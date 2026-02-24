import { describe, it, expect } from 'vitest';
import {
  detectConflicts,
  partitionChanges,
  type LocalChange,
  type HostedEntity,
} from '../../sync/conflict.js';

// ---- Helpers ----

function makeLocalChange(overrides: Partial<LocalChange> = {}): LocalChange {
  return {
    id: 'outbox-1',
    entityType: 'ticket',
    entityId: 'entity-1',
    operation: 'update',
    payload: { status: 'solved' },
    createdAt: '2026-02-20T12:00:00Z',
    ...overrides,
  };
}

function makeHostedEntity(overrides: Partial<HostedEntity> = {}): HostedEntity {
  return {
    id: 'entity-1',
    updatedAt: '2026-02-19T12:00:00Z', // older than local change by default
    data: { status: 'open', subject: 'Original' },
    ...overrides,
  };
}

// ---- Tests ----

describe('detectConflicts', () => {
  it('returns empty array when there are no changes', () => {
    const conflicts = detectConflicts([], new Map());
    expect(conflicts).toEqual([]);
  });

  it('skips create operations (creates cannot conflict)', () => {
    const changes: LocalChange[] = [
      makeLocalChange({ operation: 'create' }),
    ];
    const hosted = new Map([['entity-1', makeHostedEntity()]]);

    const conflicts = detectConflicts(changes, hosted);
    expect(conflicts).toEqual([]);
  });

  it('detects no conflict when hosted is older than local change', () => {
    const changes: LocalChange[] = [
      makeLocalChange({ createdAt: '2026-02-20T12:00:00Z' }),
    ];
    const hosted = new Map([
      ['entity-1', makeHostedEntity({ updatedAt: '2026-02-19T12:00:00Z' })],
    ]);

    const conflicts = detectConflicts(changes, hosted);
    expect(conflicts).toEqual([]);
  });

  it('detects conflict when hosted was updated after local change', () => {
    const changes: LocalChange[] = [
      makeLocalChange({ createdAt: '2026-02-20T12:00:00Z' }),
    ];
    const hosted = new Map([
      ['entity-1', makeHostedEntity({ updatedAt: '2026-02-21T12:00:00Z' })],
    ]);

    const conflicts = detectConflicts(changes, hosted);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].outboxId).toBe('outbox-1');
    expect(conflicts[0].entityId).toBe('entity-1');
    expect(conflicts[0].localChange).toEqual({ status: 'solved' });
    expect(conflicts[0].hostedVersion).toEqual({ status: 'open', subject: 'Original' });
    expect(conflicts[0].reason).toContain('Hosted was updated at');
  });

  it('detects conflict when entity was deleted on hosted side', () => {
    const changes: LocalChange[] = [
      makeLocalChange({ entityId: 'deleted-entity' }),
    ];
    const hosted = new Map<string, HostedEntity>(); // empty — entity not found

    const conflicts = detectConflicts(changes, hosted);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].entityId).toBe('deleted-entity');
    expect(conflicts[0].hostedVersion).toBeNull();
    expect(conflicts[0].reason).toContain('deleted on hosted side');
  });

  it('detects no conflict when timestamps are equal', () => {
    const timestamp = '2026-02-20T12:00:00Z';
    const changes: LocalChange[] = [
      makeLocalChange({ createdAt: timestamp }),
    ];
    const hosted = new Map([
      ['entity-1', makeHostedEntity({ updatedAt: timestamp })],
    ]);

    const conflicts = detectConflicts(changes, hosted);
    expect(conflicts).toEqual([]);
  });

  it('handles multiple changes with mixed results', () => {
    const changes: LocalChange[] = [
      makeLocalChange({ id: 'o1', entityId: 'e1', createdAt: '2026-02-20T12:00:00Z' }),
      makeLocalChange({ id: 'o2', entityId: 'e2', createdAt: '2026-02-20T12:00:00Z' }),
      makeLocalChange({ id: 'o3', entityId: 'e3', operation: 'create' }),
    ];
    const hosted = new Map<string, HostedEntity>([
      ['e1', makeHostedEntity({ id: 'e1', updatedAt: '2026-02-19T00:00:00Z' })], // safe
      ['e2', makeHostedEntity({ id: 'e2', updatedAt: '2026-02-21T00:00:00Z' })], // conflict
    ]);

    const conflicts = detectConflicts(changes, hosted);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].entityId).toBe('e2');
  });

  it('handles different entity types', () => {
    const changes: LocalChange[] = [
      makeLocalChange({ id: 'o1', entityType: 'ticket', entityId: 't1', createdAt: '2026-02-20T12:00:00Z' }),
      makeLocalChange({ id: 'o2', entityType: 'kb_article', entityId: 'kb1', createdAt: '2026-02-20T12:00:00Z' }),
    ];
    const hosted = new Map<string, HostedEntity>([
      ['t1', makeHostedEntity({ id: 't1', updatedAt: '2026-02-21T00:00:00Z' })],
      ['kb1', makeHostedEntity({ id: 'kb1', updatedAt: '2026-02-19T00:00:00Z' })],
    ]);

    const conflicts = detectConflicts(changes, hosted);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].entityType).toBe('ticket');
  });
});

describe('partitionChanges', () => {
  it('partitions into safe and conflicted groups', () => {
    const changes: LocalChange[] = [
      makeLocalChange({ id: 'o1', entityId: 'e1', createdAt: '2026-02-20T12:00:00Z' }),
      makeLocalChange({ id: 'o2', entityId: 'e2', createdAt: '2026-02-20T12:00:00Z' }),
      makeLocalChange({ id: 'o3', entityId: 'e3', operation: 'create' }),
    ];
    const hosted = new Map<string, HostedEntity>([
      ['e1', makeHostedEntity({ id: 'e1', updatedAt: '2026-02-19T00:00:00Z' })], // safe
      ['e2', makeHostedEntity({ id: 'e2', updatedAt: '2026-02-21T00:00:00Z' })], // conflict
    ]);

    const { safe, conflicted } = partitionChanges(changes, hosted);

    expect(safe).toHaveLength(2); // e1 (safe update) + e3 (create)
    expect(conflicted).toHaveLength(1);
    expect(safe.map(s => s.id)).toContain('o1');
    expect(safe.map(s => s.id)).toContain('o3');
    expect(conflicted[0].outboxId).toBe('o2');
  });

  it('returns all safe when no conflicts', () => {
    const changes: LocalChange[] = [
      makeLocalChange({ id: 'o1', entityId: 'e1', createdAt: '2026-02-20T12:00:00Z' }),
    ];
    const hosted = new Map([
      ['e1', makeHostedEntity({ id: 'e1', updatedAt: '2026-02-19T00:00:00Z' })],
    ]);

    const { safe, conflicted } = partitionChanges(changes, hosted);

    expect(safe).toHaveLength(1);
    expect(conflicted).toHaveLength(0);
  });

  it('returns all conflicted when everything conflicts', () => {
    const changes: LocalChange[] = [
      makeLocalChange({ id: 'o1', entityId: 'e1', createdAt: '2026-02-20T12:00:00Z' }),
    ];
    const hosted = new Map([
      ['e1', makeHostedEntity({ id: 'e1', updatedAt: '2026-02-21T00:00:00Z' })],
    ]);

    const { safe, conflicted } = partitionChanges(changes, hosted);

    expect(safe).toHaveLength(0);
    expect(conflicted).toHaveLength(1);
  });

  it('handles empty inputs', () => {
    const { safe, conflicted } = partitionChanges([], new Map());

    expect(safe).toEqual([]);
    expect(conflicted).toEqual([]);
  });
});
