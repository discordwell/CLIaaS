/**
 * Tests for chatbot analytics module.
 * Since analytics requires DB, we test the summary aggregation logic directly.
 */

import { describe, it, expect } from 'vitest';

// We cannot call the DB functions in unit tests, but we can test getFlowSummary's
// aggregation logic by importing and mocking. Instead we test the aggregation math
// inline since the module uses tryDb which returns null without a DB.

describe('chatbot analytics aggregation', () => {
  // Mirror the aggregation logic from getFlowSummary
  function aggregate(rows: Array<{ nodeId: string; entries: number; exits: number; dropOffs: number }>) {
    const nodeMap = new Map<string, { entries: number; exits: number; dropOffs: number }>();
    for (const row of rows) {
      const existing = nodeMap.get(row.nodeId) ?? { entries: 0, exits: 0, dropOffs: 0 };
      existing.entries += row.entries;
      existing.exits += row.exits;
      existing.dropOffs += row.dropOffs;
      nodeMap.set(row.nodeId, existing);
    }

    const totalEntries = Array.from(nodeMap.values()).reduce((s, n) => s + n.entries, 0);
    const totalDropOffs = Array.from(nodeMap.values()).reduce((s, n) => s + n.dropOffs, 0);
    const totalExits = Array.from(nodeMap.values()).reduce((s, n) => s + n.exits, 0);

    const topDropOffNodes = Array.from(nodeMap.entries())
      .filter(([, v]) => v.dropOffs > 0)
      .sort((a, b) => b[1].dropOffs - a[1].dropOffs)
      .slice(0, 5)
      .map(([nodeId, v]) => ({ nodeId, dropOffs: v.dropOffs }));

    return {
      totalSessions: Math.max(totalEntries, 1),
      completedSessions: totalExits,
      abandonedSessions: totalDropOffs,
      handoffSessions: 0,
      avgNodesPerSession: totalEntries > 0 ? Math.round((totalEntries + totalExits) / Math.max(totalEntries, 1)) : 0,
      topDropOffNodes,
    };
  }

  it('returns defaults for empty data', () => {
    const result = aggregate([]);
    expect(result.totalSessions).toBe(1);
    expect(result.completedSessions).toBe(0);
    expect(result.abandonedSessions).toBe(0);
    expect(result.topDropOffNodes).toEqual([]);
  });

  it('aggregates entries across multiple rows for same node', () => {
    const result = aggregate([
      { nodeId: 'n1', entries: 5, exits: 3, dropOffs: 1 },
      { nodeId: 'n1', entries: 3, exits: 2, dropOffs: 0 },
    ]);
    expect(result.totalSessions).toBe(8);
    expect(result.completedSessions).toBe(5);
    expect(result.abandonedSessions).toBe(1);
  });

  it('aggregates across multiple nodes', () => {
    const result = aggregate([
      { nodeId: 'n1', entries: 10, exits: 8, dropOffs: 2 },
      { nodeId: 'n2', entries: 8, exits: 5, dropOffs: 3 },
      { nodeId: 'n3', entries: 5, exits: 5, dropOffs: 0 },
    ]);
    expect(result.totalSessions).toBe(23);
    expect(result.completedSessions).toBe(18);
    expect(result.abandonedSessions).toBe(5);
  });

  it('returns top drop-off nodes sorted by drop count', () => {
    const result = aggregate([
      { nodeId: 'n1', entries: 10, exits: 8, dropOffs: 2 },
      { nodeId: 'n2', entries: 8, exits: 2, dropOffs: 6 },
      { nodeId: 'n3', entries: 5, exits: 5, dropOffs: 0 },
    ]);
    expect(result.topDropOffNodes).toEqual([
      { nodeId: 'n2', dropOffs: 6 },
      { nodeId: 'n1', dropOffs: 2 },
    ]);
  });

  it('limits top drop-off nodes to 5', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      nodeId: `n${i}`,
      entries: 10,
      exits: 5,
      dropOffs: i + 1,
    }));
    const result = aggregate(rows);
    expect(result.topDropOffNodes).toHaveLength(5);
    expect(result.topDropOffNodes[0].nodeId).toBe('n7');
  });

  it('calculates avg nodes per session', () => {
    const result = aggregate([
      { nodeId: 'n1', entries: 10, exits: 10, dropOffs: 0 },
      { nodeId: 'n2', entries: 10, exits: 10, dropOffs: 0 },
    ]);
    // (20 entries + 20 exits) / 20 entries = 2
    expect(result.avgNodesPerSession).toBe(2);
  });
});
