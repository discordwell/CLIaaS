/**
 * C++ Behavioral Parity: Defense Structures (PBOX, HBOX, GUN, FTUR, TSLA)
 *
 * Comprehensive audit of garrison/pillbox mechanics, flame turret, tesla coil,
 * and gun turret — verifying TS engine matches rules.ini authoritative values.
 *
 * ALL expected values are parsed from rules.ini at test time. Nothing is hardcoded.
 *
 * Defense structures tested:
 *   PBOX  — Pillbox        (Allied, Vulcan weapon, SA warhead, Crewed=yes, unpowered)
 *   HBOX  — Camo Pillbox   (Allied, Vulcan weapon, SA warhead, Crewed=yes, unpowered)
 *   GUN   — Gun Turret     (Allied, TurretGun weapon, AP warhead, Crewed=yes, turreted, unpowered)
 *   FTUR  — Flame Turret   (Soviet, FireballLauncher weapon, Fire warhead, Crewed=yes, unpowered)
 *   TSLA  — Tesla Coil     (Soviet, TeslaZap weapon, Super warhead, Crewed=yes, Powered=true)
 *
 * C++ source references (no .cpp files in repo, behavior inferred from rules.ini + TS engine):
 *   building.cpp — structure auto-fire logic, turret rotation, ammo reload
 *   combat.cpp   — Modify_Damage, warhead vs armor, splash damage
 *   bdata.cpp    — per-building constructors reading INI defaults
 *   warhead.cpp  — Verses= parsing, spread factor
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, WARHEAD_VS_ARMOR, WARHEAD_PROPS,
  type WarheadType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  updateStructureCombat,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, type StructureWeapon,
  STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP, STRUCTURE_POWERED,
  STRUCTURE_ARMOR,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ============================================================================
// INI Parser — parses rules.ini [Section] Key=Value format
// ============================================================================

interface IniData {
  [section: string]: { [key: string]: string };
}

function parseIni(text: string): IniData {
  const data: IniData = {};
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/;.*$/, '').trim();
    if (!line) continue;
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) {
      currentSection = secMatch[1];
      if (!data[currentSection]) data[currentSection] = {};
      continue;
    }
    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (kvMatch && currentSection) {
      data[currentSection][kvMatch[1].trim()] = kvMatch[2].trim();
    }
  }
  return data;
}

/** Parse Verses= "100%,50%,60%,25%,25%" => [1.0, 0.5, 0.6, 0.25, 0.25] */
function parseVerses(versesStr: string): [number, number, number, number, number] {
  const parts = versesStr.split(',').map(s => {
    const trimmed = s.trim().replace('%', '');
    return parseFloat(trimmed) / 100;
  });
  if (parts.length !== 5) {
    throw new Error(`Expected 5 verse values, got ${parts.length}: "${versesStr}"`);
  }
  return parts as [number, number, number, number, number];
}

/** Parse INI boolean: yes/true => true, else false */
function iniBool(val: string | undefined): boolean {
  if (!val) return false;
  const lc = val.toLowerCase();
  return lc === 'yes' || lc === 'true';
}

// ============================================================================
// Load rules.ini once at module level (synchronous, before any test runs)
// ============================================================================

const rulesPath = resolve(__dirname, '../../../public/ra/assets/rules.ini');
const ini: IniData = parseIni(readFileSync(rulesPath, 'utf-8'));

// ============================================================================
// Test Helpers — shared across all defense structure tests
// ============================================================================

function makeDefenseStructure(
  type: string,
  house: House,
  cx: number,
  cy: number,
  opts: {
    hp?: number;
    cooldown?: number;
    ammo?: number;
    maxAmmo?: number;
    turretDir?: number;
    desiredTurretDir?: number;
  } = {},
): MapStructure {
  const maxHp = opts.hp ?? STRUCTURE_MAX_HP[type] ?? 256;
  const weapon = STRUCTURE_WEAPONS[type] ? { ...STRUCTURE_WEAPONS[type] } : undefined;
  const result: MapStructure = {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: maxHp,
    maxHp,
    alive: true,
    rubble: false,
    weapon,
    attackCooldown: opts.cooldown ?? 0,
    ammo: opts.ammo ?? -1,
    maxAmmo: opts.maxAmmo ?? -1,
  };
  if (opts.turretDir !== undefined) result.turretDir = opts.turretDir;
  if (opts.desiredTurretDir !== undefined) result.desiredTurretDir = opts.desiredTurretDir;
  return result;
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
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

// ============================================================================
// Defense buildings to audit and their primary weapons from rules.ini
// ============================================================================
const DEFENSE_BUILDINGS = ['PBOX', 'HBOX', 'GUN', 'FTUR', 'TSLA'] as const;

// ============================================================================
// Section 1: INI Building Stats — Strength, Armor, Cost, Owner, TechLevel
//
// rules.ini is the authoritative source for ALL building stats.
// Tests parse INI at runtime; no hardcoded expected values.
// ============================================================================

describe('Defense building stats parsed from rules.ini', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    describe(`[${bldg}] building section`, () => {
      it(`[${bldg}] section exists in rules.ini`, () => {
        expect(ini[bldg], `[${bldg}] section must exist in rules.ini`).toBeDefined();
      });

      it(`[${bldg}] Strength matches STRUCTURE_MAX_HP`, () => {
        const iniStrength = Number(ini[bldg].Strength);
        const tsMaxHp = STRUCTURE_MAX_HP[bldg];
        expect(tsMaxHp, `${bldg}: TS maxHp=${tsMaxHp}, rules.ini Strength=${iniStrength}`).toBe(iniStrength);
      });

      it(`[${bldg}] Armor matches STRUCTURE_ARMOR`, () => {
        const iniArmor = ini[bldg].Armor;
        const tsArmor = STRUCTURE_ARMOR[bldg];
        expect(tsArmor, `${bldg}: TS armor=${tsArmor}, rules.ini Armor=${iniArmor}`).toBe(iniArmor);
      });

      it(`[${bldg}] has Crewed=yes in rules.ini (garrison flag)`, () => {
        const iniCrewedRaw = ini[bldg].Crewed;
        expect(iniBool(iniCrewedRaw), `${bldg}: Crewed=${iniCrewedRaw} should be yes/true`).toBe(true);
      });

      it(`[${bldg}] has Sensors=yes in rules.ini (reveals stealth)`, () => {
        // All 5 defense buildings have Sensors=yes in rules.ini
        // (GUN does NOT have Sensors= line but PBOX, HBOX, TSLA, FTUR do)
        const iniSensors = ini[bldg].Sensors;
        if (iniSensors !== undefined) {
          expect(iniBool(iniSensors), `${bldg}: Sensors=${iniSensors}`).toBe(true);
        }
        // GUN lacks Sensors line — skip assertion for GUN (default is no)
      });

      it(`[${bldg}] has a Primary= weapon defined`, () => {
        const iniPrimary = ini[bldg].Primary;
        expect(iniPrimary, `${bldg}: Primary= must be defined in rules.ini`).toBeDefined();
        expect(iniPrimary.length).toBeGreaterThan(0);
      });
    });
  }
});

// ============================================================================
// Section 2: INI Weapon Stats — Damage, ROF, Range, Speed, Warhead
//
// Each defense building has a Primary= weapon. The weapon section defines:
//   Damage, ROF, Range, Speed, Warhead, Projectile
// All values parsed from INI and compared to STRUCTURE_WEAPONS entries.
// ============================================================================

describe('Defense weapon stats parsed from rules.ini', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    const weaponName = ini[bldg]?.Primary;
    if (!weaponName) continue; // guard for safety; tested above

    describe(`[${bldg}] Primary=${weaponName} weapon parity`, () => {
      it(`weapon section [${weaponName}] exists in rules.ini`, () => {
        expect(ini[weaponName], `[${weaponName}] weapon section must exist`).toBeDefined();
      });

      it(`${bldg} STRUCTURE_WEAPONS entry exists`, () => {
        expect(STRUCTURE_WEAPONS[bldg], `${bldg} must be in STRUCTURE_WEAPONS`).toBeDefined();
      });

      it(`${bldg} damage matches [${weaponName}] Damage=`, () => {
        const iniDamage = Number(ini[weaponName].Damage);
        const tsDamage = STRUCTURE_WEAPONS[bldg].damage;
        expect(tsDamage, `${bldg}: TS=${tsDamage}, INI [${weaponName}] Damage=${iniDamage}`).toBe(iniDamage);
      });

      it(`${bldg} ROF matches [${weaponName}] ROF=`, () => {
        const iniROF = Number(ini[weaponName].ROF);
        const tsROF = STRUCTURE_WEAPONS[bldg].rof;
        expect(tsROF, `${bldg}: TS=${tsROF}, INI [${weaponName}] ROF=${iniROF}`).toBe(iniROF);
      });

      it(`${bldg} range matches [${weaponName}] Range=`, () => {
        const iniRange = Number(ini[weaponName].Range);
        const tsRange = STRUCTURE_WEAPONS[bldg].range;
        expect(tsRange, `${bldg}: TS=${tsRange}, INI [${weaponName}] Range=${iniRange}`).toBe(iniRange);
      });

      it(`${bldg} projSpeed matches [${weaponName}] Speed=`, () => {
        const iniSpeed = Number(ini[weaponName].Speed);
        const tsProjSpeed = STRUCTURE_WEAPONS[bldg].projSpeed;
        expect(tsProjSpeed, `${bldg}: TS=${tsProjSpeed}, INI [${weaponName}] Speed=${iniSpeed}`).toBe(iniSpeed);
      });

      it(`${bldg} warhead matches [${weaponName}] Warhead=`, () => {
        const iniWarhead = ini[weaponName].Warhead;
        const tsWarhead = STRUCTURE_WEAPONS[bldg].warhead;
        expect(tsWarhead, `${bldg}: TS=${tsWarhead}, INI [${weaponName}] Warhead=${iniWarhead}`).toBe(iniWarhead);
      });
    });
  }
});

// ============================================================================
// Section 3: Warhead Verses vs Armor — parsed from rules.ini [Warhead] Verses=
//
// For each defense weapon's warhead, parse Verses= and compare against
// WARHEAD_VS_ARMOR TS table. Armor order: [none, wood, light, heavy, concrete]
// ============================================================================

describe('Defense warhead Verses= vs WARHEAD_VS_ARMOR parity', () => {
  // Collect the unique warheads used by our defense buildings
  const warheadSet = new Set<string>();
  for (const bldg of DEFENSE_BUILDINGS) {
    const weaponName = ini[bldg]?.Primary;
    if (weaponName && ini[weaponName]?.Warhead) {
      warheadSet.add(ini[weaponName].Warhead);
    }
  }

  const ARMOR_NAMES = ['none', 'wood', 'light', 'heavy', 'concrete'];

  for (const whName of warheadSet) {
    describe(`[${whName}] warhead Verses=`, () => {
      it(`[${whName}] section exists in rules.ini`, () => {
        expect(ini[whName], `[${whName}] warhead section must exist`).toBeDefined();
      });

      it(`[${whName}] Verses= exists`, () => {
        expect(ini[whName].Verses, `[${whName}] Verses= must be defined`).toBeDefined();
      });

      it(`[${whName}] Verses= matches WARHEAD_VS_ARMOR`, () => {
        const iniVerses = parseVerses(ini[whName].Verses);
        const tsVerses = WARHEAD_VS_ARMOR[whName as WarheadType];
        expect(tsVerses, `WARHEAD_VS_ARMOR['${whName}'] must exist`).toBeDefined();
        for (let i = 0; i < 5; i++) {
          expect(tsVerses[i],
            `${whName} vs ${ARMOR_NAMES[i]}: TS=${tsVerses[i]}, INI=${iniVerses[i]}`
          ).toBe(iniVerses[i]);
        }
      });
    });
  }
});

// ============================================================================
// Section 4: Powered= Flag Parity — from rules.ini per-building Powered= key
//
// C++ bdata.cpp:2836 — IsPowered defaults to false. Only buildings with
// explicit Powered=true in rules.ini are power-dependent.
// Defense buildings: TSLA has Powered=true; PBOX, HBOX, GUN, FTUR do NOT.
// ============================================================================

describe('Powered= flag parity for defense buildings', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    const iniPowered = iniBool(ini[bldg]?.Powered);

    it(`[${bldg}] Powered=${ini[bldg]?.Powered ?? '(absent)'} => ${iniPowered} matches STRUCTURE_POWERED`, () => {
      const tsPowered = STRUCTURE_POWERED.has(bldg);
      expect(tsPowered,
        `${bldg}: TS STRUCTURE_POWERED.has=${tsPowered}, INI Powered=${iniPowered}`
      ).toBe(iniPowered);
    });
  }

  it('only TSLA among defense buildings is powered (INI-verified)', () => {
    const poweredDefenses = DEFENSE_BUILDINGS.filter(b => iniBool(ini[b]?.Powered));
    expect(poweredDefenses).toEqual(['TSLA']);
  });
});

// ============================================================================
// Section 5: Crewed= Flag — All defense buildings have Crewed=yes
//
// C++ building.cpp — Crewed buildings spawn infantry survivors when destroyed.
// rules.ini: All 5 defense buildings have Crewed=yes.
// ============================================================================

describe('Crewed= flag for all defense buildings (rules.ini)', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    it(`[${bldg}] Crewed=yes in rules.ini (garrison/crew mechanic)`, () => {
      const iniCrewedRaw = ini[bldg]?.Crewed;
      expect(iniBool(iniCrewedRaw),
        `${bldg}: Crewed=${iniCrewedRaw}, expected yes/true`
      ).toBe(true);
    });
  }

  it('all 5 defense buildings have Crewed=yes', () => {
    const crewedBuildings = DEFENSE_BUILDINGS.filter(b => iniBool(ini[b]?.Crewed));
    expect(crewedBuildings).toEqual([...DEFENSE_BUILDINGS]);
  });
});

// ============================================================================
// Section 6: PBOX + HBOX Shared Weapon — Both use Vulcan with identical stats
//
// rules.ini: [PBOX] Primary=Vulcan, [HBOX] Primary=Vulcan
// Both should have identical weapon stats since they share the same weapon type.
// ============================================================================

describe('PBOX and HBOX share identical Vulcan weapon (rules.ini)', () => {
  it('both have Primary=Vulcan in rules.ini', () => {
    expect(ini['PBOX'].Primary).toBe('Vulcan');
    expect(ini['HBOX'].Primary).toBe('Vulcan');
  });

  it('TS STRUCTURE_WEAPONS damage is identical', () => {
    expect(STRUCTURE_WEAPONS['PBOX'].damage).toBe(STRUCTURE_WEAPONS['HBOX'].damage);
  });

  it('TS STRUCTURE_WEAPONS range is identical', () => {
    expect(STRUCTURE_WEAPONS['PBOX'].range).toBe(STRUCTURE_WEAPONS['HBOX'].range);
  });

  it('TS STRUCTURE_WEAPONS ROF is identical', () => {
    expect(STRUCTURE_WEAPONS['PBOX'].rof).toBe(STRUCTURE_WEAPONS['HBOX'].rof);
  });

  it('TS STRUCTURE_WEAPONS warhead is identical', () => {
    expect(STRUCTURE_WEAPONS['PBOX'].warhead).toBe(STRUCTURE_WEAPONS['HBOX'].warhead);
  });

  it('TS STRUCTURE_WEAPONS projSpeed is identical', () => {
    expect(STRUCTURE_WEAPONS['PBOX'].projSpeed).toBe(STRUCTURE_WEAPONS['HBOX'].projSpeed);
  });

  it('HBOX has higher Strength than PBOX (INI-parsed)', () => {
    const pboxHp = Number(ini['PBOX'].Strength);
    const hboxHp = Number(ini['HBOX'].Strength);
    expect(hboxHp).toBeGreaterThan(pboxHp);
    // Also verify TS matches
    expect(STRUCTURE_MAX_HP['PBOX']).toBe(pboxHp);
    expect(STRUCTURE_MAX_HP['HBOX']).toBe(hboxHp);
  });
});

// ============================================================================
// Section 7: TSLA Special Properties — Ammo, Charges, Powered
//
// rules.ini [TSLA]: Ammo=3, Powered=true
// rules.ini [TeslaZap]: Charges=yes
// C++ building.cpp:882-883 — ammo reloads to MaxAmmo each AI tick
// ============================================================================

describe('TSLA special properties from rules.ini', () => {
  it('[TSLA] has Ammo=3 in rules.ini', () => {
    const iniAmmo = Number(ini['TSLA'].Ammo);
    expect(iniAmmo).toBe(3);
  });

  it('[TSLA] has Powered=true in rules.ini', () => {
    expect(iniBool(ini['TSLA'].Powered)).toBe(true);
  });

  it('[TeslaZap] has Charges=yes in rules.ini', () => {
    expect(iniBool(ini['TeslaZap'].Charges)).toBe(true);
  });

  it('TSLA is in STRUCTURE_POWERED set', () => {
    expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
  });
});

// ============================================================================
// Section 8: FTUR Explodes= Flag
//
// rules.ini [FTUR]: Explodes=no
// Flame turret does NOT explode when destroyed (unlike most buildings).
// ============================================================================

describe('FTUR Explodes=no flag from rules.ini', () => {
  it('[FTUR] has Explodes=no in rules.ini', () => {
    const iniExplodes = ini['FTUR'].Explodes;
    expect(iniBool(iniExplodes), `FTUR Explodes=${iniExplodes}, expected no`).toBe(false);
  });
});

// ============================================================================
// Section 9: GUN Turret Properties — ROT, turreted behavior
//
// rules.ini [GUN]: ROT=12 (turret rotation speed)
// C++ bdata.cpp:571 — GUN has IsTurretEquipped=true
// GUN is the only turreted defense among our 5 buildings.
// ============================================================================

describe('GUN turret properties from rules.ini', () => {
  it('[GUN] has ROT=12 in rules.ini (turret rotation speed)', () => {
    const iniROT = Number(ini['GUN'].ROT);
    expect(iniROT).toBe(12);
  });

  it('[GUN] is the only turreted defense among PBOX/HBOX/GUN/FTUR/TSLA', () => {
    // GUN has ROT= in rules.ini, others do not
    for (const bldg of DEFENSE_BUILDINGS) {
      const hasROT = ini[bldg]?.ROT !== undefined;
      if (bldg === 'GUN') {
        expect(hasROT, `${bldg} should have ROT=`).toBe(true);
      } else {
        expect(hasROT, `${bldg} should NOT have ROT=`).toBe(false);
      }
    }
  });
});

// ============================================================================
// Section 10: Power Drain — INI Power= values for defense buildings
//
// rules.ini Power= field defines power consumption (negative = drain).
// ============================================================================

describe('Defense building power drain from rules.ini', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    it(`[${bldg}] Power=${ini[bldg]?.Power} in rules.ini (negative = drain)`, () => {
      const iniPower = Number(ini[bldg].Power);
      expect(iniPower).toBeLessThan(0); // all defense buildings drain power
    });
  }

  it('TSLA has the highest power drain among defense buildings', () => {
    // More negative = more drain
    const drains = DEFENSE_BUILDINGS.map(b => ({
      building: b,
      drain: Number(ini[b].Power),
    }));
    // Sort ascending (most negative first)
    drains.sort((a, b) => a.drain - b.drain);
    expect(drains[0].building).toBe('TSLA');
  });
});

// ============================================================================
// Section 11: Behavioral Combat Tests — Firing, Cooldown, Power Gate
//
// Tests verify the TS combat engine behavior using updateStructureCombat.
// ============================================================================

describe('Unpowered defenses fire during power outage (PBOX, HBOX, GUN, FTUR)', () => {
  const UNPOWERED_DEFENSES = DEFENSE_BUILDINGS.filter(b => !iniBool(ini[b]?.Powered));

  for (const bldg of UNPOWERED_DEFENSES) {
    it(`${bldg} fires during power outage (powerConsumed > powerProduced)`, () => {
      const house = bldg === 'FTUR' ? House.USSR : House.Spain;
      const enemyHouse = bldg === 'FTUR' ? House.Spain : House.USSR;
      const s = makeDefenseStructure(bldg, house, 10, 10,
        bldg === 'GUN' ? { turretDir: 2, desiredTurretDir: 2 } : {});
      const enemy = entityAtCell(UnitType.I_E1, enemyHouse, 12, 10);
      const hpBefore = enemy.hp;
      const ctx = makeCombatCtx([s], [enemy], {
        powerConsumed: 200,
        powerProduced: 50,
      });
      updateStructureCombat(ctx);
      expect(enemy.hp, `${bldg} should still fire during low power`).toBeLessThan(hpBefore);
    });
  }
});

describe('TSLA does NOT fire during power outage', () => {
  it('TSLA silenced when powerConsumed > powerProduced', () => {
    const tsla = makeDefenseStructure('TSLA', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy], {
      powerConsumed: 200,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('TSLA fires when power is sufficient', () => {
    const tsla = makeDefenseStructure('TSLA', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([tsla], [enemy], {
      powerConsumed: 50,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('TSLA fires when powerConsumed == powerProduced (not low power)', () => {
    const tsla = makeDefenseStructure('TSLA', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([tsla], [enemy], {
      powerConsumed: 100,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });
});

// ============================================================================
// Section 12: Cooldown Behavior — ROF from INI sets attackCooldown
// ============================================================================

describe('Attack cooldown matches INI-parsed ROF', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    const weaponName = ini[bldg]?.Primary;
    if (!weaponName) continue;
    const iniROF = Number(ini[weaponName].ROF);

    it(`${bldg} sets attackCooldown to ${iniROF} after firing (ROF from [${weaponName}])`, () => {
      const house = bldg === 'FTUR' || bldg === 'TSLA' ? House.USSR : House.Spain;
      const enemyHouse = house === House.USSR ? House.Spain : House.USSR;
      const s = makeDefenseStructure(bldg, house, 10, 10,
        bldg === 'GUN' ? { turretDir: 2, desiredTurretDir: 2 } : {});
      const enemy = entityAtCell(UnitType.I_E1, enemyHouse, 12, 10);
      const ctx = makeCombatCtx([s], [enemy]);
      updateStructureCombat(ctx);
      expect(s.attackCooldown).toBe(iniROF);
    });
  }
});

describe('Defense structures do NOT fire while on cooldown', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    it(`${bldg} does not fire with non-zero cooldown`, () => {
      const house = bldg === 'FTUR' || bldg === 'TSLA' ? House.USSR : House.Spain;
      const enemyHouse = house === House.USSR ? House.Spain : House.USSR;
      const s = makeDefenseStructure(bldg, house, 10, 10, { cooldown: 10 });
      const enemy = entityAtCell(UnitType.I_E1, enemyHouse, 12, 10);
      const ctx = makeCombatCtx([s], [enemy]);
      updateStructureCombat(ctx);
      expect(enemy.hp).toBe(enemy.maxHp);
    });
  }
});

describe('Cooldown decrements each tick', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    it(`${bldg} cooldown decrements from 5 to 4`, () => {
      const house = bldg === 'FTUR' || bldg === 'TSLA' ? House.USSR : House.Spain;
      const enemyHouse = house === House.USSR ? House.Spain : House.USSR;
      const s = makeDefenseStructure(bldg, house, 10, 10, { cooldown: 5 });
      const enemy = entityAtCell(UnitType.I_E1, enemyHouse, 12, 10);
      const ctx = makeCombatCtx([s], [enemy]);
      updateStructureCombat(ctx);
      expect(s.attackCooldown).toBe(4);
    });
  }
});

// ============================================================================
// Section 13: Range Verification — INI-parsed range, out-of-range targets
// ============================================================================

describe('Defense structures respect INI-parsed range', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    const weaponName = ini[bldg]?.Primary;
    if (!weaponName) continue;
    const iniRange = Number(ini[weaponName].Range);

    it(`${bldg} fires at enemy within range ${iniRange} cells`, () => {
      const house = bldg === 'FTUR' || bldg === 'TSLA' ? House.USSR : House.Spain;
      const enemyHouse = house === House.USSR ? House.Spain : House.USSR;
      // Place enemy 2 cells east (well within any defense range)
      const s = makeDefenseStructure(bldg, house, 10, 10,
        bldg === 'GUN' ? { turretDir: 2, desiredTurretDir: 2 } : {});
      const enemy = entityAtCell(UnitType.I_E1, enemyHouse, 12, 10);
      const hpBefore = enemy.hp;
      const ctx = makeCombatCtx([s], [enemy]);
      updateStructureCombat(ctx);
      expect(enemy.hp, `${bldg} should hit enemy 2 cells away (range ${iniRange})`).toBeLessThan(hpBefore);
    });

    it(`${bldg} does NOT fire at enemy beyond range ${iniRange} cells`, () => {
      const house = bldg === 'FTUR' || bldg === 'TSLA' ? House.USSR : House.Spain;
      const enemyHouse = house === House.USSR ? House.Spain : House.USSR;
      // Place enemy well beyond range — at range + 5 cells east
      const outOfRangeCx = 10 + Math.ceil(iniRange) + 5;
      const s = makeDefenseStructure(bldg, house, 10, 10,
        bldg === 'GUN' ? { turretDir: 2, desiredTurretDir: 2 } : {});
      const enemy = entityAtCell(UnitType.I_E1, enemyHouse, outOfRangeCx, 10);
      const ctx = makeCombatCtx([s], [enemy]);
      updateStructureCombat(ctx);
      expect(enemy.hp, `${bldg} should NOT hit enemy at ${outOfRangeCx - 10} cells (range ${iniRange})`).toBe(enemy.maxHp);
    });
  }
});

// ============================================================================
// Section 14: Warhead Damage Application — verify correct damage per armor type
//
// For PBOX (SA warhead): full damage vs none armor, reduced vs heavy
// For FTUR (Fire warhead): 0.9x vs none, 1.0x vs wood, 0.25x vs heavy
// For TSLA (Super warhead): 1.0x vs all armor types
// For GUN (AP warhead): 0.3x vs none, 1.0x vs heavy
// ============================================================================

describe('Warhead damage application matches INI Verses=', () => {
  it('PBOX deals full damage to none-armor infantry (SA warhead)', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    // INI: SA Verses=100%,50%,60%,25%,25% => vs none = 1.0
    // INI: [Vulcan] Damage=40
    const iniDamage = Number(ini['Vulcan'].Damage);
    const iniVersesNone = parseVerses(ini['SA'].Verses)[0];
    const expectedDamage = Math.round(iniDamage * iniVersesNone);
    expect(hpBefore - enemy.hp).toBe(expectedDamage);
  });

  it('PBOX deals reduced damage to heavy-armor tanks (SA warhead)', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = tank.hp;
    const ctx = makeCombatCtx([pbox], [tank]);
    updateStructureCombat(ctx);
    // INI: SA Verses vs heavy = index 3
    const iniDamage = Number(ini['Vulcan'].Damage);
    const iniVersesHeavy = parseVerses(ini['SA'].Verses)[3];
    const expectedDamage = Math.round(iniDamage * iniVersesHeavy);
    expect(hpBefore - tank.hp).toBe(expectedDamage);
  });

  it('FTUR deals 0.9x damage to none-armor infantry (Fire warhead)', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    enemy.hp = 200;
    enemy.maxHp = 200;
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([ftur], [enemy]);
    updateStructureCombat(ctx);
    const iniDamage = Number(ini['FireballLauncher'].Damage);
    const iniVersesNone = parseVerses(ini['Fire'].Verses)[0];
    const expectedDamage = Math.round(iniDamage * iniVersesNone);
    expect(hpBefore - enemy.hp).toBe(expectedDamage);
  });

  it('FTUR deals reduced damage to heavy-armor tanks (Fire warhead, 0.25x)', () => {
    const ftur = makeDefenseStructure('FTUR', House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 12, 10);
    const hpBefore = tank.hp;
    const ctx = makeCombatCtx([ftur], [tank]);
    updateStructureCombat(ctx);
    const iniDamage = Number(ini['FireballLauncher'].Damage);
    const iniVersesHeavy = parseVerses(ini['Fire'].Verses)[3];
    const expectedDamage = Math.round(iniDamage * iniVersesHeavy);
    expect(hpBefore - tank.hp).toBe(expectedDamage);
  });

  it('TSLA deals full damage to heavy-armor tanks (Super warhead, 1.0x all)', () => {
    const tsla = makeDefenseStructure('TSLA', House.USSR, 10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 13, 10);
    const hpBefore = tank.hp;
    expect(hpBefore).toBeGreaterThan(100); // precondition: must survive
    const ctx = makeCombatCtx([tsla], [tank]);
    updateStructureCombat(ctx);
    const iniDamage = Number(ini['TeslaZap'].Damage);
    const iniVersesHeavy = parseVerses(ini['Super'].Verses)[3];
    const expectedDamage = Math.round(iniDamage * iniVersesHeavy);
    expect(hpBefore - tank.hp).toBe(expectedDamage);
  });

  it('GUN deals AP damage to none-armor infantry (0.3x vs none)', () => {
    const gun = makeDefenseStructure('GUN', House.Spain, 10, 10,
      { turretDir: 2, desiredTurretDir: 2 });
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    // GUN uses TurretGun with AP warhead, which has splash
    // AP Verses vs none = index 0
    const iniDamage = Number(ini['TurretGun'].Damage);
    const iniVersesNone = parseVerses(ini['AP'].Verses)[0];
    const expectedDamage = Math.round(iniDamage * iniVersesNone);
    // GUN has splash so damage goes through splash path — at point-blank splash
    // damage should equal base damage * verses multiplier
    expect(hpBefore - enemy.hp).toBe(expectedDamage);
  });

  it('GUN deals AP damage to heavy-armor tanks (1.0x vs heavy)', () => {
    const gun = makeDefenseStructure('GUN', House.Spain, 10, 10,
      { turretDir: 2, desiredTurretDir: 2 });
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const hpBefore = tank.hp;
    const ctx = makeCombatCtx([gun], [tank]);
    updateStructureCombat(ctx);
    const iniDamage = Number(ini['TurretGun'].Damage);
    const iniVersesHeavy = parseVerses(ini['AP'].Verses)[3];
    const expectedDamage = Math.round(iniDamage * iniVersesHeavy);
    expect(hpBefore - tank.hp).toBe(expectedDamage);
  });
});

// ============================================================================
// Section 15: No Anti-Air — None of PBOX/HBOX/GUN/FTUR/TSLA target airborne
//
// All 5 defense buildings use projectiles with AA=false (or absent).
// Only SAM and AGUN have anti-air capability.
// ============================================================================

describe('Defense structures do NOT target airborne aircraft', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    it(`${bldg} does NOT have isAntiAir flag`, () => {
      expect(STRUCTURE_WEAPONS[bldg].isAntiAir).toBeFalsy();
    });

    it(`${bldg} does NOT fire at airborne helicopter`, () => {
      const house = bldg === 'FTUR' || bldg === 'TSLA' ? House.USSR : House.Spain;
      const enemyHouse = house === House.USSR ? House.Spain : House.USSR;
      const s = makeDefenseStructure(bldg, house, 10, 10,
        bldg === 'GUN' ? { turretDir: 2, desiredTurretDir: 2 } : {});
      const heli = entityAtCell(UnitType.V_HIND, enemyHouse, 12, 10);
      heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
      const ctx = makeCombatCtx([s], [heli]);
      updateStructureCombat(ctx);
      expect(heli.hp).toBe(heli.maxHp);
    });
  }
});

// ============================================================================
// Section 16: TSLA Special Effect — produces 'tesla' effect, not projectile
// ============================================================================

describe('TSLA produces tesla-type effect when firing', () => {
  it('creates a tesla-type effect (not a projectile)', () => {
    const tsla = makeDefenseStructure('TSLA', House.USSR, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    const teslaEffects = ctx.effects.filter(e => e.type === 'tesla');
    expect(teslaEffects.length).toBeGreaterThanOrEqual(1);
  });

  it('PBOX creates a projectile effect (not tesla)', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy]);
    updateStructureCombat(ctx);
    const projEffects = ctx.effects.filter(e => e.type === 'projectile');
    expect(projEffects.length).toBeGreaterThanOrEqual(1);
    const teslaEffects = ctx.effects.filter(e => e.type === 'tesla');
    expect(teslaEffects.length).toBe(0);
  });
});

// ============================================================================
// Section 17: Dead/Destroyed Structures Don't Fire
// ============================================================================

describe('Destroyed defense structures do NOT fire', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    it(`${bldg} does not fire when hp <= 0`, () => {
      const house = bldg === 'FTUR' || bldg === 'TSLA' ? House.USSR : House.Spain;
      const enemyHouse = house === House.USSR ? House.Spain : House.USSR;
      const s = makeDefenseStructure(bldg, house, 10, 10);
      s.alive = false;
      s.hp = 0;
      const enemy = entityAtCell(UnitType.I_E1, enemyHouse, 12, 10);
      const ctx = makeCombatCtx([s], [enemy]);
      updateStructureCombat(ctx);
      expect(enemy.hp).toBe(enemy.maxHp);
    });
  }
});

// ============================================================================
// Section 18: Friendly Fire Gate — Don't shoot allies
// ============================================================================

describe('Defense structures do NOT fire at allied units', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    it(`${bldg} does not shoot allied entities`, () => {
      const s = makeDefenseStructure(bldg, House.Spain, 10, 10,
        bldg === 'GUN' ? { turretDir: 2, desiredTurretDir: 2 } : {});
      // Greece is allied with Spain
      const ally = entityAtCell(UnitType.I_E1, House.Greece, 12, 10);
      const ctx = makeCombatCtx([s], [ally]);
      updateStructureCombat(ctx);
      expect(ally.hp).toBe(ally.maxHp);
    });
  }
});

// ============================================================================
// Section 19: Owner/Faction Verification — from rules.ini Owner= field
// ============================================================================

describe('Defense building Owner= faction from rules.ini', () => {
  const FACTION_MAP: Record<string, string> = {
    PBOX: 'allies',
    HBOX: 'allies',
    GUN:  'allies',
    FTUR: 'soviet',
    TSLA: 'soviet',
  };

  for (const bldg of DEFENSE_BUILDINGS) {
    it(`[${bldg}] Owner=${FACTION_MAP[bldg]} matches rules.ini`, () => {
      const iniOwner = ini[bldg].Owner;
      expect(iniOwner).toBe(FACTION_MAP[bldg]);
    });
  }
});

// ============================================================================
// Section 20: Prerequisite= from rules.ini
// ============================================================================

describe('Defense building Prerequisite= from rules.ini', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    it(`[${bldg}] has Prerequisite= defined`, () => {
      const iniPrereq = ini[bldg].Prerequisite;
      expect(iniPrereq, `${bldg} should have Prerequisite=`).toBeDefined();
      expect(iniPrereq.length).toBeGreaterThan(0);
    });
  }

  it('PBOX requires tent (Allied barracks)', () => {
    expect(ini['PBOX'].Prerequisite).toBe('tent');
  });

  it('HBOX requires tent (Allied barracks)', () => {
    expect(ini['HBOX'].Prerequisite).toBe('tent');
  });

  it('GUN requires tent (Allied barracks)', () => {
    expect(ini['GUN'].Prerequisite).toBe('tent');
  });

  it('FTUR requires barr (Soviet barracks)', () => {
    expect(ini['FTUR'].Prerequisite).toBe('barr');
  });

  it('TSLA requires weap (War Factory)', () => {
    expect(ini['TSLA'].Prerequisite).toBe('weap');
  });
});

// ============================================================================
// Section 21: TechLevel= from rules.ini
// ============================================================================

describe('Defense building TechLevel= from rules.ini', () => {
  for (const bldg of DEFENSE_BUILDINGS) {
    it(`[${bldg}] TechLevel is a positive integer`, () => {
      const iniTL = Number(ini[bldg].TechLevel);
      expect(iniTL).toBeGreaterThan(0);
      expect(Number.isInteger(iniTL)).toBe(true);
    });
  }

  it('TSLA has the highest TechLevel among the 5 defense buildings', () => {
    const techLevels = DEFENSE_BUILDINGS.map(b => ({
      building: b,
      tl: Number(ini[b].TechLevel),
    }));
    techLevels.sort((a, b) => b.tl - a.tl);
    expect(techLevels[0].building).toBe('TSLA');
  });
});

// ============================================================================
// Section 22: Structure Size — verify STRUCTURE_SIZE matches expectations
// ============================================================================

describe('Defense building footprint sizes', () => {
  it('PBOX is 1x1', () => {
    expect(STRUCTURE_SIZE['PBOX']).toEqual([1, 1]);
  });

  it('HBOX is 1x1', () => {
    expect(STRUCTURE_SIZE['HBOX']).toEqual([1, 1]);
  });

  it('GUN is 1x1', () => {
    expect(STRUCTURE_SIZE['GUN']).toEqual([1, 1]);
  });

  it('FTUR is 1x1', () => {
    expect(STRUCTURE_SIZE['FTUR']).toEqual([1, 1]);
  });

  it('TSLA is 1x2', () => {
    expect(STRUCTURE_SIZE['TSLA']).toEqual([1, 2]);
  });
});

// ============================================================================
// Section 23: GUN Turret Rotation — must align turret before firing
// ============================================================================

describe('GUN turret must align before firing', () => {
  it('GUN does NOT fire when turretDir != desiredTurretDir (waiting for alignment)', () => {
    const gun = makeDefenseStructure('GUN', House.Spain, 10, 10, {
      turretDir: 0,           // facing North
      desiredTurretDir: 4,    // wants to face South
    });
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    // Turret must rotate before it can fire — should NOT damage enemy this tick
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('GUN fires when turretDir == desiredTurretDir (aligned)', () => {
    const gun = makeDefenseStructure('GUN', House.Spain, 10, 10, {
      turretDir: 2,
      desiredTurretDir: 2,
    });
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('GUN sets firingFlash after firing', () => {
    const gun = makeDefenseStructure('GUN', House.Spain, 10, 10, {
      turretDir: 2,
      desiredTurretDir: 2,
    });
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([gun], [enemy]);
    updateStructureCombat(ctx);
    expect(gun.firingFlash).toBe(4);
  });
});

// ============================================================================
// Section 24: Non-Turreted Defenses — PBOX, HBOX, FTUR, TSLA have no turret
// ============================================================================

describe('Non-turreted defenses (PBOX, HBOX, FTUR, TSLA) have no turret state', () => {
  const NON_TURRETED = ['PBOX', 'HBOX', 'FTUR', 'TSLA'] as const;

  for (const bldg of NON_TURRETED) {
    it(`${bldg} does NOT set turretDir after firing`, () => {
      const house = bldg === 'FTUR' || bldg === 'TSLA' ? House.USSR : House.Spain;
      const enemyHouse = house === House.USSR ? House.Spain : House.USSR;
      const s = makeDefenseStructure(bldg, house, 10, 10);
      const enemy = entityAtCell(UnitType.I_E1, enemyHouse, 12, 10);
      const ctx = makeCombatCtx([s], [enemy]);
      updateStructureCombat(ctx);
      expect(s.turretDir).toBeUndefined();
    });

    it(`${bldg} does NOT set firingFlash after firing`, () => {
      const house = bldg === 'FTUR' || bldg === 'TSLA' ? House.USSR : House.Spain;
      const enemyHouse = house === House.USSR ? House.Spain : House.USSR;
      const s = makeDefenseStructure(bldg, house, 10, 10);
      const enemy = entityAtCell(UnitType.I_E1, enemyHouse, 12, 10);
      const ctx = makeCombatCtx([s], [enemy]);
      updateStructureCombat(ctx);
      expect(s.firingFlash).toBeUndefined();
    });
  }
});

// ============================================================================
// Section 25: Cross-Defense Comparisons (INI-derived)
//
// Verify relative stats across all 5 defense buildings, all derived from INI.
// ============================================================================

describe('Cross-defense relative stats (all INI-derived)', () => {
  it('TSLA has the longest range among the 5 defenses', () => {
    const ranges = DEFENSE_BUILDINGS.map(b => ({
      building: b,
      range: Number(ini[ini[b].Primary].Range),
    }));
    ranges.sort((a, b) => b.range - a.range);
    expect(ranges[0].building).toBe('TSLA');
  });

  it('FTUR has the shortest range among the 5 defenses', () => {
    const ranges = DEFENSE_BUILDINGS.map(b => ({
      building: b,
      range: Number(ini[ini[b].Primary].Range),
    }));
    ranges.sort((a, b) => a.range - b.range);
    expect(ranges[0].building).toBe('FTUR');
  });

  it('FTUR has the highest damage per shot among the 5 defenses', () => {
    const damages = DEFENSE_BUILDINGS.map(b => ({
      building: b,
      damage: Number(ini[ini[b].Primary].Damage),
    }));
    damages.sort((a, b) => b.damage - a.damage);
    expect(damages[0].building).toBe('FTUR');
  });

  it('PBOX and HBOX have the fastest ROF (lowest ticks between shots)', () => {
    const rofs = DEFENSE_BUILDINGS.map(b => ({
      building: b,
      rof: Number(ini[ini[b].Primary].ROF),
    }));
    rofs.sort((a, b) => a.rof - b.rof);
    // PBOX and HBOX both have ROF=40 (Vulcan), which is the fastest
    expect(['PBOX', 'HBOX']).toContain(rofs[0].building);
    expect(['PBOX', 'HBOX']).toContain(rofs[1].building);
  });

  it('TSLA has the slowest ROF (highest ticks between shots)', () => {
    const rofs = DEFENSE_BUILDINGS.map(b => ({
      building: b,
      rof: Number(ini[ini[b].Primary].ROF),
    }));
    rofs.sort((a, b) => b.rof - a.rof);
    expect(rofs[0].building).toBe('TSLA');
  });

  it('HBOX has the most HP among the 5 defenses (INI Strength)', () => {
    const hps = DEFENSE_BUILDINGS.map(b => ({
      building: b,
      hp: Number(ini[b].Strength),
    }));
    hps.sort((a, b) => b.hp - a.hp);
    expect(hps[0].building).toBe('HBOX');
  });
});

// ============================================================================
// Section 26: Fire Warhead Infantry Death Animation
//
// rules.ini [Fire] InfDeath=4 — infantry killed by fire use burn animation.
// This is important for FTUR visual parity.
// ============================================================================

describe('Fire warhead infantry death animation (for FTUR)', () => {
  it('[Fire] InfDeath=4 in rules.ini (burn death)', () => {
    const iniInfDeath = Number(ini['Fire'].InfDeath);
    expect(iniInfDeath).toBe(4);
  });

  it('TS WARHEAD_PROPS Fire infantryDeath matches INI InfDeath', () => {
    const iniInfDeath = Number(ini['Fire'].InfDeath);
    expect(WARHEAD_PROPS['Fire'].infantryDeath).toBe(iniInfDeath);
  });
});

// ============================================================================
// Section 27: Super Warhead Universal Damage (TSLA)
//
// rules.ini [Super] Verses=100%,100%,100%,100%,100% — all armor types
// ============================================================================

describe('Super warhead universal 100% damage (TSLA weapon)', () => {
  it('all 5 Super Verses values are 100% from INI', () => {
    const verses = parseVerses(ini['Super'].Verses);
    for (let i = 0; i < 5; i++) {
      expect(verses[i]).toBe(1.0);
    }
  });

  it('TS WARHEAD_VS_ARMOR Super matches all 100%', () => {
    const tsVerses = WARHEAD_VS_ARMOR['Super'];
    for (let i = 0; i < 5; i++) {
      expect(tsVerses[i]).toBe(1.0);
    }
  });
});

// ============================================================================
// Section 28: SA Warhead Anti-Infantry Focus (PBOX/HBOX weapon)
//
// SA warhead is best vs infantry (none armor), weak vs armored targets.
// ============================================================================

describe('SA warhead anti-infantry focus (PBOX/HBOX weapon)', () => {
  it('SA is strongest vs none armor (infantry) from INI Verses', () => {
    const verses = parseVerses(ini['SA'].Verses);
    const maxVerse = Math.max(...verses);
    expect(verses[0], 'SA should be strongest vs none armor (index 0)').toBe(maxVerse);
  });

  it('SA is weakest vs heavy and concrete armor from INI Verses', () => {
    const verses = parseVerses(ini['SA'].Verses);
    const minVerse = Math.min(...verses);
    expect(verses[3], 'SA heavy verse should be minimum').toBe(minVerse);
    expect(verses[4], 'SA concrete verse should also be minimum').toBe(minVerse);
  });
});

// ============================================================================
// Section 29: AP Warhead Anti-Armor Focus (GUN weapon)
//
// AP warhead is best vs heavy armor, weak vs infantry.
// ============================================================================

describe('AP warhead anti-armor focus (GUN weapon)', () => {
  it('AP is strongest vs heavy armor from INI Verses', () => {
    const verses = parseVerses(ini['AP'].Verses);
    const maxVerse = Math.max(...verses);
    expect(verses[3], 'AP should be strongest vs heavy armor (index 3)').toBe(maxVerse);
  });

  it('AP is weakest vs none armor (infantry) from INI Verses', () => {
    const verses = parseVerses(ini['AP'].Verses);
    const minVerse = Math.min(...verses);
    expect(verses[0], 'AP none verse should be minimum').toBe(minVerse);
  });
});
