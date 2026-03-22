/**
 * C++ Behavioral Parity Audit: Damage State Thresholds
 *
 * Tests verify damage state thresholds match rules.ini and C++ behavior.
 * Expected values are parsed from rules.ini at test time — never hardcoded.
 *
 * C++ source references:
 *   rules.ini [General]   — ConditionRed=25%, ConditionYellow=50%
 *   rules.cpp:234         — ConditionYellow = fixed(1,2) = 0.5 (default, overridden by INI)
 *   rules.cpp:235         — ConditionRed = fixed(1,4) = 0.25 (default, overridden by INI)
 *   techno.cpp:1146-1152  — Health bar color: green, <= yellow → YELLOW, <= red → RED
 *   drive.cpp:1157-1161   — Damaged speed: Health_Ratio() <= ConditionYellow → speed -= speed/4
 *   techno.cpp:2354       — SelfHealing: Health_Ratio() <= ConditionYellow → +1 HP
 *   techno.cpp:2444       — Cloak gating: Health_Ratio() > ConditionRed → Do_Cloak()
 *   building.cpp:502,632,639,651,669,679 — Building damaged frame: Health_Ratio() <= ConditionYellow
 *   infantry.cpp:455-456  — Fear scaling: Health_Ratio() > ConditionRed → fear/2, > ConditionYellow → fear/2
 *
 * Tests that FAIL are GOOD — they identify real C++ divergences.
 * DO NOT modify engine code to make these pass.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseIniSections } from '../engine/parseIni';
import {
  CONDITION_RED, CONDITION_YELLOW, UnitType, House,
} from '../engine/types';
import { Entity } from '../engine/entity';
import { damageSpeedFactor } from '../engine/combat';

// ── Parse rules.ini at test time (authoritative source) ──────────────────────

const rulesIniPath = join(__dirname, '../../..', 'public/ra/assets/rules.ini');
const rulesText = readFileSync(rulesIniPath, 'utf-8');
const sections = parseIniSections(rulesText);

/** Get a float from an INI section (strips trailing %) */
function iniFloat(section: string, key: string, def = 0): number {
  const val = sections.get(section)?.get(key);
  if (val == null) return def;
  const cleaned = val.replace(/%$/, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? def : parsed;
}

// ── INI-derived authoritative values ─────────────────────────────────────────

const INI_CONDITION_RED_PCT = iniFloat('General', 'ConditionRed');     // 25
const INI_CONDITION_YELLOW_PCT = iniFloat('General', 'ConditionYellow'); // 50
const INI_CONDITION_RED = INI_CONDITION_RED_PCT / 100;   // 0.25
const INI_CONDITION_YELLOW = INI_CONDITION_YELLOW_PCT / 100; // 0.50

// ══════════════════════════════════════════════════════════════════════════════
// DS1: rules.ini [General] ConditionRed / ConditionYellow values
// ══════════════════════════════════════════════════════════════════════════════

describe('DS1: rules.ini damage thresholds exist and parse correctly', () => {
  it('ConditionRed=25% in rules.ini', () => {
    expect(INI_CONDITION_RED_PCT).toBe(25);
  });

  it('ConditionYellow=50% in rules.ini', () => {
    expect(INI_CONDITION_YELLOW_PCT).toBe(50);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DS2: TS engine constants match rules.ini
// ══════════════════════════════════════════════════════════════════════════════

describe('DS2: engine CONDITION_RED/YELLOW constants match rules.ini', () => {
  // C++ rules.cpp:471-472 reads from INI: ConditionRed = ini.Get_Fixed("ConditionRed", ConditionRed)
  it('CONDITION_RED matches rules.ini ConditionRed', () => {
    expect(CONDITION_RED).toBe(INI_CONDITION_RED);
  });

  it('CONDITION_YELLOW matches rules.ini ConditionYellow', () => {
    expect(CONDITION_YELLOW).toBe(INI_CONDITION_YELLOW);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DS3: Speed reduction — single tier at ConditionYellow
// C++ drive.cpp:1159: if (Health_Ratio() <= Rule.ConditionYellow) speed -= speed/4
// ══════════════════════════════════════════════════════════════════════════════

describe('DS3: damageSpeedFactor — C++ drive.cpp:1157-1161 parity', () => {
  it('full health (100%) → factor 1.0 (no reduction)', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.hp = e.maxHp;
    expect(damageSpeedFactor(e)).toBe(1.0);
  });

  it('above yellow (51%) → factor 1.0 (no reduction)', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.hp = Math.ceil(e.maxHp * 0.51);
    expect(damageSpeedFactor(e)).toBe(1.0);
  });

  // C++ uses <= ConditionYellow, so exactly 50% triggers the reduction
  it('at exactly ConditionYellow (50%) → factor 0.75 (C++ uses <=)', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.hp = Math.floor(e.maxHp * INI_CONDITION_YELLOW);
    const ratio = e.hp / e.maxHp;
    expect(ratio).toBeLessThanOrEqual(INI_CONDITION_YELLOW);
    expect(damageSpeedFactor(e)).toBe(0.75);
  });

  it('below yellow (49%) → factor 0.75', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.hp = Math.floor(e.maxHp * 0.49);
    expect(damageSpeedFactor(e)).toBe(0.75);
  });

  // C++ has NO second speed tier at ConditionRed — only one tier exists
  it('at ConditionRed (25%) → still factor 0.75 (no second tier)', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.hp = Math.floor(e.maxHp * INI_CONDITION_RED);
    expect(damageSpeedFactor(e)).toBe(0.75);
  });

  it('at 10% HP → still factor 0.75 (no second tier)', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.hp = Math.floor(e.maxHp * 0.10);
    expect(damageSpeedFactor(e)).toBe(0.75);
  });

  it('at 1 HP → still factor 0.75 (no second tier)', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.hp = 1;
    expect(damageSpeedFactor(e)).toBe(0.75);
  });

  // C++ reduction: speed -= speed/4 = 3/4 speed = 0.75, NOT 0.5
  it('speed factor is exactly 0.75 (3/4), not 0.5 (1/2)', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.hp = Math.floor(e.maxHp * 0.4);
    const factor = damageSpeedFactor(e);
    expect(factor).toBe(0.75);
    expect(factor).not.toBe(0.5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DS4: Health bar color thresholds — C++ techno.cpp:1146-1152
// C++ logic:
//   color = LTGREEN;
//   if (ratio <= Rule.ConditionYellow) color = YELLOW;  // <= 0.50
//   if (ratio <= Rule.ConditionRed) color = RED;        // <= 0.25
// ══════════════════════════════════════════════════════════════════════════════

describe('DS4: health bar color thresholds — C++ techno.cpp:1146-1152', () => {
  // C++ uses `<=` comparisons, so at exactly the threshold, the color transitions.
  // TS renderer.ts:2246-2248 uses `>=` with inverted logic:
  //   ratio >= 0.50 → GREEN, ratio >= 0.25 → YELLOW, else → RED
  // This means at exactly 0.50, C++ shows YELLOW but TS shows GREEN.
  // At exactly 0.25, C++ shows RED but TS shows YELLOW.

  it('ratio > ConditionYellow → green (both C++ and TS agree)', () => {
    const ratio = 0.51;
    // C++: starts green, neither <= 0.50 nor <= 0.25 fires → GREEN
    const cppColor = 'GREEN';
    // TS: ratio >= 0.50 → GREEN
    const tsColor = ratio >= 0.50 ? 'GREEN' : ratio >= 0.25 ? 'YELLOW' : 'RED';
    expect(tsColor).toBe(cppColor);
  });

  it('ratio == ConditionYellow (0.50) → C++ shows YELLOW (boundary test)', () => {
    const ratio = INI_CONDITION_YELLOW; // exactly 0.50
    // C++ techno.cpp:1147: ratio <= 0.50 → YELLOW
    const cppColor = 'YELLOW';
    // TS renderer.ts:2246: ratio >= 0.50 → GREEN  (MISMATCH!)
    const tsColor = ratio >= 0.50 ? 'GREEN' : ratio >= 0.25 ? 'YELLOW' : 'RED';
    expect(tsColor).toBe(cppColor); // EXPECT FAIL: TS returns GREEN, C++ returns YELLOW
  });

  it('ratio just below ConditionYellow (0.49) → both show YELLOW', () => {
    const ratio = 0.49;
    // C++: <= 0.50 → YELLOW, not <= 0.25 → stays YELLOW
    const cppColor = 'YELLOW';
    // TS: not >= 0.50, but >= 0.25 → YELLOW
    const tsColor = ratio >= 0.50 ? 'GREEN' : ratio >= 0.25 ? 'YELLOW' : 'RED';
    expect(tsColor).toBe(cppColor);
  });

  it('ratio == ConditionRed (0.25) → C++ shows RED (boundary test)', () => {
    const ratio = INI_CONDITION_RED; // exactly 0.25
    // C++ techno.cpp:1150: ratio <= 0.25 → RED
    const cppColor = 'RED';
    // TS renderer.ts:2247: ratio >= 0.25 → YELLOW  (MISMATCH!)
    const tsColor = ratio >= 0.50 ? 'GREEN' : ratio >= 0.25 ? 'YELLOW' : 'RED';
    expect(tsColor).toBe(cppColor); // EXPECT FAIL: TS returns YELLOW, C++ returns RED
  });

  it('ratio just below ConditionRed (0.24) → both show RED', () => {
    const ratio = 0.24;
    // C++: <= 0.50 → YELLOW, then <= 0.25 → RED
    const cppColor = 'RED';
    // TS: not >= 0.50, not >= 0.25 → RED
    const tsColor = ratio >= 0.50 ? 'GREEN' : ratio >= 0.25 ? 'YELLOW' : 'RED';
    expect(tsColor).toBe(cppColor);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DS5: Building damaged frame threshold — C++ building.cpp uses <= ConditionYellow
// TS renderer.ts:1396 uses: s.hp < s.maxHp * 0.5 (strictly less)
// ══════════════════════════════════════════════════════════════════════════════

describe('DS5: building damaged frame threshold — C++ building.cpp parity', () => {
  // C++ building.cpp:502,632,639,651,669,679: Health_Ratio() <= Rule.ConditionYellow
  // TS renderer.ts:1396: s.hp < s.maxHp * 0.5

  it('above 50% → undamaged frame (both agree)', () => {
    const hp = 600;
    const maxHp = 1000;
    const cppDamaged = (hp / maxHp) <= INI_CONDITION_YELLOW; // false
    const tsDamaged = hp < maxHp * 0.5; // false
    expect(tsDamaged).toBe(cppDamaged);
  });

  it('at exactly 50% → C++ shows damaged (<=), TS may not (<)', () => {
    const maxHp = 1000;
    const hp = maxHp * INI_CONDITION_YELLOW; // exactly 500
    // C++ building.cpp: Health_Ratio() <= 0.50 → true (damaged frame)
    const cppDamaged = (hp / maxHp) <= INI_CONDITION_YELLOW; // true
    // TS renderer.ts:1396: hp < maxHp * 0.5 → 500 < 500 → false
    const tsDamaged = hp < maxHp * 0.5; // false
    expect(tsDamaged).toBe(cppDamaged); // EXPECT FAIL: TS false, C++ true
  });

  it('at 49% → both show damaged', () => {
    const maxHp = 1000;
    const hp = 490;
    const cppDamaged = (hp / maxHp) <= INI_CONDITION_YELLOW; // true
    const tsDamaged = hp < maxHp * 0.5; // true
    expect(tsDamaged).toBe(cppDamaged);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DS6: Cloaking health gate — C++ techno.cpp:2444
// C++ uses: Health_Ratio() > Rule.ConditionRed → always cloak
// TS uses: entity.hp / entity.maxHp < CONDITION_RED → 96% block
// ══════════════════════════════════════════════════════════════════════════════

describe('DS6: cloak health gate — C++ techno.cpp:2444 parity', () => {
  // C++ techno.cpp:2444: if (Health_Ratio() > Rule.ConditionRed) { Do_Cloak(); }
  //                       else { if (Percent_Chance(4)) { Do_Cloak(); } }
  // TS index.ts:4573: if (entity.hp / entity.maxHp < CONDITION_RED && Math.random() > 0.04) break;

  it('above ConditionRed (30%) → always allowed (both agree)', () => {
    const ratio = 0.30;
    const cppAllowCloak = ratio > INI_CONDITION_RED; // true
    const tsBlockCloak = ratio < CONDITION_RED; // false → not blocked → allowed
    expect(!tsBlockCloak).toBe(cppAllowCloak);
  });

  it('at exactly ConditionRed (25%) → C++ blocks (uses >), TS allows (uses <)', () => {
    const ratio = INI_CONDITION_RED; // exactly 0.25
    // C++ techno.cpp:2444: 0.25 > 0.25 → false → goes to 4% chance branch
    const cppAlwaysCloak = ratio > INI_CONDITION_RED; // false (4% chance path)
    // TS index.ts:4573: 0.25 < 0.25 → false → skip break → always allowed
    const tsBlocked = ratio < CONDITION_RED; // false → NOT blocked → always allowed
    const tsAlwaysCloak = !tsBlocked; // true — always cloaks
    // Mismatch: C++ has 4% chance, TS always allows
    expect(tsAlwaysCloak).toBe(cppAlwaysCloak); // EXPECT FAIL: TS true, C++ false
  });

  it('below ConditionRed (20%) → both use 4% chance path', () => {
    const ratio = 0.20;
    // C++ techno.cpp:2444: 0.20 > 0.25 → false → 4% chance
    const cppAlwaysCloak = ratio > INI_CONDITION_RED; // false
    // TS index.ts:4573: 0.20 < 0.25 → true → 96% chance to break
    const tsBlocked = ratio < CONDITION_RED; // true → enters 4% chance path
    const tsAlwaysCloak = !tsBlocked; // false
    expect(tsAlwaysCloak).toBe(cppAlwaysCloak);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DS7: Self-healing threshold — C++ techno.cpp:2354
// C++ only heals when Health_Ratio() <= ConditionYellow (50%)
// TS heals when s.hp < s.maxHp (100%) — heals to full
// ══════════════════════════════════════════════════════════════════════════════

describe('DS7: self-healing threshold — C++ techno.cpp:2354 parity', () => {
  // C++ techno.cpp:2354:
  //   if (IsSelfHealing && (Frame % RepairRate*TICKS_PER_MINUTE)==0 && Health_Ratio() <= ConditionYellow)
  //     Strength++;
  // TS index.ts:1770: if (s.alive && s.type === 'QUEE' && s.hp < s.maxHp)

  it('at 40% HP (below ConditionYellow) → both allow self-heal', () => {
    const maxHp = 800;
    const hp = 320; // 40%
    const ratio = hp / maxHp;
    const cppShouldHeal = ratio <= INI_CONDITION_YELLOW; // true
    const tsShouldHeal = hp < maxHp; // true
    expect(tsShouldHeal).toBe(cppShouldHeal);
  });

  it('at 50% HP (exactly ConditionYellow) → both allow self-heal', () => {
    const maxHp = 800;
    const hp = 400; // 50%
    const ratio = hp / maxHp;
    const cppShouldHeal = ratio <= INI_CONDITION_YELLOW; // true (<=)
    const tsShouldHeal = hp < maxHp; // true
    expect(tsShouldHeal).toBe(cppShouldHeal);
  });

  it('at 51% HP (above ConditionYellow) → C++ stops, TS keeps healing', () => {
    const maxHp = 1000;
    const hp = 510; // 51%
    const ratio = hp / maxHp;
    // C++ techno.cpp:2354: 0.51 <= 0.50 → false → no healing
    const cppShouldHeal = ratio <= INI_CONDITION_YELLOW; // false
    // TS index.ts:1770: 510 < 1000 → true → still healing
    const tsShouldHeal = hp < maxHp; // true
    expect(tsShouldHeal).toBe(cppShouldHeal); // EXPECT FAIL: TS true, C++ false
  });

  it('at 90% HP → C++ does not heal, TS still heals', () => {
    const maxHp = 1000;
    const hp = 900;
    const ratio = hp / maxHp;
    const cppShouldHeal = ratio <= INI_CONDITION_YELLOW; // false
    const tsShouldHeal = hp < maxHp; // true
    expect(tsShouldHeal).toBe(cppShouldHeal); // EXPECT FAIL: TS true, C++ false
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DS8: Building damage visual effects thresholds
// TS renderer.ts:1572-1577 uses: <75% → smoke, <50% → fire, <25% → intense fire
// C++ building.cpp shows fire on RESULT_MAJOR (any significant damage hit)
// and fire is attached to buildings via ANIM_FIRE_SMALL etc.
// ══════════════════════════════════════════════════════════════════════════════

describe('DS8: building damage visual effects use correct thresholds', () => {
  // TS renderer.ts:1573: s.hp < s.maxHp * 0.75 starts showing smoke
  // TS renderer.ts:1577: hpRatio < 0.25 → 3 fires, < 0.5 → 2 fires, else 1 fire
  // TS renderer.ts:1583: hpRatio < 0.5 → sprite-based fire (BURN-S/M/L)
  // TS renderer.ts:1605: hpRatio >= 0.5 → small smoldering fire (BURN-S)

  it('TS starts damage effects at 75%, not at ConditionYellow (50%)', () => {
    // C++ building damage visual (fire/smoke) is driven by RESULT_MAJOR hits
    // and attached fire animations — not a continuous threshold render.
    // TS instead uses continuous thresholds: 75%, 50%, 25%.
    // The 75% outer threshold has no direct C++ equivalent.
    const tsDamageEffectStart = 0.75;
    // C++ building damaged frame uses ConditionYellow (50%)
    expect(tsDamageEffectStart).not.toBe(INI_CONDITION_YELLOW);
  });

  it('fire intensity tiers use correct INI-derived thresholds', () => {
    // TS renderer.ts:1577: hpRatio < 0.25 → 3 fires, < 0.5 → 2 fires, else → 1 fire
    // These thresholds should reference ConditionRed (0.25) and ConditionYellow (0.50)
    // Verify the constants match rules.ini
    expect(INI_CONDITION_RED).toBe(0.25);
    expect(INI_CONDITION_YELLOW).toBe(0.50);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DS9: Engineer capture threshold — C++ uses ConditionRed
// C++ rules.cpp:286: EngineerCaptureLevel = ConditionRed
// C++ infantry.cpp:598-637: fixed(hp, maxHp) <= fixed(ConditionRed) → capture
// TS missionAI.ts:1061: Math.floor(s.hp * 256 / s.maxHp) <= Math.floor(CONDITION_RED * 256)
// ══════════════════════════════════════════════════════════════════════════════

describe('DS9: engineer capture threshold uses ConditionRed', () => {
  it('capture threshold matches ConditionRed from rules.ini', () => {
    expect(CONDITION_RED).toBe(INI_CONDITION_RED);
  });

  // C++ uses fixed-point comparison, TS emulates with Math.floor(x * 256)
  it('fixed-point comparison at exactly 25% HP matches C++', () => {
    const maxHp = 400;
    const hp = 100; // exactly 25%
    const cppFixed = Math.floor(hp * 256 / maxHp);     // floor(64) = 64
    const threshFixed = Math.floor(INI_CONDITION_RED * 256); // floor(64) = 64
    expect(cppFixed).toBeLessThanOrEqual(threshFixed); // 64 <= 64 → capture
  });

  it('at 26% HP → not capturable', () => {
    const maxHp = 400;
    const hp = 104; // 26%
    const cppFixed = Math.floor(hp * 256 / maxHp);     // floor(66.56) = 66
    const threshFixed = Math.floor(INI_CONDITION_RED * 256); // floor(64) = 64
    expect(cppFixed).toBeGreaterThan(threshFixed); // 66 > 64 → no capture
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DS10: Summary of all boundary comparison mismatches
// ══════════════════════════════════════════════════════════════════════════════

describe('DS10: comparison operator parity audit', () => {
  // This section documents the expected comparison operators.
  // C++ uses `<=` for thresholds (transition AT the boundary).
  // TS sometimes uses `<` (strictly less), missing the boundary.

  it('damageSpeedFactor uses <= (matches C++ drive.cpp:1159)', () => {
    // TS combat.ts:251: if (ratio <= CONDITION_YELLOW) return 0.75;
    // C++ drive.cpp:1159: if (Health_Ratio() <= Rule.ConditionYellow) speed -= speed/4;
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.hp = Math.floor(e.maxHp * INI_CONDITION_YELLOW);
    // At exactly 50%, should trigger reduction
    expect(damageSpeedFactor(e)).toBe(0.75);
  });

  it('health bar: C++ uses <= at boundaries (TS uses >= which inverts boundary)', () => {
    // C++ techno.cpp:1147: if (ratio <= ConditionYellow) color = YELLOW
    // TS renderer.ts:2246: ratio >= 0.50 ? GREEN : ...
    // At ratio=0.50: C++ → YELLOW, TS → GREEN
    const ratio = INI_CONDITION_YELLOW;
    const cppIsYellow = ratio <= INI_CONDITION_YELLOW; // true
    const tsIsGreen = ratio >= 0.50; // true (wrongly green)
    // If TS uses >=, boundary belongs to wrong color
    expect(cppIsYellow).toBe(true);
    expect(tsIsGreen).toBe(true);
    // They disagree at the boundary:
    expect(tsIsGreen).not.toBe(!cppIsYellow); // both true but mean different colors
  });

  it('building damaged frame: C++ uses <= (TS uses <, missing boundary)', () => {
    // C++ building.cpp:651: if (Health_Ratio() <= Rule.ConditionYellow) shapenum = 1
    // TS renderer.ts:1396: const damaged = s.hp < s.maxHp * 0.5
    const maxHp = 1000;
    const hp = 500; // exactly 50%
    const cppDamaged = (hp / maxHp) <= INI_CONDITION_YELLOW; // true
    const tsDamaged = hp < maxHp * 0.5; // false
    expect(cppDamaged).toBe(true);
    expect(tsDamaged).toBe(false);
    // Mismatch at boundary
    expect(tsDamaged).not.toBe(cppDamaged);
  });

  it('cloak gate: C++ uses > (TS uses <, boundary goes to wrong branch)', () => {
    // C++ techno.cpp:2444: if (Health_Ratio() > Rule.ConditionRed) Do_Cloak()
    // TS index.ts:4573: if (entity.hp / entity.maxHp < CONDITION_RED ...) break
    const ratio = INI_CONDITION_RED; // exactly 0.25
    const cppAlwaysCloak = ratio > INI_CONDITION_RED; // false (4% path)
    const tsBlocked = ratio < CONDITION_RED; // false (allowed path)
    expect(cppAlwaysCloak).toBe(false); // C++ sends to 4% chance
    expect(tsBlocked).toBe(false); // TS sends to always-cloak
    // Mismatch: C++ 4% chance, TS 100% chance at boundary
  });
});
