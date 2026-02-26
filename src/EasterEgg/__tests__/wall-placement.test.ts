import { describe, it, expect } from 'vitest';
import { PRODUCTION_ITEMS } from '../engine/types';

describe('Wall Placement', () => {
  it('SBAG is in production items', () => {
    const sbag = PRODUCTION_ITEMS.find(p => p.type === 'SBAG');
    expect(sbag).toBeDefined();
    expect(sbag!.cost).toBe(10);
    expect(sbag!.isStructure).toBe(true);
  });

  it('FENC is in production items', () => {
    const fenc = PRODUCTION_ITEMS.find(p => p.type === 'FENC');
    expect(fenc).toBeDefined();
    expect(fenc!.cost).toBe(25);
  });

  it('BRIK is in production items', () => {
    const brik = PRODUCTION_ITEMS.find(p => p.type === 'BRIK');
    expect(brik).toBeDefined();
    expect(brik!.cost).toBe(50);
  });

  it('BARB is in production items', () => {
    const barb = PRODUCTION_ITEMS.find(p => p.type === 'BARB');
    expect(barb).toBeDefined();
    expect(barb!.cost).toBe(20);
  });

  it('all wall types are structures', () => {
    const walls = PRODUCTION_ITEMS.filter(p => ['SBAG', 'FENC', 'BARB', 'BRIK'].includes(p.type));
    expect(walls).toHaveLength(4);
    walls.forEach(w => expect(w.isStructure).toBe(true));
  });

  it('all walls require FACT', () => {
    const walls = PRODUCTION_ITEMS.filter(p => ['SBAG', 'FENC', 'BARB', 'BRIK'].includes(p.type));
    walls.forEach(w => expect(w.prerequisite).toBe('FACT'));
  });
});
