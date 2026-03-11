/**
 * AI strategic subsystem — construction, production, attack groups, defense,
 * retreat, repair, sell, harvesters, autocreate teams, income, base rebuild,
 * and unit/structure spawning for non-player houses.
 * Extracted from Game class (index.ts) to isolate AI opponent logic.
 */

import {
  type WorldPos, type UnitStats, type WeaponStats, type ProductionItem,
  CELL_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC,
  House, Mission, UnitType,
  UNIT_STATS, HOUSE_FACTION,
  type Faction,
} from './types';
import { Entity } from './entity';
import {
  type MapStructure, type TeamType,
  houseIdToHouse, STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP,
  applyScenarioOverrides,
} from './scenario';
import { type GameMap, Terrain } from './map';

// ── Re-export the types that index.ts already defines locally ──────────────

/** AI house strategic state — drives decision-making for non-player houses */
export interface AIHouseState {
  house: House;
  phase: 'economy' | 'buildup' | 'attack';
  productionEnabled: boolean;
  buildQueue: string[];
  lastBuildTick: number;
  buildCooldown: number;
  attackPool: Set<number>;
  attackThreshold: number;
  lastAttackTick: number;
  attackCooldownTicks: number;
  harvesterCount: number;
  refineryCount: number;
  lastBaseAttackTick: number;
  underAttack: boolean;
  incomeMult: number;
  buildSpeedMult: number;
  aggressionMult: number;
  designatedEnemy: House | null;
  preferredTarget: number | null;
  iq: number;
  techLevel: number;
  maxUnit: number;
  maxInfantry: number;
  maxBuilding: number;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/** AI difficulty modifiers — scale economy, build speed, and aggression */
export const AI_DIFFICULTY_MODS: Record<Difficulty, {
  incomeMult: number;
  buildSpeedMult: number;
  attackThreshold: number;
  attackCooldown: number;
  productionInterval: number;
  aggressionMult: number;
  retreatHpPercent: number;
}> = {
  easy:   { incomeMult: 0.7, buildSpeedMult: 1.5, attackThreshold: 8,  attackCooldown: 900,  productionInterval: 90, aggressionMult: 0.6, retreatHpPercent: 0.30 },
  normal: { incomeMult: 1.0, buildSpeedMult: 1.0, attackThreshold: 6,  attackCooldown: 600,  productionInterval: 60, aggressionMult: 1.0, retreatHpPercent: 0.25 },
  hard:   { incomeMult: 1.5, buildSpeedMult: 0.7, attackThreshold: 4,  attackCooldown: 400,  productionInterval: 42, aggressionMult: 1.4, retreatHpPercent: 0.15 },
};

/** Structure type -> sprite image name mapping (shared by base rebuild and AI construction) */
export const STRUCTURE_IMAGES: Record<string, string> = {
  FACT: 'fact', POWR: 'powr', APWR: 'apwr', BARR: 'barr', TENT: 'tent',
  WEAP: 'weap', PROC: 'proc', SILO: 'silo', DOME: 'dome', FIX: 'fix',
  GUN: 'gun', SAM: 'sam', HBOX: 'hbox', TSLA: 'tsla', AGUN: 'agun',
  GAP: 'gap', PBOX: 'pbox', HPAD: 'hpad', AFLD: 'afld',
  ATEK: 'atek', STEK: 'stek', IRON: 'iron', PDOX: 'pdox', KENN: 'kenn',
  QUEE: 'quee', LAR1: 'lar1', LAR2: 'lar2',
};

/** Difficulty modifiers for queen spawn rate and ant composition */
export const DIFFICULTY_MODS: Record<Difficulty, { spawnInterval: number; maxAnts: number; fireAntChance: number; waveSize: number }> = {
  easy:   { spawnInterval: 45, maxAnts: 15, fireAntChance: 0.15, waveSize: 0.7 },
  normal: { spawnInterval: 30, maxAnts: 20, fireAntChance: 0.33, waveSize: 1.0 },
  hard:   { spawnInterval: 20, maxAnts: 28, fireAntChance: 0.50, waveSize: 1.3 },
};

/** C++ RepairStep=5, RepairPercent=0.20 (from rules.cpp:228-229) */
const REPAIR_STEP = 5;
const REPAIR_PERCENT = 0.20;
const CONDITION_RED = 0.25;

// worldDist import from types is cells-based; we need the same helper
import { worldDist } from './types';

// ── Context interface ─────────────────────────────────────────────────────

export interface AIContext {
  // Core game state
  entities: Entity[];
  entityById: Map<number, Entity>;
  structures: MapStructure[];
  map: GameMap;
  tick: number;
  playerHouse: House;
  scenarioId: string;
  difficulty: Difficulty;

  // AI state
  aiStates: Map<House, AIHouseState>;
  houseCredits: Map<House, number>;
  houseIQs: Map<House, number>;
  houseTechLevels: Map<House, number>;
  houseMaxUnits: Map<House, number>;
  houseMaxInfantry: Map<House, number>;
  houseMaxBuildings: Map<House, number>;

  // Base rebuild state
  baseBlueprint: Array<{ type: string; cell: number; house: House }>;
  baseRebuildQueue: Array<{ type: string; cell: number; house: House }>;
  baseRebuildCooldown: number;

  // Production data
  scenarioProductionItems: ProductionItem[];
  scenarioUnitStats: Record<string, UnitStats>;
  scenarioWeaponStats: Record<string, WeaponStats>;

  // Attack coordination
  nextWaveId: number;

  // Autocreate
  autocreateEnabled: boolean;
  teamTypes: TeamType[];
  destroyedTeams: Set<number>;
  waypoints: Map<number, { cx: number; cy: number }>;
  houseEdges: Map<House, string>;

  // Effects (for structure footprint clear)
  effects: Array<{ type: string; x: number; y: number; frame: number; maxFrames: number; size: number; sprite?: string; spriteStart?: number; [k: string]: unknown }>;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  isPlayerControlled(e: Entity): boolean;
  clearStructureFootprint(s: MapStructure): void;
}

// ── Pure helper functions ────────────────────────────────────────────────

/** Count alive structures of a given type for a house */
export function aiCountStructure(ctx: AIContext, house: House, type: string): number {
  let count = 0;
  for (const s of ctx.structures) {
    if (s.alive && s.house === house && s.type === type) count++;
  }
  return count;
}

/** Calculate power produced by a house's structures */
export function aiPowerProduced(ctx: AIContext, house: House): number {
  let power = 0;
  for (const s of ctx.structures) {
    if (!s.alive || s.house !== house) continue;
    if (s.type === 'POWR') power += 100;
    else if (s.type === 'APWR') power += 200;
  }
  return power;
}

/** Calculate power consumed by a house's structures */
export function aiPowerConsumed(ctx: AIContext, house: House): number {
  let power = 0;
  for (const s of ctx.structures) {
    if (!s.alive || s.house !== house) continue;
    switch (s.type) {
      case 'TENT': case 'BARR': power += 20; break;
      case 'WEAP': power += 30; break;
      case 'PROC': power += 30; break;
      case 'DOME': power += 40; break;
      case 'GUN': power += 40; break;
      case 'PBOX': case 'HBOX': power += 15; break;
      case 'TSLA': power += 150; break;
      case 'SAM': power += 20; break;
      case 'AGUN': power += 50; break;
      case 'ATEK': power += 200; break;
      case 'STEK': power += 100; break;
      case 'HPAD': power += 10; break;
      case 'AFLD': power += 30; break;
      case 'GAP': power += 60; break;
      case 'FIX': power += 30; break;
      case 'FTUR': power += 20; break;
      case 'SILO': power += 10; break;
      case 'KENN': power += 10; break;
      case 'SYRD': case 'SPEN': power += 30; break;
      case 'IRON': case 'PDOX': power += 200; break;
      case 'MSLO': power += 100; break;
    }
  }
  return power;
}

/** Check if AI house has a prerequisite structure */
export function aiHasPrereq(ctx: AIContext, house: House, prereq: string): boolean {
  if (prereq === 'TENT') {
    return ctx.structures.some(s => s.alive && s.house === house && (s.type === 'TENT' || s.type === 'BARR'));
  }
  return ctx.structures.some(s => s.alive && s.house === house && s.type === prereq);
}

/** Get centroid of alive structures for an AI house */
export function aiGetBaseCenter(ctx: AIContext, house: House): { cx: number; cy: number } | null {
  let sumX = 0, sumY = 0, count = 0;
  for (const s of ctx.structures) {
    if (!s.alive || s.house !== house) continue;
    const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
    sumX += s.cx + w / 2;
    sumY += s.cy + h / 2;
    count++;
  }
  if (count === 0) return null;
  return { cx: Math.floor(sumX / count), cy: Math.floor(sumY / count) };
}

/** Check if a cell is a factory exit zone (below WEAP/TENT/BARR/PROC) */
export function aiIsFactoryExit(ctx: AIContext, cx: number, cy: number, house: House): boolean {
  const exitTypes = ['WEAP', 'TENT', 'BARR', 'PROC'];
  for (const s of ctx.structures) {
    if (!s.alive || s.house !== house || !exitTypes.includes(s.type)) continue;
    const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
    if (cy === s.cy + h && cx >= s.cx && cx < s.cx + w) return true;
  }
  return false;
}

/** Get staging area for AI house -- base center offset toward nearest enemy */
export function aiStagingArea(ctx: AIContext, house: House): WorldPos | null {
  const center = aiGetBaseCenter(ctx, house);
  if (!center) return null;

  let nearestDist = Infinity;
  let enemyCx = center.cx;
  let enemyCy = center.cy;
  for (const s of ctx.structures) {
    if (!s.alive || ctx.isAllied(s.house, house)) continue;
    const dx = s.cx - center.cx;
    const dy = s.cy - center.cy;
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) {
      nearestDist = dist;
      enemyCx = s.cx;
      enemyCy = s.cy;
    }
  }

  const dx = enemyCx - center.cx;
  const dy = enemyCy - center.cy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const stageCx = center.cx + Math.round(dx / len * 5);
  const stageCy = center.cy + Math.round(dy / len * 5);

  return {
    x: stageCx * CELL_SIZE + CELL_SIZE / 2,
    y: stageCy * CELL_SIZE + CELL_SIZE / 2,
  };
}

// ── Mutating functions ──────────────────────────────────────────────────

/** Create initial AIHouseState for a house, applying difficulty modifiers */
export function createAIHouseState(ctx: AIContext, house: House): AIHouseState {
  const mods = AI_DIFFICULTY_MODS[ctx.difficulty] ?? AI_DIFFICULTY_MODS.normal;
  return {
    house,
    phase: 'economy',
    productionEnabled: false,
    buildQueue: [],
    lastBuildTick: 0,
    buildCooldown: 0,
    attackPool: new Set(),
    attackThreshold: mods.attackThreshold,
    lastAttackTick: 0,
    attackCooldownTicks: mods.attackCooldown,
    harvesterCount: 0,
    refineryCount: 0,
    lastBaseAttackTick: 0,
    underAttack: false,
    incomeMult: mods.incomeMult,
    buildSpeedMult: mods.buildSpeedMult,
    aggressionMult: mods.aggressionMult,
    designatedEnemy: null,
    preferredTarget: null,
    iq: ctx.houseIQs.get(house) ?? 3,
    techLevel: ctx.houseTechLevels.get(house) ?? 10,
    maxUnit: ctx.houseMaxUnits.get(house) ?? -1,
    maxInfantry: ctx.houseMaxInfantry.get(house) ?? -1,
    maxBuilding: ctx.houseMaxBuildings.get(house) ?? -1,
  };
}

/** Generate priority-ordered build queue for AI house */
export function getAIBuildOrder(ctx: AIContext, house: House, _state: AIHouseState): string[] {
  const queue: string[] = [];
  const faction = HOUSE_FACTION[house] ?? 'both';
  const produced = aiPowerProduced(ctx, house);
  const consumed = aiPowerConsumed(ctx, house);
  const credits = ctx.houseCredits.get(house) ?? 0;

  // 1. POWR if power deficit
  if (consumed >= produced) {
    queue.push('POWR');
  }
  // 2. TENT/BARR if none (need infantry production)
  if (!aiHasPrereq(ctx, house, 'TENT')) {
    queue.push('TENT');
  }
  // 3. PROC if < 2 refineries (need economy)
  if (aiCountStructure(ctx, house, 'PROC') < 2) {
    queue.push('PROC');
  }
  // 4. WEAP if none (need vehicle production)
  if (aiCountStructure(ctx, house, 'WEAP') === 0) {
    queue.push('WEAP');
  }
  // 5. POWR if power margin < 100 (preemptive)
  if (produced - consumed < 100 && !queue.includes('POWR')) {
    queue.push('POWR');
  }
  // 6. DOME if none and credits > 1000 (tech unlock)
  if (aiCountStructure(ctx, house, 'DOME') === 0 && credits > 1000) {
    queue.push('DOME');
  }
  // 7. Defense structures (faction-dependent)
  const defType = faction === 'soviet' ? 'TSLA' : 'GUN';
  const defType2 = faction === 'soviet' ? 'TSLA' : 'HBOX';
  const totalDef = aiCountStructure(ctx, house, defType) + aiCountStructure(ctx, house, defType2);
  if (totalDef < 2) {
    queue.push(defType);
  }
  // 8. Tech center if none and has DOME
  if (aiHasPrereq(ctx, house, 'DOME')) {
    const techType = faction === 'soviet' ? 'STEK' : 'ATEK';
    if (aiCountStructure(ctx, house, techType) === 0) {
      queue.push(techType);
    }
  }
  // 9. Air production if has tech center
  const hasTech = faction === 'soviet'
    ? aiHasPrereq(ctx, house, 'STEK')
    : aiHasPrereq(ctx, house, 'ATEK');
  if (hasTech) {
    const airType = faction === 'soviet' ? 'AFLD' : 'HPAD';
    if (aiCountStructure(ctx, house, airType) === 0) {
      queue.push(airType);
    }
  }
  // 10. Extra PROC if harvester count > refinery count
  if (_state.harvesterCount > _state.refineryCount) {
    queue.push('PROC');
  }

  return queue;
}

/** Spiral scan outward from base center to find valid placement for a structure */
export function aiPlaceStructure(ctx: AIContext, house: House, type: string): { cx: number; cy: number } | null {
  const center = aiGetBaseCenter(ctx, house);
  if (!center) return null;

  const [fw, fh] = STRUCTURE_SIZE[type] ?? [1, 1];

  for (let ring = 1; ring <= 6; ring++) {
    const candidates: { cx: number; cy: number; dist: number }[] = [];

    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;

        const cx = center.cx + dx;
        const cy = center.cy + dy;

        if (cx < ctx.map.boundsX || cy < ctx.map.boundsY ||
            cx + fw > ctx.map.boundsX + ctx.map.boundsW ||
            cy + fh > ctx.map.boundsY + ctx.map.boundsH) continue;

        let valid = true;
        for (let fy = 0; fy < fh && valid; fy++) {
          for (let fx = 0; fx < fw && valid; fx++) {
            const t = ctx.map.getTerrain(cx + fx, cy + fy);
            if (t === Terrain.WALL || t === Terrain.WATER) valid = false;
            for (const s of ctx.structures) {
              if (!s.alive) continue;
              const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
              if (cx + fx >= s.cx && cx + fx < s.cx + sw &&
                  cy + fy >= s.cy && cy + fy < s.cy + sh) {
                valid = false;
                break;
              }
            }
          }
        }
        if (!valid) continue;

        let blocksExit = false;
        for (let fy = 0; fy < fh && !blocksExit; fy++) {
          for (let fx = 0; fx < fw && !blocksExit; fx++) {
            if (aiIsFactoryExit(ctx, cx + fx, cy + fy, house)) blocksExit = true;
          }
        }
        if (blocksExit) continue;

        // BP3: Check adjacency to existing house structure
        let adjacent = false;
        for (const s of ctx.structures) {
          if (!s.alive || s.house !== house) continue;
          const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
          const scx = s.cx + sw / 2;
          const scy = s.cy + sh / 2;
          const pcx = cx + fw / 2;
          const pcy = cy + fh / 2;
          if (Math.abs(pcx - scx) <= 2 && Math.abs(pcy - scy) <= 2) {
            adjacent = true;
            break;
          }
        }
        if (!adjacent) continue;

        const dist = dx * dx + dy * dy;
        candidates.push({ cx, cy, dist });
      }
    }

    if (candidates.length > 0) {
      const isDefense = type === 'GUN' || type === 'HBOX' || type === 'TSLA' || type === 'SAM';
      candidates.sort((a, b) => isDefense ? b.dist - a.dist : a.dist - b.dist);
      return { cx: candidates[0].cx, cy: candidates[0].cy };
    }
  }
  return null;
}

/** Spawn an AI structure: look up image/hp, push to structures[], mark footprint impassable */
export function spawnAIStructure(ctx: AIContext, type: string, house: House, cx: number, cy: number): void {
  const image = STRUCTURE_IMAGES[type] ?? type.toLowerCase();
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;

  ctx.structures.push({
    type,
    image,
    house,
    cx,
    cy,
    hp: maxHp,
    maxHp,
    alive: true,
    rubble: false,
    weapon: STRUCTURE_WEAPONS[type],
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    buildProgress: 0,
  });

  const [fw, fh] = STRUCTURE_SIZE[type] ?? [1, 1];
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      ctx.map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
    }
  }
}

/** Spawn an AI unit from a factory: find factory, calculate spawn pos, create entity */
export function spawnAIUnit(
  ctx: AIContext,
  house: House,
  unitType: UnitType,
  factoryType: string,
  mission: Mission = Mission.GUARD,
  guardOrigin?: WorldPos,
): Entity | null {
  const isInfantry = factoryType === 'TENT' || factoryType === 'BARR';
  const factory = ctx.structures.find(s =>
    s.alive && s.house === house && (isInfantry ? (s.type === 'TENT' || s.type === 'BARR') : s.type === factoryType)
  );
  if (!factory) return null;

  let sx: number;
  let sy: number;
  if (isInfantry) {
    sx = factory.cx * CELL_SIZE + CELL_SIZE + (Math.random() - 0.5) * 24;
    sy = factory.cy * CELL_SIZE + CELL_SIZE * 2;
  } else {
    sx = factory.cx * CELL_SIZE + CELL_SIZE * 2;
    sy = factory.cy * CELL_SIZE + CELL_SIZE * 2 + CELL_SIZE;
  }

  const unit = new Entity(unitType, house, sx, sy);
  unit.mission = mission;
  if (guardOrigin) {
    unit.guardOrigin = guardOrigin;
  }
  ctx.entities.push(unit);
  ctx.entityById.set(unit.id, unit);
  return unit;
}

/** AI base rebuild -- compare alive structures against blueprint, rebuild missing ones */
export function updateBaseRebuild(ctx: AIContext): void {
  if (ctx.baseBlueprint.length === 0) return;

  let anyIqOk = false;
  for (const [, st] of ctx.aiStates) { if (st.iq >= 2) { anyIqOk = true; break; } }
  if (!anyIqOk) return;

  if (ctx.baseRebuildCooldown > 0) {
    ctx.baseRebuildCooldown--;
    return;
  }

  if (ctx.tick % 75 !== 0) return;

  const aiHousesWithFact = new Set<House>();
  for (const s of ctx.structures) {
    if (s.alive && s.type === 'FACT' && !ctx.isAllied(s.house, ctx.playerHouse)) {
      aiHousesWithFact.add(s.house);
    }
  }
  if (aiHousesWithFact.size === 0) return;

  const aliveSet = new Set<string>();
  for (const s of ctx.structures) {
    if (s.alive) aliveSet.add(`${s.type}:${s.cx},${s.cy}`);
  }

  if (ctx.baseRebuildQueue.length === 0) {
    for (const bp of ctx.baseBlueprint) {
      if (!aiHousesWithFact.has(bp.house)) continue;
      const pos = { cx: bp.cell % MAP_CELLS, cy: Math.floor(bp.cell / MAP_CELLS) };
      const key = `${bp.type}:${pos.cx},${pos.cy}`;
      if (!aliveSet.has(key)) {
        const [fw, fh] = STRUCTURE_SIZE[bp.type] ?? [1, 1];
        let blocked = false;
        for (let dy = 0; dy < fh && !blocked; dy++) {
          for (let dx = 0; dx < fw && !blocked; dx++) {
            for (const s of ctx.structures) {
              if (s.alive && s.cx === pos.cx + dx && s.cy === pos.cy + dy) {
                blocked = true;
                break;
              }
            }
          }
        }
        if (!blocked) {
          ctx.baseRebuildQueue.push(bp);
        }
      }
    }
    const REBUILD_PRIORITY: Record<string, number> = {
      'POWR': 0, 'APWR': 0,
      'PROC': 1,
      'WEAP': 2, 'TENT': 2, 'BARR': 2,
      'GUN': 3, 'TSLA': 3, 'SAM': 3, 'AGUN': 3, 'PBOX': 3, 'HBOX': 3, 'FTUR': 3,
      'DOME': 4, 'FIX': 4, 'SILO': 4,
      'ATEK': 5, 'STEK': 5, 'HPAD': 5, 'AFLD': 5,
    };
    ctx.baseRebuildQueue.sort((a, b) =>
      (REBUILD_PRIORITY[a.type] ?? 6) - (REBUILD_PRIORITY[b.type] ?? 6)
    );
  }

  if (ctx.baseRebuildQueue.length > 0) {
    const bp = ctx.baseRebuildQueue.shift()!;
    if (!aiHousesWithFact.has(bp.house)) return;

    const aiState = ctx.aiStates.get(bp.house);
    if (aiState && aiState.iq < 2) return;

    const prodItem = ctx.scenarioProductionItems.find(p => p.type === bp.type && p.isStructure);
    if (prodItem) {
      const credits = ctx.houseCredits.get(bp.house) ?? 0;
      if (credits < prodItem.cost) return;
      ctx.houseCredits.set(bp.house, credits - prodItem.cost);
    }

    const pos = { cx: bp.cell % MAP_CELLS, cy: Math.floor(bp.cell / MAP_CELLS) };
    spawnAIStructure(ctx, bp.type, bp.house, pos.cx, pos.cy);

    ctx.baseRebuildCooldown = GAME_TICKS_PER_SEC * 30;
  }
}

/** AI strategic planner -- phase transitions every 150 ticks (~10s) */
export function updateAIStrategicPlanner(ctx: AIContext): void {
  if (ctx.tick % 150 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (state.iq === 0) continue;
    state.harvesterCount = 0;
    state.refineryCount = 0;
    for (const e of ctx.entities) {
      if (e.alive && e.house === house && (e.type === UnitType.V_HARV)) {
        state.harvesterCount++;
      }
    }
    for (const s of ctx.structures) {
      if (s.alive && s.house === house && s.type === 'PROC') {
        state.refineryCount++;
      }
    }

    if (state.underAttack && ctx.tick - state.lastBaseAttackTick > 150) {
      state.underAttack = false;
    }

    switch (state.phase) {
      case 'economy': {
        const hasBarracks = aiHasPrereq(ctx, house, 'TENT');
        const hasWeap = aiCountStructure(ctx, house, 'WEAP') > 0;
        const hasPower = aiCountStructure(ctx, house, 'POWR') + aiCountStructure(ctx, house, 'APWR') >= 2;
        if (hasBarracks && hasWeap && hasPower) {
          state.phase = 'buildup';
        }
        break;
      }
      case 'buildup': {
        if (state.attackPool.size >= state.attackThreshold) {
          state.phase = 'attack';
        }
        break;
      }
      case 'attack': {
        if (state.attackPool.size === 0) {
          state.phase = 'buildup';
        }
        break;
      }
    }
  }
}

/** AI base construction -- build new structures from build queue */
export function updateAIConstruction(ctx: AIContext): void {
  if (ctx.tick % 90 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (!state.productionEnabled) continue;
    if (state.iq < 1) continue;
    if (aiCountStructure(ctx, house, 'FACT') === 0) continue;

    if (state.maxBuilding >= 0) {
      let buildingCount = 0;
      for (const s of ctx.structures) {
        if (s.alive && s.house === house) buildingCount++;
      }
      if (buildingCount >= state.maxBuilding) continue;
    }

    if (state.buildCooldown > 0) {
      state.buildCooldown--;
      continue;
    }

    const credits = ctx.houseCredits.get(house) ?? 0;
    if (credits <= 0) continue;

    if (state.buildQueue.length === 0) {
      state.buildQueue = getAIBuildOrder(ctx, house, state);
    }
    if (state.buildQueue.length === 0) continue;

    const buildType = state.buildQueue[0];
    const prodItem = ctx.scenarioProductionItems.find(p => p.type === buildType && p.isStructure);
    if (!prodItem) {
      state.buildQueue.shift();
      continue;
    }

    if (credits < prodItem.cost) continue;

    const pos = aiPlaceStructure(ctx, house, buildType);
    if (!pos) {
      state.buildQueue.shift();
      continue;
    }

    ctx.houseCredits.set(house, credits - prodItem.cost);
    state.buildQueue.shift();

    spawnAIStructure(ctx, buildType, house, pos.cx, pos.cy);

    const mods = AI_DIFFICULTY_MODS[ctx.difficulty] ?? AI_DIFFICULTY_MODS.normal;
    state.buildCooldown = Math.floor(6 * mods.buildSpeedMult);
    state.lastBuildTick = ctx.tick;
  }
}

/** Weighted production pick based on composition targets */
export function getAIProductionPick(ctx: AIContext, house: House, category: 'infantry' | 'vehicle'): ProductionItem | null {
  const faction = HOUSE_FACTION[house] ?? 'both';
  const prereq = category === 'infantry' ? 'TENT' : 'WEAP';

  const aiTechLevel = ctx.aiStates.get(house)?.techLevel ?? 10;
  const items = ctx.scenarioProductionItems.filter(p =>
    (p.prerequisite === prereq || (category === 'infantry' && p.prerequisite === 'BARR')) &&
    !p.isStructure &&
    (p.faction === 'both' || p.faction === faction) &&
    (p.techLevel === undefined || (p.techLevel >= 0 && p.techLevel <= aiTechLevel)) &&
    (!p.techPrereq || aiHasPrereq(ctx, house, p.techPrereq))
  );

  if (items.length === 0) return null;

  let antiArmor = 0, infantry = 0, total = 0;
  for (const e of ctx.entities) {
    if (!e.alive || e.house !== house || e.isAnt) continue;
    total++;
    if (e.type === UnitType.I_E3 || e.type === UnitType.V_2TNK ||
        e.type === UnitType.V_3TNK || e.type === UnitType.V_4TNK ||
        e.type === UnitType.V_1TNK) {
      antiArmor++;
    }
    if (e.type === UnitType.I_E1 || e.type === UnitType.I_E2) {
      infantry++;
    }
  }

  const antiArmorRatio = total > 0 ? antiArmor / total : 0;
  const infantryRatio = total > 0 ? infantry / total : 0;

  const weighted: { item: ProductionItem; weight: number }[] = items.map(item => {
    let weight = 1;
    const isAntiArmor = item.type === 'E3' || item.type === '2TNK' || item.type === '3TNK' ||
                        item.type === '4TNK' || item.type === '1TNK';
    const isInfantry = item.type === 'E1' || item.type === 'E2';

    if (isAntiArmor && antiArmorRatio < 0.4) weight = 3;
    if (isInfantry && infantryRatio < 0.3) weight = 2;
    if (item.type === 'E6') weight = 0.2;
    if (item.type === 'MEDI') weight = 0.3;
    if (item.type === 'HARV') weight = 0.1;

    return { item, weight };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) return items[0];
  let roll = Math.random() * totalWeight;
  for (const w of weighted) {
    roll -= w.weight;
    if (roll <= 0) return w.item;
  }
  return items[0];
}

/** Update AI harvester counts and force-produce if needed */
export function updateAIHarvesters(ctx: AIContext): void {
  if (ctx.tick % 60 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    state.harvesterCount = 0;
    for (const e of ctx.entities) {
      if (e.alive && e.house === house && e.type === UnitType.V_HARV) {
        state.harvesterCount++;
      }
    }
    state.refineryCount = aiCountStructure(ctx, house, 'PROC');

    if (!state.productionEnabled) continue;

    if (state.harvesterCount === 0 && state.refineryCount > 0 &&
        aiCountStructure(ctx, house, 'WEAP') > 0) {
      const credits = ctx.houseCredits.get(house) ?? 0;
      const harvItem = ctx.scenarioProductionItems.find(p => p.type === 'HARV');
      if (harvItem && credits >= harvItem.cost) {
        const unit = spawnAIUnit(ctx, house, UnitType.V_HARV, 'WEAP');
        if (unit) {
          ctx.houseCredits.set(house, credits - harvItem.cost);
        }
      }
    }
  }
}

/** AI attack group management -- accumulate pool and launch coordinated attacks */
export function updateAIAttackGroups(ctx: AIContext): void {
  if (ctx.tick % 120 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (!state.productionEnabled) continue;
    if (state.iq < 2) continue;
    if (state.phase !== 'buildup' && state.phase !== 'attack') continue;

    const staging = aiStagingArea(ctx, house);
    if (!staging) continue;

    for (const e of ctx.entities) {
      if (!e.alive || e.house !== house) continue;
      if (e.type === UnitType.V_HARV) continue;
      if (e.mission !== Mission.AREA_GUARD && e.mission !== Mission.GUARD) continue;
      if (state.attackPool.has(e.id)) continue;
      const dist = worldDist(e.pos, staging);
      if (dist < 8) {
        state.attackPool.add(e.id);
      }
    }

    for (const id of state.attackPool) {
      const e = ctx.entityById.get(id);
      if (!e || !e.alive) state.attackPool.delete(id);
    }

    const effectiveThreshold = Math.max(2, Math.floor(state.attackThreshold / state.aggressionMult));
    const effectiveCooldown = Math.floor(state.attackCooldownTicks / state.aggressionMult);
    if (state.attackPool.size >= effectiveThreshold &&
        ctx.tick - state.lastAttackTick > effectiveCooldown) {
      launchAIAttack(ctx, house, state);
    }
  }
}

/** Pick best attack target for AI house */
export function aiPickAttackTarget(ctx: AIContext, house: House): WorldPos | null {
  const ptState = ctx.aiStates.get(house);
  if (ptState?.preferredTarget != null) {
    const STRUCT_TYPES: Record<number, string> = {
      0: 'ATEK', 1: 'IRON', 2: 'WEAP', 3: 'PDOX', 4: 'PBOX', 5: 'HBOX',
      6: 'DOME', 7: 'GAP', 8: 'GUN', 9: 'AGUN', 10: 'FTUR', 11: 'FACT',
      12: 'PROC', 13: 'SILO', 14: 'HPAD', 15: 'SAM', 16: 'AFLD', 17: 'POWR',
      18: 'APWR', 19: 'STEK', 20: 'HOSP', 21: 'BARR', 22: 'TENT', 23: 'KENN',
      24: 'FIX', 25: 'BIO', 26: 'MISS', 27: 'SYRD', 28: 'SPEN', 29: 'MSLO',
      30: 'FCOM', 31: 'TSLA', 32: 'QUEE', 33: 'LAR1', 34: 'LAR2',
    };
    const prefType = STRUCT_TYPES[ptState.preferredTarget];
    if (prefType) {
      for (const s of ctx.structures) {
        if (!s.alive || ctx.isAllied(s.house, house)) continue;
        if (s.type === prefType) {
          const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
          return { x: (s.cx + w / 2) * CELL_SIZE, y: (s.cy + h / 2) * CELL_SIZE };
        }
      }
    }
  }

  const priorities = ['FACT', 'WEAP', 'PROC'];
  for (const type of priorities) {
    for (const s of ctx.structures) {
      if (!s.alive || ctx.isAllied(s.house, house)) continue;
      if (s.type === type) {
        const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
        return {
          x: (s.cx + w / 2) * CELL_SIZE,
          y: (s.cy + h / 2) * CELL_SIZE,
        };
      }
    }
  }

  const center = aiGetBaseCenter(ctx, house);
  if (!center) return null;

  let bestDist = Infinity;
  let bestPos: WorldPos | null = null;

  for (const s of ctx.structures) {
    if (!s.alive || ctx.isAllied(s.house, house)) continue;
    const dx = s.cx - center.cx;
    const dy = s.cy - center.cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
      bestPos = { x: (s.cx + w / 2) * CELL_SIZE, y: (s.cy + h / 2) * CELL_SIZE };
    }
  }
  if (bestPos) return bestPos;

  for (const e of ctx.entities) {
    if (!e.alive || ctx.isAllied(e.house, house)) continue;
    const dx = e.pos.x / CELL_SIZE - center.cx;
    const dy = e.pos.y / CELL_SIZE - center.cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestPos = { x: e.pos.x, y: e.pos.y };
    }
  }

  return bestPos;
}

/** Launch a coordinated AI attack */
export function launchAIAttack(ctx: AIContext, house: House, state: AIHouseState): void {
  const target = aiPickAttackTarget(ctx, house);
  if (!target) return;

  const waveId = ctx.nextWaveId++;
  const rallyTick = ctx.tick + 30;

  for (const id of state.attackPool) {
    const e = ctx.entityById.get(id);
    if (!e || !e.alive) continue;
    e.mission = Mission.HUNT;
    e.moveTarget = target;
    e.waveId = waveId;
    e.waveRallyTick = rallyTick;
  }

  state.lastAttackTick = ctx.tick;
  state.attackPool.clear();
}

/** Recall up to half the attack pool as defenders when base is under attack */
export function aiRecallDefenders(ctx: AIContext, house: House, state: AIHouseState): void {
  const center = aiGetBaseCenter(ctx, house);
  if (!center) return;

  const centerPos = { x: center.cx * CELL_SIZE + CELL_SIZE / 2, y: center.cy * CELL_SIZE + CELL_SIZE / 2 };
  let recalled = 0;
  const maxRecall = Math.ceil(state.attackPool.size / 2);

  for (const id of state.attackPool) {
    if (recalled >= maxRecall) break;
    const e = ctx.entityById.get(id);
    if (!e || !e.alive) continue;
    e.mission = Mission.HUNT;
    e.moveTarget = centerPos;
    state.attackPool.delete(id);
    recalled++;
  }
}

/** AI defense -- detect base attacks and rally defenders */
export function updateAIDefense(ctx: AIContext): void {
  if (ctx.tick % 45 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (!state.underAttack) continue;
    if (state.iq < 2) continue;

    if (state.attackPool.size > 0) {
      aiRecallDefenders(ctx, house, state);
    }

    const center = aiGetBaseCenter(ctx, house);
    if (!center) continue;
    const centerPos = { x: center.cx * CELL_SIZE + CELL_SIZE / 2, y: center.cy * CELL_SIZE + CELL_SIZE / 2 };

    for (const e of ctx.entities) {
      if (!e.alive || e.house !== house) continue;
      if (e.type === UnitType.V_HARV) continue;
      if (e.mission !== Mission.AREA_GUARD && e.mission !== Mission.GUARD) continue;
      const dist = worldDist(e.pos, centerPos);
      if (dist < 10) {
        let nearestEnemy: Entity | null = null;
        let nearestDist = Infinity;
        for (const enemy of ctx.entities) {
          if (!enemy.alive || ctx.isAllied(enemy.house, house)) continue;
          const eDist = worldDist(enemy.pos, centerPos);
          if (eDist < 12 && eDist < nearestDist) {
            nearestDist = eDist;
            nearestEnemy = enemy;
          }
        }
        if (nearestEnemy) {
          e.mission = Mission.HUNT;
          e.moveTarget = { x: nearestEnemy.pos.x, y: nearestEnemy.pos.y };
        }
      }
    }
  }
}

/** AI retreat -- damaged units fall back to repair depot or base */
export function updateAIRetreat(ctx: AIContext): void {
  if (ctx.tick % 30 !== 0) return;

  const mods = AI_DIFFICULTY_MODS[ctx.difficulty] ?? AI_DIFFICULTY_MODS.normal;
  const retreatPercent = mods.retreatHpPercent;

  for (const e of ctx.entities) {
    if (!e.alive || ctx.isPlayerControlled(e)) continue;
    if (e.isAnt) continue;
    if (e.isSuicide) continue;

    const state = ctx.aiStates.get(e.house);
    if (!state) continue;
    if (state.iq < 3) continue;

    // Emergency harvester return
    if (e.type === UnitType.V_HARV) {
      const hpRatio = e.hp / e.maxHp;
      if (hpRatio >= 0.3) continue;
      if (e.harvesterState === 'returning' || e.harvesterState === 'unloading') continue;
      if (e.mission === Mission.MOVE && e.moveTarget) continue;
      let nearestProc: MapStructure | null = null;
      let nearestDist = Infinity;
      for (const s of ctx.structures) {
        if (!s.alive || s.house !== e.house || s.type !== 'PROC') continue;
        const [w, h] = STRUCTURE_SIZE[s.type] ?? [3, 2];
        const sx = (s.cx + w / 2) * CELL_SIZE;
        const sy = (s.cy + h / 2) * CELL_SIZE;
        const d = (e.pos.x - sx) ** 2 + (e.pos.y - sy) ** 2;
        if (d < nearestDist) { nearestDist = d; nearestProc = s; }
      }
      if (nearestProc) {
        const [w, h] = STRUCTURE_SIZE[nearestProc.type] ?? [3, 2];
        e.harvesterState = 'returning';
        e.mission = Mission.MOVE;
        e.moveTarget = {
          x: (nearestProc.cx + w / 2) * CELL_SIZE,
          y: (nearestProc.cy + h / 2) * CELL_SIZE,
        };
        e.harvestTick = 0;
      }
      continue;
    }

    const hpRatio = e.hp / e.maxHp;
    if (hpRatio >= retreatPercent) continue;

    if (e.mission === Mission.MOVE && e.moveTarget) continue;

    const center = aiGetBaseCenter(ctx, e.house);
    if (!center) continue;

    let retreatTarget: WorldPos | null = null;
    for (const s of ctx.structures) {
      if (!s.alive || s.house !== e.house || s.type !== 'FIX') continue;
      const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
      retreatTarget = {
        x: (s.cx + w / 2) * CELL_SIZE,
        y: (s.cy + h / 2) * CELL_SIZE,
      };
      break;
    }

    if (!retreatTarget) {
      retreatTarget = {
        x: center.cx * CELL_SIZE + CELL_SIZE / 2,
        y: center.cy * CELL_SIZE + CELL_SIZE / 2,
      };
    }

    e.mission = Mission.MOVE;
    e.moveTarget = retreatTarget;
    state.attackPool.delete(e.id);
  }
}

/** AI auto-repair -- IQ >= 3 houses repair damaged structures using their own credits */
export function updateAIRepair(ctx: AIContext): void {
  if (ctx.tick % 15 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (state.iq < 3) continue;

    const credits = ctx.houseCredits.get(house) ?? 0;
    if (credits < 10) continue;

    for (const s of ctx.structures) {
      if (!s.alive || s.house !== house) continue;
      if (s.hp >= s.maxHp) continue;
      if (s.sellProgress !== undefined) continue;
      if (s.hp >= s.maxHp * 0.8) continue;

      const prodItem = ctx.scenarioProductionItems.find(p => p.type === s.type);
      const repairCostPerStep = prodItem
        ? Math.ceil((prodItem.cost * REPAIR_PERCENT) / (s.maxHp / REPAIR_STEP))
        : 1;
      const currentCredits = ctx.houseCredits.get(house) ?? 0;
      if (currentCredits >= repairCostPerStep) {
        s.hp = Math.min(s.maxHp, s.hp + REPAIR_STEP);
        ctx.houseCredits.set(house, currentCredits - repairCostPerStep);
      }
    }
  }
}

/** AI auto-sell -- IQ >= 3 houses sell near-death structures for partial refund */
export function updateAISellDamaged(ctx: AIContext): void {
  if (ctx.tick % 75 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (state.iq < 3) continue;

    for (const s of ctx.structures) {
      if (!s.alive || s.house !== house) continue;
      if (s.sellProgress !== undefined) continue;
      if (s.hp >= s.maxHp * CONDITION_RED) continue;

      if (s.type === 'FACT') continue;

      if (s.type === 'POWR' || s.type === 'APWR') {
        let powerCount = 0;
        for (const ps of ctx.structures) {
          if (ps.alive && ps.house === house && (ps.type === 'POWR' || ps.type === 'APWR')) {
            powerCount++;
          }
        }
        if (powerCount <= 1) continue;
      }

      const prodItem = ctx.scenarioProductionItems.find(p => p.type === s.type && p.isStructure);
      if (prodItem) {
        const hpRatio = s.hp / s.maxHp;
        const refund = Math.floor(prodItem.cost * 0.5 * hpRatio);
        const current = ctx.houseCredits.get(house) ?? 0;
        ctx.houseCredits.set(house, current + refund);
      }
      s.alive = false;
      s.rubble = true;
      ctx.clearStructureFootprint(s);
    }
  }
}

/** AI passive income -- AI houses earn credits from refineries */
export function updateAIIncome(ctx: AIContext): void {
  if (ctx.tick % 450 !== 0) return;
  for (const s of ctx.structures) {
    if (!s.alive || s.type !== 'PROC') continue;
    if (ctx.isAllied(s.house, ctx.playerHouse)) continue;
    const current = ctx.houseCredits.get(s.house) ?? 0;
    const aiState = ctx.aiStates.get(s.house);
    const incomeMult = aiState ? aiState.incomeMult : 1.0;
    ctx.houseCredits.set(s.house, current + Math.floor(100 * incomeMult));
  }
}

/** AI army building -- AI houses produce units when they have credits and barracks/factory */
export function updateAIProduction(ctx: AIContext): void {
  const mods = AI_DIFFICULTY_MODS[ctx.difficulty] ?? AI_DIFFICULTY_MODS.normal;
  if (ctx.tick % mods.productionInterval !== 0) return;

  // For ant missions, respect ant cap using old random production
  if (ctx.scenarioId.startsWith('SCA')) {
    const diffMods = DIFFICULTY_MODS[ctx.difficulty] ?? DIFFICULTY_MODS.normal;
    const antCount = ctx.entities.filter(e => e.alive && e.isAnt).length;
    if (antCount >= diffMods.maxAnts) return;
  }

  for (const [house, credits] of ctx.houseCredits) {
    if (credits <= 0) continue;
    if (ctx.isAllied(house, ctx.playerHouse)) continue;

    const state = ctx.aiStates.get(house);
    if (state && !state.productionEnabled) continue;
    const hasTent = aiHasPrereq(ctx, house, 'TENT');
    const hasWeap = ctx.structures.some(s => s.alive && s.house === house && s.type === 'WEAP');

    // Strategic AI: Harvester priority
    if (state && hasWeap && state.harvesterCount < state.refineryCount) {
      const harvItem = ctx.scenarioProductionItems.find(p => p.type === 'HARV');
      if (harvItem && credits >= harvItem.cost) {
        const unit = spawnAIUnit(ctx, house, UnitType.V_HARV, 'WEAP');
        if (unit) {
          ctx.houseCredits.set(house, credits - harvItem.cost);
          continue;
        }
      }
    }

    const staging = state ? aiStagingArea(ctx, house) : null;

    // C++ MaxInfantry cap
    let skipInfantry = false;
    if (state && state.maxInfantry >= 0) {
      let infCount = 0;
      for (const e of ctx.entities) {
        if (e.alive && e.house === house && e.stats.isInfantry) infCount++;
      }
      if (infCount >= state.maxInfantry) skipInfantry = true;
    }

    if (hasTent && credits >= 100 && !skipInfantry) {
      const pick = state
        ? getAIProductionPick(ctx, house, 'infantry')
        : (() => {
            const houseFaction = HOUSE_FACTION[house] ?? 'both';
            const infItems = ctx.scenarioProductionItems.filter(p =>
              (p.prerequisite === 'TENT' || p.prerequisite === 'BARR') &&
              !p.isStructure &&
              (p.faction === 'both' || p.faction === houseFaction) &&
              (p.techLevel === undefined || p.techLevel >= 0)
            );
            return infItems.length > 0 ? infItems[Math.floor(Math.random() * infItems.length)] : null;
          })();
      if (pick && credits >= pick.cost) {
        const unitType = pick.type as UnitType;
        const unit = spawnAIUnit(ctx, house, unitType, 'TENT', Mission.AREA_GUARD,
          staging ?? undefined);
        if (unit) {
          if (!staging) {
            unit.guardOrigin = { x: unit.pos.x, y: unit.pos.y };
          } else {
            unit.moveTarget = staging;
            unit.mission = Mission.MOVE;
          }
          ctx.houseCredits.set(house, credits - pick.cost);
        }
      }
    }

    // C++ MaxUnit cap
    let skipVehicle = false;
    if (state && state.maxUnit >= 0) {
      let vehCount = 0;
      for (const e of ctx.entities) {
        if (e.alive && e.house === house && !e.stats.isInfantry && !e.isAnt && !e.stats.isAircraft && !e.stats.isVessel) vehCount++;
      }
      if (vehCount >= state.maxUnit) skipVehicle = true;
    }

    const currentCredits = ctx.houseCredits.get(house) ?? 0;
    if (hasWeap && currentCredits >= 600 && !skipVehicle) {
      const pick = state
        ? getAIProductionPick(ctx, house, 'vehicle')
        : (() => {
            const houseFaction = HOUSE_FACTION[house] ?? 'both';
            const vehItems = ctx.scenarioProductionItems.filter(p =>
              p.prerequisite === 'WEAP' &&
              !p.isStructure &&
              (p.faction === 'both' || p.faction === houseFaction) &&
              (p.techLevel === undefined || p.techLevel >= 0)
            );
            return vehItems.length > 0 ? vehItems[Math.floor(Math.random() * vehItems.length)] : null;
          })();
      if (pick && currentCredits >= pick.cost) {
        const unitType = pick.type as UnitType;
        const unit = spawnAIUnit(ctx, house, unitType, 'WEAP', Mission.AREA_GUARD,
          staging ?? undefined);
        if (unit) {
          if (!staging) {
            unit.guardOrigin = { x: unit.pos.x, y: unit.pos.y };
          } else {
            unit.moveTarget = staging;
            unit.mission = Mission.MOVE;
          }
          ctx.houseCredits.set(house, (ctx.houseCredits.get(house) ?? 0) - pick.cost);
        }
      }
    }
  }
}

/** AI autocreate teams -- periodically assemble and deploy teams from autocreate-flagged TeamTypes */
export function updateAIAutocreateTeams(ctx: AIContext): void {
  if (!ctx.autocreateEnabled) return;
  if (ctx.tick % 120 !== 0) return;

  for (const [house, state] of ctx.aiStates) {
    if (!state.productionEnabled) continue;
    if (state.iq < 2) continue;

    const credits = ctx.houseCredits.get(house) ?? 0;
    if (credits < 500) continue;

    for (let teamIdx = 0; teamIdx < ctx.teamTypes.length; teamIdx++) {
      const team = ctx.teamTypes[teamIdx];
      if (!(team.flags & 4)) continue;
      if (houseIdToHouse(team.house) !== house) continue;
      if (ctx.destroyedTeams.has(teamIdx)) continue;

      const edge = ctx.houseEdges.get(house)?.toLowerCase();
      let spawnPos: { cx: number; cy: number } | null = null;

      if (edge) {
        const bx = ctx.map.boundsX, by = ctx.map.boundsY;
        const bw = ctx.map.boundsW, bh = ctx.map.boundsH;
        const randOffset = Math.floor(Math.random() * Math.max(bw, bh));
        switch (edge) {
          case 'north': spawnPos = { cx: bx + (randOffset % bw), cy: by }; break;
          case 'south': spawnPos = { cx: bx + (randOffset % bw), cy: by + bh - 1 }; break;
          case 'east':  spawnPos = { cx: bx + bw - 1, cy: by + (randOffset % bh) }; break;
          case 'west':  spawnPos = { cx: bx, cy: by + (randOffset % bh) }; break;
        }
      }

      if (!spawnPos) {
        const wp = ctx.waypoints.get(team.origin);
        if (wp) spawnPos = wp;
        else continue;
      }

      const world = { x: spawnPos.cx * CELL_SIZE + CELL_SIZE / 2, y: spawnPos.cy * CELL_SIZE + CELL_SIZE / 2 };

      for (const member of team.members) {
        if (!UNIT_STATS[member.type]) continue;
        const unitType = member.type as UnitType;
        for (let i = 0; i < member.count; i++) {
          const offsetX = (Math.random() - 0.5) * 48;
          const offsetY = (Math.random() - 0.5) * 48;
          const entity = new Entity(unitType, house, world.x + offsetX, world.y + offsetY);
          entity.facing = Math.floor(Math.random() * 8);
          entity.bodyFacing32 = entity.facing * 4;

          if (team.missions.length > 0) {
            entity.teamMissions = team.missions.map(m => ({
              mission: m.mission,
              data: m.data,
            }));
            entity.teamMissionIndex = 0;
          } else {
            entity.mission = Mission.HUNT;
          }

          if (team.flags & 2) {
            entity.mission = Mission.HUNT;
          }

          applyScenarioOverrides([entity], ctx.scenarioUnitStats, ctx.scenarioWeaponStats);
          ctx.entities.push(entity);
          ctx.entityById.set(entity.id, entity);
        }
      }

      break; // One team per house per cycle
    }
  }
}
