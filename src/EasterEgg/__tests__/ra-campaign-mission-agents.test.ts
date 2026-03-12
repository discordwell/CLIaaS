import { describe, expect, it } from 'vitest';

import { runCampaignMissionAgents } from '../oracle/raAlliedMissionAgents';

describe('Campaign mission audit agents', () => {
  it('cover Soviet 1-5 and Allied 1-10 without unresolved script parity errors', () => {
    const reports = runCampaignMissionAgents();

    expect(reports.map((report) => report.scenarioId)).toEqual([
      'SCG01EA',
      'SCG02EA',
      'SCG03EA',
      'SCG04EA',
      'SCG05EA',
      'SCU01EA',
      'SCU02EA',
      'SCU03EA',
      'SCU04EA',
      'SCU05EA',
      'SCG06EA',
      'SCG07EA',
      'SCG08EA',
      'SCG09EA',
      'SCG10EA',
    ]);

    for (const report of reports) {
      const errors = report.issues.filter((issue) => issue.severity === 'error');
      expect(
        errors,
        `${report.scenarioId} issues:\n${errors.map((issue) => issue.message).join('\n')}`,
      ).toEqual([]);
      expect(report.facts.length).toBeGreaterThan(0);
      expect(report.runtime.unsupportedTeamMissionIds).toEqual([]);
      expect(report.runtime.unsupportedEventIds).toEqual([]);
      expect(report.runtime.unsupportedActionIds).toEqual([]);
    }
  });
});
