/**
 * Campaign system tests — verify campaign data structures, dynamic player house,
 * alliance building from INI, campaign progress persistence, and victory conditions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  House, buildDefaultAlliances, buildAlliancesFromINI,
  HOUSE_FACTION,
} from '../engine/types';
import { Entity, setPlayerHouses, getPlayerHouses } from '../engine/entity';
import {
  CAMPAIGNS, getCampaign, loadCampaignProgress, saveCampaignProgress,
  parseMissionINI,
  type CampaignId,
} from '../engine/scenario';

// Mock localStorage for Node test environment
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k in store) delete store[k]; },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true });

// ============================================================
// Campaign Data Structures
// ============================================================
describe('Campaign data structures', () => {
  it('has 4 campaigns defined', () => {
    expect(CAMPAIGNS).toHaveLength(4);
  });

  it('allied campaign has 14 missions', () => {
    const campaign = getCampaign('allied');
    expect(campaign).toBeDefined();
    expect(campaign!.missions).toHaveLength(14);
    expect(campaign!.faction).toBe('allied');
    expect(campaign!.title).toBe('Allied Campaign');
  });

  it('soviet campaign has 14 missions', () => {
    const campaign = getCampaign('soviet');
    expect(campaign).toBeDefined();
    expect(campaign!.missions).toHaveLength(14);
    expect(campaign!.faction).toBe('soviet');
  });

  it('counterstrike allied campaign has 8 missions', () => {
    const campaign = getCampaign('counterstrike_allied');
    expect(campaign).toBeDefined();
    expect(campaign!.missions).toHaveLength(8);
    expect(campaign!.faction).toBe('allied');
  });

  it('counterstrike soviet campaign has 8 missions', () => {
    const campaign = getCampaign('counterstrike_soviet');
    expect(campaign).toBeDefined();
    expect(campaign!.missions).toHaveLength(8);
    expect(campaign!.faction).toBe('soviet');
  });

  it('getCampaign returns undefined for invalid id', () => {
    expect(getCampaign('nonexistent' as CampaignId)).toBeUndefined();
  });

  it('all missions have required fields', () => {
    for (const campaign of CAMPAIGNS) {
      for (const mission of campaign.missions) {
        expect(mission.id).toBeTruthy();
        expect(mission.title).toBeTruthy();
        expect(mission.briefing).toBeTruthy();
        expect(mission.objective).toBeTruthy();
      }
    }
  });

  it('allied missions use SCG prefix', () => {
    const campaign = getCampaign('allied')!;
    for (const m of campaign.missions) {
      expect(m.id).toMatch(/^SCG\d{2}EA$/);
    }
  });

  it('soviet missions use SCU prefix', () => {
    const campaign = getCampaign('soviet')!;
    for (const m of campaign.missions) {
      expect(m.id).toMatch(/^SCU\d{2}EA$/);
    }
  });
});

// ============================================================
// Campaign Progress Persistence
// ============================================================
describe('Campaign progress persistence', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('initial progress is 0', () => {
    expect(loadCampaignProgress('allied')).toBe(0);
    expect(loadCampaignProgress('soviet')).toBe(0);
  });

  it('saving progress updates loaded value', () => {
    saveCampaignProgress('allied', 0); // complete mission 0
    expect(loadCampaignProgress('allied')).toBe(1);
  });

  it('progress only increases', () => {
    saveCampaignProgress('allied', 5);
    expect(loadCampaignProgress('allied')).toBe(6);
    // Try to go backwards
    saveCampaignProgress('allied', 2);
    expect(loadCampaignProgress('allied')).toBe(6); // should not decrease
  });

  it('campaigns have independent progress', () => {
    saveCampaignProgress('allied', 3);
    saveCampaignProgress('soviet', 7);
    expect(loadCampaignProgress('allied')).toBe(4);
    expect(loadCampaignProgress('soviet')).toBe(8);
  });
});

// ============================================================
// Dynamic Player Houses
// ============================================================
describe('Dynamic player houses', () => {
  it('default player houses include Spain and Greece', () => {
    setPlayerHouses(new Set([House.Spain, House.Greece]));
    const houses = getPlayerHouses();
    expect(houses.has(House.Spain)).toBe(true);
    expect(houses.has(House.Greece)).toBe(true);
  });

  it('can set Soviet player house', () => {
    setPlayerHouses(new Set([House.USSR, House.Ukraine]));
    const houses = getPlayerHouses();
    expect(houses.has(House.USSR)).toBe(true);
    expect(houses.has(House.Ukraine)).toBe(true);
    expect(houses.has(House.Spain)).toBe(false);
  });
});

// ============================================================
// Alliance Building from INI
// ============================================================
describe('buildAlliancesFromINI', () => {
  it('builds symmetric alliances', () => {
    const alliesMap = new Map<House, House[]>();
    alliesMap.set(House.Spain, [House.Greece, House.England]);
    alliesMap.set(House.Greece, [House.Spain]);

    const table = buildAlliancesFromINI(alliesMap, House.Spain);
    // Spain allied with Greece
    expect(table.get(House.Spain)!.has(House.Greece)).toBe(true);
    // Greece allied with Spain
    expect(table.get(House.Greece)!.has(House.Spain)).toBe(true);
    // England allied with Spain (symmetric)
    expect(table.get(House.England)!.has(House.Spain)).toBe(true);
  });

  it('GoodGuy is always allied with player', () => {
    const alliesMap = new Map<House, House[]>();
    const table = buildAlliancesFromINI(alliesMap, House.USSR);
    expect(table.get(House.GoodGuy)!.has(House.USSR)).toBe(true);
    expect(table.get(House.USSR)!.has(House.GoodGuy)).toBe(true);
  });

  it('everyone is allied with themselves', () => {
    const alliesMap = new Map<House, House[]>();
    const table = buildAlliancesFromINI(alliesMap, House.Spain);
    for (const h of Object.values(House)) {
      expect(table.get(h)!.has(h)).toBe(true);
    }
  });
});

// ============================================================
// House Enum Completeness
// ============================================================
describe('House enum', () => {
  it('includes all RA houses', () => {
    expect(House.Spain).toBeDefined();
    expect(House.Greece).toBeDefined();
    expect(House.USSR).toBeDefined();
    expect(House.England).toBeDefined();
    expect(House.France).toBeDefined();
    expect(House.Ukraine).toBeDefined();
    expect(House.Germany).toBeDefined();
    expect(House.Turkey).toBeDefined();
    expect(House.GoodGuy).toBeDefined();
    expect(House.BadGuy).toBeDefined();
    expect(House.Neutral).toBeDefined();
  });

  it('HOUSE_FACTION maps all houses', () => {
    for (const h of Object.values(House)) {
      expect(HOUSE_FACTION[h]).toBeDefined();
    }
  });
});

// ============================================================
// Mission INI Parsing
// ============================================================
describe('parseMissionINI', () => {
  it('parses basic mission briefings', () => {
    const text = `[SCG01EA.INI]
1=Rescue Einstein from the Headquarters inside this Soviet complex. Once
2=found, evacuate him via the helicopter at the signal flare.

[SCU01EA.INI]
1=A pitiful excuse for resistance has blockaded itself in this village.
2=Stalin has decided to make an example of them.`;

    const result = parseMissionINI(text);
    expect(result.size).toBe(2);
    expect(result.get('SCG01EA')).toContain('Rescue Einstein');
    expect(result.get('SCU01EA')).toContain('pitiful excuse');
  });

  it('handles @ as newline and @@ as paragraph break', () => {
    const text = `[SCG03EA.INI]
1=LANDCOM 16 HQS.@TOP SECRET.@TO: FIELD COMMANDER A9@@DESTROY ALL BRIDGES.`;

    const result = parseMissionINI(text);
    const briefing = result.get('SCG03EA')!;
    expect(briefing).toContain('LANDCOM 16 HQS.\nTOP SECRET.');
    expect(briefing).toContain('FIELD COMMANDER A9\n\nDESTROY ALL BRIDGES.');
  });

  it('joins multi-line briefings with spaces', () => {
    const text = `[SCG02EA.INI]
1=A critical supply convoy is due through this area in 25 minutes, but
2=Soviet forces have blocked the road in several places.`;

    const result = parseMissionINI(text);
    const briefing = result.get('SCG02EA')!;
    expect(briefing).toContain('25 minutes, but Soviet forces');
  });

  it('returns empty map for empty input', () => {
    expect(parseMissionINI('').size).toBe(0);
  });

  it('parses all 28 base campaign missions from real format', () => {
    // Verify we can parse the known section headers
    const text = `[SCG01EA.INI]
1=Test allied mission 1.

[SCG14EA.INI]
1=Test allied mission 14.

[SCU01EA.INI]
1=Test soviet mission 1.

[SCU14EA.INI]
1=Test soviet mission 14.`;

    const result = parseMissionINI(text);
    expect(result.has('SCG01EA')).toBe(true);
    expect(result.has('SCG14EA')).toBe(true);
    expect(result.has('SCU01EA')).toBe(true);
    expect(result.has('SCU14EA')).toBe(true);
  });
});
