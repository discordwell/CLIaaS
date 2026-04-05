/**
 * Placement subsystem — structure placement and MCV deployment.
 * Extracted from Game class (engine/index.ts) into pure + context-based functions.
 */

import {
  type ProductionItem,
  CELL_SIZE,
  type House, UnitType, Mission,
} from './types';
import { getEffectiveCost } from './production';
import { type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP, STRUCTURE_WEAPONS, STRUCTURE_ARMOR, getBibCells } from './scenario';
import { Entity } from './entity';
import { type GameMap, Terrain } from './map';
import { type Effect } from './renderer';

// ── Local constants ──────────────────────────────────────────────────────────

// C++ building.cpp:1062-1098: all wall types that convert to overlays
// cpp-parity: WOOD (building.cpp:1082) and CYCL (building.cpp:1086) were missing
const WALL_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD', 'CYCL']);

/**
 * Per-building Adjacent= value from rules.ini (C++ bdata.cpp:3772).
 * Default is 1 (C++ bdata.cpp:2839). Only SYRD/SPEN/SYRF/SPEF override to 8.
 */
const ADJACENT_RANGE: Record<string, number> = {
  SYRD: 8, SPEN: 8, SYRF: 8, SPEF: 8,
};

/** Get Adjacent= for a building type, defaulting to 1 (C++ bdata.cpp:2839). */
export function getAdjacentRange(type: string): number {
  return ADJACENT_RANGE[type] ?? 1;
}

/**
 * Buildings with BaseNormal=yes in rules.ini (C++ bdata.cpp:3777 -> IsBase).
 * C++ display.cpp:744,771,798 — proximity check only counts buildings with IsBase=true.
 * Buildings NOT in this set (SYRD, SPEN, BARL, BRL3, MINV, MINP, walls, fakes) cannot
 * satisfy the proximity requirement for placing other buildings.
 */
export const BASE_NORMAL: Set<string> = new Set([
  'FACT', 'POWR', 'APWR', 'PROC', 'WEAP', 'DOME',
  'BARR', 'TENT', 'HPAD', 'AFLD', 'GUN', 'AGUN',
  'TSLA', 'PBOX', 'HBOX', 'FTUR', 'SAM', 'MSLO',
  'ATEK', 'STEK', 'PDOX', 'IRON', 'HOSP', 'BIO',
  'SILO', 'FIX', 'GAP', 'KENN', 'FCOM', 'MISS',
]);

// ── Context interface ────────────────────────────────────────────────────────

export interface PlacementContext {
  structures: MapStructure[];
  entities: Entity[];
  entityById: Map<number, Entity>;
  credits: number;
  tick: number;
  playerHouse: House;
  pendingPlacement: ProductionItem | null;
  wallPlacementPrepaid: boolean;
  cachedAvailableItems: ProductionItem[] | null;
  evaMessages: { text: string; tick: number }[];
  effects: Effect[];
  map: GameMap;
  /** AI house states — used by deployMCV to set IsStarted (C++ unit.cpp:1549) */
  aiStates?: Map<House, { isStarted: boolean }>;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  playSound(name: string): void;
  getAvailableItems(): ProductionItem[];
  findPassableSpawn(cx: number, cy: number, structCX: number, structCY: number, fw: number, fh: number): { cx: number; cy: number };
}

// ── Mutating functions ───────────────────────────────────────────────────────

/** Place a completed structure on the map */
export function placeStructure(ctx: PlacementContext, cx: number, cy: number): boolean {
  if (!ctx.pendingPlacement) return false;
  const item = ctx.pendingPlacement;
  const isWall = WALL_TYPES.has(item.type);
  // Walls after the first need to check credits (first wall paid at production start)
  if (isWall && ctx.credits < item.cost) return false;
  const [fw, fh] = STRUCTURE_SIZE[item.type] ?? [2, 2];
  // C++ cell.cpp:498-503: cells must be buildable (Ground[land].Build=true) and within bounds
  // cpp-parity: ORE, ROUGH, BEACH are passable for movement but NOT buildable
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      if (!ctx.map.isBuildable(cx + dx, cy + dy)) return false;
    }
  }
  // C++ bdata.cpp:3448-3477 Occupy_List(placement=true): bib cells must also be buildable
  for (const bc of getBibCells(item.type, cx, cy)) {
    if (!ctx.map.isBuildable(bc.cx, bc.cy)) return false;
  }
  // C++ display.cpp:706-778 Passes_Proximity_Check: ALL placements (including walls)
  // must be near a friendly structure. C++ only counts buildings with BaseNormal=yes (IsBase).
  // cpp-parity: display.cpp:744 checks Class->IsBase, display.cpp:792 Adjacent>1 center-distance
  {
    let adjacent = false;
    const adj = getAdjacentRange(item.type);
    if (adj > 1) {
      // C++ display.cpp:792-808: Adjacent>1 center-distance check (SYRD/SPEN)
      // centdist = Distance(existing.Center, target.Cell) / CELL_LEPTON_W - (W+H)/2
      // retval = (centdist <= building->Adjacent)
      for (const s of ctx.structures) {
        if (!s.alive || !ctx.isAllied(s.house, ctx.playerHouse)) continue;
        if (!BASE_NORMAL.has(s.type)) continue; // C++ display.cpp:798: IsBase check
        const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
        const sCenterX = s.cx + sw / 2;
        const sCenterY = s.cy + sh / 2;
        const dx = Math.abs(cx - sCenterX);
        const dy = Math.abs(cy - sCenterY);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const centdist = dist - (sw + sh) / 2;
        if (centdist <= adj) { adjacent = true; break; }
      }
    } else {
      // C++ display.cpp:706-778: Adjacent==1 two-ring scan (max 2 cells in cardinal directions)
      // Only counts buildings with BaseNormal=yes (C++ display.cpp:744 Class->IsBase)
      for (const s of ctx.structures) {
        if (!s.alive || !ctx.isAllied(s.house, ctx.playerHouse)) continue;
        if (!BASE_NORMAL.has(s.type)) continue; // C++ display.cpp:744: IsBase filter
        const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
        const exL = s.cx - 2, exT = s.cy - 2, exR = s.cx + sw + 2, exB = s.cy + sh + 2;
        const nL = cx, nT = cy, nR = cx + fw, nB = cy + fh;
        if (nL < exR && nR > exL && nT < exB && nB > exT) { adjacent = true; break; }
      }
    }
    if (!adjacent) return false;
  }

  const image = item.type.toLowerCase();
  const maxHp = STRUCTURE_MAX_HP[item.type] ?? 256;
  // Create structure with construction animation
  const newStruct: MapStructure = {
    type: item.type,
    image,
    house: ctx.playerHouse,
    cx, cy,
    hp: maxHp,
    maxHp,
    armor: STRUCTURE_ARMOR[item.type] ?? 'wood',
    alive: true,
    rubble: false,
    weapon: STRUCTURE_WEAPONS[item.type],
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    missionTimer: 0,
    buildProgress: isWall ? undefined : 0, // walls appear instantly
  };
  ctx.structures.push(newStruct);
  // Mark cells as impassable
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      ctx.map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
    }
  }
  // C++ bdata.cpp:3597-3629: Mark bib cells as impassable (1 row below building)
  for (const bc of getBibCells(item.type, cx, cy)) {
    ctx.map.setTerrain(bc.cx, bc.cy, Terrain.WALL);
  }
  // Store wall type for auto-connection sprite rendering
  if (isWall) {
    ctx.map.setWallType(cx, cy, item.type);
  }
  // For walls: keep pendingPlacement active for continuous placement
  if (isWall) {
    if (ctx.wallPlacementPrepaid) {
      ctx.wallPlacementPrepaid = false; // first wall was paid at production start
    } else {
      ctx.credits -= getEffectiveCost(item, ctx.playerHouse); // subsequent walls deducted on placement
    }
  } else {
    ctx.pendingPlacement = null;
  }

  ctx.playSound('building_placed');
  ctx.playSound('eva_building');
  // Check if placing this structure unlocks new production items
  const oldItems = ctx.cachedAvailableItems ?? [];
  ctx.cachedAvailableItems = null; // force recompute
  const newItems = ctx.getAvailableItems();
  if (newItems.length > oldItems.length) {
    ctx.playSound('eva_new_options');
    ctx.evaMessages.push({ text: 'NEW CONSTRUCTION OPTIONS', tick: ctx.tick });
  }
  // Spawn free harvester with refinery
  if (item.type === 'PROC') {
    const harvSpawn = ctx.findPassableSpawn(cx + 1, cy + fh, cx, cy, fw, fh);
    const harv = new Entity(UnitType.V_HARV, ctx.playerHouse,
      harvSpawn.cx * CELL_SIZE + CELL_SIZE / 2, harvSpawn.cy * CELL_SIZE + CELL_SIZE / 2);
    harv.harvesterState = 'idle';
    ctx.entities.push(harv);
    ctx.entityById.set(harv.id, harv);
  }
  return true;
}

/** Deploy MCV at its current location → FACT structure */
export function deployMCV(ctx: PlacementContext, entity: Entity): boolean {
  if (entity.type !== UnitType.V_MCV || !entity.alive) return false;
  const ec = entity.cell;
  // C++ unit.cpp:1491: Legal_Placement checks all foundation cells via Is_Clear_To_Build
  // Need a 3x3 buildable area (cpp-parity: cell.cpp:498-503)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!ctx.map.isBuildable(ec.cx + dx, ec.cy + dy)) return false;
    }
  }
  // Remove the MCV entity
  entity.alive = false;
  entity.mission = Mission.DIE;
  // Place a Construction Yard
  const cx = ec.cx - 1;
  const cy = ec.cy - 1;
  const factMaxHp = STRUCTURE_MAX_HP['FACT'] ?? 256;
  // C++ unit.cpp:1555: building->Strength = Health_Ratio() * building->Class->MaxStrength
  // A damaged MCV creates a damaged Construction Yard (cpp-parity)
  const healthRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
  const factHp = Math.floor(healthRatio * factMaxHp);
  const newStruct: MapStructure = {
    type: 'FACT',
    image: 'fact',
    house: entity.house,
    cx, cy,
    hp: factHp,
    maxHp: factMaxHp,
    armor: STRUCTURE_ARMOR['FACT'] ?? 'heavy',
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    missionTimer: 0,
    deployedFromMCV: true, // C++ ArchiveTarget parity: tracks MCV origin for sell reversion
    // C++ bdata.cpp:3131 Init_Anim(BSTATE_CONSTRUCTION): MCV deploy plays the MAKE buildup anim.
    // The renderer (renderer.ts:1555) watches buildProgress < 1 and draws factmake frames.
    buildProgress: 0,
  };
  ctx.structures.push(newStruct);
  // Mark 3x3 footprint
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      ctx.map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
    }
  }
  // C++ bdata.cpp:3597-3629: Mark bib cells as impassable (1 row below FACT)
  for (const bc of getBibCells('FACT', cx, cy)) {
    ctx.map.setTerrain(bc.cx, bc.cy, Terrain.WALL);
  }
  // C++ unit.cpp:1549: House->IsStarted = true — MCV deploy enables production
  if (ctx.aiStates) {
    const aiState = ctx.aiStates.get(entity.house);
    if (aiState) aiState.isStarted = true;
  }
  ctx.playSound('eva_acknowledged');
  ctx.effects.push({
    type: 'explosion', x: entity.pos.x, y: entity.pos.y,
    frame: 0, maxFrames: 15, size: 10, sprite: 'piffpiff', spriteStart: 0,
  });
  return true;
}
