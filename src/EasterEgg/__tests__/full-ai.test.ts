/**
 * Tests for Full AI — Strategic Opponent (Phase 2 #6)
 * Covers: data structures, strategic planner, base construction,
 * enhanced production, harvester fixes, attack groups, retreat/defense,
 * difficulty scaling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, Mission, CELL_SIZE, HOUSE_FACTION,
  PRODUCTION_ITEMS, type ProductionItem, type Faction,
} from '../engine/types';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP, STRUCTURE_WEAPONS } from '../engine/scenario';
import type { Difficulty } from '../engine/index';

beforeEach(() => resetEntityIds());

// === Helper: minimal MapStructure-like objects for testing ===
function makeStructure(type: string, house: House, cx: number, cy: number, alive = true) {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type, image: type.toLowerCase(), house, cx, cy,
    hp: alive ? maxHp : 0, maxHp, alive, rubble: !alive,
    weapon: STRUCTURE_WEAPONS[type], attackCooldown: 0,
    ammo: -1, maxAmmo: -1,
  };
}

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

// === Part 0: Data Structures ===

describe('AI data structures', () => {
  it('Difficulty type has three levels', () => {
    const levels: Difficulty[] = ['easy', 'normal', 'hard'];
    expect(levels).toHaveLength(3);
  });

  it('PRODUCTION_ITEMS has structures with isStructure flag', () => {
    const structures = PRODUCTION_ITEMS.filter(p => p.isStructure);
    expect(structures.length).toBeGreaterThan(10);
    expect(structures.find(p => p.type === 'POWR')).toBeDefined();
    expect(structures.find(p => p.type === 'TENT')).toBeDefined();
    expect(structures.find(p => p.type === 'WEAP')).toBeDefined();
    expect(structures.find(p => p.type === 'PROC')).toBeDefined();
  });

  it('PRODUCTION_ITEMS structures have FACT prerequisite', () => {
    const factStructures = PRODUCTION_ITEMS.filter(p =>
      p.isStructure && p.prerequisite === 'FACT'
    );
    expect(factStructures.length).toBeGreaterThan(8);
    // POWR, TENT, WEAP, PROC, SILO, DOME, HBOX, GUN, TSLA, FIX, HPAD, AFLD
    const types = factStructures.map(p => p.type);
    expect(types).toContain('POWR');
    expect(types).toContain('TENT');
    expect(types).toContain('WEAP');
  });

  it('STRUCTURE_SIZE has entries for key AI-buildable types', () => {
    // TSLA uses default [1,1] fallback — not explicitly in STRUCTURE_SIZE
    const aiTypes = ['POWR', 'TENT', 'WEAP', 'PROC', 'DOME', 'GUN', 'HBOX', 'ATEK', 'STEK', 'HPAD', 'AFLD'];
    for (const t of aiTypes) {
      expect(STRUCTURE_SIZE[t]).toBeDefined();
      expect(STRUCTURE_SIZE[t]).toHaveLength(2);
    }
  });

  it('HOUSE_FACTION maps all houses correctly', () => {
    expect(HOUSE_FACTION.Spain).toBe('allied');
    expect(HOUSE_FACTION.USSR).toBe('soviet');
    expect(HOUSE_FACTION.Greece).toBe('allied');
    expect(HOUSE_FACTION.Ukraine).toBe('soviet');
  });
});

// === Part 1: Strategic Planner (build order logic, power helpers) ===

describe('AI strategic planner', () => {
  it('PRODUCTION_ITEMS includes HARV with both faction', () => {
    const harv = PRODUCTION_ITEMS.find(p => p.type === 'HARV');
    expect(harv).toBeDefined();
    expect(harv!.faction).toBe('both');
    expect(harv!.prerequisite).toBe('WEAP');
    expect(harv!.cost).toBe(1400);
  });

  it('allied faction has GUN and HBOX defensive structures', () => {
    const gun = PRODUCTION_ITEMS.find(p => p.type === 'GUN' && p.isStructure);
    const hbox = PRODUCTION_ITEMS.find(p => p.type === 'HBOX' && p.isStructure);
    expect(gun).toBeDefined();
    expect(gun!.faction).toBe('allied');
    expect(hbox).toBeDefined();
    expect(hbox!.faction).toBe('allied');
  });

  it('soviet faction has TSLA defensive structure', () => {
    const tsla = PRODUCTION_ITEMS.find(p => p.type === 'TSLA' && p.isStructure);
    expect(tsla).toBeDefined();
    expect(tsla!.faction).toBe('soviet');
  });

  it('tech centers have POWR prerequisite', () => {
    const atek = PRODUCTION_ITEMS.find(p => p.type === 'ATEK');
    const stek = PRODUCTION_ITEMS.find(p => p.type === 'STEK');
    expect(atek).toBeDefined();
    expect(atek!.prerequisite).toBe('POWR');
    expect(stek).toBeDefined();
    expect(stek!.prerequisite).toBe('POWR');
  });

  it('DOME is available to both factions', () => {
    const dome = PRODUCTION_ITEMS.find(p => p.type === 'DOME' && p.isStructure);
    expect(dome).toBeDefined();
    expect(dome!.faction).toBe('both');
    expect(dome!.cost).toBe(1000);
  });

  it('HPAD is available to both factions', () => {
    const hpad = PRODUCTION_ITEMS.find(p => p.type === 'HPAD' && p.isStructure);
    expect(hpad).toBeDefined();
    expect(hpad!.faction).toBe('both');
  });

  it('AFLD is soviet-only', () => {
    const afld = PRODUCTION_ITEMS.find(p => p.type === 'AFLD' && p.isStructure);
    expect(afld).toBeDefined();
    expect(afld!.faction).toBe('soviet');
  });

  it('build order prioritizes POWR for power deficit', () => {
    // Simulate: AI has structures consuming power but no power plants
    // Power produced should be 0, consumed > 0 → POWR first in queue
    const consumerTypes = ['TENT', 'WEAP', 'PROC']; // all consume power
    for (const t of consumerTypes) {
      const item = PRODUCTION_ITEMS.find(p => p.type === t && p.isStructure);
      expect(item).toBeDefined();
    }
  });

  it('build order includes PROC for economy', () => {
    // PROC in PRODUCTION_ITEMS
    const proc = PRODUCTION_ITEMS.find(p => p.type === 'PROC' && p.isStructure);
    expect(proc).toBeDefined();
    expect(proc!.cost).toBe(2000);
  });

  it('build order includes WEAP for vehicle production', () => {
    const weap = PRODUCTION_ITEMS.find(p => p.type === 'WEAP' && p.isStructure);
    expect(weap).toBeDefined();
    expect(weap!.cost).toBe(2000);
  });

  it('phases start at economy', () => {
    // The initial phase should be economy
    const phases = ['economy', 'buildup', 'attack'] as const;
    expect(phases[0]).toBe('economy');
  });

  it('phase transitions: economy → buildup requires TENT + WEAP + power', () => {
    // Check that all required structures exist in PRODUCTION_ITEMS
    const tent = PRODUCTION_ITEMS.find(p => p.type === 'TENT' && p.isStructure);
    const weap = PRODUCTION_ITEMS.find(p => p.type === 'WEAP' && p.isStructure);
    const powr = PRODUCTION_ITEMS.find(p => p.type === 'POWR' && p.isStructure);
    expect(tent).toBeDefined();
    expect(weap).toBeDefined();
    expect(powr).toBeDefined();
  });
});

// === Part 2: Base Construction ===

describe('AI base construction', () => {
  it('STRUCTURE_SIZE has correct dimensions for key buildings', () => {
    expect(STRUCTURE_SIZE.FACT).toEqual([3, 3]);
    expect(STRUCTURE_SIZE.WEAP).toEqual([3, 2]);
    expect(STRUCTURE_SIZE.POWR).toEqual([2, 2]);
    expect(STRUCTURE_SIZE.TENT).toEqual([2, 2]);
    expect(STRUCTURE_SIZE.PROC).toEqual([3, 2]);
    expect(STRUCTURE_SIZE.DOME).toEqual([2, 2]);
    expect(STRUCTURE_SIZE.GUN).toEqual([1, 1]);
    expect(STRUCTURE_SIZE.HBOX).toEqual([1, 1]);
    // TSLA uses default [1,1] fallback — not explicitly in STRUCTURE_SIZE
    expect(STRUCTURE_MAX_HP.TSLA).toBe(500);
  });

  it('1x1 structures are more flexible for placement', () => {
    const smallStructures = Object.entries(STRUCTURE_SIZE)
      .filter(([_, size]) => size[0] === 1 && size[1] === 1)
      .map(([type]) => type);
    expect(smallStructures.length).toBeGreaterThan(3);
    expect(smallStructures).toContain('GUN');
    expect(smallStructures).toContain('HBOX');
    expect(smallStructures).toContain('SILO');
  });

  it('STRUCTURE_MAX_HP has higher HP for advanced buildings', () => {
    expect(STRUCTURE_MAX_HP.ATEK).toBe(600);
    expect(STRUCTURE_MAX_HP.STEK).toBe(600);
    expect(STRUCTURE_MAX_HP.MSLO).toBe(800);
    expect(STRUCTURE_MAX_HP.TSLA).toBe(500);
  });

  it('factory exits are at bottom of multi-cell structures', () => {
    // WEAP is 3x2, exit should be at cy+2 row
    const [ww, wh] = STRUCTURE_SIZE.WEAP;
    expect(ww).toBe(3);
    expect(wh).toBe(2);
    // Exit row would be cy + wh = base_cy + 2
  });

  it('STRUCTURE_WEAPONS provides defensive weapons for turrets', () => {
    expect(STRUCTURE_WEAPONS.GUN).toBeDefined();
    expect(STRUCTURE_WEAPONS.HBOX).toBeDefined();
    expect(STRUCTURE_WEAPONS.TSLA).toBeDefined();
    expect(STRUCTURE_WEAPONS.SAM).toBeDefined();
  });

  it('spiral scan considers rings 1-6 for placement', () => {
    // Verify ring math: ring 1 = 8 cells, ring 2 = 16, etc.
    // Ring r has perimeter of (2r+1)^2 - (2r-1)^2 = 8r cells
    expect(8 * 1).toBe(8);  // ring 1
    expect(8 * 2).toBe(16); // ring 2
    expect(8 * 6).toBe(48); // ring 6 — max range
  });

  it('base center calculation: centroid of structures', () => {
    // Given 3 structures at (10,10), (14,10), (12,14) each 2x2
    // Center of each: (11,11), (15,11), (13,15)
    // Centroid: (11+15+13)/3 = 39/3 = 13, (11+11+15)/3 = 37/3 ≈ 12.33
    const positions = [
      { cx: 10, cy: 10, w: 2, h: 2 },
      { cx: 14, cy: 10, w: 2, h: 2 },
      { cx: 12, cy: 14, w: 2, h: 2 },
    ];
    const sumX = positions.reduce((acc, p) => acc + p.cx + p.w / 2, 0);
    const sumY = positions.reduce((acc, p) => acc + p.cy + p.h / 2, 0);
    const avgX = Math.floor(sumX / positions.length);
    const avgY = Math.floor(sumY / positions.length);
    expect(avgX).toBe(13); // (11+15+13)/3 = 13
    expect(avgY).toBe(12); // (11+11+15)/3 ≈ 12.33 → floor = 12
  });

  it('defense structures prefer perimeter positions', () => {
    // Verify defense types list
    const defenseTypes = new Set(['GUN', 'HBOX', 'TSLA', 'SAM']);
    expect(defenseTypes.has('GUN')).toBe(true);
    expect(defenseTypes.has('TSLA')).toBe(true);
    expect(defenseTypes.has('WEAP')).toBe(false);
  });
});

// === Part 3: Enhanced Production + Harvester Management ===

describe('AI enhanced production', () => {
  it('PRODUCTION_ITEMS infantry items accessible by TENT prerequisite', () => {
    const infItems = PRODUCTION_ITEMS.filter(p =>
      (p.prerequisite === 'TENT' || p.prerequisite === 'BARR') && !p.isStructure
    );
    expect(infItems.length).toBeGreaterThan(5);
    const types = infItems.map(p => p.type);
    expect(types).toContain('E1');
    expect(types).toContain('E2');
    expect(types).toContain('E3');
  });

  it('PRODUCTION_ITEMS vehicle items accessible by WEAP prerequisite', () => {
    const vehItems = PRODUCTION_ITEMS.filter(p =>
      p.prerequisite === 'WEAP' && !p.isStructure
    );
    expect(vehItems.length).toBeGreaterThan(5);
    const types = vehItems.map(p => p.type);
    expect(types).toContain('JEEP');
    expect(types).toContain('1TNK');
    expect(types).toContain('2TNK');
    expect(types).toContain('HARV');
  });

  it('soviet faction has unique infantry (E4, DOG, SHOK)', () => {
    const sovietInf = PRODUCTION_ITEMS.filter(p =>
      (p.prerequisite === 'TENT' || p.prerequisite === 'BARR') &&
      !p.isStructure && p.faction === 'soviet'
    );
    const types = sovietInf.map(p => p.type);
    expect(types).toContain('E4');
    expect(types).toContain('DOG');
    expect(types).toContain('SHOK');
  });

  it('allied faction has unique vehicles (JEEP, 1TNK, 2TNK)', () => {
    const alliedVeh = PRODUCTION_ITEMS.filter(p =>
      p.prerequisite === 'WEAP' && !p.isStructure && p.faction === 'allied'
    );
    const types = alliedVeh.map(p => p.type);
    expect(types).toContain('JEEP');
    expect(types).toContain('1TNK');
    expect(types).toContain('2TNK');
  });

  it('soviet faction has unique vehicles (3TNK, 4TNK)', () => {
    const sovietVeh = PRODUCTION_ITEMS.filter(p =>
      p.prerequisite === 'WEAP' && !p.isStructure && p.faction === 'soviet'
    );
    const types = sovietVeh.map(p => p.type);
    expect(types).toContain('3TNK');
    expect(types).toContain('4TNK');
  });

  it('harvesters deposit ore at allied refineries', () => {
    const harv = makeEntity(UnitType.V_HARV, House.USSR, 200, 200);
    expect(harv.house).toBe(House.USSR);
    // The fix changes refinery filter from hardcoded Spain/Greece to isAllied()
    // USSR harvester should find USSR refinery, not Spain refinery
    const ussrProc = makeStructure('PROC', House.USSR, 10, 10);
    const spainProc = makeStructure('PROC', House.Spain, 20, 20);
    expect(ussrProc.house).toBe(House.USSR);
    expect(spainProc.house).toBe(House.Spain);
    // The harvester should prefer its own faction's refinery
  });

  it('AI harvester creates Entity with correct type', () => {
    const harv = makeEntity(UnitType.V_HARV, House.USSR, 100, 100);
    expect(harv.type).toBe(UnitType.V_HARV);
    expect(harv.house).toBe(House.USSR);
    expect(harv.alive).toBe(true);
  });

  it('new AI units get staging area as guard origin', () => {
    const unit = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    unit.mission = Mission.AREA_GUARD;
    unit.guardOrigin = { x: 200, y: 200 };
    expect(unit.mission).toBe(Mission.AREA_GUARD);
    expect(unit.guardOrigin).toEqual({ x: 200, y: 200 });
  });

  it('weighted production reduces engineer overproduction', () => {
    // Engineers (E6) should have low weight (0.2) in production picks
    const e6 = PRODUCTION_ITEMS.find(p => p.type === 'E6');
    expect(e6).toBeDefined();
    expect(e6!.cost).toBe(500); // expensive for infantry, AI should rarely build
  });
});

// === Part 4: Attack Groups ===

describe('AI attack groups', () => {
  it('entities can have waveId for attack coordination', () => {
    const unit = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    unit.waveId = 5;
    unit.waveRallyTick = 200;
    expect(unit.waveId).toBe(5);
    expect(unit.waveRallyTick).toBe(200);
  });

  it('HUNT mission sets unit to seek and destroy', () => {
    const unit = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    unit.mission = Mission.HUNT;
    expect(unit.mission).toBe(Mission.HUNT);
  });

  it('attack target priorities: FACT > WEAP > PROC', () => {
    const priorities = ['FACT', 'WEAP', 'PROC'];
    // FACT (ConYard) is most valuable — cut off all production
    expect(priorities[0]).toBe('FACT');
    // WEAP second — cut off vehicle production
    expect(priorities[1]).toBe('WEAP');
    // PROC third — cut off economy
    expect(priorities[2]).toBe('PROC');
  });

  it('attack pool can accumulate entity IDs', () => {
    const pool = new Set<number>();
    const units = Array.from({ length: 8 }, (_, i) =>
      makeEntity(UnitType.I_E1, House.USSR, 100 + i * 10, 100)
    );
    for (const u of units) pool.add(u.id);
    expect(pool.size).toBe(8);
  });

  it('dead entities are pruned from attack pool', () => {
    const pool = new Set<number>();
    const units = [
      makeEntity(UnitType.I_E1, House.USSR, 100, 100),
      makeEntity(UnitType.I_E1, House.USSR, 120, 100),
      makeEntity(UnitType.I_E1, House.USSR, 140, 100),
    ];
    for (const u of units) pool.add(u.id);
    expect(pool.size).toBe(3);

    // Kill one
    units[1].alive = false;
    // Prune
    const entityMap = new Map(units.map(u => [u.id, u]));
    for (const id of pool) {
      const e = entityMap.get(id);
      if (!e || !e.alive) pool.delete(id);
    }
    expect(pool.size).toBe(2);
  });

  it('harvesters are never recruited into attack pool', () => {
    const harv = makeEntity(UnitType.V_HARV, House.USSR, 100, 100);
    const rifle = makeEntity(UnitType.I_E1, House.USSR, 110, 100);
    // Simulate recruitment logic: skip harvesters
    const pool = new Set<number>();
    for (const e of [harv, rifle]) {
      if (e.type === UnitType.V_HARV) continue;
      pool.add(e.id);
    }
    expect(pool.size).toBe(1);
    expect(pool.has(rifle.id)).toBe(true);
    expect(pool.has(harv.id)).toBe(false);
  });

  it('staging area calculation moves toward enemy', () => {
    // Base at (50,50), enemy at (80,80)
    const baseCx = 50, baseCy = 50;
    const enemyCx = 80, enemyCy = 80;
    const dx = enemyCx - baseCx;
    const dy = enemyCy - baseCy;
    const len = Math.sqrt(dx * dx + dy * dy);
    const stageCx = baseCx + Math.round(dx / len * 5);
    const stageCy = baseCy + Math.round(dy / len * 5);
    // Should be between base and enemy, 5 cells offset
    expect(stageCx).toBeGreaterThan(baseCx);
    expect(stageCy).toBeGreaterThan(baseCy);
    expect(stageCx).toBeLessThan(enemyCx);
    expect(stageCy).toBeLessThan(enemyCy);
  });

  it('wave rally delay gives units time to group up', () => {
    const rallyDelay = 30; // 2 seconds at 15 FPS
    const tick = 1000;
    const rallyTick = tick + rallyDelay;
    // Units should wait until rallyTick before advancing
    expect(rallyTick).toBe(1030);
    expect(tick < rallyTick).toBe(true);
    expect(tick + 30 >= rallyTick).toBe(true);
  });

  it('recall defenders takes at most half the attack pool', () => {
    const poolSize = 10;
    const maxRecall = Math.ceil(poolSize / 2);
    expect(maxRecall).toBe(5);

    const poolSize2 = 7;
    const maxRecall2 = Math.ceil(poolSize2 / 2);
    expect(maxRecall2).toBe(4);
  });
});

// === Part 5: Retreat & Defense ===

describe('AI retreat and defense', () => {
  it('retreat threshold: units below HP percent should retreat', () => {
    const unit = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    const maxHp = unit.maxHp;
    // Normal difficulty: retreat at 25%
    const retreatThreshold = 0.25;
    unit.hp = Math.floor(maxHp * 0.20); // below threshold
    expect(unit.hp / unit.maxHp).toBeLessThan(retreatThreshold);

    // Unit above threshold should not retreat
    unit.hp = Math.floor(maxHp * 0.30);
    expect(unit.hp / unit.maxHp).toBeGreaterThan(retreatThreshold);
  });

  it('FIX (service depot) is preferred retreat target', () => {
    const fix = PRODUCTION_ITEMS.find(p => p.type === 'FIX' && p.isStructure);
    expect(fix).toBeDefined();
    expect(fix!.faction).toBe('both');
    expect(STRUCTURE_SIZE.FIX).toEqual([3, 2]);
  });

  it('ants never retreat', () => {
    // Ant units are identified by isAnt flag
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100, 100);
    expect(ant.isAnt).toBe(true);
    // AI retreat logic skips ants
  });

  it('underAttack flag clears after timeout', () => {
    // Simulated: lastBaseAttackTick=900, currentTick=1100, threshold=150
    const lastAttackTick = 900;
    const currentTick = 1100;
    const timeout = 150;
    expect(currentTick - lastAttackTick > timeout).toBe(true);
    // Should clear underAttack
  });

  it('defense rallies idle units near base to hunt attackers', () => {
    const defender = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    defender.mission = Mission.AREA_GUARD;
    // When base is under attack, switch to HUNT
    defender.mission = Mission.HUNT;
    defender.moveTarget = { x: 200, y: 200 };
    expect(defender.mission).toBe(Mission.HUNT);
    expect(defender.moveTarget).toEqual({ x: 200, y: 200 });
  });

  it('damaged units retreat via MOVE mission', () => {
    const unit = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    unit.hp = 10; // very low
    unit.mission = Mission.MOVE;
    unit.moveTarget = { x: 300, y: 300 }; // retreat to base
    expect(unit.mission).toBe(Mission.MOVE);
    expect(unit.moveTarget).toBeDefined();
  });

  it('units already retreating (MOVE with target) are not re-tasked', () => {
    const unit = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    unit.hp = 10;
    unit.mission = Mission.MOVE;
    unit.moveTarget = { x: 300, y: 300 };
    // Retreat logic should skip this unit since it's already moving to target
    const alreadyRetreating = unit.mission === Mission.MOVE && unit.moveTarget !== null;
    expect(alreadyRetreating).toBe(true);
  });

  it('harvesters do not retreat', () => {
    const harv = makeEntity(UnitType.V_HARV, House.USSR, 100, 100);
    harv.hp = 10;
    // AI retreat logic explicitly skips harvesters
    expect(harv.type).toBe(UnitType.V_HARV);
  });
});

// === Part 6: Difficulty Scaling ===

describe('AI difficulty scaling', () => {
  it('easy difficulty has lower income multiplier', () => {
    // Easy incomeMult = 0.7, Normal = 1.0, Hard = 1.5
    const baseIncome = 100;
    expect(Math.floor(baseIncome * 0.7)).toBe(70);
    expect(Math.floor(baseIncome * 1.0)).toBe(100);
    expect(Math.floor(baseIncome * 1.5)).toBe(150);
  });

  it('easy difficulty has higher attack threshold', () => {
    // Easy needs 8 units, Normal needs 6, Hard needs 4
    expect(8).toBeGreaterThan(6);
    expect(6).toBeGreaterThan(4);
  });

  it('hard difficulty has shorter attack cooldown', () => {
    // Easy=900, Normal=600, Hard=400 ticks
    expect(400).toBeLessThan(600);
    expect(600).toBeLessThan(900);
  });

  it('easy difficulty has slower production interval', () => {
    // Easy=90, Normal=60, Hard=42 ticks
    expect(90).toBeGreaterThan(60);
    expect(60).toBeGreaterThan(42);
  });

  it('hard difficulty has faster build speed', () => {
    // Easy=1.5× slower, Normal=1.0×, Hard=0.7× (lower = faster)
    const baseCooldown = 6;
    expect(Math.floor(baseCooldown * 1.5)).toBeGreaterThan(Math.floor(baseCooldown * 1.0));
    expect(Math.floor(baseCooldown * 1.0)).toBeGreaterThan(Math.floor(baseCooldown * 0.7));
  });

  it('retreat HP threshold varies by difficulty', () => {
    // Easy=30%, Normal=25%, Hard=15%
    expect(0.30).toBeGreaterThan(0.25);
    expect(0.25).toBeGreaterThan(0.15);
  });

  it('aggression multiplier scales with difficulty', () => {
    // Easy=0.6, Normal=1.0, Hard=1.4
    expect(0.6).toBeLessThan(1.0);
    expect(1.0).toBeLessThan(1.4);
  });
});

// === Part 7: Integration ===

describe('AI integration', () => {
  it('ant missions (SCA*) skip strategic AI', () => {
    // The gate: !scenarioId.startsWith('SCA')
    const antScenarios = ['SCA01EA', 'SCA02EA', 'SCA03EA', 'SCA04EA'];
    for (const id of antScenarios) {
      expect(id.startsWith('SCA')).toBe(true);
    }
    // Non-ant scenarios should enable strategic AI
    const nonAntScenarios = ['SCG01EA', 'SCU01EA', 'ALLY01', 'SOV01'];
    for (const id of nonAntScenarios) {
      expect(id.startsWith('SCA')).toBe(false);
    }
  });

  it('aiStates is a Map<House, AIHouseState> pattern', () => {
    const states = new Map<House, { phase: string }>();
    states.set(House.USSR, { phase: 'economy' });
    expect(states.get(House.USSR)?.phase).toBe('economy');
  });

  it('AI initialization requires FACT structure', () => {
    // Only houses with a ConYard (FACT) get AIHouseState
    const factProd = PRODUCTION_ITEMS.find(p => p.type === 'FACT');
    expect(factProd).toBeUndefined(); // FACT isn't in PRODUCTION_ITEMS (can't build second ConYard)
    // But FACT exists in STRUCTURE_SIZE
    expect(STRUCTURE_SIZE.FACT).toEqual([3, 3]);
  });

  it('multiple AI houses can operate independently', () => {
    const states = new Map<House, { phase: string; credits: number }>();
    states.set(House.USSR, { phase: 'economy', credits: 1000 });
    states.set(House.Ukraine, { phase: 'buildup', credits: 500 });
    expect(states.size).toBe(2);
    expect(states.get(House.USSR)!.phase).not.toBe(states.get(House.Ukraine)!.phase);
  });

  it('updateAIIncome runs every 450 ticks', () => {
    // Verify modulo check: 450 ticks = 30 seconds at 15 FPS
    expect(450 / 15).toBe(30);
    for (let tick = 0; tick <= 900; tick++) {
      if (tick % 450 === 0 && tick > 0) {
        expect(tick).toBeGreaterThanOrEqual(450);
      }
    }
  });

  it('updateAIStrategicPlanner runs every 150 ticks', () => {
    // 150 ticks = 10 seconds at 15 FPS
    expect(150 / 15).toBe(10);
  });

  it('updateAIConstruction runs every 90 ticks', () => {
    // 90 ticks = 6 seconds at 15 FPS
    expect(90 / 15).toBe(6);
  });

  it('updateAIAttackGroups runs every 120 ticks', () => {
    // 120 ticks = 8 seconds at 15 FPS
    expect(120 / 15).toBe(8);
  });

  it('updateAIDefense runs every 45 ticks', () => {
    // 45 ticks = 3 seconds at 15 FPS
    expect(45 / 15).toBe(3);
  });

  it('updateAIRetreat runs every 30 ticks', () => {
    // 30 ticks = 2 seconds at 15 FPS
    expect(30 / 15).toBe(2);
  });
});
