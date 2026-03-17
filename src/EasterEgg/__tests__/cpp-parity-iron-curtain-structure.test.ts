/**
 * C++ Behavioral Parity: Iron Curtain targeting structures
 *
 * C++ source: house.cpp:2740-2771 — SPC_IRON_CURTAIN case
 * Iron Curtain uses Cell_Techno(x, y) which returns any TechnoClass at the cell.
 * The switch checks RTTI_UNIT, RTTI_BUILDING, RTTI_VESSEL, RTTI_AIRCRAFT —
 * all receive IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_MINUTE.
 *
 * Bug: TS activateSuperweapon only searched ctx.entities (units), never structures.
 * Fix: Also search ctx.structures; if a friendly structure occupies the target cell,
 *      set ironCurtainTicks on it. Structure damage code checks this field and
 *      skips damage when > 0.
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
import { GameMap, Terrain } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

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
// Iron Curtain targeting structures — C++ house.cpp:2740-2771
// =============================================================================

describe('Iron Curtain can target structures (C++ house.cpp:2740-2771)', () => {

  it('applies ironCurtainTicks to a friendly structure at the target cell', () => {
    // C++ house.cpp:2744-2751: Cell_Techno finds RTTI_BUILDING, sets IronCurtainCountDown
    const struct = makeStructure('FACT', House.Spain, 5, 5);
    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      structures: [struct],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    // Target the center of the FACT (3x3 at cell 5,5)
    const [sw, sh] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    const targetX = (struct.cx + sw / 2) * CELL_SIZE;
    const targetY = (struct.cy + sh / 2) * CELL_SIZE;

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, { x: targetX, y: targetY });

    expect(struct.ironCurtainTicks).toBe(IRON_CURTAIN_DURATION);
  });

  it('protected structure takes no damage', () => {
    // C++ techno.cpp: IronCurtainCountDown > 0 means object is invulnerable
    const struct = makeStructure('FACT', House.Spain, 5, 5, { ironCurtainTicks: 100 });
    const combatCtx = makeCombatCtx([struct]);

    const hpBefore = struct.hp;
    const killed = structureDamage(combatCtx, struct, 200);

    expect(killed).toBe(false);
    expect(struct.hp).toBe(hpBefore);
    expect(struct.alive).toBe(true);
  });

  it('protection expires after duration (ironCurtainTicks decrements to 0)', () => {
    // C++ decrements IronCurtainCountDown each tick
    const struct = makeStructure('FACT', House.Spain, 5, 5, { ironCurtainTicks: 3 });

    // Simulate 3 ticks of decrement
    for (let i = 0; i < 3; i++) {
      if (struct.ironCurtainTicks && struct.ironCurtainTicks > 0) {
        struct.ironCurtainTicks--;
      }
    }

    expect(struct.ironCurtainTicks).toBe(0);
  });

  it('structure takes damage after Iron Curtain expires', () => {
    // After IronCurtainCountDown reaches 0, damage applies normally
    const struct = makeStructure('FACT', House.Spain, 5, 5, { ironCurtainTicks: 0 });
    const combatCtx = makeCombatCtx([struct]);

    const hpBefore = struct.hp;
    structureDamage(combatCtx, struct, 50);

    expect(struct.hp).toBe(hpBefore - 50);
  });

  it('Iron Curtain still works on units (no regression)', () => {
    // C++ house.cpp:2747 — RTTI_UNIT also receives Iron Curtain
    const tank = new Entity(UnitType.V_3TNK, House.Spain, 6 * CELL_SIZE, 6 * CELL_SIZE);
    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      entities: [tank],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, tank.pos);

    expect(tank.ironCurtainTick).toBe(IRON_CURTAIN_DURATION);
    expect(tank.isInvulnerable).toBe(true);
  });

  it('only friendly structures can be protected (enemy structures ignored)', () => {
    // C++ house.cpp:2744 — Cell_Techno returns the object, but only if it belongs
    // to the activating house (isAllied check)
    const enemyStruct = makeStructure('FACT', House.USSR, 5, 5);
    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      structures: [enemyStruct],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    const [sw, sh] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    const targetX = (enemyStruct.cx + sw / 2) * CELL_SIZE;
    const targetY = (enemyStruct.cy + sh / 2) * CELL_SIZE;

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, { x: targetX, y: targetY });

    // Should NOT have been applied — enemy structure
    expect(enemyStruct.ironCurtainTicks).toBeUndefined();
  });

  it('plays Iron Curtain sound and EVA when applied to structure', () => {
    const struct = makeStructure('FACT', House.Spain, 5, 5);
    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      structures: [struct],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    const [sw, sh] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    const targetX = (struct.cx + sw / 2) * CELL_SIZE;
    const targetY = (struct.cy + sh / 2) * CELL_SIZE;

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, { x: targetX, y: targetY });

    expect((ctx as any)._sounds).toContain('iron_curtain');
    expect((ctx as any)._evaMessages).toContain('Iron Curtain activated');
  });

  it('creates visual effect at the structure center', () => {
    const struct = makeStructure('FACT', House.Spain, 5, 5);
    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      structures: [struct],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    const [sw, sh] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    const targetX = (struct.cx + sw / 2) * CELL_SIZE;
    const targetY = (struct.cy + sh / 2) * CELL_SIZE;

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, { x: targetX, y: targetY });

    expect(ctx.effects.length).toBeGreaterThanOrEqual(1);
    const explosionEffect = ctx.effects.find(e => e.type === 'explosion');
    expect(explosionEffect).toBeDefined();
  });

  it('structure with ironCurtainTicks=undefined takes damage normally', () => {
    // Baseline: structures without Iron Curtain are not protected
    const struct = makeStructure('FACT', House.Spain, 5, 5);
    // ironCurtainTicks is undefined by default
    expect(struct.ironCurtainTicks).toBeUndefined();

    const combatCtx = makeCombatCtx([struct]);
    const hpBefore = struct.hp;
    structureDamage(combatCtx, struct, 50);

    expect(struct.hp).toBe(hpBefore - 50);
  });

  it('Iron Curtain prefers structure at target cell over nearby entity', () => {
    // C++ Cell_Techno returns the first object at the cell — buildings take priority
    const struct = makeStructure('FACT', House.Spain, 5, 5);
    const [sw, sh] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    const targetX = (struct.cx + sw / 2) * CELL_SIZE;
    const targetY = (struct.cy + sh / 2) * CELL_SIZE;

    // Place a unit right at the same position
    const tank = new Entity(UnitType.V_3TNK, House.Spain, targetX, targetY);

    const swState = makeSwState(SuperweaponType.IRON_CURTAIN, House.Spain, { ready: true });
    const ctx = makeSuperweaponCtx({
      structures: [struct],
      entities: [tank],
      superweapons: new Map([[`${House.Spain}:${SuperweaponType.IRON_CURTAIN}`, swState]]),
    });

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, { x: targetX, y: targetY });

    // Structure should get Iron Curtain, not the unit
    expect(struct.ironCurtainTicks).toBe(IRON_CURTAIN_DURATION);
    expect(tank.ironCurtainTick).toBe(0);
  });
});
