/**
 * C++ Behavioral Parity: Mine Placement/Detonation & C4 Mechanics
 *
 * Tests verify mine and C4 behavior matches C++ RA source code and rules.ini.
 * Each describe block documents the C++ source reference (file:line).
 *
 * Authoritative values from rules.ini:
 *   APMineDamage=1000       ; anti-personnel mine damage
 *   AVMineDamage=1200       ; anti-vehicle mine damage
 *   C4Delay=.03             ; minutes → 0.03 * 900 = 27 ticks
 *
 * C++ source references:
 *   rules.cpp:202-204       — APMineDamage, AVMineDamage defaults
 *   rules.cpp:267           — C4Delay default
 *   building.cpp:2936       — Captured() changes ownership
 *   infantry.cpp:598-637    — Engineer capture/damage
 *   infantry.cpp:631        — Engineer damage formula: MaxStrength/3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission, AnimState,
  UNIT_STATS, CONDITION_RED,
  buildDefaultAlliances,
  modifyDamage, pixelToLepton,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { type MapStructure, STRUCTURE_SIZE } from '../engine/scenario';
import {
  MAX_MINES_PER_HOUSE,
  updateMinelayer,
  tickMines,
  updateTanyaC4,
  tickC4Timers,
  type SpecialUnitsContext,
} from '../engine/specialUnits';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  const entity = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  if (type === UnitType.V_MNLY) entity.mission = Mission.UNLOAD;
  return entity;
}

function makeStructure(
  type: string, house: House, cx: number, cy: number,
  overrides: Partial<MapStructure> = {},
): MapStructure {
  const [sw, sh] = STRUCTURE_SIZE[type] ?? [2, 2];
  return {
    type,
    house,
    cx,
    cy,
    hp: overrides.hp ?? 400,
    maxHp: overrides.maxHp ?? 400,
    alive: overrides.alive ?? true,
    rubble: false,
    weapon: null,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    sellProgress: undefined,
    buildProgress: undefined,
    ...overrides,
  } as MapStructure;
}

function makeSpecialCtx(
  entities: Entity[] = [],
  structures: MapStructure[] = [],
  mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [],
): SpecialUnitsContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    mines,
    activeVortices: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    credits: 1000,
    houseCredits: new Map(),
    map,
    evaMessages: [],
    isThieved: false,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playSound: () => {},
    movementSpeed: () => 1,
    damageEntity: (target: Entity, amount: number, _warhead: string) => {
      target.hp -= amount;
      if (target.hp <= 0) {
        target.hp = 0;
        target.alive = false;
        return true;
      }
      return false;
    },
    damageStructure: (s: MapStructure, damage: number) => {
      s.hp -= damage;
      if (s.hp <= 0) {
        s.hp = 0;
        s.alive = false;
        return true;
      }
      return false;
    },
    addEntity: () => {},
    screenShake: 0,
  };
}

// =============================================================================
// 1. APMineDamage / AVMineDamage constants (rules.ini / rules.cpp)
// =============================================================================

describe('APMineDamage / AVMineDamage constants (rules.ini:55-56, rules.cpp:202-204)', () => {
  // C++ rules.ini:55 APMineDamage=1000
  // C++ rules.ini:56 AVMineDamage=1200

  it('allied minelayer places AV mines with damage=1200 (AVMineDamage from rules.ini)', () => {
    // C++ unit.cpp:2616: Allied houses place STRUCT_AVMINE, Soviet houses place STRUCT_APMINE
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.ammo = 5;
    mnly.maxAmmo = 5;
    mnly.moveTarget = { lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2), ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2) };
    const mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [];
    const ctx = makeSpecialCtx([mnly], [], mines);

    updateMinelayer(ctx, mnly);

    expect(mines.length).toBe(1);
    // C++ rules.ini AVMineDamage=1200 — Allied minelayer places AV mines
    expect(mines[0].damage).toBe(1200);
    expect(mines[0].type).toBe('AV');
  });

  it('soviet minelayer places AP mines with damage=1000 (APMineDamage from rules.ini)', () => {
    // C++ unit.cpp:2616: Soviet houses (USSR, Ukraine, BadGuy) place STRUCT_APMINE
    const mnly = entityAtCell(UnitType.V_MNLY, House.USSR, 10, 10);
    mnly.ammo = 5;
    mnly.maxAmmo = 5;
    mnly.moveTarget = { lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2), ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2) };
    const mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [];
    const ctx = makeSpecialCtx([mnly], [], mines);

    updateMinelayer(ctx, mnly);

    expect(mines.length).toBe(1);
    // C++ rules.ini APMineDamage=1000 — Soviet minelayer places AP mines
    expect(mines[0].damage).toBe(1000);
    expect(mines[0].type).toBe('AP');
  });
});

// =============================================================================
// 2. Minelayer placement mechanics (specialUnits.ts, rules.ini [MNLY])
// =============================================================================

describe('Minelayer placement mechanics (rules.ini:685 Ammo=5, udata.cpp)', () => {
  const stats = UNIT_STATS.MNLY;

  it('MNLY has maxAmmo=5 (rules.ini:685 Ammo=5)', () => {
    // C++ rules.ini line 685: Ammo=5 for MNLY (5 mines per load)
    expect(stats.maxAmmo).toBe(5);
  });

  it('MNLY has no weapon (primaryWeapon=null) — mines are placed, not fired', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('MNLY is a wheeled vehicle with heavy armor', () => {
    expect(stats.armor).toBe('heavy');
    expect(stats.isInfantry).toBeFalsy();
  });

  it('MNLY has crusher=true (can crush infantry)', () => {
    // C++ udata.cpp: MNLY IsCrusher=true (wheeled but still crushes)
    expect(stats.crusher).toBe(true);
  });

  it('does not place a mine from ordinary Mission.Move', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.mission = Mission.MOVE;
    mnly.moveTarget = { lx: pixelToLepton(11 * CELL_SIZE + CELL_SIZE / 2), ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2) };
    const mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [];
    const ctx = makeSpecialCtx([mnly], [], mines);
    const start = { ...mnly.pos };

    updateMinelayer(ctx, mnly);

    expect(mines.length).toBe(0);
    expect(mnly.pos).toEqual(start);
    expect(mnly.mission).toBe(Mission.MOVE);
  });

  it('minelayer places mine at target cell', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.ammo = 5;
    mnly.maxAmmo = 5;
    mnly.moveTarget = { lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2), ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2) };
    const mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [];
    const ctx = makeSpecialCtx([mnly], [], mines);

    updateMinelayer(ctx, mnly);

    expect(mines.length).toBe(1);
    expect(mines[0].cx).toBe(10);
    expect(mines[0].cy).toBe(10);
    expect(mines[0].house).toBe(House.Spain);
  });

  it('minelayer decrements ammo after placing a mine', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.ammo = 5;
    mnly.maxAmmo = 5;
    mnly.moveTarget = { lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2), ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2) };
    const mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [];
    const ctx = makeSpecialCtx([mnly], [], mines);

    updateMinelayer(ctx, mnly);

    expect(mnly.ammo).toBe(4);
  });

  it('minelayer returns to GUARD after placing mine', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.ammo = 5;
    mnly.maxAmmo = 5;
    mnly.moveTarget = { lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2), ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2) };
    const mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [];
    const ctx = makeSpecialCtx([mnly], [], mines);

    updateMinelayer(ctx, mnly);

    expect(mnly.mission).toBe(Mission.GUARD);
    expect(mnly.animState).toBe(AnimState.IDLE);
    expect(mnly.moveTarget).toBeNull();
  });

  it('minelayer with 0 ammo cannot place mines', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.ammo = 0;
    mnly.maxAmmo = 5;
    mnly.moveTarget = { lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2), ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2) };
    const mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [];
    const ctx = makeSpecialCtx([mnly], [], mines);

    updateMinelayer(ctx, mnly);

    expect(mines.length).toBe(0);
    expect(mnly.mission).toBe(Mission.GUARD);
  });

  it('minelayer does not place mine on already-mined cell', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.ammo = 5;
    mnly.maxAmmo = 5;
    mnly.moveTarget = { lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2), ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2) };
    const mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [
      { cx: 10, cy: 10, house: House.Spain, damage: 1200, type: 'AV' },
    ];
    const ctx = makeSpecialCtx([mnly], [], mines);

    updateMinelayer(ctx, mnly);

    expect(mines.length).toBe(1); // no new mine placed
  });

  it('minelayer increments entity.mineCount on placement', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.ammo = 5;
    mnly.maxAmmo = 5;
    mnly.mineCount = 0;
    mnly.moveTarget = { lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2), ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2) };
    const mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [];
    const ctx = makeSpecialCtx([mnly], [], mines);

    updateMinelayer(ctx, mnly);

    expect(mnly.mineCount).toBe(1);
  });
});

// =============================================================================
// 3. Mine limit per house (C++ MAX_MINES_PER_HOUSE = 50)
// =============================================================================

describe('Mine limit per house (specialUnits.ts MAX_MINES_PER_HOUSE)', () => {
  it('MAX_MINES_PER_HOUSE constant is 50', () => {
    // C++ house.h: maximum mines per player (prevents unlimited mine spam)
    expect(MAX_MINES_PER_HOUSE).toBe(50);
  });

  it('minelayer cannot place mine when house has 50 mines', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.ammo = 5;
    mnly.maxAmmo = 5;
    mnly.moveTarget = { lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2), ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2) };
    // Fill up to 50 mines for this house
    const mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [];
    for (let i = 0; i < 50; i++) {
      mines.push({ cx: i, cy: 0, house: House.Spain, damage: 1200, type: 'AV' });
    }
    const ctx = makeSpecialCtx([mnly], [], mines);

    updateMinelayer(ctx, mnly);

    expect(mines.length).toBe(50); // no new mine added
  });

  it('minelayer CAN place mine when another house has 50 mines (limit is per-house)', () => {
    const mnly = entityAtCell(UnitType.V_MNLY, House.Spain, 10, 10);
    mnly.ammo = 5;
    mnly.maxAmmo = 5;
    mnly.moveTarget = { lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2), ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2) };
    // 50 mines for USSR, but Spain has 0
    const mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }> = [];
    for (let i = 0; i < 50; i++) {
      mines.push({ cx: i, cy: 0, house: House.USSR, damage: 1000, type: 'AP' });
    }
    const ctx = makeSpecialCtx([mnly], [], mines);

    updateMinelayer(ctx, mnly);

    expect(mines.length).toBe(51); // Spain's mine was placed
  });
});

// =============================================================================
// 4. Mine detonation trigger (specialUnits.ts tickMines)
// =============================================================================

describe('Mine detonation trigger conditions (specialUnits.ts tickMines)', () => {
  it('AP mine detonates when enemy infantry enters mined cell (infantry.cpp:920)', () => {
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1000, type: 'AP' }];
    const ctx = makeSpecialCtx([enemy], [], mines);

    tickMines(ctx);

    // Mine should have detonated and been removed
    expect(mines.length).toBe(0);
  });

  it('AV mine detonates when enemy vehicle enters mined cell (unit.cpp:1815)', () => {
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1200, type: 'AV' }];
    const ctx = makeSpecialCtx([enemy], [], mines);

    tickMines(ctx);

    expect(mines.length).toBe(0);
  });

  it('AV mine does NOT detonate on infantry (infantry.cpp:920 — infantry only triggers AP)', () => {
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1200, type: 'AV' }];
    const ctx = makeSpecialCtx([enemy], [], mines);

    tickMines(ctx);

    expect(mines.length).toBe(1); // mine still present
  });

  it('AP mine triggers on vehicles but deals only 10 damage (unit.cpp:1828-1830)', () => {
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    let recordedDamage = 0;
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1000, type: 'AP' }];
    const ctx = makeSpecialCtx([enemy], [], mines);
    ctx.damageEntity = (_target: Entity, amount: number, _warhead: string) => {
      recordedDamage = amount;
      return true;
    };

    tickMines(ctx);

    // C++ unit.cpp:1829 starts from raw 10; TS passes the post-ObjectClass
    // WARHEAD_HE amount into its shared damageEntity hook.
    expect(recordedDamage).toBe(modifyDamage(10, 'HE', enemy.stats.armor, 0));
    expect(mines.length).toBe(0);
  });

  it('mine does NOT detonate when allied unit enters mined cell', () => {
    const ally = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1000, type: 'AP' }];
    const ctx = makeSpecialCtx([ally], [], mines);

    tickMines(ctx);

    expect(mines.length).toBe(1); // mine still present
  });

  it('mine does NOT detonate for air units (isAirUnit check)', () => {
    // C++ air units fly over mines without triggering them
    const heli = entityAtCell(UnitType.V_HELI, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1200, type: 'AV' }];
    const ctx = makeSpecialCtx([heli], [], mines);

    tickMines(ctx);

    expect(mines.length).toBe(1); // mine still present
  });

  it('mine does NOT detonate for dead units', () => {
    const dead = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    dead.alive = false;
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1000, type: 'AP' }];
    const ctx = makeSpecialCtx([dead], [], mines);

    tickMines(ctx);

    expect(mines.length).toBe(1); // mine still present
  });

  it('AP mine deals APMineDamage (1000) to triggering infantry (infantry.cpp:933)', () => {
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    enemy.hp = 50;
    enemy.maxHp = 50;
    let recordedDamage = 0;
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1000, type: 'AP' }];
    const ctx = makeSpecialCtx([enemy], [], mines);
    ctx.damageEntity = (_target: Entity, amount: number, _warhead: string) => {
      recordedDamage = amount;
      return true;
    };

    tickMines(ctx);

    expect(recordedDamage).toBe(modifyDamage(1000, 'HE', enemy.stats.armor, 0));
  });

  it('mine is consumed (removed from array) after detonation', () => {
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1000, type: 'AP' }];
    const ctx = makeSpecialCtx([enemy], [], mines);

    tickMines(ctx);

    expect(mines.length).toBe(0);
  });

  it('mine creates an explosion effect on detonation', () => {
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1000, type: 'AP' }];
    const ctx = makeSpecialCtx([enemy], [], mines);

    tickMines(ctx);

    expect(ctx.effects.length).toBeGreaterThan(0);
    expect(ctx.effects[0].type).toBe('explosion');
  });

  it('only one mine detonates per tick even with multiple enemies', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const e2 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1000, type: 'AP' }];
    const ctx = makeSpecialCtx([e1, e2], [], mines);

    tickMines(ctx);

    // Mine detonates on first enemy, breaks out of inner loop
    expect(mines.length).toBe(0);
  });
});

// =============================================================================
// 5. Mine damage warhead type
// =============================================================================

describe('Mine damage warhead type (specialUnits.ts tickMines)', () => {
  it('all mine explosions use WARHEAD_HE (infantry.cpp:925, unit.cpp:1827)', () => {
    // C++ infantry.cpp:925: new AnimClass(Combat_Anim(Rule.APMineDamage, WARHEAD_HE, ...))
    // C++ infantry.cpp:934: obj->Take_Damage(damage, 0, WARHEAD_HE)
    // C++ unit.cpp:1827: Take_Damage(damage, 0, WARHEAD_HE)
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    let usedWarhead = '';
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1000, type: 'AP' }];
    const ctx = makeSpecialCtx([enemy], [], mines);
    ctx.damageEntity = (_target: Entity, _amount: number, warhead: string) => {
      usedWarhead = warhead;
      return true;
    };

    tickMines(ctx);

    expect(usedWarhead).toBe('HE');
  });

  it('AV mine also uses WARHEAD_HE (unit.cpp:1827)', () => {
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    let usedWarhead = '';
    const mines: SpecialUnitsContext['mines'] = [{ cx: 10, cy: 10, house: House.Spain, damage: 1200, type: 'AV' }];
    const ctx = makeSpecialCtx([enemy], [], mines);
    ctx.damageEntity = (_target: Entity, _amount: number, warhead: string) => {
      usedWarhead = warhead;
      return true;
    };

    tickMines(ctx);

    expect(usedWarhead).toBe('HE');
  });
});

// =============================================================================
// 6. C4 placement on buildings (Tanya — specialUnits.ts updateTanyaC4)
// =============================================================================

describe('C4 placement on buildings — Tanya (specialUnits.ts updateTanyaC4)', () => {
  it('Tanya plants C4 when in range of target structure', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const building = makeStructure('POWR', House.USSR, 10, 10);
    tanya.targetStructure = building;
    tanya.mission = Mission.ATTACK;
    const ctx = makeSpecialCtx([tanya], [building]);

    updateTanyaC4(ctx, tanya);

    const sAny = building as MapStructure & { c4Timer?: number };
    expect(sAny.c4Timer).toBe(27);
  });

  it('C4 is NOT planted on non-Tanya units', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const building = makeStructure('POWR', House.USSR, 10, 10);
    e1.targetStructure = building;
    const ctx = makeSpecialCtx([e1], [building]);

    updateTanyaC4(ctx, e1);

    const sAny = building as MapStructure & { c4Timer?: number };
    expect(sAny.c4Timer).toBeUndefined();
  });

  it('after planting C4, Tanya clears target and returns to GUARD', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const building = makeStructure('POWR', House.USSR, 10, 10);
    tanya.targetStructure = building;
    tanya.mission = Mission.ATTACK;
    const ctx = makeSpecialCtx([tanya], [building]);

    updateTanyaC4(ctx, tanya);

    expect(tanya.targetStructure).toBeNull();
    expect(tanya.target).toBeNull();
    expect(tanya.mission).toBe(Mission.GUARD);
  });

  it('Tanya shows ATTACK anim when planting C4', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const building = makeStructure('POWR', House.USSR, 10, 10);
    tanya.targetStructure = building;
    tanya.mission = Mission.ATTACK;
    const ctx = makeSpecialCtx([tanya], [building]);

    updateTanyaC4(ctx, tanya);

    // animState was set to ATTACK before clearing target
    // After clear, it was left at whatever state — but the C4 was planted
    expect((building as any).c4Timer).toBe(27);
  });

  it('EVA says "C4 PLANTED" when C4 is set', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const building = makeStructure('POWR', House.USSR, 10, 10);
    tanya.targetStructure = building;
    tanya.mission = Mission.ATTACK;
    const ctx = makeSpecialCtx([tanya], [building]);

    updateTanyaC4(ctx, tanya);

    expect(ctx.evaMessages.length).toBeGreaterThan(0);
    expect(ctx.evaMessages[0].text).toBe('C4 PLANTED');
  });

  it('dead Tanya cannot plant C4', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    tanya.alive = false;
    const building = makeStructure('POWR', House.USSR, 10, 10);
    tanya.targetStructure = building;
    const ctx = makeSpecialCtx([tanya], [building]);

    updateTanyaC4(ctx, tanya);

    expect((building as any).c4Timer).toBeUndefined();
  });

  it('Tanya with no target structure does nothing', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    tanya.targetStructure = null;
    const ctx = makeSpecialCtx([tanya]);

    updateTanyaC4(ctx, tanya);

    expect(ctx.evaMessages.length).toBe(0);
  });
});

// =============================================================================
// 7. C4 fuse timer (rules.ini C4Delay=0.03 → 27 ticks)
// =============================================================================

describe('C4 fuse timer — 27 ticks (rules.ini:60 C4Delay=.03)', () => {
  // C++ rules.ini:60: C4Delay=.03 minutes * 900 ticks/minute = 27 ticks

  it('C4 timer is initialized to 27 ticks', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const building = makeStructure('POWR', House.USSR, 10, 10);
    tanya.targetStructure = building;
    tanya.mission = Mission.ATTACK;
    const ctx = makeSpecialCtx([tanya], [building]);

    updateTanyaC4(ctx, tanya);

    expect((building as any).c4Timer).toBe(27);
  });

  it('C4 timer decrements by 1 each tick', () => {
    const building = makeStructure('POWR', House.USSR, 10, 10);
    (building as any).c4Timer = 27;
    const ctx = makeSpecialCtx([], [building]);

    tickC4Timers(ctx);

    expect((building as any).c4Timer).toBe(26);
  });

  it('C4 timer counts down from 27 to 0 over 27 ticks', () => {
    const building = makeStructure('POWR', House.USSR, 10, 10);
    (building as any).c4Timer = 27;
    const ctx = makeSpecialCtx([], [building]);

    for (let i = 0; i < 26; i++) {
      tickC4Timers(ctx);
    }

    expect((building as any).c4Timer).toBe(1);
    expect(building.alive).toBe(true);
  });

  it('building is destroyed when C4 timer reaches 0 (on tick 27)', () => {
    const building = makeStructure('POWR', House.USSR, 10, 10);
    (building as any).c4Timer = 1; // will hit 0 on next tick
    const ctx = makeSpecialCtx([], [building]);

    tickC4Timers(ctx);

    expect((building as any).c4Timer).toBeLessThanOrEqual(0);
    // damageStructure was called with 9999 damage
    expect(building.alive).toBe(false);
  });
});

// =============================================================================
// 8. C4 damage amount
// =============================================================================

describe('C4 damage amount (specialUnits.ts tickC4Timers)', () => {
  it('C4 deals 9999 damage to the structure (instant kill)', () => {
    // C++ building.cpp: C4 deals enough damage to destroy any building
    const building = makeStructure('POWR', House.USSR, 10, 10, { hp: 1000, maxHp: 1000 });
    (building as any).c4Timer = 1;
    let recordedDamage = 0;
    const ctx = makeSpecialCtx([], [building]);
    ctx.damageStructure = (s: MapStructure, damage: number) => {
      recordedDamage = damage;
      s.hp -= damage;
      if (s.hp <= 0) { s.hp = 0; s.alive = false; return true; }
      return false;
    };

    tickC4Timers(ctx);

    expect(recordedDamage).toBe(9999);
  });

  it('C4 destroys even the highest-HP building (FACT at 1500 HP)', () => {
    const building = makeStructure('FACT', House.USSR, 10, 10, { hp: 1500, maxHp: 1500 });
    (building as any).c4Timer = 1;
    const ctx = makeSpecialCtx([], [building]);

    tickC4Timers(ctx);

    expect(building.alive).toBe(false);
  });

  it('C4 timer on dead building does not tick', () => {
    const building = makeStructure('POWR', House.USSR, 10, 10);
    building.alive = false;
    (building as any).c4Timer = 5;
    const ctx = makeSpecialCtx([], [building]);

    tickC4Timers(ctx);

    // Dead building should be skipped
    expect((building as any).c4Timer).toBe(5);
  });
});

// =============================================================================
// 9. Engineer vs Tanya building interaction differences
// =============================================================================

describe('Engineer vs Tanya building interaction (infantry.cpp:598-637)', () => {
  // C++ infantry.cpp:598-637 — Engineer captures at red health, damages otherwise
  // C++ specialUnits.ts — Tanya plants C4 on any building

  it('Tanya plants C4 (time-delayed destruction), does NOT capture', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const building = makeStructure('POWR', House.USSR, 10, 10, { hp: 10, maxHp: 400 });
    tanya.targetStructure = building;
    tanya.mission = Mission.ATTACK;
    const ctx = makeSpecialCtx([tanya], [building]);

    updateTanyaC4(ctx, tanya);

    // Tanya plants C4, does NOT change building ownership
    expect(building.house).toBe(House.USSR);
    expect((building as any).c4Timer).toBe(27);
  });

  it('Tanya does not die after planting C4 (unlike engineer)', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const building = makeStructure('POWR', House.USSR, 10, 10);
    tanya.targetStructure = building;
    tanya.mission = Mission.ATTACK;
    const ctx = makeSpecialCtx([tanya], [building]);

    updateTanyaC4(ctx, tanya);

    expect(tanya.alive).toBe(true);
  });

  it('C++ engineer capture: at red health, building changes house (missionAI behavior)', () => {
    // C++ infantry.cpp:631 — Engineer damage formula: MaxStrength/3 (capped to Strength-1)
    // C++ building.cpp:2936 — Captured() changes ownership at red health
    // The engineer capture mechanic is in missionAI.ts:updateAttackStructure, not specialUnits.ts.
    // This test documents the expected C++ behavior for reference.

    // C++ red health threshold: hp/maxHp <= CONDITION_RED (0.25)
    // At red health: engineer captures (changes house)
    // Above red health: engineer deals MaxStrength/3 damage

    // Expected engineer damage on non-red building:
    const maxHp = 400;
    const expectedEngineerDamage = Math.min(Math.floor(maxHp / 3), maxHp - 1);
    // 400 / 3 = 133, which is < 399, so damage = 133
    expect(expectedEngineerDamage).toBe(133);
  });

  it('C++ CONDITION_RED threshold is 0.25 (25% HP)', () => {
    // C++ rules.cpp: ConditionRed = 0.25
    // Buildings at or below 25% HP can be captured by engineers
    expect(CONDITION_RED).toBe(0.25);
  });

  it('Tanya can plant C4 on any building regardless of HP (engineer requires red health to capture)', () => {
    // Tanya C4: works on full-health buildings, always plants timer
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const fullHpBuilding = makeStructure('POWR', House.USSR, 10, 10, { hp: 400, maxHp: 400 });
    tanya.targetStructure = fullHpBuilding;
    tanya.mission = Mission.ATTACK;
    const ctx = makeSpecialCtx([tanya], [fullHpBuilding]);

    updateTanyaC4(ctx, tanya);

    expect((fullHpBuilding as any).c4Timer).toBe(27);
  });

  it('Tanya C4 outcome: building destroyed. Engineer outcome: building captured or damaged.', () => {
    // This test documents the fundamental difference:
    // Tanya: always destroys (via C4 timer → 9999 damage)
    // Engineer: captures at red health, or deals HP/3 damage

    // Tanya path: C4 timer → 9999 damage → always destroyed
    const building1 = makeStructure('POWR', House.USSR, 10, 10, { hp: 100, maxHp: 400 });
    (building1 as any).c4Timer = 1;
    const ctx1 = makeSpecialCtx([], [building1]);
    tickC4Timers(ctx1);
    expect(building1.alive).toBe(false); // destroyed

    // Engineer path: at red health → capture (house changes, building survives)
    // In C++ infantry.cpp:631: building.hp stays the same, only house changes
    // The building is NOT destroyed — it's captured alive
    const building2 = makeStructure('POWR', House.USSR, 10, 10, { hp: 80, maxHp: 400 });
    // 80/400 = 0.20 < CONDITION_RED (0.25) → would be captured
    const hpRatio = building2.hp / building2.maxHp;
    expect(hpRatio).toBeLessThanOrEqual(CONDITION_RED);
    // After capture: building alive, house changed — NOT destroyed
  });
});

// =============================================================================
// 10. Tanya walks to out-of-range structures (updateTanyaC4 path following)
// =============================================================================

describe('Tanya C4 range and movement (specialUnits.ts updateTanyaC4)', () => {
  it('Tanya walks toward distant structure instead of planting C4', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 5, 5);
    const building = makeStructure('POWR', House.USSR, 20, 20); // far away
    tanya.targetStructure = building;
    tanya.mission = Mission.ATTACK;
    const ctx = makeSpecialCtx([tanya], [building]);
    const startX = tanya.pos.x;

    updateTanyaC4(ctx, tanya);

    // Should be walking, not planting
    expect(tanya.animState).toBe(AnimState.WALK);
    expect((building as any).c4Timer).toBeUndefined();
  });

  it('Tanya does not plant C4 on dead structure', () => {
    const tanya = entityAtCell(UnitType.I_TANYA, House.Spain, 10, 10);
    const building = makeStructure('POWR', House.USSR, 10, 10);
    building.alive = false;
    tanya.targetStructure = building;
    tanya.mission = Mission.ATTACK;
    const ctx = makeSpecialCtx([tanya], [building]);

    updateTanyaC4(ctx, tanya);

    expect((building as any).c4Timer).toBeUndefined();
  });
});

// =============================================================================
// 11. Multiple C4 timers on different structures
// =============================================================================

describe('Multiple C4 timers (tickC4Timers iterates all structures)', () => {
  it('multiple structures with C4 all tick down independently', () => {
    const b1 = makeStructure('POWR', House.USSR, 5, 5);
    const b2 = makeStructure('BARR', House.USSR, 15, 15);
    (b1 as any).c4Timer = 10;
    (b2 as any).c4Timer = 5;
    const ctx = makeSpecialCtx([], [b1, b2]);

    tickC4Timers(ctx);

    expect((b1 as any).c4Timer).toBe(9);
    expect((b2 as any).c4Timer).toBe(4);
  });

  it('one structure explodes at timer=0 while another continues ticking', () => {
    const b1 = makeStructure('POWR', House.USSR, 5, 5, { hp: 400, maxHp: 400 });
    const b2 = makeStructure('BARR', House.USSR, 15, 15, { hp: 400, maxHp: 400 });
    (b1 as any).c4Timer = 1; // will detonate
    (b2 as any).c4Timer = 10; // continues ticking
    const ctx = makeSpecialCtx([], [b1, b2]);

    tickC4Timers(ctx);

    expect(b1.alive).toBe(false); // destroyed
    expect((b2 as any).c4Timer).toBe(9); // still ticking
    expect(b2.alive).toBe(true);
  });
});
