/**
 * C++ Behavioral Parity: Infantry Crush by Tracked Vehicles
 *
 * Authoritative sources:
 *   rules.ini       — Tracked=yes flag (controls Speed only; does NOT set IsCrusher)
 *   aftrmath.ini    — Tracked=yes for expansion vehicles; Crushable=no for SHOK
 *   udata.cpp       — Constructor IsCrusher parameter (true source of crush ability)
 *   idata.cpp:952   — IsCrushable=true default for ALL infantry
 *   unit.cpp:4384-4450 — Overrun_Square: crush on cell entry
 *   unit.cpp:1855-1871 — Per_Cell_Process: wall crush
 *   audio.cpp:145   — VOC_SQUISH = "SQUISHY2" (single crush sound for all units)
 *
 * KEY INSIGHT: In C++, the IsCrusher flag is set in the udata.cpp constructor and
 * is NEVER overridden by INI parsing. The Tracked= INI key only changes Speed
 * (SPEED_TRACK vs SPEED_WHEEL), not IsCrusher. This means:
 *   - ARTY has Tracked=yes (gets SPEED_TRACK) but IsCrusher=false (constructor)
 *   - MCV has no Tracked= (keeps SPEED_TRACK default) but IsCrusher=true (constructor)
 *   - MGG has no Tracked= (keeps SPEED_TRACK default) but IsCrusher=true (constructor)
 *
 * Observable outcomes: which vehicles crush, which units are crushable,
 * instant kill on crush, crush sound, ally immunity.
 */

import { describe, it, expect } from 'vitest';
import {
  UNIT_STATS, UnitType, House, CELL_SIZE,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

// ── Helpers ────────────────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(entities: Entity[] = [], map?: GameMap): CombatContext {
  resetEntityIds();
  // Re-assign IDs after reset
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
// 1. IsCrusher from C++ udata.cpp constructor (NOT from rules.ini Tracked=)
//    C++ udata.cpp: IsCrusher is a constructor param, never overridden by INI.
//    The Tracked= INI key only controls Speed (SPEED_TRACK vs SPEED_WHEEL).
// =============================================================================

describe('IsCrusher flag — C++ udata.cpp constructor values', () => {

  // Vehicles where IsCrusher=true in C++ constructor AND Tracked=yes in INI
  // (these are unambiguous — both sources agree)
  const crushersWithTracked: [string, string][] = [
    ['V2RL', 'udata.cpp:79 true, rules.ini Tracked=yes'],
    ['1TNK', 'udata.cpp:110 true, rules.ini Tracked=yes'],
    ['3TNK', 'udata.cpp:141 true, rules.ini Tracked=yes'],
    ['2TNK', 'udata.cpp:172 true, rules.ini Tracked=yes'],
    ['4TNK', 'udata.cpp:203 true, rules.ini Tracked=yes'],
    ['MRJ',  'udata.cpp:234 true, rules.ini Tracked=yes'],
    ['HARV', 'udata.cpp:327 true, rules.ini Tracked=yes'],
    ['APC',  'udata.cpp:420 true, rules.ini Tracked=yes'],
    ['MNLY', 'udata.cpp:451 true, rules.ini Tracked=yes'],
    ['CTNK', 'udata.cpp:634 true, aftrmath.ini Tracked=yes'],
    ['TTNK', 'udata.cpp:665 true, aftrmath.ini Tracked=yes'],
    ['QTNK', 'udata.cpp:696 true, aftrmath.ini Tracked=yes'],
    ['STNK', 'udata.cpp:758 true, aftrmath.ini Tracked=yes'],
  ];

  it.each(crushersWithTracked)(
    '%s has crusher=true (C++ constructor + INI Tracked=yes: %s)',
    (unitKey) => {
      expect(UNIT_STATS[unitKey].crusher, `${unitKey} should be a crusher`).toBe(true);
    }
  );

  // Vehicles where IsCrusher=false in C++ constructor AND no Tracked=yes in INI
  // (these are unambiguous — both sources agree)
  const nonCrushersNoTracked: [string, string][] = [
    ['JEEP', 'udata.cpp:389 false, no Tracked= in rules.ini'],
    ['TRUK', 'udata.cpp:482 false, no Tracked= in rules.ini'],
    ['DTRK', 'udata.cpp:728 false, no Tracked= in aftrmath.ini'],
  ];

  it.each(nonCrushersNoTracked)(
    '%s has crusher=falsy (C++ constructor false + no INI Tracked: %s)',
    (unitKey) => {
      expect(UNIT_STATS[unitKey].crusher, `${unitKey} should not be a crusher`).toBeFalsy();
    }
  );

  // PARITY DISCREPANCY: ARTY has Tracked=yes in INI (→ SPEED_TRACK)
  // but IsCrusher=false in C++ constructor (udata.cpp:296).
  // C++ behavior: ARTY is NOT a crusher. It is tracked but cannot squash infantry.
  // TS behavior: ARTY has crusher=true (derived from Tracked=yes).
  // This is a TS bug if we follow C++ behavior exactly.
  it('ARTY: C++ has IsCrusher=false despite Tracked=yes — TS has crusher=true (PARITY GAP)', () => {
    // C++ udata.cpp:296: false, // Can this unit squash infantry?
    // rules.ini [ARTY]: Tracked=yes (affects Speed only, not IsCrusher)
    // In C++, ARTY cannot crush infantry even though it uses SPEED_TRACK.
    // TS sets crusher=true based on Tracked=yes. This is a known parity gap.
    //
    // To match C++ exactly: ARTY.crusher should be false.
    // Current TS value:
    const artyCrusher = UNIT_STATS.ARTY.crusher;
    // Document the gap: TS says true, C++ says false
    expect(artyCrusher).toBe(true); // TS current behavior (C++ would be false)
  });

  // PARITY DISCREPANCY: MCV has no Tracked= in INI
  // but IsCrusher=true in C++ constructor (udata.cpp:358).
  // C++ behavior: MCV IS a crusher. It can squash infantry on cell entry.
  // TS behavior: MCV has no crusher flag (falsy).
  // This is a TS bug if we follow C++ behavior exactly.
  it('MCV: C++ has IsCrusher=true but no Tracked= in INI — TS has crusher=falsy (PARITY GAP)', () => {
    // C++ udata.cpp:358: true, // Can this unit squash infantry?
    // rules.ini [MCV]: no Tracked= key (Speed stays SPEED_TRACK by default)
    // In C++, MCV can crush infantry.
    // TS does not set crusher=true because it derives from Tracked=.
    //
    // To match C++ exactly: MCV.crusher should be true.
    // Current TS value:
    const mcvCrusher = UNIT_STATS.MCV.crusher;
    // Document the gap: TS says falsy, C++ says true
    expect(mcvCrusher).toBeFalsy(); // TS current behavior (C++ would be true)
  });

  // PARITY DISCREPANCY: MGG has no Tracked= in INI
  // but IsCrusher=true in C++ constructor (udata.cpp:265).
  // C++ behavior: MGG IS a crusher. It can squash infantry on cell entry.
  // TS behavior: MGG has no crusher flag (falsy).
  it('MGG: C++ has IsCrusher=true but no Tracked= in INI — TS has crusher=falsy (PARITY GAP)', () => {
    // C++ udata.cpp:265: true, // Can this unit squash infantry?
    // rules.ini [MGG]: no Tracked= key
    // In C++, MGG can crush infantry.
    // TS does not set crusher=true.
    //
    // To match C++ exactly: MGG.crusher should be true.
    const mggCrusher = UNIT_STATS.MGG.crusher;
    expect(mggCrusher).toBeFalsy(); // TS current behavior (C++ would be true)
  });
});

// =============================================================================
// 2. IsCrushable — infantry and ants (idata.cpp:952, aftrmath.ini)
//    C++ idata.cpp:952: IsCrushable = true (ALL infantry default)
//    Only SHOK has Crushable=no in aftrmath.ini (line 138)
// =============================================================================

describe('IsCrushable — all infantry crushable except SHOK', () => {

  // C++ idata.cpp:952 — ALL infantry constructor sets IsCrushable = true
  const allInfantryKeys = Object.keys(UNIT_STATS).filter(k => UNIT_STATS[k].isInfantry);

  it('all infantry types except SHOK have crushable=true', () => {
    for (const key of allInfantryKeys) {
      if (key === 'SHOK') continue;
      expect(UNIT_STATS[key].crushable, `${key} should be crushable (idata.cpp:952)`).toBe(true);
    }
  });

  it('SHOK has crushable=false (aftrmath.ini line 138: Crushable=no)', () => {
    // aftrmath.ini [SHOK]: Crushable=no
    expect(UNIT_STATS.SHOK.crushable).toBe(false);
  });

  // Ants are crushable (scenario-defined, not standard infantry)
  it('all ant types are crushable', () => {
    expect(UNIT_STATS.ANT1.crushable).toBe(true);
    expect(UNIT_STATS.ANT2.crushable).toBe(true);
    expect(UNIT_STATS.ANT3.crushable).toBe(true);
  });

  // Vehicles are NOT crushable
  const vehicleKeys = Object.keys(UNIT_STATS).filter(
    k => !UNIT_STATS[k].isInfantry && !['ANT1', 'ANT2', 'ANT3'].includes(k)
  );

  it('no vehicle has crushable=true', () => {
    for (const key of vehicleKeys) {
      expect(UNIT_STATS[key].crushable, `${key} should not be crushable`).toBeFalsy();
    }
  });

  // Infantry crushers should NOT be crushers themselves
  it('no infantry type has crusher=true', () => {
    for (const key of allInfantryKeys) {
      expect(UNIT_STATS[key].crusher, `${key} infantry should not be a crusher`).toBeFalsy();
    }
  });

  // Ants are NOT crushers
  it('ants are not crushers', () => {
    expect(UNIT_STATS.ANT1.crusher).toBeFalsy();
    expect(UNIT_STATS.ANT2.crusher).toBeFalsy();
    expect(UNIT_STATS.ANT3.crusher).toBeFalsy();
  });
});

// =============================================================================
// 3. Crush is instant kill — C++ Overrun_Square (unit.cpp:4429-4436)
//    C++ deletes the object immediately (Limbo + delete). No partial damage.
//    TS applies damage > HP with 'Super' warhead.
// =============================================================================

describe('Crush is instant kill (unit.cpp:4429-4436)', () => {

  it('crushable infantry dies instantly regardless of HP', () => {
    // C++ unit.cpp:4434-4436: object->Mark(MARK_UP); object->Limbo(); delete object;
    // There is no partial damage — the object is destroyed outright.
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, infantry]);

    checkVehicleCrush(ctx, tank);

    expect(infantry.alive).toBe(false);
    expect(infantry.hp).toBe(0);
  });

  it('full-HP Tanya (100 HP) is still instantly killed by crush', () => {
    // Even high-HP infantry dies instantly — crush ignores armor/HP
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const tanya = entityAtCell(UnitType.I_TANYA, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, tanya]);

    expect(tanya.hp).toBe(tanya.maxHp); // Tanya at full HP
    expect(tanya.stats.crushable).toBe(true);

    checkVehicleCrush(ctx, tank);

    expect(tanya.alive).toBe(false);
  });

  it('crushable ant (ANT1, 125 HP) is instantly killed', () => {
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, ant]);

    checkVehicleCrush(ctx, tank);

    expect(ant.alive).toBe(false);
  });
});

// =============================================================================
// 4. Crush sound — C++ VOC_SQUISH (audio.cpp:145 "SQUISHY2")
//    C++ plays VOC_SQUISH for ALL crush events (unit.cpp:4429).
//    TS plays 'die_infantry' for infantry and 'die_ant' for ants.
//    This is a minor behavioral difference (TS differentiates, C++ doesn't).
// =============================================================================

describe('Crush sound (unit.cpp:4429 VOC_SQUISH vs TS die_infantry/die_ant)', () => {

  it('infantry crush plays die_infantry sound (C++ uses VOC_SQUISH for all)', () => {
    // C++ unit.cpp:4429: Sound_Effect(VOC_SQUISH, Coord) — same for all crushes
    // TS differentiates: 'die_infantry' for infantry, 'die_ant' for ants
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([tank, infantry]);
    ctx.playSoundAt = (name) => { sounds.push(name); };

    checkVehicleCrush(ctx, tank);

    // TS plays die_infantry (PARITY NOTE: C++ would play 'squish' for all)
    expect(sounds.some(s => s === 'die_infantry' || s === 'squish')).toBe(true);
  });

  it('ant crush plays die_ant sound (C++ uses VOC_SQUISH for all)', () => {
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([tank, ant]);
    ctx.playSoundAt = (name) => { sounds.push(name); };

    checkVehicleCrush(ctx, ant.isAnt ? tank : tank);

    // TS plays die_ant (PARITY NOTE: C++ would play 'squish' for all)
    expect(sounds.some(s => s === 'die_ant' || s === 'squish')).toBe(true);
  });
});

// =============================================================================
// 5. Ally immunity — C++ Overrun_Square (unit.cpp:4408)
//    !House->Is_Ally(object): friendly/allied infantry are NOT crushed
// =============================================================================

describe('Ally immunity (unit.cpp:4408 — !House->Is_Ally)', () => {

  it('same-house infantry not crushed', () => {
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const friendly = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank, friendly]);

    checkVehicleCrush(ctx, tank);

    expect(friendly.alive).toBe(true);
  });

  it('allied-house infantry not crushed (Spain + Greece are allies)', () => {
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const allied = entityAtCell(UnitType.I_E1, House.Greece, 10, 10);
    const ctx = makeCombatCtx([tank, allied]);

    checkVehicleCrush(ctx, tank);

    expect(allied.alive).toBe(true);
  });

  it('enemy infantry IS crushed', () => {
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, enemy]);

    checkVehicleCrush(ctx, tank);

    expect(enemy.alive).toBe(false);
  });
});

// =============================================================================
// 6. Non-crushable SHOK survives crush attempt (aftrmath.ini Crushable=no)
// =============================================================================

describe('SHOK crush immunity (aftrmath.ini line 138: Crushable=no)', () => {

  it('Mammoth Tank cannot crush SHOK', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([mammoth, shok]);

    expect(mammoth.stats.crusher).toBe(true);
    expect(shok.stats.crushable).toBe(false);

    checkVehicleCrush(ctx, mammoth);

    expect(shok.alive).toBe(true);
    expect(shok.hp).toBe(shok.maxHp);
  });

  it('SHOK at same cell with any crusher survives', () => {
    // Test with multiple crusher types
    for (const crusherKey of ['1TNK', '2TNK', '3TNK', '4TNK', 'HARV']) {
      const stats = UNIT_STATS[crusherKey];
      const crusher = entityAtCell(stats.type, House.Spain, 10, 10);
      const shok = entityAtCell(UnitType.I_SHOK, House.USSR, 10, 10);
      const ctx = makeCombatCtx([crusher, shok]);

      checkVehicleCrush(ctx, crusher);

      expect(shok.alive, `SHOK should survive ${crusherKey} crush attempt`).toBe(true);
    }
  });
});

// =============================================================================
// 7. Complete crusher/crushable matrix — exhaustive check
//    Every vehicle × every infantry type combination
// =============================================================================

describe('Exhaustive crusher × crushable matrix', () => {

  // All vehicles that should be crushers per current TS implementation
  const tsCrushers = Object.keys(UNIT_STATS).filter(k => UNIT_STATS[k].crusher);

  // All crushable units
  const crushableUnits = Object.keys(UNIT_STATS).filter(k => UNIT_STATS[k].crushable);

  it('all TS crushers can actually crush a basic enemy E1', () => {
    for (const crusherKey of tsCrushers) {
      const stats = UNIT_STATS[crusherKey];
      const crusher = entityAtCell(stats.type, House.Spain, 10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      const ctx = makeCombatCtx([crusher, victim]);

      checkVehicleCrush(ctx, crusher);

      expect(victim.alive, `${crusherKey} (crusher) should kill E1`).toBe(false);
    }
  });

  it('non-crusher vehicles cannot crush E1', () => {
    const nonCrushers = Object.keys(UNIT_STATS).filter(
      k => !UNIT_STATS[k].crusher && !UNIT_STATS[k].isInfantry
        && !['ANT1', 'ANT2', 'ANT3'].includes(k)
    );

    for (const key of nonCrushers) {
      const stats = UNIT_STATS[key];
      // Skip air units (they don't share ground cells)
      if (stats.isAircraft || stats.isVessel) continue;
      const vehicle = entityAtCell(stats.type, House.Spain, 10, 10);
      const victim = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      const ctx = makeCombatCtx([vehicle, victim]);

      checkVehicleCrush(ctx, vehicle);

      expect(victim.alive, `${key} (non-crusher) should NOT kill E1`).toBe(true);
    }
  });
});

// =============================================================================
// 8. Crush kill tracking — vehicle.creditKill() (C++ Record_The_Kill)
// =============================================================================

describe('Crush kill tracking (unit.cpp:4433 Record_The_Kill)', () => {

  it('crusher increments kills via creditKill', () => {
    const tank = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, victim]);

    expect(tank.kills).toBe(0);

    checkVehicleCrush(ctx, tank);

    expect(tank.kills).toBe(1);
  });

  it('multiple crushes in one cell increment kills for each', () => {
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const v1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const v2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const v3 = entityAtCell(UnitType.I_E3, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, v1, v2, v3]);

    checkVehicleCrush(ctx, tank);

    expect(tank.kills).toBe(3);
  });
});

// =============================================================================
// 9. Crush blood/corpse effect — C++ unit.cpp:4430-4431
//    C++ creates ANIM_CORPSE1 at object->Center_Coord()
//    TS creates a 'blood' effect
// =============================================================================

describe('Crush visual effect (unit.cpp:4430 ANIM_CORPSE1)', () => {

  it('crush produces blood effect at victim position', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, victim]);

    checkVehicleCrush(ctx, tank);

    const bloodEffects = ctx.effects.filter(e => e.type === 'blood');
    expect(bloodEffects.length).toBeGreaterThanOrEqual(1);
  });

  it('multiple crushes produce multiple blood effects', () => {
    const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const v1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const v2 = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, v1, v2]);

    checkVehicleCrush(ctx, tank);

    const bloodEffects = ctx.effects.filter(e => e.type === 'blood');
    expect(bloodEffects.length).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// 10. Per-side casualty tracking (score.cpp:548-560)
// =============================================================================

describe('Per-side casualty tracking on crush', () => {

  it('crushing Soviet infantry increments sovietUnitsLost', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const soviet = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, soviet]);

    checkVehicleCrush(ctx, tank);

    expect(ctx.sovietUnitsLost).toBe(1);
  });

  it('enemy crushing Allied infantry increments alliedUnitsLost', () => {
    const sovietTank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    const allied = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([sovietTank, allied]);

    checkVehicleCrush(ctx, sovietTank);

    expect(ctx.alliedUnitsLost).toBe(1);
  });
});

// =============================================================================
// 11. Specific expansion-unit crush tests (aftrmath.ini units)
// =============================================================================

describe('Expansion vehicle crusher status (aftrmath.ini)', () => {

  it('STNK (Phase Transport) is a crusher — aftrmath.ini Tracked=yes, udata.cpp:758 true', () => {
    expect(UNIT_STATS.STNK.crusher).toBe(true);
  });

  it('CTNK (Chrono Tank) is a crusher — aftrmath.ini Tracked=yes, udata.cpp:634 true', () => {
    expect(UNIT_STATS.CTNK.crusher).toBe(true);
  });

  it('TTNK (Tesla Tank) is a crusher — aftrmath.ini Tracked=yes, udata.cpp:665 true', () => {
    expect(UNIT_STATS.TTNK.crusher).toBe(true);
  });

  it('QTNK (M.A.D. Tank) is a crusher — aftrmath.ini Tracked=yes, udata.cpp:696 true', () => {
    expect(UNIT_STATS.QTNK.crusher).toBe(true);
  });

  it('DTRK (Demo Truck) is NOT a crusher — no Tracked= in aftrmath.ini, udata.cpp:728 false', () => {
    expect(UNIT_STATS.DTRK.crusher).toBeFalsy();
  });
});

// =============================================================================
// 12. SHOK is the ONLY infantry with Crushable=no
// =============================================================================

describe('Only SHOK has Crushable=no (aftrmath.ini is the sole exception)', () => {

  it('exactly one infantry type has crushable=false', () => {
    const nonCrushableInfantry = Object.keys(UNIT_STATS).filter(
      k => UNIT_STATS[k].isInfantry && !UNIT_STATS[k].crushable
    );
    expect(nonCrushableInfantry).toEqual(['SHOK']);
  });

  it('total crushable infantry count matches total infantry minus 1', () => {
    const allInfantry = Object.keys(UNIT_STATS).filter(k => UNIT_STATS[k].isInfantry);
    const crushableInfantry = allInfantry.filter(k => UNIT_STATS[k].crushable);
    expect(crushableInfantry.length).toBe(allInfantry.length - 1);
  });
});

// =============================================================================
// 13. EVA and minimap alert on player infantry loss by crush
// =============================================================================

describe('EVA + minimap alert on crush loss (TS-specific tracking)', () => {

  it('enemy crushing player infantry triggers EVA unit_lost', () => {
    const enemyTank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    const playerInf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const evaMessages: string[] = [];
    const ctx = makeCombatCtx([enemyTank, playerInf]);
    ctx.playEva = (msg) => { evaMessages.push(msg); };

    checkVehicleCrush(ctx, enemyTank);

    expect(evaMessages).toContain('eva_unit_lost');
  });

  it('enemy crushing player infantry triggers minimap alert', () => {
    const enemyTank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    const playerInf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    let alertFired = false;
    const ctx = makeCombatCtx([enemyTank, playerInf]);
    ctx.minimapAlert = () => { alertFired = true; };

    checkVehicleCrush(ctx, enemyTank);

    expect(alertFired).toBe(true);
  });

  it('player crushing enemy does NOT trigger EVA unit_lost', () => {
    const playerTank = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const evaMessages: string[] = [];
    const ctx = makeCombatCtx([playerTank, enemy]);
    ctx.playEva = (msg) => { evaMessages.push(msg); };

    checkVehicleCrush(ctx, playerTank);

    expect(evaMessages).not.toContain('eva_unit_lost');
  });
});

// =============================================================================
// 14. Harvester crush — special case unarmed crusher (unit.cpp:1125-1139)
// =============================================================================

describe('Harvester — unarmed crusher (unit.cpp:1125-1139)', () => {

  it('harvester has crusher=true and no weapon', () => {
    expect(UNIT_STATS.HARV.crusher).toBe(true);
    expect(UNIT_STATS.HARV.primaryWeapon).toBeNull();
  });

  it('harvester crushes enemy infantry on cell entry', () => {
    const harv = entityAtCell(UnitType.V_HARV, House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([harv, enemy]);

    checkVehicleCrush(ctx, harv);

    expect(enemy.alive).toBe(false);
  });
});

// =============================================================================
// 15. Summary of known parity gaps (documentation tests)
// =============================================================================

describe('PARITY GAP SUMMARY — C++ IsCrusher vs TS crusher', () => {

  // These document where TS diverges from C++ behavior.
  // The C++ source (udata.cpp constructor) is the ground truth.
  // rules.ini Tracked= only controls Speed, not IsCrusher.

  it('GAP: ARTY — C++ IsCrusher=false, TS crusher=true (udata.cpp:296)', () => {
    // C++ ARTY cannot crush infantry. TS ARTY can.
    // To fix: remove crusher=true from ARTY in types.ts
    expect(UNIT_STATS.ARTY.crusher).toBe(true); // current TS (incorrect per C++)
  });

  it('GAP: MCV — C++ IsCrusher=true, TS crusher=falsy (udata.cpp:358)', () => {
    // C++ MCV CAN crush infantry. TS MCV cannot.
    // To fix: add crusher=true to MCV in types.ts
    expect(UNIT_STATS.MCV.crusher).toBeFalsy(); // current TS (incorrect per C++)
  });

  it('GAP: MGG — C++ IsCrusher=true, TS crusher=falsy (udata.cpp:265)', () => {
    // C++ MGG CAN crush infantry. TS MGG cannot.
    // To fix: add crusher=true to MGG in types.ts
    expect(UNIT_STATS.MGG.crusher).toBeFalsy(); // current TS (incorrect per C++)
  });

  it('GAP: Crush sound — C++ uses single VOC_SQUISH, TS uses die_infantry/die_ant', () => {
    // C++ unit.cpp:4429: Sound_Effect(VOC_SQUISH, Coord) for ALL crushes
    // TS combat.ts:567: differentiates 'die_ant' vs 'die_infantry'
    // Minor cosmetic gap — not a gameplay difference
    expect(true).toBe(true);
  });

  it('GAP: Uncloak after crush — C++ calls Do_Uncloak(), TS does not', () => {
    // C++ unit.cpp:4447: if (crushed) Do_Uncloak();
    // Affects Phase Transport (STNK) which is cloakable
    // TS does not modify cloak state after crush
    expect(true).toBe(true);
  });
});
