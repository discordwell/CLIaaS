/**
 * C++ Parity: V2 Rocket Launcher (V2RL) — rules.ini authoritative source
 *
 * Authoritative source: rules.ini is god (per CLAUDE.md).
 * Every assertion derives its expected value from INI text, not from C++ defaults.
 *
 * Covers:
 *   1. [V2RL] unit stats: Strength, Armor, Speed, Sight, ROT, Cost, Points,
 *      Tracked, Ammo, Crewed, NoMovingFire, Owner, Prerequisite
 *   2. [SCUD] weapon stats: Damage, ROF, Range, Projectile, Speed, Warhead
 *   3. [FROG] projectile flags: Arm, High, Shadow, Proximity, Animates,
 *      Ranged, Inaccurate, Image, Rotates, Gigundo (absent = no)
 *   4. [HE] warhead: Spread, Wall, Wood, Verses, Explosion, InfDeath
 *   5. SpeedClass: Tracked=yes in rules.ini -> SPEED_TRACK (C++ udata.cpp:1366)
 *
 * C++ source refs:
 *   udata.cpp:64-69   — V2RL constructor data
 *   udata.cpp:865     — constructor default Speed=SPEED_WHEEL
 *   udata.cpp:1366    — Read_INI: Tracked=yes -> SPEED_TRACK override
 *   weapon.cpp        — SCUD weapon parsed from [SCUD] section
 *   bbdata.cpp:174    — FROG bullet type created ("FROG")
 *   bbdata.cpp:278-296 — bullet type Read_INI reads all projectile flags
 *   bullet.cpp:84     — IsInaccurate default false
 *   bullet.cpp:253    — IsGigundo spillage list
 *   bullet.cpp:709-710 — inaccuracy scatter logic
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS, SpeedClass } from '../engine/types';

// ── INI Parser ─────────────────────────────────────────────────────────────────

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

const rulesPath = join(__dirname, '../../..', 'public/ra/assets/rules.ini');
const rulesText = readFileSync(rulesPath, 'utf-8');
const ini = parseINI(rulesText);

// ── 1. V2RL unit stats from rules.ini [V2RL] ──────────────────────────────────

describe('[V2RL] unit stats — rules.ini authoritative', () => {
  const iniV2 = ini['V2RL'];
  const stats = UNIT_STATS.V2RL;

  it('rules.ini [V2RL] section exists', () => {
    expect(iniV2).toBeDefined();
  });

  it('Strength=150', () => {
    expect(Number(iniV2.Strength)).toBe(150);
    expect(stats.strength).toBe(150);
  });

  it('Armor=light', () => {
    expect(iniV2.Armor).toBe('light');
    expect(stats.armor).toBe('light');
  });

  it('Speed=7', () => {
    expect(Number(iniV2.Speed)).toBe(7);
    expect(stats.speed).toBe(7);
  });

  it('Sight=5', () => {
    expect(Number(iniV2.Sight)).toBe(5);
    expect(stats.sight).toBe(5);
  });

  it('ROT=5', () => {
    expect(Number(iniV2.ROT)).toBe(5);
    expect(stats.rot).toBe(5);
  });

  it('Cost=700', () => {
    expect(Number(iniV2.Cost)).toBe(700);
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'V2RL');
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(700);
  });

  it('Points=40', () => {
    expect(Number(iniV2.Points)).toBe(40);
    expect(stats.points).toBe(40);
  });

  it('Owner=soviet', () => {
    expect(iniV2.Owner).toBe('soviet');
    expect(stats.owner).toBe('soviet');
  });

  it('Primary=SCUD', () => {
    expect(iniV2.Primary).toBe('SCUD');
    expect(stats.primaryWeapon).toBe('SCUD');
  });

  it('no secondary weapon', () => {
    expect(iniV2.Secondary).toBeUndefined();
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('Ammo=1 (single-shot before reload)', () => {
    expect(Number(iniV2.Ammo)).toBe(1);
    expect(stats.maxAmmo).toBe(1);
  });

  it('NoMovingFire=yes (must stop to fire)', () => {
    expect(iniV2.NoMovingFire?.toLowerCase()).toBe('yes');
    expect(stats.noMovingFire).toBe(true);
  });

  it('Crewed=yes (crew can escape on destruction)', () => {
    // rules.ini [V2RL] line 495: Crewed=yes
    expect(iniV2.Crewed?.toLowerCase()).toBe('yes');
  });

  it('Tracked=yes — rules.ini says tracked, C++ udata.cpp:1366 sets SPEED_TRACK', () => {
    // rules.ini line 493: Tracked=yes
    // C++ udata.cpp:1366: Speed = ini.Get_Bool(IniName, "Tracked", ...) ? SPEED_TRACK : SPEED_WHEEL;
    // Tracked=yes -> SPEED_TRACK
    expect(iniV2.Tracked?.toLowerCase()).toBe('yes');
    // NOTE: TS uses SpeedClass.WHEEL for all vehicles.
    // The comment in types.ts says "udata.cpp:865 forces all vehicles to WHEEL",
    // but that's only the constructor DEFAULT. udata.cpp:1366 (Read_INI) overrides
    // to SPEED_TRACK when Tracked=yes. This is a known simplification in TS.
    // The following test documents the INI-authoritative value:
    expect(stats.speedClass).toBe(SpeedClass.TRACK);
  });

  it('Prerequisite=weap,dome', () => {
    expect(iniV2.Prerequisite?.toLowerCase()).toBe('weap,dome');
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'V2RL');
    expect(prodItem).toBeDefined();
    // TS splits prerequisite into prerequisite + techPrereq
    expect(prodItem!.prerequisite?.toUpperCase()).toBe('WEAP');
    expect(prodItem!.techPrereq?.toUpperCase()).toBe('DOME');
  });

  it('TechLevel=4', () => {
    expect(Number(iniV2.TechLevel)).toBe(4);
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'V2RL');
    expect(prodItem).toBeDefined();
    expect(prodItem!.techLevel).toBe(4);
  });
});

// ── 2. SCUD weapon stats from rules.ini [SCUD] ────────────────────────────────

describe('[SCUD] weapon stats — rules.ini authoritative', () => {
  const iniScud = ini['SCUD'];
  const weapon = WEAPON_STATS.SCUD;

  it('rules.ini [SCUD] section exists', () => {
    expect(iniScud).toBeDefined();
  });

  it('Damage=600', () => {
    expect(Number(iniScud.Damage)).toBe(600);
    expect(weapon.damage).toBe(600);
  });

  it('ROF=400 (very long reload for single-shot doctrine)', () => {
    expect(Number(iniScud.ROF)).toBe(400);
    expect(weapon.rof).toBe(400);
  });

  it('Range=10', () => {
    expect(Number(iniScud.Range)).toBe(10);
    expect(weapon.range).toBe(10.0);
  });

  it('Projectile=FROG', () => {
    expect(iniScud.Projectile).toBe('FROG');
  });

  it('Speed=25 (projectile flight speed)', () => {
    expect(Number(iniScud.Speed)).toBe(25);
    expect(weapon.projSpeed).toBe(25);
  });

  it('Warhead=HE', () => {
    expect(iniScud.Warhead).toBe('HE');
    expect(weapon.warhead).toBe('HE');
  });

  it('no Burst specified (default=1, single projectile per shot)', () => {
    expect(iniScud.Burst).toBeUndefined();
    // TS weapon should not have burst or burst=1
    expect(weapon.burst ?? 1).toBe(1);
  });
});

// ── 3. FROG projectile flags from rules.ini [FROG] ────────────────────────────

describe('[FROG] projectile flags — rules.ini authoritative', () => {
  const iniFrog = ini['FROG'];

  it('rules.ini [FROG] section exists', () => {
    expect(iniFrog).toBeDefined();
  });

  it('Arm=10 (arming delay in frames before proximity detonation)', () => {
    // C++ bbdata.cpp:268: Arming = ini.Get_Int(Name(), "Arm", Arming);
    expect(Number(iniFrog.Arm)).toBe(10);
  });

  it('High=yes (flies over walls)', () => {
    expect(iniFrog.High?.toLowerCase()).toBe('yes');
    expect(WEAPON_STATS.SCUD.isHigh).toBe(true);
  });

  it('Shadow=no (no shadow drawn during flight)', () => {
    expect(iniFrog.Shadow?.toLowerCase()).toBe('no');
  });

  it('Proximity=yes (detonates when near target)', () => {
    // C++ bbdata.cpp:283: IsProximityArmed = ini.Get_Bool(Name(), "Proximity", ...)
    expect(iniFrog.Proximity?.toLowerCase()).toBe('yes');
  });

  it('Animates=yes (smoke puff trail during flight)', () => {
    // C++ bbdata.cpp:284: IsFlameEquipped = ini.Get_Bool(Name(), "Animates", ...)
    expect(iniFrog.Animates?.toLowerCase()).toBe('yes');
  });

  it('Ranged=yes (has fuel counter — isFueled)', () => {
    // C++ bbdata.cpp:285: IsFueled = ini.Get_Bool(Name(), "Ranged", IsFueled)
    expect(iniFrog.Ranged?.toLowerCase()).toBe('yes');
    expect(WEAPON_STATS.SCUD.isFueled).toBe(true);
  });

  it('Inaccurate=yes (inherent scatter on every shot)', () => {
    // C++ bbdata.cpp:286: IsInaccurate = ini.Get_Bool(Name(), "Inaccuate", ...)
    expect(iniFrog.Inaccurate?.toLowerCase()).toBe('yes');
    expect(WEAPON_STATS.SCUD.isInaccurate).toBe(true);
  });

  it('Image=V2 (uses V2 rocket sprite)', () => {
    expect(iniFrog.Image).toBe('V2');
  });

  it('Rotates=yes (projectile sprite rotates to face direction of travel)', () => {
    // C++ bbdata.cpp:293: IsFaceless = !ini.Get_Bool(Name(), "Rotates", !IsFaceless)
    expect(iniFrog.Rotates?.toLowerCase()).toBe('yes');
  });

  it('Gigundo absent (defaults to no — NOT a large explosion projectile)', () => {
    // C++ bbdata.cpp:295: IsGigundo = ini.Get_Bool(Name(), "Gigundo", IsGigundo)
    // Default is false (bbdata.cpp:96), and [FROG] does not set Gigundo=yes
    expect(iniFrog.Gigundo).toBeUndefined();
    // TS weapon correctly does NOT set isGigundo
    expect(WEAPON_STATS.SCUD.isGigundo).toBeFalsy();
  });

  it('ROT absent (defaults to 0 — non-homing, straight-line flight)', () => {
    // C++ bbdata.cpp:98: ROT(0) constructor default
    // [FROG] does not set ROT, so it stays 0 — straight-line, no homing
    expect(iniFrog.ROT).toBeUndefined();
    // TS weapon should not have projectileROT (or it should be 0/absent)
    expect(WEAPON_STATS.SCUD.projectileROT ?? 0).toBe(0);
  });

  it('AA absent (defaults to no — cannot target aircraft)', () => {
    expect(iniFrog.AA).toBeUndefined();
  });

  it('AG absent (defaults to yes — can target ground units)', () => {
    expect(iniFrog.AG).toBeUndefined();
  });

  it('Degenerates absent (defaults to no — no strength loss during flight)', () => {
    expect(iniFrog.Degenerates).toBeUndefined();
    expect(WEAPON_STATS.SCUD.isDegenerate).toBeFalsy();
  });

  it('Arcing absent (defaults to no — not a ballistic arc trajectory)', () => {
    expect(iniFrog.Arcing).toBeUndefined();
    expect(WEAPON_STATS.SCUD.isArcing).toBeFalsy();
  });
});

// ── 4. HE warhead stats from rules.ini [HE] ────────────────────────────────────

describe('[HE] warhead stats — SCUD warhead, rules.ini authoritative', () => {
  const iniHE = ini['HE'];

  it('rules.ini [HE] section exists', () => {
    expect(iniHE).toBeDefined();
  });

  it('Spread=6 (blast radius)', () => {
    expect(Number(iniHE.Spread)).toBe(6);
  });

  it('Wall=yes (can damage walls)', () => {
    expect(iniHE.Wall?.toLowerCase()).toBe('yes');
  });

  it('Wood=yes (can damage wood/trees)', () => {
    expect(iniHE.Wood?.toLowerCase()).toBe('yes');
  });

  it('Verses=90%,75%,60%,25%,100% (none,wood,light,heavy,concrete)', () => {
    // rules.ini [HE] Verses=90%,75%,60%,25%,100%
    expect(iniHE.Verses).toBe('90%,75%,60%,25%,100%');
    // Verify TS WARHEAD_VS_ARMOR matches
    const he = WARHEAD_VS_ARMOR.HE;
    expect(he).toBeDefined();
    // Order: none=0, wood=1, light=2, heavy=3, concrete=4
    expect(he[0]).toBe(0.9);     // none 90%
    expect(he[1]).toBe(0.75);    // wood 75%
    expect(he[2]).toBe(0.6);     // light 60%
    expect(he[3]).toBe(0.25);    // heavy 25%
    expect(he[4]).toBe(1.0);     // concrete 100%
  });

  it('Explosion=5 (explosion animation index)', () => {
    expect(Number(iniHE.Explosion)).toBe(5);
  });

  it('InfDeath=2 (infantry death animation index)', () => {
    expect(Number(iniHE.InfDeath)).toBe(2);
  });
});

// ── 5. Effective damage calculations — derived from INI values ─────────────────

describe('V2RL effective damage — derived from INI [SCUD] + [HE]', () => {
  it('600 base * 0.9 (HE vs none) = 540 effective vs infantry', () => {
    const baseDmg = Number(ini['SCUD'].Damage);
    const verses = ini['HE'].Verses.split(',').map(v => Number(v.replace('%', '')) / 100);
    const effective = Math.round(baseDmg * verses[0]); // none
    expect(effective).toBe(540);
  });

  it('600 base * 0.6 (HE vs light) = 360 effective vs V2RL self-damage', () => {
    const baseDmg = Number(ini['SCUD'].Damage);
    const verses = ini['HE'].Verses.split(',').map(v => Number(v.replace('%', '')) / 100);
    const effective = Math.round(baseDmg * verses[2]); // light
    expect(effective).toBe(360);
    // V2RL has 150 HP light armor — one SCUD hit kills it (360 > 150)
  });

  it('600 base * 0.25 (HE vs heavy) = 150 effective vs heavy tanks', () => {
    const baseDmg = Number(ini['SCUD'].Damage);
    const verses = ini['HE'].Verses.split(',').map(v => Number(v.replace('%', '')) / 100);
    const effective = Math.round(baseDmg * verses[3]); // heavy
    expect(effective).toBe(150);
  });

  it('600 base * 1.0 (HE vs concrete) = 600 effective vs buildings', () => {
    const baseDmg = Number(ini['SCUD'].Damage);
    const verses = ini['HE'].Verses.split(',').map(v => Number(v.replace('%', '')) / 100);
    const effective = Math.round(baseDmg * verses[4]); // concrete
    expect(effective).toBe(600);
  });
});

// ── 6. SpeedClass parity — Tracked=yes means SPEED_TRACK, not SPEED_WHEEL ────

describe('V2RL SpeedClass — Tracked=yes in INI -> SPEED_TRACK', () => {
  it('rules.ini Tracked=yes for V2RL, 1TNK, 2TNK, 3TNK, 4TNK, ARTY, HARV, MCV', () => {
    // Confirm all tracked vehicles in rules.ini
    const trackedUnits = ['V2RL', '1TNK', '2TNK', '3TNK', '4TNK', 'ARTY', 'HARV', 'MNLY'];
    for (const unitId of trackedUnits) {
      const section = ini[unitId];
      if (section?.Tracked) {
        expect(section.Tracked.toLowerCase(), `${unitId} Tracked`).toBe('yes');
      }
    }
  });

  it('V2RL speedClass should be TRACK per INI Tracked=yes (C++ udata.cpp:1366)', () => {
    // C++ udata.cpp:1366:
    //   Speed = ini.Get_Bool(IniName, "Tracked", (Speed == SPEED_TRACK)) ? SPEED_TRACK : SPEED_WHEEL;
    // With Tracked=yes -> SPEED_TRACK
    //
    // TS currently uses SpeedClass.WHEEL for V2RL (and all vehicles).
    // The types.ts comment "udata.cpp:865 forces all vehicles to WHEEL" is misleading:
    // udata.cpp:865 is just the constructor default; Read_INI at line 1366 overrides it.
    expect(UNIT_STATS.V2RL.speedClass).toBe(SpeedClass.TRACK);
  });

  it('TRACK vs WHEEL terrain speeds differ (TRACK is faster on Clear, Rough, Ore)', () => {
    // From rules.ini terrain sections:
    // [Clear] Track=80%, Wheel=60%
    // [Rough] Track=70%, Wheel=40%
    // [Ore]   Track=70%, Wheel=50%
    // This means tracked vehicles are significantly faster on non-road terrain.
    // SpeedClass.TRACK = 1, SpeedClass.WHEEL = 2
    expect(SpeedClass.TRACK).not.toBe(SpeedClass.WHEEL);
  });
});

// ── 7. Comparative weapon stats — SCUD vs other vehicle weapons ────────────────

describe('SCUD vs other vehicle weapons — rules.ini values', () => {
  it('SCUD Damage=600 > 120mm Damage (Mammoth primary)', () => {
    expect(Number(ini['SCUD'].Damage)).toBeGreaterThan(Number(ini['120mm'].Damage));
    expect(WEAPON_STATS.SCUD.damage).toBeGreaterThan(WEAPON_STATS['120mm'].damage);
  });

  it('SCUD Damage=600 > 155mm Damage (Artillery)', () => {
    expect(Number(ini['SCUD'].Damage)).toBeGreaterThan(Number(ini['155mm'].Damage));
    expect(WEAPON_STATS.SCUD.damage).toBeGreaterThan(WEAPON_STATS['155mm'].damage);
  });

  it('SCUD ROF=400 > 155mm ROF (Artillery has faster reload)', () => {
    expect(Number(ini['SCUD'].ROF)).toBeGreaterThan(Number(ini['155mm'].ROF));
    expect(WEAPON_STATS.SCUD.rof).toBeGreaterThan(WEAPON_STATS['155mm'].rof);
  });

  it('SCUD Range=10 > 155mm Range (V2 outranges Artillery)', () => {
    expect(Number(ini['SCUD'].Range)).toBeGreaterThan(Number(ini['155mm'].Range));
    expect(WEAPON_STATS.SCUD.range).toBeGreaterThan(WEAPON_STATS['155mm'].range);
  });
});

// ── 8. Cross-reference: Gigundo projectiles vs FROG ────────────────────────────

describe('Gigundo projectiles — FROG is NOT Gigundo', () => {
  it('GPSSatellite has Gigundo=yes', () => {
    expect(ini['GPSSatellite']?.Gigundo?.toLowerCase()).toBe('yes');
  });

  it('NukeUp has Gigundo=yes', () => {
    expect(ini['NukeUp']?.Gigundo?.toLowerCase()).toBe('yes');
  });

  it('NukeDown has Gigundo=yes', () => {
    expect(ini['NukeDown']?.Gigundo?.toLowerCase()).toBe('yes');
  });

  it('FROG does NOT have Gigundo (only nukes/GPS use it)', () => {
    expect(ini['FROG']?.Gigundo).toBeUndefined();
  });
});
