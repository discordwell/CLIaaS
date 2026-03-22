/**
 * C++ Parity: Unit Primary/Secondary weapon assignments vs rules.ini / aftrmath.ini
 *
 * Source of truth: rules.ini for base game units, aftrmath.ini for Aftermath units.
 * aftrmath.ini overrides rules.ini when both define the same section.
 *
 * INI references (line numbers from rules.ini / aftrmath.ini):
 *   rules.ini:  [V2RL] L481, [1TNK] L499, [3TNK] L515, [2TNK] L532, [4TNK] L548,
 *               [MRJ] L566, [MGG] L581, [ARTY] L595, [HARV] L612, [MCV] L628,
 *               [JEEP] L642, [APC] L657, [MNLY] L673, [TRUK] L689,
 *               [SS] L703, [DD] L718, [CA] L734, [LST] L750, [PT] L763,
 *               [DOG] L780, [E1] L796, [E2] L808, [E3] L821, [E4] L835,
 *               [E6] L849, [SPY] L861, [THF] L874, [E7] L887, [MEDI] L904,
 *               [GNRL] L916, [C1] L929, [C7] L1003, [CHAN] L1079,
 *               [BADR] L1091, [U2] L1107, [MIG] L1122, [YAK] L1139,
 *               [TRAN] L1157, [HELI] L1171, [HIND] L1189
 *   aftrmath.ini: [STNK] L13, [CTNK] L46, [TTNK] L60, [DTRK] L77,
 *                 [QTNK] L93, [MSUB] L108, [SHOK] L124, [MECH] L140,
 *                 [4TNK] L301 (override), [DOG] L448, [E3] L475, [GNRL] L432
 */

import { describe, it, expect } from 'vitest';
import { UNIT_STATS } from '../engine/types';

// ─── helpers ───────────────────────────────────────────────────────────────────

/** Normalise INI "Primary=none" → null, missing Primary → null */
function normaliseWeapon(iniValue: string | undefined | null): string | null {
  if (!iniValue || iniValue.toLowerCase() === 'none') return null;
  return iniValue;
}

/** Get TS primary weapon (null if absent/null) */
function tsPrimary(unitId: string): string | null {
  const s = UNIT_STATS[unitId];
  return s?.primaryWeapon ?? null;
}

/** Get TS secondary weapon (null / undefined both → null) */
function tsSecondary(unitId: string): string | null {
  const s = UNIT_STATS[unitId];
  return s?.secondaryWeapon ?? null;
}

// ─── Expected data derived from rules.ini & aftrmath.ini ───────────────────────

/**
 * Format: [unitId, expectedPrimary, expectedSecondary, iniSource]
 *
 * expectedPrimary/Secondary: weapon name string or null (for "none" / absent).
 * iniSource: which INI file defines the authoritative value.
 */
const EXPECTED_WEAPONS: [string, string | null, string | null, string][] = [
  // ── Vehicles (rules.ini) ──────────────────────────────────────────────────
  ['1TNK', '75mm',    null,         'rules.ini [1TNK] L501: Primary=75mm'],
  ['2TNK', '90mm',    null,         'rules.ini [2TNK] L534: Primary=90mm'],
  ['3TNK', '105mm',   '105mm',     'rules.ini [3TNK] L517-518: Primary=105mm, Secondary=105mm'],
  ['4TNK', '120mm',   'MammothTusk', 'aftrmath.ini [4TNK] L303-304: Primary=120mm, Secondary=MammothTusk (overrides rules.ini)'],
  ['JEEP', 'M60mg',   null,         'rules.ini [JEEP] L644: Primary=M60mg'],
  ['APC',  'M60mg',   null,         'rules.ini [APC] L659: Primary=M60mg'],
  ['ARTY', '155mm',   null,         'rules.ini [ARTY] L597: Primary=155mm'],
  ['HARV', null,       null,         'rules.ini [HARV] L612: no Primary key'],
  ['MCV',  null,       null,         'rules.ini [MCV] L628: no Primary key'],
  ['V2RL', 'SCUD',    null,         'rules.ini [V2RL] L483: Primary=SCUD'],
  ['MNLY', null,       null,         'rules.ini [MNLY] L673: no Primary key'],
  ['TRUK', null,       null,         'rules.ini [TRUK] L689: no Primary key'],
  ['MRJ',  null,       null,         'rules.ini [MRJ] L566: no Primary key'],
  ['MGG',  null,       null,         'rules.ini [MGG] L581: no Primary key'],

  // ── Aftermath vehicles (aftrmath.ini) ─────────────────────────────────────
  ['STNK', 'APTusk',      null, 'aftrmath.ini [STNK] L15: Primary=APTusk'],
  ['CTNK', 'APTusk',      null, 'aftrmath.ini [CTNK] L48: Primary=APTusk'],
  ['TTNK', 'TTankZap',    null, 'aftrmath.ini [TTNK] L63: Primary=TTankZap'],
  ['QTNK', null,          null, 'aftrmath.ini [QTNK] L95: Primary=none'],
  ['DTRK', 'Democharge',  null, 'aftrmath.ini [DTRK] L80: Primary=Democharge'],

  // ── Infantry (rules.ini) ─────────────────────────────────────────────────
  ['E1',   'M1Carbine', null,     'rules.ini [E1] L797: Primary=M1Carbine'],
  ['E2',   'Grenade',   null,     'rules.ini [E2] L809: Primary=Grenade'],
  ['E3',   'RedEye',    'Dragon', 'rules.ini [E3] L822-823: Primary=RedEye, Secondary=Dragon'],
  ['E4',   'Flamer',    null,     'rules.ini [E4] L837: Primary=Flamer'],
  ['E6',   null,        null,     'rules.ini [E6] L849: no Primary key'],
  ['E7',   'Colt45',    'Colt45', 'rules.ini [E7] L889-890: Primary=Colt45, Secondary=Colt45'],
  ['DOG',  'DogJaw',    null,     'rules.ini [DOG] L782: Primary=DogJaw'],
  ['SPY',  null,        null,     'rules.ini [SPY] L861: no Primary key'],
  ['MEDI', 'Heal',      null,     'rules.ini [MEDI] L905: Primary=Heal'],
  ['THF',  null,        null,     'rules.ini [THF] L874: no Primary key'],
  ['GNRL', 'Pistol',    null,     'aftrmath.ini [GNRL] L433: Primary=Pistol, Secondary=none'],

  // ── Aftermath infantry (aftrmath.ini) ─────────────────────────────────────
  ['SHOK', 'PortaTesla',  null, 'aftrmath.ini [SHOK] L127: Primary=PortaTesla'],
  ['MECH', 'GoodWrench',  null, 'aftrmath.ini [MECH] L143: Primary=GoodWrench'],

  // ── Aircraft (rules.ini) ─────────────────────────────────────────────────
  ['MIG',  'Maverick',  'Maverick',  'rules.ini [MIG] L1124-1125: Primary=Maverick, Secondary=Maverick'],
  ['YAK',  'ChainGun',  'ChainGun',  'rules.ini [YAK] L1141-1142: Primary=ChainGun, Secondary=ChainGun'],
  ['HELI', 'Hellfire',  'Hellfire',  'rules.ini [HELI] L1173-1174: Primary=Hellfire, Secondary=Hellfire'],
  ['HIND', 'ChainGun',  null,        'rules.ini [HIND] L1191: Primary=ChainGun (no Secondary)'],
  ['TRAN', null,         null,        'rules.ini [TRAN] L1157: no Primary key'],
  ['BADR', 'ParaBomb',  null,        'rules.ini [BADR] L1093: Primary=ParaBomb'],
  ['U2',   'Camera',    null,        'rules.ini [U2] L1109: Primary=Camera'],

  // ── Vessels (rules.ini + aftrmath.ini) ────────────────────────────────────
  ['DD',   'Stinger',   'DepthCharge', 'rules.ini [DD] L720-721: Primary=Stinger, Secondary=DepthCharge'],
  ['SS',   'TorpTube',  null,          'rules.ini [SS] L705: Primary=TorpTube'],
  ['CA',   '8Inch',     '8Inch',       'rules.ini [CA] L736-737: Primary=8Inch, Secondary=8Inch'],
  ['PT',   '2Inch',     'DepthCharge', 'rules.ini [PT] L765-766: Primary=2Inch, Secondary=DepthCharge'],
  ['LST',  null,        null,          'rules.ini [LST] L750: no Primary key'],
  ['MSUB', 'SubSCUD',   null,          'aftrmath.ini [MSUB] L111: Primary=SubSCUD'],
];

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('C++ Parity — Unit Primary/Secondary weapons vs rules.ini / aftrmath.ini', () => {

  describe('unit exists in UNIT_STATS', () => {
    for (const [unitId, , , source] of EXPECTED_WEAPONS) {
      it(`${unitId} is defined`, () => {
        expect(UNIT_STATS[unitId], `${unitId} missing from UNIT_STATS — ${source}`).toBeDefined();
      });
    }
  });

  describe('primary weapon matches INI', () => {
    for (const [unitId, expectedPrimary, , source] of EXPECTED_WEAPONS) {
      it(`${unitId} primaryWeapon = ${expectedPrimary ?? 'null'}`, () => {
        const actual = tsPrimary(unitId);
        const expected = normaliseWeapon(expectedPrimary);
        expect(actual, `${unitId}: primaryWeapon mismatch — ${source}`).toBe(expected);
      });
    }
  });

  describe('secondary weapon matches INI', () => {
    for (const [unitId, , expectedSecondary, source] of EXPECTED_WEAPONS) {
      it(`${unitId} secondaryWeapon = ${expectedSecondary ?? 'null'}`, () => {
        const actual = tsSecondary(unitId);
        const expected = normaliseWeapon(expectedSecondary);
        expect(actual, `${unitId}: secondaryWeapon mismatch — ${source}`).toBe(expected);
      });
    }
  });

  describe('no unexpected primary weapons on unarmed units', () => {
    const unarmedUnits = EXPECTED_WEAPONS
      .filter(([, primary]) => primary === null)
      .map(([unitId]) => unitId);

    for (const unitId of unarmedUnits) {
      it(`${unitId} has no primary weapon`, () => {
        expect(tsPrimary(unitId), `${unitId} should have primaryWeapon=null`).toBeNull();
      });
    }
  });

  describe('units with dual weapons have matching primary and secondary', () => {
    const dualWeaponUnits = EXPECTED_WEAPONS.filter(
      ([, primary, secondary]) => primary !== null && secondary !== null
    );

    for (const [unitId, expectedPrimary, expectedSecondary, source] of dualWeaponUnits) {
      it(`${unitId}: primary=${expectedPrimary}, secondary=${expectedSecondary}`, () => {
        expect(tsPrimary(unitId), `${unitId} primary — ${source}`).toBe(expectedPrimary);
        expect(tsSecondary(unitId), `${unitId} secondary — ${source}`).toBe(expectedSecondary);
      });
    }
  });

  describe('HIND has no secondary weapon (rules.ini has only Primary=ChainGun)', () => {
    it('HIND secondaryWeapon is null/undefined', () => {
      // rules.ini [HIND] L1189-1203: Only Primary=ChainGun, no Secondary= line
      expect(tsSecondary('HIND')).toBeNull();
    });
  });

  describe('Aftermath units override correctly', () => {
    it('QTNK primary is null (aftrmath.ini Primary=none)', () => {
      // aftrmath.ini [QTNK] L95: Primary=none — M.A.D. Tank has no weapon
      expect(tsPrimary('QTNK')).toBeNull();
    });

    it('4TNK retains dual weapons after aftrmath override', () => {
      // aftrmath.ini [4TNK] L303-304 keeps Primary=120mm, Secondary=MammothTusk
      expect(tsPrimary('4TNK')).toBe('120mm');
      expect(tsSecondary('4TNK')).toBe('MammothTusk');
    });
  });
});
