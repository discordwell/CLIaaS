/**
 * C++ Behavioral Parity: Iron Curtain timer mechanics
 *
 * C++ sources:
 *   - rules.cpp:266     — IronCurtainDuration(fixed(1, 2))  [= 0.5]
 *   - house.cpp:2751    — IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_MINUTE
 *                         = 0.5 * 900 = 450 ticks (30 seconds at 15 ticks/sec)
 *   - house.cpp:2753-55 — FIXIT_CSII: Demo Truck special case:
 *                         IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_SECOND
 *                         = 0.5 * 15 = 7 ticks (integer truncation of 7.5)
 *   - defines.h:3031-32 — TICKS_PER_SECOND = 15, TICKS_PER_MINUTE = 900
 *   - techno.cpp:612    — IronCurtainCountDown(0) initialized to zero
 *   - techno.cpp:3807   — if (IronCurtainCountDown == 0) { Take_Damage... }
 *                         Non-zero countdown = invulnerable; ALL damage skipped.
 *   - techno.h:175      — CDTimerClass<FrameTimerClass> IronCurtainCountDown;
 *                         Auto-decrements each frame tick. No manual decrement needed.
 *   - techno.cpp:4274   — if (IronCurtainCountDown > 0) { remap = FadingRed; }
 *                         Visual indicator while protected.
 *   - house.cpp:2746-63 — switch(tech->What_Am_I()) only handles:
 *                         RTTI_UNIT, RTTI_BUILDING, RTTI_VESSEL, RTTI_AIRCRAFT.
 *                         RTTI_INFANTRY falls through to default:break — NO protection.
 *
 * TS constants:
 *   - types.ts:776      — IRON_CURTAIN_DURATION = 675 (45 seconds)
 *   - entity.ts:239     — ironCurtainTick = 0
 *   - entity.ts:366     — isInvulnerable: invulnTick > 0 || ironCurtainTick > 0
 *   - entity.ts:488     — takeDamage: if (isInvulnerable) return false
 *   - index.ts:1783     — if (e.ironCurtainTick > 0) e.ironCurtainTick-- (per-tick)
 *   - combat.ts:1017    — structureDamage: if (s.ironCurtainTicks > 0) return false
 *   - superweapon.ts:424 — s.ironCurtainTicks = IRON_CURTAIN_DURATION
 *   - superweapon.ts:453 — bestEntity.ironCurtainTick = IRON_CURTAIN_DURATION
 *   - superweapon.ts:444 — No infantry exclusion; any entity type can be protected.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, CELL_SIZE,
  SuperweaponType, type SuperweaponState,
  IRON_CURTAIN_DURATION,
  buildDefaultAlliances,
} from '../engine/types';
import {
  activateSuperweapon,
  type SuperweaponContext,
} from '../engine/superweapon';
import { type MapStructure, STRUCTURE_SIZE } from '../engine/scenario';
import { structureDamage, type CombatContext } from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ─── C++ Constants ──────────────────────────────────────
// Derived directly from C++ source files, not from TS constants.
const CPP_TICKS_PER_SECOND = 15;                           // defines.h:3031
const CPP_TICKS_PER_MINUTE = CPP_TICKS_PER_SECOND * 60;    // defines.h:3032 = 900
const CPP_IRON_CURTAIN_DURATION_FIXED = 0.5;                // rules.cpp:266 fixed(1,2) = 0.5
const CPP_IRON_CURTAIN_TICKS =
  Math.floor(CPP_IRON_CURTAIN_DURATION_FIXED * CPP_TICKS_PER_MINUTE); // 0.5 * 900 = 450
const CPP_DEMO_TRUCK_IC_TICKS =
  Math.floor(CPP_IRON_CURTAIN_DURATION_FIXED * CPP_TICKS_PER_SECOND); // 0.5 * 15 = 7

// ─── Helpers ────────────────────────────────────────────

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
): SuperweaponContext {
  const evaMessages: string[] = [];
  const sounds: string[] = [];

  const ctx: SuperweaponContext = {
    structures: [],
    entities: [],
    entityById: new Map(),
    superweapons: new Map(),
    effects: [],
    tick: 0,
    playerHouse: House.Spain,
    powerProduced: 100,
    powerConsumed: 50,
    killCount: 0,
    lossCount: 0,
    map: {
      revealAll() {},
      shroudAll() {},
      isPassable() { return true; },
      setVisibility() {},
      inBounds() { return true; },
      setTerrain() {},
      unjamRadius() {},
    },
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    gpsActive: false,
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied(a: House, b: House) { return a === b; },
    isPlayerControlled(e: Entity) { return e.house === House.Spain; },
    pushEva(text: string) { evaMessages.push(text); },
    playSound(name: string) { sounds.push(name); },
    playSoundAt() {},
    damageEntity(target: Entity, amount: number, warhead: string) {
      return target.takeDamage(amount, warhead);
    },
    damageStructure(s: MapStructure, damage: number) {
      s.hp -= damage;
      const killed = s.hp <= 0;
      if (killed) { s.hp = 0; s.alive = false; }
      return killed;
    },
    addEntity() {},
    aiIQ() { return 5; },
    getWarheadMult() { return 1; },
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 640,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };

  (ctx as any)._evaMessages = evaMessages;
  (ctx as any)._sounds = sounds;

  return ctx;
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
    movementSpeed: () => 1,
    getFirepowerBias: () => 1.0,
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
// 1. Duration constant parity — C++ rules.cpp:266, defines.h:3031-3032
// =============================================================================

describe('Iron Curtain duration constant (C++ rules.cpp:266, defines.h:3031-3032)', () => {

  it('C++ duration is 450 ticks (30 seconds): IronCurtainDuration(1/2) * TICKS_PER_MINUTE(900)', () => {
    // C++ rules.cpp:266 — IronCurtainDuration(fixed(1, 2)) = 0.5
    // C++ house.cpp:2751 — IronCurtainCountDown = 0.5 * 900 = 450
    expect(CPP_IRON_CURTAIN_TICKS).toBe(450);
  });

  it('TS IRON_CURTAIN_DURATION should match C++ 450 ticks', () => {
    // PARITY GAP: TS uses 675 (45 seconds), C++ uses 450 (30 seconds)
    // TS comment says "0.75 min x 60 x 15 FPS = 45 seconds" but C++ uses fixed(1,2) = 0.5 min.
    // C++ IronCurtainDuration = fixed(1,2) = 0.5, NOT 0.75.
    expect(IRON_CURTAIN_DURATION).toBe(CPP_IRON_CURTAIN_TICKS); // PARITY GAP
  });

  it('TICKS_PER_SECOND = 15 (C++ defines.h:3031)', () => {
    // Both C++ and TS use 15 ticks per second game rate
    expect(CPP_TICKS_PER_SECOND).toBe(15);
  });

  it('TICKS_PER_MINUTE = 900 (C++ defines.h:3032)', () => {
    expect(CPP_TICKS_PER_MINUTE).toBe(900);
  });
});

// =============================================================================
// 2. Timer initialization — C++ techno.cpp:612
// =============================================================================

describe('Iron Curtain timer initialization (C++ techno.cpp:612)', () => {

  it('entity ironCurtainTick starts at 0 (C++ IronCurtainCountDown(0))', () => {
    // C++ techno.cpp:612 — IronCurtainCountDown(0) in constructor
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);
    expect(tank.ironCurtainTick).toBe(0);
  });

  it('entity with ironCurtainTick=0 is NOT invulnerable', () => {
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);
    expect(tank.isInvulnerable).toBe(false);
  });

  it('entity with ironCurtainTick>0 IS invulnerable', () => {
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);
    tank.ironCurtainTick = 1;
    expect(tank.isInvulnerable).toBe(true);
  });
});

// =============================================================================
// 3. Invulnerability gate — C++ techno.cpp:3807
// =============================================================================

describe('Invulnerability damage gate (C++ techno.cpp:3807)', () => {

  it('IronCurtainCountDown == 0 allows damage (C++ techno.cpp:3807)', () => {
    // C++ techno.cpp:3807 — if (IronCurtainCountDown == 0) { result = Take_Damage(...); }
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);
    expect(tank.ironCurtainTick).toBe(0);

    const hpBefore = tank.hp;
    const killed = tank.takeDamage(50, 'HE');

    // With IronCurtainCountDown==0, damage should be taken
    expect(tank.hp).toBeLessThan(hpBefore);
  });

  it('IronCurtainCountDown > 0 blocks ALL damage (C++ techno.cpp:3807)', () => {
    // C++ techno.cpp:3807 — if IronCurtainCountDown != 0, Take_Damage is never called
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);
    tank.ironCurtainTick = 100;

    const hpBefore = tank.hp;
    const killed = tank.takeDamage(9999, 'Super');

    expect(killed).toBe(false);
    expect(tank.hp).toBe(hpBefore);
    expect(tank.alive).toBe(true);
  });

  it('structure with ironCurtainTicks > 0 blocks damage (C++ techno.cpp:3807)', () => {
    // C++ uses same TechnoClass::Take_Damage for buildings
    const struct = makeStructure('FACT', House.Spain, 5, 5, { ironCurtainTicks: 100 });
    const ctx = makeCombatCtx([struct]);

    const hpBefore = struct.hp;
    const killed = structureDamage(ctx, struct, 200);

    expect(killed).toBe(false);
    expect(struct.hp).toBe(hpBefore);
  });

  it('structure with ironCurtainTicks == 0 takes damage normally', () => {
    const struct = makeStructure('FACT', House.Spain, 5, 5, { ironCurtainTicks: 0 });
    const ctx = makeCombatCtx([struct]);

    const hpBefore = struct.hp;
    structureDamage(ctx, struct, 50);

    expect(struct.hp).toBe(hpBefore - 50);
  });

  it('damage blocked at ironCurtainTick=1 (last tick of protection)', () => {
    // C++ CDTimerClass: value of 1 means "1 tick remaining", still > 0
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);
    tank.ironCurtainTick = 1;

    const hpBefore = tank.hp;
    tank.takeDamage(100, 'HE');

    expect(tank.hp).toBe(hpBefore);
  });
});

// =============================================================================
// 4. Timer decrement — C++ CDTimerClass auto-decrement (ftimer.h:450)
// =============================================================================

describe('Timer auto-decrement per tick (C++ CDTimerClass, TS index.ts:1783)', () => {

  it('ironCurtainTick decrements by 1 each game tick (entity)', () => {
    // C++ ftimer.h:549-561 — CDTimerClass auto-decrements based on frame timer
    // TS index.ts:1783 — if (e.ironCurtainTick > 0) e.ironCurtainTick--
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);
    tank.ironCurtainTick = 5;

    // Simulate 5 ticks of the game loop's decrement
    for (let i = 0; i < 5; i++) {
      expect(tank.ironCurtainTick).toBe(5 - i);
      if (tank.ironCurtainTick > 0) tank.ironCurtainTick--;
    }

    expect(tank.ironCurtainTick).toBe(0);
    expect(tank.isInvulnerable).toBe(false);
  });

  it('ironCurtainTicks decrements by 1 each game tick (structure)', () => {
    // TS index.ts:1790 — if (s.ironCurtainTicks && s.ironCurtainTicks > 0) s.ironCurtainTicks--
    const struct = makeStructure('FACT', House.Spain, 5, 5, { ironCurtainTicks: 3 });

    for (let i = 0; i < 3; i++) {
      if (struct.ironCurtainTicks && struct.ironCurtainTicks > 0) {
        struct.ironCurtainTicks--;
      }
    }

    expect(struct.ironCurtainTicks).toBe(0);
  });

  it('timer does not go below zero', () => {
    // C++ CDTimerClass: if (value < remain) return(remain - value); else return(0);
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);
    tank.ironCurtainTick = 1;

    // Decrement once to reach 0
    if (tank.ironCurtainTick > 0) tank.ironCurtainTick--;
    expect(tank.ironCurtainTick).toBe(0);

    // Decrement again — should stay at 0
    if (tank.ironCurtainTick > 0) tank.ironCurtainTick--;
    expect(tank.ironCurtainTick).toBe(0);
  });

  it('full duration countdown: unit becomes vulnerable exactly when timer reaches 0', () => {
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);
    tank.ironCurtainTick = IRON_CURTAIN_DURATION;

    // Simulate IRON_CURTAIN_DURATION - 1 ticks — should still be invulnerable
    for (let i = 0; i < IRON_CURTAIN_DURATION - 1; i++) {
      if (tank.ironCurtainTick > 0) tank.ironCurtainTick--;
    }
    expect(tank.ironCurtainTick).toBe(1);
    expect(tank.isInvulnerable).toBe(true);

    // One more tick — expires
    if (tank.ironCurtainTick > 0) tank.ironCurtainTick--;
    expect(tank.ironCurtainTick).toBe(0);
    expect(tank.isInvulnerable).toBe(false);
  });
});

// =============================================================================
// 5. Re-application — C++ house.cpp:2751 (simple assignment, not additive)
// =============================================================================

describe('Iron Curtain re-application (C++ house.cpp:2751)', () => {

  it('re-applying Iron Curtain resets timer to full (C++ simple assignment)', () => {
    // C++ house.cpp:2751 — tech->IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_MINUTE
    // This is a simple assignment, not +=. Re-application replaces the timer.
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 6 * CELL_SIZE, 6 * CELL_SIZE);
    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      entities: [tank],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    // Apply Iron Curtain
    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, tank.pos);
    expect(tank.ironCurtainTick).toBe(IRON_CURTAIN_DURATION);

    // Simulate some ticks passing
    tank.ironCurtainTick = 100; // partially expired

    // Re-apply — timer should reset to full, not add
    const swState2 = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx2 = makeSuperweaponCtx({
      entities: [tank],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState2]]),
    });
    activateSuperweapon(ctx2, SuperweaponType.IRON_CURTAIN, House.Spain, tank.pos);

    // Should be full duration again, not 100 + IRON_CURTAIN_DURATION
    expect(tank.ironCurtainTick).toBe(IRON_CURTAIN_DURATION);
  });

  it('re-applying Iron Curtain to structure resets timer', () => {
    const struct = makeStructure('FACT', House.Spain, 5, 5, { ironCurtainTicks: 100 });
    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      structures: [struct],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    const [sw, sh] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    const targetX = (struct.cx + sw / 2) * CELL_SIZE;
    const targetY = (struct.cy + sh / 2) * CELL_SIZE;

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, { x: targetX, y: targetY });

    // Should be full duration, not 100 + IRON_CURTAIN_DURATION
    expect(struct.ironCurtainTicks).toBe(IRON_CURTAIN_DURATION);
  });
});

// =============================================================================
// 6. Infantry exclusion — C++ house.cpp:2746-2763
// =============================================================================

describe('Infantry cannot receive Iron Curtain (C++ house.cpp:2746-2763)', () => {

  it('C++ switch only handles RTTI_UNIT, RTTI_BUILDING, RTTI_VESSEL, RTTI_AIRCRAFT — not RTTI_INFANTRY', () => {
    // C++ house.cpp:2746-2763:
    //   switch (tech->What_Am_I()) {
    //     case RTTI_UNIT:
    //     case RTTI_BUILDING:
    //     case RTTI_VESSEL:
    //     case RTTI_AIRCRAFT:
    //       tech->IronCurtainCountDown = ...
    //     default: break;   ← infantry falls through here
    //   }
    //
    // TS superweapon.ts:444 — searches ALL entities with no type filter.
    // PARITY GAP: TS allows Iron Curtain on infantry, C++ does not.

    const infantry = new Entity(UnitType.I_E1, House.Spain, 6 * CELL_SIZE, 6 * CELL_SIZE);
    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      entities: [infantry],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, infantry.pos);

    // C++ expected: infantry should NOT receive Iron Curtain (default:break in switch)
    expect(infantry.ironCurtainTick).toBe(0); // PARITY GAP — TS sets it to IRON_CURTAIN_DURATION
  });
});

// =============================================================================
// 7. Demo Truck special case — C++ house.cpp:2753-2755 (FIXIT_CSII)
// =============================================================================

describe('Demo Truck shortened Iron Curtain (C++ house.cpp:2753-2755 FIXIT_CSII)', () => {

  it('C++ demo truck duration is TICKS_PER_SECOND not TICKS_PER_MINUTE = 7 ticks', () => {
    // C++ house.cpp:2753-2755 (FIXIT_CSII):
    //   if (tech->What_Am_I() == RTTI_UNIT && *(UnitClass *)tech == UNIT_DEMOTRUCK) {
    //     tech->IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_SECOND;
    //   }
    // = 0.5 * 15 = 7.5, integer truncation → 7 ticks
    expect(CPP_DEMO_TRUCK_IC_TICKS).toBe(7);
  });

  it('TS should give Demo Truck shortened Iron Curtain duration', () => {
    // PARITY GAP: TS uses IRON_CURTAIN_DURATION (675) for all units including Demo Truck.
    // C++ overrides it to 7 ticks for Demo Truck.
    const demoTruck = new Entity(UnitType.V_DTRK, House.Spain, 6 * CELL_SIZE, 6 * CELL_SIZE);
    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      entities: [demoTruck],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, demoTruck.pos);

    // C++ expected: Demo Truck gets shortened duration (7 ticks, not full duration)
    expect(demoTruck.ironCurtainTick).toBe(CPP_DEMO_TRUCK_IC_TICKS); // PARITY GAP
  });
});

// =============================================================================
// 8. Damage blocked for exact duration window — end-to-end timer test
// =============================================================================

describe('End-to-end Iron Curtain timer lifecycle', () => {

  it('unit is protected for exactly the duration, then takes damage', () => {
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);
    const hpBefore = tank.hp;
    tank.ironCurtainTick = 10;

    // Protected for 10 ticks
    for (let tick = 0; tick < 10; tick++) {
      tank.takeDamage(100, 'HE');
      expect(tank.hp, `tick ${tick}: should still be protected`).toBe(hpBefore);
      if (tank.ironCurtainTick > 0) tank.ironCurtainTick--;
    }

    // Tick 10: timer is now 0, damage should apply
    expect(tank.ironCurtainTick).toBe(0);
    expect(tank.isInvulnerable).toBe(false);
    tank.takeDamage(50, 'HE');
    expect(tank.hp).toBeLessThan(hpBefore);
  });

  it('structure is protected for exactly the duration, then takes damage', () => {
    const struct = makeStructure('FACT', House.Spain, 5, 5, { ironCurtainTicks: 5 });
    const ctx = makeCombatCtx([struct]);
    const hpBefore = struct.hp;

    // Protected for 5 ticks
    for (let tick = 0; tick < 5; tick++) {
      structureDamage(ctx, struct, 100);
      expect(struct.hp, `tick ${tick}: should still be protected`).toBe(hpBefore);
      if (struct.ironCurtainTicks && struct.ironCurtainTicks > 0) {
        struct.ironCurtainTicks--;
      }
    }

    // Tick 5: expired
    expect(struct.ironCurtainTicks).toBe(0);
    structureDamage(ctx, struct, 50);
    expect(struct.hp).toBe(hpBefore - 50);
  });
});

// =============================================================================
// 9. Visual indicator — C++ techno.cpp:4274
// =============================================================================

describe('Visual indicator while Iron Curtain is active (C++ techno.cpp:4274)', () => {

  it('isInvulnerable is true while ironCurtainTick > 0 (renderer uses this for red fade)', () => {
    // C++ techno.cpp:4274 — if (IronCurtainCountDown > 0) { remap = FadingRed; }
    // TS renderer.ts:2084 — if (entity.alive && entity.ironCurtainTick > 0) { ... }
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);

    tank.ironCurtainTick = 5;
    expect(tank.isInvulnerable).toBe(true);

    // Decrement to 1 — still active
    tank.ironCurtainTick = 1;
    expect(tank.isInvulnerable).toBe(true);

    // Decrement to 0 — no longer active
    tank.ironCurtainTick = 0;
    expect(tank.isInvulnerable).toBe(false);
  });
});

// =============================================================================
// 10. Invulnerability source independence — crate vs Iron Curtain
// =============================================================================

describe('Iron Curtain vs crate invulnerability are independent', () => {

  it('invulnTick and ironCurtainTick are separate timers', () => {
    // C++ has a single IronCurtainCountDown for both sources, but TS separates them.
    // This is a TS design choice. Verify both contribute to isInvulnerable.
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);

    // Only crate invuln
    tank.invulnTick = 10;
    tank.ironCurtainTick = 0;
    expect(tank.isInvulnerable).toBe(true);

    // Only Iron Curtain
    tank.invulnTick = 0;
    tank.ironCurtainTick = 10;
    expect(tank.isInvulnerable).toBe(true);

    // Both expired
    tank.invulnTick = 0;
    tank.ironCurtainTick = 0;
    expect(tank.isInvulnerable).toBe(false);

    // Both active
    tank.invulnTick = 5;
    tank.ironCurtainTick = 10;
    expect(tank.isInvulnerable).toBe(true);
  });
});

// =============================================================================
// 11. Edge cases
// =============================================================================

describe('Edge cases', () => {

  it('applying Iron Curtain to already-invulnerable unit (crate) still sets ironCurtainTick', () => {
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 6 * CELL_SIZE, 6 * CELL_SIZE);
    tank.invulnTick = 500; // already invulnerable from crate

    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      entities: [tank],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, tank.pos);

    // Both timers should now be set
    expect(tank.invulnTick).toBe(500);
    expect(tank.ironCurtainTick).toBe(IRON_CURTAIN_DURATION);
  });

  it('dead entity does not gain Iron Curtain protection', () => {
    // C++ house.cpp:2744 — Cell_Techno would not return a dead object
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 6 * CELL_SIZE, 6 * CELL_SIZE);
    tank.alive = false;

    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      entities: [tank],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, tank.pos);

    expect(tank.ironCurtainTick).toBe(0);
  });

  it('dead structure does not gain Iron Curtain protection', () => {
    const struct = makeStructure('FACT', House.Spain, 5, 5, { alive: false });
    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      structures: [struct],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    const [sw, sh] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    const targetX = (struct.cx + sw / 2) * CELL_SIZE;
    const targetY = (struct.cy + sh / 2) * CELL_SIZE;

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, { x: targetX, y: targetY });

    expect(struct.ironCurtainTicks).toBeUndefined();
  });
});
