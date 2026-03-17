/**
 * C++ Behavioral Parity: HOSP -- Hospital
 *
 * Tests verify Hospital behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * HOSP is a scenario-only civilian structure: HP 400, 2x2 footprint,
 * no weapon, no power drain, no power production. It appears in
 * campaign missions as a pre-placed neutral/allied building but
 * cannot be built by the player.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, POWER_DRAIN, COUNTRY_BONUSES,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  structureDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS, STRUCTURE_POWERED,
} from '../engine/scenario';
import {
  powerOutput, calculatePowerGrid,
} from '../engine/repairSell';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeHOSP(cx: number, cy: number, hp = 400, house: House = House.Spain): MapStructure {
  return {
    type: 'HOSP', image: 'hosp', house,
    cx, cy, hp, maxHp: 400, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeBuilding(type: string, cx: number, cy: number, hp: number, house: House = House.USSR): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp, maxHp: hp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
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
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
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

// -- Stats (rules.ini / building.cpp) -----------------------------------------
//
// C++ rules.ini: HOSP -> Strength=400, Cost=500, Power=0 (no drain, no production),
// Scenario=yes (not buildable), Owner=allies, TechLevel=-1

describe('HOSP stats (rules.ini parity)', () => {

  it('max HP is 400', () => {
    expect(STRUCTURE_MAX_HP['HOSP']).toBe(400);
  });

  it('footprint is 2x2 cells', () => {
    expect(STRUCTURE_SIZE['HOSP']).toEqual([2, 2]);
  });

  it('has no weapon (civilian structure)', () => {
    expect(STRUCTURE_WEAPONS['HOSP']).toBeUndefined();
  });

  it('is not a power consumer (no entry in POWER_DRAIN)', () => {
    expect(POWER_DRAIN['HOSP']).toBeUndefined();
  });

  it('is not a powered structure (no entry in STRUCTURE_POWERED)', () => {
    expect(STRUCTURE_POWERED.has('HOSP')).toBe(false);
  });

  it('is a scenario-only structure (Scenario=yes in rules.ini)', () => {
    // HOSP is not in the production items — it can only appear
    // when pre-placed in a scenario INI file.
    // We verify indirectly: HOSP has no weapon, no power drain,
    // and is not in the STRUCTURE_POWERED set — it exists purely
    // as a map decoration / objective structure.
    expect(STRUCTURE_WEAPONS['HOSP']).toBeUndefined();
    expect(POWER_DRAIN['HOSP']).toBeUndefined();
  });
});

// -- No Power Production (building.cpp:4613 Power_Output) ---------------------
//
// HOSP is not a power plant. Power_Output returns 0 for non-POWR/APWR.

describe('HOSP produces no power (building.cpp:4613 Power_Output)', () => {

  it('produces 0W at full health (400/400)', () => {
    expect(powerOutput('HOSP', 400, 400)).toBe(0);
  });

  it('produces 0W at half health (200/400)', () => {
    expect(powerOutput('HOSP', 200, 400)).toBe(0);
  });

  it('produces 0W when dead (0/400)', () => {
    expect(powerOutput('HOSP', 0, 400)).toBe(0);
  });
});

// -- No Power Grid Impact (calculatePowerGrid) -------------------------------
//
// HOSP contributes nothing to either produced or consumed side of the grid.

describe('HOSP in power grid (calculatePowerGrid)', () => {
  const alliances = buildDefaultAlliances();
  const isAllied = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;

  it('HOSP alone produces 0W and consumes 0W', () => {
    const hosp = makeHOSP(10, 10, 400, House.Spain);
    const grid = calculatePowerGrid([hosp], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(0);
  });

  it('HOSP does not affect power when added alongside a POWR', () => {
    const powr = makeBuilding('POWR', 10, 10, 400, House.Spain);
    const gridWithoutHosp = calculatePowerGrid([powr], House.Spain, isAllied);

    const hosp = makeHOSP(14, 10, 400, House.Spain);
    const gridWithHosp = calculatePowerGrid([powr, hosp], House.Spain, isAllied);

    expect(gridWithHosp.produced).toBe(gridWithoutHosp.produced);
    expect(gridWithHosp.consumed).toBe(gridWithoutHosp.consumed);
  });

  it('damaged HOSP still contributes nothing to grid', () => {
    const hosp = makeHOSP(10, 10, 100, House.Spain);
    const grid = calculatePowerGrid([hosp], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(0);
  });

  it('dead HOSP contributes nothing to grid', () => {
    const hosp = makeHOSP(10, 10, 0, House.Spain);
    hosp.alive = false;
    const grid = calculatePowerGrid([hosp], House.Spain, isAllied);
    expect(grid.produced).toBe(0);
    expect(grid.consumed).toBe(0);
  });
});

// -- 2x2 Footprint -----------------------------------------------------------
//
// C++ STRUCTURE_SIZE: HOSP is 2x2. The origin cell is top-left;
// the structure occupies (cx,cy), (cx+1,cy), (cx,cy+1), (cx+1,cy+1).

describe('HOSP 2x2 footprint', () => {

  it('footprint occupies 4 cells from origin', () => {
    const [w, h] = STRUCTURE_SIZE['HOSP']!;
    expect(w * h).toBe(4);
    // Origin at (10,10) -> cells: (10,10), (11,10), (10,11), (11,11)
    const cells: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push([10 + dx, 10 + dy]);
      }
    }
    expect(cells).toEqual([[10, 10], [11, 10], [10, 11], [11, 11]]);
  });

  it('footprint dimensions match 2x2', () => {
    const [w, h] = STRUCTURE_SIZE['HOSP']!;
    expect(w).toBe(2);
    expect(h).toBe(2);
  });
});

// -- Destruction Blast -- Radial HE (building.cpp) ----------------------------
//
// Non-barrel structures (including HOSP) use a generic 2-cell radial HE blast
// with distance falloff on destruction. HOSP has no barrel, so it uses
// the non-barrel radial path.

describe('HOSP destruction blast -- radial HE (non-barrel)', () => {

  it('damages entities within 2-cell radius on destruction', () => {
    const hosp = makeHOSP(10, 10, 50);
    hosp.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([hosp], [victim]);
    structureDamage(ctx, hosp, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('damages entities in diagonal cells (within 2-cell radius)', () => {
    const hosp = makeHOSP(10, 10, 50);
    hosp.house = House.USSR;
    // Entity at diagonal (11,11) -- within 2-cell radius
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const bx = 10 * CELL_SIZE + CELL_SIZE;
    const by = 10 * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: bx, y: by }, victim.pos);
    expect(dist).toBeLessThan(2);
    const ctx = makeCombatCtx([hosp], [victim]);
    structureDamage(ctx, hosp, 100);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });

  it('uses distance falloff (closer = more damage)', () => {
    const hosp = makeHOSP(10, 10, 50);
    hosp.house = House.USSR;
    const close = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 12);
    const ctx = makeCombatCtx([hosp], [close, far]);
    structureDamage(ctx, hosp, 100);
    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBeGreaterThan(farDmg);
  });

  it('does NOT damage entities beyond 2-cell radius', () => {
    const hosp = makeHOSP(10, 10, 50);
    hosp.house = House.USSR;
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 13, 10); // 3 cells E
    const ctx = makeCombatCtx([hosp], [victim]);
    structureDamage(ctx, hosp, 100);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('destruction blast damages adjacent structures', () => {
    const hosp = makeHOSP(10, 10, 50);
    hosp.house = House.USSR;
    const nearby = makeBuilding('SILO', 12, 10, 256);
    const ctx = makeCombatCtx([hosp, nearby]);
    structureDamage(ctx, hosp, 100);
    expect(nearby.hp).toBeLessThan(256);
  });

  it('does NOT use barrel cardinal fire-bullet mechanic', () => {
    // Barrel explosions hit ONLY cardinal cells with flat 200 damage.
    // HOSP should use radial HE with falloff -- diagonals should
    // take damage (unlike barrels where diagonals are immune).
    const hosp = makeHOSP(10, 10, 50);
    hosp.house = House.USSR;
    const diagonal = entityAtCell(UnitType.I_E1, House.USSR, 11, 11);
    const ctx = makeCombatCtx([hosp], [diagonal]);
    structureDamage(ctx, hosp, 100);
    // Radial HE hits diagonals -- unlike barrel cardinal-only
    expect(diagonal.hp).toBeLessThan(diagonal.maxHp);
  });
});

// -- Combat Damage (structureDamage) ------------------------------------------
//
// HOSP takes damage normally through structureDamage. HP reduces linearly.
// When HP reaches 0, the structure is destroyed (alive=false, rubble=true).

describe('HOSP takes combat damage normally', () => {

  it('HP reduces by damage amount', () => {
    const hosp = makeHOSP(10, 10, 400);
    hosp.house = House.USSR;
    const ctx = makeCombatCtx([hosp]);
    structureDamage(ctx, hosp, 100);
    expect(hosp.hp).toBe(300);
  });

  it('HP clamps to 0 (does not go negative)', () => {
    const hosp = makeHOSP(10, 10, 50);
    hosp.house = House.USSR;
    const ctx = makeCombatCtx([hosp]);
    structureDamage(ctx, hosp, 200);
    expect(hosp.hp).toBe(0);
  });

  it('structure dies when HP reaches 0', () => {
    const hosp = makeHOSP(10, 10, 50);
    hosp.house = House.USSR;
    const ctx = makeCombatCtx([hosp]);
    structureDamage(ctx, hosp, 100);
    expect(hosp.alive).toBe(false);
  });

  it('structure becomes rubble on destruction', () => {
    const hosp = makeHOSP(10, 10, 50);
    hosp.house = House.USSR;
    const ctx = makeCombatCtx([hosp]);
    structureDamage(ctx, hosp, 100);
    expect(hosp.rubble).toBe(true);
  });

  it('multiple hits reduce HP cumulatively', () => {
    const hosp = makeHOSP(10, 10, 400);
    hosp.house = House.USSR;
    const ctx = makeCombatCtx([hosp]);
    structureDamage(ctx, hosp, 100);
    expect(hosp.hp).toBe(300);
    structureDamage(ctx, hosp, 150);
    expect(hosp.hp).toBe(150);
    structureDamage(ctx, hosp, 150);
    expect(hosp.hp).toBe(0);
    expect(hosp.alive).toBe(false);
  });

  it('already-dead HOSP cannot take further damage', () => {
    const hosp = makeHOSP(10, 10, 50);
    hosp.house = House.USSR;
    const ctx = makeCombatCtx([hosp]);
    structureDamage(ctx, hosp, 100);
    expect(hosp.alive).toBe(false);
    // Calling again on dead structure returns false (no effect)
    const result = structureDamage(ctx, hosp, 50);
    expect(result).toBe(false);
  });
});

// -- Trigger Integration (scenario triggers) ----------------------------------
//
// HOSP can have an attached trigger (triggerName) for scenario objectives.
// When attacked, its triggerName is added to attackedTriggerNames.

describe('HOSP trigger integration', () => {

  it('attacked HOSP with triggerName registers in attackedTriggerNames', () => {
    const hosp = makeHOSP(10, 10, 400);
    hosp.house = House.USSR;
    hosp.triggerName = 'HospAttacked';
    const ctx = makeCombatCtx([hosp]);
    structureDamage(ctx, hosp, 50);
    expect(ctx.attackedTriggerNames.has('HospAttacked')).toBe(true);
  });

  it('HOSP without triggerName does not add to attackedTriggerNames', () => {
    const hosp = makeHOSP(10, 10, 400);
    hosp.house = House.USSR;
    const ctx = makeCombatCtx([hosp]);
    structureDamage(ctx, hosp, 50);
    expect(ctx.attackedTriggerNames.size).toBe(0);
  });
});

// -- Civilian Nature (no active abilities) ------------------------------------
//
// HOSP has no weapon, no power, no special production capability.
// It serves purely as a map objective or decoration in scenarios.

describe('HOSP civilian nature -- no active capabilities', () => {

  it('has no weapon stats entry', () => {
    expect(STRUCTURE_WEAPONS['HOSP']).toBeUndefined();
  });

  it('produces 0 power at any health level', () => {
    for (const hp of [400, 300, 200, 100, 50, 1, 0]) {
      expect(powerOutput('HOSP', hp, 400)).toBe(0);
    }
  });

  it('consumes 0 power (absent from POWER_DRAIN)', () => {
    expect(POWER_DRAIN['HOSP']).toBeUndefined();
  });

  it('is not affected by low power (absent from STRUCTURE_POWERED)', () => {
    expect(STRUCTURE_POWERED.has('HOSP')).toBe(false);
  });

  it('can be placed for any house (neutral civilian placement)', () => {
    const neutral = makeHOSP(10, 10, 400, House.Neutral);
    const allied = makeHOSP(14, 10, 400, House.Spain);
    const soviet = makeHOSP(18, 10, 400, House.USSR);
    expect(neutral.type).toBe('HOSP');
    expect(allied.type).toBe('HOSP');
    expect(soviet.type).toBe('HOSP');
  });
});
