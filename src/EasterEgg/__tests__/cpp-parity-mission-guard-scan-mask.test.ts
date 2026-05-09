/**
 * C++ Parity: Mission_Guard Scan Mask — Weapon Allowed_Threats Determines RTTI Mask
 *
 * FootClass::Mission_Guard (foot.cpp:638-698) calls:
 *   Target_Something_Nearby(THREAT_RANGE)
 *     → Greatest_Threat(THREAT_RANGE)
 *
 * Virtual dispatch lands in the SUBCLASS override before the base-class scan:
 *   - InfantryClass::Greatest_Threat (infantry.cpp:2283-2352)
 *   - UnitClass::Greatest_Threat     (unit.cpp:4620-4637)
 *
 * Both subclass overrides OR the weapon's Allowed_Threats bits into the `threat`
 * parameter BEFORE delegating to FootClass/TechnoClass::Greatest_Threat:
 *   threat |= Class->PrimaryWeapon->Allowed_Threats();
 *   threat |= Class->SecondaryWeapon->Allowed_Threats();
 *
 * WeaponTypeClass::Allowed_Threats (weapon.cpp:317-327) returns:
 *   - THREAT_NORMAL always
 *   - if Bullet->IsAntiAircraft: | THREAT_AIR
 *   - if Bullet->IsAntiGround:   | THREAT_INFANTRY|THREAT_VEHICLES|THREAT_BOATS|THREAT_BUILDINGS
 *
 * The base TechnoClass::Greatest_Threat (techno.cpp:2032-2040) then converts
 * threat bits to an RTTI mask. Evaluate_Object (techno.cpp:1534-1542) hard-rejects
 * candidates whose RTTI type doesn't match the mask.
 *
 * CONSEQUENCE:
 *   - Regular armed infantry (E1/E3/etc.) with anti-ground weapon: MASK includes
 *     RTTI_INFANTRY | RTTI_UNIT | RTTI_VESSEL | RTTI_BUILDING (+RTTI_AIRCRAFT for
 *     landed aircraft via techno.cpp:2089-2091). They DO auto-acquire in GUARD.
 *   - Regular armed vehicles: same set.
 *   - Dogs (IsDog hack, techno.cpp:2018-2019): method = THREAT_INFANTRY → only
 *     infantry candidates. Spies excluded from non-dog scans (techno.cpp:1557-1564).
 *   - Human-controlled armed infantry: BUILDINGS cleared (infantry.cpp:2332-2334).
 *   - Human-controlled Tanya: returns TARGET_NONE (infantry.cpp:2310-2312).
 *   - Civilians without a PrimaryWeapon: infantry.cpp:2300-2304 early-returns
 *     TARGET_NONE.
 *   - Organic warhead (dog jaw, medic heal): infantry.cpp:2325-2326 clears
 *     BUILDING|VEHICLE|BOAT|AIR — they only see infantry.
 *
 * Empirical confirmation (WASM fprintf traces):
 *   - SCG06EA tick 62: Greek E1 rifleman at cell (19,65) acquires BadGuy E1 via
 *     Mission_Guard → Target_Something_Nearby → Greatest_Threat → Assign_Target.
 *   - SCG01EA tick 44: Greek JEEP at cell (62,50) acquires a BadGuy infantry.
 *
 * C++ references:
 *   - foot.cpp:638-698       — FootClass::Mission_Guard (base, THREAT_RANGE)
 *   - infantry.cpp:2283-2352 — InfantryClass::Greatest_Threat (weapon OR + cleanup)
 *   - unit.cpp:4620-4637     — UnitClass::Greatest_Threat (weapon OR)
 *   - weapon.cpp:317-327     — WeaponTypeClass::Allowed_Threats
 *   - techno.cpp:1987-2210   — base TechnoClass::Greatest_Threat (mask + cell scan)
 *   - techno.cpp:1534-1542   — Evaluate_Object mask check
 *   - techno.cpp:2013-2026   — Dog/medic/mechanic method OVERRIDE (wipes weapon bits)
 *   - techno.cpp:2089-2091   — THREAT_VEHICLES also adds RTTI_AIRCRAFT to mask
 *   - techno.cpp:5263-5293   — Target_Something_Nearby
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

describe('Mission_Guard scan mask — C++ InfantryClass/UnitClass::Greatest_Threat weapon OR', () => {
  it('regular infantry (E1) Mission_Guard DOES auto-acquire enemy infantry (weapon is anti-ground)', () => {
    // C++ InfantryClass::Greatest_Threat ORs M1Carbine.Allowed_Threats (IsAntiGround)
    // → mask includes RTTI_INFANTRY. Evaluate_Object accepts the E1 candidate.
    // Empirical: SCG06EA tick 62 Greek E1 acquires BadGuy E1 via this path.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.I_E1, House.Greece, 100 + 2 * CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, enemy] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBe(enemy);
  });

  it('regular infantry (E3) Mission_Guard DOES auto-acquire enemy vehicle (weapon is anti-ground)', () => {
    // Dragon is anti-ground AND anti-air — Allowed_Threats includes vehicles.
    const scanner = makeEntity(UnitType.I_E3, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.V_JEEP, House.Greece, 100 + 2 * CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, enemy] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBe(enemy);
  });

  it('vehicle (3TNK) Mission_Guard DOES auto-acquire enemy vehicle (120mm anti-ground)', () => {
    // Empirical: SCG01EA tick 44 Greek JEEP acquires BadGuy infantry via the
    // same UnitClass::Greatest_Threat weapon-OR path.
    const scanner = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.V_1TNK, House.Greece, 100 + 3 * CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, enemy] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBe(enemy);
  });

  it('NON-human armed vehicle DOES auto-acquire enemy STRUCTURE (anti-ground weapon includes THREAT_BUILDINGS)', () => {
    // C++ UnitClass::Greatest_Threat does NOT clear BUILDINGS (unit.cpp:4630-4634
    // #ifdef OBSOLETE gates out the human-skip). An AI vehicle with anti-ground
    // weapon targets enemy structures in range.
    const scanner = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const enemyStruct = {
      alive: true, cx: 4, cy: 4, house: House.Greece,
      type: 'WEAP', hp: 100, maxHp: 400,
    };

    const ctx = makeCtx({
      entities: [scanner],
      structures: [enemyStruct],
      playerHouse: House.Greece, // USSR = AI
    });
    updateGuard(ctx, scanner);

    expect(scanner.targetStructure).toBe(enemyStruct);
    expect(scanner.mission).toBe(Mission.ATTACK);
  });

  it('HUMAN-controlled armed infantry (E1) does NOT auto-acquire enemy STRUCTURE (BUILDINGS cleared)', () => {
    // C++ infantry.cpp:2332-2334: human infantry with weapon → threat &= ~THREAT_BUILDINGS.
    // Mask loses RTTI_BUILDING. The infantry can still acquire other infantry.
    const scanner = makeEntity(UnitType.I_E1, House.Greece, 100, 100);
    scanner.mission = Mission.GUARD;
    const enemyStruct = {
      alive: true, cx: 4, cy: 4, house: House.USSR,
      type: 'WEAP', hp: 100, maxHp: 400,
    };

    const ctx = makeCtx({
      entities: [scanner],
      structures: [enemyStruct],
      playerHouse: House.Greece, // Greece = human
    });
    updateGuard(ctx, scanner);

    expect(scanner.targetStructure).toBeNull();
    expect(scanner.mission).toBe(Mission.GUARD);
  });

  it('DOG Mission_Guard DOES auto-acquire infantry (THREAT_INFANTRY override wipes weapon bits)', () => {
    // C++ techno.cpp:2018-2019: dog branch REPLACES method with THREAT_INFANTRY.
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

  it('MEDI Mission_Guard acquires injured allied infantry via normal C++ negative-damage scan', () => {
    // C++ FootClass::Mission_Guard has no medic-only pre-pass. The normal
    // Target_Something_Nearby(THREAT_RANGE) path reaches TechnoClass::Evaluate_Cell:
    // if Combat_Damage() < 0, it picks the first injured allied techno in the
    // cell occupier chain (techno.cpp:1831-1843), and Evaluate_Object accepts it
    // only if Health_Ratio() != ConditionGreen (techno.cpp:1491-1506).
    const medic = makeEntity(UnitType.I_MEDI, House.Greece, 100, 100);
    medic.mission = Mission.GUARD;
    const wounded = makeEntity(UnitType.I_E1, House.Greece, 100 + CELL_SIZE, 100);
    wounded.mission = Mission.GUARD;
    wounded.hp = wounded.maxHp - 1;
    const updateMedic = vi.fn();

    const ctx = makeCtx({ entities: [medic, wounded], updateMedic });
    updateGuard(ctx, medic);

    expect(updateMedic).not.toHaveBeenCalled();
    expect(medic.target).toBe(wounded);
  });

  it('MEDI Mission_Guard rejects full-health allies and enemies in C++ negative-damage cell scan', () => {
    // For Combat_Damage() < 0, Evaluate_Cell does not break on enemies and only
    // breaks on allies whose Health_Ratio() < ConditionGreen.
    const medic = makeEntity(UnitType.I_MEDI, House.Greece, 100, 100);
    medic.mission = Mission.GUARD;
    const healthyAlly = makeEntity(UnitType.I_E1, House.Greece, 100 + CELL_SIZE, 100);
    healthyAlly.mission = Mission.GUARD;
    healthyAlly.hp = healthyAlly.maxHp;
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100 + CELL_SIZE);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [medic, healthyAlly, enemy] });
    updateGuard(ctx, medic);

    expect(medic.target).toBeNull();
  });

  it('MECH Mission_Guard acquires injured allied vehicles, not infantry', () => {
    // FIXIT_CSII mechanic path: Combat_Damage() < 0 plus method =
    // THREAT_VEHICLES|THREAT_AIR (techno.cpp:2013-2026). The friendly/injured
    // negative-damage Evaluate_Cell rule is shared with medics.
    const mech = makeEntity(UnitType.I_MECH, House.Greece, 100, 100);
    mech.mission = Mission.GUARD;
    // Keep this focused on Target_Something_Nearby acquisition. The separate
    // infantry Firing_AI path has its own launch-stage/repair tests.
    mech.attackCooldown = 1;
    const woundedInfantry = makeEntity(UnitType.I_E1, House.Greece, 100 + CELL_SIZE, 100);
    woundedInfantry.mission = Mission.GUARD;
    woundedInfantry.hp = woundedInfantry.maxHp - 1;
    const woundedVehicle = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100 + CELL_SIZE / 2);
    woundedVehicle.mission = Mission.GUARD;
    woundedVehicle.hp = woundedVehicle.maxHp - 1;
    const updateMechanicUnit = vi.fn();

    const ctx = makeCtx({ entities: [mech, woundedInfantry, woundedVehicle], updateMechanicUnit });
    updateGuard(ctx, mech);

    expect(updateMechanicUnit).not.toHaveBeenCalled();
    expect(mech.target).toBe(woundedVehicle);
  });

  it('civilian (C1) without PrimaryWeapon does NOT auto-acquire (mask=0, also civilianSkipScan)', () => {
    // C++ infantry.cpp:2300-2304: unarmed infantry that are not Renovator/Spy/Thief
    // return TARGET_NONE early. TS civilians also hit the civilianSkipScan branch.
    const civilian = makeEntity(UnitType.I_C1, House.Greece, 100, 100);
    civilian.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 100 + 2 * CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [civilian, enemy], playerHouse: House.Greece });
    updateGuard(ctx, civilian);

    expect(civilian.target).toBeNull();
  });

  it('human-controlled TANYA does NOT auto-acquire (infantry.cpp:2310-2312 TARGET_NONE)', () => {
    // Special hack: Tanya under human control does not auto-fire.
    const tanya = makeEntity(UnitType.I_TANYA, House.Greece, 100, 100);
    tanya.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 100 + 2 * CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [tanya, enemy], playerHouse: House.Greece });
    updateGuard(ctx, tanya);

    expect(tanya.target).toBeNull();
  });

  it('harvester (V_HARV) does NOT auto-acquire (no primary weapon, early-return)', () => {
    const harv = makeEntity(UnitType.V_HARV, House.USSR, 100, 100);
    harv.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.I_E1, House.Greece, 100 + 2 * CELL_SIZE, 100);
    enemy.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [harv, enemy] });
    updateGuard(ctx, harv);

    expect(harv.target).toBeNull();
  });

  it('retaliation target is kept across the scan (top-of-updateGuard Firing_AI retains legal TarCom)', () => {
    // C++ Target_Something_Nearby (techno.cpp:5298-5305) retains TarCom if legal
    // AND in range, so retaliation targets persist across GUARD ticks.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const attacker = makeEntity(UnitType.I_E1, House.Greece, 100 + 2 * CELL_SIZE, 100);
    attacker.mission = Mission.GUARD;
    scanner.target = attacker;

    const ctx = makeCtx({ entities: [scanner, attacker] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBe(attacker);
  });

  it('stale out-of-range target is cleared, scan picks up a new in-range candidate', () => {
    // C++ Target_Something_Nearby clears TarCom when out-of-range, then calls
    // Greatest_Threat. With the weapon-OR mask, a new in-range candidate is found.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const farTarget = makeEntity(UnitType.I_E1, House.Greece, 100 + 10 * CELL_SIZE, 100);
    farTarget.mission = Mission.GUARD;
    scanner.target = farTarget;
    const inRangeCandidate = makeEntity(UnitType.I_E1, House.Greece, 100 + 2 * CELL_SIZE, 100);
    inRangeCandidate.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, farTarget, inRangeCandidate] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBe(inRangeCandidate);
  });
});
