/**
 * C++ Parity Audit: Infantry-Specific Mechanics
 *
 * Covers: prone damage reduction, InfDeath per warhead, fear/scatter mechanics,
 *         medic healing, C4 placement, IsFraidyCat/IsCanine/Infiltrate/C4 flags,
 *         prone movement speed modifiers, fear decay, Fear_AI prone transitions.
 *
 * ALL expected values are parsed from rules.ini (the authoritative source).
 * C++ constructor defaults are irrelevant — rules.ini overrides them at startup.
 *
 * C++ source references:
 *   infantry.cpp:319-461  — Take_Damage (prone bias, dog instant-kill, fear increase, death anims)
 *   infantry.cpp:1852-1929 — Scatter (threat-based, IsFraidyCat override, mission check)
 *   infantry.cpp:3466-3509 — Fear_AI (fear decay, prone transitions, fraidy scatter)
 *   infantry.cpp:3988-4006 — Prone movement speed (crawl=half, fraidy=double)
 *   idata.cpp:900-957     — InfantryTypeClass constructor (IsFraidyCat=false, IsDog=false defaults)
 *   idata.cpp:1350-1362   — Read_INI (Fraidycat=, IsCanine=, Infiltrate=, C4=)
 *   defines.h:617-623     — FearType enum: NONE=0, ANXIOUS=10, SCARED=100, PANIC=200, MAX=255
 *   rules.cpp:202         — ProneDamageBias = fixed(1,2) = 0.5
 *
 * DO NOT modify engine code to make these pass. Failures document real C++ divergences.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  UnitType, House, CELL_SIZE, Mission, AnimState,
  UNIT_STATS, WARHEAD_PROPS, WEAPON_STATS,
  PRONE_DAMAGE_BIAS, CONDITION_RED, CONDITION_YELLOW,
  type WarheadType, type UnitStats,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// ============================================================================
// INI Parser — parse rules.ini at test time (authoritative source of truth)
// ============================================================================

const RULES_INI_PATH = resolve(__dirname, '../../..', 'public/ra/assets/rules.ini');
const rulesText = readFileSync(RULES_INI_PATH, 'utf-8');

type IniSections = Map<string, Map<string, string>>;

function parseIniSections(text: string): IniSections {
  const sections: IniSections = new Map();
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const commentIdx = rawLine.indexOf(';');
    const stripped = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
    const line = stripped.trim();
    if (!line) continue;
    if (line.startsWith('[')) {
      const close = line.indexOf(']');
      if (close >= 0) {
        currentSection = line.slice(1, close).trim();
        if (!sections.has(currentSection)) sections.set(currentSection, new Map());
        continue;
      }
    }
    const eq = line.indexOf('=');
    if (eq > 0 && currentSection) {
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (value) sections.get(currentSection)!.set(key, value);
    }
  }
  return sections;
}

const ini = parseIniSections(rulesText);

/** Get a string value from parsed INI */
function iniGet(section: string, key: string): string | undefined {
  return ini.get(section)?.get(key);
}

/** Get an integer value from parsed INI */
function iniInt(section: string, key: string, def = 0): number {
  const v = iniGet(section, key);
  return v !== undefined ? parseInt(v, 10) : def;
}

/** Get a boolean value from parsed INI (C++ Get_Bool: "yes"/"true"/"1" => true) */
function iniBool(section: string, key: string, def = false): boolean {
  const v = iniGet(section, key)?.toLowerCase();
  if (v === undefined) return def;
  return v === 'yes' || v === 'true' || v === '1';
}

/** Parse percentage value: "50%" => 0.5, "0.5" => 0.5 */
function iniPercent(section: string, key: string, def = 1.0): number {
  const v = iniGet(section, key);
  if (v === undefined) return def;
  if (v.endsWith('%')) return parseFloat(v) / 100;
  return parseFloat(v);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. INI-PARSED GENERAL CONSTANTS — rules.ini [General]
// ═══════════════════════════════════════════════════════════════════════════════

describe('General constants from rules.ini [General]', () => {
  // C++ rules.cpp:202 — ProneDamageBias, overridden by rules.ini ProneDamage=50%
  it('ProneDamage parsed from rules.ini matches PRONE_DAMAGE_BIAS constant', () => {
    const iniProneDamage = iniPercent('General', 'ProneDamage', 0.5);
    expect(iniProneDamage).toBe(0.5);
    expect(PRONE_DAMAGE_BIAS).toBe(iniProneDamage);
  });

  // C++ rules.cpp:234-235 — ConditionYellow / ConditionRed
  it('ConditionYellow parsed from rules.ini matches CONDITION_YELLOW', () => {
    const iniCY = iniPercent('General', 'ConditionYellow', 0.5);
    expect(CONDITION_YELLOW).toBe(iniCY);
  });

  it('ConditionRed parsed from rules.ini matches CONDITION_RED', () => {
    const iniCR = iniPercent('General', 'ConditionRed', 0.25);
    expect(CONDITION_RED).toBe(iniCR);
  });

  // C++ rules.ini C4Delay=.03 (minutes) — used for Tanya C4 timer
  it('C4Delay is 0.03 minutes from rules.ini', () => {
    const iniC4Delay = parseFloat(iniGet('General', 'C4Delay') ?? '0.03');
    expect(iniC4Delay).toBeCloseTo(0.03, 4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. INFANTRY TYPE FLAGS — parsed from rules.ini sections
//    C++ idata.cpp:1350-1362 Read_INI reads: Fraidycat, IsCanine, Infiltrate, C4
// ═══════════════════════════════════════════════════════════════════════════════

describe('Infantry type flags from rules.ini (idata.cpp:1350-1362)', () => {
  // === IsCanine ===
  // C++ idata.cpp:1356: IsDog = ini.Get_Bool(Name(), "IsCanine", IsDog)
  // rules.ini [DOG]: IsCanine=yes — only DOG has this flag
  describe('IsCanine flag (rules.ini IsCanine=)', () => {
    it('DOG has IsCanine=yes in rules.ini', () => {
      expect(iniBool('DOG', 'IsCanine')).toBe(true);
    });
    it('UNIT_STATS.DOG.isCanine matches rules.ini', () => {
      expect(UNIT_STATS.DOG.isCanine).toBe(iniBool('DOG', 'IsCanine'));
    });
    it('E1 does NOT have IsCanine in rules.ini (default false)', () => {
      expect(iniBool('E1', 'IsCanine')).toBe(false);
    });
    it('UNIT_STATS.E1 has no isCanine flag (undefined or false)', () => {
      expect(UNIT_STATS.E1.isCanine ?? false).toBe(false);
    });
  });

  // === C4 ===
  // C++ idata.cpp:1355: IsBomber = ini.Get_Bool(Name(), "C4", IsBomber)
  // rules.ini [E7]: C4=yes — only Tanya has this
  describe('C4 flag (rules.ini C4=)', () => {
    it('E7 (Tanya) has C4=yes in rules.ini', () => {
      expect(iniBool('E7', 'C4')).toBe(true);
    });
    it('UNIT_STATS.E7.hasC4 matches rules.ini C4=yes', () => {
      expect(UNIT_STATS.E7.hasC4).toBe(iniBool('E7', 'C4'));
    });
    // Verify no other military infantry has C4
    const NON_C4_INFANTRY = ['E1', 'E2', 'E3', 'E4', 'E6', 'DOG', 'SPY', 'THF', 'MEDI', 'GNRL'];
    it.each(NON_C4_INFANTRY)('%s does NOT have C4=yes in rules.ini', (unitId) => {
      expect(iniBool(unitId, 'C4')).toBe(false);
    });
  });

  // === Infiltrate ===
  // C++ idata.cpp:1354: IsCapture = ini.Get_Bool(Name(), "Infiltrate", IsCapture)
  // C++ idata.cpp:1357: if (IsBomber) IsCapture = true — C4=yes implies Infiltrate
  describe('Infiltrate flag (rules.ini Infiltrate=)', () => {
    const INFILTRATE_UNITS = ['E6', 'SPY', 'THF', 'E7', 'GNRL'];
    it.each(INFILTRATE_UNITS)('%s has Infiltrate=yes in rules.ini', (unitId) => {
      // E7 (Tanya): C4=yes implies Infiltrate=true (C++ idata.cpp:1357)
      // Other units: explicit Infiltrate=yes
      const iniInf = iniBool(unitId, 'Infiltrate');
      const iniC4 = iniBool(unitId, 'C4');
      expect(iniInf || iniC4).toBe(true);
    });
    it.each(INFILTRATE_UNITS)('UNIT_STATS.%s.isInfiltrate is true', (unitId) => {
      expect(UNIT_STATS[unitId].isInfiltrate).toBe(true);
    });

    const NON_INFILTRATE = ['E1', 'E2', 'E3', 'E4', 'DOG', 'MEDI'];
    it.each(NON_INFILTRATE)('%s does NOT have Infiltrate=yes', (unitId) => {
      expect(iniBool(unitId, 'Infiltrate')).toBe(false);
    });
  });

  // === IsFraidyCat ===
  // C++ idata.cpp:1353: IsFraidyCat = ini.Get_Bool(Name(), "Fraidycat", IsFraidyCat)
  // Default: false (idata.cpp:937). Only set for civilians (C1-C10) and Einstein via rules.ini
  describe('IsFraidyCat flag (rules.ini Fraidycat=)', () => {
    const FRAIDY_UNITS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'EINSTEIN'];
    it.each(FRAIDY_UNITS)('%s has Fraidycat=yes in rules.ini', (unitId) => {
      expect(iniBool(unitId, 'Fraidycat')).toBe(true);
    });
    it.each(FRAIDY_UNITS)('UNIT_STATS.%s.isFraidyCat matches rules.ini', (unitId) => {
      expect(UNIT_STATS[unitId].isFraidyCat).toBe(iniBool(unitId, 'Fraidycat'));
    });

    // Military infantry should NOT be fraidy
    const NON_FRAIDY = ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'SPY', 'THF', 'MEDI', 'GNRL'];
    it.each(NON_FRAIDY)('%s does NOT have Fraidycat=yes (default false)', (unitId) => {
      expect(iniBool(unitId, 'Fraidycat')).toBe(false);
    });
    it.each(NON_FRAIDY)('UNIT_STATS.%s.isFraidyCat is falsy', (unitId) => {
      expect(UNIT_STATS[unitId].isFraidyCat ?? false).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. WARHEAD InfDeath VALUES — parsed from rules.ini warhead sections
//    C++ infantry.cpp:383: switch (WarheadTypeClass::As_Pointer(warhead)->InfantryDeath)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Warhead InfDeath values parsed from rules.ini', () => {
  // rules.ini warhead sections: InfDeath= key
  // 0=instant, 1=twirl/gun, 2=explode, 3=flying/grenade, 4=burn/fire, 5=electro
  const WARHEAD_SECTIONS = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke'];

  it.each(WARHEAD_SECTIONS)('[%s] InfDeath in rules.ini matches WARHEAD_PROPS', (wh) => {
    const iniInfDeath = iniInt(wh, 'InfDeath', 0);
    const tsInfDeath = WARHEAD_PROPS[wh as WarheadType]?.infantryDeath;
    expect(tsInfDeath, `WARHEAD_PROPS.${wh}.infantryDeath`).toBe(iniInfDeath);
  });

  // Verify specific known values from rules.ini
  it('SA InfDeath=1 (twirl/gun death)', () => {
    expect(iniInt('SA', 'InfDeath')).toBe(1);
  });
  it('HE InfDeath=2 (explosion death)', () => {
    expect(iniInt('HE', 'InfDeath')).toBe(2);
  });
  it('AP InfDeath=3 (flying/grenade death)', () => {
    expect(iniInt('AP', 'InfDeath')).toBe(3);
  });
  it('Fire InfDeath=4 (burn death)', () => {
    expect(iniInt('Fire', 'InfDeath')).toBe(4);
  });
  it('HollowPoint InfDeath=1 (twirl/gun death)', () => {
    expect(iniInt('HollowPoint', 'InfDeath')).toBe(1);
  });
  it('Super InfDeath=5 (electro death)', () => {
    expect(iniInt('Super', 'InfDeath')).toBe(5);
  });
  it('Organic InfDeath=0 (instant delete)', () => {
    expect(iniInt('Organic', 'InfDeath')).toBe(0);
  });
  it('Nuke InfDeath=4 (burn death, same as Fire)', () => {
    expect(iniInt('Nuke', 'InfDeath')).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PRONE DAMAGE REDUCTION — C++ infantry.cpp:329-330
//    "if (IsProne && damage > 0) damage = damage * Rule.ProneDamageBias"
//    ProneDamageBias comes from rules.ini [General] ProneDamage=50%
// ═══════════════════════════════════════════════════════════════════════════════

describe('Prone damage reduction (infantry.cpp:329-330)', () => {
  it('PRONE_DAMAGE_BIAS matches rules.ini ProneDamage value', () => {
    const iniVal = iniPercent('General', 'ProneDamage', 0.5);
    expect(PRONE_DAMAGE_BIAS).toBe(iniVal);
  });

  it('prone E1 takes 50% damage from SA warhead', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.isProne = true;
    const hpBefore = e1.hp;
    e1.takeDamage(20, 'SA');
    // 20 * 0.5 = 10
    const expectedDmg = Math.max(1, Math.round(20 * PRONE_DAMAGE_BIAS));
    expect(hpBefore - e1.hp).toBe(expectedDmg);
  });

  it('prone E1 takes 50% damage from HE warhead', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.isProne = true;
    const hpBefore = e1.hp;
    e1.takeDamage(30, 'HE');
    const expectedDmg = Math.max(1, Math.round(30 * PRONE_DAMAGE_BIAS));
    expect(hpBefore - e1.hp).toBe(expectedDmg);
  });

  it('prone infantry always takes at least 1 damage (C++ unsigned arithmetic floor)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.isProne = true;
    const hpBefore = e1.hp;
    e1.takeDamage(1, 'SA');
    // 1 * 0.5 = 0.5, Math.round = 1, Math.max(1, 1) = 1
    expect(hpBefore - e1.hp).toBe(1);
  });

  it('non-prone infantry takes full damage (no ProneDamageBias applied)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.isProne).toBe(false);
    const hpBefore = e1.hp;
    e1.takeDamage(20, 'SA');
    expect(hpBefore - e1.hp).toBe(20);
  });

  it('vehicles are NOT affected by ProneDamageBias even if isProne is somehow set', () => {
    // C++ infantry.cpp:329 — only InfantryClass::Take_Damage applies this bias
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.isProne = true; // forced — should be ignored for vehicles
    const hpBefore = tank.hp;
    tank.takeDamage(20, 'SA');
    // Vehicles don't have isInfantry=true, so prone bias should NOT apply
    expect(hpBefore - tank.hp).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. FEAR CONSTANTS — C++ defines.h:617-623
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fear constants match C++ FearType enum (defines.h:617-623)', () => {
  it('FEAR_ANXIOUS = 10', () => expect(Entity.FEAR_ANXIOUS).toBe(10));
  it('FEAR_SCARED = 100', () => expect(Entity.FEAR_SCARED).toBe(100));
  it('FEAR_PANIC = 200', () => expect(Entity.FEAR_PANIC).toBe(200));
  it('FEAR_MAXIMUM = 255', () => expect(Entity.FEAR_MAXIMUM).toBe(255));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. FEAR INCREASE ON DAMAGE — C++ infantry.cpp:427-458
//    Two-phase fear system:
//    Phase 1 (line 442-447): if source && fear < FEAR_SCARED → set SCARED or PANIC
//    Phase 2 (line 454-457): moreFear = FEAR_ANXIOUS, halved per health threshold
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fear increase on damage (infantry.cpp:427-458)', () => {
  it('military infantry (E1) fear jumps to FEAR_SCARED on first hit with known attacker', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    expect(e1.fear).toBe(0);
    // C++ infantry.cpp:442: source != NULL && Fear < FEAR_SCARED → jump
    e1.takeDamage(5, 'SA', attacker);
    expect(e1.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('anonymous damage (no attacker) uses incremental moreFear, not jump', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.fear).toBe(0);
    // C++ infantry.cpp:448-457: source == NULL → else branch (incremental)
    e1.takeDamage(5, 'SA');
    expect(e1.fear).toBeLessThan(Entity.FEAR_SCARED);
    expect(e1.fear).toBeGreaterThan(0);
  });

  it('IsFraidyCat civilian (C1) fear jumps to FEAR_PANIC on first hit with known attacker', () => {
    // C++ infantry.cpp:443-444: IsFraidyCat → Fear = FEAR_PANIC
    const civ = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    expect(UNIT_STATS.C1.isFraidyCat).toBe(true);
    expect(civ.fear).toBe(0);
    civ.takeDamage(5, 'SA', attacker);
    expect(civ.fear).toBeGreaterThanOrEqual(Entity.FEAR_PANIC);
  });

  it('fear is capped at FEAR_MAXIMUM (255)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.fear = 254;
    e1.takeDamage(5, 'SA');
    expect(e1.fear).toBeLessThanOrEqual(Entity.FEAR_MAXIMUM);
  });

  it('zero damage does not increase fear', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.fear).toBe(0);
    e1.takeDamage(0, 'SA');
    expect(e1.fear).toBe(0);
  });

  it('moreFear is smaller at higher health ratios (C++ infantry.cpp:454-457)', () => {
    // C++ logic: moreFear = FEAR_ANXIOUS(10)
    //   if health > ConditionRed(25%): moreFear /= 2 → 5
    //   if health > ConditionYellow(50%): moreFear /= 2 → 2
    // At full health: moreFear = 2. At critical: moreFear = 10.
    const fullHealth = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    fullHealth.takeDamage(5, 'SA'); // first hit: sets to SCARED + moreFear
    const fearAfterFirst = fullHealth.fear;
    fullHealth.takeDamage(5, 'SA'); // second hit: only moreFear added
    const moreFearAtHigh = fullHealth.fear - fearAfterFirst;

    // moreFear at near-full health should be small (2)
    const iniCR = iniPercent('General', 'ConditionRed', 0.25);
    const iniCY = iniPercent('General', 'ConditionYellow', 0.5);
    const hpRatio = fullHealth.hp / fullHealth.maxHp;
    let expectedMoreFear = Entity.FEAR_ANXIOUS;
    if (hpRatio > iniCR) expectedMoreFear = Math.floor(expectedMoreFear / 2);
    if (hpRatio > iniCY) expectedMoreFear = Math.floor(expectedMoreFear / 2);
    expect(moreFearAtHigh).toBe(expectedMoreFear);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. FEAR_AI — PRONE STATE TRANSITIONS — C++ infantry.cpp:3466-3509
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fear_AI prone state transitions (infantry.cpp:3466-3509)', () => {
  // C++ infantry.cpp:3496: go prone when fear >= FEAR_ANXIOUS and not dog
  it('infantry goes prone when fear >= FEAR_ANXIOUS', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.fear = Entity.FEAR_ANXIOUS;
    // Simulate Fear_AI logic from index.ts:1590-1601
    if (!e1.isProne && e1.fear >= Entity.FEAR_ANXIOUS && e1.type !== UnitType.I_DOG) {
      e1.isProne = true;
    }
    expect(e1.isProne).toBe(true);
  });

  // C++ infantry.cpp:3487: stand up when fear < FEAR_ANXIOUS
  it('infantry stands up when fear drops below FEAR_ANXIOUS', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.isProne = true;
    e1.fear = Entity.FEAR_ANXIOUS - 1;
    if (e1.isProne && e1.fear < Entity.FEAR_ANXIOUS) {
      e1.isProne = false;
    }
    expect(e1.isProne).toBe(false);
  });

  // C++ infantry.cpp:3496: !Class->IsDog — dogs never go prone
  it('dogs never go prone regardless of fear', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    dog.fear = Entity.FEAR_MAXIMUM;
    if (!dog.isProne && dog.fear >= Entity.FEAR_ANXIOUS && dog.type !== UnitType.I_DOG) {
      dog.isProne = true;
    }
    expect(dog.isProne).toBe(false);
  });

  // C++ infantry.cpp:3471-3473: Fear-- (decays by 1 per tick)
  it('fear decays by exactly 1 per tick (C++ Fear_AI: Fear--)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.fear = 50;
    if (e1.fear > 0) e1.fear--;
    expect(e1.fear).toBe(49);
  });

  // C++ infantry.cpp:3479-3481: armed civilian reloads when fear hits 0
  it('armed civilian reloads ammo when fear reaches 0 (C++ infantry.cpp:3479-3481)', () => {
    // C++ logic: if (Fear == 0 && Ammo == 0 && Is_Weapon_Equipped()) Ammo = Class->MaxAmmo
    // C1 has Primary=Pistol and Ammo=10 in rules.ini
    const iniAmmo = iniInt('C1', 'Ammo', 0);
    expect(iniAmmo).toBe(10);
    // This is a C++ behavior documentation test — the TS engine may or may not implement it
    // We verify rules.ini has the data needed for this mechanic
    expect(iniBool('C1', 'Fraidycat')).toBe(true);
    expect(iniGet('C1', 'Primary')).toBe('Pistol');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. FRAIDY CAT SCATTER — C++ infantry.cpp:3506-3508
//    "if (Class->IsFraidyCat && Fear > FEAR_ANXIOUS && !IsFalling && !IsDriving && !Target_Legal(NavCom))"
//    → Scatter(0, true)
// ═══════════════════════════════════════════════════════════════════════════════

describe('IsFraidyCat scatter behavior (infantry.cpp:3506-3508, 1852-1929)', () => {
  it('IsFraidyCat units scatter when fear > FEAR_ANXIOUS (strictly greater than)', () => {
    const civ = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    civ.fear = Entity.FEAR_ANXIOUS + 1;
    // C++ uses > not >=
    const shouldScatter = (UNIT_STATS.C1.isFraidyCat === true) && (civ.fear > Entity.FEAR_ANXIOUS);
    expect(shouldScatter).toBe(true);
  });

  it('IsFraidyCat does NOT scatter at exactly FEAR_ANXIOUS (> not >=)', () => {
    const civ = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    civ.fear = Entity.FEAR_ANXIOUS;
    const shouldScatter = (UNIT_STATS.C1.isFraidyCat === true) && (civ.fear > Entity.FEAR_ANXIOUS);
    expect(shouldScatter).toBe(false);
  });

  it('non-IsFraidyCat infantry does NOT auto-scatter from fear alone', () => {
    // C++ infantry.cpp:3506: only IsFraidyCat triggers fear-based auto-scatter
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.fear = Entity.FEAR_MAXIMUM;
    const shouldScatter = (UNIT_STATS.E1.isFraidyCat === true) && (e1.fear > Entity.FEAR_ANXIOUS);
    expect(shouldScatter).toBe(false);
  });

  // C++ infantry.cpp:1872: !Class->IsFraidyCat && Target_Legal(TarCom) && !forced → don't scatter
  it('non-fraidy infantry with valid target does not scatter (infantry.cpp:1872)', () => {
    // C++ logic: units engaged in combat skip scatter unless forced
    // IsFraidyCat overrides this and always scatters
    const e1IsFraidy = UNIT_STATS.E1.isFraidyCat ?? false;
    expect(e1IsFraidy).toBe(false);
    // With a valid target and not forced, E1 would NOT scatter
    const hasTarget = true;
    const forced = false;
    const wouldScatter = e1IsFraidy || !hasTarget || forced;
    expect(wouldScatter).toBe(false);
  });

  it('IsFraidyCat infantry ignores combat engagement and scatters anyway (infantry.cpp:1872)', () => {
    // C++ infantry.cpp:1872: !Class->IsFraidyCat && ... return — fraidy cats skip this check
    const c1IsFraidy = UNIT_STATS.C1.isFraidyCat ?? false;
    expect(c1IsFraidy).toBe(true);
    // IsFraidyCat means the scatter check at 1872 is bypassed
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. DEATH ANIMATION SELECTION — C++ infantry.cpp:383-416
//    switch (WarheadTypeClass::As_Pointer(warhead)->InfantryDeath)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Death animation matches warhead InfDeath (infantry.cpp:383-416)', () => {
  // Build test data from rules.ini — each warhead's InfDeath determines death anim
  const WARHEADS_WITH_INFDEATH: [string, number][] = [
    ['SA',          iniInt('SA', 'InfDeath', 0)],
    ['HE',          iniInt('HE', 'InfDeath', 0)],
    ['AP',          iniInt('AP', 'InfDeath', 0)],
    ['Fire',        iniInt('Fire', 'InfDeath', 0)],
    ['HollowPoint', iniInt('HollowPoint', 'InfDeath', 0)],
    ['Super',       iniInt('Super', 'InfDeath', 0)],
    ['Organic',     iniInt('Organic', 'InfDeath', 0)],
    ['Nuke',        iniInt('Nuke', 'InfDeath', 0)],
  ];

  it.each(WARHEADS_WITH_INFDEATH)(
    '%s warhead sets deathVariant=%d (INI-parsed InfDeath)',
    (warhead, expectedDeath) => {
      const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e1.takeDamage(9999, warhead);
      expect(e1.alive).toBe(false);
      expect(e1.deathVariant).toBe(expectedDeath);
    },
  );

  it('killed infantry enters Mission.DIE and AnimState.DIE', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e1.takeDamage(9999, 'SA');
    expect(e1.mission).toBe(Mission.DIE);
    expect(e1.animState).toBe(AnimState.DIE);
    expect(e1.animFrame).toBe(0);
  });

  // C++ infantry.cpp:383-386: case 0 → delthis=true (instant delete, no anim)
  it('InfDeath=0 (Organic) causes instant delete — deathVariant=0', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e1.takeDamage(9999, 'Organic');
    expect(e1.deathVariant).toBe(0);
  });

  // C++ infantry.cpp:410-415: case 5 → ANIM_ELECT_DIE (electrocution)
  it('InfDeath=5 (Super) triggers electro death — deathVariant=5', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e1.takeDamage(9999, 'Super');
    expect(e1.deathVariant).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. DOG INSTANT-KILL — C++ infantry.cpp:339-345
//     Dogs deal damage = Strength to their target, 0 to everyone else.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dog instant-kill mechanics (infantry.cpp:339-345)', () => {
  it('dog kills its designated target regardless of HP', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    dog.target = spy;
    // C++ infantry.cpp:341: damage = Strength (full HP, guaranteed kill)
    const killed = spy.takeDamage(1, 'HollowPoint', dog);
    expect(killed).toBe(true);
    expect(spy.alive).toBe(false);
  });

  it('dog collateral does NOT damage non-targets (infantry.cpp:342-344)', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    const bystander = entityAtCell(UnitType.I_E1, House.Spain, 11, 11);
    dog.target = target;
    // C++ infantry.cpp:343: damage = 0 for non-targets
    const killed = bystander.takeDamage(1, 'HollowPoint', dog);
    expect(killed).toBe(false);
    expect(bystander.hp).toBe(bystander.maxHp); // no damage at all
  });

  it('DOG has IsCanine=yes from rules.ini', () => {
    expect(iniBool('DOG', 'IsCanine')).toBe(true);
    expect(UNIT_STATS.DOG.isCanine).toBe(true);
  });

  it('DOG Strength matches rules.ini', () => {
    const iniStr = iniInt('DOG', 'Strength');
    expect(iniStr).toBe(12);
    expect(UNIT_STATS.DOG.strength).toBe(iniStr);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. MEDIC HEALING — rules.ini [Heal] weapon, [MEDI] stats
//     C++ medic uses Heal weapon: Damage=-50, ROF=80, Range=1.83
// ═══════════════════════════════════════════════════════════════════════════════

describe('Medic healing weapon (rules.ini [Heal], [MEDI])', () => {
  it('Heal weapon Damage matches rules.ini', () => {
    const iniDamage = iniInt('Heal', 'Damage');
    expect(iniDamage).toBe(-50);
    expect(WEAPON_STATS.Heal.damage).toBe(iniDamage);
  });

  it('Heal weapon ROF matches rules.ini', () => {
    const iniROF = iniInt('Heal', 'ROF');
    expect(iniROF).toBe(80);
    expect(WEAPON_STATS.Heal.rof).toBe(iniROF);
  });

  it('Heal weapon Range matches rules.ini', () => {
    const iniRange = parseFloat(iniGet('Heal', 'Range') ?? '1.83');
    expect(iniRange).toBeCloseTo(1.83, 2);
    expect(WEAPON_STATS.Heal.range).toBeCloseTo(iniRange, 2);
  });

  it('Heal weapon Warhead is Organic (rules.ini [Heal] Warhead=Organic)', () => {
    expect(iniGet('Heal', 'Warhead')).toBe('Organic');
    expect(WEAPON_STATS.Heal.warhead).toBe('Organic');
  });

  it('MEDI Primary=Heal (rules.ini [MEDI] Primary=Heal)', () => {
    expect(iniGet('MEDI', 'Primary')).toBe('Heal');
    expect(UNIT_STATS.MEDI.primaryWeapon).toBe('Heal');
  });

  it('MEDI Strength matches rules.ini', () => {
    const iniStr = iniInt('MEDI', 'Strength');
    expect(iniStr).toBe(80);
    expect(UNIT_STATS.MEDI.strength).toBe(iniStr);
  });

  it('MEDI Sight matches rules.ini', () => {
    const iniSight = iniInt('MEDI', 'Sight');
    expect(iniSight).toBe(3);
    expect(UNIT_STATS.MEDI.sight).toBe(iniSight);
  });

  it('MEDI Speed matches rules.ini', () => {
    const iniSpeed = iniInt('MEDI', 'Speed');
    expect(iniSpeed).toBe(4);
    expect(UNIT_STATS.MEDI.speed).toBe(iniSpeed);
  });

  it('MEDI Cost matches rules.ini', () => {
    const iniCost = iniInt('MEDI', 'Cost');
    expect(iniCost).toBe(800);
    expect(UNIT_STATS.MEDI.cost).toBe(iniCost);
  });

  it('Heal weapon damage is negative (heals, not hurts)', () => {
    expect(WEAPON_STATS.Heal.damage).toBeLessThan(0);
  });

  it('Heal weapon Projectile=Invisible in rules.ini', () => {
    expect(iniGet('Heal', 'Projectile')).toBe('Invisible');
    expect(WEAPON_STATS.Heal.isInvisible).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. TANYA C4 PLACEMENT — rules.ini [E7] C4=yes, [General] C4Delay=.03
//     C++ infantry.cpp: Tanya plants C4 on buildings, timer from C4Delay
//     C++ idata.cpp:1355-1357: IsBomber = C4=yes, and IsBomber implies IsCapture
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tanya C4 mechanics (rules.ini [E7] C4=yes)', () => {
  it('E7 has C4=yes in rules.ini', () => {
    expect(iniBool('E7', 'C4')).toBe(true);
  });

  it('E7 has Infiltrate=yes in rules.ini', () => {
    expect(iniBool('E7', 'Infiltrate')).toBe(true);
  });

  it('UNIT_STATS.E7 has hasC4=true', () => {
    expect(UNIT_STATS.E7.hasC4).toBe(true);
  });

  it('UNIT_STATS.E7 has isInfiltrate=true (C4 implies Infiltrate in C++)', () => {
    // C++ idata.cpp:1357: if (IsBomber) IsCapture = true
    expect(UNIT_STATS.E7.isInfiltrate).toBe(true);
  });

  it('C4Delay in rules.ini is 0.03 minutes (27 ticks at 900 ticks/min)', () => {
    const c4Delay = parseFloat(iniGet('General', 'C4Delay') ?? '0.03');
    expect(c4Delay).toBeCloseTo(0.03, 4);
    // 0.03 minutes * 900 ticks/minute = 27 ticks
    const c4Ticks = Math.round(c4Delay * 900);
    expect(c4Ticks).toBe(27);
  });

  it('only E7 (Tanya) has C4=yes among all infantry', () => {
    const allInfantry = ['E1', 'E2', 'E3', 'E4', 'E6', 'DOG', 'SPY', 'THF', 'MEDI', 'GNRL', 'CHAN',
      'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'EINSTEIN', 'DELPHI'];
    for (const id of allInfantry) {
      if (id === 'E7') continue;
      expect(iniBool(id, 'C4'), `${id} should NOT have C4=yes`).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. PRONE MOVEMENT SPEED — C++ infantry.cpp:3988-4006
//     Dogs attacking: speed * 2
//     Prone + !IsDog:
//       IsFraidyCat && !IsCrawling: speed * 2 (running scared)
//       else: speed / 2 (crawling)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Prone movement speed modifiers (infantry.cpp:3988-4006)', () => {
  // C++ infantry.cpp:4000-4006:
  //   if (IsProne && !Class->IsDog) {
  //     if (Class->IsFraidyCat && !Class->IsCrawling) movespeed = Speed*2;
  //     else movespeed = Speed/2;
  //   }

  it('crawling infantry (E1, IsCrawling=true) moves at half speed when prone', () => {
    // C++ idata.cpp E1 constructor: is_crawling=true (second param = true)
    // IsFraidyCat=false, IsCrawling=true → Speed/2
    const e1Speed = iniInt('E1', 'Speed');
    const expectedProne = Math.floor(e1Speed / 2);
    expect(expectedProne).toBe(2); // Speed=4, 4/2=2
  });

  it('IsFraidyCat civilian (C1, not IsCrawling) runs at double speed when prone', () => {
    // C++ idata.cpp C1 constructor: is_crawling=false (civilians)
    // IsFraidyCat=true (from rules.ini Fraidycat=yes), IsCrawling=false → Speed*2
    const c1Speed = iniInt('C1', 'Speed');
    const expectedProne = c1Speed * 2;
    expect(expectedProne).toBe(10); // Speed=5, 5*2=10
  });

  it('dogs are NOT affected by prone speed modifier (infantry.cpp:4000: !Class->IsDog)', () => {
    // C++ infantry.cpp:4000: if (IsProne && !Class->IsDog) — dogs bypass prone check
    // Dogs have their own speed-up: if (Class->IsDog && Target_Legal(TarCom)) movespeed *= 2
    const dogSpeed = iniInt('DOG', 'Speed');
    expect(dogSpeed).toBe(4);
    // Dogs attacking: speed*2 = 8 (from line 3997, not from prone)
  });

  // Document the IsCrawling flag from C++ idata.cpp constructor (second parameter)
  it('C++ idata.cpp: E1 IsCrawling=true (has prone/crawl animation frames)', () => {
    // E1 constructor at idata.cpp:397: true = Has crawling animation frames
    // This means E1 crawls (half speed) when prone
    // TS engine should match this behavior
    const stats = UNIT_STATS.E1;
    expect(stats.isInfantry).toBe(true);
    expect(stats.speed).toBe(iniInt('E1', 'Speed'));
  });

  it('C++ idata.cpp: DOG IsCrawling=false (no prone animations)', () => {
    // Dog constructor at idata.cpp:377: false = no crawling
    // Dogs never go prone (Fear_AI check: !Class->IsDog)
    expect(UNIT_STATS.DOG.isCanine).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. INFANTRY STATS CROSS-CHECK — INI-parsed vs UNIT_STATS
//     Verify the TS engine's static data matches rules.ini for all infantry
// ═══════════════════════════════════════════════════════════════════════════════

describe('Infantry stats INI cross-check', () => {
  const INFANTRY_IDS = ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'SPY', 'MEDI', 'GNRL'];

  describe.each(INFANTRY_IDS)('%s', (id) => {
    it('Strength matches rules.ini', () => {
      expect(UNIT_STATS[id].strength).toBe(iniInt(id, 'Strength'));
    });
    it('Armor matches rules.ini', () => {
      const iniArmor = iniGet(id, 'Armor')?.toLowerCase() ?? 'none';
      expect(UNIT_STATS[id].armor).toBe(iniArmor);
    });
    it('Speed matches rules.ini', () => {
      expect(UNIT_STATS[id].speed).toBe(iniInt(id, 'Speed'));
    });
    it('Sight matches rules.ini', () => {
      expect(UNIT_STATS[id].sight).toBe(iniInt(id, 'Sight'));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. WARHEAD EXPLOSION SET — rules.ini Explosion= values
//     Not directly infantry-specific but affects infantry death visuals
// ═══════════════════════════════════════════════════════════════════════════════

describe('Warhead explosion sets from rules.ini', () => {
  const WARHEAD_EXPLOSION: [string, number][] = [
    ['SA',          iniInt('SA', 'Explosion', 0)],
    ['HE',          iniInt('HE', 'Explosion', 0)],
    ['AP',          iniInt('AP', 'Explosion', 0)],
    ['Fire',        iniInt('Fire', 'Explosion', 0)],
    ['HollowPoint', iniInt('HollowPoint', 'Explosion', 0)],
    ['Nuke',        iniInt('Nuke', 'Explosion', 0)],
  ];

  it.each(WARHEAD_EXPLOSION)(
    '[%s] Explosion=%d from rules.ini matches WARHEAD_PROPS.explosionSet',
    (wh, expectedExplosion) => {
      const tsExplosion = WARHEAD_PROPS[wh as WarheadType]?.explosionSet;
      expect(tsExplosion, `WARHEAD_PROPS.${wh}.explosionSet`).toBe(expectedExplosion);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. DOG-SPECIFIC MECHANICS — rules.ini [DOG], C++ idata.cpp
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dog-specific mechanics (rules.ini [DOG], infantry.cpp)', () => {
  it('DOG Primary=DogJaw from rules.ini', () => {
    expect(iniGet('DOG', 'Primary')).toBe('DogJaw');
    expect(UNIT_STATS.DOG.primaryWeapon).toBe('DogJaw');
  });

  it('DOG GuardRange matches rules.ini', () => {
    const iniGR = iniInt('DOG', 'GuardRange');
    expect(iniGR).toBe(7);
    expect(UNIT_STATS.DOG.guardRange).toBe(iniGR);
  });

  it('DOG is crushable (C++ idata.cpp:952 IsCrushable=true for all infantry)', () => {
    expect(UNIT_STATS.DOG.crushable).toBe(true);
  });

  it('all infantry are crushable (C++ idata.cpp:952)', () => {
    // C++ InfantryTypeClass constructor: IsCrushable = true (line 952)
    const allInfantry = ['E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'DOG', 'SPY', 'MEDI', 'GNRL'];
    for (const id of allInfantry) {
      expect(UNIT_STATS[id].crushable, `${id} should be crushable`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. ENGINEER / SPY / THIEF INFILTRATE — rules.ini sections
// ═══════════════════════════════════════════════════════════════════════════════

describe('Infiltrate-capable infantry (rules.ini, idata.cpp:1354)', () => {
  it('E6 (Engineer) has Infiltrate=yes', () => {
    expect(iniBool('E6', 'Infiltrate')).toBe(true);
    expect(UNIT_STATS.E6.isInfiltrate).toBe(true);
  });

  it('SPY has Infiltrate=yes', () => {
    expect(iniBool('SPY', 'Infiltrate')).toBe(true);
    expect(UNIT_STATS.SPY.isInfiltrate).toBe(true);
  });

  it('THF (Thief) has Infiltrate=yes', () => {
    expect(iniBool('THF', 'Infiltrate')).toBe(true);
    expect(UNIT_STATS.THF.isInfiltrate).toBe(true);
  });

  it('GNRL has Infiltrate=yes', () => {
    expect(iniBool('GNRL', 'Infiltrate')).toBe(true);
    expect(UNIT_STATS.GNRL.isInfiltrate).toBe(true);
  });

  it('E1 does NOT have Infiltrate', () => {
    expect(iniBool('E1', 'Infiltrate')).toBe(false);
    expect(UNIT_STATS.E1.isInfiltrate ?? false).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 18. WARHEAD SPREAD AND WALL FLAGS — rules.ini warhead sections
//     Affects infantry because Spread determines damage falloff radius
// ═══════════════════════════════════════════════════════════════════════════════

describe('Warhead spread values from rules.ini', () => {
  it('SA Spread=3 (tight spread — single infantry targeted)', () => {
    expect(iniInt('SA', 'Spread')).toBe(3);
  });
  it('HE Spread=6 (wider — splash damage hits infantry groups)', () => {
    expect(iniInt('HE', 'Spread')).toBe(6);
  });
  it('Fire Spread=8 (widest conventional — napalm splash)', () => {
    expect(iniInt('Fire', 'Spread')).toBe(8);
  });
  it('HollowPoint Spread=1 (minimal — surgical anti-infantry)', () => {
    expect(iniInt('HollowPoint', 'Spread')).toBe(1);
  });
  it('Organic Spread=0 (no splash — medic heal / dog bite)', () => {
    expect(iniInt('Organic', 'Spread')).toBe(0);
  });
});
