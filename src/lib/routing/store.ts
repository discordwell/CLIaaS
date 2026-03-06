/**
 * Dual-mode store for routing data (DB primary, JSONL fallback).
 * Uses tryDb() from store-helpers to prefer Postgres when available.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { tryDb, withRls } from '../store-helpers';
import type {
  AgentSkill,
  AgentCapacity,
  GroupMembership,
  RoutingQueue,
  RoutingRule,
  RoutingLogEntry,
  RoutingConfig,
  DEFAULT_ROUTING_CONFIG,
} from './types';

const FILES = {
  skills: 'routing-skills.jsonl',
  capacity: 'routing-capacity.jsonl',
  queues: 'routing-queues.jsonl',
  rules: 'routing-rules.jsonl',
  log: 'routing-log.jsonl',
  memberships: 'group-memberships.jsonl',
  config: 'routing-config.jsonl',
  rrIndex: 'routing-rr-index.jsonl',
} as const;

function genId(): string {
  return `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Agent Skills (dual-mode) ----

export function getAgentSkills(userId?: string): AgentSkill[] {
  // Synchronous JSONL path — async DB path available via getAgentSkillsAsync
  const all = readJsonlFile<AgentSkill>(FILES.skills);
  return userId ? all.filter(s => s.userId === userId) : all;
}

export async function getAgentSkillsAsync(userId?: string): Promise<AgentSkill[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const rows = userId
      ? await db.select().from(schema.agentSkills).where(eq(schema.agentSkills.userId, userId))
      : await db.select().from(schema.agentSkills);
    return rows.map(r => ({
      id: r.id,
      workspaceId: r.workspaceId,
      userId: r.userId,
      skillName: r.skillName,
      proficiency: (r.proficiency ?? 100) / 100, // DB stores 0-100, type uses 0-1
    }));
  }
  return getAgentSkills(userId);
}

export function setAgentSkills(userId: string, workspaceId: string, skills: Array<{ skillName: string; proficiency?: number }>): AgentSkill[] {
  const all = readJsonlFile<AgentSkill>(FILES.skills).filter(s => s.userId !== userId);
  const newSkills = skills.map(s => ({
    id: genId(),
    workspaceId,
    userId,
    skillName: s.skillName,
    proficiency: s.proficiency ?? 1,
  }));
  const updated = [...all, ...newSkills];
  writeJsonlFile(FILES.skills, updated);
  return newSkills;
}

export async function setAgentSkillsAsync(
  userId: string,
  workspaceId: string,
  skills: Array<{ skillName: string; proficiency?: number }>,
): Promise<AgentSkill[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    // Delete existing skills for this user
    await db.delete(schema.agentSkills).where(eq(schema.agentSkills.userId, userId));
    // Insert new skills
    if (skills.length > 0) {
      const rows = await db.insert(schema.agentSkills).values(
        skills.map(s => ({
          workspaceId,
          userId,
          skillName: s.skillName,
          proficiency: Math.round((s.proficiency ?? 1) * 100), // Convert 0-1 to 0-100
        })),
      ).returning();
      return rows.map(r => ({
        id: r.id,
        workspaceId: r.workspaceId,
        userId: r.userId,
        skillName: r.skillName,
        proficiency: (r.proficiency ?? 100) / 100,
      }));
    }
    return [];
  }
  return setAgentSkills(userId, workspaceId, skills);
}

// ---- Agent Capacity ----

export function getAgentCapacity(userId?: string): AgentCapacity[] {
  const all = readJsonlFile<AgentCapacity>(FILES.capacity);
  return userId ? all.filter(c => c.userId === userId) : all;
}

export function setAgentCapacity(userId: string, workspaceId: string, rules: Array<{ channelType: string; maxConcurrent: number }>): AgentCapacity[] {
  const all = readJsonlFile<AgentCapacity>(FILES.capacity).filter(c => c.userId !== userId);
  const newRules = rules.map(r => ({
    id: genId(),
    workspaceId,
    userId,
    channelType: r.channelType,
    maxConcurrent: r.maxConcurrent,
  }));
  const updated = [...all, ...newRules];
  writeJsonlFile(FILES.capacity, updated);
  return newRules;
}

// ---- Group Memberships ----

export function getGroupMemberships(groupId?: string): GroupMembership[] {
  const all = readJsonlFile<GroupMembership>(FILES.memberships);
  return groupId ? all.filter(m => m.groupId === groupId) : all;
}

export function addGroupMember(workspaceId: string, groupId: string, userId: string): GroupMembership {
  const all = readJsonlFile<GroupMembership>(FILES.memberships);
  const existing = all.find(m => m.groupId === groupId && m.userId === userId);
  if (existing) return existing;
  const membership: GroupMembership = { id: genId(), workspaceId, groupId, userId };
  all.push(membership);
  writeJsonlFile(FILES.memberships, all);
  return membership;
}

export function removeGroupMember(groupId: string, userId: string): boolean {
  const all = readJsonlFile<GroupMembership>(FILES.memberships);
  const filtered = all.filter(m => !(m.groupId === groupId && m.userId === userId));
  if (filtered.length === all.length) return false;
  writeJsonlFile(FILES.memberships, filtered);
  return true;
}

// ---- Routing Queues (dual-mode) ----

export function getRoutingQueues(workspaceId?: string): RoutingQueue[] {
  const all = readJsonlFile<RoutingQueue>(FILES.queues);
  return workspaceId ? all.filter(q => q.workspaceId === workspaceId) : all;
}

export async function getRoutingQueuesAsync(workspaceId?: string): Promise<RoutingQueue[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const rows = workspaceId
      ? await db.select().from(schema.routingQueues).where(eq(schema.routingQueues.workspaceId, workspaceId))
      : await db.select().from(schema.routingQueues);
    return rows.map(r => ({
      id: r.id,
      workspaceId: r.workspaceId,
      name: r.name,
      description: r.description ?? undefined,
      priority: r.priority,
      conditions: (r.conditions ?? {}) as RoutingQueue['conditions'],
      strategy: r.strategy as RoutingQueue['strategy'],
      groupId: r.groupId ?? undefined,
      overflowQueueId: r.overflowQueueId ?? undefined,
      overflowTimeoutSecs: r.overflowTimeoutSecs ?? undefined,
      enabled: r.enabled,
    }));
  }
  return getRoutingQueues(workspaceId);
}

export function getRoutingQueue(id: string): RoutingQueue | undefined {
  return readJsonlFile<RoutingQueue>(FILES.queues).find(q => q.id === id);
}

export function createRoutingQueue(queue: Omit<RoutingQueue, 'id'>): RoutingQueue {
  const all = readJsonlFile<RoutingQueue>(FILES.queues);
  const created: RoutingQueue = { id: genId(), ...queue };
  all.push(created);
  writeJsonlFile(FILES.queues, all);
  return created;
}

export function updateRoutingQueue(id: string, updates: Partial<RoutingQueue>): RoutingQueue | null {
  const all = readJsonlFile<RoutingQueue>(FILES.queues);
  const idx = all.findIndex(q => q.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...updates, id };
  writeJsonlFile(FILES.queues, all);
  return all[idx];
}

export function deleteRoutingQueue(id: string): boolean {
  const all = readJsonlFile<RoutingQueue>(FILES.queues);
  const filtered = all.filter(q => q.id !== id);
  if (filtered.length === all.length) return false;
  writeJsonlFile(FILES.queues, filtered);
  return true;
}

// ---- Routing Rules (dual-mode) ----

export function getRoutingRules(workspaceId?: string): RoutingRule[] {
  const all = readJsonlFile<RoutingRule>(FILES.rules);
  return workspaceId ? all.filter(r => r.workspaceId === workspaceId) : all;
}

export async function getRoutingRulesAsync(workspaceId?: string): Promise<RoutingRule[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const rows = workspaceId
      ? await db.select().from(schema.routingRules).where(eq(schema.routingRules.workspaceId, workspaceId))
      : await db.select().from(schema.routingRules);
    return rows.map(r => ({
      id: r.id,
      workspaceId: r.workspaceId,
      name: r.name,
      priority: r.priority,
      conditions: (r.conditions ?? {}) as RoutingRule['conditions'],
      targetType: r.targetType as RoutingRule['targetType'],
      targetId: r.targetId,
      enabled: r.enabled,
    }));
  }
  return getRoutingRules(workspaceId);
}

export function getRoutingRule(id: string): RoutingRule | undefined {
  return readJsonlFile<RoutingRule>(FILES.rules).find(r => r.id === id);
}

export function createRoutingRule(rule: Omit<RoutingRule, 'id'>): RoutingRule {
  const all = readJsonlFile<RoutingRule>(FILES.rules);
  const created: RoutingRule = { id: genId(), ...rule };
  all.push(created);
  writeJsonlFile(FILES.rules, all);
  return created;
}

export function updateRoutingRule(id: string, updates: Partial<RoutingRule>): RoutingRule | null {
  const all = readJsonlFile<RoutingRule>(FILES.rules);
  const idx = all.findIndex(r => r.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...updates, id };
  writeJsonlFile(FILES.rules, all);
  return all[idx];
}

export function deleteRoutingRule(id: string): boolean {
  const all = readJsonlFile<RoutingRule>(FILES.rules);
  const filtered = all.filter(r => r.id !== id);
  if (filtered.length === all.length) return false;
  writeJsonlFile(FILES.rules, filtered);
  return true;
}

// ---- Routing Log ----

export function getRoutingLog(workspaceId?: string, limit: number = 100): RoutingLogEntry[] {
  const all = readJsonlFile<RoutingLogEntry>(FILES.log);
  const filtered = workspaceId ? all.filter(l => l.workspaceId === workspaceId) : all;
  return filtered.slice(-limit);
}

export function appendRoutingLog(entry: Omit<RoutingLogEntry, 'id'>): RoutingLogEntry {
  const all = readJsonlFile<RoutingLogEntry>(FILES.log);
  const created: RoutingLogEntry = { id: genId(), ...entry };
  all.push(created);
  // Keep only last 1000 entries
  const trimmed = all.length > 1000 ? all.slice(-1000) : all;
  writeJsonlFile(FILES.log, trimmed);
  // Fire-and-forget DB write
  void appendRoutingLogAsync(entry).catch(() => {});
  return created;
}

export async function appendRoutingLogAsync(entry: Omit<RoutingLogEntry, 'id'>): Promise<RoutingLogEntry> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const [row] = await db.insert(schema.routingLog).values({
      workspaceId: entry.workspaceId,
      ticketId: entry.ticketId || null,
      queueId: entry.queueId || null,
      ruleId: entry.ruleId || null,
      assignedUserId: entry.assignedUserId || null,
      strategy: entry.strategy,
      matchedSkills: entry.matchedSkills,
      scores: entry.scores,
      reasoning: entry.reasoning,
      durationMs: entry.durationMs,
    }).returning();
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      ticketId: row.ticketId ?? '',
      queueId: row.queueId ?? undefined,
      ruleId: row.ruleId ?? undefined,
      assignedUserId: row.assignedUserId ?? undefined,
      strategy: row.strategy as RoutingLogEntry['strategy'],
      matchedSkills: (row.matchedSkills ?? []) as string[],
      scores: (row.scores ?? {}) as Record<string, number>,
      reasoning: row.reasoning ?? '',
      durationMs: row.durationMs ?? 0,
      createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    };
  }
  // Fallback to JSONL (already done synchronously by the caller)
  return { id: genId(), ...entry };
}

// ---- Routing Config ----

export function getRoutingConfig(): RoutingConfig {
  const all = readJsonlFile<RoutingConfig>(FILES.config);
  if (all.length === 0) {
    return {
      defaultStrategy: 'skill_match',
      enabled: true,
      autoRouteOnCreate: true,
      llmEnhanced: false,
    };
  }
  return all[all.length - 1];
}

export function setRoutingConfig(config: RoutingConfig): void {
  writeJsonlFile(FILES.config, [config]);
}

// ---- Round-Robin Index ----

export function getRoundRobinIndex(queueId: string): number {
  const all = readJsonlFile<{ queueId: string; index: number }>(FILES.rrIndex);
  const entry = all.find(e => e.queueId === queueId);
  return entry?.index ?? 0;
}

export function setRoundRobinIndex(queueId: string, index: number): void {
  const all = readJsonlFile<{ queueId: string; index: number }>(FILES.rrIndex);
  const existing = all.findIndex(e => e.queueId === queueId);
  if (existing >= 0) {
    all[existing].index = index;
  } else {
    all.push({ queueId, index });
  }
  writeJsonlFile(FILES.rrIndex, all);
}
