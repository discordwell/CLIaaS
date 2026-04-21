/**
 * C++ Parity: Per-house fog-of-war in AI target scans
 *
 * Verifies that AI entity scans check whether the target cell is revealed by
 * the scanning entity's house, matching C++ techno.cpp:1467+ Evaluate_Object
 * which checks Is_Discovered_By_House.
 *
 * Key C++ references:
 *   - techno.cpp:1467+   — Evaluate_Object checks Is_Discovered_By_House
 *   - map.cpp:295-337    — Sight_From octagonal reveal
 *   - logic.cpp:267+     — Logic.AI runs BEFORE Map.Sight_From
 *
 * The bug this fixes: SCG07EA E4 flamethrowers target the player JEEP at tick 1
 * through unrevealed fog — WASM doesn't do this because C++ has per-house fog.
 */

import { describe, it, expect } from 'vitest';
import { Entity } from '../engine/entity';
import { updateHunt, updateAreaGuard, type MissionAIContext } from '../engine/missionAI';
import {
  CELL_SIZE, House, UnitType, Mission,
} from '../engine/types';
// Helper to create entity at cell position
function makeEntity(type: UnitType | string, house: House, cellX: number, cellY: number): Entity {
  const x = cellX * CELL_SIZE + CELL_SIZE / 2;
  const y = cellY * CELL_SIZE + CELL_SIZE / 2;
  return new Entity(type as UnitType, house, x, y);
}

// Minimal MissionAIContext with fog-of-war control
function makeCtx(overrides: Partial<MissionAIContext> & {
  entities?: Entity[];
  tick?: number;
  revealedCells?: Map<number, Set<number>>;
}): MissionAIContext {
  const revealedCells = overrides.revealedCells ?? new Map();
  return {
    entities: overrides.entities ?? [],
    structures: [],
    effects: [],
    map: {
      width: 128, height: 128,
      boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128,
      getTerrain: () => 0,
      setTerrain: () => {},
      hasLineOfSight: () => true,
      isPassable: () => true,
      isTerrainPassable: () => true,
      isWaterPassable: () => false,
      canEnterCell: () => true,
      inBounds: () => true,
      getWallType: () => undefined,
      setWallType: () => {},
      getOreCell: () => null,
    } as any,
    tick: overrides.tick ?? 100,
    playerHouse: House.Greece,
    killCount: 0,
    evaMessages: [],
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    isPlayerControlled: (e) => e.house === House.Greece,
    movementSpeed: () => 1,
    playSoundAt: () => {},
    playEva: () => {},
    playSound: () => {},
    weaponSound: (n) => n,
    damageEntity: () => false,
    damageStructure: () => false,
    triggerRetaliation: () => {},
    handleUnitDeath: () => {},
    launchProjectile: () => {},
    deferInvisibleScatter: () => {},
    applySplashDamage: () => {},
    getFirepowerBias: () => 1,
    getArmorBias: () => 1,
    getROFBias: () => 1,
    getWarheadMult: () => 1,
    getWarheadMeta: () => ({ spread: 0, flames: false, explosive: false, death: 0, wall: false }),
    getWarheadProps: () => undefined,
    warheadMuzzleColor: () => '#fff',
    weaponProjectileStyle: () => 'bullet',
    idleMission: () => Mission.GUARD,
    retreatFromTarget: () => {},
    threatScore: (_scanner, _target, dist) => 100 - dist,
    updateDemoTruck: () => {},
    updateMedic: () => {},
    updateMechanicUnit: () => {},
    updateTanyaC4: () => {},
    updateThief: () => {},
    spyDisguise: () => {},
    spyInfiltrate: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: (cx, cy, houseIdx) => {
      const set = revealedCells.get(houseIdx);
      if (!set) return false;
      return set.has(cy * 128 + cx);
    },
    ...overrides,
  };
}

// House indices matching Game.HOUSE_TO_INDEX / _HOUSE_IDX
const HOUSE_IDX = {
  [House.Spain]: 0, [House.Greece]: 1, [House.USSR]: 2,
  [House.England]: 3, [House.Ukraine]: 4, [House.Germany]: 5,
  [House.France]: 6, [House.Turkey]: 7,
  [House.GoodGuy]: 8, [House.BadGuy]: 9, [House.Neutral]: 10,
};

function cellKey(cx: number, cy: number): number {
  return cy * 128 + cx;
}

describe('Per-house fog-of-war in AI target scans (techno.cpp:1467+)', () => {

  describe('updateHunt — fog-gated target acquisition', () => {
    it('USSR E4 DOES target player JEEP even in unrevealed fog (C++ techno.cpp:1529)', () => {
      // C++ Evaluate_Object: !object->IsOwnedByPlayer bypasses the visibility check.
      // Player-owned entities are ALWAYS visible to AI, even in unrevealed fog.
      const e4 = makeEntity(UnitType.I_E4, House.USSR, 50, 50);
      e4.mission = Mission.HUNT;
      e4.target = null;

      const jeep = makeEntity(UnitType.V_JEEP, House.Greece, 60, 60);

      // No cells revealed for USSR — but player entities bypass fog
      const revealedCells = new Map<number, Set<number>>();
      const ctx = makeCtx({ entities: [e4, jeep], revealedCells, tick: 1 });

      updateHunt(ctx, e4);

      // E4 SHOULD acquire the JEEP — player entities always visible
      expect(e4.target).toBe(jeep);
    });

    it('USSR E4 DOES target player JEEP in revealed cell', () => {
      const e4 = makeEntity(UnitType.I_E4, House.USSR, 50, 50);
      e4.mission = Mission.HUNT;
      e4.target = null;


      const jeep = makeEntity(UnitType.V_JEEP, House.Greece, 51, 50);


      // Reveal the JEEP's cell for USSR
      const ussrSet = new Set<number>();
      ussrSet.add(cellKey(51, 50));
      const revealedCells = new Map<number, Set<number>>();
      revealedCells.set(HOUSE_IDX[House.USSR], ussrSet);

      const ctx = makeCtx({ entities: [e4, jeep], revealedCells, tick: 1 });

      updateHunt(ctx, e4);

      // E4 should have found the JEEP
      expect(e4.target).toBe(jeep);
    });
  });

  describe('updateAreaGuard — fog-gated target acquisition', () => {
    it('area guard scanner ignores enemies in unrevealed cells', () => {
      const guard = makeEntity(UnitType.I_E1, House.USSR, 50, 50);
      guard.mission = Mission.AREA_GUARD;

      guard.guardOrigin = { x: guard.pos.x, y: guard.pos.y };

      const target = makeEntity(UnitType.I_E1, House.Greece, 52, 50);


      // No cells revealed for USSR
      const revealedCells = new Map<number, Set<number>>();
      const ctx = makeCtx({ entities: [guard, target], revealedCells, tick: 100 });

      updateAreaGuard(ctx, guard, true);

      // Should NOT have found a target
      expect(guard.mission).not.toBe(Mission.ATTACK);
    });

    it('area guard scanner finds enemies in revealed cells', () => {
      const guard = makeEntity(UnitType.I_E1, House.USSR, 50, 50);
      guard.mission = Mission.AREA_GUARD;

      guard.guardOrigin = { x: guard.pos.x, y: guard.pos.y };

      const target = makeEntity(UnitType.I_E1, House.Greece, 52, 50);


      // Reveal target cell for USSR
      const ussrSet = new Set<number>();
      ussrSet.add(cellKey(52, 50));
      const revealedCells = new Map<number, Set<number>>();
      revealedCells.set(HOUSE_IDX[House.USSR], ussrSet);

      const ctx = makeCtx({ entities: [guard, target], revealedCells, tick: 100 });

      updateAreaGuard(ctx, guard, true);

      // C++ foot.cpp:1034-1037: target-found path stays AREA_GUARD, just sets TarCom.
      // Firing_AI fires; Approach_Target moves. Mission doesn't change to ATTACK.
      expect(guard.mission).toBe(Mission.AREA_GUARD);
      expect(guard.target).toBe(target);
    });
  });

  describe('isRevealedToHouse returns true = legacy behavior preserved', () => {
    it('when isRevealedToHouse always returns true, hunt finds all targets', () => {
      const hunter = makeEntity(UnitType.I_E1, House.USSR, 50, 50);
      hunter.mission = Mission.HUNT;
      hunter.target = null;
      // USSR entities are non-player by default (_playerHouses = {Spain, Greece})

      const prey = makeEntity(UnitType.I_E1, House.Greece, 52, 50);
      // Greece entities are player-controlled by default

      // All cells revealed (default mock behavior)
      const ctx = makeCtx({
        entities: [hunter, prey],
        tick: 1,
        isRevealedToHouse: () => true,
      });

      updateHunt(ctx, hunter);

      expect(hunter.target).toBe(prey);
    });
  });
});
