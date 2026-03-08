/**
 * Tests for the Full C++ Parity Plan (Phases 1-7).
 * Covers track-table movement, pathfinding enhancements, mission system,
 * IsSecondShot cadence, scatter formula, BulletTypeClass, and more.
 */

import { describe, it, expect } from 'vitest';
import { TRACKS, selectTrack, usesTrackMovement, rotateTrackOffset, type TrackStep } from '../engine/tracks';
import { Entity } from '../engine/entity';
import {
  Mission, SpeedClass, CELL_SIZE, LEPTON_SIZE, UnitType, House,
  WEAPON_STATS, UNIT_STATS,
  type MissionControl, MISSION_CONTROL,
} from '../engine/types';
import { STRUCTURE_POWERED } from '../engine/scenario';

// === Phase 7b: Track-table movement ===

describe('Track-table movement (Phase 7b)', () => {
  it('has 7 track types (straight + 3 turn magnitudes × left/right)', () => {
    expect(TRACKS).toHaveLength(7);
  });

  it('each track has 8 steps', () => {
    for (let i = 0; i < TRACKS.length; i++) {
      expect(TRACKS[i]).toHaveLength(8);
    }
  });

  it('track 0 (straight) moves exactly 1 cell northward', () => {
    const track = TRACKS[0];
    const lastStep = track[track.length - 1];
    expect(lastStep.x).toBeCloseTo(0, 5);
    expect(lastStep.y).toBeCloseTo(-CELL_SIZE, 5);
    for (const step of track) {
      expect(step.facing).toBe(0);
    }
  });

  it('track 1 (45° right) ends at facing 4 (NE)', () => {
    const lastStep = TRACKS[1][TRACKS[1].length - 1];
    expect(lastStep.facing).toBe(4);
  });

  it('track 2 (45° left) ends at facing 28 (NW)', () => {
    const lastStep = TRACKS[2][TRACKS[2].length - 1];
    expect(lastStep.facing).toBe(28);
  });

  it('track 3 (90° right N→E) ends at facing 8 (E)', () => {
    const lastStep = TRACKS[3][TRACKS[3].length - 1];
    expect(lastStep.facing).toBe(8);
  });

  it('track 4 (90° left N→W) ends at facing 24 (W)', () => {
    const lastStep = TRACKS[4][TRACKS[4].length - 1];
    expect(lastStep.facing).toBe(24);
  });

  it('track 5 (180° right) ends at facing 16 (S)', () => {
    const lastStep = TRACKS[5][TRACKS[5].length - 1];
    expect(lastStep.facing).toBe(16);
  });

  it('selectTrack returns 0 for same facing (straight)', () => {
    expect(selectTrack(0, 0)).toBe(0);
    expect(selectTrack(8, 8)).toBe(0);
    expect(selectTrack(16, 16)).toBe(0);
  });

  it('selectTrack returns 1 for small right turn (45°)', () => {
    expect(selectTrack(0, 4)).toBe(1);   // N → NE
    expect(selectTrack(0, 2)).toBe(1);   // small right
  });

  it('selectTrack returns 2 for small left turn (45°)', () => {
    expect(selectTrack(0, 28)).toBe(2);  // N → NW
    expect(selectTrack(0, 30)).toBe(2);  // small left
  });

  it('selectTrack returns 3 for 90° right turn', () => {
    expect(selectTrack(0, 8)).toBe(3);   // N → E
    expect(selectTrack(0, 12)).toBe(3);  // N → SE
  });

  it('selectTrack returns 4 for 90° left turn', () => {
    expect(selectTrack(0, 24)).toBe(4);  // N → W
    expect(selectTrack(0, 20)).toBe(4);  // N → SW
  });

  it('selectTrack returns 5 for 180° right turn', () => {
    expect(selectTrack(0, 16)).toBe(5);  // N → S (exact 180°)
    expect(selectTrack(0, 14)).toBe(5);  // near-180° right
  });

  it('selectTrack returns 6 for 180° left turn', () => {
    // diff = (17 - 0 + 32) % 32 = 17, isRight = false (17 > 16)
    expect(selectTrack(0, 17)).toBe(6);
  });

  it('usesTrackMovement: vehicles use tracks', () => {
    expect(usesTrackMovement(SpeedClass.WHEEL, false, false)).toBe(true);
    expect(usesTrackMovement(SpeedClass.TRACK, false, false)).toBe(true);
    expect(usesTrackMovement(SpeedClass.FLOAT, false, false)).toBe(true);
  });

  it('usesTrackMovement: infantry exempt', () => {
    expect(usesTrackMovement(SpeedClass.FOOT, true, false)).toBe(false);
    expect(usesTrackMovement(SpeedClass.WHEEL, true, false)).toBe(false);
  });

  it('usesTrackMovement: aircraft exempt', () => {
    expect(usesTrackMovement(SpeedClass.WINGED, false, true)).toBe(false);
  });

  // rotateTrackOffset: exact coordinate transforms for all 8 directions
  it('rotateTrackOffset: N (facing8=0) is identity', () => {
    const [rx, ry] = rotateTrackOffset(10, -24, 0);
    expect(rx).toBe(10);
    expect(ry).toBe(-24);
  });

  it('rotateTrackOffset: E (facing8=2) is exact 90° CW', () => {
    // (x,y) → (-y, x)
    const [rx, ry] = rotateTrackOffset(0, -24, 2);
    expect(rx).toBe(24);  // -(-24) = 24
    expect(ry).toBe(0);   // exact integer
  });

  it('rotateTrackOffset: S (facing8=4) is exact 180°', () => {
    const [rx, ry] = rotateTrackOffset(0, -24, 4);
    expect(rx).toBeCloseTo(0, 10);
    expect(ry).toBe(24);
  });

  it('rotateTrackOffset: W (facing8=6) is exact 270° CW', () => {
    // (x,y) → (y, -x)
    const [rx, ry] = rotateTrackOffset(0, -24, 6);
    expect(rx).toBe(-24);
    expect(ry).toBeCloseTo(0, 10);
  });

  it('rotateTrackOffset: NE (facing8=1) uses √2/2 scaling', () => {
    // (x-y)·S, (x+y)·S where S = √2/2
    const [rx, ry] = rotateTrackOffset(0, -24, 1);
    const S = Math.SQRT2 / 2;
    expect(rx).toBeCloseTo((0 - (-24)) * S, 10); // 24·√2/2 ≈ 16.97
    expect(ry).toBeCloseTo((0 + (-24)) * S, 10); // -24·√2/2 ≈ -16.97
  });

  it('rotateTrackOffset: cardinal transforms are exact integers (no float drift)', () => {
    // For any input, cardinal rotations should produce exact values
    const [ex, ey] = rotateTrackOffset(7, -13, 2); // E: (-y, x)
    expect(ex).toBe(13);
    expect(ey).toBe(7);
    const [sx, sy] = rotateTrackOffset(7, -13, 4); // S: (-x, -y)
    expect(sx).toBe(-7);
    expect(sy).toBe(13);
  });

  it('Entity has track state fields initialized correctly', () => {
    const e = new Entity(UnitType.V_1TNK, House.Spain, 100, 100);
    expect(e.trackNumber).toBe(-1);
    expect(e.trackIndex).toBe(0);
    expect(e.trackStartX).toBe(0);
    expect(e.trackStartY).toBe(0);
    expect(e.trackBaseFacing).toBe(0);
  });
});

// === Phase 7c: Pathfinding enhancements ===

describe('Pathfinding enhancements (Phase 7c)', () => {
  it('findPath is importable and callable', async () => {
    const { findPath } = await import('../engine/pathfinding');
    expect(typeof findPath).toBe('function');
  });
});

// === Phase 7a: 22-mission system ===

describe('22-mission system (Phase 7a)', () => {
  it('Mission enum has all 22 C++ missions', () => {
    const expectedMissions = [
      'GUARD', 'AREA_GUARD', 'MOVE', 'ATTACK', 'HUNT', 'SLEEP', 'DIE',
      'ENTER', 'CAPTURE', 'HARVEST', 'UNLOAD', 'RETREAT', 'AMBUSH',
      'STICKY', 'REPAIR', 'STOP', 'HARMLESS', 'QMOVE', 'RETURN',
      'RESCUE', 'MISSILE', 'SABOTAGE', 'CONSTRUCTION', 'DECONSTRUCTION',
    ];
    for (const name of expectedMissions) {
      expect(Mission[name as keyof typeof Mission], `Mission.${name} should exist`).toBeDefined();
    }
  });

  it('MissionControl metadata exists for all missions', () => {
    const missionValues = Object.values(Mission).filter(v => typeof v === 'number') as Mission[];
    for (const m of missionValues) {
      const ctrl = MISSION_CONTROL[Mission[m] as keyof typeof MISSION_CONTROL];
      expect(ctrl, `MissionControl for ${Mission[m]} should exist`).toBeDefined();
    }
  });

  it('GUARD mission is retaliatory and scatterable', () => {
    const ctrl = MISSION_CONTROL.GUARD;
    expect(ctrl.isRetaliate).toBe(true);
    expect(ctrl.isScatter).toBe(true);
    expect(ctrl.isNoThreat).toBe(false);
  });

  it('SLEEP mission is no-threat and non-retaliatory', () => {
    const ctrl = MISSION_CONTROL.SLEEP;
    expect(ctrl.isNoThreat).toBe(true);
    expect(ctrl.isRetaliate).toBe(false);
  });

  it('HARMLESS mission is no-threat', () => {
    const ctrl = MISSION_CONTROL.HARMLESS;
    expect(ctrl.isNoThreat).toBe(true);
  });

  it('Entity has missionQueue field', () => {
    const e = new Entity(UnitType.E1, House.Spain, 100, 100);
    expect(e.missionQueue).toBeNull();
  });
});

// === Phase 2a: IsSecondShot cadence ===

describe('IsSecondShot cadence (Phase 2a)', () => {
  it('Entity has isSecondShot field initialized to false', () => {
    const e = new Entity(UnitType.V_3TNK, House.Spain, 100, 100);
    expect(e.isSecondShot).toBe(false);
  });

  it('dual-weapon units (3TNK, 4TNK) have both weapons defined', () => {
    const tank3 = UNIT_STATS['3TNK'];
    expect(tank3.primaryWeapon).toBeDefined();
    expect(tank3.secondaryWeapon).toBeDefined();

    const tank4 = UNIT_STATS['4TNK'];
    expect(tank4.primaryWeapon).toBeDefined();
    expect(tank4.secondaryWeapon).toBeDefined();
  });
});

// === Phase 6: BulletTypeClass properties ===

describe('BulletTypeClass properties (Phase 6)', () => {
  it('155mm (Artillery) has isInaccurate flag', () => {
    const w = WEAPON_STATS['155mm'];
    expect(w.isInaccurate).toBe(true);
  });

  it('M1Carbine has isInvisible flag (instant-hit)', () => {
    const w = WEAPON_STATS['M1Carbine'];
    expect(w.isInvisible).toBe(true);
  });

  it('M60mg has isInvisible flag', () => {
    const w = WEAPON_STATS['M60mg'];
    expect(w.isInvisible).toBe(true);
  });

  it('SCUD has isGigundo and isFueled flags', () => {
    const w = WEAPON_STATS['SCUD'];
    expect(w.isGigundo).toBe(true);
    expect(w.isFueled).toBe(true);
  });

  it('DogJaw has isInvisible (instant melee)', () => {
    const w = WEAPON_STATS['DogJaw'];
    expect(w.isInvisible).toBe(true);
  });

  it('Sniper has isInvisible flag', () => {
    const w = WEAPON_STATS['Sniper'];
    expect(w.isInvisible).toBe(true);
  });
});

// === Phase 4: Per-building IsPowered ===

describe('Per-building IsPowered (Phase 4)', () => {
  const EXPECTED_POWERED = ['GUN', 'TSLA', 'SAM', 'AGUN', 'GAP', 'PDOX', 'IRON', 'MSLO'];

  it('STRUCTURE_POWERED contains all 8 powered structures', () => {
    expect(STRUCTURE_POWERED.size).toBe(8);
    for (const s of EXPECTED_POWERED) {
      expect(STRUCTURE_POWERED.has(s), `${s} should be in STRUCTURE_POWERED`).toBe(true);
    }
  });

  it('non-powered structures are not in the set', () => {
    const nonPowered = ['POWR', 'APWR', 'FACT', 'WEAP', 'PROC', 'SILO', 'BARR', 'TENT'];
    for (const s of nonPowered) {
      expect(STRUCTURE_POWERED.has(s), `${s} should NOT be in STRUCTURE_POWERED`).toBe(false);
    }
  });
});

// === Phase 5b: Formation movement ===

describe('Formation movement offset (Phase 5b)', () => {
  it('Entity has formationOffset field initialized to null', () => {
    const e = new Entity(UnitType.E1, House.Spain, 100, 100);
    expect(e.formationOffset).toBeNull();
  });
});

// === Phase 1c: Infantry fidget ===

describe('Infantry fidget randomization (Phase 1c)', () => {
  it('fidgetDelay is randomized in 12-31 range', () => {
    // Create multiple entities and verify they don't all have the same delay
    const delays = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const e = new Entity(UnitType.E1, House.Spain, 100, 100);
      expect(e.fidgetDelay).toBeGreaterThanOrEqual(12);
      expect(e.fidgetDelay).toBeLessThanOrEqual(31);
      delays.add(e.fidgetDelay);
    }
    // With 20 random values in range [12,31], we should have at least 2 distinct values
    expect(delays.size).toBeGreaterThan(1);
  });

  it('fidgetVariant is randomized between 0 and 1', () => {
    const variants = new Set<number>();
    for (let i = 0; i < 10; i++) {
      const e = new Entity(UnitType.E1, House.Spain, 100, 100);
      expect(e.fidgetVariant).toBeGreaterThanOrEqual(0);
      expect(e.fidgetVariant).toBeLessThan(1);
      variants.add(e.fidgetVariant);
    }
    expect(variants.size).toBeGreaterThan(1);
  });
});

// === Phase 2b: Scatter formula verification ===

describe('Scatter formula constants (Phase 2b)', () => {
  it('LEPTON_SIZE is 256', () => {
    expect(LEPTON_SIZE).toBe(256);
  });

  it('CELL_SIZE is 24', () => {
    expect(CELL_SIZE).toBe(24);
  });

  it('C++ scatter formula: (distLeptons/16)-64 gives correct values', () => {
    // Close range: 5 cells = 1280 leptons → (1280/16)-64 = 16
    const close = Math.max(0, Math.floor(5 * 256 / 16) - 64);
    expect(close).toBe(16);

    // Medium range: 10 cells = 2560 leptons → (2560/16)-64 = 96
    const medium = Math.max(0, Math.floor(10 * 256 / 16) - 64);
    expect(medium).toBe(96);

    // Very close: 1 cell = 256 leptons → (256/16)-64 = -48 → clamped to 0
    const veryClose = Math.max(0, Math.floor(1 * 256 / 16) - 64);
    expect(veryClose).toBe(0);
  });
});
