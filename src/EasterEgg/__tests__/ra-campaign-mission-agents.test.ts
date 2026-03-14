import { describe, expect, it } from 'vitest';

import { runCampaignMissionAgents } from '../oracle/raMainCampaignMissionAgents';

describe('Campaign mission audit agents', () => {
  it('cover the full original RA main campaign without unresolved script parity errors', () => {
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
      'SCG03EB',
      'SCG05EB',
      'SCG06EB',
      'SCG08EB',
      'SCG09EB',
      'SCG10EB',
      'SCG11EA',
      'SCG11EB',
      'SCG12EA',
      'SCG13EA',
      'SCG14EA',
      'SCU02EB',
      'SCU04EB',
      'SCU06EA',
      'SCU06EB',
      'SCU07EA',
      'SCU08EA',
      'SCU08EB',
      'SCU09EA',
      'SCU10EA',
      'SCU11EA',
      'SCU11EB',
      'SCU12EA',
      'SCU13EA',
      'SCU13EB',
      'SCU14EA',
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
