/**
 * Canvas 2D renderer — full visual fidelity.
 * Terrain, fog of war, units with death/damage effects,
 * explosions, health bars, selection circles, minimap, UI.
 */

import { CELL_SIZE, GAME_TICKS_PER_SEC, RESFACTOR, LEPTON_SIZE, House, Stance, UnitType, BODY_SHAPE, type ProductionItem, type SidebarItem, CursorType, TEMPLATE_ROAD_MIN, TEMPLATE_ROAD_MAX, SuperweaponType, SUPERWEAPON_DEFS, type SuperweaponDef, type SuperweaponState, CHRONO_SHIFT_VISUAL_TICKS, IC_TARGET_RANGE, type StripType, getStripSide, getFactoryType, isSidebarSpecialItem, leptonToPixel, type Faction, COS_TABLE_256, SIN_TABLE_256, CPP_CORPSE_FRAME_COUNT, CPP_CORPSE_FRAME_TICKS, cppCorpseAnimForInfantryDeath, Mission } from './types';
import { type Camera } from './camera';
import { type AssetManager, type DrawFrameOptions, type SpriteSheet, type TilesetMeta, type TranslucentControl } from './assets';
import { Entity, RECOIL_OFFSETS, CloakState, CLOAK_TRANSITION_FRAMES, dir256ToFacing8 } from './entity';
import { GameMap, Terrain, TREE_CENTER_OFFSET, TERRAIN_OBJECT_CENTER_OFFSET, type MapTerrainRadarObject } from './map';
import { type InputState } from './input';
import { type MapStructure, STRUCTURE_SIZE, getBibCells, getStructureOccupyCells, structureCenterLeptons, structureUsesHouseRemap } from './scenario';
import { SHADOW_TABLE, cellShadowIndex, shadowTransFadeForRGBA, RA_COLOR_BLACK, RA_COLOR_DKGREY, RA_COLOR_LTGREY, RA_COLOR_WHITE, RA_COLOR_YELLOW, makeFadingTable, makeRemapFadingTable, nearestPaletteIndex } from './shadow';
import { NonCriticalRandom } from './random';
import { RA_MESSAGE_DELAY_TICKS } from './tutorialText';
import { logicAnimRenderSpec, type LogicAnim } from './logicAnim';

/** Interpolate between two values on a 0-31 ring (shortest path).
 *  Used for smooth 60fps visual rotation between 15fps game ticks. */
function lerpFacing32(prev: number, curr: number, alpha: number): number {
  if (prev === curr) return curr;
  let diff = (curr - prev + 32) % 32;
  if (diff > 16) diff -= 32; // shortest path (may go negative for CCW)
  const result = prev + diff * alpha;
  return ((Math.round(result) % 32) + 32) % 32;
}

function dir256ToFacing16(dir: number): number {
  return (((dir + 8) & 0xff) >> 4) & 0x0f;
}

function rotation16(dir: number): number {
  const raw = dir & 0x0f;
  return raw <= 7 ? raw : raw - 16;
}

function vesselBodyFrame(entity: Entity, fallbackFacing32: number, frameCount: number): number {
  // C++ VesselClass::Shape_Number uses 16-facing ship bodies:
  // UnitClass::BodyShape[Dir_To_16(PrimaryFacing) * 2] >> 1.
  // Applying the 32-frame UnitClass mapping and wrapping with % 16 rotates
  // ships by a quadrant on e.g. SCG07EA's east-facing PT boats.
  let frame: number;
  if (entity.type === UnitType.V_LST || entity.type === UnitType.V_CARR) {
    frame = entity.type === UnitType.V_LST ? lstDoorStage(entity) : 0;
  } else {
    const primaryFacing256 = entity.bodyFacing256 >= 0
      ? entity.bodyFacing256 & 0xff
      : (fallbackFacing32 * 8) & 0xff;
    frame = (BODY_SHAPE[dir256ToFacing16(primaryFacing256) * 2] ?? 0) >> 1;
  }
  return frameCount > 0 ? frame % frameCount : frame;
}

function lstDoorStage(entity: Entity): number {
  // C++ vessel.cpp:365-371: VESSEL_TRANSPORT uses frame 0 while closed, then
  // DoorClass::Door_Stage while opening/open/closing. LST_Open_Door(5, 6)
  // stores Stages=5, so visible body frames are 0..4.
  const maxStage = 4;
  const rate = 5;
  if (entity.doorClosingTicks > 0) {
    return Math.max(0, Math.min(maxStage, Math.floor((entity.doorClosingTicks - 1) / rate)));
  }
  if (entity.doorOpeningTicks > 0) {
    return Math.max(0, Math.min(maxStage, Math.floor(((rate * (maxStage + 1)) - entity.doorOpeningTicks) / rate)));
  }
  return entity.doorOpen ? maxStage : 0;
}

function aircraftBodyFrame(entity: Entity, fallbackFacing32: number, frameCount: number): number {
  // C++ AircraftClass::Shape_Number draws from SecondaryFacing, not
  // PrimaryFacing. Fixed-wing sprites use 16 rotation stages; helicopters use
  // 32. TRAN has four extra rotor frames after the 32 body frames.
  const secondaryFacing256 = entity.turretFacing256 >= 0
    ? entity.turretFacing256 & 0xff
    : (fallbackFacing32 * 8) & 0xff;
  const frame = entity.isFixedWing || frameCount <= 16
    ? ((BODY_SHAPE[dir256ToFacing16(secondaryFacing256) * 2] ?? 0) >> 1)
    : (BODY_SHAPE[fallbackFacing32] ?? 0);
  return frameCount > 0 ? frame % frameCount : frame;
}

function aircraftShapeRotation(entity: Entity): number {
  if (!entity.isFixedWing) return 0;
  const secondaryFacing256 = entity.turretFacing256 >= 0
    ? entity.turretFacing256 & 0xff
    : (entity.turretFacing32 * 8) & 0xff;
  return rotation16(secondaryFacing256);
}

function cppEntityRenderSortKey(entity: Entity): number {
  // C++ ObjectClass::operator< compares Sort_Y() as a packed COORDINATE:
  // high word = Y leptons, low word = X leptons. That means equal-Y objects
  // still sort west-to-east before stable insertion-order ties.
  let yOffset = 0x30; // FootClass::Sort_Y default.
  if (entity.stats.isAircraft || (!entity.stats.isInfantry && !entity.stats.isVessel)) {
    yOffset = 0x80; // AircraftClass/UnitClass::Sort_Y override.
  } else if (entity.isTethered && entity.transportRef && !entity.transportRef.stats.isAircraft && !entity.transportRef.stats.isVessel) {
    yOffset = 0x100; // FootClass tethered-to-RTTI_UNIT unload bias.
  }
  return (entity.leptonY + yOffset) * 0x10000 + entity.leptonX;
}

function cppEntityRenderLayer(entity: Entity): 'ground' | 'top' {
  // C++ ObjectClass::In_Which_Layer keeps objects below
  // FLIGHT_LEVEL-(FLIGHT_LEVEL/3) in LAYER_GROUND. AircraftClass promotes
  // fixed-wing aircraft to LAYER_TOP as soon as Height is non-zero.
  if (!entity.stats.isAircraft) return 'ground';
  const height = entity.objectHeightLeptons();
  if (entity.stats.isFixedWing && height > 0) return 'top';
  const topThreshold = Entity.FLIGHT_LEVEL_LEPTONS - Math.floor(Entity.FLIGHT_LEVEL_LEPTONS / 3);
  return height < topThreshold ? 'ground' : 'top';
}

function cppStructureRenderSortKey(structure: MapStructure): { y: number; x: number } {
  // C++ BuildingClass::Sort_Y special-cases repair bays, barracks/tents, and
  // refineries, otherwise sorting from Center_Coord()+Height/3.
  const origin = {
    x: structure.cx * LEPTON_SIZE,
    y: structure.cy * LEPTON_SIZE,
  };
  if (structure.type === 'FIX') return origin;

  const center = structureCenterLeptons(structure);
  if (structure.type === 'BARR' || structure.type === 'TENT' || structure.type === 'PROC') {
    return { x: center.lx, y: center.ly };
  }
  if (structure.type === 'MINP' || structure.type === 'MINV') {
    return { x: center.lx, y: center.ly - LEPTON_SIZE };
  }

  const [, h] = STRUCTURE_SIZE[structure.type] ?? [1, 1];
  return {
    x: center.lx,
    y: center.ly + Math.trunc((h * LEPTON_SIZE) / 3),
  };
}

function normalMovePointOffset(dir: number, distance: number): { dx: number; dy: number } {
  const facing = dir & 0xff;
  const dx = (COS_TABLE_256[facing] * distance) >> 7;
  const halfSin = Math.trunc(SIN_TABLE_256[facing] / 2);
  const dy = -((halfSin * distance) >> 7);
  return { dx, dy };
}

function movePointOffset(dir: number, distance: number): { dx: number; dy: number } {
  const facing = dir & 0xff;
  const dx = (COS_TABLE_256[facing] * distance) >> 7;
  const dy = -((SIN_TABLE_256[facing] * distance) >> 7);
  return { dx, dy };
}

function structureDrawCenter(s: MapStructure, screenX: number, screenY: number): { x: number; y: number } {
  const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
  return {
    x: screenX + fw * CELL_SIZE / 2,
    y: screenY + fh * CELL_SIZE / 2,
  };
}

// House colors are applied via palette index remapping (getRemappedSheet),
// matching C++ SHAPE_FADING remap tables. No tint overlay fallback.

// C++ udata.cpp:60-61 — Harvester sprite animation lists.
// Dump: 22-stage ping-pong conveyor sweep (0→14→0) played during refinery unload.
// Load: 9-stage scoop cycle played while stationary at ore cell.
const HARVESTER_DUMP_LIST: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 6, 5, 4, 3, 2, 1, 0,
];
const HARVESTER_LOAD_LIST: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 0];
const DIR_S_256 = 128;

// Radar blip colors: C++ radar.cpp uses ColorRemaps[house->RemapColor].Bar.
// init.cpp fills Bar from PALETTE.CPS column 6; RGBClass exposes 6-bit VGA as value*4.
export const HOUSE_MINIMAP_COLOR: Record<string, string> = {
  [House.Spain]: 'rgb(144,136,76)',    // PCOLOR_GOLD
  [House.USSR]: 'rgb(176,0,0)',        // PCOLOR_RED
  [House.Greece]: 'rgb(104,116,160)',  // PCOLOR_LTBLUE
  [House.England]: 'rgb(120,152,100)', // PCOLOR_GREEN
  [House.France]: 'rgb(64,132,116)',   // PCOLOR_BLUE
  [House.Ukraine]: 'rgb(212,120,16)',  // PCOLOR_ORANGE
  [House.Germany]: 'rgb(148,124,112)', // PCOLOR_GREY
  [House.Turkey]: 'rgb(152,76,56)',    // PCOLOR_BROWN
  [House.GoodGuy]: 'rgb(104,116,160)', // PCOLOR_LTBLUE
  [House.BadGuy]: 'rgb(176,0,0)',      // PCOLOR_RED
  [House.Neutral]: 'rgb(144,136,76)',  // PCOLOR_GOLD
  [House.Special]: 'rgb(144,136,76)',  // PCOLOR_GOLD
  [House.Multi1]: 'rgb(144,136,76)',   // PCOLOR_GOLD
  [House.Multi2]: 'rgb(104,116,160)',  // PCOLOR_LTBLUE
  [House.Multi3]: 'rgb(176,0,0)',      // PCOLOR_RED
  [House.Multi4]: 'rgb(120,152,100)',  // PCOLOR_GREEN
  [House.Multi5]: 'rgb(212,120,16)',   // PCOLOR_ORANGE
  [House.Multi6]: 'rgb(148,124,112)',  // PCOLOR_GREY
  [House.Multi7]: 'rgb(64,132,116)',   // PCOLOR_BLUE
  [House.Multi8]: 'rgb(152,76,56)',    // PCOLOR_BROWN
};

// C++ TACTION_TEXT_TRIGGER: PCOLOR_GREEN with TPF_6PT_GRAD|TPF_USE_GRAD_PAL.
// init.cpp fills FontRemap[10..15] from PALETTE.CPS row PCOLOR_GREEN columns 2..7.
const PCOLOR_GREEN_FONT_RAMP = [
  '#c4e484',
  '#b0d07c',
  '#9cbc74',
  '#88ac6c',
  '#789864',
  '#68885c',
] as const;

const PCOLOR_GREEN_FULLSHADOW_FONT_PALETTE = [
  '#000000',
  PCOLOR_GREEN_FONT_RAMP[2],
  '#000000',
  '#000000',
  PCOLOR_GREEN_FONT_RAMP[0],
  PCOLOR_GREEN_FONT_RAMP[0],
  PCOLOR_GREEN_FONT_RAMP[0],
  PCOLOR_GREEN_FONT_RAMP[0],
  PCOLOR_GREEN_FONT_RAMP[0],
  PCOLOR_GREEN_FONT_RAMP[0],
  PCOLOR_GREEN_FONT_RAMP[0],
  PCOLOR_GREEN_FONT_RAMP[1],
  PCOLOR_GREEN_FONT_RAMP[2],
  PCOLOR_GREEN_FONT_RAMP[3],
  PCOLOR_GREEN_FONT_RAMP[4],
  PCOLOR_GREEN_FONT_RAMP[5],
] as const;

// C++ init.cpp:2780-2788 — MetalScheme for the in-game top tabs.
// 12METFNT.FNT pixels encode font-palette nibbles; these entries are the
// palette colors C++ installs for TPF_METAL12 | TPF_USE_GRAD_PAL.
const METAL12_FONT_PALETTE = [
  '#000000',
  '#ececec', // palette index 128
  '#000000', // palette index 12
  '#545454', // palette index 13
  '#a8a8a8', // palette index 14
  '#fcfc54',
  '#fc5454',
  '#a85400',
  '#a80000',
  '#54fcfc',
  '#5050fc',
  '#0000a8',
  '#000000',
  '#545454',
  '#a8a8a8',
  '#fcfcfc',
] as const;
const METAL12_TEXT_COLOR = '#ececec';

// TEMPERATE.PAL palette index ranges for terrain rendering
// These are the actual palette indices from the extracted TEMPERAT.PAL
const PAL_GRASS_START = 144;  // indices 144-155: green terrain ramp (light→dark)
const PAL_GRASS_COUNT = 12;
const PAL_WATER_START = 96;   // indices 96-102: animated water cycle (ping-pong)
const PAL_WATER_COUNT = 7;
const PAL_ROCK_START = 128;   // indices 128-143: gray ramp (light→dark)
const PAL_ROCK_COUNT = 16;
const PAL_DIRT_START = 80;    // indices 80-95: sand/dirt ramp (gold→dark brown)
const PAL_DIRT_COUNT = 16;
const PAL_GREEN_HP = 120;     // bright green [0,255,0]
const PAL_RED_HP = 104;       // red [190,0,0]
const RADAR_CURSOR_LTGREEN = 'rgb(84,252,84)';
// C++ const.cpp GroundColor/SnowColor[LAND_COUNT], consumed by
// CellClass::Cell_Color(false) for radar terrain pixels.
const RADAR_LAND_COLOR = [
  141, // LAND_CLEAR
  141, // LAND_ROAD
  172, // LAND_WATER
  21,  // LAND_ROCK
  21,  // LAND_WALL
  158, // LAND_TIBERIUM
  141, // LAND_BEACH
  141, // LAND_ROUGH
  174, // LAND_RIVER
  141, // TREE extension: TerrainClass over clear land
] as const;
const RADAR_TERRAIN_OBJECT_COLOR = 21; // C++ Render_Terrain(size==1)

function toCppRgbComponent(value: number): number {
  return (Math.max(0, Math.min(255, value)) >> 2) << 2;
}

export function cppDefaultAdjustedPaletteColor(r: number, g: number, b: number): [number, number, number] {
  // C++ OptionsClass::Adjust_Palette with default sliders still round-trips
  // each RGBClass through HSVClass and back. RGBClass stores 6-bit guns, so
  // HSV results are truncated through RGBClass(red >> 2, ...).
  const red = toCppRgbComponent(r);
  const green = toCppRgbComponent(g);
  const blue = toCppRgbComponent(b);
  const value = Math.max(red, green, blue);
  const white = Math.min(red, green, blue);
  const saturation = value !== 0 ? Math.floor(((value - white) * 255) / value) : 0;
  let hue = 0;

  if (saturation !== 0) {
    const delta = value - white;
    const r1 = Math.floor(((value - red) * 255) / delta);
    const g1 = Math.floor(((value - green) * 255) / delta);
    const b1 = Math.floor(((value - blue) * 255) / delta);
    let tmp: number;

    if (value === red) {
      tmp = white === green ? 5 * 256 + b1 : 1 * 256 - g1;
    } else if (value === green) {
      tmp = white === blue ? 1 * 256 + r1 : 3 * 256 - b1;
    } else {
      tmp = white === red ? 3 * 256 + g1 : 5 * 256 - r1;
    }
    hue = Math.floor(tmp / 6);
  }

  const scaledHue = hue * 6;
  const f = scaledHue % 255;
  const values: number[] = [];
  values[1] = value;
  values[2] = value;
  let tmp = Math.floor((saturation * f) / 255);
  values[3] = Math.floor((value * (255 - tmp)) / 255);
  values[4] = Math.floor((value * (255 - saturation)) / 255);
  values[5] = values[4];
  tmp = 255 - Math.floor((saturation * (255 - f)) / 255);
  values[6] = Math.floor((value * tmp) / 255);

  let section = Math.floor(scaledHue / 255);
  section += section > 4 ? -4 : 2;
  const outR = values[section] ?? 0;
  section += section > 4 ? -4 : 2;
  const outB = values[section] ?? 0;
  section += section > 4 ? -4 : 2;
  const outG = values[section] ?? 0;

  return [
    toCppRgbComponent(outR),
    toCppRgbComponent(outG),
    toCppRgbComponent(outB),
  ];
}

function paletteKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

const RA_COLOR_LTGREEN = 4;
const CPP_GROUND_ANIM_SORT_Y_OFFSET_LEPTONS = Math.round(14 * LEPTON_SIZE / CELL_SIZE);
const CPP_MAGIC_TRANSLUCENT_CONTROLS: readonly TranslucentControl[] = [
  { sourceColorIndex: 32, destColorIndex: 32, frac: 110 },
  { sourceColorIndex: 33, destColorIndex: 33, frac: 110 },
  { sourceColorIndex: 34, destColorIndex: 34, frac: 110 },
  { sourceColorIndex: 35, destColorIndex: 35, frac: 110 },
  { sourceColorIndex: 36, destColorIndex: 36, frac: 110 },
  { sourceColorIndex: 37, destColorIndex: 37, frac: 110 },
  { sourceColorIndex: 38, destColorIndex: 38, frac: 110 },
  { sourceColorIndex: 39, destColorIndex: 39, frac: 110 },
  { sourceColorIndex: RA_COLOR_BLACK, destColorIndex: RA_COLOR_BLACK, frac: 200 },
  { sourceColorIndex: RA_COLOR_WHITE, destColorIndex: RA_COLOR_BLACK, frac: 40 },
  { sourceColorIndex: RA_COLOR_LTGREY, destColorIndex: RA_COLOR_BLACK, frac: 80 },
  { sourceColorIndex: RA_COLOR_DKGREY, destColorIndex: RA_COLOR_BLACK, frac: 140 },
  { sourceColorIndex: RA_COLOR_LTGREEN, destColorIndex: RA_COLOR_BLACK, frac: 130 },
];

function pixelToNearestLepton(pixel: number): number {
  return Math.round(pixel * LEPTON_SIZE / CELL_SIZE);
}

function cppGroundAnimSortKey(anim: LogicAnim): { y: number; x: number } {
  return {
    y: pixelToNearestLepton(anim.y) + CPP_GROUND_ANIM_SORT_Y_OFFSET_LEPTONS,
    x: pixelToNearestLepton(anim.x),
  };
}

interface TerrainObjectSprite {
  name: string;
  x: number;
  y: number;
  sortX: number;
  sortY: number;
  logicIndexHint?: number;
}

type GroundLayerEntry =
  | {
      kind: 'terrain';
      sortX: number;
      sortY: number;
      order: number;
      terrain: TerrainObjectSprite;
    }
  | {
      kind: 'anim';
      sortX: number;
      sortY: number;
      order: number;
      anim: LogicAnim;
    }
  | {
      kind: 'structure';
      sortX: number;
      sortY: number;
      order: number;
      structure: MapStructure;
      structureIndex: number;
    }
  | {
      kind: 'entity';
      sortX: number;
      sortY: number;
      order: number;
      entity: Entity;
    };

export function buildCppDefaultPaletteAdjustmentMap(
  palette: readonly (readonly number[])[] | null,
): Map<number, [number, number, number]> {
  const map = new Map<number, [number, number, number]>();
  if (!palette) return map;

  for (const color of palette) {
    if (!color || color.length < 3) continue;
    const r = toCppRgbComponent(color[0] ?? 0);
    const g = toCppRgbComponent(color[1] ?? 0);
    const b = toCppRgbComponent(color[2] ?? 0);
    const adjusted = cppDefaultAdjustedPaletteColor(r, g, b);
    if (adjusted[0] !== r || adjusted[1] !== g || adjusted[2] !== b) {
      map.set(paletteKey(r, g, b), adjusted);
    }
  }

  return map;
}

export function applyCppDefaultPaletteAdjustment(
  data: Uint8ClampedArray | Uint8Array,
  adjustment: ReadonlyMap<number, readonly [number, number, number]>,
): void {
  if (adjustment.size === 0) return;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const adjusted = adjustment.get(paletteKey(data[i], data[i + 1], data[i + 2]));
    if (!adjusted) continue;
    data[i] = adjusted[0];
    data[i + 1] = adjusted[1];
    data[i + 2] = adjusted[2];
  }
}

export function waterPaletteCycleShift(elapsedMs: number): number {
  // C++ conquer.cpp:1667-1677 rotates CYCLE_COLOR_START..+6 from
  // Color_Cycle(), which is driven by SystemTimerClass in Sync_Delay rather
  // than by game logic frames. TIMER_SECOND/4 is one quarter-second.
  return Math.floor(Math.max(0, elapsedMs) / 250) % PAL_WATER_COUNT;
}

export function applyWaterPaletteCycle(
  data: Uint8ClampedArray | Uint8Array,
  palette: number[][] | null,
  shift: number,
): void {
  if (!palette || shift % PAL_WATER_COUNT === 0) return;
  const colorMap = new Map<string, number[]>();
  for (let i = 0; i < PAL_WATER_COUNT; i++) {
    const src = palette[PAL_WATER_START + i];
    const dst = palette[PAL_WATER_START + ((i - shift + PAL_WATER_COUNT) % PAL_WATER_COUNT)];
    if (src && dst) colorMap.set(`${src[0]},${src[1]},${src[2]}`, dst);
  }
  if (colorMap.size === 0) return;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const dst = colorMap.get(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    if (!dst) continue;
    data[i] = dst[0];
    data[i + 1] = dst[1];
    data[i + 2] = dst[2];
  }
}

type BuildingFrameTableEntry = {
  idleFrame: number;
  damageFrame: number;
  idleAnimCount: number;
  idleAnimRate?: number;
  activeAnimCount?: number;
  activeAnimRate?: number;
};

// Building frame layout table — maps structure type to idle/damage frame info.
// Prevents generic halfFrames cycling from treating construction/fill-level frames as animation.
export const BUILDING_FRAME_TABLE: Record<string, BuildingFrameTableEntry> = {
  // Animated idle buildings (C++ bdata.cpp:3054-3096 _anims table)
  fact: { idleFrame: 0, damageFrame: 26, idleAnimCount: 0, activeAnimCount: 26, activeAnimRate: 3 },  // C++ BSTATE_IDLE is static; BSTATE_ACTIVE is 0,26,3
  weap: { idleFrame: 0, damageFrame: 16, idleAnimCount: 32 },  // 32 frames: bay door (post-Cluster A extraction)
  barr: { idleFrame: 0, damageFrame: 10, idleAnimCount: 10 },  // 20 frames: door animation (C++ BSTATE_IDLE 0,10,3)
  tent: { idleFrame: 0, damageFrame: 10, idleAnimCount: 10 },  // 20 frames: door animation (C++ BSTATE_IDLE 0,10,3)
  silo: { idleFrame: 0, damageFrame: 5, idleAnimCount: 0 },    // 10 frames: fill level (static, NOT animation)
  proc: { idleFrame: 0, damageFrame: 16, idleAnimCount: 0 },   // 32 frames: conveyor states
  fix:  { idleFrame: 0, damageFrame: 12, idleAnimCount: 0 },   // 24 frames: repair bay states
  dome: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // Static in C++: omitted from bdata.cpp _anims table
  powr: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // Static in C++: omitted from bdata.cpp _anims table, so default Count=1
  hbox: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // 2 frames: pillbox
  bio:  { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // 3 frames: frame 2 = rubble
  miss: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // 3 frames: frame 2 = rubble
  fcom: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // 2 frames: forward command post
  apwr: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // 2 frames: advanced power plant
  afld: { idleFrame: 0, damageFrame: 8, idleAnimCount: 0 },    // 16 frames: airfield states
  hpad: { idleFrame: 0, damageFrame: 7, idleAnimCount: 0 },    // 14 frames: helipad states
  kenn: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // 2 frames: kennel
  pbox: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // 2 frames: pillbox
  // Animated buildings (have genuine idle animation loops)
  hosp: { idleFrame: 0, damageFrame: 4, idleAnimCount: 4 },    // 9 frames: red cross blinks
  tsla: { idleFrame: 0, damageFrame: 10, idleAnimCount: 10 },  // 20 frames: sparking animation
  gap:  { idleFrame: 0, damageFrame: 32, idleAnimCount: 32 },  // 64 frames: shroud sweep
  iron: { idleFrame: 0, damageFrame: 11, idleAnimCount: 11 },  // 22 frames: power glow
  pdox: { idleFrame: 0, damageFrame: 29, idleAnimCount: 29 },  // 58 frames: energy effect
  atek: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // Static in C++: omitted from bdata.cpp _anims table, so default Count=1
  stek: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // Static in C++: omitted from bdata.cpp _anims table, so default Count=1
  mslo: { idleFrame: 0, damageFrame: 4, idleAnimCount: 4 },    // Missile silo
  // Ant structures
  quee: { idleFrame: 0, damageFrame: 8, idleAnimCount: 8 },    // queen chamber pulses
  lar1: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // small larva
  lar2: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // large larva
  // Bridge barrels (destroyable)
  barl: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // explosive barrel
  brl3: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },    // bridge barrel
  // Civilian structures
  v19:  { idleFrame: 0, damageFrame: 14, idleAnimCount: 14, idleAnimRate: 4 },   // Oil pump (C++ BSTATE_IDLE 0,14,4)
  // Naval production structures
  syrd: { idleFrame: 0, damageFrame: 8, idleAnimCount: 0 },    // C++ _anims omits STRUCT_SHIP_YARD: idle is static
  spen: { idleFrame: 0, damageFrame: 8, idleAnimCount: 0 },    // C++ _anims omits STRUCT_SUB_PEN: idle is static
  minp: { idleFrame: 0, damageFrame: 4, idleAnimCount: 0 },    // Allied mine/ore processor
  minv: { idleFrame: 0, damageFrame: 4, idleAnimCount: 0 },    // Soviet mine/ore processor
  // Civilian buildings (most have 2 frames: normal + damaged)
  v01: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
  v02: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
  v03: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
  v04: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
  v05: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
  v06: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
  v07: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
  v08: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
  v09: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
  v10: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
  v11: { idleFrame: 0, damageFrame: 1, idleAnimCount: 0 },
};

function usesActiveBuildingAnimation(s: MapStructure): boolean {
  // C++ bdata.cpp registers FACT/FACF's 26-frame sequence only for
  // BSTATE_ACTIVE. BuildingClass enters it from Mission_Repair after the yard
  // receives RADIO_BUILDING, then returns to idle on RADIO_COMPLETE/OVER_OUT.
  return (s.type === 'FACT' || s.type === 'FACF') && s.mission === Mission.REPAIR;
}

function buildingAnimationFrame(
  baseFrame: number,
  animCount: number,
  rate: number,
  totalFrames: number,
  tick: number,
): number {
  const availFromBase = Math.max(1, totalFrames - baseFrame);
  const safeAnimCount = Math.max(1, Math.min(animCount, availFromBase));
  return baseFrame + (Math.floor(tick / Math.max(1, rate)) % safeAnimCount);
}

// Wall types that use auto-connection sprites
const WALL_SPRITE_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK', 'CYCL', 'WOOD']);
const WALL_OVERLAY_SHEETS: Record<string, string> = {
  SBAG: 'sbag',
  CYCL: 'cycl',
  BRIK: 'brik',
  BARB: 'barb',
  WOOD: 'wood',
  FENC: 'fenc',
};

const OVERLAY_WOOD_CRATE = 21;
const OVERLAY_STEEL_CRATE = 22;
const OVERLAY_WATER_CRATE = 24;

function overlayCrateSheet(overlayId: number): string {
  switch (overlayId) {
    case OVERLAY_WOOD_CRATE: return 'wcrate';
    case OVERLAY_STEEL_CRATE: return 'scrate';
    case OVERLAY_WATER_CRATE: return 'wwcrate';
    default: return '';
  }
}

function overlayWallType(overlayId: number): string {
  switch (overlayId) {
    case 0: return 'SBAG';
    case 1: return 'CYCL';
    case 2: return 'BRIK';
    case 3: return 'BARB';
    case 4: return 'WOOD';
    case 23: return 'FENC';
    default: return '';
  }
}

/** Compute NESW connection bitmask for wall auto-connection.
 *  Checks 4 cardinal neighbors for same-type wall → 4-bit mask (N=1, E=2, S=4, W=8). */
function wallConnectionMask(map: GameMap, cx: number, cy: number, wallType: string): number {
  let mask = 0;
  if (map.getWallType(cx, cy - 1) === wallType) mask |= 1; // N
  if (map.getWallType(cx + 1, cy) === wallType) mask |= 2; // E
  if (map.getWallType(cx, cy + 1) === wallType) mask |= 4; // S
  if (map.getWallType(cx - 1, cy) === wallType) mask |= 8; // W
  return mask;
}

export interface Effect {
  type: 'explosion' | 'muzzle' | 'blood' | 'tesla' | 'projectile' | 'marker' | 'text';
  x: number;
  y: number;
  frame: number;
  maxFrames: number;
  size: number;
  // Sprite-based effect rendering
  sprite?: string;       // sprite sheet name (e.g. 'fball1', 'piff')
  spriteStart?: number;  // first frame index in the sheet
  // Muzzle flash color (RGB string, e.g. '255,200,60')
  muzzleColor?: string;
  // Projectile travel
  startX?: number;       // projectile origin
  startY?: number;
  endX?: number;         // projectile destination
  endY?: number;
  projStyle?: 'bullet' | 'fireball' | 'shell' | 'rocket' | 'grenade';
  isArcing?: boolean;  // C4: ballistic arc trajectory — arc height scales with travel distance
  // Sprite-based projectile rendering (Cluster C: wires SHP sprites into effect path)
  // These are *separate* from `sprite` because projectiles need custom interpolation + arc logic.
  projImage?: string;         // sprite sheet name (e.g. 'dragon', 'missile', '120mm', 'bomb', 'v2rl', 'fball1')
  projRotates?: boolean;      // C++ Rotates=yes: select frame from 32-dir facing (velocity vector)
  projTumble?: boolean;       // C++ Frames>0 without Rotates: cycle through tumble frames per-tick
  projTumbleFrames?: number;  // number of tumble frames (C++ BulletTypeClass::Frames)
  projTranslucent?: boolean;  // C++ Translucent=yes: SHAPE_GHOST approximation (alpha 0.5)
  projShadow?: boolean;       // C++ IsShadow (Shadow=yes default): draw ground shadow below airborne bullet
  projFlameTrail?: boolean;   // C++ IsFlameEquipped: smoke puffs along flight path (Cluster C3)
  projArcPx?: number;         // distance-derived arc height in pixels (Cluster C6, replaces hardcoded 30)
  // Marker color (for move/attack command feedback)
  markerColor?: string;
  // Floating text (e.g. "+100" credits)
  text?: string;
  textColor?: string;
  // Blend mode for additive/screen effects (C++ SHAPE_GHOST + TranslucentTable)
  blendMode?: 'screen' | 'lighter';
  // Parachuted projectile visual (C++ bullet.cpp:573,796: ANIM_PARA_BOMB sprite during descent)
  isParachuted?: boolean;
  // Looping support for persistent effects (fire, smoke)
  loopStart?: number;
  loopEnd?: number;
  loops?: number;  // number of times to loop (-1 = infinite)
  // Animation chaining (fire → smoke)
  followUp?: string;  // sprite name for follow-up effect
  // C++ AnimClass objects also occupy Logic slots and the fixed AnimClass heap
  // even when TS only needs a visual effect. These slots affect same-tick
  // BulletClass scheduling and allocation failure behavior.
  cppLogicSlot?: boolean;
  logicIndexHint?: number;
  attachedStructureIndex?: number;
}

// Pseudo-random hash for terrain variation
function cellHash(cx: number, cy: number): number {
  let h = (cx * 374761 + cy * 668265) | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  return ((h >> 16) ^ h) & 0xff;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private pal: number[][] | null = null;
  private palTheatre = ''; // which theatre the current palette is for
  private paletteAdjustmentCache: { palette: number[][]; map: Map<number, [number, number, number]> } | null = null;
  screenShake = 0;      // remaining shake ticks
  /** C++ WASM agent harness returns immediately from Shake_The_Screen. */
  suppressScreenShake = false;
  private screenShakeLastOffset = 0;
  /** Legacy state retained for older subsystem contexts. C++ does not have a
   *  generic yellow full-screen explosion flash; nukes use whitePaletteFade. */
  screenFlash = 0;
  /** Palette whiteout countdown for nuke detonation.
   *  C++ anim.cpp:955,983 — Fade_Palette_To(WhitePalette, 30) then Fade_Palette_To(GamePalette, 15).
   *  We emulate with a full-screen white overlay that ramps in over 30 ticks, holds briefly,
   *  then fades out. Counter starts at whitePaletteFadeMax and decrements each frame. */
  whitePaletteFade = 0;
  whitePaletteFadeMax = 45;
  attackMoveMode = false; // show attack-move cursor indicator
  sellMode = false;      // show sell cursor indicator
  repairMode = false;    // show repair cursor indicator
  private scoreAnimStartTime = 0; // timestamp when score screen first appeared
  private scoreAnimActive = false; // whether score animation is running
  repairingStructures = new Set<number>(); // indices of structures being repaired
  corpses: Array<{
    x: number;
    y: number;
    type: UnitType;
    facing: number;
    isInfantry: boolean;
    isAnt: boolean;
    alpha: number;
    deathVariant: number;
    cppAnimStartTick?: number;
    logicIndexHint?: number;
    cppLogicReleased?: boolean;
  }> = [];
  logicAnims: LogicAnim[] = [];
  showHelp = false;     // F1 help overlay
  difficulty: 'easy' | 'normal' | 'hard' = 'normal';
  idleCount = 0;        // number of idle player units
  /** Render interpolation alpha (0-1): fraction of tick elapsed since last update.
   *  Used to interpolate entity positions between game ticks for smooth 60fps rendering. */
  interpolationAlpha = 1;
  minimapAlerts: Array<{ cx: number; cy: number; tick: number }> = [];
  // Sidebar data (set by game each frame)
  sidebarCredits = 0;  // animated display credits
  sidebarSiloCapacity = 0; // silo storage capacity for credits display
  sidebarPowerProduced = 0;
  sidebarPowerConsumed = 0;
  sidebarItems: SidebarItem[] = [];
  sidebarQueue: Map<string, { item: ProductionItem; progress: number; queueCount: number }> = new Map();
  sidebarHackPreventedTypes: Set<string> = new Set();
  sidebarScroll = 0;
  sidebarW = 80 * RESFACTOR;
  leftStripScroll = 0;
  rightStripScroll = 0;
  hasRadar = false; // C++ IsRadarActive || PlayerPtr->IsGPSActive
  doesRadarExist = false; // C++ DoesRadarExist || PlayerPtr->IsGPSActive
  radarZoomEnabled = false; // C++ SidebarClass::Zoom enabled state
  radarZoomPressed = false; // C++ sticky Zoom button pressed state
  radarCoverFrame: number | null = null; // opening/closing natoradr/ussrradr frame override
  /** U6: Fullscreen radar toggle — enlarged minimap overlay */
  isRadarFullscreen = false;
  isRadarJammed = false; // C++ RadarClass::IsRadarJammed from enemy MRJ coverage.
  /** Raw SHADOW.SHP pixels for C++ SHAPE_GHOST shroud edge remapping. */
  private shadowSourcePixels: {
    source: CanvasImageSource;
    width: number;
    height: number;
    data: Uint8ClampedArray;
  } | null = null;
  private shadowTransTableCache: { palette: number[][]; tables: Map<number, Uint8Array> } | null = null;
  crates: Array<{ x: number; y: number; type: string }> = [];
  evaMessages: Array<{ text: string; tick: number; systemTick?: number }> = [];
  selectedStructure: { type: string; hp: number; maxHp: number; name: string } | null = null;
  selectedStructureIdx = -1; // index into structures[] for selection highlight
  missionTimer = 0; // 0 = hidden
  timerTabFlashTicks = 0; // C++ Map.FlasherTimer branch for mission timer tab highlight
  missionName = ''; // mission title shown as overlay at start
  theatre = 'TEMPERATE'; // map theatre (affects terrain colors)
  musicTrack = ''; // currently playing music track name
  gameSpeed = 2; // player game speed (1/2/4x) — synced from Game each frame
  // Custom cursor state
  cursorType: CursorType = CursorType.DEFAULT;
  cursorX = 0;
  cursorY = 0;
  // Placement ghost
  placementItem: ProductionItem | null = null;
  placementCx = 0;
  placementCy = 0;
  private _selectedIds: Set<number> = new Set();
  // Tileset rendering cache (theatre-aware)
  private tilesetImage: HTMLImageElement | null = null;
  private tilesetMeta: TilesetMeta | null = null;
  private tilesetReady = false;
  private tilesetTheatre = ''; // which theatre the cached tileset is for
  private cycledTilesetCache = new Map<string, HTMLCanvasElement>();
  paletteCycleShift = 0;
  private paletteCycleInitialized = false;
  private paletteCycleAccumMs = 0;
  private tilesetPixelCache: {
    source: CanvasImageSource;
    width: number;
    height: number;
    data: Uint8ClampedArray;
  } | null = null;
  private radarBrightenTableCache: { palette: number[][]; table: Uint8Array } | null = null;
  private radarYellowTableCache: { palette: number[][]; table: Uint8Array } | null = null;
  private pendingTerrainObjectSprites: TerrainObjectSprite[] = [];
  placementValid = false;
  placementCells: boolean[] | null = null; // per-cell passability for placement preview
  // Dynamic player houses (set by game on start, used for sidebar filtering)
  playerHouses: Set<House> = new Set([House.Spain, House.Greece]);
  /** C++ PlayerPtr house, used by radar spy blip remapping. */
  playerHouse: House = House.Spain;
  /** PlayerPtr side for house-specific sidebar/radar art. */
  playerFaction: Faction = 'allied';
  // Superweapon state (set by game each frame)
  superweapons = new Map<string, SuperweaponState>();
  superweaponCursorMode: SuperweaponType | null = null;
  chronoTankTargeting = false;

  // Pause menu state (set by Game each frame)
  pauseMenuOpen = false;
  pauseMenuHighlight = 0; // keyboard nav index (0-5)
  pauseMenuMusicVolume = 0.4;
  pauseMenuSfxVolume = 0.35;
  pauseMenuGameSpeed = 2;

  // Power bar animation state (C++ power.cpp parity)
  private powerHeight = 0;          // current animated POWER_HEIGHT units
  private drainHeight = 0;          // current animated POWER_HEIGHT units
  private desiredPowerHeight = 0;   // target height
  private desiredDrainHeight = 0;   // target height
  private powerDir = 0;             // animation direction: -1, 0, 1
  private drainDir = 0;
  private powerBounce = 0;          // bounce counter (12→0)
  private drainBounce = 0;
  private recordedPower = -1;       // C++ Init_Clear starts recorded values at -1
  private recordedDrain = -1;
  private powerFlashTimer = 0;      // ticks remaining for flash effect
  private sidebarChromeSignature: string | null = null;
  private powerChromeDirty = false;
  private sidebarChromeDirty = true; // SidebarClass::Init_Clear starts IsToRedraw=true.
  private sidebarChromeCompleteDirty = true; // First Draw_It runs under GScreen complete redraw.
  private sidebarChromeFrame = 0; // SIDE2/SIDE3 frame cached by the last sidebar chrome redraw.
  private powerChromeAboveSidebar = false;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.width = canvas.width;
    this.height = canvas.height;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** C++ Power_Height() raw value (power.cpp:394-417) */
  static powerBarRawHeight(value: number): number {
    const POWER_HEIGHT = Renderer.POWER_HEIGHT; // 110 (C++ power.h)
    const STEP_LEVEL = Renderer.POWER_STEP_LEVEL;
    const STEP_FACTOR = Renderer.POWER_STEP_FACTOR;
    const num = Math.trunc(value / STEP_LEVEL);
    let retval = 0;
    let remaining = value;
    for (let lp = 0; lp < num; lp++) {
      retval = retval + Math.trunc(((POWER_HEIGHT - 2) - retval) / STEP_FACTOR);
      remaining -= STEP_LEVEL;
    }
    if (remaining > 0) {
      retval = retval + Math.trunc(
        (Math.trunc(((POWER_HEIGHT - 2) - retval) / STEP_FACTOR) * remaining) / STEP_LEVEL
      );
    }
    retval = Math.max(0, Math.min(POWER_HEIGHT - 2, retval));
    return retval;
  }

  /** C++ Power_Height() → Draw_It rescaling (power.cpp:394-417, 229) */
  static powerBarHeight(value: number): number {
    const rawHeight = Renderer.powerBarRawHeight(value);
    // C++ Draw_It HIRES rescaling (power.cpp:229): (raw * 153) / 107
    // At LORES (RESFACTOR=1), raw pixel height is used directly (no rescaling).
    return (RESFACTOR as number) === 1 ? rawHeight : Math.floor(rawHeight * 153 / 107);
  }

  /** Update power bar bounce animation — call once per game tick (C++ PowerClass::AI) */
  updatePowerAnimation(): void {
    const produced = this.sidebarPowerProduced;
    const consumed = this.sidebarPowerConsumed;
    const oldPower = this.powerHeight;
    const oldDrain = this.drainHeight;
    let powerDirty = false;

    // Detect power change
    if (produced !== this.recordedPower) {
      this.desiredPowerHeight = Renderer.powerBarRawHeight(produced);
      this.recordedPower = produced;
      this.powerBounce = 12;
      if (this.powerHeight > this.desiredPowerHeight) this.powerDir = -1;
      else if (this.powerHeight < this.desiredPowerHeight) this.powerDir = 1;
      else this.powerBounce = 0;
    }

    // Detect drain change
    if (consumed !== this.recordedDrain) {
      this.desiredDrainHeight = Renderer.powerBarRawHeight(consumed);
      this.recordedDrain = consumed;
      this.drainBounce = 12;
      if (this.drainHeight > this.desiredDrainHeight) this.drainDir = -1;
      else if (this.drainHeight < this.desiredDrainHeight) this.drainDir = 1;
      else this.drainBounce = 0;
    }

    // Animate drain height
    if (this.drainBounce > 0 && this.drainHeight === this.desiredDrainHeight) {
      this.drainBounce--;
      powerDirty = true;
    } else if (this.drainHeight !== this.desiredDrainHeight) {
      this.drainHeight += this.drainDir; // C++ increments by exactly 1 per tick (power.cpp:318-319)
      if ((this.drainDir > 0 && this.drainHeight > this.desiredDrainHeight) ||
          (this.drainDir < 0 && this.drainHeight < this.desiredDrainHeight)) {
        this.drainHeight = this.desiredDrainHeight;
      }
    }

    // Animate power height
    if (this.powerBounce > 0 && this.powerHeight === this.desiredPowerHeight) {
      this.powerBounce--;
      powerDirty = true;
    } else if (this.powerHeight !== this.desiredPowerHeight) {
      this.powerHeight += this.powerDir; // C++ increments by exactly 1 per tick (power.cpp:330-331)
      if ((this.powerDir > 0 && this.powerHeight > this.desiredPowerHeight) ||
          (this.powerDir < 0 && this.powerHeight < this.desiredPowerHeight)) {
        this.powerHeight = this.desiredPowerHeight;
      }
    }

    // Flash timer countdown
    if (this.powerFlashTimer > 0) {
      this.powerFlashTimer--;
      powerDirty = true;
    }

    // Trigger flash when drain exceeds power
    if (consumed > produced && produced > 0 && this.powerFlashTimer === 0) {
      this.powerFlashTimer = 15; // C++ TICKS_PER_SECOND = 15 (defines.h:3031)
      powerDirty = true;
    }

    if (oldPower !== this.powerHeight || oldDrain !== this.drainHeight) {
      powerDirty = true;
    }
    if (powerDirty) {
      this.powerChromeDirty = true;
    }
  }

  markSidebarChromeDirty(complete = false): void {
    this.sidebarChromeDirty = true;
    if (complete) this.sidebarChromeCompleteDirty = true;
  }

  syncSidebarChromeItems(items: readonly SidebarItem[] = this.sidebarItems): void {
    const chromeSignature = [
      this.playerFaction,
      items.map(item => item.type).join(','),
    ].join('|');
    if (chromeSignature !== this.sidebarChromeSignature) {
      this.sidebarChromeSignature = chromeSignature;
      this.markSidebarChromeDirty();
    }
  }

  /** Consume C++ sidebar/power chrome dirty flags for one Map.Render pass.
   *
   *  The TS renderer paints a fresh canvas for screenshots, while C++ keeps
   *  this chrome in HidPage/SeenBuff across frames. Agent-step batches still
   *  need to advance that cached layering on every simulated render tick. */
  advanceSidebarChromeCache(): void {
    if (this.sidebarChromeDirty) {
      this.sidebarChromeFrame = this.sidebarChromeCompleteDirty ? 0 : 1;
      this.powerChromeAboveSidebar = false;
    } else if (this.powerChromeDirty) {
      this.powerChromeAboveSidebar = true;
    }
    this.powerChromeDirty = false;
    this.sidebarChromeDirty = false;
    this.sidebarChromeCompleteDirty = false;
  }

  /** Is the player faction allied? (for house-specific sidebar art) */
  private isPlayerAllied(): boolean {
    return this.playerFaction !== 'soviet';
  }

  /** C++ theater-specific SHPs use the same logical name with a theater suffix.
   * The extractor stores snow variants as *_snow and falls back to base art. */
  private theatreSheetName(assets: AssetManager, baseName: string): string {
    if (this.theatre === 'SNOW') {
      const snowName = `${baseName}_snow`;
      if (assets.hasSheet(snowName)) return snowName;
    }
    return baseName;
  }

  /** Get an RGB string from the current theatre palette, with optional brightness offset */
  private palColor(idx: number, brightnessOffset = 0): string {
    if (!this.pal) return '#555';
    const c = this.pal[idx];
    if (!c) return '#555';
    const r = Math.max(0, Math.min(255, c[0] + brightnessOffset));
    const g = Math.max(0, Math.min(255, c[1] + brightnessOffset));
    const b = Math.max(0, Math.min(255, c[2] + brightnessOffset));
    return `rgb(${r},${g},${b})`;
  }

  private beginScreenShake(ctx: CanvasRenderingContext2D): boolean {
    if (this.screenShake <= 0) return false;
    if (this.suppressScreenShake) {
      this.screenShake = 0;
      this.screenShakeLastOffset = 0;
      return false;
    }

    // C++ conquer.cpp:5523-5561 uses Sim_Random_Pick(0,2)-1 and blits the
    // seen page up/down by exactly two pixels. There is no horizontal offset.
    let nextOffset = this.screenShakeLastOffset;
    do {
      nextOffset = NonCriticalRandom.nextInRange(0, 2) - 1;
    } while (nextOffset === this.screenShakeLastOffset);
    this.screenShakeLastOffset = nextOffset;

    ctx.save();
    ctx.translate(0, nextOffset * 2);
    this.screenShake--;
    if (this.screenShake <= 0) this.screenShakeLastOffset = 0;
    return true;
  }

  render(
    camera: Camera,
    map: GameMap,
    entities: Entity[],
    structures: MapStructure[],
    assets: AssetManager,
    input: InputState,
    selectedIds: Set<number>,
    effects: Effect[],
    tick: number,
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);
    this._selectedIds = selectedIds;

    // Cache palette reference from assets (refresh if theatre changed)
    if (!this.pal || this.palTheatre !== this.theatre) {
      this.pal = assets.getTheatrePalette(this.theatre);
      this.palTheatre = this.theatre;
    }

    // Cache tileset atlas reference from assets (refresh if theatre changed)
    if (!this.tilesetReady || this.tilesetTheatre !== this.theatre) {
      if (assets.hasTileset(this.theatre)) {
        this.tilesetImage = assets.getTilesetImage(this.theatre);
        this.tilesetMeta = assets.getTilesetMeta(this.theatre);
        this.tilesetReady = true;
        this.tilesetTheatre = this.theatre;
      } else {
        this.tilesetImage = null;
        this.tilesetMeta = null;
        this.tilesetReady = false;
        this.tilesetTheatre = '';
      }
    }

    const shaking = this.beginScreenShake(ctx);

    this._cachedAssets = assets; // cache for helpers that lack the param
    this.pendingTerrainObjectSprites = [];
    this.renderTerrain(camera, map, tick, assets, false);
    this.renderDecals(camera, map, assets);
    this.renderOverlays(camera, map, tick, assets);
    this.renderCorpses(camera, map, assets, tick);
    this.renderGroundLayer(camera, map, entities, structures, assets, selectedIds, tick);
    this.renderCrates(camera, map, tick);
    this.renderTargetLines(camera, entities, selectedIds);
    this.renderWaypoints(camera, entities, selectedIds);
    this.renderLogicAnims(camera, assets, 'air');
    this.renderEntities(
      camera,
      map,
      entities.filter(entity => cppEntityRenderLayer(entity) === 'top'),
      assets,
      selectedIds,
      tick,
    );
    this.renderEffects(camera, effects, assets);
    this.renderFogOfWar(camera, map, assets);

    if (shaking) {
      ctx.restore();
    }

    // Nuke palette whiteout overlay — C++ Fade_Palette_To(WhitePalette, 30) → GamePalette(15).
    // Ramp-in phase (first 30 ticks of the countdown, elapsed 0..29):
    //   whiteAlpha ramps from 0 → 1 linearly.
    // Ramp-out phase (elapsed 30..44): whiteAlpha ramps 1 → 0 over 15 ticks.
    // Produces the source-backed bloom-and-fade whiteout.
    if (this.whitePaletteFade > 0) {
      const fadeIn = 30;
      const holdOut = 15;
      const elapsed = this.whitePaletteFadeMax - this.whitePaletteFade;
      let whiteAlpha: number;
      if (elapsed < fadeIn) {
        whiteAlpha = elapsed / fadeIn; // 0 → 1 over first 30 ticks
      } else {
        const outElapsed = elapsed - fadeIn;
        whiteAlpha = Math.max(0, 1 - outElapsed / holdOut); // 1 → 0 over final 15 ticks
      }
      ctx.fillStyle = `rgba(255,255,255,${whiteAlpha})`;
      ctx.fillRect(0, 0, this.width, this.height);
      this.whitePaletteFade--;
    }

    // Placement ghost preview
    if (this.placementItem) {
      this.renderPlacementGhost(camera, assets);
    }

    this.renderSelectionBox(input);
    if (this.attackMoveMode) this.renderAttackMoveIndicator(input);
    if (this.sellMode) this.renderModeLabel(input, 'SELL', 'rgba(255,200,60,0.9)');
    if (this.repairMode) this.renderModeLabel(input, 'REPAIR', 'rgba(80,255,80,0.9)');
    this.renderOffscreenIndicators(camera, entities, selectedIds);
    this.syncSidebarChromeItems();
    this.advanceSidebarChromeCache();
    this.renderSidebar(assets);
    this.renderMinimap(map, entities, structures, camera, assets);
    this.renderSidebarButtonRow(assets);
    if (this.shouldRedrawPowerBarAfterSidebar()) {
      this.renderVerticalPowerBar(
        assets,
        this.width - this.sidebarW,
        this.sidebarPowerConsumed > this.sidebarPowerProduced && this.sidebarPowerProduced > 0,
      );
    }
    // U6: Fullscreen radar overlay
    if (this.isRadarFullscreen && this.hasRadar) {
      this.renderFullscreenRadar(map, entities, structures, camera);
    }

    if (this.showHelp) this.renderHelpOverlay();
    this.renderCursor(assets);
  }

  // ─── Layer Isolation (comparison mode) ───────────────────

  /** Render a single layer in isolation and return its data URL.
   *  Used by the comparison test harness to capture per-layer screenshots. */
  renderLayer(
    layer: 'terrain' | 'units' | 'buildings' | 'overlays' | 'full-no-ui',
    camera: Camera,
    map: GameMap,
    entities: Entity[],
    structures: MapStructure[],
    assets: AssetManager,
    selectedIds: Set<number>,
    effects: Effect[],
    tick: number,
  ): string | null {
    const ctx = this.ctx;

    // Cache palette + tileset if not yet loaded (refresh if theatre changed)
    if (!this.pal || this.palTheatre !== this.theatre) {
      this.pal = assets.getTheatrePalette(this.theatre);
      this.palTheatre = this.theatre;
    }
    if (!this.tilesetReady || this.tilesetTheatre !== this.theatre) {
      if (assets.hasTileset(this.theatre)) {
        this.tilesetImage = assets.getTilesetImage(this.theatre);
        this.tilesetMeta = assets.getTilesetMeta(this.theatre);
        this.tilesetReady = true;
        this.tilesetTheatre = this.theatre;
      } else {
        this.tilesetImage = null;
        this.tilesetMeta = null;
        this.tilesetReady = false;
        this.tilesetTheatre = '';
      }
    }

    ctx.clearRect(0, 0, this.width, this.height);

    switch (layer) {
      case 'terrain':
        this.renderTerrain(camera, map, tick, assets);
        break;
      case 'units':
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, this.width, this.height);
        this.renderEntities(camera, map, entities, assets, selectedIds, tick);
        break;
      case 'buildings':
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, this.width, this.height);
        this.renderStructures(camera, map, structures, assets, tick);
        break;
      case 'overlays':
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, this.width, this.height);
        this.renderOverlays(camera, map, tick, assets);
        break;
      case 'full-no-ui':
        this.pendingTerrainObjectSprites = [];
        this.renderTerrain(camera, map, tick, assets, false);
        this.renderDecals(camera, map, assets);
        this.renderOverlays(camera, map, tick, assets);
        this.renderCorpses(camera, map, assets, tick);
        this.renderGroundLayer(camera, map, entities, structures, assets, selectedIds, tick);
        this.renderCrates(camera, map, tick);
        this.renderLogicAnims(camera, assets, 'air');
        this.renderEntities(
          camera,
          map,
          entities.filter(entity => cppEntityRenderLayer(entity) === 'top'),
          assets,
          selectedIds,
          tick,
        );
        this.renderEffects(camera, effects, assets);
        break;
    }

    try {
      this.applyGamePaletteAdjustment();
      return ctx.canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  private getGamePaletteAdjustment(): Map<number, [number, number, number]> | null {
    if (!this.pal) return null;
    if (!this.paletteAdjustmentCache || this.paletteAdjustmentCache.palette !== this.pal) {
      this.paletteAdjustmentCache = {
        palette: this.pal,
        map: buildCppDefaultPaletteAdjustmentMap(this.pal),
      };
    }
    return this.paletteAdjustmentCache.map;
  }

  finalizeFramePalette(): void {
    this.applyGamePaletteAdjustment();
  }

  private applyGamePaletteAdjustment(): void {
    const adjustment = this.getGamePaletteAdjustment();
    if (!adjustment || adjustment.size === 0) return;

    try {
      const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
      applyCppDefaultPaletteAdjustment(imageData.data, adjustment);
      this.ctx.putImageData(imageData, 0, 0);
    } catch {
      // Some canvas backends can reject pixel reads. Rendering should continue;
      // the parity harnesses run same-origin and exercise this path.
    }
  }

  // ─── Custom Cursor (C++ MOUSE.SHP sprite-based) ──────────

  /** C++ mouse.cpp:345-391 MouseControl table: [startFrame, frameCount, frameRate, smallFrame, hotX, hotY]
   *  Hotspots are HIRES values (WD=29, HT=23). LORES cursor is 24x30. */
  private static readonly MOUSE_CONTROL: Record<string, [number, number, number, number, number]> = {
    // [startFrame, frameCount, frameRate, hotX, hotY] — hotspot in LORES pixels (24x30)
    default:      [0,   1,  0,  0,  0],
    n:            [1,   1,  0,  12, 0],
    ne:           [2,   1,  0,  24, 0],
    e:            [3,   1,  0,  24, 15],
    se:           [4,   1,  0,  24, 30],
    s:            [5,   1,  0,  12, 30],
    sw:           [6,   1,  0,  0,  30],
    w:            [7,   1,  0,  0,  15],
    nw:           [8,   1,  0,  0,  0],
    nomove:       [14,  1,  0,  12, 15],
    move:         [10,  4,  4,  12, 15],
    attack:       [21,  8,  4,  12, 15],
    select:       [15,  6,  4,  12, 15],
    sell:         [68,  12, 2,  12, 15],
    repair:       [35,  24, 2,  12, 15],
    enter:        [113, 3,  4,  12, 15],
    deploy:       [59,  9,  4,  12, 15],
    nuke:         [90,  7,  4,  12, 15],
    airstrike:    [82,  8,  2,  12, 15],
    chrono:       [97,  8,  3,  12, 15],
    chronodest:   [105, 8,  2,  12, 15],
    heal:         [160, 4,  4,  12, 15],
    nosell:       [119, 1,  0,  12, 15],
    norepair:     [120, 1,  0,  12, 15],
    guard:        [147, 1,  0,  12, 15],
    no_n:         [124, 1,  0,  12, 0],
    no_ne:        [125, 1,  0,  24, 0],
    no_e:         [126, 1,  0,  24, 15],
    no_se:        [127, 1,  0,  24, 30],
    no_s:         [128, 1,  0,  12, 30],
    no_sw:        [129, 1,  0,  0,  30],
    no_w:         [130, 1,  0,  0,  15],
    no_nw:        [131, 1,  0,  0,  0],
  };

  private cursorAnimTick = 0;
  /** Cached AssetManager reference — set each render frame for helpers that lack the param */
  private _cachedAssets: AssetManager | undefined;

  private renderCursor(assets?: AssetManager): void {
    const ctx = this.ctx;
    const x = this.cursorX;
    const y = this.cursorY;

    // Map CursorType to MOUSE_CONTROL key
    const cursorMap: Record<string, string> = {
      [CursorType.DEFAULT]: 'default',
      [CursorType.MOVE]: 'move',
      [CursorType.NOMOVE]: 'nomove',
      [CursorType.ATTACK]: 'attack',
      [CursorType.SELECT]: 'select',
      [CursorType.SELL]: 'sell',
      [CursorType.REPAIR]: 'repair',
      [CursorType.SCROLL_N]: 'n',
      [CursorType.SCROLL_NE]: 'ne',
      [CursorType.SCROLL_E]: 'e',
      [CursorType.SCROLL_SE]: 'se',
      [CursorType.SCROLL_S]: 's',
      [CursorType.SCROLL_SW]: 'sw',
      [CursorType.SCROLL_W]: 'w',
      [CursorType.SCROLL_NW]: 'nw',
      [CursorType.NOSCROLL_N]: 'no_n',
      [CursorType.NOSCROLL_NE]: 'no_ne',
      [CursorType.NOSCROLL_E]: 'no_e',
      [CursorType.NOSCROLL_SE]: 'no_se',
      [CursorType.NOSCROLL_S]: 'no_s',
      [CursorType.NOSCROLL_SW]: 'no_sw',
      [CursorType.NOSCROLL_W]: 'no_w',
      [CursorType.NOSCROLL_NW]: 'no_nw',
    };

    const mouseSheet = assets?.getSheet('mouse');
    const controlKey = cursorMap[this.cursorType] ?? 'default';
    const control = Renderer.MOUSE_CONTROL[controlKey];

    if (mouseSheet && control && assets) {
      // Sprite-based cursor rendering (C++ MOUSE.SHP parity)
      const [startFrame, frameCount, frameRate, hotX, hotY] = control;
      let frame = startFrame;
      if (frameCount > 1 && frameRate > 0) {
        this.cursorAnimTick++;
        const animFrame = Math.floor(this.cursorAnimTick / frameRate) % frameCount;
        frame = startFrame + animFrame;
      }
      const prevSmooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      assets.drawFrame(ctx, 'mouse', frame % mouseSheet.meta.frameCount, x - hotX, y - hotY);
      ctx.imageSmoothingEnabled = prevSmooth;
      return;
    }

    // Fallback: procedural vector cursors (when MOUSE.SHP not loaded)
    ctx.save();
    ctx.lineWidth = 1.5;

    switch (this.cursorType) {
      case CursorType.DEFAULT: {
        ctx.fillStyle = '#44ff44';
        ctx.strokeStyle = '#003300';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 16);
        ctx.lineTo(x + 4, y + 12);
        ctx.lineTo(x + 8, y + 18);
        ctx.lineTo(x + 10, y + 16);
        ctx.lineTo(x + 6, y + 10);
        ctx.lineTo(x + 11, y + 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case CursorType.MOVE: {
        // Green 4-way arrow
        const s = 6;
        ctx.fillStyle = '#44ff44';
        ctx.strokeStyle = '#003300';
        ctx.beginPath();
        // Up arrow
        ctx.moveTo(x, y - s * 2); ctx.lineTo(x - s, y - s); ctx.lineTo(x + s, y - s);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Down arrow
        ctx.beginPath();
        ctx.moveTo(x, y + s * 2); ctx.lineTo(x - s, y + s); ctx.lineTo(x + s, y + s);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Left arrow
        ctx.beginPath();
        ctx.moveTo(x - s * 2, y); ctx.lineTo(x - s, y - s); ctx.lineTo(x - s, y + s);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Right arrow
        ctx.beginPath();
        ctx.moveTo(x + s * 2, y); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y + s);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Center dot
        ctx.fillStyle = '#44ff44';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case CursorType.NOMOVE: {
        // Red circle with X
        const r = 7;
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
        ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
        ctx.stroke();
        break;
      }
      case CursorType.ATTACK: {
        // Red crosshair with center gap
        const r = 8;
        const gap = 3;
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 1.5;
        // Outer circle
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        // Crosshair lines with gap
        ctx.beginPath();
        ctx.moveTo(x - r - 2, y); ctx.lineTo(x - gap, y);
        ctx.moveTo(x + gap, y); ctx.lineTo(x + r + 2, y);
        ctx.moveTo(x, y - r - 2); ctx.lineTo(x, y - gap);
        ctx.moveTo(x, y + gap); ctx.lineTo(x, y + r + 2);
        ctx.stroke();
        break;
      }
      case CursorType.SELL: {
        // Yellow $ sign
        ctx.font = 'bold 16px monospace';
        ctx.fillStyle = '#FFD700';
        ctx.strokeStyle = '#553300';
        ctx.lineWidth = 2;
        ctx.textAlign = 'center';
        ctx.strokeText('$', x, y + 6);
        ctx.fillText('$', x, y + 6);
        ctx.textAlign = 'left';
        break;
      }
      case CursorType.REPAIR: {
        // Green wrench icon
        ctx.strokeStyle = '#44ff44';
        ctx.fillStyle = '#44ff44';
        ctx.lineWidth = 2;
        // Simple wrench shape
        ctx.beginPath();
        ctx.moveTo(x - 2, y - 8);
        ctx.lineTo(x + 2, y - 8);
        ctx.lineTo(x + 2, y);
        ctx.lineTo(x + 5, y + 3);
        ctx.lineTo(x + 3, y + 5);
        ctx.lineTo(x, y + 2);
        ctx.lineTo(x - 3, y + 5);
        ctx.lineTo(x - 5, y + 3);
        ctx.lineTo(x - 2, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#003300';
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      }
      default: {
        // Scroll cursors — directional white arrows
        if (this.cursorType.startsWith('SCROLL_')) {
          const dir = this.cursorType.replace('SCROLL_', '');
          const arrows: Record<string, [number, number]> = {
            N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1],
            S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1],
          };
          const [dx, dy] = arrows[dir] ?? [0, 0];
          const s = 8;
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          ctx.lineWidth = 1;
          // Arrow triangle pointing in scroll direction
          const tipX = x + dx * s * 2;
          const tipY = y + dy * s * 2;
          const perpX = -dy;
          const perpY = dx;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - dx * s + perpX * s * 0.6, tipY - dy * s + perpY * s * 0.6);
          ctx.lineTo(tipX - dx * s - perpX * s * 0.6, tipY - dy * s - perpY * s * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        break;
      }
    }

    // Superweapon targeting cursor overlay (drawn on top of normal cursor)
    if (this.superweaponCursorMode) {
      switch (this.superweaponCursorMode) {
        case SuperweaponType.CHRONOSPHERE: {
          // Blue crosshair with teleport icon
          const r = 10;
          ctx.strokeStyle = '#4488ff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
          // Inner cross
          ctx.beginPath();
          ctx.moveTo(x - r - 3, y); ctx.lineTo(x - 3, y);
          ctx.moveTo(x + 3, y); ctx.lineTo(x + r + 3, y);
          ctx.moveTo(x, y - r - 3); ctx.lineTo(x, y - 3);
          ctx.moveTo(x, y + 3); ctx.lineTo(x, y + r + 3);
          ctx.stroke();
          // Blue pulse
          const cp = 0.2 + 0.15 * Math.sin(Date.now() * 0.005);
          ctx.fillStyle = `rgba(80,120,255,${cp})`;
          ctx.beginPath();
          ctx.arc(x, y, r + 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case SuperweaponType.IRON_CURTAIN: {
          // Gold targeting reticle
          const r = 8;
          ctx.strokeStyle = '#FFD700';
          ctx.lineWidth = 2;
          // Rotating dashes
          const rot = Date.now() * 0.003;
          for (let i = 0; i < 4; i++) {
            const a = rot + i * Math.PI / 2;
            ctx.beginPath();
            ctx.arc(x, y, r, a, a + Math.PI / 4);
            ctx.stroke();
          }
          // Center dot
          ctx.fillStyle = '#FFD700';
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case SuperweaponType.NUKE: {
          // Red targeting circle showing blast radius
          const r = 10;
          ctx.strokeStyle = '#ff4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
          // Radiation symbol lines
          ctx.lineWidth = 1;
          for (let i = 0; i < 3; i++) {
            const a = i * Math.PI * 2 / 3 - Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
            ctx.stroke();
          }
          // Red pulse glow
          const np = 0.15 + 0.1 * Math.sin(Date.now() * 0.004);
          ctx.fillStyle = `rgba(255,60,60,${np})`;
          ctx.beginPath();
          ctx.arc(x, y, r + 3, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }

    // Chrono Tank deploy targeting cursor (blue crosshair, matches Chronosphere style)
    if (this.chronoTankTargeting) {
      const r = 10;
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r - 3, y); ctx.lineTo(x - 3, y);
      ctx.moveTo(x + 3, y); ctx.lineTo(x + r + 3, y);
      ctx.moveTo(x, y - r - 3); ctx.lineTo(x, y - 3);
      ctx.moveTo(x, y + 3); ctx.lineTo(x, y + r + 3);
      ctx.stroke();
      const cp = 0.2 + 0.15 * Math.sin(Date.now() * 0.005);
      ctx.fillStyle = `rgba(80,120,255,${cp})`;
      ctx.beginPath();
      ctx.arc(x, y, r + 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ─── Bitmap Text (C++ 6POINT/8POINT.FNT parity) ──────────

  /** Draw text using C++ bitmap font if available, falling back to canvas fillText.
   *  size: '6pt' → 6POINT.FNT, 'grad6' → GRAD6FNT.FNT, '8pt' → 8POINT.FNT, 'metal12' → 12METFNT.FNT */
  private drawBitmapText(
    assets: AssetManager | undefined,
    text: string, x: number, y: number,
    color: string,
    size: '6pt' | 'grad6' | '8pt' | 'metal12' = '8pt',
    options?: {
      align?: 'left' | 'center' | 'right';
      shadow?: string;
      fullShadow?: string;
      scale?: number;
      gradient?: readonly string[];
      indexedPalette?: readonly string[];
      letterSpacing?: number;
    },
  ): void {
    const fontName = size === '6pt' ? '6point' : size === 'grad6' ? 'grad6' : size === 'metal12' ? 'metal12' : '8point';
    const font = assets?.getFont(fontName);
    if (font) {
      font.drawText(this.ctx, text, x, y, color, options);
      return;
    }
    // Fallback: canvas text
    const ctx = this.ctx;
    const fontSize = size === '6pt' ? 7 : 10;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = options?.align ?? 'left';
    if (options?.fullShadow) {
      ctx.fillStyle = options.fullShadow;
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
        ctx.fillText(text, x + dx, y + fontSize + dy);
      }
    }
    if (options?.shadow) {
      ctx.fillStyle = options.shadow;
      ctx.fillText(text, x + 1, y + fontSize + 1);
    }
    ctx.fillStyle = options?.gradient?.[0] ?? color;
    ctx.fillText(text, x, y + fontSize);
  }

  // ─── Terrain ─────────────────────────────────────────────

  /** Render a grass cell with RA-style dithered pixel variation */
  private renderGrassCell(ctx: CanvasRenderingContext2D, sx: number, sy: number,
    cx: number, cy: number, h: number, tmpl: number, icon: number): void {
    // Base grass color from palette
    const palIdx = PAL_GRASS_START + 3 + ((tmpl * 13 + icon * 7 + h) % 5);
    ctx.fillStyle = this.palColor(palIdx, (h % 10) - 5);
    ctx.fillRect(sx, sy, CELL_SIZE, CELL_SIZE);
    // RA-style dithered pixel variation: alternate darker/lighter grass pixels
    for (let py = 0; py < CELL_SIZE; py += 2) {
      for (let px = 0; px < CELL_SIZE; px += 2) {
        const ph = cellHash(cx * 24 + px, cy * 24 + py);
        if (ph % 6 === 0) {
          // Darker grass pixel
          ctx.fillStyle = this.palColor(PAL_GRASS_START + 7 + (ph % 3));
          ctx.fillRect(sx + px, sy + py, 1, 1);
        } else if (ph % 9 === 0) {
          // Lighter grass pixel
          ctx.fillStyle = this.palColor(PAL_GRASS_START + 1 + (ph % 2), 6);
          ctx.fillRect(sx + px, sy + py, 1, 1);
        }
      }
    }
    // Dirt patch detail (sparse)
    if (h % 7 === 0) {
      const dx = (h % 12) + 4, dy = ((h >> 4) % 10) + 5;
      ctx.fillStyle = this.palColor(PAL_DIRT_START + 6, -15);
      ctx.globalAlpha = 0.25;
      ctx.fillRect(sx + dx, sy + dy, 4 + (h % 3), 3);
      ctx.globalAlpha = 1;
    }
    // Grass tuft (dark green blades)
    if (h > 180) {
      const gx = sx + (h % 16) + 3, gy = sy + ((h >> 4) % 14) + 4;
      ctx.fillStyle = this.palColor(PAL_GRASS_START + 9);
      ctx.fillRect(gx, gy, 1, 3);
      ctx.fillRect(gx + 2, gy + 1, 1, 2);
    }
  }

  /** Draw a magenta checkerboard stub for atlas-miss tiles. No silent fallbacks. */
  private renderMissingTileStub(
    ctx: CanvasRenderingContext2D, sx: number, sy: number,
    tmpl: number, icon: number,
  ): void {
    // Magenta/black checkerboard — classic "missing texture" pattern
    const half = CELL_SIZE / 2;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(sx, sy, half, half);
    ctx.fillRect(sx + half, sy + half, half, half);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + half, sy, half, half);
    ctx.fillRect(sx, sy + half, half, half);
    // Label: UNK + template ID so you know exactly what's missing
    ctx.fillStyle = '#ffffff';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('UNK', sx + CELL_SIZE / 2, sy + CELL_SIZE / 2 - 1);
    ctx.fillText(`${tmpl}:${icon}`, sx + CELL_SIZE / 2, sy + CELL_SIZE / 2 + 7);
    ctx.textAlign = 'start'; // reset
  }

  /** Draw a magenta checkerboard stub for missing entity/structure sprites. */
  private renderMissingSpriteStub(
    ctx: CanvasRenderingContext2D, sx: number, sy: number,
    w: number, h: number, label: string,
  ): void {
    const halfW = w / 2;
    const halfH = h / 2;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(sx, sy, halfW, halfH);
    ctx.fillRect(sx + halfW, sy + halfH, halfW, halfH);
    ctx.fillStyle = '#000000';
    ctx.fillRect(sx + halfW, sy, halfW, halfH);
    ctx.fillRect(sx, sy + halfH, halfW, halfH);
    ctx.fillStyle = '#ffffff';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, sx + w / 2, sy + h / 2 + 3);
    ctx.textAlign = 'start';
  }

  /** Try to draw a tile from the tileset atlas. Returns true if drawn. */
  private drawTileFromAtlas(
    ctx: CanvasRenderingContext2D,
    tmpl: number,
    icon: number,
    sx: number,
    sy: number,
    sourceImage?: CanvasImageSource | null,
    dw = CELL_SIZE,
    dh = CELL_SIZE,
  ): boolean {
    const image = sourceImage ?? this.tilesetImage;
    if (!image || !this.tilesetMeta) return false;
    const key = `${tmpl},${icon}`;
    const entry = this.tilesetMeta.tiles[key];
    if (!entry || entry.ax === undefined || entry.ay === undefined) return false;
    ctx.drawImage(
      image,
      entry.ax, entry.ay, this.tilesetMeta.tileW, this.tilesetMeta.tileH,
      sx, sy, dw, dh,
    );
    return true;
  }

  /** C++ SDLLIB/drawbuff.cpp Linear_Scale_To_Linear source sample offset. */
  static cppScaleSourceOffset(srcSize: number, dstSize: number, dstIndex: number): number {
    if (srcSize <= 0 || dstSize <= 0 || dstIndex <= 0) return 0;
    const step = Math.trunc((srcSize * 65536) / dstSize);
    return Math.trunc((dstIndex * step) / 65536);
  }

  private getSourceImagePixels(source: CanvasImageSource): {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  } | null {
    if (this.tilesetPixelCache?.source === source) return this.tilesetPixelCache;
    const sized = source as CanvasImageSource & {
      naturalWidth?: number; naturalHeight?: number;
      width?: number; height?: number;
    };
    const width = sized.naturalWidth || Number(sized.width) || this.tilesetMeta?.atlasW || 0;
    const height = sized.naturalHeight || Number(sized.height) || this.tilesetMeta?.atlasH || 0;
    if (width <= 0 || height <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const cctx = canvas.getContext('2d');
    if (!cctx) return null;
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(source, 0, 0);
    const image = cctx.getImageData(0, 0, width, height);
    this.tilesetPixelCache = { source, width, height, data: image.data };
    return this.tilesetPixelCache;
  }

  /** Radar zoom uses C++ Linear_Scale_To_Linear, not browser drawImage scaling. */
  private drawRadarTileFromAtlas(
    ctx: CanvasRenderingContext2D,
    tmpl: number,
    icon: number,
    sx: number,
    sy: number,
    sourceImage?: CanvasImageSource | null,
    dw = 3,
    dh = 3,
  ): boolean {
    const image = sourceImage ?? this.tilesetImage;
    if (!image || !this.tilesetMeta) return false;
    const entry = this.tilesetMeta.tiles[`${tmpl},${icon}`];
    if (!entry || entry.ax === undefined || entry.ay === undefined) return false;
    const pixels = this.getSourceImagePixels(image);
    if (!pixels) return false;

    for (let dy = 0; dy < dh; dy++) {
      const srcY = entry.ay + Renderer.cppScaleSourceOffset(this.tilesetMeta.tileH, dh, dy);
      for (let dx = 0; dx < dw; dx++) {
        const srcX = entry.ax + Renderer.cppScaleSourceOffset(this.tilesetMeta.tileW, dw, dx);
        const srcOff = (srcY * pixels.width + srcX) * 4;
        const alpha = pixels.data[srcOff + 3];
        if (alpha === 0) continue; // C++ trans=TRUE leaves the existing black radar pixel.
        ctx.fillStyle = `rgb(${pixels.data[srcOff]},${pixels.data[srcOff + 1]},${pixels.data[srcOff + 2]})`;
        ctx.fillRect(sx + dx, sy + dy, 1, 1);
      }
    }
    return true;
  }

  private getRadarBrightenTable(): Uint8Array | null {
    if (!this.pal) return null;
    if (this.radarBrightenTableCache?.palette === this.pal) return this.radarBrightenTableCache.table;
    const table = makeRemapFadingTable(this.pal, RA_COLOR_WHITE, 25);
    this.radarBrightenTableCache = { palette: this.pal, table };
    return table;
  }

  private getRadarYellowTable(): Uint8Array | null {
    if (!this.pal) return null;
    if (this.radarYellowTableCache?.palette === this.pal) return this.radarYellowTableCache.table;
    const table = makeFadingTable(this.pal, RA_COLOR_YELLOW, 140);
    this.radarYellowTableCache = { palette: this.pal, table };
    return table;
  }

  private drawRadarTerrainObjectIcon(
    ctx: CanvasRenderingContext2D,
    map: GameMap,
    cx: number,
    cy: number,
    x: number,
    y: number,
    size: number,
    assets?: AssetManager,
  ): boolean {
    if (!assets || !this.pal || size <= 0) return false;

    const neighborX = [0, 0, -1, 1, 0, -1, 1, -1, 1];
    const neighborY = [0, 0, -1, 1, 0, -1, 1, -1, 1];
    const sampleStep = Math.trunc(CELL_SIZE / 3);
    const sampleBias = Math.trunc(3 / 2);
    const brighten = this.getRadarBrightenTable();
    if (!brighten) return false;

    let drew = false;
    for (const terrainObject of this.radarTerrainObjectsForCell(map, cx, cy)) {
      const sheetName = this.theatreSheetName(assets, terrainObject.type);
      const sheet = assets.getSheet(sheetName);
      if (!sheet) continue;

      const pixels = this.getSourceImagePixels(sheet.image);
      if (!pixels) continue;

      const frameX = 0;
      const frameY = 0;
      const frameW = sheet.meta.frameWidth;
      const frameH = sheet.meta.frameHeight;
      const iconW = Math.trunc((frameW + CELL_SIZE / 2) / CELL_SIZE);
      const iconH = Math.trunc((frameH + CELL_SIZE / 2) / CELL_SIZE);
      const iconX = cx - terrainObject.cx;
      const iconY = cy - terrainObject.cy;
      if (iconX < 0 || iconY < 0 || iconX >= iconW || iconY >= iconH) continue;

      for (let dy = 0; dy < size; dy++) {
        const iconDy = Renderer.cppScaleSourceOffset(3, size, dy);
        const getY = frameY + iconY * CELL_SIZE + iconDy * sampleStep + sampleBias;
        for (let dx = 0; dx < size; dx++) {
          const iconDx = Renderer.cppScaleSourceOffset(3, size, dx);
          const getX = frameX + iconX * CELL_SIZE + iconDx * sampleStep + sampleBias;

          for (let i = 0; i < neighborX.length; i++) {
            const sx = getX - neighborX[i];
            const sy = getY - neighborY[i];
            if (sx < frameX || sx >= frameX + frameW || sy < frameY || sy >= frameY + frameH) continue;
            const srcOff = (sy * pixels.width + sx) * 4;
            const alpha = pixels.data[srcOff + 3];
            // C++ Get_Radar_Icon zeros LTGREEN (palette index 4). The
            // extractor carries that source index as the alpha-130 shadow
            // sentinel, so terrain radar icons must treat it as transparent.
            if (alpha === 0 || alpha === 130) continue;
            const palIndex = nearestPaletteIndex(
              this.pal,
              pixels.data[srcOff],
              pixels.data[srcOff + 1],
              pixels.data[srcOff + 2],
            );
            if (palIndex === 0) continue;
            const faded = brighten[palIndex];
            if (faded === 0) continue;
            ctx.fillStyle = this.palColor(faded);
            ctx.fillRect(x + dx, y + dy, 1, 1);
            drew = true;
            break;
          }
        }
      }
    }

    return drew;
  }

  private drawRadarOverlayIcon(
    ctx: CanvasRenderingContext2D,
    map: GameMap,
    cx: number,
    cy: number,
    x: number,
    y: number,
    size: number,
    assets?: AssetManager,
  ): boolean {
    if (!assets || !this.pal || size <= 0) return false;
    const idx = cy * 128 + cx;
    const overlay = map.overlay[idx];
    if (!GameMap.isOreOverlayId(overlay)) return false;

    const density = map.oreDensity[idx];
    const isGold = GameMap.isGoldOverlayId(overlay);
    const variant = isGold
      ? overlay - GameMap.OVERLAY_GOLD1 + 1
      : overlay - GameMap.OVERLAY_GEMS1 + 1;
    const frame = isGold
      ? Math.min(density !== 0xff ? density : 0, 11)
      : Math.min(density !== 0xff ? density : 0, 2);
    const baseName = isGold ? `gold0${variant}` : `gem0${variant}`;
    const sheetName = this.theatreSheetName(assets, baseName);
    const sheet = assets.getSheet(sheetName);
    if (!sheet) return false;

    const pixels = this.getSourceImagePixels(sheet.image);
    const yellow = this.getRadarYellowTable();
    if (!pixels || !yellow) return false;

    const frameW = sheet.meta.frameWidth;
    const frameH = sheet.meta.frameHeight;
    const columns = Math.max(1, sheet.meta.columns || sheet.meta.frameCount || 1);
    const frameX = (frame % columns) * frameW;
    const frameY = Math.floor(frame / columns) * frameH;
    const neighborX = [0, 0, -1, 1, 0, -1, 1, -1, 1];
    const neighborY = [0, 0, -1, 1, 0, -1, 1, -1, 1];
    const sampleStep = Math.trunc(CELL_SIZE / 3);
    const sampleBias = Math.trunc(3 / 2);
    let drew = false;

    for (let dy = 0; dy < size; dy++) {
      const iconDy = Renderer.cppScaleSourceOffset(3, size, dy);
      const getY = frameY + iconDy * sampleStep + sampleBias;
      for (let dx = 0; dx < size; dx++) {
        const iconDx = Renderer.cppScaleSourceOffset(3, size, dx);
        const getX = frameX + iconDx * sampleStep + sampleBias;

        for (let i = 0; i < neighborX.length; i++) {
          const sx = getX - neighborX[i];
          const sy = getY - neighborY[i];
          if (sx < frameX || sx >= frameX + frameW || sy < frameY || sy >= frameY + frameH) continue;
          const srcOff = (sy * pixels.width + sx) * 4;
          const alpha = pixels.data[srcOff + 3];
          if (alpha === 0 || alpha === 130) continue;
          const palIndex = nearestPaletteIndex(
            this.pal,
            pixels.data[srcOff],
            pixels.data[srcOff + 1],
            pixels.data[srcOff + 2],
          );
          if (palIndex === 0) continue;
          const faded = yellow[palIndex];
          if (faded === 0) continue;
          ctx.fillStyle = this.palColor(faded);
          ctx.fillRect(x + dx, y + dy, 1, 1);
          drew = true;
          break;
        }
      }
    }

    return drew;
  }

  private radarTerrainObjectsForCell(map: GameMap, cx: number, cy: number): MapTerrainRadarObject[] {
    const lookup = (map as GameMap & {
      getTerrainObjectsForRadarCell?: (cellX: number, cellY: number) => MapTerrainRadarObject[];
    }).getTerrainObjectsForRadarCell;
    if (typeof lookup === 'function') return lookup.call(map, cx, cy);

    const fallback: MapTerrainRadarObject[] = [];
    const tree = map.getTreeAtCell(cx, cy);
    if (tree) fallback.push(tree);
    const terrainObject = map.getTerrainObjectAtCell(cx, cy);
    if (terrainObject && !fallback.includes(terrainObject)) fallback.push(terrainObject);
    return fallback;
  }

  /** Run the visual-only C++ Color_Cycle water phase from wall-clock time. */
  advancePaletteCycle(elapsedMs: number): void {
    if (!this.paletteCycleInitialized) {
      this.paletteCycleInitialized = true;
      this.paletteCycleShift = (this.paletteCycleShift + 1) % PAL_WATER_COUNT;
      this.paletteCycleAccumMs = 0;
      return;
    }

    this.paletteCycleAccumMs += Math.max(0, elapsedMs);
    const steps = waterPaletteCycleShift(this.paletteCycleAccumMs);
    if (steps === 0) return;
    this.paletteCycleAccumMs -= steps * 250;
    this.paletteCycleShift = (this.paletteCycleShift + steps) % PAL_WATER_COUNT;
  }

  private getPaletteCycledTilesetImage(shift = this.paletteCycleShift): CanvasImageSource | null {
    if (!this.tilesetImage || !this.tilesetMeta) return null;
    if (shift === 0 || !this.pal) return this.tilesetImage;

    const width = this.tilesetImage.naturalWidth || this.tilesetImage.width || this.tilesetMeta.atlasW;
    const height = this.tilesetImage.naturalHeight || this.tilesetImage.height || this.tilesetMeta.atlasH;
    const key = `${this.tilesetTheatre}:${shift}:${width}x${height}`;
    const cached = this.cycledTilesetCache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const octx = canvas.getContext('2d');
    if (!octx) return this.tilesetImage;

    octx.drawImage(this.tilesetImage, 0, 0);
    const imageData = octx.getImageData(0, 0, width, height);
    applyWaterPaletteCycle(imageData.data, this.pal, shift);
    octx.putImageData(imageData, 0, 0);
    this.cycledTilesetCache.set(key, canvas);
    return canvas;
  }

  private renderTerrain(
    camera: Camera,
    map: GameMap,
    tick: number,
    assets: AssetManager,
    drawTerrainObjects = true,
  ): void {
    const ctx = this.ctx;
    const startCX = Math.floor(camera.x / CELL_SIZE);
    const startCY = Math.floor(camera.y / CELL_SIZE);
    const endCX = Math.ceil((camera.x + camera.viewWidth) / CELL_SIZE);
    const endCY = Math.ceil((camera.y + camera.viewHeight) / CELL_SIZE);

    // Can we use the real tileset? Available for any theatre with extracted tiles.
    const useTileset = this.tilesetReady && this.tilesetTheatre === this.theatre;
    const tilesetSource = useTileset ? this.getPaletteCycledTilesetImage() : null;

    // Deferred TerrainClass sprite draws — rendered after all ground tiles to prevent
    // clump sprites (TC01-TC05, 72-96px wide) from being overwritten by
    // neighboring _clump satellite cells' grass fill. Full-frame renders sort
    // these TerrainClass objects with ground AnimClass objects by C++ Sort_Y.
    const deferredTerrainObjects: TerrainObjectSprite[] = [];

    const queuedTreeOrigins = new Set<number>();
    const queueTreeSprite = (treeType: string, cx: number, cy: number, x: number, y: number): void => {
      const sheetName = this.theatreSheetName(assets, treeType);
      if (!assets.hasSheet(sheetName)) return;
      const [sortPx, sortPy] = TREE_CENTER_OFFSET[treeType] ?? [CELL_SIZE / 2, CELL_SIZE];
      queuedTreeOrigins.add(cy * 128 + cx);
      deferredTerrainObjects.push({
        name: sheetName,
        x,
        y,
        sortX: pixelToNearestLepton(cx * CELL_SIZE + sortPx),
        sortY: pixelToNearestLepton(cy * CELL_SIZE + sortPy),
        logicIndexHint: map.getTreeAtOrigin(cx, cy)?.logicIndexHint,
      });
    };

    const queueTreeObjectSprite = (tree: { type: string; cx: number; cy: number }): void => {
      const idx = tree.cy * 128 + tree.cx;
      if (queuedTreeOrigins.has(idx)) return;
      const drawX = tree.cx * CELL_SIZE;
      const drawY = tree.cy * CELL_SIZE;
      const screen = camera.worldToScreen(drawX, drawY);
      if (screen.x < -CELL_SIZE * 4 || screen.x > this.width + CELL_SIZE * 4 ||
          screen.y < -CELL_SIZE * 4 || screen.y > this.height + CELL_SIZE * 4) return;
      queueTreeSprite(tree.type, tree.cx, tree.cy, Math.round(screen.x), Math.round(screen.y));
    };

    const queueTerrainObjectSprite = (terrainObject: { type: string; cx: number; cy: number; logicIndexHint?: number }): void => {
      const sheetName = this.theatreSheetName(assets, terrainObject.type);
      if (!assets.hasSheet(sheetName)) return;
      const [sortPx, sortPy] = TERRAIN_OBJECT_CENTER_OFFSET[terrainObject.type] ?? [CELL_SIZE / 2, CELL_SIZE];
      const drawX = terrainObject.cx * CELL_SIZE;
      const drawY = terrainObject.cy * CELL_SIZE;
      const screen = camera.worldToScreen(drawX, drawY);
      if (screen.x < -CELL_SIZE * 4 || screen.x > this.width + CELL_SIZE * 4 ||
          screen.y < -CELL_SIZE * 4 || screen.y > this.height + CELL_SIZE * 4) return;
      deferredTerrainObjects.push({
        name: sheetName,
        x: Math.round(screen.x),
        y: Math.round(screen.y),
        sortX: pixelToNearestLepton(terrainObject.cx * CELL_SIZE + sortPx),
        sortY: pixelToNearestLepton(terrainObject.cy * CELL_SIZE + sortPy),
        logicIndexHint: terrainObject.logicIndexHint,
      });
    };

    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        const screen = camera.worldToScreen(cx * CELL_SIZE, cy * CELL_SIZE);
        screen.x = Math.round(screen.x);
        screen.y = Math.round(screen.y);

        // Out-of-bounds cells render as black (shroud border)
        if (cx < map.boundsX || cx >= map.boundsX + map.boundsW ||
            cy < map.boundsY || cy >= map.boundsY + map.boundsH) {
          ctx.fillStyle = '#000';
          ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
          continue;
        }

        const terrain = map.getTerrain(cx, cy);
        const treeType = map.getTreeType(cx, cy);
        const h = cellHash(cx, cy);

        // Use MapPack template data for richer variation when available
        const idx = cy * 128 + cx;
        const tmpl = map.templateType[idx] || 0;
        const icon = map.templateIcon[idx] || 0;

        // Try real tileset tile first.
        // For TREE terrain, draw ground from atlas but still render tree overlay on top
        let atlasDrawn = false;
        if (useTileset && tmpl > 0 && tmpl !== 0xFFFF && tmpl !== 255) {
          if (this.drawTileFromAtlas(ctx, tmpl, icon, screen.x, screen.y, tilesetSource)) {
            if (terrain !== Terrain.TREE && !treeType) continue; // Tile drawn from atlas, skip procedural
            atlasDrawn = true; // Fall through to TREE case below
          } else {
            // ATLAS MISS — magenta checkerboard stub (no silent fallbacks)
            this.renderMissingTileStub(ctx, screen.x, screen.y, tmpl, icon);
            if (terrain !== Terrain.TREE && !treeType) continue;
          }
        }

        // Clear template cells: C++ chooses base art from TType, not Land.
        // cell.cpp:981-987: TEMPLATE_NONE, TEMPLATE_CLEAR1, and 255 all draw
        // TEMPLATE_CLEAR1 with Clear_Icon() = (cx&3)|((cy&3)<<2).
        if (useTileset && (tmpl === 0 || tmpl === 0xFFFF || tmpl === 255)) {
          const clearIcon = (cx & 3) | ((cy & 3) << 2);
          if (this.drawTileFromAtlas(ctx, 255, clearIcon, screen.x, screen.y, tilesetSource)) {
            atlasDrawn = true;
            if (terrain !== Terrain.TREE && !treeType) continue;
          }
        }

        // If the atlas already drew the underlying template and this cell only
        // needs a tree overlay, defer the sprite and move on. C++ terrain
        // objects do not replace Land_Type.
        if (atlasDrawn && terrain !== Terrain.TREE) {
          if (treeType && treeType !== '_clump') {
            queueTreeSprite(treeType, cx, cy, screen.x, screen.y);
          }
          continue;
        }

        // Procedural rendering for base terrain types (type 0, 0xFFFF, or INTERIOR theatre)
        switch (terrain) {
          case Terrain.CLEAR: {
            if (this.theatre === 'INTERIOR') {
              // INTERIOR theatre — always concrete/stone floors (ignores template data)
              const bright = 60 + (h % 12) - 6;
              ctx.fillStyle = `rgb(${bright},${bright - 2},${bright - 5})`;
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              // Tile grid lines
              if ((cx + cy) % 2 === 0) {
                ctx.fillStyle = `rgba(80,78,72,0.3)`;
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, 1);
                ctx.fillRect(screen.x, screen.y, 1, CELL_SIZE);
              }
              // Occasional stain detail
              if (h > 220) {
                ctx.fillStyle = 'rgba(40,35,30,0.15)';
                ctx.fillRect(screen.x + 4, screen.y + 4, 16, 12);
              }
              break; // skip TEMPERATE template rendering and grass tufts
            } else if (tmpl > 0 && tmpl !== 0xFFFF) {
              // Template-aware rendering using palette colors
              const isRoad = tmpl >= TEMPLATE_ROAD_MIN && tmpl <= TEMPLATE_ROAD_MAX;
              const isRough = tmpl >= 0x0D && tmpl <= 0x12;
              const isShoreDirt = tmpl >= 0x06 && tmpl <= 0x0C;

              if (isRoad) {
                // Road tiles — two-tone dirt with gravel dithering
                const palIdx = PAL_DIRT_START + 4 + ((icon * 7 + h) % 4);
                ctx.fillStyle = this.palColor(palIdx, 5);
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Gravel dither pattern (RA-style pixel noise)
                for (let py = 0; py < CELL_SIZE; py += 3) {
                  for (let px = 0; px < CELL_SIZE; px += 3) {
                    const ph = cellHash(cx * 24 + px, cy * 24 + py);
                    if (ph % 4 === 0) {
                      ctx.fillStyle = this.palColor(PAL_DIRT_START + 2 + (ph % 3), ph % 12 - 6);
                      ctx.fillRect(screen.x + px, screen.y + py, 1, 1);
                    }
                  }
                }
                // Road edge darkening
                ctx.fillStyle = this.palColor(PAL_DIRT_START + 8, -10);
                ctx.globalAlpha = 0.3;
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, 2);
                ctx.fillRect(screen.x, screen.y + CELL_SIZE - 2, CELL_SIZE, 2);
                ctx.globalAlpha = 1;
              } else if (isRough) {
                // Rough terrain — dithered dirt/rock mix
                const palIdx = PAL_DIRT_START + 8 + (h % 4);
                ctx.fillStyle = this.palColor(palIdx);
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Rock scatter with varied sizes
                for (let r = 0; r < 3; r++) {
                  const rh = (h + r * 47) & 0xFF;
                  const rx = (rh % 18) + 2, ry = ((rh >> 3) % 16) + 3;
                  const rs = 2 + (rh % 3);
                  ctx.fillStyle = this.palColor(PAL_ROCK_START + 6 + (rh % 4));
                  ctx.fillRect(screen.x + rx, screen.y + ry, rs, rs - 1);
                }
              } else if (isShoreDirt) {
                // Shore/dirt — dithered sand transition
                const palIdx = PAL_DIRT_START + 2 + (h % 4);
                ctx.fillStyle = this.palColor(palIdx);
                ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
                // Sand grain dithering
                for (let py = 0; py < CELL_SIZE; py += 2) {
                  for (let px = 0; px < CELL_SIZE; px += 2) {
                    if (((px + py + h) % 5) === 0) {
                      ctx.fillStyle = this.palColor(PAL_DIRT_START + (h % 3), 8);
                      ctx.fillRect(screen.x + px, screen.y + py, 1, 1);
                    }
                  }
                }
              } else {
                // Other templates — grass with dithered variation (RA-style)
                this.renderGrassCell(ctx, screen.x, screen.y, cx, cy, h, tmpl, icon);
              }
            } else {
              // Default clear — grass with dithered variation
              this.renderGrassCell(ctx, screen.x, screen.y, cx, cy, h, 0, 0);
            }
            break;
          }
          case Terrain.WATER: {
            // Animated water using palette indices 96-102 (7-frame ping-pong cycle)
            const phase = (tick + h) % (PAL_WATER_COUNT * 2 - 2);
            const waterIdx = phase < PAL_WATER_COUNT ? phase : (PAL_WATER_COUNT * 2 - 2 - phase);
            ctx.fillStyle = this.palColor(PAL_WATER_START + waterIdx);
            ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
            // Dithered water depth variation
            for (let py = 0; py < CELL_SIZE; py += 3) {
              for (let px = 0; px < CELL_SIZE; px += 3) {
                const wp = cellHash(cx * 24 + px, cy * 24 + py + tick);
                if (wp % 7 === 0) {
                  ctx.fillStyle = this.palColor(PAL_WATER_START + Math.min(waterIdx + 1, PAL_WATER_COUNT - 1), 8);
                  ctx.fillRect(screen.x + px, screen.y + py, 1, 1);
                }
              }
            }
            // Wave highlights — moving ripple lines
            const waveOff = (tick * 0.5 + h * 0.3) % CELL_SIZE;
            ctx.fillStyle = this.palColor(PAL_WATER_START, 15);
            ctx.globalAlpha = 0.2;
            ctx.fillRect(screen.x + 2, screen.y + ((waveOff | 0) % CELL_SIZE), CELL_SIZE - 4, 1);
            ctx.fillRect(screen.x + 6, screen.y + ((waveOff + 12 | 0) % CELL_SIZE), CELL_SIZE - 12, 1);
            ctx.globalAlpha = 1;
            break;
          }
          case Terrain.ROCK: {
            if (this.theatre === 'INTERIOR') {
              // Interior: dark stone walls
              const bright = 35 + (h % 8);
              ctx.fillStyle = `rgb(${bright},${bright - 3},${bright - 5})`;
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              ctx.fillStyle = 'rgba(20,15,10,0.3)';
              ctx.fillRect(screen.x + (h % 10) + 2, screen.y + ((h >> 3) % 10) + 2, 4, 3);
            } else {
              // Rock using palette gray ramp (indices 132-140)
              const palIdx = PAL_ROCK_START + 4 + (h % 8);
              ctx.fillStyle = this.palColor(palIdx);
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              // Rock detail using darker grays
              ctx.fillStyle = this.palColor(PAL_ROCK_START + 10);
              ctx.globalAlpha = 0.5;
              ctx.fillRect(screen.x + (h % 10) + 2, screen.y + ((h >> 3) % 10) + 2, 4, 3);
              ctx.fillRect(screen.x + ((h >> 5) % 12) + 1, screen.y + ((h >> 2) % 14) + 5, 3, 4);
              ctx.globalAlpha = 1;
            }
            break;
          }
          case Terrain.TREE: {
            if (this.theatre === 'INTERIOR') {
              // Interior: support columns/pillars instead of trees
              const bright = 50 + (h % 6);
              ctx.fillStyle = `rgb(${bright},${bright - 2},${bright - 4})`;
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
              ctx.fillStyle = `rgb(${bright + 15},${bright + 12},${bright + 8})`;
              ctx.fillRect(screen.x + 8, screen.y + 4, 8, 16);
              ctx.fillStyle = `rgb(${bright + 8},${bright + 5},${bright + 2})`;
              ctx.fillRect(screen.x + 6, screen.y + 2, 12, 4);
              ctx.fillRect(screen.x + 6, screen.y + 18, 12, 4);
            } else {
              // Ground under tree — skip grass if atlas already drew the ground tile
              if (!atlasDrawn) this.renderGrassCell(ctx, screen.x, screen.y, cx, cy, h, tmpl, icon);

              if (treeType === '_clump') {
                // Covered by a nearby clump origin sprite — just show grass
              } else if (treeType && assets.hasSheet(this.theatreSheetName(assets, treeType))) {
                // Defer tree sprite to second pass (clump sprites span multiple cells)
                queueTreeSprite(treeType, cx, cy, screen.x, screen.y);
              } else {
                // Procedural fallback (MapPack trees or missing sprites)
                // Tree shadow on ground
                ctx.fillStyle = 'rgba(0,0,0,0.2)';
                ctx.beginPath();
                ctx.ellipse(screen.x + 13, screen.y + 19, 9, 4, 0, 0, Math.PI * 2);
                ctx.fill();
                // Trunk — darker brown with highlight
                const tx = screen.x + 10 + (h % 2);
                ctx.fillStyle = this.palColor(PAL_DIRT_START + 10);
                ctx.fillRect(tx, screen.y + 12, 3, 10);
                ctx.fillStyle = this.palColor(PAL_DIRT_START + 7);
                ctx.fillRect(tx + 1, screen.y + 13, 1, 8);
                // Canopy — pixel-art blocky rects (6 hash-based variants)
                const variant = h % 6;
                const sx = screen.x, sy = screen.y;
                // Dark base layer
                ctx.fillStyle = this.palColor(PAL_GRASS_START + 10 + (h % 2));
                if (variant < 2) {
                  ctx.fillRect(sx + 4, sy + 8, 16, 4);
                  ctx.fillRect(sx + 6, sy + 4, 12, 4);
                  ctx.fillRect(sx + 8, sy + 2, 8, 2);
                  ctx.fillRect(sx + 6, sy + 12, 10, 2);
                } else if (variant < 4) {
                  ctx.fillRect(sx + 3, sy + 7, 18, 5);
                  ctx.fillRect(sx + 5, sy + 3, 14, 4);
                  ctx.fillRect(sx + 7, sy + 1, 10, 2);
                  ctx.fillRect(sx + 5, sy + 12, 12, 2);
                } else {
                  ctx.fillRect(sx + 5, sy + 8, 14, 4);
                  ctx.fillRect(sx + 7, sy + 5, 10, 3);
                  ctx.fillRect(sx + 9, sy + 3, 6, 2);
                  ctx.fillRect(sx + 7, sy + 12, 10, 2);
                }
                // Mid-tone highlight blocks
                ctx.fillStyle = this.palColor(PAL_GRASS_START + 7 + (h % 3));
                ctx.fillRect(sx + 6 + (h % 3), sy + 4, 6, 4);
                ctx.fillRect(sx + 8 + (h % 2), sy + 8, 4, 3);
                // Light highlight pixels
                ctx.fillStyle = this.palColor(PAL_GRASS_START + 4 + (h % 2));
                ctx.fillRect(sx + 8 + (h % 4), sy + 4, 2, 2);
                ctx.fillRect(sx + 12 + (h % 2), sy + 6, 2, 1);
              }
            }
            break;
          }
          case Terrain.WALL: {
            // Wall overlays sit on top of normal ground; the SHP is drawn later
            // in renderOverlays/renderStructures.
            if (this.theatre === 'INTERIOR') {
              const bright = 40 + (h % 6);
              ctx.fillStyle = `rgb(${bright},${bright - 2},${bright - 4})`;
              ctx.fillRect(screen.x, screen.y, CELL_SIZE, CELL_SIZE);
            } else if (useTileset) {
              // Use CLEAR1 tileset tile (template 255) — matches surrounding terrain
              const clearIcon = (cx & 3) | ((cy & 3) << 2);
              if (!this.drawTileFromAtlas(ctx, 255, clearIcon, screen.x, screen.y, tilesetSource)) {
                this.renderGrassCell(ctx, screen.x, screen.y, cx, cy, h, tmpl, icon);
              }
            } else {
              this.renderGrassCell(ctx, screen.x, screen.y, cx, cy, h, tmpl, icon);
            }
            break;
          }
        }

        if (terrain !== Terrain.TREE && treeType && treeType !== '_clump') {
          queueTreeSprite(treeType, cx, cy, screen.x, screen.y);
        }
      }
    }

    if (drawTerrainObjects) {
      for (const tree of map.trees.values()) {
        queueTreeObjectSprite(tree);
      }
      for (const terrainObject of map.terrainObjects.values()) {
        queueTerrainObjectSprite(terrainObject);
      }
      this.renderTerrainObjectSprites(assets, deferredTerrainObjects);
    } else {
      for (const tree of map.trees.values()) {
        queueTreeObjectSprite(tree);
      }
      for (const terrainObject of map.terrainObjects.values()) {
        queueTerrainObjectSprite(terrainObject);
      }
      this.pendingTerrainObjectSprites.push(...deferredTerrainObjects);
    }
  }

  private renderTerrainObjectSprites(
    assets: AssetManager,
    sprites = this.pendingTerrainObjectSprites,
  ): void {
    for (const dt of sprites) {
      this.renderTerrainObjectSprite(assets, dt);
    }
  }

  private renderTerrainObjectSprite(assets: AssetManager, sprite: TerrainObjectSprite): void {
    const shadowOptions = this.unitShadowOptions();
    if (shadowOptions) {
      assets.drawFrame(this.ctx, sprite.name, 0, sprite.x, sprite.y, shadowOptions);
    } else {
      assets.drawFrame(this.ctx, sprite.name, 0, sprite.x, sprite.y);
    }
  }

  private collectGroundLayerEntries(entities: Entity[], structures: MapStructure[]): GroundLayerEntry[] {
    const entries: GroundLayerEntry[] = [];

    for (const terrain of this.pendingTerrainObjectSprites) {
      entries.push({
        kind: 'terrain',
        sortX: terrain.sortX,
        sortY: terrain.sortY,
        order: terrain.logicIndexHint ?? 0,
        terrain,
      });
    }

    for (const anim of this.logicAnims) {
      if (anim.delay > 0) continue;
      const spec = logicAnimRenderSpec(anim.type);
      if (!spec.groundLayer) continue;
      const sort = cppGroundAnimSortKey(anim);
      entries.push({
        kind: 'anim',
        sortX: sort.x,
        sortY: sort.y,
        order: anim.logicIndexHint ?? 0,
        anim,
      });
    }

    for (let structureIndex = 0; structureIndex < structures.length; structureIndex++) {
      const structure = structures[structureIndex];
      const sort = cppStructureRenderSortKey(structure);
      entries.push({
        kind: 'structure',
        sortX: sort.x,
        sortY: sort.y,
        order: structure.logicIndexHint ?? structureIndex,
        structure,
        structureIndex,
      });
    }

    for (const entity of entities) {
      if (cppEntityRenderLayer(entity) !== 'ground') continue;
      entries.push({
        kind: 'entity',
        sortX: entity.leptonX,
        sortY: Math.trunc(cppEntityRenderSortKey(entity) / 0x10000),
        order: entity.logicIndexHint ?? entity.id,
        entity,
      });
    }

    entries.sort((a, b) => {
      const dy = a.sortY - b.sortY;
      if (dy !== 0) return dy;
      const dx = a.sortX - b.sortX;
      if (dx !== 0) return dx;
      return a.order - b.order;
    });

    return entries;
  }

  private renderGroundTerrainObjectsAndAnims(camera: Camera, assets: AssetManager): void {
    const entries = this.collectGroundLayerEntries([], []);
    for (const entry of entries) {
      if (entry.kind === 'terrain') {
        this.renderTerrainObjectSprite(assets, entry.terrain);
      } else if (entry.kind === 'anim') {
        this.renderLogicAnim(camera, assets, entry.anim);
      }
    }
  }

  private renderGroundLayer(
    camera: Camera,
    map: GameMap,
    entities: Entity[],
    structures: MapStructure[],
    assets: AssetManager,
    selectedIds: Set<number>,
    tick: number,
  ): void {
    const dockedGroundEntities = new Map<number, Entity>();
    for (const s of structures) {
      if (s.dockedAircraft === undefined) continue;
      const docked = entities.find(entity => entity.id === s.dockedAircraft);
      if (!docked || cppEntityRenderLayer(docked) !== 'ground') continue;
      dockedGroundEntities.set(docked.id, docked);
    }

    for (const entry of this.collectGroundLayerEntries(entities, structures)) {
      switch (entry.kind) {
        case 'terrain':
          this.renderTerrainObjectSprite(assets, entry.terrain);
          break;
        case 'anim':
          this.renderLogicAnim(camera, assets, entry.anim);
          break;
        case 'structure':
          this.renderStructures(camera, map, [entry.structure], assets, tick, [entry.structureIndex], dockedGroundEntities);
          break;
        case 'entity':
          if (dockedGroundEntities.has(entry.entity.id)) break;
          this.renderEntities(camera, map, [entry.entity], assets, selectedIds, tick);
          break;
      }
    }
  }

  private renderVisibility(map: GameMap, cx: number, cy: number): number {
    return map.getDisplayVisibility(cx, cy);
  }

  private unitShadowOptions(options?: DrawFrameOptions): DrawFrameOptions | undefined {
    if (!this.pal) return options;
    const frac = this.theatre === 'SNOW' ? 75 : 130;
    return {
      ...options,
      ghostShadow: { palette: this.pal, frac },
    };
  }

  // ─── Terrain Smudges (scorch marks, craters) ────────────

  private renderDecals(camera: Camera, map: GameMap, assets: AssetManager): void {
    const ctx = this.ctx;
    // Render CellClass smudge marks from scenario INI and AnimClass::Middle.
    for (const s of map.smudges) {
      const screen = camera.worldToScreen(s.cx * CELL_SIZE, s.cy * CELL_SIZE);
      if (screen.x < -CELL_SIZE || screen.x > this.width + CELL_SIZE ||
          screen.y < -CELL_SIZE || screen.y > this.height + CELL_SIZE) continue;
      const sheetName = this.theatreSheetName(assets, s.type.toLowerCase());
      if (assets.hasSheet(sheetName)) {
        // C++ SmudgeTypeClass::Draw_It draws the theatre-specific smudge at
        // the cell icon's upper-left. Crater data selects larger damage frames.
        assets.drawFrame(ctx, sheetName, s.data ?? 0, screen.x, screen.y);
      }
    }
  }

  // ─── Overlays (ore, gems, walls) ────────────────────────

  private renderOverlays(camera: Camera, map: GameMap, tick: number, assets: AssetManager): void {
    const ctx = this.ctx;
    const startCX = Math.floor(camera.x / CELL_SIZE);
    const startCY = Math.floor(camera.y / CELL_SIZE);
    const endCX = Math.ceil((camera.x + camera.viewWidth) / CELL_SIZE);
    const endCY = Math.ceil((camera.y + camera.viewHeight) / CELL_SIZE);

    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        if (cx < 0 || cx >= 128 || cy < 0 || cy >= 128) continue;
        const ovl = map.overlay[cy * 128 + cx];
        if (ovl === 0xFF) continue;

        const screen = camera.worldToScreen(cx * CELL_SIZE, cy * CELL_SIZE);
        const drawX = screen.x + CELL_SIZE / 2;
        const drawY = screen.y + CELL_SIZE / 2;
        const overlayOptions = this.unitShadowOptions({ centerX: true, centerY: true });
        if (ovl >= 5 && ovl <= 8) {
          // Gold ore — OVERLAY_GOLD1..4 visual type; density is OverlayData.
          const density = map.oreDensity[cy * 128 + cx];
          const frame = density !== 0xFF ? Math.min(density, 11) : 0;
          const variant = ovl - 5 + 1;
          const sheetName = this.theatreSheetName(assets, `gold0${variant}`);
          assets.drawFrame(ctx, sheetName, frame, drawX, drawY, overlayOptions);
        } else if (ovl >= 9 && ovl <= 12) {
          // Gems — OVERLAY_GEMS1..4 visual type; density is OverlayData.
          const gemDensity = map.oreDensity[cy * 128 + cx];
          const frame = Math.min(gemDensity !== 0xFF ? gemDensity : 0, 2);
          const variant = ovl - 9 + 1;
          const sheetName = this.theatreSheetName(assets, `gem0${variant}`);
          assets.drawFrame(ctx, sheetName, frame, drawX, drawY, overlayOptions);
        } else {
          const crateSheet = overlayCrateSheet(ovl);
          if (crateSheet) {
            const sheetName = assets.hasSheet(crateSheet) ? crateSheet : 'wcrate';
            if (assets.hasSheet(sheetName)) {
              assets.drawFrame(ctx, sheetName, 0, drawX, drawY, overlayOptions);
            }
            continue;
          }
          const wallType = map.getWallType(cx, cy) || overlayWallType(ovl);
          const wallSheet = WALL_OVERLAY_SHEETS[wallType];
          if (wallSheet) {
            // C++ OverlayClass::Draw_It uses the wall SHP frame whose low
            // nibble is Wall_Update's NESW same-type connection mask.
            const mask = map.getWallConnectionIcon(cx, cy, wallType);
            const damageLevel = map.getWallDamageLevel(cx, cy);
            const damageBand = wallType === 'BRIK' || wallType === 'CYCL'
              ? Math.min(damageLevel, 2)
              : (damageLevel > 0 ? 1 : 0);
            assets.drawFrame(ctx, wallSheet, damageBand * 16 + mask, drawX, drawY, overlayOptions);
          }
        }
      }
    }
  }

  // ─── Structures ─────────────────────────────────────────

  private renderCrates(camera: Camera, map: GameMap, tick: number): void {
    const ctx = this.ctx;
    for (const crate of this.crates) {
      const cx = Math.floor(crate.x / CELL_SIZE);
      const cy = Math.floor(crate.y / CELL_SIZE);
      if (this.renderVisibility(map, cx, cy) !== 2) continue; // only show in fully visible area
      const screen = camera.worldToScreen(crate.x, crate.y);
      if (screen.x < -20 || screen.x > this.width || screen.y < -20 || screen.y > this.height) continue;
      // Draw a wooden crate icon (theatre-aware colors)
      const sz = 8;
      const bob = Math.sin(tick * 0.15) * 1.5; // gentle bobbing
      const crateColors = this.theatre === 'SNOW'
        ? { fill: '#b0c8d4', stroke: '#8aa8b8', cross: '#6888a0' }
        : { fill: '#8B4513', stroke: '#D2691E', cross: '#654321' };
      ctx.fillStyle = crateColors.fill;
      ctx.fillRect(screen.x - sz, screen.y - sz + bob, sz * 2, sz * 2);
      ctx.strokeStyle = crateColors.stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(screen.x - sz, screen.y - sz + bob, sz * 2, sz * 2);
      // Cross lines on crate
      ctx.beginPath();
      ctx.moveTo(screen.x - sz, screen.y - sz + bob);
      ctx.lineTo(screen.x + sz, screen.y + sz + bob);
      ctx.moveTo(screen.x + sz, screen.y - sz + bob);
      ctx.lineTo(screen.x - sz, screen.y + sz + bob);
      ctx.strokeStyle = crateColors.cross;
      ctx.stroke();
      // Type indicator dot
      const typeColor = crate.type === 'money' ? '#FFD700'
        : crate.type === 'heal' ? '#00FF00'
        : '#4488FF';
      ctx.fillStyle = typeColor;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y + bob, 2, 0, Math.PI * 2);
      ctx.fill();
      // Sparkle/glimmer effect
      const sparkPhase = (tick * 0.2 + screen.x * 0.1) % (Math.PI * 2);
      if (Math.sin(sparkPhase) > 0.7) {
        const sa = (Math.sin(sparkPhase) - 0.7) * 3.3;
        ctx.fillStyle = `rgba(255,255,200,${sa})`;
        const spx = screen.x + sz * 0.6;
        const spy = screen.y - sz * 0.6 + bob;
        ctx.fillRect(spx - 1, spy, 3, 1);
        ctx.fillRect(spx, spy - 1, 1, 3);
      }
    }
    // Defensive alpha reset after overlay pass
    ctx.globalAlpha = 1;
  }

  private renderStructures(
    camera: Camera,
    map: GameMap,
    structures: MapStructure[],
    assets: AssetManager,
    tick: number,
    structureIndices?: number[],
    dockedGroundEntities?: Map<number, Entity>,
  ): void {
    const ctx = this.ctx;
    for (let structIdx = 0; structIdx < structures.length; structIdx++) {
      const s = structures[structIdx];
      const originalStructIdx = structureIndices?.[structIdx] ?? structIdx;
      if (!s.alive) {
        // C++ BuildingClass::Take_Damage leaves a zero-strength building on
        // the map for CountDown frames. It still draws through Draw_It with
        // Strength=0 until BuildingClass::AI calls Limbo(), Drop_Debris(), and
        // deletes the object. There is no persistent TS-style rubble decal.
        if (s.debrisDropped || s.debrisCountdown === undefined) continue;
      }
      const vis = this.renderVisibility(map, s.cx, s.cy);
      if (vis === 0) continue; // fully shrouded

      const screen = camera.worldToScreen(s.cx * CELL_SIZE, s.cy * CELL_SIZE);
      const screenX = screen.x;
      const screenY = screen.y;

      // Construction/sell animation: clip building sprite progressively
      const isConstructing = s.buildProgress !== undefined && s.buildProgress < 1;
      const isSelling = s.sellProgress !== undefined;
      const sheet = assets.getSheet(s.image);
      if (sheet) {
        // Determine frame: damaged buildings use second half of frames
        const totalFrames = sheet.meta.frameCount;
        const damaged = s.hp <= s.maxHp * 0.5; // at or below 50% health (C++ uses <=)
        let frame = 0;
        // GUN turret: 128 frames = [32 normal][32 firing][32 damaged][32 damaged firing]
        // turretDir is now 32-step (0-31) — use directly with BODY_SHAPE
        if (s.type === 'GUN' && s.turretDir !== undefined) {
          const facingFrame = BODY_SHAPE[s.turretDir % 32];
          const baseFrame = damaged ? 64 : 0;
          const firingOffset = (s.firingFlash && s.firingFlash > 0) ? 32 : 0;
          frame = baseFrame + firingOffset + facingFrame;
        // SAM launcher: 68 frames = [2 closed + 32 rotation][34 damaged]
        } else if (s.type === 'SAM' && s.turretDir !== undefined) {
          const baseFrame = damaged ? 34 : 0;
          const facingFrame = BODY_SHAPE[s.turretDir % 32];
          frame = baseFrame + 2 + facingFrame;
        // AGUN turret: same 128-frame layout as GUN (32 normal, 32 firing, 32 damaged, 32 damaged-firing)
        } else if (s.type === 'AGUN' && s.turretDir !== undefined) {
          const facingFrame = BODY_SHAPE[s.turretDir % 32];
          const baseFrame = damaged ? 64 : 0;
          const firingOffset = (s.firingFlash && s.firingFlash > 0) ? 32 : 0;
          frame = baseFrame + firingOffset + facingFrame;
        } else if (s.type === 'TSLA') {
          // C++ building.cpp:598-611: Tesla coils do not use their active
          // animation as idle art. Shape 0 is forced unless IsCharging or
          // IsCharged overrides the stage.
          const stage = s.isCharged ? 3 : s.isCharging ? (s.chargeStage ?? 0) : 0;
          frame = (damaged ? 10 : 0) + Math.max(0, Math.min(9, stage));
        // Wall auto-connection: NESW bitmask selects from 16 connection patterns
        } else if (WALL_SPRITE_TYPES.has(s.type)) {
          const wt = map.getWallType(s.cx, s.cy) || s.type;
          const mask = wallConnectionMask(map, s.cx, s.cy, wt);
          if (s.type === 'BRIK') {
            // BRIK: 64 frames = [16 normal][16 damaged][16 heavy damage][16 unused]
            const hpRatio = s.hp / s.maxHp;
            frame = (damaged ? (hpRatio < 0.25 ? 32 : 16) : 0) + mask;
          } else {
            // SBAG/FENC/BARB: 32 frames = [16 normal][16 damaged]
            frame = (damaged ? 16 : 0) + mask;
          }
        } else {
          // Table-driven building frame selection
          const tableEntry = BUILDING_FRAME_TABLE[s.image];
          if (tableEntry) {
            const activeAnimCount = usesActiveBuildingAnimation(s) ? (tableEntry.activeAnimCount ?? 0) : 0;
            if (activeAnimCount > 0) {
              const baseFrame = damaged ? tableEntry.damageFrame : tableEntry.idleFrame;
              frame = buildingAnimationFrame(
                baseFrame,
                activeAnimCount,
                tableEntry.activeAnimRate ?? tableEntry.idleAnimRate ?? 8,
                totalFrames,
                tick,
              );
            } else if (tableEntry.idleAnimCount > 0) {
              // Animated building — cycle through animation frames.
              // E6: clamp animCount to what the sheet actually contains — the idleAnimCount
              // we declare may outrun totalFrames when a sheet hasn't been re-extracted yet.
              const baseFrame = damaged ? tableEntry.damageFrame : tableEntry.idleFrame;
              const rate = Math.max(1, tableEntry.idleAnimRate ?? 8);
              frame = buildingAnimationFrame(baseFrame, tableEntry.idleAnimCount, rate, totalFrames, tick);
            } else {
              // Static building — single frame, no cycling
              frame = damaged ? Math.min(tableEntry.damageFrame, Math.max(0, totalFrames - 1)) : tableEntry.idleFrame;
            }
          } else if (totalFrames === 2) {
            frame = damaged ? 1 : 0;
          } else {
            // Unknown building type — safe fallback: frame 0 or half (no cycling)
            frame = damaged ? Math.floor(totalFrames / 2) : 0;
          }
          // E6: final safety guard — if frame somehow overflows, wrap or clamp to avoid
          // garbled/out-of-bounds sprite draws while Cluster A re-extraction is pending.
          if (frame >= totalFrames || frame < 0) {
            frame = totalFrames > 0 ? ((frame % totalFrames) + totalFrames) % totalFrames : 0;
          }
        }
        // Construction/Sell: use dedicated *make buildup sheet if available (C++ RA parity).
        // In C++ RA, Get_Image_Data() switches to BuildupData (*make.shp) during BSTATE_CONSTRUCTION.
        // Sell plays the make frames in reverse. Fall back to cycling normal frames if no make sheet.
        let useSheet = s.image;
        let useFrame = frame;
        let useTotalFrames = totalFrames;
        if (isSelling || isConstructing) {
          const makeSheetName = s.image + 'make';
          const makeSheet = assets.getSheet(makeSheetName);
          if (makeSheet) {
            // Use the dedicated buildup sheet
            useSheet = makeSheetName;
            useTotalFrames = makeSheet.meta.frameCount;
            const maxFrame = useTotalFrames - 1;
            if (isConstructing) {
              useFrame = Math.min(Math.floor(s.buildProgress! * maxFrame), maxFrame);
            } else {
              useFrame = Math.max(0, Math.floor((1 - s.sellProgress!) * maxFrame));
            }
          } else {
            // No make sheet — cycle through normal frames 0..damageFrame-1
            const tableEntry2 = BUILDING_FRAME_TABLE[s.image];
            if (tableEntry2 && tableEntry2.damageFrame > 1) {
              const maxFrame = tableEntry2.damageFrame - 1;
              if (isConstructing) {
                useFrame = Math.min(Math.floor(s.buildProgress! * maxFrame), maxFrame);
              } else {
                useFrame = Math.max(0, Math.floor((1 - s.sellProgress!) * maxFrame));
              }
            }
          }
        }
        // Clamp frame to valid range
        useFrame = Math.min(useFrame, useTotalFrames - 1);
        // Resolve draw dimensions once (make sheet may differ from normal sheet)
        const drawMeta = (useSheet !== s.image ? assets.getSheet(useSheet)?.meta : null) ?? sheet.meta;
        const dfw = drawMeta.frameWidth;
        const dfh = drawMeta.frameHeight;
        // Building foundation bib: concrete pad under buildings (C++ bib.cpp).
        // BIB1=4x2, BIB2=3x2, BIB3=2x2. Bib type determined by building width.
        // Bib starts at the building's bottom row and extends 1 row below.
        if (!isConstructing && !isSelling && !WALL_SPRITE_TYPES.has(s.type)) {
          const [bw] = STRUCTURE_SIZE[s.type] ?? [0, 0];
          const bh = STRUCTURE_SIZE[s.type]?.[1] ?? 0;
          let bibName = '';
          if (bw === 4) bibName = 'bib1';
          else if (bw === 3) bibName = 'bib2';
          else if (bw === 2) bibName = 'bib3';
          // Theatre-specific bib sprites
          if (bibName && getBibCells(s.type, s.cx, s.cy).length > 0) {
            const theatreBib = this.theatre === 'SNOW' ? bibName + '_snow' : bibName;
            const bibSheetName = assets.getSheet(theatreBib) ? theatreBib : bibName;
            if (assets.getSheet(bibSheetName)) {
              // Bib starts at bottom row of building (Height-1), 2 rows tall
              const bibStartY = screenY + (bh - 1) * CELL_SIZE;
              for (let by = 0; by < 2; by++) {
                for (let bx = 0; bx < bw; bx++) {
                  const frame = by * bw + bx;
                  assets.drawFrame(ctx, bibSheetName, frame,
                    screenX + bx * CELL_SIZE, bibStartY + by * CELL_SIZE);
                }
              }
            }
          }
        }
        // C++ draws mapped structures at full brightness; Redraw_Shadow's
        // SHADOW.SHP overlay supplies fog dimming after objects are drawn.
        const hasMakeSheet = useSheet !== s.image; // true when dedicated buildup sprite exists
        // Construction: make sheet plays frames naturally. Missing make sheet = bug.
        if (isConstructing && !hasMakeSheet) {
          // MISSING MAKE SHEET — draw ugly pink/magenta box so it's obvious
          ctx.fillStyle = '#FF00FF';
          ctx.fillRect(screenX - dfw / 2, screenY - dfh / 2, dfw, dfh);
          ctx.fillStyle = '#FF69B4';
          ctx.fillRect(screenX - dfw / 2 + 4, screenY - dfh / 2 + 4, dfw - 8, dfh - 8);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('NO MAKE', screenX + dfw / 2 - dfw / 2, screenY);
          ctx.fillText(s.type, screenX + dfw / 2 - dfw / 2, screenY + 10);
          ctx.textAlign = 'left';
        }
        // Sell: shrink building top-to-bottom (reverse of construction) while fading
        if (isSelling) {
          const prog = s.sellProgress!;
          const remainH = Math.floor(dfh * (1 - prog));
          ctx.save();
          ctx.beginPath();
          ctx.rect(screenX - dfh / 2, screenY + dfh / 2 - remainH, dfw + dfh, remainH);
          ctx.clip();
          ctx.globalAlpha = Math.max(0.15, 1 - prog);
        }
        // House color remap: BuildingClass::Draw_It is const, so C++ resolves
        // Techno_Draw_Object's Remap_Table() call to TechnoClass::Remap_Table()
        // const. Only bdata IsRemappable=true building bodies use owner remap.
        const bldgRemapped = structureUsesHouseRemap(s.type)
          ? assets.getRemappedSheet(useSheet, s.house)
          : null;
        const drawCenter = structureDrawCenter(s, screenX, screenY);
        const buildingDrawOptions = this.unitShadowOptions({ centerX: true, centerY: true });
        if (bldgRemapped) {
          assets.drawFrameFrom(ctx, bldgRemapped, useSheet, useFrame % useTotalFrames,
            drawCenter.x, drawCenter.y, buildingDrawOptions);
        } else {
          assets.drawFrame(ctx, useSheet, useFrame % useTotalFrames, drawCenter.x, drawCenter.y, buildingDrawOptions);
        }
        if (!isConstructing && !isSelling && s.dockedAircraft !== undefined) {
          const docked = dockedGroundEntities?.get(s.dockedAircraft);
          if (docked && docked.occupiesCppLogic() && !docked.inLimbo) {
            // C++ building.cpp:484-492 redraws a tethered radio contact after
            // the building body and clears the contact's standalone display.
            this.renderEntities(camera, map, [docked], assets, this._selectedIds, tick);
          }
        }
        // WEAP2 door overlay — C++ building.cpp:500-503 Techno_Draw_Object(WarFactoryOverlay, Door_Stage())
        // WEAP2.SHP = 8 frames (0=closed..7=open), drawn on top of WEAP base sprite.
        // Door opens (0→7) when the 'unit' production queue is active, closes (7→0) when idle.
        if (s.image === 'weap' && assets.hasSheet('weap2') && !isConstructing && !isSelling) {
          // Drive door state from production queue: open while producing vehicles
          const isProducingUnit = this.sidebarQueue.has('unit');
          if (s.doorFrame === undefined) s.doorFrame = 0;
          if (isProducingUnit) {
            // Animate door opening: increment by 1 per tick up to 7
            if (s.doorFrame < 7) s.doorFrame = Math.min(7, s.doorFrame + 1);
          } else {
            // Animate door closing: decrement by 1 per tick down to 0
            if (s.doorFrame > 0) s.doorFrame = Math.max(0, s.doorFrame - 1);
          }
          assets.drawFrame(ctx, 'weap2', s.doorFrame, drawCenter.x, drawCenter.y, {
            centerX: true, centerY: true,
          });
        }
        // Blushing target/electric flash — C++ flasher.cpp:83-95 + house.cpp:2308
        // (blush → Map.FadingLight). Ordinary damage does not set FlashCount.
        if (s.flashCount && s.flashCount > 0 && (s.flashCount & 0x01) !== 0) {
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = 'rgba(200,200,200,0.5)';
          const [bw, bh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
          ctx.fillRect(screenX, screenY, bw * CELL_SIZE, bh * CELL_SIZE);
          ctx.globalCompositeOperation = 'source-over';
        }
        // (no construction fallback — pink/magenta box rendered above if make sheet missing)
        if (isSelling) {
          // Red sell scanline at the shrinking edge — drawn before restore to stay within clip
          const shrinkY = screenY + dfh / 2 - Math.floor(dfh * (1 - s.sellProgress!));
          ctx.fillStyle = `rgba(255,80,80,${0.4 + 0.2 * Math.sin(tick * 0.5)})`;
          ctx.fillRect(screenX - 2, shrinkY - 1, dfw + 4, 2);
          ctx.restore();
        }
      } else {
        // Missing sprite stub: magenta checkerboard + label (matches missing tile pattern)
        this.renderMissingSpriteStub(ctx, screenX, screenY, CELL_SIZE, CELL_SIZE, s.type);
      }

      // Power brownout dimming — multiply blend preserves hue (C++ FadingShade remap)
      if (this.sidebarPowerConsumed > this.sidebarPowerProduced * 1.5 && this.sidebarPowerProduced > 0) {
        const defenseTypes = ['HBOX', 'GUN', 'TSLA', 'PBOX'];
        if (defenseTypes.includes(s.type)) {
          const pulse = 0.6 + 0.1 * Math.sin(tick * 0.15);
          const shade = Math.floor(pulse * 255);
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
          const [bw, bh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
          ctx.fillRect(screenX, screenY, bw * CELL_SIZE, bh * CELL_SIZE);
          ctx.globalCompositeOperation = 'source-over';
        }
      }

      // Health bar on selected structures (visible only)
      // C++ techno.cpp:1121-1153 + bdata.cpp:3399-3405:
      //   Dimensions: width = Width() * ICON_PIXEL_W - Width() * ICON_PIXEL_W / 5
      //   = Width() * 24 * 4/5  (building footprint width scaled to 80%)
      //   Bar is centered on building center.
      if (s.alive && vis === 2 && this.selectedStructureIdx === originalStructIdx) {
        const [fw] = STRUCTURE_SIZE[s.type] ?? [2, 2];
        const cppBarW = Math.floor(fw * CELL_SIZE * 4 / 5);
        const barX = screenX + (fw * CELL_SIZE) / 2;
        const barY = screenY - 2;
        this.renderHealthBar(barX, barY, cppBarW, s.hp / s.maxHp, false);
      }

      // Selection highlight — white border when structure is selected
      if (s.alive && this.selectedStructureIdx === originalStructIdx) {
        const [selW, selH] = STRUCTURE_SIZE[s.type] ?? [2, 2];
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(screenX - 1, screenY - 1, selW * CELL_SIZE + 2, selH * CELL_SIZE + 2);
      }

      // Repair indicator: pulsing green border + wrench icon
      if (s.alive && this.repairingStructures.has(originalStructIdx)) {
        const pulse = 0.4 + 0.4 * Math.sin(tick * 0.3);
        ctx.strokeStyle = `rgba(80,255,80,${pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(screenX, screenY, CELL_SIZE * 2, CELL_SIZE * 2);
        // Wrench icon (animated sparkle)
        const wx = screenX + CELL_SIZE;
        const wy = screenY - 4;
        const sparkle = Math.sin(tick * 0.5) > 0;
        ctx.fillStyle = sparkle ? '#8f8' : '#4c4';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('\u2692', wx, wy); // ⚒ hammer and pick
        ctx.textAlign = 'left';
      }

      // Construction Yard primary marker — spinning gear icon when producing
      if (s.type === 'FACT' && (s.house === 'Spain' || s.house === 'Greece') && vis === 2) {
        const hasProduction = this.sidebarQueue.size > 0;
        if (hasProduction) {
          // Animated spinning gear
          const gx = screenX + CELL_SIZE * 1.5;
          const gy = screenY + 4;
          ctx.save();
          ctx.translate(gx, gy);
          ctx.rotate(tick * 0.1);
          ctx.fillStyle = '#FFD700';
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('\u2699', 0, 3); // ⚙ gear
          ctx.restore();
          ctx.textAlign = 'left';
        }
      }

      // Always reset alpha — prevents leak from fog dimming/brownout to next structure
      ctx.globalAlpha = 1;
    }
  }

  // ─── Corpses ─────────────────────────────────────────────

  private renderCorpses(camera: Camera, map: GameMap, assets: AssetManager, tick: number): void {
    const ctx = this.ctx;
    for (const c of this.corpses) {
      const corpseAnim = cppCorpseAnimForInfantryDeath(c.deathVariant);
      if (!c.isInfantry || c.isAnt || c.type === UnitType.I_DOG || !corpseAnim) continue;

      const elapsed = Math.max(0, tick - (c.cppAnimStartTick ?? tick));
      const frame = Math.floor(elapsed / CPP_CORPSE_FRAME_TICKS);
      if (frame >= CPP_CORPSE_FRAME_COUNT) continue;

      const ecx = Math.floor(c.x / CELL_SIZE);
      const ecy = Math.floor(c.y / CELL_SIZE);
      if (this.renderVisibility(map, ecx, ecy) === 0) continue;
      const screen = camera.worldToScreen(c.x, c.y);
      if (screen.x < -32 || screen.x > this.width + 32 || screen.y < -32 || screen.y > this.height + 32) continue;

      const sheetName = this.theatreSheetName(assets, corpseAnim.sprite);
      assets.drawFrameTranslucent(ctx, sheetName, frame, screen.x, screen.y, this.pal, CPP_MAGIC_TRANSLUCENT_CONTROLS, {
        centerX: true,
        centerY: true,
      });
    }
    ctx.globalAlpha = 1;
  }

  // ─── Entities ────────────────────────────────────────────

  private drawVesselTurretFrame(
    ctx: CanvasRenderingContext2D,
    assets: AssetManager,
    entity: Entity,
    sheetName: string,
    frame: number,
    x: number,
    y: number,
  ): void {
    if (!assets.getSheet(sheetName)) return;
    const remapped = assets.getRemappedSheet(sheetName, entity.house);
    const drawOptions = this.unitShadowOptions({ centerX: true, centerY: true });
    if (remapped) {
      assets.drawFrameFrom(ctx, remapped, sheetName, frame, x, y, drawOptions);
    } else {
      assets.drawFrame(ctx, sheetName, frame, x, y, drawOptions);
    }
  }

  private renderVesselTurrets(
    ctx: CanvasRenderingContext2D,
    assets: AssetManager,
    entity: Entity,
    screen: { x: number; y: number },
  ): void {
    if (!entity.hasTurret) return;

    const primaryFacing256 = entity.bodyFacing256 >= 0
      ? entity.bodyFacing256 & 0xff
      : (entity.bodyFacing32 * 8) & 0xff;
    const turretFacing32 = lerpFacing32(
      entity.prevTurretFacing32,
      entity.turretFacing32,
      this.interpolationAlpha,
    );
    const turretFrame = BODY_SHAPE[turretFacing32] ?? 0;
    const bodyTurretDir = (dir256ToFacing16(primaryFacing256) * 16) & 0xff;

    switch (entity.type) {
      case UnitType.V_PT: {
        const offset = normalMovePointOffset(bodyTurretDir, 14);
        this.drawVesselTurretFrame(ctx, assets, entity, 'mgun', turretFrame, screen.x + offset.dx, screen.y + offset.dy + 1);
        break;
      }
      case UnitType.V_DD: {
        const offset = normalMovePointOffset(bodyTurretDir + DIR_S_256, 8);
        this.drawVesselTurretFrame(ctx, assets, entity, 'ssam', turretFrame, screen.x + offset.dx, screen.y + offset.dy - 4);
        break;
      }
      case UnitType.V_CA: {
        const front = normalMovePointOffset(bodyTurretDir, 22);
        this.drawVesselTurretFrame(ctx, assets, entity, 'turr', turretFrame, screen.x + front.dx, screen.y + front.dy - 4);
        const rearDir = (dir256ToFacing16(primaryFacing256 + DIR_S_256) * 16) & 0xff;
        const rear = normalMovePointOffset(rearDir, 22);
        this.drawVesselTurretFrame(ctx, assets, entity, 'turr', turretFrame, screen.x + rear.dx, screen.y + rear.dy - 4);
        break;
      }
    }
  }

  private renderEntities(
    camera: Camera,
    map: GameMap,
    entities: Entity[],
    assets: AssetManager,
    selectedIds: Set<number>,
    tick: number,
  ): void {
    const ctx = this.ctx;

    // Sort by C++ Sort_Y() for depth ordering; dead entities render behind alive ones.
    const sorted = [...entities];
    sorted.sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? 1 : -1;
      return cppEntityRenderSortKey(a) - cppEntityRenderSortKey(b);
    });

    for (const entity of sorted) {
      // C++ bullet.cpp:96-175 — dog in limbo rides bullet, not rendered on map
      if (entity.inLimbo) continue;
      // C++ only queues active Cell_Occupier/Overlapper objects for Draw_It.
      // Destroyed vehicles run UnitClass::Take_Damage -> Mark(MARK_UP) ->
      // delete this, but TS can retain them for bookkeeping after their C++
      // Logic slot is gone. Dying infantry and sunk vessels still occupy the
      // original active paths through Entity.occupiesCppLogic().
      if (!entity.occupiesCppLogic()) continue;
      // C++ vessel.cpp:958-973 removes destroyed vessels from the rendered map
      // path with Mark(MARK_UP) before delete this. TS may retain the object to
      // preserve logic/RNG side effects, but the dead vessel sprite is gone.
      if (!entity.alive && entity.stats.isVessel) continue;

      const ecx = Math.floor(entity.pos.x / CELL_SIZE);
      const ecy = Math.floor(entity.pos.y / CELL_SIZE);

      // Don't render entities in unmapped cells (C++ cell.cpp:1275 — Draw_It
      // only called when cellptr->IsMapped is true; single-cell check, no neighbors)
      if (this.renderVisibility(map, ecx, ecy) === 0) continue;
      // C++ (cell.cpp:1275): objects drawn in any IsMapped cell — fog only dims terrain,
      // not units. Enemy units remain visible in explored-but-not-in-sight cells.

      // Render interpolation: smooth position between ticks for 60fps visual
      const alpha = this.interpolationAlpha;
      const renderX = entity.prevPos.x + (entity.pos.x - entity.prevPos.x) * alpha;
      const renderY = entity.prevPos.y + (entity.pos.y - entity.prevPos.y) * alpha;

      // Sub-cell offset is now baked into entity.leptonX/Y (Phase 4 lepton parity),
      // so pos.x/pos.y already reflect the sub-cell position. No extra offset needed.
      // Air units: apply flight altitude offset (renders higher, shadow at ground level)
      const altY = entity.isAirUnit ? entity.flightAltitude : 0;
      const screen = camera.worldToScreen(renderX, renderY);
      const sheet = assets.getSheet(entity.stats.image);
      const spriteW = sheet ? sheet.meta.frameWidth : (entity.stats.isInfantry ? 50 : 24);
      const spriteH = sheet ? sheet.meta.frameHeight : (entity.stats.isInfantry ? 39 : 24);

      if (!camera.isVisible(
        renderX - spriteW / 2,
        renderY - spriteH / 2,
        spriteW, spriteH
      )) continue;

      // C++ draws death Doing sequences at full palette strength until the
      // InfantryClass object is deleted or creates its follow-up corpse AnimClass.

      // Submarine/phase cloak rendering
      let drawPlayerCloakShadowy = false;
      if (entity.alive && entity.stats.isCloakable) {
        if (entity.cloakState === CloakState.CLOAKED) {
          if (entity.isPlayerUnit) {
            // C++ techno.cpp:4316 + 4444 — player-owned fully cloaked
            // objects draw as VISUAL_SHADOWY via SHAPE_PREDATOR|SHAPE_FADING.
            drawPlayerCloakShadowy = true;
          } else {
            // Enemy cloaked subs: invisible unless detected by sonar
            if (entity.sonarPulseTimer > 0) {
              ctx.globalAlpha = 0.4; // sonar-detected: partially visible
            } else {
              continue; // fully invisible to enemy
            }
          }
        } else if (entity.cloakState === CloakState.CLOAKING) {
          // Gradually fade out (1.0 → 0.15 over transition)
          const progress = 1 - (entity.cloakTimer / CLOAK_TRANSITION_FRAMES);
          ctx.globalAlpha = 1.0 - progress * 0.85;
        } else if (entity.cloakState === CloakState.UNCLOAKING) {
          // Gradually fade in (0.15 → 1.0 over transition)
          const progress = 1 - (entity.cloakTimer / CLOAK_TRANSITION_FRAMES);
          ctx.globalAlpha = 0.15 + progress * 0.85;
        }
      }

      // C++ fog dimming: objects rendered at full brightness; the SHADOW.SHP overlay
      // (renderFogOfWar, drawn after entities) handles the visual darkening for fogged cells.
      // No entity-level alpha reduction needed — avoids double-dimming.

      // C++ SHAPE_GHOST: palette index 4 is encoded in sprite PNGs with alpha
      // 130 as a sentinel; AssetManager maps it through UnitShadow at draw time.
      const preShadowAlpha = ctx.globalAlpha;
      // Restore cloak alpha for sprite rendering
      ctx.globalAlpha = preShadowAlpha;

      // Apply altitude offset for rendering (sprite drawn higher)
      screen.y -= altY;

      // C++ infantry.cpp:545-548 adjusts InfantryClass::Draw_It before
      // Techno_Draw_Object: y += 4; x -= 2.
      if (entity.stats.isInfantry) {
        screen.x -= 2;
        screen.y += 4;
      }

      // Harvester dock-slide: while dumping ore, slide the HARV sprite slightly north into
      // the PROC footprint (visual overlap with refinery bay — C++ docks the harvester at
      // south-center of the 3x3 refinery and the sprite origin is shifted upward ~8px
      // during the 22-tick dump animation for visual integration with the bay doors).
      if (entity.type === UnitType.V_HARV && entity.harvesterState === 'unloading' && entity.isHarvesterDumping) {
        screen.y -= 8;
      }

      // Selection brackets — 4 white corner L-shapes (C++ techno.cpp:1159-1187)
      // C++ draws only corner brackets, no ellipse underneath.
      if (selectedIds.has(entity.id) && entity.alive) {
        const bx0 = screen.x - spriteW / 2;
        const by0 = screen.y - spriteH / 2;
        const bx1 = screen.x + spriteW / 2;
        const by1 = screen.y + spriteH / 2;
        const armW = spriteW / 5; // bracket arm length = 1/5 of sprite width
        const armH = spriteH / 5; // bracket arm length = 1/5 of sprite height
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        // Top-left corner
        ctx.beginPath();
        ctx.moveTo(bx0 + armW, by0);
        ctx.lineTo(bx0, by0);
        ctx.lineTo(bx0, by0 + armH);
        ctx.stroke();
        // Top-right corner
        ctx.beginPath();
        ctx.moveTo(bx1 - armW, by0);
        ctx.lineTo(bx1, by0);
        ctx.lineTo(bx1, by0 + armH);
        ctx.stroke();
        // Bottom-left corner
        ctx.beginPath();
        ctx.moveTo(bx0 + armW, by1);
        ctx.lineTo(bx0, by1);
        ctx.lineTo(bx0, by1 - armH);
        ctx.stroke();
        // Bottom-right corner
        ctx.beginPath();
        ctx.moveTo(bx1 - armW, by1);
        ctx.lineTo(bx1, by1);
        ctx.lineTo(bx1, by1 - armH);
        ctx.stroke();

        // Medic heal range circle (dashed green)
        if (entity.type === UnitType.I_MEDI) {
          const healRange = entity.stats.sight * 1.5 * CELL_SIZE;
          ctx.strokeStyle = 'rgba(80,255,80,0.2)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(screen.x, screen.y + altY, healRange, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Draw sprite with house-color remapping
      if (sheet) {
        // Interpolate vehicle facing for smooth 60fps rotation rendering
        let frame: number;
        if (!entity.stats.isInfantry && !entity.isAnt) {
          const interpBody = lerpFacing32(entity.prevBodyFacing32, entity.bodyFacing32, alpha);
          if (entity.stats.isVessel) {
            frame = vesselBodyFrame(entity, interpBody, sheet.meta.frameCount);
          } else if (entity.stats.isAircraft) {
            const interpSecondary = lerpFacing32(entity.prevTurretFacing32, entity.turretFacing32, alpha);
            frame = aircraftBodyFrame(entity, interpSecondary, sheet.meta.frameCount);
          } else {
            frame = (BODY_SHAPE[interpBody] ?? 0) % sheet.meta.frameCount;
          }
          // Harvester dump/load animation overlay (C++ unit.cpp:1902-1975 Shape_Number)
          // HARV sheet layout: 0-31 body rotation, 32-95 scoop anim, 96-110 dump anim.
          if (entity.type === UnitType.V_HARV && sheet.meta.frameCount >= 96) {
            if (entity.isHarvesterDumping) {
              // C++: shapenum = Harvester_Dump_List[stage] + 96
              const stage = Math.min(entity.harvesterAnimStage, HARVESTER_DUMP_LIST.length - 1);
              frame = (96 + HARVESTER_DUMP_LIST[stage]) % sheet.meta.frameCount;
            } else if (entity.isHarvesterMining) {
              // C++: shapenum = 32 + ((BodyShape[facing]+2)/4)*8 + Harvester_Load_List[stage]
              const quadrant = ((BODY_SHAPE[entity.bodyFacing32] ?? 0) + 2) >> 2; // /4
              const q = quadrant & 7;
              const stage = Math.min(entity.harvesterAnimStage, HARVESTER_LOAD_LIST.length - 1);
              frame = (32 + q * 8 + HARVESTER_LOAD_LIST[stage]) % sheet.meta.frameCount;
            }
          }
        } else {
          frame = entity.spriteFrame % sheet.meta.frameCount;
        }
        // Compute recoil offset (C++ Recoil_Adjust — 1px kickback for 1 tick)
        let recoilDx = 0, recoilDy = 0;
        if (entity.isInRecoilState && !entity.stats.isInfantry) {
          const rFacing = entity.hasTurret ? entity.turretFacing : entity.facing;
          const ro = RECOIL_OFFSETS[rFacing];
          recoilDx = ro.dx;
          recoilDy = ro.dy;
        }
        // Use house-remapped sheet if available (ants use native brown/olive sprites, no remap)
        const remapped = entity.isAnt ? null : assets.getRemappedSheet(entity.stats.image, entity.house);
        const aircraftRotation = entity.stats.isAircraft ? aircraftShapeRotation(entity) : 0;
        const bodyDrawOptions = this.unitShadowOptions({
          centerX: true,
          centerY: true,
          ...(aircraftRotation !== 0 ? { rotation256: aircraftRotation } : {}),
        });
        const specialGhost = (assets as AssetManager & {
          drawFrameSpecialGhost?: (
            ctx: CanvasRenderingContext2D,
            sheetName: string,
            frameIndex: number,
            x: number,
            y: number,
            palette: number[][] | null,
            options?: DrawFrameOptions,
          ) => void;
        }).drawFrameSpecialGhost;
        if (entity.stats.isAircraft && entity.alive && this.pal && typeof specialGhost === 'function') {
          // C++ aircraft.cpp:454 draws a manual body-shaped shadow at ground
          // coordinates before Techno_Draw_Object subtracts flight height.
          specialGhost.call(assets, ctx, entity.stats.image, frame,
            screen.x + 1, screen.y + altY + 2, this.pal, { centerX: true, centerY: true });
        }
        if (drawPlayerCloakShadowy && this.pal && typeof specialGhost === 'function') {
          specialGhost.call(assets, ctx, entity.stats.image, frame,
            screen.x, screen.y, this.pal, bodyDrawOptions);
        } else if (remapped) {
          assets.drawFrameFrom(ctx, remapped, entity.stats.image, frame,
            screen.x, screen.y, bodyDrawOptions);
        } else {
          assets.drawFrame(ctx, entity.stats.image, frame,
            screen.x, screen.y, bodyDrawOptions);
        }
        if (entity.stats.isVessel) {
          this.renderVesselTurrets(ctx, assets, entity, screen);
        // Draw turret layer for turreted vehicles (frames 32-63)
        } else if (entity.hasTurret && sheet.meta.frameCount >= 64) {
          const interpTurret = lerpFacing32(entity.prevTurretFacing32, entity.turretFacing32, alpha);
          const turretFrame = (32 + (BODY_SHAPE[interpTurret] ?? 0)) % sheet.meta.frameCount;
          // JEEP turret y-offset (C++ udata.cpp Turret_Adjust)
          const turretOffY = entity.type === UnitType.V_JEEP ? -4 : 0;
          const turretDrawOptions = this.unitShadowOptions({ centerX: true, centerY: true });
          if (remapped) {
            assets.drawFrameFrom(ctx, remapped, entity.stats.image, turretFrame,
              screen.x + recoilDx, screen.y + recoilDy + turretOffY, turretDrawOptions);
          } else {
            assets.drawFrame(ctx, entity.stats.image, turretFrame,
              screen.x + recoilDx, screen.y + recoilDy + turretOffY, turretDrawOptions);
          }
        }
        // C++ aircraft.cpp:491-528 — helicopter rotors are separate SHP
        // overlays. TRAN uses paired rotor sets offset along SecondaryFacing.
        if (entity.isRotorEquipped && entity.alive) {
          const rotorStage = Math.max(0, entity.aircraftRotorStage);
          const rotorFrame = entity.aircraftHeightLeptons === 0
            ? (rotorStage % 8) + 4
            : rotorStage % 4;
          const rotorOptions = entity.aircraftHeightLeptons === 0
            ? this.unitShadowOptions({ centerX: true, centerY: true })
            : { centerX: true, centerY: true };
          const drawRotor = (sheetName: string, frameIndex: number, x: number, y: number) => {
            const specialGhost = (assets as AssetManager & {
              drawFrameSpecialGhost?: (
                ctx: CanvasRenderingContext2D,
                sheetName: string,
                frameIndex: number,
                x: number,
                y: number,
                palette: number[][] | null,
                options?: DrawFrameOptions,
              ) => void;
            }).drawFrameSpecialGhost;
            if (entity.aircraftHeightLeptons > 0 && this.pal && typeof specialGhost === 'function') {
              specialGhost.call(assets, ctx, sheetName, frameIndex, x, y, this.pal, rotorOptions);
            } else {
              assets.drawFrame(ctx, sheetName, frameIndex, x, y, rotorOptions);
            }
          };
          const secondaryFacing256 = entity.turretFacing256 >= 0
            ? entity.turretFacing256 & 0xff
            : (entity.turretFacing32 * 8) & 0xff;
          if (entity.type === UnitType.V_TRAN) {
            const stretch = [8, 9, 10, 9, 8, 9, 10, 9] as const;
            const face = dir256ToFacing8(secondaryFacing256);
            let rx = screen.x;
            let ry = screen.y;
            const front = movePointOffset(secondaryFacing256, stretch[face]);
            rx += front.dx;
            ry += front.dy;
            drawRotor('rrotor', rotorFrame, rx, ry - 2);
            const rear = movePointOffset(secondaryFacing256 + DIR_S_256, stretch[face] * 2);
            rx += rear.dx;
            ry += rear.dy;
            drawRotor('lrotor', rotorFrame, rx, ry - 2);
          } else {
            drawRotor('rrotor', rotorFrame, screen.x, screen.y - 2);
          }
        }
        // C++ uses palette index remapping for house colors — handled by
        // getRemappedSheet() above. No fallback tint overlay needed.
        // Predator shimmer during cloak/uncloak transitions (C++ SHAPE_PREDATOR pixel-offset sampling)
        if (entity.stats.isCloakable &&
            (entity.cloakState === CloakState.CLOAKING || entity.cloakState === CloakState.UNCLOAKING)) {
          const shimmerOffset = ((tick % 4) < 2) ? 1 : -1;
          ctx.globalAlpha = preShadowAlpha * 0.3;
          const shimmerFrame = entity.spriteFrame % sheet.meta.frameCount;
          if (remapped) {
            assets.drawFrameFrom(ctx, remapped, entity.stats.image, shimmerFrame,
              screen.x + shimmerOffset, screen.y, { centerX: true, centerY: true });
            assets.drawFrameFrom(ctx, remapped, entity.stats.image, shimmerFrame,
              screen.x - shimmerOffset, screen.y + 1, { centerX: true, centerY: true });
          } else {
            assets.drawFrame(ctx, entity.stats.image, shimmerFrame,
              screen.x + shimmerOffset, screen.y, { centerX: true, centerY: true });
            assets.drawFrame(ctx, entity.stats.image, shimmerFrame,
              screen.x - shimmerOffset, screen.y + 1, { centerX: true, centerY: true });
          }
          ctx.globalAlpha = preShadowAlpha;
        }
        // Harvester harvesting animation: small ore chunks flying into harvester
        if (entity.type === UnitType.V_HARV && entity.harvesterState === 'harvesting') {
          for (let i = 0; i < 2; i++) {
            const angle = ((tick * 0.5 + i * 3.14) % (Math.PI * 2));
            const dist = 6 + Math.sin(tick * 0.4 + i * 2) * 3;
            const ox = screen.x + Math.cos(angle) * dist;
            const oy = screen.y + Math.sin(angle) * dist * 0.6;
            const oa = 0.6 + 0.3 * Math.sin(tick * 0.3 + i);
            ctx.fillStyle = `rgba(180,140,40,${oa})`;
            ctx.fillRect(ox - 1, oy - 1, 2, 2);
          }
        }
        // Harvester unloading animation: pulsing money particles rising from unit
        if (entity.type === UnitType.V_HARV && entity.harvesterState === 'unloading') {
          const phase = (tick * 0.3) % (Math.PI * 2);
          for (let i = 0; i < 3; i++) {
            const px = screen.x - 4 + (i * 4);
            const py = screen.y - spriteH * 0.3 - ((tick * 0.8 + i * 5) % 12);
            const pa = 0.8 - ((tick * 0.8 + i * 5) % 12) / 12;
            ctx.fillStyle = `rgba(255,220,60,${pa})`;
            ctx.fillRect(px, py, 2, 2);
          }
          // Subtle yellow glow around harvester
          ctx.fillStyle = `rgba(255,220,60,${0.1 + 0.05 * Math.sin(phase)})`;
          ctx.beginPath();
          ctx.ellipse(screen.x, screen.y, spriteW * 0.5, spriteH * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Missing sprite stub: magenta checkerboard + label (matches missing tile pattern)
        const size = entity.stats.isInfantry ? 16 : 24;
        this.renderMissingSpriteStub(ctx, screen.x - size / 2, screen.y - size / 2, size, size, entity.type);
      }

      // Iron Curtain red overlay — invulnerable unit (C++ techno.cpp:4276 FadingRed palette remap)
      // C++ replaces normal house remap with DisplayClass::FadingRed — a red-shifted palette
      // remap table that makes the entire unit/building glow red. We use the 'IronCurtain'
      // house key in remap-colors.json for pixel-accurate red-shift matching C++.
      if (entity.alive && entity.ironCurtainTick > 0) {
        const icRemapped = sheet ? assets.getRemappedSheet(entity.stats.image, 'IronCurtain') : null;
        if (icRemapped && sheet) {
          // Recompute the current body frame (mirrors logic from the sprite draw block above)
          let icFrame: number;
          if (!entity.stats.isInfantry && !entity.isAnt) {
            const interpBody = lerpFacing32(entity.prevBodyFacing32, entity.bodyFacing32, alpha);
            icFrame = (BODY_SHAPE[interpBody] ?? 0) % sheet.meta.frameCount;
          } else {
            // Infantry/Ants: use entity.spriteFrame which handles all animation states
            icFrame = entity.spriteFrame % sheet.meta.frameCount;
          }
          // Redraw the unit body with FadingRed remap over the normal house-colored sprite.
          // C++ draws ONE pass with the red remap — we overdraw since the normal sprite
          // is already rendered above. Use source-over compositing (opaque redraw).
          assets.drawFrameFrom(ctx, icRemapped, entity.stats.image, icFrame,
            screen.x, screen.y, { centerX: true, centerY: true });
          // If turreted, also redraw turret with red remap
          if (entity.hasTurret && sheet.meta.frameCount >= 64) {
            const interpTurret = lerpFacing32(entity.prevTurretFacing32, entity.turretFacing32, alpha);
            const turretFrame = (32 + (BODY_SHAPE[interpTurret] ?? 0)) % sheet.meta.frameCount;
            const turretOffY = entity.type === UnitType.V_JEEP ? -4 : 0;
            assets.drawFrameFrom(ctx, icRemapped, entity.stats.image, turretFrame,
              screen.x, screen.y + turretOffY, { centerX: true, centerY: true });
          }
        } else {
          // Fallback: multiply blend overlay if IronCurtain remap not available
          const pulse = 0.25 + 0.15 * Math.sin(tick * 0.3);
          ctx.globalCompositeOperation = 'multiply';
          const redShade = Math.floor(255 * (1 - pulse * 0.5));
          ctx.fillStyle = `rgb(255,${redShade * 0.3},${redShade * 0.3})`;
          ctx.fillRect(screen.x - spriteW / 2, screen.y - spriteH / 2, spriteW, spriteH);
          ctx.globalCompositeOperation = 'source-over';
        }
        // Red glow ring (C++ doesn't have this but it aids visibility at game scale)
        ctx.strokeStyle = `rgba(255,40,40,${0.4 + 0.2 * Math.sin(tick * 0.2)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(screen.x, screen.y, spriteW * 0.5 + 2, spriteH * 0.4 + 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Chrono Shift blue flash — recently teleported unit
      if (entity.alive && entity.chronoShiftTick > 0) {
        const fadeAlpha = entity.chronoShiftTick / CHRONO_SHIFT_VISUAL_TICKS;
        ctx.fillStyle = `rgba(80,140,255,${fadeAlpha * 0.4})`;
        ctx.fillRect(screen.x - spriteW / 2, screen.y - spriteH / 2, spriteW, spriteH);
        // Electric sparkle particles
        for (let sp = 0; sp < 3; sp++) {
          const angle = ((tick * 0.8 + sp * 2.1) % (Math.PI * 2));
          const dist = spriteW * 0.3 + Math.sin(tick * 0.5 + sp) * 3;
          const sx = screen.x + Math.cos(angle) * dist;
          const sy = screen.y + Math.sin(angle) * dist * 0.6;
          ctx.fillStyle = `rgba(120,180,255,${fadeAlpha * 0.8})`;
          ctx.fillRect(sx - 1, sy - 1, 2, 2);
        }
      }

      // Crate invulnerability shimmer (existing mechanic — visual indicator)
      if (entity.alive && entity.invulnTick > 0 && entity.ironCurtainTick <= 0) {
        const pulse = 0.15 + 0.1 * Math.sin(tick * 0.4);
        ctx.fillStyle = `rgba(200,200,255,${pulse})`;
        ctx.fillRect(screen.x - spriteW / 2, screen.y - spriteH / 2, spriteW, spriteH);
      }

      // Damage smoke is created by simulation logic as an attached SMOKE_M
      // AnimClass slot. Rendering only displays the existing attachment.
      if (entity.damageSmokeStartTick >= 0) {
        const smokeSheet = assets.getSheet('smoke_m');
        if (smokeSheet) {
          // C++ adata.cpp:1045-1046 — SMOKE_M: 91 frames, loopStart=67, loops=6, delay=1.
          // Play frames 0..66 once, then loop 67..90. After 6 loops the attached anim would end in
          // C++; here the unit keeps taking damage (smoke stays on) so we wrap the loop segment.
          const age = tick - entity.damageSmokeStartTick;
          const loopStart = 67;
          const frameCount = smokeSheet.meta.frameCount; // 91
          const loopLen = frameCount - loopStart;        // 24
          const frame = age < loopStart ? age : loopStart + ((age - loopStart) % loopLen);
          assets.drawFrame(ctx, 'smoke_m', frame, screen.x, screen.y - 8, { centerX: true, centerY: true });
        }
      }

      ctx.globalAlpha = 1;

      // Aircraft ammo bar (small bar above health bar, only when selected)
      if (entity.alive && entity.isAirUnit && entity.maxAmmo > 0 && selectedIds.has(entity.id)) {
        const ammoRatio = entity.ammo / entity.maxAmmo;
        const ammoBarW = Math.max(spriteW, 18);
        const ammoBarH = 2;
        const ammoBarX = screen.x - ammoBarW / 2;
        const ammoBarY = screen.y - spriteH / 2 - 12;
        ctx.fillStyle = '#111';
        ctx.fillRect(ammoBarX - 1, ammoBarY - 1, ammoBarW + 2, ammoBarH + 2);
        // Color: blue→yellow→red based on ammo
        const ammoColor = ammoRatio > 0.5 ? '#4488ff' : ammoRatio > 0.25 ? '#cccc30' : '#cc3030';
        ctx.fillStyle = ammoColor;
        ctx.fillRect(ammoBarX, ammoBarY, ammoBarW * ammoRatio, ammoBarH);
      }

      // Harvester ore load bar (small gold bar above health bar, only when selected)
      if (entity.alive && entity.type === UnitType.V_HARV && selectedIds.has(entity.id) && entity.oreLoad > 0) {
        const oreRatio = entity.oreLoad / Entity.ORE_CAPACITY;
        const oreBarW = Math.max(spriteW, 18);
        const oreBarH = 2;
        const oreBarX = screen.x - oreBarW / 2;
        const oreBarY = screen.y - spriteH / 2 - 9;
        ctx.fillStyle = '#111';
        ctx.fillRect(oreBarX - 1, oreBarY - 1, oreBarW + 2, oreBarH + 2);
        ctx.fillStyle = '#c8a030'; // gold ore color
        ctx.fillRect(oreBarX, oreBarY, oreBarW * oreRatio, oreBarH);
      }

      // Health bar — C++ techno.cpp:1089-1188: the entire health-bar path is
      // inside if (IsSelected). Damaged unselected technos do not get bars.
      if (entity.alive && selectedIds.has(entity.id)) {
        this.renderHealthBar(
          screen.x,
          screen.y - spriteH / 2 - 5,
          Math.max(spriteW, 18),
          entity.hp / entity.maxHp,
          selectedIds.has(entity.id),
        );
      }

      // CTNK cooldown pips — C++ unit.cpp:3888 returns 0-5 pip count
      if (entity.alive && entity.type === UnitType.V_CTNK && selectedIds.has(entity.id)) {
        const fullCooldown = 2700; // Game.CHRONO_TANK_COOLDOWN
        const progress = entity.chronoCooldown > 0
          ? Math.floor((fullCooldown - entity.chronoCooldown) / (fullCooldown / 5))
          : 5; // fully charged
        const pipY = screen.y - spriteH / 2 - 9;
        const pipW = 3, pipH = 2, pipGap = 1;
        const totalW = 5 * pipW + 4 * pipGap;
        const pipStartX = screen.x - totalW / 2;
        for (let i = 0; i < 5; i++) {
          const px = pipStartX + i * (pipW + pipGap);
          ctx.fillStyle = i < progress ? '#4488ff' : '#222';
          ctx.fillRect(px, pipY, pipW, pipH);
        }
      }

      // Stance indicator for selected player units (small dot to right of selection circle)
      if (entity.alive && entity.isPlayerUnit && selectedIds.has(entity.id) &&
          entity.stance !== Stance.AGGRESSIVE) {
        const dotX = screen.x + spriteW * 0.45 + 3;
        const dotY = screen.y + spriteH * 0.3 + altY;
        ctx.fillStyle = entity.stance === Stance.HOLD_FIRE ? '#f44' : '#ff0'; // red=hold, yellow=defensive
        ctx.beginPath();
        ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ─── Health Bars ─────────────────────────────

  private renderHealthBar(
    x: number, y: number, width: number,
    ratio: number, isSelected: boolean,
  ): void {
    const ctx = this.ctx;
    const barW = width;
    const barH = isSelected ? 4 : 3;
    const bx = x - barW / 2;

    // Black border
    ctx.fillStyle = '#000';
    ctx.fillRect(bx - 1, y - 1, barW + 2, barH + 2);

    // Dark background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(bx, y, barW, barH);

    // Health fill with pip segments — palette-accurate green/yellow/red
    // C++ techno.cpp:1089-1188 thresholds: green>50%, yellow>25%, red<=25%
    const color = ratio > 0.50 ? this.palColor(PAL_GREEN_HP) :
                  ratio > 0.25 ? this.palColor(156) :  // palette yellow [255,255,158]
                                  this.palColor(PAL_RED_HP);
    const fillW = barW * ratio;
    ctx.fillStyle = color;
    ctx.fillRect(bx, y, fillW, barH);

    // Pip dividers
    const pips = Math.min(8, Math.ceil(barW / 4));
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = 1; i < pips; i++) {
      const px = bx + (barW / pips) * i;
      ctx.fillRect(px, y, 1, barH);
    }
  }

  // ─── Waypoint Markers ────────────────────────────────────

  private renderWaypoints(camera: Camera, entities: Entity[], selectedIds: Set<number>): void {
    const ctx = this.ctx;
    for (const entity of entities) {
      if (!entity.alive || !selectedIds.has(entity.id)) continue;
      if (entity.moveQueue.length === 0) continue;

      ctx.strokeStyle = 'rgba(100,255,100,0.5)';
      ctx.fillStyle = 'rgba(100,255,100,0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      // Draw line from current moveTarget (or position) through queue
      const start = entity.moveTarget
        ? { x: leptonToPixel(entity.moveTarget.lx), y: leptonToPixel(entity.moveTarget.ly) }
        : entity.pos;
      let prev = camera.worldToScreen(start.x, start.y);
      for (const wp of entity.moveQueue) {
        const screen = camera.worldToScreen(leptonToPixel(wp.lx), leptonToPixel(wp.ly));
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(screen.x, screen.y);
        ctx.stroke();
        // Waypoint dot
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
        ctx.fill();
        prev = screen;
      }
      ctx.setLineDash([]);
    }
  }

  // ─── Target Lines ───────────────────────────────────────

  private renderTargetLines(camera: Camera, entities: Entity[], selectedIds: Set<number>): void {
    const ctx = this.ctx;
    for (const entity of entities) {
      if (!entity.alive || !selectedIds.has(entity.id)) continue;
      if (entity.isAirUnit) continue; // C++ RA doesn't show target lines for aircraft
      if (!entity.target?.alive) continue;
      // Draw thin dashed line from attacker to target
      const from = camera.worldToScreen(entity.pos.x, entity.pos.y);
      const to = camera.worldToScreen(entity.target.pos.x, entity.target.pos.y);
      ctx.strokeStyle = 'rgba(255,80,80,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Small red diamond on target
      ctx.fillStyle = 'rgba(255,80,80,0.5)';
      ctx.beginPath();
      ctx.moveTo(to.x, to.y - 4);
      ctx.lineTo(to.x + 4, to.y);
      ctx.lineTo(to.x, to.y + 4);
      ctx.lineTo(to.x - 4, to.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ─── Effects ─────────────────────────────────────────────

  private renderLogicAnim(camera: Camera, assets: AssetManager, anim: LogicAnim): void {
    const spec = logicAnimRenderSpec(anim.type);
    const sheet = assets.getSheet(spec.sprite);
    if (!sheet) return;
    const screen = camera.worldToScreen(anim.x, anim.y);
    const margin = Math.max(sheet.meta.frameWidth, sheet.meta.frameHeight);
    if (screen.x < -margin || screen.y < -margin || screen.x > this.width + margin || screen.y > this.height + margin) {
      return;
    }
    const frame = Math.max(0, Math.min(anim.stage, sheet.meta.frameCount - 1));
    assets.drawFrame(this.ctx, spec.sprite, frame, screen.x, screen.y, {
      centerX: true,
      centerY: true,
    });
  }

  private renderLogicAnims(camera: Camera, assets: AssetManager, layer: 'ground' | 'air'): void {
    const anims = this.logicAnims.filter(anim => {
      if (anim.delay > 0) return false;
      const spec = logicAnimRenderSpec(anim.type);
      return spec.groundLayer === (layer === 'ground');
    });

    const sorted = layer === 'ground'
      ? [...anims].sort((a, b) => {
          const ak = cppGroundAnimSortKey(a);
          const bk = cppGroundAnimSortKey(b);
          const dy = ak.y - bk.y;
          if (dy !== 0) return dy;
          const dx = ak.x - bk.x;
          if (dx !== 0) return dx;
          return (a.logicIndexHint ?? 0) - (b.logicIndexHint ?? 0);
        })
      : anims;

    for (const anim of sorted) {
      this.renderLogicAnim(camera, assets, anim);
    }
  }

  private renderEffects(camera: Camera, effects: Effect[], assets: AssetManager): void {
    const ctx = this.ctx;

    for (const fx of effects) {
      // C++ AnimClass objects are rendered from logicAnims so their visible frame
      // is the live StageClass stage. The linked Effect copy is only a legacy
      // allocation/render bookkeeping artifact and can drift or expire early.
      if (fx.cppLogicSlot === true || fx.logicIndexHint !== undefined) continue;

      // Skip effects with negative frame (staggered delay — not yet visible)
      if (fx.frame < 0) continue;
      const screen = camera.worldToScreen(fx.x, fx.y);
      const progress = fx.frame / fx.maxFrames;

      // Sprite-based rendering: if the effect has a sprite sheet, use it
      if (fx.sprite) {
        const sheet = assets.getSheet(fx.sprite);
        if (sheet) {
          const frameIdx = (fx.spriteStart ?? 0) + Math.min(fx.frame, sheet.meta.frameCount - 1);
          const alpha = fx.type === 'tesla' ? 1 - progress * 0.5 : 1;
          if (alpha < 1) ctx.globalAlpha = alpha;
          if (fx.blendMode) ctx.globalCompositeOperation = fx.blendMode;
          assets.drawFrame(ctx, fx.sprite, frameIdx % sheet.meta.frameCount, screen.x, screen.y, {
            centerX: true,
            centerY: true,
          });
          if (fx.blendMode) ctx.globalCompositeOperation = 'source-over';
          if (alpha < 1) ctx.globalAlpha = 1;
          continue;
        }
        // Fall through to procedural if sprite not loaded
      }

      // Projectile rendering (Cluster C: sprite-based + procedural fallback)
      if (fx.type === 'projectile' && fx.startX != null && fx.startY != null &&
          fx.endX != null && fx.endY != null) {
        const t = fx.frame / fx.maxFrames;
        const px = fx.startX + (fx.endX - fx.startX) * t;
        const py = fx.startY + (fx.endY - fx.startY) * t;
        // Distance-derived arc (C6): C++ computes Riser ~= distance/(speed+1)*gravity.
        // We approximate with sin(t*PI) * (distance/K) so short shots arc low, long shots arc high.
        // Grenades arc higher than shells/rockets (C++ Lobbed.Arcing=yes uses taller arc).
        const dx = fx.endX - fx.startX;
        const dy = fx.endY - fx.startY;
        const travelDist = Math.sqrt(dx * dx + dy * dy);
        let arcPx = 0;
        if (fx.projArcPx != null) {
          arcPx = fx.projArcPx;
        } else if (fx.projStyle === 'grenade') {
          arcPx = Math.min(80, travelDist / 2);          // tall parabola
        } else if (fx.projStyle === 'shell' || fx.projStyle === 'rocket') {
          arcPx = Math.min(50, travelDist / 3);
        }
        const arcY = -Math.sin(t * Math.PI) * arcPx;
        const screenP = camera.worldToScreen(px, py + arcY);

        // Ground shadow (C5): for airborne projectiles with shadow flag or arcing trajectory.
        // C++ bullet.cpp:570-578 offsets shadow by lepton_to_pixel(height).
        if ((fx.projShadow || arcPx > 0) && fx.projImage) {
          const gs = camera.worldToScreen(px, py);
          const prevAlpha = ctx.globalAlpha;
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.ellipse(gs.x, gs.y + 1, 3, 1.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = prevAlpha;
        }

        // Flame trail (C3): spawn smoke puffs along the actual flight path including arc.
        if (fx.projFlameTrail) {
          for (let si = 1; si <= 4; si++) {
            const trailT = Math.max(0, t - si * 0.06);
            if (trailT <= 0) break;
            const stx = fx.startX + dx * trailT;
            const sty = fx.startY + dy * trailT - Math.sin(trailT * Math.PI) * arcPx;
            const sScreen = camera.worldToScreen(stx, sty);
            const sAlpha = 0.4 - si * 0.08;
            const sSize = 1 + si * 0.5;
            ctx.fillStyle = `rgba(180,180,180,${sAlpha})`;
            ctx.beginPath();
            ctx.arc(sScreen.x, sScreen.y, sSize, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // C++ bullet.cpp:573,796 — Parachuted projectile: draw parabomb.png sprite during descent.
        // PARABOMB.SHP has 13 frames (parachute opening/closing animation).
        if (fx.isParachuted) {
          const pbSheet = assets.getSheet('parabomb');
          if (pbSheet) {
            const pbFrameCount = pbSheet.meta.frameCount; // 13
            const pbFrame = Math.min(fx.frame, pbFrameCount - 1);
            assets.drawFrame(ctx, 'parabomb', pbFrame, screenP.x, screenP.y, {
              centerX: true, centerY: true,
            });
            continue;
          }
          // Fall through to procedural if parabomb sprite not loaded
        }

        // Sprite-based projectile rendering (C1/C2/C7): use SHP image when available.
        if (fx.projImage) {
          const sheet = assets.getSheet(fx.projImage);
          if (sheet) {
            // Compute frame index
            let frameIdx = 0;
            const total = sheet.meta.frameCount;
            if (fx.projRotates && total >= 32) {
              // C++ Rotates=yes: 32-direction facing from velocity vector.
              // BODY_SHAPE[32] maps facing index → SHP frame slot (mirror of INFANTRY_SHAPE).
              // Convert atan2 angle to 0-31 (N=0, clockwise).
              const angle = Math.atan2(-dy, dx); // screen up = -dy
              // atan2 returns angle from +x axis, CCW. Rotate so N(up)=0, going CW.
              // angle for +x (E)=0, for -y (N)=PI/2. facing=(PI/2 - angle) / (2*PI) * 32
              let facing = Math.round(((Math.PI / 2 - angle) / (2 * Math.PI)) * 32);
              facing = ((facing % 32) + 32) % 32;
              // BULLET_SHAPE mirrors BODY_SHAPE — projectile SHPs store 32 rotation frames
              // in the same order as vehicle body sprites (N=0, CCW through frame layout).
              frameIdx = BODY_SHAPE[facing] ?? 0;
            } else if (fx.projTumble && fx.projTumbleFrames && fx.projTumbleFrames > 1) {
              // C++ Frames>0 without Rotates: tumble animation (BOMB=8, BOMBLET=6).
              frameIdx = fx.frame % fx.projTumbleFrames;
            } else {
              frameIdx = 0;
            }
            frameIdx = frameIdx % total;

            // C++ Translucent=yes: SHAPE_GHOST approximation.
            const prevAlpha = ctx.globalAlpha;
            if (fx.projTranslucent) ctx.globalAlpha = prevAlpha * 0.55;
            assets.drawFrame(ctx, fx.projImage, frameIdx, screenP.x, screenP.y, {
              centerX: true, centerY: true,
            });
            if (fx.projTranslucent) ctx.globalAlpha = prevAlpha;
            continue;
          }
          // Sheet not loaded — fall through to procedural style
        }

        // Procedural fallback for projectiles without a loaded sprite.
        switch (fx.projStyle) {
          case 'bullet': {
            ctx.fillStyle = '#ff0';
            ctx.fillRect(screenP.x - 1, screenP.y - 1, 2, 2);
            break;
          }
          case 'fireball': {
            ctx.fillStyle = `rgba(255,${100 + Math.floor(t * 100)},30,${1 - t * 0.3})`;
            ctx.beginPath();
            ctx.arc(screenP.x, screenP.y, 3 + t * 2, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          case 'shell': {
            ctx.fillStyle = '#ccc';
            ctx.fillRect(screenP.x - 1, screenP.y - 1, 3, 3);
            if (!fx.projFlameTrail) {
              const groundScreen = camera.worldToScreen(px, py);
              ctx.fillStyle = 'rgba(0,0,0,0.3)';
              ctx.fillRect(groundScreen.x - 1, groundScreen.y, 2, 1);
            }
            break;
          }
          case 'rocket': {
            ctx.fillStyle = '#fa0';
            ctx.fillRect(screenP.x - 1, screenP.y - 1, 3, 3);
            if (!fx.projFlameTrail) {
              // Multi-puff smoke trail (already drawn above if projFlameTrail set)
              for (let si = 1; si <= 4; si++) {
                const trailT = Math.max(0, t - si * 0.06);
                if (trailT <= 0) break;
                const stx = fx.startX + dx * trailT;
                const sty = fx.startY + dy * trailT - Math.sin(trailT * Math.PI) * arcPx;
                const sScreen = camera.worldToScreen(stx, sty);
                const sAlpha = 0.4 - si * 0.08;
                const sSize = 1 + si * 0.5;
                ctx.fillStyle = `rgba(180,180,180,${sAlpha})`;
                ctx.beginPath();
                ctx.arc(sScreen.x, sScreen.y, sSize, 0, Math.PI * 2);
                ctx.fill();
              }
            }
            break;
          }
          case 'grenade': {
            ctx.fillStyle = '#555';
            const gSize = 2 + Math.sin(t * Math.PI * 4) * 0.5;
            ctx.beginPath();
            ctx.arc(screenP.x, screenP.y, gSize, 0, Math.PI * 2);
            ctx.fill();
            const gGround = camera.worldToScreen(px, py);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(gGround.x - 1, gGround.y, 3, 1);
            break;
          }
        }
        continue;
      }

      // Command marker (move/attack feedback)
      if (fx.type === 'marker' && fx.markerColor) {
        const alpha = 1 - progress;
        const r = fx.size * (1 - progress * 0.5);
        ctx.strokeStyle = fx.markerColor.replace('1)', `${alpha})`);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
        ctx.stroke();
        // Inner shrinking ring
        if (progress < 0.5) {
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, r * 0.4, 0, Math.PI * 2);
          ctx.stroke();
        }
        continue;
      }

      // Procedural fallback for effects without sprite sheets
      switch (fx.type) {
        case 'explosion': {
          const radius = fx.size * (0.3 + progress * 0.7);
          const alpha = 1 - progress;
          const gradient = ctx.createRadialGradient(
            screen.x, screen.y, 0,
            screen.x, screen.y, radius,
          );
          gradient.addColorStop(0, `rgba(255,200,50,${alpha * 0.8})`);
          gradient.addColorStop(0.4, `rgba(255,100,20,${alpha * 0.6})`);
          gradient.addColorStop(1, `rgba(200,30,0,0)`);
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
          ctx.fill();
          if (progress < 0.3) {
            ctx.fillStyle = `rgba(255,255,200,${(0.3 - progress) * 2})`;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, radius * 0.4, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case 'muzzle': {
          const alpha = 1 - progress;
          const r = fx.size * (1 - progress * 0.5);
          const mc = fx.muzzleColor ?? '255,255,150';
          ctx.fillStyle = `rgba(${mc},${alpha})`;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
          ctx.fill();
          // Bright core
          ctx.fillStyle = `rgba(255,255,255,${alpha * 0.6})`;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, r * 0.4, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'blood': {
          const alpha = 1 - progress;
          const seed = (fx.x * 7 + fx.y * 13) | 0;
          for (let i = 0; i < 5; i++) {
            const angle = ((seed + i * 73) % 360) * Math.PI / 180;
            const dist = progress * fx.size * (1 + (i % 3));
            const px = screen.x + Math.cos(angle) * dist;
            const py = screen.y + Math.sin(angle) * dist;
            ctx.fillStyle = `rgba(180,20,20,${alpha * 0.7})`;
            ctx.fillRect(px - 1, py - 1, 2, 2);
          }
          break;
        }
        case 'tesla': {
          const alpha = 1 - progress * 0.6;
          const hasTravel = fx.startX !== undefined && fx.startY !== undefined;
          const sStart = hasTravel
            ? camera.worldToScreen(fx.startX!, fx.startY!)
            : { x: screen.x - fx.size, y: screen.y };
          const sEnd = screen;

          // C++ LITNING.SHP — 8 frames of tesla bolt sprite, drawn at the impact point.
          // Use sprite-based rendering when litning.png is available; fall back to procedural.
          const litSheet = assets.getSheet('litning');
          if (litSheet) {
            const litFrameCount = litSheet.meta.frameCount; // 8
            const litFrame = fx.frame % litFrameCount;
            // Draw the lightning sprite at target with additive blend (C++ SHAPE_GHOST)
            ctx.globalAlpha = alpha;
            ctx.globalCompositeOperation = 'lighter';
            assets.drawFrame(ctx, 'litning', litFrame, sEnd.x, sEnd.y, {
              centerX: true, centerY: true,
            });
            // If beam has travel distance, draw additional sprites along the path
            if (hasTravel) {
              const dx = sEnd.x - sStart.x;
              const dy = sEnd.y - sStart.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              // Space sprites every ~20px along the bolt path
              const spacing = 20;
              const steps = Math.max(1, Math.floor(len / spacing));
              for (let i = 1; i < steps; i++) {
                const t = i / steps;
                const midX = sStart.x + dx * t;
                const midY = sStart.y + dy * t;
                // Offset frame per-segment for variation
                const segFrame = (litFrame + i * 3) % litFrameCount;
                assets.drawFrame(ctx, 'litning', segFrame, midX, midY, {
                  centerX: true, centerY: true,
                });
              }
            }
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
          } else {
            // Procedural fallback — jagged polyline lightning bolt
            const seed = (fx.x * 11 + fx.y * 17 + fx.frame * 31) | 0;
            const dx = sEnd.x - sStart.x;
            const dy = sEnd.y - sStart.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const jitter = Math.max(Math.min(len * 0.15, 12), 2);
            const segments = 8;
            const pts: Array<{ x: number; y: number }> = [sStart];
            const nx = -dy / len, ny = dx / len;
            for (let i = 1; i < segments; i++) {
              const t = i / segments;
              const perp = ((seed + i * 47 + fx.frame * 13) % (Math.floor(jitter * 2) + 1)) - jitter;
              pts.push({ x: sStart.x + dx * t + nx * perp, y: sStart.y + dy * t + ny * perp });
            }
            pts.push(sEnd);
            const drawBolt = () => {
              ctx.beginPath();
              ctx.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
              ctx.stroke();
            };
            ctx.strokeStyle = `rgba(80,150,255,${alpha * 0.3})`;
            ctx.lineWidth = 6;
            drawBolt();
            ctx.strokeStyle = `rgba(130,210,255,${alpha})`;
            ctx.lineWidth = 2;
            drawBolt();
            if (progress < 0.3) {
              ctx.strokeStyle = `rgba(220,240,255,${(0.3 - progress) * 2})`;
              ctx.lineWidth = 1;
              drawBolt();
            }
            ctx.lineWidth = 1;
            for (let b = 0; b < 2; b++) {
              const bi = 1 + ((seed + b * 3 + fx.frame) % (segments - 1));
              const bp = pts[bi];
              const bAngle = ((seed + b * 43 + fx.frame * 17) % 360) * Math.PI / 180;
              const bLen = jitter * 1.5 + 4;
              ctx.strokeStyle = `rgba(100,180,255,${alpha * 0.5})`;
              ctx.beginPath();
              ctx.moveTo(bp.x, bp.y);
              ctx.lineTo(bp.x + Math.cos(bAngle) * bLen, bp.y + Math.sin(bAngle) * bLen);
              ctx.stroke();
            }
          }
          // Impact spark at target (used by both sprite and procedural paths)
          ctx.fillStyle = `rgba(200,230,255,${alpha * (1 - progress * 0.5)})`;
          ctx.beginPath();
          ctx.arc(sEnd.x, sEnd.y, 3 + (1 - progress) * 3, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'text': {
          // Floating text (credits gained, etc.) — rises and fades
          const alpha = 1 - progress;
          const riseY = progress * 20; // float upward 20px
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = `rgba(0,0,0,${alpha * 0.6})`;
          ctx.fillText(fx.text ?? '', screen.x + 1, screen.y - riseY + 1);
          ctx.fillStyle = (fx.textColor ?? 'rgba(80,255,80,1)').replace(/[\d.]+\)$/, `${alpha})`);
          ctx.fillText(fx.text ?? '', screen.x, screen.y - riseY);
          ctx.textAlign = 'left';
          break;
        }
      }
    }
    // Defensive alpha reset after effects pass
    ctx.globalAlpha = 1;
  }

  // ─── Fog of War ──────────────────────────────────────────

  private getShadowSourcePixels(sheet: SpriteSheet): {
    source: CanvasImageSource;
    width: number;
    height: number;
    data: Uint8ClampedArray;
  } | null {
    if (this.shadowSourcePixels?.source === sheet.image) return this.shadowSourcePixels;
    if (typeof document === 'undefined') return null;

    const sized = sheet.image as HTMLImageElement & {
      naturalWidth?: number;
      naturalHeight?: number;
      width?: number;
      height?: number;
    };
    const width = sheet.meta.sheetWidth || sized.naturalWidth || Number(sized.width) || 0;
    const height = sheet.meta.sheetHeight || sized.naturalHeight || Number(sized.height) || 0;
    if (width <= 0 || height <= 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const sctx = canvas.getContext('2d');
    if (!sctx) return null;
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(sheet.image, 0, 0);
    const imageData = sctx.getImageData(0, 0, width, height);
    this.shadowSourcePixels = { source: sheet.image, width, height, data: imageData.data };
    return this.shadowSourcePixels;
  }

  private getShadowTransTable(frac: number): Uint8Array | null {
    if (!this.pal) return null;
    if (!this.shadowTransTableCache || this.shadowTransTableCache.palette !== this.pal) {
      this.shadowTransTableCache = { palette: this.pal, tables: new Map() };
    }
    const cached = this.shadowTransTableCache.tables.get(frac);
    if (cached) return cached;
    const table = makeFadingTable(this.pal, RA_COLOR_BLACK, frac);
    this.shadowTransTableCache.tables.set(frac, table);
    return table;
  }

  /** Draw one SHADOW.SHP frame as C++ SHAPE_GHOST with DisplayClass::ShadowTrans. */
  private drawShadowGhostFrame(sheet: SpriteSheet, frameIndex: number, dx: number, dy: number): boolean {
    const ctx = this.ctx;
    if (!this.pal || !ctx.getImageData || !ctx.putImageData || !ctx.canvas) return false;
    const src = this.getShadowSourcePixels(sheet);
    if (!src) return false;

    const meta = sheet.meta;
    const fw = meta.frameWidth || CELL_SIZE;
    const fh = meta.frameHeight || CELL_SIZE;
    const destX = Math.round(dx);
    const destY = Math.round(dy);
    const clipX0 = Math.max(0, destX);
    const clipY0 = Math.max(0, destY);
    const clipX1 = Math.min(ctx.canvas.width, destX + CELL_SIZE);
    const clipY1 = Math.min(ctx.canvas.height, destY + CELL_SIZE);
    const clipW = clipX1 - clipX0;
    const clipH = clipY1 - clipY0;
    if (clipW <= 0 || clipH <= 0) return true;

    const col = frameIndex % meta.columns;
    const row = Math.floor(frameIndex / meta.columns);
    const sx = col * fw;
    const sy = row * fh;
    const dest = ctx.getImageData(clipX0, clipY0, clipW, clipH);

    for (let y = 0; y < clipH; y++) {
      const frameY = clipY0 - destY + y;
      for (let x = 0; x < clipW; x++) {
        const frameX = clipX0 - destX + x;
        const srcOff = ((sy + frameY) * src.width + (sx + frameX)) * 4;
        const sr = src.data[srcOff];
        const sg = src.data[srcOff + 1];
        const sb = src.data[srcOff + 2];
        const sa = src.data[srcOff + 3];
        if (sa === 0) continue;

        const destOff = (y * clipW + x) * 4;
        const frac = shadowTransFadeForRGBA(sr, sg, sb, sa);
        if (frac !== null) {
          const table = this.getShadowTransTable(frac);
          if (!table) continue;
          const destIndex = nearestPaletteIndex(
            this.pal,
            dest.data[destOff],
            dest.data[destOff + 1],
            dest.data[destOff + 2],
          );
          const remapped = this.pal[table[destIndex]];
          if (!remapped) continue;
          dest.data[destOff] = remapped[0];
          dest.data[destOff + 1] = remapped[1];
          dest.data[destOff + 2] = remapped[2];
          dest.data[destOff + 3] = 255;
        } else {
          dest.data[destOff] = sr;
          dest.data[destOff + 1] = sg;
          dest.data[destOff + 2] = sb;
          dest.data[destOff + 3] = 255;
        }
      }
    }

    ctx.putImageData(dest, clipX0, clipY0);
    return true;
  }

  /** Sprite-based fog of war — faithful port of C++ DisplayClass::Redraw_Shadow.
   *  Uses SHADOW.SHP frames + 256-entry lookup table for shroud edge shapes. */
  private renderFogOfWar(camera: Camera, map: GameMap, assets: AssetManager): void {
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    const startCX = Math.floor(camera.x / CELL_SIZE);
    const startCY = Math.floor(camera.y / CELL_SIZE);
    const endCX = Math.ceil((camera.x + camera.viewWidth) / CELL_SIZE);
    const endCY = Math.ceil((camera.y + camera.viewHeight) / CELL_SIZE);

    const sheet = assets.getSheet('shadow');
    const getVis = (x: number, y: number) => this.renderVisibility(map, x, y);
    const fw = sheet?.meta.frameWidth ?? CELL_SIZE;
    const fh = sheet?.meta.frameHeight ?? CELL_SIZE;
    ctx.fillStyle = '#000';

    for (let cy = startCY; cy <= endCY; cy++) {
      for (let cx = startCX; cx <= endCX; cx++) {
        const vis = this.renderVisibility(map, cx, cy);
        if (vis === 2) continue; // IsVisible — no shadow

        const screen = camera.worldToScreen(cx * CELL_SIZE, cy * CELL_SIZE);
        const sx = Math.round(screen.x);
        const sy = Math.round(screen.y);

        if (vis === 0) {
          // Unmapped cell: solid black (C++ !IsMapped → Fill_Rect BLACK)
          ctx.fillRect(sx, sy, CELL_SIZE, CELL_SIZE);
        } else {
          // vis === 1: IsMapped && !IsVisible — compute shadow frame from neighbor bitmask
          const idx = cellShadowIndex(cx, cy, getVis);
          const shadow = SHADOW_TABLE[idx];

          if (shadow >= 0 && sheet) {
            const col = shadow % sheet.meta.columns;
            const row = Math.floor(shadow / sheet.meta.columns);
            if (!this.drawShadowGhostFrame(sheet, shadow, sx, sy)) {
              ctx.drawImage(sheet.image, col * fw, row * fh, fw, fh, sx, sy, CELL_SIZE, CELL_SIZE);
            }
          } else if (shadow === -2) {
            // Solid black (surrounded by unmapped cells)
            ctx.fillRect(sx, sy, CELL_SIZE, CELL_SIZE);
          }
          // shadow === -1: no shadow needed (fully surrounded by mapped cells)
        }
      }
    }
  }

  // ─── Selection Box ───────────────────────────────────────

  private renderSelectionBox(input: InputState): void {
    if (!input.isDragging) return;
    const ctx = this.ctx;
    const x1 = Math.min(input.dragStartX, input.mouseX);
    const y1 = Math.min(input.dragStartY, input.mouseY);
    const x2 = Math.max(input.dragStartX, input.mouseX);
    const y2 = Math.max(input.dragStartY, input.mouseY);

    // Semi-transparent fill — palette green
    ctx.fillStyle = this.palColor(PAL_GREEN_HP);
    ctx.globalAlpha = 0.08;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.globalAlpha = 1;

    // Green border — palette green
    ctx.strokeStyle = this.palColor(PAL_GREEN_HP);
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }

  // ─── Minimap ─────────────────────────────────────────────

  private renderMinimap(map: GameMap, entities: Entity[], structures: MapStructure[], camera: Camera, assets?: AssetManager): void {
    const ctx = this.ctx;
    const cover = this.getMinimapBounds();
    const radar = this.getActiveRadarLayout(map, camera);
    const { x: mmX, y: mmY, w: mmW, h: mmH, cellPx, ox, oy, cellsW, cellsH } = radar;
    const tilesetSource = this.tilesetReady && this.tilesetTheatre === this.theatre
      ? this.getPaletteCycledTilesetImage(0)
      : null;

    // C++ radar.cpp Draw_It: radar panel uses natoradr.shp/ussrradr.shp for the cover plate
    // and the sidebar background (side1na/side1us) provides the metallic frame border.
    // IsRadarJammed is checked BEFORE IsRadarActive — jamming takes priority (radar.cpp:469).

    // Radar jammed: C++ RadarClass::Draw_It calls Radar_Anim(), so the
    // natoradr/ussrradr animation frame replaces the minimap.
    if (this.isRadarJammed) {
      this.drawRadarCoverPlate(ctx, cover.x, cover.y, cover.size, assets);
      return;
    }

    // No radar: show cover plate (C++ radar.cpp Draw_It lines 598-616)
    // C++: val = DoesRadarExist ? MAX_RADAR_FRAMES : 0
    //   - !DoesRadarExist (no DOME): frame 0 — ornate radar panel with faction emblem
    //   - DoesRadarExist but inactive (no power): frame 41 (MAX_RADAR_FRAMES) — dark cover plate
    if (!this.hasRadar) {
      this.drawRadarCoverPlate(ctx, cover.x, cover.y, cover.size, assets);
      return;
    }

    // Active radar: C++ radar.cpp:542 draws house-specific RadarFrame frame 1
    // (NRADRFRM/URADRFRM) before plotting terrain pixels on top.
    this.drawActiveRadarFrame(ctx, assets);

    // C++ only fills the full interior with BLACK when BaseX/BaseY are both zero.
    // Zoomed radar usually leaves the centered margins from RadarFrame intact.
    ctx.save();
    ctx.beginPath();
    ctx.rect(mmX, mmY, mmW, mmH);
    ctx.clip();

    ctx.fillStyle = '#000';
    ctx.fillRect(mmX, mmY, mmW, mmH);

    // C++ radar.cpp Plot_Radar_Pixel renders one radar pixel per mapped cell.
    // It does not stretch the scenario rectangle into a square and it keys off
    // IsMapped rather than current IsVisible, so explored fog remains drawn.
    for (let cy = oy; cy < oy + cellsH; cy++) {
      for (let cx = ox; cx < ox + cellsW; cx++) {
        const vis = this.renderVisibility(map, cx, cy);
        if (vis === 0) continue; // Don't show shrouded areas

        const terrain = map.getTerrain(cx, cy);
        const px = mmX + (cx - ox) * cellPx;
        const py = mmY + (cy - oy) * cellPx;
        const ps = cellPx;
        const idx = cy * 128 + cx;

        if (map.jammedCells?.has(idx)) {
          ctx.fillStyle = '#000';
          ctx.fillRect(px, py, ps, ps);
          continue;
        }

        const treeType = map.getTreeType(cx, cy);
        let drewRadarTile = false;
        if (cellPx > 1 && tilesetSource) {
          const tmpl = map.templateType[idx] || 0;
          const icon = map.templateIcon[idx] || 0;
          if (tmpl > 0 && tmpl !== 0xFFFF && tmpl !== 255) {
            drewRadarTile = this.drawRadarTileFromAtlas(ctx, tmpl, icon, px, py, tilesetSource, ps, ps);
          } else {
            const clearIcon = (cx & 3) | ((cy & 3) << 2);
            drewRadarTile = this.drawRadarTileFromAtlas(ctx, 255, clearIcon, px, py, tilesetSource, ps, ps);
          }
        }
        if (drewRadarTile) {
          this.drawRadarOverlayIcon(ctx, map, cx, cy, px, py, ps, assets);
          this.drawRadarTerrainObjectIcon(ctx, map, cx, cy, px, py, ps, assets);
          continue;
        }

        const palIndex = (terrain === Terrain.TREE || treeType)
          ? RADAR_TERRAIN_OBJECT_COLOR
          : RADAR_LAND_COLOR[terrain] ?? RADAR_LAND_COLOR[Terrain.CLEAR];
        ctx.fillStyle = this.palColor(palIndex);
        ctx.fillRect(px, py, ps, ps);
        this.drawRadarOverlayIcon(ctx, map, cx, cy, px, py, ps, assets);
        this.drawRadarTerrainObjectIcon(ctx, map, cx, cy, px, py, ps, assets);
      }
    }

    // C++ radar.cpp asks each mapped CellClass for Cell_Color(true), which
    // returns a building color only when Cell_Building() is present on that
    // cell. That follows bdata.cpp Occupy_List, not the full BSIZE rectangle.
    for (const s of structures) {
      if (!s.alive) continue;
      ctx.fillStyle = HOUSE_MINIMAP_COLOR[s.house] ?? '#FFFFFF';
      for (const cell of getStructureOccupyCells(s.type, s.cx, s.cy)) {
        if (cell.cx < ox || cell.cx >= ox + cellsW || cell.cy < oy || cell.cy >= oy + cellsH) continue;
        const vis = this.renderVisibility(map, cell.cx, cell.cy);
        if (vis === 0) continue;
        ctx.fillRect(
          mmX + (cell.cx - ox) * cellPx,
          mmY + (cell.cy - oy) * cellPx,
          cellPx,
          cellPx,
        );
      }
    }

    // Unit dots — faction-colored blips on minimap (C++ radar.cpp Render_Infantry)
    const blinkOn = Math.floor(Date.now() / 300) % 2 === 0; // blink cycle for selected
    for (const e of entities) {
      if (!e.alive || e.inLimbo) continue;
      const { cx: ecx, cy: ecy } = e.cell;
      const vis = this.renderVisibility(map, ecx, ecy);
      if (vis === 0) continue;
      // R14: Fog-gated minimap — hide non-player units in fog/shroud
      if (vis < 2 && !e.isPlayerUnit) continue;

      // Selected units blink white on minimap
      const isSelected = this._selectedIds.has(e.id);
      const color = this.radarEntityBlipColor(e, isSelected && !blinkOn);
      this.drawRadarEntityBlip(
        ctx,
        e,
        mmX + (ecx - ox) * cellPx,
        mmY + (ecy - oy) * cellPx,
        cellPx,
        color,
      );
    }

    this.renderRadarCursor(camera, radar);

    // Alert flashes (pulsing red dots for EVA alerts)
    const now = Date.now();
    for (let i = this.minimapAlerts.length - 1; i >= 0; i--) {
      const alert = this.minimapAlerts[i];
      const age = now - alert.tick;
      if (age > 3000) { this.minimapAlerts.splice(i, 1); continue; }
      const alpha = (Math.sin(age * 0.01) * 0.5 + 0.5) * (1 - age / 3000);
      ctx.fillStyle = `rgba(255,60,60,${alpha})`;
      const ax = mmX + (alert.cx - ox) * cellPx;
      const ay = mmY + (alert.cy - oy) * cellPx;
      ctx.beginPath();
      ctx.arc(ax, ay, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawActiveRadarFrame(ctx: CanvasRenderingContext2D, assets?: AssetManager): void {
    const sheetName = this.isPlayerAllied() ? 'nradrfrm' : 'uradrfrm';
    const sheet = assets?.getSheet(sheetName);
    if (!sheet) return;

    this.drawRadarSheetClipped(ctx, assets!, sheetName, 1);
  }

  private radarEntityBlipColor(e: Entity, selectedBlink: boolean): string {
    if (selectedBlink) return '#fff';
    if (e.isCivilian) return '#c0c0c0';
    const house = e.stats.isInfantry && e.type === UnitType.I_SPY ? this.playerHouse : e.house;
    return HOUSE_MINIMAP_COLOR[house] ?? '#FFFFFF';
  }

  private drawRadarEntityBlip(
    ctx: CanvasRenderingContext2D,
    e: Entity,
    x: number,
    y: number,
    size: number,
    color: string,
  ): void {
    ctx.fillStyle = color;
    if (!e.stats.isInfantry) {
      ctx.fillRect(x, y, size, size);
      return;
    }

    const subsize = Math.max(1, Math.trunc(size / 3));
    const divisor = Math.trunc(256 / (size + 1));
    const xLepton = e.leptonX & 0xff;
    const yLepton = e.leptonY & 0xff;
    let xoff = Math.trunc(xLepton / divisor) - Math.trunc(subsize / 2);
    let yoff = Math.trunc(yLepton / divisor) - Math.trunc(subsize / 2);
    xoff = Math.max(0, Math.min(xoff, size - subsize));
    yoff = Math.max(0, Math.min(yoff, size - subsize));
    ctx.fillRect(x + xoff, y + yoff, subsize, subsize);
  }

  private getActiveRadarLayout(map: Pick<GameMap, 'boundsX' | 'boundsY' | 'boundsW' | 'boundsH'>, camera: Pick<Camera, 'x' | 'y'> = { x: map.boundsX * CELL_SIZE, y: map.boundsY * CELL_SIZE }): {
    x: number; y: number; w: number; h: number; cellPx: number;
    ox: number; oy: number; cellsW: number; cellsH: number;
  } {
    // C++ WIN32 RadarClass starts active radar in zoomed mode. Zoom_Mode()
    // fixes ZoomFactor=3, then Set_Radar_Position() uses the tactical
    // viewport's upper-left cell and confines it to MapCell bounds.
    const cellPx = 3;
    const cellsW = Math.min(map.boundsW, Math.floor(Renderer.RADAR_INNER_W / cellPx), 62 * RESFACTOR);
    const cellsH = Math.min(map.boundsH, Math.floor(Renderer.RADAR_INNER_H / cellPx), 62 * RESFACTOR);
    const baseX = Math.floor((Renderer.RADAR_INNER_W - cellsW * cellPx) / 2);
    const baseY = Math.floor((Renderer.RADAR_INNER_H - cellsH * cellPx) / 2);
    const maxOx = map.boundsX + Math.max(0, map.boundsW - cellsW);
    const maxOy = map.boundsY + Math.max(0, map.boundsH - cellsH);
    const cameraCellX = Math.floor(camera.x / CELL_SIZE);
    const cameraCellY = Math.floor(camera.y / CELL_SIZE);
    const ox = Math.max(map.boundsX, Math.min(maxOx, cameraCellX));
    const oy = Math.max(map.boundsY, Math.min(maxOy, cameraCellY));
    return {
      x: this.width - this.sidebarW + Renderer.RADAR_INNER_X_OFFSET + baseX,
      y: Renderer.RADAR_COVER_Y + Renderer.RADAR_INNER_Y_OFFSET + baseY,
      w: cellsW * cellPx,
      h: cellsH * cellPx,
      cellPx,
      ox,
      oy,
      cellsW,
      cellsH,
    };
  }

  private renderRadarCursor(
    camera: Camera,
    radar: { x: number; y: number; w: number; h: number; cellPx: number; ox: number; oy: number },
  ): void {
    const ctx = this.ctx;
    const x1 = radar.x + (Math.floor(camera.x / CELL_SIZE) - radar.ox) * radar.cellPx;
    const y1 = radar.y + (Math.floor(camera.y / CELL_SIZE) - radar.oy) * radar.cellPx;
    const x2 = x1 + Math.floor(camera.viewWidth / CELL_SIZE) * radar.cellPx - 1;
    const y2 = y1 + Math.floor(camera.viewHeight / CELL_SIZE) * radar.cellPx - 1;
    const minX = radar.x;
    const minY = radar.y;
    const maxX = radar.x + radar.w - 1;
    const maxY = radar.y + radar.h - 1;
    const lx1 = Math.round(Math.max(minX, Math.min(maxX, x1)));
    const ly1 = Math.round(Math.max(minY, Math.min(maxY, y1)));
    const lx2 = Math.round(Math.max(minX, Math.min(maxX, x2)));
    const ly2 = Math.round(Math.max(minY, Math.min(maxY, y2)));
    const barLen = 6;

    const horizontal = (xStart: number, xEnd: number, y: number) => {
      ctx.fillRect(xStart, y, Math.max(1, xEnd - xStart + 1), 1);
    };
    const vertical = (x: number, yStart: number, yEnd: number) => {
      ctx.fillRect(x, yStart, 1, Math.max(1, yEnd - yStart + 1));
    };

    ctx.fillStyle = RADAR_CURSOR_LTGREEN;
    horizontal(lx1, Math.min(lx1 + barLen, lx2), ly1);
    vertical(lx1, ly1, Math.min(ly1 + barLen, ly2));
    horizontal(Math.max(lx2 - barLen, lx1), lx2, ly1);
    vertical(lx2, ly1, Math.min(ly1 + barLen, ly2));
    vertical(lx1, Math.max(ly2 - barLen, ly1), ly2);
    horizontal(lx1, Math.min(lx1 + barLen, lx2), ly2);
    vertical(lx2, Math.max(ly2 - barLen, ly1), ly2);
    horizontal(Math.max(lx2 - barLen, lx1), lx2, ly2);
  }

  /**
   * Draw radar cover plate (C++ radar.cpp Draw_It lines 598-616).
   * Uses natoradr.shp (Allied) or ussrradr.shp (Soviet) sprite frames:
   *   - Frame 0: ornate radar panel with faction emblem (no DOME built)
   *   - Frame 41 (MAX_RADAR_FRAMES): dark cover plate (DOME exists, no power)
   * C++ logic: val = DoesRadarExist ? MAX_RADAR_FRAMES : 0
   * HIRES.MIX frames are already in 640x400 pixel coordinates; draw unscaled.
   */
  private drawRadarCoverPlate(ctx: CanvasRenderingContext2D, _x: number, _y: number, _size: number, assets?: AssetManager): void {
    const isAllied = this.isPlayerAllied();
    const sheetName = isAllied ? 'natoradr' : 'ussrradr';
    const x = this.width - this.sidebarW;
    const y = Renderer.RADAR_COVER_DRAW_Y;

    const sheet = assets?.getSheet(sheetName);
    if (sheet) {
      // C++ radar.h: RADAR_ACTIVATED_FRAME=22, MAX_RADAR_FRAMES=41
      // DoesRadarExist -> frame 41 (closed cover plate), !DoesRadarExist -> frame 0 (ornate panel)
      const frame = this.radarCoverFrame ?? (this.doesRadarExist ? 41 : 0);
      this.drawRadarSheetClipped(ctx, assets!, sheetName, frame);
      return;
    }

    // Procedural fallback (only if natoradr/ussrradr sprite assets are missing)
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, Renderer.RADAR_COVER_W, Renderer.RADAR_COVER_H);
  }

  private drawRadarSheetClipped(
    ctx: CanvasRenderingContext2D,
    assets: AssetManager,
    sheetName: string,
    frame: number,
  ): void {
    const x = this.width - this.sidebarW;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, Renderer.RADAR_COVER_Y, Renderer.RADAR_COVER_W, Renderer.RADAR_COVER_H);
    ctx.clip();
    assets.drawFrame(ctx, sheetName, frame, x, Renderer.RADAR_COVER_DRAW_Y);
    ctx.restore();
    ctx.imageSmoothingEnabled = prevSmoothing;
  }

  // ─── Fullscreen Radar (U6) ──────────────────────────────

  /** U6: Render enlarged radar overlay centered on screen (300x300) */
  private renderFullscreenRadar(map: GameMap, entities: Entity[], structures: MapStructure[], camera: Camera): void {
    const ctx = this.ctx;
    const radarSize = 150 * RESFACTOR;
    const viewW = this.width - this.sidebarW;
    const centerX = viewW / 2 - radarSize / 2;
    const centerY = this.height / 2 - radarSize / 2;
    const scale = radarSize / Math.max(map.boundsW, map.boundsH);
    const ox = map.boundsX;
    const oy = map.boundsY;

    // Semi-transparent background panel
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(centerX - 4, centerY - 4, radarSize + 8, radarSize + 8);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.strokeRect(centerX - 4, centerY - 4, radarSize + 8, radarSize + 8);

    // Terrain
    for (let cy = map.boundsY; cy < map.boundsY + map.boundsH; cy += 1) {
      for (let cx = map.boundsX; cx < map.boundsX + map.boundsW; cx += 1) {
        const vis = this.renderVisibility(map, cx, cy);
        if (vis === 0) continue;
        const terrain = map.getTerrain(cx, cy);
        const px = centerX + (cx - ox) * scale;
        const py = centerY + (cy - oy) * scale;
        const ps = Math.max(scale, 1);

        const treeType = map.getTreeType(cx, cy);
        if (terrain === Terrain.WATER) {
          ctx.fillStyle = vis === 2 ? '#1040a0' : '#081830';
        } else if (terrain === Terrain.TREE || treeType) {
          ctx.fillStyle = vis === 2 ? '#1a6020' : '#0d3010';
        } else if (terrain === Terrain.ROCK || terrain === Terrain.WALL) {
          ctx.fillStyle = vis === 2 ? '#707060' : '#383830';
        } else {
          ctx.fillStyle = vis === 2 ? '#486830' : '#243418';
        }
        ctx.fillRect(px, py, ps, ps);

        // Fog overlay
        if (vis < 2) {
          ctx.fillStyle = vis === 0 ? 'rgba(0,0,0,0.9)' : 'rgba(0,0,0,0.4)';
          ctx.fillRect(px, py, ps, ps);
        }
      }
    }

    // Structures
    for (const s of structures) {
      if (!s.alive) continue;
      const isPlayer = this.playerHouses.has(s.house as House);
      ctx.fillStyle = isPlayer ? 'rgba(80,220,255,0.85)' : 'rgba(220,50,50,0.85)';
      for (const cell of getStructureOccupyCells(s.type, s.cx, s.cy)) {
        const vis = this.renderVisibility(map, cell.cx, cell.cy);
        if (vis === 0) continue;
        ctx.fillRect(
          centerX + (cell.cx - ox) * scale,
          centerY + (cell.cy - oy) * scale,
          Math.max(scale, 3),
          Math.max(scale, 3),
        );
      }
    }

    // Units
    const blinkOn = Math.floor(Date.now() / 300) % 2 === 0;
    for (const e of entities) {
      if (!e.alive) continue;
      const { cx: ecx, cy: ecy } = e.cell;
      const vis = this.renderVisibility(map, ecx, ecy);
      if (vis === 0) continue;
      if (vis < 2 && !e.isPlayerUnit) continue;

      const isSelected = this._selectedIds.has(e.id);
      if (isSelected && !blinkOn) {
        ctx.fillStyle = '#fff';
      } else if (e.isCivilian) {
        ctx.fillStyle = '#c0c0c0';
      } else {
        ctx.fillStyle = HOUSE_MINIMAP_COLOR[e.house] ?? '#FFFFFF';
      }
      const dotSize = Math.max(scale * 1.5, 3);
      ctx.fillRect(
        centerX + (ecx - ox) * scale,
        centerY + (ecy - oy) * scale,
        dotSize, dotSize,
      );
    }

    // Camera viewport
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      centerX + (camera.x / CELL_SIZE - ox) * scale,
      centerY + (camera.y / CELL_SIZE - oy) * scale,
      (camera.viewWidth / CELL_SIZE) * scale,
      (camera.viewHeight / CELL_SIZE) * scale,
    );

    // Title
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#FFD700';
    ctx.textAlign = 'center';
    ctx.fillText('TACTICAL MAP', centerX + radarSize / 2, centerY - 8);
    ctx.textAlign = 'left';
  }

  // ─── Attack-Move Indicator ──────────────────────────────

  private renderAttackMoveIndicator(input: InputState): void {
    const ctx = this.ctx;
    const mx = input.mouseX;
    const my = input.mouseY;
    const s = 8;
    // Red crosshair near cursor
    ctx.strokeStyle = 'rgba(255,80,80,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx - s, my); ctx.lineTo(mx + s, my);
    ctx.moveTo(mx, my - s); ctx.lineTo(mx, my + s);
    ctx.stroke();
    // "A" label
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = 'rgba(255,80,80,0.9)';
    ctx.fillText('A', mx + s + 2, my - 2);
  }

  private renderModeLabel(input: InputState, label: string, color: string): void {
    const ctx = this.ctx;
    const mx = input.mouseX;
    const my = input.mouseY;
    // Draw icon near cursor
    if (label === 'SELL') {
      // Dollar sign icon
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = 'rgba(255,200,60,0.9)';
      ctx.fillText('$', mx + 10, my + 4);
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = 'rgba(255,200,60,0.6)';
      ctx.fillText('SELL', mx + 10, my + 14);
    } else if (label === 'REPAIR') {
      // Wrench icon (unicode)
      ctx.font = '12px monospace';
      ctx.fillStyle = 'rgba(80,255,80,0.9)';
      ctx.fillText('W', mx + 10, my + 4);
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = 'rgba(80,255,80,0.6)';
      ctx.fillText('FIX', mx + 10, my + 14);
    } else {
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = color;
      ctx.fillText(label, mx + 12, my - 4);
    }
  }

  // ─── Top Status Bar (C++ TabClass::Draw_It parity) ──────

  /** Tab bar height: C++ TAB_HEIGHT=8 * RESFACTOR. LORES=8px, HIRES=16px. */
  static readonly TAB_HEIGHT = 8 * RESFACTOR;
  /** C++ Rule.TimerWarning default/RULES.INI value: 2 minutes. */
  static readonly MISSION_TIMER_WARNING_TICKS = 2 * 60 * GAME_TICKS_PER_SEC;

  /** Draw the top status bar with metallic TabShape chrome.
   *  C++ RA/tab.cpp:91 TabClass::Draw_It draws TABS.SHP metallic gradient strips
   *  across the top bar instead of a plain black fill.
   *  Extracted tabs.png frames (9 frames, 80x7 LORES / 160x14 HIRES each):
   *    0 = normal metallic tab (C++ frame 0)
   *    1 = highlighted metallic tab (C++ frame 1)
   *    2 = timer dark (C++ frame 2)
   *    4 = timer warning/flash (C++ frame 4)
   *    6 = credits tab metallic (C++ frame 6)
   *    8 = credits tab red flash (C++ frame 8)
   *  Layout (LORES, EVA_WIDTH=80):
   *    Frame 0 at x=0: left tab ("Options")
   *    Frame 5 at x=width-80: credits tab (metallic) */
  renderTopBar(tick: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = Renderer.TAB_HEIGHT;
    const RF = RESFACTOR;

    // Black fill base (C++ LogicPage->Fill_Rect BLACK)
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Draw metallic tab shapes (C++ tab.cpp:116 CC_Draw_Shape TabShape)
    // Tab sprites are 80x7 LORES -- drawn at native size (CC_Draw_Shape at 1x).
    // The 7px sprite in the 8px bar leaves 1px for the bottom border line.
    const tabSheet = this._cachedAssets?.getSheet('tabs');
    if (tabSheet) {
      const prevSmoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;

      // Left tab -- frame 0 at x=0 (C++ tab.cpp:116)
      this._cachedAssets!.drawFrame(ctx, 'tabs', 0, 0, 0);

      // Credits tab -- frame 6 is the normal metallic right-cap tab.
      // C++ tab.cpp:150: CC_Draw_Shape(TabShape, 6, (320-EVA_WIDTH)*RF, 0)
      const credTabX = w - 80 * RF;
      this._cachedAssets!.drawFrame(ctx, 'tabs', 6, credTabX, 0);

      // Mission timer tab -- C++ tab.cpp:156-160 Draw_Credits_Tab.
      if (this.missionTimer > 0) {
        const light = this.missionTimer < Renderer.MISSION_TIMER_WARNING_TICKS || this.timerTabFlashTicks > 0;
        this._cachedAssets!.drawFrame(ctx, 'tabs', light ? 4 : 2, 320, 0);
      }

      ctx.imageSmoothingEnabled = prevSmoothing;
    }

    // Bottom border line (1px, C++ tab.cpp:121 Draw_Line BLACK)
    ctx.fillStyle = '#000';
    ctx.fillRect(0, h - 1, w, 1);

    const metalText = { align: 'center' as const, indexedPalette: METAL12_FONT_PALETTE, letterSpacing: 1 };

    // OPTIONS button (left, centered at x=40*RF -- EVA_WIDTH/2)
    // C++ tab.cpp:123 uses TPF_METAL12 | TPF_CENTER | TPF_USE_GRAD_PAL at y=0.
    this.drawBitmapText(this._cachedAssets, 'Options', 40 * RF, 0, METAL12_TEXT_COLOR, 'metal12', metalText);

    // Mission timer (center, x=200*RF). Only show if active.
    if (this.missionTimer > 0) {
      const totalSecs = Math.floor(this.missionTimer / GAME_TICKS_PER_SEC);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      const hours = Math.floor(mins / 60);
      const displayMins = mins % 60;
      // C++ CONQUER.TXT: "Time:%02d:%02d" / "Time:%02d:%02d:%02d"
      const timerText = hours > 0
        ? `Time:${hours.toString().padStart(2, '0')}:${displayMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        : `Time:${displayMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      this.drawBitmapText(this._cachedAssets, timerText, 200 * RF, 0, METAL12_TEXT_COLOR, 'metal12', metalText);
      void tick;
    }

    // Credits amount (right, over the credits tab at x=280*RF)
    const creditsText = `${this.sidebarCredits}`;
    this.drawBitmapText(this._cachedAssets, creditsText, 280 * RF, 0, METAL12_TEXT_COLOR, 'metal12', metalText);
  }

  // ─── EVA Messages & Mission Timer ──────────────────────

  renderEvaMessages(tick: number, systemTick = tick): void {
    const ctx = this.ctx;
    const currentSystemTick = Math.floor(systemTick);
    const active = this.evaMessages
      .filter((m) => {
        const startSystemTick = Math.floor(m.systemTick ?? currentSystemTick);
        return tick > m.tick && currentSystemTick <= startSystemTick + RA_MESSAGE_DELAY_TICKS;
      })
      .slice(-6);
    if (active.length === 0) return;

    // C++ Session.Messages.Init(Map.TacPixelX, Map.TacPixelY, 6, ..., 7*RF, ...)
    active.forEach((msg, i) => {
      this.drawBitmapText(this._cachedAssets, msg.text,
        0, (8 + i * 7) * RESFACTOR, PCOLOR_GREEN_FONT_RAMP[2], 'grad6',
        { align: 'left', indexedPalette: PCOLOR_GREEN_FULLSHADOW_FONT_PALETTE, letterSpacing: -1 });
    });
    ctx.globalAlpha = 1;
  }

  // ─── Music Track Display ─────────────────────────────────

  private lastMusicTrack = '';
  private musicTrackShowTick = 0;

  renderMusicTrack(tick: number): void {
    if (!this.musicTrack) return;
    // Detect track change → reset display timer
    if (this.musicTrack !== this.lastMusicTrack) {
      this.lastMusicTrack = this.musicTrack;
      this.musicTrackShowTick = tick;
    }
    // Show for 4 seconds (60 ticks) after track change
    const age = tick - this.musicTrackShowTick;
    if (age > 60) return;
    const alpha = age < 45 ? 0.7 : 0.7 * (1 - (age - 45) / 15);
    const ctx = this.ctx;
    const gameW = this.width - this.sidebarW;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = `rgba(180,180,180,${alpha.toFixed(2)})`;
    ctx.fillText(`♪ ${this.musicTrack}`, gameW - 6, this.height - 6);
    ctx.textAlign = 'left';
  }

  /** Render game speed indicator when above default 2× (matches original RA behavior) */
  renderGameSpeed(): void {
    if (this.gameSpeed <= 2) return;
    const ctx = this.ctx;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = this.gameSpeed >= 4 ? 'rgba(255,100,50,0.8)' : 'rgba(255,200,50,0.8)';
    ctx.fillText(`▸▸ ${this.gameSpeed}×`, 6, this.height - 6);
    ctx.textAlign = 'left';
  }

  // ─── Pause Overlay ──────────────────────────────────────

  /** Menu item count for pause menu */
  static readonly PAUSE_MENU_ITEMS = 6;

  renderPauseOverlay(): void {
    if (!this.pauseMenuOpen) {
      // Legacy "PAUSED" text for comparison mode
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, this.width, this.height);
      const pausedCol = this.palColor(PAL_ROCK_START + 2);
      const resumeCol = this.palColor(PAL_ROCK_START + 4);
      this.drawBitmapText(this._cachedAssets, 'PAUSED', this.width / 2, this.height / 2 - 20, pausedCol, '8pt', { align: 'center', scale: 2 });
      this.drawBitmapText(this._cachedAssets, 'Press P or Esc to resume', this.width / 2, this.height / 2 + 5, resumeCol, '6pt', { align: 'center' });
      return;
    }

    const ctx = this.ctx;
    // Darken background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, this.width, this.height);

    const layout = this.getPauseMenuLayout();
    const { px, py, w, h, itemH, titleH, sliderTrackW, sliderTrackX, items } = layout;

    // Panel background
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(px, py, w, h);
    ctx.strokeStyle = '#664400';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, w, h);

    // Title bar
    ctx.fillStyle = 'rgba(255,68,0,0.15)';
    ctx.fillRect(px + 1, py + 1, w - 2, titleH);
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#ff6633';
    ctx.textAlign = 'center';
    ctx.fillText('OPTIONS', px + w / 2, py + titleH - 4);

    // Render each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const iy = item.y;
      const isHighlighted = i === this.pauseMenuHighlight;

      // Highlight bar
      if (isHighlighted) {
        ctx.fillStyle = 'rgba(255,170,68,0.12)';
        ctx.fillRect(px + 2, iy, w - 4, itemH);
      }

      ctx.font = '10px monospace';
      ctx.textAlign = 'left';

      if (item.type === 'button') {
        const textColor = isHighlighted ? '#ffaa44' :
          i === 5 ? '#ff5544' : '#bbb'; // Abort is red
        ctx.fillStyle = textColor;
        const label = i === 3 ? `SPEED: ${this.pauseMenuGameSpeed}×` : item.label;
        ctx.fillText(label, px + 16, iy + itemH - 5);

        // Arrow indicator for highlighted button
        if (isHighlighted) {
          ctx.fillStyle = '#ffaa44';
          ctx.fillText('▸', px + 6, iy + itemH - 5);
        }
      } else if (item.type === 'slider') {
        const textColor = isHighlighted ? '#ffaa44' : '#bbb';
        ctx.fillStyle = textColor;
        ctx.fillText(item.label, px + 16, iy + itemH - 5);

        // Slider track
        const vol = i === 1 ? this.pauseMenuMusicVolume : this.pauseMenuSfxVolume;
        const trackY = iy + itemH / 2;
        const trackH = 6;

        // Track background
        ctx.fillStyle = 'rgba(100,68,0,0.4)';
        ctx.fillRect(sliderTrackX, trackY - trackH / 2, sliderTrackW, trackH);

        // Filled portion
        const fillW = Math.round(vol * sliderTrackW);
        ctx.fillStyle = isHighlighted ? '#ffaa44' : '#aa7722';
        ctx.fillRect(sliderTrackX, trackY - trackH / 2, fillW, trackH);

        // Track border
        ctx.strokeStyle = isHighlighted ? '#ffaa44' : '#664400';
        ctx.lineWidth = 1;
        ctx.strokeRect(sliderTrackX, trackY - trackH / 2, sliderTrackW, trackH);

        // Percentage label
        ctx.fillStyle = isHighlighted ? '#ffcc88' : '#888';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(vol * 100)}%`, px + w - 10, iy + itemH - 5);
      }
    }

    ctx.textAlign = 'left';
  }

  /** Compute pause menu layout constants */
  private getPauseMenuLayout() {
    const w = 240;
    const titleH = 18;
    const itemH = 24;
    const padBottom = 6;
    const itemCount = Renderer.PAUSE_MENU_ITEMS;
    const h = titleH + itemCount * itemH + padBottom;
    const px = (this.width - w) / 2;
    const py = (this.height - h) / 2;
    const sliderTrackW = 100;
    const sliderTrackX = px + w - sliderTrackW - 40; // right-aligned with room for %

    const items: Array<{ y: number; type: 'button' | 'slider'; label: string }> = [
      { y: py + titleH + 0 * itemH, type: 'button', label: 'RESUME GAME' },
      { y: py + titleH + 1 * itemH, type: 'slider', label: 'MUSIC' },
      { y: py + titleH + 2 * itemH, type: 'slider', label: 'SOUND' },
      { y: py + titleH + 3 * itemH, type: 'button', label: `SPEED: ${this.pauseMenuGameSpeed}×` },
      { y: py + titleH + 4 * itemH, type: 'button', label: 'RESTART MISSION' },
      { y: py + titleH + 5 * itemH, type: 'button', label: 'ABORT MISSION' },
    ];

    return { px, py, w, h, itemH, titleH, sliderTrackW, sliderTrackX, items };
  }

  /** Returns hit areas for pause menu click testing */
  getPauseMenuHitAreas(): Array<{ x: number; y: number; w: number; h: number; type: 'button' | 'slider'; index: number }> {
    const layout = this.getPauseMenuLayout();
    const { px, w, itemH, items, sliderTrackX, sliderTrackW } = layout;

    return items.map((item, i) => {
      // Sliders use full row width for click detection; sliderValueFromClick
      // handles clamping when clicks land outside the track area
      return { x: px, y: item.y, w, h: itemH, type: item.type, index: i };
    });
  }

  /** Returns the slider track position and width for click testing */
  getSliderTrackInfo(): { x: number; w: number } {
    const layout = this.getPauseMenuLayout();
    return { x: layout.sliderTrackX, w: layout.sliderTrackW };
  }

  /** Convert a click X position on a slider hit area to a 0-1 value */
  sliderValueFromClick(clickX: number, hitArea: { x: number; w: number }): number {
    return Math.max(0, Math.min(1, (clickX - hitArea.x) / hitArea.w));
  }

  // ─── Help Overlay ──────────────────────────────────────

  private renderHelpOverlay(): void {
    const ctx = this.ctx;
    const w = 280;
    const sections: Array<{ title: string; lines: string[] }> = [
      { title: 'UNIT COMMANDS', lines: [
        'S / G     Stop / Guard',
        'A         Attack-move mode',
        'Z         Cycle stance (Agg/Def/Hold)',
        'X         Scatter units',
        'Ctrl+RMB  Force-fire ground',
        'Shift+RMB Queue waypoints',
        'D         Deploy MCV',
      ]},
      { title: 'SELECTION', lines: [
        'LMB       Click select / drag box',
        'DblClick   Select all of type',
        'E         Select all same type',
        '1-9       Recall control group',
        'Ctrl+1-9  Assign control group',
        'Tab       Cycle unit types',
        '.         Cycle idle units',
      ]},
      { title: 'BUILDINGS', lines: [
        'Q         Sell mode',
        'R         Repair mode',
        'RMB build Set rally point',
      ]},
      { title: 'CAMERA', lines: [
        'Home/Spc  Center on selection',
        'Arrow/WASD Scroll map',
        'Minimap    Click to move camera',
      ]},
      { title: 'AUDIO', lines: [
        '+/-       Volume up/down',
        'M         Mute/unmute',
        'N         Next music track',
      ]},
      { title: 'SPEED', lines: [
        '` (tick)  Cycle 1×/2×/4× speed',
      ]},
      { title: 'SYSTEM', lines: [
        'Esc       Cancel / Pause',
        'F1        Toggle this help',
        `Difficulty: ${this.difficulty.toUpperCase()}`,
      ]},
    ];

    const lineH = 12;
    const sectionGap = 6;
    let totalLines = 0;
    for (const s of sections) totalLines += 1 + s.lines.length; // title + lines
    const h = totalLines * lineH + sections.length * sectionGap + 20;
    const px = (this.width - w) / 2;
    const py = (this.height - h) / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(px, py, w, h);
    ctx.strokeStyle = '#664400';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, w, h);
    // Title bar
    ctx.fillStyle = 'rgba(255,68,0,0.15)';
    ctx.fillRect(px + 1, py + 1, w - 2, 16);
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#ff6633';
    ctx.textAlign = 'center';
    ctx.fillText('COMMAND REFERENCE', px + w / 2, py + 12);
    ctx.textAlign = 'left';

    let curY = py + 22;
    for (const section of sections) {
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = '#ffaa44';
      ctx.fillText(section.title, px + 8, curY);
      curY += lineH;
      ctx.font = '9px monospace';
      ctx.fillStyle = '#bbb';
      for (const line of section.lines) {
        // Highlight key portion (before first space gap)
        const split = line.indexOf('  ');
        if (split > 0) {
          ctx.fillStyle = '#ddd';
          ctx.fillText(line.slice(0, split), px + 12, curY);
          ctx.fillStyle = '#999';
          ctx.fillText(line.slice(split), px + 12 + ctx.measureText(line.slice(0, split)).width, curY);
        } else {
          ctx.fillStyle = '#999';
          ctx.fillText(line, px + 12, curY);
        }
        curY += lineH;
      }
      curY += sectionGap;
    }
  }

  // ─── Sidebar ──────────────────────────────────────────────

  // ─── Sidebar Layout Constants (C++ sidebar.h / power.h, LORES base × RESFACTOR) ────
  static readonly RADAR_COVER_W = 80 * RESFACTOR;  // C++ RadarClass::RadWidth
  static readonly RADAR_COVER_H = 70 * RESFACTOR;  // C++ RadarClass::RadHeight
  static readonly RADAR_COVER_Y = 7 * RESFACTOR;   // C++ RadarClass::RadY
  static readonly RADAR_COVER_DRAW_Y = 8 * RESFACTOR; // C++ CC_Draw_Shape(RadarAnim, ..., RadY + 1*RESFACTOR)
  static readonly RADAR_SIZE = 70 * RESFACTOR;    // square radar minimap (custom, 70 LORES / 140 HIRES)
  static readonly RADAR_Y = 2 * RESFACTOR;        // top margin (custom)
  static readonly RADAR_INNER_X_OFFSET = 6;        // C++ RESFACTOR==2 RadOffX
  static readonly RADAR_INNER_Y_OFFSET = 7;        // C++ RESFACTOR==2 RadOffY
  static readonly RADAR_INNER_W = 128 + 18;        // C++ RESFACTOR==2 RadIWidth
  static readonly RADAR_INNER_H = 128 + 2;         // C++ RESFACTOR==2 RadIHeight

  // Button row — C++ SidebarClass::Init_IO shape button coordinates.
  // The extracted HIRES REPAIR/SELL/MAP shapes are already 34×28 pixels,
  // so they are drawn unscaled at the same absolute positions C++ uses.
  static readonly BUTTON_ROW_Y = (0x96 / 2) * RESFACTOR;
  static readonly BUTTON_H = 14 * RESFACTOR;
  static readonly BUTTON_ONE_X = (0x1f2 / 2) * RESFACTOR - 240 * RESFACTOR;
  static readonly BUTTON_ONE_W = 17 * RESFACTOR;
  static readonly BUTTON_TWO_X = ((RESFACTOR as number) === 2
    ? 0x21f
    : (Math.floor(0x21f / 2) + 1) * RESFACTOR) - 240 * RESFACTOR;
  static readonly BUTTON_TWO_W = 17 * RESFACTOR;
  static readonly BUTTON_THREE_X = (0x24c / 2) * RESFACTOR - 240 * RESFACTOR;
  static readonly BUTTON_THREE_W = 17 * RESFACTOR;

  // Strip columns (C++ StripClass, sidebar.h)
  static readonly STRIP_START_Y = 90 * RESFACTOR;   // COLUMN_ONE_Y
  static readonly CAMEO_W = 32 * RESFACTOR;          // OBJECT_WIDTH
  static readonly CAMEO_H = 24 * RESFACTOR;          // OBJECT_HEIGHT
  static readonly CAMEO_VISIBLE = 4;                  // MAX_VISIBLE (C++ = 4!)
  static readonly CAMEO_GAP = 0;                      // C++ has no gap between cameos
  static readonly CAMEO_DRAW_X_OFFSET = 2 * RESFACTOR; // LEFT_EDGE_OFFSET
  static readonly LEFT_STRIP_X_OFFSET = 8 * RESFACTOR;   // (248-240)×RF = COLUMN_ONE relative
  static readonly RIGHT_STRIP_X_OFFSET = 43 * RESFACTOR; // (283-240)×RF = COLUMN_TWO relative

  // Scroll buttons — both below strip, side-by-side (C++ sidebar.h)
  static readonly SCROLL_RATE = 6 * RESFACTOR;      // px/step (WIN32)
  static readonly UP_X_OFFSET = 2 * RESFACTOR;      // from column X — left scroll btn
  static readonly DOWN_X_OFFSET = 18 * RESFACTOR;   // from column X — right scroll btn
  static readonly SBUTTON_W = 16 * RESFACTOR;       // scroll button width
  static readonly SBUTTON_H = 12 * RESFACTOR;       // scroll button height
  static readonly SCROLL_BTN_Y_OFFSET = 97 * RESFACTOR - 1; // C++ Init_IO: Y + UP_Y_OFFSET*RESFACTOR, then Y--

  // Power bar (C++ power.h)
  static readonly POWER_Y = 88 * RESFACTOR;          // absolute Y
  static readonly POWER_HEIGHT = 110;                  // C++ POWER_HEIGHT (200-(7+70+13)) power.h:81-94 — resolution independent
  static readonly POWER_BAR_RENDERED_HEIGHT = (RESFACTOR as number) === 1 ? 76 : 153; // LORES: raw 76px, HIRES: (76×2+1) rescaled
  static readonly POWER_BAR_W = 5 * RESFACTOR;
  static readonly POWER_BAR_X_OFFSET = 0;              // C++ Draw_It: PowerBarShape at 240*RESFACTOR
  static readonly POWER_FILL_X_OFFSET = 5 * RESFACTOR; // C++ Fill_Rect starts at 245*RESFACTOR
  static readonly POWER_MARKER_X_OFFSET = 1 * RESFACTOR; // C++ PowerShape at (POWER_X*RESFACTOR)+RESFACTOR
  static readonly POWER_MARKER_Y_OFFSET = 0; // C++ power.cpp:241 has no extra y bias.
  static readonly POWER_RAW_BOTTOM = Renderer.POWER_Y + (Renderer.POWER_HEIGHT - 1) * RESFACTOR; // C++ power.cpp:199
  static readonly POWER_FILL_BOTTOM = 175 * RESFACTOR + 1; // C++ power.cpp:230

  // Sidebar background shape Y positions (absolute, for house-specific art)
  static readonly SIDEBAR_BG_TOP_Y = 8 * RESFACTOR;    // side1na/us
  static readonly SIDEBAR_BG_MID_Y = 88 * RESFACTOR;   // side2na/us
  static readonly SIDEBAR_BG_BOT_Y = 138 * RESFACTOR;  // side3na/us

  // Power bar color palette indices (C++ power.cpp)
  static readonly POWER_COLOR_NORMAL: [string, string] = ['rgb(0,168,0)', 'rgb(84,252,84)'];      // pal[3]/[4]
  static readonly POWER_COLOR_LOW: [string, string] = ['rgb(212,120,16)', 'rgb(236,172,84)'];     // pal[214]/[211]
  static readonly POWER_COLOR_CRITICAL: [string, string] = ['rgb(176,0,0)', 'rgb(252,0,0)'];      // pal[235]/[230]

  // Bounce animation modtable (C++ power.cpp:166)
  static readonly POWER_MODTABLE = [0, -1, 0, 1, 0, -1, -2, -1, 0, 1, 2, 1, 0];
  // Power height step function (C++ POWER_STEP_LEVEL / POWER_STEP_FACTOR)
  static readonly POWER_STEP_LEVEL = 100;
  static readonly POWER_STEP_FACTOR = 5;

  /** Get minimap bounds for hit-testing (used by game click handlers) */
  getMinimapBounds(): { x: number; y: number; size: number } {
    const mmSize = Renderer.RADAR_SIZE;
    const mmX = this.width - this.sidebarW + (this.sidebarW - mmSize) / 2;
    const mmY = Renderer.RADAR_Y;
    return { x: mmX, y: mmY, size: mmSize };
  }

  /** Get the Y offset where production strips start (for click handling) */
  getProductionStartY(): number {
    return Renderer.STRIP_START_Y;
  }

  /** Get button row Y position (repair/sell/map) */
  getButtonRowY(): number {
    return Renderer.BUTTON_ROW_Y;
  }

  /** Get scroll arrow hit regions for a production strip.
   *  C++ layout: both scroll buttons are side-by-side below the strip cameos. */
  getScrollArrowBounds(strip: StripType): { upX: number; upY: number; upW: number; upH: number; downX: number; downY: number; downW: number; downH: number } {
    const sidebarX = this.width - this.sidebarW;
    const xOffset = strip === 'left' ? Renderer.LEFT_STRIP_X_OFFSET : Renderer.RIGHT_STRIP_X_OFFSET;
    const colX = sidebarX + xOffset;
    const btnY = Renderer.STRIP_START_Y + Renderer.SCROLL_BTN_Y_OFFSET;
    return {
      upX: colX + Renderer.UP_X_OFFSET,
      upY: btnY,
      upW: Renderer.SBUTTON_W,
      upH: Renderer.SBUTTON_H,
      downX: colX + Renderer.DOWN_X_OFFSET,
      downY: btnY,
      downW: Renderer.SBUTTON_W,
      downH: Renderer.SBUTTON_H,
    };
  }

  /** Get bounds for a production strip (for hit testing) */
  getStripBounds(strip: StripType): { x: number; y: number; w: number; h: number } {
    const sidebarX = this.width - this.sidebarW;
    const xOffset = strip === 'left' ? Renderer.LEFT_STRIP_X_OFFSET : Renderer.RIGHT_STRIP_X_OFFSET;
    return {
      x: sidebarX + xOffset,
      y: Renderer.STRIP_START_Y,
      w: Renderer.CAMEO_W,
      h: Renderer.CAMEO_VISIBLE * (Renderer.CAMEO_H + Renderer.CAMEO_GAP),
    };
  }

  private renderSidebar(assets: AssetManager): void {
    const ctx = this.ctx;
    const x = this.width - this.sidebarW;
    const w = this.sidebarW;
    const lowPower = this.sidebarPowerConsumed > this.sidebarPowerProduced && this.sidebarPowerProduced > 0;

    // Background — house-specific 3-section shapes (C++ SidebarClass::Draw_It)
    const isAllied = this.isPlayerAllied();
    const bgTop = assets.getSheet(isAllied ? 'side1na' : 'side1us');
    const bgMid = assets.getSheet(isAllied ? 'side2na' : 'side2us');
    const bgBot = assets.getSheet(isAllied ? 'side3na' : 'side3us');
    if (bgTop && bgMid && bgBot) {
      // C++ SidebarClass::Draw_It calls PowerClass::Draw_It before repainting
      // the sidebar art, so the static chrome covers the initial powerbar pass.
      this.renderVerticalPowerBar(assets, x, lowPower);
      // LORES shapes drawn at RESFACTOR× scale to fill sidebar.
      // Nearest-neighbor sampling preserves pixel art (no bilinear blur).
      const prevSmoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      const scale = w / bgTop.meta.frameWidth;
      const midFrame = Math.min(this.sidebarChromeFrame, bgMid.meta.frameCount - 1);
      const botFrame = Math.min(this.sidebarChromeFrame, bgBot.meta.frameCount - 1);
      assets.drawFrame(ctx, isAllied ? 'side1na' : 'side1us', 0, x, Renderer.SIDEBAR_BG_TOP_Y, { scale });
      assets.drawFrame(ctx, isAllied ? 'side2na' : 'side2us', midFrame, x, Renderer.SIDEBAR_BG_MID_Y, { scale });
      assets.drawFrame(ctx, isAllied ? 'side3na' : 'side3us', botFrame, x, Renderer.SIDEBAR_BG_BOT_Y, { scale });
      ctx.imageSmoothingEnabled = prevSmoothing;
    } else {
      // Fallback: tile sidebar.png or dark fill
      const sidebarSheet = assets.getSheet('sidebar');
      if (sidebarSheet) {
        for (let ty = 0; ty < this.height; ty += 123) {
          assets.drawFrame(ctx, 'sidebar', 0, x, ty);
          assets.drawFrame(ctx, 'sidebar', 1, x + this.sidebarW / 2, ty);
        }
      } else {
        ctx.fillStyle = 'rgba(20,20,25,0.95)';
        ctx.fillRect(x, 0, w, this.height);
      }
      this.renderVerticalPowerBar(assets, x, lowPower);
    }

    // Dual production strips
    const leftItems = this.sidebarItems.filter(it => getStripSide(it) === 'left');
    const rightItems = this.sidebarItems.filter(it => getStripSide(it) === 'right');

    // Clip strips to visible cameo area
    const stripClipH = Renderer.CAMEO_VISIBLE * Renderer.CAMEO_H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, Renderer.STRIP_START_Y, w, stripClipH);
    ctx.clip();

    this.renderStrip(ctx, assets, x + Renderer.LEFT_STRIP_X_OFFSET, Renderer.STRIP_START_Y,
      leftItems, this.leftStripScroll, lowPower, 'left');
    this.renderStrip(ctx, assets, x + Renderer.RIGHT_STRIP_X_OFFSET, Renderer.STRIP_START_Y,
      rightItems, this.rightStripScroll, lowPower, 'right');

    ctx.restore();

    // Scroll buttons below strips (C++ layout: side-by-side)
    this.renderStripScrollArrows(ctx, assets, x + Renderer.LEFT_STRIP_X_OFFSET, leftItems, this.leftStripScroll);
    this.renderStripScrollArrows(ctx, assets, x + Renderer.RIGHT_STRIP_X_OFFSET, rightItems, this.rightStripScroll);

    ctx.textAlign = 'left';
  }

  private renderSidebarButtonRow(assets: AssetManager): void {
    this.renderButtonRow(this.width - this.sidebarW, this.sidebarW, assets);
  }

  /** Whether C++ would have a visible drain marker after sidebar dirty paints. */
  private shouldRenderPowerMarker(): boolean {
    return this.sidebarPowerProduced !== 0 ||
      this.sidebarPowerConsumed !== 0 ||
      this.powerHeight !== 0 ||
      this.drainHeight !== 0 ||
      this.desiredPowerHeight !== 0 ||
      this.desiredDrainHeight !== 0 ||
      this.powerBounce !== 0 ||
      this.drainBounce !== 0 ||
      this.powerFlashTimer !== 0;
  }

  /** Whether the C++ back buffer has PowerClass chrome above SIDE*.SHP chrome. */
  private shouldRedrawPowerBarAfterSidebar(): boolean {
    return this.powerChromeAboveSidebar;
  }

  /** Render vertical power bar (C++ PowerClass::Draw_It — bounce animation, palette colors) */
  private renderVerticalPowerBar(assets: AssetManager, sidebarX: number, lowPower: boolean): void {
    const ctx = this.ctx;
    const pwrFrameX = sidebarX + Renderer.POWER_BAR_X_OFFSET;
    const pwrFillX = sidebarX + Renderer.POWER_FILL_X_OFFSET;
    const markerX = sidebarX + Renderer.POWER_MARKER_X_OFFSET;
    const pwrY = Renderer.POWER_Y;
    const pwrH = Renderer.POWER_BAR_RENDERED_HEIGHT;
    const produced = this.sidebarPowerProduced;
    const consumed = this.sidebarPowerConsumed;

    // Draw powerbar shape. The extracted POWERBAR.SHP frames are already in
    // hires pixels; C++ draws them at 240*RESFACTOR without another scale.
    const pwrSheet = assets.getSheet('powerbar');
    if (pwrSheet) {
      const frameH = pwrSheet.meta.frameHeight;
      // Frame 0 = top half, frame 1 = bottom half
      assets.drawFrame(ctx, 'powerbar', 0, pwrFrameX, pwrY);
      if (pwrSheet.meta.frameCount > 1) {
        assets.drawFrame(ctx, 'powerbar', 1, pwrFrameX, pwrY + frameH);
      }
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(pwrFrameX, pwrY, Renderer.POWER_BAR_W, pwrH);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.strokeRect(pwrFrameX, pwrY, Renderer.POWER_BAR_W, pwrH);
    }

    // C++ bounce animation: apply modtable when at target height
    const modtable = Renderer.POWER_MODTABLE;
    let ph = this.powerHeight;
    let dh = this.drainHeight;
    if (this.powerBounce > 0 && ph === this.desiredPowerHeight) {
      ph += modtable[this.powerBounce] * this.powerDir;
    }
    if (this.drainBounce > 0 && dh === this.desiredDrainHeight) {
      dh += modtable[this.drainBounce] * this.drainDir;
    }
    ph = Math.max(0, Math.min(Renderer.POWER_HEIGHT - 2, ph));
    dh = Math.max(0, Math.min(Renderer.POWER_HEIGHT - 2, dh));

    let bottom = Renderer.POWER_RAW_BOTTOM;
    let drawPowerHeight = ph;
    let drawDrainHeight = dh;

    // Choose color based on drain vs power ratio (C++ power.cpp)
    let colors: [string, string];
    if (consumed > produced * 2) {
      colors = Renderer.POWER_COLOR_CRITICAL; // red
    } else if (consumed > produced) {
      colors = Renderer.POWER_COLOR_LOW; // orange
    } else {
      colors = Renderer.POWER_COLOR_NORMAL; // green
    }

    // Draw 2-pixel-wide power bars from bottom up (C++ Fill_Rect pairs)
    if (ph > 0) {
      if ((RESFACTOR as number) !== 1) {
        drawPowerHeight = Math.floor(ph * 153 / 107);
        drawDrainHeight = Math.floor(dh * 153 / 107);
      }
      drawPowerHeight = Math.max(0, Math.min(pwrH - 2, drawPowerHeight));
      drawDrainHeight = Math.max(0, Math.min(pwrH - 2, drawDrainHeight));
      bottom = Renderer.POWER_FILL_BOTTOM;

      // Flash effect: alternate red when flashing
      const flashing = this.powerFlashTimer > 1 && ((this.powerFlashTimer % 3) & 1) !== 0;
      const c1 = flashing ? '#CC0000' : colors[0];
      const c2 = flashing ? '#880000' : colors[1];

      ctx.fillStyle = c2;
      ctx.fillRect(pwrFillX, bottom - drawPowerHeight, 2, drawPowerHeight + 1);
      ctx.fillStyle = c1;
      ctx.fillRect(pwrFillX + 2, bottom - drawPowerHeight, 2, drawPowerHeight + 1);
    }

    // Draw drain marker shape at drain height
    const markerSheet = assets.getSheet('power_marker');
    const markerY = bottom - (drawDrainHeight + 2 * RESFACTOR) + Renderer.POWER_MARKER_Y_OFFSET;
    if (markerSheet && this.shouldRenderPowerMarker()) {
      assets.drawFrame(ctx, 'power_marker', 0, markerX, markerY);
    } else if (!markerSheet && this.shouldRenderPowerMarker()) {
      // Fallback: white divider line at drain level
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(markerX, bottom - dh);
      ctx.lineTo(markerX + Renderer.POWER_BAR_W, bottom - dh);
      ctx.stroke();
    }

  }

  /** Render a single production strip (C++ StripClass::Draw_It) */
  private renderStrip(
    ctx: CanvasRenderingContext2D, assets: AssetManager,
    stripX: number, startY: number,
    items: SidebarItem[], scroll: number, lowPower: boolean,
    strip: StripType,
  ): void {
    const camW = Renderer.CAMEO_W;
    const camH = Renderer.CAMEO_H;
    const rowH = camH; // CAMEO_GAP = 0
    const cameoX = stripX + Renderer.CAMEO_DRAW_X_OFFSET;

    // C++ StripClass::Draw_It draws the side-specific strip background once,
    // inset by LEFT_EDGE_OFFSET, only when fewer than MAX_VISIBLE cameos exist.
    if (items.length < Renderer.CAMEO_VISIBLE) {
      const bgName = this.isPlayerAllied() ? 'stripna' : 'stripus';
      const bg = assets.getSheet(bgName);
      if (bg) {
        assets.drawFrame(ctx, bgName, strip === 'left' ? 0 : 1, cameoX, startY);
      }
    }

    if (items.length === 0) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const iy = startY + i * rowH - scroll;

      // Cull off-screen items
      if (iy < startY - rowH || iy > this.height) continue;

      // Draw cameo icon (HIRES 64x48 — all icons should be HIRES)
      const iconName = isSidebarSpecialItem(item) ? item.iconName : item.type.toLowerCase() + 'icon';
      const iconSheet = assets.getSheet(iconName);
      if (iconSheet) {
        ctx.drawImage(iconSheet.image, 0, 0, iconSheet.meta.frameWidth, iconSheet.meta.frameHeight,
          cameoX, iy, camW, camH);
      } else {
        ctx.fillStyle = 'rgba(30,30,40,0.9)';
        ctx.fillRect(cameoX, iy, camW, camH);
        ctx.strokeStyle = 'rgba(80,80,80,0.5)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(cameoX, iy, camW, camH);
      }

      if (isSidebarSpecialItem(item)) {
        const swState = this.superweapons.get(`${item.specialHouse}:${item.specialType}`);
        if (!swState) continue;
        const def = SUPERWEAPON_DEFS[item.specialType];
        if (swState.ready) {
          const pipsSheet = assets.getSheet('pips');
          if (pipsSheet) {
            const pipScale = camW / pipsSheet.meta.frameWidth;
            assets.drawFrame(ctx, 'pips', 3, cameoX, iy + (camH - pipsSheet.meta.frameHeight * pipScale) / 2, { scale: pipScale });
          } else {
            this.drawBitmapText(assets, 'READY', cameoX + camW / 2, iy + camH / 2 - 4, '#0f0', '6pt', { align: 'center' });
          }
        } else {
          const progress = def.rechargeTicks > 0 ? swState.chargeTick / def.rechargeTicks : 0;
          const clockSheet = assets.getSheet('clock');
          if (clockSheet) {
            const clockFrame = Math.min(Math.floor(progress * (clockSheet.meta.frameCount - 1)) + 1, clockSheet.meta.frameCount - 1);
            this.drawSidebarClockOverlay(assets, clockFrame, cameoX, iy);
          }
        }
        continue;
      }

      // Check production state — use factory type key (5-factory system)
      const factoryKey = getFactoryType(item);
      const qEntry = this.sidebarQueue.get(factoryKey);
      const isBuilding = qEntry && qEntry.item.type === item.type;

      if (isBuilding && qEntry) {
        const progress = qEntry.progress / qEntry.item.buildTime;
        const completed = progress >= 1;
        const paused = !completed && qEntry.progress > 0 && (qEntry as { paused?: boolean }).paused;

        if (completed) {
          // Draw "READY" pip (C++ PipShapes frame 3)
          const pipsSheet = assets.getSheet('pips');
          if (pipsSheet) {
            const pipScale = camW / pipsSheet.meta.frameWidth;
            assets.drawFrame(ctx, 'pips', 3, cameoX, iy + (camH - pipsSheet.meta.frameHeight * pipScale) / 2, { scale: pipScale });
          } else {
            this.drawBitmapText(assets, 'READY', cameoX + camW / 2, iy + camH / 2 - 4, '#0f0', '6pt', { align: 'center' });
          }
        } else {
          // Clock overlay (C++ ClockShapes with SHAPE_GHOST)
          const clockSheet = assets.getSheet('clock');
          if (clockSheet) {
            const clockFrame = Math.min(Math.floor(progress * (clockSheet.meta.frameCount - 1)) + 1, clockSheet.meta.frameCount - 1);
            this.drawSidebarClockOverlay(assets, clockFrame, cameoX, iy);
          } else {
            const uncoverH = camH * (1 - progress);
            ctx.fillStyle = lowPower ? 'rgba(180,40,40,0.5)' : 'rgba(0,0,0,0.55)';
            ctx.fillRect(cameoX, iy, camW, uncoverH);
            ctx.font = 'bold 7px monospace';
            this.drawBitmapText(assets, `${Math.floor(progress * 100)}%`,
              cameoX + camW / 2, iy + camH / 2 - 4, lowPower ? '#f88' : '#8f8', '6pt', { align: 'center' });
          }

          // Paused: draw "HOLDING" pip (frame 4)
          if (paused) {
            const pipsSheet = assets.getSheet('pips');
            if (pipsSheet) {
              const pipScale = camW / pipsSheet.meta.frameWidth;
              assets.drawFrame(ctx, 'pips', 4, cameoX, iy + (camH - pipsSheet.meta.frameHeight * pipScale) / 2, { scale: pipScale });
            }
          }
        }
        // Queue count badge
        if (qEntry.queueCount > 1) {
          this.drawBitmapText(assets, `x${qEntry.queueCount}`, stripX + camW - 6, iy + 1, '#ff0', '6pt', { align: 'center' });
        }
      } else {
        // Not building: C++ darkens other items in the same factory strip while
        // that factory is busy. It does not darken merely because cash is low.
        if (qEntry || this.sidebarHackPreventedTypes.has(item.type)) {
          const clockSheet = assets.getSheet('clock');
          if (clockSheet) {
            this.drawSidebarClockOverlay(assets, 0, cameoX, iy);
          } else {
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.fillRect(cameoX, iy, camW, camH);
          }
        }
      }
    }
  }

  private drawSidebarClockOverlay(assets: AssetManager, frame: number, x: number, y: number): void {
    const clockSheet = assets.getSheet('clock');
    if (!clockSheet) return;

    if (this.pal) {
      const greenIndex = nearestPaletteIndex(this.pal, 0, 168, 0);
      assets.drawFrameTranslucent(
        this.ctx,
        'clock',
        Math.max(0, Math.min(frame, clockSheet.meta.frameCount - 1)),
        x,
        y,
        this.pal,
        [{ sourceColorIndex: greenIndex, destColorIndex: RA_COLOR_BLACK, frac: 100 }],
        { conquerFading: true },
      );
      return;
    }

    this.ctx.save();
    this.ctx.globalAlpha = 0.5;
    this.ctx.filter = 'brightness(0)';
    assets.drawFrame(this.ctx, 'clock', Math.max(0, Math.min(frame, clockSheet.meta.frameCount - 1)), x, y);
    this.ctx.restore();
  }

  /** Render scroll buttons below strip (C++ sprite-based, side-by-side) */
  private renderStripScrollArrows(
    ctx: CanvasRenderingContext2D, assets: AssetManager,
    stripX: number, _items: SidebarItem[], _scroll: number,
  ): void {
    const btnY = Renderer.STRIP_START_Y + Renderer.SCROLL_BTN_Y_OFFSET;

    // Up arrow (left button). C++ always draws the ShapeButton; invalid
    // scroll attempts play VOC_SCOLD rather than disabling the button visual.
    const upSheet = assets.getSheet('stripup');
    if (upSheet) {
      assets.drawFrame(ctx, 'stripup', 0, stripX + Renderer.UP_X_OFFSET, btnY);
    } else {
      ctx.fillStyle = '#aaa';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('\u25B2', stripX + Renderer.UP_X_OFFSET + Renderer.SBUTTON_W / 2, btnY + Renderer.SBUTTON_H / 2 + 3);
    }

    // Down arrow (right button), same always-visible C++ ShapeButton behavior.
    const dnSheet = assets.getSheet('stripdn');
    if (dnSheet) {
      assets.drawFrame(ctx, 'stripdn', 0, stripX + Renderer.DOWN_X_OFFSET, btnY);
    } else {
      ctx.fillStyle = '#aaa';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('\u25BC', stripX + Renderer.DOWN_X_OFFSET + Renderer.SBUTTON_W / 2, btnY + Renderer.SBUTTON_H / 2 + 3);
    }
  }

  // ─── Button Row (Repair / Sell / Map — C++ English layout, SHP sprites) ──────

  /** Render the 3-icon button row at the C++ ShapeButtonClass positions. */
  private renderButtonRow(sidebarX: number, _sidebarW: number, assets: AssetManager): void {
    const ctx = this.ctx;
    const btnY = Renderer.BUTTON_ROW_Y;
    const btnH = Renderer.BUTTON_H;
    const buttons: Array<{ sprite: string; active: boolean; label: string; x: number; w: number }> = [
      { sprite: 'repair', active: this.repairMode, label: 'FIX', x: Renderer.BUTTON_ONE_X, w: Renderer.BUTTON_ONE_W },
      { sprite: 'sell', active: this.sellMode, label: 'SELL', x: Renderer.BUTTON_TWO_X, w: Renderer.BUTTON_TWO_W },
      { sprite: 'map_btn', active: this.radarZoomPressed, label: 'MAP', x: Renderer.BUTTON_THREE_X, w: Renderer.BUTTON_THREE_W },
    ];

    for (const btn of buttons) {
      const bx = sidebarX + btn.x;

      // Sprite icon (C++ ShapeButtonClass::Draw_Me — frame 0=unpressed, 1=pressed, 2=disabled)
      const spriteSheet = assets.getSheet(btn.sprite);
      if (spriteSheet) {
        // C++ only disables Zoom in Init_IO/Radar_Activate(2). Low-power
        // Radar_Activate(0) closes the radar cover but leaves the button's
        // enabled state intact after a prior Radar_Activate(3).
        const disabled = btn.sprite === 'map_btn' && !this.radarZoomEnabled;
        const frame = disabled ? 2 : (btn.active ? 1 : 0);
        assets.drawFrame(ctx, btn.sprite, frame, bx, btnY);
      } else {
        // Fallback: semi-transparent button with text
        ctx.fillStyle = btn.active ? 'rgba(255,200,60,0.45)' : 'rgba(20,20,28,0.55)';
        ctx.fillRect(bx, btnY, btn.w, btnH);
        ctx.strokeStyle = btn.active ? '#FFD700' : '#555';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, btnY, btn.w, btnH);
        const btnColor = btn.active ? '#000' : '#ccc';
        this.drawBitmapText(assets, btn.label, bx + btn.w / 2, btnY + btnH / 2 - 3, btnColor, '6pt', { align: 'center' });
      }
    }
  }

  /** Get button row Y position */
  getSellRepairButtonY(): number {
    return Renderer.BUTTON_ROW_Y;
  }

  // ─── Superweapon Buttons ──────────────────────────────────

  private renderSuperweaponButtons(sidebarX: number, sidebarW: number, assets?: AssetManager): void {
    const ctx = this.ctx;
    const playerSws: Array<{ type: SuperweaponType; def: SuperweaponDef; chargeTick: number; ready: boolean; fired: boolean }> = [];

    for (const [, state] of this.superweapons) {
      if (!this.playerHouses.has(state.house as House)) continue;
      const def = SUPERWEAPON_DEFS[state.type];
      if (!def) continue;
      if (state.type === SuperweaponType.GPS_SATELLITE && state.fired) continue;
      playerSws.push({ type: state.type, def, chargeTick: state.chargeTick, ready: state.ready, fired: state.fired });
    }
    if (playerSws.length === 0) return;

    const btnH = 10 * RESFACTOR;
    // Position at very bottom of sidebar
    const buttonsStartY = this.height - playerSws.length * btnH;

    for (let i = 0; i < playerSws.length; i++) {
      const sw = playerSws[i];
      const btnY = buttonsStartY + i * btnH;
      const progress = sw.def.rechargeTicks > 0 ? sw.chargeTick / sw.def.rechargeTicks : 0;

      // Button background
      ctx.fillStyle = sw.ready ? 'rgba(40,80,40,0.9)' : 'rgba(30,30,40,0.9)';
      ctx.fillRect(sidebarX + 2, btnY, sidebarW - 4, btnH - 2);

      // Charge progress bar
      if (!sw.ready) {
        ctx.fillStyle = 'rgba(60,120,200,0.4)';
        ctx.fillRect(sidebarX + 2, btnY, (sidebarW - 4) * progress, btnH - 2);
      }

      // Ready glow — pulsing green border
      if (sw.ready) {
        const pulse = 0.5 + 0.3 * Math.sin(Date.now() * 0.005);
        ctx.strokeStyle = `rgba(80,255,80,${pulse})`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sidebarX + 2, btnY, sidebarW - 4, btnH - 2);
      } else {
        ctx.strokeStyle = 'rgba(80,80,100,0.5)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sidebarX + 2, btnY, sidebarW - 4, btnH - 2);
      }

      // Circular charge arc indicator (left side)
      const arcX = sidebarX + 6 * RESFACTOR;
      const arcY = btnY + btnH / 2 - 1;
      const arcR = 3 * RESFACTOR;
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(arcX, arcY, arcR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = sw.ready ? '#4f4' : '#48c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(arcX, arcY, arcR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();

      // Weapon icon (small colored dot in center of arc)
      const iconColors: Record<SuperweaponType, string> = {
        [SuperweaponType.CHRONOSPHERE]: '#88f',
        [SuperweaponType.IRON_CURTAIN]: '#fd0',
        [SuperweaponType.NUKE]: '#f44',
        [SuperweaponType.GPS_SATELLITE]: '#4df',
        [SuperweaponType.SONAR_PULSE]: '#4fa',
        [SuperweaponType.PARABOMB]: '#f80',
        [SuperweaponType.PARAINFANTRY]: '#8f4',
        [SuperweaponType.SPY_PLANE]: '#8cf',
      };
      ctx.fillStyle = iconColors[sw.type] ?? '#fff';
      ctx.beginPath();
      ctx.arc(arcX, arcY, 2, 0, Math.PI * 2);
      ctx.fill();

      // Label text
      const maxChars = (RESFACTOR as number) === 1 ? 6 : 10;
      const label = sw.def.name.length > maxChars ? sw.def.name.slice(0, maxChars - 1) + '.' : sw.def.name;
      this.drawBitmapText(assets, label, sidebarX + 11 * RESFACTOR, btnY + 1 * RESFACTOR, sw.ready ? '#4f4' : '#aaa', '6pt');

      // Charge percentage or READY
      if (sw.ready) {
        this.drawBitmapText(assets, 'READY', sidebarX + 11 * RESFACTOR, btnY + 6 * RESFACTOR, '#4f4', '6pt');
      } else {
        this.drawBitmapText(assets, `${Math.floor(progress * 100)}%`, sidebarX + 11 * RESFACTOR, btnY + 6 * RESFACTOR, '#888', '6pt');
      }
    }
  }

  // ─── Placement Ghost ────────────────────────────────────

  private renderPlacementGhost(camera: Camera, assets: AssetManager): void {
    if (!this.placementItem) return;
    const ctx = this.ctx;
    const screen = camera.worldToScreen(
      this.placementCx * CELL_SIZE,
      this.placementCy * CELL_SIZE,
    );
    const [fw, fh] = STRUCTURE_SIZE[this.placementItem.type] ?? [2, 2];

    // Per-cell passability coloring (footprint cells)
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        const idx = dy * fw + dx;
        const cellPassable = (this.placementCells && idx < this.placementCells.length)
          ? this.placementCells[idx] : this.placementValid;
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = cellPassable ? 'rgba(80,255,80,0.5)' : 'rgba(255,80,80,0.5)';
        ctx.fillRect(screen.x + dx * CELL_SIZE, screen.y + dy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = cellPassable ? 'rgba(80,255,80,0.3)' : 'rgba(255,80,80,0.3)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(screen.x + dx * CELL_SIZE, screen.y + dy * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
    // C++ bdata.cpp:3448-3477: bib cells in placement preview
    const bibCellPositions = getBibCells(this.placementItem.type, this.placementCx, this.placementCy);
    for (let bi = 0; bi < bibCellPositions.length; bi++) {
      const bc = bibCellPositions[bi];
      const bibIdx = fw * fh + bi;
      const bibPassable = (this.placementCells && bibIdx < this.placementCells.length)
        ? this.placementCells[bibIdx] : this.placementValid;
      const bScreen = camera.worldToScreen(bc.cx * CELL_SIZE, bc.cy * CELL_SIZE);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = bibPassable ? 'rgba(80,255,80,0.4)' : 'rgba(255,80,80,0.4)';
      ctx.fillRect(bScreen.x, bScreen.y, CELL_SIZE, CELL_SIZE);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = bibPassable ? 'rgba(80,255,80,0.2)' : 'rgba(255,80,80,0.2)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(bScreen.x, bScreen.y, CELL_SIZE, CELL_SIZE);
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.placementValid ? '#8f8' : '#f88';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(screen.x, screen.y, fw * CELL_SIZE, fh * CELL_SIZE);

    // Draw building sprite preview at 50% opacity
    const buildingSheet = assets.getSheet(this.placementItem.type.toLowerCase());
    if (buildingSheet) {
      ctx.globalAlpha = 0.5;
      assets.drawFrame(ctx, this.placementItem.type.toLowerCase(), 0,
        screen.x + fw * CELL_SIZE / 2,
        screen.y + fh * CELL_SIZE / 2,
        { centerX: true, centerY: true });
      ctx.globalAlpha = 1;
    }

    // Label
    this.drawBitmapText(assets, this.placementItem.name, screen.x + fw * CELL_SIZE / 2, screen.y - 11, '#fff', '8pt', { align: 'center' });
    // Cost label
    const placeColor = this.placementValid ? '#8f8' : '#f88';
    const placeText = this.placementValid ? 'Click to place' : 'Cannot place here';
    this.drawBitmapText(assets, placeText, screen.x + fw * CELL_SIZE / 2, screen.y + fh * CELL_SIZE + 2, placeColor, '6pt', { align: 'center' });
  }

  // ─── End Screen (C++ score.cpp:365-884 parity) ─────────

  /** C++ fixed-point 100*fixed(n,d) — score.cpp uses fixed.h/fixed.cpp
   *  fixed(n,d).Raw = (n*256)/d; 100*fixed = ((Raw*100)+128)/256 */
  private static fixedMul100(n: number, d: number): number {
    if (d === 0) return 0;
    const raw = Math.trunc((n * 256) / d);
    return Math.trunc(((raw * 100) + 128) / 256);
  }

  renderEndScreen(
    won: boolean,
    tick: number,
    pointTotal: number,
    survivingUnits: number,
    enemyCasualties: number,
    creditsRemaining: number,
    stolenCredits: number,
    harvestedCredits: number,
    initialCredits: number,
    alliedUnitsLost: number,
    sovietUnitsLost: number,
    alliedBuildingsLost: number,
    sovietBuildingsLost: number,
    playerSide: 'allied' | 'soviet',
    survivors: Array<{ type: string; name: string; hp: number; maxHp: number; kills: number }> = [],
  ): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    if (this.scoreAnimStartTime === 0) {
      this.scoreAnimStartTime = Date.now();
      this.scoreAnimActive = true;
    }
    const elapsed = (Date.now() - this.scoreAnimStartTime) / 1000;

    // === C++ Score Calculation (score.cpp:546-597) ===
    let uspoints = pointTotal;
    switch (this.difficulty) {
      case 'easy':   uspoints += 500;  break;
      case 'normal': uspoints += 1500; break;
      case 'hard':   uspoints += 3500; break;
    }

    let leadershipRaw = survivingUnits;
    if (!leadershipRaw) leadershipRaw = 1;
    const leadership = Math.min(150,
      Renderer.fixedMul100(leadershipRaw, enemyCasualties + leadershipRaw));

    const economy = Math.min(150,
      Renderer.fixedMul100(creditsRemaining + 1 + stolenCredits,
        harvestedCredits + initialCredits + 1));

    let total = Math.trunc((uspoints * leadership) / 100) + Math.trunc((uspoints * economy) / 100);
    if (total < -9999) total = -9999;
    total = Math.min(total, 99999);

    // === Time display (score.cpp:439, 1357-1370) ===
    const TIMER_MINUTE = 900;
    let displayMinutes = Math.trunc(tick / TIMER_MINUTE) + 1;
    if (Math.trunc(displayMinutes / 60) > 9) displayMinutes = 9 * 60 + 59;
    const timeHrs = Math.trunc(displayMinutes / 60);
    const timeMins = displayMinutes % 60;
    const timeStr = `${timeHrs}:${timeMins.toString().padStart(2, '0')}`;

    // === Animation phases ===
    const phase1Progress = Math.min(1, elapsed / 3.0);
    const phase2Progress = elapsed > 3.0 ? Math.min(1, (elapsed - 3.0) / 2.0) : 0;
    const phase3 = elapsed > 5.0;

    // === Background ===
    const isAllied = playerSide === 'allied';
    ctx.fillStyle = isAllied
      ? (won ? 'rgba(0,20,50,0.82)' : 'rgba(40,10,10,0.82)')
      : (won ? 'rgba(50,10,10,0.82)' : 'rgba(40,10,10,0.82)');
    ctx.fillRect(0, 0, w, h);

    // === Panel ===
    const panelW = 300;
    const survivorRows = won && survivors.length > 0 ? Math.ceil(new Set(survivors.map(s => s.type)).size / 3) + 2 : 0;
    const panelH = 340 + survivorRows * 12;
    const px = (w - panelW) / 2;
    const py = (h - panelH) / 2 - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = isAllied ? '#4466aa' : '#aa4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, panelW, panelH);

    // === Title ===
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = won ? '#44cc44' : '#cc4444';
    ctx.fillText(won ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED', w / 2, py + 22);

    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 10, py + 30);
    ctx.lineTo(px + panelW - 10, py + 30);
    ctx.stroke();

    // === Phase 1: Ratings ===
    const leftX = px + 16;
    const rightX = px + panelW - 16;
    let row = py + 48;
    const rowH = 18;

    const drawRow = (label: string, value: string, color = '#ccc') => {
      ctx.textAlign = 'left';
      ctx.font = '11px monospace';
      ctx.fillStyle = '#8a8';
      ctx.fillText(label, leftX, row);
      ctx.textAlign = 'right';
      ctx.fillStyle = color;
      ctx.fillText(value, rightX, row);
      row += rowH;
    };

    drawRow('TIME', timeStr, '#88cc88');

    const animLead = Math.floor(leadership * phase1Progress);
    drawRow('LEADERSHIP', `${animLead}%`, '#88cc88');

    const econDelay = Math.max(0, (phase1Progress - 0.23) / 0.77);
    const animEcon = Math.floor(economy * econDelay);
    drawRow('ECONOMY', `${animEcon}%`, '#88cc88');

    if (phase1Progress > 0.5) {
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#668';
      ctx.fillText(`x ${uspoints}`, rightX, row);
      row += 14;
    } else {
      row += 14;
    }

    ctx.strokeStyle = phase1Progress >= 0.85 ? '#88cc88' : '#333';
    ctx.beginPath();
    ctx.moveTo(px + panelW / 2, row - 8);
    ctx.lineTo(rightX, row - 8);
    ctx.stroke();

    if (phase1Progress >= 0.9) {
      const totalProgress = Math.min(1, (phase1Progress - 0.9) / 0.1);
      const animTotal = Math.floor(total * totalProgress);
      ctx.font = 'bold 13px monospace';
      drawRow('TOTAL', String(animTotal), '#FFD700');
    } else {
      row += rowH;
    }

    row += 6;

    // === Phase 2: Casualty Bar Graphs ===
    if (phase2Progress > 0) {
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#88cc88';
      ctx.fillText('CASUALTIES', w / 2, row);
      row += 14;

      const barW = panelW - 80;
      const barH = 10;
      const barX = px + 40;

      const drawBarPair = (alliedVal: number, sovietVal: number, label1: string, label2: string) => {
        const maxVal = Math.max(alliedVal, sovietVal, 1);
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#6688cc';
        ctx.fillText(label1, barX - 4, row + 8);
        ctx.fillStyle = '#223';
        ctx.fillRect(barX, row, barW, barH);
        ctx.fillStyle = '#4466aa';
        ctx.fillRect(barX, row, barW * (alliedVal / maxVal) * phase2Progress, barH);
        if (alliedVal > 0) {
          ctx.textAlign = 'left';
          ctx.fillStyle = '#aac';
          ctx.fillText(String(Math.floor(alliedVal * phase2Progress)), barX + barW + 4, row + 8);
        }
        row += barH + 3;
        ctx.textAlign = 'right';
        ctx.fillStyle = '#cc6666';
        ctx.fillText(label2, barX - 4, row + 8);
        ctx.fillStyle = '#322';
        ctx.fillRect(barX, row, barW, barH);
        ctx.fillStyle = '#aa4444';
        ctx.fillRect(barX, row, barW * (sovietVal / maxVal) * phase2Progress, barH);
        if (sovietVal > 0) {
          ctx.textAlign = 'left';
          ctx.fillStyle = '#caa';
          ctx.fillText(String(Math.floor(sovietVal * phase2Progress)), barX + barW + 4, row + 8);
        }
        row += barH + 8;
      };

      drawBarPair(alliedUnitsLost, sovietUnitsLost, 'ALLIES', 'SOVIET');

      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#88cc88';
      ctx.fillText('BUILDINGS DESTROYED', w / 2, row);
      row += 14;
      drawBarPair(alliedBuildingsLost, sovietBuildingsLost, 'ALLIES', 'SOVIET');
    }

    // === Phase 3: Survivors ===
    if (phase3 && won && survivors.length > 0) {
      row += 2;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8cf';
      ctx.fillText('SURVIVING FORCES', w / 2, row);
      row += 12;
      const typeCounts = new Map<string, { count: number; name: string; totalKills: number }>();
      for (const s of survivors) {
        const entry = typeCounts.get(s.type) ?? { count: 0, name: s.name, totalKills: 0 };
        entry.count++;
        entry.totalKills += s.kills;
        typeCounts.set(s.type, entry);
      }
      ctx.font = '9px monospace';
      let col = 0;
      for (const [, info] of typeCounts) {
        const tx = px + 16 + col * 95;
        if (tx + 80 > px + panelW) break;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#aaa';
        const killStr = info.totalKills > 0 ? ` (${info.totalKills}K)` : '';
        ctx.fillText(`${info.count}x ${info.name}${killStr}`, tx, row);
        col++;
        if (col >= 3) { col = 0; row += 11; }
      }
      if (col > 0) row += 11;
    }

    // === Prompt ===
    if (phase3 || elapsed > 4.0) {
      const blink = Math.floor(elapsed * 2) % 2 === 0;
      ctx.font = '11px monospace';
      ctx.fillStyle = blink ? '#cc8' : '#664';
      const promptY = Math.max(row + 16, py + panelH - 18);
      ctx.textAlign = 'center';
      ctx.fillText('Click to continue', w / 2, promptY);
    }

    ctx.textAlign = 'left';
  }

  // ─── Off-screen Unit Indicators ─────────────────────────

  private renderOffscreenIndicators(
    camera: Camera, entities: Entity[], selectedIds: Set<number>,
  ): void {
    if (selectedIds.size === 0) return;
    const ctx = this.ctx;
    const margin = 16;
    // Accumulate counts per edge
    let top = 0, bot = 0, left = 0, right = 0;
    let topX = 0, botX = 0, leftY = 0, rightY = 0;
    for (const e of entities) {
      if (!e.alive || !selectedIds.has(e.id)) continue;
      const s = camera.worldToScreen(e.pos.x, e.pos.y);
      if (s.x >= 0 && s.x <= this.width && s.y >= 0 && s.y <= this.height) continue;
      if (s.y < 0) { top++; topX += Math.max(margin, Math.min(this.width - margin, s.x)); }
      else if (s.y > this.height) { bot++; botX += Math.max(margin, Math.min(this.width - margin, s.x)); }
      else if (s.x < 0) { left++; leftY += Math.max(margin, Math.min(this.height - margin, s.y)); }
      else if (s.x > this.width) { right++; rightY += Math.max(margin, Math.min(this.height - margin, s.y)); }
    }

    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    const drawBadge = (x: number, y: number, count: number, arrowDx: number, arrowDy: number) => {
      // Arrow triangle
      const s = 5;
      ctx.fillStyle = 'rgba(100,255,100,0.7)';
      ctx.beginPath();
      ctx.moveTo(x + arrowDx * s * 2, y + arrowDy * s * 2);
      ctx.lineTo(x + arrowDy * s, y - arrowDx * s);
      ctx.lineTo(x - arrowDy * s, y + arrowDx * s);
      ctx.closePath();
      ctx.fill();
      // Count badge
      const tx = x - arrowDx * 8;
      const ty = y - arrowDy * 8 + 3;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(tx - 8, ty - 8, 16, 11);
      ctx.fillStyle = '#8f8';
      ctx.fillText(String(count), tx, ty);
    };

    if (top > 0) drawBadge(topX / top, margin, top, 0, -1);
    if (bot > 0) drawBadge(botX / bot, this.height - margin, bot, 0, 1);
    if (left > 0) drawBadge(margin, leftY / left, left, -1, 0);
    if (right > 0) drawBadge(this.width - margin, rightY / right, right, 1, 0);
    ctx.textAlign = 'left';
  }

}
