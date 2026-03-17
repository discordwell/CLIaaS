/**
 * C++ Behavioral Parity: Aircraft Combat
 *
 * Tests verify fixed-wing attack runs and AA targeting behavior match
 * C++ RA source code. Each describe block documents the C++ source
 * reference (file:line).
 *
 * Observable outcomes: HP changes, state transitions, ammo counts,
 * fire events, targeting decisions.
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
  updateFixedWingAttackRun,
  updateAircraft,
} from '../engine/aircraft';
import {
  type CombatContext,
  updateStructureCombat,
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

/** Place an entity at the center of a cell */
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
    ...overrides,
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

function makeDefenseStructure(
  type: string, house: House, cx: number, cy: number,
): MapStructure {
  const weapon = STRUCTURE_WEAPONS[type];
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: 256, maxHp: 256, alive: true, rubble: false,
    weapon,
    attackCooldown: 0,
    ammo: weapon ? 2 : -1,
    maxAmmo: weapon ? 2 : -1,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fixed-Wing Attack Run (aircraft.cpp Mission_Hunt)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fixed-wing facing requirement (aircraft.cpp FIRE_FACING)', () => {
  it('fires when facing is aligned with target (diff=0)', () => {
    const fireWeaponAt = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAt });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    // Target due North — default facing is N
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 3 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'dropBombs';
    yak.attackCooldown = 0;

    updateFixedWingAttackRun(ctx, yak);

    expect(fireWeaponAt).toHaveBeenCalled();
  });

  it('fires when facing is off by 1 direction (~45°)', () => {
    const fireWeaponAt = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAt });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target at NE — facing diff = 1
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200 + 3 * CELL_SIZE, 200 - 3 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'dropBombs';
    yak.attackCooldown = 0;

    updateFixedWingAttackRun(ctx, yak);

    expect(fireWeaponAt).toHaveBeenCalled();
  });

  it('does NOT fire when facing is off by 2+ directions (~90°+)', () => {
    const fireWeaponAt = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAt });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target due East — facing diff = 2
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200 + 3 * CELL_SIZE, 200);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'dropBombs';
    yak.attackCooldown = 0;

    updateFixedWingAttackRun(ctx, yak);

    expect(fireWeaponAt).not.toHaveBeenCalled();
  });

  it('keeps moving forward while waiting for facing alignment in flyToTarget', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target due South — facing diff = 4 (opposite direction)
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 + 2 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'flyToTarget';
    const posBefore = { ...yak.pos };

    updateFixedWingAttackRun(ctx, yak);

    // Aircraft must keep moving (fixed-wing can't stop)
    const moved = yak.pos.x !== posBefore.x || yak.pos.y !== posBefore.y;
    expect(moved).toBe(true);
    // Should still be in flyToTarget (facing not aligned yet)
    expect(yak.attackRunPhase).toBe('flyToTarget');
  });

  it('transitions from flyToTarget to dropBombs when facing aligns in range', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target due North, close enough to be in weapon range
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'flyToTarget';

    updateFixedWingAttackRun(ctx, yak);

    expect(yak.attackRunPhase).toBe('dropBombs');
  });
});

describe('Fixed-wing multi-shot per pass (aircraft.cpp continuous fire)', () => {
  it('fires multiple times across ticks in dropBombs phase (ChainGun ROF=3)', () => {
    const fireWeaponAt = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAt });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target far enough N that yak doesn't fly past in a few ticks
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 6 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'dropBombs';
    yak.attackCooldown = 0;

    // Simulate multiple ticks — should fire whenever cooldown expires
    let fireCount = 0;
    for (let tick = 0; tick < 20; tick++) {
      fireWeaponAt.mockClear();
      if (yak.attackCooldown > 0) yak.attackCooldown--;
      if (yak.attackRunPhase !== 'dropBombs') break;
      updateFixedWingAttackRun(ctx, yak);
      if (fireWeaponAt.mock.calls.length > 0) fireCount++;
    }

    // ChainGun ROF=3, so in 20 ticks should fire multiple times
    expect(fireCount).toBeGreaterThanOrEqual(3);
  });

  it('decrements ammo on each shot', () => {
    const fireWeaponAt = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAt });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 4 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'dropBombs';
    yak.attackCooldown = 0;
    const ammoBefore = yak.ammo;

    updateFixedWingAttackRun(ctx, yak);

    expect(yak.ammo).toBe(ammoBefore - 1);
  });

  it('transitions to regroup when ammo depleted mid-pass', () => {
    const fireWeaponAt = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAt });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 4 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'dropBombs';
    yak.attackCooldown = 0;
    yak.ammo = 1; // last shot

    updateFixedWingAttackRun(ctx, yak);

    // Should fire, then ammo=0 triggers regroup
    expect(fireWeaponAt).toHaveBeenCalled();
    expect(yak.ammo).toBe(0);
    expect(yak.attackRunPhase).toBe('regroup');
  });
});

describe('Fixed-wing anti-circle breaker (aircraft.cpp 2s delay)', () => {
  it('forces regroup after 30 ticks in range without facing alignment', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target due South — opposite direction, in range but can never align
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 + 2 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'flyToTarget';
    yak.circleBreakTimer = 0;

    // Simulate 31 ticks — hold facing fixed at N while target is S
    for (let i = 0; i < 31; i++) {
      yak.facing = Dir.N; // force-lock facing so alignment never happens
      // Keep enemy in range by repositioning
      const dist = worldDist(yak.pos, enemy.pos);
      if (dist > (yak.weapon?.range ?? 5)) {
        // Put enemy back in range
        enemy.pos.x = yak.pos.x;
        enemy.pos.y = yak.pos.y + 2 * CELL_SIZE;
      }
      if (yak.attackRunPhase !== 'flyToTarget') break;
      updateFixedWingAttackRun(ctx, yak);
    }

    expect(yak.attackRunPhase).toBe('regroup');
  });

  it('timer resets when aircraft leaves weapon range', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target far away — out of range
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 + 20 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'flyToTarget';
    yak.circleBreakTimer = 25; // almost triggering

    updateFixedWingAttackRun(ctx, yak);

    // Out of range → timer should reset to 0
    expect(yak.circleBreakTimer).toBe(0);
  });
});

describe('Fixed-wing regroup & re-engage (aircraft.cpp REGROUP)', () => {
  it('flies ~3 cells past target in regroup phase', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'regroup';

    // Run several ticks of regroup — should fly away from target
    for (let i = 0; i < 10; i++) {
      if (yak.attackRunPhase !== 'regroup') break;
      updateFixedWingAttackRun(ctx, yak);
    }

    // Should have moved further from target
    const dist = worldDist(yak.pos, enemy.pos);
    expect(dist).toBeGreaterThan(2); // moved past target
  });

  it('re-engages (flyToTarget) when ammo > 0 and target alive', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.ammo = 5;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'regroup';

    // Run until regroup completes
    for (let i = 0; i < 100; i++) {
      if (yak.attackRunPhase !== 'regroup') break;
      updateFixedWingAttackRun(ctx, yak);
    }

    expect(yak.attackRunPhase).toBe('flyToTarget');
  });

  it('RTBs when ammo = 0 after regroup', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.ammo = 0;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'regroup';

    for (let i = 0; i < 100; i++) {
      if (yak.aircraftState !== 'attacking') break;
      updateFixedWingAttackRun(ctx, yak);
    }

    expect(yak.aircraftState).toBe('returning');
    expect(yak.mission).toBe(Mission.GUARD);
  });

  it('RTBs when target dies during regroup', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.ammo = 5;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'regroup';

    // Kill target mid-regroup
    enemy.alive = false;

    for (let i = 0; i < 100; i++) {
      if (yak.aircraftState !== 'attacking') break;
      updateFixedWingAttackRun(ctx, yak);
    }

    expect(yak.aircraftState).toBe('returning');
  });

  it('target lost during flyToTarget → RTB', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.target = null;
    yak.targetStructure = null;
    yak.aircraftState = 'attacking';
    yak.attackRunPhase = 'flyToTarget';

    updateFixedWingAttackRun(ctx, yak);

    expect(yak.aircraftState).toBe('returning');
    expect(yak.mission).toBe(Mission.GUARD);
  });
});

describe('Both MiG and Yak use fixed-wing attack path', () => {
  it('MiG transitions through flyToTarget → dropBombs when aligned', () => {
    const ctx = makeAircraftCtx();
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200);
    mig.facing = Dir.N;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    mig.target = enemy;
    mig.aircraftState = 'attacking';
    mig.attackRunPhase = 'flyToTarget';

    updateFixedWingAttackRun(ctx, mig);

    expect(mig.attackRunPhase).toBe('dropBombs');
  });

  it('MiG and Yak both have isFixedWing = true', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    const yak = makeEntity(UnitType.V_YAK, House.USSR);
    expect(mig.isFixedWing).toBe(true);
    expect(yak.isFixedWing).toBe(true);
  });

  it('Helicopters do NOT use fixed-wing attack path', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    const hind = makeEntity(UnitType.V_HIND, House.USSR);
    expect(heli.isFixedWing).toBe(false);
    expect(hind.isFixedWing).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AA Targeting (combat.cpp, techno.cpp, building.cpp)
// ═══════════════════════════════════════════════════════════════════════════════
//
// C++ gate (building.cpp): non-AA structures skip airborne aircraft.
// AA structures (SAM, AGUN) can target airborne aircraft and prefer them.
// combat.cpp: IsAntiAir property on weapon controls targeting gate.

describe('Structure AA targeting (building.cpp AA gate)', () => {

  it('SAM fires at airborne aircraft', () => {
    const sam = makeDefenseStructure('SAM', House.USSR, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 11, 10);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE; // airborne
    const hpBefore = mig.hp;

    const ctx = makeCombatCtx([sam], [mig]);
    updateStructureCombat(ctx);

    expect(mig.hp).toBeLessThan(hpBefore);
  });

  it('AGUN fires at airborne aircraft', () => {
    const agun = makeDefenseStructure('AGUN', House.USSR, 10, 10);
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 11, 10);
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const hpBefore = heli.hp;

    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);

    expect(heli.hp).toBeLessThan(hpBefore);
  });

  it('GUN does NOT fire at airborne aircraft (no isAntiAir)', () => {
    const gun = makeDefenseStructure('GUN', House.USSR, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 11, 10);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const hpBefore = mig.hp;

    const ctx = makeCombatCtx([gun], [mig]);
    updateStructureCombat(ctx);

    expect(mig.hp).toBe(hpBefore); // GUN can't target airborne
  });

  it('PBOX does NOT fire at airborne aircraft (no isAntiAir)', () => {
    const pbox = makeDefenseStructure('PBOX', House.USSR, 10, 10);
    const hind = entityAtCell(UnitType.V_HIND, House.Spain, 11, 10);
    hind.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const hpBefore = hind.hp;

    const ctx = makeCombatCtx([pbox], [hind]);
    updateStructureCombat(ctx);

    expect(hind.hp).toBe(hpBefore); // PBOX can't target airborne
  });

  it('TSLA does NOT fire at airborne aircraft (no isAntiAir)', () => {
    const tsla = makeDefenseStructure('TSLA', House.USSR, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 11, 10);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const hpBefore = mig.hp;

    const ctx = makeCombatCtx([tsla], [mig]);
    updateStructureCombat(ctx);

    expect(mig.hp).toBe(hpBefore);
  });

  it('GUN fires at grounded aircraft (altitude=0, AA gate only checks altitude>0)', () => {
    const gun = makeDefenseStructure('GUN', House.USSR, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 11, 10);
    mig.flightAltitude = 0; // grounded
    const hpBefore = mig.hp;

    const ctx = makeCombatCtx([gun], [mig]);
    updateStructureCombat(ctx);

    expect(mig.hp).toBeLessThan(hpBefore); // GUN CAN target grounded aircraft
  });
});

describe('AA target preference (building.cpp AA override)', () => {
  it('SAM prefers airborne aircraft over ground units', () => {
    const sam = makeDefenseStructure('SAM', House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 11, 11);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;

    const tankHpBefore = tank.hp;
    const migHpBefore = mig.hp;
    const ctx = makeCombatCtx([sam], [tank, mig]);
    updateStructureCombat(ctx);

    // SAM should have targeted the airborne MiG, not the tank
    expect(mig.hp).toBeLessThan(migHpBefore);
    expect(tank.hp).toBe(tankHpBefore);
  });
});

describe('AA coverage of all aircraft types', () => {
  const aircraftTypes: [string, UnitType][] = [
    ['MiG (fixed-wing)', UnitType.V_MIG],
    ['Yak (fixed-wing)', UnitType.V_YAK],
    ['Longbow (helicopter)', UnitType.V_HELI],
    ['Hind (helicopter)', UnitType.V_HIND],
    ['Chinook (transport)', UnitType.V_TRAN],
  ];

  for (const [name, type] of aircraftTypes) {
    it(`SAM can target airborne ${name}`, () => {
      const sam = makeDefenseStructure('SAM', House.USSR, 10, 10);
      const aircraft = entityAtCell(type, House.Spain, 11, 10);
      aircraft.flightAltitude = Entity.FLIGHT_ALTITUDE;
      const hpBefore = aircraft.hp;

      const ctx = makeCombatCtx([sam], [aircraft]);
      updateStructureCombat(ctx);

      expect(aircraft.hp).toBeLessThan(hpBefore);
    });
  }

  for (const [name, type] of aircraftTypes) {
    it(`GUN cannot target airborne ${name}`, () => {
      const gun = makeDefenseStructure('GUN', House.USSR, 10, 10);
      const aircraft = entityAtCell(type, House.Spain, 11, 10);
      aircraft.flightAltitude = Entity.FLIGHT_ALTITUDE;
      const hpBefore = aircraft.hp;

      const ctx = makeCombatCtx([gun], [aircraft]);
      updateStructureCombat(ctx);

      expect(aircraft.hp).toBe(hpBefore);
    });
  }
});
