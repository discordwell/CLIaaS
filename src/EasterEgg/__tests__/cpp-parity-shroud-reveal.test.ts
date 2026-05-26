/**
 * C++ Behavioral Parity: Map Shroud Reveal Rules — AllyReveal, ShroudRate
 *
 * Tests fog-of-war reveal mechanics against the authoritative C++ source.
 * rules.ini is the authoritative source for all constants.
 *
 * === Authoritative INI Values ===
 *   rules.ini [General] line 91:  AllyReveal=yes
 *   rules.ini [General] line 102: ShroudRate=4
 *
 * === C++ Source References ===
 *
 * AllyReveal:
 *   rules.h:549      — unsigned IsAllyReveal:1;
 *   rules.cpp:191    — IsAllyReveal(true) [constructor default]
 *   rules.cpp:484    — IsAllyReveal = ini.Get_Bool(GENERAL, "AllyReveal", IsAllyReveal);
 *   house.cpp:2158   — if (Rule.IsAllyReveal && house == PlayerPtr->Class->House) {
 *                        for each building: Map.Sight_From(coord, SightRange, PlayerPtr, false);
 *                      }
 *   Behavior: When a house forms an alliance with the player, all buildings
 *             belonging to the allying house reveal fog around themselves.
 *             This is a ONE-TIME reveal at alliance formation time.
 *
 * ShroudRate:
 *   rules.h:634      — fixed ShroudRate; ("minutes between each shroud regrowth process")
 *   rules.cpp:206    — ShroudRate(4) [constructor default]
 *   rules.cpp:498    — ShroudRate = ini.Get_Fixed(GENERAL, "ShroudRate", ShroudRate);
 *   logic.cpp:256-258 — if (Special.IsShadowGrow && Rule.ShroudRate != 0 && Scen.ShroudTimer == 0) {
 *                          Scen.ShroudTimer = TICKS_PER_MINUTE * Rule.ShroudRate;
 *                          Map.Encroach_Shadow();
 *                        }
 *   scenario.cpp:136 — ShroudTimer(TICKS_PER_MINUTE * Rule.ShroudRate) [constructor init]
 *
 * Encroach_Shadow (display.cpp:4109-4136):
 *   - Targets only fog cells (IsMapped && !IsVisible) — NOT already-shrouded cells.
 *   - Sets those cells to fully shrouded (IsMapped=false, IsVisible=false).
 *   - Then calls All_To_Look() to re-reveal around player units.
 *
 * Shroud_Cell (display.cpp:4157-4198):
 *   - If IsGPSActive, skip (unless cell is gap-jammed).
 *   - Sets cell to IsMapped=false, IsVisible=false (full shroud).
 *   - Also sets adjacent cells IsVisible=false.
 *
 * Dead units: When a unit dies, cells transition from visible (2) to fog (1),
 *   not to shroud (0). C++ Sight_From only runs for alive units; previously
 *   revealed cells remain IsMapped=true (fog), not re-shrouded.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import {
  UnitType, House, CELL_SIZE, MAP_CELLS,
  GAME_TICKS_PER_SEC,
} from '../engine/types';
import { updateFogOfWar, type FogContext, STRUCTURE_SIGHT } from '../engine/fog';
import { type MapStructure } from '../engine/scenario';
import { GameMap } from '../engine/map';
import { parseIniSections } from '../engine/parseIni';

// ---------------------------------------------------------------------------
// Parse rules.ini (authoritative source)
// ---------------------------------------------------------------------------

const rulesText = readFileSync(
  resolve(__dirname, '../../../public/ra/assets/rules.ini'),
  'utf-8',
);
const sections = parseIniSections(rulesText);
const general = sections.get('General')!;

const TICKS_PER_MINUTE = GAME_TICKS_PER_SEC * 60; // 15 * 60 = 900

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetEntityIds();
  // Set player houses so Entity.isPlayerUnit works correctly
  setPlayerHouses(new Set([House.Spain]));
});

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

function makeEntity(
  type: string, house: House, x: number, y: number,
  sight: number,
  overrides: Partial<Entity> = {},
): Entity {
  // Entity constructor: (type, house, x, y) — uses UNIT_STATS[type] for stats.
  // E1 is a safe default infantry type with sight=4.
  const e = new Entity(type as UnitType, house, x, y);
  // Override sight if needed (the default from UNIT_STATS may differ)
  if (e.stats.sight !== sight) {
    e.stats = { ...e.stats, sight };
  }
  // isPlayerUnit is a getter based on setPlayerHouses() — do not set directly.
  const { isPlayerUnit: _ignored, ...safeOverrides } = overrides as any;
  if (Object.keys(safeOverrides).length > 0) {
    Object.assign(e, safeOverrides);
  }
  return e;
}

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
    allyReveal: true,
    powerProduced: 100,
    powerConsumed: 50,
    gapGeneratorCells: new Map(),
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    ...overrides,
  };
}

// ==========================================================================
// Section 1: rules.ini [General] AllyReveal and ShroudRate values
// ==========================================================================

describe('rules.ini [General] shroud constants', () => {
  it('AllyReveal=yes — rules.ini line 91', () => {
    const ini = general.get('AllyReveal')!.toLowerCase();
    expect(ini).toBe('yes');
  });

  it('ShroudRate=4 — rules.ini line 102', () => {
    const ini = parseInt(general.get('ShroudRate')!, 10);
    expect(ini).toBe(4);
  });

  it('ShroudRate in ticks = 4 * TICKS_PER_MINUTE = 3600', () => {
    // C++ logic.cpp:257 — Scen.ShroudTimer = TICKS_PER_MINUTE * Rule.ShroudRate
    const iniMinutes = parseFloat(general.get('ShroudRate')!);
    const expectedTicks = iniMinutes * TICKS_PER_MINUTE;
    expect(expectedTicks).toBe(3600);
  });

  it('ShroudRate=0 disables periodic reshroud (C++ logic.cpp:256)', () => {
    // C++ logic.cpp:256: if (Special.IsShadowGrow && Rule.ShroudRate != 0 ...)
    // ShroudRate=0 means no automatic shadow creep
    const iniMinutes = parseFloat(general.get('ShroudRate')!);
    expect(iniMinutes).not.toBe(0); // Default rules.ini has ShroudRate=4, not 0
  });
});

// ==========================================================================
// Section 2: AllyReveal — allied structures reveal fog on alliance formation
// C++ house.cpp:2158-2166
// ==========================================================================

describe('AllyReveal — allied structures reveal fog (C++ house.cpp:2158)', () => {
  it('allied structures contribute to fog reveal when isAllied returns true', () => {
    // C++ behavior: when AllyReveal=yes, buildings of the allying house
    // call Map.Sight_From() — the TS fog system should reveal around
    // allied structures in updateFogOfWar().
    const map = new GameMap();
    const structCx = 64;
    const structCy = 64;
    const structure = makeStructure('FACT', House.Greece, structCx, structCy);

    const ctx = makeFogContext({
      map,
      structures: [structure],
      // Greece is allied with Spain (player)
      isAllied: (a, b) => a === b || (a === House.Spain && b === House.Greece)
                                   || (a === House.Greece && b === House.Spain),
    });

    updateFogOfWar(ctx);

    // The allied structure should have revealed cells around it
    const sight = STRUCTURE_SIGHT['FACT'] ?? 0;
    expect(map.getVisibility(structCx, structCy)).toBe(2);
    // Check a cell within sight range is visible
    expect(map.getVisibility(structCx + 1, structCy)).toBe(2);
    // Check a cell well outside sight range is not visible
    expect(map.getVisibility(structCx + sight + 5, structCy + sight + 5)).toBe(0);
  });

  it('non-allied structures do NOT reveal fog', () => {
    const map = new GameMap();
    const structure = makeStructure('FACT', House.USSR, 64, 64);

    const ctx = makeFogContext({
      map,
      structures: [structure],
      // USSR is NOT allied with Spain
      isAllied: (a, b) => a === b,
    });

    updateFogOfWar(ctx);

    // Enemy structure should NOT reveal any cells
    expect(map.getVisibility(64, 64)).toBe(0);
  });

  it('AllyReveal=no prevents allied structures from revealing fog', () => {
    const map = new GameMap();
    const structure = makeStructure('FACT', House.Greece, 64, 64);

    const ctx = makeFogContext({
      map,
      structures: [structure],
      allyReveal: false,
      isAllied: (a, b) => a === b || (a === House.Spain && b === House.Greece)
                                 || (a === House.Greece && b === House.Spain),
    });

    updateFogOfWar(ctx);

    expect(map.getVisibility(64, 64)).toBe(0);
  });

  it('dead allied structures do NOT reveal fog', () => {
    const map = new GameMap();
    const structure = makeStructure('FACT', House.Spain, 64, 64, { alive: false });

    const ctx = makeFogContext({
      map,
      structures: [structure],
    });

    updateFogOfWar(ctx);

    expect(map.getVisibility(64, 64)).toBe(0);
  });

  /**
   * MISMATCH: C++ AllyReveal triggers a ONE-TIME reveal of all buildings
   * belonging to the newly allied house at the moment Make_Ally is called
   * (house.cpp:2158-2166). The TS has no equivalent one-shot mechanism —
   * it relies on the per-tick updateFogOfWar() which includes allied
   * structures. This means the TS reveals continuously (correct ongoing
   * behavior) but lacks the C++ one-time alliance event trigger.
   *
   * In practice this is functionally equivalent for campaign missions
   * because updateFogOfWar runs every tick, so allied structures will
   * be revealed starting from the next tick after alliance formation.
   */
  it('C++ AllyReveal is a one-time event on Make_Ally — TS reveals every tick via updateFogOfWar', () => {
    // This documents the behavioral difference:
    // C++ calls Map.Sight_From() once per building when Make_Ally fires.
    // TS includes allied structures in updateFogOfWar() every tick.
    // Net effect is the same: allied buildings reveal fog around them.
    const map = new GameMap();
    const structure = makeStructure('TENT', House.Greece, 64, 64);

    const ctx = makeFogContext({
      map,
      structures: [structure],
      isAllied: (a, b) => a === b || (a === House.Spain && b === House.Greece)
                                   || (a === House.Greece && b === House.Spain),
    });

    // First tick reveals the area
    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(2);

    // Second tick — still visible (continuous reveal, not one-shot)
    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(2);
  });
});

// ==========================================================================
// Section 3: ShroudRate — periodic map reshroud timer
// C++ logic.cpp:256-258, display.cpp:4109-4136
// ==========================================================================

describe('ShroudRate — periodic reshroud mechanics (C++ logic.cpp:256-258)', () => {
  /**
   * MISMATCH: C++ has a periodic reshroud timer in logic.cpp:
   *   if (Special.IsShadowGrow && Rule.ShroudRate != 0 && Scen.ShroudTimer == 0)
   *     Scen.ShroudTimer = TICKS_PER_MINUTE * Rule.ShroudRate;
   *     Map.Encroach_Shadow();
   *
   * The TS has NO periodic ShroudRate timer. The only reshroud mechanism is
   * TACTION_CREEP_SHADOW (trigger action 31) which calls map.creepShadow().
   * There is no automatic reshroud based on ShroudRate.
   */
  it('MISMATCH: TS lacks periodic ShroudRate timer (C++ logic.cpp:256-258)', () => {
    // C++ periodic reshroud fires every ShroudRate minutes when IsShadowGrow=true.
    // ShroudRate=4 means every 3600 ticks.
    // TS has no equivalent — creepShadow is only trigger-driven.
    const iniMinutes = parseFloat(general.get('ShroudRate')!);
    expect(iniMinutes).toBe(4);

    // The TS GameMap has creepShadow() but it's only called from trigger actions,
    // not from a periodic timer. Verify creepShadow exists but document the gap.
    const map = new GameMap();
    expect(typeof map.creepShadow).toBe('function');
  });

  it('C++ ShroudRate requires Special.IsShadowGrow=true to activate', () => {
    // C++ logic.cpp:256: if (Special.IsShadowGrow && Rule.ShroudRate != 0 ...)
    // In single-player campaigns, IsShadowGrow is typically false.
    // In multiplayer, it's configurable via [MultiplayerDefaults] ShadowGrow=no.
    const shadowGrow = general.get('ShadowGrow');
    // ShadowGrow is in [MultiplayerDefaults], not [General] — verify it's absent from General
    // The key gate is Special.IsShadowGrow which defaults to false for SP campaigns.
    expect(shadowGrow).toBeUndefined();
  });
});

// ==========================================================================
// Section 4: Encroach_Shadow — selective fog-to-shroud downgrade
// C++ display.cpp:4109-4136
// ==========================================================================

describe('Encroach_Shadow vs creepShadow (display.cpp:4109-4136)', () => {
  it('shrouds mapped display-edge cells, not fully visible cells', () => {
    // C++ display.cpp:4115: if (cellptr->IsVisible || !cellptr->IsMapped) continue;
    // Map_Cell's IsVisible flag means the cell is no longer a display shroud
    // edge. Edge cells can still be inside a unit sight radius and get shrouded
    // until All_To_Look maps them again.
    const map = new GameMap();

    map.updateFogOfWar([{
      x: 64 * CELL_SIZE + CELL_SIZE / 2,
      y: 64 * CELL_SIZE + CELL_SIZE / 2,
      sight: 5,
    }]);

    expect(map.getDisplayVisibility(64, 64)).toBe(2);
    expect(map.getDisplayVisibility(69, 64)).toBe(1);
    map.creepShadow();

    expect(map.getDisplayVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getDisplayVisibility(69, 64)).toBe(0);
    expect(map.getVisibility(69, 64)).toBe(0);
  });

  it('C++ Encroach_Shadow then calls All_To_Look to re-reveal (display.cpp:4133)', () => {
    // After shrouding fog cells, C++ calls All_To_Look() which re-reveals
    // around all player units/structures. The net effect is that only cells
    // outside current sight ranges are reshrouded.
    const map = new GameMap();
    const look = [{
      x: 64 * CELL_SIZE + CELL_SIZE / 2,
      y: 64 * CELL_SIZE + CELL_SIZE / 2,
      sight: 5,
    }];

    // First explicit Look/Sight_From pass: C++ Map_Cell writes display shroud.
    map.updateFogOfWar(look);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(65, 65)).toBe(2);

    // Simulate Encroach_Shadow. The display-edge cell is reshrouded.
    expect(map.getDisplayVisibility(69, 64)).toBe(1);
    map.creepShadow();
    expect(map.getVisibility(69, 64)).toBe(0);

    // Then All_To_Look equivalent — explicit Look re-reveals around units.
    map.updateFogOfWar(look);
    expect(map.getVisibility(64, 64)).toBe(2); // Restored by unit sight
    expect(map.getVisibility(69, 64)).toBe(2);
  });
});

// ==========================================================================
// Section 5: Shroud_Cell — GPS blocks reshroud
// C++ display.cpp:4157-4163
// ==========================================================================

describe('Shroud_Cell — GPS blocks reshroud (display.cpp:4159)', () => {
  it('GPS active prevents shroud regeneration', () => {
    // C++ display.cpp:4159: if (PlayerPtr->IsGPSActive) { ... return; }
    // When GPS is active, Shroud_Cell returns early (unless cell is gap-jammed).
    const map = new GameMap();
    map.revealAll(); // GPS reveals everything

    const ctx = makeFogContext({
      map,
      gpsActive: true,
    });

    // With GPS active, updateFogOfWar bypasses fog downgrade
    updateFogOfWar(ctx);

    // All cells should remain visible
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(0, 0)).toBe(2);
  });
});

// ==========================================================================
// Section 6: Dead units leave fog (1), NOT shroud (0)
// C++ map.cpp Sight_From only runs for alive units
// ==========================================================================

describe('Dead units leave fog, not shroud (C++ Sight_From alive-only)', () => {
  it('visible cells downgrade to fog (1) when unit dies, not shroud (0)', () => {
    // C++ techno.cpp:5903-5913: Look() only runs for alive units.
    // When a unit dies, its previously visible cells are no longer re-revealed
    // by Look(), so they downgrade from visible (2) to fog (1) — IsMapped stays true.
    const map = new GameMap();
    const entity = makeEntity('E1', House.Spain, 64 * CELL_SIZE, 64 * CELL_SIZE, 3);

    const ctx = makeFogContext({
      map,
      entities: [entity],
    });

    // Unit alive: cells are visible
    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(65, 64)).toBe(2);

    // Unit dies
    entity.alive = false;

    // Next fog update: visible cells downgrade to fog (1), not shroud (0)
    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(1); // fog, NOT shroud
    expect(map.getVisibility(65, 64)).toBe(1); // fog, NOT shroud
  });

  it('cells never seen by any unit remain at shroud (0)', () => {
    const map = new GameMap();
    const entity = makeEntity('E1', House.Spain, 10 * CELL_SIZE, 10 * CELL_SIZE, 2);

    const ctx = makeFogContext({
      map,
      entities: [entity],
    });

    updateFogOfWar(ctx);

    // Cells far from unit are still shroud (0)
    expect(map.getVisibility(100, 100)).toBe(0);
    expect(map.getVisibility(0, 0)).toBe(0);
  });

  it('fog cells remain at fog (1) across ticks with no unit present', () => {
    const map = new GameMap();
    const entity = makeEntity('E1', House.Spain, 30 * CELL_SIZE, 30 * CELL_SIZE, 3);

    const ctx = makeFogContext({
      map,
      entities: [entity],
    });

    // Reveal area
    updateFogOfWar(ctx);
    expect(map.getVisibility(30, 30)).toBe(2);

    // Unit moves away — simulate by removing
    ctx.entities = [];

    // Cells downgrade to fog
    updateFogOfWar(ctx);
    expect(map.getVisibility(30, 30)).toBe(1);

    // Another tick — fog stays at fog, does NOT degrade further to shroud
    updateFogOfWar(ctx);
    expect(map.getVisibility(30, 30)).toBe(1);
  });
});

// ==========================================================================
// Section 7: Sight range validation
// C++ map.cpp:296: if (!sightrange || sightrange > 10) return;
// ==========================================================================

describe('Sight range limits (C++ map.cpp:296)', () => {
  it('sight range 0 reveals nothing', () => {
    const map = new GameMap();
    const entity = makeEntity('E1', House.Spain, 64 * CELL_SIZE, 64 * CELL_SIZE, 0);

    const ctx = makeFogContext({
      map,
      entities: [entity],
    });

    updateFogOfWar(ctx);
    // C++ map.cpp:296: if (!sightrange ...) return;
    expect(map.getVisibility(64, 64)).toBe(0);
  });

  it('sight range > 10 reveals nothing (capped at 10)', () => {
    const map = new GameMap();
    const entity = makeEntity('E1', House.Spain, 64 * CELL_SIZE, 64 * CELL_SIZE, 11);

    const ctx = makeFogContext({
      map,
      entities: [entity],
    });

    updateFogOfWar(ctx);
    // C++ map.cpp:296: if (... || sightrange > 10) return;
    expect(map.getVisibility(64, 64)).toBe(0);
  });

  it('sight range 10 reveals cells (maximum valid range)', () => {
    const map = new GameMap();
    const entity = makeEntity('E1', House.Spain, 64 * CELL_SIZE, 64 * CELL_SIZE, 10);

    const ctx = makeFogContext({
      map,
      entities: [entity],
    });

    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(2);
    // Check a cell near the edge of sight=10
    expect(map.getVisibility(64 + 9, 64)).toBe(2);
  });
});

// ==========================================================================
// Section 8: Structure sight ranges match STRUCTURE_SIGHT table
// C++ building.cpp uses Class->SightRange — per rules.ini [BUILDING] Sight=
// ==========================================================================

describe('Structure sight ranges (C++ building.cpp SightRange)', () => {
  it('DOME (radar) has sight 10 — highest civilian structure range', () => {
    expect(STRUCTURE_SIGHT['DOME']).toBe(10);
  });

  it('ATEK (advanced tech center) has sight 10', () => {
    expect(STRUCTURE_SIGHT['ATEK']).toBe(10);
  });

  it('GAP generator has sight 10', () => {
    expect(STRUCTURE_SIGHT['GAP']).toBe(10);
  });

  it('POWR (power plant) has sight 4', () => {
    expect(STRUCTURE_SIGHT['POWR']).toBe(4);
  });

  it('PROC (refinery) has sight 6', () => {
    expect(STRUCTURE_SIGHT['PROC']).toBe(6);
  });

  it('AFLD (airfield) has sight 7 — highest non-10 range', () => {
    expect(STRUCTURE_SIGHT['AFLD']).toBe(7);
  });

  it('baseDiscovered=false still allows structure sight during fog update', () => {
    // C++ All_To_Look(units_only=true) at init skips buildings, but per-tick
    // building sight is not gated by a separate base-discovery flag.
    const map = new GameMap();
    const structure = makeStructure('DOME', House.Spain, 64, 64);

    const ctx = makeFogContext({
      map,
      structures: [structure],
      baseDiscovered: false,
    });

    updateFogOfWar(ctx);
    expect(map.getVisibility(64, 64)).toBe(2);
  });
});

// ==========================================================================
// Section 9: Octagonal distance for sight reveal
// C++ coord.cpp:124-136 — Distance() approximation: max(|dx|,|dy|)*2 + min <= radius*2
// ==========================================================================

describe('Octagonal sight distance (C++ coord.cpp:124-136)', () => {
  it('cell at exact diagonal of sight range is NOT revealed (octagonal cutoff)', () => {
    const map = new GameMap();
    // Sight=5: the octagonal boundary is max*2 + min <= 10
    // Cell (5,5): max=5, min=5 → 5*2+5 = 15 > 10 → NOT revealed
    const entity = makeEntity('E1', House.Spain, 64 * CELL_SIZE, 64 * CELL_SIZE, 5);

    const ctx = makeFogContext({
      map,
      entities: [entity],
    });

    updateFogOfWar(ctx);
    expect(map.getVisibility(64 + 5, 64 + 5)).toBe(0); // outside octagon
  });

  it('cell at cardinal edge of sight range IS revealed', () => {
    const map = new GameMap();
    const entity = makeEntity('E1', House.Spain, 64 * CELL_SIZE, 64 * CELL_SIZE, 5);

    const ctx = makeFogContext({
      map,
      entities: [entity],
    });

    updateFogOfWar(ctx);
    // Cell (5,0): max=5, min=0 → 5*2+0 = 10 <= 10 → revealed
    expect(map.getVisibility(64 + 5, 64)).toBe(2);
    expect(map.getVisibility(64, 64 + 5)).toBe(2);
    expect(map.getVisibility(64 - 5, 64)).toBe(2);
    expect(map.getVisibility(64, 64 - 5)).toBe(2);
  });

  it('cell (3,3) at sight=5: max*2+min = 9 <= 10 → revealed', () => {
    const map = new GameMap();
    const entity = makeEntity('E1', House.Spain, 64 * CELL_SIZE, 64 * CELL_SIZE, 5);

    const ctx = makeFogContext({
      map,
      entities: [entity],
    });

    updateFogOfWar(ctx);
    // (3,3): max=3, min=3 → 3*2+3 = 9 <= 10 → inside octagon
    expect(map.getVisibility(64 + 3, 64 + 3)).toBe(2);
  });

  it('cell (4,3) at sight=5: max*2+min = 11 > 10 → NOT revealed', () => {
    const map = new GameMap();
    const entity = makeEntity('E1', House.Spain, 64 * CELL_SIZE, 64 * CELL_SIZE, 5);

    const ctx = makeFogContext({
      map,
      entities: [entity],
    });

    updateFogOfWar(ctx);
    // (4,3): max=4, min=3 → 4*2+3 = 11 > 10 → outside octagon
    expect(map.getVisibility(64 + 4, 64 + 3)).toBe(0);
  });
});

// ==========================================================================
// Section 10: fogDisabled bypass
// ==========================================================================

describe('fogDisabled reveals entire map', () => {
  it('fogDisabled=true reveals all cells regardless of units', () => {
    const map = new GameMap();

    const ctx = makeFogContext({
      map,
      fogDisabled: true,
      entities: [],
      structures: [],
    });

    updateFogOfWar(ctx);
    expect(map.getVisibility(0, 0)).toBe(2);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(MAP_CELLS - 1, MAP_CELLS - 1)).toBe(2);
  });
});
