import type { Command } from 'commander';
import chalk from 'chalk';
import { output, outputError, isJsonMode } from '../output.js';
import {
  PERMISSION_KEYS,
  BUILTIN_ROLE_MATRIX,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES,
} from '@/lib/rbac/constants.js';
import type { BuiltinRole } from '@/lib/rbac/types.js';

const BASE_URL = () => process.env.CLIAAS_API_URL || 'http://localhost:3000';

export function registerRoleCommands(program: Command): void {
  // ---- roles ----
  const roles = program.command('roles').description('Manage roles and permissions');

  roles
    .command('list')
    .description('List built-in roles')
    .action(() => {
      const roleNames = Object.keys(BUILTIN_ROLE_MATRIX) as BuiltinRole[];
      const data = roleNames.map(name => ({
        name,
        permissionCount: BUILTIN_ROLE_MATRIX[name].length,
        totalPermissions: PERMISSION_KEYS.length,
      }));

      output(data, () => {
        console.log(chalk.bold('\nBuilt-in Roles\n'));
        console.log(`${'ROLE'.padEnd(20)} PERMISSIONS`);
        console.log('\u2500'.repeat(40));
        for (const r of data) {
          console.log(`${chalk.cyan(r.name.padEnd(20))} ${r.permissionCount}/${r.totalPermissions}`);
        }
        console.log('');
      });
    });

  roles
    .command('show <role>')
    .description('Show permissions for a role')
    .action((role: string) => {
      const perms = BUILTIN_ROLE_MATRIX[role as BuiltinRole];
      if (!perms) {
        outputError(`Unknown role: ${role}. Valid roles: ${Object.keys(BUILTIN_ROLE_MATRIX).join(', ')}`);
        process.exitCode = 1;
        return;
      }

      const grouped: Record<string, string[]> = {};
      for (const key of perms) {
        const cat = PERMISSION_CATEGORIES[key] ?? 'other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(key);
      }

      const data = {
        role,
        permissionCount: perms.length,
        totalPermissions: PERMISSION_KEYS.length,
        permissions: perms.map(k => ({
          key: k,
          label: PERMISSION_LABELS[k] ?? k,
          category: PERMISSION_CATEGORIES[k] ?? 'other',
        })),
      };

      output(data, () => {
        console.log(chalk.bold(`\nRole: ${chalk.cyan(role)}`) + `  (${perms.length}/${PERMISSION_KEYS.length} permissions)\n`);
        for (const [cat, keys] of Object.entries(grouped)) {
          console.log(chalk.bold(`  ${cat}`));
          for (const key of keys) {
            console.log(`    ${chalk.green('\u2713')} ${PERMISSION_LABELS[key] ?? key} ${chalk.gray(`(${key})`)}`);
          }
        }
        console.log('');
      });
    });

  roles
    .command('assign <userId> <role>')
    .description('Assign a role to a user')
    .action(async (userId: string, role: string) => {
      const validRoles = Object.keys(BUILTIN_ROLE_MATRIX);
      if (!validRoles.includes(role)) {
        outputError(`Invalid role: ${role}. Valid roles: ${validRoles.join(', ')}`);
        process.exitCode = 1;
        return;
      }

      try {
        const res = await fetch(`${BASE_URL()}/api/users/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        output(data, () => {
          console.log(chalk.green(`\nRole '${role}' assigned to user ${userId}`));
          if (data.user) {
            console.log(`  Name:  ${data.user.name ?? 'N/A'}`);
            console.log(`  Email: ${data.user.email ?? 'N/A'}`);
            console.log(`  Role:  ${chalk.cyan(data.user.role)}`);
          }
          console.log('');
        });
      } catch (err) {
        outputError(`Failed to assign role: ${err instanceof Error ? err.message : 'Unknown error'}`);
        process.exitCode = 1;
      }
    });

  // ---- groups ----
  const groups = program.command('groups').description('Manage agent groups');

  groups
    .command('list')
    .description('List groups')
    .action(async () => {
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

          output({ groups: rows }, () => {
            console.log(chalk.bold(`\nGroups (${rows.length})\n`));
            console.log(`${'NAME'.padEnd(25)} ${'DEFAULT ROLE'.padEnd(15)} ID`);
            console.log('\u2500'.repeat(70));
            for (const g of rows) {
              console.log(`${chalk.cyan(g.name.padEnd(25))} ${(g.defaultRole ?? 'agent').padEnd(15)} ${chalk.gray(g.id)}`);
            }
            console.log('');
          });
        } else {
          // Fallback to routing store (JSONL mode)
          const { getGroupMemberships } = await import('@/lib/routing/store.js');
          const memberships = getGroupMemberships();
          const groupIds = [...new Set(memberships.map(m => m.groupId))];

          output({ groups: groupIds.map(id => ({ id })) }, () => {
            console.log(chalk.bold(`\nGroups (${groupIds.length})\n`));
            for (const id of groupIds) {
              console.log(`  ${id}`);
            }
            console.log('');
          });
        }
      } catch (err) {
        outputError(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
        process.exitCode = 1;
      }
    });

  groups
    .command('members <groupId>')
    .description('List members of a group')
    .action(async (groupId: string) => {
      try {
        const res = await fetch(`${BASE_URL()}/api/groups/${groupId}/members`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        const members = Array.isArray(data) ? data : (data.members ?? []);
        output({ groupId, members }, () => {
          console.log(chalk.bold(`\nGroup ${groupId} Members (${members.length})\n`));
          if (members.length === 0) {
            console.log(chalk.yellow('  No members'));
          } else {
            for (const m of members) {
              console.log(`  ${m.userId ?? m.id ?? JSON.stringify(m)}`);
            }
          }
          console.log('');
        });
      } catch (err) {
        outputError(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`);
        process.exitCode = 1;
      }
    });

  groups
    .command('add-member <groupId> <userId>')
    .description('Add a user to a group')
    .action(async (groupId: string, userId: string) => {
      try {
        const res = await fetch(`${BASE_URL()}/api/groups/${groupId}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        output(data, () => {
          console.log(chalk.green(`\nAdded user ${userId} to group ${groupId}`));
          console.log('');
        });
      } catch (err) {
        outputError(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`);
        process.exitCode = 1;
      }
    });

  groups
    .command('remove-member <groupId> <userId>')
    .description('Remove a user from a group')
    .action(async (groupId: string, userId: string) => {
      try {
        const res = await fetch(`${BASE_URL()}/api/groups/${groupId}/members/${userId}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        output(data, () => {
          console.log(chalk.green(`\nRemoved user ${userId} from group ${groupId}`));
          console.log('');
        });
      } catch (err) {
        outputError(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`);
        process.exitCode = 1;
      }
    });

  // ---- ticket collaborators (extend the existing tickets command) ----
  // We register under a 'collaborators' subcommand group
  const collab = program.command('collaborators').description('Manage ticket collaborators');

  collab
    .command('list <ticketId>')
    .description('List collaborators on a ticket')
    .action(async (ticketId: string) => {
      try {
        const res = await fetch(`${BASE_URL()}/api/tickets/${ticketId}/collaborators`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        const collaborators = data.collaborators ?? [];
        output({ ticketId, collaborators }, () => {
          console.log(chalk.bold(`\nCollaborators on ticket ${ticketId} (${collaborators.length})\n`));
          if (collaborators.length === 0) {
            console.log(chalk.yellow('  No collaborators'));
          } else {
            console.log(`${'USER'.padEnd(40)} ${'CAN REPLY'.padEnd(12)} ADDED`);
            console.log('\u2500'.repeat(70));
            for (const c of collaborators) {
              const name = c.userName ?? c.userEmail ?? c.userId;
              const canReply = c.canReply ? chalk.green('Yes') : chalk.gray('No');
              const added = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : 'N/A';
              console.log(`${chalk.cyan(String(name).padEnd(40))} ${String(canReply).padEnd(12)} ${added}`);
            }
          }
          console.log('');
        });
      } catch (err) {
        outputError(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`);
        process.exitCode = 1;
      }
    });

  collab
    .command('add <ticketId> <userId>')
    .description('Add a collaborator to a ticket')
    .option('--can-reply', 'Allow the collaborator to send public replies')
    .action(async (ticketId: string, userId: string, opts: { canReply?: boolean }) => {
      try {
        const res = await fetch(`${BASE_URL()}/api/tickets/${ticketId}/collaborators`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, canReply: opts.canReply ?? false }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        output(data, () => {
          console.log(chalk.green(`\nAdded collaborator ${userId} to ticket ${ticketId}`));
          if (opts.canReply) console.log(`  Can reply: ${chalk.green('Yes')}`);
          console.log('');
        });
      } catch (err) {
        outputError(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`);
        process.exitCode = 1;
      }
    });

  collab
    .command('remove <ticketId> <userId>')
    .description('Remove a collaborator from a ticket')
    .action(async (ticketId: string, userId: string) => {
      try {
        const res = await fetch(`${BASE_URL()}/api/tickets/${ticketId}/collaborators`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        output(data, () => {
          console.log(chalk.green(`\nRemoved collaborator ${userId} from ticket ${ticketId}`));
          console.log('');
        });
      } catch (err) {
        outputError(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`);
        process.exitCode = 1;
      }
    });
}
