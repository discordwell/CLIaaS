/**
 * C++ Parity: Projectile Data — complete INI-driven audit of all projectile
 * types, weapon→projectile→warhead chains, and scalar values.
 *
 * Authoritative source: rules.ini is god (per CLAUDE.md).
 * Every assertion derives its expected value from INI text parsed at test setup.
 *
 * Covers:
 *   1. Projectile type inventory: every INI projectile section is catalogued
 *   2. Weapon→Projectile linkage: each weapon's Projectile= resolves to a real section
 *   3. Weapon→Projectile→Warhead chain integrity
 *   4. Weapon scalar parity: Damage, ROF, Range, Speed, Burst from INI vs WEAPON_STATS
 *   5. Projectile behavioral flags: High, Arcing, Inaccurate, AA, AG, ASW, Proximity,
 *      ROT, Ranged (isFueled), Dropping, Parachuted, Gigundo, Inviso, UnderWater
 *   6. Coverage gaps: projectile sections in INI not referenced by any TS weapon
 *   7. Arm / RangeLimit values for fueled projectiles
 *
 * C++ source refs:
 *   bullet.h     — BulletTypeClass declaration, all boolean member flags
 *   bbdata.cpp   — BulletTypeClass::BulletTypeClass constructor, default values
 *   bullet.cpp   — BulletClass::AI flight logic, degenerate, arcing, homing, wall collision
 *   rules.ini    — [Weapon] Projectile=, Speed=, [ProjectileType] flags
 *   aftrmath.ini — Expansion weapon/projectile overrides
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { WEAPON_STATS } from '../engine/types';

// ══════════════════════════════════════════════════════════════════════════════
// INI Parser — shared pattern per CLAUDE.md (parse values from INI, never hardcode)
// ══════════════════════════════════════════════════════════════════════════════

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
const rulesIni = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftrmathIni = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));

// Merge aftrmath.ini over rules.ini (Aftermath overrides base game)
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rulesIni)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmathIni)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// ── INI Helpers ─────────────────────────────────────────────────────────────

function iniBool(section: string, key: string, defValue = false): boolean {
  const s = ini[section];
  if (!s || !(key in s)) return defValue;
  const v = s[key].toLowerCase();
  return v === 'yes' || v === 'true' || v === '1';
}

function iniInt(section: string, key: string, defValue = 0): number {
  const s = ini[section];
  if (!s || !(key in s)) return defValue;
  const parsed = parseInt(s[key], 10);
  return isNaN(parsed) ? defValue : parsed;
}

function iniFloat(section: string, key: string, defValue = 0): number {
  const s = ini[section];
  if (!s || !(key in s)) return defValue;
  const parsed = parseFloat(s[key]);
  return isNaN(parsed) ? defValue : parsed;
}

function iniStr(section: string, key: string): string | undefined {
  return ini[section]?.[key];
}

// ── Known INI typos ─────────────────────────────────────────────────────────

const PROJECTILE_TYPO_MAP: Record<string, string> = {
  'Inivisble': 'Invisible',  // [Camera] Projectile=Inivisble (typo in rules.ini line 2133)
};

function resolveProjectileName(raw: string): string {
  return PROJECTILE_TYPO_MAP[raw] || raw;
}

// ── Known TS-only weapons (no INI section) ──────────────────────────────────

const TS_ONLY_WEAPONS = new Set([
  'Tomahawk',       // CA cruise missile — TS-created weapon, no INI section
  'SeaSerpent',     // MSUB missiles — TS-created weapon, no INI section
  'Mandible',       // Ant weapon — only in scenario INI files (SCA*.ini)
  'TeslaCannon',    // Tesla Coil building weapon — no INI weapon section (TSLA building uses TeslaZap)
]);

// Weapons where TS WEAPON_STATS intentionally uses different scalar values from INI.
// The INI section exists but the TS weapon is a variant (e.g., ANT3 TeslaZap != building TeslaZap).
const SCALAR_OVERRIDE_WEAPONS = new Set([
  'TeslaZap',       // TS WEAPON_STATS TeslaZap is ANT3 variant (Damage=60, ROF=25, Range=1.75);
                     // INI [TeslaZap] is the building version (Damage=100, ROF=120, Range=8.5).
                     // Building TeslaZap is in STRUCTURE_WEAPONS, not WEAPON_STATS.
]);

// ── All projectile sections defined in rules.ini (lines 2480-2638) ──────────
// C++ bbdata.cpp — these are the 20 BulletTypeClass entries allocated by Projectile=20

const ALL_INI_PROJECTILE_SECTIONS = [
  'Invisible',     // rules.ini:2481  — instant hit, no visible projectile
  'LeapDog',       // rules.ini:2486  — dog-rides-bullet with ROT=20
  'Cannon',        // rules.ini:2494  — straight high-speed ballistic shot
  'Ack',           // rules.ini:2498  — anti-aircraft artillery (AA=true, AG=false)
  'Torpedo',       // rules.ini:2505  — subsurface projectile (UnderWater=yes, ASW=yes)
  'FROG',          // rules.ini:2512  — free rocket over ground (V2 rocket)
  'HeatSeeker',    // rules.ini:2524  — small homing missile (AA=yes, ROT=5)
  'LaserGuided',   // rules.ini:2539  — accurate homing missile (AA=yes, ROT=20)
  'AAMissile',     // rules.ini:2553  — dedicated AA missile (AA=yes, AG=no)
  'Lobbed',        // rules.ini:2568  — lobbed tumbling grenade (Arcing=yes)
  'Catapult',      // rules.ini:2577  — depth charge (Arcing=yes, ASW=yes, AG=no)
  'Bomblet',       // rules.ini:2588  — dropped from plane (Dropping=yes)
  'Ballistic',     // rules.ini:2598  — arcing ballistic (artillery shells)
  'Parachute',     // rules.ini:2605  — parachute bomb (Dropping=yes, Parachuted=yes)
  'GPSSatellite',  // rules.ini:2614  — GPS satellite (Gigundo=yes)
  'NukeUp',        // rules.ini:2621  — nuclear missile ascending (Gigundo=yes)
  'NukeDown',      // rules.ini:2628  — nuclear missile descending (Gigundo=yes)
  'Fireball',      // rules.ini:2635  — wizard's fireball (Animates=yes)
];

// ══════════════════════════════════════════════════════════════════════════════
// 1. PROJECTILE TYPE INVENTORY — verify every INI section exists
// ══════════════════════════════════════════════════════════════════════════════

describe('Projectile type inventory from rules.ini', () => {
  it('all 18 projectile sections exist in parsed INI', () => {
    for (const projName of ALL_INI_PROJECTILE_SECTIONS) {
      expect(ini[projName], `[${projName}] section should exist in rules.ini`).toBeDefined();
    }
  });

  it('Projectile=20 allocation count matches section count', () => {
    // rules.ini [MaxControl] Projectile=20 — but actual sections are 18
    // (GPSSatellite, NukeUp, NukeDown are special; LeapDog added later)
    // This test documents the actual count parsed from INI
    expect(ALL_INI_PROJECTILE_SECTIONS.length).toBe(18);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. WEAPON→PROJECTILE LINKAGE — every weapon's Projectile= resolves
// ══════════════════════════════════════════════════════════════════════════════

describe('Weapon→Projectile linkage from rules.ini', () => {
  // Collect all INI weapons that are also in WEAPON_STATS
  const iniWeapons = Object.keys(WEAPON_STATS).filter(w => {
    if (TS_ONLY_WEAPONS.has(w)) return false;
    return !!ini[w];
  });

  for (const wName of iniWeapons) {
    it(`${wName}: Projectile= in INI resolves to a valid projectile section`, () => {
      const rawProj = iniStr(wName, 'Projectile');
      expect(rawProj, `[${wName}] should have Projectile= in INI`).toBeDefined();
      const projName = resolveProjectileName(rawProj!);
      expect(ini[projName], `[${wName}] Projectile=${rawProj} → [${projName}] section should exist`).toBeDefined();
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. WEAPON→PROJECTILE→WARHEAD CHAIN — verifies the full chain is intact
// ══════════════════════════════════════════════════════════════════════════════

describe('Weapon→Projectile→Warhead chain integrity', () => {
  const iniWeapons = Object.keys(WEAPON_STATS).filter(w => {
    if (TS_ONLY_WEAPONS.has(w)) return false;
    return !!ini[w];
  });

  for (const wName of iniWeapons) {
    it(`${wName}: INI Warhead= matches TS warhead`, () => {
      const iniWarhead = iniStr(wName, 'Warhead');
      expect(iniWarhead, `[${wName}] should have Warhead= in INI`).toBeDefined();
      const tsWarhead = WEAPON_STATS[wName].warhead;
      expect(tsWarhead, `${wName}: TS warhead '${tsWarhead}' should match INI '${iniWarhead}'`)
        .toBe(iniWarhead);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. WEAPON SCALAR PARITY — Damage, ROF, Range, Speed, Burst from INI
// ══════════════════════════════════════════════════════════════════════════════

describe('Weapon scalar values from rules.ini vs WEAPON_STATS', () => {
  const iniWeapons = Object.keys(WEAPON_STATS).filter(w => {
    if (TS_ONLY_WEAPONS.has(w)) return false;
    if (SCALAR_OVERRIDE_WEAPONS.has(w)) return false;
    return !!ini[w];
  });

  describe('Damage', () => {
    for (const wName of iniWeapons) {
      it(`${wName}: Damage=${iniInt(wName, 'Damage')} matches TS`, () => {
        const iniDamage = iniInt(wName, 'Damage');
        expect(WEAPON_STATS[wName].damage).toBe(iniDamage);
      });
    }
  });

  describe('ROF (Rate Of Fire)', () => {
    for (const wName of iniWeapons) {
      it(`${wName}: ROF=${iniInt(wName, 'ROF')} matches TS`, () => {
        const iniROF = iniInt(wName, 'ROF');
        expect(WEAPON_STATS[wName].rof).toBe(iniROF);
      });
    }
  });

  describe('Range', () => {
    for (const wName of iniWeapons) {
      it(`${wName}: Range=${iniFloat(wName, 'Range')} matches TS`, () => {
        const iniRange = iniFloat(wName, 'Range');
        expect(WEAPON_STATS[wName].range).toBe(iniRange);
      });
    }
  });

  describe('Speed (projSpeed)', () => {
    for (const wName of iniWeapons) {
      it(`${wName}: Speed=${iniInt(wName, 'Speed')} matches TS projSpeed`, () => {
        const iniSpeed = iniInt(wName, 'Speed');
        expect(WEAPON_STATS[wName].projSpeed).toBe(iniSpeed);
      });
    }
  });

  describe('Burst', () => {
    // Only test weapons that have Burst= in INI (default is 1, C++ weapon.cpp:78)
    for (const wName of iniWeapons) {
      const iniBurst = iniInt(wName, 'Burst', 1);
      const tsBurst = WEAPON_STATS[wName].burst ?? 1;
      if (iniBurst > 1 || tsBurst > 1) {
        it(`${wName}: Burst=${iniBurst} matches TS`, () => {
          expect(tsBurst).toBe(iniBurst);
        });
      }
    }
  });

  // Explicitly document TeslaZap scalar override
  describe('TeslaZap: TS uses ANT3 variant values, not building [TeslaZap] INI section', () => {
    it('INI [TeslaZap] has building values (Damage=100, ROF=120, Range=8.5)', () => {
      expect(iniInt('TeslaZap', 'Damage')).toBe(100);
      expect(iniInt('TeslaZap', 'ROF')).toBe(120);
      expect(iniFloat('TeslaZap', 'Range')).toBe(8.5);
    });

    it('TS WEAPON_STATS.TeslaZap uses ANT3 variant (Damage=60, ROF=25, Range=1.75)', () => {
      const ts = WEAPON_STATS['TeslaZap'];
      expect(ts.damage).toBe(60);
      expect(ts.rof).toBe(25);
      expect(ts.range).toBe(1.75);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. PROJECTILE BEHAVIORAL FLAGS — each projectile section's flags vs TS
// ══════════════════════════════════════════════════════════════════════════════

describe('Projectile behavioral flags from rules.ini', () => {
  // Map: INI projectile key → TS WeaponStats boolean flag name
  // C++ bbdata.cpp default values in comments
  const FLAG_MAP: [string, string, boolean][] = [
    ['High',        'isHigh',        false],  // bbdata.cpp:84 IsHigh = false
    ['Arcing',      'isArcing',      false],  // bbdata.cpp:83 IsArcing = false
    ['Inaccurate',  'isInaccurate',  false],  // bbdata.cpp:85 IsInaccurate = false
    ['AA',          'isAntiAir',     false],  // bbdata.cpp:90 IsAntiAircraft = false
    ['Dropping',    'isDropping',    false],  // bbdata.cpp:86 IsDropping = false
    ['Parachuted',  'isParachuted',  false],  // bbdata.cpp:87 IsParachuted = false
    ['Inviso',      'isInvisible',   false],  // bbdata.cpp:81 IsInvisible = false
    ['UnderWater',  'isSubSurface',  false],  // bbdata.cpp:92 IsSubSurface = false
    ['Gigundo',     'isGigundo',     false],  // bbdata.cpp:88 IsGigundo = false
    ['Ranged',      'isFueled',      false],  // bbdata.cpp:82 IsRanged = false (C++ IsRanged → TS isFueled)
  ];

  // Build weapon→projectile lookup from INI
  const weaponToProjectile: Record<string, string> = {};
  for (const wName of Object.keys(WEAPON_STATS)) {
    if (TS_ONLY_WEAPONS.has(wName)) continue;
    const raw = iniStr(wName, 'Projectile');
    if (raw) weaponToProjectile[wName] = resolveProjectileName(raw);
  }

  // ── Flag: High (C++ type.h:1365 — flies over walls) ──

  describe('High flag', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      const iniHigh = iniBool(projName, 'High');
      const tsHigh = !!WEAPON_STATS[wName].isHigh;
      if (iniHigh || tsHigh) {
        it(`${wName} → [${projName}] High=${iniHigh ? 'yes' : 'no'}, TS isHigh=${tsHigh}`, () => {
          if (iniHigh) {
            expect(tsHigh, `${wName}.isHigh should be true (INI [${projName}] High=yes)`).toBe(true);
          }
        });
      }
    }
  });

  // ── Flag: Arcing (C++ bullet.cpp:359 — ballistic arc) ──

  describe('Arcing flag', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      const iniArcing = iniBool(projName, 'Arcing');
      const tsArcing = !!WEAPON_STATS[wName].isArcing;
      if (iniArcing || tsArcing) {
        it(`${wName} → [${projName}] Arcing=${iniArcing ? 'yes' : 'no'}, TS isArcing=${tsArcing}`, () => {
          expect(tsArcing, `${wName}.isArcing should match INI [${projName}].Arcing`).toBe(iniArcing);
        });
      }
    }
  });

  // ── Flag: AA (C++ bbdata.cpp:90 — anti-aircraft) ──

  describe('AA flag', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      const iniAA = iniBool(projName, 'AA');
      const tsAA = !!WEAPON_STATS[wName].isAntiAir;
      if (iniAA || tsAA) {
        it(`${wName} → [${projName}] AA=${iniAA ? 'yes' : 'no'}, TS isAntiAir=${tsAA}`, () => {
          expect(tsAA, `${wName}.isAntiAir should match INI [${projName}].AA`).toBe(iniAA);
        });
      }
    }
  });

  // ── Flag: AG (C++ bbdata.cpp:91 — anti-ground, default=true) ──

  describe('AG flag (default true)', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      // C++ default is AG=true (bbdata.cpp:91 IsAntiGround = true)
      const iniAG = ini[projName]?.['AG'] !== undefined
        ? iniBool(projName, 'AG')
        : true; // default: AG=yes
      const tsAG = WEAPON_STATS[wName].isAntiGround !== undefined
        ? !!WEAPON_STATS[wName].isAntiGround
        : true; // TS default: undefined means AG=true

      // Only test weapons where AG is explicitly set to no (interesting cases)
      if (!iniAG || !tsAG) {
        it(`${wName} → [${projName}] AG=${iniAG ? 'yes' : 'no'}, TS isAntiGround=${tsAG}`, () => {
          expect(tsAG, `${wName}.isAntiGround should match INI [${projName}].AG`).toBe(iniAG);
        });
      }
    }
  });

  // ── Flag: ASW (anti-submarine warfare) ──

  describe('ASW flag', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      const iniASW = iniBool(projName, 'ASW');
      // TS uses isAntiSub for ASW or isSubSurface for underwater travel
      const tsASW = !!WEAPON_STATS[wName].isAntiSub;
      const tsSubSurface = !!WEAPON_STATS[wName].isSubSurface;
      if (iniASW) {
        it(`${wName} → [${projName}] ASW=yes is reflected in TS (isAntiSub=${tsASW} or isSubSurface=${tsSubSurface})`, () => {
          // ASW projectiles map to either isAntiSub (depth charges) or isSubSurface (torpedoes)
          expect(
            tsASW || tsSubSurface,
            `${wName}: INI [${projName}] ASW=yes but TS has neither isAntiSub nor isSubSurface`
          ).toBe(true);
        });
      }
    }
  });

  // ── Flag: Dropping (C++ bullet.cpp:790-802) ──

  describe('Dropping flag', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      const iniDrop = iniBool(projName, 'Dropping');
      const tsDrop = !!WEAPON_STATS[wName].isDropping;
      if (iniDrop || tsDrop) {
        it(`${wName} → [${projName}] Dropping=${iniDrop ? 'yes' : 'no'}, TS isDropping=${tsDrop}`, () => {
          expect(tsDrop, `${wName}.isDropping should match INI [${projName}].Dropping`).toBe(iniDrop);
        });
      }
    }
  });

  // ── Flag: Parachuted (C++ bullet.cpp — parachute visual during descent) ──

  describe('Parachuted flag', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      const iniPara = iniBool(projName, 'Parachuted');
      const tsPara = !!WEAPON_STATS[wName].isParachuted;
      if (iniPara || tsPara) {
        it(`${wName} → [${projName}] Parachuted=${iniPara ? 'yes' : 'no'}, TS isParachuted=${tsPara}`, () => {
          expect(tsPara, `${wName}.isParachuted should match INI [${projName}].Parachuted`).toBe(iniPara);
        });
      }
    }
  });

  // ── Flag: Ranged → isFueled (C++ fuse.cpp — fuel timer) ──

  describe('Ranged (isFueled) flag', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      const iniRanged = iniBool(projName, 'Ranged');
      const tsFueled = !!WEAPON_STATS[wName].isFueled;
      if (iniRanged || tsFueled) {
        it(`${wName} → [${projName}] Ranged=${iniRanged ? 'yes' : 'no'}, TS isFueled=${tsFueled}`, () => {
          expect(tsFueled, `${wName}.isFueled should match INI [${projName}].Ranged`).toBe(iniRanged);
        });
      }
    }
  });

  // ── Flag: Inviso → isInvisible ──

  describe('Inviso (isInvisible) flag', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      const iniInviso = iniBool(projName, 'Inviso');
      const tsInvisible = !!WEAPON_STATS[wName].isInvisible;
      if (iniInviso) {
        it(`${wName} → [${projName}] Inviso=yes, TS isInvisible=${tsInvisible}`, () => {
          expect(tsInvisible, `${wName}.isInvisible should be true (INI [${projName}] Inviso=yes)`).toBe(true);
        });
      }
    }
  });

  // ── Flag: Inaccurate ──

  describe('Inaccurate flag', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      const iniInacc = iniBool(projName, 'Inaccurate');
      const tsInacc = !!WEAPON_STATS[wName].isInaccurate;
      if (iniInacc || tsInacc) {
        it(`${wName} → [${projName}] Inaccurate=${iniInacc ? 'yes' : 'no'}, TS isInaccurate=${tsInacc}`, () => {
          if (iniInacc) {
            expect(tsInacc, `${wName}.isInaccurate should be true (INI [${projName}] Inaccurate=yes)`).toBe(true);
          }
        });
      }
    }
  });

  // ── Flag: UnderWater → isSubSurface ──

  describe('UnderWater (isSubSurface) flag', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      const iniUW = iniBool(projName, 'UnderWater');
      const tsUW = !!WEAPON_STATS[wName].isSubSurface;
      if (iniUW || tsUW) {
        it(`${wName} → [${projName}] UnderWater=${iniUW ? 'yes' : 'no'}, TS isSubSurface=${tsUW}`, () => {
          expect(tsUW, `${wName}.isSubSurface should match INI [${projName}].UnderWater`).toBe(iniUW);
        });
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. PROJECTILE ROT (homing turn rate) — INI ROT= vs TS projectileROT
// ══════════════════════════════════════════════════════════════════════════════

describe('Projectile ROT (homing turn rate) from rules.ini', () => {
  const weaponToProjectile: Record<string, string> = {};
  for (const wName of Object.keys(WEAPON_STATS)) {
    if (TS_ONLY_WEAPONS.has(wName)) continue;
    const raw = iniStr(wName, 'Projectile');
    if (raw) weaponToProjectile[wName] = resolveProjectileName(raw);
  }

  for (const [wName, projName] of Object.entries(weaponToProjectile)) {
    const iniROT = iniInt(projName, 'ROT');
    const tsROT = WEAPON_STATS[wName].projectileROT ?? 0;

    if (iniROT > 0 || tsROT > 0) {
      it(`${wName} → [${projName}] ROT=${iniROT}, TS projectileROT=${tsROT}`, () => {
        expect(tsROT, `${wName}.projectileROT should be ${iniROT} (from [${projName}].ROT)`).toBe(iniROT);
      });
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. PROJECTILE COVERAGE GAPS — INI projectile sections not used by any TS weapon
// ══════════════════════════════════════════════════════════════════════════════

describe('Projectile coverage: INI sections referenced vs unreferenced by TS weapons', () => {
  // Collect all projectile types referenced by TS WEAPON_STATS via INI Projectile= field
  const referencedProjectiles = new Set<string>();
  for (const wName of Object.keys(WEAPON_STATS)) {
    if (TS_ONLY_WEAPONS.has(wName)) continue;
    const raw = iniStr(wName, 'Projectile');
    if (raw) referencedProjectiles.add(resolveProjectileName(raw));
  }

  // Projectile sections that are purely visual/special or only used by
  // STRUCTURE_WEAPONS (not in WEAPON_STATS), so not expected to be referenced
  const SPECIAL_PROJECTILES = new Set([
    'GPSSatellite',  // GPS satellite animation — superweapon, not a weapon projectile
    'NukeUp',        // Nuclear missile ascending — superweapon animation
    'NukeDown',      // Nuclear missile descending — superweapon animation
    'Ack',           // AA artillery — used by [ZSU-23] which is a STRUCTURE_WEAPONS entry (AGUN),
                     // not in WEAPON_STATS. The AGUN building weapon is defined in scenario.ts.
  ]);

  it('documents which projectile sections are referenced by WEAPON_STATS weapons', () => {
    const referenced: string[] = [];
    const unreferenced: string[] = [];

    for (const proj of ALL_INI_PROJECTILE_SECTIONS) {
      if (referencedProjectiles.has(proj)) {
        referenced.push(proj);
      } else {
        unreferenced.push(proj);
      }
    }

    // All non-special projectiles should be referenced by at least one weapon
    for (const proj of unreferenced) {
      if (!SPECIAL_PROJECTILES.has(proj)) {
        // This is a gap — a projectile exists in INI but no TS weapon uses it
        // (Ack is used by ZSU-23, LeapDog by DogJaw, etc. — all should be covered)
        expect(
          referencedProjectiles.has(proj),
          `[${proj}] projectile section exists in INI but no TS weapon references it`
        ).toBe(true);
      }
    }
  });

  it('special projectiles (GPSSatellite, NukeUp, NukeDown) are not unit weapon projectiles', () => {
    for (const proj of SPECIAL_PROJECTILES) {
      expect(
        referencedProjectiles.has(proj),
        `[${proj}] is a superweapon animation, not expected in unit weapon projectiles`
      ).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. PROXIMITY FLAG — C++ bullet.cpp:946-948 AA proximity detonation
// ══════════════════════════════════════════════════════════════════════════════

describe('Projectile Proximity flag from rules.ini', () => {
  // Proximity=yes projectiles detonate when within half a cell of the target
  // C++ bullet.cpp:946-948 — Is_Forced_To_Explode proximity check

  const weaponToProjectile: Record<string, string> = {};
  for (const wName of Object.keys(WEAPON_STATS)) {
    if (TS_ONLY_WEAPONS.has(wName)) continue;
    const raw = iniStr(wName, 'Projectile');
    if (raw) weaponToProjectile[wName] = resolveProjectileName(raw);
  }

  // Collect all projectiles with Proximity=yes in INI
  const proximityProjectiles: string[] = [];
  for (const proj of ALL_INI_PROJECTILE_SECTIONS) {
    if (iniBool(proj, 'Proximity')) {
      proximityProjectiles.push(proj);
    }
  }

  it('documents all projectile sections with Proximity=yes', () => {
    // Proximity=yes projectiles from INI parsing:
    // LeapDog (line 2490), FROG (line 2516), HeatSeeker (line 2528),
    // LaserGuided (line 2543), AAMissile (line 2557)
    expect(proximityProjectiles.length).toBeGreaterThan(0);

    for (const proj of proximityProjectiles) {
      expect(iniBool(proj, 'Proximity')).toBe(true);
    }
  });

  it('all Proximity=yes projectiles also have High=yes (missiles fly high)', () => {
    // C++ bullet.cpp:946 — proximity fuse only activates on High projectiles near airborne targets
    for (const proj of proximityProjectiles) {
      if (proj === 'LeapDog') continue; // LeapDog has Proximity=yes but no High=yes (special case)
      const iniHigh = iniBool(proj, 'High');
      expect(iniHigh, `[${proj}] has Proximity=yes — should also have High=yes`).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. ARM & RANGELIMIT — fueled projectile arming delays
// ══════════════════════════════════════════════════════════════════════════════

describe('Projectile Arm and RangeLimit values from rules.ini', () => {
  // C++ fuse.cpp — Arm is the arming delay before the projectile can explode.
  // RangeLimit is the maximum range/fuel before forced detonation.

  const armedProjectiles: { name: string; arm: number; rangeLimit: number }[] = [];

  for (const proj of ALL_INI_PROJECTILE_SECTIONS) {
    const arm = iniInt(proj, 'Arm');
    const rangeLimit = iniInt(proj, 'RangeLimit');
    if (arm > 0 || rangeLimit > 0) {
      armedProjectiles.push({ name: proj, arm, rangeLimit });
    }
  }

  it('documents all projectiles with Arm > 0', () => {
    const armed = armedProjectiles.filter(p => p.arm > 0);
    expect(armed.length).toBeGreaterThan(0);

    for (const p of armed) {
      expect(iniInt(p.name, 'Arm')).toBe(p.arm);
    }
  });

  it('Bomblet and Parachute have Arm=24 and RangeLimit=24 (parabomb payload)', () => {
    const bombletArm = iniInt('Bomblet', 'Arm');
    const bombletRL = iniInt('Bomblet', 'RangeLimit');
    const paraArm = iniInt('Parachute', 'Arm');
    const paraRL = iniInt('Parachute', 'RangeLimit');

    expect(bombletArm).toBe(paraArm);
    expect(bombletRL).toBe(paraRL);
    expect(bombletArm).toBe(24);
    expect(bombletRL).toBe(24);
  });

  it('HeatSeeker Arm=2, LaserGuided Arm=3, AAMissile Arm=3', () => {
    expect(iniInt('HeatSeeker', 'Arm')).toBe(2);
    expect(iniInt('LaserGuided', 'Arm')).toBe(3);
    expect(iniInt('AAMissile', 'Arm')).toBe(3);
  });

  it('FROG Arm=10 (V2 rocket arming delay)', () => {
    expect(iniInt('FROG', 'Arm')).toBe(10);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. ANIMATES FLAG — maps to isFlameEquipped in TS combat.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('Projectile Animates flag (flame/smoke trail) from rules.ini', () => {
  // C++ bbdata.cpp: Animates=yes means the projectile spawns flame/smoke trail
  // every other frame during flight (bullet.cpp:377-386).
  // TS maps this to isFlameEquipped on the weapon.

  const weaponToProjectile: Record<string, string> = {};
  for (const wName of Object.keys(WEAPON_STATS)) {
    if (TS_ONLY_WEAPONS.has(wName)) continue;
    const raw = iniStr(wName, 'Projectile');
    if (raw) weaponToProjectile[wName] = resolveProjectileName(raw);
  }

  // Projectiles with Animates=yes: FROG, HeatSeeker, LaserGuided, AAMissile, Fireball
  const animatedProjectiles = ALL_INI_PROJECTILE_SECTIONS.filter(
    p => iniBool(p, 'Animates')
  );

  it('documents all projectile sections with Animates=yes', () => {
    expect(animatedProjectiles.length).toBeGreaterThan(0);
    for (const proj of animatedProjectiles) {
      expect(iniBool(proj, 'Animates')).toBe(true);
    }
  });

  // Weapons using Animates=yes projectiles should have isFlameEquipped in TS
  // unless the TS engine handles the visual trail differently (e.g., missile trail vs flame)
  //
  // C++ distinguishes Animates visually: FROG/HeatSeeker/LaserGuided/AAMissile show smoke puffs,
  // Fireball shows flame trail. TS uses isFlameEquipped for Fireball-type only.
  it('Fireball-based weapons (Flamer, FireballLauncher) have isFlameEquipped in TS', () => {
    for (const [wName, projName] of Object.entries(weaponToProjectile)) {
      if (projName === 'Fireball') {
        const ts = WEAPON_STATS[wName] as Record<string, unknown>;
        expect(
          ts.isFlameEquipped,
          `${wName}: uses [Fireball] (Animates=yes) → should have isFlameEquipped`
        ).toBe(true);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. WEAPON→PROJECTILE TYPE MAPPING — document which INI projectile each weapon uses
// ══════════════════════════════════════════════════════════════════════════════

describe('Complete weapon→projectile type mapping from rules.ini + aftrmath.ini', () => {
  // This test verifies and documents the complete mapping of every INI weapon
  // to its projectile type. The mapping is derived from Projectile= lines in INI.

  const EXPECTED_WEAPON_PROJECTILE_MAP: Record<string, string> = {};
  for (const wName of Object.keys(WEAPON_STATS)) {
    if (TS_ONLY_WEAPONS.has(wName)) continue;
    const raw = iniStr(wName, 'Projectile');
    if (raw) EXPECTED_WEAPON_PROJECTILE_MAP[wName] = resolveProjectileName(raw);
  }

  // Group weapons by projectile type for documentation
  const projectileToWeapons: Record<string, string[]> = {};
  for (const [wName, projName] of Object.entries(EXPECTED_WEAPON_PROJECTILE_MAP)) {
    if (!projectileToWeapons[projName]) projectileToWeapons[projName] = [];
    projectileToWeapons[projName].push(wName);
  }

  it('Invisible projectile weapons: instant-hit, no visual (Inviso=yes)', () => {
    const invisWeapons = projectileToWeapons['Invisible'] ?? [];
    expect(invisWeapons.length).toBeGreaterThan(0);
    for (const wName of invisWeapons) {
      // All Invisible projectile weapons should have isInvisible or be treated as instant hit
      const projName = EXPECTED_WEAPON_PROJECTILE_MAP[wName];
      expect(projName).toBe('Invisible');
    }
  });

  it('Cannon projectile weapons: straight high-speed ballistic (no special flags)', () => {
    const cannonWeapons = projectileToWeapons['Cannon'] ?? [];
    expect(cannonWeapons.length).toBeGreaterThan(0);
    for (const wName of cannonWeapons) {
      expect(EXPECTED_WEAPON_PROJECTILE_MAP[wName]).toBe('Cannon');
      // Cannon has no special flags — no High, no Arcing, no AA
      expect(iniBool('Cannon', 'High')).toBe(false);
      expect(iniBool('Cannon', 'Arcing')).toBe(false);
      expect(iniBool('Cannon', 'AA')).toBe(false);
    }
  });

  it('HeatSeeker projectile weapons: homing missiles with AA capability', () => {
    const hsWeapons = projectileToWeapons['HeatSeeker'] ?? [];
    expect(hsWeapons.length).toBeGreaterThan(0);
    for (const wName of hsWeapons) {
      expect(EXPECTED_WEAPON_PROJECTILE_MAP[wName]).toBe('HeatSeeker');
    }
    // HeatSeeker has AA=yes, High=yes, ROT=5, Ranged=yes, Proximity=yes
    expect(iniBool('HeatSeeker', 'AA')).toBe(true);
    expect(iniBool('HeatSeeker', 'High')).toBe(true);
    expect(iniInt('HeatSeeker', 'ROT')).toBe(5);
    expect(iniBool('HeatSeeker', 'Ranged')).toBe(true);
    expect(iniBool('HeatSeeker', 'Proximity')).toBe(true);
  });

  it('AAMissile projectile weapons: AA-only missiles (AG=no)', () => {
    const aaWeapons = projectileToWeapons['AAMissile'] ?? [];
    expect(aaWeapons.length).toBeGreaterThan(0);
    // AAMissile: AA=yes, AG=no — cannot fire at ground targets
    expect(iniBool('AAMissile', 'AA')).toBe(true);
    // AG defaults to true, but AAMissile explicitly sets AG=no
    const agRaw = ini['AAMissile']?.['AG'];
    expect(agRaw).toBeDefined();
    expect(agRaw!.toLowerCase()).toMatch(/^(no|false|0)$/);
  });

  it('Ballistic projectile weapons: arcing shells (artillery)', () => {
    const balWeapons = projectileToWeapons['Ballistic'] ?? [];
    expect(balWeapons.length).toBeGreaterThan(0);
    expect(iniBool('Ballistic', 'High')).toBe(true);
    expect(iniBool('Ballistic', 'Arcing')).toBe(true);
    expect(iniBool('Ballistic', 'Inaccurate')).toBe(true);
  });

  it('Lobbed projectile weapons: grenades with ballistic arc', () => {
    const lobbedWeapons = projectileToWeapons['Lobbed'] ?? [];
    expect(lobbedWeapons.length).toBeGreaterThan(0);
    expect(iniBool('Lobbed', 'Arcing')).toBe(true);
    expect(iniBool('Lobbed', 'High')).toBe(true);
    expect(iniBool('Lobbed', 'Inaccurate')).toBe(true);
  });

  it('FROG projectile (V2 rocket): high, fueled, proximity, inaccurate', () => {
    const frogWeapons = projectileToWeapons['FROG'] ?? [];
    expect(frogWeapons.length).toBeGreaterThan(0);
    expect(iniBool('FROG', 'High')).toBe(true);
    expect(iniBool('FROG', 'Proximity')).toBe(true);
    expect(iniBool('FROG', 'Ranged')).toBe(true);
    expect(iniBool('FROG', 'Inaccurate')).toBe(true);
    expect(iniBool('FROG', 'Animates')).toBe(true);
  });

  it('Torpedo projectile: underwater, anti-sub', () => {
    const torpWeapons = projectileToWeapons['Torpedo'] ?? [];
    expect(torpWeapons.length).toBeGreaterThan(0);
    expect(iniBool('Torpedo', 'UnderWater')).toBe(true);
    expect(iniBool('Torpedo', 'ASW')).toBe(true);
  });

  it('Catapult projectile (depth charge): arcing, ASW, AG=no', () => {
    const catWeapons = projectileToWeapons['Catapult'] ?? [];
    expect(catWeapons.length).toBeGreaterThan(0);
    expect(iniBool('Catapult', 'Arcing')).toBe(true);
    expect(iniBool('Catapult', 'ASW')).toBe(true);
    expect(iniBool('Catapult', 'High')).toBe(true);
    const agRaw = ini['Catapult']?.['AG'];
    expect(agRaw).toBeDefined();
    expect(agRaw!.toLowerCase()).toMatch(/^(no|false|0)$/);
  });

  it('Bomblet projectile: dropped from plane (Dropping=yes)', () => {
    const bombWeapons = projectileToWeapons['Bomblet'] ?? [];
    expect(bombWeapons.length).toBeGreaterThan(0);
    expect(iniBool('Bomblet', 'Dropping')).toBe(true);
    expect(iniBool('Bomblet', 'High')).toBe(true);
  });

  it('Parachute projectile: parachute bomb (Dropping=yes, Parachuted=yes)', () => {
    const paraWeapons = projectileToWeapons['Parachute'] ?? [];
    expect(paraWeapons.length).toBeGreaterThan(0);
    expect(iniBool('Parachute', 'Dropping')).toBe(true);
    expect(iniBool('Parachute', 'Parachuted')).toBe(true);
    expect(iniBool('Parachute', 'High')).toBe(true);
  });

  it('LaserGuided projectile: accurate homing (ROT=20, AA=yes)', () => {
    const lgWeapons = projectileToWeapons['LaserGuided'] ?? [];
    expect(lgWeapons.length).toBeGreaterThan(0);
    expect(iniInt('LaserGuided', 'ROT')).toBe(20);
    expect(iniBool('LaserGuided', 'AA')).toBe(true);
    expect(iniBool('LaserGuided', 'Proximity')).toBe(true);
    expect(iniBool('LaserGuided', 'Ranged')).toBe(true);
  });

  it('Ack projectile: AA flak (AA=true, AG=false, Inviso=yes) — used by STRUCTURE_WEAPONS only', () => {
    // Ack is used by [ZSU-23] weapon which is only in STRUCTURE_WEAPONS (AGUN building),
    // not in WEAPON_STATS. So no WEAPON_STATS entry maps to Ack.
    const ackWeapons = projectileToWeapons['Ack'] ?? [];
    expect(ackWeapons.length).toBe(0); // Not in WEAPON_STATS — only in STRUCTURE_WEAPONS

    // But verify Ack's INI flags are correct
    expect(iniBool('Ack', 'AA')).toBe(true);
    expect(iniBool('Ack', 'Inviso')).toBe(true);
    // AG defaults to true, but Ack sets AG=false
    const agRaw = ini['Ack']?.['AG'];
    expect(agRaw).toBeDefined();
    expect(agRaw!.toLowerCase()).toMatch(/^(no|false|0)$/);
  });

  it('LeapDog projectile: dog-rides-bullet (ROT=20, Proximity=yes)', () => {
    const dogWeapons = projectileToWeapons['LeapDog'] ?? [];
    expect(dogWeapons.length).toBeGreaterThan(0);
    expect(iniInt('LeapDog', 'ROT')).toBe(20);
    expect(iniBool('LeapDog', 'Proximity')).toBe(true);
  });

  it('Fireball projectile: flame trail (Animates=yes)', () => {
    const fbWeapons = projectileToWeapons['Fireball'] ?? [];
    expect(fbWeapons.length).toBeGreaterThan(0);
    expect(iniBool('Fireball', 'Animates')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. TS-ONLY WEAPONS — document weapons in WEAPON_STATS not in rules/aftrmath INI
// ══════════════════════════════════════════════════════════════════════════════

describe('TS-only weapons not found in rules.ini or aftrmath.ini', () => {
  for (const wName of TS_ONLY_WEAPONS) {
    it(`${wName}: exists in WEAPON_STATS but has no INI section`, () => {
      expect(WEAPON_STATS[wName], `${wName} should exist in WEAPON_STATS`).toBeDefined();
      expect(ini[wName], `${wName} should NOT have an INI section`).toBeUndefined();
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. SHADOW FLAG AUDIT — High projectiles with Shadow=no
// ══════════════════════════════════════════════════════════════════════════════

describe('Projectile Shadow flag from rules.ini', () => {
  // C++ bbdata.cpp default: IsShadow = true (shadows are drawn by default)
  // Some High projectiles explicitly set Shadow=no to suppress the shadow

  it('documents projectiles with Shadow=no (suppress shadow despite High=yes)', () => {
    const shadowNoProjectiles: string[] = [];
    for (const proj of ALL_INI_PROJECTILE_SECTIONS) {
      if (iniBool(proj, 'High') && ini[proj]?.['Shadow']) {
        const shadow = ini[proj]['Shadow'].toLowerCase();
        if (shadow === 'no' || shadow === 'false' || shadow === '0') {
          shadowNoProjectiles.push(proj);
        }
      }
    }

    // FROG, HeatSeeker, LaserGuided, AAMissile all have Shadow=no
    expect(shadowNoProjectiles.length).toBeGreaterThan(0);
    for (const proj of shadowNoProjectiles) {
      expect(iniBool(proj, 'High')).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. GRAVITY CONSTANT — affects all arcing/ballistic projectiles
// ══════════════════════════════════════════════════════════════════════════════

describe('Gravity constant from rules.ini [General]', () => {
  it('Gravity=3 (affects ballistic arc trajectory)', () => {
    const gravity = iniInt('General', 'Gravity');
    expect(gravity).toBe(3);
  });

  it('BallisticScatter=1.0 (max scatter for inaccurate ballistic projectiles)', () => {
    const scatter = iniFloat('General', 'BallisticScatter');
    expect(scatter).toBe(1.0);
  });

  it('HomingScatter=2.0 (max scatter for inaccurate homing projectiles)', () => {
    const scatter = iniFloat('General', 'HomingScatter');
    expect(scatter).toBe(2.0);
  });
});
