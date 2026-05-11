/**
 * C++ Parity: Guard Target Selection — Cell-Based Scan & Existing Target Retention
 *
 * Tests the two key C++ parity fixes in updateGuard():
 *
 * 1. EXISTING TARGET RETENTION (techno.cpp:5260-5266)
 *    C++ Target_Something_Nearby checks if the existing TarCom is still legal and
 *    in range BEFORE calling Greatest_Threat. If the existing target is valid, it
 *    stays — no rescan occurs. This prevents guard units from switching targets
 *    every scan cycle when the current target is still valid.
 *
 * 2. CELL-BASED SCAN ORDER (techno.cpp:2108-2209)
 *    C++ Greatest_Threat with THREAT_RANGE scans cells in a radial outward pattern
 *    from the scanner's Fire_Coord cell. A bug in the C++ code means bestval is
 *    never updated during the cell scan, so the LAST valid target in scan order
 *    wins (not the highest-scoring one). Early bailout at crange/4 and crange/2.
 *
 * Key C++ references:
 *   - foot.cpp:589-634      — Mission_Guard: calls Target_Something_Nearby(THREAT_RANGE)
 *   - techno.cpp:5251-5281  — Target_Something_Nearby: existing target check, then Greatest_Threat
 *   - techno.cpp:2108-2209  — Cell-based radial scan with bestval bug
 *   - techno.cpp:2198-2205  — Early bailout at crange/4 and crange/2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { updateGuard, updateHunt, type MissionAIContext } from '../engine/missionAI';
import { ScenarioRandom } from '../engine/random';
import {
  CELL_SIZE, House, UnitType, Mission, Stance,
  worldDist,
} from '../engine/types';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType | string, house: House, x: number, y: number): Entity {
  return new Entity(type as UnitType, house, x, y);
}

function makeCtx(overrides: Partial<MissionAIContext> & { entities?: Entity[] }): MissionAIContext {
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
    threatScore: (_scanner, _target, dist) => 100 - Math.floor(dist),
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

describe('Existing target retention — C++ techno.cpp:5260-5266', () => {
  it('keeps existing target when still alive and in range (no rescan)', () => {
    // C++ Target_Something_Nearby: if Target_Legal(TarCom) && In_Range(TarCom, primary),
    // keep existing target — Greatest_Threat is NOT called.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;

    const existingTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 2 * CELL_SIZE, 200);
    existingTarget.mission = Mission.GUARD;

    // A closer (higher-scoring) target exists
    const closerTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 1 * CELL_SIZE, 200);
    closerTarget.mission = Mission.GUARD;

    // Pre-set the existing target
    scanner.target = existingTarget;

    const ctx = makeCtx({ entities: [scanner, existingTarget, closerTarget] });
    updateGuard(ctx, scanner); // timer fired

    // C++ would keep the existing target because it's still valid and in range.
    // The closer target is NOT selected — Greatest_Threat is never called.
    expect(scanner.target).toBe(existingTarget);
  });

  it('clears existing target when out of range and rescans', () => {
    // C++ Target_Something_Nearby: if Target_Legal(TarCom) && !(In_Range(TarCom, primary)),
    // Assign_Target(TARGET_NONE), then call Greatest_Threat.
    //
    // Use DOG scanner: C++ Mission_Guard only scans (acquires) for dog/medic/mechanic
    // (techno.cpp:2013-2026 — type bits added only for these). Regular infantry
    // Mission_Guard is a mask=0 no-op scan.
    const scanner = makeEntity(UnitType.I_DOG, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;

    // Place existing target well out of range (dog guardRange = 7 cells)
    const farTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 12 * CELL_SIZE, 200);
    farTarget.mission = Mission.GUARD;

    // A new target in range
    const nearTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 2 * CELL_SIZE, 200);
    nearTarget.mission = Mission.GUARD;

    scanner.target = farTarget;

    const ctx = makeCtx({ entities: [scanner, farTarget, nearTarget] });
    updateGuard(ctx, scanner);

    // Existing target out of range → cleared → rescan finds near target
    expect(scanner.target).toBe(nearTarget);
  });

  it('clears existing target when dead and rescans', () => {
    // Use DOG scanner — see note above.
    const scanner = makeEntity(UnitType.I_DOG, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;

    const deadTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 2 * CELL_SIZE, 200);
    deadTarget.alive = false; // inactive/removed object, not a corpse in Cell_Occupier
    deadTarget.inLimbo = true;

    const aliveTarget = makeEntity(UnitType.I_E1, House.Greece, 200 + 1.5 * CELL_SIZE, 200);
    aliveTarget.mission = Mission.GUARD;

    scanner.target = deadTarget;

    const ctx = makeCtx({ entities: [scanner, deadTarget, aliveTarget] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBe(aliveTarget);
  });

  it('treats zero-strength existing target as illegal even if object is still active', () => {
    // C++ TechnoClass::Assign_Target rejects object targets with Strength == 0
    // (techno.cpp:2887-2889), even when the object is still active during its
    // death animation. SCG06EA t133 depends on this: TarCom points at a corpse
    // that remains in the cell occupier chain.
    const scanner = makeEntity(UnitType.I_E1, House.Greece, 20 * CELL_SIZE, 64 * CELL_SIZE);
    scanner.mission = Mission.GUARD;

    const corpse = makeEntity(UnitType.I_E1, House.USSR, 21 * CELL_SIZE, 65 * CELL_SIZE);
    corpse.alive = true;
    corpse.hp = 0;
    corpse.mission = Mission.DIE;
    corpse.inLimbo = false;

    scanner.target = corpse;

    const ctx = makeCtx({ entities: [scanner, corpse] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBeNull();
  });
});

describe('Vessel hunt target mask — C++ vessel.cpp:1223-1256', () => {
  it('submarines on HUNT acquire boat targets via VesselClass::Greatest_Threat', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR, 20 * CELL_SIZE, 53 * CELL_SIZE);
    sub.mission = Mission.HUNT;
    const pt = makeEntity(UnitType.V_PT, House.Greece, 16 * CELL_SIZE, 54 * CELL_SIZE);
    const ctx = makeCtx({ entities: [sub, pt] });

    updateHunt(ctx, sub);

    // VesselClass::Greatest_Threat maps submarine THREAT_NORMAL to
    // THREAT_BOATS|BUILDINGS|FACTORIES, so Mission_Hunt can acquire PT boats.
    expect(sub.target).toBe(pt);
  });

  it('HUNT scans use player discovery, not the scanner house reveal map', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR, 20 * CELL_SIZE, 53 * CELL_SIZE);
    sub.mission = Mission.HUNT;
    const alliedPt = makeEntity(UnitType.V_PT, House.England, 16 * CELL_SIZE, 54 * CELL_SIZE);
    const ctx = makeCtx({
      playerHouse: House.Spain,
      entities: [sub, alliedPt],
      isRevealedToHouse: (_cx, _cy, houseIdx) => houseIdx !== 0,
    });

    updateHunt(ctx, sub);

    // C++ techno.cpp:1529 checks IsDiscoveredByPlayer; non-PlayerPtr units are
    // ignored until the player has discovered them.
    expect(sub.target).toBeNull();
  });

  it('submarine Mission_Guard uses VesselClass::Greatest_Threat and acquires boats', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR, 20 * CELL_SIZE, 53 * CELL_SIZE);
    sub.mission = Mission.GUARD;
    const pt = makeEntity(UnitType.V_PT, House.Greece, 16 * CELL_SIZE, 54 * CELL_SIZE);
    const ctx = makeCtx({ entities: [sub, pt] });

    updateGuard(ctx, sub);

    // C++ FootClass::Mission_Guard calls Target_Something_Nearby(THREAT_RANGE)
    // for vessels. VesselClass::Greatest_Threat maps SS scans to
    // THREAT_BOATS|BUILDINGS|FACTORIES before delegating to TechnoClass.
    expect(sub.target).toBe(pt);
  });

  it('PT Mission_Guard acquires enemy vessels through weapon Allowed_Threats', () => {
    const pt = makeEntity(UnitType.V_PT, House.Greece, 19 * CELL_SIZE, 53 * CELL_SIZE);
    pt.mission = Mission.GUARD;
    const sub = makeEntity(UnitType.V_SS, House.USSR, 20 * CELL_SIZE, 53 * CELL_SIZE);
    sub.mission = Mission.HUNT;
    sub.cloakState = 0;
    const ctx = makeCtx({ entities: [pt, sub] });

    updateGuard(ctx, pt);

    // C++ SCG07EA tick 287: Greece PT at (19,53) acquires the USSR SS at
    // (20,53), fires, and its later Mission_Guard returns Arm instead of
    // consuming guard jitter RNG.
    expect(pt.target).toBe(sub);
  });
});

describe('Cell-based scan order — C++ techno.cpp:2108-2209', () => {
  it('cell scan order matches C++ radial pattern (last valid in order wins)', () => {
    // C++ bug: bestval is never updated in cell scan, so every valid target overwrites.
    // The last cell scanned with a valid target becomes the selection.
    // Scan order per ring: top row L→R, bottom row L→R, left col T→B, right col T→B.
    //
    // With two targets in the same ring, the one scanned LAST should win,
    // not the one with the higher threat score.
    //
    // Use DOG scanner: C++ Mission_Guard only scans for dog/medic/mechanic; regular
    // infantry Mission_Guard is a mask=0 no-op scan (techno.cpp:2013-2026).
    const scanner = makeEntity(UnitType.I_DOG, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;
    scanner.target = null;

    // Both targets at ring 1, same distance — different scan order positions
    // Place one on the top row (scanned first) and one on the right column (scanned last)
    const topRowTarget = makeEntity(UnitType.I_E1, House.Greece,
      200, 200 - 1 * CELL_SIZE); // top of ring 1
    topRowTarget.mission = Mission.GUARD;

    const rightColTarget = makeEntity(UnitType.I_E1, House.Greece,
      200 + 1 * CELL_SIZE, 200); // right of ring 1
    rightColTarget.mission = Mission.GUARD;

    // Use a threatScore that makes topRowTarget higher — old code would pick it,
    // but C++ cell scan order should pick rightColTarget (last in scan order).
    const ctx = makeCtx({
      entities: [scanner, topRowTarget, rightColTarget],
      threatScore: (_scanner, target, _dist) => {
        // Give top row target a MUCH higher score
        return target === topRowTarget ? 1000 : 1;
      },
    });
    updateGuard(ctx, scanner);

    // C++ cell scan: ring 1 scans top row, then bottom row, then left col, then right col.
    // rightColTarget is in the right column, scanned AFTER topRowTarget (top row).
    // Since bestval is never updated, rightColTarget overwrites topRowTarget.
    expect(scanner.target).toBe(rightColTarget);
  });

  it('uses candidate PlayerPtr visibility, not scanner ownership, before scan-order overwrite', () => {
    // C++ Evaluate_Object (techno.cpp:1529) rejects a candidate when the candidate
    // is neither owned by PlayerPtr nor discovered by PlayerPtr. The scanner being
    // player-controlled does not bypass this. This matches SCG06EA t87: Greece JEEP
    // ignores an undiscovered BadGuy E1 in an outer scan ring and targets the
    // discovered USSR E1 instead.
    const jeep = makeEntity(
      UnitType.V_JEEP,
      House.Greece,
      19 * CELL_SIZE + CELL_SIZE / 2,
      64 * CELL_SIZE + CELL_SIZE / 2,
    );
    jeep.mission = Mission.GUARD;
    jeep.target = null;

    const discoveredUsSr = makeEntity(
      UnitType.I_E1,
      House.USSR,
      22 * CELL_SIZE + CELL_SIZE / 2,
      65 * CELL_SIZE + CELL_SIZE / 2,
    );
    discoveredUsSr.mission = Mission.ATTACK;

    const hiddenBadGuy = makeEntity(
      UnitType.I_E1,
      House.BadGuy,
      18 * CELL_SIZE + CELL_SIZE / 2,
      68 * CELL_SIZE + CELL_SIZE / 2,
    );
    hiddenBadGuy.mission = Mission.MOVE;

    const ctx = makeCtx({
      entities: [jeep, discoveredUsSr, hiddenBadGuy],
      playerHouse: House.Greece,
      isRevealedToHouse: (cx, cy) => !(cx === 18 && cy === 68),
    });

    updateGuard(ctx, jeep);

    expect(jeep.target).toBe(discoveredUsSr);
  });

  it('early bailout at crange/4 prevents scanning outer rings', () => {
    // C++ techno.cpp:2198-2205: if bestobject != NULL at radius == crange/4, return early.
    // For DOG guardRange=7, crange = floor(7)+1 = 8, crange/4 = 2, crange/2 = 4.
    // If a target is found by radius == crange/4 (ring 2), return immediately.
    //
    // Use DOG scanner: regular infantry Mission_Guard is a mask=0 no-op scan.
    const scanner = makeEntity(UnitType.I_DOG, House.USSR, 200, 200);
    scanner.mission = Mission.GUARD;
    scanner.target = null;

    // Inner target at ring 2 (the bailout ring)
    const innerTarget = makeEntity(UnitType.I_E1, House.Greece,
      200 + 2 * CELL_SIZE, 200);
    innerTarget.mission = Mission.GUARD;

    // Outer target at ring 5 — would have higher score if scanned,
    // but early bailout at ring 2 prevents reaching ring 5.
    const outerTarget = makeEntity(UnitType.I_E1, House.Greece,
      200 + 5 * CELL_SIZE, 200);
    outerTarget.mission = Mission.GUARD;

    const ctx = makeCtx({
      entities: [scanner, innerTarget, outerTarget],
      threatScore: (_scanner, target, _dist) => {
        // Outer target scores MUCH higher
        return target === outerTarget ? 9999 : 1;
      },
    });
    updateGuard(ctx, scanner);

    // Early bailout at crange/4=2 means innerTarget (found at ring 2) is returned
    // before outerTarget (ring 5) is ever checked.
    expect(scanner.target).toBe(innerTarget);
  });

  it('dead object at early bailout poisons scan instead of selecting outer live target', () => {
    // C++ Evaluate_Object can accept zero-strength objects; Greatest_Threat may
    // return that corpse at the early bailout ring. Only Assign_Target clears it,
    // and Target_Something_Nearby returns false without scanning farther out.
    const scanner = makeEntity(UnitType.I_DOG, House.USSR, 10 * CELL_SIZE, 10 * CELL_SIZE);
    scanner.mission = Mission.GUARD;
    scanner.target = null;

    // DOG guard range gives crange=8, so crange/4 bailout is radius 2.
    const corpse = makeEntity(UnitType.I_E1, House.Greece, 12 * CELL_SIZE, 10 * CELL_SIZE);
    corpse.alive = true;
    corpse.hp = 0;
    corpse.mission = Mission.DIE;
    corpse.inLimbo = false;

    const outerLiveTarget = makeEntity(UnitType.I_E1, House.Greece, 15 * CELL_SIZE, 10 * CELL_SIZE);
    outerLiveTarget.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, corpse, outerLiveTarget] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBeNull();
  });

  it('dead dog records do not poison scans after C++ has removed them from occupiers', () => {
    // SCG01EA t147: TS retained a dead DOG at (63,52), but C++ had already
    // removed/limboed that dog from Cell_Occupier, so the Greek JEEP selected
    // the live E1 behind it and fired on the C++ cadence.
    const jeep = makeEntity(UnitType.V_JEEP, House.Greece,
      62 * CELL_SIZE + CELL_SIZE / 2,
      50 * CELL_SIZE + CELL_SIZE / 2);
    jeep.mission = Mission.GUARD;
    jeep.target = null;

    const deadDog = makeEntity(UnitType.I_DOG, House.USSR,
      63 * CELL_SIZE + CELL_SIZE / 2,
      52 * CELL_SIZE + CELL_SIZE / 2);
    deadDog.alive = false;
    deadDog.hp = 0;
    deadDog.mission = Mission.DIE;
    deadDog.inLimbo = false;

    const liveE1 = makeEntity(UnitType.I_E1, House.USSR,
      63 * CELL_SIZE + CELL_SIZE / 2,
      53 * CELL_SIZE + CELL_SIZE / 2);
    liveE1.mission = Mission.HUNT;

    const ctx = makeCtx({ entities: [jeep, deadDog, liveE1] });
    updateGuard(ctx, jeep);

    expect(jeep.target).toBe(liveE1);
  });

  it('dead infantry still in its C++ death animation can poison an early bailout scan', () => {
    // InfantryDeath variants 1-4 remain active InfantryClass objects until their
    // death animation completes. While still active, C++ Cell_Occupier can return
    // the zero-strength object and Target_Something_Nearby stops at the bailout.
    const jeep = makeEntity(UnitType.V_JEEP, House.Greece,
      19 * CELL_SIZE + CELL_SIZE / 2,
      64 * CELL_SIZE + CELL_SIZE / 2);
    jeep.mission = Mission.GUARD;

    // JEEP/M60mg range gives crange=5, so crange/2 bailout is radius 2.
    const dying = makeEntity(UnitType.I_E1, House.USSR,
      21 * CELL_SIZE + CELL_SIZE / 2,
      64 * CELL_SIZE + CELL_SIZE / 2);
    dying.alive = false;
    dying.hp = 0;
    dying.mission = Mission.DIE;
    dying.deathVariant = 1;
    dying.deathTick = 0;
    dying.inLimbo = false;

    const outerLive = makeEntity(UnitType.I_E1, House.USSR,
      22 * CELL_SIZE + CELL_SIZE / 2,
      66 * CELL_SIZE + CELL_SIZE / 2);
    outerLive.mission = Mission.HUNT;

    const ctx = makeCtx({ entities: [jeep, dying, outerLive] });
    updateGuard(ctx, jeep);

    expect(jeep.target).toBeNull();
  });

  it('completed dead infantry no longer occupies the scan cell and cannot hide a live target', () => {
    // SCG06EA tick 1943 shape: C++ has removed a same-cell E1 corpse from
    // Logic/Cell_Occupier, so the Greek JEEP sees the live USSR E1 in that cell.
    const jeep = makeEntity(UnitType.V_JEEP, House.Greece,
      19 * CELL_SIZE + CELL_SIZE / 2,
      64 * CELL_SIZE + CELL_SIZE / 2);
    jeep.mission = Mission.GUARD;
    jeep.bodyFacing256 = 128;
    jeep.facing = 4;
    jeep.bodyFacing32 = 16;
    jeep.turretFacing256 = 128;
    jeep.turretFacing = 4;
    jeep.turretFacing32 = 16;

    const liveE1 = makeEntity(UnitType.I_E1, House.USSR,
      22 * CELL_SIZE + CELL_SIZE / 2,
      66 * CELL_SIZE + CELL_SIZE / 2);
    liveE1.mission = Mission.HUNT;

    const completedCorpse = makeEntity(UnitType.I_E1, House.USSR,
      22 * CELL_SIZE + CELL_SIZE / 2 + 4,
      66 * CELL_SIZE + CELL_SIZE / 2 + 4);
    completedCorpse.alive = false;
    completedCorpse.hp = 0;
    completedCorpse.mission = Mission.DIE;
    completedCorpse.deathVariant = 1;
    completedCorpse.deathTick = completedCorpse.infantryDeathDurationTicks();
    completedCorpse.inLimbo = false;

    expect(completedCorpse.isInfantryDeathAnimationComplete()).toBe(true);
    expect(liveE1.cell).toEqual(completedCorpse.cell);

    const ctx = makeCtx({ entities: [jeep, liveE1, completedCorpse] });
    updateGuard(ctx, jeep);

    expect(jeep.target).toBe(liveE1);
  });

  it('runs infantry Random_Animate after dead early-bailout candidate clears TarCom', () => {
    // C++ FootClass::Mission_Guard:
    //   if (!Target_Something_Nearby(THREAT_RANGE)) Random_Animate();
    // When Greatest_Threat returns a zero-strength object, Assign_Target clears
    // TarCom, Target_Something_Nearby returns false, and Random_Animate consumes
    // IdleTimer + switch RNG. This is the SCG06EA t133 behavior.
    ScenarioRandom.seed = 12345;
    ScenarioRandom.callCount = 0;

    const scanner = makeEntity(UnitType.I_E1, House.Greece, 20 * CELL_SIZE, 64 * CELL_SIZE);
    scanner.mission = Mission.GUARD;
    scanner.target = null;
    scanner.doing = 'stand_ready';
    scanner.idleAnimTimer = 0;
    scanner.attackCooldown = 7; // Arm != 0 still returns after Random_Animate in C++.

    // E1 primary range gives crange=5, so crange/4 bailout is radius 1.
    const corpse = makeEntity(UnitType.I_E1, House.USSR, 21 * CELL_SIZE, 64 * CELL_SIZE);
    corpse.alive = true;
    corpse.hp = 0;
    corpse.mission = Mission.DIE;
    corpse.inLimbo = false;

    const outerLiveTarget = makeEntity(UnitType.I_E1, House.BadGuy, 23 * CELL_SIZE, 64 * CELL_SIZE);
    outerLiveTarget.mission = Mission.GUARD;

    const ctx = makeCtx({ entities: [scanner, corpse, outerLiveTarget] });
    updateGuard(ctx, scanner);

    expect(scanner.target).toBeNull();
    expect(scanner.idleAnimTimer).toBeGreaterThan(0);
    expect(ScenarioRandom.callCount).toBeGreaterThanOrEqual(2);
  });

  it('uses Cell_Occupier current cell for moving infantry, not reserved head-to cell', () => {
    // C++ Evaluate_Cell walks Map[cell].Cell_Occupier(). InfantryClass::Start_Driver
    // sets sub-cell occupy bits at Head_To_Coord, but does not move the
    // Cell_Occupier linked-list node there (infantry.cpp:2117-2124,
    // infantry.cpp:3021-3077). SCG01EA t87 depends on this: a dog reserves
    // (63,52), but C++ agent_get_cell_occupiers shows (63,52) empty, so the
    // JEEP returns the wounded E1 at radius 2 before scanning the dog's current
    // cell at radius 3.
    const jeep = makeEntity(
      UnitType.V_JEEP,
      House.Greece,
      63 * CELL_SIZE + CELL_SIZE / 2,
      50 * CELL_SIZE + CELL_SIZE / 2,
    );
    jeep.mission = Mission.GUARD;
    jeep.target = null;
    jeep.turretFacing = 4;
    jeep.turretFacing32 = 16;

    const woundedE1 = makeEntity(
      UnitType.I_E1,
      House.USSR,
      62 * CELL_SIZE + CELL_SIZE / 2,
      52 * CELL_SIZE + CELL_SIZE / 2,
    );
    woundedE1.mission = Mission.HUNT;
    woundedE1.hp = 5;

    const dog = makeEntity(
      UnitType.I_DOG,
      House.USSR,
      63 * CELL_SIZE + CELL_SIZE / 2,
      53 * CELL_SIZE + CELL_SIZE / 2,
    );
    dog.mission = Mission.HUNT;
    dog.isDriving = true;
    dog.claimedCellIdx = 52 * 128 + 63;

    const ctx = makeCtx({ entities: [jeep, dog, woundedE1] });
    updateGuard(ctx, jeep);

    expect(jeep.target).toBe(woundedE1);
  });
});
