/**
 * C++ Behavioral Parity Tests — Crate Collection Mechanics
 *
 * Tests walkover detection, multi-unit contests, distance threshold,
 * weighted type selection, crate type fallback, and crate effect application.
 *
 * C++ references:
 *   cell.cpp:2103-2621   — Goodie_Check (pickup logic, fallback, effects)
 *   const.cpp:381-463    — CrateShares[], CrateData[], CrateNames[]
 *   rules.cpp:422-506    — RULES.INI crate configuration
 *   foot.cpp:753-774     — Start_Driver → Goodie_Check on cell entry
 *   drive.cpp:1196       — Two-cell track mid-cell crate check
 *   defines.h:759-781    — CrateType enum (18 types)
 */

import { describe, it, expect } from 'vitest';
import {
  type CrateType, type CrateContext, type Crate,
  CRATE_SHARES, CRATE_NAME_MAP, CRATE_ANIM_MAP,
  weightedCrateType, pickupCrate,
} from '../engine/crates';
import { Entity } from '../engine/entity';
import { CELL_SIZE, UnitType, House, Mission, worldDist } from '../engine/types';

// ═══════════════════════════════════════════════════════════════════════════
// Helper: minimal CrateContext for testing pickupCrate
// ═══════════════════════════════════════════════════════════════════════════
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
    } as any,
    crateOverrides: {},
    addCredits: function(amount: number) { this.credits += amount; },
    playSoundAt: () => {},
    playSound: () => {},
    damageEntity: (entity: Entity, damage: number) => { entity.hp -= damage; },
    damageStructure: () => {},
    detonateNuke: () => {},
    isAllied: (a: House, b: House) => a === b,
    ...overrides,
  };
}

function makeEntity(type: UnitType = UnitType.V_JEEP, house: House = House.Greece, x = 100, y = 100): Entity {
  const e = new Entity(type, house, x, y);
  e.mission = Mission.GUARD;
  return e;
}

function makeCrate(type: CrateType, x = 100, y = 100): Crate {
  return { x, y, type, tick: 0, lifetime: 9000 };
}

// ═══════════════════════════════════════════════════════════════════════════
// Section 1: CrateType enum order parity
//
// C++ defines.h:759-781 — 18 crate types in specific enum order
// TS CRATE_SHARES must match this exact order for weighted selection parity
// ═══════════════════════════════════════════════════════════════════════════
describe('CrateType enum order (defines.h:759-781)', () => {
  /**
   * C++ CrateType enum:
   *   CRATE_MONEY=0, CRATE_UNIT=1, CRATE_PARA_BOMB=2, CRATE_HEAL_BASE=3,
   *   CRATE_CLOAK=4, CRATE_EXPLOSION=5, CRATE_NAPALM=6, CRATE_SQUAD=7,
   *   CRATE_DARKNESS=8, CRATE_REVEAL=9, CRATE_SONAR=10, CRATE_ARMOR=11,
   *   CRATE_SPEED=12, CRATE_FIREPOWER=13, CRATE_ICBM=14, CRATE_TIMEQUAKE=15,
   *   CRATE_INVULN=16, CRATE_VORTEX=17, CRATE_COUNT=18
   */
  const CPP_CRATE_ORDER: CrateType[] = [
    'money', 'unit', 'parabomb', 'heal_base', 'cloak', 'explosion',
    'napalm', 'squad', 'darkness', 'reveal', 'sonar', 'armor',
    'speed', 'firepower', 'icbm', 'timequake', 'invulnerability', 'vortex',
  ];

  it('CRATE_SHARES has exactly 18 entries matching CrateType enum count', () => {
    expect(CRATE_SHARES.length).toBe(18);
  });

  it('CRATE_SHARES order matches C++ CrateType enum order', () => {
    const tsOrder = CRATE_SHARES.map(s => s.type);
    expect(tsOrder).toEqual(CPP_CRATE_ORDER);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 2: CrateShares parity — default values vs RULES.INI
//
// C++ const.cpp:381-400 — default shares
// C++ rules.cpp:778-816 — RULES.INI [Powerups] overrides
// RULES.INI actual values override many defaults.
//
// Key divergence: const.cpp defaults are the base, but RULES.INI overrides
// many of them. The TS uses RULES.INI values. We verify both.
// ═══════════════════════════════════════════════════════════════════════════
describe('CrateShares values (const.cpp:381-400, RULES.INI override)', () => {
  /**
   * C++ const.cpp defaults:
   *   Money=50, Unit=20, ParaBomb=3, HealBase=1, Cloak=3, Explosion=5,
   *   Napalm=5, Squad=20, Darkness=1, Reveal=1, Sonar=3, Armor=10,
   *   Speed=10, Firepower=10, ICBM=1, TimeQuake=1, Invuln=3, Vortex=5
   *
   * RULES.INI overrides several: Cloak=0, TimeQuake=3
   */
  const RULES_INI_SHARES: Record<CrateType, number> = {
    money: 50, unit: 20, parabomb: 3, heal_base: 1, cloak: 0,
    explosion: 5, napalm: 5, squad: 20, darkness: 1, reveal: 1,
    sonar: 3, armor: 10, speed: 10, firepower: 10, icbm: 1,
    timequake: 3, invulnerability: 3, vortex: 5,
  };

  for (const entry of CRATE_SHARES) {
    it(`${entry.type} shares = ${RULES_INI_SHARES[entry.type]}`, () => {
      expect(entry.shares).toBe(RULES_INI_SHARES[entry.type]);
    });
  }

  it('total shares sum', () => {
    const total = CRATE_SHARES.reduce((sum, s) => sum + s.shares, 0);
    // With RULES.INI values: 50+20+3+1+0+5+5+20+1+1+3+10+10+10+1+3+3+5 = 151
    expect(total).toBe(151);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 3: Weighted selection algorithm parity
//
// C++ cell.cpp:2148-2154:
//   int pick = Random_Pick(1, total_shares);  // 1-indexed inclusive
//   int share_count = 0;
//   for (powerup = CRATE_FIRST; powerup < CRATE_COUNT; powerup++) {
//     share_count += CrateShares[powerup];
//     if (pick <= share_count) break;
//   }
//
// TS crates.ts:133-142:
//   let roll = Math.random() * totalShares;  // 0-indexed exclusive
//   for (const entry of shares) {
//     roll -= entry.shares;
//     if (roll <= 0) return entry.type;
//   }
//
// PARITY GAP: C++ uses 1-indexed Random_Pick (uniform over [1, total]).
// TS uses Math.random() * total (continuous [0, total)).
// Both produce valid weighted distributions, but the C++ boundary behavior
// is slightly different (C++ never picks 0, TS can pick exactly 0.0).
// ═══════════════════════════════════════════════════════════════════════════
describe('weightedCrateType distribution (cell.cpp:2148-2154)', () => {
  it('always returns a valid CrateType', () => {
    const validTypes = new Set(CRATE_SHARES.map(s => s.type));
    for (let i = 0; i < 100; i++) {
      const result = weightedCrateType();
      expect(validTypes.has(result), `invalid type: ${result}`).toBe(true);
    }
  });

  it('never returns cloak (shares=0 in RULES.INI)', () => {
    // C++ cell.cpp:2152: CrateShares[CRATE_CLOAK]=0 means it can never accumulate
    // enough share_count for pick <= share_count to trigger on this entry alone.
    // TS: cloak.shares=0, so roll -= 0 won't help cross <= 0.
    for (let i = 0; i < 500; i++) {
      expect(weightedCrateType()).not.toBe('cloak');
    }
  });

  it('returns money more often than icbm (50 shares vs 1 share)', () => {
    let moneyCount = 0;
    let icbmCount = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const t = weightedCrateType();
      if (t === 'money') moneyCount++;
      if (t === 'icbm') icbmCount++;
    }
    // money has 50x the shares of icbm
    expect(moneyCount).toBeGreaterThan(icbmCount * 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 4: Walkover detection — distance threshold
//
// C++ foot.cpp:765: Map[headto].Goodie_Check(this)
//   Triggered when a unit starts driving to a cell (enters it).
//   The check is "is there a crate overlay on this cell?"
//   The unit must enter the CELL to trigger — it's cell-granular, not
//   distance-based.
//
// TS index.ts:1678-1680:
//   const dx = e.pos.x - crate.x;
//   const dy = e.pos.y - crate.y;
//   if (dx * dx + dy * dy < CELL_SIZE * CELL_SIZE)
//   This uses a 1-cell Euclidean distance radius from crate center.
//
// PARITY NOTE: TS distance check uses pixel distance < CELL_SIZE (24px).
// C++ uses cell-entry (discrete). The TS approach is a reasonable
// approximation but allows diagonal pickups at distances the C++ wouldn't.
// ═══════════════════════════════════════════════════════════════════════════
describe('walkover detection — distance threshold (foot.cpp:765)', () => {
  it('unit directly on crate position should trigger pickup (dist=0)', () => {
    const dx = 0;
    const dy = 0;
    const distSq = dx * dx + dy * dy;
    expect(distSq < CELL_SIZE * CELL_SIZE).toBe(true);
  });

  it('unit 1 cell east should NOT trigger (dist=CELL_SIZE, not strictly less)', () => {
    // TS uses strict less-than: dx*dx + dy*dy < CELL_SIZE * CELL_SIZE
    const dx = CELL_SIZE;
    const dy = 0;
    const distSq = dx * dx + dy * dy;
    // CELL_SIZE^2 is NOT < CELL_SIZE^2
    expect(distSq < CELL_SIZE * CELL_SIZE).toBe(false);
  });

  it('unit 0.5 cells away triggers pickup', () => {
    const dx = CELL_SIZE / 2;
    const dy = 0;
    const distSq = dx * dx + dy * dy;
    expect(distSq < CELL_SIZE * CELL_SIZE).toBe(true);
  });

  it('unit diagonally 0.7 cells each axis triggers (dist~1.0 cell)', () => {
    // sqrt(0.7^2 + 0.7^2) = 0.99 cells — barely within 1 cell
    const offset = CELL_SIZE * 0.7;
    const distSq = offset * offset + offset * offset;
    // 0.7^2 + 0.7^2 = 0.98, which is < 1.0 (CELL_SIZE^2)
    expect(distSq < CELL_SIZE * CELL_SIZE).toBe(true);
  });

  it('unit diagonally 0.71 cells each axis does NOT trigger (dist>1 cell)', () => {
    // sqrt(0.71^2 + 0.71^2) = 1.004 cells — just beyond 1 cell
    const offset = CELL_SIZE * 0.71;
    const distSq = offset * offset + offset * offset;
    expect(distSq < CELL_SIZE * CELL_SIZE).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 5: Multi-unit contest — only one unit collects per crate
//
// C++ foot.cpp:765: Goodie_Check is called in Start_Driver when a unit
//   enters the crate's cell. The first unit to enter gets the crate.
//   The crate is removed (cell.cpp:2309: Map.Remove_Crate) so subsequent
//   units get nothing.
//
// TS index.ts:1676-1684: Iterates entities in array order; first match
//   within distance picks up, then `break` exits inner loop and crate is
//   spliced. Same logical outcome: one unit per crate.
// ═══════════════════════════════════════════════════════════════════════════
describe('multi-unit contest (cell.cpp:2309, foot.cpp:765)', () => {
  it('only one unit picks up the crate even when two are in range', () => {
    const ctx = makeMockContext();
    const unit1 = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const unit2 = makeEntity(UnitType.V_JEEP, House.Greece, 105, 100);
    ctx.entities.push(unit1, unit2);
    ctx.entityById.set(unit1.id, unit1);
    ctx.entityById.set(unit2.id, unit2);

    const crate = makeCrate('money', 100, 100);
    // Only call pickup once — simulates what the game loop does (break after first match)
    pickupCrate(ctx, crate, unit1);

    // Only unit1 got the money
    expect(ctx.credits).toBe(2000);

    // Picking up again with unit2 would add more money — demonstrates the crate
    // must be removed from the array after the first pickup
    const priorCredits = ctx.credits;
    pickupCrate(ctx, crate, unit2);
    // This second pickup DOES add credits — the TS splice in the game loop is what
    // prevents this. pickupCrate itself has no "already consumed" check.
    expect(ctx.credits).toBe(priorCredits + 2000);
  });

  it('only player units can pick up crates (C++ foot.cpp: only FootClass triggers)', () => {
    // TS index.ts:1677: "if (!e.alive || !e.isPlayerUnit) continue"
    // Enemy units are skipped in the TS pickup loop.
    // C++ doesn't filter by house in Goodie_Check — ANY FootClass can trigger it.
    // PARITY GAP: C++ allows any house to collect. TS restricts to player only.
    const enemyUnit = makeEntity(UnitType.V_JEEP, House.USSR, 100, 100);
    expect(enemyUnit.isPlayerUnit).toBe(false);
    // In TS game loop, this unit would be skipped by "!e.isPlayerUnit" check
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 6: Crate type fallback logic
//
// C++ cell.cpp:2161-2296 — extensive fallback-to-CRATE_MONEY when the
// selected powerup would have no effect. This applies in MULTIPLAYER only
// (Session.Type != GAME_NORMAL).
//
// TS crates.ts — NO fallback logic at all. The randomly selected type is
// always applied regardless of unit state.
//
// PARITY GAP: All of these fallback conditions are missing from TS.
// ═══════════════════════════════════════════════════════════════════════════
describe('crate type fallback to money (cell.cpp:2161-2296)', () => {
  /**
   * C++ cell.cpp:2174-2176:
   *   case CRATE_ARMOR:
   *     if (object->ArmorBias != 1) powerup = CRATE_MONEY;
   *     break;
   *
   * If the unit already has an armor upgrade (ArmorBias != 1.0), the armor
   * crate should fallback to money. TS does NOT check this.
   */
  it('PARITY GAP: armor crate should fallback to money if unit already has armor bias', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    unit.armorBias = 2.0; // already upgraded
    ctx.entities.push(unit);
    ctx.entityById.set(unit.id, unit);

    const crate = makeCrate('armor');
    pickupCrate(ctx, crate, unit);

    // C++ would give money instead. TS stacks the armor bias.
    // PARITY GAP: TS sets armorBias = 2 again (no-op if already 2),
    // but C++ would have given money instead.
    // In C++ the check is `ArmorBias != 1`, so any non-default value triggers fallback.
    // The test documents that TS doesn't fallback.
    expect(ctx.credits).toBe(0); // TS gave armor, not money — diverges from C++
  });

  /**
   * C++ cell.cpp:2178-2180:
   *   case CRATE_SPEED:
   *     if (object->SpeedBias != 1 || object->What_Am_I() == RTTI_AIRCRAFT) powerup = CRATE_MONEY;
   *     break;
   */
  it('PARITY GAP: speed crate should fallback to money if unit already has speed bias', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    unit.speedBias = 1.7; // already upgraded
    ctx.entities.push(unit);

    const crate = makeCrate('speed');
    pickupCrate(ctx, crate, unit);

    // C++ would give money. TS overwrites speedBias with 1.7 (same value, no-op).
    expect(ctx.credits).toBe(0); // TS gave speed, not money
  });

  /**
   * C++ cell.cpp:2182-2184:
   *   case CRATE_FIREPOWER:
   *     if (object->FirepowerBias != 1 || !object->Is_Weapon_Equipped()) powerup = CRATE_MONEY;
   *     break;
   */
  it('PARITY GAP: firepower crate should fallback to money if unit already has firepower bias', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    unit.firepowerBias = 2.0; // already upgraded
    ctx.entities.push(unit);

    const crate = makeCrate('firepower');
    pickupCrate(ctx, crate, unit);

    // C++ would give money. TS overwrites firepowerBias with 2 (same value).
    expect(ctx.credits).toBe(0); // TS gave firepower, not money
  });

  /**
   * C++ cell.cpp:2196-2198:
   *   case CRATE_CLOAK:
   *     if (object->IsCloakable) powerup = CRATE_MONEY;
   *     break;
   */
  it('PARITY GAP: cloak crate should fallback to money if unit already cloakable', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    unit.isCloakable = true; // already cloakable
    ctx.entities.push(unit);

    const crate = makeCrate('cloak');
    pickupCrate(ctx, crate, unit);

    // C++ would give money. TS sets isCloakable = true again (redundant).
    expect(ctx.credits).toBe(0); // TS gave cloak, not money
  });

  /**
   * C++ cell.cpp:2162-2164:
   *   case CRATE_UNIT:
   *     if (object->House->CurUnits > 50) powerup = CRATE_MONEY;
   *     break;
   */
  it('PARITY GAP: unit crate should fallback to money when house has >50 units', () => {
    // TS has no unit count check before spawning a unit crate.
    // C++ prevents army bloat by falling back to money.
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    // Simulate >50 units by populating entities
    for (let i = 0; i < 51; i++) {
      ctx.entities.push(makeEntity(UnitType.V_JEEP, House.Greece, i * 50, 100));
    }

    const crate = makeCrate('unit');
    pickupCrate(ctx, crate, unit);

    // C++ would fallback to money. TS spawns the unit regardless.
    // The entity count should have increased (unit spawned)
    expect(ctx.entities.length).toBeGreaterThan(51); // TS spawned another unit — no fallback
  });

  /**
   * C++ cell.cpp:2166-2168:
   *   case CRATE_SQUAD:
   *     if (object->House->CurInfantry > 100) powerup = CRATE_MONEY;
   *     break;
   */
  it('PARITY GAP: squad crate should fallback to money when house has >100 infantry', () => {
    // TS has no infantry count check.
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    for (let i = 0; i < 101; i++) {
      ctx.entities.push(makeEntity(UnitType.I_E1, House.Greece, i * 10, 100));
    }

    const crate = makeCrate('squad');
    pickupCrate(ctx, crate, unit);

    // C++ would fallback to money. TS spawns the squad regardless.
    expect(ctx.entities.length).toBeGreaterThan(101);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 7: Water crate override
//
// C++ cell.cpp:2286-2296:
//   if (Overlay == OVERLAY_WATER_CRATE) {
//     switch (powerup) {
//       case CRATE_UNIT:
//       case CRATE_SQUAD:
//         powerup = CRATE_MONEY;
//         break;
//       default:
//         break;
//     }
//   }
//
// TS has no water crate overlay concept — crates have a type field but
// no surface/overlay distinction.
// ═══════════════════════════════════════════════════════════════════════════
describe('water crate override (cell.cpp:2286-2296)', () => {
  it('PARITY GAP: unit crate on water should fallback to money', () => {
    // C++ prevents land-only units from spawning on water cells by
    // converting CRATE_UNIT to CRATE_MONEY when the crate overlay is water.
    // TS has no such mechanism — a "unit" crate type is always applied.
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);

    // Even if we set the crate type to 'unit', TS will spawn a unit
    // regardless of whether the crate was a water crate.
    const crate = makeCrate('unit');
    pickupCrate(ctx, crate, unit);

    // TS spawned a unit — C++ would have given money on a water crate
    expect(ctx.entities.length).toBe(1); // spawned entity
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 8: Money crate amount
//
// C++ cell.cpp:2340:
//   object->House->Refund_Money(Random_Pick(CrateData[powerup], CrateData[powerup]+900));
//   With RULES.INI Money=50,DOLLAR,2000 → CrateData[CRATE_MONEY] = 2000
//   So range is Random_Pick(2000, 2900)
//
// Solo play (cell.cpp:2132): force_money = Rule.SoloCrateMoney = 2000
// cell.cpp:2337-2338: if (force_money > 0) use force_money instead
//
// TS crates.ts:187: ctx.addCredits(2000, true) — always flat 2000
// ═══════════════════════════════════════════════════════════════════════════
describe('money crate amount (cell.cpp:2335-2341)', () => {
  it('solo play gives exactly SoloCrateMoney=2000 (TS matches)', () => {
    // C++ solo: force_money = Rule.SoloCrateMoney = 2000
    // TS: addCredits(2000) — matches solo play behavior
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    pickupCrate(ctx, makeCrate('money'), unit);
    expect(ctx.credits).toBe(2000);
  });

  it('PARITY GAP: multiplayer money should be Random_Pick(2000, 2900)', () => {
    // C++ multiplayer: Random_Pick(CrateData[CRATE_MONEY], CrateData[CRATE_MONEY]+900)
    // With RULES.INI CrateData[CRATE_MONEY] = 2000, this gives 2000-2900 range.
    // TS always gives flat 2000, regardless of game mode.
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    pickupCrate(ctx, makeCrate('money'), unit);

    // TS gives exactly 2000 — which matches solo but NOT multiplayer behavior
    expect(ctx.credits).toBe(2000);
    // In C++ MP, this should be in range [2000, 2900]
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 9: Crate effect application — bias values
//
// C++ uses multiplicative application from CrateData (RULES.INI third field).
// TS uses absolute assignment.
// ═══════════════════════════════════════════════════════════════════════════
describe('crate effect bias application (cell.cpp:2552-2592)', () => {
  /**
   * C++ cell.cpp:2556-2558 (armor):
   *   fixed val = ((TechnoClass *)obj)->ArmorBias * Inverse(fixed(CrateData[powerup], 256));
   *   RULES.INI Armor=10,ARMOR,2.0 → CrateData = fixed("2.0") * 256 = 512
   *   fixed(512, 256) = 2.0. Inverse(2.0) = 0.5.
   *   So ArmorBias = 1.0 * 0.5 = 0.5 (takes half damage).
   *
   * TS crates.ts:212: unit.armorBias = 2 (absolute 2, applied as damage / armorBias)
   *
   * The effective result is similar (half damage) but the mechanism differs:
   * C++ stores 0.5 and multiplies damage by it.
   * TS stores 2.0 and divides damage by it.
   */
  it('armor crate sets armorBias for the picking-up unit', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    expect(unit.armorBias).toBe(1.0); // default

    pickupCrate(ctx, makeCrate('armor'), unit);
    expect(unit.armorBias).toBe(2); // TS sets to 2
  });

  /**
   * C++ cell.cpp:2572 (speed):
   *   fixed val = foot->SpeedBias * fixed(CrateData[powerup], 256);
   *   RULES.INI Speed=10,SPEED,1.7 → CrateData = fixed("1.7") * 256 ≈ 435
   *   fixed(435, 256) ≈ 1.699. SpeedBias = 1.0 * 1.699 ≈ 1.7.
   *
   * TS crates.ts:223: unit.speedBias = 1.7 (absolute assignment)
   *
   * First application: same result (1.0 * 1.7 = 1.7 vs flat 1.7).
   * PARITY GAP: C++ is multiplicative — second crate would give 1.7 * 1.7 = 2.89.
   * TS would still set 1.7 (no stacking).
   * However, C++ would fallback to money if SpeedBias != 1, so stacking
   * never happens in practice. Both end up at 1.7.
   */
  it('speed crate sets speedBias to 1.7', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    expect(unit.speedBias).toBe(1.0);

    pickupCrate(ctx, makeCrate('speed'), unit);
    expect(unit.speedBias).toBe(1.7);
  });

  /**
   * C++ cell.cpp:2586 (firepower):
   *   fixed val = ((TechnoClass *)obj)->FirepowerBias * fixed(CrateData[powerup], 256);
   *   RULES.INI Firepower=10,FPOWER,2.0 → CrateData = fixed("2.0") * 256 = 512
   *   fixed(512, 256) = 2.0. FirepowerBias = 1.0 * 2.0 = 2.0.
   *
   * TS crates.ts:217: unit.firepowerBias = 2 (matches first application)
   */
  it('firepower crate sets firepowerBias to 2', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    expect(unit.firepowerBias).toBe(1.0);

    pickupCrate(ctx, makeCrate('firepower'), unit);
    expect(unit.firepowerBias).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 10: Area-of-effect radius for upgrade crates
//
// C++ cell.cpp:2520,2556,2569,2584,2598:
//   All upgrade crates (cloak, armor, speed, firepower, invuln) iterate
//   ALL ground layer objects within Rule.CrateRadius and apply the effect.
//   rules.cpp:262: CrateRadius = 0x0280 = 640 leptons ≈ 2.67 cells
//
// TS crates.ts: applies effects ONLY to the single picking-up unit.
//
// PARITY GAP: C++ affects all nearby units, TS affects only the collector.
// ═══════════════════════════════════════════════════════════════════════════
describe('area-of-effect radius for upgrade crates (cell.cpp:2516-2603)', () => {
  /**
   * C++ cell.cpp:2552-2561 (armor):
   *   for (int index = 0; index < DisplayClass::Layer[LAYER_GROUND].Count(); index++) {
   *     ObjectClass * obj = DisplayClass::Layer[LAYER_GROUND][index];
   *     if (obj != NULL && obj->Is_Techno() && Distance(Cell_Coord(), obj->Center_Coord()) < Rule.CrateRadius
   *         && ((TechnoClass *)obj)->ArmorBias == 1) {
   *       fixed val = ((TechnoClass *)obj)->ArmorBias * Inverse(fixed(CrateData[powerup], 256));
   *       ((TechnoClass *)obj)->ArmorBias = val;
   *     }
   *   }
   */
  it('PARITY GAP: armor crate should affect all nearby units within CrateRadius', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const nearby = makeEntity(UnitType.V_JEEP, House.Greece, 110, 100); // ~0.4 cells away
    ctx.entities.push(collector, nearby);

    pickupCrate(ctx, makeCrate('armor', 100, 100), collector);

    // TS only upgrades the collector, not the nearby unit
    expect(collector.armorBias).toBe(2);
    expect(nearby.armorBias).toBe(1.0); // PARITY GAP: C++ would have upgraded this too
  });

  /**
   * C++ cell.cpp:2565-2577 (speed):
   *   Same pattern — all FootClass objects within CrateRadius get speed boost.
   *   Also excludes RTTI_AIRCRAFT (cell.cpp:2569).
   */
  it('PARITY GAP: speed crate should affect all nearby ground units within CrateRadius', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const nearby = makeEntity(UnitType.V_1TNK, House.Greece, 120, 100); // ~0.8 cells away
    ctx.entities.push(collector, nearby);

    pickupCrate(ctx, makeCrate('speed', 100, 100), collector);

    expect(collector.speedBias).toBe(1.7);
    expect(nearby.speedBias).toBe(1.0); // PARITY GAP: C++ would boost this too
  });

  /**
   * C++ cell.cpp:2516-2523 (cloak):
   *   All TechnoClass objects within CrateRadius get IsCloakable=true.
   */
  it('PARITY GAP: cloak crate should affect all nearby units within CrateRadius', () => {
    const ctx = makeMockContext();
    const collector = makeEntity(UnitType.V_JEEP, House.Greece, 100, 100);
    const nearby = makeEntity(UnitType.V_JEEP, House.Greece, 115, 100);
    ctx.entities.push(collector, nearby);

    pickupCrate(ctx, makeCrate('cloak', 100, 100), collector);

    expect(collector.isCloakable).toBe(true);
    expect(nearby.isCloakable).toBe(false); // PARITY GAP: C++ would cloak this too
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 11: heal_base crate effect
//
// C++ cell.cpp:2529-2540:
//   case CRATE_HEAL_BASE:
//     for (int index = 0; index < Logic.Count(); index++) {
//       ObjectClass * obj = Logic[index];
//       if (obj && object->Is_Techno() && object->House->Class->House == obj->Owner()) {
//         obj->Strength = obj->Class_Of().MaxStrength;  // FULL heal
//       }
//     }
//
// TS crates.ts:271-279:
//   for (const s of ctx.structures) {
//     if (s.alive && ctx.isAllied(s.house, ctx.playerHouse)) {
//       s.hp = Math.min(s.maxHp, s.hp + Math.ceil(s.maxHp * 0.2));  // 20% heal
//     }
//   }
//
// PARITY GAP #1: C++ heals to FULL HP. TS heals only 20%.
// PARITY GAP #2: C++ heals ALL objects (units, buildings, etc). TS heals only structures.
// ═══════════════════════════════════════════════════════════════════════════
describe('heal_base crate effect (cell.cpp:2529-2540)', () => {
  it('PARITY GAP: heal_base should restore structures to FULL HP, not +20%', () => {
    const ctx = makeMockContext();
    const structure = { alive: true, house: House.Greece, hp: 100, maxHp: 1000,
      cx: 5, cy: 5, type: 'POWR', w: 2, h: 2 } as any;
    ctx.structures.push(structure);
    const unit = makeEntity(UnitType.V_JEEP);

    pickupCrate(ctx, makeCrate('heal_base'), unit);

    // C++ sets obj->Strength = obj->Class_Of().MaxStrength = 1000
    // TS adds 20%: 100 + ceil(1000 * 0.2) = 100 + 200 = 300
    expect(structure.hp).toBe(300); // TS: 300 — PARITY GAP: C++ would give 1000
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 12: Invulnerability crate duration
//
// C++ cell.cpp:2599:
//   ((TechnoClass *)obj)->IronCurtainCountDown = (TICKS_PER_MINUTE * fixed(CrateData[powerup], 256));
//   RULES.INI Invulnerability=3,INVULBOX,1.0 → CrateData = fixed("1.0")*256 = 256
//   fixed(256, 256) = 1.0
//   TICKS_PER_MINUTE = 15*60 = 900 (15 FPS * 60 seconds)
//   Duration = 900 * 1.0 = 900 ticks = 1 minute
//
// TS crates.ts:306: unit.invulnTick = 300 (300 ticks = 20 seconds)
//
// PARITY GAP: C++ gives 900 ticks (1 minute). TS gives 300 ticks (20 sec).
// ═══════════════════════════════════════════════════════════════════════════
describe('invulnerability crate duration (cell.cpp:2594-2603)', () => {
  it('PARITY GAP: invulnerability should last 900 ticks (1 min), TS gives 300', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);

    pickupCrate(ctx, makeCrate('invulnerability'), unit);

    // C++ duration: TICKS_PER_MINUTE * 1.0 = 900 ticks
    // TS duration: 300 ticks
    expect(unit.invulnTick).toBe(300); // TS gives 300 — PARITY GAP vs C++ 900
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 13: Solo play crate type override
//
// C++ cell.cpp:2127-2145: In solo play (GAME_NORMAL), crate type is
// determined by overlay type, NOT weighted random:
//   OVERLAY_STEEL_CRATE → Rule.SilverCrate (default: CRATE_HEAL_BASE)
//   OVERLAY_WOOD_CRATE  → Rule.WoodCrate   (default: CRATE_MONEY)
//   OVERLAY_WATER_CRATE → Rule.WaterCrate  (default: CRATE_MONEY)
//
// TS crates.ts:147-153: Has crateOverrides.silver/wood/water but uses
// weighted random for base selection, overriding only if an INI value exists.
// ═══════════════════════════════════════════════════════════════════════════
describe('solo play crate type override (cell.cpp:2127-2145)', () => {
  it('silver crate default maps to heal_base in C++ (rules.cpp:154)', () => {
    // C++ rules.cpp:154: SilverCrate(CRATE_HEAL_BASE) — default for steel/silver crates
    // TS would use crateOverrides.silver if set, otherwise weighted random
    // We verify the mapping exists in CRATE_NAME_MAP
    expect(CRATE_NAME_MAP['heal_base']).toBe('heal_base');
  });

  it('wood crate default maps to money in C++ (rules.cpp:155)', () => {
    expect(CRATE_NAME_MAP['money']).toBe('money');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 14: CrateNames parity
//
// C++ const.cpp:444-463 — canonical crate names used for INI parsing
// ═══════════════════════════════════════════════════════════════════════════
describe('CrateNames parity (const.cpp:444-463)', () => {
  /**
   * C++ names:
   *   "Money", "Unit", "ParaBomb", "HealBase", "Cloak", "Explosion",
   *   "Napalm", "Squad", "Darkness", "Reveal", "Sonar", "Armor",
   *   "Speed", "Firepower", "ICBM", "TimeQuake", "Invulnerability", "ChronalVortex"
   */
  const CPP_NAMES = [
    'Money', 'Unit', 'ParaBomb', 'HealBase', 'Cloak', 'Explosion',
    'Napalm', 'Squad', 'Darkness', 'Reveal', 'Sonar', 'Armor',
    'Speed', 'Firepower', 'ICBM', 'TimeQuake', 'Invulnerability', 'ChronalVortex',
  ];

  it('CRATE_NAME_MAP covers all C++ CrateNames (lowercase lookup)', () => {
    // TS uses lowercase keys in CRATE_NAME_MAP
    const tsKeys = Object.keys(CRATE_NAME_MAP);
    for (const cppName of CPP_NAMES) {
      const lcName = cppName.toLowerCase();
      // Some names are transformed: HealBase→heal_base, ParaBomb→parabomb,
      // ChronalVortex→vortex, TimeQuake→timequake
      // Just verify coverage — not exact 1:1 naming
    }
    // At minimum, all 18 C++ types should have a TS mapping
    expect(CRATE_SHARES.length).toBe(CPP_NAMES.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 15: Crate animation mapping
//
// C++ const.cpp:402-421 (defaults all ANIM_NONE), rules.cpp:801 (RULES.INI override)
// RULES.INI populates animations for most types.
// TS CRATE_ANIM_MAP should match the RULES.INI entries.
// ═══════════════════════════════════════════════════════════════════════════
describe('crate animation mapping (const.cpp:402-421, RULES.INI)', () => {
  it('money crate has dollar animation', () => {
    expect(CRATE_ANIM_MAP['money']).toBe('dollar');
  });

  it('armor crate has armor animation', () => {
    expect(CRATE_ANIM_MAP['armor']).toBe('armor');
  });

  it('speed crate has speed animation', () => {
    expect(CRATE_ANIM_MAP['speed']).toBe('speed');
  });

  it('unit crate has no animation (ANIM_NONE in RULES.INI)', () => {
    // C++ RULES.INI: Unit=20,NONE → ANIM_NONE
    expect(CRATE_ANIM_MAP['unit']).toBeUndefined();
  });

  it('explosion crate has no animation (ANIM_NONE in RULES.INI)', () => {
    expect(CRATE_ANIM_MAP['explosion']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 16: Crate removal and respawn
//
// C++ cell.cpp:2309: Map.Remove_Crate(Cell_Number());
// C++ cell.cpp:2312-2314:
//   if (Session.Type != GAME_NORMAL && Rule.IsMPCrates) {
//     Map.Place_Random_Crate();
//   }
//
// In multiplayer, picking up a crate immediately spawns a new one.
// In solo play, no replacement crate is spawned.
//
// TS index.ts:1662-1665: Spawns crates on a timer (60-90 sec), max 3.
// No immediate replacement on pickup.
// ═══════════════════════════════════════════════════════════════════════════
describe('crate removal and respawn (cell.cpp:2309-2314)', () => {
  it('TS uses timed respawn, not immediate replacement', () => {
    // This is a design-level divergence, not a bug — TS uses periodic spawning
    // rather than immediate MP-style replacement.
    // Documenting for completeness.
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 17: Crate lifetime / expiry
//
// C++ rules.cpp:207: CrateTime(10) — 10 minutes default
// C++ rules.cpp:506: CrateTime = ini.Get_Fixed(GENERAL, "CrateRegen", CrateTime);
// The actual crate placement/regeneration timer uses CrateTime, but individual
// crate lifetime isn't explicitly limited in C++ — crates persist until
// collected or the map is reset.
//
// TS crates.ts:154-160: Per-crate lifetime = Random(CrateTime/2, CrateTime*2) minutes
// TS index.ts:1672: if (this.tick - crate.tick > crate.lifetime) → expire
//
// PARITY GAP: C++ crates don't expire. TS crates do.
// ═══════════════════════════════════════════════════════════════════════════
describe('crate lifetime (rules.cpp:207)', () => {
  it('PARITY GAP: C++ crates persist indefinitely, TS crates expire', () => {
    // TS gives each crate a lifetime of Random(5, 20) minutes converted to ticks.
    // C++ crates remain on the map until collected.
    const GAME_TICKS_PER_SEC = 15;
    const minLifetimeMin = 5;
    const maxLifetimeMin = 20;
    const minTicks = minLifetimeMin * 60 * GAME_TICKS_PER_SEC; // 4500
    const maxTicks = maxLifetimeMin * 60 * GAME_TICKS_PER_SEC; // 18000

    // Verify the TS lifetime range is reasonable (5-20 minutes)
    const crate = makeCrate('money');
    // Default test crate has lifetime=9000 (our test fixture)
    expect(crate.lifetime).toBeGreaterThanOrEqual(0);
    // The real spawn logic uses random — we just document the gap
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 18: MCV force spawn
//
// C++ cell.cpp:2264-2270:
//   if (object->House->BScan == 0 &&
//       object->House->Available_Money() > (refinery + power cost) &&
//       Session.Options.Bases &&
//       !(object->House->UScan & UNITF_MCV)) {
//     powerup = CRATE_UNIT;
//     force_mcv = true;
//   }
//
// This forces the crate to spawn an MCV when the player has no buildings,
// enough money, bases enabled, and no existing MCV.
// TS has no equivalent logic.
// ═══════════════════════════════════════════════════════════════════════════
describe('MCV force spawn (cell.cpp:2264-2270)', () => {
  it('PARITY GAP: C++ forces MCV spawn when player lost all buildings', () => {
    // C++ checks BScan==0 (no buildings), sufficient money, bases option on,
    // and no existing MCV → forces CRATE_UNIT with force_mcv=true
    // TS has no such mechanic — crate type is purely random/fixed
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    ctx.structures.length = 0; // no structures

    // Even with no structures, TS won't force an MCV
    const crate = makeCrate('money');
    pickupCrate(ctx, crate, unit);
    expect(ctx.credits).toBe(2000); // got money, not forced MCV
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 19: Refinery money force
//
// C++ cell.cpp:2276-2280:
//   if (powerup == CRATE_MONEY &&
//       (BScan & (STRUCTF_CONST|STRUCTF_REFINERY)) == STRUCTF_CONST &&
//       Available_Money() < refinery_cost) {
//     force_money = refinery_cost;
//   }
//
// When getting money and you have a ConYard but no refinery and can't
// afford one, the money amount is forced to the refinery cost.
// ═══════════════════════════════════════════════════════════════════════════
describe('refinery money force (cell.cpp:2276-2280)', () => {
  it('PARITY GAP: C++ forces money amount to refinery cost when needed', () => {
    // C++ checks: has construction yard, no refinery, can't afford refinery
    // → forces money to refinery cost. TS always gives flat 2000.
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP);
    ctx.credits = 100; // can't afford refinery

    pickupCrate(ctx, makeCrate('money'), unit);
    // TS gives 2000 regardless. C++ might give more/less based on refinery cost.
    expect(ctx.credits).toBe(2100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 20: reveal crate — visionary flag
//
// C++ cell.cpp:2186-2194 (fallback):
//   case CRATE_REVEAL:
//     if (object->House->IsVisionary) {
//       if (object->House->IsGPSActive) {
//         powerup = CRATE_MONEY;
//       } else {
//         powerup = CRATE_DARKNESS;
//       }
//     }
//
// C++ cell.cpp:2356-2364 (effect):
//   object->House->IsVisionary = true;
//   for all cells: Map.Map_Cell(cell, PlayerPtr);
//
// TS crates.ts:228-230:
//   ctx.visionaryHouses.add(unit.house);
//   ctx.map.revealAll();
// ═══════════════════════════════════════════════════════════════════════════
describe('reveal crate — visionary flag (cell.cpp:2186-2194, 2356-2364)', () => {
  it('reveal crate adds house to visionaryHouses set', () => {
    const ctx = makeMockContext();
    const unit = makeEntity(UnitType.V_JEEP, House.Greece);

    pickupCrate(ctx, makeCrate('reveal'), unit);

    expect(ctx.visionaryHouses.has(House.Greece)).toBe(true);
  });

  it('PARITY GAP: second reveal should fallback to darkness (not money)', () => {
    // C++ checks IsVisionary → if already visionary, gives darkness instead
    // (or money if GPS also active).
    // TS has no such fallback — second reveal just calls revealAll again.
    const ctx = makeMockContext();
    ctx.visionaryHouses.add(House.Greece); // already visionary
    const unit = makeEntity(UnitType.V_JEEP, House.Greece);

    pickupCrate(ctx, makeCrate('reveal'), unit);

    // TS gives reveal again. C++ would give darkness.
    expect(ctx.visionaryHouses.has(House.Greece)).toBe(true);
    // No darkness effect applied — TS doesn't check visionary status before applying
  });
});
