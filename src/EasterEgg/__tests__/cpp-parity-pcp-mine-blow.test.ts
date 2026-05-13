/**
 * C++ Behavioral Parity: PCP_END land-mine blow
 *
 * Pins the cell-arrival mine-detonation semantics from
 *   `UnitClass::Per_Cell_Process` — unit.cpp:1806-1838
 *   `InfantryClass::Per_Cell_Process` — infantry.cpp:916-942
 *
 * The TS engine does not yet route mine-blow through the
 * `unitPerCellProcess` PCP_END hook. Instead, the per-tick
 * `tickMines` scan in `specialUnits.ts:209` (invoked from
 * `Game.update` at `index.ts:2576`) walks every mine against
 * every entity-cell each logic tick. Because units snap to cell
 * coordinates the moment they end a track-step, the observable
 * outcome — a unit ending its move on an enemy AVMINE/APMINE
 * cell takes mine damage on the same tick the cell is reached —
 * matches the C++ PCP_END behavior. These tests pin that
 * timing equivalence so a future refactor that moves the call
 * into `unitPerCellProcess` doesn't silently break it.
 *
 * === C++ behavior pinned here (unit.cpp:1806-1837) ===
 *
 *   BuildingClass * bldng = Map[cell].Cell_Building();
 *   if (bldng != NULL && (*bldng == STRUCT_AVMINE || *bldng == STRUCT_APMINE)
 *       && !bldng->House->Is_Ally(this)) {
 *     // Special case: minelayer over its own deployed mine — ignore
 *     if (*this != UNIT_MINELAYER || bldng->House != House) {
 *       COORDINATE blcoord = bldng->Center_Coord();
 *       new AnimClass(ANIM_MINE_EXP1, blcoord);
 *       if (*bldng == STRUCT_AVMINE) {
 *         int damage = Rule.AVMineDamage;           // rules.ini AVMineDamage
 *         Take_Damage(damage, 0, WARHEAD_HE);
 *       } else {
 *         int damage = 10;                          // hardcoded — NOT in rules.ini
 *         Take_Damage(damage, 0, WARHEAD_HE);
 *       }
 *       delete bldng;
 *       if (!IsActive) { BEnd(BENCH_PCP); return; }
 *     }
 *   }
 *
 * === C++ behavior pinned here (infantry.cpp:920-942) ===
 *
 *   if (bldng != NULL && *bldng == STRUCT_APMINE) {
 *     // AV mines do NOT trigger on infantry — only AP
 *     COORDINATE blcoord = bldng->Center_Coord();
 *     new AnimClass(Combat_Anim(Rule.APMineDamage, WARHEAD_HE, ...), blcoord);
 *     delete bldng;
 *     for each infantry within 0xC0 leptons of blcoord:
 *       Take_Damage(Rule.APMineDamage, 0, WARHEAD_HE);   // splash damage
 *   }
 *
 * Damage constants are parsed from rules.ini (NEVER hardcoded). The vehicle
 * AP-mine damage of 10 is the one exception — it is hardcoded in C++ source
 * (unit.cpp:1828) and is verified against the C++ literal.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  UnitType, House, CELL_SIZE,
  Mission,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  tickMines,
  type SpecialUnitsContext,
} from '../engine/specialUnits';
import type { Effect } from '../engine/renderer';
import { parseIniSections } from '../engine/parseIni';

beforeEach(() => resetEntityIds());

// ── INI Parsing ─────────────────────────────────────────────────────────────

function loadIni(filename: string): string {
  const candidates = [
    resolve(process.cwd(), `public/ra/assets/${filename}`),
    resolve(__dirname, `../../../public/ra/assets/${filename}`),
    resolve(__dirname, `../../../../public/ra/assets/${filename}`),
  ];
  for (const c of candidates) {
    try { return readFileSync(c, 'utf-8'); } catch { /* next */ }
  }
  throw new Error(`${filename} not found`);
}

const sections = parseIniSections(loadIni('rules.ini'));

function iniInt(section: string, key: string): number {
  const sec = sections.get(section);
  if (!sec) throw new Error(`[${section}] missing from rules.ini`);
  const val = sec.get(key);
  if (val === undefined) throw new Error(`${key} missing from [${section}]`);
  return Number.parseInt(val, 10);
}

// rules.ini [General] — authoritative damage values. NEVER hardcoded.
const AV_MINE_DAMAGE = iniInt('General', 'AVMineDamage');
const AP_MINE_DAMAGE = iniInt('General', 'APMineDamage');

// C++ unit.cpp:1828 — hardcoded vehicle-vs-AP-mine damage. Verified against
// C++ source, NOT rules.ini. This is the one constant that is not in INI.
const VEHICLE_AP_MINE_DAMAGE_CPP_LITERAL = 10;

// ── Test Helpers ────────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

const alliances = buildDefaultAlliances();

type Damage = { entity: Entity; amount: number; warhead: string };

function makeContext(overrides: Partial<SpecialUnitsContext> = {}): SpecialUnitsContext & { _damaged: Damage[] } {
  const entities: Entity[] = overrides.entities ?? [];
  const mines: SpecialUnitsContext['mines'] = overrides.mines ?? [];
  const effects: Effect[] = overrides.effects ?? [];
  const damaged: Damage[] = [];

  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
    mines,
    activeVortices: [],
    effects,
    tick: 100,
    playerHouse: House.Spain,
    credits: 10000,
    houseCredits: new Map(),
    map: { getTerrain: () => 0 } as any,
    evaMessages: [],
    isThieved: false,
    isAllied: (a: House, b: House) => {
      if (a === b) return true;
      return alliances.get(a)?.has(b) ?? false;
    },
    entitiesAllied: (a: Entity, b: Entity) => {
      if (a.house === b.house) return true;
      return alliances.get(a.house)?.has(b.house) ?? false;
    },
    isPlayerControlled: (e: Entity) => e.house === House.Spain,
    playSoundAt: () => {},
    playSound: () => {},
    movementSpeed: () => 0.5,
    damageEntity: (target: Entity, amount: number, warhead: string) => {
      damaged.push({ entity: target, amount, warhead });
      target.hp -= amount;
      if (target.hp <= 0) { target.alive = false; return true; }
      return false;
    },
    damageStructure: () => false,
    addEntity: (e: Entity) => entities.push(e),
    screenShake: 0,
    ...overrides,
    _damaged: damaged,
  } as SpecialUnitsContext & { _damaged: Damage[] };
}

// =============================================================================
// 1. AVMINE blows under enemy vehicle — C++ unit.cpp:1824-1827
// =============================================================================

describe('PCP_END parity: AVMINE under enemy vehicle', () => {
  it('vehicle ending cell-step on enemy AVMINE takes AVMineDamage HE damage', () => {
    // Soviet heavy tank arrives at a cell containing an Allied AVMINE.
    const vehicle = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const effects: Effect[] = [];
    const ctx = makeContext({ entities: [vehicle], mines, effects });

    tickMines(ctx);

    // Damage applied with WARHEAD_HE (unit.cpp:1826)
    expect(ctx._damaged).toHaveLength(1);
    expect(ctx._damaged[0].entity.id).toBe(vehicle.id);
    expect(ctx._damaged[0].amount).toBe(AV_MINE_DAMAGE);
    expect(ctx._damaged[0].warhead).toBe('HE');

    // Mine deleted (unit.cpp:1831 delete bldng)
    expect(mines).toHaveLength(0);

    // Explosion animation at mine center (unit.cpp:1818 ANIM_MINE_EXP1)
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe('explosion');
    expect(effects[0].x).toBe(10 * CELL_SIZE + CELL_SIZE / 2);
    expect(effects[0].y).toBe(10 * CELL_SIZE + CELL_SIZE / 2);
  });
});

// =============================================================================
// 2. APMINE blows under enemy infantry — C++ infantry.cpp:920-934
// =============================================================================

describe('PCP_END parity: APMINE under enemy infantry', () => {
  it('infantry ending cell-step on enemy APMINE takes APMineDamage HE damage', () => {
    // C++ infantry.cpp:925, 933-934 — infantry on APMINE takes Rule.APMineDamage
    // with WARHEAD_HE. This is the canonical APMineDamage path (1000 from
    // rules.ini), not the hardcoded 10-damage path which applies only to
    // vehicles running over an APMINE (unit.cpp:1828).
    const inf = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AP_MINE_DAMAGE, type: 'AP' },
    ];
    const effects: Effect[] = [];
    const ctx = makeContext({ entities: [inf], mines, effects });

    tickMines(ctx);

    const hit = ctx._damaged.find(d => d.entity.id === inf.id);
    expect(hit).toBeDefined();
    expect(hit!.amount).toBe(AP_MINE_DAMAGE);
    expect(hit!.warhead).toBe('HE');

    expect(mines).toHaveLength(0);
    expect(effects[0].type).toBe('explosion');
  });
});

// =============================================================================
// 3. APMINE under enemy vehicle — hardcoded 10 damage (C++ unit.cpp:1828-1830)
//
// Distinct from case 2 above: a *vehicle* that runs over an APMINE takes
// only 10 damage, not Rule.APMineDamage. This is the hardcoded literal in
// the C++ source; the task brief calls this out specifically.
// =============================================================================

describe('PCP_END parity: APMINE under enemy vehicle takes hardcoded 10 damage', () => {
  it('vehicle on APMINE takes exactly 10 HE damage (C++ unit.cpp:1828 literal)', () => {
    const vehicle = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AP_MINE_DAMAGE, type: 'AP' },
    ];
    const ctx = makeContext({ entities: [vehicle], mines });

    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(1);
    expect(ctx._damaged[0].amount).toBe(VEHICLE_AP_MINE_DAMAGE_CPP_LITERAL);
    expect(ctx._damaged[0].amount).not.toBe(AP_MINE_DAMAGE);
    expect(ctx._damaged[0].warhead).toBe('HE');
  });
});

// =============================================================================
// 4. Alliance check — AVMINE under allied vehicle does NOT blow
//    C++ unit.cpp:1807 — `!bldng->House->Is_Ally(this)` outer gate.
// =============================================================================

describe('PCP_END parity: AVMINE under allied vehicle does not blow', () => {
  it('allied (same-house) vehicle on AVMINE: no damage, mine survives', () => {
    const vehicle = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const effects: Effect[] = [];
    const ctx = makeContext({ entities: [vehicle], mines, effects });

    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(0);
    expect(mines).toHaveLength(1);
    expect(effects).toHaveLength(0);
  });

  it('cross-allied (Spain ↔ Greece) vehicle on AVMINE: no damage, mine survives', () => {
    // buildDefaultAlliances wires Spain ↔ Greece, so a Greek tank should
    // treat a Spanish AVMINE as friendly per the C++ Is_Ally chain.
    const vehicle = entityAtCell(UnitType.V_2TNK, House.Greece, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const ctx = makeContext({ entities: [vehicle], mines });

    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(0);
    expect(mines).toHaveLength(1);
  });
});

// =============================================================================
// 5. Minelayer over its own house's mine — C++ unit.cpp:1814
//    `*this != UNIT_MINELAYER || bldng->House != House`
//
// In C++ this is a defensive inner carve-out: a minelayer running over a
// freshly-placed friendly mine should not blow itself up. The outer Is_Ally
// gate at unit.cpp:1807 already filters same-house mines (a house is always
// allied to itself), so this case is observationally identical to the
// alliance-check fallthrough. We pin it explicitly so future refactors that
// move into a per-cell-process hook preserve the carve-out unambiguously.
// =============================================================================

describe('PCP_END parity: minelayer over its own deployed AVMINE does not blow', () => {
  it('Allied MNLY standing on its own AVMINE: no damage, mine survives', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.mission = Mission.GUARD;
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const ctx = makeContext({ entities: [mnly], mines });

    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(0);
    expect(mines).toHaveLength(1);
    expect(mnly.alive).toBe(true);
  });
});

// =============================================================================
// 6. Vehicle destroyed by mine — entity.alive flips false
//    C++ unit.cpp:1832-1835 — `if (!IsActive) { BEnd(BENCH_PCP); return; }`
//
// The C++ Take_Damage path may destroy the unit; PCP_END then early-returns
// instead of running the impassable-cell suicide check below. In TS the
// damageEntity callback flips entity.alive on hp<=0. Pin both outcomes:
// alive=false AND tickMines reported the damage event.
// =============================================================================

describe('PCP_END parity: vehicle destroyed by AVMINE', () => {
  it('low-HP vehicle on enemy AVMINE: hp ≤ 0 → alive=false, mine consumed', () => {
    const vehicle = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    // Reduce HP below AVMineDamage so the mine kills the tank in one hit.
    vehicle.hp = 50;
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const ctx = makeContext({ entities: [vehicle], mines });

    expect(vehicle.alive).toBe(true);
    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(1);
    expect(ctx._damaged[0].amount).toBe(AV_MINE_DAMAGE);
    expect(vehicle.alive).toBe(false);
    expect(vehicle.hp).toBeLessThanOrEqual(0);
    expect(mines).toHaveLength(0);
  });
});

// =============================================================================
// 7. AVMINE does NOT trigger on enemy infantry — C++ infantry.cpp:920
//    The infantry PCP_END branch ONLY checks STRUCT_APMINE; AV mines are
//    entirely transparent to foot-soldiers.
// =============================================================================

describe('PCP_END parity: AVMINE under enemy infantry is inert', () => {
  it('enemy infantry on AVMINE: no damage, mine survives', () => {
    const inf = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const ctx = makeContext({ entities: [inf], mines });

    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(0);
    expect(mines).toHaveLength(1);
    expect(inf.alive).toBe(true);
  });
});

// =============================================================================
// 8. Cell-arrival timing — entity NOT on mine cell does NOT trigger
//    Verifies the scan only fires when entity.cell matches mine.cell —
//    i.e. when the entity has actually arrived at the mined cell. This
//    is the load-bearing timing guarantee that makes the per-tick
//    tickMines scan observationally equivalent to a PCP_END hook.
// =============================================================================

describe('PCP_END parity: entity on adjacent (non-mine) cell does not trigger', () => {
  it('enemy vehicle one cell away from AVMINE: no damage', () => {
    const vehicle = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const ctx = makeContext({ entities: [vehicle], mines });

    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(0);
    expect(mines).toHaveLength(1);
  });
});
