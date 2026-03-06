/**
 * Dual-mode store for routing data (JSONL + DB).
 * Follows the pattern from src/lib/webhooks.ts / src/lib/sla.ts.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
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

// ---- Agent Skills ----

export function getAgentSkills(userId?: string): AgentSkill[] {
  const all = readJsonlFile<AgentSkill>(FILES.skills);
  return userId ? all.filter(s => s.userId === userId) : all;
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

// ---- Routing Queues ----

export function getRoutingQueues(workspaceId?: string): RoutingQueue[] {
  const all = readJsonlFile<RoutingQueue>(FILES.queues);
  return workspaceId ? all.filter(q => q.workspaceId === workspaceId) : all;
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

// ---- Routing Rules ----

export function getRoutingRules(workspaceId?: string): RoutingRule[] {
  const all = readJsonlFile<RoutingRule>(FILES.rules);
  return workspaceId ? all.filter(r => r.workspaceId === workspaceId) : all;
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
  return created;
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
