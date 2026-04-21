/**
 * C++ Parity: Mission_Guard Scan Fog Filter — IsOwnedByPlayer strict PlayerPtr
 *
 * Companion to `cpp-parity-area-guard-fog.test.ts`. That test locks the fix for
 * `updateAreaGuard`; this test locks the SAME strict-PlayerPtr fix in
 * `cellBasedGuardScan` (used by `updateGuard`).
 *
 * SCG07EA tick 1 manifestation:
 *   - Player = Greece, Greece's declared Allies include England.
 *   - England JEEP (UNITS[8], cell 27,58, Mission=Guard, trigger=eatk) scans for
 *     targets via `Mission_Guard` → `Target_Something_Nearby(THREAT_RANGE)`.
 *   - TS used `entity.isPlayerUnit ? -1 : ...` to compute `guardHouseIdx`.
 *     `isPlayerUnit` is TRUE for any member of `_playerHouses` (Greece OR
 *     England). So `guardHouseIdx = -1` for England → the fog-filter is disabled
 *     for the scanner → any USSR target in the cellmap is acceptable.
 *   - WASM: `IsOwnedByPlayer(JEEP) = (PlayerPtr==House) = (Greece==England) =
 *     false`. JEEP is NOT the strict PlayerPtr. Evaluate_Object then rejects any
 *     USSR target that is not `IsDiscoveredByPlayer` at tick 1 (fog empty).
 *
 * Result: TS JEEP acquired a target at tick 1 and fired its weapon, consuming
 * 5+ extra RNG calls (damageEntity → aiScatterOnDamage + handleUnitDeath),
 * while WASM only consumed 1 RNG (Mission_Guard timer jitter `Random_Pick(0,2)`).
 * Net Δcalls=-12 at tick 1, first-divergence stuck at tick 1.
 *
 * Fix: `cellBasedGuardScan` (missionAI.ts) uses strict `entity.house ===
 * ctx.playerHouse` to decide whether the scanner bypasses fog.
 *
 * C++ references:
 *   - techno.cpp:624              IsOwnedByPlayer = (PlayerPtr == House)
 *   - techno.cpp:1525-1532        Evaluate_Object rejects non-IsOwnedByPlayer + non-IsDiscoveredByPlayer
 *   - foot.cpp:638-698            FootClass::Mission_Guard — Target_Something_Nearby, Random_Animate, Random_Pick(0,2) jitter
 *   - unit.cpp:425-688            UnitClass::AI → MissionClass::AI then Firing_AI — same-tick fire if TarCom set
 *   - weapon.cpp:317-327          Primary weapon Allowed_Threats → threat mask
 *
 * Bug references (C++):
 *   - techno.cpp:1525-1532 filter is the AUTHORITATIVE gate for AI target
 *     selection in singleplayer. Bypass requires PlayerPtr match, not Ally match.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import { House, UnitType, Mission, CELL_SIZE, Stance } from '../engine/types';
// Import the exported helper so we can exercise the strict-PlayerPtr fog gate directly.
// cellBasedGuardScan is used by updateGuard (via missionAI.ts) — the strict-PlayerPtr
// gate lives in the shared guardHouseIdx computation at the top of cellBasedGuardScan.
// We can't import cellBasedGuardScan directly (not exported); instead we drive the
// behavior through updateGuard which is the public entry point.
import { updateGuard, type MissionAIContext } from '../engine/missionAI';

beforeEach(() => {
  resetEntityIds();
  // SCG07EA: Player=Greece, Greece's Allies=England
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
    tick: 1,
    playerHouse: House.Greece,
    killCount: 0,
    evaMessages: [],
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    isAllied: (a, b) => {
      if (a === b) return true;
      if ((a === House.Greece && b === House.England) || (a === House.England && b === House.Greece)) return true;
      if ((a === House.USSR && b === House.BadGuy) || (a === House.BadGuy && b === House.USSR)) return true;
      return false;
    },
    entitiesAllied: (a, b) => {
      if (a.house === b.house) return true;
      const h1 = a.house, h2 = b.house;
      if ((h1 === House.Greece && h2 === House.England) || (h1 === House.England && h2 === House.Greece)) return true;
      if ((h1 === House.USSR && h2 === House.BadGuy) || (h1 === House.BadGuy && h2 === House.USSR)) return true;
      return false;
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
    // Default: fog is empty (tick-1 before any discovery). isRevealedToHouse
    // returns false for every (cell, house) pair.
    isRevealedToHouse: () => false,
    aiIQ: () => 3,
    ...overrides,
  };
}

describe('SCG07EA tick 1 — Mission_Guard scan strict IsOwnedByPlayer (C++ techno.cpp:1525-1532)', () => {
  it('England JEEP (player-ALLIED, NOT PlayerPtr) does NOT acquire USSR target through empty fog', () => {
    // Critical SCG07EA tick-1 scenario. England JEEP is in the _playerHouses set
    // (Greece + allies) so `isPlayerUnit` = true. C++ treats England as NOT the
    // PlayerPtr (PlayerPtr = Greece), so JEEP must respect fog when scanning.
    // Before the fix, TS skipped the fog check → acquired USSR target → fired
    // weapon → 5+ extra RNG calls at tick 1.
    const jeep = makeEntity(UnitType.V_JEEP, House.England, 27, 58);
    jeep.mission = Mission.GUARD;
    jeep.attackCooldown = 0;

    const ussrInf = makeEntity(UnitType.I_E1, House.USSR, 30, 60); // in range of 4-cell MG
    ussrInf.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [jeep, ussrInf] });
    updateGuard(ctx, jeep, /*timerFired=*/ true);

    expect(jeep.target, 'England JEEP must NOT acquire USSR target under empty fog').toBeNull();
  });

  it('Greece scanner (strict PlayerPtr) DOES bypass fog and acquire USSR target', () => {
    // Greece IS the PlayerPtr — IsOwnedByPlayer=true → fog bypass allowed.
    const jeep = makeEntity(UnitType.V_JEEP, House.Greece, 27, 58);
    jeep.mission = Mission.GUARD;
    jeep.attackCooldown = 0;

    const ussrInf = makeEntity(UnitType.I_E1, House.USSR, 29, 60);
    ussrInf.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [jeep, ussrInf] });
    updateGuard(ctx, jeep, /*timerFired=*/ true);

    expect(jeep.target, 'Greece JEEP must acquire USSR target via IsOwnedByPlayer fog bypass').toBe(ussrInf);
  });

  it('England JEEP acquires USSR target once fog has revealed the target cell to England', () => {
    // Symmetric to the Area-Guard test: once England's fog reveals the USSR
    // cell (e.g. later in the mission after discovery), the scanner can acquire.
    const jeep = makeEntity(UnitType.V_JEEP, House.England, 27, 58);
    jeep.mission = Mission.GUARD;
    jeep.attackCooldown = 0;

    const ussrInf = makeEntity(UnitType.I_E1, House.USSR, 29, 60);
    ussrInf.mission = Mission.GUARD;

    const ctx = makeCtx({
      entities: [jeep, ussrInf],
      isRevealedToHouse: () => true, // England sees the cell
    });
    updateGuard(ctx, jeep, /*timerFired=*/ true);

    expect(jeep.target, 'England JEEP must acquire USSR target when cell is revealed to England').toBe(ussrInf);
  });

  it('USSR scanner (NOT player-allied) still respects fog — no regression on AI scanners', () => {
    // The fix must not affect the existing fog gate for purely-AI houses. USSR is
    // not in the _playerHouses set; guardHouseIdx > 0; fog still applies normally.
    const ussrInf = makeEntity(UnitType.I_E1, House.USSR, 30, 60);
    ussrInf.mission = Mission.GUARD;
    ussrInf.attackCooldown = 0;

    const greeceInf = makeEntity(UnitType.I_E1, House.Greece, 29, 60);
    greeceInf.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [ussrInf, greeceInf] });
    updateGuard(ctx, ussrInf, /*timerFired=*/ true);

    // Greece is PlayerPtr → IsOwnedByPlayer=true → fog bypassed for the target.
    expect(ussrInf.target, 'USSR must acquire Greece PlayerPtr target regardless of fog').toBe(greeceInf);
  });

  it('USSR scanner does NOT acquire England (player-ALLIED, non-PlayerPtr) target through empty fog', () => {
    // The mirror test: England units are player-allied but not PlayerPtr, so a
    // USSR scanner must filter them out under empty fog (C++ Evaluate_Object
    // rejects them because !IsOwnedByPlayer=!(PlayerPtr==England)=true).
    const ussrInf = makeEntity(UnitType.I_E1, House.USSR, 30, 60);
    ussrInf.mission = Mission.GUARD;
    ussrInf.attackCooldown = 0;

    const englandInf = makeEntity(UnitType.I_E1, House.England, 29, 60);
    englandInf.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [ussrInf, englandInf] });
    updateGuard(ctx, ussrInf, /*timerFired=*/ true);

    expect(ussrInf.target, 'USSR must NOT acquire England (player-allied) target under empty fog').toBeNull();
  });
});
