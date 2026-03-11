/**
 * Behavioral tests for crates.ts — weightedCrateType, spawnCrate, pickupCrate.
 * Calls exported functions directly with mock contexts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, Mission, CELL_SIZE,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import { STRUCTURE_MAX_HP } from '../engine/scenario';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';
import {
  type CrateContext, type Crate, type CrateType,
  weightedCrateType,
  spawnCrate,
  pickupCrate,
  CRATE_SHARES,
} from '../engine/crates';

beforeEach(() => resetEntityIds());

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeMap(): GameMap {
  const m = new GameMap();
  m.setBounds(0, 0, 128, 128);
  // Mark all cells as explored so spawning can find valid cells
  m.revealAll();
  return m;
}

function makeStructure(
  type: string, house: House, cx = 10, cy = 10,
  opts: Partial<MapStructure> = {},
): MapStructure {
  const maxHp = opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256;
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
  };
}

function makeCrateCtx(overrides: Partial<CrateContext> = {}): CrateContext {
  return {
    crates: [],
    entities: [],
    entityById: new Map(),
    structures: [],
    effects: [],
    evaMessages: [],
    activeVortices: [],
    visionaryHouses: new Set(),
    credits: 5000,
    tick: 100,
    playerHouse: House.Greece,
    screenShake: 0,
    map: makeMap(),
    crateOverrides: {},
    addCredits: vi.fn((amount: number) => {}),
    playSoundAt: vi.fn(),
    playSound: vi.fn(),
    damageEntity: vi.fn(),
    damageStructure: vi.fn(),
    detonateNuke: vi.fn(),
    isAllied: (a, b) => a === b,
    ...overrides,
  };
}

function makeCrate(type: CrateType, x = 500, y = 500): Crate {
  return { x, y, type, tick: 50, lifetime: 9000 };
}

// ═══════════════════════════════════════════════════════════════════════════
// weightedCrateType
// ═══════════════════════════════════════════════════════════════════════════

describe('weightedCrateType', () => {
  it('returns a valid CrateType string', () => {
    const validTypes = CRATE_SHARES.map(s => s.type);
    const result = weightedCrateType();
    expect(validTypes).toContain(result);
  });

  it('produces a distribution over many calls (not always the same type)', () => {
    const seen = new Set<CrateType>();
    for (let i = 0; i < 200; i++) {
      seen.add(weightedCrateType());
    }
    // With 200 rolls across 14 types, we should see at least 3 different types
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('money has the highest share weight', () => {
    const moneyEntry = CRATE_SHARES.find(s => s.type === 'money');
    expect(moneyEntry).toBeDefined();
    for (const entry of CRATE_SHARES) {
      expect(moneyEntry!.shares).toBeGreaterThanOrEqual(entry.shares);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// spawnCrate
// ═══════════════════════════════════════════════════════════════════════════

describe('spawnCrate', () => {
  it('adds a crate to ctx.crates array', () => {
    const ctx = makeCrateCtx();
    spawnCrate(ctx);
    expect(ctx.crates).toHaveLength(1);
  });

  it('crate has valid world-coordinate position within map bounds', () => {
    const ctx = makeCrateCtx();
    spawnCrate(ctx);
    const crate = ctx.crates[0];
    // World coords should be within bounds (0..128 cells → 0..128*CELL_SIZE pixels)
    expect(crate.x).toBeGreaterThan(0);
    expect(crate.y).toBeGreaterThan(0);
    expect(crate.x).toBeLessThan(128 * CELL_SIZE);
    expect(crate.y).toBeLessThan(128 * CELL_SIZE);
  });

  it('crate has a valid type from CRATE_SHARES', () => {
    const ctx = makeCrateCtx();
    spawnCrate(ctx);
    const validTypes = CRATE_SHARES.map(s => s.type);
    expect(validTypes).toContain(ctx.crates[0].type);
  });

  it('crate has a positive lifetime in ticks', () => {
    const ctx = makeCrateCtx();
    spawnCrate(ctx);
    expect(ctx.crates[0].lifetime).toBeGreaterThan(0);
  });

  it('applies silver crate override when set', () => {
    const ctx = makeCrateCtx({
      crateOverrides: { silver: 'heal' },
    });
    spawnCrate(ctx);
    expect(ctx.crates[0].type).toBe('heal');
  });

  it('does not spawn if all attempted cells are impassable', () => {
    const ctx = makeCrateCtx();
    // Make every cell impassable
    for (let i = 0; i < ctx.map.cells.length; i++) {
      ctx.map.cells[i] = Terrain.ROCK;
    }
    spawnCrate(ctx);
    // 20 attempts, all fail — no crate spawned
    expect(ctx.crates).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// pickupCrate
// ═══════════════════════════════════════════════════════════════════════════

describe('pickupCrate', () => {
  it('MONEY crate adds 2000 credits via addCredits callback', () => {
    const ctx = makeCrateCtx();
    const crate = makeCrate('money');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);

    pickupCrate(ctx, crate, unit);
    expect(ctx.addCredits).toHaveBeenCalledWith(2000, true);
    expect(ctx.evaMessages.some(m => m.text === 'MONEY CRATE')).toBe(true);
  });

  it('HEAL crate restores unit HP to max', () => {
    const ctx = makeCrateCtx();
    const crate = makeCrate('heal');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);
    unit.hp = 10; // damage the unit

    pickupCrate(ctx, crate, unit);
    expect(unit.hp).toBe(unit.maxHp);
    expect(ctx.evaMessages.some(m => m.text === 'UNIT HEALED')).toBe(true);
  });

  it('REVEAL crate adds house to visionaryHouses and reveals map', () => {
    const ctx = makeCrateCtx();
    // Reset visibility to 0 first
    ctx.map.visibility.fill(0);
    const crate = makeCrate('reveal');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);

    pickupCrate(ctx, crate, unit);
    expect(ctx.visionaryHouses.has(House.Greece)).toBe(true);
    // Map should be fully revealed (visibility = 2 everywhere)
    expect(ctx.map.getVisibility(50, 50)).toBe(2);
    expect(ctx.evaMessages.some(m => m.text === 'MAP REVEALED')).toBe(true);
  });

  it('FIREPOWER crate sets firepowerBias to 2', () => {
    const ctx = makeCrateCtx();
    const crate = makeCrate('firepower');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);
    expect(unit.firepowerBias).toBe(1.0); // default

    pickupCrate(ctx, crate, unit);
    expect(unit.firepowerBias).toBe(2);
    expect(ctx.evaMessages.some(m => m.text === 'FIREPOWER UPGRADE')).toBe(true);
  });

  it('SPEED crate sets speedBias to 1.5', () => {
    const ctx = makeCrateCtx();
    const crate = makeCrate('speed');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);
    expect(unit.speedBias).toBe(1.0); // default

    pickupCrate(ctx, crate, unit);
    expect(unit.speedBias).toBe(1.5);
    expect(ctx.evaMessages.some(m => m.text === 'SPEED UPGRADE')).toBe(true);
  });

  it('ARMOR crate sets armorBias to 2', () => {
    const ctx = makeCrateCtx();
    const crate = makeCrate('armor');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);
    expect(unit.armorBias).toBe(1.0); // default

    pickupCrate(ctx, crate, unit);
    expect(unit.armorBias).toBe(2);
    expect(ctx.evaMessages.some(m => m.text === 'ARMOR UPGRADE')).toBe(true);
  });

  it('CLOAK crate gives unit permanent cloaking ability', () => {
    const ctx = makeCrateCtx();
    const crate = makeCrate('cloak');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);
    expect(unit.isCloakable).toBe(false);

    pickupCrate(ctx, crate, unit);
    expect(unit.isCloakable).toBe(true);
    expect(ctx.evaMessages.some(m => m.text === 'UNIT CLOAKED')).toBe(true);
  });

  it('INVULNERABILITY crate sets 300-tick invulnerability', () => {
    const ctx = makeCrateCtx();
    const crate = makeCrate('invulnerability');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);
    expect(unit.invulnTick).toBe(0);

    pickupCrate(ctx, crate, unit);
    expect(unit.invulnTick).toBe(300);
    expect(ctx.evaMessages.some(m => m.text === 'INVULNERABILITY')).toBe(true);
  });

  it('UNIT crate spawns a new entity', () => {
    const ctx = makeCrateCtx();
    const crate = makeCrate('unit');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);

    pickupCrate(ctx, crate, unit);
    expect(ctx.entities).toHaveLength(1);
    expect(ctx.entities[0].house).toBe(House.Greece);
    expect(ctx.entities[0].mission).toBe(Mission.GUARD);
    expect(ctx.evaMessages.some(m => m.text === 'REINFORCEMENTS')).toBe(true);
  });

  it('SQUAD crate spawns 5 infantry units', () => {
    const ctx = makeCrateCtx();
    const crate = makeCrate('squad');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);

    pickupCrate(ctx, crate, unit);
    expect(ctx.entities).toHaveLength(5);
    for (const e of ctx.entities) {
      expect(e.house).toBe(House.Greece);
      expect(e.mission).toBe(Mission.GUARD);
    }
    expect(ctx.evaMessages.some(m => m.text === 'SQUAD REINFORCEMENT')).toBe(true);
  });

  it('HEAL_BASE crate heals all allied structures by 20% of maxHp', () => {
    const s1 = makeStructure('POWR', House.Greece, 10, 10, { hp: 100 });
    const s2 = makeStructure('WEAP', House.Greece, 20, 20, { hp: 500 });
    const enemyS = makeStructure('POWR', House.USSR, 30, 30, { hp: 100 });
    const ctx = makeCrateCtx({ structures: [s1, s2, enemyS] });
    const crate = makeCrate('heal_base');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);

    pickupCrate(ctx, crate, unit);
    // s1: POWR maxHp=400, was 100, healed +20% of 400 = +80 → 180
    expect(s1.hp).toBe(180);
    // s2: WEAP maxHp=1000, was 500, healed +20% of 1000 = +200 → 700
    expect(s2.hp).toBe(700);
    // Enemy structure should NOT be healed
    expect(enemyS.hp).toBe(100);
    expect(ctx.evaMessages.some(m => m.text === 'BASE REPAIRED')).toBe(true);
  });

  it('EXPLOSION crate calls damageEntity on nearby units', () => {
    const ctx = makeCrateCtx();
    const nearby = new Entity(UnitType.I_E1, House.Greece, 500, 500);
    nearby.alive = true;
    ctx.entities.push(nearby);
    const crate = makeCrate('explosion', 500, 500);
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 600, 600);

    pickupCrate(ctx, crate, unit);
    expect(ctx.damageEntity).toHaveBeenCalled();
    expect(ctx.evaMessages.some(m => m.text === 'BOOBY TRAP!')).toBe(true);
  });

  it('DARKNESS crate shrouds 7x7 cells around crate', () => {
    const ctx = makeCrateCtx();
    // Map starts fully revealed
    const crateCX = 50;
    const crateCY = 50;
    const crateX = crateCX * CELL_SIZE + CELL_SIZE / 2;
    const crateY = crateCY * CELL_SIZE + CELL_SIZE / 2;
    const crate = makeCrate('darkness', crateX, crateY);
    const unit = new Entity(UnitType.V_JEEP, House.Greece, crateX, crateY);

    pickupCrate(ctx, crate, unit);
    // Center of shroud should be 0
    expect(ctx.map.getVisibility(crateCX, crateCY)).toBe(0);
    // Corners of 7x7 area (±3)
    expect(ctx.map.getVisibility(crateCX - 3, crateCY - 3)).toBe(0);
    expect(ctx.map.getVisibility(crateCX + 3, crateCY + 3)).toBe(0);
    // Just outside the 7x7 area should still be revealed
    expect(ctx.map.getVisibility(crateCX + 4, crateCY)).toBe(2);
    expect(ctx.evaMessages.some(m => m.text === 'DARKNESS')).toBe(true);
  });

  it('VORTEX crate spawns a vortex entry', () => {
    const ctx = makeCrateCtx();
    const crate = makeCrate('vortex', 500, 500);
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);

    pickupCrate(ctx, crate, unit);
    expect(ctx.activeVortices).toHaveLength(1);
    expect(ctx.activeVortices[0].x).toBe(500);
    expect(ctx.activeVortices[0].y).toBe(500);
    expect(ctx.activeVortices[0].ticksLeft).toBe(450);
    expect(ctx.evaMessages.some(m => m.text === 'VORTEX SPAWNED')).toBe(true);
  });

  it('TIMEQUAKE crate damages all entities and structures', () => {
    const e1 = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    const e2 = new Entity(UnitType.I_E1, House.USSR, 200, 200);
    const s1 = makeStructure('POWR', House.Greece, 10, 10);
    const ctx = makeCrateCtx({
      entities: [e1, e2],
      structures: [s1],
    });
    const crate = makeCrate('timequake');
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);

    pickupCrate(ctx, crate, unit);
    // Should damage both entities (friend and foe)
    expect(ctx.damageEntity).toHaveBeenCalledTimes(2);
    // Should damage all structures
    expect(ctx.damageStructure).toHaveBeenCalledTimes(1);
    // Screen shake
    expect(ctx.screenShake).toBeGreaterThanOrEqual(15);
    expect(ctx.evaMessages.some(m => m.text === 'TIME QUAKE')).toBe(true);
  });

  it('all pickups play crate_pickup sound and add piffpiff effect', () => {
    const ctx = makeCrateCtx();
    const crate = makeCrate('money', 500, 500);
    const unit = new Entity(UnitType.V_JEEP, House.Greece, 500, 500);

    pickupCrate(ctx, crate, unit);
    expect(ctx.playSoundAt).toHaveBeenCalledWith('crate_pickup', 500, 500);
    expect(ctx.effects.some(e => e.sprite === 'piffpiff')).toBe(true);
  });
});
