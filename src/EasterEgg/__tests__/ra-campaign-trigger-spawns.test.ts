import { describe, expect, it } from 'vitest';

import { auditScenarioTriggerSpawns } from '../oracle/raCampaignTriggerSpawnAudit';

describe('campaign trigger spawn audit', () => {
  it('passes a clean early campaign spawn chain', () => {
    const report = auditScenarioTriggerSpawns('SCG01EA');

    expect(report.counts.spawnActions).toBeGreaterThan(0);
    expect(report.issues).toEqual([]);
  });

  it('passes late-campaign triggered spawn types once support exists', () => {
    const report = auditScenarioTriggerSpawns('SCG13EA');

    expect(report.issues).toEqual([]);
  });

  it('falls back to the house edge when a trigger team origin waypoint is undefined', () => {
    const report = auditScenarioTriggerSpawns('SCU11EB');

    expect(report.issues).toEqual([]);
  });
});
