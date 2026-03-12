import { describe, expect, it } from 'vitest';

import { runAlliedMissionAgents } from '../oracle/raAlliedMissionAgents';

describe('Early Allied mission audit agents', () => {
  it('cover SCG01EA through SCG05EA without unresolved script parity errors', () => {
    const reports = runAlliedMissionAgents();

    expect(reports.map((report) => report.scenarioId)).toEqual([
      'SCG01EA',
      'SCG02EA',
      'SCG03EA',
      'SCG04EA',
      'SCG05EA',
    ]);

    for (const report of reports) {
      const errors = report.issues.filter((issue) => issue.severity === 'error');
      expect(errors, `${report.scenarioId} issues:\n${errors.map((issue) => issue.message).join('\n')}`).toEqual([]);
      expect(report.facts.length).toBeGreaterThan(0);
      expect(report.runtime.unsupportedTeamMissionIds).toEqual([]);
      expect(report.runtime.unsupportedEventIds).toEqual([]);
      expect(report.runtime.unsupportedActionIds).toEqual([]);
    }
  });
});
