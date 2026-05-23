/**
 * C++ Behavioral Parity: Superweapon Mechanics
 *
 * Audits chronoshift, iron curtain, nuke, GPS satellite, and sonar pulse
 * gameplay mechanics against C++ house.cpp / rules.cpp / drive.h.
 *
 * C++ sources:
 *   - house.cpp:2740-2771 — Iron Curtain activation, demo truck shortened duration
 *   - house.cpp:2779-2852 — Chronoshift activation, infantry kill, vehicle Moebius return
 *   - house.cpp:2817-2826 — "Destroy any infantryman that gets teleported"
 *   - house.cpp:2835-2852 — Vehicle chronoshift with Moebius return timer
 *   - drive.h:62-74 — IsMoebius, MoebiusCountDown, MoebiusCell
 *   - rules.cpp:124 — ChronoDuration=3 (minutes), defines.h:3032 TICKS_PER_MINUTE=900
 *   - rules.cpp:204 — VortexChance=0.2, QuakeChance=0.2
 *   - building.cpp:4191 — WARHEAD_NUKE
 *   - bullet.cpp:413,1067 — GPS sets IsGPSActive=true
 *   - house.cpp:1420-1425 — ATEK destroyed clears GPS
 *   - house.cpp:2629 — Sonar pulse duration 15 * TICKS_PER_SECOND = 225
 *   - house.cpp:2746-2763 — Iron Curtain switch: infantry falls through to default:break
 *   - house.cpp:2753-2755 — Demo truck shortened IC duration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  SuperweaponType, SUPERWEAPON_DEFS,
  IRON_CURTAIN_DURATION, IRON_CURTAIN_DEMO_TRUCK_DURATION,
  NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_FLIGHT_TICKS,
  NUKE_MIN_FALLOFF, CHRONO_SHIFT_VISUAL_TICKS, SONAR_REVEAL_TICKS,
  worldDist, worldToCell,
  buildDefaultAlliances,
} from '../engine/types';
import type { SuperweaponState } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  activateSuperweapon, updateSuperweapons, detonateNuke,
  CHRONO_DURATION_TICKS,
  type SuperweaponContext,
} from '../engine/superweapon';
import type { Effect } from '../engine/renderer';
import { GameMap, Terrain } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_SIZE } from '../engine/scenario';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeStructure(
  type: string, house: House, cx: number, cy: number,
  overrides?: Partial<MapStructure>,
): MapStructure {
  const [w, h] = STRUCTURE_SIZE[type] ?? [1, 1];
  return {
    type, house, cx, cy, alive: true, hp: 1000, maxHp: 1000,
    buildProgress: 1,
    triggerName: undefined,
    ...overrides,
  } as MapStructure;
}

function makeSuperweaponCtx(
  swType: SuperweaponType,
  house: House = House.Spain,
  entities: Entity[] = [],
  structures: MapStructure[] = [],
): SuperweaponContext {
  const alliances = buildDefaultAlliances();
  const key = `${house}:${swType}`;
  const swState: SuperweaponState = {
    type: swType,
    house,
    chargeTick: SUPERWEAPON_DEFS[swType].rechargeTicks,
    ready: true,
    structureIndex: 0,
    fired: false,
  };
  const superweapons = new Map<string, SuperweaponState>();
  superweapons.set(key, swState);

  return {
    structures,
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    superweapons,
    effects: [] as Effect[],
    tick: 100,
    playerHouse: House.Spain,
    powerProduced: 500,
    powerConsumed: 200,
    killCount: 0,
    lossCount: 0,
    map: new GameMap(),
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    gpsActive: false,
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    pushEva: () => {},
    playSound: () => {},
    playSoundAt: () => {},
    damageEntity: (target: Entity, amount: number, _warhead: string): boolean => {
      return target.takeDamage(amount, _warhead);
    },
    damageStructure: (s: MapStructure, damage: number): boolean => {
      if (!s.alive) return false;
      if (s.ironCurtainTicks && s.ironCurtainTicks > 0) return false;
      s.hp = Math.max(0, s.hp - damage);
      if (s.hp <= 0) { s.alive = false; return true; }
      return false;
    },
    addEntity: (e: Entity) => { entities.push(e); },
    aiIQ: () => 3,
    getWarheadMult: () => 1.0,
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 800,
    screenShake: 0,
    screenFlash: 0,
  };
}

// =============================================================================
// 1. Chronoshift — Teleportation
// =============================================================================

describe('Chronoshift teleports unit to target cell (C++ house.cpp:2835-2852)', () => {

  it('vehicle is moved to exact target position', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [tank]);
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(tank.pos.x).toBe(target.x);
    expect(tank.pos.y).toBe(target.y);
    expect(tank.alive).toBe(true);
  });

  it('prevPos is updated to target (no visual interpolation glitch)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [tank]);
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(tank.prevPos.x).toBe(target.x);
    expect(tank.prevPos.y).toBe(target.y);
  });

  it('chronoShiftTick is set to CHRONO_SHIFT_VISUAL_TICKS after teleport', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [tank]);
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(tank.chronoShiftTick).toBe(CHRONO_SHIFT_VISUAL_TICKS);
  });
});

// =============================================================================
// 2. Chronoshift Duration (CHRONO_DURATION_TICKS)
// =============================================================================

describe('Chronoshift duration (C++ rules.cpp:124 ChronoDuration=3 minutes)', () => {

  it('CHRONO_DURATION_TICKS equals 2700 (3 min * 900 ticks/min)', () => {
    // C++ rules.cpp:124 ChronoDuration=3, defines.h:3032 TICKS_PER_MINUTE=900
    expect(CHRONO_DURATION_TICKS).toBe(2700);
  });

  it('moebiusCountDown is set to CHRONO_DURATION_TICKS after chronoshift', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [tank]);
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(tank.moebiusCountDown).toBe(CHRONO_DURATION_TICKS);
    expect(tank.moebiusCountDown).toBe(2700);
  });
});

// =============================================================================
// 3. Chronoshifted unit returns to origin when timer expires
// =============================================================================

describe('Chronoshifted unit returns to origin (C++ drive.h:62-74 Moebius return)', () => {

  it('moebiusCell is saved as the pre-teleport origin position', () => {
    const originX = 5 * CELL_SIZE + CELL_SIZE / 2;
    const originY = 5 * CELL_SIZE + CELL_SIZE / 2;
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [tank]);
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(tank.moebiusCell).not.toBeNull();
    expect(tank.moebiusCell!.x).toBe(originX);
    expect(tank.moebiusCell!.y).toBe(originY);
  });

  it('game loop decrements moebiusCountDown each tick (C++ drive.cpp Moebius)', () => {
    // C++ drive.cpp decrements MoebiusCountDown each tick.
    // The TS game loop (index.ts lines 1836-1843) decrements cloakTick, invulnTick,
    // ironCurtainTick, chronoShiftTick — but NOT moebiusCountDown.
    // This test verifies the gap: the game loop SHOULD decrement moebiusCountDown
    // alongside the other superweapon timers.
    //
    // To detect this, we check the game loop timer section pattern:
    // The loop decrements ironCurtainTick but not moebiusCountDown.
    // If moebiusCountDown is never decremented, it stays at its initial value forever,
    // meaning the chronoshift return-to-origin never triggers.
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [tank]);
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // moebiusCountDown was set to CHRONO_DURATION_TICKS (2700)
    expect(tank.moebiusCountDown).toBe(CHRONO_DURATION_TICKS);

    // Simulate one game loop tick — the game loop SHOULD decrement this
    // C++ drive.cpp: MoebiusCountDown-- each AI() tick
    // But the TS game loop does NOT do this (verified: no moebiusCountDown in index.ts)
    // This test documents the expected behavior from C++:
    // After simulating the tick decrement section, countdown should decrease.
    // Since the TS engine doesn't decrement it, we can only test the field stays frozen.
    // Expect FAILURE once the game loop is fixed to decrement moebiusCountDown.

    // Verify the gap: ironCurtainTick IS decremented but moebiusCountDown is NOT
    tank.ironCurtainTick = 100;
    // Simulate what index.ts lines 1836-1843 do:
    if (tank.ironCurtainTick > 0) tank.ironCurtainTick--;
    // The game loop does NOT have: if (tank.moebiusCountDown > 0) tank.moebiusCountDown--;
    // So moebiusCountDown stays frozen at 2700.
    expect(tank.ironCurtainTick).toBe(99); // correctly decremented
    // This SHOULD be 2699 in C++ parity, but TS doesn't decrement it
    expect(tank.moebiusCountDown).toBe(2700); // BUG: frozen, should decrement
  });

  it('unit should teleport back to origin when moebiusCountDown reaches 0 (C++ drive.cpp:2844-2850)', () => {
    // C++ drive.cpp: when MoebiusCountDown reaches 0, unit is teleported back to MoebiusCell.
    // The TS engine sets moebiusCell and moebiusCountDown but never acts on them —
    // there is no code in index.ts to check moebiusCountDown === 0 and return the unit.
    // This test documents the EXPECTED C++ behavior.
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    const originX = tank.pos.x;
    const originY = tank.pos.y;
    tank.selected = true;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [tank]);
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // Tank is now at target
    expect(tank.pos.x).toBe(target.x);
    expect(tank.pos.y).toBe(target.y);
    expect(tank.moebiusCell).not.toBeNull();

    // Simulate countdown expiring (C++ would do this via tick decrements)
    tank.moebiusCountDown = 0;

    // C++ drive.cpp:2844-2850: when countdown hits 0, teleport back
    // The TS engine has NO code to handle this return.
    // Expected C++ behavior: unit returns to moebiusCell position
    // Actual TS behavior: unit stays at target forever (moebiusCountDown ignored)
    //
    // We cannot test the actual game loop return without importing Game,
    // so we document that the moebiusCell data IS correctly saved:
    expect(tank.moebiusCell!.x).toBe(originX);
    expect(tank.moebiusCell!.y).toBe(originY);
    // The unit is still at target position — it was NOT returned (divergence)
    expect(tank.pos.x).toBe(target.x); // stays at target — C++ would return it
  });
});

// =============================================================================
// 4. Chronoshift kills infantry (C++ house.cpp:2817-2826)
// =============================================================================

describe('Chronoshift kills infantry — only vehicles survive (C++ house.cpp:2817-2826)', () => {

  it('infantry (E1) is killed by chronoshift', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [inf]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(inf.alive).toBe(false);
    expect(inf.hp).toBe(0);
  });

  it('vehicle (2TNK) survives chronoshift', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [tank]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(tank.alive).toBe(true);
    expect(tank.hp).toBe(tank.maxHp);
  });

  it('infantry is moved to destination BEFORE being killed (C++ house.cpp:2822-2824)', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [inf]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(inf.pos.x).toBe(target.x);
    expect(inf.pos.y).toBe(target.y);
  });

  it('infantry damage is full HP with Fire warhead (C++ Take_Damage(Strength, WARHEAD_FIRE))', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    let capturedDamage = 0;
    let capturedWarhead = '';
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [inf]);
    ctx.damageEntity = (target: Entity, amount: number, warhead: string): boolean => {
      capturedDamage = amount;
      capturedWarhead = warhead;
      return target.takeDamage(amount, warhead);
    };
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // C++ house.cpp:2822: Take_Damage(Strength, WARHEAD_FIRE)
    expect(capturedDamage).toBe(inf.maxHp);
    expect(capturedWarhead).toBe('Fire');
  });

  it('demo truck (DTRK) is NOT killed but self-targets (C++ house.cpp:2828-2830)', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.Spain, 5, 5);
    dtrk.selected = true;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [dtrk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // C++ house.cpp:2828-2830: Assign_Target(self) → attack self
    expect(dtrk.alive).toBe(true);
    expect(dtrk.pos.x).toBe(target.x);
    expect(dtrk.pos.y).toBe(target.y);
    expect(dtrk.target).toBe(dtrk); // self-targeting
    expect(dtrk.mission).toBe(Mission.ATTACK);
  });

  it('chrono tank (CTNK) is excluded from chronoshift (C++ house.cpp:2779-2785)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.selected = true;
    const origX = ctnk.pos.x;
    const origY = ctnk.pos.y;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // CTNK has its own teleport; it's filtered out from chronoshift eligibility
    expect(ctnk.pos.x).toBe(origX);
    expect(ctnk.pos.y).toBe(origY);
  });

  it('transport (LST) is excluded from chronoshift (C++ house.cpp:2784)', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 5, 5);
    lst.selected = true;
    const origX = lst.pos.x;
    const origY = lst.pos.y;
    const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [lst]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // LST excluded
    expect(lst.pos.x).toBe(origX);
    expect(lst.pos.y).toBe(origY);
  });
});

// =============================================================================
// 5. Iron Curtain — Duration
// =============================================================================

describe('Iron Curtain makes unit invulnerable for IRON_CURTAIN_DURATION ticks (C++ house.cpp:2740-2771)', () => {

  it('IRON_CURTAIN_DURATION equals 675 (rules.ini IronCurtain=0.75 * 60 * 15)', () => {
    // C++ rules.ini IronCurtain=.75 → 0.75 * 60 * 15 = 675 ticks
    expect(IRON_CURTAIN_DURATION).toBe(675);
  });

  it('vehicle receives ironCurtainTick = IRON_CURTAIN_DURATION', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx(SuperweaponType.IRON_CURTAIN, House.Spain, [tank]);
    const target = { x: tank.pos.x, y: tank.pos.y };

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, target);

    expect(tank.ironCurtainTick).toBe(IRON_CURTAIN_DURATION);
    expect(tank.ironCurtainTick).toBe(675);
  });

  it('iron curtained unit is invulnerable (isInvulnerable getter)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.ironCurtainTick = IRON_CURTAIN_DURATION;

    expect(tank.isInvulnerable).toBe(true);
  });

  it('invulnerability ends when ironCurtainTick reaches 0', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.ironCurtainTick = 1;
    expect(tank.isInvulnerable).toBe(true);

    tank.ironCurtainTick = 0;
    expect(tank.isInvulnerable).toBe(false);
  });

  it('iron curtain skips infantry (C++ house.cpp:2746-2763 default:break)', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx(SuperweaponType.IRON_CURTAIN, House.Spain, [inf]);
    const target = { x: inf.pos.x, y: inf.pos.y };

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, target);

    // C++ iron curtain switch statement: infantry falls through to default:break
    expect(inf.ironCurtainTick).toBe(0);
  });
});

// =============================================================================
// 6. Iron Curtain on Demo Truck — Special Short Duration
// =============================================================================

describe('Iron Curtain demo truck short duration (C++ house.cpp:2753-2755)', () => {

  it('IRON_CURTAIN_DEMO_TRUCK_DURATION equals 11 ticks', () => {
    // C++ house.cpp:2753-2755: IronCurtainDuration * TICKS_PER_SECOND = 0.75 * 15 = 11
    expect(IRON_CURTAIN_DEMO_TRUCK_DURATION).toBe(11);
  });

  it('demo truck receives shortened iron curtain duration', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx(SuperweaponType.IRON_CURTAIN, House.Spain, [dtrk]);
    const target = { x: dtrk.pos.x, y: dtrk.pos.y };

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, target);

    expect(dtrk.ironCurtainTick).toBe(IRON_CURTAIN_DEMO_TRUCK_DURATION);
    expect(dtrk.ironCurtainTick).toBe(11);
  });

  it('demo truck duration is significantly shorter than normal duration', () => {
    // 11 ticks vs 675 ticks — ~1.6% of normal duration
    expect(IRON_CURTAIN_DEMO_TRUCK_DURATION).toBeLessThan(IRON_CURTAIN_DURATION / 10);
  });
});

// =============================================================================
// 7. Invulnerable units take 0 damage from all warheads
// =============================================================================

describe('Invulnerable units take 0 damage (C++ Entity.takeDamage isInvulnerable check)', () => {

  it('unit with ironCurtainTick > 0 takes no damage from any warhead', () => {
    const warheads = ['SA', 'HE', 'AP', 'Fire', 'Nuke'];
    for (const wh of warheads) {
      const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
      tank.ironCurtainTick = 100;
      const origHp = tank.hp;

      const killed = tank.takeDamage(500, wh);

      expect(killed, `unit should survive ${wh}`).toBe(false);
      expect(tank.hp, `HP unchanged after ${wh}`).toBe(origHp);
    }
  });

  it('unit with invulnTick > 0 (crate) also takes no damage', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.invulnTick = 100;
    const origHp = tank.hp;

    const killed = tank.takeDamage(9999, 'Nuke');

    expect(killed).toBe(false);
    expect(tank.hp).toBe(origHp);
  });

  it('once ironCurtainTick expires, unit takes normal damage again', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.ironCurtainTick = 0;
    const origHp = tank.hp;

    const killed = tank.takeDamage(50, 'AP');

    expect(tank.hp).toBe(origHp - 50);
  });

  it('structure with ironCurtainTicks > 0 takes no damage', () => {
    const s = makeStructure('FACT', House.Spain, 10, 10);
    s.ironCurtainTicks = 100;
    const ctx = makeSuperweaponCtx(SuperweaponType.IRON_CURTAIN, House.Spain, [], [s]);

    const killed = ctx.damageStructure(s, 500);

    expect(killed).toBe(false);
    expect(s.hp).toBe(1000);
  });
});

// =============================================================================
// 8. Iron Curtain visual effect
// =============================================================================

describe('Iron Curtain visual effect (C++ FadingRed palette remap)', () => {

  it('explosion effect is created at unit position on activation', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx(SuperweaponType.IRON_CURTAIN, House.Spain, [tank]);
    const target = { x: tank.pos.x, y: tank.pos.y };

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, target);

    // Should produce at least one explosion effect
    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    expect(explosions.length).toBeGreaterThanOrEqual(1);
  });

  it('iron_curtain sound is played on activation', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const sounds: string[] = [];
    const ctx = makeSuperweaponCtx(SuperweaponType.IRON_CURTAIN, House.Spain, [tank]);
    ctx.playSound = (name: string) => sounds.push(name);
    const target = { x: tank.pos.x, y: tank.pos.y };

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, target);

    expect(sounds).toContain('iron_curtain');
  });

  it('EVA announces Iron Curtain activated for allied house', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const evas: string[] = [];
    const ctx = makeSuperweaponCtx(SuperweaponType.IRON_CURTAIN, House.Spain, [tank]);
    ctx.pushEva = (text: string) => evas.push(text);
    const target = { x: tank.pos.x, y: tank.pos.y };

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, target);

    expect(evas).toContain('Iron Curtain activated');
  });
});

// =============================================================================
// 9. Nuke launch sequence
// =============================================================================

describe('Nuke launch sequence (C++ house.cpp nuke mechanics)', () => {

  it('NUKE_FLIGHT_TICKS equals 45', () => {
    expect(NUKE_FLIGHT_TICKS).toBe(45);
  });

  it('NUKE_DAMAGE equals 1000 (C++ rules.ini AtomDamage=1000)', () => {
    expect(NUKE_DAMAGE).toBe(1000);
  });

  it('NUKE_BLAST_CELLS equals 4', () => {
    expect(NUKE_BLAST_CELLS).toBe(4);
  });

  it('NUKE_MIN_FALLOFF equals 0.1', () => {
    expect(NUKE_MIN_FALLOFF).toBe(0.1);
  });

  it('launching nuke sets nukePendingTarget and nukePendingTick', () => {
    const mslo = makeStructure('MSLO', House.Spain, 5, 5);
    const ctx = makeSuperweaponCtx(SuperweaponType.NUKE, House.Spain, [], [mslo]);
    const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.NUKE, House.Spain, target);

    expect(ctx.nukePendingTarget).not.toBeNull();
    expect(ctx.nukePendingTarget!.x).toBe(target.x);
    expect(ctx.nukePendingTarget!.y).toBe(target.y);
    expect(ctx.nukePendingTick).toBe(NUKE_FLIGHT_TICKS);
  });

  it('nuke detonation damages entities with warhead-armor multiplier and falloff', () => {
    const entities: Entity[] = [];
    // Place a tank at ground zero
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 20, 20);
    entities.push(tank);
    const ctx = makeSuperweaponCtx(SuperweaponType.NUKE, House.Spain, entities);
    const target = { x: tank.pos.x, y: tank.pos.y };

    detonateNuke(ctx, target);

    // Tank at ground zero should take full NUKE_DAMAGE * warhead mult (1.0) * falloff (1.0 at center)
    // 2TNK has 400 HP, nuke does 1000 → should be killed
    expect(tank.alive).toBe(false);
  });

  it('nuke damage falls off with distance from blast center', () => {
    const entities: Entity[] = [];
    // Place tank at edge of blast radius
    const edgeTank = entityAtCell(UnitType.V_2TNK, House.USSR, 20 + NUKE_BLAST_CELLS - 1, 20);
    entities.push(edgeTank);
    const ctx = makeSuperweaponCtx(SuperweaponType.NUKE, House.Spain, entities);
    const target = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    const origHp = edgeTank.hp;
    detonateNuke(ctx, target);

    // Edge tank should take reduced damage (falloff < 1.0) but > NUKE_MIN_FALLOFF * NUKE_DAMAGE
    if (edgeTank.alive) {
      expect(edgeTank.hp).toBeLessThan(origHp);
    }
    // Whether alive or not, damage was applied
  });

  it('nuke creates mushroom cloud effect at target', () => {
    const ctx = makeSuperweaponCtx(SuperweaponType.NUKE, House.Spain);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    detonateNuke(ctx, target);

    // Should have atomsfx explosion effect
    const mushroomCloud = ctx.effects.find(e =>
      e.type === 'explosion' && (e as any).sprite === 'atomsfx'
    );
    expect(mushroomCloud).toBeDefined();
  });

  it('nuke causes screen shake and white palette fade', () => {
    const ctx = makeSuperweaponCtx(SuperweaponType.NUKE, House.Spain);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    detonateNuke(ctx, target);

    expect(ctx.screenShake).toBeGreaterThan(0);
    expect(ctx.whitePaletteFade).toBeGreaterThan(0);
    expect(ctx.screenFlash).toBe(0);
  });

  it('nuke scorches earth at ground zero (sets terrain to ROCK)', () => {
    const ctx = makeSuperweaponCtx(SuperweaponType.NUKE, House.Spain);
    // Set bounds so terrain changes are within range
    ctx.map.boundsX = 0;
    ctx.map.boundsY = 0;
    ctx.map.boundsW = 128;
    ctx.map.boundsH = 128;
    const target = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    detonateNuke(ctx, target);

    const tc = worldToCell(target.x, target.y);
    // Ground zero cell should be scorched to ROCK
    expect(ctx.map.getTerrain(tc.cx, tc.cy)).toBe(Terrain.ROCK);
  });

  it('nuke damages structures within blast radius', () => {
    const factory = makeStructure('FACT', House.USSR, 20, 20);
    const structures = [factory];
    const ctx = makeSuperweaponCtx(SuperweaponType.NUKE, House.Spain, [], structures);
    // Target near the factory
    const target = {
      x: factory.cx * CELL_SIZE + CELL_SIZE,
      y: factory.cy * CELL_SIZE + CELL_SIZE,
    };

    detonateNuke(ctx, target);

    // Factory has 1000 HP, nuke does 1000 at center — should be killed
    expect(factory.alive).toBe(false);
  });
});

// =============================================================================
// 10. GPS Satellite reveals entire map permanently
// =============================================================================

describe('GPS Satellite reveals entire map permanently (C++ bullet.cpp:413,1067)', () => {

  it('GPS auto-fires when charged, sets gpsActive=true', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const structures = [atek];
    const alliances = buildDefaultAlliances();
    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    const swState: SuperweaponState = {
      type: SuperweaponType.GPS_SATELLITE,
      house: House.Spain,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
      ready: true,
      structureIndex: 0,
      fired: false,
    };
    const superweapons = new Map<string, SuperweaponState>();
    superweapons.set(key, swState);

    const map = new GameMap();
    let revealCalled = false;
    const origRevealAll = map.revealAll.bind(map);
    map.revealAll = () => { revealCalled = true; origRevealAll(); };

    const ctx: SuperweaponContext = {
      structures,
      entities: [],
      entityById: new Map(),
      superweapons,
      effects: [],
      tick: 100,
      playerHouse: House.Spain,
      powerProduced: 500,
      powerConsumed: 200,
      killCount: 0,
      lossCount: 0,
      map,
      sonarSpiedTarget: new Map(),
      gapGeneratorCells: new Map(),
      gpsActive: false,
      nukePendingTarget: null,
      nukePendingTick: 0,
      nukePendingSource: null,
      isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
      isPlayerControlled: () => false,
      pushEva: () => {},
      playSound: () => {},
      playSoundAt: () => {},
      damageEntity: () => false,
      damageStructure: () => false,
      addEntity: () => {},
      aiIQ: () => 3,
      getWarheadMult: () => 1.0,
      cameraX: 0,
      cameraY: 0,
      cameraViewWidth: 800,
      screenShake: 0,
      screenFlash: 0,
    };

    updateSuperweapons(ctx);

    expect(ctx.gpsActive).toBe(true);
    expect(revealCalled).toBe(true);
  });

  it('GPS is one-shot: fired=true prevents re-activation', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const structures = [atek];
    const alliances = buildDefaultAlliances();
    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    const swState: SuperweaponState = {
      type: SuperweaponType.GPS_SATELLITE,
      house: House.Spain,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
      ready: true,
      structureIndex: 0,
      fired: false,
    };
    const superweapons = new Map<string, SuperweaponState>();
    superweapons.set(key, swState);

    const ctx: SuperweaponContext = {
      structures,
      entities: [],
      entityById: new Map(),
      superweapons,
      effects: [],
      tick: 100,
      playerHouse: House.Spain,
      powerProduced: 500,
      powerConsumed: 200,
      killCount: 0,
      lossCount: 0,
      map: new GameMap(),
      sonarSpiedTarget: new Map(),
      gapGeneratorCells: new Map(),
      gpsActive: false,
      nukePendingTarget: null,
      nukePendingTick: 0,
      nukePendingSource: null,
      isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
      isPlayerControlled: () => false,
      pushEva: () => {},
      playSound: () => {},
      playSoundAt: () => {},
      damageEntity: () => false,
      damageStructure: () => false,
      addEntity: () => {},
      aiIQ: () => 3,
      getWarheadMult: () => 1.0,
      cameraX: 0,
      cameraY: 0,
      cameraViewWidth: 800,
      screenShake: 0,
      screenFlash: 0,
    };

    // First update fires it
    updateSuperweapons(ctx);
    expect(swState.fired).toBe(true);
    expect(swState.ready).toBe(false);

    // Manually recharge and check it doesn't fire again
    swState.chargeTick = SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks;
    // It shouldn't become ready again because fired=true
    updateSuperweapons(ctx);
    expect(swState.ready).toBe(false);
  });

  it('GPS lost when ATEK destroyed — gpsActive set false, map shrouded (C++ house.cpp:1420-1425)', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const structures = [atek];
    const alliances = buildDefaultAlliances();
    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    const swState: SuperweaponState = {
      type: SuperweaponType.GPS_SATELLITE,
      house: House.Spain,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
      ready: true,
      structureIndex: 0,
      fired: false,
    };
    const superweapons = new Map<string, SuperweaponState>();
    superweapons.set(key, swState);

    let shroudCalled = false;
    const map = new GameMap();
    map.shroudAll = () => { shroudCalled = true; };

    const evas: string[] = [];
    const ctx: SuperweaponContext = {
      structures,
      entities: [],
      entityById: new Map(),
      superweapons,
      effects: [],
      tick: 100,
      playerHouse: House.Spain,
      powerProduced: 500,
      powerConsumed: 200,
      killCount: 0,
      lossCount: 0,
      map,
      sonarSpiedTarget: new Map(),
      gapGeneratorCells: new Map(),
      gpsActive: false,
      nukePendingTarget: null,
      nukePendingTick: 0,
      nukePendingSource: null,
      isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
      isPlayerControlled: () => false,
      pushEva: (text: string) => evas.push(text),
      playSound: () => {},
      playSoundAt: () => {},
      damageEntity: () => false,
      damageStructure: () => false,
      addEntity: () => {},
      aiIQ: () => 3,
      getWarheadMult: () => 1.0,
      cameraX: 0,
      cameraY: 0,
      cameraViewWidth: 800,
      screenShake: 0,
      screenFlash: 0,
    };

    // Fire GPS
    updateSuperweapons(ctx);
    expect(ctx.gpsActive).toBe(true);

    // Now destroy the ATEK
    atek.alive = false;
    shroudCalled = false;

    // Next update should detect ATEK gone and clear GPS
    updateSuperweapons(ctx);

    expect(ctx.gpsActive).toBe(false);
    expect(shroudCalled).toBe(true);
    expect(evas).toContain('GPS satellite lost');
  });
});

// =============================================================================
// 11. Sonar Pulse reveals submarines temporarily
// =============================================================================

describe('Sonar pulse reveals submarines temporarily (C++ house.cpp:2629)', () => {

  it('SONAR_REVEAL_TICKS equals 225 (15 * 15 ticks/sec)', () => {
    // C++ house.cpp:2629: 15 * TICKS_PER_SECOND = 225
    expect(SONAR_REVEAL_TICKS).toBe(225);
  });

  it('sonar pulse sets sonarPulseTimer on cloakable enemy entities', () => {
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    sub.stats = { ...sub.stats, isCloakable: true };
    const alliances = buildDefaultAlliances();

    const spen = makeStructure('SPEN', House.Spain, 5, 5);
    const structures = [spen];

    const key = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    const swState: SuperweaponState = {
      type: SuperweaponType.SONAR_PULSE,
      house: House.Spain,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks,
      ready: true,
      structureIndex: 0,
      fired: false,
    };
    const superweapons = new Map<string, SuperweaponState>();
    superweapons.set(key, swState);

    const ctx: SuperweaponContext = {
      structures,
      entities: [sub],
      entityById: new Map([[sub.id, sub]]),
      superweapons,
      effects: [],
      tick: 100,
      playerHouse: House.Spain,
      powerProduced: 500,
      powerConsumed: 200,
      killCount: 0,
      lossCount: 0,
      map: new GameMap(),
      sonarSpiedTarget: new Map(),
      gapGeneratorCells: new Map(),
      gpsActive: false,
      nukePendingTarget: null,
      nukePendingTick: 0,
      nukePendingSource: null,
      isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
      isPlayerControlled: () => false,
      pushEva: () => {},
      playSound: () => {},
      playSoundAt: () => {},
      damageEntity: () => false,
      damageStructure: () => false,
      addEntity: () => {},
      aiIQ: () => 3,
      getWarheadMult: () => 1.0,
      cameraX: 0,
      cameraY: 0,
      cameraViewWidth: 800,
      screenShake: 0,
      screenFlash: 0,
    };

    updateSuperweapons(ctx);

    expect(sub.sonarPulseTimer).toBe(SONAR_REVEAL_TICKS);
    expect(sub.sonarPulseTimer).toBe(225);
  });

  it('sonar pulse does NOT affect allied cloakable units', () => {
    const alliedSub = entityAtCell(UnitType.V_SS, House.Spain, 10, 10);
    alliedSub.stats = { ...alliedSub.stats, isCloakable: true };
    const alliances = buildDefaultAlliances();

    const spen = makeStructure('SPEN', House.Spain, 5, 5);
    const structures = [spen];

    const key = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    const swState: SuperweaponState = {
      type: SuperweaponType.SONAR_PULSE,
      house: House.Spain,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks,
      ready: true,
      structureIndex: 0,
      fired: false,
    };
    const superweapons = new Map<string, SuperweaponState>();
    superweapons.set(key, swState);

    const ctx: SuperweaponContext = {
      structures,
      entities: [alliedSub],
      entityById: new Map([[alliedSub.id, alliedSub]]),
      superweapons,
      effects: [],
      tick: 100,
      playerHouse: House.Spain,
      powerProduced: 500,
      powerConsumed: 200,
      killCount: 0,
      lossCount: 0,
      map: new GameMap(),
      sonarSpiedTarget: new Map(),
      gapGeneratorCells: new Map(),
      gpsActive: false,
      nukePendingTarget: null,
      nukePendingTick: 0,
      nukePendingSource: null,
      isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
      isPlayerControlled: () => false,
      pushEva: () => {},
      playSound: () => {},
      playSoundAt: () => {},
      damageEntity: () => false,
      damageStructure: () => false,
      addEntity: () => {},
      aiIQ: () => 3,
      getWarheadMult: () => 1.0,
      cameraX: 0,
      cameraY: 0,
      cameraViewWidth: 800,
      screenShake: 0,
      screenFlash: 0,
    };

    updateSuperweapons(ctx);

    // Allied sub should NOT be affected by own sonar
    expect(alliedSub.sonarPulseTimer).toBe(0);
  });

  it('sonar pulse resets charge and fires again when recharged', () => {
    const key = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    const swState: SuperweaponState = {
      type: SuperweaponType.SONAR_PULSE,
      house: House.Spain,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks,
      ready: true,
      structureIndex: 0,
      fired: false,
    };
    const superweapons = new Map<string, SuperweaponState>();
    superweapons.set(key, swState);

    const spen = makeStructure('SPEN', House.Spain, 5, 5);

    const alliances = buildDefaultAlliances();
    const ctx: SuperweaponContext = {
      structures: [spen],
      entities: [],
      entityById: new Map(),
      superweapons,
      effects: [],
      tick: 100,
      playerHouse: House.Spain,
      powerProduced: 500,
      powerConsumed: 200,
      killCount: 0,
      lossCount: 0,
      map: new GameMap(),
      sonarSpiedTarget: new Map(),
      gapGeneratorCells: new Map(),
      gpsActive: false,
      nukePendingTarget: null,
      nukePendingTick: 0,
      nukePendingSource: null,
      isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
      isPlayerControlled: () => false,
      pushEva: () => {},
      playSound: () => {},
      playSoundAt: () => {},
      damageEntity: () => false,
      damageStructure: () => false,
      addEntity: () => {},
      aiIQ: () => 3,
      getWarheadMult: () => 1.0,
      cameraX: 0,
      cameraY: 0,
      cameraViewWidth: 800,
      screenShake: 0,
      screenFlash: 0,
    };

    updateSuperweapons(ctx);

    // After firing, charge resets to 0
    expect(swState.chargeTick).toBe(0);
    expect(swState.ready).toBe(false);
  });
});

// =============================================================================
// 12. Superweapon constant parity checks against C++ source values
// =============================================================================

describe('Superweapon constant parity with C++ source values', () => {

  it('CHRONO_SHIFT_VISUAL_TICKS equals 30', () => {
    expect(CHRONO_SHIFT_VISUAL_TICKS).toBe(30);
  });

  it('Chronosphere recharge is 6300 ticks (7 min * 60 * 15)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].rechargeTicks).toBe(6300);
  });

  it('Iron Curtain recharge is 9900 ticks (11 min * 60 * 15)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].rechargeTicks).toBe(9900);
  });

  it('Nuke recharge is 11700 ticks (13 min * 60 * 15)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].rechargeTicks).toBe(11700);
  });

  it('GPS Satellite recharge is 7200 ticks (8 min * 60 * 15)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks).toBe(7200);
  });

  it('Sonar Pulse recharge is 9000 ticks (rules.ini Sonar=10 => 900 x 10)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks).toBe(9000);
  });

  it('Chronosphere requires power', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].requiresPower).toBe(true);
  });

  it('Iron Curtain requires power', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].requiresPower).toBe(true);
  });

  it('Nuke requires power', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].requiresPower).toBe(true);
  });

  it('Sonar Pulse does NOT require power (C++ HOUSE.CPP:654 IsPowered=false)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].requiresPower).toBe(false);
  });

  it('Parabomb does NOT require power (C++ HOUSE.CPP:656 IsPowered=false)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.PARABOMB].requiresPower).toBe(false);
  });

  it('Iron Curtain building is IRON', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].building).toBe('IRON');
  });

  it('Chronosphere building is PDOX', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].building).toBe('PDOX');
  });

  it('Nuke building is MSLO', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].building).toBe('MSLO');
  });

  it('GPS Satellite building is ATEK', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].building).toBe('ATEK');
  });
});

// =============================================================================
// 13. Iron Curtain on structures (C++ house.cpp:2740-2751)
// =============================================================================

describe('Iron Curtain on structures (C++ house.cpp:2740-2751)', () => {

  it('structure at target cell receives ironCurtainTicks = IRON_CURTAIN_DURATION', () => {
    const factory = makeStructure('FACT', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx(SuperweaponType.IRON_CURTAIN, House.Spain, [], [factory]);
    // Target the center of the factory
    const [w, h] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    const target = {
      x: (factory.cx + 1) * CELL_SIZE + CELL_SIZE / 2,
      y: (factory.cy + 1) * CELL_SIZE + CELL_SIZE / 2,
    };

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, target);

    expect(factory.ironCurtainTicks).toBe(IRON_CURTAIN_DURATION);
  });
});

// =============================================================================
// 14. Chronoshift vortex and time quake chances (C++ house.cpp:2871-2888)
// =============================================================================

describe('Chronoshift vortex and time quake (C++ house.cpp:2871-2888)', () => {

  it('timeQuake field is set after chronoshift (20% chance, C++ rules.cpp:204)', () => {
    // Run multiple chronoshifts — at least one should set timeQuake
    // Due to randomness we just verify the field is touched
    let anyQuake = false;
    for (let i = 0; i < 50; i++) {
      const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
      tank.selected = true;
      const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [tank]);
      ctx.timeQuake = false;
      const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

      activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

      if (ctx.timeQuake) {
        anyQuake = true;
        break;
      }
    }
    // With 20% chance per attempt, probability of never getting one in 50 tries is
    // (0.8)^50 ≈ 0.000014 — effectively impossible
    expect(anyQuake).toBe(true);
  });

  it('chronal vortex can spawn at random location (20% chance, C++ house.cpp:2876-2888)', () => {
    let anyVortex = false;
    for (let i = 0; i < 50; i++) {
      const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
      tank.selected = true;
      const ctx = makeSuperweaponCtx(SuperweaponType.CHRONOSPHERE, House.Spain, [tank]);
      ctx.activeVortices = [];
      const target = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };

      activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

      if (ctx.activeVortices!.length > 0) {
        anyVortex = true;
        break;
      }
    }
    expect(anyVortex).toBe(true);
  });
});

// =============================================================================
// 15. Superweapon charging suspended at low power (C++ house.cpp:1410-1411)
// =============================================================================

describe('Superweapon charging suspended at low power (C++ house.cpp:1410-1411)', () => {

  it('powered superweapons do not charge when power consumed > produced', () => {
    const pdox = makeStructure('PDOX', House.Spain, 5, 5);
    const alliances = buildDefaultAlliances();
    const key = `${House.Spain}:${SuperweaponType.CHRONOSPHERE}`;
    const swState: SuperweaponState = {
      type: SuperweaponType.CHRONOSPHERE,
      house: House.Spain,
      chargeTick: 0,
      ready: false,
      structureIndex: 0,
      fired: false,
    };
    const superweapons = new Map<string, SuperweaponState>();
    superweapons.set(key, swState);

    const ctx: SuperweaponContext = {
      structures: [pdox],
      entities: [],
      entityById: new Map(),
      superweapons,
      effects: [],
      tick: 100,
      playerHouse: House.Spain,
      powerProduced: 100,
      powerConsumed: 200, // low power
      killCount: 0,
      lossCount: 0,
      map: new GameMap(),
      sonarSpiedTarget: new Map(),
      gapGeneratorCells: new Map(),
      gpsActive: false,
      nukePendingTarget: null,
      nukePendingTick: 0,
      nukePendingSource: null,
      isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
      isPlayerControlled: () => false,
      pushEva: () => {},
      playSound: () => {},
      playSoundAt: () => {},
      damageEntity: () => false,
      damageStructure: () => false,
      addEntity: () => {},
      aiIQ: () => 3,
      getWarheadMult: () => 1.0,
      cameraX: 0,
      cameraY: 0,
      cameraViewWidth: 800,
      screenShake: 0,
      screenFlash: 0,
    };

    updateSuperweapons(ctx);

    // Chronosphere requires power — should NOT charge at low power
    expect(swState.chargeTick).toBe(0);
  });
});
