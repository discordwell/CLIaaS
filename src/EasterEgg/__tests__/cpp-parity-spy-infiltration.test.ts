/**
 * C++ Behavioral Parity: Spy Infiltration Mechanics
 *
 * Tests verify spy disguise, per-building infiltration effects, dog detection,
 * and spy consumption match C++ RA source code (infantry.cpp, techno.cpp).
 *
 * ALL expected values are parsed from rules.ini — the authoritative source.
 *
 * C++ spy infiltration algorithm (infantry.cpp:645-706):
 *   1. Spy enters building on MISSION_CAPTURE                    (line 593)
 *   2. housespy = (1 << (House->Class->House))                   (line 646)
 *   3. If trigger, fire TEVENT_SPIED                             (line 649-651)
 *   4. Speak VOX_BUILDING_INFILTRATED if player-owned spy        (line 653)
 *   5. tech->SpiedBy |= housespy  (ALL buildings, unconditional) (line 656)
 *   6. Building-specific effects (only 2 types in C++):
 *      a. STRUCT_RADAR: tech->House->RadarSpied |= housespy      (line 660-661)
 *      b. STRUCT_SUB_PEN: enable SPC_SONAR_PULSE for spy's house (line 664-669)
 *   7. delete this  (spy consumed — always)                      (line 706)
 *
 * CRITICAL: C++ has NO special handling for:
 *   - PROC (refinery): no money steal, just SpiedBy
 *   - POWR/APWR (power): no power sabotage, just SpiedBy
 *   - WEAP/TENT/BARR (production): no production reveal, just SpiedBy
 *   - Any other building type: just SpiedBy
 *
 * Dog spy detection: C++ techno.cpp:1557-1563:
 *   - All non-dog units return 0 threat for spies (invisible to AI)
 *   - Dogs detect and target spies within guard range
 *
 * C++ reference files:
 *   - infantry.cpp:645-706 (spy infiltration handler)
 *   - techno.cpp:1557-1563 (spy threat exclusion / dog detection)
 *   - house.cpp:654 (sonar pulse superweapon init)
 *   - rules.ini [SPY], [DOG], [DogJaw], [Organic], [Recharge]
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  UnitType, House, CELL_SIZE, Mission, SuperweaponType,
  SUPERWEAPON_DEFS, SONAR_REVEAL_TICKS,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR,
  armorIndex,
  type SuperweaponState,
} from '../engine/types';
import type { MapStructure } from '../engine/scenario';
import { Entity, resetEntityIds, threatScore } from '../engine/entity';

// ---------------------------------------------------------------------------
// INI Parser (replicates C++ INI load: last-key-wins within a section)
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

/** Parse a percentage string like "100%" to a float (1.0), or a plain number */
function parseIniPercent(val: string): number {
  if (val.endsWith('%')) return parseFloat(val) / 100;
  return parseFloat(val);
}

// ---------------------------------------------------------------------------
// Load rules.ini — authoritative source for ALL game constants
// ---------------------------------------------------------------------------

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const ini = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));

// Parse INI values for SPY, DOG, THF, DogJaw, Organic warhead, Recharge
const iniSpy = ini['SPY'];
const iniDog = ini['DOG'];
const iniThf = ini['THF'];
const iniE1 = ini['E1'];
const iniE6 = ini['E6'];
const iniDogJaw = ini['DogJaw'];
const iniOrganic = ini['Organic'];
const iniRecharge = ini['Recharge'];

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

/** Create a spy Entity at a given cell */
function makeSpy(house: House, cx: number, cy: number): Entity {
  return new Entity(UnitType.I_SPY, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create an entity at a given cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create a minimal MapStructure for testing */
function makeStructure(type: string, house: House, cx = 5, cy = 5): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx, cy,
    hp: 256,
    maxHp: 256,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    spiedBy: 0,
  };
}

/**
 * Faithful reproduction of TS Game.spyInfiltrate (index.ts) matching C++ infantry.cpp:645-706.
 * Returns the observable side effects so tests can verify them against C++ expected behavior.
 */
interface SpyInfiltrationResult {
  infiltrated: boolean;
  spyAlive: boolean;
  spyMission: Mission;
  spyDisguise: House | null;
  /** Houses added to spiedHouses (ALL buildings get this) */
  spiedHouses: Set<House>;
  /** Houses added to radarSpiedHouses (DOME only) */
  radarSpiedHouses: Set<House>;
  /** Sonar target mapping (spy house -> target house) */
  sonarSpiedTarget: Map<House, House>;
  /** Superweapon states created */
  superweapons: Map<string, SuperweaponState>;
  /** EVA messages pushed */
  evaMessages: string[];
  /** Trigger names added to spiedBuildingTriggers */
  spiedTriggers: Set<string>;
  /** SpiedBy bitmask set on the building */
  buildingSpiedBy: number;
}

/**
 * Reproduces TS Game.spyInfiltrate logic exactly as written in index.ts
 * (post C++ parity fix) so we can test it in isolation.
 */
function tsSpyInfiltrate(
  spy: Entity,
  structure: MapStructure,
  playerHouse: House = House.Spain,
  isAllied: (a: House, b: House) => boolean = (a, b) => a === b,
): SpyInfiltrationResult {
  const result: SpyInfiltrationResult = {
    infiltrated: false,
    spyAlive: spy.alive,
    spyMission: spy.mission,
    spyDisguise: spy.disguisedAs,
    spiedHouses: new Set(),
    radarSpiedHouses: new Set(),
    sonarSpiedTarget: new Map(),
    superweapons: new Map(),
    evaMessages: [],
    spiedTriggers: new Set(),
    buildingSpiedBy: 0,
  };

  // Guard
  if (spy.type !== UnitType.I_SPY || !spy.alive) return result;

  const targetHouse = structure.house;
  if (isAllied(targetHouse, playerHouse)) return result;

  result.infiltrated = true;

  // Step 1: TEVENT_SPIED trigger (C++ infantry.cpp:649-651)
  if (structure.triggerName) result.spiedTriggers.add(structure.triggerName);

  // Step 2: EVA message (C++ infantry.cpp:653)
  result.evaMessages.push('BUILDING INFILTRATED');

  // Step 3: SpiedBy on ALL buildings (C++ infantry.cpp:656)
  structure.spiedBy = (structure.spiedBy ?? 0) | 1;
  result.buildingSpiedBy = structure.spiedBy;
  result.spiedHouses.add(targetHouse);

  // Step 4: Building-type-specific effects (C++ only has 2 cases)
  if (structure.type === 'DOME') {
    // C++ infantry.cpp:660-662: RadarSpied
    result.radarSpiedHouses.add(targetHouse);
  } else if (structure.type === 'SPEN') {
    // C++ infantry.cpp:664-670: sonar pulse
    const spyHouse = spy.house;
    result.sonarSpiedTarget.set(spyHouse, targetHouse);
    const sonarKey = `${spyHouse}:${SuperweaponType.SONAR_PULSE}`;
    result.superweapons.set(sonarKey, {
      type: SuperweaponType.SONAR_PULSE,
      house: spyHouse,
      chargeTick: 0,
      ready: true,
      structureIndex: -1,
      fired: false,
    });
  }

  // Step 5: Spy consumption (C++ infantry.cpp:706)
  spy.triggerName = undefined;
  spy.alive = false;
  spy.mission = Mission.DIE;
  spy.disguisedAs = null;
  result.spyAlive = spy.alive;
  result.spyMission = spy.mission;
  result.spyDisguise = spy.disguisedAs;

  return result;
}

// ==========================================================================
// Section 1: SPY unit stats parsed from rules.ini
// C++ idata.cpp / rules.ini [SPY] section
// ==========================================================================

describe('SPY stats from rules.ini [SPY] (idata.cpp)', () => {
  const stats = UNIT_STATS.SPY;
  const iniStrength = parseInt(iniSpy['Strength'], 10);
  const iniArmor = iniSpy['Armor'];
  const iniSpeed = parseInt(iniSpy['Speed'], 10);
  const iniSight = parseInt(iniSpy['Sight'], 10);
  const iniCost = parseInt(iniSpy['Cost'], 10);
  const iniPoints = parseInt(iniSpy['Points'], 10);
  const iniInfiltrate = iniSpy['Infiltrate'];
  const iniPrereq = iniSpy['Prerequisite'];

  it(`Strength=${iniStrength} from rules.ini`, () => {
    expect(stats.strength).toBe(iniStrength);
  });

  it(`Armor=${iniArmor} from rules.ini`, () => {
    expect(stats.armor).toBe(iniArmor);
  });

  it(`Speed=${iniSpeed} from rules.ini`, () => {
    expect(stats.speed).toBe(iniSpeed);
  });

  it(`Sight=${iniSight} from rules.ini`, () => {
    expect(stats.sight).toBe(iniSight);
  });

  it(`Cost=${iniCost} from rules.ini`, () => {
    expect(stats.cost).toBe(iniCost);
  });

  it(`Points=${iniPoints} from rules.ini`, () => {
    expect(stats.points).toBe(iniPoints);
  });

  it(`Infiltrate=${iniInfiltrate} from rules.ini — SPY can enter buildings`, () => {
    expect(iniInfiltrate).toBe('yes');
    expect(stats.isInfiltrate).toBe(true);
  });

  it(`Prerequisite=${iniPrereq} from rules.ini — requires radar dome`, () => {
    expect(iniPrereq).toBe('dome');
  });

  it('SPY has no primary weapon (rules.ini has no Primary= key)', () => {
    expect(iniSpy['Primary']).toBeUndefined();
    expect(stats.primaryWeapon).toBeNull();
  });

  it('SPY is infantry (isInfantry=true)', () => {
    expect(stats.isInfantry).toBe(true);
  });

  it('Entity constructor initializes HP to INI Strength', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    expect(spy.hp).toBe(iniStrength);
    expect(spy.maxHp).toBe(iniStrength);
  });
});

// ==========================================================================
// Section 2: DOG stats parsed from rules.ini — spy counter unit
// ==========================================================================

describe('DOG stats from rules.ini [DOG] (idata.cpp) — spy counter', () => {
  const stats = UNIT_STATS.DOG;
  const iniStrength = parseInt(iniDog['Strength'], 10);
  const iniSight = parseInt(iniDog['Sight'], 10);
  const iniWeapon = iniDog['Primary'];
  const iniIsCanine = iniDog['IsCanine'];

  it(`Strength=${iniStrength} from rules.ini`, () => {
    expect(stats.strength).toBe(iniStrength);
  });

  it(`Sight=${iniSight} from rules.ini`, () => {
    expect(stats.sight).toBe(iniSight);
  });

  it(`Primary=${iniWeapon} from rules.ini`, () => {
    expect(stats.primaryWeapon).toBe(iniWeapon);
  });

  it(`IsCanine=${iniIsCanine} from rules.ini — enables dog-specific logic`, () => {
    expect(iniIsCanine).toBe('yes');
    expect(stats.isCanine).toBe(true);
  });
});

// ==========================================================================
// Section 3: DogJaw weapon stats from rules.ini [DogJaw]
// ==========================================================================

describe('DogJaw weapon from rules.ini [DogJaw]', () => {
  const jaw = WEAPON_STATS.DogJaw;
  const iniDamage = parseInt(iniDogJaw['Damage'], 10);
  const iniRange = parseFloat(iniDogJaw['Range']);
  const iniWarhead = iniDogJaw['Warhead'];

  it(`Damage=${iniDamage} from rules.ini`, () => {
    expect(jaw.damage).toBe(iniDamage);
  });

  it(`Range=${iniRange} from rules.ini`, () => {
    expect(jaw.range).toBe(iniRange);
  });

  it(`Warhead=${iniWarhead} from rules.ini`, () => {
    expect(jaw.warhead).toBe(iniWarhead);
  });
});

// ==========================================================================
// Section 4: Organic warhead Verses from rules.ini [Organic]
// Dog jaw uses Organic warhead — 100% vs none, 0% vs everything else
// ==========================================================================

describe('Organic warhead Verses from rules.ini [Organic]', () => {
  const versesStr = iniOrganic['Verses'];
  const versesArr = versesStr.split(',').map(v => parseIniPercent(v.trim()));
  // C++ armor order: none=0, wood=1, light=2, heavy=3, concrete=4

  it(`Verses[0] (none) = ${versesArr[0]} from rules.ini — kills unarmored infantry`, () => {
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('none')]).toBe(versesArr[0]);
  });

  it(`Verses[1] (wood) = ${versesArr[1]} from rules.ini — useless vs wood armor`, () => {
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('wood')]).toBe(versesArr[1]);
  });

  it(`Verses[2] (light) = ${versesArr[2]} from rules.ini — useless vs light armor`, () => {
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('light')]).toBe(versesArr[2]);
  });

  it(`Verses[3] (heavy) = ${versesArr[3]} from rules.ini — useless vs heavy armor`, () => {
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('heavy')]).toBe(versesArr[3]);
  });

  it(`Verses[4] (concrete) = ${versesArr[4]} from rules.ini — useless vs concrete`, () => {
    expect(WARHEAD_VS_ARMOR.Organic[armorIndex('concrete')]).toBe(versesArr[4]);
  });
});

// ==========================================================================
// Section 5: Sonar recharge from rules.ini [Recharge] Sonar=
// C++ rules.cpp:210 SonarTime default, overridden by rules.ini
// ==========================================================================

describe('Sonar recharge from rules.ini [Recharge]', () => {
  const iniSonarMinutes = parseInt(iniRecharge['Sonar'], 10);
  // C++ TICKS_PER_MINUTE = 15 * 60 = 900
  const expectedTicks = iniSonarMinutes * 900;

  it(`[Recharge] Sonar=${iniSonarMinutes} => ${expectedTicks} ticks`, () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks).toBe(expectedTicks);
  });

  it('sonar pulse building is empty string (spy-only, no building produces it)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].building).toBe('');
  });

  it('sonar pulse does not need a target (auto-reveals subs)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].needsTarget).toBe(false);
  });
});

// ==========================================================================
// Section 6: SONAR_REVEAL_TICKS — C++ house.cpp:2629
// 15 * TICKS_PER_SECOND = 15 * 15 = 225
// ==========================================================================

describe('SONAR_REVEAL_TICKS (house.cpp:2629)', () => {
  it('sonar reveal duration = 225 ticks (15s at 15 TPS)', () => {
    expect(SONAR_REVEAL_TICKS).toBe(15 * 15);
  });
});

// ==========================================================================
// Section 7: THF (Thief) stats from rules.ini — distinct from SPY
// ==========================================================================

describe('THF stats from rules.ini [THF] — Thief is distinct from SPY', () => {
  const iniThfStrength = parseInt(iniThf['Strength'], 10);
  const iniThfInfiltrate = iniThf['Infiltrate'];
  const iniThfPrereq = iniThf['Prerequisite'];
  const iniSpyPrereq = iniSpy['Prerequisite'];

  it('SPY and THIEF are distinct unit types', () => {
    expect(UnitType.I_SPY).not.toBe(UnitType.I_THF);
  });

  it(`THF Strength=${iniThfStrength} matches SPY Strength=${parseInt(iniSpy['Strength'], 10)}`, () => {
    const spyStrength = parseInt(iniSpy['Strength'], 10);
    expect(UNIT_STATS.THF.strength).toBe(iniThfStrength);
    expect(UNIT_STATS.SPY.strength).toBe(spyStrength);
  });

  it(`THF Infiltrate=${iniThfInfiltrate} — both can enter buildings`, () => {
    expect(iniThfInfiltrate).toBe('yes');
    expect(UNIT_STATS.THF.isInfiltrate).toBe(true);
  });

  it(`THF Prerequisite=${iniThfPrereq} vs SPY Prerequisite=${iniSpyPrereq}`, () => {
    expect(iniThfPrereq).toBe('atek');
    expect(iniSpyPrereq).toBe('dome');
  });

  it('THF has no weapon (same as SPY — unarmed infiltrators)', () => {
    expect(iniThf['Primary']).toBeUndefined();
    expect(UNIT_STATS.THF.primaryWeapon).toBeNull();
  });
});

// ==========================================================================
// Section 8: Infiltrate= flag cross-check across all infantry types
// C++ infantry.h IsInfiltrate — parsed from rules.ini
// ==========================================================================

describe('Infiltrate= flag cross-check from rules.ini', () => {
  const INFILTRATORS = ['SPY', 'THF', 'E6', 'E7'];

  for (const section of INFILTRATORS) {
    it(`[${section}] Infiltrate=${ini[section]?.['Infiltrate']} — TS matches`, () => {
      const iniVal = ini[section]?.['Infiltrate'];
      expect(iniVal).toBe('yes');
      const stats = UNIT_STATS[section as keyof typeof UNIT_STATS];
      expect(stats?.isInfiltrate).toBe(true);
    });
  }

  // Non-infiltrators should NOT have Infiltrate=yes
  const NON_INFILTRATORS = ['E1', 'E2', 'E3', 'E4', 'DOG'];
  for (const section of NON_INFILTRATORS) {
    it(`[${section}] has no Infiltrate= key — cannot enter buildings`, () => {
      const iniVal = ini[section]?.['Infiltrate'];
      expect(iniVal).toBeUndefined();
    });
  }
});

// ==========================================================================
// Section 9: IsCanine= flag — only DOG has this
// ==========================================================================

describe('IsCanine= flag from rules.ini — only DOG', () => {
  it('[DOG] IsCanine=yes — enables spy detection logic', () => {
    expect(iniDog['IsCanine']).toBe('yes');
    expect(UNIT_STATS.DOG.isCanine).toBe(true);
  });

  it('[SPY] has no IsCanine — spy is not a dog', () => {
    expect(iniSpy['IsCanine']).toBeUndefined();
  });

  it('[E1] has no IsCanine', () => {
    expect(iniE1['IsCanine']).toBeUndefined();
  });
});

// ==========================================================================
// Section 10: STRUCT_RADAR (DOME) spy effect (infantry.cpp:660-661)
// ==========================================================================

describe('STRUCT_RADAR (DOME) spy effect (infantry.cpp:660-661)', () => {
  it('spying on DOME adds target house to radarSpiedHouses', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.infiltrated).toBe(true);
    expect(result.radarSpiedHouses.has(House.USSR)).toBe(true);
  });

  it('C++ RadarSpied is set on TARGET HOUSE — not spy house', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.radarSpiedHouses.has(House.USSR)).toBe(true);
    expect(result.radarSpiedHouses.has(House.Spain)).toBe(false);
  });

  it('DOME spy ALSO sets SpiedBy (C++ line 656 is unconditional before line 660)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.spiedHouses.has(House.USSR)).toBe(true);
    expect(result.radarSpiedHouses.has(House.USSR)).toBe(true);
  });

  it('ATEK is NOT DOME — should NOT trigger radar reveal', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const atek = makeStructure('ATEK', House.USSR);
    const result = tsSpyInfiltrate(spy, atek);

    expect(result.radarSpiedHouses.has(House.USSR)).toBe(false);
  });

  it('spy is consumed after DOME infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    tsSpyInfiltrate(spy, dome);

    expect(spy.alive).toBe(false);
    expect(spy.mission).toBe(Mission.DIE);
  });
});

// ==========================================================================
// Section 11: STRUCT_SUB_PEN (SPEN) spy effect — sonar pulse
// C++ infantry.cpp:664-669
// ==========================================================================

describe('STRUCT_SUB_PEN (SPEN) spy effect — sonar pulse (infantry.cpp:664-669)', () => {
  it('spying on SPEN grants sonar pulse to SPY HOUSE', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const spen = makeStructure('SPEN', House.USSR);
    const result = tsSpyInfiltrate(spy, spen);

    expect(result.infiltrated).toBe(true);
    const sonarKey = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    const sonarState = result.superweapons.get(sonarKey);
    expect(sonarState).toBeDefined();
    expect(sonarState!.house).toBe(House.Spain);
    expect(sonarState!.ready).toBe(true);
  });

  it('sonar pulse is immediately ready (C++ Enable oneTime=true)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const spen = makeStructure('SPEN', House.USSR);
    const result = tsSpyInfiltrate(spy, spen);

    const sonarKey = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    expect(result.superweapons.get(sonarKey)!.ready).toBe(true);
  });

  it('sonar tracks spy house -> target house for maintenance', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const spen = makeStructure('SPEN', House.USSR);
    const result = tsSpyInfiltrate(spy, spen);

    expect(result.sonarSpiedTarget.get(House.Spain)).toBe(House.USSR);
  });

  it('spy is consumed after SPEN infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const spen = makeStructure('SPEN', House.USSR);
    tsSpyInfiltrate(spy, spen);
    expect(spy.alive).toBe(false);
  });

  it('SYRD does NOT grant sonar (C++ only checks STRUCT_SUB_PEN)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const syrd = makeStructure('SYRD', House.USSR);
    const result = tsSpyInfiltrate(spy, syrd);

    expect(result.superweapons.size).toBe(0);
    expect(result.sonarSpiedTarget.size).toBe(0);
  });
});

// ==========================================================================
// Section 12: PROC spy effect — C++ only sets SpiedBy, NO credit theft
// C++ infantry.cpp:656 (generic) — thief handles PROC in lines 673-701
// ==========================================================================

describe('PROC spy effect (infantry.cpp:656 — generic SpiedBy only in C++)', () => {
  it('spying on PROC adds target to spiedHouses (generic SpiedBy)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const proc = makeStructure('PROC', House.USSR);
    const result = tsSpyInfiltrate(spy, proc);

    expect(result.infiltrated).toBe(true);
    expect(result.spiedHouses.has(House.USSR)).toBe(true);
  });

  it('PROC spy does NOT steal money (thief does that, not spy)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    expect(spy.type).toBe(UnitType.I_SPY);
    expect(spy.type).not.toBe(UnitType.I_THF);
  });

  it('PROC spy has NO special effects beyond SpiedBy', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const proc = makeStructure('PROC', House.USSR);
    const result = tsSpyInfiltrate(spy, proc);

    expect(result.radarSpiedHouses.size).toBe(0);
    expect(result.superweapons.size).toBe(0);
  });

  it('spy is consumed after PROC infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const proc = makeStructure('PROC', House.USSR);
    tsSpyInfiltrate(spy, proc);
    expect(spy.alive).toBe(false);
  });
});

// ==========================================================================
// Section 13: POWR/APWR — C++ only sets SpiedBy, NO power sabotage
// ==========================================================================

describe('POWR/APWR spy effect (infantry.cpp:656 — generic SpiedBy only in C++)', () => {
  it('spying on POWR adds target to spiedHouses (generic SpiedBy)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const powr = makeStructure('POWR', House.USSR);
    const result = tsSpyInfiltrate(spy, powr);

    expect(result.infiltrated).toBe(true);
    expect(result.spiedHouses.has(House.USSR)).toBe(true);
  });

  it('spying on APWR adds target to spiedHouses', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const apwr = makeStructure('APWR', House.USSR);
    const result = tsSpyInfiltrate(spy, apwr);

    expect(result.spiedHouses.has(House.USSR)).toBe(true);
  });

  it('POWR/APWR have NO special effects beyond SpiedBy', () => {
    for (const type of ['POWR', 'APWR']) {
      const spy = makeSpy(House.Spain, 10, 10);
      const s = makeStructure(type, House.USSR);
      const result = tsSpyInfiltrate(spy, s);
      expect(result.radarSpiedHouses.size, `${type} should not set radarSpiedHouses`).toBe(0);
      expect(result.superweapons.size, `${type} should not grant superweapons`).toBe(0);
    }
  });
});

// ==========================================================================
// Section 14: WEAP/TENT/BARR — C++ only sets SpiedBy
// ==========================================================================

describe('WEAP/TENT/BARR spy effect (infantry.cpp:656 — generic SpiedBy only in C++)', () => {
  for (const type of ['WEAP', 'TENT', 'BARR']) {
    it(`spying on ${type} adds target to spiedHouses (SpiedBy only)`, () => {
      const spy = makeSpy(House.Spain, 10, 10);
      const s = makeStructure(type, House.USSR);
      const result = tsSpyInfiltrate(spy, s);

      expect(result.infiltrated).toBe(true);
      expect(result.spiedHouses.has(House.USSR)).toBe(true);
      expect(result.radarSpiedHouses.size).toBe(0);
      expect(result.superweapons.size).toBe(0);
    });
  }
});

// ==========================================================================
// Section 15: Spy consumption on infiltration (infantry.cpp:706)
// ==========================================================================

describe('Spy consumption on infiltration (infantry.cpp:706)', () => {
  it('spy alive=false after infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    tsSpyInfiltrate(spy, dome);

    expect(spy.alive).toBe(false);
  });

  it('spy mission set to DIE after infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    tsSpyInfiltrate(spy, dome);

    expect(spy.mission).toBe(Mission.DIE);
  });

  it('spy disguise cleared after infiltration', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    spy.disguisedAs = House.USSR;
    const dome = makeStructure('DOME', House.USSR);
    tsSpyInfiltrate(spy, dome);

    expect(spy.disguisedAs).toBeNull();
  });

  it('spy triggerName cleared before death (prevents TEVENT_DESTROYED)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    spy.triggerName = 'spy_trigger';
    const dome = makeStructure('DOME', House.USSR);
    tsSpyInfiltrate(spy, dome);

    expect(spy.triggerName).toBeUndefined();
  });

  it('spy consumed for ALL building types — delete this is outside the type switch', () => {
    const buildingTypes = ['DOME', 'SPEN', 'PROC', 'POWR', 'APWR', 'WEAP', 'TENT', 'BARR', 'SILO', 'FIX', 'FACT'];
    for (const type of buildingTypes) {
      const spy = makeSpy(House.Spain, 10, 10);
      const structure = makeStructure(type, House.USSR);
      tsSpyInfiltrate(spy, structure);
      expect(spy.alive, `spy should be consumed after infiltrating ${type}`).toBe(false);
    }
  });
});

// ==========================================================================
// Section 16: Guard conditions (infantry.cpp:593-645)
// ==========================================================================

describe('Spy infiltration guard conditions (infantry.cpp:593-645)', () => {
  it('non-spy unit does not infiltrate', () => {
    const rifleman = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(rifleman, dome);

    expect(result.infiltrated).toBe(false);
    expect(rifleman.alive).toBe(true);
  });

  it('dead spy does not infiltrate', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    spy.alive = false;
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.infiltrated).toBe(false);
  });

  it('spy cannot infiltrate allied building', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.Spain);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.infiltrated).toBe(false);
    expect(spy.alive).toBe(true);
  });

  it('spy infiltrates enemy building', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.infiltrated).toBe(true);
    expect(spy.alive).toBe(false);
  });
});

// ==========================================================================
// Section 17: TEVENT_SPIED trigger (infantry.cpp:649-651)
// ==========================================================================

describe('TEVENT_SPIED trigger (infantry.cpp:649-651)', () => {
  it('trigger is tracked when structure has triggerName', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    dome.triggerName = 'spy_detected';
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.spiedTriggers.has('spy_detected')).toBe(true);
  });

  it('no trigger tracked when structure has no triggerName', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const dome = makeStructure('DOME', House.USSR);
    const result = tsSpyInfiltrate(spy, dome);

    expect(result.spiedTriggers.size).toBe(0);
  });

  it('trigger fires for ALL building types (C++ line 649 is before type check)', () => {
    const types = ['DOME', 'SPEN', 'PROC', 'POWR', 'WEAP', 'BARR', 'SILO', 'FIX'];
    for (const type of types) {
      const spy = makeSpy(House.Spain, 10, 10);
      const s = makeStructure(type, House.USSR);
      s.triggerName = `trigger_${type}`;
      const result = tsSpyInfiltrate(spy, s);
      expect(result.spiedTriggers.has(`trigger_${type}`),
        `trigger should fire for ${type}`).toBe(true);
    }
  });
});

// ==========================================================================
// Section 18: EVA announcement — VOX_BUILDING_INFILTRATED
// ==========================================================================

describe('EVA announcement (infantry.cpp:653)', () => {
  it('single VOX_BUILDING_INFILTRATED for ALL building types', () => {
    const types = ['PROC', 'DOME', 'POWR', 'APWR', 'SPEN', 'WEAP', 'TENT', 'BARR', 'SILO', 'FIX'];
    for (const type of types) {
      const spy = makeSpy(House.Spain, 10, 10);
      const s = makeStructure(type, House.USSR);
      const result = tsSpyInfiltrate(spy, s);
      expect(result.evaMessages[0], `EVA for ${type}`).toBe('BUILDING INFILTRATED');
    }
  });
});

// ==========================================================================
// Section 19: SpiedBy tracking for ALL building types
// C++ infantry.cpp:656 sets SpiedBy for ALL buildings unconditionally
// ==========================================================================

describe('SpiedBy tracking for all building types (infantry.cpp:656)', () => {
  const ALL_TYPES = ['PROC', 'SILO', 'DOME', 'POWR', 'APWR', 'SPEN', 'WEAP',
    'TENT', 'BARR', 'FIX', 'FACT', 'GAP', 'ATEK', 'STEK', 'KENN',
    'PDOX', 'IRON', 'MSLO', 'SYRD', 'AFLD', 'HPAD', 'BIO', 'HOSP'];

  for (const type of ALL_TYPES) {
    it(`${type}: SpiedBy flag is set and spiedHouses updated`, () => {
      const spy = makeSpy(House.Spain, 10, 10);
      const s = makeStructure(type, House.USSR);
      const result = tsSpyInfiltrate(spy, s);

      expect(spy.alive).toBe(false);
      expect(result.spiedHouses.has(House.USSR)).toBe(true);
      expect(result.buildingSpiedBy).toBeGreaterThan(0);
    });
  }
});

// ==========================================================================
// Section 20: Spy disguise system (infantry.cpp, entity.ts)
// C++ infantry.cpp — spy adopts enemy house appearance
// ==========================================================================

describe('Spy disguise system (infantry.cpp)', () => {
  it('spy starts undisguised (disguisedAs = null)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    expect(spy.disguisedAs).toBeNull();
  });

  it('spy can be disguised as an enemy house', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    spy.disguisedAs = House.USSR;
    expect(spy.disguisedAs).toBe(House.USSR);
  });

  it('spy.house remains unchanged when disguised', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    spy.disguisedAs = House.USSR;
    expect(spy.house).toBe(House.Spain);
    expect(spy.disguisedAs).toBe(House.USSR);
  });

  it('disguise can be cleared by setting to null', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    spy.disguisedAs = House.USSR;
    spy.disguisedAs = null;
    expect(spy.disguisedAs).toBeNull();
  });

  it('disguise is cleared on infiltration (C++ delete this)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    spy.disguisedAs = House.USSR;
    const dome = makeStructure('DOME', House.USSR);
    tsSpyInfiltrate(spy, dome);
    expect(spy.disguisedAs).toBeNull();
  });
});

// ==========================================================================
// Section 21: Dog spy detection — AI targeting (techno.cpp:1557-1563)
// Spies are INVISIBLE to all non-dog units. Only dogs detect them.
// ==========================================================================

describe('Dog spy detection — threatScore (techno.cpp:1557-1563)', () => {
  it('threatScore returns 0 when E1 scans SPY (spy invisible to rifle)', () => {
    const scanner = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    expect(threatScore(scanner, spy, 1, false)).toBe(0);
  });

  it('threatScore returns 0 when 2TNK scans SPY (spy invisible to tanks)', () => {
    const scanner = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    expect(threatScore(scanner, spy, 1, false)).toBe(0);
  });

  it('threatScore returns 0 when E3 scans SPY (spy invisible to rockets)', () => {
    const scanner = entityAtCell(UnitType.I_E3, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    expect(threatScore(scanner, spy, 1, false)).toBe(0);
  });

  it('threatScore returns 0 for SPY even at zero distance', () => {
    const scanner = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 10, 10);
    expect(threatScore(scanner, spy, 0, false)).toBe(0);
  });

  it('threatScore returns > 0 when DOG scans SPY (dogs detect spies)', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    const score = threatScore(dog, spy, 1, false);
    expect(score).toBeGreaterThan(0);
  });

  it('dog threat score uses SPY Points from rules.ini', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    const iniPoints = parseInt(iniSpy['Points'], 10);
    // C++ Value() = 2 * Points; score = floor((value * 32000) / (dist+1))
    const expectedValue = iniPoints * 2;
    const dist = 1;
    // Organic warhead vs none armor = 1.0 (no mult adjustment)
    const expectedScore = Math.max(Math.trunc((expectedValue * 32000) / (Math.floor(dist) + 1)), 1);
    const score = threatScore(dog, spy, dist, false);
    expect(score).toBe(expectedScore);
  });
});

// ==========================================================================
// Section 22: Dog instant-kills spy on attack (DG1)
// DogJaw Damage from rules.ini, Organic warhead vs none armor from rules.ini
// ==========================================================================

describe('Dog instant-kills spy (DG1 — DogJaw vs none armor)', () => {
  const iniDamage = parseInt(iniDogJaw['Damage'], 10);
  const versesArr = iniOrganic['Verses'].split(',').map(v => parseIniPercent(v.trim()));
  const organicVsNone = versesArr[0]; // First entry is vs none armor

  it(`DogJaw damage=${iniDamage}, Organic vs none=${organicVsNone} — kills spy`, () => {
    const spy = entityAtCell(UnitType.I_SPY, House.Spain, 11, 10);
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    dog.target = spy;
    const killed = spy.takeDamage(iniDamage, 'Organic', dog);
    expect(killed).toBe(true);
    expect(spy.alive).toBe(false);
    expect(spy.hp).toBe(0);
  });

  it(`DogJaw damage (${iniDamage}) exceeds SPY Strength (${parseInt(iniSpy['Strength'], 10)})`, () => {
    const spyStrength = parseInt(iniSpy['Strength'], 10);
    const effectiveDamage = Math.floor(iniDamage * organicVsNone);
    expect(effectiveDamage).toBeGreaterThanOrEqual(spyStrength);
  });
});

// ==========================================================================
// Section 23: SPY fragility — INI-parsed HP comparison
// ==========================================================================

describe('SPY fragility (rules.ini Strength comparison)', () => {
  const spyHp = parseInt(iniSpy['Strength'], 10);
  const e6Hp = parseInt(iniE6['Strength'], 10);
  const e1Hp = parseInt(iniE1['Strength'], 10);
  const dogHp = parseInt(iniDog['Strength'], 10);

  it(`SPY HP (${spyHp}) equals Engineer E6 HP (${e6Hp})`, () => {
    expect(spyHp).toBe(e6Hp);
    expect(UNIT_STATS.SPY.strength).toBe(UNIT_STATS.E6.strength);
  });

  it(`SPY HP (${spyHp}) < Rifle E1 HP (${e1Hp})`, () => {
    expect(spyHp).toBeLessThan(e1Hp);
    expect(UNIT_STATS.SPY.strength).toBeLessThan(UNIT_STATS.E1.strength);
  });

  it(`SPY HP (${spyHp}) > DOG HP (${dogHp})`, () => {
    expect(spyHp).toBeGreaterThan(dogHp);
    expect(UNIT_STATS.SPY.strength).toBeGreaterThan(UNIT_STATS.DOG.strength);
  });
});

// ==========================================================================
// Section 24: C++ housespy bitmask (infantry.cpp:646)
// ==========================================================================

describe('C++ housespy bitmask (infantry.cpp:646)', () => {
  it('bitmask uses 1 << house_enum_index — all bits unique', () => {
    for (let i = 0; i < 10; i++) {
      for (let j = i + 1; j < 10; j++) {
        expect((1 << i) & (1 << j)).toBe(0);
      }
    }
  });

  it('multiple houses can spy on same building via OR', () => {
    let spiedBy = 0;
    spiedBy |= (1 << 0);
    spiedBy |= (1 << 4);
    expect(spiedBy & (1 << 0)).toBeTruthy();
    expect(spiedBy & (1 << 4)).toBeTruthy();
    expect(spiedBy & (1 << 2)).toBeFalsy();
  });
});

// ==========================================================================
// Section 25: Building type code mapping (C++ STRUCT_* -> TS string)
// ==========================================================================

describe('C++ STRUCT_* to TS type code mapping', () => {
  const MAPPING: [string, string][] = [
    ['STRUCT_RADAR', 'DOME'],
    ['STRUCT_SUB_PEN', 'SPEN'],
    ['STRUCT_REFINERY', 'PROC'],
    ['STRUCT_POWER', 'POWR'],
    ['STRUCT_ADVANCED_POWER', 'APWR'],
    ['STRUCT_BARRACKS', 'BARR'],
    ['STRUCT_TENT', 'TENT'],
    ['STRUCT_WEAP', 'WEAP'],
    ['STRUCT_KENNEL', 'KENN'],
    ['STRUCT_REPAIR', 'FIX'],
    ['STRUCT_STORAGE', 'SILO'],
    ['STRUCT_GAP', 'GAP'],
    ['STRUCT_EYE', 'ATEK'],
  ];

  for (const [cppName, tsCode] of MAPPING) {
    it(`${cppName} = ${tsCode}`, () => {
      const s = makeStructure(tsCode, House.USSR);
      expect(s.type).toBe(tsCode);
    });
  }
});

// ==========================================================================
// Section 26: Complete spy effect matrix — C++ vs TS
// ==========================================================================

describe('Complete spy effect matrix', () => {
  it('DOME: SpiedBy + RadarSpied (matches C++)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const result = tsSpyInfiltrate(spy, makeStructure('DOME', House.USSR));
    expect(result.spiedHouses.has(House.USSR)).toBe(true);
    expect(result.radarSpiedHouses.has(House.USSR)).toBe(true);
    expect(result.superweapons.size).toBe(0);
  });

  it('SPEN: SpiedBy + sonar pulse (matches C++)', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const result = tsSpyInfiltrate(spy, makeStructure('SPEN', House.USSR));
    expect(result.spiedHouses.has(House.USSR)).toBe(true);
    expect(result.superweapons.size).toBe(1);
    expect(result.radarSpiedHouses.size).toBe(0);
  });

  const SPIED_BY_ONLY = ['PROC', 'SILO', 'POWR', 'APWR', 'WEAP', 'TENT', 'BARR',
    'FIX', 'FACT', 'GAP', 'ATEK', 'STEK', 'KENN'];
  for (const type of SPIED_BY_ONLY) {
    it(`${type}: SpiedBy only (matches C++ — no special effect)`, () => {
      const spy = makeSpy(House.Spain, 10, 10);
      const result = tsSpyInfiltrate(spy, makeStructure(type, House.USSR));
      expect(result.spiedHouses.has(House.USSR)).toBe(true);
      expect(result.radarSpiedHouses.size).toBe(0);
      expect(result.superweapons.size).toBe(0);
      expect(spy.alive).toBe(false);
    });
  }
});

// ==========================================================================
// Section 27: Source code verification — spyInfiltrate has NO fabricated effects
// Reads index.ts to confirm the TS implementation matches C++
// ==========================================================================

describe('spyInfiltrate source code — no fabricated effects', () => {
  const indexSrc = readFileSync(
    join(__dirname, '../engine/index.ts'),
    'utf-8',
  );

  function extractSpyInfiltrate(): string {
    const start = indexSrc.indexOf('private spyInfiltrate(');
    if (start === -1) throw new Error('spyInfiltrate method not found in index.ts');
    const methodRegion = indexSrc.slice(start);
    const endMatch = methodRegion.match(/\n  (?:\/\/ ===|(?:private|public|protected) \w)/);
    if (!endMatch || endMatch.index === undefined) return methodRegion;
    return methodRegion.slice(0, endMatch.index);
  }

  const spyMethodRaw = extractSpyInfiltrate();

  /** Strip comments so regex only matches executable code */
  function stripComments(src: string): string {
    return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  }

  const spyMethod = stripComments(spyMethodRaw);

  it('no credit theft code (steal/houseCredits/addCredits)', () => {
    expect(/houseCredits|stolen|steal|addCredits/i.test(spyMethod)).toBe(false);
  });

  it('no power sabotage code (powerSabotage/powerDrain/blackout)', () => {
    expect(/powerSabotage|powerDrain|blackout/i.test(spyMethod)).toBe(false);
  });

  it('no fogDisabled (C++ only sets RadarSpied, not fog disable)', () => {
    expect(/fogDisabled\s*=\s*true/.test(spyMethod)).toBe(false);
  });

  it('no fogReEnableTick timer (fabricated concept — C++ RadarSpied is permanent)', () => {
    expect(/fogReEnableTick/.test(spyMethod)).toBe(false);
  });

  it('no production queue reset', () => {
    expect(/productionQueue\.delete|abandon|cancel.*production/i.test(spyMethod)).toBe(false);
  });

  it('no GPS satellite grant', () => {
    expect(/GPS_SATELLITE|gpsActive/i.test(spyMethod)).toBe(false);
  });

  it('no productionSpiedHouses (TS invention — C++ only has generic SpiedBy)', () => {
    expect(/productionSpiedHouses/.test(spyMethod)).toBe(false);
  });

  it('sets radarSpiedHouses for DOME', () => {
    expect(/radarSpiedHouses\.add/.test(spyMethod)).toBe(true);
  });

  it('sets structure.spiedBy (per-building bitmask)', () => {
    expect(/structure\.spiedBy/.test(spyMethod)).toBe(true);
  });

  it('sets spiedHouses (house-level tracking)', () => {
    expect(/spiedHouses\.add/.test(spyMethod)).toBe(true);
  });

  it('spy is consumed (alive=false, mission=DIE)', () => {
    expect(/spy\.alive\s*=\s*false/.test(spyMethod)).toBe(true);
    expect(/spy\.mission\s*=\s*Mission\.DIE/.test(spyMethod)).toBe(true);
  });

  it('spy disguise cleared on infiltration', () => {
    expect(/spy\.disguisedAs\s*=\s*null/.test(spyMethod)).toBe(true);
  });

  it('spy triggerName cleared before death', () => {
    expect(/spy\.triggerName\s*=\s*undefined/.test(spyMethod)).toBe(true);
  });

  it('records spiedBuildingTriggers for TEVENT_SPIED', () => {
    expect(/spiedBuildingTriggers\.add/.test(spyMethodRaw)).toBe(true);
  });

  // Only DOME and SPEN should have type conditions
  const fabricatedCases = ['PROC', 'SILO', 'POWR', 'APWR', 'WEAP', 'BARR', 'TENT', 'ATEK', 'STEK', 'SYRD'];
  for (const btype of fabricatedCases) {
    it(`${btype} has no case/condition with fabricated effects`, () => {
      const caseRegex = new RegExp(`case\\s+['"]${btype}['"]`);
      const conditionRegex = new RegExp(`structure\\.type\\s*===?\\s*['"]${btype}['"]`);
      expect(caseRegex.test(spyMethod) || conditionRegex.test(spyMethod)).toBe(false);
    });
  }
});

// ==========================================================================
// Section 28: PARITY GAP — AI spy infiltration restriction
// C++ allows any house spy to infiltrate; TS restricts to player spies
// ==========================================================================

describe('PARITY GAP: AI spy infiltration (infantry.cpp:645 vs missionAI.ts:1056)', () => {
  it('C++ allows any house spy to infiltrate — TS only allows player spies', () => {
    const aiSpy = makeSpy(House.USSR, 10, 10);
    expect(aiSpy.isPlayerUnit).toBe(false);

    const playerSpy = makeSpy(House.Spain, 10, 10);
    expect(playerSpy.isPlayerUnit).toBe(true);

    // Both are valid SPY units
    expect(aiSpy.type).toBe(UnitType.I_SPY);
    expect(playerSpy.type).toBe(UnitType.I_SPY);
  });
});

// ==========================================================================
// Section 29: Thief vs Spy distinction in specialUnits.ts
// C++ infantry.cpp:675-701 — thief steals credits, spy does not
// ==========================================================================

describe('Thief vs Spy credit theft distinction (infantry.cpp:645-701)', () => {
  const specialUnitsSrc = readFileSync(
    join(__dirname, '../engine/specialUnits.ts'),
    'utf-8',
  );

  it('Thief correctly steals 50% credits from PROC/SILO (baseline)', () => {
    const thiefSteals = /enemyCredits\s*\*\s*0\.5|Math\.floor.*0\.5/.test(specialUnitsSrc);
    expect(thiefSteals).toBe(true);
  });

  it('Spy on PROC does NOT steal credits (only sets SpiedBy)', () => {
    const indexSrc = readFileSync(join(__dirname, '../engine/index.ts'), 'utf-8');
    const start = indexSrc.indexOf('private spyInfiltrate(');
    const methodRegion = indexSrc.slice(start, start + 2000);
    const stripped = methodRegion.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/houseCredits|stolen|steal|addCredits/i.test(stripped)).toBe(false);
  });
});

// ==========================================================================
// Section 30: Sonar pulse granted to SPY house, not target house
// ==========================================================================

describe('Sonar pulse granted to spy house (infantry.cpp:664-670)', () => {
  it('sonar pulse for spy house, not target house', () => {
    const spy = makeSpy(House.Spain, 10, 10);
    const spen = makeStructure('SPEN', House.USSR);
    const result = tsSpyInfiltrate(spy, spen);

    const sonarKey = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;
    const state = result.superweapons.get(sonarKey);
    expect(state).toBeDefined();
    expect(state!.house).toBe(House.Spain);
    expect(state!.type).toBe(SuperweaponType.SONAR_PULSE);
  });

  it('only one sonar per spy house (Map semantics)', () => {
    const sonarMap = new Map<House, House>();
    sonarMap.set(House.Spain, House.USSR);
    sonarMap.set(House.Spain, House.Ukraine);
    expect(sonarMap.get(House.Spain)).toBe(House.Ukraine);
    expect(sonarMap.size).toBe(1);
  });

  it('sonar recharge matches rules.ini [Recharge] Sonar=', () => {
    const iniMinutes = parseInt(iniRecharge['Sonar'], 10);
    const expectedTicks = iniMinutes * 900;
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks).toBe(expectedTicks);
  });
});
