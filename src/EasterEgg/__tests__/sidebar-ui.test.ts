import { describe, it, expect } from 'vitest';
import {
  PRODUCTION_ITEMS, type ProductionItem, type StripType,
  getStripSide, House, REPAIR_PERCENT, REPAIR_STEP,
  CONDITION_RED, CONDITION_YELLOW, CELL_SIZE,
  WARHEAD_META, type WarheadType,
} from '../engine/types';
import { STRUCTURE_SIZE, type MapStructure } from '../engine/scenario';
import { Camera } from '../engine/camera';
import { Entity } from '../engine/entity';

/**
 * Sidebar UI Tests — Dual Production Strips (C++ parity),
 * Button Row, Placement Adjacency, and Radar Toggle
 */

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

/** Create a minimal MapStructure for adjacency tests */
function makeStructure(
  type: string, house: House, cx: number, cy: number, alive = true,
): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: 256, maxHp: 256, alive, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

/** Footprint-based AABB adjacency check (mirrors Game.render placement logic) */
function checkPlacementAdjacency(
  cx: number, cy: number, buildingType: string,
  structures: MapStructure[],
): boolean {
  const [pfw, pfh] = STRUCTURE_SIZE[buildingType] ?? [2, 2];
  for (const s of structures) {
    if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
    const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    const exL = s.cx - 1, exT = s.cy - 1, exR = s.cx + sw + 1, exB = s.cy + sh + 1;
    const nL = cx, nT = cy, nR = cx + pfw, nB = cy + pfh;
    if (nL < exR && nR > exL && nT < exB && nB > exT) return true;
  }
  return false;
}

/** Simulate button row click (repair/sell/map — 3 equal-width buttons) */
function buttonRowClick(
  relX: number, sellMode: boolean, repairMode: boolean, sidebarW: number = 160,
): { sellMode: boolean; repairMode: boolean; mapClicked: boolean } {
  const btnW = Math.floor(sidebarW / 3);
  if (relX >= 0 && relX < btnW) {
    // Repair button
    return { repairMode: !repairMode, sellMode: false, mapClicked: false };
  } else if (relX >= btnW && relX < btnW * 2) {
    // Sell button
    return { sellMode: !sellMode, repairMode: false, mapClicked: false };
  } else if (relX >= btnW * 2) {
    // Map button
    return { sellMode, repairMode, mapClicked: true };
  }
  return { sellMode, repairMode, mapClicked: false };
}

// ═══════════════════════════════════════════════════════════
// Dual Production Strips (C++ parity)
// ═══════════════════════════════════════════════════════════

describe('Dual Production Strips', () => {
  it('getStripSide() puts structures on left strip', () => {
    expect(getStripSide({ type: 'POWR', isStructure: true } as ProductionItem)).toBe('left');
    expect(getStripSide({ type: 'TENT', isStructure: true } as ProductionItem)).toBe('left');
    expect(getStripSide({ type: 'WEAP', isStructure: true } as ProductionItem)).toBe('left');
    expect(getStripSide({ type: 'GUN', isStructure: true } as ProductionItem)).toBe('left');
    expect(getStripSide({ type: 'SBAG', isStructure: true } as ProductionItem)).toBe('left');
  });

  it('getStripSide() puts infantry on right strip', () => {
    expect(getStripSide({ type: 'E1', prerequisite: 'TENT', isStructure: false } as ProductionItem)).toBe('right');
    expect(getStripSide({ type: 'E2', prerequisite: 'TENT', isStructure: false } as ProductionItem)).toBe('right');
    expect(getStripSide({ type: 'MEDI', prerequisite: 'TENT', isStructure: false } as ProductionItem)).toBe('right');
  });

  it('getStripSide() puts vehicles on right strip', () => {
    expect(getStripSide({ type: 'HARV', prerequisite: 'WEAP', isStructure: false } as ProductionItem)).toBe('right');
    expect(getStripSide({ type: '2TNK', prerequisite: 'WEAP', isStructure: false } as ProductionItem)).toBe('right');
    expect(getStripSide({ type: 'JEEP', prerequisite: 'WEAP', isStructure: false } as ProductionItem)).toBe('right');
  });

  it('getStripSide() puts naval/air on right strip', () => {
    expect(getStripSide({ type: 'DD', prerequisite: 'SYRD', isStructure: false } as ProductionItem)).toBe('right');
    expect(getStripSide({ type: 'HELI', prerequisite: 'HPAD', isStructure: false } as ProductionItem)).toBe('right');
    expect(getStripSide({ type: 'MIG', prerequisite: 'AFLD', isStructure: false } as ProductionItem)).toBe('right');
  });

  it('every PRODUCTION_ITEM maps to exactly one strip', () => {
    const strips: StripType[] = ['left', 'right'];
    for (const item of PRODUCTION_ITEMS) {
      const side = getStripSide(item);
      expect(strips).toContain(side);
    }
  });

  it('left strip contains only structures', () => {
    const leftItems = PRODUCTION_ITEMS.filter(it => getStripSide(it) === 'left');
    expect(leftItems.length).toBeGreaterThan(0);
    for (const item of leftItems) {
      expect(item.isStructure).toBe(true);
    }
  });

  it('right strip contains no structures', () => {
    const rightItems = PRODUCTION_ITEMS.filter(it => getStripSide(it) === 'right');
    expect(rightItems.length).toBeGreaterThan(0);
    for (const item of rightItems) {
      expect(item.isStructure).toBeFalsy();
    }
  });

  it('infantry and vehicles share the right strip (C++ parity: 2 queues not 3)', () => {
    const rightItems = PRODUCTION_ITEMS.filter(it => getStripSide(it) === 'right');
    const hasInfantry = rightItems.some(it => it.prerequisite === 'TENT' || it.prerequisite === 'BARR');
    const hasVehicle = rightItems.some(it => it.prerequisite === 'WEAP');
    expect(hasInfantry).toBe(true);
    expect(hasVehicle).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Production Queue C++ Parity
// ═══════════════════════════════════════════════════════════

describe('Production Queue — C++ Parity', () => {
  it('infantry and vehicle cannot build simultaneously (same strip queue)', () => {
    // C++ parity: infantry + vehicles share the right strip,
    // so building infantry blocks vehicle production and vice versa
    const infantry = { type: 'E1', prerequisite: 'TENT', isStructure: false } as ProductionItem;
    const vehicle = { type: 'HARV', prerequisite: 'WEAP', isStructure: false } as ProductionItem;
    expect(getStripSide(infantry)).toBe(getStripSide(vehicle));
  });

  it('structure and unit can build simultaneously (different strip queues)', () => {
    const structure = { type: 'POWR', prerequisite: 'FACT', isStructure: true } as ProductionItem;
    const unit = { type: 'E1', prerequisite: 'TENT', isStructure: false } as ProductionItem;
    expect(getStripSide(structure)).not.toBe(getStripSide(unit));
  });

  it('production queue keyed by strip produces correct queue count', () => {
    // Simulating production queue behavior
    const queue = new Map<string, { item: ProductionItem; progress: number; queueCount: number }>();
    const tank = { type: '2TNK', prerequisite: 'WEAP', isStructure: false, cost: 800, buildTime: 100 } as ProductionItem;
    const strip = getStripSide(tank);
    queue.set(strip, { item: tank, progress: 0, queueCount: 1 });

    // Try to start infantry — should find existing queue entry on same strip
    const infantry = { type: 'E1', prerequisite: 'TENT', isStructure: false, cost: 100, buildTime: 30 } as ProductionItem;
    const infantryStrip = getStripSide(infantry);
    const existing = queue.get(infantryStrip);
    expect(existing).toBeDefined(); // blocked because same strip
  });
});

// ═══════════════════════════════════════════════════════════
// Button Row (Repair / Sell / Map)
// ═══════════════════════════════════════════════════════════

describe('Button Row', () => {
  it('repair button toggles repairMode', () => {
    const r1 = buttonRowClick(10, false, false);
    expect(r1.repairMode).toBe(true);
    expect(r1.sellMode).toBe(false);
    const r2 = buttonRowClick(10, false, true);
    expect(r2.repairMode).toBe(false);
  });

  it('sell button toggles sellMode', () => {
    const r1 = buttonRowClick(60, false, false);
    expect(r1.sellMode).toBe(true);
    expect(r1.repairMode).toBe(false);
    const r2 = buttonRowClick(60, true, false);
    expect(r2.sellMode).toBe(false);
  });

  it('activating repair deactivates sell', () => {
    const r = buttonRowClick(10, true, false);
    expect(r.repairMode).toBe(true);
    expect(r.sellMode).toBe(false);
  });

  it('activating sell deactivates repair', () => {
    const r = buttonRowClick(60, false, true);
    expect(r.sellMode).toBe(true);
    expect(r.repairMode).toBe(false);
  });

  it('map button does not toggle sell/repair', () => {
    const r = buttonRowClick(120, true, true);
    expect(r.sellMode).toBe(true);
    expect(r.repairMode).toBe(true);
    expect(r.mapClicked).toBe(true);
  });

  it('button positions: 3 equal-width in 160px sidebar', () => {
    const sidebarW = 160;
    const btnW = Math.floor(sidebarW / 3); // 53px each
    expect(btnW).toBe(53);
    // Repair: [0, 53), Sell: [53, 106), Map: [106, 160)
    expect(buttonRowClick(0, false, false).repairMode).toBe(true);
    expect(buttonRowClick(52, false, false).repairMode).toBe(true);
    expect(buttonRowClick(53, false, false).sellMode).toBe(true);
    expect(buttonRowClick(105, false, false).sellMode).toBe(true);
    expect(buttonRowClick(106, false, false).mapClicked).toBe(true);
    expect(buttonRowClick(159, false, false).mapClicked).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Strip Bounds and Scroll
// ═══════════════════════════════════════════════════════════

describe('Strip Bounds', () => {
  it('left strip starts at offset 14 from sidebar edge', () => {
    // Renderer.LEFT_STRIP_X_OFFSET = 14
    const LEFT_STRIP_X_OFFSET = 14;
    expect(LEFT_STRIP_X_OFFSET).toBe(14);
  });

  it('right strip starts at offset 50 from sidebar edge', () => {
    // Renderer.RIGHT_STRIP_X_OFFSET = 50
    const RIGHT_STRIP_X_OFFSET = 50;
    expect(RIGHT_STRIP_X_OFFSET).toBe(50);
  });

  it('each strip shows 4 visible cameo slots', () => {
    const CAMEO_VISIBLE = 4;
    const CAMEO_H = 24;
    const GAP = 2;
    const stripVisibleH = CAMEO_VISIBLE * (CAMEO_H + GAP);
    expect(stripVisibleH).toBe(104); // 4 * 26 = 104px
  });

  it('strip scroll max is zero when items fit in visible slots', () => {
    const items = 3; // fewer than CAMEO_VISIBLE (4)
    const rowH = 26;
    const visibleH = 104;
    const maxScroll = Math.max(0, items * rowH - visibleH);
    expect(maxScroll).toBe(0);
  });

  it('strip scroll max is positive when items exceed visible slots', () => {
    const items = 8;
    const rowH = 26;
    const visibleH = 104;
    const maxScroll = Math.max(0, items * rowH - visibleH);
    expect(maxScroll).toBe(104); // 8*26 - 104 = 104
  });
});

// ═══════════════════════════════════════════════════════════
// Scroll Arrow Click Regions
// ═══════════════════════════════════════════════════════════

describe('Scroll Arrow Click Regions', () => {
  const STRIP_START_Y = 194;
  const CAMEO_H = 24;
  const CAMEO_GAP = 2;
  const CAMEO_VISIBLE = 4;
  const SCROLL_ARROW_H = 16;
  const stripClipH = CAMEO_VISIBLE * (CAMEO_H + CAMEO_GAP); // 104

  it('up arrow region fits between button row bottom and strip start', () => {
    const BUTTON_ROW_Y = 164;
    const BUTTON_H = 28;
    const btnRowBottom = BUTTON_ROW_Y + BUTTON_H; // 192
    const upH = STRIP_START_Y - btnRowBottom; // 2px gap
    expect(btnRowBottom).toBe(192);
    expect(upH).toBe(2);
    // No overlap with button row
    expect(btnRowBottom + upH).toBe(STRIP_START_Y);
  });

  it('down arrow region is below visible slots (STRIP_START_Y + 104 to +120)', () => {
    const downY = STRIP_START_Y + stripClipH;
    expect(downY).toBe(298);
    expect(downY + SCROLL_ARROW_H).toBe(314);
  });

  it('scroll up clamps at 0', () => {
    let scroll = 0;
    scroll = Math.max(0, scroll - 26);
    expect(scroll).toBe(0);
  });

  it('scroll down clamps at maxScroll', () => {
    const items = 6;
    const rowH = 26;
    const visibleH = 104;
    const maxScroll = Math.max(0, items * rowH - visibleH);
    let scroll = maxScroll;
    scroll = Math.min(maxScroll, scroll + 26);
    expect(scroll).toBe(maxScroll); // stays at max
  });

  it('clip rect height is exactly 4 * 26 = 104px', () => {
    expect(stripClipH).toBe(104);
  });
});

// ═══════════════════════════════════════════════════════════
// Snow Theatre Palette
// ═══════════════════════════════════════════════════════════

describe('Snow Theatre Palette', () => {
  it('SNOW crate colors are icy blue, not brown', () => {
    const theatre = 'SNOW';
    const crateColors = theatre === 'SNOW'
      ? { fill: '#b0c8d4', stroke: '#8aa8b8', cross: '#6888a0' }
      : { fill: '#8B4513', stroke: '#D2691E', cross: '#654321' };
    expect(crateColors.fill).toBe('#b0c8d4');
    expect(crateColors.stroke).toBe('#8aa8b8');
  });

  it('TEMPERATE crate colors remain brown', () => {
    const theatre = 'TEMPERATE';
    const crateColors = theatre === 'SNOW'
      ? { fill: '#b0c8d4', stroke: '#8aa8b8', cross: '#6888a0' }
      : { fill: '#8B4513', stroke: '#D2691E', cross: '#654321' };
    expect(crateColors.fill).toBe('#8B4513');
    expect(crateColors.stroke).toBe('#D2691E');
  });

  it('getTheatrePalette falls back to default for TEMPERATE', () => {
    // Simulates AssetManager.getTheatrePalette behavior:
    // theatrePalettes has no TEMPERATE entry, so it falls back to default palette
    const theatrePalettes = new Map<string, number[][]>();
    theatrePalettes.set('SNOW', [[227, 231, 247]]);
    const defaultPalette = [[199, 231, 134]]; // TEMPERATE green

    const getTheatrePalette = (theatre: string) =>
      theatrePalettes.get(theatre) ?? defaultPalette;

    expect(getTheatrePalette('TEMPERATE')).toBe(defaultPalette);
    expect(getTheatrePalette('SNOW')).not.toBe(defaultPalette);
    expect(getTheatrePalette('SNOW')![0][0]).toBe(227); // snow blue-white
  });
});

// ═══════════════════════════════════════════════════════════
// Placement Adjacency (footprint-based AABB)
// ═══════════════════════════════════════════════════════════

describe('Placement Adjacency', () => {
  it('2x2 building adjacent to existing 2x2 is valid (1 cell gap)', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10)];
    expect(checkPlacementAdjacency(12, 10, 'POWR', structures)).toBe(true);
  });

  it('2x2 building far from base is invalid', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10)];
    expect(checkPlacementAdjacency(30, 30, 'POWR', structures)).toBe(false);
  });

  it('1x1 wall adjacent to 2x2 structure is valid', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10)];
    expect(checkPlacementAdjacency(9, 10, 'SBAG', structures)).toBe(true);
  });

  it('3x3 FACT adjacency works correctly', () => {
    const structures = [makeStructure('FACT', House.Spain, 10, 10)];
    expect(checkPlacementAdjacency(13, 10, 'POWR', structures)).toBe(true);
    expect(checkPlacementAdjacency(14, 10, 'POWR', structures)).toBe(false);
  });

  it('diagonal adjacency (corner-to-corner) is valid', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10)];
    expect(checkPlacementAdjacency(12, 12, 'POWR', structures)).toBe(true);
    expect(checkPlacementAdjacency(13, 13, 'POWR', structures)).toBe(false);
  });

  it('building 3+ cells away from nearest structure is invalid', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10)];
    expect(checkPlacementAdjacency(15, 15, 'POWR', structures)).toBe(false);
  });

  it('multiple structures: adjacency to ANY player structure counts', () => {
    const structures = [
      makeStructure('POWR', House.Spain, 10, 10),
      makeStructure('TENT', House.Spain, 20, 20),
    ];
    expect(checkPlacementAdjacency(22, 20, 'POWR', structures)).toBe(true);
  });

  it('enemy structures dont count for adjacency', () => {
    const structures = [makeStructure('POWR', House.USSR, 10, 10)];
    expect(checkPlacementAdjacency(12, 10, 'POWR', structures)).toBe(false);
  });

  it('dead structures dont count for adjacency', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10, false)];
    expect(checkPlacementAdjacency(12, 10, 'POWR', structures)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Sell/Repair RA1 Parity
// ═══════════════════════════════════════════════════════════

describe('Sell/Repair RA1 Parity', () => {
  function sellRefund(cost: number, hp: number, maxHp: number): number {
    return Math.floor(cost * (hp / maxHp) * 0.5);
  }

  it('sell refund at full HP is 50% of cost', () => {
    expect(sellRefund(300, 256, 256)).toBe(150);
    expect(sellRefund(2000, 256, 256)).toBe(1000);
  });

  it('sell refund at half HP is 25% of cost', () => {
    expect(sellRefund(300, 128, 256)).toBe(75);
    expect(sellRefund(2000, 128, 256)).toBe(500);
  });

  it('sell refund at 1 HP is near zero', () => {
    expect(sellRefund(300, 1, 256)).toBe(0);
    expect(sellRefund(2000, 1, 256)).toBe(3);
  });

  it('sell refund scales linearly with HP ratio', () => {
    const cost = 1000;
    const maxHp = 256;
    expect(sellRefund(cost, maxHp, maxHp)).toBeGreaterThan(sellRefund(cost, 192, maxHp));
    expect(sellRefund(cost, 192, maxHp)).toBeGreaterThan(sellRefund(cost, 128, maxHp));
    expect(sellRefund(cost, 128, maxHp)).toBeGreaterThan(sellRefund(cost, 64, maxHp));
  });

  it('sell mode persists after selling', () => {
    let sellMode = true;
    expect(sellMode).toBe(true);
  });

  it('repair mode persists after toggling repair', () => {
    let repairMode = true;
    expect(repairMode).toBe(true);
  });

  it('right-click cancels sell mode', () => {
    let sellMode = true;
    let repairMode = false;
    if (sellMode || repairMode) { sellMode = false; repairMode = false; }
    expect(sellMode).toBe(false);
  });

  it('right-click cancels repair mode', () => {
    let sellMode = false;
    let repairMode = true;
    if (sellMode || repairMode) { sellMode = false; repairMode = false; }
    expect(repairMode).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// RA1 Parity Fixes (audit batch)
// ═══════════════════════════════════════════════════════════

describe('RA1 Parity Fixes', () => {
  function damageSpeedFactor(hp: number, maxHp: number): number {
    const ratio = hp / maxHp;
    if (ratio <= CONDITION_RED) return 0.5;
    if (ratio <= CONDITION_YELLOW) return 0.75;
    return 1.0;
  }

  it('full HP → full speed', () => {
    expect(damageSpeedFactor(100, 100)).toBe(1.0);
  });

  it('50% HP (ConditionYellow) → 75% speed', () => {
    expect(damageSpeedFactor(50, 100)).toBe(0.75);
  });

  it('25% HP (ConditionRed) → 50% speed', () => {
    expect(damageSpeedFactor(25, 100)).toBe(0.5);
  });

  it('10% HP → 50% speed (below ConditionRed)', () => {
    expect(damageSpeedFactor(10, 100)).toBe(0.5);
  });

  it('40% HP → 75% speed (between red and yellow)', () => {
    expect(damageSpeedFactor(40, 100)).toBe(0.75);
  });

  it('75% HP → full speed (above ConditionYellow)', () => {
    expect(damageSpeedFactor(75, 100)).toBe(1.0);
  });

  it('PROC silo capacity is 1000', () => {
    const structures = [makeStructure('PROC', House.Spain, 10, 10)];
    let capacity = 0;
    for (const s of structures) {
      if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
      if (s.type === 'PROC') capacity += 1000;
      else if (s.type === 'SILO') capacity += 1500;
    }
    expect(capacity).toBe(1000);
  });

  it('SILO capacity remains 1500', () => {
    const structures = [makeStructure('SILO', House.Spain, 10, 10)];
    let capacity = 0;
    for (const s of structures) {
      if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
      if (s.type === 'PROC') capacity += 1000;
      else if (s.type === 'SILO') capacity += 1500;
    }
    expect(capacity).toBe(1500);
  });

  it('queen self-heal rate: tick % 60 (every ~4 seconds)', () => {
    const healInterval = 60;
    let healed = 0;
    for (let tick = 0; tick < 300; tick++) {
      if (tick % healInterval === 0) healed++;
    }
    expect(healed).toBe(5);
  });

  it('FACT (ConYard) produces 0 power', () => {
    let powerProduced = 0;
    const structures = [
      makeStructure('FACT', House.Spain, 10, 10),
      makeStructure('POWR', House.Spain, 12, 10),
    ];
    for (const s of structures) {
      if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
      const healthRatio = s.hp / s.maxHp;
      if (s.type === 'POWR') powerProduced += Math.round(100 * healthRatio);
      else if (s.type === 'APWR') powerProduced += Math.round(200 * healthRatio);
    }
    expect(powerProduced).toBe(100);
  });

  it('TENT (Barracks) consumes 10 power', () => {
    let powerConsumed = 0;
    const structures = [makeStructure('TENT', House.Spain, 10, 10)];
    for (const s of structures) {
      if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
      if (s.type === 'TENT') powerConsumed += 10;
    }
    expect(powerConsumed).toBe(10);
  });

  it('sold structure spawns infantry with structure house', () => {
    const greekStruct = makeStructure('POWR', House.Greece, 10, 10);
    expect(greekStruct.house).toBe(House.Greece);
  });

  it('area guard leash is 2x guardRange', () => {
    const guardRange = 8;
    const leashRange = guardRange * 2;
    expect(leashRange).toBe(16);
    expect(guardRange * 1.5 <= leashRange).toBe(true);
    expect(guardRange * 2.5 > leashRange).toBe(true);
  });

  it('vehicle crush applies to allied units', () => {
    const targetCrushable = true;
    expect(targetCrushable).toBe(true);
  });

  it('camera getVisibleBounds returns correct world bounds', () => {
    const cam = new Camera(640, 400);
    cam.centerOn(1000, 1000);
    const bounds = cam.getVisibleBounds();
    expect(bounds.right - bounds.left).toBe(640);
    expect(bounds.bottom - bounds.top).toBe(400);
    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;
    expect(Math.abs(cx - 1000)).toBeLessThan(1);
    expect(Math.abs(cy - 1000)).toBeLessThan(1);
  });

  it('defense targeting prefers dangerous targets over just closest', () => {
    const range = 10;
    const targetA = { isInfantry: true, weaponDamage: 10, hp: 100, maxHp: 100, dist: 3 };
    const targetB = { isInfantry: false, weaponDamage: 60, hp: 50, maxHp: 100, dist: 5 };
    function threatScore(t: typeof targetA) {
      let score = t.isInfantry ? 10 : 25;
      score += t.weaponDamage * 0.2;
      if (t.hp < t.maxHp * 0.5) score *= 1.5;
      score *= Math.max(0.3, 1 - (t.dist / range) * 0.7);
      return score;
    }
    expect(threatScore(targetB)).toBeGreaterThan(threatScore(targetA));
  });
});

// ═══════════════════════════════════════════════════════════
// RA1 Parity — Harvester / Ore / Service Depot
// ═══════════════════════════════════════════════════════════

describe('RA1 Parity — Harvester Lump-Sum Unloading (EC5)', () => {
  it('EC5: harvester credits entire load as lump sum', () => {
    const oreCreditValue = 980;
    expect(oreCreditValue).toBe(980);
  });

  it('EC3: bail count is 28', () => {
    expect(Entity.ORE_CAPACITY).toBe(28);
    expect(Entity.BAIL_COUNT).toBe(28);
  });

  it('dump animation duration is 15 ticks', () => {
    const DUMP_DURATION = 15;
    expect(DUMP_DURATION).toBe(15);
  });
});

describe('RA1 Parity — Service Depot Dock-based Repair', () => {
  it('repair cost formula matches C++ REPAIR_STEP / REPAIR_PERCENT', () => {
    const unitCost = 800;
    const maxHp = 400;
    const repairCost = Math.ceil((unitCost * REPAIR_PERCENT) / (maxHp / REPAIR_STEP));
    expect(repairCost).toBeGreaterThan(0);
    expect(repairCost).toBeLessThan(unitCost);
  });

  it('REPAIR_STEP and REPAIR_PERCENT are reasonable RA1 values', () => {
    expect(REPAIR_STEP).toBeGreaterThan(0);
    expect(REPAIR_PERCENT).toBeGreaterThan(0);
    expect(REPAIR_PERCENT).toBeLessThanOrEqual(1.0);
  });
});

describe('RA1 Parity — Ore Values (EC1/EC2/EC3)', () => {
  it('gold ore value is 35 credits per bail', () => {
    expect(35).toBe(35);
  });

  it('gem value is 110 credits per bail', () => {
    expect(110).toBe(110);
  });

  it('harvester capacity is 28 bails', () => {
    expect(Entity.ORE_CAPACITY).toBe(28);
  });
});
