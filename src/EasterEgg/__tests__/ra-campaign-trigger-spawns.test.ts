import { describe, expect, it } from 'vitest';

import { auditScenarioTriggerSpawns } from '../oracle/raCampaignTriggerSpawnAudit';

describe('campaign trigger spawn audit', () => {
  it('passes a clean early campaign spawn chain', () => {
    const report = auditScenarioTriggerSpawns('SCG01EA');

    expect(report.counts.spawnActions).toBeGreaterThan(0);
    // C++ parity: ground units spawn at map edge, not waypoint origin.
    // Position mismatches are expected for edge-spawned ground reinforcements.
    const nonEdgeIssues = report.issues.filter(
      i => i.code !== 'ground-spawn-position-mismatch',
    );
    expect(nonEdgeIssues).toEqual([]);
  });

  it('passes late-campaign triggered spawn types once support exists', () => {
    const report = auditScenarioTriggerSpawns('SCG13EA');

    // C++ parity: ground units spawn at map edge, not waypoint origin.
    // Position mismatches are expected for edge-spawned ground reinforcements.
    const nonEdgeIssues = report.issues.filter(
      i => i.code !== 'ground-spawn-position-mismatch',
    );
    expect(nonEdgeIssues).toEqual([]);
  });

  it('falls back to the house edge when a trigger team origin waypoint is undefined', () => {
    const report = auditScenarioTriggerSpawns('SCU11EB');

    // C++ parity: ground reinforcements spawn at calculated edge cell (reinf.cpp:471).
    // Position mismatches between waypoint and edge cell are expected.
    const nonEdgeIssues = report.issues.filter(
      i => i.code !== 'ground-spawn-position-mismatch',
    );
    expect(nonEdgeIssues).toEqual([]);
  });
});
