/**
 * C++ Behavioral Parity: Vehicle Crush Mechanics
 *
 * Tests verify that vehicle crushing (infantry, wall, multi-unit) matches
 * C++ Red Alert source code behavior.
 *
 * C++ source references:
 *   unit.cpp:4384-4450 — Overrun_Square(): crush infantry on cell entry
 *   unit.cpp:1855-1871 — Per_Cell_Process(): crush walls on cell entry
 *   unit.cpp:4813-4855 — Should_Crush_It(): AI crush decision logic
 *   unit.cpp:3069-3319 — Can_Enter_Cell(): movement vs crushable objects
 *   infantry.cpp:1852-1929 — Scatter(): infantry flee approaching vehicles
 *
 * Observable outcomes: entity death, wall destruction, sound effects,
 * kill tracking, friendly crush prevention, sound and blood effects.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE,
  Mission, AnimState,
  UNIT_STATS, buildDefaultAlliances,
} from '../engine/types';
import type { WarheadType } from '../engine/types';
import { Entity, resetEntityIds, CloakState } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  checkWallCrush,
  CRUSHABLE_WALLS,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(entities: Entity[] = [], map?: GameMap): CombatContext {
  const gameMap = map ?? new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    pointTotal: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map: gameMap,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
    movementSpeed: () => 1,
    getFirepowerBias: () => 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
  } as CombatContext;
}

// =============================================================================
// 1. Basic Vehicle Crush — IsCrusher + IsCrushable (unit.cpp:4390-4408)
// =============================================================================

describe('Basic vehicle crush (unit.cpp:4384-4450 Overrun_Square)', () => {

  it('crusher vehicle kills crushable infantry in same cell', () => {
    // C++ unit.cpp:4408 — IsCrushable && !Is_Ally(object) && Distance < CELL_LEPTON_W/2
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, infantry]);

    expect(tank.stats.crusher).toBe(true);
    expect(infantry.stats.crushable).toBe(true);

    checkVehicleCrush(ctx, tank);

    expect(infantry.alive).toBe(false);
  });

  it('crusher deletes prone infantry instead of applying damage bias', () => {
    // C++ unit.cpp:4422-4435 deletes the object directly; InfantryClass
    // ProneDamageBias from Take_Damage is not involved.
    const mrj = entityAtCell(UnitType.V_MRJ, House.USSR, 12, 55);
    const infantry = entityAtCell(UnitType.I_E1, House.Greece, 12, 55);
    mrj.leptonX = 12 * 256 + 128;
    mrj.leptonY = 55 * 256 + 128;
    mrj.syncPosFromLeptons();
    infantry.leptonX = 12 * 256 + 192;
    infantry.leptonY = 55 * 256 + 64;
    infantry.syncPosFromLeptons();
    infantry.hp = 47;
    infantry.isProne = true;
    const ctx = makeCombatCtx([mrj, infantry]);

    checkVehicleCrush(ctx, mrj);

    expect(infantry.alive).toBe(false);
    expect(infantry.inLimbo).toBe(true);
    expect(infantry.hp).toBe(0);
  });

  it('non-crusher vehicle does NOT crush infantry', () => {
    // C++ unit.cpp:4390 — if (Class->IsCrusher) gate
    // V2RL actually has crusher=true in TS; use a vehicle that doesn't have it
    // Jeep (if exists) or a unit without crusher. Let's check: MSAM has no crusher.
    // Use MSAM (Mobile SAM) which should not be a crusher
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([jeep, infantry]);

    expect(jeep.stats.crusher).toBeFalsy();

    checkVehicleCrush(ctx, jeep);

    expect(infantry.alive).toBe(true);
  });

  it('crusher vehicle does NOT crush non-crushable units (e.g. vehicles)', () => {
    // C++ unit.cpp:4408 — Class_Of().IsCrushable must be true
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const enemyTank = entityAtCell(UnitType.V_1TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, enemyTank]);

    expect(enemyTank.stats.crushable).toBeFalsy();

    checkVehicleCrush(ctx, tank);

    expect(enemyTank.alive).toBe(true);
  });

  it('infantry in adjacent cell is NOT crushed', () => {
    // C++ unit.cpp:4408 — crush only happens for objects IN the cell
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 11, 10); // adjacent cell
    const ctx = makeCombatCtx([tank, infantry]);

    checkVehicleCrush(ctx, tank);

    expect(infantry.alive).toBe(true);
  });
});

// =============================================================================
// 2. Friendly Crush Prevention (unit.cpp:4408 — !House->Is_Ally(object))
// =============================================================================

describe('Friendly crush prevention (unit.cpp:4408 ally check)', () => {

  it('crusher does NOT crush allied infantry', () => {
    // C++ unit.cpp:4408 — !House->Is_Ally(object): allied units are skipped
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const friendlyInf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10); // same house
    const ctx = makeCombatCtx([tank, friendlyInf]);

    checkVehicleCrush(ctx, tank);

    expect(friendlyInf.alive).toBe(true);
  });

  it('crusher does NOT crush allied infantry from different allied house', () => {
    // C++ unit.cpp:4408 — Is_Ally checks house alliance, not just same house
    // Spain and Greece are allied in default alliances
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const alliedInf = entityAtCell(UnitType.I_E1, House.Greece, 10, 10);
    const ctx = makeCombatCtx([tank, alliedInf]);

    checkVehicleCrush(ctx, tank);

    expect(alliedInf.alive).toBe(true);
  });

  it('crusher DOES crush non-allied infantry', () => {
    // C++ unit.cpp:4408 — enemy infantry gets crushed
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const enemyInf = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, enemyInf]);

    checkVehicleCrush(ctx, tank);

    expect(enemyInf.alive).toBe(false);
  });
});

// =============================================================================
// 3. Multi-Unit Crush (unit.cpp:4405-4446 — while loop over Cell_Occupier chain)
// =============================================================================

describe('Multi-unit crush (unit.cpp:4405-4446 while loop)', () => {

  it('crusher kills multiple enemy infantry in the same cell', () => {
    // C++ unit.cpp:4405-4446 — iterates through Cell_Occupier linked list,
    // crushing all crushable enemies in the cell
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const inf1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const inf2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const inf3 = entityAtCell(UnitType.I_E3, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, inf1, inf2, inf3]);

    checkVehicleCrush(ctx, tank);

    expect(inf1.alive).toBe(false);
    expect(inf2.alive).toBe(false);
    expect(inf3.alive).toBe(false);
  });

  it('crushes enemy infantry but skips allied infantry in same cell', () => {
    // C++ unit.cpp:4408 — ally check is per-object in the iteration
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const friendly = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, friendly, enemy]);

    checkVehicleCrush(ctx, tank);

    expect(friendly.alive).toBe(true);
    expect(enemy.alive).toBe(false);
  });
});

// =============================================================================
// 4. Crush Kill Tracking (unit.cpp:4424-4447 — Record_The_Kill, Do_Uncloak)
// =============================================================================

describe('Crush kill tracking and side effects', () => {

  it('player vehicle crushing enemy increments killCount', () => {
    // C++ unit.cpp:4433 — Record_The_Kill(this): credits kill to crusher
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, enemy]);

    checkVehicleCrush(ctx, tank);

    expect(ctx.killCount).toBe(1);
  });

  it('player vehicle crushing multiple enemies increments killCount for each', () => {
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const inf1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const inf2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, inf1, inf2]);

    checkVehicleCrush(ctx, tank);

    expect(ctx.killCount).toBe(2);
  });

  it('crush produces blood/squish visual effect', () => {
    // C++ unit.cpp:4429-4431 — Sound_Effect(VOC_SQUISH), AnimClass(ANIM_CORPSE1)
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, enemy]);

    checkVehicleCrush(ctx, tank);

    const bloodEffects = ctx.effects.filter(e => e.type === 'blood');
    expect(bloodEffects.length).toBeGreaterThanOrEqual(1);
  });

  it('crush does not add TS-only ground decals at crush location', () => {
    // C++ unit.cpp:4437 leaves OverlayClass(OVERLAY_SQUISH, ...) commented out;
    // there is no CellClass smudge or generic decal side effect.
    const map = new GameMap();
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, enemy], map);
    const addDecalSpy = { called: false };
    map.addDecal = () => { addDecalSpy.called = true; };

    checkVehicleCrush(ctx, tank);

    expect(addDecalSpy.called).toBe(false);
    expect(map.decals).toHaveLength(0);
  });

  it('enemy vehicle crushing player infantry increments lossCount', () => {
    // TS tracks player losses when enemy crushes player infantry
    const enemyTank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const playerInf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([enemyTank, playerInf]);

    checkVehicleCrush(ctx, enemyTank);

    expect(playerInf.alive).toBe(false);
    expect(ctx.lossCount).toBe(1);
  });
});

// =============================================================================
// 5. Crusher Vehicle Types — IsCrusher flag (C++ udata.cpp, rules.ini Crusher=yes)
// =============================================================================

describe('IsCrusher flag matches C++ udata.cpp / rules.ini', () => {

  it('heavy tanks are crushers (1TNK, 2TNK, 3TNK, 4TNK)', () => {
    // C++ udata.cpp / rules.ini: all main battle tanks have Crusher=yes
    expect(UNIT_STATS['1TNK'].crusher).toBe(true);
    expect(UNIT_STATS['2TNK'].crusher).toBe(true);
    expect(UNIT_STATS['3TNK'].crusher).toBe(true);
    expect(UNIT_STATS['4TNK'].crusher).toBe(true);
  });

  it('APC is a crusher', () => {
    // C++ udata.cpp: APC has Crusher=yes (tracked vehicle)
    expect(UNIT_STATS.APC.crusher).toBe(true);
  });

  it('Harvester is a crusher', () => {
    // C++ udata.cpp: HARV has Crusher=yes (heavy tracked vehicle)
    expect(UNIT_STATS.HARV.crusher).toBe(true);
  });

  it('MCV IS a crusher (C++ udata.cpp:358 IsCrusher=true)', () => {
    expect(UNIT_STATS.MCV.crusher).toBe(true);
  });

  it('Artillery is NOT a crusher (C++ udata.cpp:296 IsCrusher=false)', () => {
    // C++ udata.cpp:296 IsCrusher=false despite Tracked=yes in rules.ini
    expect(UNIT_STATS.ARTY.crusher).toBeFalsy();
  });
});

// =============================================================================
// 6. Crushable Infantry Types — IsCrushable flag (C++ idata.cpp, rules.ini Crushable=yes)
// =============================================================================

describe('IsCrushable flag matches C++ idata.cpp / rules.ini', () => {

  it('standard infantry are crushable (E1, E2, E3, E4)', () => {
    // C++ idata.cpp: all standard infantry have Crushable=yes
    expect(UNIT_STATS.E1.crushable).toBe(true);
    expect(UNIT_STATS.E2.crushable).toBe(true);
    expect(UNIT_STATS.E3.crushable).toBe(true);
    expect(UNIT_STATS.E4.crushable).toBe(true);
  });

  it('special infantry are crushable (engineer, spy, dog, Tanya)', () => {
    expect(UNIT_STATS.E6.crushable).toBe(true);
    expect(UNIT_STATS.SPY.crushable).toBe(true);
    expect(UNIT_STATS.DOG.crushable).toBe(true);
    expect(UNIT_STATS.E7.crushable).toBe(true);
  });

  it('Shock Trooper is NOT crushable (C++ aftrmath.ini Crushable=no)', () => {
    // C++ aftrmath.ini: SHOK has Crushable=no — special case
    expect(UNIT_STATS.SHOK.crushable).toBe(false);
  });

  it('ants are crushable', () => {
    // C++ SCA INI: ants have Crushable=yes
    expect(UNIT_STATS.ANT1.crushable).toBe(true);
    expect(UNIT_STATS.ANT2.crushable).toBe(true);
    expect(UNIT_STATS.ANT3.crushable).toBe(true);
  });

  it('vehicles are NOT crushable', () => {
    // C++ udata.cpp: vehicles don't have Crushable=yes
    expect(UNIT_STATS['1TNK'].crushable).toBeFalsy();
    expect(UNIT_STATS['2TNK'].crushable).toBeFalsy();
    expect(UNIT_STATS.HARV.crushable).toBeFalsy();
  });
});

// =============================================================================
// 7. Wall Crush — Per_Cell_Process (unit.cpp:1855-1871)
// =============================================================================

describe('Wall crush (unit.cpp:1855-1871 Per_Cell_Process)', () => {

  it('crusher vehicle destroys sandbag wall (SBAG)', () => {
    // C++ unit.cpp:1859-1869: IsCrusher && IsCrushable overlay → Reduce_Wall(-1)
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank], map);

    checkWallCrush(ctx, tank);

    expect(map.getWallType(10, 10)).toBe('');
  });

  it('crusher vehicle destroys fence wall (FENC)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'FENC');
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank], map);

    checkWallCrush(ctx, tank);

    expect(map.getWallType(10, 10)).toBe('');
  });

  it('crusher vehicle destroys barbwire wall (BARB)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'BARB');
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank], map);

    checkWallCrush(ctx, tank);

    expect(map.getWallType(10, 10)).toBe('');
  });

  it('crusher vehicle destroys wood wall (WOOD)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'WOOD');
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank], map);

    checkWallCrush(ctx, tank);

    expect(map.getWallType(10, 10)).toBe('');
  });

  it('crusher vehicle does NOT crush brick wall (BRIK)', () => {
    // C++ odata.cpp: BRIK has IsCrushable=false — brick walls are NOT crushable
    const map = new GameMap();
    map.setWallType(10, 10, 'BRIK');
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank], map);

    checkWallCrush(ctx, tank);

    expect(map.getWallType(10, 10)).toBe('BRIK');
  });

  it('non-crusher vehicle does NOT crush any wall', () => {
    // C++ unit.cpp:1859 — if (Class->IsCrusher) gate
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    const ctx = makeCombatCtx([jeep], map);

    checkWallCrush(ctx, jeep);

    expect(map.getWallType(10, 10)).toBe('SBAG');
  });

  it('empty cell — no crash', () => {
    // No wall at cell — should be a no-op
    const map = new GameMap();
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank], map);

    checkWallCrush(ctx, tank);

    expect(map.getWallType(10, 10)).toBe('');
  });
});

// =============================================================================
// 8. Wall Crush Sound Effects (unit.cpp:1864-1868)
// =============================================================================

describe('Wall crush sound effects (unit.cpp:1864-1868)', () => {

  it('sandbag wall crush plays wallkill_sand sound', () => {
    // C++ unit.cpp:1864-1865: OVERLAY_SANDBAG_WALL → VOC_SANDBAG
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([tank], map);
    ctx.playSoundAt = (name) => { sounds.push(name); };

    checkWallCrush(ctx, tank);

    expect(sounds).toContain('wallkill_sand');
  });

  it('non-sandbag wall crush plays wallkill2 sound', () => {
    // C++ unit.cpp:1867: non-sandbag → VOC_WALLKILL2
    const map = new GameMap();
    map.setWallType(10, 10, 'FENC');
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([tank], map);
    ctx.playSoundAt = (name) => { sounds.push(name); };

    checkWallCrush(ctx, tank);

    expect(sounds).toContain('wallkill2');
  });
});

// =============================================================================
// 9. CRUSHABLE_WALLS constant matches C++ odata.cpp IsCrushable
// =============================================================================

describe('CRUSHABLE_WALLS matches C++ odata.cpp IsCrushable', () => {

  it('contains SBAG (sandbag wall)', () => {
    expect(CRUSHABLE_WALLS.has('SBAG')).toBe(true);
  });

  it('contains FENC (fence)', () => {
    expect(CRUSHABLE_WALLS.has('FENC')).toBe(true);
  });

  it('contains BARB (barbwire)', () => {
    expect(CRUSHABLE_WALLS.has('BARB')).toBe(true);
  });

  it('contains WOOD (wood wall)', () => {
    expect(CRUSHABLE_WALLS.has('WOOD')).toBe(true);
  });

  it('does NOT contain BRIK (brick wall is NOT crushable)', () => {
    // C++ odata.cpp: BRIK IsCrushable=false
    expect(CRUSHABLE_WALLS.has('BRIK')).toBe(false);
  });

  it('has exactly 5 entries (SBAG, FENC, BARB, WOOD, CYCL)', () => {
    expect(CRUSHABLE_WALLS.size).toBe(5);
    expect(CRUSHABLE_WALLS.has('CYCL')).toBe(true);
  });
});

// =============================================================================
// 10. Crush with Ants (crushable non-infantry)
// =============================================================================

describe('Ant crushing (SCA INI: ants are crushable)', () => {

  it('heavy tank crushes warrior ant in same cell', () => {
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, ant]);

    expect(ant.stats.crushable).toBe(true);

    checkVehicleCrush(ctx, tank);

    expect(ant.alive).toBe(false);
  });

  it('crush plays ant death sound for ants', () => {
    // C++ uses VOC_SQUISH for all crush; TS differentiates ant vs infantry sound
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([tank, ant]);
    ctx.playSoundAt = (name) => { sounds.push(name); };

    checkVehicleCrush(ctx, tank);

    expect(sounds).toContain('die_ant');
  });

  it('crush plays infantry death sound for infantry (not ant sound)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([tank, inf]);
    ctx.playSoundAt = (name) => { sounds.push(name); };

    checkVehicleCrush(ctx, tank);

    expect(sounds).toContain('die_infantry');
  });
});

// =============================================================================
// 11. Shock Trooper Crush Immunity (aftrmath.ini Crushable=no)
// =============================================================================

describe('Shock Trooper crush immunity (aftrmath.ini Crushable=no)', () => {

  it('crusher vehicle does NOT crush Shock Trooper', () => {
    // C++ aftrmath.ini: SHOK has Crushable=no
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, shok]);

    checkVehicleCrush(ctx, tank);

    expect(shok.alive).toBe(true);
  });
});

// =============================================================================
// 12. Crush does NOT affect dead entities
// =============================================================================

describe('Crush skips dead entities', () => {

  it('already-dead infantry is not crushed again', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const deadInf = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    deadInf.alive = false;
    deadInf.hp = 0;
    const ctx = makeCombatCtx([tank, deadInf]);

    checkVehicleCrush(ctx, tank);

    // Should not increment kill count for already dead entity
    expect(ctx.killCount).toBe(0);
  });
});

// =============================================================================
// 13. Point Total Tracking (C++ score.cpp, techno.cpp PointTotal)
// =============================================================================

describe('Crush point total tracking (score.cpp)', () => {

  it('player crushing enemy adds to pointTotal', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, enemy]);

    checkVehicleCrush(ctx, tank);

    expect(ctx.pointTotal).toBeGreaterThan(0);
  });

  it('enemy crushing player infantry subtracts from pointTotal', () => {
    const enemyTank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const playerInf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([enemyTank, playerInf]);

    checkVehicleCrush(ctx, enemyTank);

    expect(ctx.pointTotal).toBeLessThan(0);
  });
});

// =============================================================================
// 14. Per-Side Casualty Tracking (C++ score.cpp:548-560)
// =============================================================================

describe('Per-side casualty tracking on crush (score.cpp:548-560)', () => {

  it('crushing Soviet infantry increments sovietUnitsLost', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const sovietInf = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, sovietInf]);

    checkVehicleCrush(ctx, tank);

    expect(ctx.sovietUnitsLost).toBe(1);
  });

  it('crushing Allied infantry increments alliedUnitsLost', () => {
    // USSR tank crushes an allied (Spain) infantry
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const alliedInf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank, alliedInf]);

    checkVehicleCrush(ctx, tank);

    expect(ctx.alliedUnitsLost).toBe(1);
  });
});

// =============================================================================
// 15. Wall Crush — Structure Cleanup
// =============================================================================

describe('Wall crush clears corresponding structure', () => {

  it('wall crush marks structure as dead and rubble', () => {
    // TS checkWallCrush iterates ctx.structures to find matching wall structure
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const wallStruct = { type: 'SBAG', cx: 10, cy: 10, house: House.USSR, alive: true, rubble: false, hp: 1, maxHp: 1 };
    const ctx = makeCombatCtx([tank], map);
    ctx.structures = [wallStruct as any];

    checkWallCrush(ctx, tank);

    expect(wallStruct.alive).toBe(false);
    expect(wallStruct.rubble).toBe(true);
  });
});

// =============================================================================
// 16. PARITY FIXED: C++ Overrun_Square sub-cell distance check
// =============================================================================

describe('PARITY FIXED: C++ sub-cell distance check (unit.cpp:4408)', () => {

  // C++ unit.cpp:4408: Distance(object->Center_Coord()) < CELL_LEPTON_W/2
  // TS now uses distance-based check within same cell, matching C++.
  // Units at cell center are always within range. Units at cell edges may be outside range.

  it('crushes units at cell center (within CELL_LEPTON_W/2 distance)', () => {
    // Both entities at cell (10,10) center — distance is 0, well within range
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, infantry]);

    checkVehicleCrush(ctx, tank);

    expect(infantry.alive).toBe(false);
  });

  it('does NOT crush units at far edge of same cell (outside CELL_LEPTON_W/2)', () => {
    // Place tank at cell center, infantry at far corner of same cell
    // Distance = sqrt((CELL_SIZE/2 - 1)^2 + (CELL_SIZE/2 - 1)^2) > CELL_SIZE/2
    const cx = 10, cy = 10;
    const tank = new Entity(UnitType.V_2TNK, House.Spain,
      cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
    const infantry = new Entity(UnitType.I_E1, House.USSR,
      cx * CELL_SIZE + CELL_SIZE - 1, cy * CELL_SIZE + CELL_SIZE - 1);
    const ctx = makeCombatCtx([tank, infantry]);

    checkVehicleCrush(ctx, tank);

    // Infantry at far corner is outside CELL_LEPTON_W/2 distance, not crushed
    expect(infantry.alive).toBe(true);
  });
});

// =============================================================================
// 17. PARITY FIXED: C++ crusher uncloaks after crush (unit.cpp:4447)
// =============================================================================

describe('PARITY FIXED: crusher uncloak on crush (unit.cpp:4447)', () => {

  // C++ unit.cpp:4447: if (crushed) Do_Uncloak();
  // After crushing at least one unit, the vehicle uncloaks.
  // TS now implements this for cloakable crushers like the Phase Transport (STNK).

  it('cloakable crusher uncloaks after crushing enemy', () => {
    // STNK (Phase Transport) has both crusher=true and isCloakable=true
    const stnk = entityAtCell(UnitType.V_STNK, House.Spain, 10, 10);
    stnk.cloakState = CloakState.CLOAKED;
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([stnk, enemy]);

    checkVehicleCrush(ctx, stnk);

    expect(enemy.alive).toBe(false);
    // PARITY FIXED: cloaked vehicle transitions to UNCLOAKING after crush
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);
  });

  it('non-cloakable crusher does NOT change cloak state', () => {
    // Regular tank is not cloakable — cloak state should not change
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, enemy]);

    checkVehicleCrush(ctx, tank);

    expect(enemy.alive).toBe(false);
    expect(tank.cloakState).toBe(CloakState.UNCLOAKED); // unchanged
  });
});

// =============================================================================
// 18. PARITY FIXED: C++ wall crush checks wall owner alliance (unit.cpp:3108-3109)
// =============================================================================

describe('PARITY FIXED: wall crush owner alliance check (unit.cpp:3108-3109)', () => {

  // C++ unit.cpp:3108-3109 (Can_Enter_Cell):
  //   if (optr->IsCrushable && Class->IsCrusher) {
  //     cancrush = !House->Is_Ally(cellptr->Owner);
  //   }
  //
  // TS now checks wall structure ownership — allied walls are NOT crushed.

  it('crusher does NOT crush allied walls (wall owned by same house)', () => {
    // Wall owned by Spain (same as tank) — should NOT be crushed
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank], map);
    const wallStruct = { type: 'SBAG', cx: 10, cy: 10, house: House.Spain, alive: true, rubble: false, hp: 1, maxHp: 1 };
    ctx.structures = [wallStruct as any];

    checkWallCrush(ctx, tank);

    // PARITY FIXED: allied wall is NOT crushed
    expect(map.getWallType(10, 10)).toBe('SBAG');
  });

  it('crusher DOES crush enemy walls', () => {
    // Wall owned by USSR (enemy) — should be crushed
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank], map);
    const wallStruct = { type: 'SBAG', cx: 10, cy: 10, house: House.USSR, alive: true, rubble: false, hp: 1, maxHp: 1 };
    ctx.structures = [wallStruct as any];

    checkWallCrush(ctx, tank);

    // Enemy wall IS crushed
    expect(map.getWallType(10, 10)).toBe('');
  });

  it('crusher crushes walls with no owner structure (neutral walls)', () => {
    // Wall on map with no matching structure — no owner to check, crush proceeds
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank], map);
    // No structures — wall has no owner

    checkWallCrush(ctx, tank);

    // Neutral wall IS crushed
    expect(map.getWallType(10, 10)).toBe('');
  });
});

// =============================================================================
// 19. Spy passive crush — Overrun_Square has no spy exception (unit.cpp:4384-4450)
// =============================================================================

describe('Spy passive crush — Overrun_Square has no spy exception', () => {

  // C++ unit.cpp:4850-4852 (Should_Crush_It):
  //   if (it->What_Am_I() == RTTI_INFANTRY && *(InfantryClass *)it == INFANTRY_SPY) {
  //     return(false);
  //   }
  //
  // In C++, AI-controlled vehicles will NOT auto-crush spies. The spy can still be
  // crushed manually by player-controlled vehicles or if the vehicle happens to drive
  // over the spy (Overrun_Square doesn't check for spies — Should_Crush_It does).
  //
  // Note: Overrun_Square (the actual crush-on-cell-entry) does NOT have this check.
  // Should_Crush_It only gates the AI DECISION to deliberately seek and crush.
  // So this is about AI pursuit behavior, not about crush-on-contact immunity.
  // The spy CAN still be crushed if the vehicle enters the spy's cell for other reasons.

  it('Spy is crushable (Overrun_Square has no spy exception)', () => {
    // C++ Overrun_Square does NOT check for spies — spies die when driven over
    // The spy protection is only in Should_Crush_It (AI targeting decision)
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, spy]);

    expect(spy.stats.crushable).toBe(true);

    checkVehicleCrush(ctx, tank);

    // Spy IS crushed on cell entry (Overrun_Square behavior)
    expect(spy.alive).toBe(false);
  });
});

// =============================================================================
// 20. Harvester Crush — unarmed crusher (unit.cpp:1125-1139)
// =============================================================================

describe('Harvester crush (unit.cpp:1125-1139 — unarmed crusher)', () => {

  it('harvester (unarmed) crushes enemy infantry', () => {
    // C++ unit.cpp:1125-1139 — harvesters try to crush attackers since they have
    // no weapon. Overrun_Square handles the actual crush on cell entry.
    const harv = entityAtCell(UnitType.V_HARV, House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([harv, enemy]);

    expect(harv.stats.crusher).toBe(true);
    expect(harv.stats.primaryWeapon).toBeNull(); // unarmed

    checkVehicleCrush(ctx, harv);

    expect(enemy.alive).toBe(false);
  });
});

// =============================================================================
// 21. Vehicle does NOT crush itself
// =============================================================================

describe('Vehicle does not crush itself', () => {

  it('crusher vehicle skips self in crush check', () => {
    // C++ unit.cpp:4405 — while (object != NULL): implicitly skips self because
    // the vehicle is not in its own Cell_Occupier list in the same way.
    // TS: other.id === vehicle.id check
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank]);

    checkVehicleCrush(ctx, tank);

    expect(tank.alive).toBe(true);
    expect(ctx.killCount).toBe(0);
  });
});
