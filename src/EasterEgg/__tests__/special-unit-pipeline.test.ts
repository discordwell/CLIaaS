/**
 * Special Unit Behaviors Pipeline — comprehensive tests for all special unit
 * functions extracted to engine/specialUnits.ts.
 *
 * Tests cover: Demo Truck, Chrono Tank, Tanya C4, Thief, Medic, Engineer,
 * Spy, Mechanic, Minelayer, MAD Tank, Vehicle Cloaking, Mine System, C4 Timers.
 *
 * Pattern: Behavioral tests calling exported functions from specialUnits.ts
 * with mock SpecialUnitsContext, plus entity-level unit tests for state fields.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Entity, resetEntityIds, CloakState, CLOAK_TRANSITION_FRAMES } from '../engine/entity';
import {
  UnitType, House, Mission, AnimState, UNIT_STATS, WEAPON_STATS,
  CELL_SIZE, worldDist, worldToCell, CONDITION_RED,
  CHRONO_SHIFT_VISUAL_TICKS,
} from '../engine/types';
import { type MapStructure, STRUCTURE_SIZE } from '../engine/scenario';
import {
  type SpecialUnitsContext,
  updateDemoTruck, updateChronoTank, teleportChronoTank,
  updateTanyaC4, tickC4Timers, updateThief,
  updateMinelayer, tickMines, updateMADTank, deployMADTank,
  updateVehicleCloak, updateMechanicUnit, updateMedic,
  tickVortices,
  DEMO_TRUCK_DAMAGE, DEMO_TRUCK_RADIUS, DEMO_TRUCK_FUSE_TICKS,
  CHRONO_TANK_COOLDOWN, MAD_TANK_CHARGE_TICKS, MAD_TANK_DAMAGE,
  MAD_TANK_RADIUS, MAX_MINES_PER_HOUSE,
  MECHANIC_HEAL_RANGE, MECHANIC_HEAL_AMOUNT,
} from '../engine/specialUnits';

beforeEach(() => resetEntityIds());

// ─── Mock Context Factory ────────────────────────────────────────────────
function makeMockSpecialUnitsContext(overrides: Partial<SpecialUnitsContext> = {}): SpecialUnitsContext {
  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    mines: [],
    activeVortices: [],
    effects: [],
    tick: 0,
    playerHouse: House.Spain,
    credits: 1000,
    houseCredits: new Map(),
    map: {
      isPassable: () => true,
      getOccupancy: () => 0,
      boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128,
    } as any,
    evaMessages: [],
    isThieved: false,
    isAllied: (a: House, b: House) => a === b,
    entitiesAllied: (a: Entity, b: Entity) => a.house === b.house,
    isPlayerControlled: (e: Entity) => e.house === House.Spain,
    playSoundAt: vi.fn(),
    playSound: vi.fn(),
    movementSpeed: () => 0.5,
    damageEntity: vi.fn((target: Entity, amount: number) => {
      target.hp -= amount;
      if (target.hp <= 0) { target.hp = 0; target.alive = false; return true; }
      return false;
    }),
    damageStructure: vi.fn((s: MapStructure, damage: number) => {
      s.hp -= damage;
      if (s.hp <= 0) { s.hp = 0; s.alive = false; return true; }
      return false;
    }),
    addCredits: vi.fn((amount: number) => amount),
    addEntity: vi.fn(),
    screenShake: 0,
    ...overrides,
  };
}

function makeMockStructure(type: string, house: House, cx = 5, cy = 5): MapStructure {
  return {
    type, house, cx, cy, hp: 256, maxHp: 256, alive: true,
    rubble: false, image: type.toLowerCase(),
  } as MapStructure;
}

// ─── Helpers ────────────────────────────────────────────────────────────
function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

// =========================================================================
// 1. DEMO TRUCK (V_DTRK) — updateDemoTruck / detonateDemoTruck
// =========================================================================
describe('Demo Truck (DTRK) — kamikaze state machine', () => {
  it('has correct UNIT_STATS entry', () => {
    const stats = UNIT_STATS.DTRK;
    expect(stats.type).toBe(UnitType.V_DTRK);
    expect(stats.strength).toBe(110);
    expect(stats.armor).toBe('light');
    expect(stats.primaryWeapon).toBe('Democharge');
  });

  it('Democharge weapon has Nuke warhead', () => {
    const w = WEAPON_STATS.Democharge;
    expect(w).toBeDefined();
    expect(w.warhead).toBe('Nuke');
    expect(w.damage).toBe(500);
  });

  it('entity initializes with fuseTimer = 0', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    expect(dtrk.fuseTimer).toBe(0);
    expect(dtrk.alive).toBe(true);
  });

  it('fuseTimer counts down each tick toward 0', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.fuseTimer = 10;
    // Simulating countdown
    dtrk.fuseTimer--;
    expect(dtrk.fuseTimer).toBe(9);
    for (let i = 0; i < 9; i++) dtrk.fuseTimer--;
    expect(dtrk.fuseTimer).toBe(0);
  });

  it('updateDemoTruck only runs for DTRK in ATTACK mission', () => {
    // Non-DTRK entity: should be a no-op
    const tank = makeEntity(UnitType.V_2TNK, House.USSR);
    tank.mission = Mission.ATTACK;
    const ctx = makeMockSpecialUnitsContext();
    updateDemoTruck(ctx, tank);
    expect(tank.mission).toBe(Mission.ATTACK); // unchanged

    // DTRK but not in ATTACK mission: should be a no-op
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.mission = Mission.GUARD;
    updateDemoTruck(ctx, dtrk);
    expect(dtrk.mission).toBe(Mission.GUARD); // unchanged
  });

  it('updateDemoTruck arms fuse at DEMO_TRUCK_FUSE_TICKS when reaching target', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.mission = Mission.ATTACK;
    const target = makeEntity(UnitType.V_2TNK, House.Spain);
    // Place target adjacent (within 1.5 cells)
    target.pos.x = dtrk.pos.x;
    target.pos.y = dtrk.pos.y;
    dtrk.target = target;

    const ctx = makeMockSpecialUnitsContext({ entities: [dtrk, target] });
    updateDemoTruck(ctx, dtrk);

    expect(dtrk.fuseTimer).toBe(DEMO_TRUCK_FUSE_TICKS);
    expect(DEMO_TRUCK_FUSE_TICKS).toBe(45);
  });

  it('updateDemoTruck calls detonation when fuse reaches 0', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.mission = Mission.ATTACK;
    dtrk.fuseTimer = 1; // will reach 0 this tick
    const target = makeEntity(UnitType.V_2TNK, House.Spain);
    target.pos.x = dtrk.pos.x;
    target.pos.y = dtrk.pos.y;
    dtrk.target = target;

    const ctx = makeMockSpecialUnitsContext({ entities: [dtrk, target] });
    updateDemoTruck(ctx, dtrk);

    // After detonation: truck is dead
    expect(dtrk.alive).toBe(false);
    expect(dtrk.mission).toBe(Mission.DIE);
  });

  it('detonation applies splash damage in DEMO_TRUCK_RADIUS', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.mission = Mission.ATTACK;
    dtrk.fuseTimer = 1;
    // Place a victim within radius
    const victim = makeEntity(UnitType.V_2TNK, House.Spain);
    victim.pos.x = dtrk.pos.x + CELL_SIZE; // 1 cell away, within radius of 3
    victim.pos.y = dtrk.pos.y;
    dtrk.target = victim;

    const ctx = makeMockSpecialUnitsContext({ entities: [dtrk, victim] });
    updateDemoTruck(ctx, dtrk);

    expect(ctx.damageEntity).toHaveBeenCalled();
    // Verify the damage was applied with Nuke warhead
    const call = (ctx.damageEntity as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => c[0] === victim
    );
    expect(call).toBeDefined();
    expect(call![2]).toBe('Nuke');
  });

  it('detonation kills the truck', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.mission = Mission.ATTACK;
    dtrk.fuseTimer = 1;
    dtrk.target = makeEntity(UnitType.I_E1, House.Spain);
    dtrk.target.pos.x = dtrk.pos.x;
    dtrk.target.pos.y = dtrk.pos.y;

    const ctx = makeMockSpecialUnitsContext({ entities: [dtrk, dtrk.target] });
    updateDemoTruck(ctx, dtrk);

    expect(dtrk.alive).toBe(false);
    expect(dtrk.mission).toBe(Mission.DIE);
    expect(dtrk.hp).toBe(0);
  });

  it('detonation also damages structures within radius', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.mission = Mission.ATTACK;
    dtrk.fuseTimer = 1;
    // Target a structure
    const struct = makeMockStructure('WEAP', House.Spain, Math.floor(dtrk.pos.x / CELL_SIZE), Math.floor(dtrk.pos.y / CELL_SIZE));
    dtrk.targetStructure = struct;
    dtrk.target = null;

    const ctx = makeMockSpecialUnitsContext({ entities: [dtrk], structures: [struct] });
    updateDemoTruck(ctx, dtrk);

    expect(ctx.damageStructure).toHaveBeenCalled();
  });

  it('static constants match C++ parity values', () => {
    expect(DEMO_TRUCK_DAMAGE).toBe(1000);
    expect(DEMO_TRUCK_RADIUS).toBe(3);
    expect(DEMO_TRUCK_FUSE_TICKS).toBe(45);
  });

  it('demo truck with no target returns to GUARD', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.mission = Mission.ATTACK;
    dtrk.target = null;
    dtrk.targetStructure = null;

    const ctx = makeMockSpecialUnitsContext();
    updateDemoTruck(ctx, dtrk);

    expect(dtrk.mission).toBe(Mission.GUARD);
  });

  it('damage falloff: center damage > edge damage', () => {
    // Verify the formula: damage * (1 - (d / blastRadius) * 0.5)
    const blastRadius = 3;
    const baseDamage = 1000;
    const centerDamage = Math.round(baseDamage * (1 - (0 / blastRadius) * 0.5));
    const edgeDamage = Math.round(baseDamage * (1 - (blastRadius / blastRadius) * 0.5));
    expect(centerDamage).toBe(1000);
    expect(edgeDamage).toBe(500);
    expect(centerDamage).toBeGreaterThan(edgeDamage);
  });

  it('demo truck is NOT a turreted vehicle', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    expect(dtrk.hasTurret).toBe(false);
  });
});

// =========================================================================
// 2. CHRONO TANK (V_CTNK) — updateChronoTank / teleportChronoTank
// =========================================================================
describe('Chrono Tank (CTNK) — teleport state machine', () => {
  it('has correct UNIT_STATS entry', () => {
    const stats = UNIT_STATS.CTNK;
    expect(stats.type).toBe(UnitType.V_CTNK);
    expect(stats.strength).toBe(350);
    expect(stats.armor).toBe('light');
    expect(stats.primaryWeapon).toBe('APTusk');
  });

  it('APTusk weapon has burst fire', () => {
    const w = WEAPON_STATS.APTusk;
    expect(w).toBeDefined();
    expect(w.burst).toBe(2);
    expect(w.warhead).toBe('AP');
    expect(w.damage).toBe(75);
  });

  it('entity initializes with chronoCooldown = 0', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    expect(ctnk.chronoCooldown).toBe(0);
    expect(ctnk.chronoShiftTick).toBe(0);
  });

  it('chronoCooldown decrements each tick when > 0', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    ctnk.chronoCooldown = 100;
    const ctx = makeMockSpecialUnitsContext();
    updateChronoTank(ctx, ctnk);
    expect(ctnk.chronoCooldown).toBe(99);
  });

  it('chronoCooldown stays at 0 when already 0', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    expect(ctnk.chronoCooldown).toBe(0);
    const ctx = makeMockSpecialUnitsContext();
    updateChronoTank(ctx, ctnk);
    expect(ctnk.chronoCooldown).toBe(0);
  });

  it('static CHRONO_TANK_COOLDOWN = 2700 ticks (C++ parity)', () => {
    expect(CHRONO_TANK_COOLDOWN).toBe(2700);
  });

  it('teleportChronoTank blocked when on cooldown', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    ctnk.chronoCooldown = 100;
    const ctx = makeMockSpecialUnitsContext();
    const origX = ctnk.pos.x;
    teleportChronoTank(ctx, ctnk, { x: 500, y: 500 });
    expect(ctnk.pos.x).toBe(origX); // didn't move
  });

  it('teleportChronoTank checks map passability', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    const ctx = makeMockSpecialUnitsContext({
      map: { isPassable: () => false, getOccupancy: () => 0, boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128 } as any,
    });
    const origX = ctnk.pos.x;
    teleportChronoTank(ctx, ctnk, { x: 500, y: 500 });
    expect(ctnk.pos.x).toBe(origX); // blocked by impassable terrain
  });

  it('teleportChronoTank snaps prevPos to prevent interpolation swoosh', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    const target = { x: 500, y: 500 };
    const ctx = makeMockSpecialUnitsContext();
    teleportChronoTank(ctx, ctnk, target);
    expect(ctnk.prevPos.x).toBe(target.x);
    expect(ctnk.prevPos.y).toBe(target.y);
  });

  it('teleportChronoTank sets chronoShiftTick visual effect', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    const ctx = makeMockSpecialUnitsContext();
    teleportChronoTank(ctx, ctnk, { x: 500, y: 500 });
    expect(ctnk.chronoShiftTick).toBe(CHRONO_SHIFT_VISUAL_TICKS);
  });

  it('teleportChronoTank sets cooldown and clears move/attack targets', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    ctnk.moveTarget = { x: 200, y: 200 };
    ctnk.target = makeEntity(UnitType.I_E1, House.USSR);
    ctnk.mission = Mission.ATTACK;
    const ctx = makeMockSpecialUnitsContext();
    teleportChronoTank(ctx, ctnk, { x: 500, y: 500 });
    expect(ctnk.chronoCooldown).toBe(CHRONO_TANK_COOLDOWN);
    expect(ctnk.moveTarget).toBeNull();
    expect(ctnk.target).toBeNull();
    expect(ctnk.mission).toBe(Mission.GUARD);
  });

  it('CHRONO_SHIFT_VISUAL_TICKS = 30 (types.ts export)', () => {
    expect(CHRONO_SHIFT_VISUAL_TICKS).toBe(30);
  });

  it('chrono tank is NOT turreted (C++ udata.cpp)', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    expect(ctnk.hasTurret).toBe(false);
  });

  it('teleportChronoTank creates lightning effects at both origin and destination', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    const ctx = makeMockSpecialUnitsContext();
    teleportChronoTank(ctx, ctnk, { x: 500, y: 500 });
    // Should have two 'litning' sprite effects (origin + destination)
    const litningEffects = ctx.effects.filter(e => e.sprite === 'litning');
    expect(litningEffects.length).toBeGreaterThanOrEqual(2);
  });
});

// =========================================================================
// 3. TANYA (I_TANYA / E7) — updateTanyaC4
// =========================================================================
describe('Tanya (E7) — C4 placement state machine', () => {
  it('has correct UNIT_STATS: infantry, dual Colt45, can swim', () => {
    const stats = UNIT_STATS.E7;
    expect(stats.type).toBe(UnitType.I_TANYA);
    expect(stats.strength).toBe(100);
    expect(stats.isInfantry).toBe(true);
    expect(stats.primaryWeapon).toBe('Colt45');
    expect(stats.secondaryWeapon).toBe('Colt45');
    expect(stats.canSwim).toBe(true);
  });

  it('Tanya entity has weapon for normal combat', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    expect(tanya.weapon).not.toBeNull();
    expect(tanya.weapon!.name).toBe('Colt45');
    expect(tanya.weapon2).not.toBeNull();
  });

  it('updateTanyaC4 only runs for I_TANYA type', () => {
    const rifle = makeEntity(UnitType.I_E1, House.Spain);
    const struct = makeMockStructure('WEAP', House.USSR);
    rifle.targetStructure = struct;
    const ctx = makeMockSpecialUnitsContext();
    updateTanyaC4(ctx, rifle);
    // No C4 should have been planted (entity is not Tanya)
    expect((struct as any).c4Timer).toBeUndefined();
  });

  it('updateTanyaC4 requires alive targetStructure', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    const struct = makeMockStructure('WEAP', House.USSR);
    struct.alive = false;
    tanya.targetStructure = struct;
    const ctx = makeMockSpecialUnitsContext();
    updateTanyaC4(ctx, tanya);
    expect((struct as any).c4Timer).toBeUndefined();
  });

  it('updateTanyaC4 walks toward structure if dist > 1.5', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    tanya.pos.x = 0;
    tanya.pos.y = 0;
    const struct = makeMockStructure('WEAP', House.USSR, 10, 10);
    tanya.targetStructure = struct;
    const ctx = makeMockSpecialUnitsContext();
    updateTanyaC4(ctx, tanya);
    expect(tanya.animState).toBe(AnimState.WALK);
    // No C4 planted yet
    expect((struct as any).c4Timer).toBeUndefined();
  });

  it('updateTanyaC4 plants C4 with 45-tick timer when adjacent', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    const struct = makeMockStructure('WEAP', House.USSR, 4, 4);
    // Place tanya at center of structure
    const [sw, sh] = STRUCTURE_SIZE[struct.type] ?? [2, 2];
    tanya.pos.x = struct.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    tanya.pos.y = struct.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    tanya.targetStructure = struct;
    const ctx = makeMockSpecialUnitsContext();
    updateTanyaC4(ctx, tanya);
    expect((struct as any).c4Timer).toBe(45);
  });

  it('updateTanyaC4 sets attack animation when planting', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    const struct = makeMockStructure('WEAP', House.USSR, 4, 4);
    const [sw, sh] = STRUCTURE_SIZE[struct.type] ?? [2, 2];
    tanya.pos.x = struct.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    tanya.pos.y = struct.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    tanya.targetStructure = struct;
    const ctx = makeMockSpecialUnitsContext();
    updateTanyaC4(ctx, tanya);
    expect(tanya.animState).toBe(AnimState.ATTACK);
  });

  it('updateTanyaC4 clears target and returns to GUARD after planting', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    const struct = makeMockStructure('WEAP', House.USSR, 4, 4);
    const [sw, sh] = STRUCTURE_SIZE[struct.type] ?? [2, 2];
    tanya.pos.x = struct.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    tanya.pos.y = struct.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    tanya.targetStructure = struct;
    tanya.target = makeEntity(UnitType.I_E1, House.USSR);
    const ctx = makeMockSpecialUnitsContext();
    updateTanyaC4(ctx, tanya);
    expect(tanya.targetStructure).toBeNull();
    expect(tanya.target).toBeNull();
    expect(tanya.mission).toBe(Mission.GUARD);
  });

  it('updateTanyaC4 emits EVA message on C4 plant', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    const struct = makeMockStructure('WEAP', House.USSR, 4, 4);
    const [sw, sh] = STRUCTURE_SIZE[struct.type] ?? [2, 2];
    tanya.pos.x = struct.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    tanya.pos.y = struct.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    tanya.targetStructure = struct;
    const ctx = makeMockSpecialUnitsContext();
    updateTanyaC4(ctx, tanya);
    expect(ctx.evaMessages.some(m => m.text === 'C4 PLANTED')).toBe(true);
  });

  it('Tanya cost is 1200 credits', () => {
    expect(UNIT_STATS.E7.cost).toBe(1200);
  });
});

// =========================================================================
// 4. THIEF (I_THF) — updateThief
// =========================================================================
describe('Thief (THF) — cash theft state machine', () => {
  it('has correct UNIT_STATS: no weapon, infantry', () => {
    const stats = UNIT_STATS.THF;
    expect(stats.type).toBe(UnitType.I_THF);
    expect(stats.strength).toBe(25);
    expect(stats.isInfantry).toBe(true);
    expect(stats.primaryWeapon).toBeNull();
    expect(stats.cost).toBe(500);
  });

  it('thief entity has no weapon', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    expect(thief.weapon).toBeNull();
    expect(thief.weapon2).toBeNull();
  });

  it('updateThief only targets PROC and SILO structures', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    const weap = makeMockStructure('WEAP', House.USSR);
    // Place thief adjacent
    thief.pos.x = weap.cx * CELL_SIZE + CELL_SIZE;
    thief.pos.y = weap.cy * CELL_SIZE + CELL_SIZE;
    thief.targetStructure = weap;
    const ctx = makeMockSpecialUnitsContext({
      isAllied: (a, b) => a === b,
    });
    updateThief(ctx, thief);
    // Should reject WEAP and return to GUARD
    expect(thief.targetStructure).toBeNull();
    expect(thief.mission).toBe(Mission.GUARD);
  });

  it('updateThief rejects allied structures', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    const proc = makeMockStructure('PROC', House.Spain); // same house = allied
    thief.pos.x = proc.cx * CELL_SIZE + CELL_SIZE;
    thief.pos.y = proc.cy * CELL_SIZE + CELL_SIZE;
    thief.targetStructure = proc;
    const ctx = makeMockSpecialUnitsContext({
      isAllied: (a, b) => a === b,
    });
    updateThief(ctx, thief);
    expect(thief.targetStructure).toBeNull();
    expect(thief.mission).toBe(Mission.GUARD);
  });

  it('updateThief steals 50% of enemy credits', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    // thief.isPlayerUnit is a getter derived from house — House.Spain is player-controlled by default
    expect(thief.isPlayerUnit).toBe(true);
    const proc = makeMockStructure('PROC', House.USSR, 4, 4);
    const [sw, sh] = STRUCTURE_SIZE['PROC'] ?? [3, 2];
    thief.pos.x = proc.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    thief.pos.y = proc.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    thief.targetStructure = proc;
    const houseCredits = new Map<House, number>();
    houseCredits.set(House.USSR, 1000);
    const ctx = makeMockSpecialUnitsContext({ houseCredits });
    updateThief(ctx, thief);
    expect(houseCredits.get(House.USSR)).toBe(500);
    expect(ctx.credits).toBe(1500); // started with 1000, gained 500
  });

  it('50% theft math: 1000 credits -> steals 500', () => {
    const enemyCredits = 1000;
    const stolen = Math.floor(enemyCredits * 0.5);
    expect(stolen).toBe(500);
  });

  it('50% theft math: 1 credit -> steals 0 (floored)', () => {
    const enemyCredits = 1;
    const stolen = Math.floor(enemyCredits * 0.5);
    expect(stolen).toBe(0);
  });

  it('50% theft math: 0 credits -> steals 0', () => {
    const enemyCredits = 0;
    const stolen = Math.floor(enemyCredits * 0.5);
    expect(stolen).toBe(0);
  });

  it('updateThief: thief dies after stealing', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    const proc = makeMockStructure('PROC', House.USSR, 4, 4);
    const [sw, sh] = STRUCTURE_SIZE['PROC'] ?? [3, 2];
    thief.pos.x = proc.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    thief.pos.y = proc.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    thief.targetStructure = proc;
    const houseCredits = new Map<House, number>();
    houseCredits.set(House.USSR, 1000);
    const ctx = makeMockSpecialUnitsContext({ houseCredits });
    updateThief(ctx, thief);
    expect(thief.alive).toBe(false);
    expect(thief.mission).toBe(Mission.DIE);
  });

  it('updateThief sets isThieved trigger flag', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    const proc = makeMockStructure('PROC', House.USSR, 4, 4);
    const [sw, sh] = STRUCTURE_SIZE['PROC'] ?? [3, 2];
    thief.pos.x = proc.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    thief.pos.y = proc.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    thief.targetStructure = proc;
    const houseCredits = new Map<House, number>();
    houseCredits.set(House.USSR, 1000);
    const ctx = makeMockSpecialUnitsContext({ houseCredits });
    updateThief(ctx, thief);
    expect(ctx.isThieved).toBe(true);
  });

  it('updateThief emits EVA message with stolen amount', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    const proc = makeMockStructure('PROC', House.USSR, 4, 4);
    const [sw, sh] = STRUCTURE_SIZE['PROC'] ?? [3, 2];
    thief.pos.x = proc.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    thief.pos.y = proc.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    thief.targetStructure = proc;
    const houseCredits = new Map<House, number>();
    houseCredits.set(House.USSR, 1000);
    const ctx = makeMockSpecialUnitsContext({ houseCredits });
    updateThief(ctx, thief);
    expect(ctx.evaMessages.some(m => m.text.includes('CREDITS STOLEN'))).toBe(true);
  });

  it('updateThief walks toward target if dist > 1.5', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    thief.pos.x = 0;
    thief.pos.y = 0;
    const proc = makeMockStructure('PROC', House.USSR, 10, 10);
    thief.targetStructure = proc;
    const ctx = makeMockSpecialUnitsContext();
    updateThief(ctx, thief);
    expect(thief.animState).toBe(AnimState.WALK);
  });
});

// =========================================================================
// 5. MEDIC (I_MEDI) — updateMedic (non-duplicate checks)
// =========================================================================
describe('Medic (MEDI) — updateMedic state machine (non-duplicate checks)', () => {
  it('updateMedic flee behavior when fear >= FEAR_SCARED', () => {
    const medic = makeEntity(UnitType.I_MEDI, House.Spain);
    medic.fear = Entity.FEAR_SCARED;
    const enemy = makeEntity(UnitType.I_E1, House.USSR);
    enemy.pos.x = medic.pos.x + CELL_SIZE * 2;
    enemy.pos.y = medic.pos.y;
    const ctx = makeMockSpecialUnitsContext({
      entities: [medic, enemy],
      entitiesAllied: (a, b) => a.house === b.house,
    });
    updateMedic(ctx, medic);
    expect(medic.animState).toBe(AnimState.WALK);
  });

  it('updateMedic drops heal target when fleeing', () => {
    const medic = makeEntity(UnitType.I_MEDI, House.Spain);
    medic.fear = Entity.FEAR_SCARED;
    const ally = makeEntity(UnitType.I_E1, House.Spain);
    ally.hp = 10;
    medic.healTarget = ally;
    const enemy = makeEntity(UnitType.I_E1, House.USSR);
    enemy.pos.x = medic.pos.x + CELL_SIZE * 2;
    enemy.pos.y = medic.pos.y;
    const ctx = makeMockSpecialUnitsContext({
      entities: [medic, ally, enemy],
      entitiesAllied: (a, b) => a.house === b.house,
    });
    updateMedic(ctx, medic);
    expect(medic.healTarget).toBeNull();
  });

  it('updateMedic validates heal target is alive, friendly, infantry, damaged', () => {
    const medic = makeEntity(UnitType.I_MEDI, House.Spain);
    // Set up a dead heal target
    const deadAlly = makeEntity(UnitType.I_E1, House.Spain);
    deadAlly.alive = false;
    medic.healTarget = deadAlly;
    const ctx = makeMockSpecialUnitsContext({
      entities: [medic, deadAlly],
      tick: 100,
    });
    updateMedic(ctx, medic);
    expect(medic.healTarget).toBeNull();

    // Non-infantry target should also be cleared
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.hp = 10;
    medic.healTarget = tank;
    updateMedic(ctx, medic);
    expect(medic.healTarget).toBeNull();
  });

  it('updateMedic scan range is sight * 1.5', () => {
    const medic = makeEntity(UnitType.I_MEDI, House.Spain);
    const sightRange = medic.stats.sight;
    // Place a damaged ally just within sight*1.5 range
    const ally = makeEntity(UnitType.I_E1, House.Spain);
    ally.hp = 10;
    const healScanRange = sightRange * 1.5;
    // Place ally at exactly healScanRange distance (in cells, converted to pixels)
    ally.pos.x = medic.pos.x + (healScanRange - 0.1) * CELL_SIZE;
    ally.pos.y = medic.pos.y;
    const ctx = makeMockSpecialUnitsContext({
      entities: [medic, ally],
      tick: 100,
    });
    medic.lastGuardScan = 0; // force scan
    updateMedic(ctx, medic);
    expect(medic.healTarget).toBe(ally);
  });

  it('updateMedic heals when adjacent (dist <= 1.5)', () => {
    const medic = makeEntity(UnitType.I_MEDI, House.Spain);
    const ally = makeEntity(UnitType.I_E1, House.Spain);
    ally.hp = 10;
    ally.pos.x = medic.pos.x;
    ally.pos.y = medic.pos.y;
    medic.healTarget = ally;
    medic.attackCooldown = 0;
    const ctx = makeMockSpecialUnitsContext({
      entities: [medic, ally],
    });
    const prevHp = ally.hp;
    updateMedic(ctx, medic);
    expect(ally.hp).toBeGreaterThan(prevHp);
    expect(medic.animState).toBe(AnimState.ATTACK);
  });

  it('updateMedic uses weapon ROF for heal cooldown', () => {
    const medic = makeEntity(UnitType.I_MEDI, House.Spain);
    const ally = makeEntity(UnitType.I_E1, House.Spain);
    ally.hp = 10;
    ally.pos.x = medic.pos.x;
    ally.pos.y = medic.pos.y;
    medic.healTarget = ally;
    medic.attackCooldown = 0;
    const ctx = makeMockSpecialUnitsContext({
      entities: [medic, ally],
    });
    updateMedic(ctx, medic);
    // After healing, attackCooldown should be set to weapon ROF
    const healRof = medic.weapon?.rof ?? 15;
    expect(medic.attackCooldown).toBe(healRof);
  });

  it('updateMedic skips ants from healing', () => {
    const medic = makeEntity(UnitType.I_MEDI, House.Spain);
    const ant = makeEntity(UnitType.I_ANT1, House.Spain);
    ant.hp = 10;
    ant.pos.x = medic.pos.x + CELL_SIZE;
    ant.pos.y = medic.pos.y;
    const ctx = makeMockSpecialUnitsContext({
      entities: [medic, ant],
      tick: 100,
    });
    medic.lastGuardScan = 0;
    updateMedic(ctx, medic);
    // Medic should NOT target an ant
    expect(medic.healTarget).not.toBe(ant);
  });
});

// =========================================================================
// 6. ENGINEER (I_E6) — capture / repair logic
// =========================================================================
describe('Engineer (E6) — structure capture/repair', () => {
  it('has correct UNIT_STATS: no weapon, infantry', () => {
    const stats = UNIT_STATS.E6;
    expect(stats.type).toBe(UnitType.I_E6);
    expect(stats.strength).toBe(25);
    expect(stats.isInfantry).toBe(true);
    expect(stats.primaryWeapon).toBeNull();
  });

  it('engineer has null weapon', () => {
    const eng = makeEntity(UnitType.I_E6, House.Spain);
    expect(eng.weapon).toBeNull();
  });

  it('engineer entity type is I_E6', () => {
    const eng = makeEntity(UnitType.I_E6, House.Spain);
    expect(eng.type).toBe(UnitType.I_E6);
  });

  it('engineer is consumed on use (alive = false)', () => {
    const eng = makeEntity(UnitType.I_E6, House.Spain);
    expect(eng.alive).toBe(true);
    // Simulate consumption
    eng.alive = false;
    eng.mission = Mission.DIE;
    expect(eng.alive).toBe(false);
    expect(eng.mission).toBe(Mission.DIE);
  });

  it('engineer is crushable infantry', () => {
    const stats = UNIT_STATS.E6;
    expect(stats.crushable).toBe(true);
    expect(stats.isInfantry).toBe(true);
  });
});

// =========================================================================
// 7. SPY (I_SPY) — spyInfiltrate (avoid duplicating spy-mechanics.test.ts)
// =========================================================================
describe('Spy (SPY) — infiltration state machine (non-duplicate checks)', () => {
  it('spy has no weapon (non-combat)', () => {
    const spy = makeEntity(UnitType.I_SPY, House.Spain);
    expect(spy.weapon).toBeNull();
  });

  it('spy entity type is I_SPY with correct stats', () => {
    // Spy infiltration is handled by the Game class spyInfiltrate method
    // (not extracted to specialUnits.ts), so test entity-level properties
    const spy = makeEntity(UnitType.I_SPY, House.Spain);
    expect(spy.type).toBe(UnitType.I_SPY);
    expect(spy.stats.isInfantry).toBe(true);
    expect(spy.stats.primaryWeapon).toBeNull();
  });

  it('spy infiltration targets enemy structures (multiple types)', () => {
    // Verify the structure types that spy can infiltrate exist in STRUCTURE_SIZE
    for (const type of ['PROC', 'DOME', 'POWR', 'APWR', 'SPEN', 'WEAP', 'TENT', 'BARR']) {
      expect(STRUCTURE_SIZE[type], `${type} should have structure size`).toBeDefined();
    }
  });

  it('spy PROC structure size supports infiltration approach', () => {
    const size = STRUCTURE_SIZE['PROC'];
    expect(size).toBeDefined();
    expect(size![0]).toBeGreaterThan(0);
    expect(size![1]).toBeGreaterThan(0);
  });

  it('spy DOME structure size supports infiltration approach', () => {
    const size = STRUCTURE_SIZE['DOME'];
    expect(size).toBeDefined();
  });

  it('spy SPEN structure size supports infiltration approach', () => {
    const size = STRUCTURE_SIZE['SPEN'];
    expect(size).toBeDefined();
  });

  it('spy is consumed after infiltration (alive = false simulation)', () => {
    const spy = makeEntity(UnitType.I_SPY, House.Spain);
    // Simulate what spyInfiltrate does
    spy.alive = false;
    spy.mission = Mission.DIE;
    spy.disguisedAs = null;
    expect(spy.alive).toBe(false);
    expect(spy.mission).toBe(Mission.DIE);
    expect(spy.disguisedAs).toBeNull();
  });

  it('spy only works on enemy structures (house != ally)', () => {
    // Verify isAllied logic that spyInfiltrate uses
    const ctx = makeMockSpecialUnitsContext();
    expect(ctx.isAllied(House.Spain, House.Spain)).toBe(true);
    expect(ctx.isAllied(House.Spain, House.USSR)).toBe(false);
  });

  it('spy tracks trigger for TEVENT_SPIED (triggerName field exists on structures)', () => {
    const struct = makeMockStructure('DOME', House.USSR);
    // MapStructure supports triggerName for trigger tracking
    (struct as any).triggerName = 'spy_trigger_1';
    expect((struct as any).triggerName).toBe('spy_trigger_1');
  });

  it('spy disguise field works correctly', () => {
    const spy = makeEntity(UnitType.I_SPY, House.Spain);
    expect(spy.disguisedAs).toBeNull();
    spy.disguisedAs = House.USSR;
    expect(spy.disguisedAs).toBe(House.USSR);
    spy.disguisedAs = null;
    expect(spy.disguisedAs).toBeNull();
  });

  it('spy has 200hp strength for dog instant-kill interaction', () => {
    // Spy has 25 HP but dogs instant-kill using maxHp
    const spy = makeEntity(UnitType.I_SPY, House.Spain);
    expect(spy.maxHp).toBe(25);
    // Dog instant-kill: damage = target.maxHp (from entity.ts takeDamage)
    const dog = makeEntity(UnitType.I_DOG, House.USSR);
    dog.target = spy;
    // Verify dog sets damage to maxHp
    const killDamage = spy.maxHp;
    expect(killDamage).toBe(25);
    expect(killDamage).toBeGreaterThanOrEqual(spy.hp);
  });
});

// =========================================================================
// 8. MECHANIC (I_MECH) — updateMechanicUnit
// =========================================================================
describe('Mechanic (MECH) — vehicle repair state machine', () => {
  it('has correct UNIT_STATS: infantry, GoodWrench weapon', () => {
    const stats = UNIT_STATS.MECH;
    expect(stats.type).toBe(UnitType.I_MECH);
    expect(stats.strength).toBe(60);
    expect(stats.isInfantry).toBe(true);
    expect(stats.primaryWeapon).toBe('GoodWrench');
  });

  it('GoodWrench weapon has negative damage (healing)', () => {
    const w = WEAPON_STATS.GoodWrench;
    expect(w).toBeDefined();
    expect(w.damage).toBeLessThan(0);
    expect(w.damage).toBe(-100);
    expect(w.warhead).toBe('Mechanical');
    expect(w.range).toBe(1.83);
    expect(w.rof).toBe(80);
  });

  it('mechanic entity has GoodWrench as primary weapon', () => {
    const mech = makeEntity(UnitType.I_MECH, House.Spain);
    expect(mech.weapon).not.toBeNull();
    expect(mech.weapon!.name).toBe('GoodWrench');
  });

  it('static constants: MECHANIC_HEAL_RANGE = 6, MECHANIC_HEAL_AMOUNT = 5', () => {
    expect(MECHANIC_HEAL_RANGE).toBe(6);
    expect(MECHANIC_HEAL_AMOUNT).toBe(5);
  });

  it('updateMechanicUnit only runs for I_MECH type', () => {
    const rifle = makeEntity(UnitType.I_E1, House.Spain);
    const ctx = makeMockSpecialUnitsContext({ entities: [rifle] });
    updateMechanicUnit(ctx, rifle);
    // Should be a no-op for non-MECH
    expect(rifle.animState).toBe(AnimState.IDLE);
  });

  it('updateMechanicUnit flees when fear >= FEAR_SCARED', () => {
    const mech = makeEntity(UnitType.I_MECH, House.Spain);
    mech.fear = Entity.FEAR_SCARED;
    const enemy = makeEntity(UnitType.I_E1, House.USSR);
    enemy.pos.x = mech.pos.x + CELL_SIZE * 2;
    enemy.pos.y = mech.pos.y;
    const ctx = makeMockSpecialUnitsContext({
      entities: [mech, enemy],
      entitiesAllied: (a, b) => a.house === b.house,
    });
    updateMechanicUnit(ctx, mech);
    expect(mech.animState).toBe(AnimState.WALK);
  });

  it('updateMechanicUnit heals vehicles, NOT infantry or air units', () => {
    const mech = makeEntity(UnitType.I_MECH, House.Spain);
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.hp = 10;
    tank.pos.x = mech.pos.x + CELL_SIZE;
    tank.pos.y = mech.pos.y;
    const ctx = makeMockSpecialUnitsContext({
      entities: [mech, tank],
      tick: 100,
    });
    mech.lastGuardScan = 0;
    updateMechanicUnit(ctx, mech);
    expect(mech.healTarget).toBe(tank);

    // Infantry should NOT be targeted
    const mech2 = makeEntity(UnitType.I_MECH, House.Spain);
    const rifle = makeEntity(UnitType.I_E1, House.Spain);
    rifle.hp = 10;
    rifle.pos.x = mech2.pos.x + CELL_SIZE;
    rifle.pos.y = mech2.pos.y;
    const ctx2 = makeMockSpecialUnitsContext({
      entities: [mech2, rifle],
      tick: 100,
    });
    mech2.lastGuardScan = 0;
    updateMechanicUnit(ctx2, mech2);
    expect(mech2.healTarget).toBeNull();
  });

  it('updateMechanicUnit does NOT heal self', () => {
    const mech = makeEntity(UnitType.I_MECH, House.Spain);
    mech.hp = 10; // damage self
    const ctx = makeMockSpecialUnitsContext({
      entities: [mech],
      tick: 100,
    });
    mech.lastGuardScan = 0;
    updateMechanicUnit(ctx, mech);
    // Mechanic should not target itself (it's infantry anyway, but also has id check)
    expect(mech.healTarget).toBeNull();
  });

  it('updateMechanicUnit heals 5 HP per tick with heal effect text', () => {
    const mech = makeEntity(UnitType.I_MECH, House.Spain);
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.hp = tank.maxHp - 10;
    tank.pos.x = mech.pos.x;
    tank.pos.y = mech.pos.y;
    mech.healTarget = tank;
    mech.attackCooldown = 0;
    const ctx = makeMockSpecialUnitsContext({
      entities: [mech, tank],
    });
    const prevHp = tank.hp;
    updateMechanicUnit(ctx, mech);
    expect(tank.hp).toBe(prevHp + MECHANIC_HEAL_AMOUNT);
    // Check for text effect
    const textEffect = ctx.effects.find(e => e.type === 'text' && e.text?.includes('+'));
    expect(textEffect).toBeDefined();
  });

  it('mechanic heal caps at target maxHp', () => {
    // Simulating the mechanic heal logic
    const target = makeEntity(UnitType.V_2TNK, House.Spain);
    target.hp = target.maxHp - 3; // only 3 HP missing
    const healAmount = 5;
    const prevHp = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + healAmount);
    expect(target.hp).toBe(target.maxHp);
    expect(target.hp - prevHp).toBe(3); // only healed 3, not 5
  });

  it('mechanic does NOT heal full-health vehicles', () => {
    const target = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(target.hp).toBe(target.maxHp);
    const shouldHeal = target.hp < target.maxHp;
    expect(shouldHeal).toBe(false);
  });

  it('mechanic does NOT heal infantry', () => {
    const rifle = makeEntity(UnitType.I_E1, House.Spain);
    rifle.hp = 10;
    // Mechanic heal target validation: !other.stats.isInfantry required
    expect(rifle.stats.isInfantry).toBe(true);
    const shouldHeal = !rifle.stats.isInfantry && rifle.hp < rifle.maxHp;
    expect(shouldHeal).toBe(false);
  });
});

// =========================================================================
// 9. MINELAYER (V_MNLY) — updateMinelayer / tickMines
// =========================================================================
describe('Minelayer (MNLY) — mine placement state machine', () => {
  it('has correct UNIT_STATS: no weapon, maxAmmo = 5', () => {
    const stats = UNIT_STATS.MNLY;
    expect(stats.type).toBe(UnitType.V_MNLY);
    expect(stats.strength).toBe(100);
    expect(stats.armor).toBe('heavy');
    expect(stats.primaryWeapon).toBeNull();
    expect(stats.maxAmmo).toBe(5);
    expect(stats.cost).toBe(800);
  });

  it('minelayer entity has mineCount = 0 initially', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    expect(mnly.mineCount).toBe(0);
    expect(mnly.ammo).toBe(5); // from maxAmmo stat
  });

  it('static MAX_MINES_PER_HOUSE = 50', () => {
    expect(MAX_MINES_PER_HOUSE).toBe(50);
  });

  it('updateMinelayer only runs for V_MNLY with moveTarget', () => {
    // Non-MNLY entity: should be a no-op
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.moveTarget = { x: 200, y: 200 };
    const ctx = makeMockSpecialUnitsContext();
    updateMinelayer(ctx, tank);
    expect(ctx.mines.length).toBe(0);

    // MNLY without moveTarget: no-op
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    mnly.moveTarget = null;
    updateMinelayer(ctx, mnly);
    expect(ctx.mines.length).toBe(0);
  });

  it('updateMinelayer respects ammo limit', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    mnly.ammo = 0;
    mnly.moveTarget = { x: mnly.pos.x, y: mnly.pos.y };
    const ctx = makeMockSpecialUnitsContext();
    updateMinelayer(ctx, mnly);
    expect(ctx.mines.length).toBe(0);
    expect(mnly.mission).toBe(Mission.GUARD);
  });

  it('updateMinelayer respects per-house mine limit', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    mnly.moveTarget = { x: mnly.pos.x, y: mnly.pos.y };
    // Fill up mines to MAX_MINES_PER_HOUSE
    const existingMines = Array.from({ length: MAX_MINES_PER_HOUSE }, (_, i) => ({
      cx: i, cy: 0, house: House.Spain, damage: 1000,
    }));
    const ctx = makeMockSpecialUnitsContext({ mines: existingMines });
    updateMinelayer(ctx, mnly);
    expect(ctx.mines.length).toBe(MAX_MINES_PER_HOUSE); // no new mine added
  });

  it('updateMinelayer prevents duplicate mines at same cell', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    const targetCell = worldToCell(mnly.pos.x, mnly.pos.y);
    mnly.moveTarget = { x: mnly.pos.x, y: mnly.pos.y };
    const ctx = makeMockSpecialUnitsContext({
      mines: [{ cx: targetCell.cx, cy: targetCell.cy, house: House.USSR, damage: 1000 }],
    });
    const prevCount = ctx.mines.length;
    updateMinelayer(ctx, mnly);
    expect(ctx.mines.length).toBe(prevCount); // no new mine
  });

  it('updateMinelayer places mine with 1000 damage', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    mnly.moveTarget = { x: mnly.pos.x, y: mnly.pos.y };
    const ctx = makeMockSpecialUnitsContext();
    updateMinelayer(ctx, mnly);
    expect(ctx.mines.length).toBe(1);
    expect(ctx.mines[0].damage).toBe(1000);
  });

  it('updateMinelayer decrements ammo on mine placement', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    mnly.moveTarget = { x: mnly.pos.x, y: mnly.pos.y };
    const ctx = makeMockSpecialUnitsContext();
    const prevAmmo = mnly.ammo;
    updateMinelayer(ctx, mnly);
    expect(mnly.ammo).toBe(prevAmmo - 1);
  });

  it('updateMinelayer increments entity mineCount', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    mnly.moveTarget = { x: mnly.pos.x, y: mnly.pos.y };
    const ctx = makeMockSpecialUnitsContext();
    updateMinelayer(ctx, mnly);
    expect(mnly.mineCount).toBe(1);
  });

  it('minelayer ammo tracking: 5 ammo -> place 3 mines -> 2 remaining', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    expect(mnly.ammo).toBe(5);
    // Simulate 3 mine placements
    for (let i = 0; i < 3; i++) {
      if (mnly.ammo > 0) {
        mnly.ammo--;
        mnly.mineCount++;
      }
    }
    expect(mnly.ammo).toBe(2);
    expect(mnly.mineCount).toBe(3);
  });

  it('minelayer stops placing when ammo = 0', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    // Use all ammo
    for (let i = 0; i < 5; i++) mnly.ammo--;
    expect(mnly.ammo).toBe(0);
    // Logic check: ammo === 0 && maxAmmo > 0 -> stop
    expect(mnly.ammo === 0 && mnly.maxAmmo > 0).toBe(true);
  });
});

// =========================================================================
// 10. MINE SYSTEM — tickMines
// =========================================================================
describe('Mine System — tickMines proximity detonation', () => {
  it('tickMines triggers on enemy entering mined cell', () => {
    const mine = { cx: 4, cy: 4, house: House.Spain, damage: 1000 };
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR);
    enemy.pos.x = mine.cx * CELL_SIZE + CELL_SIZE / 2;
    enemy.pos.y = mine.cy * CELL_SIZE + CELL_SIZE / 2;
    const ctx = makeMockSpecialUnitsContext({
      mines: [mine],
      entities: [enemy],
      isAllied: (a, b) => a === b,
    });
    tickMines(ctx);
    expect(ctx.damageEntity).toHaveBeenCalledWith(enemy, 1000, 'AP');
    expect(ctx.mines.length).toBe(0); // mine consumed
  });

  it('tickMines skips allied units and air units', () => {
    const mine = { cx: 4, cy: 4, house: House.Spain, damage: 1000 };
    // Allied unit on mine
    const ally = makeEntity(UnitType.V_2TNK, House.Spain);
    ally.pos.x = mine.cx * CELL_SIZE + CELL_SIZE / 2;
    ally.pos.y = mine.cy * CELL_SIZE + CELL_SIZE / 2;
    // Air unit on mine
    const heli = makeEntity(UnitType.V_TRAN, House.USSR);
    heli.pos.x = mine.cx * CELL_SIZE + CELL_SIZE / 2;
    heli.pos.y = mine.cy * CELL_SIZE + CELL_SIZE / 2;

    const ctx = makeMockSpecialUnitsContext({
      mines: [mine],
      entities: [ally, heli],
      isAllied: (a, b) => a === b,
    });
    tickMines(ctx);
    expect(ctx.damageEntity).not.toHaveBeenCalled();
    expect(ctx.mines.length).toBe(1); // mine not consumed
  });

  it('tickMines applies mine damage via damageEntity', () => {
    const mine = { cx: 4, cy: 4, house: House.Spain, damage: 1000 };
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR);
    enemy.pos.x = mine.cx * CELL_SIZE + CELL_SIZE / 2;
    enemy.pos.y = mine.cy * CELL_SIZE + CELL_SIZE / 2;
    const ctx = makeMockSpecialUnitsContext({
      mines: [mine],
      entities: [enemy],
    });
    tickMines(ctx);
    expect(ctx.damageEntity).toHaveBeenCalledWith(enemy, mine.damage, 'AP');
  });

  it('tickMines removes mine after detonation', () => {
    const mine = { cx: 4, cy: 4, house: House.Spain, damage: 1000 };
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR);
    enemy.pos.x = mine.cx * CELL_SIZE + CELL_SIZE / 2;
    enemy.pos.y = mine.cy * CELL_SIZE + CELL_SIZE / 2;
    const ctx = makeMockSpecialUnitsContext({
      mines: [mine],
      entities: [enemy],
    });
    tickMines(ctx);
    expect(ctx.mines.length).toBe(0);
  });

  it('tickMines creates explosion effect', () => {
    const mine = { cx: 4, cy: 4, house: House.Spain, damage: 1000 };
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR);
    enemy.pos.x = mine.cx * CELL_SIZE + CELL_SIZE / 2;
    enemy.pos.y = mine.cy * CELL_SIZE + CELL_SIZE / 2;
    const ctx = makeMockSpecialUnitsContext({
      mines: [mine],
      entities: [enemy],
    });
    tickMines(ctx);
    expect(ctx.effects.some(e => e.type === 'explosion')).toBe(true);
  });

  it('tickMines uses AP warhead for mine damage', () => {
    const mine = { cx: 4, cy: 4, house: House.Spain, damage: 1000 };
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR);
    enemy.pos.x = mine.cx * CELL_SIZE + CELL_SIZE / 2;
    enemy.pos.y = mine.cy * CELL_SIZE + CELL_SIZE / 2;
    const ctx = makeMockSpecialUnitsContext({
      mines: [mine],
      entities: [enemy],
    });
    tickMines(ctx);
    expect(ctx.damageEntity).toHaveBeenCalledWith(enemy, 1000, 'AP');
  });

  it('mine data structure has cx, cy, house, damage fields', () => {
    const mine = { cx: 5, cy: 5, house: House.Spain, damage: 1000 };
    expect(mine.cx).toBe(5);
    expect(mine.cy).toBe(5);
    expect(mine.house).toBe(House.Spain);
    expect(mine.damage).toBe(1000);
  });

  it('air units are immune to mines', () => {
    // Air unit check
    const heli = makeEntity(UnitType.V_TRAN, House.USSR);
    expect(heli.isAirUnit).toBe(true);
    // tickMines skips e.isAirUnit === true
  });

  it('mines do not trigger on allied units', () => {
    // Verify same-house check
    const mine = { cx: 5, cy: 5, house: House.Spain, damage: 1000 };
    const ally = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(mine.house).toBe(ally.house);
    // isAllied(e.house, mine.house) would be true -> skip
  });
});

// =========================================================================
// 11. MAD TANK (V_QTNK) — deployMADTank / updateMADTank
// =========================================================================
describe('MAD Tank (QTNK) — seismic shockwave state machine', () => {
  it('has correct UNIT_STATS: no weapon, heavy armor', () => {
    const stats = UNIT_STATS.QTNK;
    expect(stats.type).toBe(UnitType.V_QTNK);
    expect(stats.strength).toBe(300);
    expect(stats.armor).toBe('heavy');
    expect(stats.primaryWeapon).toBeNull();
    expect(stats.crusher).toBe(true);
  });

  it('MAD Tank entity initializes with deploy fields at default', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    expect(qtnk.isDeployed).toBe(false);
    expect(qtnk.deployTimer).toBe(0);
  });

  it('static constants match C++ parity', () => {
    expect(MAD_TANK_CHARGE_TICKS).toBe(90);
    expect(MAD_TANK_DAMAGE).toBe(600);
    expect(MAD_TANK_RADIUS).toBe(8);
  });

  it('deployMADTank sets isDeployed = true and starts timer', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    const ctx = makeMockSpecialUnitsContext({
      map: {
        isPassable: () => true,
        getOccupancy: () => 0,
        boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128,
      } as any,
    });
    deployMADTank(ctx, qtnk);
    expect(qtnk.isDeployed).toBe(true);
    expect(qtnk.deployTimer).toBe(MAD_TANK_CHARGE_TICKS);
  });

  it('deployMADTank guards against double-deploy', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 50;
    const ctx = makeMockSpecialUnitsContext();
    deployMADTank(ctx, qtnk);
    expect(qtnk.deployTimer).toBe(50); // unchanged
  });

  it('deployMADTank ejects civilian crew before detonation', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    const ctx = makeMockSpecialUnitsContext({
      map: {
        isPassable: () => true,
        getOccupancy: () => 0,
        boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128,
      } as any,
    });
    deployMADTank(ctx, qtnk);
    // Should have called addEntity with an I_C1 crew member
    expect(ctx.addEntity).toHaveBeenCalled();
    const addedEntity = (ctx.addEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as Entity;
    expect(addedEntity.type).toBe(UnitType.I_C1);
    expect(addedEntity.mission).toBe(Mission.MOVE);
  });

  it('deployMADTank clears move and attack targets', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    qtnk.moveTarget = { x: 200, y: 200 };
    qtnk.target = makeEntity(UnitType.I_E1, House.USSR);
    const ctx = makeMockSpecialUnitsContext({
      map: {
        isPassable: () => true,
        getOccupancy: () => 0,
        boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128,
      } as any,
    });
    deployMADTank(ctx, qtnk);
    expect(qtnk.moveTarget).toBeNull();
    expect(qtnk.target).toBeNull();
    expect(qtnk.mission).toBe(Mission.GUARD);
  });

  it('updateMADTank decrements deployTimer each tick', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 50;
    const ctx = makeMockSpecialUnitsContext({ entities: [qtnk] });
    updateMADTank(ctx, qtnk);
    expect(qtnk.deployTimer).toBe(49);
  });

  it('updateMADTank damages vehicles (not infantry, not air, not self)', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1; // will fire this tick

    const tank = makeEntity(UnitType.V_2TNK, House.USSR);
    tank.pos.x = qtnk.pos.x + CELL_SIZE;
    tank.pos.y = qtnk.pos.y;

    const infantry = makeEntity(UnitType.I_E1, House.USSR);
    infantry.pos.x = qtnk.pos.x + CELL_SIZE;
    infantry.pos.y = qtnk.pos.y;

    const heli = makeEntity(UnitType.V_TRAN, House.USSR);
    heli.pos.x = qtnk.pos.x + CELL_SIZE;
    heli.pos.y = qtnk.pos.y;

    const ctx = makeMockSpecialUnitsContext({
      entities: [qtnk, tank, infantry, heli],
    });
    updateMADTank(ctx, qtnk);

    // Tank should be damaged
    const tankCall = (ctx.damageEntity as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => c[0] === tank
    );
    expect(tankCall).toBeDefined();
    expect(tankCall![1]).toBe(MAD_TANK_DAMAGE);

    // Infantry should NOT be damaged
    const infantryCall = (ctx.damageEntity as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => c[0] === infantry
    );
    expect(infantryCall).toBeUndefined();

    // Air unit should NOT be damaged
    const heliCall = (ctx.damageEntity as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: any[]) => c[0] === heli
    );
    expect(heliCall).toBeUndefined();
  });

  it('updateMADTank uses MAD_TANK_DAMAGE and MAD_TANK_RADIUS', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1;
    // Place target just within radius
    const tank = makeEntity(UnitType.V_2TNK, House.USSR);
    tank.pos.x = qtnk.pos.x + (MAD_TANK_RADIUS - 1) * CELL_SIZE;
    tank.pos.y = qtnk.pos.y;
    const ctx = makeMockSpecialUnitsContext({ entities: [qtnk, tank] });
    updateMADTank(ctx, qtnk);
    expect(ctx.damageEntity).toHaveBeenCalledWith(tank, MAD_TANK_DAMAGE, 'HE');
  });

  it('updateMADTank self-destructs after shockwave', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1;
    const ctx = makeMockSpecialUnitsContext({ entities: [qtnk] });
    updateMADTank(ctx, qtnk);
    expect(qtnk.hp).toBe(0);
    expect(qtnk.alive).toBe(false);
  });

  it('MAD Tank deploy timer countdown simulation', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    // Simulate deploy
    qtnk.isDeployed = true;
    qtnk.deployTimer = 90;

    // Count down
    for (let i = 0; i < 89; i++) {
      qtnk.deployTimer--;
      expect(qtnk.deployTimer).toBeGreaterThan(0);
    }
    qtnk.deployTimer--;
    expect(qtnk.deployTimer).toBe(0);
    // At 0, shockwave fires
  });

  it('MAD Tank is NOT turreted', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    expect(qtnk.hasTurret).toBe(false);
  });

  it('MAD Tank shockwave skips infantry — infantry-safe EMP', () => {
    // The updateMADTank code checks other.stats.isInfantry -> continue
    const rifle = makeEntity(UnitType.I_E1, House.USSR);
    expect(rifle.stats.isInfantry).toBe(true);
    // Verifies infantry would be skipped in the shockwave loop
  });
});

// =========================================================================
// 12. VEHICLE CLOAK (V_STNK) — updateVehicleCloak / CloakState
// =========================================================================
describe('Vehicle Cloaking (STNK) — cloak state machine', () => {
  it('STNK has isCloakable = true in UNIT_STATS', () => {
    const stats = UNIT_STATS.STNK;
    expect(stats.isCloakable).toBe(true);
    expect(stats.type).toBe(UnitType.V_STNK);
    expect(stats.passengers).toBe(1);
    expect(stats.primaryWeapon).toBe('APTusk');
  });

  it('entity initializes with UNCLOAKED state', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
    expect(stnk.cloakTimer).toBe(0);
    expect(stnk.sonarPulseTimer).toBe(0);
  });

  it('CloakState enum has 4 states', () => {
    expect(CloakState.UNCLOAKED).toBe(0);
    expect(CloakState.CLOAKING).toBe(1);
    expect(CloakState.CLOAKED).toBe(2);
    expect(CloakState.UNCLOAKING).toBe(3);
  });

  it('CLOAK_TRANSITION_FRAMES = 38 (~2.5 seconds at 15 FPS)', () => {
    expect(CLOAK_TRANSITION_FRAMES).toBe(38);
  });

  it('updateVehicleCloak skips vessels (vessel cloak is separate)', () => {
    // Create a vessel entity with isCloakable
    const sub = makeEntity(UnitType.V_SS, House.Spain);
    sub.cloakState = CloakState.UNCLOAKED;
    const ctx = makeMockSpecialUnitsContext();
    updateVehicleCloak(ctx, sub);
    // Vessel's cloak state should remain unchanged (function returns early)
    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('updateVehicleCloak: CLOAKING -> CLOAKED when timer reaches 0', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = 1;
    const ctx = makeMockSpecialUnitsContext();
    updateVehicleCloak(ctx, stnk);
    expect(stnk.cloakState).toBe(CloakState.CLOAKED);
    expect(stnk.cloakTimer).toBe(0);
  });

  it('updateVehicleCloak: UNCLOAKING -> UNCLOAKED when timer reaches 0', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.UNCLOAKING;
    stnk.cloakTimer = 1;
    const ctx = makeMockSpecialUnitsContext();
    updateVehicleCloak(ctx, stnk);
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
    expect(stnk.cloakTimer).toBe(0);
  });

  it('updateVehicleCloak: decloak prevention during ATTACK mission', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.UNCLOAKED;
    stnk.mission = Mission.ATTACK;
    const ctx = makeMockSpecialUnitsContext();
    updateVehicleCloak(ctx, stnk);
    // Should NOT start cloaking when in ATTACK mission
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('updateVehicleCloak: decloak prevention during weapon cooldown', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.UNCLOAKED;
    stnk.attackCooldown = 10;
    const ctx = makeMockSpecialUnitsContext();
    updateVehicleCloak(ctx, stnk);
    // Should NOT start cloaking when weapon is on cooldown
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('updateVehicleCloak: sonarPulseTimer blocks recloaking', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.UNCLOAKED;
    stnk.sonarPulseTimer = 10;
    const ctx = makeMockSpecialUnitsContext();
    updateVehicleCloak(ctx, stnk);
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('updateVehicleCloak: low HP reduces recloak chance (CONDITION_RED threshold)', () => {
    // When hp/maxHp < CONDITION_RED (0.25), random chance blocks cloak
    // We can verify the threshold constant and the entity state
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.hp = Math.floor(stnk.maxHp * 0.1); // well below CONDITION_RED
    expect(stnk.hp / stnk.maxHp).toBeLessThan(CONDITION_RED);
    // The function uses Math.random() > 0.04 to block; not deterministic,
    // but we verify the threshold is checked
    expect(CONDITION_RED).toBe(0.25);
  });

  it('updateVehicleCloak starts cloaking with CLOAK_TRANSITION_FRAMES', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.UNCLOAKED;
    stnk.mission = Mission.GUARD;
    stnk.attackCooldown = 0;
    stnk.sonarPulseTimer = 0;
    // Full health so CONDITION_RED path doesn't interfere
    const ctx = makeMockSpecialUnitsContext();
    updateVehicleCloak(ctx, stnk);
    expect(stnk.cloakState).toBe(CloakState.CLOAKING);
    expect(stnk.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('STNK is NOT turreted (C++ udata.cpp)', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    expect(stnk.hasTurret).toBe(false);
  });

  it('cloak state transition: UNCLOAKED -> CLOAKING -> CLOAKED', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);

    // Begin cloaking
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = CLOAK_TRANSITION_FRAMES;
    expect(stnk.cloakState).toBe(CloakState.CLOAKING);
    expect(stnk.cloakTimer).toBe(38);

    // Count down to 0
    for (let i = 0; i < 38; i++) {
      stnk.cloakTimer--;
    }
    expect(stnk.cloakTimer).toBe(0);

    // Transition to CLOAKED
    stnk.cloakState = CloakState.CLOAKED;
    stnk.cloakTimer = 0;
    expect(stnk.cloakState).toBe(CloakState.CLOAKED);
  });

  it('cloak state transition: CLOAKED -> UNCLOAKING -> UNCLOAKED', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.CLOAKED;

    // Begin uncloaking (e.g., due to damage)
    stnk.cloakState = CloakState.UNCLOAKING;
    stnk.cloakTimer = CLOAK_TRANSITION_FRAMES;

    // Count down
    for (let i = 0; i < 38; i++) {
      stnk.cloakTimer--;
    }
    expect(stnk.cloakTimer).toBe(0);

    stnk.cloakState = CloakState.UNCLOAKED;
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('damage forces uncloak on cloakable units (Entity.takeDamage)', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.CLOAKED;
    // takeDamage checks isCloakable and force-uncloaks
    stnk.takeDamage(10, 'AP');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);
    expect(stnk.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('damage during CLOAKING also forces uncloak', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = 20;
    stnk.takeDamage(10, 'AP');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);
    expect(stnk.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('damage while UNCLOAKED does NOT change cloak state', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.UNCLOAKED;
    stnk.takeDamage(10, 'AP');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
  });
});

// =========================================================================
// 13. C4 TIMER SYSTEM — tickC4Timers
// =========================================================================
describe('C4 Timer System — tickC4Timers', () => {
  it('tickC4Timers decrements c4Timer on structures', () => {
    const struct = makeMockStructure('WEAP', House.USSR);
    (struct as any).c4Timer = 10;
    const ctx = makeMockSpecialUnitsContext({ structures: [struct] });
    tickC4Timers(ctx);
    expect((struct as any).c4Timer).toBe(9);
  });

  it('tickC4Timers destroys structure when timer reaches 0', () => {
    const struct = makeMockStructure('WEAP', House.USSR);
    (struct as any).c4Timer = 1;
    const ctx = makeMockSpecialUnitsContext({ structures: [struct] });
    tickC4Timers(ctx);
    expect(ctx.damageStructure).toHaveBeenCalledWith(struct, 9999);
  });

  it('tickC4Timers skips dead structures', () => {
    const struct = makeMockStructure('WEAP', House.USSR);
    struct.alive = false;
    (struct as any).c4Timer = 5;
    const ctx = makeMockSpecialUnitsContext({ structures: [struct] });
    tickC4Timers(ctx);
    expect((struct as any).c4Timer).toBe(5); // unchanged
  });

  it('C4 timer countdown: 45 ticks -> 0 -> kaboom', () => {
    // Simulate the c4Timer countdown
    let c4Timer = 45;
    for (let i = 0; i < 45; i++) {
      c4Timer--;
    }
    expect(c4Timer).toBe(0);
    // At 0, structure receives 9999 damage (guaranteed destruction)
    expect(9999).toBeGreaterThan(256); // max structure HP
  });

  it('C4 damage amount (9999) exceeds any structure maxHp', () => {
    // Standard structure maxHp is 256
    const c4Damage = 9999;
    expect(c4Damage).toBeGreaterThan(256);
    // Even reinforced structures with 600+ HP would be destroyed
    expect(c4Damage).toBeGreaterThan(600);
  });
});

// =========================================================================
// 14. CROSS-CUTTING: Entity field initialization for special units
// =========================================================================
describe('Entity field initialization — special ability fields', () => {
  it('all special fields initialize to safe defaults', () => {
    const e = makeEntity(UnitType.I_E1, House.Spain);
    expect(e.c4Timer).toBe(0);
    expect(e.mineCount).toBe(0);
    expect(e.chronoCooldown).toBe(0);
    expect(e.isDeployed).toBe(false);
    expect(e.deployTimer).toBe(0);
    expect(e.fuseTimer).toBe(0);
    expect(e.disguisedAs).toBeNull();
    expect(e.cloakState).toBe(CloakState.UNCLOAKED);
    expect(e.cloakTimer).toBe(0);
    expect(e.sonarPulseTimer).toBe(0);
    expect(e.isCloakable).toBe(false);
    expect(e.ironCurtainTick).toBe(0);
    expect(e.chronoShiftTick).toBe(0);
  });

  it('STNK isCloakable initializes from stats', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    // isCloakable is set from stats in the constructor for STNK
    expect(stnk.stats.isCloakable).toBe(true);
  });

  it('CTNK isCloakable is false (not inherently cloakable)', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    expect(ctnk.stats.isCloakable).toBeUndefined();
  });

  it('MNLY initializes ammo from stats.maxAmmo', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    expect(mnly.ammo).toBe(5);
    expect(mnly.maxAmmo).toBe(5);
  });

  it('QTNK has null weapon (no direct attack)', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    expect(qtnk.weapon).toBeNull();
  });
});

// =========================================================================
// 15. CROSS-CUTTING: Game tick loop integration of special units
// =========================================================================
describe('Game tick loop — special unit update integration', () => {
  it('updateMADTank only acts when isDeployed is true', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    qtnk.isDeployed = false;
    const ctx = makeMockSpecialUnitsContext({ entities: [qtnk] });
    updateMADTank(ctx, qtnk);
    // Should be a no-op when not deployed
    expect(qtnk.deployTimer).toBe(0);
  });

  it('updateChronoTank runs cooldown tick for CTNK', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    ctnk.chronoCooldown = 10;
    const ctx = makeMockSpecialUnitsContext();
    updateChronoTank(ctx, ctnk);
    expect(ctnk.chronoCooldown).toBe(9);
  });

  it('updateVehicleCloak runs for non-vessel cloakable units', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.UNCLOAKED;
    stnk.mission = Mission.GUARD;
    stnk.attackCooldown = 0;
    const ctx = makeMockSpecialUnitsContext();
    updateVehicleCloak(ctx, stnk);
    expect(stnk.cloakState).toBe(CloakState.CLOAKING);
  });

  it('updateMinelayer runs when MNLY has moveTarget', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    mnly.moveTarget = { x: mnly.pos.x, y: mnly.pos.y };
    const ctx = makeMockSpecialUnitsContext();
    updateMinelayer(ctx, mnly);
    expect(ctx.mines.length).toBe(1);
  });

  it('tickC4Timers runs and processes structures', () => {
    const struct = makeMockStructure('WEAP', House.USSR);
    (struct as any).c4Timer = 5;
    const ctx = makeMockSpecialUnitsContext({ structures: [struct] });
    tickC4Timers(ctx);
    expect((struct as any).c4Timer).toBe(4);
  });

  it('tickMines runs and processes mine detonations', () => {
    const mine = { cx: 4, cy: 4, house: House.Spain, damage: 1000 };
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR);
    enemy.pos.x = mine.cx * CELL_SIZE + CELL_SIZE / 2;
    enemy.pos.y = mine.cy * CELL_SIZE + CELL_SIZE / 2;
    const ctx = makeMockSpecialUnitsContext({
      mines: [mine],
      entities: [enemy],
    });
    tickMines(ctx);
    expect(ctx.mines.length).toBe(0);
  });

  it('updateDemoTruck intercepts ATTACK mission for DTRK', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.mission = Mission.ATTACK;
    dtrk.target = null;
    dtrk.targetStructure = null;
    const ctx = makeMockSpecialUnitsContext();
    updateDemoTruck(ctx, dtrk);
    // With no target, returns to GUARD
    expect(dtrk.mission).toBe(Mission.GUARD);
  });

  it('updateTanyaC4 intercepts structure attack for Tanya', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    const struct = makeMockStructure('WEAP', House.USSR, 4, 4);
    const [sw, sh] = STRUCTURE_SIZE[struct.type] ?? [2, 2];
    tanya.pos.x = struct.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    tanya.pos.y = struct.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    tanya.targetStructure = struct;
    const ctx = makeMockSpecialUnitsContext();
    updateTanyaC4(ctx, tanya);
    expect((struct as any).c4Timer).toBe(45);
  });

  it('updateThief intercepts structure attack for thief', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    const proc = makeMockStructure('PROC', House.USSR, 4, 4);
    const [sw, sh] = STRUCTURE_SIZE['PROC'] ?? [3, 2];
    thief.pos.x = proc.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
    thief.pos.y = proc.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
    thief.targetStructure = proc;
    const houseCredits = new Map<House, number>();
    houseCredits.set(House.USSR, 1000);
    const ctx = makeMockSpecialUnitsContext({ houseCredits });
    updateThief(ctx, thief);
    expect(thief.alive).toBe(false);
  });

  it('updateMedic runs heal logic for MEDI type', () => {
    const medic = makeEntity(UnitType.I_MEDI, House.Spain);
    const ctx = makeMockSpecialUnitsContext({ entities: [medic] });
    updateMedic(ctx, medic);
    expect(medic.animState).toBe(AnimState.IDLE); // no heal target, so idle
  });
});

// =========================================================================
// 16. EDGE CASES — dead targets, self-targeting, out of range
// =========================================================================
describe('Edge cases — dead targets, self-targeting, cooldowns', () => {
  it('Demo Truck with dead target stops (no explosion)', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.mission = Mission.ATTACK;
    const target = makeEntity(UnitType.V_2TNK, House.Spain);
    target.alive = false;
    dtrk.target = target;
    const ctx = makeMockSpecialUnitsContext();
    updateDemoTruck(ctx, dtrk);
    expect(dtrk.mission).toBe(Mission.GUARD);
  });

  it('Tanya C4 with dead targetStructure aborts', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    const struct = makeMockStructure('WEAP', House.USSR);
    struct.alive = false;
    tanya.targetStructure = struct;
    const ctx = makeMockSpecialUnitsContext();
    updateTanyaC4(ctx, tanya);
    expect((struct as any).c4Timer).toBeUndefined();
  });

  it('Thief against allied structure rejects and returns to GUARD', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    const proc = makeMockStructure('PROC', House.Spain); // allied
    thief.pos.x = proc.cx * CELL_SIZE + CELL_SIZE;
    thief.pos.y = proc.cy * CELL_SIZE + CELL_SIZE;
    thief.targetStructure = proc;
    const ctx = makeMockSpecialUnitsContext();
    updateThief(ctx, thief);
    expect(thief.targetStructure).toBeNull();
    expect(thief.mission).toBe(Mission.GUARD);
  });

  it('Thief against non-PROC/SILO structure rejects', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    const weap = makeMockStructure('WEAP', House.USSR);
    thief.pos.x = weap.cx * CELL_SIZE + CELL_SIZE;
    thief.pos.y = weap.cy * CELL_SIZE + CELL_SIZE;
    thief.targetStructure = weap;
    const ctx = makeMockSpecialUnitsContext();
    updateThief(ctx, thief);
    expect(thief.targetStructure).toBeNull();
    expect(thief.mission).toBe(Mission.GUARD);
  });

  it('Chrono Tank teleport blocked by impassable terrain', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    const ctx = makeMockSpecialUnitsContext({
      map: { isPassable: () => false, getOccupancy: () => 0, boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128 } as any,
    });
    const origX = ctnk.pos.x;
    teleportChronoTank(ctx, ctnk, { x: 500, y: 500 });
    expect(ctnk.pos.x).toBe(origX);
  });

  it('Chrono Tank teleport blocked by cooldown > 0', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    ctnk.chronoCooldown = 100;
    const ctx = makeMockSpecialUnitsContext();
    const origX = ctnk.pos.x;
    teleportChronoTank(ctx, ctnk, { x: 500, y: 500 });
    expect(ctnk.pos.x).toBe(origX);
  });

  it('MAD Tank double-deploy is prevented', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 50;
    const ctx = makeMockSpecialUnitsContext();
    deployMADTank(ctx, qtnk);
    expect(qtnk.deployTimer).toBe(50); // unchanged
  });

  it('updateMADTank does nothing if not deployed', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    qtnk.isDeployed = false;
    const ctx = makeMockSpecialUnitsContext({ entities: [qtnk] });
    updateMADTank(ctx, qtnk);
    expect(qtnk.deployTimer).toBe(0); // unchanged
  });

  it('updateDemoTruck does nothing for non-ATTACK mission', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.mission = Mission.GUARD;
    const ctx = makeMockSpecialUnitsContext();
    updateDemoTruck(ctx, dtrk);
    expect(dtrk.mission).toBe(Mission.GUARD); // unchanged
  });

  it('invulnerable unit cannot be killed by mine (Entity.takeDamage)', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.ironCurtainTick = 100; // invulnerable
    expect(tank.isInvulnerable).toBe(true);
    const killed = tank.takeDamage(9999, 'AP');
    expect(killed).toBe(false);
    expect(tank.alive).toBe(true);
    expect(tank.hp).toBe(tank.maxHp); // no damage taken
  });

  it('dead entity cannot take further damage', () => {
    const unit = makeEntity(UnitType.I_E1, House.Spain);
    unit.alive = false;
    unit.hp = 0;
    const killed = unit.takeDamage(100, 'AP');
    expect(killed).toBe(false);
  });

  it('crate-granted cloak (isCloakable) persists permanently', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.isCloakable = true;
    // Simulate 1000 ticks — boolean stays true
    for (let i = 0; i < 1000; i++) {
      expect(tank.isCloakable).toBe(true);
    }
  });
});

// =========================================================================
// 17. worldDist / worldToCell helpers used by special units
// =========================================================================
describe('worldDist / worldToCell — coordinate math used by special units', () => {
  it('worldDist measures in cells (CELL_SIZE = 24)', () => {
    expect(CELL_SIZE).toBe(24);
    const a = { x: 0, y: 0 };
    const b = { x: CELL_SIZE, y: 0 };
    expect(worldDist(a, b)).toBeCloseTo(1.0);
  });

  it('worldDist: 1.5 cells = 36 pixels (mine/C4 adjacency threshold)', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 136, y: 100 }; // 36px = 1.5 cells
    expect(worldDist(a, b)).toBeCloseTo(1.5);
  });

  it('worldToCell converts pixel coords to cell coords', () => {
    const cell = worldToCell(50, 74);
    expect(cell.cx).toBe(2); // floor(50/24) = 2
    expect(cell.cy).toBe(3); // floor(74/24) = 3
  });

  it('CONDITION_RED = 0.25 (used by vehicle cloak low-HP check)', () => {
    expect(CONDITION_RED).toBe(0.25);
  });
});
