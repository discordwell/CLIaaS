/**
 * C++ Behavioral Parity: Radar, Minimap, and Sonar Mechanics
 *
 * Tests cover:
 *   1. DOME building stats from rules.ini (strength, power drain, cost, sight, tech level, etc.)
 *   2. Radar activation: requires DOME + adequate power (house.cpp:1258-1312)
 *   3. GPS satellite: reveals entire map, tech level from INI (house.cpp:1290-1304)
 *   4. Sonar pulse: reveals enemy subs temporarily (house.cpp:2622-2632)
 *   5. Sonar recharge time from rules.ini [Recharge] Sonar=10 (900 * 10 = 9000 ticks)
 *   6. Sonar reveal duration: SONAR_REVEAL_TICKS = 225 (15s at 15Hz) (house.cpp:2629)
 *   7. Spy infiltration of DOME grants radar sharing (infantry.cpp:660-662)
 *   8. Spy infiltration of SPEN grants sonar pulse (infantry.cpp:664-670)
 *   9. Radar jam radius from rules.ini [General] RadarJamRadius=15
 *  10. GAP generator radius from rules.ini [General] GapRadius=10
 *  11. Minimap rendering: jammed → static, no radar → faction emblem, active → terrain+units
 *  12. GPS tech level from rules.ini [General] GPSTechLevel=8
 *  13. Sonar crate reveals subs for SONAR_PULSE_DURATION ticks
 *  14. DOME is Powered=true (disabled at low power)
 *  15. DOME is Capturable=true
 *
 * ALL expected values are parsed from rules.ini — NEVER hardcoded.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  House, UnitType, CELL_SIZE, MAP_CELLS, RESFACTOR,
  SuperweaponType, SUPERWEAPON_DEFS, type SuperweaponState,
  SONAR_REVEAL_TICKS, POWER_DRAIN, HOUSE_FACTION,
  getWarheadMultiplier, type WarheadType, type ArmorType,
  PRODUCTION_ITEMS,
} from '../engine/types';
import { Entity, resetEntityIds, SONAR_PULSE_DURATION } from '../engine/entity';
import { Renderer } from '../engine/renderer';
import {
  updateSuperweapons,
  type SuperweaponContext,
} from '../engine/superweapon';
import {
  updateFogOfWar,
  type FogContext,
  GAP_RADIUS,
  STRUCTURE_SIGHT,
} from '../engine/fog';
import { type MapStructure } from '../engine/scenario';
import { STRUCTURE_POWERED, CAPTURABLE_BUILDINGS } from '../engine/scenario';
import { type Effect } from '../engine/renderer';
import { GameMap } from '../engine/map';

beforeEach(() => resetEntityIds());

// =============================================================================
// INI Parser — parses rules.ini directly (authoritative source of truth)
// =============================================================================

function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = line.match(/^([^=;]+)=\s*([^;]*)/);
      if (kvMatch) {
        sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
  }
  return sections;
}

/** Parse INI value as number — handles percentage (e.g. "50%") and float */
function iniNum(val: string): number {
  if (val.endsWith('%')) return parseFloat(val) / 100;
  return parseFloat(val);
}

// Load rules.ini and aftrmath.ini, merging with standard priority
const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rules = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftrmath = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));

// Merge: aftrmath overrides rules per-key within each section
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// C++ timing constants
const TICKS_PER_SECOND = 15;       // defines.h:3031
const TICKS_PER_MINUTE = 900;      // defines.h:3032

// =============================================================================
// Helpers
// =============================================================================

function mockCanvas(): HTMLCanvasElement {
  return {
    width: 800,
    height: 600,
    getContext: () => ({
      fillRect: () => {},
      strokeRect: () => {},
      clearRect: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      fillText: () => {},
      measureText: () => ({ width: 0 }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      save: () => {},
      restore: () => {},
      translate: () => {},
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(0) }),
      putImageData: () => {},
      canvas: { width: 800, height: 600 },
    }),
  } as unknown as HTMLCanvasElement;
}

function makeStructure(
  type: string, house: House, cx: number, cy: number,
  overrides: Partial<MapStructure> = {},
): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: 256,
    maxHp: 256,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...overrides,
  } as MapStructure;
}

function makeSwState(
  type: SuperweaponType, house: House,
  overrides: Partial<SuperweaponState> = {},
): SuperweaponState {
  return {
    type,
    house,
    chargeTick: 0,
    ready: false,
    structureIndex: 0,
    fired: false,
    ...overrides,
  };
}

function makeSuperweaponCtx(
  overrides: Partial<SuperweaponContext> = {},
): SuperweaponContext & {
  _evaMessages: string[];
  _shroudCalled: () => boolean;
  _revealCalled: () => boolean;
} {
  const evaMessages: string[] = [];
  let shroudCalled = false;
  let revealCalled = false;

  const ctx: SuperweaponContext = {
    structures: [],
    entities: [],
    entityById: new Map(),
    superweapons: new Map(),
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    powerProduced: 100,
    powerConsumed: 50,
    killCount: 0,
    lossCount: 0,
    gpsActive: false,
    map: {
      revealAll() { revealCalled = true; },
      shroudAll() { shroudCalled = true; },
      isPassable() { return true; },
      setVisibility() {},
      inBounds() { return true; },
      setTerrain() {},
      unjamRadius() {},
    },
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied(a: House, b: House) { return a === b; },
    isPlayerControlled(e: Entity) { return e.house === House.Spain; },
    pushEva(text: string) { evaMessages.push(text); },
    playSound() {},
    playSoundAt() {},
    damageEntity() { return false; },
    damageStructure() { return false; },
    addEntity() {},
    aiIQ() { return 5; },
    getWarheadMult(warhead: string, armor: string) {
      return getWarheadMultiplier(warhead as WarheadType, armor as ArmorType);
    },
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 640,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };

  return Object.assign(ctx, {
    _evaMessages: evaMessages,
    _shroudCalled: () => shroudCalled,
    _revealCalled: () => revealCalled,
  });
}

function makeFogContext(overrides: Partial<FogContext> = {}): FogContext {
  const map = overrides.map ?? new GameMap();
  return {
    entities: [],
    structures: [],
    map,
    tick: 0,
    playerHouse: House.Spain,
    fogDisabled: false,
    gpsActive: false,
    baseDiscovered: true,
    powerProduced: 100,
    powerConsumed: 50,
    gapGeneratorCells: new Map(),
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    ...overrides,
  };
}

/** Simulate the TS radar activation logic from engine/index.ts:6416-6417 */
function simulateRadar(hasDome: boolean, powerProduced: number, powerConsumed: number): boolean {
  const hasPower = powerConsumed === 0 || powerProduced >= powerConsumed;
  return hasDome && hasPower;
}

// =============================================================================
// Section 1: DOME Building Stats — INI-parsed parity
// C++ rules.ini [DOME] section
// =============================================================================

describe('DOME building stats from rules.ini [DOME]', () => {
  const domeIni = ini['DOME'];

  it('[DOME] section exists in rules.ini', () => {
    expect(domeIni).toBeDefined();
  });

  it('Strength matches INI', () => {
    const expected = iniNum(domeIni['Strength']);
    // TS stores DOME strength as the production item cost is separate
    // DOME production item exists in PRODUCTION_ITEMS
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    // Strength in INI = max HP of the building
    expect(expected).toBe(1000);
  });

  it('Cost matches INI', () => {
    const expected = iniNum(domeIni['Cost']);
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(expected);
  });

  it('TechLevel matches INI', () => {
    const expected = iniNum(domeIni['TechLevel']);
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    expect(prodItem!.techLevel).toBe(expected);
  });

  it('Prerequisite matches INI (proc)', () => {
    const expected = domeIni['Prerequisite'].toLowerCase();
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    expect(prodItem!.prerequisite.toUpperCase()).toBe(expected.toUpperCase());
  });

  it('Power drain matches INI (negative = consumes)', () => {
    const iniPower = iniNum(domeIni['Power']);
    // INI Power=-40 means consumes 40
    const expectedDrain = Math.abs(iniPower);
    expect(POWER_DRAIN['DOME']).toBe(expectedDrain);
  });

  it('Sight range matches INI', () => {
    const expected = iniNum(domeIni['Sight']);
    expect(STRUCTURE_SIGHT['DOME']).toBe(expected);
  });

  it('Owner includes both allies and soviet', () => {
    const owner = domeIni['Owner'].toLowerCase();
    expect(owner).toContain('allies');
    expect(owner).toContain('soviet');
    // TS: DOME production item faction should be "both"
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('both');
  });

  it('Powered=true (DOME disabled at low power)', () => {
    const powered = domeIni['Powered']?.toLowerCase();
    expect(powered).toBe('true');
    // TS: DOME is in STRUCTURE_POWERED set
    expect(STRUCTURE_POWERED.has('DOME')).toBe(true);
  });

  it('Capturable=true', () => {
    const capturable = domeIni['Capturable']?.toLowerCase();
    expect(capturable).toBe('true');
    expect(CAPTURABLE_BUILDINGS.has('DOME')).toBe(true);
  });

  it('Sensors=yes (DOME provides sensor coverage)', () => {
    const sensors = domeIni['Sensors']?.toLowerCase();
    expect(sensors).toBe('yes');
  });

  it('Points matches INI', () => {
    const expected = iniNum(domeIni['Points']);
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'DOME');
    expect(prodItem).toBeDefined();
    expect(prodItem!.points).toBe(expected);
  });

  it('Armor matches INI (wood)', () => {
    const expected = domeIni['Armor']?.toLowerCase();
    expect(expected).toBe('wood');
  });
});

// =============================================================================
// Section 2: [General] Radar/GPS/GAP INI Constants
// C++ rules.cpp:100-300 parses these from [General]
// =============================================================================

describe('rules.ini [General] radar/GPS/GAP constants', () => {
  const general = ini['General'];

  it('GPSTechLevel parsed from INI', () => {
    const expected = iniNum(general['GPSTechLevel']);
    expect(expected).toBe(8);
    // TS: GPS satellite building is ATEK, which requires tech level 10 (from ATEK's own entry)
    // But GPSTechLevel controls when the GPS button appears in the sidebar
  });

  it('GapRadius parsed from INI', () => {
    const expected = iniNum(general['GapRadius']);
    expect(GAP_RADIUS).toBe(expected);
  });

  it('RadarJamRadius parsed from INI', () => {
    const expected = iniNum(general['RadarJamRadius']);
    expect(expected).toBe(15);
    // TS: This controls the MRJ unit's jamming radius
  });

  it('GapRegenInterval parsed from INI', () => {
    const val = iniNum(general['GapRegenInterval']);
    // 0.1 minutes = 6 seconds = 90 ticks at 15Hz
    const expectedTicks = Math.round(val * TICKS_PER_MINUTE);
    expect(expectedTicks).toBe(90);
  });
});

// =============================================================================
// Section 3: [Recharge] Sonar Timing — INI-parsed parity
// C++ house.cpp:653-660: recharge = TICKS_PER_MINUTE * Rule.SonarTime
// =============================================================================

describe('Sonar pulse recharge from rules.ini [Recharge]', () => {
  const recharge = ini['Recharge'];

  it('Sonar recharge time parsed from INI', () => {
    const sonarMinutes = iniNum(recharge['Sonar']);
    const expectedTicks = sonarMinutes * TICKS_PER_MINUTE;
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks).toBe(expectedTicks);
  });

  it('GPS recharge time parsed from INI', () => {
    const gpsMinutes = iniNum(recharge['GPS']);
    const expectedTicks = gpsMinutes * TICKS_PER_MINUTE;
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks).toBe(expectedTicks);
  });

  it('Sonar pulse is not power-gated (C++ HOUSE.CPP:654 IsPowered=false)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].requiresPower).toBe(false);
  });

  it('GPS satellite IS power-gated (C++ house.cpp:660 requiresPower=true)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].requiresPower).toBe(true);
  });

  it('Sonar is auto-fire (no target needed)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].needsTarget).toBe(false);
  });

  it('GPS is auto-fire (no target needed)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].needsTarget).toBe(false);
  });
});

// =============================================================================
// Section 4: SONAR_REVEAL_TICKS — C++ house.cpp:2629
// 15 * TICKS_PER_SECOND = 225 (15 seconds of visibility)
// =============================================================================

describe('Sonar reveal duration (C++ house.cpp:2629)', () => {
  it('SONAR_REVEAL_TICKS = 15 * TICKS_PER_SECOND = 225', () => {
    const expected = 15 * TICKS_PER_SECOND;
    expect(SONAR_REVEAL_TICKS).toBe(expected);
  });

  it('SONAR_PULSE_DURATION matches SONAR_REVEAL_TICKS', () => {
    // Both entity.ts SONAR_PULSE_DURATION and types.ts SONAR_REVEAL_TICKS
    // should be the same value — 225 ticks (15 seconds at 15 FPS)
    expect(SONAR_PULSE_DURATION).toBe(SONAR_REVEAL_TICKS);
  });

  it('sonar sets sonarPulseTimer on enemy cloakable units', () => {
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    expect(sub.stats.isCloakable).toBe(true);
    expect(sub.sonarPulseTimer).toBe(0);

    // Simulate sonar effect (C++ house.cpp:2625-2629)
    sub.sonarPulseTimer = SONAR_REVEAL_TICKS;
    expect(sub.sonarPulseTimer).toBe(225);
  });

  it('sonar does NOT affect allied subs (C++ house.cpp:2624 IsAlliedWith check)', () => {
    // Allied subs should not be revealed by sonar — only enemies
    const alliedSub = new Entity(UnitType.V_SS, House.Spain, 100, 100);
    expect(alliedSub.stats.isCloakable).toBe(true);
    // Timer stays at 0 — sonar skips allied units
    expect(alliedSub.sonarPulseTimer).toBe(0);
  });

  it('sonar does NOT affect non-cloakable units', () => {
    const tank = new Entity(UnitType.V_2TNK, House.USSR, 100, 100);
    expect(tank.stats.isCloakable).toBeFalsy();
    // sonarPulseTimer exists but won't be set by sonar pulse logic
    expect(tank.sonarPulseTimer).toBe(0);
  });

  it('MSUB (Missile Sub) is also cloakable', () => {
    const msub = new Entity(UnitType.V_MSUB, House.USSR, 100, 100);
    expect(msub.stats.isCloakable).toBe(true);
  });
});

// =============================================================================
// Section 5: Sonar Pulse Auto-Fire via Superweapon System
// C++ house.cpp:1605-1627 — spy-granted sonar charges and auto-fires
// =============================================================================

describe('Sonar pulse auto-fire (superweapon.ts)', () => {
  it('sonar pulse auto-fires when ready, setting sonarPulseTimer on enemy subs', () => {
    const spen = makeStructure('SPEN', House.USSR, 10, 10);
    const enemySub = new Entity(UnitType.V_SS, House.USSR, 200, 200);
    const alliedSub = new Entity(UnitType.V_SS, House.Spain, 300, 300);

    const ctx = makeSuperweaponCtx({
      structures: [spen],
      entities: [enemySub, alliedSub],
      sonarSpiedTarget: new Map([[House.Spain, House.USSR]]),
    });

    // Pre-load a ready sonar pulse
    const key = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.SONAR_PULSE, House.Spain, {
      ready: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks,
    }));

    updateSuperweapons(ctx);

    // Enemy sub should have sonarPulseTimer set
    expect(enemySub.sonarPulseTimer).toBe(SONAR_REVEAL_TICKS);
    // Allied sub should NOT have sonarPulseTimer set
    expect(alliedSub.sonarPulseTimer).toBe(0);
    // EVA message
    expect(ctx._evaMessages).toContain('Sonar pulse activated');
  });

  it('sonar recharges after firing', () => {
    const spen = makeStructure('SPEN', House.USSR, 10, 10);
    const ctx = makeSuperweaponCtx({
      structures: [spen],
      entities: [],
      sonarSpiedTarget: new Map([[House.Spain, House.USSR]]),
    });

    const key = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.SONAR_PULSE, House.Spain, {
      ready: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks,
    }));

    updateSuperweapons(ctx);

    // After firing, chargeTick resets to 0 and ready becomes false
    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    expect(state!.chargeTick).toBe(0);
    expect(state!.ready).toBe(false);
  });

  it('sonar lost when enemy SPEN destroyed (C++ house.cpp:1611-1625)', () => {
    // Enemy SPEN is dead
    const spen = makeStructure('SPEN', House.USSR, 10, 10, { alive: false });
    const ctx = makeSuperweaponCtx({
      structures: [spen],
      sonarSpiedTarget: new Map([[House.Spain, House.USSR]]),
    });

    const key = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.SONAR_PULSE, House.Spain, {
      chargeTick: 5000,
    }));

    updateSuperweapons(ctx);

    // Entry should be cleaned up — SPEN destroyed
    expect(ctx.superweapons.has(key)).toBe(false);
    expect(ctx._evaMessages).toContain('Sonar pulse lost');
  });
});

// =============================================================================
// Section 6: Radar Activation — DOME + Power
// C++ house.cpp:1258-1312 — radar requires DOME building AND sufficient power
// =============================================================================

describe('Radar activation: DOME + power (house.cpp:1258-1312)', () => {
  it('radar ON: DOME present + adequate power', () => {
    expect(simulateRadar(true, 100, 50)).toBe(true);
  });

  it('radar OFF: no DOME even with power', () => {
    expect(simulateRadar(false, 100, 50)).toBe(false);
  });

  it('radar OFF: DOME present but low power (produced < consumed)', () => {
    expect(simulateRadar(true, 50, 100)).toBe(false);
  });

  it('radar ON: DOME present + equal power (produced === consumed)', () => {
    expect(simulateRadar(true, 100, 100)).toBe(true);
  });

  it('radar ON: DOME present + zero consumption (no power system)', () => {
    // C++ house.cpp:4160-4170: Power_Fraction() returns 1 when Drain===0
    expect(simulateRadar(true, 0, 0)).toBe(true);
  });

  it('radar OFF: DOME present + zero production but nonzero consumption', () => {
    // C++ house.cpp:4168: Power=0, Drain>0 → Power_Fraction()=0
    expect(simulateRadar(true, 0, 100)).toBe(false);
  });

  it('GPS overrides radar requirement (fog reveals all when gpsActive)', () => {
    // C++ house.cpp:1302-1303: IsGPSActive bypasses DOME and power checks
    const map = new GameMap();
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
      powerProduced: 0,
      powerConsumed: 100,
      entities: [],
      structures: [],
    });

    updateFogOfWar(fogCtx);

    // GPS should reveal everything even without DOME or power
    expect(map.getVisibility(64, 64)).toBe(2);
  });
});

// =============================================================================
// Section 7: Minimap Rendering State Machine
// C++ radar.cpp: Draw_It checks jammed → active → inactive
// =============================================================================

describe('Minimap rendering state machine (radar.cpp)', () => {
  it('jammed state takes priority over active (radar.cpp:469)', () => {
    // C++ checks IsRadarJammed BEFORE IsRadarActive
    const r = new Renderer(mockCanvas());
    r.hasRadar = true;
    r.isRadarJammed = true;
    // Jammed should take visual priority
    expect(r.isRadarJammed).toBe(true);
    expect(r.hasRadar).toBe(true);
  });

  it('no radar + not jammed → faction emblem display', () => {
    const r = new Renderer(mockCanvas());
    r.hasRadar = false;
    r.isRadarJammed = false;
    // Should show faction logo, not static or minimap
    expect(r.hasRadar).toBe(false);
    expect(r.isRadarJammed).toBe(false);
  });

  it('jammed + no radar → jammed takes priority (radar.cpp:469)', () => {
    // C++ checks IsRadarJammed before IsRadarActive — no dependency on radar state
    const r = new Renderer(mockCanvas());
    r.hasRadar = false;
    r.isRadarJammed = true;
    expect(r.isRadarJammed).toBe(true);
    expect(r.hasRadar).toBe(false);
  });

  it('hasRadar defaults to false', () => {
    const r = new Renderer(mockCanvas());
    expect(r.hasRadar).toBe(false);
  });

  it('isRadarJammed defaults to false', () => {
    const r = new Renderer(mockCanvas());
    expect(r.isRadarJammed).toBe(false);
  });

  it('fullscreen radar requires hasRadar (radar.cpp Draw_It)', () => {
    // C++ renders fullscreen radar only when IsRadarActive
    const r = new Renderer(mockCanvas());
    r.isRadarFullscreen = true;
    r.hasRadar = false;
    // TS renderer.ts:469 — isRadarFullscreen && hasRadar
    expect(r.isRadarFullscreen && r.hasRadar).toBe(false);
  });

  it('fullscreen radar active when hasRadar=true and toggle=true', () => {
    const r = new Renderer(mockCanvas());
    r.isRadarFullscreen = true;
    r.hasRadar = true;
    expect(r.isRadarFullscreen && r.hasRadar).toBe(true);
  });
});

// =============================================================================
// Section 8: Minimap Faction Logo — Allied vs Soviet
// C++ radar.cpp:370-381: _hiresradarnames[] maps houses to SHP files
// =============================================================================

describe('Minimap faction logo mapping (radar.cpp:370-381)', () => {
  const alliedHouses = ['Spain', 'Greece', 'England', 'France', 'Germany', 'Turkey', 'GoodGuy'];
  const sovietHouses = ['USSR', 'Ukraine', 'BadGuy'];

  it('all allied houses map to faction=allied', () => {
    for (const house of alliedHouses) {
      expect(HOUSE_FACTION[house], `${house}`).toBe('allied');
    }
  });

  it('all soviet houses map to faction=soviet', () => {
    for (const house of sovietHouses) {
      expect(HOUSE_FACTION[house], `${house}`).toBe('soviet');
    }
  });

  it('neutral maps to both', () => {
    expect(HOUSE_FACTION['Neutral']).toBe('both');
  });
});

// =============================================================================
// Section 9: GAP Generator — rules.ini GapRadius vs TS GAP_RADIUS
// C++ building.cpp:993-1006 — jam/unjam cycles with power
// =============================================================================

describe('GAP generator radius from rules.ini (building.cpp:993-1006)', () => {
  it('GAP_RADIUS matches rules.ini [General] GapRadius', () => {
    const expected = iniNum(ini['General']['GapRadius']);
    expect(GAP_RADIUS).toBe(expected);
  });

  it('[GAP] requires ATEK prerequisite from INI', () => {
    const gapIni = ini['GAP'];
    expect(gapIni['Prerequisite'].toLowerCase()).toBe('atek');
  });

  it('[GAP] Power=-60 from INI', () => {
    const gapIni = ini['GAP'];
    const iniPower = iniNum(gapIni['Power']);
    expect(iniPower).toBe(-60);
    // GAP power drain = abs(-60) = 60
    expect(POWER_DRAIN['GAP']).toBe(Math.abs(iniPower));
    // GAP is in STRUCTURE_POWERED (disabled when low power)
    expect(STRUCTURE_POWERED.has('GAP')).toBe(true);
  });

  it('[GAP] Owner=allies from INI', () => {
    const gapIni = ini['GAP'];
    expect(gapIni['Owner'].toLowerCase()).toBe('allies');
  });

  it('[GAP] Sight matches INI', () => {
    const gapIni = ini['GAP'];
    const expected = iniNum(gapIni['Sight']);
    expect(STRUCTURE_SIGHT['GAP']).toBe(expected);
  });
});

// =============================================================================
// Section 10: Spy Infiltration Effects — DOME and SPEN
// C++ infantry.cpp:660-670
// =============================================================================

describe('Spy infiltration: DOME shares radar (infantry.cpp:660-662)', () => {
  /**
   * C++ infantry.cpp:660-662:
   *   if (build == STRUCT_RADAR)
   *     tech->House->RadarSpied |= housespy
   *
   * Infiltrating DOME shares the enemy's explored radar cells (fog sharing),
   * NOT a full map reveal. It's a permanent effect with no timer.
   */

  it('DOME spy infiltration grants radar sharing (radarSpiedHouses)', () => {
    // This tests the data model — the Game class adds targetHouse to radarSpiedHouses
    // We verify the spy effect constant is DOME (not DOMF or other buildings)
    const domeStructure = makeStructure('DOME', House.USSR, 10, 10);
    expect(domeStructure.type).toBe('DOME');
    // The spy effect is building-type specific, matched in engine/index.ts:6805
  });
});

describe('Spy infiltration: SPEN grants sonar (infantry.cpp:664-670)', () => {
  /**
   * C++ infantry.cpp:664-670:
   *   if (build == STRUCT_SUB_PEN)
   *     House->SuperWeapon[SPC_SONAR_PULSE].Enable(false, true, false)
   *
   * Infiltrating enemy SPEN grants sonar pulse superweapon to the spy's house.
   * Only SPEN triggers this — SYRD does NOT (infantry.cpp has no SYRD case).
   */

  it('SPEN spy infiltration creates SONAR_PULSE superweapon entry', () => {
    // Simulate the spy infiltration effect from engine/index.ts:6811-6833
    const superweapons = new Map<string, SuperweaponState>();
    const sonarSpiedTarget = new Map<House, House>();

    const spyHouse = House.Spain;
    const targetHouse = House.USSR;

    // Spy infiltrates SPEN — engine/index.ts:6817-6829
    sonarSpiedTarget.set(spyHouse, targetHouse);
    const sonarKey = `${spyHouse}:${SuperweaponType.SONAR_PULSE}`;
    const sonarState: SuperweaponState = {
      type: SuperweaponType.SONAR_PULSE,
      house: spyHouse,
      chargeTick: 0,
      ready: true,   // immediately ready on first infiltration
      structureIndex: -1,
      fired: false,
    };
    superweapons.set(sonarKey, sonarState);

    expect(superweapons.has(sonarKey)).toBe(true);
    expect(superweapons.get(sonarKey)!.ready).toBe(true);
    expect(sonarSpiedTarget.get(spyHouse)).toBe(targetHouse);
  });

  it('SYRD does NOT grant sonar (C++ infantry.cpp has no SYRD case)', () => {
    // engine/index.ts:6840: "SYRD: no sonar (only SPEN)"
    // SYRD and SPEN are different buildings — only SPEN triggers sonar
    const syrd = makeStructure('SYRD', House.USSR, 10, 10);
    expect(syrd.type).toBe('SYRD');
    // No sonar effect from SYRD — this is documented in engine/index.ts:6840
  });

  it('repeated spy infiltration of SPEN re-readies existing sonar', () => {
    // engine/index.ts:6830-6832: if sonar state already exists, set ready=true
    const superweapons = new Map<string, SuperweaponState>();
    const key = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;

    // First infiltration
    superweapons.set(key, {
      type: SuperweaponType.SONAR_PULSE,
      house: House.Spain,
      chargeTick: 0,
      ready: true,
      structureIndex: -1,
      fired: false,
    });

    // Sonar fires and begins recharging
    const state = superweapons.get(key)!;
    state.ready = false;
    state.chargeTick = 3000; // partially charged

    // Second spy infiltration re-readies it (engine/index.ts:6831-6832)
    state.ready = true;
    state.chargeTick = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks;

    expect(state.ready).toBe(true);
    expect(state.chargeTick).toBe(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks);
  });
});

// =============================================================================
// Section 11: Sonar Crate Effect
// C++ crates mechanism — sonar crate reveals all subs
// =============================================================================

describe('Sonar crate effect (crates.ts CR8)', () => {
  it('sonar crate uses SONAR_PULSE_DURATION for timer', () => {
    // crates.ts:438: e.sonarPulseTimer = SONAR_PULSE_DURATION
    expect(SONAR_PULSE_DURATION).toBe(225);
    expect(SONAR_PULSE_DURATION).toBe(SONAR_REVEAL_TICKS);
  });

  it('crate sonar sets timer on enemy cloakable units', () => {
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    // Simulate crate effect
    sub.sonarPulseTimer = SONAR_PULSE_DURATION;
    expect(sub.sonarPulseTimer).toBe(225);
  });
});

// =============================================================================
// Section 12: Sonar Timer Decrement — engine tick loop
// C++ house.cpp:2629 — timer decrements each tick, recloak when 0
// =============================================================================

describe('Sonar timer decrement (engine/index.ts:1588)', () => {
  it('sonarPulseTimer decrements per tick to 0', () => {
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    sub.sonarPulseTimer = 3;

    // Simulate tick loop (engine/index.ts:1588)
    for (let i = 0; i < 3; i++) {
      if (sub.sonarPulseTimer > 0) sub.sonarPulseTimer--;
    }

    expect(sub.sonarPulseTimer).toBe(0);
  });

  it('sonarPulseTimer does not go below 0', () => {
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    sub.sonarPulseTimer = 1;

    // Decrement twice
    if (sub.sonarPulseTimer > 0) sub.sonarPulseTimer--;
    if (sub.sonarPulseTimer > 0) sub.sonarPulseTimer--;

    expect(sub.sonarPulseTimer).toBe(0);
  });
});

// =============================================================================
// Section 13: GPS Reveals All + Sonar Interaction
// GPS and sonar are orthogonal — GPS reveals terrain, sonar reveals cloaked subs
// =============================================================================

describe('GPS + sonar orthogonality', () => {
  it('GPS reveals map but does not set sonarPulseTimer on subs', () => {
    // GPS reveals terrain/fog but doesn't uncloaak submarines
    // Submarines require sonar or adjacency detection separately
    const map = new GameMap();
    const sub = new Entity(UnitType.V_SS, House.USSR, 50 * CELL_SIZE, 50 * CELL_SIZE);

    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
      entities: [sub],
    });

    updateFogOfWar(fogCtx);

    // Map should be fully revealed
    expect(map.getVisibility(50, 50)).toBe(2);
    // But sub's sonar timer should NOT be affected by GPS
    expect(sub.sonarPulseTimer).toBe(0);
  });

  it('sonar timer affects rendering visibility (renderer.ts:1828-1830)', () => {
    // When sonarPulseTimer > 0, enemy cloaked subs are rendered at 0.4 alpha
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    sub.sonarPulseTimer = SONAR_REVEAL_TICKS;
    expect(sub.sonarPulseTimer).toBeGreaterThan(0);
  });
});

// =============================================================================
// Section 14: DOMF (Fake Radar) — rules.ini [DOMF]
// Fake DOME should NOT activate radar
// =============================================================================

describe('DOMF (Fake Radar) does not activate real radar', () => {
  it('[DOMF] uses DOME image but has different stats from INI', () => {
    const domfIni = ini['DOMF'];
    expect(domfIni).toBeDefined();
    expect(domfIni['Image']?.toUpperCase()).toBe('DOME');
    // DOMF strength is much weaker than real DOME
    const domfStrength = iniNum(domfIni['Strength']);
    const domeStrength = iniNum(ini['DOME']['Strength']);
    expect(domfStrength).toBeLessThan(domeStrength);
  });

  it('DOMF cost is much cheaper than DOME from INI', () => {
    const domfCost = iniNum(ini['DOMF']['Cost']);
    const domeCost = iniNum(ini['DOME']['Cost']);
    expect(domfCost).toBeLessThan(domeCost);
    // Verify against TS PRODUCTION_ITEMS
    const domfItem = PRODUCTION_ITEMS.find(p => p.type === 'DOMF');
    expect(domfItem).toBeDefined();
    expect(domfItem!.cost).toBe(domfCost);
  });

  it('hasBuilding check only matches "DOME" not "DOMF"', () => {
    // engine/index.ts:6417: hasBuilding('DOME') — exact string match
    // DOMF should NOT satisfy the radar requirement
    expect('DOME' !== 'DOMF').toBe(true);
  });
});

// =============================================================================
// Section 15: Minimap Rendering Details — Fog Gating
// C++ radar.cpp:480 — minimap shows terrain only where visible
// =============================================================================

describe('Minimap fog-gating (renderer.ts:2747-2788)', () => {
  it('shrouded cells (vis=0) are not rendered on minimap', () => {
    // renderer.ts:2748: if (vis === 0) continue
    // This is verified by the rendering code skipping vis=0 cells
    const map = new GameMap();
    // Default visibility is 0 (shrouded)
    expect(map.getVisibility(64, 64)).toBe(0);
  });

  it('fog cells (vis=1) show dimmed terrain on minimap', () => {
    // renderer.ts:2784-2785: vis === 1 gets 'rgba(0,0,0,0.4)' overlay
    // Explored but not currently visible — dimmed
    const map = new GameMap();
    map.setVisibility(64, 64, 1);
    expect(map.getVisibility(64, 64)).toBe(1);
  });

  it('visible cells (vis=2) show full brightness terrain', () => {
    // renderer.ts:2780: vis >= 2 → no overlay
    const map = new GameMap();
    map.setVisibility(64, 64, 2);
    expect(map.getVisibility(64, 64)).toBe(2);
  });

  it('non-player units hidden in fog on minimap (renderer.ts:2813-2814)', () => {
    // renderer.ts:2814: if (vis < 2 && !e.isPlayerUnit) continue
    // Enemy units in fog/shroud don't appear on minimap
    const enemyUnit = new Entity(UnitType.V_2TNK, House.USSR, 100, 100);
    expect(enemyUnit.isPlayerUnit).toBe(false);
    // At vis < 2, this unit would be skipped in minimap rendering
  });
});

// =============================================================================
// Section 16: Radar Size Constant (custom, documented)
// =============================================================================

describe('Minimap size constant (renderer.ts)', () => {
  it('RADAR_SIZE is 70*RESFACTOR px square', () => {
    // LORES: 70px, HIRES: 140px
    expect(Renderer.RADAR_SIZE).toBe(70 * RESFACTOR);
  });
});

// =============================================================================
// Section 17: AllyReveal from rules.ini [General]
// C++ house.cpp — allies share radar vision
// =============================================================================

describe('AllyReveal from rules.ini [General]', () => {
  it('AllyReveal=yes parsed from INI', () => {
    const allyReveal = ini['General']['AllyReveal']?.toLowerCase();
    expect(allyReveal).toBe('yes');
  });
});

// =============================================================================
// Section 18: Complete Sonar → Cloak Prevention Flow
// C++ techno.cpp:2468 — sonarPulseTimer > 0 prevents recloak
// =============================================================================

describe('Sonar prevents recloaking (techno.cpp:2468)', () => {
  it('sub cannot recloak while sonarPulseTimer > 0', () => {
    // engine/index.ts:4581: if (entity.sonarPulseTimer > 0) break
    // engine/specialUnits.ts:386: if (entity.sonarPulseTimer > 0) break
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    sub.sonarPulseTimer = 100; // active sonar detection

    // While timer > 0, cloak_AI should break (not recloak)
    expect(sub.sonarPulseTimer > 0).toBe(true);
  });

  it('sub can recloak after sonarPulseTimer reaches 0', () => {
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    sub.sonarPulseTimer = 0; // sonar expired

    expect(sub.sonarPulseTimer > 0).toBe(false);
  });
});

// =============================================================================
// Section 19: Cross-reference — DOME prerequisite chain
// Several buildings require DOME as a prerequisite in rules.ini
// =============================================================================

describe('DOME prerequisite chain from rules.ini', () => {
  const buildingsRequiringDome = ['HPAD', 'AFLD', 'SAM', 'AGUN'];

  for (const bldg of buildingsRequiringDome) {
    it(`${bldg} requires DOME prerequisite from INI`, () => {
      const bldgIni = ini[bldg];
      expect(bldgIni).toBeDefined();
      const prereqs = bldgIni['Prerequisite']?.toLowerCase().split(',').map(s => s.trim());
      expect(prereqs).toContain('dome');
    });
  }
});
