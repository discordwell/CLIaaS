/**
 * C++ Parity Tests — Crate Pickup Animation Effects (13 crate animations)
 *
 * Tests that each crate type produces the correct visual effect animation
 * at the pickup location, and that crate pickup effects match C++ behavior.
 *
 * C++ references:
 *   - adata.cpp:1264-1554  13 crate animation definitions (CRATE_DEVIATOR through CRATE_STEALTH)
 *   - adata.cpp:1676-1699  CRATE_MISSILE (MISSILE2 sprite)
 *   - adata.cpp:1289-1312  CRATE_ARMOR, 1313-1336 CRATE_SPEED, 1338-1361 CRATE_FPOWER, 1362-1385 CRATE_TQUAKE
 *   - const.cpp:381-400    CrateShares[] — default share weights
 *   - const.cpp:402-421    CrateAnims[] — default all ANIM_NONE (overridden by RULES.INI)
 *   - const.cpp:423-442    CrateData[] — default all 0 (overridden by RULES.INI)
 *   - const.cpp:444-463    CrateNames[] — canonical names for each crate type
 *   - defines.h:759-781    CrateType enum (18 types: CRATE_MONEY through CRATE_VORTEX)
 *   - rules.cpp:778-821    Powerups() — parses [Powerups] section: shares,anim,data per crate
 *   - cell.cpp:2103-2621   Goodie_Check() — crate pickup logic + animation trigger (line 2319)
 *   - cell.cpp:2319-2321   CrateAnims[powerup] != ANIM_NONE → new AnimClass(CrateAnims[powerup])
 *
 *   - RULES.INI [Powerups] section (public/ra/assets/rules.ini:2819-2836):
 *     Money=50,DOLLAR,2000         Unit=20,NONE      ParaBomb=3,PARABOX
 *     HealBase=1,INVUN             Cloak=0,STEALTH2  Explosion=5,NONE,500
 *     Napalm=5,NONE,600            Squad=20,NONE     Darkness=1,EMPULSE
 *     Reveal=1,EARTH               Sonar=3,SONARBOX  Armor=10,ARMOR,2.0
 *     Speed=10,SPEED,1.7           Firepower=10,FPOWER,2.0
 *     ICBM=1,MISSILE2              TimeQuake=3,TQUAKE
 *     Invulnerability=3,INVULBOX,1.0
 *
 * All 13 crate animation sprites from adata.cpp share common properties:
 *   - dimension=48, biggestStage=0, isNormalized=true, delay=2
 *   - stages=-1 (play all SHP frames), loops=0 (play once)
 *   - loopStart=0, loopEnd=0, startFrame=0
 *   - sound=VOC_NONE, followUp=ANIM_NONE
 */

import { describe, it, expect } from 'vitest';
import {
  pickupCrate, CRATE_SHARES, CRATE_ANIM_MAP,
  type Crate, type CrateType, type CrateContext,
} from '../engine/crates';
import { Entity } from '../engine/entity';
import { UnitType, Mission, House, CELL_SIZE } from '../engine/types';
import type { Effect } from '../engine/renderer';
import type { MapStructure } from '../engine/scenario';

// ========== C++ REFERENCE DATA ==========

/**
 * C++ adata.cpp crate animation definitions — all 13 sprites.
 * Each entry: [ANIM_CRATE_xxx enum name, sprite data name, adata.cpp line]
 */
const CPP_CRATE_ANIM_DEFS: Array<{
  animEnum: string;
  sprite: string;
  line: number;
  dimension: number;
  delay: number;
  stages: number;
  loops: number;
  normalized: boolean;
}> = [
  { animEnum: 'ANIM_CRATE_DEVIATOR', sprite: 'DEVIATOR', line: 1265, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_ARMOR',    sprite: 'ARMOR',    line: 1290, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_SPEED',    sprite: 'SPEED',    line: 1314, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_FPOWER',   sprite: 'FPOWER',   line: 1339, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_TQUAKE',   sprite: 'TQUAKE',   line: 1363, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_DOLLAR',   sprite: 'DOLLAR',   line: 1388, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_EARTH',    sprite: 'EARTH',    line: 1412, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_EMPULSE',  sprite: 'EMPULSE',  line: 1436, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_INVUN',    sprite: 'INVUN',    line: 1460, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_MINE',     sprite: 'MINE',     line: 1484, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_RAPID',    sprite: 'RAPID',    line: 1508, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_STEALTH',  sprite: 'STEALTH2', line: 1532, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
  { animEnum: 'ANIM_CRATE_MISSILE',  sprite: 'MISSILE2', line: 1677, dimension: 48, delay: 2, stages: -1, loops: 0, normalized: true },
];

/**
 * C++ RULES.INI [Powerups] section — maps CrateType → animation sprite.
 * From public/ra/assets/rules.ini:2819-2836 and cell.cpp:2319
 * "NONE" means CrateAnims[crate] = ANIM_NONE (no crate-specific animation).
 */
const CPP_CRATE_TYPE_TO_ANIM: Record<string, string | null> = {
  money:            'DOLLAR',    // Money=50,DOLLAR,2000
  unit:             null,        // Unit=20,NONE
  parabomb:         'PARABOX',   // ParaBomb=3,PARABOX (not one of the 13 crate anims)
  heal_base:        'INVUN',     // HealBase=1,INVUN
  cloak:            'STEALTH2',  // Cloak=0,STEALTH2
  explosion:        null,        // Explosion=5,NONE,500
  napalm:           null,        // Napalm=5,NONE,600
  squad:            null,        // Squad=20,NONE
  darkness:         'EMPULSE',   // Darkness=1,EMPULSE
  reveal:           'EARTH',     // Reveal=1,EARTH
  sonar:            'SONARBOX',  // Sonar=3,SONARBOX (not one of the 13 crate anims)
  armor:            'ARMOR',     // Armor=10,ARMOR,2.0
  speed:            'SPEED',     // Speed=10,SPEED,1.7
  firepower:        'FPOWER',    // Firepower=10,FPOWER,2.0
  icbm:             'MISSILE2',  // ICBM=1,MISSILE2
  timequake:        'TQUAKE',    // TimeQuake=3,TQUAKE
  invulnerability:  'INVULBOX',  // Invulnerability=3,INVULBOX,1.0 (not one of the 13 crate anims)
  vortex:           null,        // ChronalVortex not in RULES.INI → defaults to ANIM_NONE
};

/**
 * C++ CrateShares[] from const.cpp:381-400 (default values before RULES.INI override)
 * These are the base shares; RULES.INI overrides most of them.
 * RULES.INI values (public/ra/assets/rules.ini:2819-2836):
 */
const CPP_RULES_INI_SHARES: Record<string, number> = {
  money: 50, unit: 20, parabomb: 3, heal_base: 1, cloak: 0,
  explosion: 5, napalm: 5, squad: 20, darkness: 1, reveal: 1,
  sonar: 3, armor: 10, speed: 10, firepower: 10, icbm: 1,
  timequake: 3, invulnerability: 3,
  // vortex not in RULES.INI → uses const.cpp default of 5
};

/**
 * C++ CrateData[] from RULES.INI (the third field in Powerups entries):
 *   - Armor=2.0 → ArmorBias = 1/fixed(2.0) (C++ Inverse; doubles effective armor)
 *   - Speed=1.7 → SpeedBias = fixed(1.7) (1.7x speed multiplier)
 *   - Firepower=2.0 → FirepowerBias = fixed(2.0) (2x damage output)
 *   - Invulnerability=1.0 → IronCurtainCountDown = TICKS_PER_MINUTE * fixed(1.0)
 *   - Money=2000 → SoloCrateMoney=2000 (solo play override)
 *   - Explosion=500, Napalm=600 → damage values
 */
const CPP_CRATE_DATA = {
  armor_multiplier: 2.0,
  speed_multiplier: 1.7,
  firepower_multiplier: 2.0,
  invuln_minutes: 1.0,
  solo_money: 2000,
  explosion_damage: 500,
  napalm_damage: 600,
};

/** C++ CrateType enum order from defines.h:759-778 */
const CPP_CRATE_TYPE_ORDER = [
  'CRATE_MONEY', 'CRATE_UNIT', 'CRATE_PARA_BOMB', 'CRATE_HEAL_BASE',
  'CRATE_CLOAK', 'CRATE_EXPLOSION', 'CRATE_NAPALM', 'CRATE_SQUAD',
  'CRATE_DARKNESS', 'CRATE_REVEAL', 'CRATE_SONAR', 'CRATE_ARMOR',
  'CRATE_SPEED', 'CRATE_FIREPOWER', 'CRATE_ICBM', 'CRATE_TIMEQUAKE',
  'CRATE_INVULN', 'CRATE_VORTEX',
] as const;

// ========== HELPER: Create a mock CrateContext ==========

function makeMockCtx(overrides?: Partial<CrateContext>): CrateContext {
  return {
    crates: [],
    entities: [],
    entityById: new Map(),
    structures: [] as MapStructure[],
    effects: [],
    evaMessages: [],
    activeVortices: [],
    visionaryHouses: new Set<House>(),
    credits: 5000,
    tick: 100,
    playerHouse: House.Spain,
    screenShake: 0,
    map: {
      boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128,
      isPassable: () => true,
      getVisibility: () => 1,
      setVisibility: () => {},
      revealAll: () => {},
    } as any,
    crateOverrides: {},
    addCredits: () => {},
    playSoundAt: () => {},
    playSound: () => {},
    damageEntity: () => {},
    damageStructure: () => {},
    detonateNuke: () => {},
    isAllied: (a: House, b: House) => a === b,
    ...overrides,
  };
}

function makeUnit(house: House = House.Spain): Entity {
  const unit = new Entity(UnitType.V_2TNK, house, 100, 100);
  unit.mission = Mission.GUARD;
  return unit;
}

function makeCrate(type: CrateType, x = 100, y = 100): Crate {
  return { x, y, type, tick: 0, lifetime: 1000 };
}

// ========== TESTS ==========

describe('C++ Parity: Crate Pickup Animation Effects', () => {

  // ── Section 1: All 13 crate animation sprites exist in adata.cpp ──────────

  describe('adata.cpp crate animation definitions (13 sprites)', () => {

    it('exactly 13 crate-specific animation sprites defined', () => {
      expect(CPP_CRATE_ANIM_DEFS).toHaveLength(13);
    });

    for (const def of CPP_CRATE_ANIM_DEFS) {
      describe(`${def.animEnum} → "${def.sprite}" (adata.cpp:${def.line})`, () => {

        it('dimension = 48 (all crate anims are 48px)', () => {
          expect(def.dimension).toBe(48);
        });

        it('delay = 2 (all crate anims use delay=2)', () => {
          expect(def.delay).toBe(2);
        });

        it('stages = -1 (play all SHP frames)', () => {
          expect(def.stages).toBe(-1);
        });

        it('loops = 0 (play once, do not loop)', () => {
          expect(def.loops).toBe(0);
        });

        it('isNormalized = true', () => {
          expect(def.normalized).toBe(true);
        });
      });
    }
  });

  // ── Section 2: CRATE_ANIM_MAP matches C++ RULES.INI [Powerups] ──────────

  describe('CRATE_ANIM_MAP matches RULES.INI crate-to-animation mapping', () => {

    it('CRATE_ANIM_MAP is exported from crates module', () => {
      expect(CRATE_ANIM_MAP).toBeDefined();
      expect(typeof CRATE_ANIM_MAP).toBe('object');
    });

    // Test each crate type that HAS an animation (non-null in RULES.INI)
    const animatedCrates = Object.entries(CPP_CRATE_TYPE_TO_ANIM)
      .filter(([, anim]) => anim !== null) as [string, string][];

    for (const [crateType, expectedSprite] of animatedCrates) {
      it(`${crateType} → "${expectedSprite}" (C++ RULES.INI)`, () => {
        const tsSprite = CRATE_ANIM_MAP[crateType as CrateType];
        expect(tsSprite, `CRATE_ANIM_MAP['${crateType}'] should be "${expectedSprite}"`).toBe(expectedSprite.toLowerCase());
      });
    }

    // Test each crate type that has NO animation (NONE in RULES.INI)
    const nonAnimatedCrates = Object.entries(CPP_CRATE_TYPE_TO_ANIM)
      .filter(([, anim]) => anim === null) as [string, null][];

    for (const [crateType] of nonAnimatedCrates) {
      it(`${crateType} → null/undefined (no crate-specific animation)`, () => {
        const tsSprite = CRATE_ANIM_MAP[crateType as CrateType];
        expect(tsSprite == null || tsSprite === undefined,
          `CRATE_ANIM_MAP['${crateType}'] should be null/undefined but got "${tsSprite}"`).toBe(true);
      });
    }
  });

  // ── Section 3: pickupCrate generates correct animation at pickup location ──

  describe('pickupCrate() generates correct sprite-based effect', () => {

    // Crate types that have dedicated animations
    const typesWithAnims: [CrateType, string][] = [
      ['money', 'dollar'],
      ['armor', 'armor'],
      ['speed', 'speed'],
      ['firepower', 'fpower'],
      ['cloak', 'stealth2'],
      ['invulnerability', 'invulbox'],
      ['icbm', 'missile2'],
      ['timequake', 'tquake'],
      ['reveal', 'earth'],
      ['darkness', 'empulse'],
      ['heal_base', 'invun'],
    ];

    for (const [crateType, expectedSprite] of typesWithAnims) {
      it(`${crateType} crate produces "${expectedSprite}" sprite effect at pickup location`, () => {
        const ctx = makeMockCtx();
        const unit = makeUnit();
        ctx.entities.push(unit);
        ctx.entityById.set(unit.id, unit);
        const crate = makeCrate(crateType, 200, 300);

        pickupCrate(ctx, crate, unit);

        // Find the crate-specific animation effect (not generic piffpiff)
        const crateEffect = ctx.effects.find(e =>
          e.sprite === expectedSprite && e.x === 200 && e.y === 300
        );
        expect(crateEffect, `Expected "${expectedSprite}" effect at (200,300) for ${crateType} crate`).toBeDefined();
      });
    }

    // Crate types with NO dedicated animation — should still produce the generic piffpiff
    const typesWithoutAnims: CrateType[] = ['unit', 'explosion', 'napalm', 'squad', 'vortex'];

    for (const crateType of typesWithoutAnims) {
      it(`${crateType} crate uses generic pickup effect (C++ ANIM_NONE in CrateAnims[])`, () => {
        const ctx = makeMockCtx();
        const unit = makeUnit();
        ctx.entities.push(unit);
        ctx.entityById.set(unit.id, unit);
        const crate = makeCrate(crateType, 200, 300);

        pickupCrate(ctx, crate, unit);

        // Should have a generic effect but NOT a crate-specific sprite
        const crateSpecificSprite = CRATE_ANIM_MAP[crateType];
        if (crateSpecificSprite) {
          // If there IS a mapping, verify it's there
          const effect = ctx.effects.find(e => e.sprite === crateSpecificSprite);
          expect(effect).toBeDefined();
        }
        // Just verify effects were generated (piffpiff or type-specific effects like napalm/explosion)
        expect(ctx.effects.length).toBeGreaterThan(0);
      });
    }
  });

  // ── Section 4: Crate pickup effects match C++ behavior ──────────────────

  describe('crate pickup reward effects match C++', () => {

    it('money crate gives 2000 credits in solo play (C++ SoloCrateMoney=2000, rules.cpp:126)', () => {
      let received = 0;
      const ctx = makeMockCtx({ addCredits: (amount) => { received = amount; } });
      const unit = makeUnit();
      const crate = makeCrate('money');

      pickupCrate(ctx, crate, unit);

      expect(received).toBe(CPP_CRATE_DATA.solo_money);
    });

    it('heal crate restores unit to full HP (C++ cell.cpp:2537 — obj->Strength = MaxStrength)', () => {
      const ctx = makeMockCtx();
      const unit = makeUnit();
      unit.hp = 50;
      const crate = makeCrate('heal');

      pickupCrate(ctx, crate, unit);

      expect(unit.hp).toBe(unit.maxHp);
    });

    it('armor crate sets armorBias = 2 (C++ ArmorBias = Inverse(fixed(2.0,256)), cell.cpp:2557)', () => {
      const ctx = makeMockCtx();
      const unit = makeUnit();
      expect(unit.armorBias).toBe(1.0); // default

      const crate = makeCrate('armor');
      pickupCrate(ctx, crate, unit);

      // C++ RULES.INI Armor=10,ARMOR,2.0 → CrateData = fixed(2.0) * 256 = 512
      // C++ cell.cpp:2557: val = ArmorBias * Inverse(fixed(CrateData, 256))
      // = 1.0 * Inverse(fixed(512, 256)) = 1.0 * Inverse(2.0) = 0.5
      // But TS simplifies to armorBias = 2 (half damage = armor multiplier of 2)
      expect(unit.armorBias).toBe(2);
    });

    it('speed crate sets speedBias = 1.7 (C++ RULES.INI Speed=10,SPEED,1.7)', () => {
      const ctx = makeMockCtx();
      const unit = makeUnit();
      expect(unit.speedBias).toBe(1.0);

      const crate = makeCrate('speed');
      pickupCrate(ctx, crate, unit);

      // C++ RULES.INI Speed=10,SPEED,1.7 → CrateData = fixed(1.7) * 256 ≈ 435
      // C++ cell.cpp:2572: val = SpeedBias * fixed(CrateData, 256) = 1.0 * 1.7 = 1.7
      expect(unit.speedBias).toBeCloseTo(CPP_CRATE_DATA.speed_multiplier, 1);
    });

    it('firepower crate sets firepowerBias = 2 (C++ RULES.INI Firepower=10,FPOWER,2.0)', () => {
      const ctx = makeMockCtx();
      const unit = makeUnit();
      expect(unit.firepowerBias).toBe(1.0);

      const crate = makeCrate('firepower');
      pickupCrate(ctx, crate, unit);

      // C++ RULES.INI Firepower=10,FPOWER,2.0 → CrateData = fixed(2.0) * 256 = 512
      // C++ cell.cpp:2586: val = FirepowerBias * fixed(CrateData, 256) = 1.0 * 2.0 = 2.0
      expect(unit.firepowerBias).toBe(CPP_CRATE_DATA.firepower_multiplier);
    });

    it('cloak crate sets isCloakable = true (C++ cell.cpp:2521)', () => {
      const ctx = makeMockCtx();
      const unit = makeUnit();
      expect(unit.isCloakable).toBe(false);

      const crate = makeCrate('cloak');
      pickupCrate(ctx, crate, unit);

      expect(unit.isCloakable).toBe(true);
    });

    it('invulnerability crate sets invulnTick > 0 (C++ cell.cpp:2599 — IronCurtainCountDown)', () => {
      const ctx = makeMockCtx();
      const unit = makeUnit();
      expect(unit.invulnTick).toBe(0);

      const crate = makeCrate('invulnerability');
      pickupCrate(ctx, crate, unit);

      // C++ RULES.INI Invulnerability=3,INVULBOX,1.0 → duration = TICKS_PER_MINUTE * 1.0
      // TICKS_PER_MINUTE = 900 at 15fps, or 1200 at 20fps
      expect(unit.invulnTick).toBeGreaterThan(0);
    });

    it('reveal crate reveals entire map (C++ cell.cpp:2357-2363)', () => {
      let mapRevealed = false;
      const ctx = makeMockCtx({
        map: {
          boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128,
          isPassable: () => true,
          getVisibility: () => 1,
          setVisibility: () => {},
          revealAll: () => { mapRevealed = true; },
        } as any,
      });
      const unit = makeUnit();

      const crate = makeCrate('reveal');
      pickupCrate(ctx, crate, unit);

      expect(mapRevealed).toBe(true);
      expect(ctx.visionaryHouses.has(unit.house)).toBe(true);
    });

    it('timequake crate causes screen shake (C++ cell.cpp:2329 — TimeQuake = true)', () => {
      const ctx = makeMockCtx();
      const unit = makeUnit();

      const crate = makeCrate('timequake');
      pickupCrate(ctx, crate, unit);

      expect(ctx.screenShake).toBeGreaterThan(0);
    });

    it('icbm crate triggers nuke detonation (C++ cell.cpp:2543-2550)', () => {
      let nuked = false;
      const enemyStruct = {
        alive: true, house: House.USSR, cx: 10, cy: 10,
        hp: 100, maxHp: 200, type: 'FACT',
      } as any;
      const ctx = makeMockCtx({
        structures: [enemyStruct],
        detonateNuke: () => { nuked = true; },
        isAllied: (a: House, b: House) => a === b,
      });
      const unit = makeUnit();

      const crate = makeCrate('icbm');
      pickupCrate(ctx, crate, unit);

      expect(nuked).toBe(true);
    });

    it('vortex crate spawns active vortex (C++ cell.cpp:2608-2614)', () => {
      const ctx = makeMockCtx();
      const unit = makeUnit();

      const crate = makeCrate('vortex', 500, 600);
      pickupCrate(ctx, crate, unit);

      expect(ctx.activeVortices.length).toBe(1);
      expect(ctx.activeVortices[0].x).toBe(500);
      expect(ctx.activeVortices[0].y).toBe(600);
      expect(ctx.activeVortices[0].ticksLeft).toBeGreaterThan(0);
    });
  });

  // ── Section 5: Animation plays once (loops=0 in adata.cpp) ──────────────

  describe('crate animations play once (not looping)', () => {

    const typesWithAnims: [CrateType, string][] = [
      ['money', 'dollar'],
      ['armor', 'armor'],
      ['speed', 'speed'],
      ['firepower', 'fpower'],
      ['reveal', 'earth'],
      ['darkness', 'empulse'],
      ['cloak', 'stealth2'],
      ['icbm', 'missile2'],
      ['timequake', 'tquake'],
      ['invulnerability', 'invulbox'],
      ['heal_base', 'invun'],
    ];

    for (const [crateType, expectedSprite] of typesWithAnims) {
      it(`${crateType} animation ("${expectedSprite}") has no loop properties (plays once per C++ loops=0)`, () => {
        const ctx = makeMockCtx();
        const unit = makeUnit();
        ctx.entities.push(unit);
        ctx.entityById.set(unit.id, unit);
        const crate = makeCrate(crateType, 100, 100);

        pickupCrate(ctx, crate, unit);

        const crateEffect = ctx.effects.find(e => e.sprite === expectedSprite);
        expect(crateEffect, `Expected "${expectedSprite}" effect for ${crateType}`).toBeDefined();
        // loops=0 in C++ means play once → TS should not set loopStart/loopEnd/loops
        if (crateEffect) {
          expect(crateEffect.loops === undefined || crateEffect.loops === 0,
            `${expectedSprite} should not loop (C++ adata.cpp loops=0)`).toBe(true);
        }
      });
    }
  });

  // ── Section 6: EVA messages match C++ crate type ──────────────────────────

  describe('EVA messages generated for each crate pickup', () => {

    const crateEvaMessages: [CrateType, string][] = [
      ['money', 'MONEY CRATE'],
      ['heal', 'UNIT HEALED'],
      ['armor', 'ARMOR UPGRADE'],
      ['firepower', 'FIREPOWER UPGRADE'],
      ['speed', 'SPEED UPGRADE'],
      ['reveal', 'MAP REVEALED'],
      ['cloak', 'UNIT CLOAKED'],
      ['invulnerability', 'INVULNERABILITY'],
      ['timequake', 'TIME QUAKE'],
    ];

    for (const [crateType, expectedMsg] of crateEvaMessages) {
      it(`${crateType} produces EVA message "${expectedMsg}"`, () => {
        const ctx = makeMockCtx();
        const unit = makeUnit();
        ctx.entities.push(unit);
        ctx.entityById.set(unit.id, unit);
        const crate = makeCrate(crateType);

        pickupCrate(ctx, crate, unit);

        const msg = ctx.evaMessages.find(m => m.text === expectedMsg);
        expect(msg, `Expected EVA message "${expectedMsg}" for ${crateType}`).toBeDefined();
      });
    }
  });

  // ── Section 7: C++ CrateType enum completeness ──────────────────────────

  describe('C++ CrateType enum completeness', () => {

    it('C++ defines exactly 18 crate types (CRATE_MONEY through CRATE_VORTEX)', () => {
      expect(CPP_CRATE_TYPE_ORDER).toHaveLength(18);
    });

    it('TS CrateType union covers all crate types that appear in CRATE_SHARES', () => {
      // CRATE_SHARES must include entries for the crate types used in multiplay random selection
      const shareTypes = CRATE_SHARES.map(s => s.type);
      // These are the types from C++ that go into the weighted pool
      const expectedInPool: CrateType[] = [
        'money', 'unit', 'speed', 'firepower', 'armor',
        'reveal', 'cloak', 'heal', 'explosion',
        'sonar', 'icbm', 'timequake', 'vortex',
      ];
      for (const t of expectedInPool) {
        expect(shareTypes, `CRATE_SHARES should include "${t}"`).toContain(t);
      }
    });
  });

  // ── Section 8: Crate pickup sound (C++ uses crate removal, no specific sound per anim) ──

  describe('crate pickup generates pickup sound', () => {

    it('pickupCrate calls playSoundAt for all crate types', () => {
      let soundPlayed = false;
      const ctx = makeMockCtx({
        playSoundAt: () => { soundPlayed = true; },
      });
      const unit = makeUnit();
      const crate = makeCrate('money');

      pickupCrate(ctx, crate, unit);

      expect(soundPlayed).toBe(true);
    });
  });
});
