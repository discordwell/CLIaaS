import { describe, it, expect, beforeEach } from 'vitest';
import {
  listProcedures,
  getProcedure,
  createProcedure,
  updateProcedure,
  deleteProcedure,
} from '../procedures';

beforeEach(() => {
  (globalThis as Record<string, unknown>).__cliaasAIProcedures = undefined;
});

describe('procedures CRUD (in-memory fallback)', () => {
  const wsId = 'ws-test-1';

  it('creates and lists procedures', async () => {
    const proc = await createProcedure(wsId, {
      name: 'Password Reset',
      description: 'Guide user through password reset',
      steps: ['Ask for email', 'Send reset link', 'Confirm receipt'],
      triggerTopics: ['password', 'reset', 'login'],
    });

    expect(proc.id).toBeDefined();
    expect(proc.name).toBe('Password Reset');
    expect(proc.steps).toHaveLength(3);
    expect(proc.triggerTopics).toEqual(['password', 'reset', 'login']);
    expect(proc.enabled).toBe(true);

    const list = await listProcedures(wsId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(proc.id);
  });

  it('gets a procedure by id', async () => {
    const proc = await createProcedure(wsId, {
      name: 'Refund Process',
      steps: ['Verify purchase', 'Issue refund'],
      triggerTopics: ['refund'],
    });

    const found = await getProcedure(proc.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Refund Process');
  });

  it('returns null for non-existent procedure', async () => {
    const found = await getProcedure('does-not-exist');
    expect(found).toBeNull();
  });

  it('updates a procedure', async () => {
    const proc = await createProcedure(wsId, {
      name: 'Original',
      steps: ['step 1'],
      triggerTopics: ['test'],
    });

    const updated = await updateProcedure(proc.id, {
      name: 'Updated',
      steps: ['step 1', 'step 2'],
      enabled: false,
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated');
    expect(updated!.steps).toHaveLength(2);
    expect(updated!.enabled).toBe(false);
  });

  it('returns null when updating non-existent procedure', async () => {
    const result = await updateProcedure('fake-id', { name: 'nope' });
    expect(result).toBeNull();
  });

  it('deletes a procedure', async () => {
    const proc = await createProcedure(wsId, {
      name: 'To Delete',
      steps: [],
      triggerTopics: [],
    });

    const deleted = await deleteProcedure(proc.id);
    expect(deleted).toBe(true);

    const found = await getProcedure(proc.id);
    expect(found).toBeNull();
  });

  it('returns false when deleting non-existent procedure', async () => {
    const result = await deleteProcedure('fake-id');
    expect(result).toBe(false);
  });

  it('filters by workspaceId', async () => {
    await createProcedure('ws-a', {
      name: 'Proc A',
      steps: [],
      triggerTopics: [],
    });
    await createProcedure('ws-b', {
      name: 'Proc B',
      steps: [],
      triggerTopics: [],
    });

    const listA = await listProcedures('ws-a');
    expect(listA).toHaveLength(1);
    expect(listA[0].name).toBe('Proc A');

    const listB = await listProcedures('ws-b');
    expect(listB).toHaveLength(1);
    expect(listB[0].name).toBe('Proc B');
  });

  it('defaults enabled to true', async () => {
    const proc = await createProcedure(wsId, {
      name: 'Default Enabled',
      steps: [],
      triggerTopics: [],
    });
    expect(proc.enabled).toBe(true);
  });

  it('can create a disabled procedure', async () => {
    const proc = await createProcedure(wsId, {
      name: 'Disabled',
      steps: [],
      triggerTopics: [],
      enabled: false,
    });
    expect(proc.enabled).toBe(false);
  });
});
