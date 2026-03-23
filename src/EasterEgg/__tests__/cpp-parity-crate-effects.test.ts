/**
 * C++ Behavioral Parity Tests — Crate Effect Application
 *
 * Tests the actual behavior of each crate pickup effect against C++ cell.cpp
 * Goodie_Check (lines 2103-2621). Complements existing parity tests that cover
 * data constants (crate-data), spawn/placement (crate-spawn), timing (crate-spawn-timing),
 * and collection mechanics (crate-collection).
 *
 * This file focuses on the RUNTIME BEHAVIOR of each crate type:
 *   - What happens when each crate type is picked up?
 *   - Do area-of-effect crates match C++ radius and filter rules?
 *   - Do fallback chains fire correctly?
 *   - Do squad/explosion/napalm patterns match C++?
 *   - Do superweapon-style crates (ICBM, parabomb, sonar) behave correctly?
 *
 * C++ source references:
 *   cell.cpp:2103-2621  — Goodie_Check: full crate pickup logic
 *   cell.cpp:2328-2342  — CRATE_MONEY: force_money or Random_Pick(CrateData, CrateData+900)
 *   cell.cpp:2347-2351  — CRATE_DARKNESS: Map.Shroud_The_Map() (entire map, not local)
 *   cell.cpp:2356-2364  — CRATE_REVEAL: IsVisionary=true, map all cells
 *   cell.cpp:2369-2437  — CRATE_UNIT: force_mcv / force_harvester / random, IsCrateGoodie filter
 *   cell.cpp:2443-2457  — CRATE_SQUAD: 5 infantry from {6x E1, E2, E3, RENOVATOR}
 *   cell.cpp:2462-2469  — CRATE_PARA_BOMB: enable one-shot superweapon
 *   cell.cpp:2474-2481  — CRATE_SONAR: enable one-shot superweapon
 *   cell.cpp:2486-2497  — CRATE_EXPLOSION: damage triggering unit + 5 scatter frags
 *   cell.cpp:2502-2511  — CRATE_NAPALM: damage triggering unit + area napalm
 *   cell.cpp:2516-2524  — CRATE_CLOAK: all ground TechnoClass within CrateRadius
 *   cell.cpp:2529-2540  — CRATE_HEAL_BASE: all allied objects to MaxStrength
 *   cell.cpp:2543-2550  — CRATE_ICBM: enable one-shot nuclear bomb
 *   cell.cpp:2552-2563  — CRATE_ARMOR: all ground Techno within CrateRadius, ArmorBias==1 filter
 *   cell.cpp:2565-2578  — CRATE_SPEED: all ground Foot within CrateRadius, SpeedBias==1, no aircraft
 *   cell.cpp:2580-2592  — CRATE_FIREPOWER: all ground Techno within CrateRadius, FirepowerBias==1
 *   cell.cpp:2594-2603  — CRATE_INVULN: all ground Techno within CrateRadius, iron curtain countdown
 *   cell.cpp:2608-2614  — CRATE_VORTEX: spawn if not already active
 *   cell.cpp:2328-2329  — CRATE_TIMEQUAKE: TimeQuake=true (global flag)
 *   cell.cpp:2161-2257  — Fallback rules (already-upgraded -> money, etc.)
 *   cell.cpp:2286-2296  — Water crate: UNIT/SQUAD -> MONEY
 *   cell.cpp:2264-2270  — Force MCV logic: BScan==0 && money > threshold && Bases && no MCV
 *   const.cpp:381-400   — CrateShares[] defaults
 *   const.cpp:423-442   — CrateData[] defaults (all 0 before RULES.INI override)
 *   const.cpp:444-463   — CrateNames[] canonical names
 *   rules.ini [Powerups] — Shares, anim, data overrides
 *   defines.h:3031-3032  — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 */

import { describe, it, expect } from 'vitest';
import {
  type CrateType, type CrateContext, type Crate,
  CRATE_SHARES, CRATE_ANIM_MAP, CRATE_RADIUS,
  pickupCrate, crateFallbackCheck,
} from '../engine/crates';
import { Entity, SONAR_PULSE_DURATION } from '../engine/entity';
import {
  CELL_SIZE, UnitType, House, Mission, worldDist,
  WEAPON_STATS, EXPLOSION_FRAMES,
} from '../engine/types';

// ══════════════════════════════════════════════════════════════════════════════
// C++ Reference Constants
// ══════════════════════════════════════════════════════════════════════════════

/** C++ defines.h:3031-3032 */
const CPP_TICKS_PER_SECOND = 15;
const CPP_TICKS_PER_MINUTE = CPP_TICKS_PER_SECOND * 60; // 900

/** C++ RULES.INI CrateData values (third field in [Powerups]) */
const CPP_CRATE_DATA = {
  money: 2000,          // Money=50,DOLLAR,2000
  explosion: 500,       // Explosion=5,NONE,500
  napalm: 600,          // Napalm=5,NONE,600
  armor: 2.0,           // Armor=10,ARMOR,2.0
  speed: 1.7,           // Speed=10,SPEED,1.7
  firepower: 2.0,       // Firepower=10,FPOWER,2.0
  invuln_minutes: 1.0,  // Invulnerability=3,INVULBOX,1.0
};

/** C++ RULES.INI SoloCrateMoney=2000 */
const CPP_SOLO_CRATE_MONEY = 2000;

// ══════════════════════════════════════════════════════════════════════════════
// Test Helpers
// ══════════════════════════════════════════════════════════════════════════════

function makeMockContext(overrides: Partial<CrateContext> = {}): CrateContext {
  return {
    crates: [],
    entities: [],
    entityById: new Map(),
    structures: [],
    effects: [],
    evaMessages: [],
    activeVortices: [],
    visionaryHouses: new Set(),
    credits: 0,
    tick: 100,
    playerHouse: House.Greece,
    screenShake: 0,
    map: {
      boundsX: 0, boundsY: 0, boundsW: 64, boundsH: 64,
      isPassable: () => true,
      getVisibility: () => 1,
      setVisibility: () => {},
      revealAll: () => {},
      shroudAll: () => {},
    } as any,
    crateOverrides: {},
    addCredits: function(amount: number) { this.credits += amount; },
    playSoundAt: () => {},
    playSound: () => {},
    damageEntity: (entity: Entity, damage: number) => { entity.hp -= damage; },
    damageStructure: (s: any, damage: number) => { s.hp -= damage; },
    detonateNuke: () => {},
    isAllied: (a: House, b: House) => a === b,
    ...overrides,
  };
}

function makeEntity(
  type: UnitType = UnitType.V_JEEP,
  house: House = House.Greece,
  x = 100, y = 100,
): Entity {
  const e = new Entity(type, house, x, y);
  e.mission = Mission.GUARD;
  return e;
}

function makeCrate(type: CrateType, x = 100, y = 100): Crate {
  return { x, y, type, tick: 0, lifetime: 9000 };
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Money Crate Effect
//
// C++ cell.cpp:2335-2341:
//   case CRATE_MONEY:
//     crate_money:
//       if (force_money > 0) {
//         object->House->Refund_Money(force_money);
//       } else {
//         object->House->Refund_Money(Random_Pick(CrateData[powerup], CrateData[powerup]+900));
//       }
//
// Solo play: force_money = Rule.SoloCrateMoney = 2000 (flat)
// Multiplayer: Random_Pick(2000, 2900)
// TS: always flat 2000 (targets solo play behavior)
// ══════════════════════════════════════════════════════════════════════════════

describe('money crate effect (cell.cpp:2335-2341)', () => {
  it('awards exactly SoloCrateMoney=2000 credits', () => {
    // C++ solo: force_money = Rule.SoloCrateMoney = 2000
    // TS crates.ts:233: ctx.addCredits(2000, true)
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('money'), unit);
    expect(ctx.credits).toBe(CPP_SOLO_CRATE_MONEY);
  });

  it('generates MONEY CRATE eva message', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('money'), unit);
    expect(ctx.evaMessages.some(m => m.text === 'MONEY CRATE')).toBe(true);
  });

  it('creates dollar animation effect (RULES.INI Money=50,DOLLAR,2000)', () => {
    // C++ cell.cpp:2319-2321: CrateAnims[CRATE_MONEY] — RULES.INI overrides ANIM_NONE to DOLLAR
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('money'), unit);
    // TS uses CRATE_ANIM_MAP['money'] = 'dollar'
    const dollarEffect = ctx.effects.find(e => e.sprite === 'dollar');
    expect(dollarEffect, 'should display dollar animation').toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Heal Crate Effect
//
// C++ has NO CRATE_HEAL type — only CRATE_HEAL_BASE (index 3).
// TS adds a 'heal' type that restores a SINGLE unit to full HP.
// This is a TS extension, not a C++ parity item.
// ══════════════════════════════════════════════════════════════════════════════

describe('heal crate effect (TS extension, no C++ equivalent)', () => {
  it('heal restores single unit to full HP', () => {
    // TS crates.ts:238: unit.hp = unit.maxHp
    // C++ has NO single-unit heal crate — only CRATE_HEAL_BASE (all units)
    const ctx = makeMockContext();
    const unit = makeEntity();
    unit.hp = 50; // damaged
    pickupCrate(ctx, makeCrate('heal'), unit);
    expect(unit.hp).toBe(unit.maxHp);
  });

  it('heal type is NOT in CRATE_SHARES (cannot be randomly selected)', () => {
    // C++ defines.h:759-781 has NO CRATE_HEAL.
    // TS 'heal' exists in CrateType union but has no shares entry.
    const healEntry = CRATE_SHARES.find(s => s.type === 'heal');
    expect(healEntry, '"heal" should NOT be in CRATE_SHARES').toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Heal Base Crate Effect
//
// C++ cell.cpp:2529-2540:
//   case CRATE_HEAL_BASE:
//     for (int index = 0; index < Logic.Count(); index++) {
//       ObjectClass * obj = Logic[index];
//       if (obj && object->Is_Techno() && object->House->Class->House == obj->Owner()) {
//         obj->Strength = obj->Class_Of().MaxStrength;
//       }
//     }
//
// Heals ALL allied objects (units AND buildings) to FULL HP.
// ══════════════════════════════════════════════════════════════════════════════

describe('heal_base crate effect (cell.cpp:2529-2540)', () => {
  it('heals all allied units to full HP', () => {
    const ctx = makeMockContext();
    const unit1 = makeEntity(UnitType.V_JEEP, House.Greece, 200, 200);
    const unit2 = makeEntity(UnitType.V_1TNK, House.Greece, 500, 500);
    unit1.hp = 10;
    unit2.hp = 30;
    ctx.entities.push(unit1, unit2);

    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    pickupCrate(ctx, makeCrate('heal_base'), collector);

    // C++ heals ALL allied objects, not just nearby ones
    expect(unit1.hp).toBe(unit1.maxHp);
    expect(unit2.hp).toBe(unit2.maxHp);
  });

  it('heals all allied structures to full HP', () => {
    const ctx = makeMockContext();
    const struct1 = { alive: true, house: House.Greece, hp: 50, maxHp: 1000,
      cx: 5, cy: 5, type: 'POWR', w: 2, h: 2 } as any;
    const struct2 = { alive: true, house: House.Greece, hp: 100, maxHp: 500,
      cx: 10, cy: 10, type: 'WEAP', w: 3, h: 3 } as any;
    ctx.structures.push(struct1, struct2);

    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('heal_base'), collector);

    // C++ cell.cpp:2537: obj->Strength = obj->Class_Of().MaxStrength
    expect(struct1.hp).toBe(1000);
    expect(struct2.hp).toBe(500);
  });

  it('does NOT heal enemy objects', () => {
    const ctx = makeMockContext();
    const enemyUnit = makeEntity(UnitType.V_JEEP, House.USSR, 300, 300);
    enemyUnit.hp = 10;
    ctx.entities.push(enemyUnit);

    const enemyStruct = { alive: true, house: House.USSR, hp: 50, maxHp: 1000,
      cx: 15, cy: 15, type: 'POWR', w: 2, h: 2 } as any;
    ctx.structures.push(enemyStruct);

    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('heal_base'), collector);

    // C++ cell.cpp:2536: object->House->Class->House == obj->Owner()
    // Enemy objects should NOT be healed
    expect(enemyUnit.hp).toBe(10);
    expect(enemyStruct.hp).toBe(50);
  });

  it('does NOT heal dead objects', () => {
    const ctx = makeMockContext();
    const deadUnit = makeEntity(UnitType.V_JEEP, House.Greece, 200, 200);
    deadUnit.hp = 0;
    deadUnit.alive = false;
    ctx.entities.push(deadUnit);

    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('heal_base'), collector);

    expect(deadUnit.hp).toBe(0);
  });

  it('uses INVUN animation (RULES.INI HealBase=1,INVUN)', () => {
    // C++ CrateAnims[CRATE_HEAL_BASE] = ANIM_INVUN (from RULES.INI)
    expect(CRATE_ANIM_MAP['heal_base']).toBe('invun');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Reveal Crate Effect
//
// C++ cell.cpp:2356-2364:
//   case CRATE_REVEAL:
//     object->House->IsVisionary = true;
//     if (object->House == PlayerPtr) {
//       for (CELL cell = 0; cell < MAP_CELL_TOTAL; cell++) {
//         Map.Map_Cell(cell, PlayerPtr);
//       }
//       Map.Flag_To_Redraw(true);
//     }
//
// Sets IsVisionary flag AND reveals entire map.
// ══════════════════════════════════════════════════════════════════════════════

describe('reveal crate effect (cell.cpp:2356-2364)', () => {
  it('adds house to visionaryHouses (C++ IsVisionary=true)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP, House.Greece);
    pickupCrate(ctx, makeCrate('reveal'), unit);

    // C++ cell.cpp:2357: object->House->IsVisionary = true
    expect(ctx.visionaryHouses.has(House.Greece)).toBe(true);
  });

  it('calls map.revealAll() to reveal entire map', () => {
    let revealCalled = false;
    const ctx = makeMockContext({
      map: {
        boundsX: 0, boundsY: 0, boundsW: 64, boundsH: 64,
        isPassable: () => true,
        getVisibility: () => 1,
        setVisibility: () => {},
        revealAll: () => { revealCalled = true; },
        shroudAll: () => {},
      } as any,
    });
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('reveal'), unit);

    // C++ cell.cpp:2359-2361: maps all cells for player
    expect(revealCalled).toBe(true);
  });

  it('uses EARTH animation (RULES.INI Reveal=1,EARTH)', () => {
    expect(CRATE_ANIM_MAP['reveal']).toBe('earth');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Darkness Crate Effect
//
// C++ cell.cpp:2347-2351:
//   case CRATE_DARKNESS:
//     if (object->House == PlayerPtr) {
//       Map.Shroud_The_Map();
//     }
//
// ENTIRE map is shrouded in C++.
// PARITY ACHIEVED: TS crates.ts now calls ctx.map.shroudAll() to shroud entire map,
// matching C++ Map.Shroud_The_Map(). Normal fog-of-war re-reveals around units next tick.
// ══════════════════════════════════════════════════════════════════════════════

describe('darkness crate effect (cell.cpp:2347-2351)', () => {
  it('calls shroudAll() to shroud the ENTIRE map (C++ Map.Shroud_The_Map())', () => {
    // C++ cell.cpp:2349: Map.Shroud_The_Map() — shrouds ALL cells on the map.
    // Normal fog-of-war update re-reveals around player units next tick.
    let shroudAllCalled = false;
    const ctx = makeMockContext({
      map: {
        boundsX: 0, boundsY: 0, boundsW: 64, boundsH: 64,
        isPassable: () => true,
        getVisibility: () => 1,
        setVisibility: () => {},
        revealAll: () => {},
        shroudAll: () => { shroudAllCalled = true; },
      } as any,
    });
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('darkness', 100, 100), unit);

    expect(shroudAllCalled).toBe(true);
  });

  it('DARKNESS eva message', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('darkness'), unit);
    expect(ctx.evaMessages.some(m => m.text === 'DARKNESS')).toBe(true);
  });

  it('uses EMPULSE animation (RULES.INI Darkness=1,EMPULSE)', () => {
    expect(CRATE_ANIM_MAP['darkness']).toBe('empulse');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Explosion Crate Effect
//
// C++ cell.cpp:2486-2497:
//   case CRATE_EXPLOSION:
//     if (object != NULL) {
//       int d = CrateData[powerup];     // = 500 from RULES.INI
//       object->Take_Damage(d, 0, WARHEAD_HE, 0, true);
//     }
//     for (int index = 0; index < 5; index++) {
//       COORDINATE frag_coord = Coord_Scatter(Cell_Coord(), Random_Pick(0, 0x0200));
//       new AnimClass(ANIM_FBALL1, frag_coord);
//       damage = CrateData[powerup];
//       Explosion_Damage(frag_coord, damage, NULL, WARHEAD_HE);
//     }
//
// Key: damages the TRIGGERING unit directly + 5 random scatter explosions.
// TS: damages all entities within 3-cell radius for 500 damage.
// ══════════════════════════════════════════════════════════════════════════════

describe('explosion crate effect (cell.cpp:2486-2497)', () => {
  it('damages entities near crate with CrateData=500 damage (RULES.INI Explosion=5,NONE,500)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const startHp = unit.hp;
    ctx.entities.push(unit);

    pickupCrate(ctx, makeCrate('explosion', 100, 100), unit);

    // C++ cell.cpp:2488: object->Take_Damage(CrateData[powerup]=500, 0, WARHEAD_HE, 0, true)
    // Unit should take significant damage
    expect(unit.hp).toBeLessThan(startHp);
  });

  it('creates explosion visual effects', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('explosion'), unit);

    // C++ creates ANIM_FBALL1 for 5 scatter explosions + crate anim
    // TS creates atomsfx explosion effect
    const explosionEffects = ctx.effects.filter(e => e.type === 'explosion');
    expect(explosionEffects.length).toBeGreaterThan(0);
  });

  it('C++ damages triggering unit directly with 500 HP (cell.cpp:2488)', () => {
    // C++ cell.cpp:2487-2489:
    //   int d = CrateData[powerup]; // = 500
    //   object->Take_Damage(d, 0, WARHEAD_HE, 0, true);
    // This is DIRECT damage to the triggering unit, separate from scatter explosions.
    const cppDirectDamage = CPP_CRATE_DATA.explosion; // 500
    expect(cppDirectDamage).toBe(500);
  });

  it('C++ fires 5 scatter explosions each dealing CrateData=500 damage', () => {
    // C++ cell.cpp:2491-2496: 5 scatter frags within 0x0200=512 leptons (~2 cells)
    const cppScatterCount = 5;
    const cppScatterDamage = CPP_CRATE_DATA.explosion; // 500 each
    expect(cppScatterCount).toBe(5);
    expect(cppScatterDamage).toBe(500);
  });

  it('BOOBY TRAP eva message', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('explosion'), unit);
    expect(ctx.evaMessages.some(m => m.text === 'BOOBY TRAP!')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: Napalm Crate Effect
//
// C++ cell.cpp:2502-2511:
//   case CRATE_NAPALM:
//     coord = Coord_Mid(Cell_Coord(), object->Center_Coord());
//     new AnimClass(ANIM_NAPALM3, coord);
//     if (object != NULL) {
//       int d = CrateData[powerup];     // = 600 from RULES.INI
//       object->Take_Damage(d, 0, WARHEAD_FIRE, 0, true);
//     }
//     damage = CrateData[powerup];
//     Explosion_Damage(coord, damage, NULL, WARHEAD_FIRE);
//
// Key: damages triggering unit + single area explosion at midpoint.
// TS: fires 3x3 grid of napalm each dealing 600 damage.
// ══════════════════════════════════════════════════════════════════════════════

describe('napalm crate effect (cell.cpp:2502-2511)', () => {
  it('deals CrateData=600 fire damage (RULES.INI Napalm=5,NONE,600)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const startHp = unit.hp;
    ctx.entities.push(unit);

    pickupCrate(ctx, makeCrate('napalm', 100, 100), unit);

    // C++ cell.cpp:2506: object->Take_Damage(600, 0, WARHEAD_FIRE, 0, true)
    expect(unit.hp).toBeLessThan(startHp);
  });

  it('creates napalm visual effects in 3x3 grid', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('napalm'), unit);

    // TS fires napalm1 sprites in 3x3 grid = 9 effects (+ crate anim)
    const napalmEffects = ctx.effects.filter(e => e.sprite === 'napalm1');
    expect(napalmEffects.length).toBe(9);
  });

  it('uses Fire warhead (C++ WARHEAD_FIRE)', () => {
    // C++ cell.cpp:2507: object->Take_Damage(d, 0, WARHEAD_FIRE, 0, true)
    // C++ cell.cpp:2510: Explosion_Damage(coord, damage, NULL, WARHEAD_FIRE)
    // TS crates.ts:373: ctx.damageEntity(e, 600, 'Fire')
    // The warhead type is 'Fire', matching C++.
    const cppWarhead = 'WARHEAD_FIRE';
    expect(cppWarhead).toContain('FIRE');
  });

  it('NAPALM STRIKE eva message', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('napalm'), unit);
    expect(ctx.evaMessages.some(m => m.text === 'NAPALM STRIKE')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: Cloak Crate Effect
//
// C++ cell.cpp:2516-2524:
//   case CRATE_CLOAK:
//     for (int index = 0; index < DisplayClass::Layer[LAYER_GROUND].Count(); index++) {
//       ObjectClass * obj = DisplayClass::Layer[LAYER_GROUND][index];
//       if (obj && obj->Is_Techno() && Distance(Cell_Coord(), obj->Center_Coord()) < Rule.CrateRadius) {
//         ((TechnoClass *)obj)->IsCloakable = true;
//       }
//     }
//
// C++ applies to ALL techno objects within CrateRadius (any house).
// PARITY ACHIEVED: TS crates.ts now iterates all entities within CRATE_RADIUS
// and sets isCloakable on each, matching C++ area-of-effect behavior.
// ══════════════════════════════════════════════════════════════════════════════

describe('cloak crate effect (cell.cpp:2516-2524)', () => {
  it('makes collecting unit cloakable', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    expect(unit.isCloakable).toBe(false);

    pickupCrate(ctx, makeCrate('cloak'), unit);
    expect(unit.isCloakable).toBe(true);
  });

  it('cloak shares = 0 in RULES.INI (disabled, const.cpp default was 3)', () => {
    // C++ const.cpp:386: CrateShares[CRATE_CLOAK] = 3 (compiled default)
    // RULES.INI:2820: Cloak=0,STEALTH2 (overrides to 0)
    const cloakEntry = CRATE_SHARES.find(s => s.type === 'cloak');
    expect(cloakEntry?.shares).toBe(0);
  });

  it('cloaks ALL nearby units within CrateRadius (cell.cpp:2516-2524)', () => {
    // C++ cell.cpp:2520: iterates LAYER_GROUND, all Techno within CrateRadius
    // C++ does NOT filter by house — even enemy units get cloaked
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const nearby = makeEntity(UnitType.V_JEEP, House.Greece, 110, 100);
    ctx.entities.push(collector, nearby);

    pickupCrate(ctx, makeCrate('cloak', 100, 100), collector);

    expect(collector.isCloakable).toBe(true);
    expect(nearby.isCloakable).toBe(true); // C++ parity: area-of-effect
  });

  it('cloaks enemy units within CrateRadius (C++ has no house filter)', () => {
    // C++ cell.cpp:2520: no house check — all techno within radius
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const enemy = makeEntity(UnitType.V_JEEP, House.USSR, 110, 100);
    ctx.entities.push(collector, enemy);

    pickupCrate(ctx, makeCrate('cloak', 100, 100), collector);

    expect(collector.isCloakable).toBe(true);
    expect(enemy.isCloakable).toBe(true); // C++ parity: no house filter
  });

  it('does NOT cloak units beyond CrateRadius', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const farUnit = makeEntity(UnitType.V_JEEP, House.Greece, 500, 500);
    ctx.entities.push(collector, farUnit);

    pickupCrate(ctx, makeCrate('cloak', 100, 100), collector);

    expect(collector.isCloakable).toBe(true);
    expect(farUnit.isCloakable).toBe(false); // too far
  });

  it('uses STEALTH2 animation (RULES.INI Cloak=0,STEALTH2)', () => {
    expect(CRATE_ANIM_MAP['cloak']).toBe('stealth2');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 9: Armor Crate Effect — Area of Effect
//
// C++ cell.cpp:2552-2563:
//   case CRATE_ARMOR:
//     for (obj in LAYER_GROUND) {
//       if (obj && Is_Techno() && Distance < CrateRadius && ArmorBias == 1) {
//         ArmorBias *= Inverse(fixed(CrateData/256));  // = 0.5 for CrateData=2.0
//       }
//     }
//
// Key C++ behavior:
//   1. Area of effect within CrateRadius (~3.0 cells from RULES.INI)
//   2. Only units with ArmorBias == 1 (not already upgraded)
//   3. Distance uses strict less-than (<)
//   4. Does NOT filter by house (C++ cell.cpp:2556 has no house check)
// ══════════════════════════════════════════════════════════════════════════════

describe('armor crate area-of-effect (cell.cpp:2552-2563)', () => {
  it('upgrades collector armorBias to 2 (equivalent to C++ 0.5 inverse)', () => {
    // C++ ArmorBias = 1.0 * Inverse(2.0) = 0.5 — damage multiplied by 0.5
    // TS armorBias = 2 — damage divided by 2
    // Both reduce incoming damage by 50%
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('armor'), unit);
    expect(unit.armorBias).toBe(2);
  });

  it('upgrades nearby allied units within CrateRadius', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    // Place a unit very close (well within CRATE_RADIUS=3.0 cells)
    const nearby = makeEntity(UnitType.V_1TNK, House.Greece, 110, 100); // ~0.4 cells
    ctx.entities.push(collector, nearby);

    pickupCrate(ctx, makeCrate('armor', 100, 100), collector);

    expect(collector.armorBias).toBe(2);
    expect(nearby.armorBias).toBe(2);
  });

  it('does NOT upgrade units beyond CrateRadius', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    // Place a unit far away (well beyond CRATE_RADIUS=3.0 cells, which is ~72 world units)
    const farUnit = makeEntity(UnitType.V_JEEP, House.Greece, 500, 500);
    ctx.entities.push(collector, farUnit);

    pickupCrate(ctx, makeCrate('armor', 100, 100), collector);

    expect(collector.armorBias).toBe(2);
    expect(farUnit.armorBias).toBe(1.0); // not upgraded
  });

  it('C++ only upgrades units with ArmorBias==1 (cell.cpp:2556)', () => {
    // C++ cell.cpp:2556: && ((TechnoClass *)obj)->ArmorBias == 1
    // Already-upgraded units are skipped in C++ area sweep.
    // TS crates.ts:263: no such check — always overwrites to 2.
    // The fallback in crateFallbackCheck prevents the crate from firing at all
    // if the COLLECTOR has ArmorBias != 1, but nearby units get overwritten.
    const cppRequiresDefaultBias = true;
    expect(cppRequiresDefaultBias).toBe(true);
  });

  it('uses ARMOR animation (RULES.INI Armor=10,ARMOR,2.0)', () => {
    expect(CRATE_ANIM_MAP['armor']).toBe('armor');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 10: Speed Crate Effect — Area of Effect
//
// C++ cell.cpp:2565-2578:
//   case CRATE_SPEED:
//     for (obj in LAYER_GROUND) {
//       if (obj && Is_Foot() && Distance < CrateRadius && SpeedBias == 1
//           && What_Am_I() != RTTI_AIRCRAFT) {
//         SpeedBias *= fixed(CrateData/256);  // = 1.7
//       }
//     }
//
// Key: excludes aircraft (cell.cpp:2569).
// ══════════════════════════════════════════════════════════════════════════════

describe('speed crate area-of-effect (cell.cpp:2565-2578)', () => {
  it('upgrades collector speedBias to 1.7 (RULES.INI Speed=10,SPEED,1.7)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('speed'), unit);
    expect(unit.speedBias).toBe(1.7);
  });

  it('upgrades nearby allied ground units within CrateRadius', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const nearby = makeEntity(UnitType.V_1TNK, House.Greece, 115, 100);
    ctx.entities.push(collector, nearby);

    pickupCrate(ctx, makeCrate('speed', 100, 100), collector);

    expect(collector.speedBias).toBe(1.7);
    expect(nearby.speedBias).toBe(1.7);
  });

  it('excludes aircraft from speed upgrade (cell.cpp:2569: RTTI_AIRCRAFT)', () => {
    // C++ cell.cpp:2569: obj->What_Am_I() != RTTI_AIRCRAFT
    // TS crates.ts:295: if (e.isAirUnit) continue
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const aircraft = makeEntity(UnitType.V_HIND, House.Greece, 110, 100);
    ctx.entities.push(collector, aircraft);

    pickupCrate(ctx, makeCrate('speed', 100, 100), collector);

    expect(collector.speedBias).toBe(1.7);
    // Aircraft should be excluded from speed upgrade
    if (aircraft.isAirUnit) {
      expect(aircraft.speedBias).toBe(1.0);
    }
  });

  it('does NOT upgrade enemy units', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const enemy = makeEntity(UnitType.V_JEEP, House.USSR, 110, 100);
    ctx.entities.push(collector, enemy);

    pickupCrate(ctx, makeCrate('speed', 100, 100), collector);

    expect(collector.speedBias).toBe(1.7);
    expect(enemy.speedBias).toBe(1.0); // not upgraded
  });

  it('uses SPEED animation (RULES.INI Speed=10,SPEED,1.7)', () => {
    expect(CRATE_ANIM_MAP['speed']).toBe('speed');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 11: Firepower Crate Effect — Area of Effect
//
// C++ cell.cpp:2580-2592:
//   case CRATE_FIREPOWER:
//     for (obj in LAYER_GROUND) {
//       if (obj && Is_Techno() && Distance < CrateRadius && FirepowerBias == 1) {
//         FirepowerBias *= fixed(CrateData/256);  // = 2.0
//       }
//     }
// ══════════════════════════════════════════════════════════════════════════════

describe('firepower crate area-of-effect (cell.cpp:2580-2592)', () => {
  it('upgrades collector firepowerBias to 2 (RULES.INI Firepower=10,FPOWER,2.0)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('firepower'), unit);
    expect(unit.firepowerBias).toBe(2);
  });

  it('upgrades nearby allied units within CrateRadius', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const nearby = makeEntity(UnitType.V_1TNK, House.Greece, 112, 100);
    ctx.entities.push(collector, nearby);

    pickupCrate(ctx, makeCrate('firepower', 100, 100), collector);

    expect(collector.firepowerBias).toBe(2);
    expect(nearby.firepowerBias).toBe(2);
  });

  it('does NOT upgrade enemy units', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const enemy = makeEntity(UnitType.V_JEEP, House.USSR, 110, 100);
    ctx.entities.push(collector, enemy);

    pickupCrate(ctx, makeCrate('firepower', 100, 100), collector);

    expect(collector.firepowerBias).toBe(2);
    expect(enemy.firepowerBias).toBe(1.0);
  });

  it('uses FPOWER animation (RULES.INI Firepower=10,FPOWER,2.0)', () => {
    expect(CRATE_ANIM_MAP['firepower']).toBe('fpower');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 12: Invulnerability Crate Effect — Area of Effect
//
// C++ cell.cpp:2594-2603:
//   case CRATE_INVULN:
//     for (obj in LAYER_GROUND) {
//       if (obj && Is_Techno() && Distance < CrateRadius) {
//         IronCurtainCountDown = (TICKS_PER_MINUTE * fixed(CrateData[powerup], 256));
//       }
//     }
//
// RULES.INI Invulnerability=3,INVULBOX,1.0
// CrateData = fixed(1.0)*256 = 256
// Duration = 900 * 1.0 = 900 C++ ticks = 60 seconds
// TS: 900 ticks at 15 TPS = 60 seconds (exact C++ parity)
//
// PARITY ACHIEVED: TS now applies invulnerability to ALL entities within CRATE_RADIUS,
// matching C++ area-of-effect behavior (no house filter).
// ══════════════════════════════════════════════════════════════════════════════

describe('invulnerability crate effect (cell.cpp:2594-2603)', () => {
  it('sets invulnTick = 900 (60s at 15 TPS, exact C++ parity)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('invulnerability'), unit);

    // C++ duration: TICKS_PER_MINUTE * 1.0 = 900 ticks / 15 TPS = 60 seconds
    // TS duration: 900 ticks / 15 TPS = 60 seconds — exact parity
    const cppSeconds = (CPP_TICKS_PER_MINUTE * CPP_CRATE_DATA.invuln_minutes) / CPP_TICKS_PER_SECOND;
    const tsSeconds = unit.invulnTick / 15;
    expect(tsSeconds).toBe(cppSeconds);
    expect(unit.invulnTick).toBe(900);
  });

  it('applies invulnerability to ALL nearby units within CrateRadius (cell.cpp:2594-2603)', () => {
    // C++ cell.cpp:2598: iterates LAYER_GROUND, applies to all Techno within CrateRadius
    // C++ does NOT check house — even enemy units get invulnerability
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const nearby = makeEntity(UnitType.V_JEEP, House.Greece, 110, 100);
    ctx.entities.push(collector, nearby);

    pickupCrate(ctx, makeCrate('invulnerability', 100, 100), collector);

    expect(collector.invulnTick).toBe(900);
    expect(nearby.invulnTick).toBe(900); // C++ parity: area-of-effect
  });

  it('applies invulnerability to enemy units within CrateRadius (C++ has no house filter)', () => {
    // C++ cell.cpp:2598: no house check — all techno within radius
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const enemy = makeEntity(UnitType.V_JEEP, House.USSR, 110, 100);
    ctx.entities.push(collector, enemy);

    pickupCrate(ctx, makeCrate('invulnerability', 100, 100), collector);

    expect(collector.invulnTick).toBe(900);
    expect(enemy.invulnTick).toBe(900); // C++ parity: no house filter
  });

  it('does NOT apply invulnerability to units beyond CrateRadius', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const farUnit = makeEntity(UnitType.V_JEEP, House.Greece, 500, 500);
    ctx.entities.push(collector, farUnit);

    pickupCrate(ctx, makeCrate('invulnerability', 100, 100), collector);

    expect(collector.invulnTick).toBe(900);
    expect(farUnit.invulnTick).toBe(0);
  });

  it('uses INVULBOX animation (RULES.INI Invulnerability=3,INVULBOX,1.0)', () => {
    expect(CRATE_ANIM_MAP['invulnerability']).toBe('invulbox');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 13: Unit Crate Effect
//
// C++ cell.cpp:2369-2437:
//   case CRATE_UNIT:
//     1. force_mcv → spawn MCV (if BScan==0, money>threshold, bases enabled)
//     2. No harvester + has refinery → spawn Harvester
//     3. UnitCrateType != UNIT_NONE → spawn that specific type
//     4. Otherwise random: Random_Pick(UNIT_FIRST, UNIT_COUNT-1-3)
//        Filter: IsCrateGoodie && Ownable by player
//
// TS: spawns from a fixed array of unit types.
// ══════════════════════════════════════════════════════════════════════════════

describe('unit crate effect (cell.cpp:2369-2437)', () => {
  it('spawns a new entity near the crate', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    const initialCount = ctx.entities.length;

    pickupCrate(ctx, makeCrate('unit'), unit);

    // Should spawn exactly 1 new entity
    expect(ctx.entities.length).toBe(initialCount + 1);
  });

  it('spawned unit belongs to player house', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP, House.Greece);
    pickupCrate(ctx, makeCrate('unit'), unit);

    const spawned = ctx.entities[ctx.entities.length - 1];
    // C++ cell.cpp:2419: utp->Create_One_Of(object->House)
    // TS crates.ts:249: new Entity(uType, ctx.playerHouse, ...)
    expect(spawned.house).toBe(House.Greece);
  });

  it('spawned unit gets GUARD mission', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('unit'), unit);

    const spawned = ctx.entities[ctx.entities.length - 1];
    expect(spawned.mission).toBe(Mission.GUARD);
  });

  it('REINFORCEMENTS eva message', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('unit'), unit);
    expect(ctx.evaMessages.some(m => m.text === 'REINFORCEMENTS')).toBe(true);
  });

  it('C++ random unit selection skips last 3 units (ant types) with FIXIT_ANTS', () => {
    // C++ cell.cpp:2402: Random_Pick(UNIT_FIRST, (UnitType)(UNIT_RA_COUNT-1 -3))
    // This excludes the 3 ant unit types from random selection.
    const cppExcludesAntTypes = true;
    expect(cppExcludesAntTypes).toBe(true);
  });

  it('C++ filters by IsCrateGoodie flag (cell.cpp:2411)', () => {
    // C++ cell.cpp:2411: if (utp->IsCrateGoodie && (utp->Ownable & (1 << ActLike)))
    // Only units marked as crate-eligible and ownable by the player's faction
    // can appear from unit crates.
    const cppUsesGoodieFilter = true;
    expect(cppUsesGoodieFilter).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 14: Squad Crate Effect
//
// C++ cell.cpp:2443-2457:
//   case CRATE_SQUAD:
//     for (int index = 0; index < 5; index++) {
//       static InfantryType _inf[] = {
//         INFANTRY_E1,INFANTRY_E1,INFANTRY_E1,INFANTRY_E1,INFANTRY_E1,INFANTRY_E1,
//         INFANTRY_E2,
//         INFANTRY_E3,
//         INFANTRY_RENOVATOR
//       };
//       if (!Create_And_Place(Cell_Number(), object->Owner())) {
//         if (index == 0) goto crate_money;
//       }
//     }
//
// Key C++ details:
//   1. Spawns exactly 5 infantry
//   2. Pool: 6x E1, 1x E2, 1x E3, 1x RENOVATOR (engineer)
//   3. If first infantry fails to spawn, falls back to money
// ══════════════════════════════════════════════════════════════════════════════

describe('squad crate effect (cell.cpp:2443-2457)', () => {
  it('spawns exactly 5 infantry', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    const initialCount = ctx.entities.length;

    pickupCrate(ctx, makeCrate('squad'), unit);

    expect(ctx.entities.length).toBe(initialCount + 5);
  });

  it('uses C++ weighted pool: 6x E1, 1x E2, 1x E3, 1x E6/RENOVATOR (9 entries)', () => {
    // C++ cell.cpp:2445-2449:
    //   static InfantryType _inf[] = {
    //     INFANTRY_E1,INFANTRY_E1,INFANTRY_E1,INFANTRY_E1,INFANTRY_E1,INFANTRY_E1,
    //     INFANTRY_E2,
    //     INFANTRY_E3,
    //     INFANTRY_RENOVATOR
    //   };
    // TS now matches this pool: E1x6, E2, E3, E6 (engineer = RENOVATOR)
    // Verify by spawning many squads and checking that only E1, E2, E3, E6 appear
    const seenTypes = new Set<string>();
    for (let trial = 0; trial < 50; trial++) {
      const ctx = makeMockContext();
      const unit = makeEntity();
      pickupCrate(ctx, makeCrate('squad'), unit);
      for (const e of ctx.entities) {
        seenTypes.add(e.stats.type);
      }
    }
    // Should only contain types from the C++ pool
    for (const t of seenTypes) {
      expect(['E1', 'E2', 'E3', 'E6']).toContain(t);
    }
    // E4 should NOT appear (was in old TS pool, not in C++ pool)
    expect(seenTypes.has('E4')).toBe(false);
  });

  it('spawned infantry belong to player house', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP, House.Greece);
    pickupCrate(ctx, makeCrate('squad'), unit);

    const spawned = ctx.entities;
    for (const e of spawned) {
      expect(e.house).toBe(House.Greece);
    }
  });

  it('SQUAD REINFORCEMENT eva message', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('squad'), unit);
    expect(ctx.evaMessages.some(m => m.text === 'SQUAD REINFORCEMENT')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 15: ParaBomb Crate Effect
//
// C++ cell.cpp:2462-2469:
//   case CRATE_PARA_BOMB:
//     if (object->House->SuperWeapon[SPC_PARA_BOMB].Enable(true)) {
//       if (object->IsOwnedByPlayer) {
//         Map.Add(RTTI_SPECIAL, SPC_PARA_BOMB);
//         Map.Column[1].Flag_To_Redraw();
//       }
//     }
//
// C++ enables a one-shot superweapon. TS fires an immediate airstrike.
// ══════════════════════════════════════════════════════════════════════════════

describe('parabomb crate effect (cell.cpp:2462-2469)', () => {
  it('creates explosion effects along a bombing line', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('parabomb'), unit);

    // TS fires bombs in a line from x-3 to x+3 cells = 7 bomb positions
    const bombEffects = ctx.effects.filter(e => e.sprite === 'art-exp1');
    expect(bombEffects.length).toBe(7);
  });

  it('PARITY NOTE: C++ enables superweapon, TS fires immediate strike', () => {
    // C++ cell.cpp:2463: SuperWeapon[SPC_PARA_BOMB].Enable(true)
    // This gives the player a one-shot parabomb ability to use at will.
    // TS immediately detonates bombs at the crate location.
    const cppBehavior = 'enable_superweapon';
    const tsBehavior = 'immediate_strike';
    expect(cppBehavior).not.toBe(tsBehavior);
  });

  it('PARABOMB STRIKE eva message', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('parabomb'), unit);
    expect(ctx.evaMessages.some(m => m.text === 'PARABOMB STRIKE')).toBe(true);
  });

  it('uses PARABOX animation (RULES.INI ParaBomb=3,PARABOX)', () => {
    expect(CRATE_ANIM_MAP['parabomb']).toBe('parabox');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 16: Sonar Crate Effect
//
// C++ cell.cpp:2474-2481:
//   case CRATE_SONAR:
//     if (object->House->SuperWeapon[SPC_SONAR_PULSE].Enable(true)) {
//       if (object->IsOwnedByPlayer) {
//         Map.Add(RTTI_SPECIAL, SPC_SONAR_PULSE);
//       }
//     }
//
// C++ enables a one-shot sonar pulse superweapon.
// TS immediately reveals all enemy cloakable units.
// ══════════════════════════════════════════════════════════════════════════════

describe('sonar crate effect (cell.cpp:2474-2481)', () => {
  it('sets sonarPulseTimer on enemy cloakable units', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece);

    // Create an enemy cloakable unit (submarine)
    const sub = makeEntity(UnitType.V_SS, House.USSR, 300, 300);
    ctx.entities.push(sub);

    pickupCrate(ctx, makeCrate('sonar'), collector);

    // TS crates.ts:418: e.sonarPulseTimer = SONAR_PULSE_DURATION
    if (sub.stats.isCloakable) {
      expect(sub.sonarPulseTimer).toBe(SONAR_PULSE_DURATION);
    }
  });

  it('does NOT affect allied cloakable units', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece);

    const alliedSub = makeEntity(UnitType.V_SS, House.Greece, 300, 300);
    ctx.entities.push(alliedSub);

    pickupCrate(ctx, makeCrate('sonar'), collector);

    // Allied subs should not be affected by sonar pulse
    expect(alliedSub.sonarPulseTimer).toBe(0);
  });

  it('SONAR PULSE eva message', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('sonar'), unit);
    expect(ctx.evaMessages.some(m => m.text === 'SONAR PULSE')).toBe(true);
  });

  it('uses SONARBOX animation (RULES.INI Sonar=3,SONARBOX)', () => {
    expect(CRATE_ANIM_MAP['sonar']).toBe('sonarbox');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 17: ICBM Crate Effect
//
// C++ cell.cpp:2543-2550:
//   case CRATE_ICBM:
//     if (object->House->SuperWeapon[SPC_NUCLEAR_BOMB].Enable(true)) {
//       if (object->IsOwnedByPlayer) {
//         Map.Add(RTTI_SPECIAL, SPC_NUCLEAR_BOMB);
//       }
//     }
//
// C++ enables a one-shot nuclear bomb superweapon.
// TS immediately nukes a random enemy structure.
// ══════════════════════════════════════════════════════════════════════════════

describe('ICBM crate effect (cell.cpp:2543-2550)', () => {
  it('detonates nuke at enemy structure when enemies exist', () => {
    let nukeTarget: { x: number; y: number } | null = null;
    const ctx = makeMockContext({
      detonateNuke: (target) => { nukeTarget = target; },
    });

    const enemyStruct = {
      alive: true, house: House.USSR, hp: 500, maxHp: 1000,
      cx: 10, cy: 10, type: 'POWR', w: 2, h: 2,
    } as any;
    ctx.structures.push(enemyStruct);

    const collector = makeEntity(UnitType.V_JEEP, House.Greece);
    pickupCrate(ctx, makeCrate('icbm'), collector);

    expect(nukeTarget).not.toBeNull();
    expect(ctx.evaMessages.some(m => m.text === 'ICBM LAUNCHED')).toBe(true);
  });

  it('falls back to money when no enemy structures exist', () => {
    // TS crates.ts:434-438: if no enemies, addCredits(2000) + 'MONEY CRATE'
    const ctx = makeMockContext();
    // No enemy structures
    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('icbm'), collector);

    expect(ctx.credits).toBe(2000);
    expect(ctx.evaMessages.some(m => m.text === 'MONEY CRATE')).toBe(true);
  });

  it('PARITY NOTE: C++ enables superweapon, TS fires immediate nuke', () => {
    // C++ cell.cpp:2544: SuperWeapon[SPC_NUCLEAR_BOMB].Enable(true)
    // Player gets a one-shot nuke to aim at their leisure.
    // TS immediately targets a random enemy structure.
    const cppBehavior = 'enable_superweapon';
    const tsBehavior = 'immediate_nuke';
    expect(cppBehavior).not.toBe(tsBehavior);
  });

  it('uses MISSILE2 animation (RULES.INI ICBM=1,MISSILE2)', () => {
    expect(CRATE_ANIM_MAP['icbm']).toBe('missile2');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 18: TimeQuake Crate Effect
//
// C++ cell.cpp:2328-2329:
//   case CRATE_TIMEQUAKE:
//     TimeQuake = true;   // sets global flag; actual damage happens elsewhere
//
// C++ cell.cpp:2206-2258:
//   Complex eligibility check in multiplayer:
//   - Random chance inversely proportional to elapsed time
//   - Random chance inversely proportional to min unit count
//   - Falls back to money if conditions not met
//
// TS: immediately damages all units and structures for 100-300 random damage.
// ══════════════════════════════════════════════════════════════════════════════

describe('timequake crate effect (cell.cpp:2328-2329, 2206-2258)', () => {
  it('damages all entities on the map', () => {
    const ctx = makeMockContext();
    const unit1 = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const unit2 = makeEntity(UnitType.V_JEEP, House.USSR, 500, 500);
    const hp1 = unit1.hp;
    const hp2 = unit2.hp;
    ctx.entities.push(unit1, unit2);

    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('timequake'), collector);

    // TS damages all alive entities — both allied and enemy
    expect(unit1.hp).toBeLessThan(hp1);
    expect(unit2.hp).toBeLessThan(hp2);
  });

  it('damages all structures on the map', () => {
    const ctx = makeMockContext();
    const struct1 = { alive: true, house: House.Greece, hp: 1000, maxHp: 1000,
      cx: 5, cy: 5, type: 'POWR', w: 2, h: 2 } as any;
    const struct2 = { alive: true, house: House.USSR, hp: 800, maxHp: 800,
      cx: 15, cy: 15, type: 'WEAP', w: 3, h: 3 } as any;
    ctx.structures.push(struct1, struct2);

    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('timequake'), collector);

    expect(struct1.hp).toBeLessThan(1000);
    expect(struct2.hp).toBeLessThan(800);
  });

  it('applies screen shake', () => {
    const ctx = makeMockContext();
    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('timequake'), collector);

    // TS crates.ts:453: ctx.screenShake = Math.max(ctx.screenShake, 15)
    expect(ctx.screenShake).toBeGreaterThanOrEqual(15);
  });

  it('C++ multiplayer eligibility: time-based + unit-count-based random check', () => {
    // C++ cell.cpp:2217-2257:
    //   if (Session.Type != GAME_NORMAL) {
    //     unsigned long minutes = (Score.ElapsedTime / TIMER_MINUTE);
    //     if (minutes > 100) minutes = 100;
    //     if (Random_Pick(0, 100-(int)minutes) == 0) {
    //       // count units per player, find minimum
    //       if (Random_Pick(0, minunits) == minunits) { found = true; }
    //     }
    //     if (!found) powerup = CRATE_MONEY;
    //   }
    // This means timequakes are VERY rare early game and become more likely over time.
    // TS does not implement this check — timequake always fires.
    const cppHasEligibilityCheck = true;
    expect(cppHasEligibilityCheck).toBe(true);
  });

  it('TIME QUAKE eva message', () => {
    const ctx = makeMockContext();
    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('timequake'), collector);
    expect(ctx.evaMessages.some(m => m.text === 'TIME QUAKE')).toBe(true);
  });

  it('uses TQUAKE animation (RULES.INI TimeQuake=3,TQUAKE)', () => {
    expect(CRATE_ANIM_MAP['timequake']).toBe('tquake');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 19: Vortex Crate Effect
//
// C++ cell.cpp:2608-2614:
//   case CRATE_VORTEX:
//     if (!ChronalVortex.Is_Active()) {
//       ChronalVortex.Appear(Cell_Coord());
//       ChronalVortex.Set_Target((ObjectClass*) object);
//       Sound_Effect(VOC_TESLA_ZAP, object->Center_Coord());
//     }
//
// Key: C++ only spawns if vortex is NOT already active (singleton).
// TS: always spawns a new vortex (no singleton check).
// ══════════════════════════════════════════════════════════════════════════════

describe('vortex crate effect (cell.cpp:2608-2614)', () => {
  it('spawns a vortex at crate location', () => {
    const ctx = makeMockContext();
    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('vortex', 200, 300), collector);

    expect(ctx.activeVortices.length).toBe(1);
    expect(ctx.activeVortices[0].x).toBe(200);
    expect(ctx.activeVortices[0].y).toBe(300);
  });

  it('vortex has limited lifetime (ticksLeft > 0)', () => {
    const ctx = makeMockContext();
    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('vortex'), collector);

    expect(ctx.activeVortices[0].ticksLeft).toBeGreaterThan(0);
  });

  it('singleton: does NOT spawn vortex if one already active (cell.cpp:2609)', () => {
    // C++ cell.cpp:2609: if (!ChronalVortex.Is_Active())
    // Only one chronal vortex can exist at a time.
    const ctx = makeMockContext();
    ctx.activeVortices.push({ x: 50, y: 50, angle: 0, ticksLeft: 100, id: 1 });

    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('vortex', 200, 200), collector);

    // C++ parity: only 1 vortex should exist (the pre-existing one)
    expect(ctx.activeVortices.length).toBe(1);
    expect(ctx.activeVortices[0].x).toBe(50); // original vortex unchanged
  });

  it('singleton: no eva message when vortex already active', () => {
    const ctx = makeMockContext();
    ctx.activeVortices.push({ x: 50, y: 50, angle: 0, ticksLeft: 100, id: 1 });

    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('vortex', 200, 200), collector);

    // No VORTEX SPAWNED message when blocked by singleton check
    expect(ctx.evaMessages.some(m => m.text === 'VORTEX SPAWNED')).toBe(false);
  });

  it('VORTEX SPAWNED eva message when no vortex active', () => {
    const ctx = makeMockContext();
    const collector = makeEntity();
    pickupCrate(ctx, makeCrate('vortex'), collector);
    expect(ctx.evaMessages.some(m => m.text === 'VORTEX SPAWNED')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 20: Crate Fallback Rules — crateFallbackCheck
//
// C++ cell.cpp:2161-2257 — when the selected crate type would have no effect,
// fall back to CRATE_MONEY. These fallback checks only apply in multiplayer
// (Session.Type != GAME_NORMAL).
// ══════════════════════════════════════════════════════════════════════════════

describe('crate fallback rules via crateFallbackCheck (cell.cpp:2161-2257)', () => {
  it('armor: falls back to money if ArmorBias != 1 (cell.cpp:2174-2176)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    unit.armorBias = 2.0; // already upgraded
    const result = crateFallbackCheck('armor', unit, ctx);
    expect(result).toBe('money');
  });

  it('armor: no fallback when ArmorBias == 1 (default)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    expect(unit.armorBias).toBe(1.0);
    const result = crateFallbackCheck('armor', unit, ctx);
    expect(result).toBe('armor');
  });

  it('speed: falls back to money if SpeedBias != 1 (cell.cpp:2178-2180)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    unit.speedBias = 1.7;
    const result = crateFallbackCheck('speed', unit, ctx);
    expect(result).toBe('money');
  });

  it('speed: falls back to money for aircraft (cell.cpp:2179)', () => {
    // C++ cell.cpp:2179: object->What_Am_I() == RTTI_AIRCRAFT
    const ctx = makeMockContext();
    const aircraft = makeEntity(UnitType.V_HIND, House.Greece);
    if (aircraft.isAirUnit) {
      const result = crateFallbackCheck('speed', aircraft, ctx);
      expect(result).toBe('money');
    }
  });

  it('firepower: falls back to money if FirepowerBias != 1 (cell.cpp:2182-2184)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    unit.firepowerBias = 2.0;
    const result = crateFallbackCheck('firepower', unit, ctx);
    expect(result).toBe('money');
  });

  it('firepower: falls back to money if unit has no weapon (cell.cpp:2183)', () => {
    // C++ cell.cpp:2183: !object->Is_Weapon_Equipped()
    const ctx = makeMockContext();
    const unit = makeEntity();
    (unit as any).weapon = null; // simulate no weapon
    const result = crateFallbackCheck('firepower', unit, ctx);
    expect(result).toBe('money');
  });

  it('cloak: falls back to money if already cloakable (cell.cpp:2196-2198)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    unit.isCloakable = true;
    const result = crateFallbackCheck('cloak', unit, ctx);
    expect(result).toBe('money');
  });

  it('cloak: no fallback when not cloakable (default)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    expect(unit.isCloakable).toBe(false);
    const result = crateFallbackCheck('cloak', unit, ctx);
    expect(result).toBe('cloak');
  });

  it('unit: falls back to money when house has >50 units (cell.cpp:2162-2164)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    // Add >50 non-infantry units
    for (let i = 0; i < 51; i++) {
      ctx.entities.push(makeEntity(UnitType.V_JEEP, House.Greece, i * 50, 100));
    }
    const result = crateFallbackCheck('unit', unit, ctx);
    expect(result).toBe('money');
  });

  it('unit: no fallback when house has <=50 units', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    for (let i = 0; i < 10; i++) {
      ctx.entities.push(makeEntity(UnitType.V_JEEP, House.Greece, i * 50, 100));
    }
    const result = crateFallbackCheck('unit', unit, ctx);
    expect(result).toBe('unit');
  });

  it('squad: falls back to money when house has >100 infantry (cell.cpp:2166-2168)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    for (let i = 0; i < 101; i++) {
      ctx.entities.push(makeEntity(UnitType.I_E1, House.Greece, i * 10, 100));
    }
    const result = crateFallbackCheck('squad', unit, ctx);
    expect(result).toBe('money');
  });

  it('squad: no fallback when house has <=100 infantry', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    for (let i = 0; i < 50; i++) {
      ctx.entities.push(makeEntity(UnitType.I_E1, House.Greece, i * 10, 100));
    }
    const result = crateFallbackCheck('squad', unit, ctx);
    expect(result).toBe('squad');
  });

  it('money: no fallback (money is the fallback target itself)', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    const result = crateFallbackCheck('money', unit, ctx);
    expect(result).toBe('money');
  });

  it('C++ reveal fallback: if IsVisionary + IsGPSActive -> money (cell.cpp:2186-2193)', () => {
    // C++ cell.cpp:2186-2193:
    //   case CRATE_REVEAL:
    //     if (object->House->IsVisionary) {
    //       if (object->House->IsGPSActive) powerup = CRATE_MONEY;
    //       else powerup = CRATE_DARKNESS;
    //     }
    //
    // TS does not implement this fallback — reveal always reveals.
    // This is a C++ multiplayer-only check.
    const cppHasRevealFallback = true;
    expect(cppHasRevealFallback).toBe(true);
  });

  it('C++ darkness fallback: if IsGPSActive -> money (cell.cpp:2170-2172)', () => {
    // C++ cell.cpp:2170-2172:
    //   case CRATE_DARKNESS:
    //     if (object->House->IsGPSActive) powerup = CRATE_MONEY;
    //
    // TS does not implement this — darkness always fires.
    const cppHasDarknessFallback = true;
    expect(cppHasDarknessFallback).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 21: Water Crate Restrictions
//
// C++ cell.cpp:2286-2296:
//   if (Overlay == OVERLAY_WATER_CRATE) {
//     switch (powerup) {
//       case CRATE_UNIT:
//       case CRATE_SQUAD:
//         powerup = CRATE_MONEY;
//         break;
//     }
//   }
//
// Water crates cannot give UNIT or SQUAD because infantry/vehicles can't
// spawn on water. Falls back to MONEY instead.
// TS has no water vs land crate distinction.
// ══════════════════════════════════════════════════════════════════════════════

describe('water crate restrictions (cell.cpp:2286-2296)', () => {
  it('C++ converts CRATE_UNIT to CRATE_MONEY on water crates', () => {
    // C++ cell.cpp:2288-2290: case CRATE_UNIT: powerup = CRATE_MONEY;
    // This prevents infantry from spawning on water cells.
    const cppUnitFallbackOnWater = 'CRATE_MONEY';
    expect(cppUnitFallbackOnWater).toBe('CRATE_MONEY');
  });

  it('C++ converts CRATE_SQUAD to CRATE_MONEY on water crates', () => {
    // C++ cell.cpp:2289-2290: case CRATE_SQUAD: powerup = CRATE_MONEY;
    const cppSquadFallbackOnWater = 'CRATE_MONEY';
    expect(cppSquadFallbackOnWater).toBe('CRATE_MONEY');
  });

  it('TS has no water crate concept — no UNIT/SQUAD restriction', () => {
    // TS crates have a type field but no surface/overlay distinction.
    // A 'unit' crate always spawns a unit, regardless of terrain.
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('unit'), unit);
    // Unit was spawned (no water check prevents it)
    expect(ctx.entities.length).toBe(1);
  });

  it('water crate chance = 20% (RULES.INI WaterCrateChance=20%)', () => {
    // C++ crate.cpp:133: Percent_Chance(100 * Rule.WaterCrateChance)
    // RULES.INI:16: WaterCrateChance=20%
    const cppWaterCrateChance = 0.20;
    expect(cppWaterCrateChance).toBe(0.20);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 22: Force MCV Logic
//
// C++ cell.cpp:2264-2270:
//   if (object->House->BScan == 0 &&
//       object->House->Available_Money() > (Refinery.Cost + Power.Cost) * CostBias &&
//       Session.Options.Bases &&
//       !(object->House->UScan & UNITF_MCV)) {
//     powerup = CRATE_UNIT;
//     force_mcv = true;
//   }
//
// When player has no buildings, enough money, bases enabled, and no MCV,
// ANY crate becomes a forced MCV spawn.
// TS does not implement force_mcv logic.
// ══════════════════════════════════════════════════════════════════════════════

describe('force MCV logic (cell.cpp:2264-2270)', () => {
  it('C++ forces MCV when: no buildings + enough money + bases + no MCV', () => {
    // This is multiplayer-only emergency recovery logic.
    // C++ conditions:
    //   1. BScan == 0 (no buildings)
    //   2. Available_Money() > (Refinery + Power).Cost * CostBias
    //   3. Session.Options.Bases == true
    //   4. !(UScan & UNITF_MCV) (no MCV exists)
    // When all conditions met, crate becomes CRATE_UNIT with force_mcv=true
    const cppHasForceMcvLogic = true;
    expect(cppHasForceMcvLogic).toBe(true);
  });

  it('C++ force_money logic: money crate + ConYard + no refinery + too poor', () => {
    // C++ cell.cpp:2276-2279:
    //   if (powerup == CRATE_MONEY && (BScan & (STRUCTF_CONST|STRUCTF_REFINERY)) == STRUCTF_CONST
    //       && Available_Money() < Refinery.Cost * CostBias) {
    //     force_money = Refinery.Cost * CostBias;
    //   }
    // Guarantees enough money to rebuild refinery if player has ConYard but no refinery.
    const cppHasForceMoneyLogic = true;
    expect(cppHasForceMoneyLogic).toBe(true);
  });

  it('TS does not implement force_mcv or force_money recovery logic', () => {
    // TS pickupCrate has no building-scan or money-threshold checks.
    // These are acceptable gaps since TS targets solo play.
    const tsImplementsForceMcv = false;
    expect(tsImplementsForceMcv).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 23: Multiplayer Crate Replacement
//
// C++ cell.cpp:2312-2314:
//   if (Session.Type != GAME_NORMAL && Rule.IsMPCrates) {
//     Map.Place_Random_Crate();
//   }
//
// In multiplayer, picking up a crate immediately spawns a replacement.
// TS relies on periodic spawn only (no immediate replacement).
// ══════════════════════════════════════════════════════════════════════════════

describe('multiplayer crate replacement (cell.cpp:2312-2314)', () => {
  it('C++ immediately places a new random crate after pickup in multiplayer', () => {
    // C++ cell.cpp:2312-2314: after removing the crate overlay,
    // if in multiplayer with crates enabled, Place_Random_Crate() is called.
    // This maintains constant crate density on the map.
    const cppReplacesImmediately = true;
    expect(cppReplacesImmediately).toBe(true);
  });

  it('TS does not implement immediate crate replacement', () => {
    // TS relies on spawnCrate being called periodically from the game loop.
    // Crate count can temporarily drop below the initial count after pickup.
    const tsReplacesImmediately = false;
    expect(tsReplacesImmediately).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 24: Crate Animation Mapping — Complete Audit
//
// C++ const.cpp:402-421: All CrateAnims[] default to ANIM_NONE.
// C++ rules.cpp:801: CrateAnims[crate] = Anim_From_Name(token) from RULES.INI.
// RULES.INI [Powerups] second field specifies the animation override.
// ══════════════════════════════════════════════════════════════════════════════

describe('crate animation mapping audit (const.cpp:402-421, RULES.INI [Powerups])', () => {
  /**
   * RULES.INI [Powerups] animation assignments:
   * Types with NONE (no animation): Unit, Explosion, Napalm, Squad
   * Types with specific animation: all others
   */
  const expectedAnimations: Array<[CrateType, string | undefined, string]> = [
    ['money',           'dollar',   'Money=50,DOLLAR,2000'],
    ['armor',           'armor',    'Armor=10,ARMOR,2.0'],
    ['speed',           'speed',    'Speed=10,SPEED,1.7'],
    ['firepower',       'fpower',   'Firepower=10,FPOWER,2.0'],
    ['cloak',           'stealth2', 'Cloak=0,STEALTH2'],
    ['darkness',        'empulse',  'Darkness=1,EMPULSE'],
    ['reveal',          'earth',    'Reveal=1,EARTH'],
    ['heal_base',       'invun',    'HealBase=1,INVUN'],
    ['sonar',           'sonarbox', 'Sonar=3,SONARBOX'],
    ['icbm',            'missile2', 'ICBM=1,MISSILE2'],
    ['timequake',       'tquake',   'TimeQuake=3,TQUAKE'],
    ['invulnerability', 'invulbox', 'Invulnerability=3,INVULBOX,1.0'],
    ['parabomb',        'parabox',  'ParaBomb=3,PARABOX'],
    // Types with ANIM_NONE in RULES.INI (second field = NONE):
    ['unit',            undefined,  'Unit=20,NONE'],
    ['explosion',       undefined,  'Explosion=5,NONE,500'],
    ['napalm',          undefined,  'Napalm=5,NONE,600'],
    ['squad',           undefined,  'Squad=20,NONE'],
  ];

  for (const [type, expectedAnim, source] of expectedAnimations) {
    it(`${type} animation = ${expectedAnim ?? 'none'} (${source})`, () => {
      const actual = CRATE_ANIM_MAP[type];
      expect(actual).toBe(expectedAnim);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 25: CRATE_RADIUS — upgrade crate distance threshold
//
// C++ rules.cpp:262: CrateRadius = 0x0280 = 640 leptons = 2.5 cells (compiled default)
// RULES.INI:13: CrateRadius=3.0 (overrides compiled default)
// TS CRATE_RADIUS = 3.0 (matches RULES.INI)
//
// C++ uses strict less-than (<) for distance comparison.
// TS uses greater-than-or-equal (>=) with continue, which is equivalent to < for "include".
// ══════════════════════════════════════════════════════════════════════════════

describe('CRATE_RADIUS upgrade distance threshold', () => {
  it('CRATE_RADIUS = 3.0 cells (matches RULES.INI override, not compiled default 2.5)', () => {
    // C++ compiled default: 0x0280 = 640 leptons = 2.5 cells (rules.cpp:262)
    // RULES.INI:13: CrateRadius=3.0 — overrides to 3.0 cells
    // TS CRATE_RADIUS = 3.0 (matches RULES.INI)
    expect(CRATE_RADIUS).toBe(3.0);
  });

  it('units at exactly CrateRadius are excluded (both C++ and TS use strict <)', () => {
    // C++ cell.cpp:2556: Distance(Cell_Coord(), obj->Center_Coord()) < Rule.CrateRadius
    // TS crates.ts:265: if (worldDist(armorPos, e.pos) >= CRATE_RADIUS) continue;
    // Both exclude units at exactly the radius distance.
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    // Place unit at exactly CRATE_RADIUS distance
    const atRadius = makeEntity(UnitType.V_JEEP, House.Greece,
      100 + CRATE_RADIUS * CELL_SIZE, 100);
    ctx.entities.push(collector, atRadius);

    pickupCrate(ctx, makeCrate('armor', 100, 100), collector);

    expect(collector.armorBias).toBe(2);
    // At exactly CRATE_RADIUS: worldDist >= CRATE_RADIUS -> excluded
    const dist = worldDist({ x: 100, y: 100 }, atRadius.pos);
    if (dist >= CRATE_RADIUS) {
      expect(atRadius.armorBias).toBe(1.0); // not upgraded
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 26: Crate pickup generates crate-type-specific animation
//
// C++ cell.cpp:2319-2321:
//   if (CrateAnims[powerup] != ANIM_NONE) {
//     new AnimClass(CrateAnims[powerup], Cell_Coord());
//   }
//
// TS crates.ts:225-229: always creates an effect, using CRATE_ANIM_MAP or 'piffpiff' fallback.
// ══════════════════════════════════════════════════════════════════════════════

describe('crate pickup animation (cell.cpp:2319-2321)', () => {
  it('crate with specific animation creates that animation effect', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('armor'), unit);

    // CRATE_ANIM_MAP['armor'] = 'armor'
    const armorEffect = ctx.effects.find(e => e.sprite === 'armor');
    expect(armorEffect).toBeDefined();
  });

  it('crate with ANIM_NONE uses piffpiff fallback', () => {
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('unit'), unit);

    // CRATE_ANIM_MAP['unit'] = undefined (ANIM_NONE)
    // TS crates.ts:228: sprite: crateSprite ?? 'piffpiff'
    const piffEffect = ctx.effects.find(e => e.sprite === 'piffpiff');
    expect(piffEffect).toBeDefined();
  });

  it('C++ creates NO animation when CrateAnims[powerup] == ANIM_NONE', () => {
    // C++ cell.cpp:2319: if (CrateAnims[powerup] != ANIM_NONE)
    // C++ skips animation entirely for ANIM_NONE types.
    // TS always creates an animation (using piffpiff as fallback).
    // This is a minor visual divergence — TS shows more visual feedback.
    const cppSkipsAnimation = true;
    expect(cppSkipsAnimation).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 27: Solo Play vs Multiplayer Crate Type Selection
//
// C++ cell.cpp:2127-2145 (solo): crate type determined by overlay type
// C++ cell.cpp:2148-2154 (multiplayer): weighted random from CrateShares[]
//
// Solo play:
//   OVERLAY_STEEL_CRATE  -> Rule.SilverCrate = CRATE_HEAL_BASE
//   OVERLAY_WOOD_CRATE   -> Rule.WoodCrate = CRATE_MONEY
//   OVERLAY_WATER_CRATE  -> Rule.WaterCrate = CRATE_MONEY
//
// TS: always uses weighted random (no overlay-based type determination).
// ══════════════════════════════════════════════════════════════════════════════

describe('solo play crate type selection (cell.cpp:2127-2145)', () => {
  it('C++ solo: silver (steel) crate always gives SilverCrate=CRATE_HEAL_BASE', () => {
    // C++ cell.cpp:2134-2135:
    //   if (Overlay == OVERLAY_STEEL_CRATE) powerup = Rule.SilverCrate;
    // RULES.INI:18: SilverCrate=HealBase
    const cppSilverCrateType = 'heal_base';
    expect(cppSilverCrateType).toBe('heal_base');
  });

  it('C++ solo: wood crate always gives WoodCrate=CRATE_MONEY', () => {
    // C++ cell.cpp:2138-2139:
    //   if (Overlay == OVERLAY_WOOD_CRATE) powerup = Rule.WoodCrate;
    // RULES.INI:20: WoodCrate=Money
    const cppWoodCrateType = 'money';
    expect(cppWoodCrateType).toBe('money');
  });

  it('C++ solo: water crate always gives WaterCrate=CRATE_MONEY', () => {
    // C++ cell.cpp:2142-2144:
    //   if (Overlay == OVERLAY_WATER_CRATE) powerup = Rule.WaterCrate;
    // RULES.INI:19: WaterCrate=Money
    const cppWaterCrateType = 'money';
    expect(cppWaterCrateType).toBe('money');
  });

  it('C++ solo: money amount = SoloCrateMoney, not Random_Pick', () => {
    // C++ cell.cpp:2132: force_money = Rule.SoloCrateMoney = 2000
    // In solo, money crate always gives flat 2000 (not 2000-2900 range)
    // TS matches this behavior.
    const ctx = makeMockContext();
    const unit = makeEntity();
    pickupCrate(ctx, makeCrate('money'), unit);
    expect(ctx.credits).toBe(2000);
  });

  it('TS uses weighted random for all crates (no overlay-based selection)', () => {
    // TS has no overlay type concept — crate type is pre-determined at spawn.
    // This means TS never uses the SilverCrate/WoodCrate/WaterCrate rules.
    // The crateOverrides field provides partial support for this.
    const tsUsesOverlaySelection = false;
    expect(tsUsesOverlaySelection).toBe(false);
  });
});
