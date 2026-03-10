/**
 * Track-table movement verification tests.
 *
 * Verifies:
 * 1. Track endpoints in North reference frame match target cell centers
 * 2. Track step continuity (no large gaps between consecutive steps)
 * 3. Post-track residual is bounded (diagonal movement handled smoothly)
 * 4. Track selection logic for different angular differences
 * 5. Vehicle/infantry track usage classification
 */

import { describe, it, expect } from 'vitest';
import { TRACKS, selectTrack, rotateTrackOffset, usesTrackMovement } from '../engine/tracks';
import { CELL_SIZE, SpeedClass } from '../engine/types';

describe('Track table endpoints (North reference)', () => {
  // In North reference frame, all tracks should reach exact cell centers
  const expectedEndpoints: [number, number][] = [
    [0, -CELL_SIZE],           // track 0: straight N
    [CELL_SIZE, -CELL_SIZE],   // track 1: 45° right → NE (extended)
    [-CELL_SIZE, -CELL_SIZE],  // track 2: 45° left → NW (extended)
    [CELL_SIZE, 0],            // track 3: 90° right → E
    [-CELL_SIZE, 0],           // track 4: 90° left → W
    [0, CELL_SIZE],            // track 5: 180° right → S
    [0, CELL_SIZE],            // track 6: 180° left → S
  ];

  for (let trackNum = 0; trackNum < TRACKS.length; trackNum++) {
    it(`track ${trackNum} endpoint matches target cell center`, () => {
      const track = TRACKS[trackNum];
      const lastStep = track[track.length - 1];
      const [expectedX, expectedY] = expectedEndpoints[trackNum];
      const [rx, ry] = rotateTrackOffset(lastStep.x, lastStep.y, 0);

      expect(rx).toBeCloseTo(expectedX, 4);
      expect(ry).toBeCloseTo(expectedY, 4);
    });
  }
});

describe('Post-track residual bounds', () => {
  it('all track endpoints have bounded snap distance for all 8 directions', () => {
    // After track completion + rotation, the remaining distance to cell center
    // must be small enough for smooth residual approach (< CELL_SIZE/2 = 12px).
    // The residual approach code in updateMove handles this smoothly.
    for (let facing8 = 0; facing8 < 8; facing8++) {
      for (let trackNum = 0; trackNum < TRACKS.length; trackNum++) {
        const track = TRACKS[trackNum];
        const lastStep = track[track.length - 1];
        const [rx, ry] = rotateTrackOffset(lastStep.x, lastStep.y, facing8);

        const cellsX = Math.round(rx / CELL_SIZE);
        const cellsY = Math.round(ry / CELL_SIZE);
        const snapX = Math.abs(rx - cellsX * CELL_SIZE);
        const snapY = Math.abs(ry - cellsY * CELL_SIZE);
        const snapDist = Math.sqrt(snapX * snapX + snapY * snapY);

        // Residual must be < CELL_SIZE/2 for smooth approach
        expect(snapDist, `track ${trackNum} facing ${facing8}: snap ${snapDist.toFixed(1)}px`)
          .toBeLessThan(CELL_SIZE / 2);
      }
    }
  });

  it('cardinal-facing straight tracks have zero snap', () => {
    // When facing N/E/S/W, the straight track should reach cell center exactly
    for (const facing8 of [0, 2, 4, 6]) {
      const track = TRACKS[0]; // straight
      const lastStep = track[track.length - 1];
      const [rx, ry] = rotateTrackOffset(lastStep.x, lastStep.y, facing8);
      const cellsX = Math.round(rx / CELL_SIZE);
      const cellsY = Math.round(ry / CELL_SIZE);
      const snap = Math.sqrt(
        Math.pow(rx - cellsX * CELL_SIZE, 2) +
        Math.pow(ry - cellsY * CELL_SIZE, 2)
      );
      expect(snap, `straight track facing ${facing8}`).toBeLessThan(0.01);
    }
  });
});

describe('Track selection', () => {
  it('same facing selects straight track', () => {
    expect(selectTrack(0, 0)).toBe(0);
    expect(selectTrack(16, 16)).toBe(0);
  });

  it('small angle selects 45° turn', () => {
    expect(selectTrack(0, 4)).toBe(1);   // N→NE = 45° right
    expect(selectTrack(0, 28)).toBe(2);  // N→NW = 45° left
    expect(selectTrack(8, 12)).toBe(1);  // E→SE = 45° right
  });

  it('medium angle selects 90° turn', () => {
    expect(selectTrack(0, 8)).toBe(3);   // N→E = 90° right
    expect(selectTrack(0, 24)).toBe(4);  // N→W = 90° left
  });

  it('large angle selects 180° turn', () => {
    expect(selectTrack(0, 16)).toBe(5);  // N→S = 180° right
    // N→SSW (20): diff=20, isRight=false, absDiff=12 → 90° range
    expect(selectTrack(0, 20)).toBe(4);  // falls in 90° range (absDiff=12)
    // For actual 180° left: diff must be > 12 from left
    expect(selectTrack(4, 20)).toBe(5);  // NE→S: diff=16, right, absDiff=16 → 180°
  });
});

describe('Track step continuity (anti-jank)', () => {
  it('consecutive track steps have bounded gaps (< 10px)', () => {
    // Steps should be close together for smooth movement.
    // The max gap occurs in the 90° turn track's last step (large radius).
    const maxGap = 10;

    for (let trackNum = 0; trackNum < TRACKS.length; trackNum++) {
      const track = TRACKS[trackNum];
      let prevX = 0, prevY = 0;

      for (let i = 0; i < track.length; i++) {
        const [rx, ry] = rotateTrackOffset(track[i].x, track[i].y, 0);
        const dx = rx - prevX;
        const dy = ry - prevY;
        const gap = Math.sqrt(dx * dx + dy * dy);

        expect(gap, `track ${trackNum} step ${i}: ${gap.toFixed(2)}px gap`).toBeLessThan(maxGap);
        prevX = rx;
        prevY = ry;
      }
    }
  });

  it('45° turn tracks have smooth extension (no sudden direction change)', () => {
    // The extension steps after the curve should maintain the diagonal direction
    for (const trackNum of [1, 2]) {
      const track = TRACKS[trackNum];
      // Steps after index 7 are the extension
      for (let i = 8; i < track.length; i++) {
        const prev = track[i - 1];
        const curr = track[i];
        // Extension steps should maintain the same facing
        expect(curr.facing).toBe(prev.facing);
      }
    }
  });
});

describe('Vehicle track movement classification', () => {
  it('WHEEL vehicles use track movement', () => {
    expect(usesTrackMovement(SpeedClass.WHEEL, false, false)).toBe(true);
  });

  it('TRACK vehicles use track movement', () => {
    expect(usesTrackMovement(SpeedClass.TRACK, false, false)).toBe(true);
  });

  it('FLOAT vessels use track movement', () => {
    expect(usesTrackMovement(SpeedClass.FLOAT, false, false)).toBe(true);
  });

  it('infantry do NOT use track movement', () => {
    expect(usesTrackMovement(SpeedClass.FOOT, true, false)).toBe(false);
  });

  it('aircraft do NOT use track movement', () => {
    expect(usesTrackMovement(SpeedClass.WINGED, false, true)).toBe(false);
  });
});
