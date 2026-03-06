import { describe, it, expect } from 'vitest';
import {
  evaluateCustomer,
  evaluateSegment,
  evaluateSegmentWithStats,
  type SegmentQuery,
  type EvaluableCustomer,
} from '../lib/segments/evaluator';

const customers: EvaluableCustomer[] = [
  { id: '1', email: 'alice@example.com', name: 'Alice', plan: 'pro', tags: ['vip', 'early-adopter'], ticketCount: 5, totalSpend: 500, customAttributes: { industry: 'tech' } },
  { id: '2', email: 'bob@example.com', name: 'Bob', plan: 'free', tags: ['trial'], ticketCount: 1, totalSpend: 0 },
  { id: '3', email: 'carol@example.com', name: 'Carol', plan: 'enterprise', tags: ['vip'], ticketCount: 20, totalSpend: 5000, customAttributes: { industry: 'finance' } },
  { id: '4', email: 'dave@example.com', name: 'Dave', plan: 'pro', tags: [], ticketCount: 0, totalSpend: 100 },
  { id: '5', name: 'Eve', plan: 'free', tags: ['trial'], ticketCount: 3 },
];

describe('evaluateCustomer', () => {
  it('eq operator matches exact value', () => {
    const query: SegmentQuery = { conditions: [{ field: 'plan', operator: 'eq', value: 'pro' }] };
    expect(evaluateCustomer(customers[0], query)).toBe(true);
    expect(evaluateCustomer(customers[1], query)).toBe(false);
  });

  it('neq operator excludes value', () => {
    const query: SegmentQuery = { conditions: [{ field: 'plan', operator: 'neq', value: 'free' }] };
    expect(evaluateCustomer(customers[0], query)).toBe(true);
    expect(evaluateCustomer(customers[1], query)).toBe(false);
  });

  it('gt/gte/lt/lte operators work with numbers', () => {
    expect(evaluateCustomer(customers[0], { conditions: [{ field: 'ticketCount', operator: 'gt', value: 3 }] })).toBe(true);
    expect(evaluateCustomer(customers[0], { conditions: [{ field: 'ticketCount', operator: 'gte', value: 5 }] })).toBe(true);
    expect(evaluateCustomer(customers[0], { conditions: [{ field: 'ticketCount', operator: 'lt', value: 5 }] })).toBe(false);
    expect(evaluateCustomer(customers[3], { conditions: [{ field: 'ticketCount', operator: 'lte', value: 0 }] })).toBe(true);
  });

  it('contains operator checks array membership', () => {
    const query: SegmentQuery = { conditions: [{ field: 'tags', operator: 'contains', value: 'vip' }] };
    expect(evaluateCustomer(customers[0], query)).toBe(true);
    expect(evaluateCustomer(customers[1], query)).toBe(false);
  });

  it('not_contains operator excludes array membership', () => {
    const query: SegmentQuery = { conditions: [{ field: 'tags', operator: 'not_contains', value: 'vip' }] };
    expect(evaluateCustomer(customers[0], query)).toBe(false);
    expect(evaluateCustomer(customers[1], query)).toBe(true);
  });

  it('in operator checks value in array', () => {
    const query: SegmentQuery = { conditions: [{ field: 'plan', operator: 'in', value: ['pro', 'enterprise'] }] };
    expect(evaluateCustomer(customers[0], query)).toBe(true);
    expect(evaluateCustomer(customers[1], query)).toBe(false);
    expect(evaluateCustomer(customers[2], query)).toBe(true);
  });

  it('not_in operator excludes value from array', () => {
    const query: SegmentQuery = { conditions: [{ field: 'plan', operator: 'not_in', value: ['free'] }] };
    expect(evaluateCustomer(customers[0], query)).toBe(true);
    expect(evaluateCustomer(customers[1], query)).toBe(false);
  });

  it('exists operator checks for non-null', () => {
    const query: SegmentQuery = { conditions: [{ field: 'email', operator: 'exists' }] };
    expect(evaluateCustomer(customers[0], query)).toBe(true);
    expect(evaluateCustomer(customers[4], query)).toBe(false);
  });

  it('not_exists operator checks for null/undefined', () => {
    const query: SegmentQuery = { conditions: [{ field: 'email', operator: 'not_exists' }] };
    expect(evaluateCustomer(customers[0], query)).toBe(false);
    expect(evaluateCustomer(customers[4], query)).toBe(true);
  });

  it('customAttributes.* field path works', () => {
    const query: SegmentQuery = { conditions: [{ field: 'customAttributes.industry', operator: 'eq', value: 'tech' }] };
    expect(evaluateCustomer(customers[0], query)).toBe(true);
    expect(evaluateCustomer(customers[2], query)).toBe(false);
  });

  it('AND combinator requires all conditions', () => {
    const query: SegmentQuery = {
      combinator: 'and',
      conditions: [
        { field: 'plan', operator: 'eq', value: 'pro' },
        { field: 'ticketCount', operator: 'gt', value: 3 },
      ],
    };
    expect(evaluateCustomer(customers[0], query)).toBe(true);  // pro + 5 tickets
    expect(evaluateCustomer(customers[3], query)).toBe(false);  // pro + 0 tickets
  });

  it('OR combinator requires any condition', () => {
    const query: SegmentQuery = {
      combinator: 'or',
      conditions: [
        { field: 'plan', operator: 'eq', value: 'enterprise' },
        { field: 'tags', operator: 'contains', value: 'trial' },
      ],
    };
    expect(evaluateCustomer(customers[2], query)).toBe(true);   // enterprise
    expect(evaluateCustomer(customers[1], query)).toBe(true);   // has trial tag
    expect(evaluateCustomer(customers[3], query)).toBe(false);  // neither
  });

  it('nested groups work', () => {
    const query: SegmentQuery = {
      combinator: 'and',
      groups: [
        {
          combinator: 'or',
          conditions: [
            { field: 'plan', operator: 'eq', value: 'pro' },
            { field: 'plan', operator: 'eq', value: 'enterprise' },
          ],
        },
        {
          conditions: [{ field: 'tags', operator: 'contains', value: 'vip' }],
        },
      ],
    };
    expect(evaluateCustomer(customers[0], query)).toBe(true);   // pro + vip
    expect(evaluateCustomer(customers[2], query)).toBe(true);   // enterprise + vip
    expect(evaluateCustomer(customers[3], query)).toBe(false);  // pro but no vip
  });

  it('empty query matches all', () => {
    expect(evaluateCustomer(customers[0], {})).toBe(true);
    expect(evaluateCustomer(customers[0], { conditions: [] })).toBe(true);
  });
});

describe('evaluateSegment', () => {
  it('returns all customers for empty query', () => {
    expect(evaluateSegment(customers, {})).toHaveLength(5);
  });

  it('filters customers by single condition', () => {
    const query: SegmentQuery = { conditions: [{ field: 'plan', operator: 'eq', value: 'pro' }] };
    const result = evaluateSegment(customers, query);
    expect(result).toHaveLength(2);
    expect(result.map(c => c.name)).toEqual(['Alice', 'Dave']);
  });

  it('filters with complex AND+OR query', () => {
    const query: SegmentQuery = {
      combinator: 'and',
      conditions: [{ field: 'ticketCount', operator: 'gt', value: 0 }],
      groups: [{
        combinator: 'or',
        conditions: [
          { field: 'plan', operator: 'eq', value: 'pro' },
          { field: 'plan', operator: 'eq', value: 'enterprise' },
        ],
      }],
    };
    const result = evaluateSegment(customers, query);
    expect(result).toHaveLength(2); // Alice (pro, 5) and Carol (enterprise, 20)
  });
});

describe('evaluateSegmentWithStats', () => {
  it('returns count, total, and sample', () => {
    const query: SegmentQuery = { conditions: [{ field: 'plan', operator: 'eq', value: 'free' }] };
    const result = evaluateSegmentWithStats(customers, query, 1);
    expect(result.count).toBe(2);
    expect(result.total).toBe(5);
    expect(result.sample).toHaveLength(1);
  });
});
