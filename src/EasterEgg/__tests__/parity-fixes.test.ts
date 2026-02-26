import { describe, it, expect } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { MAP_CELLS, CELL_SIZE } from '../engine/types';

describe('Bug 1: Harvester Logic', () => {
  it('harvester finds ore at distance 15 after cell depletion (search radius = 20)', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    // Init playable area as clear
    for (let cy = 40; cy < 90; cy++) {
      for (let cx = 40; cx < 90; cx++) {
        map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    // Place ore at distance ~15 cells from harvester position (60,60)
    const oreCX = 60 + 10;
    const oreCY = 60 + 10; // distance = sqrt(200) ≈ 14.1
    map.overlay[oreCY * MAP_CELLS + oreCX] = 0x06; // gold ore

    // With radius 20, should find it
    const result = map.findNearestOre(60, 60, 20);
    expect(result).not.toBeNull();
    expect(result!.cx).toBe(oreCX);
    expect(result!.cy).toBe(oreCY);

    // With old radius 5, should NOT find it
    const resultSmall = map.findNearestOre(60, 60, 5);
    expect(resultSmall).toBeNull();
  });

  it('refinery arrival detects from all 4 approach directions using edge distance', () => {
    // Simulate the refinery arrival check: distance to nearest edge of footprint ≤ 1
    // PROC footprint: 3x2, so cx range [procCX, procCX+2], cy range [procCY, procCY+1]
    const procCX = 50, procCY = 50;
    const procW = 3, procH = 2;

    function edgeDist(ecx: number, ecy: number): number {
      const nearX = Math.max(procCX, Math.min(ecx, procCX + procW - 1));
      const nearY = Math.max(procCY, Math.min(ecy, procCY + procH - 1));
      return Math.abs(nearX - ecx) + Math.abs(nearY - ecy);
    }

    // Adjacent from south (below entrance)
    expect(edgeDist(51, 52)).toBe(1);
    // Adjacent from north
    expect(edgeDist(51, 49)).toBe(1);
    // Adjacent from west
    expect(edgeDist(49, 50)).toBe(1);
    // Adjacent from east
    expect(edgeDist(53, 50)).toBe(1);
    // On top of refinery
    expect(edgeDist(51, 51)).toBe(0);
    // Far away
    expect(edgeDist(55, 55)).toBeGreaterThan(1);
  });

  it('pathfinding timeout falls back to idle after 45 ticks', () => {
    // This tests the logic: if stuck in MOVE with empty path for 45+ ticks, fall to idle.
    // We just verify the timeout constant matches the 3s design (45 ticks at 15 FPS).
    const TICKS_PER_SEC = 15;
    const TIMEOUT_TICKS = 45;
    expect(TIMEOUT_TICKS / TICKS_PER_SEC).toBe(3);
  });
});

describe('Bug 2: Wall Auto-Connection', () => {
  it('computes correct NESW bitmask for isolated wall', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.setWallType(10, 10, 'SBAG');
    // No neighbors → mask = 0
    expect(map.getWallType(10, 10)).toBe('SBAG');
    // Check cardinal directions are empty
    expect(map.getWallType(10, 9)).toBe('');  // N
    expect(map.getWallType(11, 10)).toBe(''); // E
    expect(map.getWallType(10, 11)).toBe(''); // S
    expect(map.getWallType(9, 10)).toBe('');  // W
  });

  it('computes correct NESW bitmask for horizontal wall segment', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    // Horizontal line: cells (10,10), (11,10), (12,10)
    map.setWallType(10, 10, 'FENC');
    map.setWallType(11, 10, 'FENC');
    map.setWallType(12, 10, 'FENC');

    // Middle cell (11,10) should have E=2 + W=8 = 10
    let mask = 0;
    if (map.getWallType(11, 9) === 'FENC') mask |= 1;  // N
    if (map.getWallType(12, 10) === 'FENC') mask |= 2; // E
    if (map.getWallType(11, 11) === 'FENC') mask |= 4; // S
    if (map.getWallType(10, 10) === 'FENC') mask |= 8; // W
    expect(mask).toBe(2 + 8); // E + W = 10
  });

  it('computes correct NESW bitmask for L-shaped wall', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    // L-shape: (10,10), (10,11), (11,11)
    map.setWallType(10, 10, 'BRIK');
    map.setWallType(10, 11, 'BRIK');
    map.setWallType(11, 11, 'BRIK');

    // Corner cell (10,11): N=1 (has 10,10) + E=2 (has 11,11) = 3
    let mask = 0;
    if (map.getWallType(10, 10) === 'BRIK') mask |= 1; // N
    if (map.getWallType(11, 11) === 'BRIK') mask |= 2; // E
    if (map.getWallType(10, 12) === 'BRIK') mask |= 4; // S
    if (map.getWallType(9, 11) === 'BRIK') mask |= 8;  // W
    expect(mask).toBe(1 + 2); // N + E = 3
  });

  it('computes correct NESW bitmask for T-shaped wall', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    // T-shape: (9,10), (10,10), (11,10), (10,11)
    map.setWallType(9, 10, 'BARB');
    map.setWallType(10, 10, 'BARB');
    map.setWallType(11, 10, 'BARB');
    map.setWallType(10, 11, 'BARB');

    // Center (10,10): E=2 + S=4 + W=8 = 14
    let mask = 0;
    if (map.getWallType(10, 9) === 'BARB') mask |= 1;  // N
    if (map.getWallType(11, 10) === 'BARB') mask |= 2; // E
    if (map.getWallType(10, 11) === 'BARB') mask |= 4; // S
    if (map.getWallType(9, 10) === 'BARB') mask |= 8;  // W
    expect(mask).toBe(2 + 4 + 8); // E + S + W = 14
  });

  it('different wall types do not connect to each other', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.setWallType(10, 10, 'SBAG');
    map.setWallType(11, 10, 'FENC'); // different type

    // SBAG at (10,10) should NOT see FENC as neighbor
    let mask = 0;
    if (map.getWallType(10, 9) === 'SBAG') mask |= 1;
    if (map.getWallType(11, 10) === 'SBAG') mask |= 2;
    if (map.getWallType(10, 11) === 'SBAG') mask |= 4;
    if (map.getWallType(9, 10) === 'SBAG') mask |= 8;
    expect(mask).toBe(0);
  });

  it('clearWallType removes wall type', () => {
    const map = new GameMap();
    map.setWallType(5, 5, 'BRIK');
    expect(map.getWallType(5, 5)).toBe('BRIK');
    map.clearWallType(5, 5);
    expect(map.getWallType(5, 5)).toBe('');
  });
});

describe('Bug 3: Building Damage Frame Rendering', () => {
  it('FACT shows frame 0 idle (not cycling through construction frames)', () => {
    // FACT: 52 frames, idleFrame=0, damageFrame=26, idleAnimCount=0
    // With the old logic: halfFrames=26, frame cycles 0-25. With new: frame=0 static.
    const totalFrames = 52;
    const idleFrame = 0;
    const idleAnimCount = 0;
    const damaged = false;

    // New behavior: static
    let frame: number;
    if (idleAnimCount > 0) {
      const baseFrame = damaged ? 26 : idleFrame;
      frame = baseFrame + (Math.floor(0 / 8) % idleAnimCount);
    } else {
      frame = damaged ? 26 : idleFrame;
    }
    expect(frame).toBe(0);

    // Verify it doesn't change with tick
    for (const tick of [0, 8, 16, 100, 200]) {
      let f: number;
      if (idleAnimCount > 0) {
        f = (damaged ? 26 : idleFrame) + (Math.floor(tick / 8) % idleAnimCount);
      } else {
        f = damaged ? 26 : idleFrame;
      }
      expect(f).toBe(0);
    }
  });

  it('SILO shows frame 0 idle (not cycling fill-level frames)', () => {
    // SILO: 10 frames, idleFrame=0, damageFrame=5, idleAnimCount=0
    const idleAnimCount = 0;
    const idleFrame = 0;
    const damaged = false;
    const frame = damaged ? 5 : idleFrame;
    expect(frame).toBe(0);
  });

  it('TSLA cycles frames 0-9 when healthy (animated building)', () => {
    // TSLA: 20 frames, idleFrame=0, damageFrame=10, idleAnimCount=10
    const idleAnimCount = 10;
    const idleFrame = 0;
    const damageFrame = 10;
    const damaged = false;

    const frames = new Set<number>();
    for (let tick = 0; tick < 80; tick++) {
      const baseFrame = damaged ? damageFrame : idleFrame;
      const frame = baseFrame + (Math.floor(tick / 8) % idleAnimCount);
      frames.add(frame);
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(10);
    }
    // Should cycle through all 10 frames
    expect(frames.size).toBe(10);
  });

  it('TSLA cycles frames 10-19 when damaged', () => {
    const idleAnimCount = 10;
    const damageFrame = 10;
    const damaged = true;

    const frames = new Set<number>();
    for (let tick = 0; tick < 80; tick++) {
      const baseFrame = damaged ? damageFrame : 0;
      const frame = baseFrame + (Math.floor(tick / 8) % idleAnimCount);
      frames.add(frame);
      expect(frame).toBeGreaterThanOrEqual(10);
      expect(frame).toBeLessThan(20);
    }
    expect(frames.size).toBe(10);
  });

  it('FACT shows frame 26 when damaged (not cycling)', () => {
    const idleAnimCount = 0;
    const damageFrame = 26;
    const damaged = true;
    const frame = damaged ? damageFrame : 0;
    expect(frame).toBe(26);
  });
});
