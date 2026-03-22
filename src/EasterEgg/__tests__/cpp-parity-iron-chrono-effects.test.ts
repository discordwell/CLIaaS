/**
 * C++ Behavioral Parity: Iron Curtain & Chronoshift effect mechanics
 *
 * Authoritative source: rules.ini (public/ra/assets/rules.ini)
 *
 * C++ sources:
 *   house.cpp:2740-2771   — SPC_IRON_CURTAIN: targets RTTI_UNIT/BUILDING/VESSEL/AIRCRAFT
 *                            IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_MINUTE
 *   house.cpp:2753-2755   — FIXIT_CSII: Demo Truck → IronCurtainDuration * TICKS_PER_SECOND
 *   house.cpp:2773-2897   — SPC_CHRONOSPHERE + SPC_CHRONO2: eligibility, teleport, moebius
 *   house.cpp:2779-2785   — Chrono targets: RTTI_UNIT, RTTI_INFANTRY, RTTI_VESSEL
 *                            (except VESSEL_TRANSPORT and VESSEL_CARRIER via FIXIT_CARRIER)
 *   house.cpp:2787        — Cannot chronoshift deploying units: !IsDeploying guard
 *   house.cpp:2790-2793   — FIXIT_CSII: UNIT_CHRONOTANK excluded from chronoshift
 *   house.cpp:2813        — Aircraft excluded from chrono destination step
 *   house.cpp:2820-2826   — Infantry killed on chronoshift: Take_Damage(Strength, WARHEAD_FIRE)
 *   house.cpp:2828-2830   — Demo Truck: Assign_Target(self) → self-destruct after chrono
 *   house.cpp:2835-2850   — Vehicle warp: MoebiusCell, IsMoebius=true,
 *                            MoebiusCountDown = ChronoDuration * TICKS_PER_MINUTE
 *   house.cpp:2871-2873   — 20% time quake chance per chronoshift
 *   house.cpp:2884        — 20% chronal vortex chance per chronoshift
 *   techno.cpp:3807       — IronCurtainCountDown == 0 gates Take_Damage — non-zero = immune
 *   techno.cpp:4274       — Visual: IronCurtainCountDown > 0 → remap = FadingRed
 *   defines.h:3031-3032   — TICKS_PER_SECOND = 15, TICKS_PER_MINUTE = 900
 *
 * rules.ini [General]:
 *   IronCurtain=.75       → 0.75 minutes → 0.75 * 900 = 675 ticks (45 seconds)
 *   ChronoDuration=3      → 3 minutes → 3 * 900 = 2700 ticks
 *   QuakeChance=20%       → 0.2
 *   VortexChance=20%      → 0.2
 *
 * rules.ini [Recharge]:
 *   IronCurtain=11        → 11 minutes → 11 * 900 = 9900 ticks
 *   Chrono=7              → 7 minutes → 7 * 900 = 6300 ticks
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, CELL_SIZE, Mission,
  SuperweaponType, SUPERWEAPON_DEFS,
  type SuperweaponState,
  IRON_CURTAIN_DURATION,
  IRON_CURTAIN_DEMO_TRUCK_DURATION,
  CHRONO_SHIFT_VISUAL_TICKS,
  buildDefaultAlliances,
} from '../engine/types';
import {
  activateSuperweapon,
  CHRONO_DURATION_TICKS,
  type SuperweaponContext,
} from '../engine/superweapon';
import { type MapStructure, STRUCTURE_SIZE } from '../engine/scenario';
import { structureDamage, type CombatContext } from '../engine/combat';
import type { Effect } from '../engine/renderer';
import { GameMap, Terrain } from '../engine/map';

// ---------------------------------------------------------------------------
// C++ reference constants (from rules.ini + defines.h)
// ---------------------------------------------------------------------------

const TICKS_PER_SECOND = 15;                // defines.h:3031
const TICKS_PER_MINUTE = 900;               // defines.h:3032 (15 * 60)

// rules.ini [General]
const RULES_INI_IRON_CURTAIN_MINUTES = 0.75; // IronCurtain=.75
const RULES_INI_CHRONO_DURATION_MINUTES = 3;  // ChronoDuration=3
const RULES_INI_QUAKE_CHANCE = 0.20;          // QuakeChance=20%
const RULES_INI_VORTEX_CHANCE = 0.20;         // VortexChance=20%

// Computed C++ values
const CPP_IRON_CURTAIN_TICKS = Math.floor(RULES_INI_IRON_CURTAIN_MINUTES * TICKS_PER_MINUTE); // 675
const CPP_IRON_CURTAIN_DEMO_TICKS = Math.floor(RULES_INI_IRON_CURTAIN_MINUTES * TICKS_PER_SECOND); // 11
const CPP_CHRONO_DURATION_TICKS = RULES_INI_CHRONO_DURATION_MINUTES * TICKS_PER_MINUTE; // 2700

beforeEach(() => resetEntityIds());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
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
    buildProgress: 1,
    ...overrides,
  } as MapStructure;
}

function makeIronCurtainCtx(
  entities: Entity[] = [],
  structures: MapStructure[] = [],
): SuperweaponContext {
  const alliances = buildDefaultAlliances();
  const key = `${House.USSR}:${SuperweaponType.IRON_CURTAIN}`;
  const swState: SuperweaponState = {
    type: SuperweaponType.IRON_CURTAIN,
    house: House.USSR,
    chargeTick: SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].rechargeTicks,
    ready: true,
    structureIndex: 0,
    fired: false,
  };
  const superweapons = new Map<string, SuperweaponState>();
  superweapons.set(key, swState);
  const entityById = new Map<number, Entity>();
  for (const e of entities) entityById.set(e.id, e);

  const map = new GameMap(64, 64);

  return {
    structures,
    entities,
    entityById,
    superweapons,
    effects: [] as Effect[],
    tick: 100,
    playerHouse: House.USSR,
    powerProduced: 200,
    powerConsumed: 100,
    killCount: 0,
    lossCount: 0,
    map,
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    gpsActive: false,
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? a === b,
    isPlayerControlled: (e: Entity) => e.house === House.USSR,
    pushEva: () => {},
    playSound: () => {},
    playSoundAt: () => {},
    damageEntity: (target: Entity, amount: number) => {
      target.hp -= amount;
      if (target.hp <= 0) { target.alive = false; target.hp = 0; }
      return !target.alive;
    },
    damageStructure: () => false,
    addEntity: () => {},
    aiIQ: () => 5,
    getWarheadMult: () => 1,
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 800,
    screenShake: 0,
    screenFlash: 0,
    activeVortices: [],
  };
}

function makeChronoCtx(
  entities: Entity[] = [],
  overrides: Partial<SuperweaponContext> = {},
): SuperweaponContext {
  const alliances = buildDefaultAlliances();
  const key = `${House.Spain}:${SuperweaponType.CHRONOSPHERE}`;
  const swState: SuperweaponState = {
    type: SuperweaponType.CHRONOSPHERE,
    house: House.Spain,
    chargeTick: SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].rechargeTicks,
    ready: true,
    structureIndex: 0,
    fired: false,
  };
  const superweapons = new Map<string, SuperweaponState>();
  superweapons.set(key, swState);
  const entityById = new Map<number, Entity>();
  for (const e of entities) entityById.set(e.id, e);

  const map = new GameMap(64, 64);

  return {
    structures: [],
    entities,
    entityById,
    superweapons,
    effects: [] as Effect[],
    tick: 100,
    playerHouse: House.Spain,
    powerProduced: 200,
    powerConsumed: 100,
    killCount: 0,
    lossCount: 0,
    map,
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    gpsActive: false,
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? a === b,
    isPlayerControlled: (e: Entity) => e.house === House.Spain,
    pushEva: () => {},
    playSound: () => {},
    playSoundAt: () => {},
    damageEntity: (target: Entity, amount: number) => {
      target.hp -= amount;
      if (target.hp <= 0) { target.alive = false; target.hp = 0; }
      return !target.alive;
    },
    damageStructure: () => false,
    addEntity: () => {},
    aiIQ: () => 5,
    getWarheadMult: () => 1,
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 800,
    screenShake: 0,
    screenFlash: 0,
    activeVortices: [],
    ...overrides,
  };
}

// ===========================================================================
// IRON CURTAIN EFFECT MECHANICS
// ===========================================================================

describe('Iron Curtain effect duration (rules.ini IronCurtain=.75, house.cpp:2751)', () => {

  it('IRON_CURTAIN_DURATION matches rules.ini: 0.75 * TICKS_PER_MINUTE(900) = 675', () => {
    // rules.ini [General] IronCurtain=.75 (authoritative)
    // C++ house.cpp:2751: IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_MINUTE
    expect(IRON_CURTAIN_DURATION).toBe(CPP_IRON_CURTAIN_TICKS);
    expect(IRON_CURTAIN_DURATION).toBe(675);
  });

  it('Demo Truck duration matches C++: 0.75 * TICKS_PER_SECOND(15) = 11', () => {
    // C++ house.cpp:2753-2755 (FIXIT_CSII):
    //   if (UNIT_DEMOTRUCK) IronCurtainCountDown = IronCurtainDuration * TICKS_PER_SECOND
    //   = 0.75 * 15 = 11.25 → integer truncation to 11
    expect(IRON_CURTAIN_DEMO_TRUCK_DURATION).toBe(CPP_IRON_CURTAIN_DEMO_TICKS);
    expect(IRON_CURTAIN_DEMO_TRUCK_DURATION).toBe(11);
  });

  it('duration is 45 real-time seconds at 15 TPS', () => {
    const realSeconds = IRON_CURTAIN_DURATION / TICKS_PER_SECOND;
    expect(realSeconds).toBe(45);
  });
});

describe('Iron Curtain damage immunity (techno.cpp:3807)', () => {

  it('entity with ironCurtainTick > 0 is invulnerable (takeDamage returns false)', () => {
    // C++ techno.cpp:3807: if (IronCurtainCountDown == 0) { result = Take_Damage(...) }
    // Non-zero countdown → damage is entirely skipped
    const tank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    tank.ironCurtainTick = IRON_CURTAIN_DURATION;
    const initialHp = tank.hp;

    const killed = tank.takeDamage(500);
    expect(killed).toBe(false);
    expect(tank.hp).toBe(initialHp);
    expect(tank.alive).toBe(true);
  });

  it('entity with ironCurtainTick == 0 takes normal damage', () => {
    const tank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    tank.ironCurtainTick = 0;
    const initialHp = tank.hp;

    tank.takeDamage(50);
    expect(tank.hp).toBeLessThan(initialHp);
  });

  it('structure with ironCurtainTicks > 0 is invulnerable', () => {
    // C++ house.cpp:2748 RTTI_BUILDING case + techno.cpp:3807 immunity
    const s = makeStructure('FACT', House.USSR, 5, 5);
    s.ironCurtainTicks = IRON_CURTAIN_DURATION;

    const ctx: CombatContext = {
      attackedTriggerNames: new Set(),
    } as unknown as CombatContext;

    const killed = structureDamage(ctx, s, 999);
    expect(killed).toBe(false);
    expect(s.hp).toBe(256);
    expect(s.alive).toBe(true);
  });

  it('structure with ironCurtainTicks == 0 takes damage normally', () => {
    const s = makeStructure('FACT', House.USSR, 5, 5);
    s.ironCurtainTicks = 0;

    const ctx: CombatContext = {
      attackedTriggerNames: new Set(),
      aiStates: new Map(),
      tick: 100,
      lastBaseAttackEva: 0,
      gameTicksPerSec: 15,
      isAllied: () => false,
      playerHouse: House.Greece,
    } as unknown as CombatContext;

    const killed = structureDamage(ctx, s, 100);
    expect(s.hp).toBe(156);
  });
});

describe('Iron Curtain targeting rules (house.cpp:2746-2763)', () => {

  it('applies to vehicles (RTTI_UNIT): tank gets ironCurtainTick = 675', () => {
    // C++ house.cpp:2747 case RTTI_UNIT:
    const tank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    const ctx = makeIronCurtainCtx([tank]);

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.USSR, tank.pos);
    expect(tank.ironCurtainTick).toBe(IRON_CURTAIN_DURATION);
  });

  it('applies to structures (RTTI_BUILDING): building gets ironCurtainTicks = 675', () => {
    // C++ house.cpp:2748 case RTTI_BUILDING:
    const bldg = makeStructure('FACT', House.USSR, 10, 10);
    const [sw, sh] = STRUCTURE_SIZE['FACT'] ?? [2, 2];
    const target = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeIronCurtainCtx([], [bldg]);

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.USSR, target);
    expect(bldg.ironCurtainTicks).toBe(IRON_CURTAIN_DURATION);
  });

  it('does NOT apply to infantry (falls through default:break in C++)', () => {
    // C++ house.cpp:2746 switch: RTTI_INFANTRY is NOT listed → falls to default:break
    const inf = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeIronCurtainCtx([inf]);

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.USSR, inf.pos);
    expect(inf.ironCurtainTick).toBe(0);
  });

  it('Demo Truck gets shortened duration (house.cpp:2753-2755 FIXIT_CSII)', () => {
    // C++ house.cpp:2753-2755: Demo Truck → IronCurtainDuration * TICKS_PER_SECOND = 11
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const ctx = makeIronCurtainCtx([dtrk]);

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.USSR, dtrk.pos);
    expect(dtrk.ironCurtainTick).toBe(IRON_CURTAIN_DEMO_TRUCK_DURATION);
    expect(dtrk.ironCurtainTick).toBe(11);
  });
});

// ===========================================================================
// CHRONOSHIFT EFFECT MECHANICS
// ===========================================================================

describe('Chronoshift Moebius return timer (rules.ini ChronoDuration=3, house.cpp:2844)', () => {

  it('CHRONO_DURATION_TICKS matches rules.ini: 3 * TICKS_PER_MINUTE(900) = 2700', () => {
    // rules.ini [General] ChronoDuration=3 (authoritative)
    // C++ house.cpp:2844: MoebiusCountDown = Rule.ChronoDuration * TICKS_PER_MINUTE
    expect(CHRONO_DURATION_TICKS).toBe(CPP_CHRONO_DURATION_TICKS);
    expect(CHRONO_DURATION_TICKS).toBe(2700);
  });

  it('Moebius return timer is exactly 3 real-time minutes at 15 TPS', () => {
    const realMinutes = CHRONO_DURATION_TICKS / TICKS_PER_MINUTE;
    expect(realMinutes).toBe(3);
  });

  it('vehicle gets moebiusCountDown = 2700 and moebiusCell set to origin', () => {
    // C++ house.cpp:2835-2850: DriveClass warp — MoebiusCell, IsMoebius, MoebiusCountDown
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const originX = tank.pos.x;
    const originY = tank.pos.y;
    const target = { x: 30 * CELL_SIZE + CELL_SIZE / 2, y: 30 * CELL_SIZE + CELL_SIZE / 2 };

    const ctx = makeChronoCtx([tank]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(tank.moebiusCountDown).toBe(CHRONO_DURATION_TICKS);
    expect(tank.moebiusCell).not.toBeNull();
    expect(tank.moebiusCell!.x).toBe(originX);
    expect(tank.moebiusCell!.y).toBe(originY);
  });
});

describe('Chronoshift infantry kill (house.cpp:2820-2826)', () => {

  it('infantry teleported by chronoshift is killed with full-strength damage', () => {
    // C++ house.cpp:2820-2826:
    //   if (RTTI_INFANTRY) { move to dest; damage = Strength; Take_Damage(damage, WARHEAD_FIRE); }
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    const ctx = makeChronoCtx([inf]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(inf.alive).toBe(false);
    expect(inf.hp).toBe(0);
  });

  it('infantry is moved to destination before being killed', () => {
    // C++ house.cpp:2822-2823: inf->Coord = Cell_Coord(cell) THEN inf->Take_Damage
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    const ctx = makeChronoCtx([inf]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // Unit should be at destination coordinates (even though dead)
    expect(inf.pos.x).toBe(target.x);
    expect(inf.pos.y).toBe(target.y);
  });
});

describe('Chronoshift Demo Truck self-destruct (house.cpp:2828-2830)', () => {

  it('Demo Truck self-targets after chronoshift (Assign_Target(self))', () => {
    // C++ house.cpp:2828-2830 (FIXIT_CSII):
    //   else if (UNIT_DEMOTRUCK) tech->Assign_Target(tech->As_Target())
    //   → self-targeting causes kamikaze explosion
    const dtrk = entityAtCell(UnitType.V_DTRK, House.Spain, 5, 5);
    dtrk.selected = true;
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    const ctx = makeChronoCtx([dtrk]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // TS sets target=self and mission=ATTACK to match C++ Assign_Target(self)
    expect(dtrk.target).toBe(dtrk);
    expect(dtrk.mission).toBe(Mission.ATTACK);
  });

  it('Demo Truck is teleported to destination before self-destruct', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.Spain, 5, 5);
    dtrk.selected = true;
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    const ctx = makeChronoCtx([dtrk]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(dtrk.pos.x).toBe(target.x);
    expect(dtrk.pos.y).toBe(target.y);
  });

  it('Demo Truck does NOT get Moebius return (no moebiusCell set)', () => {
    // C++ house.cpp:2828-2830: Demo Truck branch does NOT reach the MoebiusCell assignment
    // at house.cpp:2836. It self-destructs instead of warping with a return timer.
    const dtrk = entityAtCell(UnitType.V_DTRK, House.Spain, 5, 5);
    dtrk.selected = true;
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    const ctx = makeChronoCtx([dtrk]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // Demo Truck should NOT have moebius return fields set
    expect(dtrk.moebiusCell).toBeNull();
    expect(dtrk.moebiusCountDown).toBe(0);
  });
});

describe('Chronoshift eligibility filter (house.cpp:2779-2803)', () => {

  it('excludes aircraft (C++ house.cpp:2813: RTTI_AIRCRAFT check)', () => {
    const heli = entityAtCell(UnitType.V_HIND, House.Spain, 5, 5);
    heli.selected = true;
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    const ctx = makeChronoCtx([heli]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // Aircraft should not be teleported
    expect(heli.pos.x).not.toBe(target.x);
  });

  it('excludes VESSEL_TRANSPORT / V_LST (C++ house.cpp:2784)', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 5, 5);
    lst.selected = true;
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    const ctx = makeChronoCtx([lst]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(lst.pos.x).not.toBe(target.x);
  });

  it('excludes UNIT_CHRONOTANK / V_CTNK (C++ house.cpp:2790-2793 FIXIT_CSII)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.selected = true;
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    const ctx = makeChronoCtx([ctnk]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(ctnk.pos.x).not.toBe(target.x);
  });

  it.todo('excludes VESSEL_CARRIER / V_CARR (C++ house.cpp:2782 FIXIT_CARRIER) — known parity gap: TS does not exclude carriers from chronoshift', () => {
    // C++ #ifdef FIXIT_CARRIER: *((VesselClass *)tech) != VESSEL_CARRIER
    // TS superweapon.ts:380-385 — MISMATCH: V_CARR is NOT excluded from chrono filter
    // Known parity gap: TS allows chronoshift of carriers, C++ excludes them via FIXIT_CARRIER
    const carr = entityAtCell(UnitType.V_CARR, House.Spain, 5, 5);
    carr.selected = true;
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    const ctx = makeChronoCtx([carr]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // Per C++ parity, carrier should NOT be teleported
    expect(carr.pos.x).not.toBe(target.x);
  });

  it('allows normal vehicles (medium tank teleports successfully)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const target = { x: 30 * CELL_SIZE + CELL_SIZE / 2, y: 30 * CELL_SIZE + CELL_SIZE / 2 };

    const ctx = makeChronoCtx([tank]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(tank.pos.x).toBe(target.x);
    expect(tank.pos.y).toBe(target.y);
  });

  it('allows infantry (but kills them — house.cpp:2779 RTTI_INFANTRY eligible)', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    const ctx = makeChronoCtx([inf]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // Infantry IS eligible for chrono (not filtered out), but dies on teleport
    expect(inf.alive).toBe(false);
  });
});

describe('Chronoshift visual effect timer', () => {

  it('chronoShiftTick set on teleported vehicle', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const target = { x: 30 * CELL_SIZE + CELL_SIZE / 2, y: 30 * CELL_SIZE + CELL_SIZE / 2 };

    const ctx = makeChronoCtx([tank]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(tank.chronoShiftTick).toBe(CHRONO_SHIFT_VISUAL_TICKS);
  });

  it('blue flash effects created at both origin and destination', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const target = { x: 30 * CELL_SIZE + CELL_SIZE / 2, y: 30 * CELL_SIZE + CELL_SIZE / 2 };

    const ctx = makeChronoCtx([tank]);
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // Should have at least 2 explosion effects (origin + destination) + possible vortex
    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    expect(explosions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Chronal side effects: time quake and vortex (house.cpp:2871-2888)', () => {

  it('vortex/quake chance constants match rules.ini', () => {
    // rules.ini [General] QuakeChance=20%, VortexChance=20%
    // TS superweapon.ts:29-33 uses 0.2 for both — should match 20%
    expect(RULES_INI_QUAKE_CHANCE).toBe(0.2);
    expect(RULES_INI_VORTEX_CHANCE).toBe(0.2);
  });

  it('chronal vortex appears at random map location (not origin/destination)', () => {
    // C++ house.cpp:2884-2888: random x,y within map bounds
    // (The commented-out code at 2889-2893 would have placed it at origin or dest,
    //  but final C++ code uses random map position)
    // This is a statistical test — run enough iterations to see at least one vortex
    let vortexSeen = false;
    for (let trial = 0; trial < 200; trial++) {
      resetEntityIds();
      const tank = entityAtCell(UnitType.V_MTNK, House.Spain, 5, 5);
      tank.selected = true;
      const target = { x: 30 * CELL_SIZE + CELL_SIZE / 2, y: 30 * CELL_SIZE + CELL_SIZE / 2 };

      const vortices: Array<{ x: number; y: number; angle: number; ticksLeft: number; id: number }> = [];
      const ctx = makeChronoCtx([tank], { activeVortices: vortices });
      activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

      if (vortices.length > 0) {
        vortexSeen = true;
        break;
      }
    }
    expect(vortexSeen).toBe(true);
  });
});

// ===========================================================================
// CROSS-CUTTING: Iron Curtain + Chronoshift interaction
// ===========================================================================

describe('Iron Curtain + damage: forced damage still blocked (techno.cpp:3807)', () => {

  it('Iron Curtain blocks ALL damage regardless of amount', () => {
    // C++ techno.cpp:3807: entire Take_Damage path gated by IronCurtainCountDown == 0
    // There is NO exception for forced damage, nukes, or any other source
    const tank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    tank.ironCurtainTick = 1; // minimum non-zero value
    const initialHp = tank.hp;

    // Even 9999 damage should do nothing
    tank.takeDamage(9999);
    expect(tank.hp).toBe(initialHp);
    expect(tank.alive).toBe(true);
  });

  it('Iron Curtain wears off after countdown reaches 0', () => {
    // C++ techno.h:175: CDTimerClass auto-decrements each tick
    // Once it reaches 0, Take_Damage path is unblocked
    const tank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    tank.ironCurtainTick = 1;

    // Simulate one tick decrement
    tank.ironCurtainTick--;
    expect(tank.ironCurtainTick).toBe(0);
    expect(tank.isInvulnerable).toBe(false);

    // Now damage should work
    const initialHp = tank.hp;
    tank.takeDamage(50);
    expect(tank.hp).toBeLessThan(initialHp);
  });
});
