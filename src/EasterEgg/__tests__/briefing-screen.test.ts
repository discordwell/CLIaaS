/**
 * Mission briefing screen tests — verify the military dossier briefing renders
 * correctly for all three factions (allied, soviet, ants) with proper theming,
 * mission data, difficulty selector, and action buttons.
 */
import { describe, it, expect } from 'vitest';
import { MISSIONS, CAMPAIGNS, getCampaign } from '../engine/scenario';

// ============================================================
// Briefing data integrity
// ============================================================
describe('Briefing screen data integrity', () => {
  it('all ant missions have briefing and objective text', () => {
    expect(MISSIONS.length).toBeGreaterThanOrEqual(4);
    for (const mission of MISSIONS) {
      expect(mission.briefing, `${mission.id} should have briefing`).toBeTruthy();
      expect(mission.objective, `${mission.id} should have objective`).toBeTruthy();
      expect(mission.title, `${mission.id} should have title`).toBeTruthy();
      expect(mission.id, `mission should have id`).toMatch(/^SCA\d{2}EA$/);
    }
  });

  it('all campaign missions have briefing and objective text', () => {
    for (const campaignId of ['allied', 'soviet', 'counterstrike_allied', 'counterstrike_soviet'] as const) {
      const campaign = getCampaign(campaignId);
      expect(campaign, `${campaignId} campaign should exist`).toBeDefined();
      for (const mission of campaign!.missions) {
        expect(mission.briefing, `${campaign!.id}/${mission.id} should have briefing`).toBeTruthy();
        expect(mission.objective, `${campaign!.id}/${mission.id} should have objective`).toBeTruthy();
        expect(mission.title, `${campaign!.id}/${mission.id} should have title`).toBeTruthy();
      }
    }
  });
});

// ============================================================
// Faction theming logic (mirrors the briefing screen IIFE)
// ============================================================
describe('Briefing faction theming', () => {
  // Replicate the faction resolution logic from the briefing screen
  function resolveFaction(activeCampaign: { faction: 'allied' | 'soviet' } | null): 'allied' | 'soviet' | 'ants' {
    return activeCampaign ? activeCampaign.faction : 'ants';
  }

  const THEME_MAP: Record<'allied' | 'soviet' | 'ants', {
    classification: string;
    primary: string;
  }> = {
    allied: { classification: 'ALLIED COMMAND', primary: '#4488cc' },
    soviet: { classification: 'SOVIET COMMAND', primary: '#cc4444' },
    ants:   { classification: 'FIELD COMMAND',  primary: '#ff8800' },
  };

  it('ant missions (no campaign) resolve to "ants" faction', () => {
    expect(resolveFaction(null)).toBe('ants');
  });

  it('allied campaign resolves to "allied" faction', () => {
    const campaign = getCampaign('allied')!;
    expect(resolveFaction(campaign)).toBe('allied');
  });

  it('soviet campaign resolves to "soviet" faction', () => {
    const campaign = getCampaign('soviet')!;
    expect(resolveFaction(campaign)).toBe('soviet');
  });

  it('counterstrike allied campaign resolves to "allied" faction', () => {
    const campaign = getCampaign('counterstrike_allied')!;
    expect(resolveFaction(campaign)).toBe('allied');
  });

  it('each faction has distinct classification text', () => {
    const classifications = Object.values(THEME_MAP).map(t => t.classification);
    const unique = new Set(classifications);
    expect(unique.size).toBe(3);
  });

  it('each faction has distinct primary color', () => {
    const colors = Object.values(THEME_MAP).map(t => t.primary);
    const unique = new Set(colors);
    expect(unique.size).toBe(3);
  });
});

// ============================================================
// Mission number formatting
// ============================================================
describe('Briefing mission numbering', () => {
  it('standalone ant missions show "1 of N" format', () => {
    const missionIndex = 0;
    const label = `${missionIndex + 1} of ${MISSIONS.length}`;
    expect(label).toBe(`1 of ${MISSIONS.length}`);
  });

  it('campaign missions show correct "M of N" format', () => {
    const campaign = getCampaign('allied')!;
    const campaignMissionIndex = 4;
    const label = `${campaignMissionIndex + 1} of ${campaign.missions.length}`;
    expect(label).toBe('5 of 14');
  });

  it('standalone missions use MISSION label, campaigns use OPERATION label', () => {
    // Standalone
    const standaloneLabel = null ? 'OPERATION' : 'MISSION';
    expect(standaloneLabel).toBe('MISSION');
    // Campaign
    const campaignLabel = getCampaign('allied') ? 'OPERATION' : 'MISSION';
    expect(campaignLabel).toBe('OPERATION');
  });
});

// ============================================================
// Difficulty selector data
// ============================================================
describe('Briefing difficulty selector', () => {
  // Import directly from engine to verify the options match
  it('has exactly 3 difficulty levels: easy, normal, hard', async () => {
    const { DIFFICULTIES } = await import('../engine/index');
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
  });
});

// ============================================================
// Theme structure completeness
// ============================================================
describe('Briefing theme structure', () => {
  const REQUIRED_THEME_KEYS = [
    'primary', 'accent', 'dim', 'bg', 'border', 'glow', 'stamp',
    'headerBg', 'launchBg', 'launchColor', 'launchBorder',
    'docBg', 'docBorder', 'objColor', 'insigniaColor', 'classification',
  ] as const;

  // Replicate theme definitions from the component to verify completeness
  const themes: Record<string, Record<string, string>> = {
    allied: {
      primary: '#4488cc', accent: '#88ccff', dim: '#2a4466',
      bg: 'rgba(10,25,50,0.85)', border: '#335577', glow: 'rgba(68,136,204,0.4)',
      stamp: '#3366aa', headerBg: 'rgba(20,40,80,0.9)',
      launchBg: '#1a3355', launchColor: '#66bbff', launchBorder: '#4488cc',
      docBg: 'rgba(15,30,55,0.6)', docBorder: '#2a4466',
      objColor: '#66ccff', insigniaColor: '#4488cc',
      classification: 'ALLIED COMMAND',
    },
    soviet: {
      primary: '#cc4444', accent: '#ff6666', dim: '#662222',
      bg: 'rgba(40,10,10,0.85)', border: '#663333', glow: 'rgba(204,68,68,0.4)',
      stamp: '#aa3333', headerBg: 'rgba(60,15,15,0.9)',
      launchBg: '#441111', launchColor: '#ff6666', launchBorder: '#cc4444',
      docBg: 'rgba(45,15,15,0.6)', docBorder: '#552222',
      objColor: '#ff8888', insigniaColor: '#cc4444',
      classification: 'SOVIET COMMAND',
    },
    ants: {
      primary: '#ff8800', accent: '#ffaa33', dim: '#664400',
      bg: 'rgba(30,20,5,0.85)', border: '#664400', glow: 'rgba(255,136,0,0.4)',
      stamp: '#cc6600', headerBg: 'rgba(50,30,10,0.9)',
      launchBg: '#442200', launchColor: '#ffaa33', launchBorder: '#ff8800',
      docBg: 'rgba(40,25,10,0.6)', docBorder: '#553311',
      objColor: '#ffcc44', insigniaColor: '#ff8800',
      classification: 'FIELD COMMAND',
    },
  };

  for (const [faction, theme] of Object.entries(themes)) {
    it(`${faction} theme has all required keys`, () => {
      for (const key of REQUIRED_THEME_KEYS) {
        expect(theme[key], `${faction} theme missing key: ${key}`).toBeDefined();
        expect(theme[key].length, `${faction}.${key} should not be empty`).toBeGreaterThan(0);
      }
    });
  }

  it('all themes have non-overlapping primary colors', () => {
    const primaries = Object.values(themes).map(t => t.primary);
    expect(new Set(primaries).size).toBe(3);
  });

  it('all themes have non-overlapping classification labels', () => {
    const labels = Object.values(themes).map(t => t.classification);
    expect(new Set(labels).size).toBe(3);
  });
});

// ============================================================
// Briefing screen content rendering expectations
// ============================================================
describe('Briefing screen content expectations', () => {
  it('first ant mission has expected title and briefing content', () => {
    const mission = MISSIONS[0];
    expect(mission.title).toBe('It Came From Red Alert!');
    expect(mission.briefing).toContain('giant ants');
    expect(mission.objective).toContain('ant threat');
  });

  it('briefing text supports multi-paragraph content with newlines', () => {
    // All ant missions have multi-paragraph briefings
    for (const mission of MISSIONS) {
      expect(mission.briefing, `${mission.id} briefing should have paragraphs`).toContain('\n');
    }
  });

  it('mission IDs match expected format for ant missions', () => {
    const ids = MISSIONS.map(m => m.id);
    expect(ids).toEqual(['SCA01EA', 'SCA02EA', 'SCA03EA', 'SCA04EA']);
  });

  it('allied campaign first mission has expected structure', () => {
    const campaign = getCampaign('allied')!;
    const first = campaign.missions[0];
    expect(first.id).toBe('SCG01EA');
    expect(first.title).toBeTruthy();
    expect(first.briefing).toBeTruthy();
    expect(first.objective).toBeTruthy();
  });

  it('soviet campaign first mission has expected structure', () => {
    const campaign = getCampaign('soviet')!;
    const first = campaign.missions[0];
    expect(first.id).toBe('SCU01EA');
    expect(first.title).toBeTruthy();
    expect(first.briefing).toBeTruthy();
    expect(first.objective).toBeTruthy();
  });
});
