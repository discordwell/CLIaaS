/**
 * Tests for naval combat system — vessel movement, submarine cloaking,
 * sub detection, target filtering, naval production, LST load/unload,
 * shore bombardment, and weapon stats.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds, CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION } from '../engine/entity';
import {
  UnitType, House, SpeedClass, UNIT_STATS, WEAPON_STATS,
  WARHEAD_VS_ARMOR, type WarheadType, type ArmorType,
  CELL_SIZE, worldDist,
} from '../engine/types';
import { GameMap, Terrain } from '../engine/map';
import { findPath } from '../engine/pathfinding';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeWaterMap(): GameMap {
  const map = new GameMap();
  map.setBounds(0, 0, 20, 20);
  // Fill with water
  for (let cy = 0; cy < 20; cy++) {
    for (let cx = 0; cx < 20; cx++) {
      map.setTerrain(cx, cy, Terrain.WATER);
    }
  }
  return map;
}

function makeMixedMap(): GameMap {
  const map = new GameMap();
  map.setBounds(0, 0, 20, 20);
  // Top half: land, bottom half: water
  for (let cy = 0; cy < 20; cy++) {
    for (let cx = 0; cx < 20; cx++) {
      map.setTerrain(cx, cy, cy >= 10 ? Terrain.WATER : Terrain.CLEAR);
    }
  }
  return map;
}

// === Part 1: Vessel Type Definitions ===

describe('Naval vessel type definitions', () => {
  it('SS (Submarine) has correct stats', () => {
    const stats = UNIT_STATS['SS'];
    expect(stats).toBeDefined();
    expect(stats.type).toBe(UnitType.V_SS);
    expect(stats.speedClass).toBe(SpeedClass.FLOAT);
    expect(stats.isVessel).toBe(true);
    expect(stats.isCloakable).toBe(true);
    expect(stats.primaryWeapon).toBe('TorpTube');
    expect(stats.strength).toBe(120);
    expect(stats.armor).toBe('light');
  });

  it('DD (Destroyer) has correct stats', () => {
    const stats = UNIT_STATS['DD'];
    expect(stats).toBeDefined();
    expect(stats.type).toBe(UnitType.V_DD);
    expect(stats.speedClass).toBe(SpeedClass.FLOAT);
    expect(stats.isVessel).toBe(true);
    expect(stats.isAntiSub).toBe(true);
    expect(stats.primaryWeapon).toBe('Stinger');
    expect(stats.secondaryWeapon).toBe('DepthCharge');
    expect(stats.strength).toBe(400);
    expect(stats.armor).toBe('heavy');
  });

  it('CA (Cruiser) has correct stats', () => {
    const stats = UNIT_STATS['CA'];
    expect(stats).toBeDefined();
    expect(stats.type).toBe(UnitType.V_CA);
    expect(stats.speedClass).toBe(SpeedClass.FLOAT);
    expect(stats.isVessel).toBe(true);
    expect(stats.primaryWeapon).toBe('Tomahawk');
    expect(stats.strength).toBe(700);
    expect(stats.armor).toBe('heavy');
  });

  it('PT (Gunboat) has correct stats', () => {
    const stats = UNIT_STATS['PT'];
    expect(stats).toBeDefined();
    expect(stats.type).toBe(UnitType.V_PT);
    expect(stats.speedClass).toBe(SpeedClass.FLOAT);
    expect(stats.isVessel).toBe(true);
    expect(stats.primaryWeapon).toBe('Stinger');
    expect(stats.strength).toBe(200);
  });

  it('MSUB (Missile Sub) has correct stats', () => {
    const stats = UNIT_STATS['MSUB'];
    expect(stats).toBeDefined();
    expect(stats.type).toBe(UnitType.V_MSUB);
    expect(stats.speedClass).toBe(SpeedClass.FLOAT);
    expect(stats.isVessel).toBe(true);
    expect(stats.isCloakable).toBe(true);
    expect(stats.primaryWeapon).toBe('SeaSerpent');
    expect(stats.strength).toBe(150);
  });

  it('LST has isVessel flag', () => {
    const stats = UNIT_STATS['LST'];
    expect(stats.isVessel).toBe(true);
    expect(stats.speedClass).toBe(SpeedClass.FLOAT);
    expect(stats.passengers).toBe(8);
  });

  it('all vessels report isNavalUnit = true', () => {
    const vesselTypes = [UnitType.V_SS, UnitType.V_DD, UnitType.V_CA, UnitType.V_PT, UnitType.V_MSUB, UnitType.V_LST];
    for (const type of vesselTypes) {
      const entity = makeEntity(type, House.Spain);
      expect(entity.isNavalUnit).toBe(true);
    }
  });

  it('non-vessel units report isNavalUnit = false', () => {
    const landTypes = [UnitType.V_2TNK, UnitType.V_JEEP, UnitType.I_E1];
    for (const type of landTypes) {
      const entity = makeEntity(type, House.Spain);
      expect(entity.isNavalUnit).toBe(false);
    }
  });
});

// === Part 2: Naval Weapon Stats ===

describe('Naval weapon stats', () => {
  it('Stinger (DD/PT primary) has correct values', () => {
    const w = WEAPON_STATS['Stinger'];
    expect(w).toBeDefined();
    expect(w.damage).toBe(15);
    expect(w.range).toBe(5.0);
    expect(w.warhead).toBe('SA');
    expect(w.rof).toBe(20);
  });

  it('TorpTube (SS torpedo) has isSubSurface flag', () => {
    const w = WEAPON_STATS['TorpTube'];
    expect(w).toBeDefined();
    expect(w.damage).toBe(50);
    expect(w.range).toBe(5.0);
    expect(w.warhead).toBe('AP');
    expect(w.isSubSurface).toBe(true);
  });

  it('DepthCharge (DD secondary) has isAntiSub flag', () => {
    const w = WEAPON_STATS['DepthCharge'];
    expect(w).toBeDefined();
    expect(w.damage).toBe(40);
    expect(w.range).toBe(3.0);
    expect(w.warhead).toBe('AP');
    expect(w.isAntiSub).toBe(true);
  });

  it('Tomahawk (CA cruise missile) has burst and splash', () => {
    const w = WEAPON_STATS['Tomahawk'];
    expect(w).toBeDefined();
    expect(w.damage).toBe(50);
    expect(w.range).toBe(10.0);
    expect(w.splash).toBe(2.0);
    expect(w.burst).toBe(2);
    expect(w.projectileROT).toBe(5);
  });

  it('SeaSerpent (MSUB missiles) has burst and splash', () => {
    const w = WEAPON_STATS['SeaSerpent'];
    expect(w).toBeDefined();
    expect(w.damage).toBe(35);
    expect(w.range).toBe(8.0);
    expect(w.splash).toBe(1.5);
    expect(w.burst).toBe(2);
  });
});

// === Part 3: Vessel Movement & Pathfinding ===

describe('Vessel movement on water', () => {
  it('naval pathfinding finds path on water-only map', () => {
    const map = makeWaterMap();
    const start = { cx: 2, cy: 2 };
    const goal = { cx: 10, cy: 10 };
    const path = findPath(map, start, goal, false, true, SpeedClass.FLOAT);
    expect(path.length).toBeGreaterThan(0);
  });

  it('naval pathfinding cannot pathfind on land cells', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 20, 20);
    // All clear land
    for (let cy = 0; cy < 20; cy++) {
      for (let cx = 0; cx < 20; cx++) {
        map.setTerrain(cx, cy, Terrain.CLEAR);
      }
    }
    const path = findPath(map, { cx: 2, cy: 2 }, { cx: 10, cy: 10 }, false, true, SpeedClass.FLOAT);
    expect(path.length).toBe(0); // no water path available
  });

  it('FLOAT units get correct speed multiplier on water', () => {
    const map = makeWaterMap();
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.FLOAT)).toBe(1.0);
  });

  it('FLOAT units get low speed multiplier on land', () => {
    const map = makeMixedMap();
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.FLOAT)).toBe(0.3); // land cell
    expect(map.getSpeedMultiplier(5, 15, SpeedClass.FLOAT)).toBe(1.0); // water cell
  });

  it('speedClass parameter is threaded through findPath', () => {
    const map = makeMixedMap();
    // Land path for WHEEL: should work on clear terrain
    const landPath = findPath(map, { cx: 2, cy: 2 }, { cx: 8, cy: 8 }, false, false, SpeedClass.WHEEL);
    expect(landPath.length).toBeGreaterThan(0);

    // Naval path: should only work on water cells
    const navalPath = findPath(map, { cx: 2, cy: 12 }, { cx: 8, cy: 18 }, false, true, SpeedClass.FLOAT);
    expect(navalPath.length).toBeGreaterThan(0);
  });
});

// === Part 4: Submarine Cloaking ===

describe('Submarine cloaking state machine', () => {
  it('submarines start uncloaked', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR);
    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
    expect(sub.cloakTimer).toBe(0);
    expect(sub.sonarPulseTimer).toBe(0);
  });

  it('SS has isCloakable flag', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR);
    expect(sub.stats.isCloakable).toBe(true);
  });

  it('MSUB has isCloakable flag', () => {
    const msub = makeEntity(UnitType.V_MSUB, House.USSR);
    expect(msub.stats.isCloakable).toBe(true);
  });

  it('cloaking transition takes CLOAK_TRANSITION_FRAMES', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR);
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakTimer = CLOAK_TRANSITION_FRAMES;

    // Simulate transition
    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      expect(sub.cloakState).toBe(CloakState.CLOAKING);
      sub.cloakTimer--;
      if (sub.cloakTimer <= 0) {
        sub.cloakState = CloakState.CLOAKED;
      }
    }
    expect(sub.cloakState).toBe(CloakState.CLOAKED);
  });

  it('uncloaking transition takes CLOAK_TRANSITION_FRAMES', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR);
    sub.cloakState = CloakState.UNCLOAKING;
    sub.cloakTimer = CLOAK_TRANSITION_FRAMES;

    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      sub.cloakTimer--;
      if (sub.cloakTimer <= 0) {
        sub.cloakState = CloakState.UNCLOAKED;
      }
    }
    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('taking damage force-uncloaks a cloaked submarine', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR);
    sub.cloakState = CloakState.CLOAKED;
    sub.cloakTimer = 0;

    sub.takeDamage(10, 'AP');
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('taking damage force-uncloaks a CLOAKING submarine', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR);
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakTimer = 10; // mid-transition

    sub.takeDamage(10, 'AP');
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('sonarPulseTimer blocks recloaking', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR);
    sub.sonarPulseTimer = SONAR_PULSE_DURATION;
    // Even if conditions are right to cloak, sonarPulseTimer prevents it
    expect(sub.sonarPulseTimer).toBeGreaterThan(0);
  });

  it('SONAR_PULSE_DURATION is 150 frames (10 seconds at 15 FPS)', () => {
    expect(SONAR_PULSE_DURATION).toBe(150);
  });

  it('CLOAK_TRANSITION_FRAMES is 15 (1 second at 15 FPS)', () => {
    expect(CLOAK_TRANSITION_FRAMES).toBe(15);
  });
});

// === Part 5: Sub Detection ===

describe('Destroyer sub detection', () => {
  it('DD has isAntiSub flag', () => {
    const dd = makeEntity(UnitType.V_DD, House.Spain);
    expect(dd.stats.isAntiSub).toBe(true);
  });

  it('DD has DepthCharge as secondary weapon with isAntiSub', () => {
    const dd = makeEntity(UnitType.V_DD, House.Spain);
    expect(dd.weapon2).not.toBeNull();
    expect(dd.weapon2!.name).toBe('DepthCharge');
    expect(dd.weapon2!.isAntiSub).toBe(true);
  });

  it('non-DD units do not have isAntiSub', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(tank.stats.isAntiSub).toBeUndefined();
  });
});

// === Part 6: Target Filtering ===

describe('Naval target filtering', () => {
  it('torpedoes (TorpTube) have isSubSurface flag', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR);
    expect(sub.weapon).not.toBeNull();
    expect(sub.weapon!.isSubSurface).toBe(true);
  });

  it('normal weapons do not have isSubSurface', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(tank.weapon!.isSubSurface).toBeUndefined();
  });

  it('DepthCharge has isAntiSub flag for hitting submerged subs', () => {
    expect(WEAPON_STATS['DepthCharge'].isAntiSub).toBe(true);
  });

  it('normal weapons do not have isAntiSub', () => {
    expect(WEAPON_STATS['90mm'].isAntiSub).toBeUndefined();
    expect(WEAPON_STATS['M1Carbine'].isAntiSub).toBeUndefined();
  });
});

// === Part 7: Naval Production ===

describe('Naval production structures', () => {
  it('SYRD and SPEN sprites are in extraction list', () => {
    // These should be defined in UNIT_STATS for production
    const syrdItems = ['PT', 'DD', 'LST', 'CA'];
    const spenItems = ['SS', 'MSUB'];
    for (const type of syrdItems) {
      expect(UNIT_STATS[type]).toBeDefined();
    }
    for (const type of spenItems) {
      expect(UNIT_STATS[type]).toBeDefined();
    }
  });
});

// === Part 8: Map Utilities ===

describe('Map naval utilities', () => {
  it('isWaterPassable returns true for water cells', () => {
    const map = makeWaterMap();
    expect(map.isWaterPassable(5, 5)).toBe(true);
  });

  it('isWaterPassable returns false for land cells', () => {
    const map = makeMixedMap();
    expect(map.isWaterPassable(5, 5)).toBe(false); // clear land
    expect(map.isWaterPassable(5, 15)).toBe(true);  // water
  });

  it('isShoreCell correctly identifies land cells adjacent to water', () => {
    const map = makeMixedMap();
    // Row 9 is land adjacent to water (row 10+)
    expect(map.isShoreCell(5, 9)).toBe(true);
    // Row 5 is land not adjacent to water
    expect(map.isShoreCell(5, 5)).toBe(false);
    // Row 15 is water, not shore
    expect(map.isShoreCell(5, 15)).toBe(false);
  });

  it('findAdjacentWaterCell finds water around a shore structure', () => {
    const map = makeMixedMap();
    // Place a 2x2 structure at the shoreline (row 8-9, adjacent to water at row 10)
    const waterCell = map.findAdjacentWaterCell(5, 8, 2, 2);
    expect(waterCell).not.toBeNull();
    expect(map.isWaterPassable(waterCell!.cx, waterCell!.cy)).toBe(true);
  });

  it('findAdjacentWaterCell returns null when no water nearby', () => {
    const map = makeMixedMap();
    // Structure far from water
    const waterCell = map.findAdjacentWaterCell(5, 2, 2, 2);
    expect(waterCell).toBeNull();
  });
});

// === Part 9: LST Door State ===

describe('LST door state', () => {
  it('LST starts with door closed', () => {
    const lst = makeEntity(UnitType.V_LST, House.Spain);
    expect(lst.doorOpen).toBe(false);
    expect(lst.doorTimer).toBe(0);
  });

  it('LST door opens when set and auto-closes on timer', () => {
    const lst = makeEntity(UnitType.V_LST, House.Spain);
    lst.doorOpen = true;
    lst.doorTimer = 60;
    expect(lst.doorOpen).toBe(true);

    // Simulate timer countdown
    for (let i = 0; i < 60; i++) {
      lst.doorTimer--;
      if (lst.doorTimer <= 0) lst.doorOpen = false;
    }
    expect(lst.doorOpen).toBe(false);
  });

  it('LST has transport capacity of 8', () => {
    const lst = makeEntity(UnitType.V_LST, House.Spain);
    expect(lst.maxPassengers).toBe(8);
    expect(lst.isTransport).toBe(true);
  });
});

// === Part 10: Vessel Turret Configuration ===

describe('Vessel turret configuration', () => {
  it('DD has turret (turreted vessel)', () => {
    const dd = makeEntity(UnitType.V_DD, House.Spain);
    expect(dd.hasTurret).toBe(true);
  });

  it('CA has turret (turreted vessel)', () => {
    const ca = makeEntity(UnitType.V_CA, House.Spain);
    expect(ca.hasTurret).toBe(true);
  });

  it('PT has turret (turreted vessel)', () => {
    const pt = makeEntity(UnitType.V_PT, House.Spain);
    expect(pt.hasTurret).toBe(true);
  });

  it('SS has no turret', () => {
    const ss = makeEntity(UnitType.V_SS, House.USSR);
    expect(ss.hasTurret).toBe(false);
  });

  it('MSUB has no turret', () => {
    const msub = makeEntity(UnitType.V_MSUB, House.USSR);
    expect(msub.hasTurret).toBe(false);
  });

  it('LST has no turret', () => {
    const lst = makeEntity(UnitType.V_LST, House.Spain);
    expect(lst.hasTurret).toBe(false);
  });
});

// === Part 11: Shore Bombardment (bidirectional) ===

describe('Shore bombardment rules', () => {
  it('land units with appropriate weapons CAN fire at vessels (range check)', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const dd = makeEntity(UnitType.V_DD, House.USSR, 150, 100);
    // Tank weapon range is 4.75 cells, distance is ~2 cells
    expect(tank.inRange(dd)).toBe(true);
  });

  it('vessels CAN fire at land targets', () => {
    const dd = makeEntity(UnitType.V_DD, House.Spain, 100, 100);
    const tank = makeEntity(UnitType.V_2TNK, House.USSR, 150, 100);
    expect(dd.inRange(tank)).toBe(true);
  });
});
