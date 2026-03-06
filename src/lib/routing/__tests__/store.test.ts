import { describe, it, expect, beforeEach } from 'vitest';
import { writeJsonlFile } from '../../jsonl-store';
import {
  getAgentSkills, setAgentSkills,
  getAgentCapacity, setAgentCapacity,
  getRoutingQueues, createRoutingQueue, updateRoutingQueue, deleteRoutingQueue,
  getRoutingRules, createRoutingRule, updateRoutingRule, deleteRoutingRule,
  getRoutingLog, appendRoutingLog,
  getGroupMemberships, addGroupMember, removeGroupMember,
  getRoutingConfig, setRoutingConfig,
  getRoundRobinIndex, setRoundRobinIndex,
} from '../store';

function clearStores() {
  for (const f of [
    'routing-skills.jsonl', 'routing-capacity.jsonl', 'routing-queues.jsonl',
    'routing-rules.jsonl', 'routing-log.jsonl', 'group-memberships.jsonl',
    'routing-config.jsonl', 'routing-rr-index.jsonl',
  ]) {
    writeJsonlFile(f, []);
  }
}

describe('routing store', () => {
  beforeEach(clearStores);

  describe('agent skills', () => {
    it('sets and gets skills for a user', () => {
      setAgentSkills('u1', 'ws-1', [
        { skillName: 'technical', proficiency: 0.9 },
        { skillName: 'billing' },
      ]);
      const skills = getAgentSkills('u1');
      expect(skills).toHaveLength(2);
      expect(skills[0].skillName).toBe('technical');
      expect(skills[1].proficiency).toBe(1); // default
    });

    it('replaces skills on re-set', () => {
      setAgentSkills('u1', 'ws-1', [{ skillName: 'a' }]);
      setAgentSkills('u1', 'ws-1', [{ skillName: 'b' }]);
      const skills = getAgentSkills('u1');
      expect(skills).toHaveLength(1);
      expect(skills[0].skillName).toBe('b');
    });
  });

  describe('agent capacity', () => {
    it('sets and gets capacity', () => {
      setAgentCapacity('u1', 'ws-1', [{ channelType: 'email', maxConcurrent: 15 }]);
      const caps = getAgentCapacity('u1');
      expect(caps).toHaveLength(1);
      expect(caps[0].maxConcurrent).toBe(15);
    });
  });

  describe('routing queues', () => {
    it('creates, reads, updates, deletes', () => {
      const queue = createRoutingQueue({
        workspaceId: 'ws-1', name: 'Test Queue', priority: 5,
        conditions: {}, strategy: 'skill_match', enabled: true,
      });
      expect(queue.id).toBeTruthy();

      const all = getRoutingQueues('ws-1');
      expect(all).toHaveLength(1);

      updateRoutingQueue(queue.id, { name: 'Updated Queue' });
      const updated = getRoutingQueues('ws-1');
      expect(updated[0].name).toBe('Updated Queue');

      expect(deleteRoutingQueue(queue.id)).toBe(true);
      expect(getRoutingQueues('ws-1')).toHaveLength(0);
    });
  });

  describe('routing rules', () => {
    it('creates, reads, updates, deletes', () => {
      const rule = createRoutingRule({
        workspaceId: 'ws-1', name: 'Test Rule', priority: 10,
        conditions: {}, targetType: 'agent', targetId: 'u1', enabled: true,
      });
      expect(rule.id).toBeTruthy();

      expect(getRoutingRules('ws-1')).toHaveLength(1);

      updateRoutingRule(rule.id, { name: 'Updated' });
      expect(getRoutingRules('ws-1')[0].name).toBe('Updated');

      expect(deleteRoutingRule(rule.id)).toBe(true);
      expect(getRoutingRules('ws-1')).toHaveLength(0);
    });
  });

  describe('routing log', () => {
    it('appends and retrieves log entries', () => {
      appendRoutingLog({
        workspaceId: 'ws-1', ticketId: 't1', strategy: 'skill_match',
        matchedSkills: ['billing'], scores: { u1: 0.9 },
        reasoning: 'test', durationMs: 5, createdAt: new Date().toISOString(),
      });
      const log = getRoutingLog('ws-1');
      expect(log).toHaveLength(1);
      expect(log[0].ticketId).toBe('t1');
    });
  });

  describe('group memberships', () => {
    it('adds and removes members', () => {
      addGroupMember('ws-1', 'g1', 'u1');
      addGroupMember('ws-1', 'g1', 'u2');
      expect(getGroupMemberships('g1')).toHaveLength(2);

      // Idempotent add
      addGroupMember('ws-1', 'g1', 'u1');
      expect(getGroupMemberships('g1')).toHaveLength(2);

      expect(removeGroupMember('g1', 'u1')).toBe(true);
      expect(getGroupMemberships('g1')).toHaveLength(1);
    });
  });

  describe('routing config', () => {
    it('gets default config', () => {
      const config = getRoutingConfig();
      expect(config.defaultStrategy).toBe('skill_match');
      expect(config.enabled).toBe(true);
    });

    it('sets and retrieves config', () => {
      setRoutingConfig({
        defaultStrategy: 'round_robin',
        enabled: false,
        autoRouteOnCreate: false,
        llmEnhanced: true,
      });
      const config = getRoutingConfig();
      expect(config.defaultStrategy).toBe('round_robin');
      expect(config.enabled).toBe(false);
    });
  });

  describe('round robin index', () => {
    it('tracks index per queue', () => {
      expect(getRoundRobinIndex('q1')).toBe(0);
      setRoundRobinIndex('q1', 3);
      expect(getRoundRobinIndex('q1')).toBe(3);
      expect(getRoundRobinIndex('q2')).toBe(0);
    });
  });
});
