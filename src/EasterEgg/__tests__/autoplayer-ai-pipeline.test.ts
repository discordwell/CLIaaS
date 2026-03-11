/**
 * AutoPlayer AI pipeline tests — comprehensive coverage of the bot AI
 * in autoPlayer.ts that plays ant missions to completion.
 *
 * Tests cover:
 * - Construction and initialization
 * - update() tick dispatch (reactive + strategic cadence)
 * - reactiveLayer() — guard units auto-engage enemies in aggro range
 * - strategicLayer() — focus-fire nearest enemy to army centroid
 * - Unit targeting logic and priority
 * - Attack coordination and pathfinding caps
 * - Edge cases: no units, no enemies, no armed units, mixed states
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutoPlayer } from '../engine/autoPlayer';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import {
  UnitType, House, Mission, CELL_SIZE, worldDist, worldToCell,
} from '../engine/types';
import { GameMap, Terrain } from '../engine/map';
import type { Game } from '../engine/index';

// ============================================================
// Test helpers
// ============================================================

beforeEach(() => {
  resetEntityIds();
  // Ant missions: Spain + Greece are player-controlled
  setPlayerHouses(new Set([House.Spain, House.Greece]));
});

/** Create a minimal GameMap for pathfinding (all CLEAR terrain). */
function makeMap(): GameMap {
  const cells = new Array(128 * 128).fill(Terrain.CLEAR);
  const map = new GameMap(cells, 0, 0, 128, 128);
  return map;
}

/** Shorthand entity factory. */
function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

/**
 * Build a minimal Game-like object that satisfies the subset of Game
 * used by AutoPlayer (entities, tick, map).
 */
function makeGame(entities: Entity[] = [], tick = 0): Game {
  return {
    entities,
    tick,
    map: makeMap(),
  } as unknown as Game;
}

// ============================================================
// Part 0: AutoPlayer construction and initialization
// ============================================================

describe('AutoPlayer construction', () => {
  it('can be instantiated without arguments', () => {
    const ap = new AutoPlayer();
    expect(ap).toBeInstanceOf(AutoPlayer);
  });

  it('update is callable with a Game-like object', () => {
    const ap = new AutoPlayer();
    const game = makeGame();
    // Should not throw
    ap.update(game);
  });

  it('first update at tick 0 runs reactive but not strategic', () => {
    // At tick=0, lastStrategicTick starts at 0, so
    // (0 - 0 >= 15) is false. Only reactive fires at tick 0.
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // Place ant far beyond aggro range (>12 cells = >288 px)
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 15 * CELL_SIZE, 100);
    const game = makeGame([player, ant], 0);
    ap.update(game);
    // Ant is beyond reactive aggro range (15 > 12 cells), and strategic doesn't fire at tick 0
    expect(player.mission).toBe(Mission.GUARD);
  });
});

// ============================================================
// Part 1: Reactive layer — GUARD-mode armed units engage nearby enemies
// ============================================================

describe('reactiveLayer', () => {
  it('armed GUARD unit attacks nearest enemy within aggro range (12 cells)', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // Place ant within 12 cells (12 * 24 = 288 px distance in cells)
    const antX = 100 + 10 * CELL_SIZE; // 10 cells away
    const ant = makeEntity(UnitType.ANT1, House.USSR, antX, 100);

    const game = makeGame([player, ant], 0);
    expect(player.mission).toBe(Mission.GUARD);
    expect(player.weapon).not.toBeNull();

    ap.update(game);

    expect(player.mission).toBe(Mission.ATTACK);
    expect(player.target).toBe(ant);
  });

  it('does not engage enemies beyond aggro range', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // Place ant beyond 12 cells
    const antX = 100 + 15 * CELL_SIZE; // 15 cells away
    const ant = makeEntity(UnitType.ANT1, House.USSR, antX, 100);

    const game = makeGame([player, ant], 0);
    ap.update(game);

    expect(player.mission).toBe(Mission.GUARD);
    expect(player.target).toBeNull();
  });

  it('picks the nearest enemy when multiple are in range', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // Ant A at 5 cells, Ant B at 10 cells
    const antA = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);
    const antB = makeEntity(UnitType.ANT2, House.USSR, 100 + 10 * CELL_SIZE, 100);

    const game = makeGame([player, antA, antB], 0);
    ap.update(game);

    expect(player.mission).toBe(Mission.ATTACK);
    expect(player.target).toBe(antA);
  });

  it('skips dead player units', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    player.alive = false;
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);

    const game = makeGame([player, ant], 0);
    ap.update(game);

    // Dead unit should remain unchanged
    expect(player.mission).toBe(Mission.GUARD);
    expect(player.target).toBeNull();
  });

  it('skips unarmed units (no weapon)', () => {
    const ap = new AutoPlayer();
    const engineer = makeEntity(UnitType.I_E6, House.Spain, 100, 100);
    // Engineers have no weapon
    expect(engineer.weapon).toBeNull();
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);

    const game = makeGame([engineer, ant], 0);
    ap.update(game);

    expect(engineer.mission).toBe(Mission.GUARD);
    expect(engineer.target).toBeNull();
  });

  it('skips units not in GUARD mission', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    player.mission = Mission.MOVE;
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);

    const game = makeGame([player, ant], 0);
    ap.update(game);

    expect(player.mission).toBe(Mission.MOVE);
    expect(player.target).toBeNull();
  });

  it('skips enemy units (only processes player units)', () => {
    const ap = new AutoPlayer();
    // An ant unit in GUARD mode should NOT be made to attack players
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100, 100);
    ant.mission = Mission.GUARD;
    const player = makeEntity(UnitType.I_E1, House.Spain, 100 + 5 * CELL_SIZE, 100);

    const game = makeGame([ant, player], 0);
    ap.update(game);

    // Ant should remain unchanged — AutoPlayer only handles player units
    expect(ant.target).toBeNull();
  });

  it('ignores dead enemies as targets', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const deadAnt = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);
    deadAnt.alive = false;

    const game = makeGame([player, deadAnt], 0);
    ap.update(game);

    expect(player.mission).toBe(Mission.GUARD);
    expect(player.target).toBeNull();
  });

  it('does not target friendly units as enemies', () => {
    const ap = new AutoPlayer();
    const player1 = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const player2 = makeEntity(UnitType.I_E3, House.Greece, 100 + 3 * CELL_SIZE, 100);

    const game = makeGame([player1, player2], 0);
    ap.update(game);

    // Should not attack a friendly unit
    expect(player1.target).toBeNull();
    expect(player1.mission).toBe(Mission.GUARD);
  });

  it('multiple player units each independently engage nearest enemy', () => {
    const ap = new AutoPlayer();
    const p1 = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const p2 = makeEntity(UnitType.I_E3, House.Spain, 100, 100 + 10 * CELL_SIZE);

    // Ant A near p1, Ant B near p2
    const antA = makeEntity(UnitType.ANT1, House.USSR, 100 + 3 * CELL_SIZE, 100);
    const antB = makeEntity(UnitType.ANT2, House.USSR, 100 + 3 * CELL_SIZE, 100 + 10 * CELL_SIZE);

    const game = makeGame([p1, p2, antA, antB], 0);
    ap.update(game);

    expect(p1.mission).toBe(Mission.ATTACK);
    expect(p1.target).toBe(antA);
    expect(p2.mission).toBe(Mission.ATTACK);
    expect(p2.target).toBe(antB);
  });
});

// ============================================================
// Part 2: Strategic layer — focus-fire nearest enemy to centroid
// ============================================================

describe('strategicLayer', () => {
  it('fires every 15 ticks (STRATEGIC_INTERVAL)', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // Put ant far away so reactive doesn't engage it
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([player, ant], 0);

    // Tick 0: strategic fires (0 - 0 >= 15 is false at init, but lastStrategicTick=0 → 0-0=0 < 15)
    // Strategic does NOT fire at tick 0
    ap.update(game);
    expect(player.mission).toBe(Mission.GUARD); // No reactive engagement (out of range)

    // Tick 14: still no strategic
    game.tick = 14;
    ap.update(game);
    expect(player.mission).toBe(Mission.GUARD);

    // Tick 15: strategic fires now
    game.tick = 15;
    ap.update(game);
    // Player should now be assigned to MOVE toward the ant (out of weapon range)
    expect(player.mission).toBe(Mission.MOVE);
    expect(player.moveTarget).not.toBeNull();
  });

  it('assigns idle/guard units to attack target in range', () => {
    const ap = new AutoPlayer();
    // Place player with weapon range sufficient to reach the ant
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // M1Carbine has range 3.0 cells — place ant at 2 cells
    const antX = 100 + 2 * CELL_SIZE;
    const ant = makeEntity(UnitType.ANT1, House.USSR, antX, 100);

    const game = makeGame([player, ant], 15);
    ap.update(game);

    // At tick 15, strategic fires. Ant is within weapon range (2 < 3 cells),
    // but reactive also fires first and catches it at GUARD + within 12 cells aggro.
    // Either way, the unit should be in ATTACK with the ant as target.
    expect(player.mission).toBe(Mission.ATTACK);
    expect(player.target).toBe(ant);
  });

  it('assigns idle units to MOVE toward distant target with path', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // Place ant way beyond aggro range AND weapon range
    const antX = 100 + 50 * CELL_SIZE;
    const ant = makeEntity(UnitType.ANT1, House.USSR, antX, 100);

    const game = makeGame([player, ant], 15);
    ap.update(game);

    expect(player.mission).toBe(Mission.MOVE);
    expect(player.target).toBeNull();
    expect(player.moveTarget).toEqual({ x: ant.pos.x, y: ant.pos.y });
    expect(player.path.length).toBeGreaterThan(0);
    expect(player.pathIndex).toBe(0);
  });

  it('does not re-assign units already attacking a live target', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const antA = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);
    const antB = makeEntity(UnitType.ANT2, House.USSR, 100 + 60 * CELL_SIZE, 100);

    // Pre-set player to already be attacking antA
    player.mission = Mission.ATTACK;
    player.target = antA;

    const game = makeGame([player, antA, antB], 15);
    ap.update(game);

    // Strategic should skip this unit because it's already attacking a live target
    expect(player.mission).toBe(Mission.ATTACK);
    expect(player.target).toBe(antA);
  });

  it('re-assigns units whose target has died', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const deadAnt = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);
    const liveAnt = makeEntity(UnitType.ANT2, House.USSR, 100 + 55 * CELL_SIZE, 100);

    // Pre-set player to attacking a dead ant
    player.mission = Mission.ATTACK;
    deadAnt.alive = false;
    player.target = deadAnt;

    const game = makeGame([player, deadAnt, liveAnt], 15);
    ap.update(game);

    // Strategic should re-assign to the live ant
    // Since live ant is beyond aggro range, strategic moves toward it
    expect(player.mission).toBe(Mission.MOVE);
    expect(player.moveTarget).toEqual({ x: liveAnt.pos.x, y: liveAnt.pos.y });
  });

  it('skips strategic if no armed player units exist', () => {
    const ap = new AutoPlayer();
    // Only unarmed units
    const eng = makeEntity(UnitType.I_E6, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([eng, ant], 15);
    ap.update(game);

    // Engineer has no weapon, so strategic skips (armed filter returns empty)
    expect(eng.mission).toBe(Mission.GUARD);
  });

  it('skips strategic if no enemies exist', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);

    const game = makeGame([player], 15);
    ap.update(game);

    // No enemies → strategic returns early
    expect(player.mission).toBe(Mission.GUARD);
  });

  it('caps pathfinding to MAX_PATHS_PER_TICK (5)', () => {
    const ap = new AutoPlayer();
    // Create 8 player units all in GUARD mode, all far from ant
    const players: Entity[] = [];
    for (let i = 0; i < 8; i++) {
      players.push(makeEntity(UnitType.I_E1, House.Spain, 100 + i * CELL_SIZE, 100));
    }
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([...players, ant], 15);
    ap.update(game);

    // Only 5 should have gotten paths (MAX_PATHS_PER_TICK=5)
    const movedUnits = players.filter(p => p.mission === Mission.MOVE && p.path.length > 0);
    expect(movedUnits.length).toBe(5);

    // The remaining 3 should still be in GUARD (or ATTACK via reactive if close enough)
    const guardUnits = players.filter(p => p.mission === Mission.GUARD);
    expect(guardUnits.length).toBe(3);
  });

  it('computes army centroid correctly for single unit', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 240, 480);
    // Place two ants: one closer to the player, one farther
    const antNear = makeEntity(UnitType.ANT1, House.USSR, 240 + 30 * CELL_SIZE, 480);
    const antFar = makeEntity(UnitType.ANT2, House.USSR, 240 + 60 * CELL_SIZE, 480);

    const game = makeGame([player, antNear, antFar], 15);
    ap.update(game);

    // With single player unit, centroid is at the player's position.
    // antNear is closer to centroid, so it should be the target.
    expect(player.moveTarget).toEqual({ x: antNear.pos.x, y: antNear.pos.y });
  });

  it('computes army centroid correctly for multiple units', () => {
    const ap = new AutoPlayer();
    // Two player units at (100,100) and (100 + 20*24, 100) = (580, 100)
    // Centroid = (340, 100)
    const p1 = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const p2 = makeEntity(UnitType.I_E1, House.Spain, 580, 100);

    // Ant A at (300, 100) — 40px from centroid = 1.67 cells
    // Ant B at (600, 100) — 260px from centroid = 10.83 cells
    const antA = makeEntity(UnitType.ANT1, House.USSR, 300, 100);
    const antB = makeEntity(UnitType.ANT2, House.USSR, 600, 100);

    const game = makeGame([p1, p2, antA, antB], 15);
    ap.update(game);

    // The nearest ant to centroid (340, 100) is antA at (300, 100)
    // p1 is in range of antA via reactive (< 12 cells), so reactive assigns it
    // p2 may or may not be in reactive range but strategic should target antA
    // Verify at least one unit targets antA
    const targetsAntA = [p1, p2].some(
      p => (p.target === antA) ||
           (p.moveTarget?.x === antA.pos.x && p.moveTarget?.y === antA.pos.y)
    );
    expect(targetsAntA).toBe(true);
  });
});

// ============================================================
// Part 3: update() cadence — reactive vs strategic timing
// ============================================================

describe('update() cadence', () => {
  it('reactive runs every tick', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);

    const game = makeGame([player, ant], 3);
    ap.update(game);

    // Reactive should fire at any tick
    expect(player.mission).toBe(Mission.ATTACK);
    expect(player.target).toBe(ant);
  });

  it('strategic fires again after another 15-tick interval', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([player, ant]);

    // First strategic at tick 15
    game.tick = 15;
    ap.update(game);
    expect(player.mission).toBe(Mission.MOVE);

    // Reset player to GUARD to test next strategic
    player.mission = Mission.GUARD;
    player.target = null;
    player.moveTarget = null;
    player.path = [];

    // Tick 29: strategic should NOT fire again
    game.tick = 29;
    ap.update(game);
    expect(player.mission).toBe(Mission.GUARD); // Only reactive, ant out of range

    // Tick 30: strategic fires again (30 - 15 = 15 >= 15)
    game.tick = 30;
    ap.update(game);
    expect(player.mission).toBe(Mission.MOVE);
  });
});

// ============================================================
// Part 4: Focus-fire coordination
// ============================================================

describe('focus-fire coordination', () => {
  it('all idle units focus on the same target', () => {
    const ap = new AutoPlayer();
    const players = [
      makeEntity(UnitType.I_E1, House.Spain, 100, 100),
      makeEntity(UnitType.I_E3, House.Spain, 120, 120),
      makeEntity(UnitType.I_E1, House.Spain, 140, 100),
    ];
    // Single ant far away
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([...players, ant], 15);
    ap.update(game);

    // All 3 should be MOVE toward the same ant
    for (const p of players) {
      expect(p.mission).toBe(Mission.MOVE);
      expect(p.moveTarget).toEqual({ x: ant.pos.x, y: ant.pos.y });
    }
  });

  it('units already attacking a live target continue independently', () => {
    const ap = new AutoPlayer();
    const p1 = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const p2 = makeEntity(UnitType.I_E1, House.Spain, 120, 100);

    const antA = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);
    const antB = makeEntity(UnitType.ANT2, House.USSR, 100 + 55 * CELL_SIZE, 100);

    // p1 is already attacking antB (alive)
    p1.mission = Mission.ATTACK;
    p1.target = antB;

    const game = makeGame([p1, p2, antA, antB], 15);
    ap.update(game);

    // p1 should keep attacking antB
    expect(p1.mission).toBe(Mission.ATTACK);
    expect(p1.target).toBe(antB);

    // p2 should be assigned to the nearest enemy to centroid
    expect(p2.mission).toBe(Mission.MOVE);
  });
});

// ============================================================
// Part 5: Edge cases and degenerate states
// ============================================================

describe('edge cases', () => {
  it('no entities at all — update does not throw', () => {
    const ap = new AutoPlayer();
    const game = makeGame([], 15);
    expect(() => ap.update(game)).not.toThrow();
  });

  it('only player units, no enemies — no state changes', () => {
    const ap = new AutoPlayer();
    const p1 = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const p2 = makeEntity(UnitType.I_E3, House.Spain, 200, 200);

    const game = makeGame([p1, p2], 15);
    ap.update(game);

    expect(p1.mission).toBe(Mission.GUARD);
    expect(p2.mission).toBe(Mission.GUARD);
  });

  it('only enemies, no player units — no state changes', () => {
    const ap = new AutoPlayer();
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100, 100);

    const game = makeGame([ant], 15);
    ap.update(game);

    expect(ant.mission).toBe(Mission.GUARD);
  });

  it('all player units are dead — no state changes', () => {
    const ap = new AutoPlayer();
    const p1 = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    p1.alive = false;
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);

    const game = makeGame([p1, ant], 15);
    ap.update(game);

    expect(p1.mission).toBe(Mission.GUARD);
    expect(p1.target).toBeNull();
  });

  it('all enemies are dead — no engagement', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);
    ant.alive = false;

    const game = makeGame([player, ant], 15);
    ap.update(game);

    expect(player.mission).toBe(Mission.GUARD);
    expect(player.target).toBeNull();
  });

  it('player units have no weapons — strategic skips entirely', () => {
    const ap = new AutoPlayer();
    // MCV has no weapon, engineer has no weapon
    const mcv = makeEntity(UnitType.V_MCV, House.Spain, 100, 100);
    const eng = makeEntity(UnitType.I_E6, House.Spain, 200, 200);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 300, 300);

    const game = makeGame([mcv, eng, ant], 15);
    ap.update(game);

    expect(mcv.mission).toBe(Mission.GUARD);
    expect(eng.mission).toBe(Mission.GUARD);
  });

  it('single player unit vs single enemy far away at strategic tick', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.V_2TNK, House.Spain, 48, 48);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 48 + 80 * CELL_SIZE, 48);

    const game = makeGame([player, ant], 15);
    ap.update(game);

    // Too far for reactive (>12 cells), strategic should MOVE toward it
    expect(player.mission).toBe(Mission.MOVE);
    expect(player.moveTarget).toEqual({ x: ant.pos.x, y: ant.pos.y });
  });

  it('enemy at exact aggro boundary (12 cells) is NOT engaged by reactive', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 0, 0);
    // Exactly 12 cells away — reactive uses < (not <=), so this should NOT trigger
    const ant = makeEntity(UnitType.ANT1, House.USSR, 12 * CELL_SIZE, 0);

    const dist = worldDist(player.pos, ant.pos);
    expect(dist).toBeCloseTo(12, 5); // exactly 12 cells

    const game = makeGame([player, ant], 0);
    ap.update(game);

    // nearestDist starts at AGGRO_RANGE (12), condition is dist < nearestDist
    // 12 < 12 is false → no engagement
    expect(player.mission).toBe(Mission.GUARD);
  });

  it('enemy just inside aggro boundary is engaged by reactive', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 0, 0);
    // 11.9 cells away
    const ant = makeEntity(UnitType.ANT1, House.USSR, Math.floor(11.9 * CELL_SIZE), 0);

    const dist = worldDist(player.pos, ant.pos);
    expect(dist).toBeLessThan(12);

    const game = makeGame([player, ant], 0);
    ap.update(game);

    expect(player.mission).toBe(Mission.ATTACK);
    expect(player.target).toBe(ant);
  });
});

// ============================================================
// Part 6: Unit type interactions
// ============================================================

describe('unit type interactions', () => {
  it('tanks engage ants via reactive layer', () => {
    const ap = new AutoPlayer();
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);

    const game = makeGame([tank, ant], 0);
    ap.update(game);

    expect(tank.mission).toBe(Mission.ATTACK);
    expect(tank.target).toBe(ant);
  });

  it('rocket soldiers engage ants', () => {
    const ap = new AutoPlayer();
    const rocket = makeEntity(UnitType.I_E3, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT2, House.USSR, 100 + 4 * CELL_SIZE, 100);

    const game = makeGame([rocket, ant], 0);
    ap.update(game);

    expect(rocket.mission).toBe(Mission.ATTACK);
    expect(rocket.target).toBe(ant);
  });

  it('Greece-housed units are treated as player units', () => {
    const ap = new AutoPlayer();
    const greeceUnit = makeEntity(UnitType.I_E1, House.Greece, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);

    const game = makeGame([greeceUnit, ant], 0);
    expect(greeceUnit.isPlayerUnit).toBe(true);
    ap.update(game);

    expect(greeceUnit.mission).toBe(Mission.ATTACK);
    expect(greeceUnit.target).toBe(ant);
  });

  it('USSR units are NOT treated as player units', () => {
    const ap = new AutoPlayer();
    const ussrUnit = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const spainUnit = makeEntity(UnitType.I_E1, House.Spain, 100 + 5 * CELL_SIZE, 100);

    const game = makeGame([ussrUnit, spainUnit], 0);
    expect(ussrUnit.isPlayerUnit).toBe(false);
    ap.update(game);

    // USSR unit should not be controlled by AutoPlayer
    expect(ussrUnit.mission).toBe(Mission.GUARD);
    expect(ussrUnit.target).toBeNull();
  });

  it('harvesters are included in reactive if they have no weapon (skip filter)', () => {
    const ap = new AutoPlayer();
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);

    const game = makeGame([harv, ant], 0);
    ap.update(game);

    // HARV has no primaryWeapon → weapon is null, so reactive skips it
    expect(harv.weapon).toBeNull();
    expect(harv.mission).toBe(Mission.GUARD);
  });

  it('strategic layer excludes dead armed units from centroid calc', () => {
    const ap = new AutoPlayer();
    // Two players: one dead, one alive
    const dead = makeEntity(UnitType.I_E1, House.Spain, 1000, 1000);
    dead.alive = false;
    const alive = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([dead, alive, ant], 15);
    ap.update(game);

    // Only the alive unit should be considered.
    // It should move toward the ant.
    expect(alive.mission).toBe(Mission.MOVE);
    expect(alive.moveTarget).toEqual({ x: ant.pos.x, y: ant.pos.y });
    // Dead unit unchanged
    expect(dead.mission).toBe(Mission.GUARD);
  });
});

// ============================================================
// Part 7: Strategic target selection — isAnt filter
// ============================================================

describe('strategic target selection (isAnt filter)', () => {
  it('only entities with isAnt=true are considered as enemies in strategic', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);

    // Non-ant USSR unit: should NOT be targeted by strategic (which filters on isAnt)
    const ussrInf = makeEntity(UnitType.I_E1, House.USSR, 100 + 50 * CELL_SIZE, 100);
    expect(ussrInf.isAnt).toBe(false);

    const game = makeGame([player, ussrInf], 15);
    ap.update(game);

    // Strategic filters enemies by isAnt — ussrInf is not an ant, so no strategic move
    expect(player.mission).toBe(Mission.GUARD);
  });

  it('ant types ANT1, ANT2, ANT3 all qualify as strategic targets', () => {
    for (const antType of [UnitType.ANT1, UnitType.ANT2, UnitType.ANT3]) {
      const ap = new AutoPlayer();
      resetEntityIds();
      const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
      const ant = makeEntity(antType, House.USSR, 100 + 50 * CELL_SIZE, 100);
      expect(ant.isAnt).toBe(true);

      const game = makeGame([player, ant], 15);
      ap.update(game);

      expect(player.mission).toBe(Mission.MOVE);
      expect(player.moveTarget).toEqual({ x: ant.pos.x, y: ant.pos.y });
    }
  });

  it('reactive layer uses isPlayerUnit check (not isAnt) for enemy filtering', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // A USSR infantry (not ant) within aggro range
    const ussrInf = makeEntity(UnitType.I_E1, House.USSR, 100 + 5 * CELL_SIZE, 100);
    expect(ussrInf.isPlayerUnit).toBe(false);
    expect(ussrInf.isAnt).toBe(false);

    const game = makeGame([player, ussrInf], 0);
    ap.update(game);

    // Reactive filters by !enemy.isPlayerUnit — USSR infantry qualifies as target
    expect(player.mission).toBe(Mission.ATTACK);
    expect(player.target).toBe(ussrInf);
  });
});

// ============================================================
// Part 8: State machine interactions — reactive then strategic
// ============================================================

describe('reactive-strategic interaction', () => {
  it('reactive fires before strategic in the same tick', () => {
    const ap = new AutoPlayer();
    // Player in GUARD, ant within reactive aggro range but also triggers strategic
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);

    const game = makeGame([player, ant], 15);
    ap.update(game);

    // Reactive runs first → sets mission=ATTACK, target=ant
    // Then strategic runs: unit.mission === ATTACK && unit.target?.alive → skip
    // Net result: ATTACK on the ant
    expect(player.mission).toBe(Mission.ATTACK);
    expect(player.target).toBe(ant);
  });

  it('reactive engagement prevents strategic from overriding', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    // Nearby ant (reactive) and faraway ant (strategic would pick this)
    const nearAnt = makeEntity(UnitType.ANT1, House.USSR, 100 + 5 * CELL_SIZE, 100);
    const farAnt = makeEntity(UnitType.ANT2, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([player, nearAnt, farAnt], 15);
    ap.update(game);

    // Reactive picks nearAnt (closer in aggro range)
    // Strategic sees player is already attacking live target → skips
    expect(player.mission).toBe(Mission.ATTACK);
    expect(player.target).toBe(nearAnt);
  });
});

// ============================================================
// Part 9: Constants verification
// ============================================================

describe('AutoPlayer constants', () => {
  it('AGGRO_RANGE is 12 cells', () => {
    // Verify by testing boundary behavior (already tested in edge cases)
    // This test confirms the value indirectly
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 0, 0);
    // 11 cells away — should engage
    const ant11 = makeEntity(UnitType.ANT1, House.USSR, 11 * CELL_SIZE, 0);
    const game11 = makeGame([player, ant11], 0);
    ap.update(game11);
    expect(player.mission).toBe(Mission.ATTACK);

    // Reset
    player.mission = Mission.GUARD;
    player.target = null;

    // 13 cells away — should NOT engage
    const ant13 = makeEntity(UnitType.ANT1, House.USSR, 13 * CELL_SIZE, 0);
    const game13 = makeGame([player, ant13], 0);
    ap.update(game13);
    expect(player.mission).toBe(Mission.GUARD);
  });

  it('STRATEGIC_INTERVAL is 15 ticks', () => {
    // Verify by testing that strategic fires at tick 15 but not 14
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([player, ant]);
    game.tick = 14;
    ap.update(game);
    expect(player.mission).toBe(Mission.GUARD); // no strategic

    game.tick = 15;
    ap.update(game);
    expect(player.mission).toBe(Mission.MOVE); // strategic fires
  });

  it('MAX_PATHS_PER_TICK is 5 (verified by path assignment count)', () => {
    const ap = new AutoPlayer();
    const players: Entity[] = [];
    for (let i = 0; i < 10; i++) {
      players.push(makeEntity(UnitType.I_E1, House.Spain, 100 + i * CELL_SIZE, 100));
    }
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([...players, ant], 15);
    ap.update(game);

    const withPaths = players.filter(p => p.mission === Mission.MOVE && p.path.length > 0);
    expect(withPaths.length).toBe(5);
  });
});

// ============================================================
// Part 10: Pathfinding integration
// ============================================================

describe('pathfinding integration', () => {
  it('path is computed from unit cell to target cell', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 2 * CELL_SIZE, 2 * CELL_SIZE);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 40 * CELL_SIZE, 2 * CELL_SIZE);

    const game = makeGame([player, ant], 15);
    ap.update(game);

    expect(player.path.length).toBeGreaterThan(0);
    // First element of path should be near the start
    // Last element should be at or near the ant's cell
    const targetCell = worldToCell(ant.pos.x, ant.pos.y);
    const lastCell = player.path[player.path.length - 1];
    expect(lastCell.cx).toBe(targetCell.cx);
    expect(lastCell.cy).toBe(targetCell.cy);
  });

  it('pathIndex is reset to 0 on new path assignment', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 2 * CELL_SIZE, 2 * CELL_SIZE);
    player.pathIndex = 99; // simulate old path progress
    const ant = makeEntity(UnitType.ANT1, House.USSR, 40 * CELL_SIZE, 2 * CELL_SIZE);

    const game = makeGame([player, ant], 15);
    ap.update(game);

    expect(player.pathIndex).toBe(0);
  });

  it('moveTarget is set to the enemy position', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([player, ant], 15);
    ap.update(game);

    expect(player.moveTarget).toEqual({ x: ant.pos.x, y: ant.pos.y });
  });

  it('target is set to null when moving (not attacking)', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([player, ant], 15);
    ap.update(game);

    expect(player.mission).toBe(Mission.MOVE);
    expect(player.target).toBeNull();
  });
});

// ============================================================
// Part 11: Sustained multi-tick simulation
// ============================================================

describe('sustained multi-tick simulation', () => {
  it('repeated updates converge units toward enemies', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 30 * CELL_SIZE, 100);

    const game = makeGame([player, ant]);

    // Run multiple strategic ticks
    for (let tick = 15; tick <= 60; tick += 15) {
      // Reset to GUARD to simulate unit not having arrived yet
      player.mission = Mission.GUARD;
      player.target = null;
      player.moveTarget = null;
      player.path = [];

      game.tick = tick;
      ap.update(game);

      // Each strategic tick re-assigns MOVE toward ant
      expect(player.mission).toBe(Mission.MOVE);
      expect(player.moveTarget).toEqual({ x: ant.pos.x, y: ant.pos.y });
    }
  });

  it('once enemy dies mid-simulation, units stop being assigned', () => {
    const ap = new AutoPlayer();
    const player = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 100 + 50 * CELL_SIZE, 100);

    const game = makeGame([player, ant]);

    // Tick 15: strategic assigns move
    game.tick = 15;
    ap.update(game);
    expect(player.mission).toBe(Mission.MOVE);

    // Kill the ant
    ant.alive = false;

    // Reset player state
    player.mission = Mission.GUARD;
    player.target = null;
    player.moveTarget = null;
    player.path = [];

    // Tick 30: strategic sees no alive enemies → does nothing
    game.tick = 30;
    ap.update(game);
    expect(player.mission).toBe(Mission.GUARD);
    expect(player.target).toBeNull();
  });
});
