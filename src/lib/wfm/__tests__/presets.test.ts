import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { listPresets, generatePresetEntries, getPresetById } from '../presets';

describe('Holiday Presets', () => {
  it('lists available presets', () => {
    const presets = listPresets();
    expect(presets.length).toBe(4);
    expect(presets.map(p => p.id)).toContain('us-federal');
    expect(presets.map(p => p.id)).toContain('uk-bank');
    expect(presets.map(p => p.id)).toContain('ca-statutory');
    expect(presets.map(p => p.id)).toContain('au-public');
  });

  it('generates US Federal entries for 2026', () => {
    const entries = generatePresetEntries('us-federal', 2026);
    expect(entries.length).toBe(11);
    const names = entries.map(e => e.name);
    expect(names).toContain("New Year's Day");
    expect(names).toContain('Thanksgiving');
    expect(names).toContain('Christmas Day');
    // MLK Day 2026: 3rd Monday of January = Jan 19
    const mlk = entries.find(e => e.name === 'MLK Jr. Day');
    expect(mlk?.date).toBe('2026-01-19');
  });

  it('generates UK Bank entries for 2026', () => {
    const entries = generatePresetEntries('uk-bank', 2026);
    expect(entries.length).toBe(8);
    const names = entries.map(e => e.name);
    expect(names).toContain('Good Friday');
    expect(names).toContain('Boxing Day');
  });

  it('handles unknown preset gracefully', () => {
    const entries = generatePresetEntries('nonexistent', 2026);
    expect(entries).toEqual([]);
  });

  it('getPresetById returns correct preset', () => {
    const preset = getPresetById('ca-statutory');
    expect(preset).toBeDefined();
    expect(preset!.country).toBe('CA');
  });

  it('floating holidays compute correctly for 2026', () => {
    const entries = generatePresetEntries('us-federal', 2026);
    // Labor Day 2026: 1st Monday of September = Sep 7
    const labor = entries.find(e => e.name === 'Labor Day');
    expect(labor?.date).toBe('2026-09-07');
    // Memorial Day 2026: Last Monday of May = May 25
    const memorial = entries.find(e => e.name === 'Memorial Day');
    expect(memorial?.date).toBe('2026-05-25');
  });

  // Regression: holiday dates must be computed in UTC, not local time. Building
  // dates with `new Date(y, m, d)` (local) while formatting with `toISOString()`
  // (UTC) drifts every floating/Easter holiday one day earlier under any
  // positive-offset timezone (e.g. a server running TZ=Australia/Sydney), which
  // then corrupts SLA/business-hours math around that day.
  describe('timezone independence (positive UTC offset)', () => {
    const originalTz = process.env.TZ;
    beforeAll(() => { process.env.TZ = 'Australia/Sydney'; });
    afterAll(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    const dateOf = (presetId: string, name: string) =>
      generatePresetEntries(presetId, 2026).find(e => e.name === name)?.date;

    it('US floating holidays are correct under TZ=Australia/Sydney', () => {
      expect(dateOf('us-federal', 'MLK Jr. Day')).toBe('2026-01-19');     // 3rd Mon Jan
      expect(dateOf('us-federal', "Presidents' Day")).toBe('2026-02-16'); // 3rd Mon Feb
      expect(dateOf('us-federal', 'Memorial Day')).toBe('2026-05-25');    // last Mon May
      expect(dateOf('us-federal', 'Columbus Day')).toBe('2026-10-12');    // 2nd Mon Oct
      expect(dateOf('us-federal', 'Thanksgiving')).toBe('2026-11-26');    // 4th Thu Nov
    });

    it('Easter-derived holidays are correct under TZ=Australia/Sydney', () => {
      // Easter Sunday 2026 = Apr 5, so Good Friday = Apr 3, Easter Monday = Apr 6.
      expect(dateOf('uk-bank', 'Good Friday')).toBe('2026-04-03');
      expect(dateOf('uk-bank', 'Easter Monday')).toBe('2026-04-06');
      expect(dateOf('au-public', 'Good Friday')).toBe('2026-04-03');
      expect(dateOf('au-public', 'Easter Saturday')).toBe('2026-04-04');
      expect(dateOf('au-public', 'Easter Monday')).toBe('2026-04-06');
      expect(dateOf('ca-statutory', 'Good Friday')).toBe('2026-04-03');
    });

    it('Victoria Day (Monday before May 25) is correct under TZ=Australia/Sydney', () => {
      // May 25, 2026 is itself a Monday, so Victoria Day is the prior Monday, May 18.
      expect(dateOf('ca-statutory', 'Victoria Day')).toBe('2026-05-18');
    });
  });
});
