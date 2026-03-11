/**
 * Aircraft Behavioral Tests — calls exported functions from aircraft.ts
 * directly with mock contexts. No source-string pattern matching.
 *
 * Functions tested:
 *   - canTargetNaval(scanner, target) — pure function
 *   - getAircraftTargetPos(entity) — pure function
 *   - findLandingPad(ctx, entity)
 *   - updateAircraft(ctx, entity) — main state machine
 *   - updateFixedWingAttackRun(ctx, entity)
 *   - updateHelicopterAttack(ctx, entity)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, Mission, AnimState, CELL_SIZE, MAP_CELLS,
  UNIT_STATS, WEAPON_STATS, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds, CloakState } from '../engine/entity';
import { GameMap } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';

import {
  type AircraftContext,
  canTargetNaval,
  findLandingPad,
  getAircraftTargetPos,
  updateAircraft,
  updateFixedWingAttackRun,
  updateHelicopterAttack,
} from '../engine/aircraft';

beforeEach(() => resetEntityIds());

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeStructure(
  type: string, house: House, cx = 10, cy = 10,
  opts: Partial<MapStructure> = {},
): MapStructure {
  const maxHp = (opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256);
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: opts.hp ?? maxHp,
    maxHp,
    alive: opts.alive ?? true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...opts,
  } as MapStructure;
}

function makeAircraftContext(overrides: Partial<AircraftContext> = {}): AircraftContext {
  return {
    structures: [],
    map: new GameMap(),
    unitsLeftMap: 0,
    civiliansEvacuated: 0,
    isAllied: (a, b) => a === b,
    movementSpeed: () => 2,
    idleMission: () => Mission.GUARD,
    fireWeaponAt: vi.fn(),
    fireWeaponAtStructure: vi.fn(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. canTargetNaval — pure function (no context)
// ═══════════════════════════════════════════════════════════════════════════

describe('canTargetNaval', () => {
  it('returns true for valid naval target from destroyer', () => {
    const dd = makeEntity(UnitType.V_DD, House.Spain);
    const ss = makeEntity(UnitType.V_SS, House.USSR);
    // Submarine is uncloaked
    ss.cloakState = CloakState.UNCLOAKED;

    expect(canTargetNaval(dd, ss)).toBe(true);
  });

  it('returns false for cloaked submarine without antiSub weapon', () => {
    // Use a unit without isAntiSub weapons (e.g., a cruiser has 8Inch — not antiSub)
    const ca = makeEntity(UnitType.V_CA, House.Spain);
    const ss = makeEntity(UnitType.V_SS, House.USSR);
    ss.cloakState = CloakState.CLOAKED;

    expect(canTargetNaval(ca, ss)).toBe(false);
  });

  it('returns true for cloaked submarine when scanner has antiSub weapon', () => {
    const dd = makeEntity(UnitType.V_DD, House.Spain);
    const ss = makeEntity(UnitType.V_SS, House.USSR);
    ss.cloakState = CloakState.CLOAKED;

    // DD has DepthCharge (secondary) with isAntiSub
    expect(dd.weapon2?.isAntiSub).toBe(true);
    expect(canTargetNaval(dd, ss)).toBe(true);
  });

  it('returns false when cruiser tries to target infantry', () => {
    const ca = makeEntity(UnitType.V_CA, House.Spain);
    const inf = makeEntity(UnitType.I_E1, House.USSR);

    expect(canTargetNaval(ca, inf)).toBe(false);
  });

  it('returns false for torpedo-only unit targeting land unit', () => {
    const ss = makeEntity(UnitType.V_SS, House.USSR);
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);

    // Sub has TorpTube (isSubSurface) as primary, no secondary
    expect(ss.weapon?.isSubSurface).toBe(true);
    expect(ss.weapon2).toBeNull();
    expect(canTargetNaval(ss, tank)).toBe(false);
  });

  it('returns true for torpedo unit targeting naval unit', () => {
    const ss = makeEntity(UnitType.V_SS, House.USSR);
    const dd = makeEntity(UnitType.V_DD, House.Spain);

    // DD is a naval unit
    expect(dd.isNavalUnit).toBe(true);
    expect(canTargetNaval(ss, dd)).toBe(true);
  });

  it('returns false for cloaking (in-progress) submarine without antiSub', () => {
    const ca = makeEntity(UnitType.V_CA, House.Spain);
    const ss = makeEntity(UnitType.V_SS, House.USSR);
    ss.cloakState = CloakState.CLOAKING; // mid-transition

    expect(canTargetNaval(ca, ss)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. getAircraftTargetPos — pure function
// ═══════════════════════════════════════════════════════════════════════════

describe('getAircraftTargetPos', () => {
  it('returns entity position when target is an alive entity', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 400, 300);
    heli.target = enemy;

    const pos = getAircraftTargetPos(heli);

    expect(pos).not.toBeNull();
    expect(pos!.x).toBe(400);
    expect(pos!.y).toBe(300);
  });

  it('returns structure position when target is an alive structure', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    const struct = makeStructure('WEAP', House.USSR, 20, 20);
    heli.targetStructure = struct;

    const pos = getAircraftTargetPos(heli);

    expect(pos).not.toBeNull();
    // Structure target pos = cx * CELL_SIZE + CELL_SIZE, cy * CELL_SIZE + CELL_SIZE
    expect(pos!.x).toBe(20 * CELL_SIZE + CELL_SIZE);
    expect(pos!.y).toBe(20 * CELL_SIZE + CELL_SIZE);
  });

  it('returns null when no target assigned', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.target = null;
    heli.targetStructure = null;

    expect(getAircraftTargetPos(heli)).toBeNull();
  });

  it('returns null when target entity is dead', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 400, 300);
    enemy.alive = false;
    heli.target = enemy;

    expect(getAircraftTargetPos(heli)).toBeNull();
  });

  it('returns null when target structure is destroyed', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    const struct = makeStructure('WEAP', House.USSR, 20, 20, { alive: false });
    heli.targetStructure = struct;

    expect(getAircraftTargetPos(heli)).toBeNull();
  });

  it('prefers entity target over structure target', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 400, 300);
    const struct = makeStructure('WEAP', House.USSR, 20, 20);
    heli.target = enemy;
    heli.targetStructure = struct;

    const pos = getAircraftTargetPos(heli);
    expect(pos!.x).toBe(400);
    expect(pos!.y).toBe(300);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. findLandingPad
// ═══════════════════════════════════════════════════════════════════════════

describe('findLandingPad', () => {
  it('returns index of available helipad for helicopter', () => {
    const hpad = makeStructure('HPAD', House.Spain, 20, 20);
    const ctx = makeAircraftContext({ structures: [hpad] });
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);

    const idx = findLandingPad(ctx, heli);

    expect(idx).toBe(0);
  });

  it('returns -1 when no helipad available', () => {
    const ctx = makeAircraftContext({ structures: [] });
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);

    expect(findLandingPad(ctx, heli)).toBe(-1);
  });

  it('returns -1 when helipad is occupied', () => {
    const hpad = makeStructure('HPAD', House.Spain, 20, 20, { dockedAircraft: 42 } as any);
    const ctx = makeAircraftContext({ structures: [hpad] });
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);

    expect(findLandingPad(ctx, heli)).toBe(-1);
  });

  it('prefers closer helipad when multiple available', () => {
    const farPad = makeStructure('HPAD', House.Spain, 80, 80);
    const closePad = makeStructure('HPAD', House.Spain, 10, 10);
    const ctx = makeAircraftContext({ structures: [farPad, closePad] });
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 10 * CELL_SIZE, 10 * CELL_SIZE);

    const idx = findLandingPad(ctx, heli);

    expect(idx).toBe(1); // closePad is at index 1
  });

  it('skips enemy helipads', () => {
    const enemyPad = makeStructure('HPAD', House.USSR, 20, 20);
    const ctx = makeAircraftContext({ structures: [enemyPad] });
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);

    expect(findLandingPad(ctx, heli)).toBe(-1);
  });

  it('returns AFLD for fixed-wing aircraft', () => {
    const afld = makeStructure('AFLD', House.USSR, 20, 20);
    const ctx = makeAircraftContext({ structures: [afld] });
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200);

    const idx = findLandingPad(ctx, mig);

    expect(idx).toBe(0);
  });

  it('skips destroyed helipads', () => {
    const deadPad = makeStructure('HPAD', House.Spain, 20, 20, { alive: false });
    const ctx = makeAircraftContext({ structures: [deadPad] });
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);

    expect(findLandingPad(ctx, heli)).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. updateAircraft — main state machine
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAircraft — state machine', () => {
  it('returns false for non-aircraft entity', () => {
    const ctx = makeAircraftContext();
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);

    expect(updateAircraft(ctx, tank)).toBe(false);
  });

  it('landed aircraft stays landed when no orders', () => {
    const ctx = makeAircraftContext();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'landed';
    heli.flightAltitude = 0;
    heli.mission = Mission.GUARD;

    const result = updateAircraft(ctx, heli);

    expect(result).toBe(true);
    expect(heli.aircraftState).toBe('landed');
    expect(heli.flightAltitude).toBe(0);
    expect(heli.animState).toBe(AnimState.IDLE);
  });

  it('landed aircraft transitions to takeoff when given attack target', () => {
    const ctx = makeAircraftContext();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'landed';
    heli.mission = Mission.ATTACK;
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 400, 300);
    heli.target = enemy;

    const result = updateAircraft(ctx, heli);

    expect(result).toBe(true);
    expect(heli.aircraftState).toBe('takeoff');
  });

  it('landed aircraft transitions to takeoff when given move order', () => {
    const ctx = makeAircraftContext();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'landed';
    heli.mission = Mission.MOVE;
    heli.moveTarget = { x: 500, y: 500 };

    const result = updateAircraft(ctx, heli);

    expect(result).toBe(true);
    expect(heli.aircraftState).toBe('takeoff');
  });

  it('takeoff increases flight altitude until FLIGHT_ALTITUDE reached', () => {
    const ctx = makeAircraftContext();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = 0;
    heli.landedAtStructure = -1;

    // Run enough ticks to reach flight altitude
    for (let i = 0; i < Entity.FLIGHT_ALTITUDE; i++) {
      updateAircraft(ctx, heli);
    }

    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(heli.aircraftState).toBe('flying');
  });

  it('flying aircraft with attack target transitions to attacking when in range', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.mission = Mission.ATTACK;

    // Place target very close (within weapon range)
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 202, 200);
    heli.target = enemy;

    const ctx = makeAircraftContext();

    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('attacking');
  });

  it('flying aircraft returns to base when attack target is lost', () => {
    const ctx = makeAircraftContext();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'flying';
    heli.mission = Mission.ATTACK;
    heli.target = null; // target lost
    heli.targetStructure = null;

    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('returning');
  });

  it('aircraft in returning state seeks landing pad', () => {
    const hpad = makeStructure('HPAD', House.Spain, 20, 20);
    const ctx = makeAircraftContext({ structures: [hpad] });
    // Place helicopter far from pad
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 60 * CELL_SIZE, 60 * CELL_SIZE);
    heli.aircraftState = 'returning';
    heli.mission = Mission.GUARD;
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;

    updateAircraft(ctx, heli);

    // Should still be returning (flying toward pad, not yet arrived)
    expect(heli.aircraftState).toBe('returning');
    expect(heli.animState).toBe(AnimState.WALK);
  });

  it('aircraft reaching map edge with OOB target is removed', () => {
    const map = new GameMap();
    // Set tight bounds so we can easily reach the edge
    map.boundsX = 40;
    map.boundsY = 40;
    map.boundsW = 50;
    map.boundsH = 50;

    const ctx = makeAircraftContext({ map });

    // Place helicopter at map edge (boundsX)
    const edgeCx = 40;
    const edgeCy = 60;
    const heli = makeEntity(UnitType.V_HELI, House.Spain,
      edgeCx * CELL_SIZE + CELL_SIZE / 2, edgeCy * CELL_SIZE + CELL_SIZE / 2);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.mission = Mission.MOVE;
    // Target out of bounds
    heli.moveTarget = { x: 0, y: edgeCy * CELL_SIZE };

    const initialUnitsLeft = ctx.unitsLeftMap;
    updateAircraft(ctx, heli);

    expect(heli.alive).toBe(false);
    expect(ctx.unitsLeftMap).toBe(initialUnitsLeft + 1);
  });

  it('returning aircraft breaks out to flying when given new attack order', () => {
    const ctx = makeAircraftContext();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'returning';
    heli.mission = Mission.ATTACK;
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 400, 300);
    heli.target = enemy;

    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('flying');
  });

  it('decrementing attack cooldowns each tick for aircraft', () => {
    const ctx = makeAircraftContext();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'landed';
    heli.mission = Mission.GUARD;
    heli.attackCooldown = 5;
    heli.attackCooldown2 = 3;

    updateAircraft(ctx, heli);

    expect(heli.attackCooldown).toBe(4);
    expect(heli.attackCooldown2).toBe(2);
  });

  it('landing aircraft descends until altitude reaches 0', () => {
    const ctx = makeAircraftContext();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 3;
    heli.landedAtStructure = -1;
    // Set ammo to max so it goes to 'landed' not 'rearming'
    heli.ammo = heli.maxAmmo;

    // Tick 3 times to descend from 3 to 0
    updateAircraft(ctx, heli);
    expect(heli.flightAltitude).toBe(2);
    updateAircraft(ctx, heli);
    expect(heli.flightAltitude).toBe(1);
    updateAircraft(ctx, heli);
    expect(heli.flightAltitude).toBe(0);
    expect(heli.aircraftState).toBe('landed');
  });

  it('landing aircraft with depleted ammo transitions to rearming', () => {
    const ctx = makeAircraftContext();
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200);
    mig.aircraftState = 'landing';
    mig.flightAltitude = 1; // one tick to land
    mig.ammo = 0; // depleted
    mig.landedAtStructure = -1;

    updateAircraft(ctx, mig);

    expect(mig.flightAltitude).toBe(0);
    expect(mig.aircraftState).toBe('rearming');
  });

  it('rearming aircraft restores ammo over time then transitions to landed', () => {
    const ctx = makeAircraftContext();
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200);
    mig.aircraftState = 'rearming';
    mig.flightAltitude = 0;
    mig.ammo = mig.maxAmmo - 1; // one short
    mig.rearmTimer = 1; // about to finish

    updateAircraft(ctx, mig);

    expect(mig.ammo).toBe(mig.maxAmmo);
    expect(mig.aircraftState).toBe('landed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. updateFixedWingAttackRun
// ═══════════════════════════════════════════════════════════════════════════

describe('updateFixedWingAttackRun', () => {
  it('returns to base when target is lost', () => {
    const ctx = makeAircraftContext();
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200);
    mig.aircraftState = 'attacking';
    mig.target = null;
    mig.targetStructure = null;

    updateFixedWingAttackRun(ctx, mig);

    expect(mig.aircraftState).toBe('returning');
    expect(mig.mission).toBe(Mission.GUARD);
  });

  it('fires weapon when in range and cooldown ready', () => {
    const fireWeaponAt = vi.fn();
    const ctx = makeAircraftContext({ fireWeaponAt });
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 201, 200); // very close
    mig.target = enemy;
    mig.attackRunPhase = 'firing';
    mig.attackCooldown = 0;

    updateFixedWingAttackRun(ctx, mig);

    expect(fireWeaponAt).toHaveBeenCalledWith(mig, enemy, mig.weapon);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. updateHelicopterAttack
// ═══════════════════════════════════════════════════════════════════════════

describe('updateHelicopterAttack', () => {
  it('returns to base when target is lost', () => {
    const ctx = makeAircraftContext();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.target = null;
    heli.targetStructure = null;

    updateHelicopterAttack(ctx, heli);

    expect(heli.aircraftState).toBe('returning');
    expect(heli.mission).toBe(Mission.GUARD);
  });

  it('fires weapon when in range and cooldown ready', () => {
    const fireWeaponAt = vi.fn();
    const ctx = makeAircraftContext({ fireWeaponAt });
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 201, 200); // very close
    heli.target = enemy;
    heli.attackCooldown = 0;

    updateHelicopterAttack(ctx, heli);

    expect(fireWeaponAt).toHaveBeenCalledWith(heli, enemy, heli.weapon);
    expect(heli.animState).toBe(AnimState.ATTACK);
  });

  it('helicopter returns to base when out of ammo', () => {
    const ctx = makeAircraftContext({ fireWeaponAt: vi.fn() });
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 201, 200);
    heli.target = enemy;
    heli.attackCooldown = 0;
    heli.ammo = 1; // last round

    updateHelicopterAttack(ctx, heli);

    // After firing last round, ammo decremented to 0 -> RTB
    expect(heli.ammo).toBe(0);
    expect(heli.aircraftState).toBe('returning');
    expect(heli.target).toBeNull();
  });

  it('helicopter closes distance when out of weapon range', () => {
    const ctx = makeAircraftContext();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 1000, 1000); // far away
    heli.target = enemy;

    updateHelicopterAttack(ctx, heli);

    expect(heli.animState).toBe(AnimState.WALK);
    // Should have moved toward target (position changed)
    const dist = worldDist(heli.pos, enemy.pos);
    expect(dist).toBeLessThan(worldDist({ x: 200, y: 200 }, { x: 1000, y: 1000 }));
  });
});
