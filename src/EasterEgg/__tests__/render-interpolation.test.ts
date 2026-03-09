/**
 * Render interpolation tests — verify smooth 60fps visual rendering
 * between 20fps game ticks via prevPos/pos linear interpolation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House, CELL_SIZE, GAME_TICKS_PER_SEC } from '../engine/types';

beforeEach(() => resetEntityIds());

describe('Render interpolation: prevPos → pos smooth visual', () => {
  it('newly created entity has prevPos === pos (no interpolation jump)', () => {
    const unit = new Entity(UnitType.V_JEEP, House.Spain, 100, 200);
    expect(unit.prevPos.x).toBe(100);
    expect(unit.prevPos.y).toBe(200);
    expect(unit.pos.x).toBe(100);
    expect(unit.pos.y).toBe(200);
  });

  it('after movement, prevPos reflects pre-move position', () => {
    const unit = new Entity(UnitType.V_JEEP, House.Spain, 100, 100);
    // Simulate what the game loop does: save prevPos, then move
    unit.prevPos.x = unit.pos.x;
    unit.prevPos.y = unit.pos.y;
    // Simulate movement
    unit.pos.x = 101;
    unit.pos.y = 100;
    expect(unit.prevPos.x).toBe(100);
    expect(unit.pos.x).toBe(101);
  });

  it('interpolation at alpha=0 yields prevPos', () => {
    const unit = new Entity(UnitType.V_JEEP, House.Spain, 100, 100);
    unit.prevPos.x = 100;
    unit.prevPos.y = 100;
    unit.pos.x = 102;
    unit.pos.y = 104;

    const alpha = 0;
    const renderX = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * alpha;
    const renderY = unit.prevPos.y + (unit.pos.y - unit.prevPos.y) * alpha;
    expect(renderX).toBe(100);
    expect(renderY).toBe(100);
  });

  it('interpolation at alpha=1 yields current pos', () => {
    const unit = new Entity(UnitType.V_JEEP, House.Spain, 100, 100);
    unit.prevPos.x = 100;
    unit.prevPos.y = 100;
    unit.pos.x = 102;
    unit.pos.y = 104;

    const alpha = 1;
    const renderX = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * alpha;
    const renderY = unit.prevPos.y + (unit.pos.y - unit.prevPos.y) * alpha;
    expect(renderX).toBe(102);
    expect(renderY).toBe(104);
  });

  it('interpolation at alpha=0.5 yields midpoint', () => {
    const unit = new Entity(UnitType.V_JEEP, House.Spain, 100, 100);
    unit.prevPos.x = 100;
    unit.prevPos.y = 100;
    unit.pos.x = 102;
    unit.pos.y = 104;

    const alpha = 0.5;
    const renderX = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * alpha;
    const renderY = unit.prevPos.y + (unit.pos.y - unit.prevPos.y) * alpha;
    expect(renderX).toBe(101);
    expect(renderY).toBe(102);
  });

  it('stationary entity has no interpolation drift', () => {
    const unit = new Entity(UnitType.V_JEEP, House.Spain, 200, 200);
    // Simulate a tick with no movement
    unit.prevPos.x = unit.pos.x;
    unit.prevPos.y = unit.pos.y;

    // Any alpha should return the same position
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
      const renderX = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * alpha;
      const renderY = unit.prevPos.y + (unit.pos.y - unit.prevPos.y) * alpha;
      expect(renderX).toBe(200);
      expect(renderY).toBe(200);
    }
  });

  it('JEEP sub-pixel movement produces smooth intermediate positions', () => {
    // JEEP speed=10, MPH_TO_PX=24/256=0.09375 → 0.9375 px/tick
    const speed = 10 * (CELL_SIZE / 256); // 0.9375 px/tick
    const unit = new Entity(UnitType.V_JEEP, House.Spain, 100, 100);

    // Simulate one tick of northward movement
    unit.prevPos.x = 100;
    unit.prevPos.y = 100;
    unit.pos.y = 100 - speed; // moved north

    // At 60fps render rate, 3 renders per tick (60/20=3)
    // Render 1: alpha≈0.33
    const r1y = unit.prevPos.y + (unit.pos.y - unit.prevPos.y) * 0.33;
    // Render 2: alpha≈0.67
    const r2y = unit.prevPos.y + (unit.pos.y - unit.prevPos.y) * 0.67;
    // Render 3: alpha≈1.0
    const r3y = unit.prevPos.y + (unit.pos.y - unit.prevPos.y) * 1.0;

    // Each render should show progressively more movement
    expect(r1y).toBeGreaterThan(r3y); // r1 is closer to start (less negative)
    expect(r2y).toBeGreaterThan(r3y);
    expect(r1y).toBeGreaterThan(r2y);

    // Increments should be roughly equal (linear interpolation)
    const inc1 = r1y - 100;
    const inc2 = r2y - r1y;
    expect(inc1).toBeCloseTo(inc2, 1); // 1 decimal precision (floating-point rounding)
  });

  it('tick interval is 50ms at 20fps game speed', () => {
    const tickInterval = 1000 / GAME_TICKS_PER_SEC;
    expect(tickInterval).toBe(50);
    // At 60fps render (16.67ms), roughly 3 renders per tick
    const rendersPerTick = tickInterval / (1000 / 60);
    expect(rendersPerTick).toBeCloseTo(3, 0);
  });
});
