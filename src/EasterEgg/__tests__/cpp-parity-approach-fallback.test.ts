/**
 * C++ parity: FootClass::Approach_Target fallback via Map.Nearby_Location.
 *
 * When the approach sweep finds no clear in-range cell, foot.cpp:1010-1011
 * calls Map.Nearby_Location(trycell). SCG01EA's opening USSR E1 targeting a
 * Greek JEEP hits this path: the target cell and north/side cells are occupied,
 * so Frame % count at tick 1 selects the middle south cell.
 */

import { describe, it, expect } from 'vitest';
import { GameMap } from '../engine/map';
import { nearbyLocation } from '../engine/pathfinding';

function makeScg01eaOpeningApproachMap(): GameMap {
  const map = new GameMap();
  map.setBounds(40, 40, 50, 50);
  map.initDefault();

  // Target JEEP and flanking JEEPs.
  map.setVehicleOccupancy(62, 50, 29);
  map.setVehicleOccupancy(63, 50, 27);
  map.setVehicleOccupancy(64, 50, 30);

  // Allied infantry immediately north of the JEEPs.
  map.setOccupancy(62, 49, 46);
  map.setOccupancy(63, 49, 45);
  map.setOccupancy(64, 49, 44);

  return map;
}

describe('Approach_Target fallback through Nearby_Location', () => {
  it('selects Frame % count from the first clear ring around the blocked target cell', () => {
    const map = makeScg01eaOpeningApproachMap();

    expect(nearbyLocation(map, { cx: 63, cy: 50 }, false, 0)).toEqual({ cx: 62, cy: 51 });
    expect(nearbyLocation(map, { cx: 63, cy: 50 }, false, 1)).toEqual({ cx: 63, cy: 51 });
    expect(nearbyLocation(map, { cx: 63, cy: 50 }, false, 2)).toEqual({ cx: 64, cy: 51 });
  });
});
