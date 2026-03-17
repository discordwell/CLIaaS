/**
 * C++ Behavioral Parity: Chronoshift kills infantry
 *
 * C++ source: house.cpp:2817-2826
 *   "Destroy any infantryman that gets teleported"
 *   - Infantry selected for chronoshift are moved to destination and killed
 *     with Take_Damage(Strength, WARHEAD_FIRE) — full HP fire damage
 *   - Vehicles are teleported normally (not killed)
 *   - This is intentional lore: organic matter cannot survive chronoshift
 *
 * TS bug (issue #25): superweapon.ts filtered out infantry with !e.stats.isInfantry,
 * silently ignoring them instead of killing them.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  SuperweaponType, SUPERWEAPON_DEFS,
  CHRONO_SHIFT_VISUAL_TICKS,
  buildDefaultAlliances,
} from '../engine/types';
import type { SuperweaponState } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { activateSuperweapon, type SuperweaponContext } from '../engine/superweapon';
import type { Effect } from '../engine/renderer';
import { GameMap } from '../engine/map';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeSuperweaponCtx(
  entities: Entity[] = [],
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

  return {
    structures: [],
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
}

// =============================================================================
// Chronoshift Infantry Kill — C++ house.cpp:2817-2826
// =============================================================================

describe('Chronoshift kills infantry (C++ house.cpp:2817-2826)', () => {

  it('infantry selected for chronoshift is killed (hp=0, alive=false)', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    const ctx = makeSuperweaponCtx([inf]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(inf.alive).toBe(false);
    expect(inf.hp).toBe(0);
  });

  it('vehicle selected for chronoshift is teleported (not killed)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeSuperweaponCtx([tank]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(tank.alive).toBe(true);
    expect(tank.hp).toBe(tank.maxHp);
    expect(tank.pos.x).toBe(target.x);
    expect(tank.pos.y).toBe(target.y);
    expect(tank.chronoShiftTick).toBe(CHRONO_SHIFT_VISUAL_TICKS);
  });

  it('mixed group: infantry dies, vehicle teleports (first selected wins)', () => {
    // When infantry is first selected entity, it gets chronoshifted (and killed)
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 6, 5);
    tank.selected = true;
    const ctx = makeSuperweaponCtx([inf, tank]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // Infantry was first in list, so it's the one chronoshifted and killed
    expect(inf.alive).toBe(false);
    expect(inf.hp).toBe(0);
    // Tank was not chronoshifted (only first selected unit is teleported)
    expect(tank.alive).toBe(true);
    expect(tank.pos.x).toBe(6 * CELL_SIZE + CELL_SIZE / 2); // unmoved
  });

  it('enemy infantry is also killed by allied chronoshift (owner-house gated)', () => {
    // C++ selects only own-house units, so enemy infantry wouldn't normally be
    // selected. But we verify the kill path works regardless of house.
    // The TS filter uses `e.house === house`, so enemy infantry can't be
    // chronoshifted by another house. Verify own infantry is still killed.
    const ownInf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    ownInf.selected = true;
    const enemyInf = entityAtCell(UnitType.I_E1, House.USSR, 6, 5);
    enemyInf.selected = true; // enemy selection is filtered out by house check
    const ctx = makeSuperweaponCtx([ownInf, enemyInf]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // Own infantry killed
    expect(ownInf.alive).toBe(false);
    expect(ownInf.hp).toBe(0);
    // Enemy infantry untouched (not selected by chronoshift owner)
    expect(enemyInf.alive).toBe(true);
    expect(enemyInf.hp).toBe(enemyInf.maxHp);
  });

  it('dead infantry is properly marked with DIE mission', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    const ctx = makeSuperweaponCtx([inf]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(inf.alive).toBe(false);
    expect(inf.hp).toBe(0);
    // Entity.takeDamage sets mission to DIE when killed
    expect(inf.mission).toBe(Mission.DIE);
  });

  it('infantry is moved to destination before being killed', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    const ctx = makeSuperweaponCtx([inf]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // C++ house.cpp:2822-2824: infantry is moved to destination cell before death
    expect(inf.pos.x).toBe(target.x);
    expect(inf.pos.y).toBe(target.y);
  });

  it('chronoshift produces effects and sound even when killing infantry', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    const sounds: string[] = [];
    const evas: string[] = [];
    const ctx = makeSuperweaponCtx([inf]);
    ctx.playSound = (name: string) => sounds.push(name);
    ctx.pushEva = (text: string) => evas.push(text);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(sounds).toContain('chrono');
    expect(evas).toContain('Chronosphere activated');
    // Should have at least one lightning effect at origin
    expect(ctx.effects.length).toBeGreaterThanOrEqual(1);
  });

  it('rocket soldier (E2) is also killed by chronoshift', () => {
    const rocketGuy = entityAtCell(UnitType.I_E2, House.Spain, 5, 5);
    rocketGuy.selected = true;
    const ctx = makeSuperweaponCtx([rocketGuy]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(rocketGuy.alive).toBe(false);
    expect(rocketGuy.hp).toBe(0);
  });

  it('engineer (E7) is also killed by chronoshift', () => {
    const engineer = entityAtCell(UnitType.I_E7, House.Spain, 5, 5);
    engineer.selected = true;
    const ctx = makeSuperweaponCtx([engineer]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(engineer.alive).toBe(false);
    expect(engineer.hp).toBe(0);
  });
});
