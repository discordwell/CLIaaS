/**
 * C++ Parity: Naval unit behavior parsed directly from rules.ini / aftrmath.ini
 *
 * Authoritative source: rules.ini is god (per CLAUDE.md).
 * Every assertion derives its expected value from INI text, not from C++ defaults.
 *
 * Covers:
 *   1. Vessel section stats: Strength, Armor, Speed, Sight, ROT, Cost, Points,
 *      Cloakable, Sensors, Prerequisite, Owner, Passengers
 *   2. Naval weapon stats: Damage, ROF, Range, Projectile, Speed, Warhead, Burst
 *   3. Naval projectile flags: UnderWater, ASW, AG, Arcing, Inaccurate, High
 *   4. Submarine cloak delay: [General] SubmergeDelay -> CloakDelay computation
 *   5. Sonar pulse duration: 15 * TICKS_PER_SECOND = 225 ticks
 *   6. Depth charge targeting restrictions (Catapult AG=no, ASW=yes)
 *   7. Cruiser shore bombardment range: 8Inch Range=22
 *
 * C++ source refs:
 *   vessel.cpp:88-126  — constructor, IsCloakable from Class
 *   vessel.cpp:1006-1139 — Can_Fire: torpedo LOS, depth charge sub-only
 *   vessel.cpp:1951-1953 — Is_Allowed_To_Recloak: PulseCountDown == 0
 *   house.cpp:2629  — PulseCountDown = 15 * TICKS_PER_SECOND
 *   rules.cpp:430   — CloakDelay = Get_Fixed("SubmergeDelay", CloakDelay)
 *   techno.cpp:6281  — IsScanner = Get_Bool("Sensors", IsScanner)
 *   defines.h:3031   — TICKS_PER_SECOND = 15
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { UNIT_STATS, WEAPON_STATS, PRODUCTION_ITEMS } from '../engine/types';
import {
  CLOAK_DELAY_TICKS, SONAR_PULSE_DURATION, CLOAK_TRANSITION_FRAMES,
} from '../engine/entity';

// ── INI Parser (shared pattern from cpp-parity-naval-combat.test.ts) ──────────

function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const commentIdx = rawLine.indexOf(';');
    const stripped = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
    const line = stripped.trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (value) sections[current][key] = value;
      }
    }
  }
  return sections;
}

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const ini = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftIni = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));

// Merge aftrmath.ini over rules.ini (Aftermath overrides base game)
function getSection(name: string): Record<string, string> {
  return { ...(ini[name] ?? {}), ...(aftIni[name] ?? {}) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function iniInt(section: string, key: string): number {
  const s = getSection(section);
  return parseInt(s[key], 10);
}

function iniFloat(section: string, key: string): number {
  const s = getSection(section);
  return parseFloat(s[key]);
}

function iniBool(section: string, key: string): boolean {
  const s = getSection(section);
  const v = (s[key] ?? '').toLowerCase();
  return v === 'yes' || v === 'true';
}

function iniStr(section: string, key: string): string | undefined {
  return getSection(section)[key];
}

function findProdItem(type: string) {
  return PRODUCTION_ITEMS.find(i => i.type === type);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. VESSEL SECTION STATS — rules.ini / aftrmath.ini vs UNIT_STATS
// ══════════════════════════════════════════════════════════════════════════════

const VESSEL_IDS = ['SS', 'DD', 'CA', 'LST', 'PT', 'MSUB'] as const;

describe('Vessel unit stats from rules.ini (vessel sections)', () => {

  describe.each(VESSEL_IDS)('%s — Strength', (id) => {
    it(`TS Strength matches INI Strength=`, () => {
      const expected = iniInt(id, 'Strength');
      const actual = UNIT_STATS[id]?.strength;
      expect(actual, `${id} strength`).toBe(expected);
    });
  });

  describe.each(VESSEL_IDS)('%s — Armor', (id) => {
    it(`TS armor matches INI Armor=`, () => {
      const expected = iniStr(id, 'Armor')!.toLowerCase();
      const actual = UNIT_STATS[id]?.armor;
      expect(actual, `${id} armor`).toBe(expected);
    });
  });

  describe.each(VESSEL_IDS)('%s — Speed', (id) => {
    it(`TS speed matches INI Speed=`, () => {
      const expected = iniInt(id, 'Speed');
      const actual = UNIT_STATS[id]?.speed;
      expect(actual, `${id} speed`).toBe(expected);
    });
  });

  describe.each(VESSEL_IDS)('%s — Sight', (id) => {
    it(`TS sight matches INI Sight=`, () => {
      const expected = iniInt(id, 'Sight');
      const actual = UNIT_STATS[id]?.sight;
      expect(actual, `${id} sight`).toBe(expected);
    });
  });

  describe.each(VESSEL_IDS)('%s — ROT', (id) => {
    it(`TS rot matches INI ROT=`, () => {
      const expected = iniInt(id, 'ROT');
      const actual = UNIT_STATS[id]?.rot;
      expect(actual, `${id} ROT`).toBe(expected);
    });
  });

  describe.each(VESSEL_IDS)('%s — Points', (id) => {
    it(`TS points matches INI Points=`, () => {
      const expected = iniInt(id, 'Points');
      const actual = UNIT_STATS[id]?.points;
      expect(actual, `${id} points`).toBe(expected);
    });
  });

  describe.each(VESSEL_IDS)('%s — Cost (PRODUCTION_ITEMS)', (id) => {
    it(`PRODUCTION_ITEMS cost matches INI Cost=`, () => {
      const expected = iniInt(id, 'Cost');
      const prod = findProdItem(id);
      expect(prod, `${id} should exist in PRODUCTION_ITEMS`).toBeDefined();
      expect(prod!.cost, `${id} cost`).toBe(expected);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. VESSEL PRIMARY/SECONDARY WEAPON ASSIGNMENTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Vessel weapon assignments from rules.ini', () => {
  const VESSEL_WEAPONS: [string, string | null, string | null][] = [
    // [vesselId, expectedPrimary (INI Primary=), expectedSecondary (INI Secondary=)]
    ['SS',   'TorpTube',    null],
    ['DD',   'Stinger',     'DepthCharge'],
    ['CA',   '8Inch',       '8Inch'],
    ['LST',  null,           null],
    ['PT',   '2Inch',       'DepthCharge'],
    ['MSUB', 'SubSCUD',     null],
  ];

  it.each(VESSEL_WEAPONS)('%s — primary weapon matches INI', (id, expectedPrimary) => {
    const iniPrimary = iniStr(id, 'Primary') ?? null;
    expect(iniPrimary, `INI sanity: ${id} Primary`).toBe(expectedPrimary);
    const tsPrimary = UNIT_STATS[id]?.primaryWeapon ?? null;
    expect(tsPrimary, `${id} TS primaryWeapon`).toBe(expectedPrimary);
  });

  it.each(VESSEL_WEAPONS)('%s — secondary weapon matches INI', (id, _p, expectedSecondary) => {
    const iniSecondary = iniStr(id, 'Secondary') ?? null;
    expect(iniSecondary, `INI sanity: ${id} Secondary`).toBe(expectedSecondary);
    const tsSecondary = UNIT_STATS[id]?.secondaryWeapon ?? null;
    expect(tsSecondary, `${id} TS secondaryWeapon`).toBe(expectedSecondary);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. VESSEL BOOLEAN FLAGS — Cloakable, Sensors
// ══════════════════════════════════════════════════════════════════════════════

describe('Vessel boolean flags from rules.ini', () => {

  it('SS has Cloakable=yes', () => {
    expect(iniBool('SS', 'Cloakable')).toBe(true);
    expect(UNIT_STATS.SS?.isCloakable).toBe(true);
  });

  it('MSUB has Cloakable=yes (aftrmath.ini)', () => {
    expect(iniBool('MSUB', 'Cloakable')).toBe(true);
    expect(UNIT_STATS.MSUB?.isCloakable).toBe(true);
  });

  it('DD does NOT have Cloakable=yes', () => {
    expect(iniBool('DD', 'Cloakable')).toBe(false);
    expect(UNIT_STATS.DD?.isCloakable).toBeFalsy();
  });

  it('CA does NOT have Cloakable=yes', () => {
    expect(iniBool('CA', 'Cloakable')).toBe(false);
    expect(UNIT_STATS.CA?.isCloakable).toBeFalsy();
  });

  it('DD has Sensors=Yes (can detect submerged subs)', () => {
    // C++ techno.cpp:6281: IsScanner = Get_Bool("Sensors", IsScanner)
    expect(iniBool('DD', 'Sensors')).toBe(true);
    // TS maps this to isAntiSub on the unit stat
    expect(UNIT_STATS.DD?.isAntiSub).toBe(true);
  });

  it('CA has Sensors=Yes (can detect submerged subs)', () => {
    expect(iniBool('CA', 'Sensors')).toBe(true);
    // TS maps this to isAntiSub
    expect(UNIT_STATS.CA?.isAntiSub).toBe(true);
  });

  it('PT has Sensors=Yes (can detect submerged subs)', () => {
    expect(iniBool('PT', 'Sensors')).toBe(true);
    expect(UNIT_STATS.PT?.isAntiSub).toBe(true);
  });

  it('SS does NOT have Sensors=Yes', () => {
    expect(iniBool('SS', 'Sensors')).toBe(false);
  });

  it('LST does NOT have Sensors=Yes', () => {
    expect(iniBool('LST', 'Sensors')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. VESSEL FACTION OWNERSHIP — rules.ini Owner= vs PRODUCTION_ITEMS faction
// ══════════════════════════════════════════════════════════════════════════════

describe('Vessel faction ownership from rules.ini', () => {
  const VESSEL_OWNERS: [string, string, string][] = [
    // [vesselId, INI Owner=, expected PRODUCTION_ITEMS faction]
    ['SS',   'soviet',        'soviet'],
    ['DD',   'allies',        'allied'],
    ['CA',   'allies',        'allied'],
    ['LST',  'allies,soviet', 'both'],
    ['PT',   'allies',        'allied'],
    ['MSUB', 'soviet',        'soviet'],
  ];

  it.each(VESSEL_OWNERS)('%s — INI Owner= matches PRODUCTION_ITEMS faction', (id, expectedOwner, expectedFaction) => {
    const iniOwner = iniStr(id, 'Owner');
    expect(iniOwner, `INI ${id} Owner`).toBe(expectedOwner);
    const prod = findProdItem(id);
    expect(prod, `${id} should exist in PRODUCTION_ITEMS`).toBeDefined();
    expect(prod!.faction, `${id} faction`).toBe(expectedFaction);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. NAVAL WEAPON STATS — rules.ini weapon sections vs WEAPON_STATS
// ══════════════════════════════════════════════════════════════════════════════

describe('Naval weapon stats from rules.ini', () => {
  const NAVAL_WEAPONS = ['TorpTube', 'Stinger', 'DepthCharge', '8Inch', '2Inch'] as const;
  // SubSCUD is from aftrmath.ini, tested separately

  describe.each(NAVAL_WEAPONS)('%s — Damage', (wep) => {
    it('TS damage matches INI Damage=', () => {
      const expected = iniInt(wep, 'Damage');
      const actual = WEAPON_STATS[wep]?.damage;
      expect(actual, `${wep} damage`).toBe(expected);
    });
  });

  describe.each(NAVAL_WEAPONS)('%s — ROF', (wep) => {
    it('TS rof matches INI ROF=', () => {
      const expected = iniInt(wep, 'ROF');
      const actual = WEAPON_STATS[wep]?.rof;
      expect(actual, `${wep} rof`).toBe(expected);
    });
  });

  describe.each(NAVAL_WEAPONS)('%s — Range', (wep) => {
    it('TS range matches INI Range=', () => {
      const expected = iniFloat(wep, 'Range');
      const actual = WEAPON_STATS[wep]?.range;
      expect(actual, `${wep} range`).toBeCloseTo(expected, 1);
    });
  });

  describe.each(NAVAL_WEAPONS)('%s — Speed (projectile)', (wep) => {
    it('TS projSpeed matches INI Speed=', () => {
      const expected = iniInt(wep, 'Speed');
      const actual = WEAPON_STATS[wep]?.projSpeed;
      expect(actual, `${wep} projSpeed`).toBe(expected);
    });
  });

  describe.each(NAVAL_WEAPONS)('%s — Warhead', (wep) => {
    it('TS warhead matches INI Warhead=', () => {
      const expected = iniStr(wep, 'Warhead');
      const actual = WEAPON_STATS[wep]?.warhead;
      expect(actual, `${wep} warhead`).toBe(expected);
    });
  });

  // Burst is only defined on some weapons
  it('Stinger has Burst=2 (INI)', () => {
    expect(iniInt('Stinger', 'Burst')).toBe(2);
    expect(WEAPON_STATS.Stinger?.burst).toBe(2);
  });

  it('TorpTube has no Burst (single shot)', () => {
    expect(iniStr('TorpTube', 'Burst')).toBeUndefined();
    expect(WEAPON_STATS.TorpTube?.burst).toBeUndefined();
  });

  it('DepthCharge has no Burst', () => {
    expect(iniStr('DepthCharge', 'Burst')).toBeUndefined();
    expect(WEAPON_STATS.DepthCharge?.burst).toBeUndefined();
  });

  it('8Inch has Supress=yes (area suppression)', () => {
    expect(iniBool('8Inch', 'Supress')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. SubSCUD — Aftermath missile sub weapon (aftrmath.ini)
// ══════════════════════════════════════════════════════════════════════════════

describe('SubSCUD weapon stats from aftrmath.ini', () => {
  it('Damage=400', () => {
    expect(iniInt('SubSCUD', 'Damage')).toBe(400);
    expect(WEAPON_STATS.SubSCUD?.damage).toBe(400);
  });

  it('ROF=120', () => {
    expect(iniInt('SubSCUD', 'ROF')).toBe(120);
    expect(WEAPON_STATS.SubSCUD?.rof).toBe(120);
  });

  it('Range=14', () => {
    expect(iniFloat('SubSCUD', 'Range')).toBe(14);
    expect(WEAPON_STATS.SubSCUD?.range).toBe(14);
  });

  it('Speed=20', () => {
    expect(iniInt('SubSCUD', 'Speed')).toBe(20);
    expect(WEAPON_STATS.SubSCUD?.projSpeed).toBe(20);
  });

  it('Warhead=HE', () => {
    expect(iniStr('SubSCUD', 'Warhead')).toBe('HE');
    expect(WEAPON_STATS.SubSCUD?.warhead).toBe('HE');
  });

  it('Burst=2', () => {
    expect(iniInt('SubSCUD', 'Burst')).toBe(2);
    expect(WEAPON_STATS.SubSCUD?.burst).toBe(2);
  });

  it('Projectile=HeatSeeker', () => {
    expect(iniStr('SubSCUD', 'Projectile')).toBe('HeatSeeker');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. NAVAL PROJECTILE FLAGS — rules.ini projectile sections
// ══════════════════════════════════════════════════════════════════════════════

describe('Naval projectile flags from rules.ini', () => {

  describe('Torpedo projectile (TorpTube projectile)', () => {
    it('TorpTube uses Torpedo projectile', () => {
      expect(iniStr('TorpTube', 'Projectile')).toBe('Torpedo');
    });

    it('Torpedo has UnderWater=yes (subsurface travel)', () => {
      expect(iniBool('Torpedo', 'UnderWater')).toBe(true);
    });

    it('Torpedo has ASW=yes (can hit submerged targets)', () => {
      expect(iniBool('Torpedo', 'ASW')).toBe(true);
    });

    it('TS TorpTube weapon has isSubSurface=true', () => {
      expect(WEAPON_STATS.TorpTube?.isSubSurface).toBe(true);
    });
  });

  describe('Catapult projectile (DepthCharge projectile)', () => {
    it('DepthCharge uses Catapult projectile', () => {
      expect(iniStr('DepthCharge', 'Projectile')).toBe('Catapult');
    });

    it('Catapult has ASW=yes (anti-submarine)', () => {
      expect(iniBool('Catapult', 'ASW')).toBe(true);
    });

    it('Catapult has AG=no (cannot hit ground targets)', () => {
      // This is the key restriction: depth charges can ONLY hit subs
      const agValue = iniStr('Catapult', 'AG')?.toLowerCase();
      expect(agValue).toBe('no');
    });

    it('Catapult has High=yes (arcing trajectory)', () => {
      expect(iniBool('Catapult', 'High')).toBe(true);
    });

    it('Catapult has Arcing=yes', () => {
      expect(iniBool('Catapult', 'Arcing')).toBe(true);
    });

    it('Catapult has Inaccurate=yes', () => {
      expect(iniBool('Catapult', 'Inaccurate')).toBe(true);
    });

    it('TS DepthCharge weapon has isAntiSub=true', () => {
      expect(WEAPON_STATS.DepthCharge?.isAntiSub).toBe(true);
    });

    it('TS DepthCharge weapon has isAntiGround=false', () => {
      // Catapult AG=no means depth charges cannot hit surface/ground targets
      expect(WEAPON_STATS.DepthCharge?.isAntiGround).toBe(false);
    });
  });

  describe('Ballistic projectile (8Inch / cruiser projectile)', () => {
    it('8Inch uses Ballistic projectile', () => {
      expect(iniStr('8Inch', 'Projectile')).toBe('Ballistic');
    });

    it('Ballistic has High=yes (arcing trajectory)', () => {
      expect(iniBool('Ballistic', 'High')).toBe(true);
    });

    it('Ballistic has Arcing=yes', () => {
      expect(iniBool('Ballistic', 'Arcing')).toBe(true);
    });

    it('Ballistic has Inaccurate=yes', () => {
      expect(iniBool('Ballistic', 'Inaccurate')).toBe(true);
    });

    it('Ballistic does NOT have ASW (cannot hit subs)', () => {
      expect(iniBool('Ballistic', 'ASW')).toBe(false);
    });
  });

  describe('LaserGuided projectile (Stinger / DD primary)', () => {
    it('Stinger uses LaserGuided projectile', () => {
      expect(iniStr('Stinger', 'Projectile')).toBe('LaserGuided');
    });

    it('LaserGuided has AA=yes (anti-air capable)', () => {
      expect(iniBool('LaserGuided', 'AA')).toBe(true);
    });

    it('LaserGuided has High=yes', () => {
      expect(iniBool('LaserGuided', 'High')).toBe(true);
    });

    it('LaserGuided has ROT=20 (fast tracking)', () => {
      expect(iniInt('LaserGuided', 'ROT')).toBe(20);
    });
  });

  describe('Cannon projectile (2Inch / gunboat)', () => {
    it('2Inch uses Cannon projectile', () => {
      expect(iniStr('2Inch', 'Projectile')).toBe('Cannon');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. CRUISER SHORE BOMBARDMENT RANGE
// ══════════════════════════════════════════════════════════════════════════════

describe('Cruiser shore bombardment (8Inch weapon range)', () => {
  it('8Inch Range=22 in rules.ini (longest naval weapon range)', () => {
    expect(iniFloat('8Inch', 'Range')).toBe(22);
  });

  it('TS WEAPON_STATS["8Inch"].range matches 22', () => {
    expect(WEAPON_STATS['8Inch']?.range).toBe(22);
  });

  it('8Inch damage is 500 (heavy bombardment)', () => {
    expect(iniInt('8Inch', 'Damage')).toBe(500);
    expect(WEAPON_STATS['8Inch']?.damage).toBe(500);
  });

  it('8Inch ROF=160 (slow reload for massive damage)', () => {
    expect(iniInt('8Inch', 'ROF')).toBe(160);
    expect(WEAPON_STATS['8Inch']?.rof).toBe(160);
  });

  it('8Inch uses HE warhead (High Explosive, area damage)', () => {
    expect(iniStr('8Inch', 'Warhead')).toBe('HE');
    expect(WEAPON_STATS['8Inch']?.warhead).toBe('HE');
  });

  it('CA primary and secondary are both 8Inch (dual gun configuration)', () => {
    expect(iniStr('CA', 'Primary')).toBe('8Inch');
    expect(iniStr('CA', 'Secondary')).toBe('8Inch');
    expect(UNIT_STATS.CA?.primaryWeapon).toBe('8Inch');
    expect(UNIT_STATS.CA?.secondaryWeapon).toBe('8Inch');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. SUBMARINE CLOAK DELAY — [General] SubmergeDelay computation
// ══════════════════════════════════════════════════════════════════════════════

describe('Submarine cloak delay from rules.ini [General]', () => {
  // C++ rules.cpp:430: CloakDelay = ini.Get_Fixed("SubmergeDelay", CloakDelay)
  // C++ techno.cpp:2468: timer = Rule.CloakDelay * TICKS_PER_MINUTE
  // TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900

  const TICKS_PER_SECOND = 15;  // defines.h:3031
  const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60;  // 900

  it('[General] SubmergeDelay=.02 in rules.ini', () => {
    const val = iniFloat('General', 'SubmergeDelay');
    expect(val).toBeCloseTo(0.02, 4);
  });

  it('CloakDelay = SubmergeDelay * TICKS_PER_MINUTE = .02 * 900 = 18 ticks', () => {
    const submergeDelay = iniFloat('General', 'SubmergeDelay');
    const computed = Math.round(submergeDelay * TICKS_PER_MINUTE);
    expect(computed).toBe(18);
  });

  it('TS CLOAK_DELAY_TICKS matches computed 18', () => {
    expect(CLOAK_DELAY_TICKS).toBe(18);
  });

  it('TICKS_PER_SECOND is 15 (defines.h:3031)', () => {
    expect(TICKS_PER_SECOND).toBe(15);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. SONAR PULSE DURATION — house.cpp:2629
// ══════════════════════════════════════════════════════════════════════════════

describe('Sonar pulse duration (house.cpp:2629)', () => {
  // C++ house.cpp:2629: sub->PulseCountDown = 15 * TICKS_PER_SECOND
  // 15 * 15 = 225 ticks = 15 seconds at 15Hz

  const TICKS_PER_SECOND = 15;

  it('PulseCountDown = 15 * TICKS_PER_SECOND = 225 ticks', () => {
    const expected = 15 * TICKS_PER_SECOND;
    expect(expected).toBe(225);
  });

  it('TS SONAR_PULSE_DURATION matches 225', () => {
    expect(SONAR_PULSE_DURATION).toBe(225);
  });

  it('Sonar reveals for exactly 15 seconds at 15 FPS', () => {
    const durationSeconds = SONAR_PULSE_DURATION / TICKS_PER_SECOND;
    expect(durationSeconds).toBe(15);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. DEPTH CHARGE TARGETING — vessel.cpp:1083-1105
// ══════════════════════════════════════════════════════════════════════════════

describe('Depth charge targeting restrictions (vessel.cpp:1083-1105)', () => {
  // C++ vessel.cpp:1083: if (weapon->Bullet->IsAntiSub) — depth charges only for subs
  // C++ vessel.cpp:1088: CSII allows targeting MSUB as well as SS
  // C++ vessel.cpp:1097-1104: non-ASW weapons CANNOT fire at subs

  it('DepthCharge weapon has Catapult projectile with ASW=yes', () => {
    expect(iniStr('DepthCharge', 'Projectile')).toBe('Catapult');
    expect(iniBool('Catapult', 'ASW')).toBe(true);
  });

  it('Stinger (DD primary) does NOT have ASW (uses LaserGuided)', () => {
    // Stinger cannot attack submerged subs — only DepthCharge (secondary) can
    expect(iniStr('Stinger', 'Projectile')).toBe('LaserGuided');
    expect(iniBool('LaserGuided', 'ASW')).toBe(false);
  });

  it('2Inch (PT primary) does NOT have ASW (uses Cannon)', () => {
    expect(iniStr('2Inch', 'Projectile')).toBe('Cannon');
    // Cannon does not have ASW defined
    expect(iniBool('Cannon', 'ASW')).toBe(false);
  });

  it('DD can engage subs with secondary (DepthCharge) but not primary (Stinger)', () => {
    expect(UNIT_STATS.DD?.primaryWeapon).toBe('Stinger');
    expect(UNIT_STATS.DD?.secondaryWeapon).toBe('DepthCharge');
    expect(WEAPON_STATS.DepthCharge?.isAntiSub).toBe(true);
  });

  it('PT can engage subs with secondary (DepthCharge) but not primary (2Inch)', () => {
    expect(UNIT_STATS.PT?.primaryWeapon).toBe('2Inch');
    expect(UNIT_STATS.PT?.secondaryWeapon).toBe('DepthCharge');
    expect(WEAPON_STATS.DepthCharge?.isAntiSub).toBe(true);
  });

  it('SS torpedo (TorpTube) is subsurface — can hit other subs and ships', () => {
    expect(iniBool('Torpedo', 'UnderWater')).toBe(true);
    expect(iniBool('Torpedo', 'ASW')).toBe(true);
    expect(WEAPON_STATS.TorpTube?.isSubSurface).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. MSUB — Aftermath unit from aftrmath.ini
// ══════════════════════════════════════════════════════════════════════════════

describe('MSUB (Missile Sub) stats from aftrmath.ini', () => {
  it('Prerequisite=stek (Soviet Tech Center)', () => {
    expect(iniStr('MSUB', 'Prerequisite')?.toLowerCase()).toBe('stek');
  });

  it('Strength=150', () => {
    expect(iniInt('MSUB', 'Strength')).toBe(150);
    expect(UNIT_STATS.MSUB?.strength).toBe(150);
  });

  it('Armor=light', () => {
    expect(iniStr('MSUB', 'Armor')?.toLowerCase()).toBe('light');
    expect(UNIT_STATS.MSUB?.armor).toBe('light');
  });

  it('TechLevel=9', () => {
    const prod = findProdItem('MSUB');
    expect(prod?.techLevel).toBe(9);
    expect(iniInt('MSUB', 'TechLevel')).toBe(9);
  });

  it('Cost=1650', () => {
    expect(iniInt('MSUB', 'Cost')).toBe(1650);
    expect(findProdItem('MSUB')?.cost).toBe(1650);
  });

  it('Cloakable=yes', () => {
    expect(iniBool('MSUB', 'Cloakable')).toBe(true);
    expect(UNIT_STATS.MSUB?.isCloakable).toBe(true);
  });

  it('Inaccurate=no (aftrmath.ini explicit override)', () => {
    // aftrmath.ini [MSUB] has Inaccurate=no explicitly
    const val = iniStr('MSUB', 'Inaccurate')?.toLowerCase();
    expect(val).toBe('no');
  });

  it('Owner=soviet', () => {
    expect(iniStr('MSUB', 'Owner')).toBe('soviet');
    expect(findProdItem('MSUB')?.faction).toBe('soviet');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. LST (Transport) — no weapons, carries passengers
// ══════════════════════════════════════════════════════════════════════════════

describe('LST (Transport) from rules.ini', () => {
  it('has no Primary weapon', () => {
    expect(iniStr('LST', 'Primary')).toBeUndefined();
    expect(UNIT_STATS.LST?.primaryWeapon).toBeNull();
  });

  it('has no Prerequisite (scenario unit)', () => {
    // LST has no Prerequisite line in rules.ini — it cannot be built directly
    expect(iniStr('LST', 'Prerequisite')).toBeUndefined();
  });

  it('Passengers=5', () => {
    expect(iniInt('LST', 'Passengers')).toBe(5);
    expect(UNIT_STATS.LST?.passengers).toBe(5);
  });

  it('Owner=allies,soviet (both factions)', () => {
    expect(iniStr('LST', 'Owner')).toBe('allies,soviet');
    expect(findProdItem('LST')?.faction).toBe('both');
  });

  it('Speed=14 (fastest vessel)', () => {
    expect(iniInt('LST', 'Speed')).toBe(14);
    expect(UNIT_STATS.LST?.speed).toBe(14);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. CLOAK TRANSITION FRAMES — C++ CLOAK_STAGES
// ══════════════════════════════════════════════════════════════════════════════

describe('Cloak transition frames (techno.cpp:2457)', () => {
  // C++ techno.cpp:2457: CloakingDevice.Set_Stage(0, CLOAK_STAGES)
  // CLOAK_STAGES = 38 for the cloaking/uncloaking animation

  it('CLOAK_TRANSITION_FRAMES is 38', () => {
    expect(CLOAK_TRANSITION_FRAMES).toBe(38);
  });

  it('Cloak transition at 15Hz = 2.53 seconds', () => {
    const seconds = CLOAK_TRANSITION_FRAMES / 15;
    expect(seconds).toBeCloseTo(2.53, 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. CROSS-CHECKS — weapon-projectile chain integrity
// ══════════════════════════════════════════════════════════════════════════════

describe('Weapon-projectile chain integrity (INI cross-references)', () => {
  it('TorpTube -> Torpedo -> UnderWater=yes, ASW=yes (complete torpedo chain)', () => {
    const proj = iniStr('TorpTube', 'Projectile');
    expect(proj).toBe('Torpedo');
    expect(iniBool(proj!, 'UnderWater')).toBe(true);
    expect(iniBool(proj!, 'ASW')).toBe(true);
  });

  it('DepthCharge -> Catapult -> ASW=yes, AG=no (anti-sub only chain)', () => {
    const proj = iniStr('DepthCharge', 'Projectile');
    expect(proj).toBe('Catapult');
    expect(iniBool(proj!, 'ASW')).toBe(true);
    expect(iniStr(proj!, 'AG')?.toLowerCase()).toBe('no');
  });

  it('8Inch -> Ballistic -> High=yes, Arcing=yes, Inaccurate=yes (bombardment chain)', () => {
    const proj = iniStr('8Inch', 'Projectile');
    expect(proj).toBe('Ballistic');
    expect(iniBool(proj!, 'High')).toBe(true);
    expect(iniBool(proj!, 'Arcing')).toBe(true);
    expect(iniBool(proj!, 'Inaccurate')).toBe(true);
  });

  it('SubSCUD -> HeatSeeker -> AA=yes, High=yes (missile sub SCUD chain)', () => {
    const proj = iniStr('SubSCUD', 'Projectile');
    expect(proj).toBe('HeatSeeker');
    expect(iniBool(proj!, 'AA')).toBe(true);
    expect(iniBool(proj!, 'High')).toBe(true);
  });

  it('Stinger -> LaserGuided -> AA=yes, ROT=20 (DD missile chain)', () => {
    const proj = iniStr('Stinger', 'Projectile');
    expect(proj).toBe('LaserGuided');
    expect(iniBool(proj!, 'AA')).toBe(true);
    expect(iniInt(proj!, 'ROT')).toBe(20);
  });

  it('2Inch -> Cannon (gunboat shell chain)', () => {
    const proj = iniStr('2Inch', 'Projectile');
    expect(proj).toBe('Cannon');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. GENERAL SECTION — Gravity for ballistic/catapult projectiles
// ══════════════════════════════════════════════════════════════════════════════

describe('[General] section constants for naval combat', () => {
  it('Gravity=3 (affects Ballistic and Catapult arcing trajectories)', () => {
    expect(iniInt('General', 'Gravity')).toBe(3);
  });

  it('BallisticScatter=1.0 (scatter radius for inaccurate ballistic)', () => {
    expect(iniFloat('General', 'BallisticScatter')).toBeCloseTo(1.0, 2);
  });

  it('HomingScatter=2.0 (scatter radius for inaccurate homing)', () => {
    expect(iniFloat('General', 'HomingScatter')).toBeCloseTo(2.0, 2);
  });
});
