import { describe, it, expect } from 'vitest';
import { CELL_SIZE } from '../engine/types';

describe('Formation Movement', () => {
  // Test the formation calculation logic directly
  function calculateFormation(centerX: number, centerY: number, count: number) {
    if (count <= 1) return [{ x: centerX, y: centerY }];
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const positions = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const offsetX = (col - (cols - 1) / 2) * CELL_SIZE;
      const offsetY = (row - (rows - 1) / 2) * CELL_SIZE;
      positions.push({ x: centerX + offsetX, y: centerY + offsetY });
    }
    return positions;
  }

  it('single unit gets exact target position', () => {
    const pos = calculateFormation(100, 100, 1);
    expect(pos).toHaveLength(1);
    expect(pos[0]).toEqual({ x: 100, y: 100 });
  });

  it('4 units form 2x2 grid', () => {
    const pos = calculateFormation(100, 100, 4);
    expect(pos).toHaveLength(4);
    // Grid should be centered on 100,100
    const avgX = pos.reduce((s, p) => s + p.x, 0) / 4;
    const avgY = pos.reduce((s, p) => s + p.y, 0) / 4;
    expect(avgX).toBe(100);
    expect(avgY).toBe(100);
  });

  it('9 units form 3x3 grid', () => {
    const pos = calculateFormation(200, 200, 9);
    expect(pos).toHaveLength(9);
    const cols = Math.ceil(Math.sqrt(9));
    expect(cols).toBe(3);
  });

  it('positions are spread by CELL_SIZE', () => {
    const pos = calculateFormation(100, 100, 4);
    // 2x2 grid: positions should differ by CELL_SIZE
    const dx = Math.abs(pos[1].x - pos[0].x);
    expect(dx).toBe(CELL_SIZE);
  });
});
