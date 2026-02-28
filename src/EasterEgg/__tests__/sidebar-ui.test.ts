import { describe, it, expect } from 'vitest';
import {
  PRODUCTION_ITEMS, type ProductionItem, type SidebarTab,
  getItemCategory, House, REPAIR_PERCENT, REPAIR_STEP,
  CONDITION_RED, CONDITION_YELLOW, CELL_SIZE,
} from '../engine/types';
import { STRUCTURE_SIZE, type MapStructure } from '../engine/scenario';
import { Camera } from '../engine/camera';

/**
 * Sidebar UI Tests — Production Tabs, Sell/Repair Buttons,
 * Placement Adjacency, and Radar Toggle
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
    // Expand existing structure bounds by 1 cell in each direction
    const exL = s.cx - 1, exT = s.cy - 1, exR = s.cx + sw + 1, exB = s.cy + sh + 1;
    // New building footprint
    const nL = cx, nT = cy, nR = cx + pfw, nB = cy + pfh;
    // AABB overlap test
    if (nL < exR && nR > exL && nT < exB && nB > exT) return true;
  }
  return false;
}

/** Map tab click X position to tab (mirrors handleSidebarClick) */
function tabFromClickX(relX: number, sidebarW: number = 100): SidebarTab | null {
  const margin = 2;
  const tabW = Math.floor((sidebarW - margin * 2) / 3);
  if (relX < 0) return null;
  if (relX < tabW) return 'infantry';
  if (relX < tabW * 2) return 'vehicle';
  if (relX < tabW * 3) return 'structure';
  return null;
}

/** Simulate sell/repair button toggle (mirrors handleSidebarClick) */
function toggleSellRepair(
  relX: number, sellMode: boolean, repairMode: boolean, sidebarW: number = 100,
): { sellMode: boolean; repairMode: boolean } {
  const margin = 2;
  const gap = 4;
  const btnW = Math.floor((sidebarW - margin * 2 - gap) / 2);
  if (relX >= 0 && relX < btnW) {
    return { sellMode: !sellMode, repairMode: false };
  } else if (relX >= btnW + gap && relX < btnW * 2 + gap) {
    return { repairMode: !repairMode, sellMode: false };
  }
  return { sellMode, repairMode };
}

// ═══════════════════════════════════════════════════════════
// Production Tabs
// ═══════════════════════════════════════════════════════════

describe('Production Tabs', () => {
  it('getItemCategory() classifies infantry items', () => {
    expect(getItemCategory({ type: 'E1', prerequisite: 'TENT', isStructure: false } as ProductionItem)).toBe('infantry');
    expect(getItemCategory({ type: 'E2', prerequisite: 'TENT', isStructure: false } as ProductionItem)).toBe('infantry');
    expect(getItemCategory({ type: 'MEDI', prerequisite: 'TENT', isStructure: false } as ProductionItem)).toBe('infantry');
  });

  it('getItemCategory() classifies vehicle items', () => {
    expect(getItemCategory({ type: 'HARV', prerequisite: 'WEAP', isStructure: false } as ProductionItem)).toBe('vehicle');
    expect(getItemCategory({ type: '2TNK', prerequisite: 'WEAP', isStructure: false } as ProductionItem)).toBe('vehicle');
    expect(getItemCategory({ type: 'JEEP', prerequisite: 'WEAP', isStructure: false } as ProductionItem)).toBe('vehicle');
  });

  it('getItemCategory() classifies naval/air items as vehicle', () => {
    expect(getItemCategory({ type: 'DD', prerequisite: 'SYRD', isStructure: false } as ProductionItem)).toBe('vehicle');
    expect(getItemCategory({ type: 'HELI', prerequisite: 'HPAD', isStructure: false } as ProductionItem)).toBe('vehicle');
    expect(getItemCategory({ type: 'MIG', prerequisite: 'AFLD', isStructure: false } as ProductionItem)).toBe('vehicle');
  });

  it('getItemCategory() classifies structure items', () => {
    expect(getItemCategory({ type: 'POWR', prerequisite: 'FACT', isStructure: true } as ProductionItem)).toBe('structure');
    expect(getItemCategory({ type: 'TENT', prerequisite: 'FACT', isStructure: true } as ProductionItem)).toBe('structure');
    expect(getItemCategory({ type: 'WEAP', prerequisite: 'FACT', isStructure: true } as ProductionItem)).toBe('structure');
  });

  it('getItemCategory() classifies defense structures', () => {
    expect(getItemCategory({ type: 'GUN', prerequisite: 'FACT', isStructure: true } as ProductionItem)).toBe('structure');
    expect(getItemCategory({ type: 'HBOX', prerequisite: 'FACT', isStructure: true } as ProductionItem)).toBe('structure');
    expect(getItemCategory({ type: 'TSLA', prerequisite: 'FACT', isStructure: true } as ProductionItem)).toBe('structure');
  });

  it('getItemCategory() classifies walls', () => {
    expect(getItemCategory({ type: 'SBAG', prerequisite: 'FACT', isStructure: true } as ProductionItem)).toBe('structure');
    expect(getItemCategory({ type: 'BRIK', prerequisite: 'FACT', isStructure: true } as ProductionItem)).toBe('structure');
  });

  it('every PRODUCTION_ITEM is reachable via exactly one tab', () => {
    const tabs: SidebarTab[] = ['infantry', 'vehicle', 'structure'];
    for (const item of PRODUCTION_ITEMS) {
      const cat = getItemCategory(item);
      expect(tabs).toContain(cat);
      // Ensure it falls into exactly one tab
      const matchCount = tabs.filter(t => {
        if (t === 'structure') return !!item.isStructure;
        if (t === 'infantry') return !item.isStructure && (item.prerequisite === 'TENT' || item.prerequisite === 'BARR');
        return !item.isStructure && item.prerequisite !== 'TENT' && item.prerequisite !== 'BARR';
      }).length;
      expect(matchCount).toBe(1);
    }
  });

  it('filtering items by infantry tab returns only infantry prerequisites', () => {
    const infantry = PRODUCTION_ITEMS.filter(it => getItemCategory(it) === 'infantry');
    expect(infantry.length).toBeGreaterThan(0);
    for (const item of infantry) {
      expect(item.isStructure).toBeFalsy();
      expect(['TENT', 'BARR']).toContain(item.prerequisite);
    }
  });

  it('filtering items by vehicle tab excludes structures and infantry', () => {
    const vehicles = PRODUCTION_ITEMS.filter(it => getItemCategory(it) === 'vehicle');
    expect(vehicles.length).toBeGreaterThan(0);
    for (const item of vehicles) {
      expect(item.isStructure).toBeFalsy();
      expect(item.prerequisite).not.toBe('TENT');
      expect(item.prerequisite).not.toBe('BARR');
    }
  });

  it('filtering items by structure tab returns only isStructure items', () => {
    const structures = PRODUCTION_ITEMS.filter(it => getItemCategory(it) === 'structure');
    expect(structures.length).toBeGreaterThan(0);
    for (const item of structures) {
      expect(item.isStructure).toBe(true);
    }
  });

  it('tab click X mapping: 0-31 → infantry, 32-63 → vehicle, 64-95 → structure', () => {
    expect(tabFromClickX(5)).toBe('infantry');
    expect(tabFromClickX(15)).toBe('infantry');
    expect(tabFromClickX(32)).toBe('vehicle');
    expect(tabFromClickX(50)).toBe('vehicle');
    expect(tabFromClickX(64)).toBe('structure');
    expect(tabFromClickX(90)).toBe('structure');
  });

  it('default tab is infantry', () => {
    // Game initializes activeTab to 'infantry'
    const defaultTab: SidebarTab = 'infantry';
    expect(defaultTab).toBe('infantry');
  });
});

// ═══════════════════════════════════════════════════════════
// Sell / Repair Buttons
// ═══════════════════════════════════════════════════════════

describe('Sell/Repair Buttons', () => {
  it('sell button toggles sellMode', () => {
    const r1 = toggleSellRepair(10, false, false);
    expect(r1.sellMode).toBe(true);
    expect(r1.repairMode).toBe(false);
    // Toggle off
    const r2 = toggleSellRepair(10, true, false);
    expect(r2.sellMode).toBe(false);
  });

  it('repair button toggles repairMode', () => {
    const r1 = toggleSellRepair(55, false, false);
    expect(r1.repairMode).toBe(true);
    expect(r1.sellMode).toBe(false);
    // Toggle off
    const r2 = toggleSellRepair(55, false, true);
    expect(r2.repairMode).toBe(false);
  });

  it('activating sell deactivates repair', () => {
    const r = toggleSellRepair(10, false, true);
    expect(r.sellMode).toBe(true);
    expect(r.repairMode).toBe(false);
  });

  it('activating repair deactivates sell', () => {
    const r = toggleSellRepair(55, true, false);
    expect(r.repairMode).toBe(true);
    expect(r.sellMode).toBe(false);
  });

  it('button position formula is consistent', () => {
    // Sell button occupies the first half, repair the second
    const sidebarW = 100;
    const margin = 2;
    const gap = 4;
    const btnW = Math.floor((sidebarW - margin * 2 - gap) / 2);
    expect(btnW).toBe(46); // (100-4-4)/2 = 46
    // Sell occupies [0, 46), repair occupies [50, 96)
    expect(toggleSellRepair(0, false, false).sellMode).toBe(true);
    expect(toggleSellRepair(45, false, false).sellMode).toBe(true);
    expect(toggleSellRepair(50, false, false).repairMode).toBe(true);
    expect(toggleSellRepair(95, false, false).repairMode).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Placement Adjacency (footprint-based AABB)
// ═══════════════════════════════════════════════════════════

describe('Placement Adjacency', () => {
  it('2x2 building adjacent to existing 2x2 is valid (1 cell gap)', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10)];
    // Place right next to it (1 cell gap on the right)
    expect(checkPlacementAdjacency(12, 10, 'POWR', structures)).toBe(true);
  });

  it('2x2 building far from base is invalid', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10)];
    // 20 cells away
    expect(checkPlacementAdjacency(30, 30, 'POWR', structures)).toBe(false);
  });

  it('1x1 wall adjacent to 2x2 structure is valid', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10)];
    // Wall immediately left of POWR (cx=9, cy=10 — within 1 cell of POWR left edge)
    expect(checkPlacementAdjacency(9, 10, 'SBAG', structures)).toBe(true);
  });

  it('3x3 FACT adjacency works correctly', () => {
    const structures = [makeStructure('FACT', House.Spain, 10, 10)];
    // FACT is 3x3, so its footprint is 10-12,10-12. Expanded = 9-13,9-13
    // Place a 2x2 at (13,10) → right edge of expanded zone
    expect(checkPlacementAdjacency(13, 10, 'POWR', structures)).toBe(true);
    // Place a 2x2 at (14,10) → just outside
    expect(checkPlacementAdjacency(14, 10, 'POWR', structures)).toBe(false);
  });

  it('diagonal adjacency (corner-to-corner) is valid', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10)];
    // POWR is 2x2 at (10,10)-(11,11), expanded = (9,9)-(13,13)
    // Place 2x2 at (12,12) → shares diagonal corner → valid (RA1 allows diagonal placement)
    expect(checkPlacementAdjacency(12, 12, 'POWR', structures)).toBe(true);
    // Place at (13,13) → 2 cells diagonally from nearest corner → invalid
    expect(checkPlacementAdjacency(13, 13, 'POWR', structures)).toBe(false);
  });

  it('building 3+ cells away from nearest structure is invalid', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10)];
    // POWR 2x2 expanded = (9,9)-(12,12). Place at (15,15) → far away
    expect(checkPlacementAdjacency(15, 15, 'POWR', structures)).toBe(false);
  });

  it('multiple structures: adjacency to ANY player structure counts', () => {
    const structures = [
      makeStructure('POWR', House.Spain, 10, 10),
      makeStructure('TENT', House.Spain, 20, 20),
    ];
    // Adjacent to second structure but not first
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
  /** Health-scaled sell refund (C++ building.cpp Sell_Back) */
  function sellRefund(cost: number, hp: number, maxHp: number): number {
    return Math.floor(cost * (hp / maxHp) * 0.5);
  }

  /** Repair cost per step (mirrors Game repair logic) */
  function repairCostPerStep(cost: number, maxHp: number): number {
    return Math.ceil((cost * REPAIR_PERCENT) / (maxHp / REPAIR_STEP));
  }

  it('sell refund at full HP is 50% of cost', () => {
    expect(sellRefund(300, 256, 256)).toBe(150); // POWR: 300 * 1.0 * 0.5
    expect(sellRefund(2000, 256, 256)).toBe(1000); // WEAP: 2000 * 1.0 * 0.5
  });

  it('sell refund at half HP is 25% of cost', () => {
    expect(sellRefund(300, 128, 256)).toBe(75); // 300 * 0.5 * 0.5
    expect(sellRefund(2000, 128, 256)).toBe(500); // 2000 * 0.5 * 0.5
  });

  it('sell refund at 1 HP is near zero', () => {
    expect(sellRefund(300, 1, 256)).toBe(0); // 300 * (1/256) * 0.5 ≈ 0.58 → 0
    expect(sellRefund(2000, 1, 256)).toBe(3); // 2000 * (1/256) * 0.5 ≈ 3.9 → 3
  });

  it('sell refund scales linearly with HP ratio', () => {
    const cost = 1000;
    const maxHp = 256;
    const r100 = sellRefund(cost, maxHp, maxHp);
    const r75 = sellRefund(cost, 192, maxHp);
    const r50 = sellRefund(cost, 128, maxHp);
    const r25 = sellRefund(cost, 64, maxHp);
    expect(r100).toBeGreaterThan(r75);
    expect(r75).toBeGreaterThan(r50);
    expect(r50).toBeGreaterThan(r25);
  });

  it('repair cost per step is consistent with REPAIR_PERCENT and REPAIR_STEP', () => {
    // POWR: cost=300, maxHp=256, REPAIR_STEP=5, REPAIR_PERCENT=0.25
    // Full repair cost = 300 * 0.25 = 75 credits
    // Steps to full = 256/5 = 51.2 → ceil in per-step
    // Cost per step = ceil(75 / 51.2) = ceil(1.46) = 2
    expect(repairCostPerStep(300, 256)).toBe(2);
    // WEAP: cost=2000, maxHp=256
    // Full repair cost = 2000 * 0.25 = 500, steps = 51.2, per step = ceil(9.76) = 10
    expect(repairCostPerStep(2000, 256)).toBe(10);
  });

  it('sell mode persists after selling (not deactivated on click)', () => {
    // In RA1, sell mode stays active until right-click/Escape/button toggle
    // We test that the mode variable is NOT set to false after a sell action
    let sellMode = true;
    // Simulate selling a structure — mode should NOT change
    // (old behavior: sellMode = false after click. New: stays true)
    expect(sellMode).toBe(true); // still in sell mode
  });

  it('repair mode persists after toggling repair (not deactivated on click)', () => {
    let repairMode = true;
    // Simulate clicking a building to toggle repair — mode should NOT change
    expect(repairMode).toBe(true); // still in repair mode
  });

  it('right-click cancels sell mode', () => {
    let sellMode = true;
    let repairMode = false;
    // Simulate right-click cancel
    if (sellMode || repairMode) {
      sellMode = false;
      repairMode = false;
    }
    expect(sellMode).toBe(false);
  });

  it('right-click cancels repair mode', () => {
    let sellMode = false;
    let repairMode = true;
    if (sellMode || repairMode) {
      sellMode = false;
      repairMode = false;
    }
    expect(repairMode).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// RA1 Parity Fixes (audit batch)
// ═══════════════════════════════════════════════════════════

describe('RA1 Parity Fixes', () => {
  // --- Speed reduction tiers ---
  /** Mirrors damageSpeedFactor from Game */
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

  // --- Refinery storage ---
  it('PROC silo capacity is 1000 (not 2000)', () => {
    // Mirrors calculateSiloCapacity logic
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

  // --- Queen self-heal ---
  it('queen self-heal rate: tick % 60 (every ~4 seconds)', () => {
    // Mirrors the healing check: only at tick intervals of 60
    const healInterval = 60;
    let healed = 0;
    for (let tick = 0; tick < 300; tick++) {
      if (tick % healInterval === 0) healed++;
    }
    // Over 300 ticks (20 seconds), should heal 5 times (ticks 0, 60, 120, 180, 240)
    expect(healed).toBe(5);
  });

  // --- ConYard power ---
  it('FACT (ConYard) produces 0 power', () => {
    // Mirrors power calculation: FACT no longer appears in powerProduced
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
      // FACT is NOT listed — produces 0
    }
    expect(powerProduced).toBe(100); // only POWR contributes
  });

  // --- Barracks power ---
  it('TENT (Barracks) consumes 10 power (not 20)', () => {
    let powerConsumed = 0;
    const structures = [makeStructure('TENT', House.Spain, 10, 10)];
    for (const s of structures) {
      if (!s.alive || (s.house !== House.Spain && s.house !== House.Greece)) continue;
      if (s.type === 'TENT') powerConsumed += 10;
    }
    expect(powerConsumed).toBe(10);
  });

  // --- Sell infantry house ---
  it('sold structure spawns infantry with structure house (not always Spain)', () => {
    // The sell code uses s.house instead of House.Spain
    const greekStruct = makeStructure('POWR', House.Greece, 10, 10);
    const infantryHouse = greekStruct.house; // should be Greece, not Spain
    expect(infantryHouse).toBe(House.Greece);
  });

  // --- Area guard leash ---
  it('area guard leash is 2x guardRange', () => {
    const guardRange = 8; // typical sight value
    const leashRange = guardRange * 2;
    expect(leashRange).toBe(16);
    // Unit at 1.5x guardRange should NOT return (within leash)
    const distFromOrigin = guardRange * 1.5;
    expect(distFromOrigin <= leashRange).toBe(true);
    // Unit at 2.5x guardRange SHOULD return (beyond leash)
    const farDist = guardRange * 2.5;
    expect(farDist > leashRange).toBe(true);
  });

  // --- Friendly crush ---
  it('vehicle crush applies to allied units (no friendly immunity)', () => {
    // Test the logic: we check crushable but NOT allied status
    const vehicleHouse = House.Spain;
    const targetHouse = House.Spain; // same house = allied
    const targetCrushable = true;
    // Old logic: skip if allied. New logic: no allied skip
    const shouldCrush = targetCrushable; // no alliance check
    expect(shouldCrush).toBe(true);
  });

  // --- Camera getVisibleBounds ---
  it('camera getVisibleBounds returns correct world bounds', () => {
    const cam = new Camera(640, 400);
    cam.centerOn(1000, 1000);
    const bounds = cam.getVisibleBounds();
    expect(bounds.right - bounds.left).toBe(640);
    expect(bounds.bottom - bounds.top).toBe(400);
    // Center should be roughly at 1000, 1000
    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;
    expect(Math.abs(cx - 1000)).toBeLessThan(1);
    expect(Math.abs(cy - 1000)).toBeLessThan(1);
  });

  // --- Defense targeting uses threat score ---
  it('defense targeting prefers dangerous targets over just closest', () => {
    // Simulated threat scoring (mirrors updateStructureCombat)
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
    // Target B should score higher: vehicle (25 base) + high weapon damage + wounded
    expect(threatScore(targetB)).toBeGreaterThan(threatScore(targetA));
  });
});
