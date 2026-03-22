/**
 * C++ Parity: Projectile AA/AG flags
 *
 * Verifies that TS WEAPON_STATS isAntiAir / isAntiGround flags match the
 * authoritative rules.ini / aftrmath.ini projectile definitions.
 *
 * C++ defaults (bbdata.cpp:90-91):
 *   IsAntiAircraft = false
 *   IsAntiGround   = true
 *
 * Chain: Weapon section -> Projectile= -> Projectile section -> AA= / AG=
 *
 * Source files:
 *   rules.ini  [Weapon]  Projectile=XXX
 *   rules.ini  [XXX]     AA=yes/no  AG=yes/no
 *   aftrmath.ini (expansion weapons/projectiles)
 *   bbdata.cpp:90-91 (C++ defaults)
 */
import { describe, it, expect } from 'vitest';
import { WEAPON_STATS } from '../engine/types';

// ── Authoritative weapon→projectile mapping from rules.ini / aftrmath.ini ──

interface ProjectileAaAg {
  projectile: string;
  aa: boolean;  // from INI AA= line, default false
  ag: boolean;  // from INI AG= line, default true
  source: string; // INI file reference
}

/**
 * Complete mapping of every WEAPON_STATS entry to its projectile AA/AG flags.
 * Derived by reading each weapon's Projectile= line in rules.ini or aftrmath.ini,
 * then reading that projectile section's AA= and AG= lines.
 */
const WEAPON_PROJECTILE_AA_AG: Record<string, ProjectileAaAg> = {
  // ── Infantry weapons ──
  // [M1Carbine] Projectile=Invisible → [Invisible] no AA/AG lines → defaults
  M1Carbine:   { projectile: 'Invisible',   aa: false, ag: true,  source: 'rules.ini line 2192' },
  // [Grenade] Projectile=Lobbed → [Lobbed] no AA/AG lines → defaults
  Grenade:     { projectile: 'Lobbed',       aa: false, ag: true,  source: 'rules.ini line 2222' },
  // [Dragon] Projectile=HeatSeeker → [HeatSeeker] AA=yes, no AG line → AG=true
  Dragon:      { projectile: 'HeatSeeker',   aa: true,  ag: true,  source: 'rules.ini line 2202, projectile line 2532' },
  // [RedEye] Projectile=AAMissile → [AAMissile] AA=yes, AG=no
  RedEye:      { projectile: 'AAMissile',    aa: true,  ag: false, source: 'rules.ini line 2351, projectile lines 2560-2561' },
  // [Flamer] Projectile=Fireball → [Fireball] no AA/AG lines → defaults
  Flamer:      { projectile: 'Fireball',     aa: false, ag: true,  source: 'rules.ini line 2152' },
  // [DogJaw] Projectile=LeapDog → [LeapDog] no AA/AG lines → defaults
  DogJaw:      { projectile: 'LeapDog',      aa: false, ag: true,  source: 'rules.ini line 2426' },
  // [Heal] Projectile=Invisible → [Invisible] no AA/AG lines → defaults
  Heal:        { projectile: 'Invisible',    aa: false, ag: true,  source: 'rules.ini line 2436' },
  // [Sniper] Projectile=Invisible → [Invisible] no AA/AG lines → defaults
  Sniper:      { projectile: 'Invisible',    aa: false, ag: true,  source: 'rules.ini line 2161' },
  // [Colt45] Projectile=Invisible → [Invisible] no AA/AG lines → defaults
  Colt45:      { projectile: 'Invisible',    aa: false, ag: true,  source: 'rules.ini line 2091' },
  // [Pistol] Projectile=Invisible → [Invisible] no AA/AG lines → defaults
  Pistol:      { projectile: 'Invisible',    aa: false, ag: true,  source: 'rules.ini line 2182' },

  // ── Vehicle weapons ──
  // [M60mg] Projectile=Invisible → defaults
  M60mg:       { projectile: 'Invisible',    aa: false, ag: true,  source: 'rules.ini line 2309' },
  // [75mm] Projectile=Cannon → [Cannon] no AA/AG lines → defaults
  '75mm':      { projectile: 'Cannon',       aa: false, ag: true,  source: 'rules.ini line 2231' },
  // [90mm] Projectile=Cannon → defaults
  '90mm':      { projectile: 'Cannon',       aa: false, ag: true,  source: 'rules.ini line 2242' },
  // [105mm] Projectile=Cannon → defaults
  '105mm':     { projectile: 'Cannon',       aa: false, ag: true,  source: 'rules.ini line 2253' },
  // [120mm] Projectile=Cannon → defaults
  '120mm':     { projectile: 'Cannon',       aa: false, ag: true,  source: 'rules.ini line 2264' },
  // [MammothTusk] Projectile=HeatSeeker → AA=yes, AG=true (default)
  MammothTusk: { projectile: 'HeatSeeker',   aa: true,  ag: true,  source: 'rules.ini line 2287, projectile line 2532' },
  // [155mm] Projectile=Ballistic → [Ballistic] no AA/AG lines → defaults
  '155mm':     { projectile: 'Ballistic',    aa: false, ag: true,  source: 'rules.ini line 2298' },
  // [SCUD] Projectile=FROG → [FROG] no AA/AG lines → defaults
  SCUD:        { projectile: 'FROG',         aa: false, ag: true,  source: 'rules.ini line 2446' },

  // ── Expansion weapons (aftrmath.ini) ──
  // [PortaTesla] Projectile=Invisible → defaults
  PortaTesla:  { projectile: 'Invisible',    aa: false, ag: true,  source: 'aftrmath.ini line 167' },
  // [GoodWrench] Projectile=Invisible → defaults
  GoodWrench:  { projectile: 'Invisible',    aa: false, ag: true,  source: 'aftrmath.ini line 189' },
  // [APTusk] Projectile=HeatSeeker → AA=yes, AG=true (default)
  APTusk:      { projectile: 'HeatSeeker',   aa: true,  ag: true,  source: 'aftrmath.ini line 216, rules.ini projectile line 2532' },
  // [TTankZap] Projectile=Invisible → defaults
  TTankZap:    { projectile: 'Invisible',    aa: false, ag: true,  source: 'aftrmath.ini line 178' },
  // [SubSCUD] Projectile=HeatSeeker → AA=yes, AG=true (default)
  SubSCUD:     { projectile: 'HeatSeeker',   aa: true,  ag: true,  source: 'aftrmath.ini line 205, rules.ini projectile line 2532' },
  // [Democharge] Projectile=Invisible → defaults
  Democharge:  { projectile: 'Invisible',    aa: false, ag: true,  source: 'aftrmath.ini line 228' },

  // ── Naval weapons ──
  // [Stinger] Projectile=LaserGuided → [LaserGuided] AA=yes, no AG line → AG=true
  Stinger:     { projectile: 'LaserGuided',  aa: true,  ag: true,  source: 'rules.ini line 2374, projectile line 2546' },
  // [TorpTube] Projectile=Torpedo → [Torpedo] no AA/AG lines → defaults
  TorpTube:    { projectile: 'Torpedo',      aa: false, ag: true,  source: 'rules.ini line 2386' },
  // [DepthCharge] Projectile=Catapult → [Catapult] AG=no, no AA line → AA=false
  DepthCharge: { projectile: 'Catapult',     aa: false, ag: false, source: 'rules.ini line 2407, projectile line 2584' },
  // [8Inch] Projectile=Ballistic → [Ballistic] no AA/AG lines → defaults
  '8Inch':     { projectile: 'Ballistic',    aa: false, ag: true,  source: 'rules.ini line 2362' },
  // [2Inch] Projectile=Cannon → [Cannon] no AA/AG lines → defaults
  '2Inch':     { projectile: 'Cannon',       aa: false, ag: true,  source: 'rules.ini line 2396' },

  // ── Aircraft weapons ──
  // [Maverick] Projectile=HeatSeeker → AA=yes, AG=true (default)
  Maverick:    { projectile: 'HeatSeeker',   aa: true,  ag: true,  source: 'rules.ini line 2123, projectile line 2532' },
  // [Hellfire] Projectile=HeatSeeker → AA=yes, AG=true (default)
  Hellfire:    { projectile: 'HeatSeeker',   aa: true,  ag: true,  source: 'rules.ini line 2212, projectile line 2532' },
  // [ChainGun] Projectile=Invisible → defaults
  ChainGun:    { projectile: 'Invisible',    aa: false, ag: true,  source: 'rules.ini line 2171' },
  // [Camera] Projectile=Inivisble (typo in rules.ini) → section not found → C++ defaults
  Camera:      { projectile: 'Inivisble',    aa: false, ag: true,  source: 'rules.ini line 2133 (typo: "Inivisble")' },
  // [Napalm] Projectile=Bomblet → [Bomblet] no AA/AG lines → defaults
  Napalm:      { projectile: 'Bomblet',      aa: false, ag: true,  source: 'rules.ini line 2320' },
  // [ParaBomb] Projectile=Parachute → [Parachute] no AA/AG lines → defaults
  ParaBomb:    { projectile: 'Parachute',    aa: false, ag: true,  source: 'rules.ini line 2416' },

  // ── Ant weapons (from SCA scenario INI files) ──
  // [Mandible] Projectile=Invisible → defaults
  Mandible:    { projectile: 'Invisible',    aa: false, ag: true,  source: 'SCA01EA.ini line 55' },
  // [TeslaZap] (ant variant) Projectile=Invisible → defaults
  TeslaZap:    { projectile: 'Invisible',    aa: false, ag: true,  source: 'SCA01EA.ini line 64' },
  // [FireballLauncher] Projectile=Fireball → [Fireball] no AA/AG lines → defaults
  FireballLauncher: { projectile: 'Fireball', aa: false, ag: true, source: 'rules.ini line 2143' },
};

// ── TS-fabricated weapons that don't exist in any INI ──
// Tomahawk, SeaSerpent, TeslaCannon are TS inventions — not in rules.ini or aftrmath.ini.
// CA actually uses "8Inch", MSUB uses "SubSCUD", TSLA building uses "TeslaZap".
const TS_FABRICATED_WEAPONS = ['Tomahawk', 'SeaSerpent', 'TeslaCannon'];

// ── STRUCTURE_WEAPONS AA/AG from INI ──
// SAM building uses [Nike] → Projectile=AAMissile → AA=yes, AG=no
// AGUN building uses [ZSU-23] → Projectile=Ack → AA=true, AG=false

interface StructureWeaponAaAg {
  weapon: string;
  projectile: string;
  aa: boolean;
  ag: boolean;
  source: string;
}

const STRUCTURE_WEAPON_AA_AG: Record<string, StructureWeaponAaAg> = {
  // [SAM] Primary=Nike → [Nike] Projectile=AAMissile → AA=yes, AG=no
  SAM:  { weapon: 'Nike',    projectile: 'AAMissile', aa: true,  ag: false, source: 'rules.ini line 2340, projectile lines 2560-2561' },
  // [AGUN] Primary=ZSU-23 → [ZSU-23] Projectile=Ack → AA=true, AG=false
  AGUN: { weapon: 'ZSU-23',  projectile: 'Ack',       aa: true,  ag: false, source: 'rules.ini line 2101, projectile lines 2501-2502' },
  // [HBOX] Primary=Vulcan → [Vulcan] Projectile=Invisible → defaults
  HBOX: { weapon: 'Vulcan',  projectile: 'Invisible',  aa: false, ag: true,  source: 'rules.ini line 2112' },
  // [PBOX] Primary=Vulcan → [Vulcan] Projectile=Invisible → defaults
  PBOX: { weapon: 'Vulcan',  projectile: 'Invisible',  aa: false, ag: true,  source: 'rules.ini line 2112' },
  // [GUN] Primary=TurretGun → [TurretGun] Projectile=Cannon → defaults
  GUN:  { weapon: 'TurretGun', projectile: 'Cannon',   aa: false, ag: true,  source: 'rules.ini line 2276' },
  // [TSLA] Primary=TeslaZap → [TeslaZap] Projectile=Invisible → defaults
  TSLA: { weapon: 'TeslaZap',  projectile: 'Invisible', aa: false, ag: true, source: 'rules.ini line 2329' },
  // [FTUR] Primary=FireballLauncher → [FireballLauncher] Projectile=Fireball → defaults
  FTUR: { weapon: 'FireballLauncher', projectile: 'Fireball', aa: false, ag: true, source: 'rules.ini line 2143' },
};

describe('C++ Parity: Projectile AA/AG flags (rules.ini)', () => {

  describe('WEAPON_STATS isAntiAir must match rules.ini projectile AA flag', () => {
    for (const [weaponName, expected] of Object.entries(WEAPON_PROJECTILE_AA_AG)) {
      const ws = WEAPON_STATS[weaponName];
      if (!ws) continue; // skip if weapon not in WEAPON_STATS (structure-only weapons)

      it(`${weaponName} (${expected.projectile}) AA=${expected.aa} — ${expected.source}`, () => {
        const tsAA = ws.isAntiAir ?? false;
        expect(tsAA, `${weaponName}: isAntiAir should be ${expected.aa} per ${expected.projectile} projectile`).toBe(expected.aa);
      });
    }
  });

  describe('WEAPON_STATS isAntiGround must match rules.ini projectile AG flag', () => {
    for (const [weaponName, expected] of Object.entries(WEAPON_PROJECTILE_AA_AG)) {
      const ws = WEAPON_STATS[weaponName];
      if (!ws) continue;

      it(`${weaponName} (${expected.projectile}) AG=${expected.ag} — ${expected.source}`, () => {
        // In TS, isAntiGround defaults to undefined which means "true" (can fire at ground).
        // Only when explicitly false does it mean "cannot fire at ground".
        const tsAG = ws.isAntiGround !== false; // undefined/true -> true, false -> false
        expect(tsAG, `${weaponName}: isAntiGround should be ${expected.ag} per ${expected.projectile} projectile`).toBe(expected.ag);
      });
    }
  });

  describe('STRUCTURE_WEAPONS isAntiAir must match rules.ini projectile AA flag', () => {
    // Import STRUCTURE_WEAPONS from scenario.ts
    // We re-import here so we test the actual runtime values
    it('SAM structure has isAntiAir=true (Nike -> AAMissile AA=yes)', async () => {
      const { STRUCTURE_WEAPONS } = await import('../engine/scenario');
      const sam = (STRUCTURE_WEAPONS as Record<string, { isAntiAir?: boolean }>)['SAM'];
      expect(sam).toBeDefined();
      expect(sam.isAntiAir).toBe(true);
    });

    it('AGUN structure has isAntiAir=true (ZSU-23 -> Ack AA=true)', async () => {
      const { STRUCTURE_WEAPONS } = await import('../engine/scenario');
      const agun = (STRUCTURE_WEAPONS as Record<string, { isAntiAir?: boolean }>)['AGUN'];
      expect(agun).toBeDefined();
      expect(agun.isAntiAir).toBe(true);
    });

    it('non-AA structures (HBOX, PBOX, GUN, TSLA, FTUR) must NOT have isAntiAir', async () => {
      const { STRUCTURE_WEAPONS } = await import('../engine/scenario');
      const weapons = STRUCTURE_WEAPONS as Record<string, { isAntiAir?: boolean }>;
      for (const key of ['HBOX', 'PBOX', 'GUN', 'TSLA', 'FTUR']) {
        const sw = weapons[key];
        expect(sw, `${key} should exist in STRUCTURE_WEAPONS`).toBeDefined();
        expect(sw.isAntiAir ?? false, `${key} should NOT be anti-air`).toBe(false);
      }
    });
  });

  describe('weapons with AA=true must all be accounted for', () => {
    // Every weapon in WEAPON_STATS that has isAntiAir=true must be in the
    // AA-true list from rules.ini (HeatSeeker, LaserGuided, or AAMissile projectile)
    const INI_AA_WEAPONS = new Set(
      Object.entries(WEAPON_PROJECTILE_AA_AG)
        .filter(([, v]) => v.aa)
        .map(([k]) => k)
    );

    it('no spurious isAntiAir flags in WEAPON_STATS', () => {
      for (const [name, ws] of Object.entries(WEAPON_STATS)) {
        if (ws.isAntiAir) {
          expect(INI_AA_WEAPONS.has(name), `${name} has isAntiAir=true in TS but not in INI`).toBe(true);
        }
      }
    });

    it('no missing isAntiAir flags in WEAPON_STATS', () => {
      for (const aaWeapon of INI_AA_WEAPONS) {
        const ws = WEAPON_STATS[aaWeapon];
        if (!ws) continue; // weapon not in WEAPON_STATS (structure-only)
        expect(ws.isAntiAir, `${aaWeapon} should have isAntiAir=true per INI`).toBe(true);
      }
    });
  });

  describe('weapons with AG=false must all be accounted for', () => {
    const INI_AG_FALSE_WEAPONS = new Set(
      Object.entries(WEAPON_PROJECTILE_AA_AG)
        .filter(([, v]) => !v.ag)
        .map(([k]) => k)
    );

    it('every AG=false weapon must have isAntiGround=false in TS', () => {
      for (const agFalseWeapon of INI_AG_FALSE_WEAPONS) {
        const ws = WEAPON_STATS[agFalseWeapon];
        if (!ws) continue;
        expect(ws.isAntiGround,
          `${agFalseWeapon} (${WEAPON_PROJECTILE_AA_AG[agFalseWeapon].projectile}) ` +
          `must have isAntiGround=false — ${WEAPON_PROJECTILE_AA_AG[agFalseWeapon].source}`
        ).toBe(false);
      }
    });

    it('no spurious isAntiGround=false flags', () => {
      for (const [name, ws] of Object.entries(WEAPON_STATS)) {
        if (ws.isAntiGround === false) {
          expect(INI_AG_FALSE_WEAPONS.has(name),
            `${name} has isAntiGround=false in TS but AG is true in INI`
          ).toBe(true);
        }
      }
    });
  });

  describe('TS-fabricated weapon names', () => {
    // These weapon names exist in WEAPON_STATS but NOT in any INI file.
    // They are TS inventions. The actual C++ weapons are:
    //   Tomahawk -> CA uses "8Inch" (rules.ini line 736)
    //   SeaSerpent -> not a real RA weapon (MSUB uses SubSCUD)
    //   TeslaCannon -> TSLA building uses "TeslaZap" (rules.ini line 1345)
    for (const name of TS_FABRICATED_WEAPONS) {
      it(`${name} does not exist in rules.ini or aftrmath.ini`, () => {
        expect(WEAPON_PROJECTILE_AA_AG[name]).toBeUndefined();
        // Verify it IS in WEAPON_STATS (documenting the discrepancy)
        expect(WEAPON_STATS[name], `${name} should exist in WEAPON_STATS as a TS-fabricated entry`).toBeDefined();
      });
    }
  });

  describe('DepthCharge Catapult AG=no parity', () => {
    // The Catapult projectile (used by DepthCharge) has AG=no in rules.ini line 2584.
    // This means DepthCharge cannot fire at ground targets — it is ASW-only.
    // C++ bullet.cpp respects AG flag: if AG=false, the weapon cannot acquire ground targets.
    it('DepthCharge must have isAntiGround=false (Catapult AG=no, rules.ini:2584)', () => {
      const dc = WEAPON_STATS['DepthCharge'];
      expect(dc).toBeDefined();
      expect(dc.isAntiGround,
        'DepthCharge uses Catapult projectile which has AG=no in rules.ini. ' +
        'It is an ASW-only weapon that cannot fire at ground targets.'
      ).toBe(false);
    });
  });
});
