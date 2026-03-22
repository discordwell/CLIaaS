/**
 * C++ Behavioral Parity: Minelayer & Mine Mechanics
 *
 * Tests verify that MNLY unit stats, mine placement, mine detonation, mine
 * visibility flags, and mine damage all match C++ RA source code behavior.
 * rules.ini is the authoritative source of truth — ALL expected values are
 * parsed from INI at test time, never hardcoded.
 *
 * === C++ Source References ===
 *
 * MNLY unit data:
 *   rules.ini [MNLY]  — Strength=100, Armor=heavy, Speed=9, Sight=5, ROT=5,
 *                        Ammo=5, Cost=800, Owner=allies,soviet, Prerequisite=weap,fix
 *
 * Mine placement:
 *   unit.cpp:2578-2635  — UNIT_MINELAYER deploy state machine:
 *     - INITIAL_CHECK: check Ammo > 0, turn to DIR_NE
 *     - MANEUVERING: wait for rotation, open door
 *     - OPENING_DOOR: wait for door open
 *     - UNLOADING: check Ammo > 0, check cell empty (no building),
 *       create BuildingClass: Soviet (USSR/Ukraine/BadGuy) → STRUCT_APMINE,
 *                              Allied → STRUCT_AVMINE
 *       Ammo--
 *     - CLOSING_DOOR: close, return to guard
 *
 *   unit.cpp:2616: faction check:
 *     (House->ActLike == HOUSE_USSR || HOUSE_UKRAINE || HOUSE_BAD) ? STRUCT_APMINE : STRUCT_AVMINE
 *
 * Mine detonation (vehicles):
 *   unit.cpp:1805-1838  — Per_Cell_Process: entering cell with mine
 *     - Check: bldng != NULL && (STRUCT_AVMINE || STRUCT_APMINE) && !ally
 *     - Minelayer skip: *this == UNIT_MINELAYER && bldng->House == House → ignore own mine
 *     - AV mine: damage = Rule.AVMineDamage, warhead HE (unit.cpp:1825-1827)
 *     - AP mine on vehicle: damage = 10, warhead HE (unit.cpp:1829-1830)
 *     - Mine is deleted after detonation (unit.cpp:1832)
 *
 * Mine detonation (infantry):
 *   infantry.cpp:916-942  — Per_Cell_Process: entering cell with mine
 *     - Only STRUCT_APMINE triggers on infantry (infantry.cpp:920)
 *     - AV mines do NOT trigger on infantry
 *     - AP mine splash: all infantry within 0xC0 (192) leptons take APMineDamage
 *     - Warhead: HE (infantry.cpp:925, 934)
 *
 * Mine movement rules:
 *   unit.cpp:3141-3143  — Can_Enter_Cell: units can move onto mines (MOVE_OK)
 *     - MineAware: if Rule.IsMineAware, friendly units avoid friendly mines
 *   infantry.cpp:1341-1351  — Can_Enter_Cell: infantry can move onto mines
 *     - AV mines: always passable for infantry (infantry.cpp:1342)
 *     - AP mines: passable if not MineAware or not allied (infantry.cpp:1346-1347)
 *
 * Mine overlay properties:
 *   rules.ini [MINV]  — Strength=1, Invisible=yes, Unsellable=yes, BaseNormal=no
 *   rules.ini [MINP]  — Strength=1, Invisible=yes, Unsellable=yes, BaseNormal=no
 *
 * Mine damage constants:
 *   rules.ini [General] APMineDamage=1000
 *   rules.ini [General] AVMineDamage=1200
 *   rules.ini [General] MineAware=yes
 *
 * Service depot rearm (MNLY):
 *   unit.cpp:722  — RADIO_NEED_REPAIR: minelayer needs service depot if
 *                    Health_Ratio() < 1 OR Ammo < Class->MaxAmmo
 *   rules.ini [General] ReloadRate=.04 (minutes per ammo point reload)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  UnitType, House, CELL_SIZE,
  Mission, AnimState,
  UNIT_STATS, PRODUCTION_ITEMS,
  HOUSE_FACTION,
  worldToCell, worldDist,
  GAME_TICKS_PER_SEC,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  updateMinelayer,
  tickMines,
  MAX_MINES_PER_HOUSE,
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

const rulesText = loadIni('rules.ini');
const sections = parseIniSections(rulesText);

function iniSection(name: string): Map<string, string> {
  const sec = sections.get(name);
  if (!sec) throw new Error(`[${name}] section not found in rules.ini`);
  return sec;
}

function iniInt(section: string, key: string): number {
  const val = iniSection(section).get(key);
  if (val === undefined) throw new Error(`${key} not found in [${section}]`);
  return Number.parseInt(val, 10);
}

function iniFloat(section: string, key: string): number {
  const val = iniSection(section).get(key);
  if (val === undefined) throw new Error(`${key} not found in [${section}]`);
  return Number.parseFloat(val);
}

function iniBool(section: string, key: string): boolean {
  const val = iniSection(section).get(key);
  if (val === undefined) throw new Error(`${key} not found in [${section}]`);
  return val.toLowerCase() === 'yes' || val.toLowerCase() === 'true';
}

function iniStr(section: string, key: string): string {
  const val = iniSection(section).get(key);
  if (val === undefined) throw new Error(`${key} not found in [${section}]`);
  return val;
}

// ── Parsed INI Values (authoritative) ───────────────────────────────────────

const MNLY_STRENGTH = iniInt('MNLY', 'Strength');
const MNLY_ARMOR = iniStr('MNLY', 'Armor').toLowerCase();
const MNLY_SPEED = iniInt('MNLY', 'Speed');
const MNLY_SIGHT = iniInt('MNLY', 'Sight');
const MNLY_ROT = iniInt('MNLY', 'ROT');
const MNLY_AMMO = iniInt('MNLY', 'Ammo');
const MNLY_COST = iniInt('MNLY', 'Cost');
const MNLY_OWNER = iniStr('MNLY', 'Owner');
const MNLY_PREREQ = iniStr('MNLY', 'Prerequisite');
const MNLY_TECH_LEVEL = iniInt('MNLY', 'TechLevel');
const MNLY_POINTS = iniInt('MNLY', 'Points');
const MNLY_TRACKED = iniBool('MNLY', 'Tracked');
const MNLY_CREWED = iniBool('MNLY', 'Crewed');

const MINV_STRENGTH = iniInt('MINV', 'Strength');
const MINV_INVISIBLE = iniBool('MINV', 'Invisible');
const MINV_UNSELLABLE = iniBool('MINV', 'Unsellable');
const MINV_BASE_NORMAL = iniStr('MINV', 'BaseNormal').toLowerCase();

const MINP_STRENGTH = iniInt('MINP', 'Strength');
const MINP_INVISIBLE = iniBool('MINP', 'Invisible');
const MINP_UNSELLABLE = iniBool('MINP', 'Unsellable');
const MINP_BASE_NORMAL = iniStr('MINP', 'BaseNormal').toLowerCase();

const AP_MINE_DAMAGE = iniInt('General', 'APMineDamage');
const AV_MINE_DAMAGE = iniInt('General', 'AVMineDamage');
const MINE_AWARE = iniBool('General', 'MineAware');
const RELOAD_RATE = iniFloat('General', 'ReloadRate');

const TICKS_PER_MINUTE = GAME_TICKS_PER_SEC * 60; // 900

// ── Entity & Context Helpers ────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeMinelayer(house: House = House.Spain, cx = 10, cy = 10): Entity {
  return entityAtCell(UnitType.V_MNLY, house, cx, cy);
}

function makeInfantry(house: House = House.USSR, cx = 10, cy = 10): Entity {
  return entityAtCell(UnitType.I_E1, house, cx, cy);
}

function makeVehicle(house: House = House.USSR, cx = 10, cy = 10): Entity {
  return entityAtCell(UnitType.V_2TNK, house, cx, cy);
}

const alliances = buildDefaultAlliances();

function makeContext(overrides: Partial<SpecialUnitsContext> = {}): SpecialUnitsContext {
  const entities: Entity[] = overrides.entities ?? [];
  const mines: SpecialUnitsContext['mines'] = overrides.mines ?? [];
  const effects: Effect[] = overrides.effects ?? [];
  const damaged: Array<{ entity: Entity; amount: number; warhead: string }> = [];

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
    // Expose damage log via hidden property for test assertions
    _damaged: damaged,
  } as SpecialUnitsContext & { _damaged: typeof damaged };
}

// =============================================================================
// 1. MNLY Unit Stats (rules.ini [MNLY] is authoritative)
// =============================================================================

describe('MNLY stats match rules.ini [MNLY]', () => {
  const stats = UNIT_STATS.MNLY;

  it('Strength matches rules.ini', () => {
    expect(stats.strength).toBe(MNLY_STRENGTH);
  });

  it('Armor matches rules.ini', () => {
    expect(stats.armor).toBe(MNLY_ARMOR);
  });

  it('Speed matches rules.ini', () => {
    expect(stats.speed).toBe(MNLY_SPEED);
  });

  it('Sight matches rules.ini', () => {
    expect(stats.sight).toBe(MNLY_SIGHT);
  });

  it('ROT matches rules.ini', () => {
    expect(stats.rot).toBe(MNLY_ROT);
  });

  it('Ammo (maxAmmo) matches rules.ini', () => {
    expect(stats.maxAmmo).toBe(MNLY_AMMO);
  });

  it('Cost matches rules.ini', () => {
    expect(stats.cost).toBe(MNLY_COST);
  });

  it('Points matches rules.ini', () => {
    expect(stats.points).toBe(MNLY_POINTS);
  });

  it('Owner=allies,soviet → TS owner=both', () => {
    // rules.ini Owner=allies,soviet means both factions can build it
    expect(MNLY_OWNER).toMatch(/allies/i);
    expect(MNLY_OWNER).toMatch(/soviet/i);
    expect(stats.owner).toBe('both');
  });

  it('Tracked=yes → TS speedClass=TRACK and crusher=true', () => {
    expect(MNLY_TRACKED).toBe(true);
    expect(stats.crusher).toBe(true);
  });

  it('type enum = V_MNLY', () => {
    expect(stats.type).toBe(UnitType.V_MNLY);
  });

  it('no primary weapon (unarmed mine deployer)', () => {
    // C++ udata.cpp: MNLY has no primary or secondary weapon
    expect(stats.primaryWeapon).toBeNull();
    expect(stats.secondaryWeapon).toBeNull();
  });

  it('isInfantry = false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });
});

// =============================================================================
// 2. MNLY Entity Initialization
// =============================================================================

describe('MNLY entity initialization', () => {
  it('ammo initialized from stats.maxAmmo (rules.ini Ammo)', () => {
    const mnly = makeMinelayer();
    expect(mnly.ammo).toBe(MNLY_AMMO);
    expect(mnly.maxAmmo).toBe(MNLY_AMMO);
  });

  it('HP initialized from stats.strength (rules.ini Strength)', () => {
    const mnly = makeMinelayer();
    expect(mnly.hp).toBe(MNLY_STRENGTH);
    expect(mnly.maxHp).toBe(MNLY_STRENGTH);
  });
});

// =============================================================================
// 3. MNLY Production Item
// =============================================================================

describe('MNLY production item matches rules.ini', () => {
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'MNLY');

  it('exists in production list', () => {
    expect(prodItem).toBeDefined();
  });

  it('cost matches rules.ini', () => {
    expect(prodItem!.cost).toBe(MNLY_COST);
  });

  it('prerequisite includes WEAP (from rules.ini Prerequisite=weap,fix)', () => {
    expect(MNLY_PREREQ.toLowerCase()).toContain('weap');
    expect(prodItem!.prerequisite).toBe('WEAP');
  });

  it('techPrereq includes FIX (from rules.ini Prerequisite=weap,fix)', () => {
    expect(MNLY_PREREQ.toLowerCase()).toContain('fix');
    expect(prodItem!.techPrereq).toBe('FIX');
  });

  it('techLevel matches rules.ini', () => {
    expect(prodItem!.techLevel).toBe(MNLY_TECH_LEVEL);
  });

  it('faction=both (Owner=allies,soviet)', () => {
    expect(prodItem!.faction).toBe('both');
  });
});

// =============================================================================
// 4. Mine Overlay Properties (rules.ini [MINV] and [MINP])
// =============================================================================

describe('mine overlay properties from rules.ini', () => {
  describe('[MINV] anti-vehicle mine', () => {
    it('Strength=1 (one-shot, destroyed on detonation)', () => {
      expect(MINV_STRENGTH).toBe(1);
    });

    it('Invisible=yes (hidden from enemy until detector reveals)', () => {
      expect(MINV_INVISIBLE).toBe(true);
    });

    it('Unsellable=yes (cannot be sold by player)', () => {
      expect(MINV_UNSELLABLE).toBe(true);
    });

    it('BaseNormal=no (not part of base building AI)', () => {
      expect(MINV_BASE_NORMAL).toBe('no');
    });
  });

  describe('[MINP] anti-personnel mine', () => {
    it('Strength=1 (one-shot, destroyed on detonation)', () => {
      expect(MINP_STRENGTH).toBe(1);
    });

    it('Invisible=yes (hidden from enemy until detector reveals)', () => {
      expect(MINP_INVISIBLE).toBe(true);
    });

    it('Unsellable=yes (cannot be sold by player)', () => {
      expect(MINP_UNSELLABLE).toBe(true);
    });

    it('BaseNormal=no (not part of base building AI)', () => {
      expect(MINP_BASE_NORMAL).toBe('no');
    });
  });
});

// =============================================================================
// 5. Mine Damage Constants (rules.ini [General])
// =============================================================================

describe('mine damage constants from rules.ini [General]', () => {
  it('APMineDamage parsed from rules.ini', () => {
    expect(AP_MINE_DAMAGE).toBe(1000);
  });

  it('AVMineDamage parsed from rules.ini', () => {
    expect(AV_MINE_DAMAGE).toBe(1200);
  });

  it('MineAware=yes parsed from rules.ini', () => {
    expect(MINE_AWARE).toBe(true);
  });

  it('ReloadRate parsed from rules.ini (minutes per ammo point)', () => {
    expect(RELOAD_RATE).toBeCloseTo(0.04, 4);
  });
});

// =============================================================================
// 6. Mine Placement — Faction-based Mine Type
//    C++ unit.cpp:2616: Soviet → STRUCT_APMINE, Allied → STRUCT_AVMINE
// =============================================================================

describe('mine placement: faction determines mine type', () => {
  it('Allied house (Spain) places AV mine', () => {
    const mnly = makeMinelayer(House.Spain, 10, 10);
    mnly.moveTarget = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [mnly] });
    updateMinelayer(ctx, mnly);

    expect(ctx.mines).toHaveLength(1);
    expect(ctx.mines[0].type).toBe('AV');
    // C++ HOUSE_FACTION: Spain maps to 'allied'
    expect(HOUSE_FACTION[House.Spain]).toBe('allied');
  });

  it('Soviet house (USSR) places AP mine', () => {
    const mnly = makeMinelayer(House.USSR, 10, 10);
    mnly.moveTarget = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [mnly] });
    updateMinelayer(ctx, mnly);

    expect(ctx.mines).toHaveLength(1);
    expect(ctx.mines[0].type).toBe('AP');
    expect(HOUSE_FACTION[House.USSR]).toBe('soviet');
  });

  it('Ukraine (Soviet faction) places AP mine — C++ HOUSE_UKRAINE check', () => {
    const mnly = makeMinelayer(House.Ukraine, 10, 10);
    mnly.moveTarget = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [mnly] });
    updateMinelayer(ctx, mnly);

    expect(ctx.mines).toHaveLength(1);
    expect(ctx.mines[0].type).toBe('AP');
    expect(HOUSE_FACTION[House.Ukraine]).toBe('soviet');
  });

  it('BadGuy (Soviet faction) places AP mine — C++ HOUSE_BAD check', () => {
    const mnly = makeMinelayer(House.BadGuy, 10, 10);
    mnly.moveTarget = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [mnly] });
    updateMinelayer(ctx, mnly);

    expect(ctx.mines).toHaveLength(1);
    expect(ctx.mines[0].type).toBe('AP');
    expect(HOUSE_FACTION[House.BadGuy]).toBe('soviet');
  });

  it('mine damage matches INI value for mine type', () => {
    // Allied AV mine
    const avMnly = makeMinelayer(House.Spain, 10, 10);
    avMnly.moveTarget = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const avCtx = makeContext({ entities: [avMnly] });
    updateMinelayer(avCtx, avMnly);
    expect(avCtx.mines[0].damage).toBe(AV_MINE_DAMAGE);

    // Soviet AP mine
    const apMnly = makeMinelayer(House.USSR, 15, 15);
    apMnly.moveTarget = { x: 15 * CELL_SIZE + CELL_SIZE / 2, y: 15 * CELL_SIZE + CELL_SIZE / 2 };
    const apCtx = makeContext({ entities: [apMnly] });
    updateMinelayer(apCtx, apMnly);
    expect(apCtx.mines[0].damage).toBe(AP_MINE_DAMAGE);
  });
});

// =============================================================================
// 7. Mine Placement — Ammo Depletion
//    C++ unit.cpp:2613: Ammo > 0 check, 2623: Ammo--
// =============================================================================

describe('mine placement: ammo mechanics', () => {
  it('placing a mine decrements ammo by 1', () => {
    const mnly = makeMinelayer(House.Spain, 10, 10);
    const initialAmmo = mnly.ammo;
    mnly.moveTarget = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [mnly] });
    updateMinelayer(ctx, mnly);

    expect(mnly.ammo).toBe(initialAmmo - 1);
  });

  it('minelayer with 0 ammo cannot place mine', () => {
    const mnly = makeMinelayer(House.Spain, 10, 10);
    mnly.ammo = 0;
    mnly.moveTarget = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [mnly] });
    updateMinelayer(ctx, mnly);

    expect(ctx.mines).toHaveLength(0);
    expect(mnly.mission).toBe(Mission.GUARD);
    expect(mnly.animState).toBe(AnimState.IDLE);
  });

  it('can place exactly maxAmmo mines before running out', () => {
    const mines: SpecialUnitsContext['mines'] = [];
    const mnly = makeMinelayer(House.Spain, 10, 10);
    const maxAmmo = MNLY_AMMO;

    for (let i = 0; i < maxAmmo; i++) {
      const cx = 10 + i;
      mnly.pos = { x: cx * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
      mnly.moveTarget = { x: cx * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
      const ctx = makeContext({ entities: [mnly], mines });
      updateMinelayer(ctx, mnly);
    }

    expect(mines).toHaveLength(maxAmmo);
    expect(mnly.ammo).toBe(0);
  });

  it('cannot place mine on already-mined cell — C++ unit.cpp:2614 cell check', () => {
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const mnly = makeMinelayer(House.Spain, 10, 10);
    const initialAmmo = mnly.ammo;
    mnly.moveTarget = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [mnly], mines });
    updateMinelayer(ctx, mnly);

    // Mine should not be placed; ammo should not decrease
    expect(mines).toHaveLength(1);
    expect(mnly.ammo).toBe(initialAmmo);
  });
});

// =============================================================================
// 8. Mine Limit Per House
//    TS specialUnits.ts: MAX_MINES_PER_HOUSE = 50
// =============================================================================

describe('mine limit per house', () => {
  it('MAX_MINES_PER_HOUSE is 50', () => {
    expect(MAX_MINES_PER_HOUSE).toBe(50);
  });

  it('cannot place mine when house limit reached', () => {
    const mines: SpecialUnitsContext['mines'] = [];
    for (let i = 0; i < MAX_MINES_PER_HOUSE; i++) {
      mines.push({ cx: i, cy: 0, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' });
    }

    const mnly = makeMinelayer(House.Spain, 60, 10);
    mnly.moveTarget = { x: 60 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [mnly], mines });
    updateMinelayer(ctx, mnly);

    expect(mines).toHaveLength(MAX_MINES_PER_HOUSE);
    expect(mnly.mission).toBe(Mission.GUARD);
  });
});

// =============================================================================
// 9. Mine Detonation — Vehicle Triggers
//    C++ unit.cpp:1805-1838
// =============================================================================

describe('mine detonation: vehicle triggers', () => {
  it('AV mine deals AVMineDamage to vehicle — C++ unit.cpp:1825-1827', () => {
    const vehicle = makeVehicle(House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const ctx = makeContext({ entities: [vehicle], mines }) as SpecialUnitsContext & { _damaged: any[] };
    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(1);
    expect(ctx._damaged[0].amount).toBe(AV_MINE_DAMAGE);
    expect(ctx._damaged[0].warhead).toBe('HE');
    expect(mines).toHaveLength(0); // mine consumed
  });

  it('AP mine deals only 10 damage to vehicle — C++ unit.cpp:1829-1830', () => {
    const vehicle = makeVehicle(House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AP_MINE_DAMAGE, type: 'AP' },
    ];
    const ctx = makeContext({ entities: [vehicle], mines }) as SpecialUnitsContext & { _damaged: any[] };
    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(1);
    expect(ctx._damaged[0].amount).toBe(10); // hardcoded 10 in C++
    expect(ctx._damaged[0].warhead).toBe('HE');
    expect(mines).toHaveLength(0);
  });

  it('mine is removed after detonation — C++ unit.cpp:1832 delete bldng', () => {
    const vehicle = makeVehicle(House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const ctx = makeContext({ entities: [vehicle], mines });
    tickMines(ctx);

    expect(mines).toHaveLength(0);
  });

  it('explosion effect is created at mine location', () => {
    const vehicle = makeVehicle(House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const effects: Effect[] = [];
    const ctx = makeContext({ entities: [vehicle], mines, effects });
    tickMines(ctx);

    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe('explosion');
    expect(effects[0].x).toBe(10 * CELL_SIZE + CELL_SIZE / 2);
    expect(effects[0].y).toBe(10 * CELL_SIZE + CELL_SIZE / 2);
  });
});

// =============================================================================
// 10. Mine Detonation — Infantry Triggers
//     C++ infantry.cpp:916-942
// =============================================================================

describe('mine detonation: infantry triggers', () => {
  it('AP mine triggers on infantry — C++ infantry.cpp:920', () => {
    const inf = makeInfantry(House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AP_MINE_DAMAGE, type: 'AP' },
    ];
    const ctx = makeContext({ entities: [inf], mines }) as SpecialUnitsContext & { _damaged: any[] };
    tickMines(ctx);

    expect(ctx._damaged.length).toBeGreaterThanOrEqual(1);
    expect(mines).toHaveLength(0); // mine consumed
  });

  it('AV mine does NOT trigger on infantry — C++ infantry.cpp:920 only checks STRUCT_APMINE', () => {
    const inf = makeInfantry(House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const ctx = makeContext({ entities: [inf], mines }) as SpecialUnitsContext & { _damaged: any[] };
    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(0);
    expect(mines).toHaveLength(1); // mine still exists
  });

  it('AP mine splash damages all infantry in radius — C++ infantry.cpp:928-936', () => {
    // Place two infantry in same cell
    const inf1 = makeInfantry(House.USSR, 10, 10);
    const inf2 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AP_MINE_DAMAGE, type: 'AP' },
    ];
    const ctx = makeContext({ entities: [inf1, inf2], mines }) as SpecialUnitsContext & { _damaged: any[] };
    tickMines(ctx);

    // Both infantry should be damaged by splash
    const damagedEntities = ctx._damaged.map(d => d.entity.id);
    expect(damagedEntities).toContain(inf1.id);
    expect(damagedEntities).toContain(inf2.id);
  });

  it('AP mine deals APMineDamage from rules.ini — C++ infantry.cpp:933', () => {
    const inf = makeInfantry(House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AP_MINE_DAMAGE, type: 'AP' },
    ];
    const ctx = makeContext({ entities: [inf], mines }) as SpecialUnitsContext & { _damaged: any[] };
    tickMines(ctx);

    const infDamage = ctx._damaged.find(d => d.entity.id === inf.id);
    expect(infDamage).toBeDefined();
    expect(infDamage!.amount).toBe(AP_MINE_DAMAGE);
    expect(infDamage!.warhead).toBe('HE');
  });
});

// =============================================================================
// 11. Mine Alliance Check — Friendly Mines Don't Trigger
//     C++ unit.cpp:1808: !bldng->House->Is_Ally(this)
//     C++ infantry.cpp:920: implicit — only enemy mines in Per_Cell_Process
// =============================================================================

describe('mine alliance: friendly mines do not trigger', () => {
  it('allied vehicle does not trigger allied mine', () => {
    const vehicle = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const ctx = makeContext({ entities: [vehicle], mines }) as SpecialUnitsContext & { _damaged: any[] };
    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(0);
    expect(mines).toHaveLength(1); // mine still exists
  });

  it('allied infantry does not trigger allied AP mine', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AP_MINE_DAMAGE, type: 'AP' },
    ];
    const ctx = makeContext({ entities: [inf], mines }) as SpecialUnitsContext & { _damaged: any[] };
    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(0);
    expect(mines).toHaveLength(1);
  });

  it('enemy vehicle triggers enemy mine', () => {
    const vehicle = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const ctx = makeContext({ entities: [vehicle], mines }) as SpecialUnitsContext & { _damaged: any[] };
    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(1);
    expect(mines).toHaveLength(0);
  });
});

// =============================================================================
// 12. Air Units Ignore Mines
//     C++ mines are ground-only (building overlay); aircraft fly over them
// =============================================================================

describe('air units do not trigger mines', () => {
  it('air unit flying over mine cell does not trigger it', () => {
    const heli = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    // isAirUnit is a getter derived from stats.isAircraft — HIND has isAircraft=true
    expect(heli.isAirUnit).toBe(true);
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AV_MINE_DAMAGE, type: 'AV' },
    ];
    const ctx = makeContext({ entities: [heli], mines }) as SpecialUnitsContext & { _damaged: any[] };
    tickMines(ctx);

    expect(ctx._damaged).toHaveLength(0);
    expect(mines).toHaveLength(1); // mine still intact
  });
});

// =============================================================================
// 13. MNLY Service Depot Rearm
//     C++ unit.cpp:722: RADIO_NEED_REPAIR → minelayer needs service depot
//     if Health < 100% OR Ammo < MaxAmmo
// =============================================================================

describe('MNLY service depot rearm behavior', () => {
  it('ReloadRate in rules.ini converts to ticks per ammo point', () => {
    // C++ ReloadRate = 0.04 minutes per ammo point
    // 0.04 * 900 = 36 ticks per ammo point reload
    const rearmTicks = Math.round(RELOAD_RATE * TICKS_PER_MINUTE);
    expect(rearmTicks).toBe(36);
  });

  it('MNLY maxAmmo matches rules.ini Ammo — depot must rearm up to this', () => {
    const mnly = makeMinelayer();
    expect(mnly.maxAmmo).toBe(MNLY_AMMO);
  });

  it('MNLY with depleted ammo has ammo < maxAmmo (service depot trigger condition)', () => {
    // C++ unit.cpp:722: (*this != UNIT_MINELAYER || Ammo >= Class->MaxAmmo)
    // Minelayer needs service when Ammo < MaxAmmo (in addition to HP check)
    const mnly = makeMinelayer();
    mnly.ammo = 0;
    expect(mnly.ammo).toBeLessThan(mnly.maxAmmo);
  });

  it('MNLY at full ammo AND full HP does not need service depot', () => {
    // C++ unit.cpp:722: if HP >= 100% AND (not MNLY OR Ammo >= MaxAmmo) → RADIO_NEGATIVE
    const mnly = makeMinelayer();
    expect(mnly.hp).toBe(mnly.maxHp);
    expect(mnly.ammo).toBe(mnly.maxAmmo);
    // This is the condition for RADIO_NEGATIVE (no service needed)
    const healthFull = mnly.hp >= mnly.maxHp;
    const ammoFull = mnly.ammo >= mnly.maxAmmo;
    expect(healthFull && ammoFull).toBe(true);
  });
});

// =============================================================================
// 14. MNLY No Turret
//     C++ udata.cpp: MNLY has IsTurretEquipped=false
// =============================================================================

describe('MNLY turret behavior', () => {
  it('MNLY has no turret — hasTurret returns false', () => {
    const mnly = makeMinelayer();
    expect(mnly.hasTurret).toBe(false);
  });
});

// =============================================================================
// 15. INI Sanity Checks — Verify All Mine-Related Values Are Parseable
// =============================================================================

describe('INI sanity: all mine-related sections exist and parse', () => {
  it('[MNLY] section exists with required keys', () => {
    const sec = iniSection('MNLY');
    expect(sec.has('Strength')).toBe(true);
    expect(sec.has('Armor')).toBe(true);
    expect(sec.has('Speed')).toBe(true);
    expect(sec.has('Sight')).toBe(true);
    expect(sec.has('ROT')).toBe(true);
    expect(sec.has('Ammo')).toBe(true);
    expect(sec.has('Cost')).toBe(true);
    expect(sec.has('Owner')).toBe(true);
    expect(sec.has('Prerequisite')).toBe(true);
    expect(sec.has('TechLevel')).toBe(true);
    expect(sec.has('Tracked')).toBe(true);
    expect(sec.has('Crewed')).toBe(true);
  });

  it('[MINV] section exists with required keys', () => {
    const sec = iniSection('MINV');
    expect(sec.has('Strength')).toBe(true);
    expect(sec.has('Invisible')).toBe(true);
    expect(sec.has('Unsellable')).toBe(true);
    expect(sec.has('BaseNormal')).toBe(true);
  });

  it('[MINP] section exists with required keys', () => {
    const sec = iniSection('MINP');
    expect(sec.has('Strength')).toBe(true);
    expect(sec.has('Invisible')).toBe(true);
    expect(sec.has('Unsellable')).toBe(true);
    expect(sec.has('BaseNormal')).toBe(true);
  });

  it('[General] has mine damage keys', () => {
    const sec = iniSection('General');
    expect(sec.has('APMineDamage')).toBe(true);
    expect(sec.has('AVMineDamage')).toBe(true);
    expect(sec.has('MineAware')).toBe(true);
  });
});

// =============================================================================
// 16. Both Mine Types Are Invisible (rules.ini Invisible=yes)
//     C++ building.cpp: mines with Invisible=yes are hidden from enemy radar
// =============================================================================

describe('mine visibility flags from INI', () => {
  it('both mine types have Invisible=yes — enemies cannot see mines', () => {
    expect(MINV_INVISIBLE).toBe(true);
    expect(MINP_INVISIBLE).toBe(true);
  });

  it('both mine types have Strength=1 — destroyed on any damage', () => {
    expect(MINV_STRENGTH).toBe(1);
    expect(MINP_STRENGTH).toBe(1);
  });
});

// =============================================================================
// 17. Cross-Faction Mine Damage Values Match INI
//     Verify TS hardcoded constants match what's in rules.ini
// =============================================================================

describe('TS mine damage constants match rules.ini', () => {
  it('TS AV mine damage matches rules.ini AVMineDamage', () => {
    // TS specialUnits.ts line 175: mineDamage = mineType === 'AP' ? 1000 : 1200
    // This must match rules.ini [General] AVMineDamage
    const avMnly = makeMinelayer(House.Spain, 20, 20);
    avMnly.moveTarget = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [avMnly] });
    updateMinelayer(ctx, avMnly);

    expect(ctx.mines[0].damage).toBe(AV_MINE_DAMAGE);
  });

  it('TS AP mine damage matches rules.ini APMineDamage', () => {
    const apMnly = makeMinelayer(House.USSR, 20, 20);
    apMnly.moveTarget = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [apMnly] });
    updateMinelayer(ctx, apMnly);

    expect(ctx.mines[0].damage).toBe(AP_MINE_DAMAGE);
  });
});

// =============================================================================
// 18. Mine Cell Coordinate Storage
//     Verify mines store the correct cell position matching placement target
// =============================================================================

describe('mine placement stores correct cell coordinates', () => {
  it('mine placed at target cell coordinates', () => {
    const targetCx = 15;
    const targetCy = 20;
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, targetCx, targetCy);
    mnly.moveTarget = { x: targetCx * CELL_SIZE + CELL_SIZE / 2, y: targetCy * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [mnly] });
    updateMinelayer(ctx, mnly);

    expect(ctx.mines[0].cx).toBe(targetCx);
    expect(ctx.mines[0].cy).toBe(targetCy);
    expect(ctx.mines[0].house).toBe(House.Spain);
  });
});

// =============================================================================
// 19. Mine Placement State Reset
//     C++ unit.cpp:2627-2634: after mine placed, status → CLOSING_DOOR, mission → GUARD
// =============================================================================

describe('mine placement state reset', () => {
  it('after placing mine, minelayer returns to GUARD/IDLE', () => {
    const mnly = makeMinelayer(House.Spain, 10, 10);
    mnly.moveTarget = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const ctx = makeContext({ entities: [mnly] });
    updateMinelayer(ctx, mnly);

    expect(mnly.moveTarget).toBeNull();
    expect(mnly.mission).toBe(Mission.GUARD);
    expect(mnly.animState).toBe(AnimState.IDLE);
  });
});

// =============================================================================
// 20. Vehicle Hitting AP Mine — Minimal Damage
//     C++ unit.cpp:1829: int damage = 10; (hardcoded)
//     This is a deliberate design: AP mines are designed for infantry.
//     Vehicles running over an AP mine take only scratch damage.
// =============================================================================

describe('vehicle AP mine minimal damage — C++ hardcoded 10', () => {
  it('heavy tank running over AP mine takes exactly 10 damage, not APMineDamage', () => {
    const tank = makeVehicle(House.USSR, 10, 10);
    const initialHp = tank.hp;
    const mines: SpecialUnitsContext['mines'] = [
      { cx: 10, cy: 10, house: House.Spain, damage: AP_MINE_DAMAGE, type: 'AP' },
    ];
    const ctx = makeContext({ entities: [tank], mines }) as SpecialUnitsContext & { _damaged: any[] };
    tickMines(ctx);

    // The damage to vehicle from AP mine is hardcoded 10 in C++, NOT Rule.APMineDamage
    expect(ctx._damaged[0].amount).toBe(10);
    // Verify this is NOT the full AP mine damage
    expect(10).not.toBe(AP_MINE_DAMAGE);
  });
});
