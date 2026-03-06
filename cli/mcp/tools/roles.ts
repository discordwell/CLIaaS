/**
 * MCP tools for RBAC: roles, groups, and collaborators.
 * Read-only tools use the constants module directly.
 * Write tools use the confirmation pattern and scope controls.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';
import {
  PERMISSION_KEYS,
  BUILTIN_ROLE_MATRIX,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES,
} from '@/lib/rbac/constants.js';
import type { BuiltinRole } from '@/lib/rbac/types.js';

export function registerRoleTools(server: McpServer): void {
  // ---- roles_list ----
  server.tool(
    'roles_list',
    'List built-in roles with permission counts',
    {},
    async () => {
      const roleNames = Object.keys(BUILTIN_ROLE_MATRIX) as BuiltinRole[];
      const roles = roleNames.map(name => ({
        name,
        permissionCount: BUILTIN_ROLE_MATRIX[name].length,
        totalPermissions: PERMISSION_KEYS.length,
      }));
      return textResult({ roles });
    },
  );

  // ---- role_permissions ----
  server.tool(
    'role_permissions',
    'Get permissions for a specific built-in role',
    {
      role: z.string().describe('Role name (owner, admin, agent, light_agent, collaborator, viewer)'),
    },
    async ({ role }) => {
      const perms = BUILTIN_ROLE_MATRIX[role as BuiltinRole];
      if (!perms) {
        return errorResult(`Unknown role: "${role}". Valid roles: ${Object.keys(BUILTIN_ROLE_MATRIX).join(', ')}`);
      }

      const permissions = perms.map(key => ({
        key,
        label: PERMISSION_LABELS[key] ?? key,
        category: PERMISSION_CATEGORIES[key] ?? 'other',
      }));

      return textResult({
        role,
        permissionCount: perms.length,
        totalPermissions: PERMISSION_KEYS.length,
        permissions,
      });
    },
  );

  // ---- user_permissions ----
  server.tool(
    'user_permissions',
    'Get effective permissions for a user (resolved from role + custom overrides)',
    {
      userId: z.string().describe('User ID'),
    },
    async ({ userId }) => {
      try {
        // Try DB path first
        const { tryDb } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq } = await import('drizzle-orm');
          const [user] = await conn.db
            .select({ id: conn.schema.users.id, role: conn.schema.users.role, name: conn.schema.users.name, email: conn.schema.users.email })
            .from(conn.schema.users)
            .where(eq(conn.schema.users.id, userId))
            .limit(1);

          if (!user) return errorResult(`User "${userId}" not found.`);

          const { resolveUserPermissions, getUserBitfield } = await import('@/lib/rbac/permissions.js');
          const permissions = await resolveUserPermissions(user.role);
          const bitfield = await getUserBitfield(user.role);

          return textResult({
            userId,
            name: user.name,
            email: user.email,
            role: user.role,
            permissions,
            bitfield: bitfield.toString(),
            permissionCount: permissions.length,
            totalPermissions: PERMISSION_KEYS.length,
          });
        }

        // No DB — use role directly from constants
        return errorResult('Database not available. Cannot look up user permissions without DB.');
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get user permissions');
      }
    },
  );

  // ---- roles_assign ----
  server.tool(
    'roles_assign',
    'Assign a built-in role to a user (requires confirm=true)',
    {
      userId: z.string().describe('User ID'),
      role: z.string().describe('Role to assign (owner, admin, agent, light_agent, collaborator, viewer)'),
      confirm: z.boolean().optional().describe('Must be true to execute'),
    },
    async ({ userId, role, confirm }) => {
      const guard = scopeGuard('roles_assign');
      if (guard) return guard;

      const validRoles = Object.keys(BUILTIN_ROLE_MATRIX);
      if (!validRoles.includes(role)) {
        return errorResult(`Invalid role: "${role}". Valid roles: ${validRoles.join(', ')}`);
      }

      // Prevent escalation to owner via MCP
      if (role === 'owner') {
        return errorResult('Cannot assign owner role via MCP. Use the admin UI.');
      }

      const result = withConfirmation(confirm, {
        description: `Assign role "${role}" to user ${userId}`,
        preview: { userId, role, permissionCount: BUILTIN_ROLE_MATRIX[role as BuiltinRole].length },
        execute: async () => {
          const { tryDb } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return { error: 'Database not available' };

          const { eq, and } = await import('drizzle-orm');

          // Workspace-scoped lookup to prevent cross-workspace role assignment
          const wsId = process.env.WORKSPACE_ID;
          const whereClause = wsId
            ? and(eq(conn.schema.users.id, userId), eq(conn.schema.users.workspaceId, wsId))
            : eq(conn.schema.users.id, userId);

          const [updated] = await conn.db
            .update(conn.schema.users)
            .set({ role: role as typeof conn.schema.users.$inferInsert['role'] })
            .where(whereClause)
            .returning({ id: conn.schema.users.id, name: conn.schema.users.name, role: conn.schema.users.role });

          if (!updated) return { error: 'User not found in this workspace' };

          recordMCPAction({
            tool: 'roles_assign', action: 'assign',
            params: { userId, role },
            timestamp: new Date().toISOString(), result: 'success',
          });

          return { assigned: true, user: updated };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- group_list ----
  server.tool(
    'group_list',
    'List groups in the workspace',
    {},
    async () => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq } = await import('drizzle-orm');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const rows = await conn.db
            .select({
              id: conn.schema.groups.id,
              name: conn.schema.groups.name,
              defaultRole: conn.schema.groups.defaultRole,
              createdAt: conn.schema.groups.createdAt,
            })
            .from(conn.schema.groups)
            .where(eq(conn.schema.groups.workspaceId, wsId))
            .orderBy(conn.schema.groups.name);

          return textResult({ count: rows.length, groups: rows });
        }

        // Fallback: routing store
        const { getGroupMemberships } = await import('@/lib/routing/store.js');
        const memberships = getGroupMemberships();
        const groupIds = [...new Set(memberships.map(m => m.groupId))];
        return textResult({ count: groupIds.length, groups: groupIds.map(id => ({ id })) });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list groups');
      }
    },
  );

  // ---- group_members ----
  server.tool(
    'group_members',
    'List members of a group',
    {
      groupId: z.string().describe('Group ID'),
    },
    async ({ groupId }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq, and } = await import('drizzle-orm');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const rows = await conn.db
            .select({
              id: conn.schema.groupMemberships.id,
              userId: conn.schema.groupMemberships.userId,
              createdAt: conn.schema.groupMemberships.createdAt,
              userName: conn.schema.users.name,
              userEmail: conn.schema.users.email,
              userRole: conn.schema.users.role,
            })
            .from(conn.schema.groupMemberships)
            .innerJoin(conn.schema.users, eq(conn.schema.users.id, conn.schema.groupMemberships.userId))
            .where(
              and(
                eq(conn.schema.groupMemberships.groupId, groupId),
                eq(conn.schema.groupMemberships.workspaceId, wsId),
              ),
            );

          return textResult({ groupId, count: rows.length, members: rows });
        }

        // Fallback: routing store
        const { getGroupMemberships } = await import('@/lib/routing/store.js');
        const members = getGroupMemberships(groupId);
        return textResult({ groupId, count: members.length, members });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list group members');
      }
    },
  );

  // ---- group_add_member ----
  server.tool(
    'group_add_member',
    'Add a user to a group (requires confirm=true)',
    {
      groupId: z.string().describe('Group ID'),
      userId: z.string().describe('User ID to add'),
      confirm: z.boolean().optional().describe('Must be true to execute'),
    },
    async ({ groupId, userId, confirm }) => {
      const guard = scopeGuard('group_add_member');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Add user ${userId} to group ${groupId}`,
        preview: { groupId, userId },
        execute: async () => {
          const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();

          if (conn) {
            const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
            const [created] = await conn.db
              .insert(conn.schema.groupMemberships)
              .values({ workspaceId: wsId, groupId, userId })
              .onConflictDoNothing()
              .returning();

            recordMCPAction({
              tool: 'group_add_member', action: 'add',
              params: { groupId, userId },
              timestamp: new Date().toISOString(), result: 'success',
            });

            return created
              ? { added: true, membership: created }
              : { added: false, message: 'User is already a member of this group' };
          }

          // Fallback: routing store
          const { addGroupMember } = await import('@/lib/routing/store.js');
          const membership = addGroupMember('', groupId, userId);

          recordMCPAction({
            tool: 'group_add_member', action: 'add',
            params: { groupId, userId },
            timestamp: new Date().toISOString(), result: 'success',
          });

          return { added: true, membership };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- group_remove_member ----
  server.tool(
    'group_remove_member',
    'Remove a user from a group (requires confirm=true)',
    {
      groupId: z.string().describe('Group ID'),
      userId: z.string().describe('User ID to remove'),
      confirm: z.boolean().optional().describe('Must be true to execute'),
    },
    async ({ groupId, userId, confirm }) => {
      const guard = scopeGuard('group_remove_member');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Remove user ${userId} from group ${groupId}`,
        preview: { groupId, userId },
        execute: async () => {
          const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();

          if (conn) {
            const { eq, and } = await import('drizzle-orm');
            const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
            const [deleted] = await conn.db
              .delete(conn.schema.groupMemberships)
              .where(
                and(
                  eq(conn.schema.groupMemberships.groupId, groupId),
                  eq(conn.schema.groupMemberships.userId, userId),
                  eq(conn.schema.groupMemberships.workspaceId, wsId),
                ),
              )
              .returning();

            if (!deleted) return { removed: false, error: 'Membership not found' };

            recordMCPAction({
              tool: 'group_remove_member', action: 'remove',
              params: { groupId, userId },
              timestamp: new Date().toISOString(), result: 'success',
            });

            return { removed: true };
          }

          // Fallback: routing store
          const { removeGroupMember } = await import('@/lib/routing/store.js');
          const removed = removeGroupMember(groupId, userId);

          if (!removed) return { removed: false, error: 'Membership not found' };

          recordMCPAction({
            tool: 'group_remove_member', action: 'remove',
            params: { groupId, userId },
            timestamp: new Date().toISOString(), result: 'success',
          });

          return { removed: true };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- ticket_add_collaborator ----
  server.tool(
    'ticket_add_collaborator',
    'Add a collaborator to a ticket (requires confirm=true)',
    {
      ticketId: z.string().describe('Ticket ID'),
      userId: z.string().describe('User ID to add as collaborator'),
      canReply: z.boolean().optional().describe('Allow collaborator to send public replies (default false)'),
      confirm: z.boolean().optional().describe('Must be true to execute'),
    },
    async ({ ticketId, userId, canReply, confirm }) => {
      const guard = scopeGuard('ticket_add_collaborator');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Add collaborator ${userId} to ticket ${ticketId}`,
        preview: { ticketId, userId, canReply: canReply ?? false },
        execute: async () => {
          const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return { error: 'Database not available' };

          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const [created] = await conn.db
            .insert(conn.schema.ticketCollaborators)
            .values({
              workspaceId: wsId,
              ticketId,
              userId,
              canReply: canReply ?? false,
            })
            .onConflictDoNothing()
            .returning();

          recordMCPAction({
            tool: 'ticket_add_collaborator', action: 'add',
            params: { ticketId, userId, canReply },
            timestamp: new Date().toISOString(), result: 'success',
          });

          return created
            ? { added: true, collaborator: created }
            : { added: false, message: 'User is already a collaborator on this ticket' };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- ticket_remove_collaborator ----
  server.tool(
    'ticket_remove_collaborator',
    'Remove a collaborator from a ticket (requires confirm=true)',
    {
      ticketId: z.string().describe('Ticket ID'),
      userId: z.string().describe('User ID to remove'),
      confirm: z.boolean().optional().describe('Must be true to execute'),
    },
    async ({ ticketId, userId, confirm }) => {
      const guard = scopeGuard('ticket_remove_collaborator');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Remove collaborator ${userId} from ticket ${ticketId}`,
        preview: { ticketId, userId },
        execute: async () => {
          const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return { error: 'Database not available' };

          const { eq, and } = await import('drizzle-orm');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const [deleted] = await conn.db
            .delete(conn.schema.ticketCollaborators)
            .where(
              and(
                eq(conn.schema.ticketCollaborators.ticketId, ticketId),
                eq(conn.schema.ticketCollaborators.userId, userId),
                eq(conn.schema.ticketCollaborators.workspaceId, wsId),
              ),
            )
            .returning();

          if (!deleted) return { removed: false, error: 'Collaborator not found' };

          recordMCPAction({
            tool: 'ticket_remove_collaborator', action: 'remove',
            params: { ticketId, userId },
            timestamp: new Date().toISOString(), result: 'success',
          });

          return { removed: true };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- ticket_list_collaborators ----
  server.tool(
    'ticket_list_collaborators',
    'List collaborators on a ticket',
    {
      ticketId: z.string().describe('Ticket ID'),
    },
    async ({ ticketId }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) return textResult({ ticketId, collaborators: [], message: 'Database not available' });

        const { eq, and } = await import('drizzle-orm');
        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        const rows = await conn.db
          .select({
            id: conn.schema.ticketCollaborators.id,
            userId: conn.schema.ticketCollaborators.userId,
            canReply: conn.schema.ticketCollaborators.canReply,
            addedBy: conn.schema.ticketCollaborators.addedBy,
            createdAt: conn.schema.ticketCollaborators.createdAt,
            userName: conn.schema.users.name,
            userEmail: conn.schema.users.email,
            userRole: conn.schema.users.role,
          })
          .from(conn.schema.ticketCollaborators)
          .innerJoin(conn.schema.users, eq(conn.schema.users.id, conn.schema.ticketCollaborators.userId))
          .where(
            and(
              eq(conn.schema.ticketCollaborators.ticketId, ticketId),
              eq(conn.schema.ticketCollaborators.workspaceId, wsId),
            ),
          );

        return textResult({ ticketId, count: rows.length, collaborators: rows });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list collaborators');
      }
    },
  );
}
