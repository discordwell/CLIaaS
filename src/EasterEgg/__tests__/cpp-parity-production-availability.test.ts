/**
 * C++ production parity: structure cameos require the building factory.
 *
 * A refinery/tech center can be a prerequisite for a structure type, but C++
 * still needs a live Construction Yard factory before the structure strip is
 * available.
 */

import { describe, expect, it } from 'vitest';
import { getAvailableItems, type ProductionContext } from '../engine/production';
import { type MapStructure } from '../engine/scenario';
import { House, type ProductionItem } from '../engine/types';
import { GameMap } from '../engine/map';

function structure(type: string, house = House.Greece): MapStructure {
  return {
    type,
    house,
    cx: 0,
    cy: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    direction: 0,
  } as MapStructure;
}

function ctxWith(structures: MapStructure[], items: ProductionItem[]): ProductionContext {
  const ctx = {
    structures,
    entities: [],
    entityById: new Map(),
    credits: 10000,
    playerHouse: House.Greece,
    playerFaction: 'allied',
    playerTechLevel: 10,
    baseDiscovered: true,
    scenarioProductionItems: items,
    productionQueue: new Map(),
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    map: new GameMap(),
    tick: 0,
    powerProduced: 100,
    powerConsumed: 0,
    builtUnitTypes: new Set(),
    builtInfantryTypes: new Set(),
    builtAircraftTypes: new Set(),
    rallyPoints: new Map(),
    isAllied: (a: House, b: House) => a === b,
    hasBuilding(type: string) {
      return structures.some(s => s.alive && s.type === type && s.house === House.Greece);
    },
    playSound: () => {},
    playEva: () => {},
    addEntity: () => {},
    findPassableSpawn: () => ({ cx: 0, cy: 0 }),
  } satisfies ProductionContext;
  return ctx;
}

describe('structure production availability', () => {
  it('does not show structure cameos without a Construction Yard factory', () => {
    const silo: ProductionItem = {
      type: 'SILO',
      name: 'Ore Silo',
      cost: 150,
      buildTime: 60,
      prerequisite: 'PROC',
      faction: 'both',
      isStructure: true,
      techLevel: 1,
    };

    expect(getAvailableItems(ctxWith([structure('PROC')], [silo]))).toEqual([]);
    expect(getAvailableItems(ctxWith([structure('FACT'), structure('PROC')], [silo]))).toEqual([silo]);
  });
});
