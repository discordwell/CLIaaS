/**
 * C++ parity: scenario INI Power= overrides mutate BuildingTypeClass before
 * structures contribute to HouseClass::Power/Drain.
 *
 * References:
 *   bdata.cpp:3778-3781 — Power<0 becomes Class->Drain
 *   building.cpp:2431 — Grand_Opening adjusts house drain by Class->Drain
 *   building.cpp:4660-4668 — positive Class->Power is health-scaled output
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadScenario, type MapStructure } from '../engine/scenario';
import { calculatePowerGrid } from '../engine/repairSell';
import { House } from '../engine/types';

function installScenarioFetch(): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.pathname
        : input.url;
    const path = resolve(__dirname, '../../../public', url.replace(/^\//, ''));
    try {
      const text = readFileSync(path, 'utf8');
      return { ok: true, text: async () => text };
    } catch {
      return { ok: false, status: 404, text: async () => 'Not found' };
    }
  });
}

function makeStruct(type: string, power: number | undefined, hp = 400, maxHp = 400): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house: House.Spain,
    cx: 1,
    cy: 1,
    hp,
    maxHp,
    ...(power !== undefined ? { power } : {}),
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    missionTimer: 0,
  };
}

describe('scenario Power= overrides', () => {
  beforeEach(() => {
    installScenarioFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SCG08EA applies [AGUN] Power=-40 before computing the Greece grid', async () => {
    const scenario = await loadScenario('SCG08EA');
    const aguns = scenario.structures.filter(s => s.house === House.Greece && s.type === 'AGUN');

    expect(aguns).toHaveLength(2);
    expect(aguns.every(s => s.power === -40)).toBe(true);

    const grid = calculatePowerGrid(
      scenario.structures,
      scenario.playerHouse,
      (a, b) => a === b,
    );

    expect(scenario.playerHouse).toBe(House.Greece);
    expect(grid.produced).toBe(1200);
    expect(grid.consumed).toBe(1040);
  });

  it('calculatePowerGrid uses structure Power= overrides for production and drain', () => {
    const grid = calculatePowerGrid(
      [
        makeStruct('POWR', 150),
        makeStruct('AGUN', -40),
      ],
      House.Spain,
      (a, b) => a === b,
    );

    expect(grid).toEqual({ produced: 150, consumed: 40 });
  });
});
