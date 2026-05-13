/**
 * C++ parity: scenario BuildingClass mines are passable to enemy vehicles.
 *
 * SCG20EA tick 25 diverged because the BadGuy scout2 3TNK routed around Greek
 * MINV buildings, while C++ UnitClass::Can_Enter_Cell returns MOVE_OK for
 * non-allied STRUCT_AVMINE/STRUCT_APMINE (unit.cpp:3140-3143). This test uses
 * the real SCG20EA map and structures so it pins the gameplay rule, not a
 * harness-only first-divergence workaround.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MoveResult } from '../engine/map';
import { findPath } from '../engine/pathfinding';
import { CELL_SIZE, House, SpeedClass } from '../engine/types';
import { NodeAgentAdapter } from './node-agent-adapter';
import { ScenarioRandom } from '../engine/random';

	describe('scenario mine pathing parity', () => {
	  let adapter: NodeAgentAdapter | null = null;

	  beforeEach(() => {
	    ScenarioRandom.seed = 0;
	    ScenarioRandom.callCount = 0;
	    ScenarioRandom._sourceTag = 0;
	    ScenarioRandom._entityTag = 0;
	    ScenarioRandom._seedLog = [];
	    ScenarioRandom._taggedLog = [];
	    ScenarioRandom._tagLogging = false;
	    ScenarioRandom._tagLoggingExternal = false;
	  });

  afterEach(() => {
    adapter?.disconnect();
    adapter = null;
  });

  it('SCG20EA scout2 3TNK Basic_Path drives west through enemy MINV cells', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG20EA', 'normal');
    const game = (adapter as unknown as { game: any }).game;

    const tank = game.entities.find((e: any) =>
      e.type === '3TNK' &&
      e.house === House.BadGuy &&
      e.cell.cx === 31 &&
      e.cell.cy === 58);
    expect(tank, 'expected BadGuy 3TNK at scout2 start cell').toBeDefined();
    expect(game.structures.some((s: any) =>
      s.alive &&
      s.type === 'MINV' &&
      s.house === House.Greece &&
      s.cx === 29 &&
      s.cy === 58),
    'expected SCG20EA Greek MINV on the direct west path').toBe(true);

    const path = findPath(
      game.map,
      tank.cell,
      { cx: 17, cy: 57 },
      false,
      false,
      SpeedClass.TRACK,
      undefined,
      undefined,
      undefined,
      false,
      MoveResult.CLOAK,
      (cx, cy) => game.canEnterTrackJumpCell(tank, cx, cy),
    );

    expect(path.slice(0, 6)).toEqual([
      { cx: 30, cy: 58 },
      { cx: 29, cy: 58 },
      { cx: 28, cy: 58 },
      { cx: 27, cy: 58 },
      { cx: 26, cy: 58 },
      { cx: 25, cy: 58 },
    ]);
  });

  it('SCG20EA infantry mines do not hide vehicle reservations from Basic_Path', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG20EA', 'normal');
    const game = (adapter as unknown as { game: any }).game;

    adapter.step(25);

    const infantry = game.entities.find((e: any) =>
      e.type === 'E1' &&
      e.house === House.BadGuy &&
      e.cell.cx === 32 &&
      e.cell.cy === 58 &&
      !e.isDriving &&
      e.moveTarget);
    expect(infantry, 'expected the BadGuy E1 that repaths at SCG20EA tick 26').toBeDefined();

    const mine = game.structures.find((s: any) =>
      s.alive &&
      s.type === 'MINV' &&
      s.house === House.Greece &&
      s.cx === 29 &&
      s.cy === 58);
    expect(mine, 'expected the Greek AV mine in the reserved track cell').toBeDefined();
    expect(game.map.getVehicleTrackReservation(29, 58), 'expected 3TNK Mark_Track reservation over the mine').toBeGreaterThan(0);
    expect(game.infantryCanEnterCell(infantry, 29, 58, -1)).toBe(MoveResult.IMPASSABLE);

    const path = findPath(
      game.map,
      infantry.cell,
      {
        cx: Math.floor(infantry.moveTarget.lx / 256),
        cy: Math.floor(infantry.moveTarget.ly / 256),
      },
      false,
      false,
      SpeedClass.FOOT,
      undefined,
      undefined,
      undefined,
      true,
      MoveResult.CLOAK,
      (cx, cy, facing) => game.infantryCanEnterCell(infantry, cx, cy, facing),
    ) as Array<{ cx: number; cy: number }> & { facings?: number[] };

    expect(path.facings?.slice(0, 6)).toEqual([6, 7, 6, 5, 6, 6]);
    expect(path.slice(0, 4)).toEqual([
      { cx: 31, cy: 58 },
      { cx: 30, cy: 57 },
      { cx: 29, cy: 57 },
      { cx: 28, cy: 58 },
    ]);
  });

	  it('SCG20EA scout2 3TNK triggers the MINV only on PCP_END cell arrival', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG20EA', 'normal');
    const game = (adapter as unknown as { game: any }).game;

    const tank = game.entities.find((e: any) =>
      e.type === '3TNK' &&
      e.house === House.BadGuy &&
      e.cell.cx === 31 &&
      e.cell.cy === 58);
    const mine = game.structures.find((s: any) =>
      s.type === 'MINV' &&
      s.house === House.Greece &&
      s.cx === 29 &&
      s.cy === 58);
    expect(tank, 'expected BadGuy 3TNK at scout2 start cell').toBeDefined();
    expect(mine, 'expected SCG20EA Greek MINV on the direct west path').toBeDefined();

    adapter.step(40);
    expect(tank.alive, 'tank should still be alive before reaching mine cell center').toBe(true);
    expect(tank.hp, 'mine should not damage the tank before PCP_END').toBe(400);
    expect(mine.alive, 'mine should remain armed until PCP_END').toBe(true);

    adapter.step(1);
    expect(mine.alive, 'mine detonates on the cell-arrival PCP_END tick').toBe(false);
    expect(tank.alive, '3TNK survives one AV mine hit after armor reduction').toBe(true);
	    expect(tank.hp).toBe(100);
	  });

	  it('SCG20EA lethal MINV death runs UnitClass::Take_Damage aftermath', async () => {
	    adapter = new NodeAgentAdapter();
	    await adapter.loadScenario('SCG20EA', 'normal');
	    const game = (adapter as unknown as { game: any }).game;

	    adapter.step(88);
	    const tank = game.entities.find((e: any) =>
	      e.type === '3TNK' &&
	      e.house === House.BadGuy &&
	      e.cell.cx === 27 &&
	      e.cell.cy === 58);
	    const mine = game.structures.find((s: any) =>
	      s.type === 'MINV' &&
	      s.house === House.Greece &&
	      s.cx === 27 &&
	      s.cy === 58);
	    expect(tank, 'expected the damaged BadGuy 3TNK on the lethal mine cell before tick 89').toBeDefined();
	    expect(tank.hp).toBe(100);
	    expect(mine, 'expected the Greek MINV that kills the damaged 3TNK').toBeDefined();
	    expect(mine.alive).toBe(true);

	    adapter.step(1);

	    expect(tank.alive, 'tank should be destroyed by the second AV mine').toBe(false);
	    expect(mine.alive, 'lethal mine should be consumed').toBe(false);

	    const survivor = game.entities.find((e: any) =>
	      e.type === 'E1' &&
	      e.house === House.BadGuy &&
	      e.cell.cx === 27 &&
	      e.cell.cy === 58 &&
	      e.alive);
	    expect(survivor, 'C++ unit.cpp:1046-1058 spawns an E1 vehicle crew survivor here').toBeDefined();
	    expect(survivor.hp).toBe(11);
	    expect(survivor.moveTarget, 'InfantryClass::Scatter(0,true) should assign a scatter destination').toBeTruthy();

	    const deathAnimTypes = (game.logicAnims ?? [])
	      .filter((anim: any) => anim.x === 27 * CELL_SIZE + CELL_SIZE / 2 && anim.y === 58 * CELL_SIZE + CELL_SIZE / 2)
	      .map((anim: any) => anim.type);
	    expect(deathAnimTypes).toEqual(expect.arrayContaining(['veh-hit2', 'frag1']));
	  });
	});
