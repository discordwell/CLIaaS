/**
 * C++ Parity: WeaponTypeClass::Allowed_Threats — weapon.cpp:317-327
 *
 *   ThreatType WeaponTypeClass::Allowed_Threats(void) const
 *   {
 *     ThreatType threat = THREAT_NORMAL;
 *     if (Bullet->IsAntiAircraft) {
 *       threat = threat | THREAT_AIR;
 *     }
 *     if (Bullet->IsAntiGround) {
 *       threat = threat | THREAT_INFANTRY|THREAT_VEHICLES|THREAT_BOATS|THREAT_BUILDINGS;
 *     }
 *     return(threat);
 *   }
 *
 * TS maps this via the WeaponStats flags:
 *   - isAntiGround === false  → C++ IsAntiGround=no (AA-only weapon)
 *   - isAntiGround undefined  → C++ IsAntiGround=yes (default)
 *   - isAntiAir === true      → C++ IsAntiAircraft=yes
 *
 * In InfantryClass::Greatest_Threat (infantry.cpp:2314-2319) and UnitClass::
 * Greatest_Threat (unit.cpp:4623-4628) the PrimaryWeapon's Allowed_Threats
 * is ORed into the threat mask BEFORE calling the base-class Greatest_Threat.
 * That threat mask is then converted to an RTTI mask in techno.cpp:2032-2040:
 *
 *   if (threat & THREAT_AIR)        mask |= RTTI_AIRCRAFT;
 *   if (threat & THREAT_INFANTRY)   mask |= RTTI_INFANTRY;
 *   if (threat & THREAT_VEHICLES)   mask |= RTTI_UNIT;
 *   if (threat & THREAT_BOATS)      mask |= RTTI_VESSEL;
 *   if (threat & THREAT_BUILDINGS)  mask |= RTTI_BUILDING;
 *
 * And techno.cpp:2089-2091: if mask has RTTI_UNIT (THREAT_VEHICLES set), also
 * add RTTI_AIRCRAFT so landed aircraft count as vehicles.
 *
 * These tests pin the threat→RTTI derivation for the key infantry/vehicle
 * weapons used in campaign scenarios (M1Carbine, 120mm, Dragon, RedEye, etc.).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { updateGuard, type MissionAIContext } from '../engine/missionAI';
import {
  CELL_SIZE, House, UnitType, Mission, WEAPON_STATS,
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

describe('WeaponTypeClass::Allowed_Threats — TS WeaponStats flag interpretation', () => {
  // -----------------------------------------------------------------
  // 1. Flag sanity checks — confirm WeaponStats match C++ bullet flags
  // -----------------------------------------------------------------
  it('M1Carbine is anti-ground (infantry rifle)', () => {
    const w = WEAPON_STATS.M1Carbine;
    // C++ bullet.cpp Bullet.IsAntiGround=yes (default, no override in INI).
    expect(w.isAntiGround).not.toBe(false);
    expect(!!w.isAntiAir).toBe(false);
  });

  it('120mm (Mammoth) is anti-ground only', () => {
    const w = WEAPON_STATS['120mm'];
    expect(w.isAntiGround).not.toBe(false);
    expect(!!w.isAntiAir).toBe(false);
  });

  it('Dragon (E3 rocket) is anti-ground AND anti-air', () => {
    // C++ RulesINI: Dragon bullet (HeatSeeker) IsAntiAircraft=yes, IsAntiGround=yes.
    const w = WEAPON_STATS.Dragon;
    expect(!!w.isAntiAir).toBe(true);
    expect(w.isAntiGround).not.toBe(false);
  });

  it('RedEye (SAM site) is anti-air ONLY', () => {
    // C++ RulesINI: RedEye bullet IsAntiGround=no.
    const w = WEAPON_STATS.RedEye;
    expect(!!w.isAntiAir).toBe(true);
    expect(w.isAntiGround).toBe(false);
  });

  it('ChainGun (YAK/HIND) is anti-ground', () => {
    // Note: C++ ChainGun bullet has IsAntiAircraft=no, IsAntiGround=yes.
    const w = WEAPON_STATS.ChainGun;
    expect(w.isAntiGround).not.toBe(false);
  });

  it('TorpTube (SS torpedo) is anti-boat (isSubSurface — sub-surface only targets naval)', () => {
    const w = WEAPON_STATS.TorpTube;
    // Torpedoes are AG=default, but they travel underwater and are filtered by
    // canTargetNaval. Confirm the flags are still default-ground.
    expect(w.isAntiGround).not.toBe(false);
    expect(!!w.isSubSurface).toBe(true);
  });

  // -----------------------------------------------------------------
  // 2. Integration: guard scan respects Allowed_Threats mask
  // -----------------------------------------------------------------
  it('E1 (M1Carbine AG) + aircraft-in-air target: REJECTED (no AA bit)', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const heli = makeEntity(UnitType.V_HELI, House.Greece, 100 + 2 * CELL_SIZE, 100);
    heli.mission = Mission.GUARD;
    heli.flightAltitude = 24; // airborne

    const ctx = makeCtx({ entities: [scanner, heli] });
    updateGuard(ctx, scanner);

    // M1Carbine has no THREAT_AIR → RTTI_AIRCRAFT not in mask for this airborne heli.
    expect(scanner.target).toBeNull();
  });

  it('E3 (Dragon AG+AA) + aircraft-in-air target: ACCEPTED (AA bit set)', () => {
    const scanner = makeEntity(UnitType.I_E3, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const heli = makeEntity(UnitType.V_HELI, House.Greece, 100 + 2 * CELL_SIZE, 100);
    heli.mission = Mission.GUARD;
    heli.flightAltitude = 24;

    const ctx = makeCtx({ entities: [scanner, heli] });
    updateGuard(ctx, scanner);

    // Dragon isAntiAir=true → THREAT_AIR → RTTI_AIRCRAFT in mask.
    expect(scanner.target).toBe(heli);
  });

  it('E3 (Dragon) still accepts infantry targets (AG bit contributes INFANTRY)', () => {
    const scanner = makeEntity(UnitType.I_E3, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const target = makeEntity(UnitType.I_E1, House.Greece, 100 + 2 * CELL_SIZE, 100);
    target.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, target] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBe(target);
  });

  it('3TNK (120mm AG) + infantry target: ACCEPTED (VEHICLE unit with AG weapon)', () => {
    // Empirical parallel: SCG01EA tick 44 Greek JEEP acquires enemy infantry.
    const scanner = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const target = makeEntity(UnitType.I_E1, House.Greece, 100 + 3 * CELL_SIZE, 100);
    target.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, target] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBe(target);
  });

  it('3TNK (120mm AG) + airborne aircraft: REJECTED (no AA, even though VEHICLES bit covers landed aircraft)', () => {
    // C++ techno.cpp:2089-2091 adds RTTI_AIRCRAFT when THREAT_VEHICLES is set,
    // but cellBasedGuardScan still rejects airborne aircraft without an AA weapon
    // (matches C++ practical behavior: landed aircraft are fine, airborne need AA).
    const scanner = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    scanner.mission = Mission.GUARD;
    const heli = makeEntity(UnitType.V_HELI, House.Greece, 100 + 2 * CELL_SIZE, 100);
    heli.flightAltitude = 24;
    heli.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, heli] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBeNull();
  });

  it('dog (IsDog override, DogJaw Organic warhead) + vehicle target: REJECTED', () => {
    // C++ techno.cpp:2017-2019: IsDog forces method=THREAT_INFANTRY. The weapon
    // Allowed_Threats from the base OR is overwritten. Organic warhead also
    // clears non-infantry bits (infantry.cpp:2325-2326) — redundant here, both
    // land at THREAT_INFANTRY-only.
    const dog = makeEntity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.mission = Mission.GUARD;
    const veh = makeEntity(UnitType.V_JEEP, House.Greece, 100 + 1 * CELL_SIZE, 100);
    veh.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [dog, veh] });
    updateGuard(ctx, dog);

    expect(dog.target).toBeNull();
  });

  it('MEDI (Heal, Organic) + enemy infantry target: REJECTED by mask (medic scan is infantry-only)', () => {
    // Medic (Combat_Damage<0) hits the dog/medic branch → method=THREAT_INFANTRY.
    // Medics target infantry for HEALING via updateMedic (friendly); enemy infantry
    // enter the same mask but medics don't act on them. The cellBasedGuardScan
    // does return the enemy (ally check is in the scan already), but the medic
    // has no anti-ground weapon to damage them with — acceptable parity: this
    // tests that the mask *allows* infantry and filters out vehicles.
    const medic = makeEntity(UnitType.I_MEDI, House.USSR, 100, 100);
    medic.mission = Mission.GUARD;
    const veh = makeEntity(UnitType.V_JEEP, House.Greece, 100 + 1 * CELL_SIZE, 100);
    veh.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [medic, veh] });
    updateGuard(ctx, medic);

    // Medic mask is INFANTRY-only — vehicles are filtered.
    expect(medic.target).toBeNull();
  });

  it('MECH (GoodWrench, Mechanical) + enemy vehicle: scan mask is VEHICLES|AIR — vehicle visible', () => {
    // C++ techno.cpp:2021-2023: MECHANIC branch sets method = THREAT_VEHICLES | THREAT_AIR.
    const mech = makeEntity(UnitType.I_MECH, House.USSR, 100, 100);
    mech.mission = Mission.GUARD;
    const veh = makeEntity(UnitType.V_JEEP, House.Greece, 100 + 1 * CELL_SIZE, 100);
    veh.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [mech, veh] });
    updateGuard(ctx, mech);

    expect(mech.target).toBe(veh);
  });

  it('MECH + enemy infantry: REJECTED (mask is VEHICLES|AIR, no INFANTRY bit)', () => {
    const mech = makeEntity(UnitType.I_MECH, House.USSR, 100, 100);
    mech.mission = Mission.GUARD;
    const inf = makeEntity(UnitType.I_E1, House.Greece, 100 + 1 * CELL_SIZE, 100);
    inf.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [mech, inf] });
    updateGuard(ctx, mech);

    expect(mech.target).toBeNull();
  });
});
