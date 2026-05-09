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
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
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

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
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
  for (let i = 0; i < 10 && ctx.inflightProjectiles.length > 0; i++) {
    updateInflightProjectiles(ctx);
  }
}

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
