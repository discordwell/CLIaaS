import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/password';
import { ROLE_HIERARCHY, type Role } from '@/lib/api-auth';

export type UserRow = typeof users.$inferSelect;

/** Sanitize a user row for API responses (strip passwordHash). */
export function sanitizeUser(u: UserRow) {
  const { passwordHash, ...safe } = u;
  return safe;
}

// ---- Queries ----

export async function listWorkspaceUsers(workspaceId: string) {
  return db
    .select()
    .from(users)
    .where(eq(users.workspaceId, workspaceId));
}

export async function getUser(userId: string, workspaceId: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.workspaceId, workspaceId)));
  return user ?? null;
}

// ---- Mutations ----

type UserStatus = 'active' | 'inactive' | 'invited' | 'disabled';

export async function updateUser(
  userId: string,
  workspaceId: string,
  data: { name?: string; role?: Role; status?: UserStatus },
  actorRole: Role,
) {
  const target = await getUser(userId, workspaceId);
  if (!target) throw new Error('User not found');

  // Can't set a role higher than your own
  if (data.role && (ROLE_HIERARCHY[data.role] ?? 0) > (ROLE_HIERARCHY[actorRole] ?? 0)) {
    throw new Error('Cannot assign a role higher than your own');
  }

  // Owner can't be demoted
  if (target.role === 'owner' && data.role && data.role !== 'owner') {
    throw new Error('Cannot demote the workspace owner');
  }

  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.workspaceId, workspaceId)))
    .returning();
  return updated;
}

export async function inviteUser(
  workspaceId: string,
  data: { email: string; name: string; role?: Role },
  tenantId?: string,
) {
  // Check for existing user with same email in workspace
  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.workspaceId, workspaceId), eq(users.email, data.email)));
  if (existing) throw new Error('A user with this email already exists in this workspace');

  const [created] = await db
    .insert(users)
    .values({
      workspaceId,
      tenantId: tenantId ?? null,
      email: data.email,
      name: data.name,
      role: data.role ?? 'agent',
      status: 'invited',
    })
    .returning();
  return created;
}

export async function removeUser(userId: string, workspaceId: string, actorId: string) {
  if (userId === actorId) throw new Error('Cannot remove yourself');

  const target = await getUser(userId, workspaceId);
  if (!target) throw new Error('User not found');
  if (target.role === 'owner') throw new Error('Cannot remove the workspace owner');

  const [updated] = await db
    .update(users)
    .set({ status: 'disabled', updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.workspaceId, workspaceId)))
    .returning();
  return updated;
}

// ---- Self-service ----

export async function updateProfile(userId: string, data: { name: string }) {
  const [updated] = await db
    .update(users)
    .set({ name: data.name, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw new Error('User not found');
  return updated;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new Error('User not found');

  if (!user.passwordHash) {
    throw new Error('Cannot change password for accounts without a password (use SSO/OAuth)');
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw new Error('Current password is incorrect');

  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters');

  const hash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash: hash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
