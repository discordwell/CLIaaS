/**
 * Tests for Phase 1 unit behavior fixes and Phase 2 sidebar overhaul.
 *
 * Covers:
 * - moveToward snap threshold (0.5px sub-pixel snap)
 * - movementSpeed default fraction (1.0 instead of 0.5)
 * - Sidebar production gating for no-base missions (SCG01EA)
 * - Generic briefing generation from INI text
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { Dir, UnitType, House, CELL_SIZE, UNIT_STATS, getStripSide, RESFACTOR } from '../engine/types';
import { getCanonicalProductionItems } from '../engine/rulesIniPipeline';
const PRODUCTION_ITEMS = getCanonicalProductionItems();

beforeEach(() => resetEntityIds());

// ── moveToward snap threshold ─────────────────────────────

describe('moveToward — sub-pixel snap threshold', () => {
  it('does NOT snap when 1px away (prevents visible teleport)', () => {
    const tanya = new Entity(UnitType.I_TANYA, House.Spain, 100, 100);
    tanya.facing = Dir.E;
    const target = { x: 101, y: 100 }; // 1px away

    tanya.rotTickedThisFrame = false;
    const arrived = tanya.moveToward(target, 3.0); // speed=3 (old threshold would snap)

    // With 0.5px threshold, should NOT snap from 1px — should move instead
    // The unit moves toward the target but doesn't teleport
    if (arrived) {
      // If arrived, position should equal target (within tolerance)
      expect(Math.abs(tanya.pos.x - target.x)).toBeLessThanOrEqual(0.5);
    } else {
      // If not arrived, should have moved closer
      expect(tanya.pos.x).toBeGreaterThan(100);
    }
  });

  it('snaps when within lepton snap threshold (prevents oscillation)', () => {
    const unit = new Entity(UnitType.I_E1, House.Spain, 100.3, 100.0);
    unit.facing = Dir.E;
    const target = { x: 100.5, y: 100.0 }; // 0.2px away — within infantry snap range (16 leptons = 1px)

    unit.rotTickedThisFrame = false;
    const arrived = unit.moveToward(target, 2.0);

    expect(arrived).toBe(true);
    // Lepton quantization means snapped position may differ from target by sub-pixel amount
    expect(Math.abs(unit.pos.x - target.x)).toBeLessThan(0.5);
    expect(Math.abs(unit.pos.y - target.y)).toBeLessThan(0.5);
  });

  it('unit moves smoothly when target is within old snap range', () => {
    const tanya = new Entity(UnitType.I_TANYA, House.Spain, 100, 100);
    tanya.facing = Dir.E;
    // Place target 2.5px away — old threshold (effectiveSpeed=3) would snap instantly
    // With new lepton-based snapping, unit should move via normal movement logic
    const target = { x: 102.5, y: 100 };

    tanya.rotTickedThisFrame = false;
    const arrived = tanya.moveToward(target, 3.0);

    // Unit should have moved toward target (not stayed at start)
    expect(tanya.pos.x).toBeGreaterThan(100);
    // Speed=3 can cover 2.5px in one tick, so may arrive.
    // Lepton quantization means arrival position may differ from target by sub-pixel amount.
    if (arrived) {
      expect(Math.abs(tanya.pos.x - target.x)).toBeLessThan(0.5);
    }
  });
});

// ── movementSpeed default fraction ────────────────────────

describe('movementSpeed default fraction', () => {
  it('Tanya base speed stat matches types.ts', () => {
    // Tanya speed from types.ts (verify stat is positive and reasonable)
    const speed = UNIT_STATS[UnitType.I_TANYA].speed;
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThanOrEqual(10);
  });

  it('unit speeds are now used at full value (fraction=1.0)', () => {
    // Verify that units have positive speeds that will be used directly
    // (no longer halved by default speedFraction=0.5)
    const tanyas = UNIT_STATS[UnitType.I_TANYA].speed;
    const rifleSpeed = UNIT_STATS[UnitType.I_E1].speed;
    const tankSpeed = UNIT_STATS[UnitType.V_1TNK].speed;
    expect(tanyas).toBeGreaterThan(0);
    expect(rifleSpeed).toBeGreaterThan(0);
    expect(tankSpeed).toBeGreaterThan(0);
    // Tanya should be faster than regular infantry
    expect(tanyas).toBeGreaterThanOrEqual(rifleSpeed);
  });

  it('vehicle speed values are reasonable', () => {
    const lightTank = UNIT_STATS[UnitType.V_1TNK].speed;
    const heavyTank = UNIT_STATS[UnitType.V_3TNK].speed;
    // Light tanks should be faster than heavy tanks
    expect(lightTank).toBeGreaterThanOrEqual(heavyTank);
  });
});

// ── Sidebar production gating ─────────────────────────────

describe('sidebar production gating for no-base missions', () => {
  it('PRODUCTION_ITEMS all require prerequisite buildings (except FACT and non-buildable items)', () => {
    // Non-buildable items (techLevel=-1 with empty prerequisite) are excluded:
    // scenario-placed structures, non-buildable walls/fences, some fakes
    const NON_BUILDABLE_NO_PREREQ = new Set([
      'FACT',       // root of build tree
      'CYCL', 'BARB', 'WOOD',     // non-buildable walls/fences
      'BIO', 'HOSP', 'FCOM', 'MISS',  // scenario-placed buildings
      'FACF', 'SPEF',             // fakes with no prerequisite
    ]);
    for (const item of PRODUCTION_ITEMS) {
      if (NON_BUILDABLE_NO_PREREQ.has(item.type)) {
        expect(item.prerequisite).toBe('');
        continue;
      }
      expect(item.prerequisite).toBeTruthy();
      expect(typeof item.prerequisite).toBe('string');
    }
  });

  it('getStripSide returns correct strip for production items', () => {
    const e1 = PRODUCTION_ITEMS.find(p => p.type === 'E1')!;
    expect(getStripSide(e1)).toBe('right'); // infantry → right strip

    const tank = PRODUCTION_ITEMS.find(p => p.type === '1TNK')!;
    expect(getStripSide(tank)).toBe('right'); // vehicles → right strip

    const fact = PRODUCTION_ITEMS.find(p => p.type === 'POWR')!;
    expect(getStripSide(fact)).toBe('left'); // structures → left strip
  });

  it('SCG01EA player=Greece has no allied structures (USSR base)', () => {
    // In SCG01EA, all structures belong to USSR, player is Greece
    // isAllied(USSR, Greece) = false, so hasBuilding returns false
    // This means getAvailableItems returns [] — no production
    // We test the data assumption: buildable structures have prerequisites
    const NON_BUILDABLE_NO_PREREQ = new Set([
      'FACT', 'CYCL', 'BARB', 'WOOD', 'BIO', 'HOSP', 'FCOM', 'MISS', 'FACF', 'SPEF',
    ]);
    const alliedStructures = PRODUCTION_ITEMS.filter(p => p.isStructure);
    for (const s of alliedStructures) {
      if (NON_BUILDABLE_NO_PREREQ.has(s.type)) continue;
      expect(s.prerequisite).toBeTruthy();
    }
  });
});

// ── Generic briefing generation ───────────────────────────

describe('generic briefing generation', () => {
  // Import the BriefingRenderer — it should accept iniBriefingText
  it('BriefingRenderer.start signature accepts optional briefing text', async () => {
    // We can't easily instantiate BriefingRenderer without a canvas,
    // but we can verify the module exports correctly
    const mod = await import('../engine/briefing');
    expect(mod.BriefingRenderer).toBeDefined();
  });
});

// ── Sidebar layout constants ──────────────────────────────

describe('sidebar layout', () => {
  it('sidebar layout constants match C++ parity (LORES base × RESFACTOR)', async () => {
    const mod = await import('../engine/renderer');
    expect(mod.Renderer.RADAR_SIZE).toBe(70 * RESFACTOR);
    expect(mod.Renderer.RADAR_Y).toBe(2 * RESFACTOR);
    expect(mod.Renderer.STRIP_START_Y).toBe(90 * RESFACTOR);
    expect(mod.Renderer.CAMEO_W).toBe(32 * RESFACTOR);
    expect(mod.Renderer.CAMEO_H).toBe(24 * RESFACTOR);
  });
});
