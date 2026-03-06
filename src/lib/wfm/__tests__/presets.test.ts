import { describe, it, expect } from 'vitest';
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
});
