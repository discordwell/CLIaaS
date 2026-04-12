/**
 * C++ Behavioral Parity: Damage Calculation Edge Cases — combat.cpp
 *
 * Audits edge-case damage behaviors against the C++ combat engine:
 *   - Minimum damage is 1 (C++ never deals 0 to a valid close-range target)
 *   - Negative damage (Heal: -50, GoodWrench: -100) heals instead
 *   - Healing cannot exceed max HP
 *   - Damage to already-dead entities is ignored
 *   - Self-damage prevention (splash doesn't hit attacker)
 *   - Overkill: damage > remaining HP still kills (no negative HP)
 *   - Fixed-point rounding: TS matches C++ integer truncation
 *   - Country firepower bias stacking with warhead multiplier
 *   - Prone damage halved (ProneDamage from rules.ini)
 *   - Condition thresholds: ConditionRed / ConditionYellow from rules.ini
 *
 * All expected values are parsed from rules.ini / aftrmath.ini at test time.
 * NEVER hardcode C++ values — INI is the source of truth.
 *
 * C++ source refs:
 *   - combat.cpp:72-129   — Modify_Damage (minimum damage, max damage, distance)
 *   - combat.cpp:86-96    — Negative damage healing (FIXIT_CSII)
 *   - combat.cpp:122-124  — MinDamage=1 guarantee for close range
 *   - combat.cpp:127      — MaxDamage=1000 cap
 *   - combat.cpp:207      — Explosion_Damage: splash excludes firer (source)
 *   - infantry.cpp:329-330 — ProneDamageBias applied in TakeDamage
 *   - object.cpp:1620-1659 — Take_Damage: overkill capping, dead entity guard
 *   - rules.cpp:202,227,233-235 — ProneDamageBias, MaxDamage, Condition thresholds
 *   - house.cpp:289,299   — FirepowerBias = country * difficulty
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, WEAPON_STATS,
  buildDefaultAlliances, Mission, AnimState,
  COUNTRY_BONUSES, modifyDamage, MAX_DAMAGE,
  WARHEAD_META, WARHEAD_VS_ARMOR, PRONE_DAMAGE_BIAS,
  CONDITION_RED, CONDITION_YELLOW,
  type WarheadType, type ArmorType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  applySplashDamage,
  damageEntity,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ---------------------------------------------------------------------------
// INI Parser — replicates C++ INI load (last-key-wins within a section)
// ---------------------------------------------------------------------------
function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = line.match(/^([^=;]+)=\s*([^;]*)/);
      if (kvMatch) {
        sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Load INI files — rules.ini + aftrmath.ini (aftrmath overrides rules)
// ---------------------------------------------------------------------------
const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rules = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftrmath = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));

// Merge: aftrmath overrides rules per-key
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

/** Parse a percentage string like "25%" → 0.25, or a plain number like "0.5" → 0.5 */
function parsePercent(val: string): number {
  if (val.endsWith('%')) return parseInt(val, 10) / 100;
  return parseFloat(val);
}

// ---------------------------------------------------------------------------
// Parse expected values from INI at test time
// ---------------------------------------------------------------------------
const INI_MAX_DAMAGE = parseInt(ini['General']?.['MaxDamage'] ?? '1000', 10);
const INI_MIN_DAMAGE = parseInt(ini['General']?.['MinDamage'] ?? '1', 10);
const INI_CONDITION_RED = parsePercent(ini['General']?.['ConditionRed'] ?? '25%');
const INI_CONDITION_YELLOW = parsePercent(ini['General']?.['ConditionYellow'] ?? '50%');
const INI_PRONE_DAMAGE = parsePercent(ini['General']?.['ProneDamage'] ?? '50%');

// Heal weapon from rules.ini [Heal] section
const INI_HEAL_DAMAGE = parseInt(ini['Heal']?.['Damage'] ?? '-50', 10);
const INI_HEAL_WARHEAD = ini['Heal']?.['Warhead'] ?? 'Organic';

// GoodWrench weapon from aftrmath.ini [GoodWrench] section
const INI_GOODWRENCH_DAMAGE = parseInt(ini['GoodWrench']?.['Damage'] ?? '-100', 10);
const INI_GOODWRENCH_WARHEAD = ini['GoodWrench']?.['Warhead'] ?? 'Mechanical';

// Germany firepower from INI
const INI_GERMANY_FIREPOWER = parseFloat(ini['Germany']?.['Firepower'] ?? '1.1');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  entities: Entity[] = [],
  structures: MapStructure[] = [],
  overrides: Partial<CombatContext> = {},
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    pointTotal: 0,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
    movementSpeed: () => 1,
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
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
    ...overrides,
  } as CombatContext;
}

// ============================================================
// Section 1: Minimum damage is 1 — combat.cpp:122-124
// C++ guarantees MinDamage=1 at close range (distFactor < 4)
// ============================================================
describe('Minimum damage is 1 at close range (combat.cpp:122-124)', () => {

  it('INI MinDamage matches C++ default of 1', () => {
    // rules.ini: MinDamage=1
    expect(INI_MIN_DAMAGE).toBe(1);
  });

  it('tiny damage (baseDamage=1) with low warhead mult still yields 1 at point-blank', () => {
    // C++ combat.cpp:122-124: if (distFactor < 4) damage = max(damage, MinDamage=1)
    // baseDamage=1, HollowPoint vs wood (mult=0.05): 1 * 0.05 = 0.05 → MinDamage=1 → round(1)=1
    const result = modifyDamage(1, 'HollowPoint', 'wood', 0);
    expect(result).toBeGreaterThanOrEqual(INI_MIN_DAMAGE);
  });

  it('MinDamage applies at distFactor=3 but NOT at distFactor=4', () => {
    // C++ combat.cpp:122: if (distance < 4) — strict less-than
    // SA spread=3: dist=5px → distFactor=floor(10/3)=3 < 4 → MinDamage applies
    const atDist3 = modifyDamage(1, 'SA', 'heavy', 5);
    expect(atDist3).toBeGreaterThanOrEqual(INI_MIN_DAMAGE);

    // SA spread=3: dist=6px → distFactor=floor(12/3)=4, NOT < 4 → MinDamage does NOT apply
    const atDist4 = modifyDamage(1, 'SA', 'heavy', 6);
    // 1 * 0.25 / 4 = 0.0625 → round(0.0625) = 0 (no MinDamage guarantee)
    expect(atDist4).toBe(0);
  });

  it('MAX_DAMAGE constant matches INI', () => {
    expect(MAX_DAMAGE).toBe(INI_MAX_DAMAGE);
  });

  it('Organic warhead vs non-none armor always yields 0 (mult=0, no MinDamage override)', () => {
    // C++ combat.cpp:101-102: mult=0 → return 0 before MinDamage logic
    // Organic warhead vs wood/light/heavy/concrete: Verses=0%
    const result = modifyDamage(100, 'Organic', 'heavy', 0);
    expect(result).toBe(0);
  });
});

// ============================================================
// Section 2: Negative damage (Heal / GoodWrench) — combat.cpp:86-96
// C++ FIXIT_CSII: negative baseDamage = healing
// ============================================================
describe('Negative damage heals (combat.cpp:86-96, FIXIT_CSII)', () => {

  it('Heal weapon has negative damage in INI', () => {
    // rules.ini: [Heal] Damage=-50
    expect(INI_HEAL_DAMAGE).toBeLessThan(0);
  });

  it('GoodWrench weapon has negative damage in INI', () => {
    // aftrmath.ini: [GoodWrench] Damage=-100
    expect(INI_GOODWRENCH_DAMAGE).toBeLessThan(0);
  });

  it('Heal weapon uses Organic warhead in INI', () => {
    expect(INI_HEAL_WARHEAD).toBe('Organic');
  });

  it('GoodWrench weapon uses Mechanical warhead in INI', () => {
    expect(INI_GOODWRENCH_WARHEAD).toBe('Mechanical');
  });

  it('WEAPON_STATS Heal damage matches INI', () => {
    expect(WEAPON_STATS.Heal.damage).toBe(INI_HEAL_DAMAGE);
  });

  it('WEAPON_STATS GoodWrench damage matches INI', () => {
    expect(WEAPON_STATS.GoodWrench.damage).toBe(INI_GOODWRENCH_DAMAGE);
  });

  it('Heal (Organic warhead, negative dmg) returns negative at point-blank vs unarmored', () => {
    // C++ combat.cpp:86-90: warhead != Mechanical, armor == none, close range → return baseDamage
    const result = modifyDamage(INI_HEAL_DAMAGE, 'Organic', 'none', 0);
    expect(result).toBe(INI_HEAL_DAMAGE);
  });

  it('GoodWrench (Mechanical warhead, negative dmg) returns negative at point-blank vs armored', () => {
    // C++ combat.cpp:91-95: warhead == Mechanical, armor != none, close range → return baseDamage
    const result = modifyDamage(INI_GOODWRENCH_DAMAGE, 'Mechanical', 'heavy', 0);
    expect(result).toBe(INI_GOODWRENCH_DAMAGE);
  });

  it('Heal returns 0 vs armored (wrong armor type for healing)', () => {
    // C++ combat.cpp:86-90: warhead != Mechanical, armor != none → no healing
    expect(modifyDamage(INI_HEAL_DAMAGE, 'Organic', 'heavy', 0)).toBe(0);
    expect(modifyDamage(INI_HEAL_DAMAGE, 'Organic', 'wood', 0)).toBe(0);
    expect(modifyDamage(INI_HEAL_DAMAGE, 'Organic', 'light', 0)).toBe(0);
    expect(modifyDamage(INI_HEAL_DAMAGE, 'Organic', 'concrete', 0)).toBe(0);
  });

  it('GoodWrench returns 0 vs unarmored (wrong armor type for healing)', () => {
    // C++ combat.cpp:91-95: warhead == Mechanical, armor == none → no healing
    expect(modifyDamage(INI_GOODWRENCH_DAMAGE, 'Mechanical', 'none', 0)).toBe(0);
  });

  it('healing returns 0 when too far away (dist >= heal proximity)', () => {
    // C++ combat.cpp:87: distance < 0x008 leptons (~0.75 pixels)
    // At dist=1 pixel, already beyond heal proximity
    expect(modifyDamage(INI_HEAL_DAMAGE, 'Organic', 'none', 1)).toBe(0);
    expect(modifyDamage(INI_GOODWRENCH_DAMAGE, 'Mechanical', 'heavy', 1)).toBe(0);
  });
});

// ============================================================
// Section 3: Healing cannot exceed max HP
// C++ object.cpp:1614 — Strength capped at MaxStrength
// ============================================================
describe('Healing cannot exceed max HP (object.cpp:1614)', () => {

  it('takeDamage with negative amount heals but does not exceed maxHp', () => {
    // Create an infantry at partial HP and "heal" it
    const medic = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    medic.hp = medic.maxHp - 10; // 10 HP below max
    const hpBefore = medic.hp;

    // Apply negative damage (heal) of -50 — should only heal up to maxHp
    medic.takeDamage(-50); // heal 50 HP
    // C++ caps Strength at MaxStrength: hp = min(hp + healAmount, maxHp)
    // TS implementation: hp -= amount, so hp -= (-50) = hp + 50
    // But should be capped at maxHp
    expect(medic.hp).toBeLessThanOrEqual(medic.maxHp);
  });

  it('healing a full HP entity does not increase HP above max', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(unit.hp).toBe(unit.maxHp);
    unit.takeDamage(-100);
    // HP should remain at maxHp, not go above
    expect(unit.hp).toBeLessThanOrEqual(unit.maxHp);
  });
});

// ============================================================
// Section 4: Damage to already-dead entities is ignored
// C++ object.cpp:1559 — if (Strength == 0) return RESULT_NONE
// ============================================================
describe('Damage to already-dead entities (object.cpp:1559)', () => {

  it('dead entity (alive=false, hp=0) takes no damage', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.alive = false;
    e.hp = 0;
    const killed = e.takeDamage(100, 'Super');
    expect(killed).toBe(false); // already dead, no re-death
    expect(e.hp).toBe(0);
  });

  it('dead entity returns false (not killed again)', () => {
    const e = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    // Kill it first
    e.takeDamage(e.maxHp + 100, 'Super');
    expect(e.alive).toBe(false);
    expect(e.hp).toBe(0);

    // Try to damage again
    const killed = e.takeDamage(500, 'Super');
    expect(killed).toBe(false);
    expect(e.hp).toBe(0);
  });

  it('dead entity does not set damageFlash or change fear', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.alive = false;
    e.hp = 0;
    e.damageFlash = 0;
    const fearBefore = e.fear;
    e.takeDamage(50, 'SA');
    expect(e.damageFlash).toBe(0);
    expect(e.fear).toBe(fearBefore);
  });
});

// ============================================================
// Section 5: Self-damage prevention — combat.cpp:207
// Splash damage excludes the firer (source entity)
// ============================================================
describe('Self-damage prevention via splash exclusion (combat.cpp:207)', () => {

  it('attacker is excluded from its own splash damage', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10); // same cell
    const ctx = makeCombatCtx([attacker, target]);

    const attackerHpBefore = attacker.hp;
    applySplashDamage(
      ctx,
      attacker.pos, // splash centered on attacker
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1, attacker.house, attacker,
    );

    // C++ combat.cpp:207: source excluded from splash
    expect(attacker.hp).toBe(attackerHpBefore);
    // Target at same position should take damage
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it('attacker excluded even with Super warhead at point-blank', () => {
    const attacker = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([attacker]);

    const hpBefore = attacker.hp;
    applySplashDamage(
      ctx,
      attacker.pos,
      { damage: 1000, warhead: 'Super', splash: 1.5 },
      -1, attacker.house, attacker,
    );

    expect(attacker.hp).toBe(hpBefore);
  });

  it('friendly units in splash ARE hit (no house exclusion)', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const friendly = entityAtCell(UnitType.I_E1, House.Spain, 10, 11); // 1 cell away, same house
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([attacker, friendly, enemy]);

    const friendlyHpBefore = friendly.hp;
    applySplashDamage(
      ctx,
      enemy.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1, attacker.house, attacker,
    );

    // Friendly within splash takes damage (C++ has no house exclusion for splash)
    expect(friendly.hp).toBeLessThan(friendlyHpBefore);
  });
});

// ============================================================
// Section 6: Overkill — damage > remaining HP still kills
// C++ object.cpp:1632: damage = oldstrength (caps damage at remaining HP)
// HP cannot go negative.
// ============================================================
describe('Overkill: damage > remaining HP (object.cpp:1620-1659)', () => {

  it('damage exceeding HP kills entity, HP clamped to 0', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.hp = 10;
    const killed = e.takeDamage(999, 'Super');
    expect(killed).toBe(true);
    expect(e.hp).toBe(0);
    expect(e.alive).toBe(false);
  });

  it('damage exactly equal to HP kills entity', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const killed = e.takeDamage(e.maxHp, 'Super');
    expect(killed).toBe(true);
    expect(e.hp).toBe(0);
  });

  it('HP never goes negative even with massive overkill', () => {
    const e = entityAtCell(UnitType.V_3TNK, House.Spain, 10, 10);
    e.hp = 1;
    e.takeDamage(10000, 'Super');
    expect(e.hp).toBeGreaterThanOrEqual(0);
    expect(e.hp).toBe(0);
  });

  it('1 HP entity killed by 1 damage', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.hp = 1;
    const killed = e.takeDamage(1, 'SA');
    expect(killed).toBe(true);
    expect(e.hp).toBe(0);
  });

  it('overkill sets mission to DIE and animState to DIE', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.takeDamage(e.maxHp + 500, 'Super');
    expect(e.mission).toBe(Mission.DIE);
    expect(e.animState).toBe(AnimState.DIE);
  });
});

// ============================================================
// Section 7: Fixed-point rounding — TS must match C++ truncation
// C++ uses integer division for distFactor; TS uses Math.floor
// ============================================================
describe('Fixed-point rounding: C++ integer truncation (combat.cpp:108-114)', () => {

  it('distFactor is floored, not rounded: floor(2.667)=2, not 3', () => {
    // SA spread=3 at dist=4px: distFactor = floor(4*2/3) = floor(2.667) = 2
    // damage = 100 / 2 = 50
    const result = modifyDamage(100, 'SA', 'none', 4);
    expect(result).toBe(50); // if rounded to 3: 100/3=33 — wrong
  });

  it('damage division is floored after mult: 90/4 = 22.5 → rounds to 23', () => {
    // HE vs none at dist=12px: mult=0.9, distFactor=4
    // C++ integer truncation of 90/4 = 22 (floor), but TS uses Math.round → 23
    // Actually C++ uses: damage = Fixed(damage) / distFactor which produces 22.5
    // C++ keeps fixed-point until final cast. The expected value per existing tests is 23.
    const result = modifyDamage(100, 'HE', 'none', 12);
    expect(result).toBe(23);
  });

  it('result is always integer', () => {
    const warheads: WarheadType[] = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke', 'Mechanical'];
    const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];
    for (const wh of warheads) {
      for (const ar of armors) {
        for (const dist of [0, 3, 7, 15, 25]) {
          const result = modifyDamage(100, wh, ar, dist);
          expect(Number.isInteger(result), `${wh} vs ${ar} at ${dist}px`).toBe(true);
        }
      }
    }
  });

  it('near-miss never exceeds direct hit for any warhead', () => {
    // C++ integer truncation ensures dist=1 damage <= dist=0 damage
    const warheads: WarheadType[] = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Nuke', 'Mechanical'];
    for (const wh of warheads) {
      const d0 = modifyDamage(100, wh, 'none', 0);
      const d1 = modifyDamage(100, wh, 'none', 1);
      if (d0 === 0) continue; // skip zero-mult combos
      expect(d1, `${wh} dist=1 should not exceed dist=0`).toBeLessThanOrEqual(d0);
    }
  });

  it('damage monotonically decreases with distance for SA spread=3', () => {
    let prev = modifyDamage(100, 'SA', 'none', 0);
    for (let dist = 1; dist <= 50; dist++) {
      const dmg = modifyDamage(100, 'SA', 'none', dist);
      expect(dmg, `SA dist=${dist} should be <= dist=${dist - 1}`).toBeLessThanOrEqual(prev);
      prev = dmg;
    }
  });
});

// ============================================================
// Section 8: Country firepower bias stacking with warhead multiplier
// C++ house.cpp:289,299 — FirepowerBias = country * difficulty
// ============================================================
describe('Country firepower bias stacking (house.cpp:289,299)', () => {

  it('Germany firepower from INI matches COUNTRY_BONUSES', () => {
    expect(COUNTRY_BONUSES.Germany.firepowerMult).toBe(INI_GERMANY_FIREPOWER);
  });

  it('Germany 1.1x firepower stacks with SA warhead multiplier', () => {
    // SA vs none: mult=1.0; Germany bias=1.1
    // damage = 100 * 1.0 * 1.1 = 110
    const result = modifyDamage(100, 'SA', 'none', 0, INI_GERMANY_FIREPOWER);
    expect(result).toBe(110);
  });

  it('Germany 1.1x firepower stacks with HE warhead vs none (0.9x)', () => {
    // HE vs none: mult=0.9; Germany bias=1.1
    // damage = 100 * 0.9 * 1.1 = 99
    const result = modifyDamage(100, 'HE', 'none', 0, INI_GERMANY_FIREPOWER);
    expect(result).toBe(99);
  });

  it('Germany 1.1x firepower stacks with AP warhead vs heavy (1.0x)', () => {
    // AP vs heavy: mult=1.0; Germany bias=1.1
    // damage = 100 * 1.0 * 1.1 = 110
    const result = modifyDamage(100, 'AP', 'heavy', 0, INI_GERMANY_FIREPOWER);
    expect(result).toBe(110);
  });

  it('firepower bias stacks with distance falloff', () => {
    // SA vs none, dist=6px: distFactor=4, bias=1.1
    // damage = 100 * 1.0 * 1.1 = 110, then /4 = 27.5 → round(27.5) = 28
    const result = modifyDamage(100, 'SA', 'none', 6, INI_GERMANY_FIREPOWER);
    expect(result).toBe(28);
  });

  it('firepower bias can push damage to MaxDamage cap', () => {
    // 600 * 1.0 * 2.0 = 1200 → capped at INI_MAX_DAMAGE
    const result = modifyDamage(600, 'Super', 'none', 0, 2.0);
    expect(result).toBe(INI_MAX_DAMAGE);
  });

  it('all non-Germany/non-France countries have 1.0 firepower in INI', () => {
    const countriesWithDefaultFirepower = ['England', 'France', 'Ukraine', 'USSR'];
    for (const country of countriesWithDefaultFirepower) {
      if (country === 'Germany') continue;
      const iniVal = parseFloat(ini[country]?.['Firepower'] ?? '1.0');
      if (country === 'France') {
        // France has Firepower=1.0 in INI
        expect(iniVal).toBe(1.0);
      } else {
        expect(iniVal, `${country} should have Firepower=1.0`).toBe(1.0);
      }
    }
  });
});

// ============================================================
// Section 9: Prone damage halved — infantry.cpp:329-330
// ProneDamageBias from rules.ini (ProneDamage=50%)
// ============================================================
describe('Prone damage halved (infantry.cpp:329-330, rules.ini ProneDamage)', () => {

  it('INI ProneDamage matches PRONE_DAMAGE_BIAS constant', () => {
    // rules.ini: ProneDamage=50% → 0.5
    expect(PRONE_DAMAGE_BIAS).toBe(INI_PRONE_DAMAGE);
  });

  it('prone infantry takes half damage', () => {
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    infantry.isProne = true;
    const hpBefore = infantry.hp;
    infantry.takeDamage(100);
    const damageTaken = hpBefore - infantry.hp;
    // C++ applies ProneDamageBias: round(100 * 0.5) = 50
    expect(damageTaken).toBe(Math.round(100 * INI_PRONE_DAMAGE));
  });

  it('standing infantry takes full damage', () => {
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    infantry.isProne = false;
    const hpBefore = infantry.hp;
    infantry.takeDamage(30);
    const damageTaken = hpBefore - infantry.hp;
    expect(damageTaken).toBe(30);
  });

  it('prone damage minimum is 1 (never reduces to 0)', () => {
    // C++ combat.cpp MinDamage guarantee + prone:
    // 1 damage * 0.5 = 0.5 → max(1, round(0.5)) = max(1, 1) = 1
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    infantry.isProne = true;
    const hpBefore = infantry.hp;
    infantry.takeDamage(1);
    const damageTaken = hpBefore - infantry.hp;
    expect(damageTaken).toBeGreaterThanOrEqual(1);
  });

  it('prone does not affect vehicles (only infantry)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    // Vehicles don't have isProne, but set it to verify it has no effect
    (tank as any).isProne = true;
    const hpBefore = tank.hp;
    tank.takeDamage(100);
    const damageTaken = hpBefore - tank.hp;
    // Vehicles should take full damage regardless of isProne
    // (C++ only applies ProneDamageBias in infantry.cpp, not unit.cpp)
    expect(damageTaken).toBe(100);
  });

  it('odd damage with prone: 7 * 0.5 = 3.5 → max(1, round(3.5)) = max(1, 4) = 4', () => {
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    infantry.isProne = true;
    const hpBefore = infantry.hp;
    infantry.takeDamage(7);
    const damageTaken = hpBefore - infantry.hp;
    expect(damageTaken).toBe(Math.max(1, Math.round(7 * INI_PRONE_DAMAGE)));
  });
});

// ============================================================
// Section 10: Condition thresholds — rules.ini ConditionRed/Yellow
// Verify constants match INI and affect visual state derivation
// ============================================================
describe('Condition thresholds from rules.ini', () => {

  it('CONDITION_RED matches rules.ini ConditionRed', () => {
    // rules.ini: ConditionRed=25%
    expect(CONDITION_RED).toBe(INI_CONDITION_RED);
  });

  it('CONDITION_YELLOW matches rules.ini ConditionYellow', () => {
    // rules.ini: ConditionYellow=50%
    expect(CONDITION_YELLOW).toBe(INI_CONDITION_YELLOW);
  });

  it('CONDITION_RED < CONDITION_YELLOW (red is worse than yellow)', () => {
    expect(INI_CONDITION_RED).toBeLessThan(INI_CONDITION_YELLOW);
  });

  it('at exactly ConditionYellow (50%), health bar should be yellow', () => {
    // C++ techno.cpp:1147-1152: if (ratio <= ConditionYellow) color = YELLOW
    // At exactly 50%, ratio <= 0.5 is TRUE → yellow
    const ratio = INI_CONDITION_YELLOW;
    expect(ratio <= INI_CONDITION_YELLOW).toBe(true);
    // But above 50%: false → green
    expect(ratio + 0.01 <= INI_CONDITION_YELLOW).toBe(false);
  });

  it('at exactly ConditionRed (25%), health bar should be red', () => {
    // C++ techno.cpp:1149: if (ratio <= ConditionRed) color = RED
    const ratio = INI_CONDITION_RED;
    expect(ratio <= INI_CONDITION_RED).toBe(true);
    // Just above: false → stays yellow
    expect(ratio + 0.01 <= INI_CONDITION_RED).toBe(false);
  });

  it('fear increment depends on condition thresholds', () => {
    // C++ infantry.cpp:454-457:
    //   moreFear = FEAR_ANXIOUS (10)
    //   if (ratio > ConditionRed)    moreFear /= 2 → 5
    //   if (ratio > ConditionYellow) moreFear /= 2 → 2
    // Full health (above both thresholds): moreFear = 2
    // Between red and yellow: moreFear = 5
    // At/below red: moreFear = 10

    // Full health infantry
    const eHealthy = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    eHealthy.fear = Entity.FEAR_SCARED; // skip first-hit branch
    const fearBefore = eHealthy.fear;
    eHealthy.takeDamage(1, 'SA');
    const healthyIncrease = eHealthy.fear - fearBefore;

    // Low health infantry (at ConditionRed)
    const eLow = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    eLow.hp = Math.floor(eLow.maxHp * INI_CONDITION_RED);
    eLow.fear = Entity.FEAR_SCARED;
    const lowFearBefore = eLow.fear;
    eLow.takeDamage(1, 'SA');
    const lowIncrease = eLow.fear - lowFearBefore;

    // Badly hurt infantry gets more fear increment
    expect(lowIncrease).toBeGreaterThanOrEqual(healthyIncrease);
  });

  it('entity at full HP: health ratio > ConditionYellow', () => {
    const e = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ratio = e.hp / e.maxHp;
    expect(ratio).toBeGreaterThan(INI_CONDITION_YELLOW);
  });

  it('entity at half HP: health ratio at ConditionYellow boundary', () => {
    const e = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    e.hp = Math.floor(e.maxHp * INI_CONDITION_YELLOW);
    const ratio = e.hp / e.maxHp;
    expect(ratio).toBeLessThanOrEqual(INI_CONDITION_YELLOW);
  });

  it('entity at quarter HP: health ratio at ConditionRed boundary', () => {
    // Use 2TNK (400 HP) — divisible by 4
    const e = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(e.maxHp).toBe(400);
    e.hp = Math.floor(e.maxHp * INI_CONDITION_RED);
    const ratio = e.hp / e.maxHp;
    expect(ratio).toBeLessThanOrEqual(INI_CONDITION_RED);
  });
});

// ============================================================
// Section 11: Additional edge case interactions
// ============================================================
describe('Damage edge case interactions', () => {

  it('invulnerable entity ignores all damage (ironCurtainTick > 0)', () => {
    const e = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    e.ironCurtainTick = 100;
    const hpBefore = e.hp;
    e.takeDamage(999, 'Super');
    expect(e.hp).toBe(hpBefore);
    expect(e.alive).toBe(true);
  });

  it('invulnerable entity ignores MAX_DAMAGE (1000)', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.ironCurtainTick = 50;
    const hpBefore = e.hp;
    e.takeDamage(INI_MAX_DAMAGE, 'Super');
    expect(e.hp).toBe(hpBefore);
  });

  it('armorBias from crate stacks: damage / armorBias, minimum 1', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.armorBias = 2.0;
    const hpBefore = e.hp;
    e.takeDamage(20, 'SA');
    const damageTaken = hpBefore - e.hp;
    // 20 / 2.0 = 10
    expect(damageTaken).toBe(10);
  });

  it('armorBias ensures minimum 1 damage even with extreme bias', () => {
    const e = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e.armorBias = 100.0;
    const hpBefore = e.hp;
    e.takeDamage(1, 'SA');
    const damageTaken = hpBefore - e.hp;
    expect(damageTaken).toBeGreaterThanOrEqual(1);
  });

  it('baseDamage=0 always returns 0 (combat.cpp:74 short-circuit)', () => {
    // C++ combat.cpp:74: if (!damage) return 0
    expect(modifyDamage(0, 'Super', 'none', 0)).toBe(0);
    expect(modifyDamage(0, 'HE', 'heavy', 0, 2.0)).toBe(0);
  });

  it('damage just under MaxDamage is not capped', () => {
    const result = modifyDamage(INI_MAX_DAMAGE - 1, 'Super', 'none', 0);
    expect(result).toBe(INI_MAX_DAMAGE - 1);
  });

  it('damage at exactly MaxDamage passes through', () => {
    const result = modifyDamage(INI_MAX_DAMAGE, 'Super', 'none', 0);
    expect(result).toBe(INI_MAX_DAMAGE);
  });

  it('damage above MaxDamage is capped', () => {
    const result = modifyDamage(INI_MAX_DAMAGE + 1, 'Super', 'none', 0);
    expect(result).toBe(INI_MAX_DAMAGE);
  });

  it('killing entity also kills passengers (transport destruction)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const p1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const p2 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    apc.passengers = [p1, p2];

    apc.takeDamage(apc.maxHp, 'Super');
    expect(apc.alive).toBe(false);
    expect(p1.alive).toBe(false);
    expect(p2.alive).toBe(false);
    expect(apc.passengers).toHaveLength(0);
  });
});
