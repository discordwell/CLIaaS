/**
 * C++ Behavioral Parity: Building Target Scan (Greatest_Threat)
 *
 * Tests verify building combat target acquisition matches C++ RA source code.
 * This is the path: BuildingClass::Mission_Guard → BuildingClass::Greatest_Threat
 * → TechnoClass::Greatest_Threat → Evaluate_Cell → Evaluate_Object.
 *
 * Key C++ behaviors tested:
 *   1. No LOS check — Evaluate_Object (techno.cpp:1449-1763) does NOT check
 *      line-of-sight. Buildings fire through rock, walls, terrain obstacles.
 *   2. Range boundary inclusive — In_Range (techno.cpp:1289) uses <= comparison:
 *      Distance(Fire_Coord, target) <= Weapon_Range. Targets AT exact range
 *      are valid targets.
 *   3. Weapon Allowed_Threats — BuildingClass::Greatest_Threat (building.cpp:2338-2364)
 *      merges weapon->Allowed_Threats() into the threat mask. Anti-air weapons
 *      get THREAT_AIR; anti-ground get THREAT_INFANTRY|THREAT_VEHICLES|THREAT_BOATS|
 *      THREAT_BUILDINGS.
 *   4. Human building THREAT_BUILDINGS removal — building.cpp:2349-2351 removes
 *      THREAT_BUILDINGS for human-owned buildings. (In TS, entity list doesn't
 *      contain structures, so this is implicitly correct.)
 *
 * C++ source references:
 *   building.cpp:3228-3306  — Mission_Guard: calls Greatest_Threat(THREAT_NORMAL)
 *   building.cpp:2338-2364  — BuildingClass::Greatest_Threat override
 *   weapon.cpp:317-327      — Allowed_Threats: AA→THREAT_AIR, AG→THREAT_GROUND
 *   techno.cpp:1987-2267    — TechnoClass::Greatest_Threat: cell scan with THREAT_RANGE
 *   techno.cpp:1449-1763    — Evaluate_Object: no LOS, checks range/alliance/mask/value
 *   techno.cpp:1278-1294    — In_Range: Distance <= Weapon_Range (inclusive)
 *   techno.cpp:1651-1752    — value = Value() + Kills, distance falloff
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, Mission, CELL_SIZE, LEPTON_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  findStructureThreatTarget,
  handleUnitDeath,
  updateInflightProjectiles,
  updateStructureCombat,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import {
  type MapStructure,
  STRUCTURE_WEAPONS,
  STRUCTURE_MAX_HP,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGUN(cx: number, cy: number, house: House = House.USSR, facing: number = 2): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['GUN'] ?? 400;
  return {
    type: 'GUN', image: 'gun', house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    weapon: { ...STRUCTURE_WEAPONS['GUN'] },
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    turretDir: facing,
    desiredTurretDir: facing,
    firingFlash: 0,
    missionTimer: 0,
  } as MapStructure;
}

function makeFTUR(cx: number, cy: number, house: House = House.USSR): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['FTUR'] ?? 200;
  return {
    type: 'FTUR', image: 'ftur', house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    weapon: { ...STRUCTURE_WEAPONS['FTUR'] },
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    missionTimer: 0,
  } as MapStructure;
}

function makePBOX(cx: number, cy: number, house: House = House.Greece): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['PBOX'] ?? 400;
  return {
    type: 'PBOX', image: 'pbox', house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    weapon: { ...STRUCTURE_WEAPONS['PBOX'] },
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    missionTimer: 0,
  } as MapStructure;
}

function makeHBOX(cx: number, cy: number, house: House = House.Greece): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['HBOX'] ?? 600;
  return {
    type: 'HBOX', image: 'hbox', house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    weapon: { ...STRUCTURE_WEAPONS['HBOX'] },
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    missionTimer: 0,
  } as MapStructure;
}

function makeTSLA(cx: number, cy: number, house: House = House.USSR): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['TSLA'] ?? 400;
  return {
    type: 'TSLA', image: 'tsla', house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    weapon: { ...STRUCTURE_WEAPONS['TSLA'] },
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    missionTimer: 0,
  } as MapStructure;
}

function makeAGUN(cx: number, cy: number, house: House = House.Greece): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['AGUN'] ?? 400;
  return {
    type: 'AGUN', image: 'agun', house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    weapon: { ...STRUCTURE_WEAPONS['AGUN'] },
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    turretDir: 0,
    desiredTurretDir: 0,
    turretFacing256: 0,
    desiredTurretFacing256: 0,
    missionTimer: 0,
  } as MapStructure;
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function entityAtLeptons(type: UnitType, house: House, lx: number, ly: number): Entity {
  const e = new Entity(type, house, lx * CELL_SIZE / LEPTON_SIZE, ly * CELL_SIZE / LEPTON_SIZE);
  e.leptonX = lx;
  e.leptonY = ly;
  e.pos = { x: lx * CELL_SIZE / LEPTON_SIZE, y: ly * CELL_SIZE / LEPTON_SIZE };
  e.prevPos = { ...e.pos };
  return e;
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
  playerHouse: House = House.Spain,
): CombatContext {
  const map = new GameMap();
  map.initDefault();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    logicAnims: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(playerHouse) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
    movementSpeed: () => 1,
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
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
    pointTotal: 0,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
  } as CombatContext;
}

function fireStructures(ctx: CombatContext): void {
  updateStructureCombat(ctx);
  for (let i = 0; ctx.inflightProjectiles.length > 0 && i < 512; i++) {
    updateInflightProjectiles(ctx);
  }
  expect(ctx.inflightProjectiles.length).toBe(0);
}

describe('building TarCom detach on target death (ObjectClass::Detach_All)', () => {
  it('clears structure targetEntityId when the assigned target is destroyed', () => {
    // C++ ObjectClass::Detach_All -> Detach_This_From_All(As_Target())
    // reaches BuildingClass/TechnoClass::Detach and clears TarCom immediately.
    const agun = makeAGUN(55, 100, House.Greece);
    const otherAgun = makeAGUN(62, 100, House.Greece);
    const yak = entityAtCell(UnitType.A_YAK, House.USSR, 58, 100);
    const otherYak = entityAtCell(UnitType.A_YAK, House.USSR, 57, 100);
    agun.mission = Mission.ATTACK;
    agun.missionTimer = 1;
    agun.targetEntityId = yak.id;
    otherAgun.mission = Mission.ATTACK;
    otherAgun.missionTimer = 1;
    otherAgun.targetEntityId = otherYak.id;
    const ctx = makeCombatCtx([agun, otherAgun], [yak, otherYak]);

    yak.alive = false;
    handleUnitDeath(ctx, yak, {
      screenShake: 0,
      explosionSize: 0,
      debris: false,
      decal: null,
      explodeLgSound: false,
      attackerIsPlayer: false,
      trackLoss: false,
    });

    expect(agun.targetEntityId).toBeUndefined();
    expect(agun.mission).toBe(Mission.ATTACK);
    expect(agun.missionTimer).toBe(1);
    expect(otherAgun.targetEntityId).toBe(otherYak.id);
  });
});

describe('building targeting: MissionControl NoThreat gate (C++ Evaluate_Object)', () => {
  it('PBOX ignores enemies on MISSION_HARMLESS', () => {
    // C++ techno.cpp:1476-1479:
    //   if (MissionControl[object->Mission].IsNoThreat) return false;
    // SCU07EA tick 1 depends on this for HARMLESS dogs near the player PBOX.
    const pbox = makePBOX(83, 81, House.Greece);
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 84, 83);
    dog.mission = Mission.HARMLESS;
    const ctx = makeCombatCtx([pbox], [dog], House.Greece);

    expect(findStructureThreatTarget(ctx, pbox)).toBeNull();
  });

  it('PBOX can acquire the same enemy once it is no longer NoThreat', () => {
    const pbox = makePBOX(83, 81, House.Greece);
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 84, 83);
    dog.mission = Mission.GUARD;
    const ctx = makeCombatCtx([pbox], [dog], House.Greece);

    expect(findStructureThreatTarget(ctx, pbox)?.id).toBe(dog.id);
  });
});

describe('building targeting: ground-layer cell scan', () => {
  it('dead infantry still in Cell_Occupier can poison the HBOX half-range bailout', () => {
    // SCG26EA tick 150: C++ HBOX at (38,72) scans from its fire coord.
    // A zero-strength USSR E1 still active in Cell_Occupier at radius 3 is
    // accepted by Evaluate_Object, so Greatest_Threat returns it at crange/2.
    // BuildingClass::Assign_Target then clears that dead TarCom and the HBOX
    // rolls its normal weapon guard delay instead of scanning onward to the
    // live E1/E2 at radius 4.
    const hbox = makeHBOX(38, 72, House.Greece);
    const corpse = entityAtCell(UnitType.I_E1, House.USSR, 37, 69);
    corpse.alive = false;
    corpse.hp = 0;
    corpse.mission = Mission.DIE;
    corpse.deathVariant = 1;
    corpse.deathTick = 1;
    corpse.inLimbo = false;

    const outerLive = entityAtCell(UnitType.I_E1, House.USSR, 38, 68);
    outerLive.mission = Mission.HUNT;
    const ctx = makeCombatCtx([hbox], [corpse, outerLive], House.Greece);

    expect(findStructureThreatTarget(ctx, hbox)).toBeNull();
  });

  it('ground defenses ignore parachuting infantry while ObjectClass keeps them in LAYER_TOP', () => {
    // C++ TechnoClass::Greatest_Threat scans aircraft separately, then scans
    // Map.Layer[LAYER_GROUND]/Cell_Occupier for ground targets. Non-air falling
    // objects are absent from that ground scan until ObjectClass::In_Which_Layer
    // changes at FLIGHT_LEVEL - FLIGHT_LEVEL/3.
    const gun = makeGUN(32, 42, House.Greece);
    const trooper = entityAtCell(UnitType.I_E2, House.USSR, 36, 40);
    trooper.isFalling = true;
    trooper.fallHeightLeptons = Entity.FLIGHT_LEVEL_LEPTONS;
    trooper.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const ctx = makeCombatCtx([gun], [trooper], House.Greece);

    expect(findStructureThreatTarget(ctx, gun)).toBeNull();

    trooper.fallHeightLeptons =
      Entity.FLIGHT_LEVEL_LEPTONS - Math.trunc(Entity.FLIGHT_LEVEL_LEPTONS / 3) - 1;
    trooper.flightAltitude = 15;

    expect(findStructureThreatTarget(ctx, gun)?.id).toBe(trooper.id);
  });

  it('uses the first non-allied object in a shared ground cell as C++ Cell_Occupier head', () => {
    // SCG26EA tick 188: two USSR infantry occupy (38,69). C++ Cell_Occupier
    // returns the E2 first, and Evaluate_Cell does not continue to the E1
    // behind it in the same cell.
    const gun = makeGUN(34, 72, House.Greece);
    const chainHead = entityAtCell(UnitType.I_E2, House.USSR, 38, 69);
    chainHead.logicIndexHint = 90;
    chainHead.cellOccupierSerial = 12;
    chainHead.mission = Mission.HUNT;

    const behindHead = entityAtCell(UnitType.I_E1, House.USSR, 38, 69);
    behindHead.logicIndexHint = 92;
    behindHead.cellOccupierSerial = 11;
    behindHead.mission = Mission.HUNT;

    const ctx = makeCombatCtx([gun], [chainHead, behindHead], House.Greece);

    expect(findStructureThreatTarget(ctx, gun)?.id).toBe(chainHead.id);
  });

  it('uses the current Cell_Occupier head even when later than logic order', () => {
    // SCG26EA tick 166: E2 and E1 both occupy (38,69), but the E1 is the
    // current Cell_Occupier head because its later movement Mark_Down prepended
    // it. Logic order alone would pick the E2.
    const hbox = makeHBOX(38, 72, House.Greece);
    const olderHead = entityAtCell(UnitType.I_E2, House.USSR, 38, 69);
    olderHead.logicIndexHint = 90;
    olderHead.cellOccupierSerial = 20;
    olderHead.mission = Mission.HUNT;

    const currentHead = entityAtCell(UnitType.I_E1, House.USSR, 38, 69);
    currentHead.logicIndexHint = 92;
    currentHead.cellOccupierSerial = 21;
    currentHead.mission = Mission.HUNT;

    const ctx = makeCombatCtx([hbox], [olderHead, currentHead], House.Greece);

    expect(findStructureThreatTarget(ctx, hbox)?.id).toBe(currentHead.id);
  });
});

// ============================================================
// Section 1: No LOS check for building target acquisition
//
// C++ techno.cpp:1449-1763 Evaluate_Object:
//   Checks: limbo, cloak, mission, zone, alliance, range, mask, value.
//   Does NOT check: line-of-sight, terrain, walls, obstacles.
//
// This matches missionAI.ts:813 where guard scan also removes LOS
// (same Evaluate_Object path in C++).
// ============================================================

describe('building targeting: no LOS check (C++ Evaluate_Object)', () => {
  it('GUN fires through rock terrain (C++ has no LOS in Evaluate_Object)', () => {
    // GUN (TurretGun) range=6 cells, anti-ground
    const gun = makeGUN(10, 10, House.USSR, 2); // facing east
    const target = entityAtCell(UnitType.I_E1, House.Greece, 13, 10); // 3 cells east, well within range
    const ctx = makeCombatCtx([gun], [target]);

    // Block LOS with a solid wall of rock
    for (let y = 8; y <= 12; y++) {
      ctx.map.setTerrain(12, y, Terrain.ROCK);
    }

    const hpBefore = target.hp;
    fireStructures(ctx);

    // C++ parity: building fires regardless of terrain — no LOS in Evaluate_Object
    expect(target.hp).toBeLessThan(hpBefore);
  });

  it('FTUR fires through rock terrain', () => {
    // FTUR (FireballLauncher) range=4 cells, anti-ground, not turreted
    const ftur = makeFTUR(10, 10, House.USSR);
    const target = entityAtCell(UnitType.I_E1, House.Greece, 12, 10); // 2 cells east
    const ctx = makeCombatCtx([ftur], [target]);

    // Block LOS
    ctx.map.setTerrain(11, 10, Terrain.ROCK);

    const hpBefore = target.hp;
    fireStructures(ctx);

    expect(target.hp).toBeLessThan(hpBefore);
  });
});

// ============================================================
// Section 2: Range boundary inclusive — In_Range uses <=
//
// C++ techno.cpp:1289:
//   if (::Distance(Fire_Coord(which), target->Center_Coord()) <= range)
//
// The <= means targets at EXACTLY weapon range are valid targets.
// Previously TS used >= (rejecting targets at exact range).
// ============================================================

describe('building targeting: range boundary inclusive (C++ In_Range <=)', () => {
  it('AGUN guard scan uses aircraft Center_Coord for acquisition range', () => {
    // C++ Evaluate_Object(range=0) calls In_Range(object, primary), and that
    // object-pointer overload compares Fire_Coord to object->Center_Coord().
    // Mission_Attack later rechecks TarCom/Target_Coord, so an airborne target
    // can be acquired on one frame and rejected on the next as it crosses the
    // AA edge. SCG08EA tick 597 depends on this split.
    const agun = makeAGUN(10, 10);
    const fireLX = 10 * LEPTON_SIZE + 0x80;
    const fireLY = 10 * LEPTON_SIZE + 0xff;
    const yak = entityAtLeptons(UnitType.V_YAK, House.USSR, fireLX + 1500, fireLY);
    yak.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const ctx = makeCombatCtx([agun], [yak]);

    expect(findStructureThreatTarget(ctx, agun)?.id).toBe(yak.id);
  });

  it('AGUN aircraft scan uses Evaluate_Object score, not closest-aircraft override', () => {
    // SCG08EA tick 683: the lead YAK has the higher C++ Evaluate_Object score
    // even though the trailing wounded YAK is slightly closer to the AGUN fire
    // coord. BuildingClass::Greatest_Threat does not do a separate nearest-air
    // override after scoring.
    const agun = makeAGUN(62, 100, House.Greece);
    const leadYak = entityAtLeptons(UnitType.V_YAK, House.USSR, 14860, 26571);
    const trailingYak = entityAtLeptons(UnitType.V_YAK, House.USSR, 15036, 26827);
    leadYak.flightAltitude = Entity.FLIGHT_ALTITUDE;
    trailingYak.flightAltitude = Entity.FLIGHT_ALTITUDE;
    trailingYak.hp = 15;
    const ctx = makeCombatCtx([agun], [leadYak, trailingYak]);

    expect(findStructureThreatTarget(ctx, agun)?.id).toBe(leadYak.id);
  });

  it('TSLA acquires SCG01EA C8 using bdata vertical Fire_Coord offset', () => {
    // C++ oracle at SCG01EA tick 270:
    // agent_debug_eval_target(TSLA at 71,59, C8 at 18763,13237) reports
    // In_Range=true, Evaluate_Object=true, bestId=C8. Without TSLA's
    // bdata.cpp VerticalOffset=0x00C8 in Fire_Coord, this edge target is
    // measured outside TeslaZap range and the guard path rolls idle jitter.
    const tsla = makeTSLA(71, 59, House.USSR);
    const c8 = entityAtLeptons(UnitType.I_C8, House.England, 18763, 13237);
    c8.mission = Mission.MOVE;
    const ctx = makeCombatCtx([tsla], [c8]);

    expect(findStructureThreatTarget(ctx, tsla)?.id).toBe(c8.id);
  });

  it('FTUR hits target at exactly range=4 cells', () => {
    // FTUR range=4 cells. Place target exactly 4 cells away.
    const ftur = makeFTUR(10, 10, House.USSR);
    // Entity at cell (14, 10) — 4 cells east of building at (10,10).
    // Building fires from center: (10*CELL_SIZE+CELL_SIZE, 10*CELL_SIZE+CELL_SIZE).
    // Entity at cell center: (14*CELL_SIZE + CELL_SIZE/2, 10*CELL_SIZE + CELL_SIZE/2).
    // Distance in cells depends on exact positions.
    // For a clean test, place entity so worldDist == range exactly.
    // FTUR at (10,10), fires from (10*24+24, 10*24+24) = (264, 264)
    // Place entity at exactly 4 cells east: x = 264 + 4*24 = 360
    // But worldDist converts to leptons first, so we need the entity in the right spot.
    // Instead, let's use entityAtCell which places at cell center:
    //   entity at cell (14, 10) = (14*24+12, 10*24+12) = (348, 252)
    //   building pos = (10*24+24, 10*24+24) = (264, 264)
    //   dx = 348-264 = 84 pixels, dy = 252-264 = -12 pixels
    //   leptons: dx_l = floor(84*256/24) = 896, dy_l = floor(12*256/24) = 128
    //   leptonDist = max(896,128) + min(896,128)/2 = 896 + 64 = 960
    //   cellDist = 960/256 = 3.75 — that's < 4, not exactly 4
    // Instead, place entity so distance is exactly 4 cells (1024 leptons).
    // Let's use a manual position.
    const fturX = 10 * CELL_SIZE + CELL_SIZE / 2; // C++ BSIZE_11 CenterOffset = 0x80,0x80
    const fturY = 10 * CELL_SIZE + CELL_SIZE / 2;
    // We want leptonDist = 4 * 256 = 1024.
    // Straight east: dy=0, dx = 1024 leptons.
    // 1024 leptons = 1024 * CELL_SIZE / 256 = 1024 * 24 / 256 = 96 pixels east.
    const targetX = fturX + 96;
    const targetY = fturY;
    const target = new Entity(UnitType.I_E1, House.Greece, targetX, targetY);
    const ctx = makeCombatCtx([ftur], [target]);

    // Verify distance is exactly 4 cells
    const dist = worldDist({ x: fturX, y: fturY }, target.pos);
    expect(dist).toBe(4); // exactly at range boundary

    const hpBefore = target.hp;
    fireStructures(ctx);

    // C++ In_Range: distance <= range → target at exactly range IS valid
    expect(target.hp).toBeLessThan(hpBefore);
  });

  it('FTUR does NOT hit target beyond range=4 cells', () => {
    const ftur = makeFTUR(10, 10, House.USSR);
    const fturX = 10 * CELL_SIZE + CELL_SIZE;
    const fturY = 10 * CELL_SIZE + CELL_SIZE;
    // Place target at 4.5 cells east (1152 leptons)
    // 1152 * 24 / 256 = 108 pixels
    const targetX = fturX + 108;
    const targetY = fturY;
    const target = new Entity(UnitType.I_E1, House.Greece, targetX, targetY);
    const ctx = makeCombatCtx([ftur], [target]);

    const dist = worldDist({ x: fturX, y: fturY }, target.pos);
    expect(dist).toBeGreaterThan(4); // beyond range

    const hpBefore = target.hp;
    fireStructures(ctx);

    // Target beyond range — should NOT be hit
    expect(target.hp).toBe(hpBefore);
  });
});
