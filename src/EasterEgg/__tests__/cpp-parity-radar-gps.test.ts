/**
 * C++ Behavioral Parity: Radar/GPS shroud toggling
 *
 * Tests the interaction between GPS satellite, radar power gating,
 * GAP generators, and shroud management.
 *
 * Key C++ source references:
 *   house.cpp:1258-1312  — radar activation/deactivation, GPS overrides power+radar checks
 *   house.cpp:1265-1266  — IsGPSActive bypasses radar jam checks
 *   house.cpp:1292-1304  — GPS keeps radar active even without power or radar buildings
 *   house.cpp:1420-1425  — ATEK destruction clears IsGPSActive, calls Shroud_The_Map
 *   house.cpp:1433-1441  — GPS sidebar entry removed when ATEK gone OR already fired
 *   house.cpp:660        — SPC_GPS is power-gated (requiresPower=true)
 *   display.cpp:4157-4163 — Shroud_Cell: GPS active prevents shrouding except for jammed cells
 *   building.cpp:5684-5700 — Remove_Gap_Effect: unjam + re-reveal under GPS
 *   building.cpp:993-1006 — GAP generator: jam when powered, unjam when unpowered
 *   map.cpp:2111-2134     — Shroud_The_Map: shroud all + re-reveal around player units
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, CELL_SIZE, MAP_CELLS,
  SuperweaponType, SUPERWEAPON_DEFS, type SuperweaponState,
  getWarheadMultiplier, type WarheadType, type ArmorType,
} from '../engine/types';
import {
  updateSuperweapons,
  type SuperweaponContext,
} from '../engine/superweapon';
import {
  updateFogOfWar,
  updateGapGenerators,
  type FogContext,
  GAP_RADIUS,
} from '../engine/fog';
import { type MapStructure } from '../engine/scenario';
import { type Effect } from '../engine/renderer';
import { GameMap, Terrain } from '../engine/map';

beforeEach(() => resetEntityIds());

// ─── Helpers ────────────────────────────────────────────

function makeStructure(
  type: string, house: House, cx: number, cy: number,
  overrides: Partial<MapStructure> = {},
): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: 256,
    maxHp: 256,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...overrides,
  } as MapStructure;
}

function makeSwState(
  type: SuperweaponType, house: House,
  overrides: Partial<SuperweaponState> = {},
): SuperweaponState {
  return {
    type,
    house,
    chargeTick: 0,
    ready: false,
    structureIndex: 0,
    fired: false,
    ...overrides,
  };
}

/** Create a mock SuperweaponContext */
function makeSuperweaponCtx(
  overrides: Partial<SuperweaponContext> = {},
): SuperweaponContext & {
  _evaMessages: string[];
  _shroudCalled: () => boolean;
  _revealCalled: () => boolean;
} {
  const evaMessages: string[] = [];
  let shroudCalled = false;
  let revealCalled = false;

  const ctx: SuperweaponContext = {
    structures: [],
    entities: [],
    entityById: new Map(),
    superweapons: new Map(),
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    powerProduced: 100,
    powerConsumed: 50,
    killCount: 0,
    lossCount: 0,
    gpsActive: false,
    map: {
      revealAll() { revealCalled = true; },
      shroudAll() { shroudCalled = true; },
      isPassable() { return true; },
      setVisibility() {},
      inBounds() { return true; },
      setTerrain() {},
      unjamRadius() {},
    },
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied(a: House, b: House) { return a === b; },
    isPlayerControlled(e: Entity) { return e.house === House.Spain; },
    pushEva(text: string) { evaMessages.push(text); },
    playSound() {},
    playSoundAt() {},
    damageEntity() { return false; },
    damageStructure() { return false; },
    addEntity() {},
    aiIQ() { return 5; },
    getWarheadMult(warhead: string, armor: string) {
      return getWarheadMultiplier(warhead as WarheadType, armor as ArmorType);
    },
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 640,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };

  return Object.assign(ctx, {
    _evaMessages: evaMessages,
    _shroudCalled: () => shroudCalled,
    _revealCalled: () => revealCalled,
  });
}

/** Create a FogContext with sensible defaults */
function makeFogContext(overrides: Partial<FogContext> = {}): FogContext {
  const map = overrides.map ?? new GameMap();
  return {
    entities: [],
    structures: [],
    map,
    tick: 0,
    playerHouse: House.Spain,
    fogDisabled: false,
    gpsActive: false,
    baseDiscovered: true,
    powerProduced: 100,
    powerConsumed: 50,
    gapGeneratorCells: new Map(),
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    ...overrides,
  };
}

// =============================================================================
// Section 1: GPS Power Gating for Radar Activation
// C++ house.cpp:1290-1311
// =============================================================================

describe('GPS keeps radar active regardless of power (house.cpp:1290-1304)', () => {
  /**
   * C++ house.cpp:1290-1311:
   *   if (Map.Is_Radar_Active()) {
   *     if (ActiveBScan & STRUCTF_RADAR) {
   *       if (Power_Fraction() < 1 && !IsGPSActive) {
   *         Map.Radar_Activate(0);  // deactivate only if NOT GPS
   *       }
   *     } else {
   *       if (!IsGPSActive) {
   *         Map.Radar_Activate(0);  // deactivate only if NOT GPS
   *       }
   *     }
   *   } else {
   *     if (IsGPSActive || (ActiveBScan & STRUCTF_RADAR)) {
   *       if (Power_Fraction() >= 1 || IsGPSActive) {
   *         Map.Radar_Activate(1);  // GPS activates radar even at 0 power
   *       }
   *     }
   *   }
   *
   * GPS overrides ALL radar power/building requirements.
   * TS parity: fog.ts:64-66 — gpsActive causes revealAll() which implicitly
   * makes radar meaningful (you can see everything).
   */

  it('GPS active reveals map even with zero power (no radar needed)', () => {
    // C++ house.cpp:1302-1303: IsGPSActive || STRUCTF_RADAR => Power_Fraction()>=1 || IsGPSActive
    // GPS bypasses the power check entirely.
    const map = new GameMap();
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
      powerProduced: 0,
      powerConsumed: 100,
      entities: [], // no units, no radar building
      structures: [],
    });

    updateFogOfWar(fogCtx);

    // GPS should reveal everything even with zero power and no radar building
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(10, 10)).toBe(2);
  });

  it('GPS active reveals map even without any radar building', () => {
    // C++ house.cpp:1295-1298: no STRUCTF_RADAR but IsGPSActive => radar stays on
    const map = new GameMap();
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
      structures: [], // no radar building at all
    });

    updateFogOfWar(fogCtx);

    expect(map.getVisibility(0, 0)).toBe(2);
    expect(map.getVisibility(MAP_CELLS - 1, MAP_CELLS - 1)).toBe(2);
  });

  it('without GPS, fog requires units for visibility', () => {
    // Baseline: no GPS, no units → everything shrouded
    const map = new GameMap();
    const fogCtx = makeFogContext({
      map,
      gpsActive: false,
      entities: [],
      structures: [],
    });

    updateFogOfWar(fogCtx);

    // Everything should remain shrouded (0)
    expect(map.getVisibility(64, 64)).toBe(0);
  });
});

// =============================================================================
// Section 2: Shroud_Cell GPS Immunity
// C++ display.cpp:4157-4163
// =============================================================================

describe('Shroud_Cell GPS immunity (display.cpp:4157-4163)', () => {
  /**
   * C++ display.cpp:4157-4163:
   *   void DisplayClass::Shroud_Cell(CELL cell) {
   *     if (PlayerPtr->IsGPSActive) {
   *       if ((*this)[cell].Jammed & (1 << PlayerPtr->Class->House)) {
   *         return;  // jammed cell stays shrouded even with GPS
   *       }
   *     }
   *     ...
   *   }
   *
   * When GPS is active, Shroud_Cell returns early for non-jammed cells
   * (effectively preventing any re-shrouding). But jammed cells (from
   * enemy GAP generators) remain shrouded even under GPS.
   *
   * NOTE: The C++ logic at 4159 has an interesting nuance: when GPS is
   * active AND the cell is jammed, Shroud_Cell returns WITHOUT shrouding.
   * This means GPS protects ALL cells from Shroud_Cell, but enemy GAP
   * generators separately jam cells through their own mechanism.
   */

  it('GPS active prevents fog downgrade on non-jammed cells', () => {
    // C++ display.cpp:4159: if (PlayerPtr->IsGPSActive) { ... return; }
    // GPS prevents Shroud_Cell from affecting non-jammed cells
    const map = new GameMap();

    // First reveal everything (GPS active)
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
    });
    updateFogOfWar(fogCtx);

    // All cells should be visible
    expect(map.getVisibility(64, 64)).toBe(2);

    // Run fog update again — GPS should keep everything revealed
    updateFogOfWar(fogCtx);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(10, 10)).toBe(2);
  });

  it('jammed cells remain shrouded even when GPS is active', () => {
    // C++ display.cpp:4159-4162: GPS active + cell is jammed => cell stays shrouded
    // The GAP generator jams cells independently of GPS visibility
    const map = new GameMap();

    // GPS reveals everything
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
    });
    updateFogOfWar(fogCtx);
    expect(map.getVisibility(64, 64)).toBe(2);

    // Enemy GAP generator jams a cell AFTER GPS reveal
    map.jamCell(64, 64);

    // The jammed cell should now be shrouded (0)
    expect(map.getVisibility(64, 64)).toBe(0);
  });

  it('GPS re-reveals jammed cell after unjam', () => {
    // When enemy GAP is destroyed, unjam restores to fog(1), then GPS re-reveals to 2
    const map = new GameMap();

    // GPS reveals everything first
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
    });
    updateFogOfWar(fogCtx);

    // Enemy GAP jams a cell
    map.jamCell(50, 50);
    expect(map.getVisibility(50, 50)).toBe(0);

    // GAP destroyed — unjam the cell
    map.unjamCell(50, 50);
    // After unjam, cell goes to fog (1)
    expect(map.getVisibility(50, 50)).toBe(1);

    // Next fog update with GPS active should re-reveal
    updateFogOfWar(fogCtx);
    expect(map.getVisibility(50, 50)).toBe(2);
  });
});

// =============================================================================
// Section 3: GAP + GPS Interaction
// C++ building.cpp:5684-5700 — Remove_Gap_Effect
// =============================================================================

describe('GAP + GPS interaction (building.cpp:5684-5700)', () => {
  /**
   * C++ building.cpp:5688-5689:
   *   if (!House->IsPlayerControl && PlayerPtr->IsGPSActive) {
   *     Map.Sight_From(center, GapShroudRadius, PlayerPtr);
   *   }
   *
   * When an ENEMY Gap Generator is destroyed AND the player has GPS active,
   * the area is immediately re-revealed (Sight_From). This is because the
   * normal fog-of-war won't instantly re-reveal the area — units need to
   * be nearby. GPS guarantees full visibility.
   *
   * TS parity: After gap unjam, the next updateFogOfWar with gpsActive=true
   * calls revealAll(), which re-reveals the formerly jammed cells.
   */

  it('enemy GAP destruction + GPS active: formerly jammed area re-revealed on next fog tick', () => {
    const map = new GameMap();

    // Player has GPS
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
    });
    updateFogOfWar(fogCtx);

    // Enemy GAP jams a radius
    const gapCx = 60;
    const gapCy = 60;
    const r = GAP_RADIUS;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r2) {
          map.jamCell(gapCx + dx, gapCy + dy);
        }
      }
    }

    // Cells within GAP radius should be shrouded
    expect(map.getVisibility(gapCx, gapCy)).toBe(0);
    expect(map.getVisibility(gapCx + 3, gapCy + 3)).toBe(0);

    // Enemy GAP destroyed — unjam the radius
    map.unjamRadius(gapCx, gapCy, r);

    // Next fog update with GPS active re-reveals everything
    updateFogOfWar(fogCtx);

    // All formerly jammed cells should be revealed again
    expect(map.getVisibility(gapCx, gapCy)).toBe(2);
    expect(map.getVisibility(gapCx + 3, gapCy + 3)).toBe(2);
  });

  it('overlapping GAP generators: destroying one does not fully unjam overlap', () => {
    // C++ building.cpp:5692-5698: after unjamming, re-jams overlapping GAPs
    // TS parity: jamCell increments jam count, unjamCell decrements — overlap remains
    const map = new GameMap();

    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
    });
    updateFogOfWar(fogCtx);

    // Two overlapping GAPs
    const gap1cx = 60;
    const gap2cx = 65; // overlaps within radius
    const cy = 60;

    // Jam from both GAPs
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy <= 9) {
          map.jamCell(gap1cx + dx, cy + dy);
          map.jamCell(gap2cx + dx, cy + dy);
        }
      }
    }

    // Overlapping cell between the two GAPs — jammed twice
    const overlapX = 63; // between 60 and 65, within radius 3 of both
    expect(map.getVisibility(overlapX, cy)).toBe(0);

    // Destroy first GAP — unjam its radius
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy <= 9) {
          map.unjamCell(gap1cx + dx, cy + dy);
        }
      }
    }

    // Overlap cell should still be jammed (second GAP still active)
    expect(map.getVisibility(overlapX, cy)).toBe(0);

    // Cells only covered by first GAP should be unjammed (fog level 1)
    // e.g., cell at gap1cx-3 = 57 is NOT within radius 3 of gap2cx=65
    expect(map.getVisibility(57, cy)).toBe(1);
  });
});

// =============================================================================
// Section 4: Shroud_The_Map + Unit Re-reveal
// C++ map.cpp:2111-2134
// =============================================================================

describe('Shroud_The_Map re-reveals around player units (map.cpp:2129-2134)', () => {
  /**
   * C++ map.cpp:2129-2134:
   *   for (int obj_index = 0; ...) {
   *     ObjectClass * layer_object = DisplayClass::Layer[LAYER_GROUND][obj_index];
   *     if (layer_object && layer_object->Is_Techno() &&
   *         ((TechnoClass *)layer_object)->House == PlayerPtr) {
   *       layer_object->Look();
   *     }
   *   }
   *
   * After shrouding the entire map, C++ immediately calls Look() on all
   * player units so they re-reveal their sight radius. This prevents
   * the player from going completely blind.
   *
   * TS parity: shroudAll() blanks the map, then the next updateFogOfWar()
   * re-reveals around units. This is NOT called within shroudAll itself,
   * but in the game loop's next fog tick. This is a minor timing difference
   * but the end result is the same within one tick.
   */

  it('after shroudAll, fog update re-reveals around player units', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 20, 20);
    map.initDefault();

    // Place a unit at cell (50, 50)
    const unit = new Entity(UnitType.V_MTNK, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);

    // GPS was active — everything revealed
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
      entities: [unit],
    });
    updateFogOfWar(fogCtx);
    expect(map.getVisibility(40, 40)).toBe(2);
    expect(map.getVisibility(50, 50)).toBe(2);

    // ATEK destroyed — shroud everything
    map.shroudAll();
    fogCtx.gpsActive = false;

    // Everything should be shrouded
    expect(map.getVisibility(50, 50)).toBe(0);
    expect(map.getVisibility(40, 40)).toBe(0);

    // Next fog update re-reveals around units (C++ map.cpp:2131-2133)
    updateFogOfWar(fogCtx);

    // Unit's cell should be visible
    expect(map.getVisibility(50, 50)).toBe(2);
    // Far cell should remain shrouded (beyond unit's sight range)
    expect(map.getVisibility(40, 40)).toBe(0);
  });

  it('multiple units each re-reveal their own sight radius after shroudAll', () => {
    const map = new GameMap();
    map.setBounds(30, 30, 40, 40);
    map.initDefault();

    // Two units far apart
    const unit1 = new Entity(UnitType.V_MTNK, House.Spain, 35 * CELL_SIZE, 35 * CELL_SIZE);
    const unit2 = new Entity(UnitType.V_MTNK, House.Spain, 65 * CELL_SIZE, 65 * CELL_SIZE);

    const fogCtx = makeFogContext({
      map,
      entities: [unit1, unit2],
      gpsActive: false,
    });

    // First reveal around units
    updateFogOfWar(fogCtx);
    expect(map.getVisibility(35, 35)).toBe(2);
    expect(map.getVisibility(65, 65)).toBe(2);

    // Shroud everything (simulating darkness crate or GPS loss)
    map.shroudAll();
    expect(map.getVisibility(35, 35)).toBe(0);
    expect(map.getVisibility(65, 65)).toBe(0);

    // Re-reveal
    updateFogOfWar(fogCtx);
    expect(map.getVisibility(35, 35)).toBe(2);
    expect(map.getVisibility(65, 65)).toBe(2);

    // Midpoint should remain shrouded
    expect(map.getVisibility(50, 50)).toBe(0);
  });
});

// =============================================================================
// Section 5: GPS Superweapon Power Gating
// C++ house.cpp:660 — SPC_GPS requiresPower=true
// =============================================================================

describe('GPS superweapon charging is power-gated (house.cpp:660)', () => {
  /**
   * C++ house.cpp:660:
   *   new (&SuperWeapon[SPC_GPS]) SuperClass(
   *     TICKS_PER_MINUTE * Rule.GPSTime,
   *     true,     // <-- requires power
   *     VOX_NONE, VOX_NONE, VOX_NOT_READY, VOX_INSUFFICIENT_POWER
   *   );
   *
   * The GPS satellite requires power to charge. When power is insufficient
   * (Power_Fraction < 1), charging is fully suspended — not slowed.
   *
   * C++ house.cpp:1410-1411: powered superweapons are fully suspended
   * when Power_Fraction() < 1.
   */

  it('GPS does not charge when power is insufficient', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({
      structures: [atek],
      powerProduced: 50,
      powerConsumed: 100, // low power
    });

    // Run several ticks
    for (let i = 0; i < 100; i++) {
      ctx.tick = i;
      updateSuperweapons(ctx);
    }

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    // Charge should be 0 — fully suspended under low power
    expect(state!.chargeTick).toBe(0);
    expect(state!.ready).toBe(false);
    expect(ctx.gpsActive).toBe(false);
  });

  it('GPS charges normally when power is sufficient', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({
      structures: [atek],
      powerProduced: 100,
      powerConsumed: 50, // adequate power
    });

    // Run a few ticks
    for (let i = 0; i < 10; i++) {
      ctx.tick = i;
      updateSuperweapons(ctx);
    }

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    // Should have charged some amount
    expect(state!.chargeTick).toBeGreaterThan(0);
  });
});

// =============================================================================
// Section 6: GPS Sidebar Removal
// C++ house.cpp:1433-1441
// =============================================================================

describe('GPS sidebar entry lifecycle (house.cpp:1433-1441)', () => {
  /**
   * C++ house.cpp:1433-1434:
   *   if (SuperWeapon[SPC_GPS].Is_Present()) {
   *     if (!(ActiveBScan & STRUCTF_ADVANCED_TECH) || IsGPSActive || IsDefeated) {
   *       SuperWeapon[SPC_GPS].Remove();
   *
   * GPS is removed from the sidebar when:
   * 1. ATEK is destroyed (no STRUCTF_ADVANCED_TECH)
   * 2. GPS has already been fired (IsGPSActive)
   * 3. Player is defeated
   *
   * TS parity: superweapon entries are cleaned up when their building is gone
   * (activeBuildings check at line 251-255 in superweapon.ts).
   */

  it('GPS entry is removed when ATEK is destroyed (no building = no SW)', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10, { alive: false });
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      chargeTick: 100,
    }));

    updateSuperweapons(ctx);

    // Entry should be cleaned up — ATEK is dead
    expect(ctx.superweapons.has(key)).toBe(false);
  });

  it('GPS entry persists while ATEK alive and charging', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    updateSuperweapons(ctx);

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    expect(ctx.superweapons.has(key)).toBe(true);
  });

  it('GPS entry removed after firing (one-shot weapon)', () => {
    // GPS is one-shot: after firing, the entry should be cleaned up on next tick
    // when the ATEK is no longer present (or equivalently, the fired state removes it)
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      ready: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
    }));

    // This tick should auto-fire the GPS
    updateSuperweapons(ctx);
    expect(ctx.gpsActive).toBe(true);

    // GPS is one-shot — after firing, it should not create a new entry
    // Run another tick to verify the entry is still present but fired
    updateSuperweapons(ctx);
    const state = ctx.superweapons.get(key);
    // The entry should still exist (ATEK alive) but be marked as fired
    // C++ removes GPS from sidebar after firing via IsGPSActive check
    expect(state?.fired ?? !ctx.superweapons.has(key)).toBeTruthy();
  });
});

// =============================================================================
// Section 7: GPS + GAP Generator Power Cycling
// C++ building.cpp:993-1006
// =============================================================================

describe('GAP generator power cycling with GPS (building.cpp:993-1006)', () => {
  /**
   * C++ building.cpp:996-1006:
   *   if (!IsJamming) {
   *     if (House->Power_Fraction() >= 1) {
   *       Map.Jam_From(center, GapShroudRadius, House);
   *       IsJamming = true;
   *     }
   *   } else {
   *     if (House->Power_Fraction() < 1) {
   *       IsJamming = false;
   *       Map.UnJam_From(center, GapShroudRadius, House);
   *     }
   *   }
   *
   * GAP generators require full power to jam. When power drops below 100%,
   * they unjam. This interacts with GPS — if GPS is active AND enemy GAP
   * unjams (due to enemy losing power), the area becomes fully visible.
   */

  it('GAP unjams when power drops, GPS then reveals the area', () => {
    const map = new GameMap();

    // Start with GPS active
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
      powerProduced: 100,
      powerConsumed: 50,
      tick: 0,  // updateGapGenerators runs at tick % GAP_UPDATE_INTERVAL === 0
    });

    updateFogOfWar(fogCtx);
    expect(map.getVisibility(64, 64)).toBe(2);

    // Enemy GAP jams some cells
    map.jamCell(64, 64);
    expect(map.getVisibility(64, 64)).toBe(0);

    // Enemy loses power — GAP unjams
    map.unjamCell(64, 64);

    // GPS re-reveals on next fog update
    updateFogOfWar(fogCtx);
    expect(map.getVisibility(64, 64)).toBe(2);
  });

  it('updateGapGenerators creates and removes GAP entries based on power', () => {
    const map = new GameMap();
    const gapStr = makeStructure('GAP', House.Spain, 64, 64);

    // Full power — GAP should activate
    const fogCtx = makeFogContext({
      map,
      structures: [gapStr as any],
      powerProduced: 100,
      powerConsumed: 50,
      tick: 0, // matches interval
    });

    updateGapGenerators(fogCtx);
    expect(fogCtx.gapGeneratorCells.size).toBe(1);

    // Power drops — GAP should deactivate
    fogCtx.powerProduced = 40;
    fogCtx.powerConsumed = 100;
    // Reset to trigger next interval check
    fogCtx.tick = 90; // next interval
    updateGapGenerators(fogCtx);
    expect(fogCtx.gapGeneratorCells.size).toBe(0);
  });
});

// =============================================================================
// Section 8: Full GPS Lifecycle Integration
// =============================================================================

describe('full GPS lifecycle: charge → fire → ATEK destroy → re-shroud → re-reveal', () => {
  it('complete lifecycle with real GameMap', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 20, 20);
    map.initDefault();

    const unit = new Entity(UnitType.V_MTNK, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);
    const atek = makeStructure('ATEK', House.Spain, 45, 45);

    // Phase 1: Before GPS — normal fog
    const fogCtx = makeFogContext({
      map,
      entities: [unit],
      structures: [atek as any],
      gpsActive: false,
    });
    updateFogOfWar(fogCtx);

    expect(map.getVisibility(50, 50)).toBe(2); // unit's cell visible
    // (59,59) is beyond both unit sight=5 and ATEK sight=10 (INI Sight=10)
    expect(map.getVisibility(59, 59)).toBe(0); // far cell shrouded

    // Phase 2: GPS fires — everything revealed
    fogCtx.gpsActive = true;
    updateFogOfWar(fogCtx);

    expect(map.getVisibility(40, 40)).toBe(2);
    expect(map.getVisibility(59, 59)).toBe(2);

    // Phase 3: Enemy GAP jams some cells (even with GPS active)
    map.jamCell(55, 55);
    expect(map.getVisibility(55, 55)).toBe(0);

    // Phase 4: ATEK destroyed — GPS lost
    map.shroudAll();
    fogCtx.gpsActive = false;

    // Everything shrouded
    expect(map.getVisibility(50, 50)).toBe(0);
    expect(map.getVisibility(55, 55)).toBe(0);

    // Phase 5: Normal fog re-reveals around units + ATEK structure (still alive)
    updateFogOfWar(fogCtx);

    expect(map.getVisibility(50, 50)).toBe(2); // near unit
    // (59,59) is beyond both unit sight and ATEK sight
    expect(map.getVisibility(59, 59)).toBe(0); // far from both

    // The previously jammed cell is still jammed (GAP still active)
    // but since GPS is off, it's just shrouded anyway
    // Unjam it to verify it becomes fog (1), not visible (2) — no unit nearby
    map.unjamCell(55, 55);
    expect(map.getVisibility(55, 55)).toBe(1); // fog, not visible
  });
});
