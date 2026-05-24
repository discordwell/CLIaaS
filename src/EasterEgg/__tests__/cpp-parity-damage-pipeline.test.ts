/**
 * C++ Behavioral Parity Tests — Damage Calculation Pipeline
 *
 * Tests the full chain from weapon fire to HP reduction:
 *   damage * warhead_vs_armor * distance_falloff * veterancy
 *
 * C++ source references:
 *   combat.cpp:72-129  — Modify_Damage(): warhead * armor * distance falloff * min/max clamp
 *   combat.cpp:162-271 — Explosion_Damage(): splash radius, object collection, distance calc
 *   warhead.h:46-117   — WarheadTypeClass: SpreadFactor, Modifier[ARMOR_COUNT], wall flags
 *   warhead.cpp:168-191 — Read_INI(): loads Spread, Verses, Wall, Wood, Ore, Explosion, InfDeath
 *   display.h:45-56     — ICON_PIXEL_W=24, ICON_LEPTON_W=256, PIXEL_LEPTON_W=256/24=10
 *   rules.ini [SA],[HE],[AP],[Fire],[HollowPoint],[Super],[Organic],[Nuke] — authoritative values
 *
 * CRITICAL: All expected values are PARSED from rules.ini, never hardcoded.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  modifyDamage, armorIndex,
  WARHEAD_VS_ARMOR, WARHEAD_META, WARHEAD_PROPS,
  CELL_SIZE, LEPTON_SIZE, MAX_DAMAGE, PRONE_DAMAGE_BIAS,
  UNIT_STATS, UnitType, House, WEAPON_STATS,
  buildDefaultAlliances,
  type WarheadType, type ArmorType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  applySplashDamage, damageEntity, getWarheadMult, getWarheadMeta, handleUnitDeath,
  SPLASH_RADIUS, structureDamage, tickDestroyedStructureDebris,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import { ScenarioRandom } from '../engine/random';
import { type MapStructure, STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';
import { Team, TMISSION_ATTACK, clearAllTeams, resetTeamIds } from '../engine/team';

// ── INI Parser ────────────────────────────────────────────────────────────────

const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const rulesContent = fs.readFileSync(RULES_INI_PATH, 'utf-8');

interface INIData {
  [section: string]: { [key: string]: string };
}

function parseINI(content: string): INIData {
  const result: INIData = {};
  let currentSection = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }
    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (kvMatch && currentSection) {
      result[currentSection][kvMatch[1].trim()] = kvMatch[2].trim();
    }
  }
  return result;
}

/** Parse a percentage string like "50%" to a fraction (0.5), or a plain number. */
function parsePercent(val: string): number {
  if (val.endsWith('%')) return parseFloat(val) / 100;
  return parseFloat(val);
}

const ini = parseINI(rulesContent);

// ── INI-parsed warhead data ─────────────────────────────────────────────────

interface ParsedWarhead {
  spread: number;
  verses: [number, number, number, number, number]; // [none, wood, light, heavy, concrete]
  explosion: number;
  infDeath: number;
  wall: boolean;
  wood: boolean;
  ore: boolean;
}

const WARHEAD_NAMES = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke'] as const;

function parseWarhead(name: string): ParsedWarhead {
  const section = ini[name];
  if (!section) throw new Error(`Missing [${name}] section in rules.ini`);
  const versesStr = section['Verses'] ?? '100%,100%,100%,100%,100%';
  const verses = versesStr.split(',').map(v => parsePercent(v.trim())) as [number, number, number, number, number];
  return {
    spread: parseInt(section['Spread'] ?? '1', 10),
    verses,
    explosion: parseInt(section['Explosion'] ?? '0', 10),
    infDeath: parseInt(section['InfDeath'] ?? '0', 10),
    wall: (section['Wall'] ?? 'no').toLowerCase() === 'yes',
    wood: (section['Wood'] ?? 'no').toLowerCase() === 'yes',
    ore: (section['Ore'] ?? 'no').toLowerCase() === 'yes',
  };
}

const parsedWarheads: Record<string, ParsedWarhead> = {};
for (const name of WARHEAD_NAMES) {
  parsedWarheads[name] = parseWarhead(name);
}

// ── INI-parsed general combat constants ─────────────────────────────────────

const INI_MIN_DAMAGE = parseInt(ini['General']['MinDamage'] ?? '1', 10);
const INI_MAX_DAMAGE = parseInt(ini['General']['MaxDamage'] ?? '1000', 10);
const INI_PRONE_DAMAGE = parsePercent(ini['General']['ProneDamage'] ?? '50%');
const INI_BRIDGE_STRENGTH = parseInt(ini['General']['BridgeStrength'] ?? '1000', 10);

// ── C++ constants from display.h ────────────────────────────────────────────
// ICON_PIXEL_W = 24, ICON_LEPTON_W = 256, PIXEL_LEPTON_W = 256/24 = 10 (integer division)
const ICON_PIXEL_W = 24;
const ICON_LEPTON_W = 256;
const PIXEL_LEPTON_W = Math.floor(ICON_LEPTON_W / ICON_PIXEL_W); // 10

// ── Test helpers ────────────────────────────────────────────────────────────

const ARMOR_TYPES: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];

beforeEach(() => {
  resetEntityIds();
  resetTeamIds();
  clearAllTeams();
});

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(entities: Entity[] = []): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
    inflightProjectiles: [],
    logicAnims: [],
    effects: [],
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
    getFirepowerBias: () => 1.0,
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
  } as CombatContext;
}

function structureAtCell(type: string, house: House, cx: number, cy: number): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: STRUCTURE_MAX_HP[type] ?? 400,
    maxHp: STRUCTURE_MAX_HP[type] ?? 400,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    missionTimer: 0,
  };
}

/**
 * Replicate C++ Modify_Damage logic exactly using INI-parsed values.
 * C++ combat.cpp:72-129
 *
 * @param damage     Raw weapon damage
 * @param spreadFactor  Warhead Spread= from INI
 * @param armorMult  Warhead Verses[armor] from INI
 * @param distLeptons  Distance in leptons from explosion center
 * @param houseBias  FirepowerBias multiplier (default 1.0)
 * @returns Expected damage after C++ Modify_Damage
 */
function cppModifyDamage(
  damage: number, spreadFactor: number, armorMult: number,
  distLeptons: number, houseBias = 1.0,
): number {
  if (damage === 0) return 0;
  if (damage < 0) return 0; // simplified; heal logic tested separately

  const fixedMultiplyInt = (value: number, multiplier: number): number => {
    if (multiplier <= 0) return 0;
    const raw = Math.trunc(multiplier * 256 + 1e-9);
    return Math.trunc(((raw * value) + 128) / 256);
  };

  // C++ applies house firepower as fixed*int before Modify_Damage, then applies
  // the warhead modifier with fixed::operator*(int) in combat.cpp:101.
  let dmg = fixedMultiplyInt(damage, houseBias);
  dmg = fixedMultiplyInt(dmg, armorMult);
  if (dmg <= 0) return 0;

  // C++ combat.cpp:107-111 — distance normalization
  let distance: number;
  if (spreadFactor === 0) {
    // combat.cpp:108 — distance /= PIXEL_LEPTON_W/4 = 10/4 = 2 (C++ integer division)
    distance = Math.floor(distLeptons / Math.floor(PIXEL_LEPTON_W / 4));
  } else {
    // combat.cpp:110 — distance /= SpreadFactor * (PIXEL_LEPTON_W / 2) = SpreadFactor * 5
    distance = Math.floor(distLeptons / (spreadFactor * Math.floor(PIXEL_LEPTON_W / 2)));
  }

  // combat.cpp:112 — Bound(distance, 0, 16)
  distance = Math.max(0, Math.min(16, distance));

  // combat.cpp:113-115 — damage / distance
  if (distance > 0) {
    // `dmg` is an int in C++; integer division truncates toward zero.
    dmg = Math.trunc(dmg / distance);
  }

  // combat.cpp:122-124 — MinDamage threshold: distance < 4 means at least MinDamage
  if (distance < 4) {
    dmg = Math.max(dmg, INI_MIN_DAMAGE);
  }

  // combat.cpp:127 — MaxDamage cap
  dmg = Math.min(dmg, INI_MAX_DAMAGE);

  return Math.max(0, dmg);
}

// =============================================================================
// 1. WARHEAD VS ARMOR TABLES — rules.ini Verses= is authoritative
// =============================================================================

describe('Warhead vs Armor tables match rules.ini Verses= (warhead.cpp:178-185)', () => {
  for (const whName of WARHEAD_NAMES) {
    const parsed = parsedWarheads[whName];
    describe(`[${whName}] Verses=${parsed.verses.map(v => (v * 100) + '%').join(',')}`, () => {
      for (let i = 0; i < ARMOR_TYPES.length; i++) {
        const armor = ARMOR_TYPES[i];
        const iniVal = parsed.verses[i];

        it(`${whName} vs ${armor}: TS WARHEAD_VS_ARMOR = ${iniVal} (INI Verses)`, () => {
          const tsVal = WARHEAD_VS_ARMOR[whName as WarheadType]?.[i];
          expect(tsVal, `WARHEAD_VS_ARMOR['${whName}'][${i}] (${armor})`).toBeCloseTo(iniVal, 4);
        });

        it(`${whName} vs ${armor}: getWarheadMult returns INI value`, () => {
          const mult = getWarheadMult(whName as WarheadType, armor, {});
          expect(mult, `getWarheadMult('${whName}', '${armor}')`).toBeCloseTo(iniVal, 4);
        });
      }
    });
  }
});

// =============================================================================
// 2. WARHEAD META — Spread, Wall, Wood, Ore from rules.ini
// =============================================================================

describe('Warhead metadata matches rules.ini Spread/Wall/Wood/Ore (warhead.cpp:171-174)', () => {
  for (const whName of WARHEAD_NAMES) {
    const parsed = parsedWarheads[whName];
    const meta = WARHEAD_META[whName as WarheadType];

    it(`[${whName}] Spread=${parsed.spread} matches WARHEAD_META.spreadFactor`, () => {
      expect(meta?.spreadFactor, `WARHEAD_META['${whName}'].spreadFactor`).toBe(parsed.spread);
    });

    if (parsed.wall) {
      it(`[${whName}] Wall=yes matches WARHEAD_META.destroysWalls=true`, () => {
        expect(meta?.destroysWalls).toBe(true);
      });
    }
    if (parsed.wood) {
      it(`[${whName}] Wood=yes matches WARHEAD_META.destroysWood=true`, () => {
        expect(meta?.destroysWood).toBe(true);
      });
    }
    if (parsed.ore) {
      it(`[${whName}] Ore=yes matches WARHEAD_META.destroysOre=true`, () => {
        expect(meta?.destroysOre).toBe(true);
      });
    }
  }
});

// =============================================================================
// 3. WARHEAD PROPS — Explosion set and InfDeath from rules.ini
// =============================================================================

describe('Warhead props match rules.ini Explosion/InfDeath (warhead.cpp:175-176)', () => {
  for (const whName of WARHEAD_NAMES) {
    const parsed = parsedWarheads[whName];
    const props = WARHEAD_PROPS[whName as WarheadType];

    it(`[${whName}] Explosion=${parsed.explosion} matches WARHEAD_PROPS.explosionSet`, () => {
      expect(props?.explosionSet, `WARHEAD_PROPS['${whName}'].explosionSet`).toBe(parsed.explosion);
    });

    it(`[${whName}] InfDeath=${parsed.infDeath} matches WARHEAD_PROPS.infantryDeath`, () => {
      expect(props?.infantryDeath, `WARHEAD_PROPS['${whName}'].infantryDeath`).toBe(parsed.infDeath);
    });
  }
});

// =============================================================================
// 4. GENERAL COMBAT CONSTANTS — rules.ini [General] is authoritative
// =============================================================================

describe('General combat constants match rules.ini [General]', () => {
  it(`MinDamage=${INI_MIN_DAMAGE} (rules.ini General.MinDamage)`, () => {
    // The TS engine uses MinDamage=1 in modifyDamage (combat.cpp:123: damage = max(damage, Rule.MinDamage))
    expect(INI_MIN_DAMAGE).toBe(1);
  });

  it(`MaxDamage=${INI_MAX_DAMAGE} matches TS MAX_DAMAGE constant`, () => {
    expect(MAX_DAMAGE).toBe(INI_MAX_DAMAGE);
  });

  it(`ProneDamage=${INI_PRONE_DAMAGE * 100}% matches TS PRONE_DAMAGE_BIAS`, () => {
    expect(PRONE_DAMAGE_BIAS).toBeCloseTo(INI_PRONE_DAMAGE, 4);
  });
});

// =============================================================================
// 5. modifyDamage() — CORE FORMULA PARITY (combat.cpp:72-129)
// =============================================================================

describe('modifyDamage() formula matches C++ Modify_Damage (combat.cpp:72-129)', () => {

  // ── 5a. Zero damage short-circuit (combat.cpp:74) ──

  it('zero damage returns 0 regardless of warhead/armor (combat.cpp:74)', () => {
    expect(modifyDamage(0, 'HE', 'none', 0)).toBe(0);
    expect(modifyDamage(0, 'AP', 'heavy', 10)).toBe(0);
    expect(modifyDamage(0, 'SA', 'light', 100)).toBe(0);
  });

  // ── 5b. Point-blank (distance=0) damage = baseDamage * armorMult ──

  it('point-blank (dist=0): damage = baseDamage * Verses[armor] (combat.cpp:101,113-115)', () => {
    for (const whName of WARHEAD_NAMES) {
      const parsed = parsedWarheads[whName];
      for (let i = 0; i < ARMOR_TYPES.length; i++) {
        const armor = ARMOR_TYPES[i];
        const mult = parsed.verses[i];
        const baseDmg = 100;
        const expected = Math.max(0, Math.round(baseDmg * mult));
        // Distance=0, distFactor=0, so no division; minDamage guaranteed (distFactor < 4)
        if (mult <= 0) {
          // 0% verses = 0 damage (combat.cpp:101 after multiplication)
          expect(
            modifyDamage(baseDmg, whName as WarheadType, armor, 0),
            `${whName} vs ${armor} (0% verses)`,
          ).toBe(0);
        } else {
          // Positive verses → at least MinDamage=1, capped at MaxDamage
          const tsDmg = modifyDamage(baseDmg, whName as WarheadType, armor, 0);
          expect(tsDmg, `${whName} vs ${armor} at dist=0`).toBe(
            Math.min(Math.max(expected, INI_MIN_DAMAGE), INI_MAX_DAMAGE),
          );
        }
      }
    }
  });

  // ── 5c. Distance-based falloff (combat.cpp:106-125) ──

  describe('distance falloff matches C++ integer math (combat.cpp:106-125)', () => {
    // Test with HE warhead (Spread=6) at various distances
    // C++ formula: distFactor = floor(distLeptons / (SpreadFactor * PIXEL_LEPTON_W/2))
    //            = floor(distLeptons / (6 * 5)) = floor(distLeptons / 30)
    // In pixel space, TS converts: distFactor = floor(distPixels * 2 / SpreadFactor)
    const heSpread = parsedWarheads['HE'].spread; // 6
    const heVsNone = parsedWarheads['HE'].verses[0]; // 0.9

    it('HE at dist=0 pixels: full damage (distFactor=0, no division)', () => {
      const result = modifyDamage(100, 'HE', 'none', 0);
      const expected = Math.round(100 * heVsNone);
      expect(result).toBe(expected); // 90
    });

    it('HE at dist=1 pixel: distFactor=floor(1*2/6)=0, full damage', () => {
      const result = modifyDamage(100, 'HE', 'none', 1);
      const expected = Math.round(100 * heVsNone); // Still 90 (distFactor=0)
      expect(result).toBe(expected);
    });

    it('HE at dist=3 pixels: distFactor=floor(3*2/6)=1, damage/1', () => {
      const result = modifyDamage(100, 'HE', 'none', 3);
      // distFactor=floor(6/6)=1, damage/1=90
      const expected = Math.trunc(Math.round(100 * heVsNone) / 1);
      expect(result).toBe(expected); // 90
    });

    it('HE at dist=6 pixels: distFactor=floor(6*2/6)=2, damage/2', () => {
      const result = modifyDamage(100, 'HE', 'none', 6);
      // distFactor=floor(12/6)=2, 90/2=45
      const expected = Math.trunc(Math.round(100 * heVsNone) / 2);
      expect(result).toBe(expected); // 45
    });

    it('HE at dist=12 pixels: distFactor=floor(12*2/6)=4, damage/4', () => {
      const result = modifyDamage(100, 'HE', 'none', 12);
      // distFactor=floor(24/6)=4, 90/4=22.5 → 22 (C++ int division)
      const expected = Math.trunc(Math.round(100 * heVsNone) / 4);
      expect(result).toBe(expected); // 22
    });

    // SA warhead has Spread=3, tighter spread
    const saSpread = parsedWarheads['SA'].spread; // 3
    const saVsNone = parsedWarheads['SA'].verses[0]; // 1.0

    it('SA at dist=3 pixels: distFactor=floor(3*2/3)=2, damage/2', () => {
      const result = modifyDamage(100, 'SA', 'none', 3);
      // distFactor=floor(6/3)=2, 100/2=50
      expect(result).toBe(Math.trunc(Math.round(100 * saVsNone) / 2)); // 50
    });

    it('SA at dist=6 pixels: distFactor=floor(6*2/3)=4, damage/4', () => {
      const result = modifyDamage(100, 'SA', 'none', 6);
      // distFactor=floor(12/3)=4, 100/4=25
      expect(result).toBe(Math.trunc(Math.round(100 * saVsNone) / 4)); // 25
    });

    // Fire warhead has Spread=8, widest spread
    const fireSpread = parsedWarheads['Fire'].spread; // 8
    const fireVsNone = parsedWarheads['Fire'].verses[0]; // 0.9

    it('Fire at dist=8 pixels: distFactor=floor(8*2/8)=2, damage/2', () => {
      const result = modifyDamage(100, 'Fire', 'none', 8);
      // distFactor=floor(16/8)=2, 90/2=45
      expect(result).toBe(Math.trunc(Math.round(100 * fireVsNone) / 2)); // 45
    });

    it('Fire at dist=16 pixels: distFactor=floor(16*2/8)=4, damage/4', () => {
      const result = modifyDamage(100, 'Fire', 'none', 16);
      // distFactor=floor(32/8)=4, 90/4=22.5 → 22 (C++ int division)
      expect(result).toBe(Math.trunc(Math.round(100 * fireVsNone) / 4)); // 22
    });
  });

  // ── 5d. Organic warhead: Spread=0 special path (combat.cpp:108) ──

  describe('Organic warhead (Spread=0) uses narrow falloff path (combat.cpp:108)', () => {
    // Spread=0: distance /= PIXEL_LEPTON_W/4 = 10/4 = 2 (C++ integer division)
    // In pixel space: distFactor = distPixels * 5

    const orgVsNone = parsedWarheads['Organic'].verses[0]; // 1.0

    it('Organic at dist=0: full damage', () => {
      expect(modifyDamage(100, 'Organic', 'none', 0)).toBe(Math.round(100 * orgVsNone));
    });

    it('Organic at dist=1 pixel: distFactor=floor(1*5)=5, damage/5=20', () => {
      // Very steep falloff: 1 pixel away already divides by 5
      const result = modifyDamage(100, 'Organic', 'none', 1);
      expect(result).toBe(Math.trunc(Math.round(100 * orgVsNone) / 5)); // 20
    });

    it('Organic does 0 damage to armored targets (Verses=0%)', () => {
      expect(modifyDamage(100, 'Organic', 'wood', 0)).toBe(0);
      expect(modifyDamage(100, 'Organic', 'light', 0)).toBe(0);
      expect(modifyDamage(100, 'Organic', 'heavy', 0)).toBe(0);
      expect(modifyDamage(100, 'Organic', 'concrete', 0)).toBe(0);
    });
  });

  // ── 5e. Distance falloff bound to [0,16] (combat.cpp:112) ──

  describe('distance factor clamped to [0,16] (combat.cpp:112)', () => {
    // HollowPoint Spread=1, very narrow. At large distances, distFactor = floor(dist*2/1) can exceed 16.
    const hpSpread = parsedWarheads['HollowPoint'].spread; // 1
    const hpVsNone = parsedWarheads['HollowPoint'].verses[0]; // 1.0

    it('HollowPoint at dist=20 pixels: distFactor clamped to 16, damage/16', () => {
      // distFactor = floor(20*2/1) = 40, clamped to 16
      const result = modifyDamage(100, 'HollowPoint', 'none', 20);
      // damage = 100 * 1.0 / 16 = 6.25 → 6 (C++ int division)
      // distFactor=16 >= 4, so no minDamage guarantee
      expect(result).toBe(Math.trunc(Math.round(100 * hpVsNone) / 16)); // 6
    });

    it('Super at dist=50 pixels: distFactor clamped to 16', () => {
      // Super Spread=1: distFactor = floor(50*2/1)=100, clamped to 16
      const result = modifyDamage(200, 'Super', 'none', 50);
      // 200 / 16 = 12.5 → 12 (C++ int division)
      expect(result).toBe(Math.trunc(200 / 16)); // 12
    });
  });

  // ── 5f. MinDamage guarantee when distFactor < 4 (combat.cpp:122-124) ──

  describe('MinDamage=1 only applies after armor multiply leaves non-zero damage (combat.cpp:106, 122-124)', () => {
    it('1 damage * SA vs heavy (25%) at dist=0: fixed multiply rounds to 0, so no MinDamage', () => {
      // fixed::operator*(int) rounds 1*25% to 0, so C++ skips the whole distance/minDamage block.
      const result = modifyDamage(1, 'SA', 'heavy', 0);
      expect(result).toBe(0);
    });

    it('2 damage * HollowPoint vs heavy (5%) at dist=0: fixed multiply rounds to 0, so no MinDamage', () => {
      // 2 * 0.05 = 0.1 → fixed multiply rounds to 0 before `if (damage)`.
      const result = modifyDamage(2, 'HollowPoint', 'heavy', 0);
      expect(result).toBe(0);
    });

    it('distFactor=3 (< 4) still gets MinDamage when armor multiply is non-zero', () => {
      // AP Spread=3: dist=4.5 pixels → distFactor=floor(4.5*2/3)=3
      // 10 * AP_vs_none(0.3) = 3; 3 / 3 = 1; distFactor=3 < 4 preserves at least 1.
      const result = modifyDamage(10, 'AP', 'none', 4.5);
      expect(result).toBeGreaterThanOrEqual(INI_MIN_DAMAGE);
    });

    it('far-edge SA splash can truncate to 0 after distance division', () => {
      // SCG06EA-style case: 15 SA vs none rounds to 15, distFactor=16, 15/16 truncates to 0.
      expect(modifyDamage(15, 'SA', 'none', 24)).toBe(0);
    });
  });

  // ── 5g. No MinDamage when distFactor >= 4 (combat.cpp:122 — "if distance < 4") ──

  describe('no MinDamage guarantee when distFactor >= 4 (combat.cpp:122)', () => {
    it('distFactor=4: 1 damage * 25% armor → rounds to 0, allowed to be 0', () => {
      // HE Spread=6: dist=12 pixels → distFactor=floor(12*2/6)=4
      // 1 * 0.25 / 4 = 0.0625 → round = 0
      // distFactor=4, NOT < 4, so minDamage does NOT apply
      const result = modifyDamage(1, 'HE', 'heavy', 12);
      // C++ would compute: 1 * 0.25 = 0.25 (C++ uses fixed-point); / 4 = 0.0625
      // TS rounds: Math.round(0.0625) = 0. But Math.max(0, ...) = 0.
      // This is correct: at distance>=4, damage CAN drop to 0.
      expect(result).toBe(0);
    });
  });

  // ── 5h. MaxDamage cap (combat.cpp:127) ──

  describe('MaxDamage cap at 1000 (combat.cpp:127, rules.ini MaxDamage)', () => {
    it('2000 damage * 100% at dist=0 → capped to 1000', () => {
      const result = modifyDamage(2000, 'Super', 'none', 0);
      expect(result).toBe(INI_MAX_DAMAGE);
    });

    it('5000 damage * 100% at dist=0 → capped to 1000', () => {
      expect(modifyDamage(5000, 'Super', 'none', 0)).toBe(INI_MAX_DAMAGE);
    });
  });

  // ── 5i. Healing (negative damage) behavior (combat.cpp:86-96) ──

  describe('negative damage (healing) rules (combat.cpp:86-96, FIXIT_CSII)', () => {
    it('negative damage to unarmored at close range: passes through (non-Mechanical)', () => {
      const result = modifyDamage(-50, 'SA', 'none', 0);
      expect(result).toBe(-50);
    });

    it('negative damage to armored at close range: returns 0 (non-Mechanical)', () => {
      expect(modifyDamage(-50, 'SA', 'heavy', 0)).toBe(0);
    });

    it('Mechanical heals armored at close range', () => {
      // FIXIT_CSII: Mechanical warhead heals armored units (armor != none)
      const result = modifyDamage(-50, 'Mechanical', 'heavy', 0);
      expect(result).toBe(-50);
    });

    it('Mechanical does not heal unarmored at close range', () => {
      expect(modifyDamage(-50, 'Mechanical', 'none', 0)).toBe(0);
    });

    it('negative damage at far distance returns 0', () => {
      // Distance >= 0x008 leptons = 8 leptons. HEAL_PROXIMITY_PX = 8 * CELL_SIZE / LEPTON_SIZE
      // = 8 * 24 / 256 = 0.75 pixels. So distance >= 1 pixel should return 0.
      expect(modifyDamage(-50, 'SA', 'none', 2)).toBe(0);
    });
  });
});

// =============================================================================
// 6. CROSS-VALIDATION: TS modifyDamage vs C++ Modify_Damage reference impl
// =============================================================================

describe('TS modifyDamage matches C++ reference implementation', () => {
  // Test many combinations of warhead, armor, distance to ensure formula parity
  const testCases: { wh: WarheadType; armor: ArmorType; baseDmg: number; distPx: number; desc: string }[] = [
    // Direct hits
    { wh: 'SA', armor: 'none', baseDmg: 25, distPx: 0, desc: 'SA vs infantry point-blank' },
    { wh: 'HE', armor: 'heavy', baseDmg: 200, distPx: 0, desc: 'HE vs heavy tank direct' },
    { wh: 'AP', armor: 'heavy', baseDmg: 150, distPx: 0, desc: 'AP vs heavy tank direct' },
    { wh: 'Fire', armor: 'wood', baseDmg: 100, distPx: 0, desc: 'Fire vs wood building direct' },
    { wh: 'HollowPoint', armor: 'none', baseDmg: 50, distPx: 0, desc: 'HollowPoint vs infantry direct' },
    // Medium distances
    { wh: 'HE', armor: 'none', baseDmg: 200, distPx: 6, desc: 'HE vs infantry at 6px' },
    { wh: 'AP', armor: 'light', baseDmg: 150, distPx: 4, desc: 'AP vs light at 4px' },
    { wh: 'SA', armor: 'wood', baseDmg: 50, distPx: 3, desc: 'SA vs wood at 3px' },
    // Long range (near max falloff)
    { wh: 'HollowPoint', armor: 'none', baseDmg: 50, distPx: 10, desc: 'HollowPoint vs infantry at 10px' },
    { wh: 'Nuke', armor: 'heavy', baseDmg: 1000, distPx: 20, desc: 'Nuke vs heavy at 20px' },
  ];

  for (const tc of testCases) {
    it(`${tc.desc}: ${tc.wh} ${tc.baseDmg}dmg vs ${tc.armor} at ${tc.distPx}px`, () => {
      const parsed = parsedWarheads[tc.wh];
      const armorIdx = armorIndex(tc.armor);
      const armorMult = parsed.verses[armorIdx];
      const spreadFactor = parsed.spread;

      // Convert TS display pixels back to C++ coordinate leptons. PIXEL_LEPTON_W
      // is only used inside combat.cpp after Distance() has already returned
      // leptons; pixel->lepton conversion uses the coordinate scale 256/24.
      const distLeptons = Math.trunc((tc.distPx * ICON_LEPTON_W) / ICON_PIXEL_W);

      const cppExpected = cppModifyDamage(tc.baseDmg, spreadFactor, armorMult, distLeptons);
      const tsResult = modifyDamage(tc.baseDmg, tc.wh, tc.armor, tc.distPx);

      // Allow +-1 rounding tolerance (C++ uses fixed-point, TS uses float)
      expect(tsResult).toBeGreaterThanOrEqual(Math.floor(cppExpected) - 1);
      expect(tsResult).toBeLessThanOrEqual(Math.ceil(cppExpected) + 1);
    });
  }

  it('SCG07EA fireball splash bucket: 70 Fire vs prone infantry at 288 leptons deals 4 after prone bias', () => {
    // C++ trace: Explosion_Damage(coord=(6976,15168), victim=(6784,14976))
    // distance=288, prone raw=35, Fire Verses[none]=90%, Spread=8.
    // fixed(90%) raw=230; ((230*35)+128)/256 => 31.
    // distance bucket floor(288 / (8 * 5)) => 7; 31 / 7 truncates to 4.
    const distPx = 288 * ICON_PIXEL_W / ICON_LEPTON_W;
    expect(modifyDamage(35, 'Fire', 'none', distPx)).toBe(4);
  });

  it('SCG07EA fireball splash bucket: 70 Fire vs prone infantry at 352 leptons deals 3 after C++ fixed multiply', () => {
    // C++ trace: Explosion_Damage(coord=(6848,15296), victim=(6784,14976))
    // distance=352, prone raw=35, Fire Verses[none]=90%, Spread=8.
    // fixed(90%) raw=230; ((230*35)+128)/256 => 31.
    // distance bucket floor(352 / (8 * 5)) => 8; 31 / 8 truncates to 3.
    const distPx = 352 * ICON_PIXEL_W / ICON_LEPTON_W;
    expect(modifyDamage(35, 'Fire', 'none', distPx)).toBe(3);
  });
});

// =============================================================================
// 7. SPLASH DAMAGE — Explosion_Damage (combat.cpp:162-271)
// =============================================================================

describe('Splash damage matches C++ Explosion_Damage (combat.cpp:162-271)', () => {

  // ── 7a. Splash radius = 1.5 cells (ICON_LEPTON_W + ICON_LEPTON_W/2) ──

  it('splash radius = 1.5 cells (C++ ICON_LEPTON_W + ICON_LEPTON_W>>1 = 384 leptons = 1.5 cells)', () => {
    // C++ combat.cpp:176: range = ICON_LEPTON_W + (ICON_LEPTON_W >> 1) = 256 + 128 = 384 leptons
    // 384 leptons / 256 leptons_per_cell = 1.5 cells
    expect(SPLASH_RADIUS).toBe(1.5);
  });

  // ── 7b. Entity at distance > 1.5 cells takes no splash damage ──

  it('entity beyond 1.5-cell splash radius takes no damage', () => {
    // Place target 2 cells away from explosion center
    const target = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([target]);
    const hpBefore = target.hp;

    applySplashDamage(
      ctx,
      { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 200, warhead: 'HE', splash: 1.5 },
      -1, House.Spain,
    );

    expect(target.hp).toBe(hpBefore);
  });

  it('entity exactly at 1.5-cell splash radius takes no damage (strict C++ distance < range)', () => {
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const target = new Entity(UnitType.I_E1, House.USSR, center.x + (1.5 * CELL_SIZE), center.y);
    const ctx = makeCombatCtx([target]);
    const hpBefore = target.hp;

    applySplashDamage(
      ctx,
      center,
      { damage: 200, warhead: 'HE', splash: 1.5 },
      -1, House.Spain,
    );

    expect(target.hp).toBe(hpBefore);
  });

  it('entity within radius but outside the impact plus adjacent cell scan takes no splash damage', () => {
    // C++ combat.cpp:188-216 collects victims from Coord_Cell(impact) and
    // the eight adjacent cells before applying Distance() < 384. This SCG04
    // geometry is 380 leptons from the impact, but the infantry is two cells
    // north of the impact cell, so C++ never adds it to the damage list.
    const center = {
      x: 18152 * CELL_SIZE / ICON_LEPTON_W,
      y: 15656 * CELL_SIZE / ICON_LEPTON_W,
    };
    const target = new Entity(
      UnitType.I_E1,
      House.Greece,
      18112 * CELL_SIZE / ICON_LEPTON_W,
      15296 * CELL_SIZE / ICON_LEPTON_W,
    );
    const ctx = makeCombatCtx([target]);
    const hpBefore = target.hp;

    applySplashDamage(
      ctx,
      center,
      { damage: 200, warhead: 'HE', splash: 1.5 },
      -1,
      House.BadGuy,
    );

    expect(target.hp).toBe(hpBefore);
  });

  it('Explosion_Damage does not collect top-layer fixed-wing aircraft', () => {
    // C++ combat.cpp snapshots Cell_Occupier() chains. FootClass::Mark converts
    // MARK_DOWN to MARK_CHANGE for top-layer objects, so an airborne fixed-wing
    // aircraft is not in Cell_Occupier and cannot be hit by ground splash.
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    yak.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const ctx = makeCombatCtx([yak]);
    const hpBefore = yak.hp;

    applySplashDamage(
      ctx,
      yak.pos,
      { damage: 200, warhead: 'Fire', splash: 1.5 },
      -1, House.Spain,
    );

    expect(yak.hp).toBe(hpBefore);
  });

  it('Explosion_Damage collects grounded fixed-wing aircraft', () => {
    // Once a fixed-wing aircraft reaches Height=0, AircraftClass::In_Which_Layer
    // returns ground and Cell_Occupier splash can damage it like other FootClass
    // objects.
    const yak = entityAtCell(UnitType.V_YAK, House.USSR, 10, 10);
    yak.flightAltitude = 0;
    yak.aircraftState = 'landed';
    const ctx = makeCombatCtx([yak]);
    const hpBefore = yak.hp;

    applySplashDamage(
      ctx,
      yak.pos,
      { damage: 200, warhead: 'Fire', splash: 1.5 },
      -1, House.Spain,
    );

    expect(yak.hp).toBeLessThan(hpBefore);
  });

  it('Explosion_Damage only collects helicopters after they enter the ground layer', () => {
    // Non-fixed aircraft use ObjectClass::In_Which_Layer: Height >=
    // FLIGHT_LEVEL - FLIGHT_LEVEL/3 is top layer. With TS' pixel altitude,
    // 16px is still top-layer; 15px is ground-layer.
    const topLayerHeli = entityAtCell(UnitType.V_HELI, House.USSR, 10, 10);
    topLayerHeli.flightAltitude = 16;
    const topCtx = makeCombatCtx([topLayerHeli]);
    const topHpBefore = topLayerHeli.hp;

    applySplashDamage(
      topCtx,
      topLayerHeli.pos,
      { damage: 200, warhead: 'HE', splash: 1.5 },
      -1, House.Spain,
    );

    expect(topLayerHeli.hp).toBe(topHpBefore);

    const groundLayerHeli = entityAtCell(UnitType.V_HELI, House.USSR, 10, 10);
    groundLayerHeli.flightAltitude = 15;
    const groundCtx = makeCombatCtx([groundLayerHeli]);
    const groundHpBefore = groundLayerHeli.hp;

    applySplashDamage(
      groundCtx,
      groundLayerHeli.pos,
      { damage: 200, warhead: 'HE', splash: 1.5 },
      -1, House.Spain,
    );

    expect(groundLayerHeli.hp).toBeLessThan(groundHpBefore);
  });

  it('Explosion_Damage processes cell occupier order, not all infantry before buildings', () => {
    // SCG12EA tick 25: the first cruiser shell hits V19 at (84,82).
    // C++ snapshots Cell_Occupier chains in center/N/NE/E/SE/S/SW/W/NW order.
    // That destroys the adjacent barrels before the E2 death explosion can
    // cascade extra structure damage into the northern V19/BRL3.
    const attacker = entityAtCell(UnitType.V_CA, House.USSR, 10, 10);
    const e2 = entityAtCell(UnitType.I_E2, House.Spain, 83, 82);
    const e1North = entityAtCell(UnitType.I_E1, House.Spain, 82, 80);
    const e1Mid = entityAtCell(UnitType.I_E1, House.Spain, 82, 81);
    const ctx = makeCombatCtx([attacker, e2, e1North, e1Mid]);

    const v19North = structureAtCell('V19', House.Spain, 83, 80);
    const targetV19 = structureAtCell('V19', House.Spain, 84, 82);
    const brl3 = structureAtCell('BRL3', House.Spain, 84, 80);
    const barlNorth = structureAtCell('BARL', House.Spain, 84, 81);
    const barlWest = structureAtCell('BARL', House.Spain, 83, 81);
    const barlSouth = structureAtCell('BARL', House.Spain, 84, 83);
    ctx.structures.push(v19North, targetV19, brl3, barlNorth, barlWest, barlSouth);

    applySplashDamage(
      ctx,
      { x: 21625 * CELL_SIZE / LEPTON_SIZE, y: 21095 * CELL_SIZE / LEPTON_SIZE },
      WEAPON_STATS['8Inch'],
      -1,
      attacker.house,
      attacker,
    );

    expect(targetV19.alive).toBe(false);
    expect(barlNorth.alive).toBe(false);
    expect(barlWest.alive).toBe(false);
    expect(barlSouth.alive).toBe(false);
    expect(v19North.hp).toBe(396);
    expect(brl3.hp).toBe(5);
  });

  it('pending Drop_Debris buildings still occupy an Explosion_Damage object slot', () => {
    // C++ BuildingClass::Take_Damage leaves a zero-strength building in
    // Cell_Occupier until BuildingClass::AI calls Drop_Debris. Explosion_Damage
    // snapshots at most 32 objects, so pending debris must still consume a slot.
    const centerEntities = Array.from({ length: 31 }, () =>
      entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10));
    const cappedOutTarget = entityAtCell(UnitType.V_4TNK, House.USSR, 11, 9);
    const ctx = makeCombatCtx([...centerEntities, cappedOutTarget]);
    const pendingDebris = structureAtCell('V19', House.Spain, 10, 9);
    pendingDebris.hp = 0;
    pendingDebris.alive = false;
    pendingDebris.rubble = true;
    pendingDebris.debrisCountdown = 8;
    pendingDebris.debrisDropped = false;
    ctx.structures.push(pendingDebris);

    const targetHpBefore = cappedOutTarget.hp;

    applySplashDamage(
      ctx,
      { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1,
      House.Spain,
    );

    expect(cappedOutTarget.hp).toBe(targetHpBefore);
  });

  it('nested Explosion_Damage skips objects already reserved by the outer damage list', () => {
    // C++ uses ObjectClass::IsToDamage while building objects[32]. A grenadier
    // killed by the outer explosion can run Wide_Area_Damage before the outer
    // loop reaches later victims, and those pending victims must be skipped by
    // the nested explosion until the outer loop clears their IsToDamage flag.
    const attacker = entityAtCell(UnitType.V_CA, House.England, 20, 20);
    const grenadier = entityAtCell(UnitType.I_E2, House.USSR, 10, 10);
    const ctx = makeCombatCtx([attacker, grenadier]);
    const pendingStructure = structureAtCell('V19', House.USSR, 10, 9);
    pendingStructure.hp = 20;
    ctx.structures.push(pendingStructure);

    applySplashDamage(
      ctx,
      grenadier.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1,
      attacker.house,
      attacker,
    );

    expect(grenadier.alive).toBe(false);
    expect(pendingStructure.alive).toBe(true);
    expect(pendingStructure.hp).toBe(11);
  });

  // ── 7c. Entity at distance 0 (point-blank) takes full splash damage ──

  it('entity at explosion center takes full warhead damage (distance=0)', () => {
    // Use a high-HP target so it survives and we can measure exact damage
    const target = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10); // 600 HP Mammoth, armor=heavy
    const ctx = makeCombatCtx([target]);
    const hpBefore = target.hp;

    const heVsHeavy = parsedWarheads['HE'].verses[3]; // 0.25
    const baseDmg = 100;

    applySplashDamage(
      ctx,
      target.pos,
      { damage: baseDmg, warhead: 'HE', splash: 1.5 },
      -1, House.Spain,
    );

    // At distance=0, modifyDamage should yield baseDmg * heVsHeavy = 100*0.25 = 25
    const expectedDmg = Math.round(baseDmg * heVsHeavy);
    expect(hpBefore - target.hp).toBe(expectedDmg);
  });

  it('negative Organic explosion heals unarmored infantry at direct impact', () => {
    const target = entityAtCell(UnitType.I_E1, House.Greece, 10, 10);
    target.hp = target.maxHp - 30;
    const medic = entityAtCell(UnitType.I_MEDI, House.Greece, 9, 10);
    const ctx = makeCombatCtx([target, medic]);
    ScenarioRandom.seed = 12345;
    const seedBefore = ScenarioRandom.seed;

    applySplashDamage(
      ctx,
      target.pos,
      { damage: -50, warhead: 'Organic', splash: 1.5 },
      -1, House.Greece, medic,
    );

    expect(target.hp).toBe(target.maxHp);
    expect(ScenarioRandom.seed).toBe(seedBefore);
    expect(target.moveTarget).toBeNull();
  });

  it('negative Organic explosion does not heal armored units', () => {
    const target = entityAtCell(UnitType.V_2TNK, House.Greece, 10, 10);
    target.hp = target.maxHp - 30;
    const medic = entityAtCell(UnitType.I_MEDI, House.Greece, 9, 10);
    const ctx = makeCombatCtx([target, medic]);

    applySplashDamage(
      ctx,
      target.pos,
      { damage: -50, warhead: 'Organic', splash: 1.5 },
      -1, House.Greece, medic,
    );

    expect(target.hp).toBe(target.maxHp - 30);
  });

  // ── 7d. Entity at 1 cell distance takes reduced splash damage ──

  it('entity 1 cell from explosion takes distance-reduced damage', () => {
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const ctx = makeCombatCtx([target]);
    const hpBefore = target.hp;

    applySplashDamage(
      ctx,
      { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 200, warhead: 'HE', splash: 1.5 },
      -1, House.Spain,
    );

    // 1 cell = CELL_SIZE=24 pixels; modifyDamage with HE(Spread=6):
    // distFactor = floor(24*2/6) = 8; damage = round(200*0.9)/8 = 22
    const heVsNone = parsedWarheads['HE'].verses[0];
    const heSpread = parsedWarheads['HE'].spread;
    const distFactor = Math.floor(CELL_SIZE * 2 / heSpread);
    const expectedDmg = Math.trunc(Math.round(200 * heVsNone) / distFactor);

    expect(hpBefore - target.hp).toBe(expectedDmg);
  });

  it('applies infantry prone bias before distance falloff', () => {
    // C++ order:
    //   infantry.cpp:329 ProneDamageBias first
    //   object.cpp:1581 Modify_Damage distance falloff second.
    //
    // For 15 SA at ~0.7 cells, prone bias turns 15 -> 8; SA Spread=3 then
    // truncates 8 / 12 to 0. Applying falloff first would produce 1 damage.
    const center = {
      x: 10 * CELL_SIZE + CELL_SIZE / 2,
      y: 10 * CELL_SIZE + CELL_SIZE / 2,
    };
    const direct = new Entity(UnitType.I_E4, House.USSR, center.x, center.y);
    direct.isProne = true;
    const nearbyProne = new Entity(UnitType.I_E4, House.USSR, center.x + CELL_SIZE / 2, center.y + CELL_SIZE / 2);
    nearbyProne.isProne = true;
    const ctx = makeCombatCtx([direct, nearbyProne]);
    const directHp = direct.hp;
    const nearbyHp = nearbyProne.hp;

    applySplashDamage(
      ctx,
      center,
      { damage: 15, warhead: 'SA', splash: 1.5 },
      -1,
      House.England,
    );

    expect(directHp - direct.hp).toBe(Math.round(15 * PRONE_DAMAGE_BIAS));
    expect(nearbyProne.hp).toBe(nearbyHp);
  });

  // ── 7e. Firer excluded from own splash (combat.cpp:207) ──

  it('firer is excluded from its own splash (combat.cpp:207: object != source)', () => {
    const attacker = entityAtCell(UnitType.I_E2, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 10, 10); // same cell
    const ctx = makeCombatCtx([attacker, target]);
    const attackerHpBefore = attacker.hp;

    applySplashDamage(
      ctx, target.pos,
      { damage: 200, warhead: 'HE', splash: 1.5 },
      -1, House.Spain, attacker,
    );

    expect(attacker.hp).toBe(attackerHpBefore);
  });

  it('wall Reduce_Wall is impact-cell only and uses C++ DamagePoints rejection RNG', () => {
    const ctx = makeCombatCtx([]);
    const cx = 10;
    const cy = 10;
    ctx.map.setWallType(cx, cy, 'SBAG');      // DamagePoints=20, DamageLevels=1
    ctx.map.setWallType(cx + 1, cy, 'SBAG');  // Adjacent wall must not be touched.

    ScenarioRandom.seed = 115696874;
    ScenarioRandom.callCount = 0;

    applySplashDamage(
      ctx,
      { x: cx * CELL_SIZE + CELL_SIZE / 2, y: cy * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 16, warhead: 'HE', splash: 1.5 },
      -1,
      House.Spain,
    );

    // C++ CellClass::Reduce_Wall calls Random_Pick(0, 20). From this seed the
    // first masked pick is rejected (28), the second is accepted (15 < damage).
    expect(ScenarioRandom.callCount).toBe(2);
    expect(ScenarioRandom.seed).toBe(3602595448);
    expect(ctx.map.getWallType(cx, cy)).toBe('');
    expect(ctx.map.getWallType(cx + 1, cy)).toBe('SBAG');
  });

  it('non-impact walls are not cleared by Explosion_Damage splash radius', () => {
    const ctx = makeCombatCtx([]);
    ctx.map.setWallType(11, 10, 'SBAG');

    applySplashDamage(
      ctx,
      { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1,
      House.Spain,
    );

    expect(ctx.map.getWallType(11, 10)).toBe('SBAG');
  });

  it('building RESULT_HALF damage state runs C++ occupy-list fire RNG under Take_Damage tag', () => {
    const apwr = structureAtCell('APWR', House.USSR, 10, 10);
    apwr.hp = 400;
    const ctx = makeCombatCtx([]);
    ctx.structures.push(apwr);

    ScenarioRandom.seed = 2849928510;
    ScenarioRandom.callCount = 0;
    ScenarioRandom._seedLog = [];
    ScenarioRandom._sourceTag = 60043;
    ScenarioRandom._tagLogging = true;

    try {
      applySplashDamage(
        ctx,
        { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 11 * CELL_SIZE + CELL_SIZE / 2 },
        { damage: 140, warhead: 'HE', splash: 1.5 },
        -1,
        House.Spain,
      );
    } finally {
      ScenarioRandom._tagLogging = false;
    }

    expect(apwr.hp).toBeLessThan(apwr.maxHp >> 1);
    expect(STRUCTURE_SIZE.APWR).toEqual([3, 3]);
    // C++ building.cpp:1459 argument order is source order for this path:
    // Percent_Chance, Coord_Scatter, Random_Pick(0,7), Random_Pick(1,3).
    // SCG08EA tick 1309 pins this against the WASM oracle.
    expect(ScenarioRandom._seedLog.map(([, tag]) => tag)).toEqual([
      52005, 52005, 52005, 50002,
      52005, 52005, 52005, 50002,
      52005, 52005, 52005, 52005, 52005, 50002,
      52005, 52005,
    ]);
    expect(ScenarioRandom.seed).toBe(2687543790);
    expect(ScenarioRandom._sourceTag).toBe(60043);
  });

  it('building RESULT_DESTROYED uses C++ occupy-list explosion RNG and defers Drop_Debris', () => {
    const apwr = structureAtCell('APWR', House.Greece, 10, 10);
    const ctx = makeCombatCtx([]);
    ctx.structures.push(apwr);

    ScenarioRandom.seed = 4225763526;
    ScenarioRandom.callCount = 0;
    ScenarioRandom._seedLog = [];
    ScenarioRandom._sourceTag = 60043;
    ScenarioRandom._tagLogging = true;

    try {
      applySplashDamage(
        ctx,
        { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 11 * CELL_SIZE + CELL_SIZE / 2 },
        { damage: 999, warhead: 'HE', splash: 1.5 },
        -1,
        House.USSR,
      );
    } finally {
      ScenarioRandom._tagLogging = false;
    }

    expect(apwr.alive).toBe(false);
    expect(ctx.entities).toHaveLength(0);
    expect(apwr.debrisCountdown).toBe(8);
    const mediumFire = ctx.logicAnims.filter(anim => anim.type === 'fire_med');
    expect(mediumFire.map(anim => anim.delay)).toEqual([5, 2]);
    expect(mediumFire.map(anim => anim.loops)).toEqual([3, 3]);
    expect(ScenarioRandom._seedLog.map(([, tag]) => tag)).toEqual([
      52005, 52005, 50002, 52005, 52005,
      52005, 52005, 52005, 50002, 52005,
      52005, 52005, 52005, 50002, 52005,
      52005, 52005, 50002, 52005, 52005,
      52005, 52005, 50002, 52005, 52005,
      50002, 52005, 52005, 52005, 52005,
      52005, 50002, 52005, 52005, 52005,
      50002, 52005, 52005, 52005, 52005,
      52005, 50002, 52005, 52005, 52005,
      50002, 52005, 52005, 52005, 52005,
      50002, 52005,
    ]);
    expect(ScenarioRandom.seed).toBe(292287586);
    expect(ScenarioRandom._sourceTag).toBe(60043);
  });

  it('destroyed building CountDown does not elapse in the frame it is assigned', () => {
    const apwr = structureAtCell('APWR', House.Greece, 10, 10);
    const ctx = makeCombatCtx([]);
    ctx.tick = 100;
    ctx.structures.push(apwr);

    applySplashDamage(
      ctx,
      { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 11 * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 999, warhead: 'HE', splash: 1.5 },
      -1,
      House.USSR,
    );

    expect(apwr.alive).toBe(false);
    expect(apwr.debrisCountdown).toBe(8);

    tickDestroyedStructureDebris(ctx, apwr);
    expect(apwr.debrisDropped).toBe(false);
    expect(apwr.debrisCountdown).toBe(8);

    for (let frame = 101; frame < 108; frame++) {
      ctx.tick = frame;
      tickDestroyedStructureDebris(ctx, apwr);
      expect(apwr.debrisDropped).toBe(false);
      expect(apwr.debrisCountdown).toBe(108 - frame);
    }

    ctx.tick = 108;
    tickDestroyedStructureDebris(ctx, apwr);
    expect(apwr.debrisDropped).toBe(true);
    expect(apwr.debrisCountdown).toBeUndefined();
  });

  it('Drop_Debris smoke uses C++ AnimClass argument order', () => {
    const barrel = structureAtCell('BRL3', House.Turkey, 107, 77);
    const ctx = makeCombatCtx([]);
    ctx.structures.push(barrel);
    barrel.alive = false;
    barrel.hp = 0;
    barrel.rubble = true;
    barrel.debrisCountdown = 0;
    barrel.debrisDropped = false;

    // SCG14EA tick 137: C++ Drop_Debris for this BRL3 consumes the smoke
    // switch, then AnimClass constructor args in source order: Coord_Scatter,
    // delay, then loop.
    ScenarioRandom.seed = 1974182732;
    ScenarioRandom.callCount = 0;
    ScenarioRandom._seedLog = [];
    ScenarioRandom._sourceTag = 12239;
    ScenarioRandom._tagLogging = true;
    try {
      expect(tickDestroyedStructureDebris(ctx, barrel)).toBe(true);
    } finally {
      ScenarioRandom._tagLogging = false;
    }

    expect(ScenarioRandom._seedLog.map(([, tag]) => tag).slice(0, 5)).toEqual([
      12239, 12239, 50002, 12239, 12239,
    ]);
    expect(ScenarioRandom._seedLog.map(([seed]) => seed).slice(0, 5)).toEqual([
      4271759253, 1167444138, 2707844251, 1217767480, 3561611281,
    ]);
    expect(ctx.logicAnims).toHaveLength(1);
    expect(ctx.logicAnims[0]).toMatchObject({
      type: 'smoke_m',
      delay: 2,
      loops: 6,
    });
    expect(ctx.effects.find(e => e.sprite === 'smoke_m')).toBeUndefined();
    expect(ctx.map.decals).toHaveLength(0);
    expect(ctx.map.smudges).toHaveLength(1);
  });

  it('Drop_Debris skips smoke constructor RNG when the C++ AnimClass heap is full', () => {
    const barrel = structureAtCell('BRL3', House.Turkey, 107, 77);
    const ctx = makeCombatCtx([]);
    ctx.reserveAnimSlot = () => false;
    ctx.structures.push(barrel);
    barrel.alive = false;
    barrel.hp = 0;
    barrel.rubble = true;
    barrel.debrisCountdown = 0;
    barrel.debrisDropped = false;

    ScenarioRandom.seed = 1974182732;
    ScenarioRandom.callCount = 0;
    ScenarioRandom._seedLog = [];
    ScenarioRandom._sourceTag = 12239;
    ScenarioRandom._tagLogging = true;
    try {
      expect(tickDestroyedStructureDebris(ctx, barrel)).toBe(true);
    } finally {
      ScenarioRandom._tagLogging = false;
    }

    // Allocation fails before constructor arguments are evaluated. The two
    // switch calls are followed by the ground-scar Percent_Chance, smudge pick,
    // and crater Coord_Scatter. The old TS path consumed smoke scatter/delay/loop
    // anyway, which matched only by spending RNG in the wrong call site.
    expect(ScenarioRandom._seedLog.map(([seed, tag]) => [seed, tag])).toEqual([
      [4271759253, 12239],
      [1167444138, 12239],
      [2707844251, 12239],
      [1217767480, 12239],
      [3561611281, 50002],
    ]);
    expect(ctx.effects.find(e => e.sprite === 'smoke_m')).toBeUndefined();
    expect(ctx.map.decals).toHaveLength(0);
    expect(ctx.map.smudges).toHaveLength(1);
  });

  it('Drop_Debris terrestrial gate ignores the building occupy bit', () => {
    // C++ building.cpp:1764-1783 calls
    // Is_Clear_To_Move(SPEED_TRACK, true, true), which ignores the
    // vehicle/building occupancy bit but still checks terrain and wall overlays.
    const barrel = structureAtCell('BRL3', House.Turkey, 107, 77);
    const ctx = makeCombatCtx([]);
    ctx.structures.push(barrel);
    ctx.map.setMovementBlocked(107, 77, true);
    barrel.alive = false;
    barrel.hp = 0;
    barrel.rubble = true;
    barrel.debrisCountdown = 0;
    barrel.debrisDropped = false;

    ScenarioRandom.seed = 1974182732;
    ScenarioRandom.callCount = 0;

    expect(tickDestroyedStructureDebris(ctx, barrel)).toBe(true);
    expect(ctx.logicAnims).toHaveLength(1);
    expect(ctx.map.smudges).toHaveLength(1);
  });

  it('forced building destruction suppresses Drop_Debris survivors', () => {
    const apwr = structureAtCell('APWR', House.BadGuy, 10, 10);
    const ctx = makeCombatCtx([]);
    ctx.structures.push(apwr);
    ScenarioRandom.seed = 12345;
    ScenarioRandom.callCount = 0;

    const destroyed = structureDamage(ctx, apwr, apwr.maxHp + 1, undefined, 'AP', { forced: true });
    expect(destroyed).toBe(true);
    expect(apwr.isSurvivorless).toBe(true);

    ctx.tick = 8;
    tickDestroyedStructureDebris(ctx, apwr);

    expect(apwr.debrisDropped).toBe(true);
    expect(ctx.entities).toHaveLength(0);
    expect(ScenarioRandom.callCount).toBe(79);
    expect(ScenarioRandom.seed).toBe(2490222064);
  });
});

// =============================================================================
// 8. FRIENDLY FIRE — splash damages ALL units (combat.cpp:205-215)
// =============================================================================

describe('Friendly fire: splash damages all units in radius (combat.cpp:205-215)', () => {
  it('friendly units in splash radius take damage', () => {
    // C++ Explosion_Damage collects ALL objects, not just enemies (combat.cpp:207)
    const ally = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ally]);
    const hpBefore = ally.hp;

    // Enemy attack centered on ally's cell
    applySplashDamage(
      ctx,
      ally.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1, House.USSR,
    );

    expect(ally.hp).toBeLessThan(hpBefore);
  });
});

// =============================================================================
// 9. OVERKILL BEHAVIOR — damage exceeds HP
// =============================================================================

describe('Overkill behavior: HP goes to 0 when damage exceeds current HP', () => {
  it('infantry with 50 HP takes 200 damage: killed, HP clamped', () => {
    const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    expect(e.hp).toBe(UNIT_STATS.E1.strength); // 50 HP
    const ctx = makeCombatCtx([e]);

    const killed = damageEntity(ctx, e, 200, 'HE');
    expect(killed).toBe(true);
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(e.alive).toBe(false);
  });

  it('overkill does not cause negative HP issues (no underflow)', () => {
    const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([e]);
    damageEntity(ctx, e, 9999, 'Super');
    // HP should be negative (entity.takeDamage does this.hp -= amount), but entity is dead
    expect(e.alive).toBe(false);
  });
});

// =============================================================================
// 9b. DEATH DETACH_ALL TEAM MEMBERSHIP (foot.cpp:1844-1853)
// =============================================================================

describe('Death Detach_All team membership parity (foot.cpp:1844-1853)', () => {
  it('destroyed foot members are removed from their Team before death animation continues', () => {
    const victim = entityAtCell(UnitType.I_E1, House.BadGuy, 5, 5);
    const attacker = entityAtCell(UnitType.I_E1, House.Greece, 6, 5);
    const team = new Team({
      typeName: 'death-team',
      house: House.BadGuy,
      desiredMembers: [{ type: UnitType.I_E1, count: 1 }],
      missionList: [{ mission: TMISSION_ATTACK, data: 2 }],
      forcedActive: true,
    });
    team.add(victim);

    const ctx = makeCombatCtx([victim, attacker]);
    const killed = damageEntity(ctx, victim, victim.hp + 10, 'SA', attacker);
    expect(killed).toBe(true);

    handleUnitDeath(ctx, victim, {
      screenShake: 4,
      explosionSize: 12,
      debris: false,
      explodeLgSound: false,
      attackerIsPlayer: true,
      trackLoss: false,
      attacker,
    });

    expect(victim.teamRef).toBeNull();
    expect(team.members).not.toContain(victim);
    expect((team as unknown as { isAltered: boolean }).isAltered).toBe(true);
  });
});

// =============================================================================
// 10. PRONE INFANTRY DAMAGE REDUCTION (infantry.cpp:329-330)
// =============================================================================

describe('Prone infantry take 50% damage (rules.ini ProneDamage, infantry.cpp:329-330)', () => {
  it('prone E1 takes half damage from direct hit', () => {
    const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e.isProne = true;
    const hpBefore = e.hp;
    const ctx = makeCombatCtx([e]);

    // Apply 40 raw damage — prone should halve it to 20
    damageEntity(ctx, e, 40, 'SA');

    // Prone damage: max(1, round(40 * 0.5)) = 20
    const expectedDmg = Math.max(1, Math.round(40 * INI_PRONE_DAMAGE));
    expect(hpBefore - e.hp).toBe(expectedDmg);
  });

  it('prone damage reduction uses ProneDamage from rules.ini', () => {
    // Verify the engine constant matches INI
    expect(PRONE_DAMAGE_BIAS).toBeCloseTo(INI_PRONE_DAMAGE, 4);
  });

  it('vehicles are NOT affected by prone damage bias', () => {
    // C++ only applies ProneDamageBias in infantry.cpp, not unit.cpp
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const hpBefore = tank.hp;
    const ctx = makeCombatCtx([tank]);

    damageEntity(ctx, tank, 100, 'AP');

    // No prone bias applied — full 100 damage
    expect(hpBefore - tank.hp).toBe(100);
  });
});

// =============================================================================
// 11. FIREPOWER BIAS (house.cpp:289 — houseBias multiplier)
// =============================================================================

describe('FirepowerBias multiplier in modifyDamage (house.cpp:289)', () => {
  it('houseBias=1.5 increases damage by 50%', () => {
    const heVsNone = parsedWarheads['HE'].verses[0]; // 0.9
    const result = modifyDamage(100, 'HE', 'none', 0, 1.5);
    // 100 * 0.9 * 1.5 = 135
    expect(result).toBe(Math.round(100 * heVsNone * 1.5));
  });

  it('houseBias=0.5 reduces damage by 50%', () => {
    const heVsNone = parsedWarheads['HE'].verses[0]; // 0.9
    const result = modifyDamage(100, 'HE', 'none', 0, 0.5);
    // 100 * 0.9 * 0.5 = 45
    expect(result).toBe(Math.round(100 * heVsNone * 0.5));
  });
});

// =============================================================================
// 12. SPECIFIC WEAPON SCENARIOS — real game matchups
// =============================================================================

describe('Real game weapon matchups match INI-parsed expected damage', () => {
  // Derive expected values from rules.ini warhead Verses tables

  it('M1Carbine (SA, dmg=15) vs Rifle Infantry (none): full 15 damage', () => {
    const saVsNone = parsedWarheads['SA'].verses[0]; // 1.0
    const result = modifyDamage(15, 'SA', 'none', 0);
    expect(result).toBe(Math.round(15 * saVsNone));
  });

  it('M1Carbine (SA, dmg=15) vs Heavy Tank (heavy): 15*25% = 4 damage', () => {
    const saVsHeavy = parsedWarheads['SA'].verses[3]; // 0.25
    const result = modifyDamage(15, 'SA', 'heavy', 0);
    expect(result).toBe(Math.round(15 * saVsHeavy));
  });

  it('120mm (AP, dmg=60) vs Heavy Tank (heavy): 60*100% = 60 damage', () => {
    const apVsHeavy = parsedWarheads['AP'].verses[3]; // 1.0
    const result = modifyDamage(60, 'AP', 'heavy', 0);
    expect(result).toBe(Math.round(60 * apVsHeavy));
  });

  it('120mm (AP, dmg=60) vs Rifle Infantry (none): 60*30% = 18 damage', () => {
    const apVsNone = parsedWarheads['AP'].verses[0]; // 0.3
    const result = modifyDamage(60, 'AP', 'none', 0);
    expect(result).toBe(Math.round(60 * apVsNone));
  });

  it('Nuke (dmg=1000) vs concrete: 1000*50% = 500', () => {
    const nukeVsConcrete = parsedWarheads['Nuke'].verses[4]; // 0.5
    const result = modifyDamage(1000, 'Nuke', 'concrete', 0);
    expect(result).toBe(Math.round(1000 * nukeVsConcrete));
  });

  it('Nuke vs Nuke: verses match Fire warhead exactly (rules.ini comment)', () => {
    // rules.ini: "; Nuclear warhead (same as fire)" — verify verses are identical
    for (let i = 0; i < 5; i++) {
      expect(
        parsedWarheads['Nuke'].verses[i],
        `Nuke vs ${ARMOR_TYPES[i]} should match Fire`,
      ).toBeCloseTo(parsedWarheads['Fire'].verses[i], 4);
    }
  });
});

// =============================================================================
// 13. SCATTER DAMAGE — multiple entities in splash
// =============================================================================

describe('Scatter damage: multiple entities in splash radius receive damage', () => {
  it('3 infantry near explosion all take damage proportional to distance', () => {
    // Place 3 infantry at varying distances from explosion center
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10); // distance ~0
    const e2 = entityAtCell(UnitType.I_E1, House.USSR, 11, 10); // distance ~1 cell
    const e3 = entityAtCell(UnitType.I_E1, House.USSR, 10, 11); // distance ~1 cell
    const ctx = makeCombatCtx([e1, e2, e3]);
    const hp1Before = e1.hp;
    const hp2Before = e2.hp;
    const hp3Before = e3.hp;

    applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1.5 }, -1, House.Spain);

    // e1 at distance 0 should take most damage
    const dmg1 = hp1Before - e1.hp;
    const dmg2 = hp2Before - e2.hp;
    const dmg3 = hp3Before - e3.hp;

    // All should take some damage (within 1.5 cell radius)
    expect(dmg1).toBeGreaterThan(0);
    expect(dmg2).toBeGreaterThan(0);
    expect(dmg3).toBeGreaterThan(0);

    // Center entity takes more than peripheral entities
    expect(dmg1).toBeGreaterThan(dmg2);

    // Equidistant entities take equal damage
    expect(dmg2).toBe(dmg3);
  });
});

// =============================================================================
// 14. WARHEAD ISORGANIC FLAG (warhead.cpp:187)
// =============================================================================

describe('IsOrganic flag derived from Verses (warhead.cpp:187)', () => {
  it('Organic warhead: Modifier[ARMOR_STEEL]=0 means IsOrganic=true', () => {
    // C++ warhead.cpp:187: IsOrganic = (Modifier[ARMOR_STEEL] == 0)
    // ARMOR_STEEL is index 3 (heavy). Organic has Verses=100%,0%,0%,0%,0%
    const orgVsHeavy = parsedWarheads['Organic'].verses[3];
    expect(orgVsHeavy).toBe(0);
  });

  it('SA warhead: Modifier[ARMOR_STEEL]=25% means IsOrganic=false', () => {
    const saVsHeavy = parsedWarheads['SA'].verses[3];
    expect(saVsHeavy).toBeGreaterThan(0);
  });
});

// =============================================================================
// 15. INVULNERABILITY — zero damage on invulnerable entities
// =============================================================================

describe('Invulnerable entities take no damage (entity.takeDamage check)', () => {
  it('invulnerable entity takes 0 damage from any warhead', () => {
    const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e.invulnTick = 100; // grant invulnerability (Iron Curtain / crate)
    const hpBefore = e.hp;
    const ctx = makeCombatCtx([e]);

    damageEntity(ctx, e, 999, 'Super');
    expect(e.hp).toBe(hpBefore);
    expect(e.alive).toBe(true);
  });
});

// =============================================================================
// 16. C++ PIXEL_LEPTON_W VALUE VERIFICATION
// =============================================================================

describe('C++ display.h constants used in distance conversion', () => {
  it('ICON_PIXEL_W = 24 (display.h:45)', () => {
    // TS CELL_SIZE must match C++ ICON_PIXEL_W
    expect(CELL_SIZE).toBe(ICON_PIXEL_W);
  });

  it('PIXEL_LEPTON_W = floor(256/24) = 10 (display.h:55)', () => {
    expect(PIXEL_LEPTON_W).toBe(10);
  });

  it('Spread=6: PIXEL_LEPTON_W/2 * 6 = 30 (divisor for HE distance falloff)', () => {
    // C++ combat.cpp:110 — distance /= whead->SpreadFactor * (PIXEL_LEPTON_W/2)
    const heSpread = parsedWarheads['HE'].spread;
    const divisor = heSpread * Math.floor(PIXEL_LEPTON_W / 2);
    expect(divisor).toBe(30);
  });

  it('Spread=0: PIXEL_LEPTON_W/4 = 2 (divisor for Organic distance falloff)', () => {
    // C++ combat.cpp:108 — distance /= PIXEL_LEPTON_W/4
    const divisor = Math.floor(PIXEL_LEPTON_W / 4);
    expect(divisor).toBe(2);
  });
});
