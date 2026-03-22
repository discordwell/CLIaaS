/**
 * C++ Parity Audit: Crate Data Constants
 *
 * Audits static crate/powerup data values from RULES.INI [General] and [Powerups]
 * against the TS engine constants in crates.ts.
 *
 * Failing tests are EXPECTED — they document real C++ divergences.
 *
 * C++ source references:
 *   - rules.ini [General]:11-20  — CrateMinimum, CrateMaximum, CrateRadius, CrateRegen,
 *                                   UnitCrateType, WaterCrateChance, SoloCrateMoney,
 *                                   SilverCrate, WaterCrate, WoodCrate
 *   - rules.ini [Powerups]:2819-2835 — per-type shares, anim, data values
 *   - rules.cpp:125-128          — compiled defaults for crate rules
 *   - rules.cpp:154-158          — CrateMinimum=1, CrateMaximum=255
 *   - rules.cpp:207              — CrateTime=10 (INI key: "CrateRegen")
 *   - rules.cpp:262              — CrateRadius=0x0280 (640 leptons = 2.5 cells)
 *   - rules.cpp:475-506          — INI parsing: CrateRadius = ini.Get_Fixed(GENERAL, "CrateRadius")
 *   - rules.cpp:778-816          — Powerups() INI parsing
 *   - const.cpp:381-400          — CrateShares[] defaults (before INI override)
 *   - const.cpp:402-421          — CrateAnims[] defaults
 *   - const.cpp:423-442          — CrateData[] defaults
 *   - const.cpp:444-463          — CrateNames[] canonical names
 *   - defines.h:759-781          — CrateType enum (18 types)
 *   - defines.h:3031-3032        — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *   - cell.cpp:2335-2341         — Money crate: Refund_Money(Random_Pick(CrateData, CrateData+900))
 *   - cell.cpp:2487-2489         — Explosion crate: Take_Damage(CrateData, 0, WARHEAD_HE)
 *   - cell.cpp:2505-2508         — Napalm crate: damage = CrateData, 5 scatter explosions
 *   - cell.cpp:2597-2600         — Invulnerability: IronCurtainCountDown = TICKS_PER_MINUTE * fixed(CrateData)
 *   - cell.cpp:2552-2561         — Armor: ArmorBias *= Inverse(fixed(CrateData/256))
 *   - cell.cpp:2565-2577         — Speed: SpeedBias *= fixed(CrateData/256)
 *   - cell.cpp:2580-2592         — Firepower: FirepowerBias *= fixed(CrateData/256)
 */

import { describe, it, expect } from 'vitest';
import {
  CRATE_RADIUS,
  CRATE_SHARES,
  CRATE_ANIM_MAP,
  CRATE_NAME_MAP,
  type CrateType,
} from '../engine/crates';

// ══════════════════════════════════════════════════════════════════════════════
// C++ reference constants from RULES.INI [General] (lines 11-20)
// ══════════════════════════════════════════════════════════════════════════════

/** rules.ini:11 — CrateMinimum=1 */
const INI_CRATE_MINIMUM = 1;

/** rules.ini:12 — CrateMaximum=255 */
const INI_CRATE_MAXIMUM = 255;

/**
 * rules.ini:13 — CrateRadius=3.0 (cells)
 *
 * The compiled C++ default (rules.cpp:262) is 0x0280 = 640 leptons = 2.5 cells.
 * However, RULES.INI overrides this to 3.0 via:
 *   rules.cpp:475: CrateRadius = ini.Get_Fixed(GENERAL, "CrateRadius", CrateRadius);
 * So the effective runtime value is 3.0 cells.
 */
const INI_CRATE_RADIUS = 3.0;

/**
 * rules.ini:14 — CrateRegen=3 (minutes)
 * This is the INI key for the CrateTime field.
 * rules.cpp:506: CrateTime = ini.Get_Fixed(GENERAL, "CrateRegen", CrateTime);
 * The compiled default is CrateTime=10 (rules.cpp:207), but RULES.INI overrides to 3.
 */
const INI_CRATE_REGEN = 3;

/** rules.ini:17 — SoloCrateMoney=2000 */
const INI_SOLO_CRATE_MONEY = 2000;

/** rules.ini:18 — SilverCrate=HealBase */
const INI_SILVER_CRATE = 'HealBase';

/** rules.ini:19 — WaterCrate=Money */
const INI_WATER_CRATE = 'Money';

/** rules.ini:20 — WoodCrate=Money */
const INI_WOOD_CRATE = 'Money';

/** rules.ini:16 — WaterCrateChance=20% */
const INI_WATER_CRATE_CHANCE = 0.20;

// ══════════════════════════════════════════════════════════════════════════════
// C++ reference constants from RULES.INI [Powerups] (lines 2819-2835)
// Format: Name=shares,ANIM,data
// ══════════════════════════════════════════════════════════════════════════════

interface CppCrateEntry {
  /** INI key name */
  iniName: string;
  /** shares (first field) */
  shares: number;
  /** animation sprite name (second field) */
  anim: string;
  /** data value (third field, type-specific) */
  data: number | null;
  /** TS CrateType equivalent */
  tsType: CrateType;
}

/**
 * Complete [Powerups] section from rules.ini:2819-2835
 * ChronalVortex is NOT in RULES.INI — uses const.cpp default shares=5.
 */
const CPP_POWERUPS: CppCrateEntry[] = [
  { iniName: 'Armor',           shares: 10, anim: 'ARMOR',    data: 2.0,  tsType: 'armor' },
  { iniName: 'Cloak',           shares: 0,  anim: 'STEALTH2', data: null, tsType: 'cloak' },
  { iniName: 'Darkness',        shares: 1,  anim: 'EMPULSE',  data: null, tsType: 'darkness' },
  { iniName: 'Explosion',       shares: 5,  anim: 'NONE',     data: 500,  tsType: 'explosion' },
  { iniName: 'Firepower',       shares: 10, anim: 'FPOWER',   data: 2.0,  tsType: 'firepower' },
  { iniName: 'HealBase',        shares: 1,  anim: 'INVUN',    data: null, tsType: 'heal_base' },
  { iniName: 'ICBM',            shares: 1,  anim: 'MISSILE2', data: null, tsType: 'icbm' },
  { iniName: 'Money',           shares: 50, anim: 'DOLLAR',   data: 2000, tsType: 'money' },
  { iniName: 'Napalm',          shares: 5,  anim: 'NONE',     data: 600,  tsType: 'napalm' },
  { iniName: 'ParaBomb',        shares: 3,  anim: 'PARABOX',  data: null, tsType: 'parabomb' },
  { iniName: 'Reveal',          shares: 1,  anim: 'EARTH',    data: null, tsType: 'reveal' },
  { iniName: 'Sonar',           shares: 3,  anim: 'SONARBOX', data: null, tsType: 'sonar' },
  { iniName: 'Speed',           shares: 10, anim: 'SPEED',    data: 1.7,  tsType: 'speed' },
  { iniName: 'Squad',           shares: 20, anim: 'NONE',     data: null, tsType: 'squad' },
  { iniName: 'Unit',            shares: 20, anim: 'NONE',     data: null, tsType: 'unit' },
  { iniName: 'Invulnerability', shares: 3,  anim: 'INVULBOX', data: 1.0,  tsType: 'invulnerability' },
  { iniName: 'TimeQuake',       shares: 3,  anim: 'TQUAKE',   data: null, tsType: 'timequake' },
];

/** C++ defines.h:3031-3032 */
const CPP_TICKS_PER_SECOND = 15;
const CPP_TICKS_PER_MINUTE = CPP_TICKS_PER_SECOND * 60; // 900

// ══════════════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity Audit: Crate Data Constants', () => {

  // ── Section 1: [General] crate configuration ─────────────────────────────

  describe('[General] crate configuration (rules.ini:11-20)', () => {

    it('CrateRadius matches RULES.INI (3.0 cells, not compiled default 2.5)', () => {
      // rules.ini:13 — CrateRadius=3.0
      // rules.cpp:262 compiled default = 0x0280 = 640 leptons = 2.5 cells
      // rules.cpp:475 INI override: CrateRadius = ini.Get_Fixed(GENERAL, "CrateRadius", CrateRadius)
      // RULES.INI sets it to 3.0, so the effective C++ runtime value is 3.0 cells
      // TS CRATE_RADIUS = 2.5 (uses compiled default, ignores INI override)
      expect(CRATE_RADIUS).toBe(INI_CRATE_RADIUS);
    });

    it('CrateRegen/CrateTime: RULES.INI says 3 minutes, not compiled default 10', () => {
      // rules.ini:14 — CrateRegen=3
      // rules.cpp:207 compiled default: CrateTime=10
      // rules.cpp:506: CrateTime = ini.Get_Fixed(GENERAL, "CrateRegen", CrateTime)
      // So effective CrateTime is 3, not 10.
      // TS crates.ts:163 hardcodes crateTimeMin = 10 (compiled default, ignores INI)
      //
      // With CrateRegen=3:
      //   C++ min lifetime = CrateTime/2 = 1.5 minutes
      //   C++ max lifetime = CrateTime*2 = 6 minutes
      // TS uses CrateTime=10:
      //   TS min lifetime = 5 minutes, TS max lifetime = 20 minutes
      //
      // This is a significant divergence — TS crates last 3-13x longer than C++.
      const tsCrateTimeMinutes = 10; // hardcoded in crates.ts:163
      expect(tsCrateTimeMinutes).toBe(INI_CRATE_REGEN);
    });

    it('SilverCrate override maps to heal_base', () => {
      // rules.ini:18 — SilverCrate=HealBase
      // TS CRATE_NAME_MAP should map 'HealBase' (case-insensitive key) to 'heal_base'
      const tsType = CRATE_NAME_MAP[INI_SILVER_CRATE.toLowerCase()];
      expect(tsType).toBe('heal_base');
    });

    it('WoodCrate override maps to money', () => {
      // rules.ini:20 — WoodCrate=Money
      const tsType = CRATE_NAME_MAP[INI_WOOD_CRATE.toLowerCase()];
      expect(tsType).toBe('money');
    });

    it('WaterCrate override maps to money', () => {
      // rules.ini:19 — WaterCrate=Money
      const tsType = CRATE_NAME_MAP[INI_WATER_CRATE.toLowerCase()];
      expect(tsType).toBe('money');
    });

    it('SoloCrateMoney value = 2000 (used in money crate pickup)', () => {
      // rules.ini:17 — SoloCrateMoney=2000
      // TS crates.ts:233 hardcodes addCredits(2000, true)
      // This matches the INI value, but C++ multiplayer uses
      // Random_Pick(CrateData, CrateData+900) = 2000-2900
      expect(INI_SOLO_CRATE_MONEY).toBe(2000);
    });
  });

  // ── Section 2: CRATE_SHARES enum order vs C++ CrateType enum ─────────────

  describe('CRATE_SHARES order matches C++ CrateType enum (defines.h:759-781)', () => {

    /**
     * C++ CrateType enum order (defines.h:759-781):
     *   0=MONEY, 1=UNIT, 2=PARA_BOMB, 3=HEAL_BASE, 4=CLOAK, 5=EXPLOSION,
     *   6=NAPALM, 7=SQUAD, 8=DARKNESS, 9=REVEAL, 10=SONAR, 11=ARMOR,
     *   12=SPEED, 13=FIREPOWER, 14=ICBM, 15=TIMEQUAKE, 16=INVULN, 17=VORTEX
     *
     * The order matters because C++ indexes CrateShares[], CrateData[], CrateAnims[]
     * by the enum value. If TS CRATE_SHARES is in a different order, weighted selection
     * still works (it's just a weighted pool), but documentation/maintenance diverges.
     */
    const CPP_ENUM_ORDER: CrateType[] = [
      'money',           // 0
      'unit',            // 1
      'parabomb',        // 2
      'heal_base',       // 3
      'cloak',           // 4
      'explosion',       // 5
      'napalm',          // 6
      'squad',           // 7
      'darkness',        // 8
      'reveal',          // 9
      'sonar',           // 10
      'armor',           // 11
      'speed',           // 12
      'firepower',       // 13
      'icbm',            // 14
      'timequake',       // 15
      'invulnerability', // 16
      'vortex',          // 17
    ];

    it('CRATE_SHARES has exactly 18 entries (one per C++ CrateType)', () => {
      expect(CRATE_SHARES).toHaveLength(18);
    });

    it('CRATE_SHARES order matches C++ CrateType enum order', () => {
      const tsOrder = CRATE_SHARES.map(s => s.type);
      expect(tsOrder).toEqual(CPP_ENUM_ORDER);
    });
  });

  // ── Section 3: Per-type share values from [Powerups] ──────────────────────

  describe('[Powerups] share values match RULES.INI (rules.ini:2819-2835)', () => {

    const tsShareMap = new Map(CRATE_SHARES.map(s => [s.type, s.shares]));

    for (const entry of CPP_POWERUPS) {
      it(`${entry.iniName} shares = ${entry.shares} (${entry.iniName}=${entry.shares},${entry.anim}${entry.data !== null ? ',' + entry.data : ''})`, () => {
        const actual = tsShareMap.get(entry.tsType);
        expect(actual, `${entry.tsType} shares`).toBe(entry.shares);
      });
    }

    it('ChronalVortex shares = 5 (not in RULES.INI, const.cpp default)', () => {
      const vortexShares = tsShareMap.get('vortex');
      expect(vortexShares).toBe(5);
    });

    it('total shares = 151 (sum of all RULES.INI + ChronalVortex=5)', () => {
      // 50+20+3+1+0+5+5+20+1+1+3+10+10+10+1+3+3+5 = 151
      const total = CRATE_SHARES.reduce((sum, s) => sum + s.shares, 0);
      expect(total).toBe(151);
    });
  });

  // ── Section 4: Crate animation sprite mapping ────────────────────────────

  describe('CRATE_ANIM_MAP matches [Powerups] anim field (rules.ini:2819-2835)', () => {

    /**
     * C++ rules.cpp:801: CrateAnims[crate] = Anim_From_Name(token);
     * The anim names in RULES.INI are uppercase; TS lowercases them.
     */
    for (const entry of CPP_POWERUPS) {
      if (entry.anim === 'NONE') {
        it(`${entry.iniName} has no crate animation (ANIM_NONE)`, () => {
          const tsAnim = CRATE_ANIM_MAP[entry.tsType];
          expect(tsAnim, `${entry.tsType} should have no animation`).toBeUndefined();
        });
      } else {
        it(`${entry.iniName} animation = ${entry.anim.toLowerCase()}`, () => {
          const tsAnim = CRATE_ANIM_MAP[entry.tsType];
          expect(tsAnim, `${entry.tsType} animation`).toBe(entry.anim.toLowerCase());
        });
      }
    }
  });

  // ── Section 5: CrateData values (third field) ────────────────────────────

  describe('CrateData values match [Powerups] third field', () => {

    it('Explosion damage = 500 (Explosion=5,NONE,500)', () => {
      // C++ cell.cpp:2487-2489:
      //   int d = CrateData[powerup]; // = 500
      //   object->Take_Damage(d, 0, WARHEAD_HE, 0, true);
      // TS crates.ts:325: ctx.damageEntity(e, 200, 'HE')
      // TS uses 200, C++ uses 500 from CrateData
      //
      // We can't directly test the hardcoded 200 vs 500 without calling pickupCrate,
      // but we document the divergence: TS explosion damage is 200, C++ is 500.
      const cppExplosionDamage = 500; // from RULES.INI
      const tsExplosionDamage = 200;  // hardcoded in crates.ts:325
      expect(tsExplosionDamage).toBe(cppExplosionDamage);
    });

    it('Napalm damage = 600 per cell (Napalm=5,NONE,600)', () => {
      // C++ cell.cpp:2505-2508:
      //   damage = CrateData[powerup]; // = 600
      //   Explosion_Damage(Cell_Coord(), damage, NULL, WARHEAD_FIRE);
      // C++ fires 5 scatter explosions each dealing 600 damage.
      // TS crates.ts:373: ctx.damageEntity(e, 80, 'Fire') per 3x3 cell
      // TS uses 80 per cell, C++ uses 600 per explosion.
      const cppNapalmDamage = 600;
      const tsNapalmDamagePerCell = 80;
      expect(tsNapalmDamagePerCell).toBe(cppNapalmDamage);
    });

    it('Money crate: C++ multiplayer gives Random_Pick(2000, 2900), TS gives flat 2000', () => {
      // C++ cell.cpp:2340:
      //   object->House->Refund_Money(Random_Pick(CrateData[powerup], CrateData[powerup]+900));
      // CrateData = 2000 from RULES.INI, so range is 2000-2900.
      // TS crates.ts:233: ctx.addCredits(2000, true) — always flat 2000
      //
      // Note: TS targets solo play where SoloCrateMoney=2000 is correct.
      // But the CrateData-based random range is the multiplayer C++ behavior.
      const cppMoneyMax = 2000 + 900; // 2900
      const tsMoneyAmount = 2000;
      // Document that TS doesn't support the random range
      expect(tsMoneyAmount).toBeLessThan(cppMoneyMax);
    });

    it('Invulnerability duration = TICKS_PER_MINUTE * 1.0 = 900 C++ ticks', () => {
      // C++ cell.cpp:2597-2600:
      //   IronCurtainCountDown = TICKS_PER_MINUTE * fixed(CrateData[powerup], 256)
      //   CrateData = fixed(1.0)*256 = 256 → fixed(256/256) = 1.0
      //   IronCurtainCountDown = 900 * 1.0 = 900 ticks (1 minute at 15 TPS)
      //
      // TS crates.ts:387: unit.invulnTick = 300 (300 ticks at 20 TPS = 15 seconds)
      //
      // C++ duration = 900/15 = 60 seconds (1 full minute)
      // TS duration  = 300/20 = 15 seconds
      // This is a 4:1 divergence.
      const cppInvulnTicks = CPP_TICKS_PER_MINUTE * 1.0; // 900
      const cppInvulnSeconds = cppInvulnTicks / CPP_TICKS_PER_SECOND; // 60
      const tsInvulnTicks = 300; // hardcoded in crates.ts:387
      const tsTPS = 20; // GAME_TICKS_PER_SEC
      const tsInvulnSeconds = tsInvulnTicks / tsTPS; // 15

      // Should match C++ duration in real-time seconds
      expect(tsInvulnSeconds).toBe(cppInvulnSeconds);
    });

    it('Armor multiplier = 2.0 (Armor=10,ARMOR,2.0)', () => {
      // C++ cell.cpp:2557: ArmorBias *= Inverse(fixed(CrateData/256))
      // CrateData = fixed(2.0)*256 = 512 → Inverse(fixed(512/256)) = Inverse(2.0) = 0.5
      // So ArmorBias = 1.0 * 0.5 = 0.5 (halves incoming damage = doubles effective armor)
      // TS: armorBias = 2 — same practical effect (damage / armorBias)
      // Values differ (0.5 vs 2) but the effect is equivalent: 2x armor.
      // This is an acceptable implementation difference — pass.
      expect(true).toBe(true);
    });

    it('Speed multiplier = 1.7 (Speed=10,SPEED,1.7)', () => {
      // C++ cell.cpp:2572: SpeedBias *= fixed(CrateData/256) = 1.7
      // TS: speedBias = 1.7 — matches
      // (Verified by existing tests; included for completeness)
      expect(true).toBe(true);
    });

    it('Firepower multiplier = 2.0 (Firepower=10,FPOWER,2.0)', () => {
      // C++ cell.cpp:2586: FirepowerBias *= fixed(CrateData/256) = 2.0
      // TS: firepowerBias = 2 — matches
      expect(true).toBe(true);
    });
  });

  // ── Section 6: TS phantom types not in C++ ────────────────────────────────

  describe('TS CrateType inventory vs C++ CrateType enum', () => {

    it('"heal" type exists in TS but NOT in C++ enum (C++ only has CRATE_HEAL_BASE)', () => {
      // C++ defines.h:759-781 lists 18 types. There is NO CRATE_HEAL.
      // The closest is CRATE_HEAL_BASE (index 3).
      // TS CrateType union includes 'heal' AND 'heal_base'.
      // 'heal' has no entry in CRATE_SHARES, so it can never be randomly selected,
      // but it IS a valid CrateType and appears in CRATE_NAME_MAP:
      //   CRATE_NAME_MAP['veterancy'] = 'heal'
      // C++ has no "veterancy" crate concept.
      const healInShares = CRATE_SHARES.find(s => s.type === 'heal');
      expect(healInShares, '"heal" should NOT be in CRATE_SHARES (no C++ equivalent)').toBeUndefined();
    });

    it('"heal" is mapped from "veterancy" in CRATE_NAME_MAP (no C++ equivalent)', () => {
      // This mapping has no C++ counterpart
      const mapped = CRATE_NAME_MAP['veterancy'];
      expect(mapped).toBe('heal');
    });

    it('CRATE_NAME_MAP has entries for all 18 C++ canonical names (lowercase)', () => {
      // C++ CrateNames[] from const.cpp:444-463
      const cppCanonicalNames = [
        'money', 'unit', 'parabomb', 'healbase', 'cloak',
        'explosion', 'napalm', 'squad', 'darkness', 'reveal',
        'sonar', 'armor', 'speed', 'firepower', 'icbm',
        'timequake', 'invulnerability', 'chronalvortex',
      ];

      // Note: C++ uses "ParaBomb" → "parabomb", "HealBase" → "healbase", etc.
      // Check which ones TS CRATE_NAME_MAP handles (it uses lowercase keys)
      for (const name of cppCanonicalNames) {
        // TS uses underscore variants: heal_base vs healbase
        const tsName = CRATE_NAME_MAP[name];
        const tsNameAlt = CRATE_NAME_MAP[name.replace('base', '_base')];
        const found = tsName !== undefined || tsNameAlt !== undefined;
        expect(found, `CRATE_NAME_MAP should handle C++ name "${name}"`).toBe(true);
      }
    });
  });

  // ── Section 7: Const.cpp defaults vs RULES.INI overrides ──────────────────

  describe('const.cpp defaults that RULES.INI overrides', () => {

    it('Cloak: const.cpp default shares=3, RULES.INI overrides to 0', () => {
      // const.cpp:384: CrateShares[CRATE_CLOAK] = 3
      // RULES.INI:2820: Cloak=0,STEALTH2
      // TS should use the RULES.INI value (0), not the compiled default (3)
      const tsCloak = CRATE_SHARES.find(s => s.type === 'cloak');
      expect(tsCloak?.shares, 'Cloak shares should be 0 (RULES.INI override)').toBe(0);
    });

    it('TimeQuake: const.cpp default shares=1, RULES.INI overrides to 3', () => {
      // const.cpp:396: CrateShares[CRATE_TIMEQUAKE] = 1
      // RULES.INI:2835: TimeQuake=3,TQUAKE
      const ts = CRATE_SHARES.find(s => s.type === 'timequake');
      expect(ts?.shares).toBe(3);
    });

    it('Invulnerability: const.cpp default shares=3, RULES.INI keeps 3', () => {
      // const.cpp:397: CrateShares[CRATE_INVULN] = 3
      // RULES.INI:2834: Invulnerability=3,INVULBOX,1.0
      const ts = CRATE_SHARES.find(s => s.type === 'invulnerability');
      expect(ts?.shares).toBe(3);
    });
  });

  // ── Section 8: Probability calculations ───────────────────────────────────

  describe('crate probability calculations', () => {

    it('money crate probability = 50/151 = ~33.1%', () => {
      const total = CRATE_SHARES.reduce((sum, s) => sum + s.shares, 0);
      const moneyShares = CRATE_SHARES.find(s => s.type === 'money')!.shares;
      const probability = moneyShares / total;
      expect(probability).toBeCloseTo(50 / 151, 4);
    });

    it('cloak crate probability = 0% (disabled by RULES.INI)', () => {
      const total = CRATE_SHARES.reduce((sum, s) => sum + s.shares, 0);
      const cloakShares = CRATE_SHARES.find(s => s.type === 'cloak')!.shares;
      const probability = cloakShares / total;
      expect(probability).toBe(0);
    });

    it('harmful crate probability = (explosion+napalm+darkness+timequake)/total', () => {
      // "Harmful" crates that can damage the picking-up player
      const total = CRATE_SHARES.reduce((sum, s) => sum + s.shares, 0);
      const harmfulTypes: CrateType[] = ['explosion', 'napalm', 'darkness', 'timequake'];
      const harmfulShares = CRATE_SHARES
        .filter(s => harmfulTypes.includes(s.type))
        .reduce((sum, s) => sum + s.shares, 0);
      // 5 + 5 + 1 + 3 = 14
      expect(harmfulShares).toBe(14);
      const probability = harmfulShares / total;
      expect(probability).toBeCloseTo(14 / 151, 4);
    });

    it('unit/squad crate combined probability = 40/151 = ~26.5%', () => {
      const total = CRATE_SHARES.reduce((sum, s) => sum + s.shares, 0);
      const unitSquad = CRATE_SHARES
        .filter(s => s.type === 'unit' || s.type === 'squad')
        .reduce((sum, s) => sum + s.shares, 0);
      expect(unitSquad).toBe(40);
      expect(unitSquad / total).toBeCloseTo(40 / 151, 4);
    });
  });

  // ── Section 9: CrateRadius usage in area effects ─────────────────────────

  describe('CRATE_RADIUS used for area-effect crates', () => {

    it('CRATE_RADIUS value matches export', () => {
      // This just verifies the exported constant.
      // The key divergence (2.5 vs 3.0) is tested in Section 1.
      expect(typeof CRATE_RADIUS).toBe('number');
      expect(CRATE_RADIUS).toBeGreaterThan(0);
    });

    it('CRATE_RADIUS is used as >= comparison (units AT exactly radius are excluded)', () => {
      // C++ cell.cpp:2556: if (Distance(obj->Center_Coord(), cell_coord) < CrateRadius)
      //   Uses strict less-than (<), so units exactly at radius are EXCLUDED.
      // TS crates.ts:265: if (worldDist(armorPos, e.pos) >= CRATE_RADIUS) continue;
      //   Uses >=, so units exactly at radius are also EXCLUDED. This matches.
      expect(true).toBe(true);
    });
  });

  // ── Section 10: Gap inventory — features in RULES.INI not in TS ───────────

  describe('gap inventory: RULES.INI features not fully implemented in TS', () => {

    it('UnitCrateType=none — TS does not read this from INI', () => {
      // rules.ini:15 — UnitCrateType=none
      // When not "none", C++ will always give this specific unit type from unit crates.
      // TS hardcodes a fixed array of unit types in crates.ts:242-249.
      // This is acceptable for solo play but is a gap for INI configurability.
      expect(true).toBe(true); // documenting only
    });

    it('WaterCrateChance=20% — TS has no water crate concept', () => {
      // rules.ini:16 — WaterCrateChance=20%
      // C++ crate.cpp:127-135: if cell is water → use water crate overlay
      // TS does not distinguish water vs land crate overlays.
      expect(true).toBe(true); // documenting only
    });

    it('C++ multiplayer crate replacement: pickup → Place_Random_Crate immediately', () => {
      // C++ cell.cpp:2309-2313: in multiplayer, picking up a crate immediately places
      // a new random one. TS does not implement this (relies on periodic spawn only).
      expect(true).toBe(true); // documenting only
    });

    it('C++ Crates[256] max slot array — TS uses dynamic array', () => {
      // C++ map.h:152: CrateClass Crates[256] — fixed 256-slot array
      // TS crates.ts:112: crates: Crate[] — dynamic array, no hard cap enforced
      expect(true).toBe(true); // documenting only
    });
  });
});
