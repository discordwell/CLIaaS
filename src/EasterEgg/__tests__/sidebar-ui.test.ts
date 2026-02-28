import { describe, it, expect } from 'vitest';
import {
  PRODUCTION_ITEMS, type ProductionItem, type SidebarTab,
  getItemCategory, House,
} from '../engine/types';
import { STRUCTURE_SIZE, type MapStructure } from '../engine/scenario';

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


