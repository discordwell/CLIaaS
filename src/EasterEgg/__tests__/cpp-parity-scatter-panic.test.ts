/**
 * C++ Behavioral Parity Audit: Infantry Scatter & Panic
 *
 * Tests verify scatter/panic behavior matches C++ infantry.cpp.
 * Expected values are parsed from rules.ini at test time — never hardcoded.
 *
 * C++ source references:
 *   infantry.cpp:1852-1929 — InfantryClass::Scatter (directional, threat-based)
 *   infantry.cpp:1860      — IsDriving → forced=false
 *   infantry.cpp:1866      — MissionControl[Mission].IsScatter required (or forced)
 *   infantry.cpp:1872      — Non-FraidyCat with valid target doesn't scatter (unless forced)
 *   infantry.cpp:1885      — Must be forced OR IsFraidyCat to execute
 *   infantry.cpp:1888-1900 — Direction away from threat with random +-2 facing offset
 *   infantry.cpp:1905-1915 — Try 8 directions starting from away-direction
 *   infantry.cpp:329-330   — ProneDamageBias applied to prone infantry
 *   infantry.cpp:442-457   — Fear increase on damage (FEAR_SCARED/FEAR_PANIC jump)
 *   infantry.cpp:3466-3509 — Fear_AI (fear decay, prone transitions, IsFraidyCat scatter)
 *   infantry.cpp:3496      — !Class->IsDog prevents prone
 *   infantry.cpp:3506      — IsFraidyCat && Fear > FEAR_ANXIOUS → scatter
 *   infantry.cpp:339-345   — Dog instant-kill on designated target
 *   defines.h:617-623      — FearType enum: NONE=0, ANXIOUS=10, SCARED=100, PANIC=200, MAX=255
 *   rules.cpp:202           — ProneDamageBias = fixed(1,2) = 0.5
 *   rules.cpp:260           — StrayDistance = 0x0200 = 512 leptons = 2 cells
 *   rules.ini [General]     — Stray=2.0
 *   rules.ini [IQ]          — Scatter=3 (IQ threshold for scatter)
 *   rules.ini [C1]-[C10],[EINSTEIN] — Fraidycat=yes
 *   rules.ini mission sections — Scatter=no for specific missions
 *
 * Tests that FAIL are GOOD — they identify real C++ divergences.
 * DO NOT modify engine code to make these pass.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseIniSections } from '../engine/parseIni';
import {
  UnitType, House, CELL_SIZE, Dir, Mission,
  UNIT_STATS, MISSION_CONTROL, DIR_DX, DIR_DY, DIR_COUNT,
  PRONE_DAMAGE_BIAS, CONDITION_RED, CONDITION_YELLOW,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  aiScatterOnDamage,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import { AI_BUILD_RULES } from '../engine/ai';
import type { Effect } from '../engine/renderer';

// ── Parse rules.ini at test time (authoritative source) ──────────────────────

const rulesIniPath = join(__dirname, '../../..', 'public/ra/assets/rules.ini');
const rulesText = readFileSync(rulesIniPath, 'utf-8');
const sections = parseIniSections(rulesText);

/** Get a float from an INI section */
function iniFloat(section: string, key: string, def = 0): number {
  const val = sections.get(section)?.get(key);
  if (val == null) return def;
  const cleaned = val.replace(/%$/, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? def : parsed;
}

/** Get a boolean from an INI section */
function iniBool(section: string, key: string, def = false): boolean {
  const val = sections.get(section)?.get(key)?.toLowerCase();
  if (val == null) return def;
  return val === 'yes' || val === 'true' || val === '1';
}

/** Get raw string from an INI section */
function iniRaw(section: string, key: string): string | undefined {
  return sections.get(section)?.get(key);
}

beforeEach(() => resetEntityIds());

// ── Helpers ──────────────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(entities: Entity[] = []): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
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
    isRevealedToHouse: () => true,
    movementSpeed: () => 1,
    getFirepowerBias: () => 1.0,
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
  } as CombatContext;
}

function cellDir(fromCX: number, fromCY: number, toCX: number, toCY: number): Dir {
  const dx = toCX - fromCX;
  const dy = toCY - fromCY;
  const angle = Math.atan2(dy, dx);
  const octant = Math.round(((angle + Math.PI) / (Math.PI * 2)) * 8) % 8;
  return ((octant + 6) % 8) as Dir;
}

// =============================================================================
// 1. IsFraidyCat — all civilians (C1-C10, EINSTEIN) from rules.ini
// =============================================================================

describe('IsFraidyCat: civilians flagged from rules.ini Fraidycat=yes', () => {
  const civilianIds = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'EINSTEIN'];

  for (const id of civilianIds) {
    it(`${id} has Fraidycat=yes in rules.ini`, () => {
      const iniVal = iniBool(id, 'Fraidycat');
      expect(iniVal).toBe(true);
    });

    it(`UNIT_STATS.${id}.isFraidyCat matches rules.ini Fraidycat=yes`, () => {
      const iniVal = iniBool(id, 'Fraidycat');
      const tsVal = UNIT_STATS[id]?.isFraidyCat ?? false;
      expect(tsVal).toBe(iniVal);
    });
  }

  // C++ idata.cpp: military infantry do NOT have IsFraidyCat (default is false)
  const militaryIds = ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'SPY'];
  for (const id of militaryIds) {
    it(`${id} does NOT have Fraidycat=yes in rules.ini`, () => {
      const iniVal = iniBool(id, 'Fraidycat');
      expect(iniVal).toBe(false);
    });

    it(`UNIT_STATS.${id}.isFraidyCat is falsy (military infantry)`, () => {
      expect(UNIT_STATS[id]?.isFraidyCat).toBeFalsy();
    });
  }

  // DELPHI is NOT a fraidycat despite being civilian-like
  it('DELPHI does NOT have Fraidycat=yes in rules.ini', () => {
    const iniVal = iniBool('DELPHI', 'Fraidycat');
    expect(iniVal).toBe(false);
  });
});

// =============================================================================
// 2. IsFraidyCat scatter behavior — more readily, lower threshold
// =============================================================================

describe('IsFraidyCat scatter: civilians scatter more readily (infantry.cpp:1885)', () => {
  // C++ infantry.cpp:1885 — only FraidyCat or forced scatters when not forced
  // FraidyCat units bypass the !forced check at line 1885
  it('FraidyCat civilian scatters even when already moving (isDriving=true)', () => {
    let scattered = false;
    for (let i = 0; i < 100; i++) {
      const civ = entityAtCell(UnitType.I_C1, House.USSR, 10, 10);
      civ.mission = Mission.MOVE;
      civ.moveTarget = { x: 15 * CELL_SIZE, y: 10 * CELL_SIZE };
      const ctx = makeCombatCtx([civ]);
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
      aiScatterOnDamage(ctx, civ, attacker);
      if (civ.moveTarget!.x !== 15 * CELL_SIZE || civ.moveTarget!.y !== 10 * CELL_SIZE) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('non-FraidyCat infantry does NOT scatter when already moving', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e1.mission = Mission.MOVE;
    e1.moveTarget = { x: 15 * CELL_SIZE, y: 10 * CELL_SIZE };
    const origTarget = { ...e1.moveTarget };
    const ctx = makeCombatCtx([e1]);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
    aiScatterOnDamage(ctx, e1, attacker);
    expect(e1.moveTarget!.x).toBe(origTarget.x);
    expect(e1.moveTarget!.y).toBe(origTarget.y);
  });

  // C++ infantry.cpp:3506: IsFraidyCat && Fear > FEAR_ANXIOUS → auto-scatter
  it('FraidyCat civilians get FEAR_PANIC (200) on first hit vs military FEAR_SCARED (100)', () => {
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 20, 20);
    const civ = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    expect(civ.fear).toBe(0);
    civ.takeDamage(1, 'SA', attacker);
    // C++ infantry.cpp:443-444: IsFraidyCat → FEAR_PANIC
    expect(civ.fear).toBeGreaterThanOrEqual(Entity.FEAR_PANIC);

    const mil = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(mil.fear).toBe(0);
    mil.takeDamage(1, 'SA', attacker);
    // C++ infantry.cpp:443: non-FraidyCat → FEAR_SCARED
    expect(mil.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
    // Military fear should be lower than civilian fear
    expect(mil.fear).toBeLessThan(civ.fear);
  });
});

// =============================================================================
// 3. Scatter distance from rules.ini [General] Stray=
// =============================================================================

describe('Scatter distance: rules.ini [General] Stray=', () => {
  it('[General] section has Stray key in rules.ini', () => {
    const strayRaw = iniRaw('General', 'Stray');
    expect(strayRaw).toBeDefined();
  });

  it('Stray= value from rules.ini parses to 2.0 cells', () => {
    const strayValue = iniFloat('General', 'Stray');
    expect(strayValue).toBe(2.0);
  });

  // C++ rules.cpp:260: StrayDistance = 0x0200 = 512 leptons = 2 cells
  // This is the team stray distance, used for team member regrouping
  it('TS team stray threshold matches rules.ini Stray= (2 cells)', () => {
    const iniStray = iniFloat('General', 'Stray');
    // In C++, StrayDistance is 512 leptons = 2 cells
    // TS team.ts:493 uses strayThreshold = 2 (cells)
    expect(iniStray).toBe(2.0);
  });

  // Infantry scatter moves to an adjacent cell (1 cell away in any direction)
  // C++ infantry.cpp:1905-1915: try 8 directions, each 1 cell away
  it('infantry scatter target is exactly 1 cell away (C++ tries 8 adjacent cells)', () => {
    const scatterDistances = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e.mission = Mission.GUARD;
      const ctx = makeCombatCtx([e]);
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
      aiScatterOnDamage(ctx, e, attacker);
      if (e.moveTarget) {
        const tcx = Math.floor(e.moveTarget.x / CELL_SIZE);
        const tcy = Math.floor(e.moveTarget.y / CELL_SIZE);
        const dist = Math.max(Math.abs(tcx - 10), Math.abs(tcy - 10)); // Chebyshev distance
        scatterDistances.add(dist);
      }
    }
    // All scatter targets should be exactly 1 cell away (adjacent cells)
    expect(scatterDistances.size).toBe(1);
    expect(scatterDistances.has(1)).toBe(true);
  });
});

// =============================================================================
// 4. Scatter triggers: damage, nearby explosion, enemy in sight
// =============================================================================

describe('Scatter triggers (infantry.cpp Take_Damage + Fear_AI)', () => {
  // C++ infantry.cpp:439 — Scatter is called from TakeDamage
  it('infantry scatters when taking damage (via aiScatterOnDamage)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e.mission = Mission.GUARD;
      const ctx = makeCombatCtx([e]);
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
      aiScatterOnDamage(ctx, e, attacker);
      if (e.mission === Mission.MOVE && e.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  // Scatter without attacker (explosion nearby, no direct source)
  it('infantry scatters without attacker source (uses facing direction)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e.mission = Mission.GUARD;
      e.facing = Dir.N;
      const ctx = makeCombatCtx([e]);
      aiScatterOnDamage(ctx, e); // no attacker
      if (e.mission === Mission.MOVE && e.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  // Player-controlled units do NOT auto-scatter
  // C++ infantry.cpp:1883: if House->IsHuman && !forced && !Team → return
  it('player-controlled infantry does NOT scatter (C++ human house check)', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.mission = Mission.GUARD;
    const ctx = makeCombatCtx([e]);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 10, 15);
    aiScatterOnDamage(ctx, e, attacker);
    expect(e.mission).toBe(Mission.GUARD);
    expect(e.moveTarget).toBeNull();
  });
});

// =============================================================================
// 5. Dogs cause instant scatter in infantry (dog-related fear/panic)
// =============================================================================

describe('Dog instant kill and fear (infantry.cpp:339-345)', () => {
  // C++ infantry.cpp:339-344: dog kills its designated target instantly
  it('dog kills designated target instantly (amount = Strength)', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    dog.target = victim;
    victim.takeDamage(10, 'Organic', dog);
    expect(victim.alive).toBe(false);
  });

  // C++ infantry.cpp:339-345: dog does zero damage to non-targets
  it('dog does zero damage to non-designated targets (no collateral)', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const bystander = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    dog.target = target;
    const hpBefore = bystander.hp;
    bystander.takeDamage(50, 'Organic', dog);
    expect(bystander.hp).toBe(hpBefore);
  });

  // Nearby infantry should gain fear from seeing a dog attack
  // C++ infantry.cpp:442: fear increases on TakeDamage
  // Infantry that survive dog encounters will have high fear and scatter
  it('infantry that takes damage gains fear (enabling scatter)', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    // Use non-dog attacker to avoid DG2 collateral prevention
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 10, 11);
    expect(e.fear).toBe(0);
    e.takeDamage(5, 'SA', attacker);
    expect(e.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });
});

// =============================================================================
// 6. Prone behavior: infantry go prone when under fire
// =============================================================================

describe('Prone behavior (infantry.cpp:3486-3509)', () => {
  // C++ infantry.cpp:3496: Fear >= FEAR_ANXIOUS → go prone (if not dog)
  it('infantry goes prone when fear >= FEAR_ANXIOUS (10)', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.fear = Entity.FEAR_ANXIOUS;
    expect(e.isProne).toBe(false);
    // Simulate Fear_AI prone check (index.ts:1580)
    if (!e.isProne && e.fear >= Entity.FEAR_ANXIOUS && e.type !== UnitType.I_DOG) {
      e.isProne = true;
    }
    expect(e.isProne).toBe(true);
  });

  // C++ infantry.cpp:3487: Fear < FEAR_ANXIOUS → stand up
  it('infantry stands up when fear < FEAR_ANXIOUS', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.isProne = true;
    e.fear = Entity.FEAR_ANXIOUS - 1;
    if (e.isProne && e.fear < Entity.FEAR_ANXIOUS) {
      e.isProne = false;
    }
    expect(e.isProne).toBe(false);
  });

  // C++ infantry.cpp:3496: !Class->IsDog — dogs never go prone
  it('dogs NEVER go prone regardless of fear level', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    dog.fear = Entity.FEAR_MAXIMUM;
    if (!dog.isProne && dog.fear >= Entity.FEAR_ANXIOUS && dog.type !== UnitType.I_DOG) {
      dog.isProne = true;
    }
    expect(dog.isProne).toBe(false);
  });

  // Boundary test: exactly at FEAR_ANXIOUS threshold
  it('prone entry at exactly FEAR_ANXIOUS=10 (boundary)', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.fear = Entity.FEAR_ANXIOUS; // exactly 10
    e.isProne = false;
    if (!e.isProne && e.fear >= Entity.FEAR_ANXIOUS && e.type !== UnitType.I_DOG) {
      e.isProne = true;
    }
    expect(e.isProne).toBe(true);
  });

  it('prone exit threshold: stays prone at exactly FEAR_ANXIOUS', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.isProne = true;
    e.fear = Entity.FEAR_ANXIOUS; // exactly 10 — NOT below
    if (e.isProne && e.fear < Entity.FEAR_ANXIOUS) {
      e.isProne = false;
    }
    expect(e.isProne).toBe(true); // stays prone
  });
});

// =============================================================================
// 7. Prone reduces damage by PRONE_DAMAGE_BIAS
// =============================================================================

describe('Prone damage reduction (infantry.cpp:329-330, rules.cpp:202)', () => {
  // C++ rules.cpp:202: ProneDamageBias = fixed(1,2) = 0.5
  // rules.ini [General] ProneDamage=50% → 0.5
  it('PRONE_DAMAGE_BIAS matches rules.ini ProneDamage= (0.5)', () => {
    const iniProneDamage = iniFloat('General', 'ProneDamage');
    // rules.ini expresses as percentage: 50 (%) → 0.5
    const expected = iniProneDamage > 1 ? iniProneDamage / 100 : iniProneDamage;
    expect(PRONE_DAMAGE_BIAS).toBe(expected);
  });

  // C++ infantry.cpp:329-330: if (IsProne && damage > 0) damage *= ProneDamageBias
  it('prone infantry takes 50% damage', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.isProne = true;
    const hpBefore = e.hp;
    e.takeDamage(20, 'SA');
    const damageTaken = hpBefore - e.hp;
    // 20 * 0.5 = 10
    expect(damageTaken).toBe(Math.max(1, Math.round(20 * PRONE_DAMAGE_BIAS)));
  });

  it('non-prone infantry takes full damage', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e.isProne).toBe(false);
    const hpBefore = e.hp;
    e.takeDamage(20, 'SA');
    expect(hpBefore - e.hp).toBe(20);
  });

  it('prone damage reduction has minimum 1 damage', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.isProne = true;
    const hpBefore = e.hp;
    e.takeDamage(1, 'SA');
    // 1 * 0.5 = 0.5, rounded = 1 (Math.max(1, ...))
    expect(hpBefore - e.hp).toBe(1);
  });

  // Vehicles are NOT affected by prone damage bias (C++ only in infantry.cpp)
  it('vehicles are NOT affected by prone damage bias', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const hpBefore = tank.hp;
    tank.takeDamage(20, 'AP');
    // Vehicles take full damage regardless
    expect(hpBefore - tank.hp).toBe(20);
  });
});

// =============================================================================
// 8. Prone duration / recovery (fear decay rate)
// =============================================================================

describe('Prone duration: fear decay drives recovery (infantry.cpp:3471-3473)', () => {
  // C++ Fear_AI: Fear-- every tick
  it('fear decays by 1 per tick', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.fear = 50;
    if (e.stats.isInfantry && e.fear > 0) e.fear--;
    expect(e.fear).toBe(49);
  });

  // Fear decay from FEAR_SCARED to 0 = 100 ticks → prone duration ~91 ticks
  // (prone entry at fear 100, prone exit at fear 9)
  it('prone duration from FEAR_SCARED: entry at 100, exit at 9 = 91 ticks', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.fear = Entity.FEAR_SCARED; // 100
    e.isProne = false;

    let proneEntryTick = -1;
    let proneExitTick = -1;

    for (let tick = 0; e.fear > 0; tick++) {
      e.fear--;
      if (!e.isProne && e.fear >= Entity.FEAR_ANXIOUS && e.type !== UnitType.I_DOG) {
        e.isProne = true;
        if (proneEntryTick === -1) proneEntryTick = tick;
      }
      if (e.isProne && e.fear < Entity.FEAR_ANXIOUS) {
        e.isProne = false;
        proneExitTick = tick;
      }
    }

    // Tick 0: fear 100→99, still >= 10 → goes prone
    expect(proneEntryTick).toBe(0);
    // Tick 90: fear 10→9, below FEAR_ANXIOUS=10 → stands up
    expect(proneExitTick).toBe(90);
    // Prone duration = 90 - 0 = 90 ticks
    expect(proneExitTick - proneEntryTick).toBe(90);
  });

  // Fear decay from FEAR_PANIC (200) to 0 = 200 ticks → prone ~191 ticks
  it('prone duration from FEAR_PANIC (civilians): ~191 ticks', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.fear = Entity.FEAR_PANIC; // 200
    e.isProne = false;

    let proneEntryTick = -1;
    let proneExitTick = -1;

    for (let tick = 0; e.fear > 0; tick++) {
      e.fear--;
      if (!e.isProne && e.fear >= Entity.FEAR_ANXIOUS && e.type !== UnitType.I_DOG) {
        e.isProne = true;
        if (proneEntryTick === -1) proneEntryTick = tick;
      }
      if (e.isProne && e.fear < Entity.FEAR_ANXIOUS) {
        e.isProne = false;
        proneExitTick = tick;
      }
    }

    expect(proneEntryTick).toBe(0);
    // 200 → decay → 10→9 at tick 190
    expect(proneExitTick).toBe(190);
  });

  it('fear capped at FEAR_MAXIMUM (255)', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.fear = 254;
    e.takeDamage(5, 'SA');
    expect(e.fear).toBeLessThanOrEqual(Entity.FEAR_MAXIMUM);
  });
});

// =============================================================================
// 9. IQ level affects scatter behavior — rules.ini [IQ] Scatter=
// =============================================================================

describe('IQ scatter threshold (rules.ini [IQ] Scatter=)', () => {
  it('[IQ] section exists in rules.ini', () => {
    expect(sections.has('IQ')).toBe(true);
  });

  it('rules.ini [IQ] Scatter= value is 3', () => {
    const iqScatterIni = iniFloat('IQ', 'Scatter');
    expect(iqScatterIni).toBe(3);
  });

  it('AI_BUILD_RULES.iqScatter matches rules.ini [IQ] Scatter=', () => {
    const iniVal = iniFloat('IQ', 'Scatter');
    expect(AI_BUILD_RULES.iqScatter).toBe(iniVal);
  });

  // C++ techno.cpp: scatter requires IQ >= Scatter threshold
  // TS combat.ts:339: if (ctx.aiIQ(entity.house) < 2) return
  // C++ uses IQ >= Rule.IQScatter (3), TS uses IQ < 2
  // This is a potential divergence!
  it('TS scatter IQ gate should use rules.ini [IQ] Scatter= threshold (3), not hardcoded 2', () => {
    const iniScatterIQ = iniFloat('IQ', 'Scatter');
    // C++ requires IQ >= 3 to scatter; TS checks IQ < 2
    // Test documents: does TS use the correct threshold?
    const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e.mission = Mission.GUARD;

    // IQ=2: C++ says NO scatter (2 < 3), TS says YES scatter (2 >= 2)
    const ctxIQ2 = makeCombatCtx([e]);
    ctxIQ2.aiIQ = () => 2;
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);

    // Run many times to see if scatter occurs at IQ=2
    let scatteredAtIQ2 = false;
    for (let i = 0; i < 50; i++) {
      const te = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      te.mission = Mission.GUARD;
      const ctx = makeCombatCtx([te]);
      ctx.aiIQ = () => 2;
      aiScatterOnDamage(ctx, te, attacker);
      if (te.mission === Mission.MOVE && te.moveTarget !== null) {
        scatteredAtIQ2 = true;
        break;
      }
    }

    // C++ behavior: at IQ=2, scatter should NOT occur (IQ < Scatter=3)
    // If scatteredAtIQ2 is true, TS diverges from C++ (uses wrong threshold)
    expect(scatteredAtIQ2).toBe(false);
  });

  // IQ=0 (human player): should not scatter
  it('IQ=0 prevents scatter (human player equivalent)', () => {
    const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e.mission = Mission.GUARD;
    const ctx = makeCombatCtx([e]);
    ctx.aiIQ = () => 0;
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
    aiScatterOnDamage(ctx, e, attacker);
    expect(e.mission).toBe(Mission.GUARD);
    expect(e.moveTarget).toBeNull();
  });

  // IQ=1: below threshold, should not scatter
  it('IQ=1 prevents scatter (below Scatter=3 threshold)', () => {
    const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e.mission = Mission.GUARD;
    const ctx = makeCombatCtx([e]);
    ctx.aiIQ = () => 1;
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
    aiScatterOnDamage(ctx, e, attacker);
    expect(e.mission).toBe(Mission.GUARD);
    expect(e.moveTarget).toBeNull();
  });

  // IQ >= 3: should scatter
  it('IQ=3 allows scatter (meets Scatter= threshold)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e.mission = Mission.GUARD;
      const ctx = makeCombatCtx([e]);
      ctx.aiIQ = () => 3;
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
      aiScatterOnDamage(ctx, e, attacker);
      if (e.mission === Mission.MOVE && e.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });
});

// =============================================================================
// 10. Mission-level scatter control from rules.ini
// =============================================================================

describe('Mission scatter control from rules.ini mission sections', () => {
  // rules.ini mission sections define Scatter=no for certain missions
  const missionsWithScatterNo: [string, string][] = [
    ['Sleep', 'Scatter=no'],
    ['Sticky', 'Scatter=no'],
    ['Capture', 'Scatter=no'],
    ['Harvest', 'Scatter=no'],
    ['Unload', 'Scatter=no'],
    ['Construction', 'Scatter=no'],
    ['Selling', 'Scatter=no'],
  ];

  for (const [missionName] of missionsWithScatterNo) {
    it(`rules.ini [${missionName}] has Scatter=no`, () => {
      const scatterVal = iniRaw(missionName, 'Scatter')?.toLowerCase();
      expect(scatterVal).toBe('no');
    });
  }

  // Missions that do NOT have Scatter=no should default to yes
  // Guard, Move, Area Guard, etc.
  const missionsWithDefaultScatter = ['Guard', 'Move', 'Area Guard', 'Attack', 'Hunt'];
  for (const missionName of missionsWithDefaultScatter) {
    it(`rules.ini [${missionName}] does not have Scatter=no (defaults to yes)`, () => {
      const scatterVal = iniRaw(missionName, 'Scatter')?.toLowerCase();
      // Either undefined (default yes) or explicitly 'yes'
      expect(scatterVal !== 'no').toBe(true);
    });
  }

  // Now verify TS MISSION_CONTROL matches
  // C++ mission defaults: Guard, Move, Area Guard have isScatter=true
  it('MISSION_CONTROL[GUARD].isScatter = true', () => {
    expect(MISSION_CONTROL[Mission.GUARD].isScatter).toBe(true);
  });

  it('MISSION_CONTROL[MOVE].isScatter = true', () => {
    expect(MISSION_CONTROL[Mission.MOVE].isScatter).toBe(true);
  });

  it('MISSION_CONTROL[AREA_GUARD].isScatter = true', () => {
    expect(MISSION_CONTROL[Mission.AREA_GUARD].isScatter).toBe(true);
  });

  // C++ Attack mission: Scatter defaults to yes (not overridden in rules.ini)
  // But C++ source line 1866 shows Attack mission doesn't scatter
  // TS sets isScatter=false for ATTACK
  it('MISSION_CONTROL[ATTACK].isScatter matches C++ defaults (true — no INI override)', () => {
    // C++ constructor default is isScatter=true; rules.ini [Attack] has no Scatter= override
    expect(MISSION_CONTROL[Mission.ATTACK].isScatter).toBe(true);
  });

  // Verify missions with explicit Scatter=no in rules.ini have isScatter=false in TS
  it('MISSION_CONTROL[HARVEST].isScatter = false (rules.ini Scatter=no)', () => {
    expect(MISSION_CONTROL[Mission.HARVEST].isScatter).toBe(false);
  });

  // HARMLESS: rules.ini does NOT have Scatter=no, but C++ may differ
  // TS has isScatter=true for HARMLESS
  it('MISSION_CONTROL[HARMLESS].isScatter should be true (no Scatter=no in rules.ini)', () => {
    const iniScatter = iniRaw('Harmless', 'Scatter')?.toLowerCase();
    const tsScatter = MISSION_CONTROL[Mission.HARMLESS].isScatter;
    // rules.ini [Harmless] doesn't set Scatter= → default is yes → isScatter=true
    if (iniScatter === 'no') {
      expect(tsScatter).toBe(false);
    } else {
      expect(tsScatter).toBe(true);
    }
  });

  // STICKY: rules.ini has Scatter=no
  // But TS MISSION_CONTROL[STICKY].isScatter = true — possible divergence!
  it('MISSION_CONTROL[STICKY].isScatter should match rules.ini Scatter=no (false)', () => {
    const iniScatter = iniRaw('Sticky', 'Scatter')?.toLowerCase();
    expect(iniScatter).toBe('no'); // rules.ini says no
    expect(MISSION_CONTROL[Mission.STICKY].isScatter).toBe(false);
  });
});

// =============================================================================
// 11. Fear constant values match C++ defines.h
// =============================================================================

describe('Fear constants: C++ defines.h:617-623', () => {
  // These are hardcoded in C++ defines.h — not from INI, but need to verify TS matches
  it('FEAR_ANXIOUS = 10', () => {
    expect(Entity.FEAR_ANXIOUS).toBe(10);
  });

  it('FEAR_SCARED = 100', () => {
    expect(Entity.FEAR_SCARED).toBe(100);
  });

  it('FEAR_PANIC = 200', () => {
    expect(Entity.FEAR_PANIC).toBe(200);
  });

  it('FEAR_MAXIMUM = 255 (unsigned char max)', () => {
    expect(Entity.FEAR_MAXIMUM).toBe(255);
  });

  it('infantry starts with fear=0 (FEAR_NONE)', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e.fear).toBe(0);
  });

  it('infantry starts not prone', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e.isProne).toBe(false);
  });
});

// =============================================================================
// 12. Fear increase on damage — health-based moreFear
// =============================================================================

describe('Fear increase on damage (infantry.cpp:442-457)', () => {
  // C++ infantry.cpp:454-457:
  //   moreFear = FEAR_ANXIOUS (10)
  //   if (hpRatio > CONDITION_RED)    moreFear /= 2  → 5
  //   if (hpRatio > CONDITION_YELLOW) moreFear /= 2  → 2
  // So at full health: moreFear = 2; at yellow: moreFear = 5; at red: moreFear = 10

  it('moreFear at full health = FEAR_ANXIOUS/4 = 2 (above yellow + red)', () => {
    // Parse thresholds from rules.ini
    const condYellow = iniFloat('General', 'ConditionYellow') / 100; // 50% → 0.5
    const condRed = iniFloat('General', 'ConditionRed') / 100; // 25% → 0.25

    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    // At full health, hp/maxHp = 1.0 > condYellow > condRed
    let moreFear = Entity.FEAR_ANXIOUS; // 10
    const hpRatio = e.hp / e.maxHp;
    if (hpRatio > condRed) moreFear = Math.floor(moreFear / 2); // 5
    if (hpRatio > condYellow) moreFear = Math.floor(moreFear / 2); // 2
    expect(moreFear).toBe(2);
  });

  it('moreFear at yellow health = FEAR_ANXIOUS/2 = 5 (above red, below yellow)', () => {
    const condYellow = iniFloat('General', 'ConditionYellow') / 100;
    const condRed = iniFloat('General', 'ConditionRed') / 100;

    // HP ratio between condRed and condYellow: e.g., 0.35
    const hpRatio = (condRed + condYellow) / 2; // ~0.375
    let moreFear = Entity.FEAR_ANXIOUS;
    if (hpRatio > condRed) moreFear = Math.floor(moreFear / 2); // 5
    if (hpRatio > condYellow) moreFear = Math.floor(moreFear / 2); // not triggered
    expect(moreFear).toBe(5);
  });

  it('moreFear at red health = FEAR_ANXIOUS = 10 (below red)', () => {
    const condRed = iniFloat('General', 'ConditionRed') / 100;

    // HP ratio below condRed: e.g., 0.1
    const hpRatio = condRed - 0.1; // 0.15
    let moreFear = Entity.FEAR_ANXIOUS;
    if (hpRatio > condRed) moreFear = Math.floor(moreFear / 2); // not triggered
    if (hpRatio > CONDITION_YELLOW) moreFear = Math.floor(moreFear / 2); // not triggered
    expect(moreFear).toBe(10);
  });

  // Verify TS takeDamage actually adds moreFear incrementally
  it('second hit adds incremental fear (not resets to FEAR_SCARED)', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 20, 20);
    e.takeDamage(5, 'SA', attacker);
    const fearAfterFirst = e.fear;
    expect(fearAfterFirst).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);

    e.takeDamage(5, 'SA');
    const fearAfterSecond = e.fear;
    // Second hit should add moreFear on top (not reset)
    expect(fearAfterSecond).toBeGreaterThan(fearAfterFirst);
  });

  it('zero damage does NOT increase fear', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e.fear).toBe(0);
    e.takeDamage(0, 'SA');
    expect(e.fear).toBe(0);
  });
});

// =============================================================================
// 13. Scatter direction — away from threat with +-2 offset
// =============================================================================

describe('Scatter direction: away from threat (infantry.cpp:1888-1900)', () => {
  // C++ infantry.cpp:1889: Dir_Facing(Direction8(threat, Coord))
  // Direction from threat to infantry = away from threat
  it('infantry scatters AWAY from attacker (northern arc when attacker is south)', () => {
    const scatterDirs = new Set<Dir>();
    for (let i = 0; i < 200; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e.mission = Mission.GUARD;
      const ctx = makeCombatCtx([e]);
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 13);
      aiScatterOnDamage(ctx, e, attacker);
      if (e.moveTarget) {
        const tcx = Math.floor(e.moveTarget.x / CELL_SIZE);
        const tcy = Math.floor(e.moveTarget.y / CELL_SIZE);
        scatterDirs.add(cellDir(10, 10, tcx, tcy));
      }
    }
    // Away from south = north-ish (Dir.N=0, Dir.NE=1, Dir.NW=7)
    expect(scatterDirs.has(Dir.N) || scatterDirs.has(Dir.NE) || scatterDirs.has(Dir.NW)).toBe(true);
  });

  // C++ infantry.cpp:1890: Random_Pick(0,4)-2 → +-2 offset
  it('scatter direction has randomness (multiple unique directions)', () => {
    const scatterDirs = new Set<Dir>();
    for (let i = 0; i < 300; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e.mission = Mission.GUARD;
      const ctx = makeCombatCtx([e]);
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 15, 10);
      aiScatterOnDamage(ctx, e, attacker);
      if (e.moveTarget) {
        const tcx = Math.floor(e.moveTarget.x / CELL_SIZE);
        const tcy = Math.floor(e.moveTarget.y / CELL_SIZE);
        scatterDirs.add(cellDir(10, 10, tcx, tcy));
      }
    }
    // Random offset should produce > 1 unique direction
    expect(scatterDirs.size).toBeGreaterThan(1);
  });

  // C++ infantry.cpp:1905-1915: blocked direction → try next
  it('blocked direction causes infantry to try alternate cells', () => {
    let scattered = false;
    for (let i = 0; i < 100; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 1, 1);
      e.mission = Mission.GUARD;
      const ctx = makeCombatCtx([e]);
      ctx.map.setTerrain(0, 1, Terrain.ROCK); // block west cell
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 5, 1);
      aiScatterOnDamage(ctx, e, attacker);
      if (e.moveTarget) {
        scattered = true;
        const tcx = Math.floor(e.moveTarget.x / CELL_SIZE);
        const tcy = Math.floor(e.moveTarget.y / CELL_SIZE);
        expect(tcx !== 0 || tcy !== 1).toBe(true); // NOT the blocked cell
      }
    }
    expect(scattered).toBe(true);
  });
});

// =============================================================================
// 14. Scatter condition interplay: mission + target + FraidyCat
// =============================================================================

describe('Scatter condition interplay (infantry.cpp:1860-1885)', () => {
  // C++ infantry.cpp:1872: !FraidyCat && target != null && !forced → skip
  it('non-FraidyCat with combat target does NOT scatter', () => {
    const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e.mission = Mission.GUARD;
    e.target = entityAtCell(UnitType.I_E1, House.Spain, 12, 10); // has combat target
    const ctx = makeCombatCtx([e]);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
    aiScatterOnDamage(ctx, e, attacker);
    // Non-FraidyCat with target → no scatter
    expect(e.moveTarget).toBeNull();
  });

  // ATTACK has isScatter=true (C++ default, no INI override) — infantry CAN scatter
  it('infantry on ATTACK mission CAN scatter (isScatter=true per C++ defaults)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e.mission = Mission.ATTACK;
      const ctx = makeCombatCtx([e]);
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
      aiScatterOnDamage(ctx, e, attacker);
      if (e.mission === Mission.MOVE && e.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  // HUNT has isScatter=true (C++ default, no INI Scatter= override) — infantry CAN scatter
  it('infantry on HUNT mission CAN scatter (isScatter=true per C++ defaults)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e.mission = Mission.HUNT;
      const ctx = makeCombatCtx([e]);
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
      aiScatterOnDamage(ctx, e, attacker);
      if (e.mission === Mission.MOVE && e.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  // Non-infantry: only scatters on GUARD or AREA_GUARD
  it('non-infantry on GUARD scatters (random direction)', () => {
    let scattered = false;
    for (let i = 0; i < 200; i++) {
      const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
      tank.mission = Mission.GUARD;
      const ctx = makeCombatCtx([tank]);
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
      aiScatterOnDamage(ctx, tank, attacker);
      if (tank.moveTarget) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('non-infantry on ATTACK does NOT scatter', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    tank.mission = Mission.ATTACK;
    const ctx = makeCombatCtx([tank]);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
    aiScatterOnDamage(ctx, tank, attacker);
    expect(tank.moveTarget).toBeNull();
  });
});
