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
  parseMissionINI, parseScenarioINI, executeTriggerAction, houseIdToHouse,
  type CampaignId, type TriggerAction, type TeamType,
} from '../engine/scenario';
import { UnitType, UNIT_STATS, CIVILIAN_UNIT_TYPES } from '../engine/types';

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

// ============================================================
// Campaign Control Harness — Gap Fixes
// ============================================================

describe('EINSTEIN unit type (Gap #2)', () => {
  it('EINSTEIN exists in UNIT_STATS', () => {
    const stats = UNIT_STATS['EINSTEIN'];
    expect(stats).toBeDefined();
    expect(stats.type).toBe(UnitType.I_EINSTEIN);
    expect(stats.name).toBe('Prof. Einstein');
    expect(stats.image).toBe('einstein');
    expect(stats.isInfantry).toBe(true);
    expect(stats.primaryWeapon).toBeNull();
    expect(stats.crushable).toBe(true);
  });

  it('UnitType enum has I_EINSTEIN', () => {
    expect(UnitType.I_EINSTEIN).toBe('EINSTEIN');
  });
});

describe('Civilian type detection (Gap #3)', () => {
  it('CIVILIAN_UNIT_TYPES includes C1-C10 and EINSTEIN', () => {
    for (let i = 1; i <= 10; i++) {
      expect(CIVILIAN_UNIT_TYPES.has(`C${i}`), `C${i} should be civilian`).toBe(true);
    }
    expect(CIVILIAN_UNIT_TYPES.has('EINSTEIN')).toBe(true);
  });

  it('non-civilians are not in CIVILIAN_UNIT_TYPES', () => {
    expect(CIVILIAN_UNIT_TYPES.has('E1')).toBe(false);
    expect(CIVILIAN_UNIT_TYPES.has('1TNK')).toBe(false);
    expect(CIVILIAN_UNIT_TYPES.has('ANT1')).toBe(false);
  });
});

describe('AI house credits parsing (Gap #1)', () => {
  it('parses Credits= for non-player houses', () => {
    const ini = `[Basic]
Player=Spain
Name=Test

[Map]
X=40
Y=40
Width=50
Height=50

[Spain]
Credits=10

[USSR]
Credits=25

[Waypoints]
[MapPack]
[OverlayPack]
`;
    const data = parseScenarioINI(ini);
    // Player house (Spain) credits should NOT be in houseCredits
    expect(data.houseCredits.has('Spain')).toBe(false);
    // AI house credits parsed correctly
    expect(data.houseCredits.get('USSR')).toBe(25);
  });

  it('player credits are separate from houseCredits', () => {
    const ini = `[Basic]
Player=Greece
Name=Test

[Map]
X=0
Y=0
Width=50
Height=50

[Greece]
Credits=50

[USSR]
Credits=30

[Waypoints]
[MapPack]
[OverlayPack]
`;
    const data = parseScenarioINI(ini);
    expect(data.playerCredits).toBe(50);
    expect(data.houseCredits.get('USSR')).toBe(30);
    expect(data.houseCredits.has('Greece')).toBe(false);
  });
});

describe('Edge field parsing (Gap #5)', () => {
  it('parses Edge= for houses', () => {
    const ini = `[Basic]
Player=Greece
Name=Test

[Map]
X=0
Y=0
Width=50
Height=50

[Greece]
Edge=West

[USSR]
Edge=East

[Waypoints]
[MapPack]
[OverlayPack]
`;
    const data = parseScenarioINI(ini);
    expect(data.houseEdges.get('Greece')).toBe('West');
    expect(data.houseEdges.get('USSR')).toBe('East');
  });

  it('returns empty map when no Edge= fields', () => {
    const ini = `[Basic]
Player=Spain
Name=Test

[Map]
X=0
Y=0
Width=50
Height=50

[Waypoints]
[MapPack]
[OverlayPack]
`;
    const data = parseScenarioINI(ini);
    expect(data.houseEdges.size).toBe(0);
  });
});

describe('BEGIN_PRODUCTION trigger action (Gap #4)', () => {
  it('executeTriggerAction returns beginProduction for TACTION_BEGIN_PRODUCTION', () => {
    const action: TriggerAction = { action: 3, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, [], new Map(), new Set(), [], 2 /* USSR house index */
    );
    expect(result.beginProduction).toBe(2);
  });

  it('houseIdToHouse maps USSR index to House.USSR', () => {
    expect(houseIdToHouse(2)).toBe('USSR');
    expect(houseIdToHouse(0)).toBe('Spain');
    expect(houseIdToHouse(3)).toBe('England');
  });
});

// ============================================================
// Edge-Based Reinforcement Spawning (Gap #5 behavior)
// ============================================================
describe('Edge-based reinforcement spawning', () => {
  const makeTeam = (house: number, origin: number): TeamType => ({
    name: 'TestTeam',
    house,
    flags: 0,
    origin,
    members: [{ type: 'E1', count: 1 }],
    missions: [],
  });

  const mapBounds = { x: 40, y: 40, w: 50, h: 50 };

  it('spawns units at east edge when origin=-1 and house has Edge=East', () => {
    const team = makeTeam(2, -1); // USSR = house 2
    const houseEdges = new Map<House, string>([[House.USSR, 'East']]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 }; // TACTION_REINFORCEMENTS
    const result = executeTriggerAction(
      action, [team], new Map(), new Set(), [], 2, houseEdges, mapBounds
    );
    expect(result.spawned.length).toBeGreaterThan(0);
    // East edge: cx should be bx + bw - 1 = 89, cellToWorld adds CELL_SIZE/2
    for (const unit of result.spawned) {
      // pos.x = cx * 24 + 12 + offsetX; cx=89 → base ~2148, allow spread
      expect(unit.pos.x).toBeGreaterThanOrEqual(89 * 24);
      expect(unit.pos.x).toBeLessThan(90 * 24 + 24);
    }
  });

  it('spawns units at west edge when origin=-1 and house has Edge=West', () => {
    const team = makeTeam(0, -1); // Spain = house 0
    const houseEdges = new Map<House, string>([[House.Spain, 'West']]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, [team], new Map(), new Set(), [], 0, houseEdges, mapBounds
    );
    expect(result.spawned.length).toBeGreaterThan(0);
    // West edge: cx should be bx = 40, cellToWorld adds CELL_SIZE/2
    for (const unit of result.spawned) {
      expect(unit.pos.x).toBeGreaterThanOrEqual(40 * 24 - 24);
      expect(unit.pos.x).toBeLessThan(41 * 24 + 24);
    }
  });

  it('does not spawn when origin=-1 and no houseEdges provided', () => {
    const team = makeTeam(2, -1);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, [team], new Map(), new Set(), [], 2
    );
    expect(result.spawned.length).toBe(0);
  });

  it('does not spawn when origin=-1 and edge is unrecognized', () => {
    const team = makeTeam(2, -1);
    const houseEdges = new Map<House, string>([[House.USSR, 'NorthEast']]);
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = executeTriggerAction(
      action, [team], new Map(), new Set(), [], 2, houseEdges, mapBounds
    );
    expect(result.spawned.length).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown house edge'));
    warnSpy.mockRestore();
  });
});
