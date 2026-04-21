/**
 * C++ Parity: Mission_Guard Scan Mask — THREAT_RANGE → mask=0 No-Op for Regular Units
 *
 * FootClass::Mission_Guard (foot.cpp:638-698) calls:
 *   Target_Something_Nearby(THREAT_RANGE)
 *     → Greatest_Threat(THREAT_RANGE) (techno.cpp:1987)
 *
 * In Greatest_Threat, method = THREAT_RANGE is preserved through the dog/medic branch
 * (techno.cpp:2013-2026):
 *   - Dogs (IsDog) → method = THREAT_INFANTRY | (method & RANGE/AREA)
 *   - Medics (Combat_Damage() < 0) → method = THREAT_INFANTRY | (method & RANGE/AREA)
 *   - Mechanics (FIXIT_CSII) → method = (THREAT_VEHICLES|THREAT_AIR) | (method & RANGE/AREA)
 *   - Everything else → method unchanged (= THREAT_RANGE only)
 *
 * The mask is then built (techno.cpp:2032-2040) from type bits (CIVILIANS, AIR, CAPTURE,
 * INFANTRY, VEHICLES, BUILDINGS, BOATS, TIBERIUM, BASE_DEFENSE). For pure THREAT_RANGE
 * with no type bits, mask = 0.
 *
 * Evaluate_Object (techno.cpp:1534-1542) hard-rejects when mask = 0:
 *   RTTIType otype = object->What_Am_I();
 *   if (!((1 << otype) & mask)) return(false);   // Mask failure.
 *
 * Therefore: for regular infantry and vehicles, Mission_Guard's scan is a no-op. Auto-
 * acquire in GUARD happens only via:
 *   (a) TechnoClass::Assign_Target(source) in take_damage — retaliation
 *   (b) Explicit player/team orders
 *   (c) Dog/medic/mechanic specialized scans
 *
 * Regression context:
 *   - Before commit a47eb9a9 (same-tick Firing_AI), TS's cellBasedGuardScan could set
 *     a target but Firing_AI only fired on the NEXT tick — tolerable for RNG timing.
 *   - After a47eb9a9, Firing_AI fires SAME TICK as scan. Combined with commit 9a334f4b
 *     (invisible-bullet Coord_Scatter same-tick end-of-loop), TS now consumed an extra
 *     Coord_Scatter RNG on ticks where C++ would never have acquired a target at all.
 *   - Surfaced as SCG03EA tick 238 and SCG06EA tick 63 divergences.
 *
 * Fix: gate cellBasedGuardScan + structure-scan in updateGuard to run only for dogs
 * (the only unit type where C++ Mission_Guard's scan mask is non-zero — medics and
 * mechanics are dispatched earlier via updateMedic/updateMechanicUnit).
 *
 * C++ references:
 *   - foot.cpp:638-698       — FootClass::Mission_Guard (base, THREAT_RANGE)
 *   - foot.cpp:1037-1098     — FootClass::Mission_Guard_Area (THREAT_AREA, also mask=0)
 *   - techno.cpp:1987-2210   — TechnoClass::Greatest_Threat (mask construction + cell scan)
 *   - techno.cpp:1534-1542   — Evaluate_Object mask check (rejects when mask & RTTI == 0)
 *   - techno.cpp:2013-2026   — Type-bit additions for dog/medic/mechanic only
 *   - techno.cpp:5263-5293   — Target_Something_Nearby (delegates to Greatest_Threat)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { updateGuard, type MissionAIContext } from '../engine/missionAI';
import {
  CELL_SIZE, House, UnitType, Mission,
} from '../engine/types';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType | string, house: House, x: number, y: number): Entity {
  return new Entity(type as UnitType, house, x, y);
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
    tick: 100,
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
    isRevealedToHouse: () => true,
    ...overrides,
  };
}

describe('Mission_Guard scan mask — C++ techno.cpp:2013-2026 + 2032-2040', () => {
  it('regular infantry (E1) Mission_Guard does NOT auto-acquire infantry targets (mask=0)', () => {
    // C++ Greatest_Threat(THREAT_RANGE) for non-dog/medic/mechanic: mask=0 →
    // Evaluate_Object rejects every RTTI type → no target found.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    // Enemy well within weapon range (M1Carbine=3.0)
    const enemy = makeEntity(UnitType.I_E1, House.Greece, 100 + 2 * CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, enemy] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBeNull();
    expect(scanner.mission).toBe(Mission.GUARD);
  });

  it('regular infantry (E1) Mission_Guard does NOT auto-acquire vehicle targets (mask=0)', () => {
    const scanner = makeEntity(UnitType.I_E3, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.V_JEEP, House.Greece, 100 + 2 * CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, enemy] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBeNull();
  });

  it('vehicle (3TNK) Mission_Guard does NOT auto-acquire enemy vehicle (mask=0)', () => {
    const scanner = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.V_1TNK, House.Greece, 100 + 3 * CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, enemy] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBeNull();
  });

  it('vehicle (3TNK) Mission_Guard does NOT auto-acquire enemy STRUCTURE (mask=0)', () => {
    // C++ techno.cpp:2032-2040 — RTTI_BUILDING added to mask only for THREAT_BUILDINGS/
    // CIVILIANS/BASE_DEFENSE/CAPTURE/TIBERIUM/POWER/FACTORIES/FAKES. None are set by
    // Mission_Guard's THREAT_RANGE, so buildings are invisible.
    const scanner = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const enemyStruct = {
      alive: true, cx: 4, cy: 4, house: House.Greece,
      type: 'WEAP', hp: 100, maxHp: 400,
    };

    const ctx = makeCtx({ entities: [scanner], structures: [enemyStruct] });
    updateGuard(ctx, scanner);

    expect(scanner.targetStructure).toBeNull();
    expect(scanner.mission).toBe(Mission.GUARD);
  });

  it('DOG Mission_Guard DOES auto-acquire infantry targets (THREAT_INFANTRY bit added)', () => {
    // C++ techno.cpp:2018-2019 — dogs get method = THREAT_INFANTRY → mask includes
    // RTTI_INFANTRY. Dogs can auto-acquire infantry targets in Mission_Guard.
    const dog = makeEntity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.I_E1, House.Greece, 100 + 2 * CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [dog, enemy] });
    updateGuard(ctx, dog);

    expect(dog.target).toBe(enemy);
  });

  it('DOG Mission_Guard does NOT auto-acquire vehicle targets (THREAT_INFANTRY only)', () => {
    // C++ techno.cpp:2019 forces method=THREAT_INFANTRY for dogs — vehicles excluded.
    const dog = makeEntity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.mission = Mission.GUARD;
    const vehicle = makeEntity(UnitType.V_JEEP, House.Greece, 100 + 2 * CELL_SIZE, 100);
    vehicle.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [dog, vehicle] });
    updateGuard(ctx, dog);

    expect(dog.target).toBeNull();
  });

  it('retaliation target is respected even though Mission_Guard scan is a no-op', () => {
    // Real-world path: C++ take_damage calls Assign_Target(source) on the victim, so
    // the victim's next updateGuard sees entity.target set and fires via Firing_AI
    // (missionAI.ts line ~886). The gating does NOT prevent this — it only skips
    // the fresh cell-scan target-acquisition step.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const attacker = makeEntity(UnitType.I_E1, House.Greece, 100 + 2 * CELL_SIZE, 100);
    attacker.mission = Mission.GUARD;
    // Simulate retaliation: attacker damaged scanner → scanner.target = attacker
    scanner.target = attacker;

    const ctx = makeCtx({ entities: [scanner, attacker] });
    updateGuard(ctx, scanner);

    // Target kept (C++ Target_Something_Nearby techno.cpp:5272-5279 retains legal TarCom
    // in range before calling Greatest_Threat).
    expect(scanner.target).toBe(attacker);
  });

  it('stale out-of-range target is cleared and NOT replaced by scan (mask=0)', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    // Target far out of weapon range (M1Carbine=3.0 cells)
    const farTarget = makeEntity(UnitType.I_E1, House.Greece, 100 + 10 * CELL_SIZE, 100);
    farTarget.mission = Mission.GUARD;
    scanner.target = farTarget;
    // A candidate that WOULD be in range — but scan is mask=0 no-op, so it's ignored.
    const inRangeCandidate = makeEntity(UnitType.I_E1, House.Greece, 100 + 2 * CELL_SIZE, 100);
    inRangeCandidate.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, farTarget, inRangeCandidate] });
    updateGuard(ctx, scanner);

    // Stale target cleared (C++ Assign_Target(TARGET_NONE) at techno.cpp:5276); the
    // subsequent Greatest_Threat call returns nothing for regular infantry (mask=0).
    expect(scanner.target).toBeNull();
  });
});
