import { describe, it, expect, beforeEach } from 'vitest';
import { applyStrategy } from '../strategies';
import { writeJsonlFile } from '../../jsonl-store';
import type { ScoredAgent } from '../types';

function clearStores() {
  writeJsonlFile('routing-rr-index.jsonl', []);
}

function makeCandidates(): ScoredAgent[] {
  return [
    { userId: 'a1', userName: 'Alice', score: 0.9, matchedSkills: ['technical'], load: 3, capacity: 10 },
    { userId: 'a2', userName: 'Bob', score: 0.7, matchedSkills: ['billing'], load: 8, capacity: 10 },
    { userId: 'a3', userName: 'Carol', score: 0.5, matchedSkills: [], load: 1, capacity: 10 },
  ];
}

describe('applyStrategy', () => {
  beforeEach(clearStores);

  it('skill_match picks highest score', () => {
    const result = applyStrategy('skill_match', makeCandidates(), {});
    expect(result?.userId).toBe('a1');
  });

  it('load_balanced picks lowest load ratio', () => {
    const result = applyStrategy('load_balanced', makeCandidates(), {});
    expect(result?.userId).toBe('a3'); // 1/10 = 0.1
  });

  it('round_robin rotates through candidates', () => {
    const candidates = makeCandidates();
    const r1 = applyStrategy('round_robin', candidates, { queueId: 'q1' });
    const r2 = applyStrategy('round_robin', candidates, { queueId: 'q1' });
    const r3 = applyStrategy('round_robin', candidates, { queueId: 'q1' });

    expect(r1?.userId).toBe('a1');
    expect(r2?.userId).toBe('a2');
    expect(r3?.userId).toBe('a3');
  });

  it('priority_weighted boosts high-skill agents for urgent tickets', () => {
    const candidates = [
      { userId: 'a1', userName: 'Alice', score: 0.6, matchedSkills: ['technical'], load: 3, capacity: 10 },
      { userId: 'a2', userName: 'Bob', score: 0.55, matchedSkills: ['billing'], load: 1, capacity: 10 },
    ];
    const result = applyStrategy('priority_weighted', candidates, { ticketPriority: 'urgent' });
    expect(result?.userId).toBe('a1'); // 0.6 + 0.15 boost > 0.55 + 0.15
  });

  it('returns null for empty candidates', () => {
    const result = applyStrategy('skill_match', [], {});
    expect(result).toBeNull();
  });
});
