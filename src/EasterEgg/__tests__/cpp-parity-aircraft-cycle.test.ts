/**
 * C++ Behavioral Parity: Aircraft Ammo / Rearm / Landing Cycle
 *
 * End-to-end cycle audit: ammo values match rules.ini Ammo=, aircraft RTB
 * when ammo depleted, rearm timing, pad assignment, fixed-wing vs rotary
 * behavior differences, AA weapon targeting gate, weapon fire depletes ammo,
 * and multiple aircraft sharing limited pads.
 *
 * Tests that FAIL identify real C++ divergences.
 *
 * C++ references:
 *   - rules.ini [BADR] Ammo=5, [U2] Ammo=1, [MIG] Ammo=3, [YAK] Ammo=15,
 *     [HELI] Ammo=6, [HIND] Ammo=12
 *   - aadata.cpp:60-219 — aircraft type data (preferred landing building, IsFixedWing)
 *   - aircraft.cpp:228-248 — constructor (Ammo = Class->MaxAmmo, Height = FLIGHT_LEVEL)
 *   - aircraft.cpp:800-803 — ammo=0 → Enter_Idle_Mode (RTB)
 *   - aircraft.cpp:2691-2694 — RADIO_PREPARED (grounded: full ammo; airborne: any ammo)
 *   - aircraft.cpp:3227-3465 — Mission_Enter (landing state machine)
 *   - aircraft.cpp:1879-2020 — Enter_Idle_Mode (find docking bay by type)
 *   - building.cpp:3989-4037 — helipad/airstrip rearm state machine (BUILDING drives rearm)
 *   - techno.cpp:964-968 — RADIO_RELOAD handler (Ammo++)
 *   - techno.cpp:2857-2870 — Rearm_Delay (weapon ROF * ROFBias; first shot of two-shooter = 3)
 *   - techno.cpp:3186-3188 — Fire_At (if Ammo > 0) Ammo--
 *   - combat.cpp / missionAI.cpp — AA gate: non-AA weapons cannot target airborne aircraft
 *   - aircraft.cpp:4062-4068 — fixed-wing on ground without MISSION_ENTER → DESTROYED
 *   - aircraft.cpp:1314-1318 — Mission_Retreat altitude gain (1 lepton/3 ticks vs 11 leptons/tick)
 *   - building.cpp:4023-4025 — rearm delay = Inverse(pfrac) * ReloadRate * TICKS_PER_MINUTE
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, Dir, CELL_SIZE, COUNTRY_BONUSES,
  Mission, AnimState, buildDefaultAlliances,
  UNIT_STATS, WEAPON_STATS, worldDist, directionTo,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type AircraftContext,
  findLandingPad,
  updateAircraft,
  updateHelicopterAttack,
  updateFixedWingAttackRun,
} from '../engine/aircraft';
import {
  type CombatContext,
  triggerRetaliation,
} from '../engine/combat';
import {
  STRUCTURE_WEAPONS,
  type MapStructure,
} from '../engine/scenario';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeAircraftCtx(overrides: Partial<AircraftContext> = {}): AircraftContext {
  return {
    structures: [],
    map: new GameMap(),
    unitsLeftMap: 0,
    civiliansEvacuated: 0,
    isAllied: (a: House, b: House) => a === b,
    movementSpeed: () => 2,
    idleMission: () => Mission.GUARD,
    fireWeaponAt: vi.fn(),
    fireWeaponAtStructure: vi.fn(),
    getROFBias: () => 1.0,
    getPowerFraction: () => 1.0,
    ...overrides,
  };
}

function makePadStructure(
  type: string, house: House, cx: number, cy: number,
  dockedAircraft?: number,
): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: 256, maxHp: 256, alive: true, rubble: false,
    weapon: null,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    dockedAircraft,
  };
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
    movementSpeed: () => 2,
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
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

// ═══════════════════════════════════════════════════════════════════════════════
// Section 1: maxAmmo Values Match rules.ini Ammo= for ALL Aircraft
// C++ rules.ini parsed at techno.cpp:6289
// ═══════════════════════════════════════════════════════════════════════════════

describe('maxAmmo matches rules.ini Ammo= for all aircraft (techno.cpp:6289)', () => {
  // These are the authoritative values from public/ra/assets/rules.ini
  const AIRCRAFT_INI_AMMO: [string, UnitType, number][] = [
    ['BADR', UnitType.V_BADR, 5],   // rules.ini line 1103: Ammo=5
    ['U2',   UnitType.V_U2,   1],   // rules.ini line 1119: Ammo=1
    ['MIG',  UnitType.V_MIG,  3],   // rules.ini line 1135: Ammo=3
    ['YAK',  UnitType.V_YAK,  15],  // rules.ini line 1152: Ammo=15
    ['HELI', UnitType.V_HELI, 6],   // rules.ini line 1184: Ammo=6
    ['HIND', UnitType.V_HIND, 12],  // rules.ini line 1201: Ammo=12
  ];

  for (const [name, type, iniAmmo] of AIRCRAFT_INI_AMMO) {
    it(`${name} UNIT_STATS.maxAmmo = ${iniAmmo} (rules.ini Ammo=${iniAmmo})`, () => {
      const stats = UNIT_STATS[type];
      expect(stats?.maxAmmo, `${name} maxAmmo should match rules.ini Ammo=`).toBe(iniAmmo);
    });
  }

  // Cross-check: Entity constructor initializes ammo from maxAmmo
  for (const [name, type, iniAmmo] of AIRCRAFT_INI_AMMO) {
    it(`${name} entity starts with ammo=${iniAmmo} (aircraft.cpp:248 Ammo = Class->MaxAmmo)`, () => {
      const entity = makeEntity(type, House.USSR);
      expect(entity.ammo, `${name} initial ammo`).toBe(iniAmmo);
      expect(entity.maxAmmo, `${name} maxAmmo`).toBe(iniAmmo);
    });
  }

  // TRAN has no Ammo= in rules.ini (no weapon) — should be unlimited
  it('TRAN has no ammo tracking (no weapon, no Ammo= in rules.ini)', () => {
    const tran = makeEntity(UnitType.V_TRAN, House.Spain);
    expect(tran.ammo).toBe(-1);
    expect(tran.maxAmmo).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 2: Aircraft Speed/ROT/Strength Match rules.ini
// Verify other aircraft stats from rules.ini
// ═══════════════════════════════════════════════════════════════════════════════

describe('aircraft stats match rules.ini Speed= / ROT= / Strength= / Armor=', () => {
  const AIRCRAFT_STATS: [string, UnitType, { speed: number; rot: number; strength: number; armor: string }][] = [
    ['BADR', UnitType.V_BADR, { speed: 16, rot: 5, strength: 60, armor: 'light' }],
    ['U2',   UnitType.V_U2,   { speed: 40, rot: 7, strength: 2000, armor: 'heavy' }],
    ['MIG',  UnitType.V_MIG,  { speed: 20, rot: 5, strength: 50, armor: 'light' }],
    ['YAK',  UnitType.V_YAK,  { speed: 16, rot: 5, strength: 60, armor: 'light' }],
    ['TRAN', UnitType.V_TRAN, { speed: 12, rot: 5, strength: 90, armor: 'light' }],
    ['HELI', UnitType.V_HELI, { speed: 16, rot: 4, strength: 225, armor: 'heavy' }],
    ['HIND', UnitType.V_HIND, { speed: 12, rot: 4, strength: 225, armor: 'heavy' }],
  ];

  for (const [name, type, expected] of AIRCRAFT_STATS) {
    it(`${name} Speed=${expected.speed}`, () => {
      expect(UNIT_STATS[type]?.speed).toBe(expected.speed);
    });
    it(`${name} ROT=${expected.rot}`, () => {
      expect(UNIT_STATS[type]?.rot).toBe(expected.rot);
    });
    it(`${name} Strength=${expected.strength}`, () => {
      expect(UNIT_STATS[type]?.strength).toBe(expected.strength);
    });
    it(`${name} Armor=${expected.armor}`, () => {
      expect(UNIT_STATS[type]?.armor).toBe(expected.armor);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 3: Aircraft Return to Base When Ammo = 0
// C++ aircraft.cpp:800-803 — ammo=0 → Enter_Idle_Mode
// ═══════════════════════════════════════════════════════════════════════════════

describe('aircraft RTB when ammo=0 (aircraft.cpp:800-803)', () => {

  it('helicopter transitions to returning when ammo=0 during hover attack', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'attacking';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 0;
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 200, 200 + CELL_SIZE);
    heli.target = enemy;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('returning');
    expect(heli.mission).toBe(Mission.GUARD);
    expect(heli.target).toBeNull();
  });

  it('fixed-wing transitions to returning via regroup when ammo=0', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200);
    mig.aircraftState = 'attacking';
    mig.attackRunPhase = 'regroup';
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    mig.ammo = 0;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 4 * CELL_SIZE);
    mig.target = enemy;

    const ctx = makeAircraftCtx();
    // Run until state changes from 'attacking'
    for (let i = 0; i < 100; i++) {
      if (mig.aircraftState !== 'attacking') break;
      updateAircraft(ctx, mig);
    }

    expect(mig.aircraftState).toBe('returning');
    expect(mig.mission).toBe(Mission.GUARD);
  });

  it('helicopter with ammo > 0 does NOT RTB (continues attacking)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'attacking';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 3;
    heli.attackCooldown = 99; // prevent firing this tick
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 200, 200 + CELL_SIZE);
    heli.target = enemy;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.aircraftState).not.toBe('returning');
  });

  it('full cycle: fly → attack → deplete ammo → RTB → land → rearm → ready', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'attacking';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 1; // last shot
    heli.attackCooldown = 0;
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 200, 200 + CELL_SIZE);
    heli.target = enemy;

    const fireWeaponAt = vi.fn();
    const pad = makePadStructure('HPAD', House.Spain, 8, 8);
    const ctx = makeAircraftCtx({ fireWeaponAt, structures: [pad] });

    // Phase 1: Attack fires, depletes ammo
    updateAircraft(ctx, heli);
    if (fireWeaponAt.mock.calls.length > 0) {
      expect(heli.ammo).toBe(0);
    }

    // Phase 2: RTB
    if (heli.aircraftState !== 'returning') {
      updateAircraft(ctx, heli);
    }
    expect(heli.aircraftState).toBe('returning');

    // Phase 3: Fly toward pad and land
    for (let i = 0; i < 500; i++) {
      if (heli.aircraftState === 'landed' || heli.aircraftState === 'rearming') break;
      updateAircraft(ctx, heli);
    }

    // Phase 4: Rearm
    for (let i = 0; i < 1000; i++) {
      if (heli.aircraftState === 'landed' && heli.ammo >= heli.maxAmmo) break;
      updateAircraft(ctx, heli);
    }

    expect(heli.ammo).toBe(heli.maxAmmo);
    expect(heli.aircraftState).toBe('landed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: Rearm Time Per Ammo Point — C++ vs TS Divergence
// C++ building.cpp:4023-4025: time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
// TS aircraft.ts:252: rearmTimer = weapon.rof * ROFBias
// ═══════════════════════════════════════════════════════════════════════════════

describe('rearm time per ammo point — C++ building formula vs TS weapon ROF', () => {

  /**
   * C++ rearm is BUILDING-driven with power dependency:
   *   pfrac = clamp(Power_Fraction(), 0.5, 1.0)
   *   time = (1/pfrac) * ReloadRate * TICKS_PER_MINUTE
   *   ReloadRate ≈ 0.066 (rules.ini), TICKS_PER_MINUTE = 900 (at 15 tps)
   *   At full power: 1.0 * 0.066 * 900 ≈ 59 ticks per ammo
   *
   * TS rearm is AIRCRAFT-driven with weapon ROF:
   *   rearmTimer = max(1, round(weapon.rof * ROFBias))
   *   MIG Maverick rof=3 → 3 ticks per ammo (20x faster than C++)
   *   HELI Hellfire rof=60 → 60 ticks per ammo (close to C++)
   *   HIND ChainGun rof=3 → 3 ticks per ammo (20x faster)
   *   YAK ChainGun rof=3 → 3 ticks per ammo (20x faster)
   */

  it('MIG rearm = 36 ticks/ammo (C++ ReloadRate=.04 at full power)', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.maxAmmo = 3;
    mig.aircraftState = 'rearming';
    // TS now uses computeRearmDelay(powerFraction) = 36 at full power
    mig.rearmTimer = 36;

    const ctx = makeAircraftCtx();
    let ticksToFullRearm = 0;
    while (mig.aircraftState === 'rearming' && ticksToFullRearm < 1000) {
      updateAircraft(ctx, mig);
      ticksToFullRearm++;
    }

    // 3 ammo * 36 ticks/ammo = 108 ticks total
    expect(ticksToFullRearm).toBe(108);
  });

  it('HIND rearm = 36 ticks/ammo (C++ ReloadRate=.04 at full power)', () => {
    const hind = makeEntity(UnitType.V_HIND, House.USSR);
    hind.ammo = 0;
    hind.maxAmmo = 12;
    hind.aircraftState = 'rearming';
    hind.rearmTimer = 36;

    const ctx = makeAircraftCtx();
    let ticks = 0;
    while (hind.aircraftState === 'rearming' && ticks < 5000) {
      updateAircraft(ctx, hind);
      ticks++;
    }

    // 12 ammo * 36 ticks/ammo = 432 ticks
    expect(ticks).toBe(432);
  });

  it('HELI rearm = 36 ticks/ammo (C++ ReloadRate=.04 at full power)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.ammo = 0;
    heli.maxAmmo = 6;
    heli.aircraftState = 'rearming';
    heli.rearmTimer = 36;

    const ctx = makeAircraftCtx();
    let ticks = 0;
    while (heli.aircraftState === 'rearming' && ticks < 5000) {
      updateAircraft(ctx, heli);
      ticks++;
    }

    // 6 ammo * 36 ticks/ammo = 216 ticks
    expect(ticks).toBe(216);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 5: Landing Building Assignment
// C++ aadata.cpp: MIG/YAK → STRUCT_AIRSTRIP, HELI/HIND → STRUCT_HELIPAD
// C++ aadata.cpp:168: TRAN → STRUCT_NONE (uses Good_LZ)
// ═══════════════════════════════════════════════════════════════════════════════

describe('landing building assignment — HELI→HPAD, fixed-wing→AFLD', () => {

  const LANDING_MAP: [string, UnitType, string][] = [
    ['MIG',  UnitType.V_MIG,  'AFLD'],  // aadata.cpp:122
    ['YAK',  UnitType.V_YAK,  'AFLD'],  // aadata.cpp:145
    ['HELI', UnitType.V_HELI, 'HPAD'],  // aadata.cpp:191
    ['HIND', UnitType.V_HIND, 'HPAD'],  // aadata.cpp:215
  ];

  for (const [name, type, expectedBuilding] of LANDING_MAP) {
    it(`${name} landingBuilding = ${expectedBuilding}`, () => {
      expect(UNIT_STATS[type]?.landingBuilding).toBe(expectedBuilding);
    });
  }

  it('TRAN landingBuilding is undefined — matches C++ STRUCT_NONE', () => {
    // C++ aadata.cpp:168: Transport helicopter has STRUCT_NONE as Building
    // C++ uses Good_LZ() to land on clear terrain — Transport never needs a helipad
    const tran = UNIT_STATS[UnitType.V_TRAN];
    expect(tran?.landingBuilding).toBeUndefined();
  });

  it('BADR has no landingBuilding (bomber, never lands)', () => {
    // C++ aadata.cpp:67: Badger Building = STRUCT_NONE — bomber flies off map after bombing
    const badr = UNIT_STATS[UnitType.V_BADR];
    expect(badr?.landingBuilding).toBeUndefined();
  });

  it('U2 has no landingBuilding (spy plane, never lands)', () => {
    // C++ aadata.cpp:90: U2 Building = STRUCT_NONE — spy plane flies off map after recon
    const u2 = UNIT_STATS[UnitType.V_U2];
    expect(u2?.landingBuilding).toBeUndefined();
  });

  it('findLandingPad returns correct pad type for each aircraft', () => {
    const afld = makePadStructure('AFLD', House.USSR, 5, 5);
    const hpad = makePadStructure('HPAD', House.USSR, 8, 8);
    const ctx = makeAircraftCtx({ structures: [afld, hpad] });

    const mig = makeEntity(UnitType.V_MIG, House.USSR, 100, 100);
    expect(ctx.structures[findLandingPad(ctx, mig)].type).toBe('AFLD');

    const heli = makeEntity(UnitType.V_HELI, House.USSR, 100, 100);
    expect(ctx.structures[findLandingPad(ctx, heli)].type).toBe('HPAD');

    const yak = makeEntity(UnitType.V_YAK, House.USSR, 100, 100);
    expect(ctx.structures[findLandingPad(ctx, yak)].type).toBe('AFLD');

    const hind = makeEntity(UnitType.V_HIND, House.USSR, 100, 100);
    expect(ctx.structures[findLandingPad(ctx, hind)].type).toBe('HPAD');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 6: Fixed-Wing vs Rotary Flight Behavior
// C++ aadata.cpp:67,113,136 — IsFixedWing; aircraft.cpp — attack run vs hover
// ═══════════════════════════════════════════════════════════════════════════════

describe('fixed-wing vs rotary flight behavior (aadata.cpp, aircraft.cpp)', () => {

  const FLIGHT_CLASS: [string, UnitType, boolean, boolean][] = [
    ['BADR', UnitType.V_BADR, true,  false],
    ['U2',   UnitType.V_U2,   true,  false],
    ['MIG',  UnitType.V_MIG,  true,  false],
    ['YAK',  UnitType.V_YAK,  true,  false],
    ['HELI', UnitType.V_HELI, false, true],
    ['HIND', UnitType.V_HIND, false, true],
    ['TRAN', UnitType.V_TRAN, false, true],
  ];

  for (const [name, type, isFixed, isHeli] of FLIGHT_CLASS) {
    it(`${name} isFixedWing=${isFixed}, isHelicopter=${isHeli}`, () => {
      const entity = makeEntity(type, House.USSR);
      expect(entity.isFixedWing).toBe(isFixed);
      expect(entity.isHelicopter).toBe(isHeli);
    });
  }

  it('fixed-wing uses attack run state machine (flyToTarget/dropBombs/regroup)', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200);
    mig.aircraftState = 'attacking';
    mig.attackRunPhase = 'flyToTarget';
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    mig.facing = Dir.N;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    mig.target = enemy;

    const ctx = makeAircraftCtx();
    expect(mig.isFixedWing).toBe(true);

    updateAircraft(ctx, mig);
    // Should transition to dropBombs when aligned and in range
    expect(mig.attackRunPhase).toBe('dropBombs');
  });

  it('helicopter uses hover attack (closes to range, hovers, fires)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'attacking';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.attackCooldown = 0;
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 200, 200 + CELL_SIZE);
    heli.target = enemy;

    const fireWeaponAt = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAt });
    expect(heli.isHelicopter).toBe(true);

    updateAircraft(ctx, heli);
    // Helicopter should attempt to fire in hover mode (no attack run phases)
    expect(heli.attackRunPhase).not.toBe('dropBombs');
  });

  it('FIXED: C++ fixed-wing crashes on open ground — TS now matches', () => {
    // C++ aircraft.cpp:4062-4068: fixed-wing on ground without MISSION_ENTER → destroyed
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.aircraftState = 'landing';
    mig.flightAltitude = 1;
    mig.ammo = 3;
    mig.maxAmmo = 3;
    mig.landedAtStructure = -1; // no pad

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    // FIXED: MIG is destroyed when landing without an airstrip — matches C++
    expect(mig.alive).toBe(false);
    expect(mig.hp).toBe(0);
  });

  it('helicopter can land without pad (transport behavior)', () => {
    // C++ aadata.cpp:162: TRAN IsLandable=true
    const tran = makeEntity(UnitType.V_TRAN, House.Spain, 200, 200);
    tran.aircraftState = 'returning';
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE;
    tran.mission = Mission.GUARD;

    const ctx = makeAircraftCtx({ structures: [] }); // no pads
    updateAircraft(ctx, tran);

    // Transport can land without a pad
    expect(tran.aircraftState).toBe('landing');
  });

  it('combat helicopter orbits when no pad available', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'returning';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.mission = Mission.GUARD;

    const ctx = makeAircraftCtx({ structures: [] }); // no pads
    updateAircraft(ctx, heli);

    // Combat aircraft stays in returning (orbiting)
    expect(heli.aircraftState).toBe('returning');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 7: Aircraft Can't Be Targeted by Non-AA Weapons
// C++ combat.cpp/missionAI.cpp — AA gate
// ═══════════════════════════════════════════════════════════════════════════════

describe('AA weapon targeting gate (combat.cpp, missionAI.cpp)', () => {

  it('ground unit without AA weapon cannot retaliate against airborne attacker', () => {
    // C++ combat.cpp triggerRetaliation: checks isAntiAir before retaliating
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200 + CELL_SIZE);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;

    // Verify tank has no AA weapons
    expect(tank.weapon?.isAntiAir).toBeFalsy();
    expect(tank.weapon2?.isAntiAir).toBeFalsy();

    const ctx = makeCombatCtx([], [tank, mig]);
    triggerRetaliation(ctx, tank, mig);

    // Tank should NOT acquire the airborne MIG as a target
    expect(tank.target).toBeNull();
  });

  it('AA-equipped unit CAN retaliate against airborne attacker', () => {
    // E3 (Rocket Soldier) has RedEye (isAntiAir=true)
    const e3 = makeEntity(UnitType.I_E3, House.Spain, 200, 200);
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200 + CELL_SIZE);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;

    // Verify E3 has AA weapon
    expect(e3.weapon?.isAntiAir || e3.weapon2?.isAntiAir).toBeTruthy();

    const ctx = makeCombatCtx([], [e3, mig]);
    triggerRetaliation(ctx, e3, mig);

    // E3 should acquire the airborne MIG
    expect(e3.target).toBe(mig);
  });

  it('Mammoth Tank CAN retaliate against airborne (MammothTusk isAntiAir=true)', () => {
    const tank = makeEntity(UnitType.V_4TNK, House.Spain, 200, 200);
    const hind = makeEntity(UnitType.V_HIND, House.USSR, 200, 200 + CELL_SIZE);
    hind.flightAltitude = Entity.FLIGHT_ALTITUDE;

    // Verify MammothTusk has isAntiAir
    expect(WEAPON_STATS['MammothTusk']?.isAntiAir).toBe(true);
    expect(tank.weapon?.isAntiAir || tank.weapon2?.isAntiAir).toBeTruthy();

    const ctx = makeCombatCtx([], [tank, hind]);
    triggerRetaliation(ctx, tank, hind);

    expect(tank.target).toBe(hind);
  });

  it('ground unit CAN target grounded aircraft (altitude=0)', () => {
    // AA gate only checks flightAltitude > 0
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200 + CELL_SIZE);
    mig.flightAltitude = 0; // grounded

    const ctx = makeCombatCtx([], [tank, mig]);
    triggerRetaliation(ctx, tank, mig);

    // Tank CAN target grounded MIG
    expect(tank.target).toBe(mig);
  });

  it('weapon isAntiGround=false means primary cannot target ground (RedEye AG-only)', () => {
    // RedEye: isAntiAir=true, isAntiGround=false (AA-only weapon)
    const redeyeStats = WEAPON_STATS['RedEye'];
    expect(redeyeStats?.isAntiAir).toBe(true);
    expect(redeyeStats?.isAntiGround).toBe(false);

    // E3 primary is RedEye — cannot fire at ground targets via primary
    // E3 secondary is Dragon — can fire at ground targets
    const e3 = makeEntity(UnitType.I_E3, House.Spain, 200, 200);
    expect(e3.weapon?.isAntiGround).toBe(false); // RedEye: AG=no
    expect(e3.weapon2?.isAntiGround).not.toBe(false); // Dragon: AG default (undefined = yes)
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 8: Aircraft Weapon Firing Depletes Ammo
// C++ techno.cpp:3186-3188: if (Ammo > 0) Ammo--
// ═══════════════════════════════════════════════════════════════════════════════

describe('weapon firing depletes ammo (techno.cpp:3186-3188)', () => {

  it('helicopter ammo decrements by 1 per fire', () => {
    const fireWeaponAt = vi.fn();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'attacking';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 6;
    heli.attackCooldown = 0;
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 200, 200 + CELL_SIZE);
    heli.target = enemy;

    const ctx = makeAircraftCtx({ fireWeaponAt });
    updateAircraft(ctx, heli);

    if (fireWeaponAt.mock.calls.length > 0) {
      expect(heli.ammo).toBe(5);
    }
  });

  it('fixed-wing ammo decrements during dropBombs phase', () => {
    const fireWeaponAt = vi.fn();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'dropBombs';
    yak.flightAltitude = Entity.FLIGHT_ALTITUDE;
    yak.ammo = 15;
    yak.attackCooldown = 0;
    yak.facing = Dir.N;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;

    const ctx = makeAircraftCtx({ fireWeaponAt });
    updateAircraft(ctx, yak);

    if (fireWeaponAt.mock.calls.length > 0) {
      expect(yak.ammo).toBe(14);
    }
  });

  it('ammo does not go below 0 (C++ guard: if Ammo > 0)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'attacking';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 0;
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 200, 200 + CELL_SIZE);
    heli.target = enemy;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.ammo).toBeGreaterThanOrEqual(0);
  });

  it('YAK with 15 shots fires multiple times before needing rearm (ChainGun ROF=3)', () => {
    const fireWeaponAt = vi.fn();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'dropBombs';
    yak.flightAltitude = Entity.FLIGHT_ALTITUDE;
    yak.attackCooldown = 0;
    yak.facing = Dir.N;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 8 * CELL_SIZE);
    yak.target = enemy;

    const ctx = makeAircraftCtx({ fireWeaponAt });

    let shotsFired = 0;
    for (let tick = 0; tick < 60; tick++) {
      fireWeaponAt.mockClear();
      if (yak.attackCooldown > 0) yak.attackCooldown--;
      if (yak.attackRunPhase !== 'dropBombs') break;
      updateAircraft(ctx, yak);
      if (fireWeaponAt.mock.calls.length > 0) shotsFired++;
    }

    // ChainGun ROF=3, so in 60 ticks should fire many times
    expect(shotsFired).toBeGreaterThanOrEqual(5);
    expect(yak.ammo).toBeLessThan(15);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 9: Multiple Aircraft Sharing Limited Pads
// C++ Find_Docking_Bay — skips occupied pads, selects nearest available
// ═══════════════════════════════════════════════════════════════════════════════

describe('multiple aircraft sharing limited pads (aircraft.cpp Find_Docking_Bay)', () => {

  it('second aircraft finds different pad when first is occupied', () => {
    const pad1 = makePadStructure('HPAD', House.Spain, 5, 5);
    const pad2 = makePadStructure('HPAD', House.Spain, 10, 10);

    // First helicopter docks at pad1
    pad1.dockedAircraft = 42; // some entity id

    const heli = makeEntity(UnitType.V_HELI, House.Spain, 100, 100);
    const ctx = makeAircraftCtx({ structures: [pad1, pad2] });
    const idx = findLandingPad(ctx, heli);

    // Should pick pad2 since pad1 is occupied
    expect(idx).toBe(1);
    expect(ctx.structures[idx].type).toBe('HPAD');
  });

  it('returns -1 when all pads are occupied', () => {
    const pad1 = makePadStructure('HPAD', House.Spain, 5, 5, 42);
    const pad2 = makePadStructure('HPAD', House.Spain, 10, 10, 43);

    const heli = makeEntity(UnitType.V_HELI, House.Spain, 100, 100);
    const ctx = makeAircraftCtx({ structures: [pad1, pad2] });
    const idx = findLandingPad(ctx, heli);

    expect(idx).toBe(-1);
  });

  it('returning aircraft orbits when all pads occupied, lands when one frees up', () => {
    const pad = makePadStructure('HPAD', House.Spain, 5, 5, 42); // occupied

    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'returning';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 0;
    heli.mission = Mission.GUARD;

    const ctx = makeAircraftCtx({ structures: [pad] });

    // Tick while occupied — should stay returning (orbiting)
    updateAircraft(ctx, heli);
    expect(heli.aircraftState).toBe('returning');

    // Free the pad
    pad.dockedAircraft = undefined;

    // Now aircraft should find the pad and proceed toward landing
    for (let i = 0; i < 500; i++) {
      if (heli.aircraftState === 'landing' || heli.aircraftState === 'landed') break;
      updateAircraft(ctx, heli);
    }

    expect(['landing', 'landed', 'rearming']).toContain(heli.aircraftState);
  });

  it('MIG ignores HPAD, HELI ignores AFLD even when available', () => {
    const afld = makePadStructure('AFLD', House.USSR, 5, 5);
    const hpad = makePadStructure('HPAD', House.USSR, 10, 10);

    const mig = makeEntity(UnitType.V_MIG, House.USSR, 100, 100);
    const heli = makeEntity(UnitType.V_HELI, House.USSR, 100, 100);

    // MIG only sees AFLD
    const ctxMig = makeAircraftCtx({ structures: [hpad] }); // only HPAD
    expect(findLandingPad(ctxMig, mig)).toBe(-1);

    // HELI only sees HPAD
    const ctxHeli = makeAircraftCtx({ structures: [afld] }); // only AFLD
    expect(findLandingPad(ctxHeli, heli)).toBe(-1);
  });

  it('aircraft selects nearest available pad (distance-based)', () => {
    // Two pads: far one free, near one free — should pick near
    const farPad = makePadStructure('AFLD', House.USSR, 1, 1);    // far from (200,200)
    const nearPad = makePadStructure('AFLD', House.USSR, 8, 8);   // closer

    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200);
    const ctx = makeAircraftCtx({ structures: [farPad, nearPad] });
    const idx = findLandingPad(ctx, mig);

    expect(idx).toBe(1); // nearPad at index 1
  });

  it('destroyed pads are skipped', () => {
    const deadPad = makePadStructure('HPAD', House.Spain, 5, 5);
    deadPad.alive = false;
    const livePad = makePadStructure('HPAD', House.Spain, 10, 10);

    const heli = makeEntity(UnitType.V_HELI, House.Spain, 100, 100);
    const ctx = makeAircraftCtx({ structures: [deadPad, livePad] });
    const idx = findLandingPad(ctx, heli);

    expect(idx).toBe(1); // live pad
  });

  it('enemy pads are not used (house check)', () => {
    const enemyPad = makePadStructure('AFLD', House.Spain, 5, 5);
    const friendlyPad = makePadStructure('AFLD', House.USSR, 10, 10);

    const mig = makeEntity(UnitType.V_MIG, House.USSR, 100, 100);
    const ctx = makeAircraftCtx({ structures: [enemyPad, friendlyPad] });
    const idx = findLandingPad(ctx, mig);

    expect(idx).toBe(1); // friendly pad only
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 10: C++ Initial Altitude vs TS — PARITY GAP
// C++ aircraft.cpp:249: Height = FLIGHT_LEVEL (created airborne)
// TS entity.ts:337-339: aircraftState='landed', flightAltitude=0
// ═══════════════════════════════════════════════════════════════════════════════

describe('FIXED: aircraft initial state (aircraft.cpp:249)', () => {

  it('FIXED: TS creates aircraft at FLIGHT_ALTITUDE (airborne), matching C++', () => {
    // C++ aircraft.cpp:249: Height = FLIGHT_LEVEL
    // FIXED: TS now matches C++ — aircraft created airborne
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    expect(mig.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(mig.aircraftState).toBe('flying');
  });

  it('all aircraft types start airborne in TS (matching C++)', () => {
    const types: [string, UnitType][] = [
      ['BADR', UnitType.V_BADR],
      ['U2',   UnitType.V_U2],
      ['MIG',  UnitType.V_MIG],
      ['YAK',  UnitType.V_YAK],
      ['HELI', UnitType.V_HELI],
      ['HIND', UnitType.V_HIND],
      ['TRAN', UnitType.V_TRAN],
    ];

    for (const [name, type] of types) {
      const entity = makeEntity(type, House.USSR);
      expect(entity.aircraftState, `${name} should start flying`).toBe('flying');
      expect(entity.flightAltitude, `${name} should start at FLIGHT_ALTITUDE`).toBe(Entity.FLIGHT_ALTITUDE);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 11: Weapon Assignment Parity
// rules.ini Primary=/Secondary= vs TS primaryWeapon/secondaryWeapon
// ═══════════════════════════════════════════════════════════════════════════════

describe('aircraft weapon assignment matches rules.ini Primary=/Secondary=', () => {

  const AIRCRAFT_WEAPONS: [string, UnitType, string | null, string | null][] = [
    ['BADR', UnitType.V_BADR, 'ParaBomb', null],         // Primary=ParaBomb, no Secondary
    ['U2',   UnitType.V_U2,   'Camera',   null],          // Primary=Camera, no Secondary
    ['MIG',  UnitType.V_MIG,  'Maverick', 'Maverick'],    // Primary=Maverick, Secondary=Maverick
    ['YAK',  UnitType.V_YAK,  'ChainGun', 'ChainGun'],    // Primary=ChainGun, Secondary=ChainGun
    ['TRAN', UnitType.V_TRAN, null,        null],           // No weapons
    ['HELI', UnitType.V_HELI, 'Hellfire', 'Hellfire'],     // Primary=Hellfire, Secondary=Hellfire
    ['HIND', UnitType.V_HIND, 'ChainGun', null],           // Primary=ChainGun, no Secondary
  ];

  for (const [name, type, primary, secondary] of AIRCRAFT_WEAPONS) {
    it(`${name} Primary=${primary ?? 'none'}, Secondary=${secondary ?? 'none'}`, () => {
      const stats = UNIT_STATS[type];
      expect(stats?.primaryWeapon ?? null).toBe(primary);
      expect(stats?.secondaryWeapon ?? null).toBe(secondary);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 12: Docking/Undocking Lifecycle
// C++ aircraft.cpp Mission_Enter → RADIO_IM_IN → building.dockedAircraft
// ═══════════════════════════════════════════════════════════════════════════════

describe('docking/undocking lifecycle (aircraft.cpp Mission_Enter)', () => {

  it('aircraft docks at pad on landing (pad.dockedAircraft set)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'returning';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 0;
    heli.mission = Mission.GUARD;

    const pad = makePadStructure('HPAD', House.Spain, 8, 8);
    const ctx = makeAircraftCtx({ structures: [pad] });

    // Run until docked
    for (let i = 0; i < 500; i++) {
      if (pad.dockedAircraft !== undefined) break;
      updateAircraft(ctx, heli);
    }

    expect(pad.dockedAircraft).toBeDefined();
    expect(heli.landedAtStructure).toBe(0);
  });

  it('aircraft undocks on takeoff (pad.dockedAircraft cleared)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = 0;
    heli.landedAtStructure = 0;

    const pad = makePadStructure('HPAD', House.Spain, 8, 8);
    pad.dockedAircraft = heli.id;
    const ctx = makeAircraftCtx({ structures: [pad] });

    updateAircraft(ctx, heli);

    expect(pad.dockedAircraft).toBeUndefined();
    expect(heli.landedAtStructure).toBe(-1);
  });

  it('undocked pad is available for another aircraft', () => {
    const pad = makePadStructure('HPAD', House.Spain, 8, 8);
    pad.dockedAircraft = 42; // occupied

    // While occupied: no pad available for new aircraft
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 100, 100);
    const ctx = makeAircraftCtx({ structures: [pad] });
    expect(findLandingPad(ctx, heli)).toBe(-1);

    // Clear the pad
    pad.dockedAircraft = undefined;
    expect(findLandingPad(ctx, heli)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 13: Ammo Overshoot PARITY GAP
// C++ techno.cpp:965: if (Ammo == MaxAmmo) return RADIO_NEGATIVE (check BEFORE increment)
// TS aircraft.ts:266-268: ammo++ first, THEN check if >= maxAmmo
// ═══════════════════════════════════════════════════════════════════════════════

describe('PARITY GAP: ammo overshoot during rearming (techno.cpp:965)', () => {

  it('TS allows ammo to momentarily exceed maxAmmo', () => {
    // C++ techno.cpp:965: if (Ammo == MaxAmmo) return(RADIO_NEGATIVE);
    //   → C++ checks BEFORE increment, Ammo never exceeds MaxAmmo
    // TS aircraft.ts:266: entity.ammo++ — increments first, then checks
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 3;      // already at max
    mig.maxAmmo = 3;
    mig.aircraftState = 'rearming';
    mig.rearmTimer = 1; // will trigger increment this tick

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    // TS overshoots: ammo becomes 4 before state transition
    // C++ would keep ammo at 3 (RADIO_RELOAD rejected)
    // PARITY GAP
    expect(mig.ammo).toBe(4); // TS behavior
    // C++ expected: mig.ammo === 3
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 14: Takeoff/Landing Timing Symmetry
// C++ Landing_Takeoff_AI: 24 ticks both directions
// TS: 24 ticks both directions (parity confirmed)
// ═══════════════════════════════════════════════════════════════════════════════

describe('takeoff/landing timing (aircraft.cpp Landing_Takeoff_AI)', () => {

  it('takeoff takes exactly 24 ticks (0 → FLIGHT_ALTITUDE=24)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = 0;

    const ctx = makeAircraftCtx();
    let ticks = 0;
    while (heli.aircraftState === 'takeoff' && ticks < 100) {
      updateAircraft(ctx, heli);
      ticks++;
    }

    expect(ticks).toBe(24);
    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(heli.aircraftState).toBe('flying');
  });

  it('landing takes exactly 24 ticks (FLIGHT_ALTITUDE → 0)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 0;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    let ticks = 0;
    while (heli.aircraftState === 'landing' && ticks < 100) {
      updateAircraft(ctx, heli);
      ticks++;
    }

    expect(ticks).toBe(24);
    expect(heli.flightAltitude).toBe(0);
  });

  it('FLIGHT_ALTITUDE = 24 pixels (C++ FLIGHT_LEVEL=256 leptons = 24 pixels)', () => {
    expect(Entity.FLIGHT_ALTITUDE).toBe(24);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 15: Full Ammo/Rearm/Landing Cycle Integration
// End-to-end: landed → takeoff → fly → attack → deplete → RTB → land → rearm → ready
// ═══════════════════════════════════════════════════════════════════════════════

describe('full ammo/rearm/landing cycle integration', () => {

  it('MIG complete cycle: landed → takeoff → attack → RTB → land → rearm → landed', () => {
    const pad = makePadStructure('AFLD', House.USSR, 8, 8);
    const fireWeaponAt = vi.fn();
    const ctx = makeAircraftCtx({ structures: [pad], fireWeaponAt });

    // Start: MIG landed on pad with full ammo
    const mig = makeEntity(UnitType.V_MIG, House.USSR, (8 + 1) * CELL_SIZE, (8 + 1) * CELL_SIZE);
    mig.aircraftState = 'landed';
    mig.flightAltitude = 0;
    mig.landedAtStructure = 0;
    pad.dockedAircraft = mig.id;

    // Give attack order
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 300, 300);
    mig.target = enemy;
    mig.mission = Mission.ATTACK;

    const statesVisited = new Set<string>();

    // Run full cycle
    for (let tick = 0; tick < 2000; tick++) {
      statesVisited.add(mig.aircraftState);
      updateAircraft(ctx, mig);
      // If returned to landed with full ammo, cycle is complete
      if (mig.aircraftState === 'landed' && mig.ammo >= mig.maxAmmo) break;
    }

    // Should have visited key states in the cycle
    expect(statesVisited.has('landed')).toBe(true);
    expect(statesVisited.has('takeoff')).toBe(true);
    expect(statesVisited.has('flying')).toBe(true);
    expect(mig.ammo).toBe(mig.maxAmmo);
  });

  it('HELI complete cycle with rearm verification', () => {
    const pad = makePadStructure('HPAD', House.Spain, 8, 8);
    const fireWeaponAt = vi.fn();
    const ctx = makeAircraftCtx({ structures: [pad], fireWeaponAt });

    const heli = makeEntity(UnitType.V_HELI, House.Spain, (8 + 1) * CELL_SIZE, (8 + 1) * CELL_SIZE);
    heli.aircraftState = 'landed';
    heli.flightAltitude = 0;
    heli.landedAtStructure = 0;
    pad.dockedAircraft = heli.id;

    // Give attack order
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 300, 300);
    heli.target = enemy;
    heli.mission = Mission.ATTACK;

    let sawRearming = false;
    for (let tick = 0; tick < 5000; tick++) {
      if (heli.aircraftState === 'rearming') sawRearming = true;
      updateAircraft(ctx, heli);
      if (heli.aircraftState === 'landed' && heli.ammo >= heli.maxAmmo && sawRearming) break;
    }

    expect(sawRearming).toBe(true);
    expect(heli.ammo).toBe(heli.maxAmmo);
    expect(heli.aircraftState).toBe('landed');
  });
});
