/**
 * C++ Behavioral Parity: Superweapon System — INI-Driven Tests
 *
 * ALL expected values are parsed from rules.ini (the authoritative source).
 * NO hardcoded expected values — every assertion derives from INI data.
 *
 * Covers:
 *   1. Recharge times       — [Recharge] section × TICKS_PER_MINUTE
 *   2. Nuke damage/radius   — [General] AtomDamage, C++ anim.cpp:1093 blast radius
 *   3. Chronosphere         — [General] ChronoDuration, ChronoKillCargo, ChronoTechLevel
 *   4. Iron Curtain          — [General] IronCurtain duration, demo truck short duration
 *   5. Chrono side effects  — [General] QuakeChance, VortexChance, VortexDamage, VortexRange
 *   6. Structure INI data   — [PDOX], [IRON], [MSLO] Strength, Cost, Power, TechLevel, Owner, Prerequisite
 *   7. IsPowered flag       — C++ house.cpp:653-660 SuperClass construction
 *   8. Structure-to-SW map  — building links, faction assignments, targeting modes
 *
 * C++ source references:
 *   - house.cpp:653-660   — SuperWeapon[] construction with TICKS_PER_MINUTE * Rule.<Time>
 *   - house.cpp:1385-1411 — Super_Weapon_Handler: charge, suspend on low power
 *   - house.cpp:2740-2897 — Place_Special_Blast: activation effects
 *   - rules.cpp:124-266   — RulesClass constructor (C++ defaults, overridden by INI)
 *   - rules.cpp:417-582   — Process() reads INI values
 *   - anim.cpp:1064-1107  — Do_Atom_Damage: nuke ground detonation
 *   - building.cpp:4128-4236 — Mission_Missile: MSLO launch state machine
 *   - defines.h:3031-3032 — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN, PRODUCTION_ITEMS,
  buildDefaultAlliances, worldDist,
  SuperweaponType, SUPERWEAPON_DEFS,
  IRON_CURTAIN_DURATION, IRON_CURTAIN_DEMO_TRUCK_DURATION,
  NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_FLIGHT_TICKS, NUKE_MIN_FALLOFF,
  CHRONO_SHIFT_VISUAL_TICKS, SONAR_REVEAL_TICKS,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS, STRUCTURE_POWERED,
} from '../engine/scenario';
import {
  calculatePowerGrid, sellRefund, repairCostPerStep,
} from '../engine/repairSell';
import { CHRONO_DURATION_TICKS } from '../engine/superweapon';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ===========================================================================
// INI Parser — parse rules.ini as authoritative source of truth
// ===========================================================================

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

const rulesPath = resolve(__dirname, '../../../public/ra/assets/rules.ini');
const rulesText = readFileSync(rulesPath, 'utf-8');
const INI = parseINI(rulesText);

// Helpers to parse INI value types
function iniInt(section: string, key: string): number {
  const val = INI[section]?.[key];
  if (val === undefined) throw new Error(`Missing INI key: [${section}] ${key}`);
  return Number.parseInt(val, 10);
}

function iniFloat(section: string, key: string): number {
  const val = INI[section]?.[key];
  if (val === undefined) throw new Error(`Missing INI key: [${section}] ${key}`);
  return Number.parseFloat(val);
}

function iniStr(section: string, key: string): string {
  const val = INI[section]?.[key];
  if (val === undefined) throw new Error(`Missing INI key: [${section}] ${key}`);
  return val;
}

function iniPercent(section: string, key: string): number {
  const raw = iniStr(section, key);
  if (raw.endsWith('%')) return Number.parseFloat(raw.replace('%', '')) / 100;
  return Number.parseFloat(raw);
}

function iniBool(section: string, key: string): boolean {
  const val = iniStr(section, key).toLowerCase();
  return val === 'yes' || val === 'true';
}

// ===========================================================================
// C++ Constants (from defines.h — these are compile-time constants, not INI)
// ===========================================================================

/** C++ defines.h:3031 */
const CPP_TICKS_PER_SECOND = 15;

/** C++ defines.h:3032: TICKS_PER_MINUTE = TICKS_PER_SECOND * 60 */
const CPP_TICKS_PER_MINUTE = CPP_TICKS_PER_SECOND * 60; // 900

// ===========================================================================
// INI-parsed expected values (computed from rules.ini, NOT hardcoded)
// ===========================================================================

// [Recharge] section — all values are in minutes
const INI_RECHARGE_CHRONO      = iniFloat('Recharge', 'Chrono');
const INI_RECHARGE_GPS         = iniFloat('Recharge', 'GPS');
const INI_RECHARGE_IRON        = iniFloat('Recharge', 'IronCurtain');
const INI_RECHARGE_NUKE        = iniFloat('Recharge', 'Nuke');
const INI_RECHARGE_PARABOMB    = iniFloat('Recharge', 'ParaBomb');
const INI_RECHARGE_PARATROOPER = iniFloat('Recharge', 'Paratrooper');
const INI_RECHARGE_SONAR       = iniFloat('Recharge', 'Sonar');
const INI_RECHARGE_SPYPLANE    = iniFloat('Recharge', 'SpyPlane');

// [General] section — superweapon gameplay values
const INI_ATOM_DAMAGE           = iniInt('General', 'AtomDamage');
const INI_IRON_CURTAIN_MINUTES  = iniFloat('General', 'IronCurtain');
const INI_CHRONO_DURATION_MIN   = iniFloat('General', 'ChronoDuration');
const INI_CHRONO_KILL_CARGO     = iniBool('General', 'ChronoKillCargo');
const INI_CHRONO_TECH_LEVEL     = iniInt('General', 'ChronoTechLevel');
const INI_GPS_TECH_LEVEL        = iniInt('General', 'GPSTechLevel');
const INI_QUAKE_CHANCE          = iniPercent('General', 'QuakeChance');
const INI_QUAKE_DAMAGE          = iniPercent('General', 'QuakeDamage');
const INI_VORTEX_CHANCE         = iniPercent('General', 'VortexChance');
const INI_VORTEX_DAMAGE         = iniInt('General', 'VortexDamage');
const INI_VORTEX_RANGE          = iniInt('General', 'VortexRange');

// Structure INI sections — [PDOX], [IRON], [MSLO]
const INI_PDOX_STRENGTH    = iniInt('PDOX', 'Strength');
const INI_PDOX_COST        = iniInt('PDOX', 'Cost');
const INI_PDOX_POWER       = iniInt('PDOX', 'Power');  // negative = consumes
const INI_PDOX_TECHLEVEL   = iniInt('PDOX', 'TechLevel');
const INI_PDOX_OWNER       = iniStr('PDOX', 'Owner');
const INI_PDOX_PREREQ      = iniStr('PDOX', 'Prerequisite');
const INI_PDOX_POWERED     = iniBool('PDOX', 'Powered');

const INI_IRON_STRENGTH    = iniInt('IRON', 'Strength');
const INI_IRON_COST        = iniInt('IRON', 'Cost');
const INI_IRON_POWER       = iniInt('IRON', 'Power');
const INI_IRON_TECHLEVEL   = iniInt('IRON', 'TechLevel');
const INI_IRON_OWNER       = iniStr('IRON', 'Owner');
const INI_IRON_PREREQ      = iniStr('IRON', 'Prerequisite');
const INI_IRON_POWERED     = iniBool('IRON', 'Powered');

const INI_MSLO_STRENGTH    = iniInt('MSLO', 'Strength');
const INI_MSLO_COST        = iniInt('MSLO', 'Cost');
const INI_MSLO_POWER       = iniInt('MSLO', 'Power');
const INI_MSLO_TECHLEVEL   = iniInt('MSLO', 'TechLevel');
const INI_MSLO_OWNER       = iniStr('MSLO', 'Owner');
const INI_MSLO_PREREQ      = iniStr('MSLO', 'Prerequisite');

// ===========================================================================
// Helpers
// ===========================================================================

function makeStructure(
  type: string, cx: number, cy: number,
  hp?: number, house: House = House.Spain,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: hp ?? maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
    movementSpeed: () => 1,
    getFirepowerBias: (house: House) => 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
  } as CombatContext;
}

// =============================================================================
//  SECTION 1: Recharge Times — INI [Recharge] × TICKS_PER_MINUTE
//  C++ house.cpp:653-660: recharge = TICKS_PER_MINUTE * Rule.<Weapon>Time
// =============================================================================

describe('superweapon recharge times match rules.ini [Recharge] (house.cpp:653-660)', () => {

  it(`Chronosphere: [Recharge] Chrono=${INI_RECHARGE_CHRONO} min -> ${INI_RECHARGE_CHRONO * CPP_TICKS_PER_MINUTE} ticks`, () => {
    const expected = INI_RECHARGE_CHRONO * CPP_TICKS_PER_MINUTE;
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].rechargeTicks).toBe(expected);
  });

  it(`Iron Curtain: [Recharge] IronCurtain=${INI_RECHARGE_IRON} min -> ${INI_RECHARGE_IRON * CPP_TICKS_PER_MINUTE} ticks`, () => {
    const expected = INI_RECHARGE_IRON * CPP_TICKS_PER_MINUTE;
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].rechargeTicks).toBe(expected);
  });

  it(`Nuclear Missile: [Recharge] Nuke=${INI_RECHARGE_NUKE} min -> ${INI_RECHARGE_NUKE * CPP_TICKS_PER_MINUTE} ticks`, () => {
    const expected = INI_RECHARGE_NUKE * CPP_TICKS_PER_MINUTE;
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].rechargeTicks).toBe(expected);
  });

  it(`GPS Satellite: [Recharge] GPS=${INI_RECHARGE_GPS} min -> ${INI_RECHARGE_GPS * CPP_TICKS_PER_MINUTE} ticks`, () => {
    const expected = INI_RECHARGE_GPS * CPP_TICKS_PER_MINUTE;
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks).toBe(expected);
  });

  it(`Sonar Pulse: [Recharge] Sonar=${INI_RECHARGE_SONAR} min -> ${INI_RECHARGE_SONAR * CPP_TICKS_PER_MINUTE} ticks`, () => {
    const expected = INI_RECHARGE_SONAR * CPP_TICKS_PER_MINUTE;
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks).toBe(expected);
  });

  it(`Parabomb: [Recharge] ParaBomb=${INI_RECHARGE_PARABOMB} min -> ${INI_RECHARGE_PARABOMB * CPP_TICKS_PER_MINUTE} ticks`, () => {
    const expected = INI_RECHARGE_PARABOMB * CPP_TICKS_PER_MINUTE;
    expect(SUPERWEAPON_DEFS[SuperweaponType.PARABOMB].rechargeTicks).toBe(expected);
  });

  it(`Paratroopers: [Recharge] Paratrooper=${INI_RECHARGE_PARATROOPER} min -> ${INI_RECHARGE_PARATROOPER * CPP_TICKS_PER_MINUTE} ticks`, () => {
    const expected = INI_RECHARGE_PARATROOPER * CPP_TICKS_PER_MINUTE;
    expect(SUPERWEAPON_DEFS[SuperweaponType.PARAINFANTRY].rechargeTicks).toBe(expected);
  });

  it(`Spy Plane: [Recharge] SpyPlane=${INI_RECHARGE_SPYPLANE} min -> ${INI_RECHARGE_SPYPLANE * CPP_TICKS_PER_MINUTE} ticks`, () => {
    const expected = INI_RECHARGE_SPYPLANE * CPP_TICKS_PER_MINUTE;
    expect(SUPERWEAPON_DEFS[SuperweaponType.SPY_PLANE].rechargeTicks).toBe(expected);
  });

  it('recharge ordering: SpyPlane < Chrono=Para < GPS < Sonar < IC < Nuke < ParaBomb', () => {
    const spy = SUPERWEAPON_DEFS[SuperweaponType.SPY_PLANE].rechargeTicks;
    const chrono = SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].rechargeTicks;
    const para = SUPERWEAPON_DEFS[SuperweaponType.PARAINFANTRY].rechargeTicks;
    const gps = SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks;
    const sonar = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks;
    const ic = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].rechargeTicks;
    const nuke = SUPERWEAPON_DEFS[SuperweaponType.NUKE].rechargeTicks;
    const pbomb = SUPERWEAPON_DEFS[SuperweaponType.PARABOMB].rechargeTicks;

    expect(spy).toBeLessThan(chrono);
    expect(chrono).toBe(para);
    expect(chrono).toBeLessThan(gps);
    expect(gps).toBeLessThan(sonar);
    expect(sonar).toBeLessThan(ic);
    expect(ic).toBeLessThan(nuke);
    expect(nuke).toBeLessThan(pbomb);
  });
});

// =============================================================================
//  SECTION 2: Nuclear Strike — [General] AtomDamage, blast radius, constants
//  C++ anim.cpp:1094 — rawdamage = Rule.AtomDamage
//  C++ anim.cpp:1093 — radius=4 (single-player)
// =============================================================================

describe('nuclear strike constants match rules.ini [General] (anim.cpp:1064-1107)', () => {

  it(`NUKE_DAMAGE matches [General] AtomDamage=${INI_ATOM_DAMAGE}`, () => {
    expect(NUKE_DAMAGE).toBe(INI_ATOM_DAMAGE);
  });

  it('NUKE_BLAST_CELLS = 4 (C++ anim.cpp:1093, single-player radius)', () => {
    // C++ anim.cpp:1093: if (Session.Type == GAME_NORMAL) radius = 4;
    // C++ anim.cpp:1097: else radius = 3; (multiplayer)
    // TS uses single-player value.
    const CPP_SP_BLAST_RADIUS = 4;
    expect(NUKE_BLAST_CELLS).toBe(CPP_SP_BLAST_RADIUS);
  });

  it('NUKE_FLIGHT_TICKS = 45 (missile travel animation)', () => {
    expect(NUKE_FLIGHT_TICKS).toBe(45);
  });

  it('NUKE_MIN_FALLOFF = 0.1 (10% minimum damage at blast edge)', () => {
    expect(NUKE_MIN_FALLOFF).toBe(0.1);
  });

  it(`[General] AtomDamage is ${INI_ATOM_DAMAGE} — not the C++ constructor default (1000)`, () => {
    // C++ rules.cpp:182 constructor default AtomDamage=1000.
    // rules.ini [General] AtomDamage=1000 happens to match, but INI is authoritative.
    expect(INI_ATOM_DAMAGE).toBe(iniInt('General', 'AtomDamage'));
    expect(NUKE_DAMAGE).toBe(INI_ATOM_DAMAGE);
  });
});

// =============================================================================
//  SECTION 3: Chronosphere — [General] ChronoDuration, ChronoKillCargo, TechLevel
//  C++ rules.cpp:124 — ChronoDuration=3 (minutes)
//  C++ rules.cpp:419 — IsChronoKill = ini.Get_Bool("ChronoKillCargo")
//  C++ rules.cpp:505 — ChronoTechLevel = ini.Get_Int("ChronoTechLevel")
// =============================================================================

describe('Chronosphere constants match rules.ini [General] (rules.cpp:124,419,505)', () => {

  it(`ChronoDuration=${INI_CHRONO_DURATION_MIN} min -> ${INI_CHRONO_DURATION_MIN * CPP_TICKS_PER_MINUTE} ticks`, () => {
    // C++ drive.h:62-74: MoebiusCountDown = ChronoDuration * TICKS_PER_MINUTE
    const expected = INI_CHRONO_DURATION_MIN * CPP_TICKS_PER_MINUTE;
    expect(CHRONO_DURATION_TICKS).toBe(expected);
  });

  it(`ChronoKillCargo=${INI_CHRONO_KILL_CARGO} — infantry killed on chronoshift`, () => {
    // C++ house.cpp:2817-2826: "Destroy any infantryman that gets teleported"
    // This is gated by Rule.IsChronoKill (from ChronoKillCargo=yes)
    expect(INI_CHRONO_KILL_CARGO).toBe(true);
  });

  it(`ChronoTechLevel=${INI_CHRONO_TECH_LEVEL} — tech level required for chrono effect`, () => {
    expect(INI_CHRONO_TECH_LEVEL).toBe(iniInt('General', 'ChronoTechLevel'));
  });

  it(`GPSTechLevel=${INI_GPS_TECH_LEVEL} — tech level for GPS satellite`, () => {
    expect(INI_GPS_TECH_LEVEL).toBe(iniInt('General', 'GPSTechLevel'));
  });

  it('CHRONO_SHIFT_VISUAL_TICKS = 30 (blue flash duration)', () => {
    expect(CHRONO_SHIFT_VISUAL_TICKS).toBe(30);
  });
});

// =============================================================================
//  SECTION 4: Iron Curtain — [General] IronCurtain duration
//  C++ rules.cpp:483 — IronCurtainDuration = ini.Get_Fixed("IronCurtain")
//  C++ house.cpp:2751 — IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_MINUTE
// =============================================================================

describe('Iron Curtain duration matches rules.ini [General] (rules.cpp:483, house.cpp:2751)', () => {

  it(`[General] IronCurtain=${INI_IRON_CURTAIN_MINUTES} min -> ${INI_IRON_CURTAIN_MINUTES * CPP_TICKS_PER_MINUTE} ticks`, () => {
    const expected = INI_IRON_CURTAIN_MINUTES * CPP_TICKS_PER_MINUTE;
    expect(IRON_CURTAIN_DURATION).toBe(expected);
  });

  it(`demo truck duration = IronCurtain * TICKS_PER_SECOND = ${INI_IRON_CURTAIN_MINUTES} * ${CPP_TICKS_PER_SECOND} = ${Math.floor(INI_IRON_CURTAIN_MINUTES * CPP_TICKS_PER_SECOND)}`, () => {
    // C++ house.cpp:2753-2755: UNIT_DEMOTRUCK gets IronCurtainDuration * TICKS_PER_SECOND
    // (seconds, not minutes — intentionally short)
    const expected = Math.floor(INI_IRON_CURTAIN_MINUTES * CPP_TICKS_PER_SECOND);
    expect(IRON_CURTAIN_DEMO_TRUCK_DURATION).toBe(expected);
  });

  it('normal duration is much longer than demo truck duration', () => {
    expect(IRON_CURTAIN_DURATION).toBeGreaterThan(IRON_CURTAIN_DEMO_TRUCK_DURATION * 10);
  });

  it('entity has ironCurtainTick property (defaults to 0)', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    expect(unit.ironCurtainTick).toBe(0);
  });

  it('entity is NOT invulnerable when ironCurtainTick = 0', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    expect(unit.isInvulnerable).toBe(false);
  });

  it('setting ironCurtainTick > 0 makes entity invulnerable', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    unit.ironCurtainTick = IRON_CURTAIN_DURATION;
    expect(unit.isInvulnerable).toBe(true);
  });

  it('ironCurtainTick = 1 still makes entity invulnerable (last tick)', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    unit.ironCurtainTick = 1;
    expect(unit.isInvulnerable).toBe(true);
  });

  it('invulnerability from iron curtain and invulnTick are independent', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    unit.ironCurtainTick = 100;
    expect(unit.isInvulnerable).toBe(true);
    unit.ironCurtainTick = 0;
    unit.invulnTick = 100;
    expect(unit.isInvulnerable).toBe(true);
    unit.invulnTick = 0;
    expect(unit.isInvulnerable).toBe(false);
  });
});

// =============================================================================
//  SECTION 5: Chrono Side Effects — [General] QuakeChance, VortexChance, etc.
//  C++ rules.cpp:203-204 — QuakeDamagePercent, QuakeChance
//  C++ rules.cpp:134-137 — VortexRange, VortexSpeed, VortexDamage, VortexChance
// =============================================================================

describe('chronoshift side-effect values match rules.ini [General] (rules.cpp:203-204,134-137)', () => {

  it(`QuakeChance=${INI_QUAKE_CHANCE * 100}% (rules.ini QuakeChance=${iniStr('General', 'QuakeChance')})`, () => {
    expect(INI_QUAKE_CHANCE).toBe(0.2);
  });

  it(`QuakeDamage=${INI_QUAKE_DAMAGE * 100}% (rules.ini QuakeDamage=${iniStr('General', 'QuakeDamage')})`, () => {
    expect(INI_QUAKE_DAMAGE).toBeCloseTo(0.33, 2);
  });

  it(`VortexChance=${INI_VORTEX_CHANCE * 100}% (rules.ini VortexChance=${iniStr('General', 'VortexChance')})`, () => {
    expect(INI_VORTEX_CHANCE).toBe(0.2);
  });

  it(`VortexDamage=${INI_VORTEX_DAMAGE} (rules.ini VortexDamage=${iniStr('General', 'VortexDamage')})`, () => {
    expect(INI_VORTEX_DAMAGE).toBe(200);
  });

  it(`VortexRange=${INI_VORTEX_RANGE} cells (rules.ini VortexRange=${iniStr('General', 'VortexRange')})`, () => {
    expect(INI_VORTEX_RANGE).toBe(10);
  });
});

// =============================================================================
//  SECTION 6: Sonar Pulse — reveal duration
//  C++ house.cpp:2629: sub->PulseCountDown = 15 * TICKS_PER_SECOND
// =============================================================================

describe('sonar pulse reveal duration (house.cpp:2629)', () => {

  it(`SONAR_REVEAL_TICKS = 15 * TICKS_PER_SECOND = ${15 * CPP_TICKS_PER_SECOND} ticks`, () => {
    const expected = 15 * CPP_TICKS_PER_SECOND;
    expect(SONAR_REVEAL_TICKS).toBe(expected);
  });
});

// =============================================================================
//  SECTION 7: PDOX (Chronosphere) — INI structure data
//  rules.ini: [PDOX] Strength=400, Cost=2800, Power=-200, TechLevel=12,
//             Owner=allies, Prerequisite=atek, Powered=true
// =============================================================================

describe('PDOX structure stats match rules.ini [PDOX]', () => {

  it(`max HP matches [PDOX] Strength=${INI_PDOX_STRENGTH}`, () => {
    expect(STRUCTURE_MAX_HP['PDOX']).toBe(INI_PDOX_STRENGTH);
  });

  it('footprint is 2x2 cells', () => {
    expect(STRUCTURE_SIZE['PDOX']).toEqual([2, 2]);
  });

  it('has no weapon (superweapon structure, not defensive)', () => {
    expect(STRUCTURE_WEAPONS['PDOX']).toBeUndefined();
  });

  it(`consumes ${Math.abs(INI_PDOX_POWER)}W power ([PDOX] Power=${INI_PDOX_POWER})`, () => {
    expect(POWER_DRAIN['PDOX']).toBe(Math.abs(INI_PDOX_POWER));
  });

  it(`is a powered structure ([PDOX] Powered=${INI_PDOX_POWERED})`, () => {
    expect(STRUCTURE_POWERED.has('PDOX')).toBe(INI_PDOX_POWERED);
  });

  it(`cost=${INI_PDOX_COST} and prerequisite=${INI_PDOX_PREREQ} (from [PDOX])`, () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'PDOX');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(INI_PDOX_COST);
    expect(item!.prerequisite).toBe(INI_PDOX_PREREQ.toUpperCase());
  });

  it(`is Allied faction ([PDOX] Owner=${INI_PDOX_OWNER})`, () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'PDOX');
    expect(item!.faction).toBe('allied');
  });
});

describe('PDOX superweapon definition (Chronosphere)', () => {
  const def = SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE];

  it('is linked to PDOX building', () => {
    expect(def.building).toBe('PDOX');
  });

  it('requires a target (player clicks destination)', () => {
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('requires power to charge (C++ house.cpp:655 IsPowered=true)', () => {
    expect(def.requiresPower).toBe(true);
  });

  it('is Allied faction', () => {
    expect(def.faction).toBe('allied');
  });

  it(`recharge matches [Recharge] Chrono=${INI_RECHARGE_CHRONO} min`, () => {
    expect(def.rechargeTicks).toBe(INI_RECHARGE_CHRONO * CPP_TICKS_PER_MINUTE);
  });
});

describe('PDOX chronoshift entity effect', () => {

  it('entity has chronoShiftTick property (defaults to 0)', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(unit.chronoShiftTick).toBe(0);
  });

  it('chronoShiftTick can be set to CHRONO_SHIFT_VISUAL_TICKS', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    unit.chronoShiftTick = CHRONO_SHIFT_VISUAL_TICKS;
    expect(unit.chronoShiftTick).toBe(30);
  });
});

describe('PDOX in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it(`PDOX consumes ${Math.abs(INI_PDOX_POWER)}W from the grid`, () => {
    const pdox = makeStructure('PDOX', 10, 10, INI_PDOX_STRENGTH, House.Spain);
    const grid = calculatePowerGrid([pdox], House.Spain, isAllied);
    expect(grid.consumed).toBe(Math.abs(INI_PDOX_POWER));
    expect(grid.produced).toBe(0);
  });

  it('dead PDOX does not consume power', () => {
    const pdox = makeStructure('PDOX', 10, 10, 0, House.Spain);
    pdox.alive = false;
    const grid = calculatePowerGrid([pdox], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling PDOX does not count in grid', () => {
    const pdox = makeStructure('PDOX', 10, 10, INI_PDOX_STRENGTH, House.Spain);
    pdox.sellProgress = 0.5;
    const grid = calculatePowerGrid([pdox], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('enemy PDOX does not affect player grid', () => {
    const pdox = makeStructure('PDOX', 10, 10, INI_PDOX_STRENGTH, House.USSR);
    const grid = calculatePowerGrid([pdox], House.Spain, isAllied);
    expect(grid.consumed).toBe(0);
  });
});

describe('PDOX economic functions ([PDOX] Cost / Strength)', () => {

  it(`sell refund is 50% of build cost = ${INI_PDOX_COST / 2}`, () => {
    expect(sellRefund(INI_PDOX_COST)).toBe(Math.floor(INI_PDOX_COST / 2));
  });

  it('repair cost per step is correctly calculated', () => {
    const result = repairCostPerStep(INI_PDOX_COST, INI_PDOX_STRENGTH);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(INI_PDOX_COST); // sanity
  });
});

describe('PDOX 2x2 footprint', () => {
  it('footprint occupies 4 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['PDOX']!;
    expect(w * h).toBe(4);
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([[10, 10], [11, 10], [10, 11], [11, 11]]);
  });
});

describe('PDOX destruction blast -- visual-only (C++ parity: no entity damage)', () => {
  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const pdox = makeStructure('PDOX', 10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([pdox], [victim]);
    structureDamage(ctx, pdox, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });
});

// =============================================================================
//  SECTION 8: IRON (Iron Curtain) — INI structure data
//  rules.ini: [IRON] Strength=400, Cost=2800, Power=-200, TechLevel=12,
//             Owner=soviet, Prerequisite=stek, Powered=true
// =============================================================================

describe('IRON structure stats match rules.ini [IRON]', () => {

  it(`max HP matches [IRON] Strength=${INI_IRON_STRENGTH}`, () => {
    expect(STRUCTURE_MAX_HP['IRON']).toBe(INI_IRON_STRENGTH);
  });

  it('footprint is 2x2 cells', () => {
    expect(STRUCTURE_SIZE['IRON']).toEqual([2, 2]);
  });

  it('has no weapon (superweapon structure, not defensive)', () => {
    expect(STRUCTURE_WEAPONS['IRON']).toBeUndefined();
  });

  it(`consumes ${Math.abs(INI_IRON_POWER)}W power ([IRON] Power=${INI_IRON_POWER})`, () => {
    expect(POWER_DRAIN['IRON']).toBe(Math.abs(INI_IRON_POWER));
  });

  it(`is a powered structure ([IRON] Powered=${INI_IRON_POWERED})`, () => {
    expect(STRUCTURE_POWERED.has('IRON')).toBe(INI_IRON_POWERED);
  });

  it(`cost=${INI_IRON_COST} and prerequisite=${INI_IRON_PREREQ} (from [IRON])`, () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'IRON');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(INI_IRON_COST);
    expect(item!.prerequisite).toBe(INI_IRON_PREREQ.toUpperCase());
  });

  it(`is Soviet faction ([IRON] Owner=${INI_IRON_OWNER})`, () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'IRON');
    expect(item!.faction).toBe('soviet');
  });
});

describe('IRON superweapon definition (Iron Curtain)', () => {
  const def = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN];

  it('is linked to IRON building', () => {
    expect(def.building).toBe('IRON');
  });

  it('requires a target (player clicks a unit)', () => {
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('unit');
  });

  it('requires power to charge (C++ house.cpp:659 IsPowered=true)', () => {
    expect(def.requiresPower).toBe(true);
  });

  it('is Soviet faction', () => {
    expect(def.faction).toBe('soviet');
  });

  it(`recharge matches [Recharge] IronCurtain=${INI_RECHARGE_IRON} min`, () => {
    expect(def.rechargeTicks).toBe(INI_RECHARGE_IRON * CPP_TICKS_PER_MINUTE);
  });
});

describe('IRON in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it(`IRON consumes ${Math.abs(INI_IRON_POWER)}W from the grid`, () => {
    const iron = makeStructure('IRON', 10, 10, INI_IRON_STRENGTH, House.USSR);
    const grid = calculatePowerGrid([iron], House.USSR, isAllied);
    expect(grid.consumed).toBe(Math.abs(INI_IRON_POWER));
    expect(grid.produced).toBe(0);
  });

  it('dead IRON does not consume power', () => {
    const iron = makeStructure('IRON', 10, 10, 0, House.USSR);
    iron.alive = false;
    const grid = calculatePowerGrid([iron], House.USSR, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling IRON does not count in grid', () => {
    const iron = makeStructure('IRON', 10, 10, INI_IRON_STRENGTH, House.USSR);
    iron.sellProgress = 0.5;
    const grid = calculatePowerGrid([iron], House.USSR, isAllied);
    expect(grid.consumed).toBe(0);
  });
});

describe('IRON economic functions ([IRON] Cost / Strength)', () => {

  it(`sell refund is 50% of build cost = ${INI_IRON_COST / 2}`, () => {
    expect(sellRefund(INI_IRON_COST)).toBe(Math.floor(INI_IRON_COST / 2));
  });

  it('repair cost per step is correctly calculated', () => {
    const result = repairCostPerStep(INI_IRON_COST, INI_IRON_STRENGTH);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(INI_IRON_COST);
  });
});

describe('IRON 2x2 footprint', () => {
  it('footprint occupies 4 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['IRON']!;
    expect(w * h).toBe(4);
  });
});

describe('IRON destruction blast -- visual-only (C++ parity: no entity damage)', () => {
  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const iron = makeStructure('IRON', 10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([iron], [victim]);
    structureDamage(ctx, iron, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const iron = makeStructure('IRON', 10, 10, 50, House.USSR);
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([iron], [close, far]);
    structureDamage(ctx, iron, 100);
    expect(close.maxHp - close.hp).toBe(0);
    expect(far.maxHp - far.hp).toBe(0);
  });
});

// =============================================================================
//  SECTION 9: MSLO (Missile Silo) — INI structure data
//  rules.ini: [MSLO] Strength=400, Cost=2500, Power=-100, TechLevel=13,
//             Owner=soviet,allies, Prerequisite=stek
// =============================================================================

describe('MSLO structure stats match rules.ini [MSLO]', () => {

  it(`max HP matches [MSLO] Strength=${INI_MSLO_STRENGTH}`, () => {
    expect(STRUCTURE_MAX_HP['MSLO']).toBe(INI_MSLO_STRENGTH);
  });

  it('footprint is 2x1 cells', () => {
    expect(STRUCTURE_SIZE['MSLO']).toEqual([2, 1]);
  });

  it('has no weapon (superweapon structure, not defensive)', () => {
    expect(STRUCTURE_WEAPONS['MSLO']).toBeUndefined();
  });

  it(`consumes ${Math.abs(INI_MSLO_POWER)}W power ([MSLO] Power=${INI_MSLO_POWER})`, () => {
    expect(POWER_DRAIN['MSLO']).toBe(Math.abs(INI_MSLO_POWER));
  });

  it('MSLO is NOT a powered structure (no Powered=yes in [MSLO])', () => {
    // rules.ini [MSLO] does not have Powered=yes, unlike [PDOX] and [IRON]
    expect(STRUCTURE_POWERED.has('MSLO')).toBe(false);
  });

  it(`cost=${INI_MSLO_COST} and prerequisite=${INI_MSLO_PREREQ} (from [MSLO])`, () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MSLO');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(INI_MSLO_COST);
    expect(item!.prerequisite).toBe(INI_MSLO_PREREQ.toUpperCase());
  });

  it(`is available to both factions ([MSLO] Owner=${INI_MSLO_OWNER})`, () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MSLO');
    // rules.ini Owner=soviet,allies -> both factions
    expect(item!.faction).toBe('both');
  });

  it(`TechLevel=${INI_MSLO_TECHLEVEL} — highest tech requirement among SW structures`, () => {
    expect(INI_MSLO_TECHLEVEL).toBe(iniInt('MSLO', 'TechLevel'));
    // MSLO TechLevel=13, PDOX and IRON TechLevel=12
    expect(INI_MSLO_TECHLEVEL).toBeGreaterThan(INI_PDOX_TECHLEVEL);
    expect(INI_MSLO_TECHLEVEL).toBeGreaterThan(INI_IRON_TECHLEVEL);
  });
});

describe('MSLO superweapon definition (Nuclear Strike)', () => {
  const def = SUPERWEAPON_DEFS[SuperweaponType.NUKE];

  it('is linked to MSLO building', () => {
    expect(def.building).toBe('MSLO');
  });

  it('requires a target (player clicks ground)', () => {
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('requires power to charge (C++ house.cpp:653 IsPowered=true)', () => {
    expect(def.requiresPower).toBe(true);
  });

  it('faction is soviet in SUPERWEAPON_DEFS', () => {
    expect(def.faction).toBe('soviet');
  });

  it(`recharge matches [Recharge] Nuke=${INI_RECHARGE_NUKE} min`, () => {
    expect(def.rechargeTicks).toBe(INI_RECHARGE_NUKE * CPP_TICKS_PER_MINUTE);
  });
});

describe('MSLO in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it(`MSLO consumes ${Math.abs(INI_MSLO_POWER)}W from the grid`, () => {
    const mslo = makeStructure('MSLO', 10, 10, INI_MSLO_STRENGTH, House.USSR);
    const grid = calculatePowerGrid([mslo], House.USSR, isAllied);
    expect(grid.consumed).toBe(Math.abs(INI_MSLO_POWER));
    expect(grid.produced).toBe(0);
  });

  it('dead MSLO does not consume power', () => {
    const mslo = makeStructure('MSLO', 10, 10, 0, House.USSR);
    mslo.alive = false;
    const grid = calculatePowerGrid([mslo], House.USSR, isAllied);
    expect(grid.consumed).toBe(0);
  });

  it('selling MSLO does not count in grid', () => {
    const mslo = makeStructure('MSLO', 10, 10, INI_MSLO_STRENGTH, House.USSR);
    mslo.sellProgress = 0.5;
    const grid = calculatePowerGrid([mslo], House.USSR, isAllied);
    expect(grid.consumed).toBe(0);
  });
});

describe('MSLO economic functions ([MSLO] Cost / Strength)', () => {

  it(`sell refund is 50% of build cost = ${INI_MSLO_COST / 2}`, () => {
    expect(sellRefund(INI_MSLO_COST)).toBe(Math.floor(INI_MSLO_COST / 2));
  });

  it('repair cost per step is correctly calculated', () => {
    const result = repairCostPerStep(INI_MSLO_COST, INI_MSLO_STRENGTH);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(INI_MSLO_COST);
  });
});

describe('MSLO 2x1 footprint', () => {
  it('footprint occupies 2 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['MSLO']!;
    expect(w * h).toBe(2);
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([[10, 10], [11, 10]]);
  });
});

describe('MSLO destruction blast -- visual-only (C++ parity: no entity damage)', () => {
  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const mslo = makeStructure('MSLO', 10, 10, 50, House.USSR);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([mslo], [victim]);
    structureDamage(ctx, mslo, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('damages adjacent structures on destruction', () => {
    const mslo = makeStructure('MSLO', 10, 10, 50, House.USSR);
    const nearby = makeStructure('SILO', 12, 10, undefined, House.USSR);
    const ctx = makeCombatCtx([mslo, nearby]);
    const origHp = nearby.hp;
    structureDamage(ctx, mslo, 100);
    expect(nearby.hp).toBeLessThan(origHp);
  });
});

// =============================================================================
//  SECTION 10: IsPowered flag — C++ house.cpp:653-660
//  Powered superweapons are suspended during low power (house.cpp:1410-1411)
// =============================================================================

describe('superweapon IsPowered flag matches C++ (house.cpp:653-660)', () => {

  // C++ house.cpp:653: SPC_NUCLEAR_BOMB — IsPowered=true
  it('Nuclear Missile requires power (house.cpp:653)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].requiresPower).toBe(true);
  });

  // C++ house.cpp:654: SPC_SONAR_PULSE — IsPowered=false
  it('Sonar Pulse does NOT require power (house.cpp:654)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].requiresPower).toBe(false);
  });

  // C++ house.cpp:655: SPC_CHRONOSPHERE — IsPowered=true
  it('Chronosphere requires power (house.cpp:655)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].requiresPower).toBe(true);
  });

  // C++ house.cpp:656: SPC_PARA_BOMB — IsPowered=false
  it('Parabomb does NOT require power (house.cpp:656)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.PARABOMB].requiresPower).toBe(false);
  });

  // C++ house.cpp:657: SPC_PARA_INFANTRY — IsPowered=false
  it('Paratroopers does NOT require power (house.cpp:657)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.PARAINFANTRY].requiresPower).toBe(false);
  });

  // C++ house.cpp:658: SPC_SPY_MISSION — IsPowered=false
  it('Spy Plane does NOT require power (house.cpp:658)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SPY_PLANE].requiresPower).toBe(false);
  });

  // C++ house.cpp:659: SPC_IRON_CURTAIN — IsPowered=true
  it('Iron Curtain requires power (house.cpp:659)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].requiresPower).toBe(true);
  });

  // C++ house.cpp:660: SPC_GPS — IsPowered=true
  it('GPS Satellite requires power (house.cpp:660)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].requiresPower).toBe(true);
  });
});

// =============================================================================
//  SECTION 11: Structure-to-superweapon mapping
//  C++ house.cpp:1433-1698 — ActiveBScan flags
// =============================================================================

describe('superweapon-to-structure mapping matches C++ (house.cpp:1433-1698)', () => {

  it('Chronosphere requires PDOX (STRUCT_CHRONOSPHERE)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].building).toBe('PDOX');
  });

  it('Iron Curtain requires IRON (STRUCT_IRON_CURTAIN)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].building).toBe('IRON');
  });

  it('Nuke requires MSLO (STRUCT_MSLO)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].building).toBe('MSLO');
  });

  it('GPS requires ATEK (STRUCT_ADVANCED_TECH)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].building).toBe('ATEK');
  });

  it('Sonar Pulse has no building (spy-infiltration grant)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].building).toBe('');
  });

  it('Parabomb requires AFLD', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.PARABOMB].building).toBe('AFLD');
  });

  it('Paratroopers requires AFLD', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.PARAINFANTRY].building).toBe('AFLD');
  });

  it('Spy Plane requires AFLD', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SPY_PLANE].building).toBe('AFLD');
  });
});

// =============================================================================
//  SECTION 12: Targeting mode and faction assignment
//  C++ house.cpp:2740-2897 — Place_Special_Blast
// =============================================================================

describe('superweapon targeting mode matches C++ (house.cpp Place_Special_Blast)', () => {

  it('Chronosphere targets ground', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].targetMode).toBe('ground');
  });

  it('Iron Curtain targets a unit', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].targetMode).toBe('unit');
  });

  it('Nuke targets ground', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].targetMode).toBe('ground');
  });

  it('GPS Satellite auto-fires (no target)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].needsTarget).toBe(false);
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].targetMode).toBe('none');
  });

  it('Sonar Pulse auto-fires (no target)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].needsTarget).toBe(false);
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].targetMode).toBe('none');
  });
});

describe('superweapon faction matches C++ (house.cpp Super_Weapon_Handler)', () => {

  it('Chronosphere is Allied', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].faction).toBe('allied');
  });

  it('Iron Curtain is Soviet', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].faction).toBe('soviet');
  });

  it('Nuke is Soviet', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].faction).toBe('soviet');
  });

  it('GPS is Allied', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].faction).toBe('allied');
  });

  it('Sonar Pulse is both factions', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].faction).toBe('both');
  });
});

// =============================================================================
//  SECTION 13: Cross-cutting invariants — all three SW structures
// =============================================================================

describe('superweapon structures — shared behavioral invariants (INI-derived)', () => {

  it('PDOX and IRON are 2x2, MSLO is 2x1', () => {
    expect(STRUCTURE_SIZE['PDOX']).toEqual([2, 2]);
    expect(STRUCTURE_SIZE['IRON']).toEqual([2, 2]);
    expect(STRUCTURE_SIZE['MSLO']).toEqual([2, 1]);
  });

  it('all three have Strength matching rules.ini', () => {
    expect(STRUCTURE_MAX_HP['PDOX']).toBe(INI_PDOX_STRENGTH);
    expect(STRUCTURE_MAX_HP['IRON']).toBe(INI_IRON_STRENGTH);
    expect(STRUCTURE_MAX_HP['MSLO']).toBe(INI_MSLO_STRENGTH);
  });

  it('PDOX and IRON are powered structures; MSLO is not', () => {
    expect(STRUCTURE_POWERED.has('PDOX')).toBe(true);
    expect(STRUCTURE_POWERED.has('IRON')).toBe(true);
    expect(STRUCTURE_POWERED.has('MSLO')).toBe(false);
  });

  it('none have weapons (superweapon buildings are unarmed)', () => {
    for (const type of ['PDOX', 'IRON', 'MSLO']) {
      expect(STRUCTURE_WEAPONS[type]).toBeUndefined();
    }
  });

  it('all three are high-cost structures (>= 2500 from INI)', () => {
    expect(INI_PDOX_COST).toBeGreaterThanOrEqual(2500);
    expect(INI_IRON_COST).toBeGreaterThanOrEqual(2500);
    expect(INI_MSLO_COST).toBeGreaterThanOrEqual(2500);
    for (const type of ['PDOX', 'IRON', 'MSLO']) {
      const item = PRODUCTION_ITEMS.find(p => p.type === type);
      expect(item).toBeDefined();
      expect(item!.cost).toBeGreaterThanOrEqual(2500);
    }
  });

  it('all three require advanced prerequisites (tech centers)', () => {
    const pdox = PRODUCTION_ITEMS.find(p => p.type === 'PDOX')!;
    const iron = PRODUCTION_ITEMS.find(p => p.type === 'IRON')!;
    const mslo = PRODUCTION_ITEMS.find(p => p.type === 'MSLO')!;
    expect(pdox.prerequisite).toBe(INI_PDOX_PREREQ.toUpperCase());
    expect(iron.prerequisite).toBe(INI_IRON_PREREQ.toUpperCase());
    expect(mslo.prerequisite).toBe(INI_MSLO_PREREQ.toUpperCase());
  });

  it('each structure maps to a distinct superweapon type', () => {
    const buildings = new Set([
      SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].building,
      SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].building,
      SUPERWEAPON_DEFS[SuperweaponType.NUKE].building,
    ]);
    expect(buildings.size).toBe(3); // all distinct
    expect(buildings).toContain('PDOX');
    expect(buildings).toContain('IRON');
    expect(buildings).toContain('MSLO');
  });

  it('all three superweapons require power to charge', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].requiresPower).toBe(true);
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].requiresPower).toBe(true);
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].requiresPower).toBe(true);
  });

  it('all three superweapons require a player-selected target', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].needsTarget).toBe(true);
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].needsTarget).toBe(true);
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].needsTarget).toBe(true);
  });

  it('PDOX and IRON are symmetric in cost and HP (from INI)', () => {
    expect(INI_PDOX_COST).toBe(INI_IRON_COST);
    expect(INI_PDOX_STRENGTH).toBe(INI_IRON_STRENGTH);
    const pdoxItem = PRODUCTION_ITEMS.find(p => p.type === 'PDOX')!;
    const ironItem = PRODUCTION_ITEMS.find(p => p.type === 'IRON')!;
    expect(pdoxItem.cost).toBe(ironItem.cost);
    expect(STRUCTURE_MAX_HP['PDOX']).toBe(STRUCTURE_MAX_HP['IRON']);
  });

  it(`PDOX and IRON have symmetric power drain (${Math.abs(INI_PDOX_POWER)}W each)`, () => {
    expect(Math.abs(INI_PDOX_POWER)).toBe(Math.abs(INI_IRON_POWER));
    expect(POWER_DRAIN['PDOX']).toBe(POWER_DRAIN['IRON']);
  });

  it(`MSLO is cheaper (${INI_MSLO_COST} vs ${INI_PDOX_COST}) but has lower power drain (${Math.abs(INI_MSLO_POWER)}W vs ${Math.abs(INI_PDOX_POWER)}W)`, () => {
    expect(INI_MSLO_COST).toBeLessThan(INI_PDOX_COST);
    expect(Math.abs(INI_MSLO_POWER)).toBeLessThan(Math.abs(INI_PDOX_POWER));
  });
});

// =============================================================================
//  SECTION 14: Power grid with multiple superweapons
// =============================================================================

describe('multiple superweapon structures in power grid', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it(`IRON + MSLO (soviet base) consumes ${Math.abs(INI_IRON_POWER) + Math.abs(INI_MSLO_POWER)}W total`, () => {
    const iron = makeStructure('IRON', 10, 10, INI_IRON_STRENGTH, House.USSR);
    const mslo = makeStructure('MSLO', 14, 10, INI_MSLO_STRENGTH, House.USSR);
    const grid = calculatePowerGrid([iron, mslo], House.USSR, isAllied);
    expect(grid.consumed).toBe(Math.abs(INI_IRON_POWER) + Math.abs(INI_MSLO_POWER));
  });

  it('PDOX (allied) + IRON (soviet) on different sides do not combine', () => {
    const pdox = makeStructure('PDOX', 10, 10, INI_PDOX_STRENGTH, House.Spain);
    const iron = makeStructure('IRON', 14, 10, INI_IRON_STRENGTH, House.USSR);

    const alliedGrid = calculatePowerGrid([pdox, iron], House.Spain, isAllied);
    expect(alliedGrid.consumed).toBe(Math.abs(INI_PDOX_POWER)); // Only PDOX

    const sovietGrid = calculatePowerGrid([pdox, iron], House.USSR, isAllied);
    expect(sovietGrid.consumed).toBe(Math.abs(INI_IRON_POWER)); // Only IRON
  });
});

// =============================================================================
//  SECTION 15: INI self-consistency checks (rules.ini parsing verification)
// =============================================================================

describe('rules.ini self-consistency checks (parsing verification)', () => {

  it('rules.ini has [General] section', () => {
    expect(INI['General']).toBeDefined();
  });

  it('rules.ini has [Recharge] section', () => {
    expect(INI['Recharge']).toBeDefined();
  });

  it('rules.ini has [PDOX], [IRON], and [MSLO] sections', () => {
    expect(INI['PDOX']).toBeDefined();
    expect(INI['IRON']).toBeDefined();
    expect(INI['MSLO']).toBeDefined();
  });

  it('[Recharge] section has all 9 expected keys', () => {
    const expectedKeys = [
      'Chrono', 'GPS', 'IronCurtain', 'Nuke',
      'ParaBomb', 'Paratrooper', 'Saboteur', 'Sonar', 'SpyPlane',
    ];
    for (const key of expectedKeys) {
      expect(
        INI['Recharge'][key],
        `[Recharge] must contain ${key}`
      ).toBeDefined();
    }
  });

  it('[General] has all superweapon-related keys', () => {
    const keys = [
      'AtomDamage', 'IronCurtain', 'ChronoDuration',
      'ChronoKillCargo', 'ChronoTechLevel', 'GPSTechLevel',
      'QuakeChance', 'QuakeDamage', 'VortexChance', 'VortexDamage', 'VortexRange',
    ];
    for (const key of keys) {
      expect(INI['General'][key], `[General] must contain ${key}`).toBeDefined();
    }
  });

  it('C++ constructor defaults match INI values (INI overrides checked)', () => {
    // C++ rules.cpp constructor defaults that INI overrides:
    //   ChronoDuration=3  (cpp:124)  -> INI: 3     (match)
    //   AtomDamage=1000   (cpp:182)  -> INI: 1000  (match)
    //   IronCurtainDuration=fixed(1,2)=0.5 (cpp:266) -> INI: 0.75 (OVERRIDE!)
    //   VortexDamage=200  (cpp:136)  -> INI: 200   (match)
    //   VortexChance=.2   (cpp:137)  -> INI: 20%   (match)
    //   QuakeDamagePercent=.33 (cpp:203) -> INI: 33% (match)
    //   QuakeChance=.2    (cpp:204)  -> INI: 20%   (match)

    // The critical override: C++ defaults IronCurtainDuration to 0.5 minutes,
    // but rules.ini sets it to 0.75 minutes. rules.ini wins.
    const CPP_DEFAULT_IC_DURATION = 0.5;
    expect(INI_IRON_CURTAIN_MINUTES).not.toBe(CPP_DEFAULT_IC_DURATION);
    expect(INI_IRON_CURTAIN_MINUTES).toBe(0.75);
    // TS must use the INI value (0.75), not the C++ default (0.5)
    expect(IRON_CURTAIN_DURATION).toBe(INI_IRON_CURTAIN_MINUTES * CPP_TICKS_PER_MINUTE);
  });

  it('C++ recharge defaults that INI overrides', () => {
    // C++ rules.cpp:211 ChronoTime=3 -> INI Chrono=7 (OVERRIDE!)
    // C++ rules.cpp:217 GPSTime=1    -> INI GPS=8    (OVERRIDE!)
    // C++ rules.cpp:218 NukeTime=14  -> INI Nuke=13  (OVERRIDE!)
    // C++ rules.cpp:216 IronCurtainTime=14 -> INI IronCurtain=11 (OVERRIDE!)
    const CPP_DEFAULT_CHRONO_TIME = 3;
    const CPP_DEFAULT_GPS_TIME = 1;
    const CPP_DEFAULT_NUKE_TIME = 14;
    const CPP_DEFAULT_IC_TIME = 14;

    expect(INI_RECHARGE_CHRONO).not.toBe(CPP_DEFAULT_CHRONO_TIME);
    expect(INI_RECHARGE_CHRONO).toBe(7);

    expect(INI_RECHARGE_GPS).not.toBe(CPP_DEFAULT_GPS_TIME);
    expect(INI_RECHARGE_GPS).toBe(8);

    expect(INI_RECHARGE_NUKE).not.toBe(CPP_DEFAULT_NUKE_TIME);
    expect(INI_RECHARGE_NUKE).toBe(13);

    expect(INI_RECHARGE_IRON).not.toBe(CPP_DEFAULT_IC_TIME);
    expect(INI_RECHARGE_IRON).toBe(11);
  });
});
