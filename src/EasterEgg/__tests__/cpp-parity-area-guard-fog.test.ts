/**
 * C++ Parity: Mission_Guard_Area Fog Filter — IsOwnedByPlayer is strict PlayerPtr
 *
 * C++ techno.cpp:1525-1532 (Evaluate_Object):
 *   if (!object->IsOwnedByPlayer && !object->IsDiscoveredByPlayer &&
 *       Session.Type == GAME_NORMAL && object->What_Am_I() != RTTI_AIRCRAFT) {
 *       return(false);
 *   }
 *
 * `IsOwnedByPlayer` is STRICTLY `(PlayerPtr == House)` (techno.cpp:624, 3781) — it is TRUE
 * only for the human player's direct house, NOT for player-allied houses. Regular
 * singleplayer has only one `PlayerPtr` (Greece in SCG07EA, SCG04EA, etc.).
 *
 * TS `Entity.isPlayerUnit` (entity.ts:517-519) evaluates `_playerHouses.has(this.house)`,
 * where `_playerHouses` is populated with Greece + Greece's declared Allies (e.g. England).
 * That set matches "player-allied", not the strict PlayerPtr. Using `!other.isPlayerUnit`
 * as the fog-bypass made AI scans visible through to allied houses that C++ would have
 * filtered, surfacing as SCG07EA tick 0 E4 USSR Area Guard scan acquiring England's JEEP
 * (3–4 cells away) before any fog had populated — C++ returned `(1)` for the no-target
 * path but TS returned `1` for target-found, skipping the `Random_Pick(1,5)` jitter call.
 *
 * Fix: use strict `other.house !== ctx.playerHouse` in the AreaGuard fog-bypass so
 * allied-but-not-player targets still require fog reveal.
 *
 * C++ references:
 *   - techno.cpp:624          IsOwnedByPlayer = (PlayerPtr == House)
 *   - techno.cpp:1525-1532    Evaluate_Object rejects non-IsOwnedByPlayer + non-IsDiscoveredByPlayer
 *   - foot.cpp:1037-1097      Mission_Guard_Area returns (1) for new target, else Random_Pick(1,5)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import { updateAreaGuard, type MissionAIContext } from '../engine/missionAI';
import { House, UnitType, Mission, CELL_SIZE } from '../engine/types';

beforeEach(() => {
  resetEntityIds();
  // Reset player-houses to SCG07EA layout: player=Greece, allies=England
  setPlayerHouses(new Set([House.Greece, House.England]));
});

function makeEntity(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCtx(overrides: Partial<MissionAIContext> & { entities?: Entity[]; structures?: any[] }): MissionAIContext {
  return {
    entities: overrides.entities ?? [],
    structures: overrides.structures ?? [],
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
    tick: 0, // Tick 0: no fog populated yet
    playerHouse: House.Greece,
    killCount: 0,
    evaMessages: [],
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    isAllied: (a, b) => {
      if (a === b) return true;
      // Greece and England are allies for this scenario
      if ((a === House.Greece && b === House.England) || (a === House.England && b === House.Greece)) return true;
      return false;
    },
    entitiesAllied: (a, b) => {
      return (a.house === b.house) ||
        ((a.house === House.Greece && b.house === House.England) || (a.house === House.England && b.house === House.Greece));
    },
    isPlayerControlled: (e) => e.house === House.Greece || e.house === House.England,
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
    // Default: nothing discovered by PlayerPtr (tick-0 empty fog). C++
    // Evaluate_Object uses IsDiscoveredByPlayer, not scanner-house fog.
    isDiscoveredByPlayer: () => false,
    isRevealedToHouse: () => false,
    ...overrides,
  };
}

describe('Mission_Guard_Area fog filter — C++ techno.cpp:1525-1532 IsOwnedByPlayer strict', () => {
  it('AI scanner SKIPS player-ALLIED (non-PlayerPtr) target when fog is empty', () => {
    // SCG07EA tick 0: E4 USSR at (30, 61) scanning in Area Guard mode. England (player
    // ally) JEEP at (27, 58) is within scan range. C++ Evaluate_Object rejects England
    // JEEP because (1) England != PlayerPtr=Greece → !IsOwnedByPlayer; (2) not yet
    // IsDiscoveredByPlayer (tick 0 fog empty). TS must match — no target acquired.
    const scanner = makeEntity(UnitType.I_E4, House.USSR, 30, 61);
    scanner.mission = Mission.AREA_GUARD;
    scanner.guardOrigin = { x: scanner.pos.x, y: scanner.pos.y };

    const englandJeep = makeEntity(UnitType.V_JEEP, House.England, 27, 58);
    englandJeep.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, englandJeep] });
    updateAreaGuard(ctx, scanner);

    expect(scanner.target, 'AI scanner must NOT acquire England JEEP at tick 0 with empty fog').toBeNull();
  });

  it('AI scanner DOES acquire PlayerPtr-owned (strict Greece) target even with empty fog', () => {
    // C++ IsOwnedByPlayer bypasses fog check → Greece unit is always visible to AI scan.
    const scanner = makeEntity(UnitType.I_E4, House.USSR, 30, 61);
    scanner.mission = Mission.AREA_GUARD;
    scanner.guardOrigin = { x: scanner.pos.x, y: scanner.pos.y };

    const greeceJeep = makeEntity(UnitType.V_JEEP, House.Greece, 28, 60);
    greeceJeep.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, greeceJeep] });
    updateAreaGuard(ctx, scanner);

    expect(scanner.target, 'AI scanner MUST acquire PlayerPtr (Greece) target via IsOwnedByPlayer bypass').toBe(greeceJeep);
  });

  it('AI scanner does NOT acquire player-ALLIED target through scanner-house fog alone', () => {
    // C++ Evaluate_Object ignores scanner-house fog here; England is not PlayerPtr
    // and must be IsDiscoveredByPlayer before the scanner can acquire it.
    const scanner = makeEntity(UnitType.I_E4, House.USSR, 30, 61);
    scanner.mission = Mission.AREA_GUARD;
    scanner.guardOrigin = { x: scanner.pos.x, y: scanner.pos.y };

    const englandJeep = makeEntity(UnitType.V_JEEP, House.England, 28, 60);
    englandJeep.mission = Mission.GUARD;

    const ctx = makeCtx({
      entities: [scanner, englandJeep],
      // USSR sees everything (simulate fog reveal)
      isRevealedToHouse: () => true,
    });
    updateAreaGuard(ctx, scanner);

    expect(scanner.target, 'AI scanner must not acquire England target through scanner fog alone').toBeNull();
  });

  it('AI scanner acquires player-ALLIED target when it is IsDiscoveredByPlayer', () => {
    const scanner = makeEntity(UnitType.I_E4, House.USSR, 30, 61);
    scanner.mission = Mission.AREA_GUARD;
    scanner.guardOrigin = { x: scanner.pos.x, y: scanner.pos.y };

    const englandJeep = makeEntity(UnitType.V_JEEP, House.England, 28, 60);
    englandJeep.mission = Mission.GUARD;

    const ctx = makeCtx({
      entities: [scanner, englandJeep],
      isDiscoveredByPlayer: (e) => e === englandJeep,
      isRevealedToHouse: () => false,
    });
    updateAreaGuard(ctx, scanner);

    expect(scanner.target, 'AI scanner must acquire England target once IsDiscoveredByPlayer is true').toBe(englandJeep);
  });
});
