/**
 * Shared types for the routing domain.
 */

export type RoutingStrategy = 'round_robin' | 'load_balanced' | 'skill_match' | 'priority_weighted';
export type AgentAvailabilityStatus = 'online' | 'away' | 'offline';

export interface AgentSkill {
  id: string;
  workspaceId: string;
  userId: string;
  skillName: string;
  proficiency: number; // 0-1
}

export interface AgentCapacity {
  id: string;
  workspaceId: string;
  userId: string;
  channelType: string;
  maxConcurrent: number;
}

export interface GroupMembership {
  id: string;
  workspaceId: string;
  userId: string;
  groupId: string;
}

export interface RoutingQueue {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  priority: number;
  conditions: RoutingConditions;
  strategy: RoutingStrategy;
  groupId?: string;
  overflowQueueId?: string;
  overflowTimeoutSecs?: number;
  enabled: boolean;
}

export interface RoutingRule {
  id: string;
  workspaceId: string;
  name: string;
  priority: number;
  conditions: RoutingConditions;
  targetType: 'queue' | 'group' | 'agent';
  targetId: string;
  enabled: boolean;
}

export interface RoutingLogEntry {
  id: string;
  workspaceId: string;
  ticketId: string;
  queueId?: string;
  ruleId?: string;
  assignedUserId?: string;
  strategy: RoutingStrategy;
  matchedSkills: string[];
  scores: Record<string, number>;
  reasoning: string;
  durationMs: number;
  createdAt: string;
}

export interface RoutingConditions {
  all?: RoutingCondition[];
  any?: RoutingCondition[];
}

export interface RoutingCondition {
  field: string;
  operator: string;
  value: unknown;
}

export interface ScoredAgent {
  userId: string;
  userName: string;
  score: number;
  matchedSkills: string[];
  load: number;
  capacity: number;
}

export interface RoutingResult {
  ticketId: string;
  suggestedAgentId: string;
  suggestedAgentName: string;
  matchedSkills: string[];
  reasoning: string;
  confidence: number;
  queueId?: string;
  ruleId?: string;
  strategy: RoutingStrategy;
  alternateAgents: Array<{
    agentId: string;
    agentName: string;
    score: number;
  }>;
}

export interface RoutingConfig {
  defaultStrategy: RoutingStrategy;
  enabled: boolean;
  autoRouteOnCreate: boolean;
  llmEnhanced: boolean;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  defaultStrategy: 'skill_match',
  enabled: true,
  autoRouteOnCreate: true,
  llmEnhanced: false,
};
