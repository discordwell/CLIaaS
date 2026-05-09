/**
 * C++ Behavioral Parity: AA Proximity Detonation + Torpedo Water Boundary
 *
 * Tests verify two projectile behaviors match C++ RA source code:
 *
 * 1. bullet.cpp:946-948 — Anti-air proximity detonation:
 *    `if (IsAntiAircraft && As_Aircraft(TarCom) && Distance(TarCom) < 0x0080)`
 *    AA projectiles detonate when within half a cell of an airborne target.
 *
 * 2. bullet.cpp:920-941 — Torpedo water boundary:
 *    `if (Class->IsSubSurface) { if (cellptr->Land_Type() != LAND_WATER ...) return true; }`
 *    Subsurface/torpedo projectiles explode if they leave water.
 *
 * C++ source is the source of truth. These tests describe WHAT happens
 * (observable outcomes), not HOW the code implements it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, WEAPON_STATS,
  buildDefaultAlliances, worldToCell, pixelToLepton, leptonDist, directionToLeptons256,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  type InflightProjectile,
  updateInflightProjectiles,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function entityAtWorld(type: UnitType, house: House, x: number, y: number): Entity {
  return new Entity(type, house, x, y);
}

function makeCombatCtx(
  entities: Entity[] = [],
  map?: GameMap,
): CombatContext {
  const gameMap = map ?? new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [] as MapStructure[],
    inflightProjectiles: [],
    logicAnims: [],
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
    map: gameMap,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
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

function makeProjectile(
  attackerId: number,
  targetId: number,
  weapon: typeof WEAPON_STATS[string],
  startX: number,
  startY: number,
  impactX: number,
  impactY: number,
  travelFrames: number,
): InflightProjectile {
  const logicalLX = pixelToLepton(startX);
  const logicalLY = pixelToLepton(startY);
  const headToLX = pixelToLepton(impactX);
  const headToLY = pixelToLepton(impactY);
  const dist = leptonDist(logicalLX, logicalLY, headToLX, headToLY);
  const speedAdd = Math.max(10, Math.ceil((dist / Math.max(1, travelFrames)) / 10) * 10);
  return {
    attackerId,
    targetId,
    weapon,
    damage: weapon.damage,
    strength: weapon.damage,
    speed: 1,
    travelFrames,
    currentFrame: 0,
    directHit: true,
    impactX,
    impactY,
    attackerIsPlayer: true,
    isArcing: weapon.isArcing ?? false,
    arcHeight: weapon.isArcing ? 1 : 0,
    arcRiser: weapon.isArcing ? 10 : 0,
    startX,
    startY,
    dogRiderId: -1,
    fuelTimer: travelFrames + 4,
    isFueled: false,
    isDropping: false,
    dropHeight: 0,
    isFlameEquipped: false,
    flameToggle: false,
    logicalLX,
    logicalLY,
    headToLX,
    headToLY,
    facing256: directionToLeptons256(logicalLX, logicalLY, headToLX, headToLY),
    speedAccum: 0,
    speedAdd,
    fuseTimer: travelFrames,
    armingTimer: 0,
    proximity: dist,
  };
}

// =============================================================================
// Weapon flag verification — C++ RULES.INI
// =============================================================================

describe('weapon flags (C++ RULES.INI)', () => {
  it('RedEye is anti-air', () => {
    expect(WEAPON_STATS.RedEye.isAntiAir).toBe(true);
  });

  it('TorpTube is subsurface', () => {
    expect(WEAPON_STATS.TorpTube.isSubSurface).toBe(true);
  });

  it('non-AA weapons are not flagged isAntiAir', () => {
    const nonAA = ['M1Carbine', '75mm', '90mm', '105mm', 'TorpTube'];
    for (const name of nonAA) {
      expect(WEAPON_STATS[name].isAntiAir, `${name} should not be isAntiAir`).toBeFalsy();
    }
  });

  it('HeatSeeker weapons have isAntiAir (C++ AA=yes)', () => {
    expect(WEAPON_STATS.Dragon.isAntiAir).toBe(true);
    expect(WEAPON_STATS.Stinger.isAntiAir).toBe(true);
  });

  it('non-torpedo weapons are not flagged isSubSurface', () => {
    const nonTorp = ['M1Carbine', '75mm', 'Stinger', 'RedEye', 'Dragon', 'DepthCharge'];
    for (const name of nonTorp) {
      expect(WEAPON_STATS[name].isSubSurface, `${name} should not be isSubSurface`).toBeFalsy();
    }
  });
});

// =============================================================================
// AA proximity detonation — C++ bullet.cpp:946-948
// =============================================================================

describe('AA proximity detonation (bullet.cpp:946-948)', () => {
  it('AA projectile detonates early when within half a cell of airborne target', () => {
    // SAM site at (5,5) shooting at aircraft at (10,5)
    const attacker = entityAtWorld(UnitType.I_E1, House.Spain, 5 * CELL_SIZE, 5 * CELL_SIZE);
    // Aircraft target — must be airborne
    const target = entityAtWorld(UnitType.V_HELI, House.USSR, 10 * CELL_SIZE, 5 * CELL_SIZE);
    target.flightAltitude = 100; // airborne

    const ctx = makeCombatCtx([attacker, target]);

    // Create AA projectile (RedEye) starting at attacker, heading to target
    // Travel frames = 20, so each frame covers (10-5)*24/20 = 6px
    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.RedEye,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      20,
    );
    ctx.inflightProjectiles.push(proj);

    // Advance enough frames so the projectile gets within CELL_SIZE/2 (12px) of target
    // Distance = 5*24 = 120px. At frame 18, t=0.9, pos = 5*24 + 120*0.9 = 228, target at 240
    // distance = 12 => not < 12. At frame 19, t=0.95, pos = 234, distance = 6 => < 12 => detonate!
    let detonatedFrame = -1;
    for (let i = 0; i < 20; i++) {
      const prevLen = ctx.inflightProjectiles.length;
      updateInflightProjectiles(ctx);
      if (ctx.inflightProjectiles.length < prevLen || ctx.inflightProjectiles.length === 0) {
        // Check if it detonated before reaching the full travel frames
        if (proj.currentFrame < 20) {
          detonatedFrame = proj.currentFrame;
        }
        break;
      }
    }

    // Should have detonated early (before frame 20)
    expect(detonatedFrame).toBeGreaterThan(0);
    expect(detonatedFrame).toBeLessThan(20);
  });

  it('non-AA projectile must reach exact target (no proximity detonation)', () => {
    const attacker = entityAtWorld(UnitType.I_E1, House.Spain, 5 * CELL_SIZE, 5 * CELL_SIZE);
    // Aircraft target
    const target = entityAtWorld(UnitType.V_HELI, House.USSR, 10 * CELL_SIZE, 5 * CELL_SIZE);
    target.flightAltitude = 100;

    const ctx = makeCombatCtx([attacker, target]);

    // Create non-AA projectile (90mm — not isAntiAir)
    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS['90mm'],
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      20,
    );
    ctx.inflightProjectiles.push(proj);

    // Run for 18 frames — should still be in flight (90mm is a tank cannon,
    // it should NOT proximity-detonate since it's not isAntiAir)
    for (let i = 0; i < 18; i++) {
      updateInflightProjectiles(ctx);
    }

    // After 18 frames, projectile should still be inflight (currentFrame=18 < travelFrames=20)
    // 90mm is NOT isAntiAir, so no proximity detonation
    // The projectile only arrives at frame 20 via the normal landing check
    expect(proj.currentFrame).toBe(18);
  });

  it('AA projectile does NOT proximity-detonate against ground units', () => {
    const attacker = entityAtWorld(UnitType.I_E1, House.Spain, 5 * CELL_SIZE, 5 * CELL_SIZE);
    // Ground target (not aircraft, or aircraft on ground)
    const target = entityAtWorld(UnitType.V_2TNK, House.USSR, 8 * CELL_SIZE, 5 * CELL_SIZE);

    const ctx = makeCombatCtx([attacker, target]);

    // Create AA projectile aimed at ground unit
    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.RedEye,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      10,
    );
    ctx.inflightProjectiles.push(proj);

    // Run most frames — should not proximity-detonate (target is not airborne)
    for (let i = 0; i < 9; i++) {
      updateInflightProjectiles(ctx);
    }

    // At frame 9, should still be inflight (no early detonation for ground targets)
    expect(proj.currentFrame).toBe(9);
  });
});

// =============================================================================
// Torpedo water boundary — C++ bullet.cpp:920-941
// =============================================================================

describe('torpedo water boundary (bullet.cpp:920-941)', () => {
  it('torpedo explodes when leaving water onto land', () => {
    // Set up a map with water cells and land cells
    const map = new GameMap();
    // Place water from column 5 to 8, land at column 9+
    for (let cx = 5; cx <= 8; cx++) {
      map.setTerrain(cx, 5, Terrain.WATER);
    }
    // Column 9 is CLEAR (land) — torpedo should explode here

    const attacker = entityAtWorld(UnitType.I_E1, House.Spain, 5 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2);
    const target = entityAtWorld(UnitType.I_E1, House.USSR, 12 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2);

    const ctx = makeCombatCtx([attacker, target], map);

    // Create torpedo projectile traveling from water (col 5) toward land (col 12)
    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.TorpTube,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      30, // 30 frames to travel
    );
    ctx.inflightProjectiles.push(proj);

    // Track when it explodes
    let explodedOnLand = false;
    for (let i = 0; i < 30; i++) {
      updateInflightProjectiles(ctx);
      if (ctx.inflightProjectiles.length === 0) {
        // Should have exploded before reaching target at col 12
        // Impact should be at the land cell center (col 9)
        const impactCell = worldToCell(proj.impactX, proj.impactY);
        // The torpedo should explode on the first non-water cell it enters
        expect(impactCell.cx).toBeGreaterThanOrEqual(9);
        expect(impactCell.cx).toBeLessThan(12); // should NOT reach target
        explodedOnLand = true;
        break;
      }
    }

    expect(explodedOnLand).toBe(true);
  });

  it('torpedo in water reaches target normally', () => {
    // All-water map — torpedo should NOT be force-exploded
    const map = new GameMap();
    for (let cx = 0; cx < 20; cx++) {
      map.setTerrain(cx, 5, Terrain.WATER);
    }

    const attacker = entityAtWorld(UnitType.I_E1, House.Spain, 5 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2);
    const target = entityAtWorld(UnitType.I_E1, House.USSR, 10 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2);

    const ctx = makeCombatCtx([attacker, target], map);

    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.TorpTube,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      15,
    );
    ctx.inflightProjectiles.push(proj);

    let arrivedAtTarget = false;
    for (let i = 0; i < 15; i++) {
      updateInflightProjectiles(ctx);
      if (ctx.inflightProjectiles.length === 0) {
        const impactCell = worldToCell(proj.impactX, proj.impactY);
        expect(impactCell.cx).toBe(10);
        expect(impactCell.cy).toBe(5);
        arrivedAtTarget = true;
        break;
      }
    }

    expect(arrivedAtTarget).toBe(true);
  });

  it('non-torpedo projectile ignores water boundary', () => {
    // Map with water ending at column 8, land from column 9
    const map = new GameMap();
    for (let cx = 5; cx <= 8; cx++) {
      map.setTerrain(cx, 5, Terrain.WATER);
    }
    // Columns 9+ are CLEAR (default)

    const attacker = entityAtWorld(UnitType.I_E1, House.Spain, 5 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2);
    const target = entityAtWorld(UnitType.I_E1, House.USSR, 12 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2);

    const ctx = makeCombatCtx([attacker, target], map);

    // Use a non-torpedo weapon (Stinger — naval gun, NOT subsurface)
    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.Stinger,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      20,
    );
    ctx.inflightProjectiles.push(proj);

    // Run for 19 frames — should still be inflight (Stinger ignores water boundary)
    for (let i = 0; i < 19; i++) {
      updateInflightProjectiles(ctx);
    }

    expect(proj.currentFrame).toBe(19);
    expect(ctx.inflightProjectiles.length).toBe(1);
  });
});
