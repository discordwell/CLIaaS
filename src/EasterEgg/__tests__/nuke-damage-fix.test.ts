/**
 * Tests for nuke structure damage fix — verifies detonateNuke uses
 * ctx.damageStructure() instead of direct hp mutation, ensuring:
 * - rubble=true on destroyed structures
 * - damageStructure called for each structure in blast radius
 * - structures outside blast radius are unaffected
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, CELL_SIZE,
  SuperweaponType, NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_MIN_FALLOFF,
  UNIT_STATS, getWarheadMultiplier,
  type WarheadType, type ArmorType,
} from '../engine/types';
import {
  detonateNuke,
  type SuperweaponContext,
} from '../engine/superweapon';
import { type MapStructure, STRUCTURE_SIZE } from '../engine/scenario';
import { type Effect } from '../engine/renderer';
import { Terrain } from '../engine/map';

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

function makeMockSuperweaponContext(
  overrides: Partial<SuperweaponContext> = {},
): SuperweaponContext & {
  _damagedStructures: Array<{ s: MapStructure; damage: number; destroyed: boolean }>;
} {
  const damagedStructures: Array<{ s: MapStructure; damage: number; destroyed: boolean }> = [];

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
    pushEva() {},
    playSound() {},
    playSoundAt() {},
    damageEntity(target: Entity, amount: number, warhead: string) {
      return target.takeDamage(amount, warhead);
    },
    damageStructure(s: MapStructure, damage: number) {
      s.hp -= damage;
      const destroyed = s.hp <= 0;
      if (destroyed) {
        s.hp = 0;
        s.alive = false;
        s.rubble = true; // This is the key side effect that was missing
      }
      damagedStructures.push({ s, damage, destroyed });
      return destroyed;
    },
    addEntity() {},
    aiIQ() { return 5; },
    getWarheadMult(warhead: string, armor: string) {
      return getWarheadMultiplier(warhead as WarheadType, armor as ArmorType);
    },
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 640,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };

  return Object.assign(ctx, { _damagedStructures: damagedStructures });
}

// ═══════════════════════════════════════════════════════════
// Nuke damage fix — ctx.damageStructure instead of direct hp mutation
// ═══════════════════════════════════════════════════════════
describe('detonateNuke uses ctx.damageStructure for structures', () => {

  it('nuked structures that die have rubble=true (via damageStructure callback)', () => {
    const ctx = makeMockSuperweaponContext();
    // Place a low-HP structure at ground zero so the nuke destroys it
    const struct = makeStructure('WEAP', House.USSR, 8, 8, { hp: 50, maxHp: 256 });
    ctx.structures.push(struct);

    const sx = struct.cx * CELL_SIZE + CELL_SIZE;
    const sy = struct.cy * CELL_SIZE + CELL_SIZE;
    detonateNuke(ctx, { x: sx, y: sy });

    // Structure should be dead with rubble=true set by damageStructure
    expect(struct.alive).toBe(false);
    expect(struct.hp).toBe(0);
    expect(struct.rubble).toBe(true);
  });

  it('damageStructure is called for each structure in blast radius', () => {
    const ctx = makeMockSuperweaponContext();
    // Place 3 structures within blast radius
    const blastCells = NUKE_BLAST_CELLS; // 10
    const s1 = makeStructure('POWR', House.USSR, 10, 10, { hp: 999 });
    const s2 = makeStructure('BARR', House.USSR, 12, 10, { hp: 999 });
    const s3 = makeStructure('WEAP', House.USSR, 10, 12, { hp: 999 });
    ctx.structures.push(s1, s2, s3);

    // Nuke at cell (10,10) center — all 3 structures within 10 cells
    const targetX = 10 * CELL_SIZE + CELL_SIZE;
    const targetY = 10 * CELL_SIZE + CELL_SIZE;
    detonateNuke(ctx, { x: targetX, y: targetY });

    // All 3 structures should have been passed to damageStructure
    expect(ctx._damagedStructures.length).toBe(3);
    const damagedRefs = ctx._damagedStructures.map(d => d.s);
    expect(damagedRefs).toContain(s1);
    expect(damagedRefs).toContain(s2);
    expect(damagedRefs).toContain(s3);
  });

  it('structures outside blast radius are unaffected', () => {
    const ctx = makeMockSuperweaponContext();
    // worldDist returns cells, but blastRadius = CELL_SIZE * NUKE_BLAST_CELLS (= 240).
    // So we need cellDist > 240 cells to be outside the blast radius.
    // Place structure at (500, 500) and nuke at (10, 10) — cellDist ≈ 693, well outside 240
    const farStruct = makeStructure('FACT', House.USSR, 500, 500, { hp: 256, maxHp: 256 });
    ctx.structures.push(farStruct);

    const targetX = 10 * CELL_SIZE + CELL_SIZE;
    const targetY = 10 * CELL_SIZE + CELL_SIZE;
    detonateNuke(ctx, { x: targetX, y: targetY });

    // Far structure should not have been damaged
    expect(ctx._damagedStructures.length).toBe(0);
    expect(farStruct.hp).toBe(256);
    expect(farStruct.alive).toBe(true);
    expect(farStruct.rubble).toBe(false);
  });

  it('damage amount uses NUKE_DAMAGE * falloff (no warhead multiplier for structures)', () => {
    const ctx = makeMockSuperweaponContext();
    // Place a structure at ground zero
    const struct = makeStructure('WEAP', House.USSR, 10, 10, { hp: 5000, maxHp: 5000 });
    ctx.structures.push(struct);

    const sx = struct.cx * CELL_SIZE + CELL_SIZE;
    const sy = struct.cy * CELL_SIZE + CELL_SIZE;
    detonateNuke(ctx, { x: sx, y: sy });

    // At ground zero, dist=0, falloff=max(NUKE_MIN_FALLOFF, 1 - 0) = 1.0
    // dmg = max(1, round(NUKE_DAMAGE * 1.0)) = NUKE_DAMAGE
    expect(ctx._damagedStructures.length).toBe(1);
    expect(ctx._damagedStructures[0].damage).toBe(NUKE_DAMAGE);
  });

  it('structures at blast edge receive minimum falloff damage', () => {
    const ctx = makeMockSuperweaponContext();
    const blastRadius = CELL_SIZE * NUKE_BLAST_CELLS;
    // Place structure just barely inside blast radius
    // Structure center at (cx*CELL + CELL, cy*CELL + CELL)
    // We need worldDist from target to structure center < blastRadius
    // If target at (10*CELL+CELL, 10*CELL+CELL) and struct at (10+NUKE_BLAST_CELLS-1, 10)
    // dist ≈ (NUKE_BLAST_CELLS-1)*CELL_SIZE which is within radius
    const edgeCx = 10 + NUKE_BLAST_CELLS - 1;
    const struct = makeStructure('POWR', House.USSR, edgeCx, 10, { hp: 5000, maxHp: 5000 });
    ctx.structures.push(struct);

    const targetX = 10 * CELL_SIZE + CELL_SIZE;
    const targetY = 10 * CELL_SIZE + CELL_SIZE;
    detonateNuke(ctx, { x: targetX, y: targetY });

    // Structure should be damaged with falloff applied
    expect(ctx._damagedStructures.length).toBe(1);
    const dmg = ctx._damagedStructures[0].damage;
    // Damage should be less than max (NUKE_DAMAGE) but at least min falloff
    expect(dmg).toBeLessThan(NUKE_DAMAGE);
    expect(dmg).toBeGreaterThanOrEqual(Math.max(1, Math.round(NUKE_DAMAGE * NUKE_MIN_FALLOFF)));
  });

  it('dead structures are skipped (not double-damaged)', () => {
    const ctx = makeMockSuperweaponContext();
    const struct = makeStructure('WEAP', House.USSR, 10, 10, { hp: 0, alive: false });
    ctx.structures.push(struct);

    const targetX = 10 * CELL_SIZE + CELL_SIZE;
    const targetY = 10 * CELL_SIZE + CELL_SIZE;
    detonateNuke(ctx, { x: targetX, y: targetY });

    // Already-dead structure should not be passed to damageStructure
    expect(ctx._damagedStructures.length).toBe(0);
  });

  it('multiple structures destroyed by nuke all get rubble=true', () => {
    const ctx = makeMockSuperweaponContext();
    // 3 low-HP structures at ground zero
    const s1 = makeStructure('POWR', House.USSR, 10, 10, { hp: 10, maxHp: 256 });
    const s2 = makeStructure('BARR', House.USSR, 11, 10, { hp: 10, maxHp: 256 });
    const s3 = makeStructure('PROC', House.USSR, 10, 11, { hp: 10, maxHp: 256 });
    ctx.structures.push(s1, s2, s3);

    const targetX = 10 * CELL_SIZE + CELL_SIZE;
    const targetY = 10 * CELL_SIZE + CELL_SIZE;
    detonateNuke(ctx, { x: targetX, y: targetY });

    // All 3 should be destroyed with rubble
    for (const s of [s1, s2, s3]) {
      expect(s.alive).toBe(false);
      expect(s.rubble).toBe(true);
    }
    // All 3 should have been passed through damageStructure
    expect(ctx._damagedStructures.length).toBe(3);
    expect(ctx._damagedStructures.every(d => d.destroyed)).toBe(true);
  });

  it('high-HP structure survives nuke at edge but still goes through damageStructure', () => {
    const ctx = makeMockSuperweaponContext();
    // Place structure at edge of blast with very high HP
    const edgeCx = 10 + NUKE_BLAST_CELLS - 1;
    const struct = makeStructure('FACT', House.USSR, edgeCx, 10, { hp: 50000, maxHp: 50000 });
    ctx.structures.push(struct);

    const targetX = 10 * CELL_SIZE + CELL_SIZE;
    const targetY = 10 * CELL_SIZE + CELL_SIZE;
    detonateNuke(ctx, { x: targetX, y: targetY });

    // damageStructure was called
    expect(ctx._damagedStructures.length).toBe(1);
    expect(ctx._damagedStructures[0].destroyed).toBe(false);
    // Structure survived
    expect(struct.alive).toBe(true);
    expect(struct.rubble).toBe(false);
    // But took damage
    expect(struct.hp).toBeLessThan(50000);
  });
});
