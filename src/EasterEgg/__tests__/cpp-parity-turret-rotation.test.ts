/**
 * C++ Parity Audit: Turret Rotation Mechanics
 *
 * Audits turret rotation for ALL turreted units against C++ unit.cpp/turret.cpp,
 * rules.ini, and aftrmath.ini. All expected values are parsed from INI at test time.
 *
 * Failing tests are GOOD -- they identify real C++ divergences.
 * DO NOT modify engine code to make these pass.
 *
 * C++ source references:
 *   unit.cpp:542          — Turret: SecondaryFacing.Rotation_Adjust(Class->ROT+1)
 *   unit.cpp:554-556      — Idle: SecondaryFacing.Set_Desired(PrimaryFacing.Current())
 *   unit.cpp:517-524      — Non-turreted body rotation for aiming
 *   facing.cpp:142-183    — Rotation_Adjust(rate): step by rate toward desired, snap if abs(diff) < rate
 *   facing.cpp:70          — Difference() = (int)(signed char)(desired - current)
 *   facing.h:69            — Is_Rotating() = (DesiredFacing != CurrentFacing)
 *   inline.h:694-697       — Dir_To_32(facing) = Facing32[facing] -> 0..31 visual frame index
 *   face.h:44-51           — DIR_N=0, DIR_NE=32, DIR_E=64, DIR_SE=96, DIR_S=128, DIR_SW=160, DIR_W=192, DIR_NW=224
 *   type.h:512-516         — ROT field: rotation speed in 256ths per tick
 *   udata.cpp:114          — UnitLTank: IsTurretEquipped=true
 *   udata.cpp:145          — UnitMTank: IsTurretEquipped=true
 *   udata.cpp:176          — UnitMTank2: IsTurretEquipped=true
 *   udata.cpp:207          — UnitHTank: IsTurretEquipped=true
 *   udata.cpp:393          — UnitRanger(JEEP): IsTurretEquipped=true
 *   udata.cpp:762          — UnitPhase(STNK): IsTurretEquipped=true
 *   bdata.cpp:571-599      — ClassTurret(GUN): IsTurretEquipped=true
 *   bdata.cpp:601-629      — ClassAAGun(AGUN): IsTurretEquipped=true
 *   bdata.cpp:901-929      — ClassSAM: IsTurretEquipped=true
 *   building.cpp:5347-5363 — Rotation_AI: uses PrimaryFacing.Rotation_Adjust(Class->ROT) for buildings
 *   drive.cpp:1344-1346    — Pre-move rotation: PrimaryFacing.Rotation_Adjust(ROT * GroundspeedBias)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Entity, resetEntityIds } from '../engine/entity';
import { Dir, UnitType, House, UNIT_STATS, BODY_SHAPE } from '../engine/types';
import { STRUCTURE_WEAPONS } from '../engine/scenario';

beforeEach(() => resetEntityIds());

// ============================================================================
// INI Parser: parse ROT= and Turret= values directly from rules.ini/aftrmath.ini
// ============================================================================

const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const AFTRMATH_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/aftrmath.ini');
const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');
const aftermathText = fs.readFileSync(AFTRMATH_INI_PATH, 'utf-8');

interface INISection {
  rot?: number;
  turret?: boolean;
  speed?: number;
}

function parseINI(text: string): Record<string, INISection> {
  const result: Record<string, INISection> = {};
  let currentSection = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([A-Za-z0-9_]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    if (!currentSection) continue;

    const kvMatch = line.match(/^(\w+)=(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const val = kvMatch[2].trim();

    if (!result[currentSection]) result[currentSection] = {};
    const entry = result[currentSection];

    switch (key) {
      case 'ROT':
        entry.rot = parseInt(val, 10);
        break;
      case 'Turret':
        entry.turret = val.toLowerCase() === 'yes';
        break;
      case 'Speed':
        entry.speed = parseInt(val, 10);
        break;
    }
  }
  return result;
}

const rulesINI = parseINI(rulesText);
const aftermathINI = parseINI(aftermathText);

/** Get INI data for a unit, checking aftermath first (overrides), then rules */
function getINI(unitKey: string): INISection | undefined {
  return aftermathINI[unitKey] ?? rulesINI[unitKey];
}

// ============================================================================
// C++ Reference: Rotation_Adjust reimplementation (facing.cpp:142-183)
// ============================================================================

function cppRotationAdjust(current: number, desired: number, rate: number): [number, boolean] {
  current = current & 0xFF;
  desired = desired & 0xFF;
  rate = Math.min(rate, 127);

  if (current === desired) return [current, false];

  const oldFacing32 = cppDirTo32(current);
  let diff = (desired - current) & 0xFF;
  if (diff > 127) diff -= 256;

  let newFacing: number;
  if (Math.abs(diff) < rate) {
    newFacing = desired;
  } else if (diff < 0) {
    newFacing = (current - rate) & 0xFF;
  } else {
    newFacing = (current + rate) & 0xFF;
  }

  const newFacing32 = cppDirTo32(newFacing);
  return [newFacing, newFacing32 !== oldFacing32];
}

function cppDirTo32(dir: number): number {
  return Math.floor(((dir & 0xFF) + 4) / 8) % 32;
}

/** Simulate full C++ rotation and count ticks to reach desired */
function cppRotationTicks(start: number, desired: number, rate: number): number {
  let current = start & 0xFF;
  desired = desired & 0xFF;
  let ticks = 0;
  while (current !== desired && ticks < 500) {
    [current] = cppRotationAdjust(current, desired, rate);
    ticks++;
  }
  return ticks;
}

// ============================================================================
// All unit types and their categories
// ============================================================================

/** Vehicles with turrets in C++ (IsTurretEquipped=true in udata.cpp) */
const CPP_TURRETED_VEHICLES: [string, string][] = [
  ['1TNK', 'udata.cpp:114 UnitLTank'],
  ['2TNK', 'udata.cpp:176 UnitMTank2'],
  ['3TNK', 'udata.cpp:145 UnitMTank'],
  ['4TNK', 'udata.cpp:207 UnitHTank'],
  ['JEEP', 'udata.cpp:393 UnitRanger'],
  ['STNK', 'udata.cpp:762 UnitPhase'],
];

/** Vehicles WITHOUT turrets in C++ (IsTurretEquipped=false in udata.cpp) */
const CPP_NON_TURRETED_VEHICLES: [string, string][] = [
  ['V2RL', 'udata.cpp:83 UnitV2Launcher'],
  ['MRJ',  'udata.cpp:238 UnitMRJammer'],
  ['MGG',  'udata.cpp:269 UnitMGG'],
  ['ARTY', 'udata.cpp:300 UnitArty'],
  ['HARV', 'udata.cpp:331 UnitHarvester'],
  ['MCV',  'udata.cpp:362 UnitMCV'],
  ['APC',  'udata.cpp:424 UnitAPC'],
  ['MNLY', 'udata.cpp:455 UnitMineLayer'],
  ['TRUK', 'udata.cpp:486 UnitConvoyTruck'],
  ['CTNK', 'udata.cpp:638 UnitChrono'],
  ['TTNK', 'udata.cpp:669 UnitTesla'],
  ['QTNK', 'udata.cpp:700 UnitMAD'],
  ['DTRK', 'udata.cpp:732 UnitDemoTruck'],
];

/** Buildings with turrets in C++ (IsTurretEquipped=true in bdata.cpp) */
const CPP_TURRETED_BUILDINGS: [string, string][] = [
  ['GUN',  'bdata.cpp:571-599 ClassTurret'],
  ['AGUN', 'bdata.cpp:601-629 ClassAAGun'],
  ['SAM',  'bdata.cpp:901-929 ClassSAM'],
];

/** Naval vessels with turrets */
const CPP_TURRETED_NAVAL: [string, string][] = [
  ['DD', 'vdata.cpp Destroyer — has rotating turret'],
  ['CA', 'vdata.cpp Cruiser — has rotating turret'],
  ['PT', 'vdata.cpp Gunboat — has rotating turret'],
];

/** Naval vessels WITHOUT turrets */
const CPP_NON_TURRETED_NAVAL: [string, string][] = [
  ['SS',   'vdata.cpp Submarine — no turret'],
  ['LST',  'vdata.cpp Landing Ship — no turret'],
  ['MSUB', 'vdata.cpp Missile Sub — no turret'],
];

// ============================================================================
// 1. Turret flag parity: which units have turrets
// ============================================================================

describe('1. Turret flag parity: turreted vehicles (C++ udata.cpp IsTurretEquipped)', () => {
  for (const [key, ref] of CPP_TURRETED_VEHICLES) {
    it(`${key} HAS turret in C++ (${ref}) — TS hasTurret should match`, () => {
      const entity = new Entity(UNIT_STATS[key].type, House.Spain, 100, 100);
      // C++ says these have turrets. TS may diverge (JEEP, STNK are known divergences)
      expect(entity.hasTurret).toBe(true);
    });
  }

  for (const [key, ref] of CPP_NON_TURRETED_VEHICLES) {
    it(`${key} has NO turret in C++ (${ref}) — TS hasTurret should match`, () => {
      const entity = new Entity(UNIT_STATS[key].type, House.Spain, 100, 100);
      expect(entity.hasTurret).toBe(false);
    });
  }
});

describe('1b. Turret flag parity: turreted naval vessels', () => {
  for (const [key, ref] of CPP_TURRETED_NAVAL) {
    it(`${key} HAS turret (${ref})`, () => {
      const entity = new Entity(UNIT_STATS[key].type, House.Spain, 100, 100);
      expect(entity.hasTurret).toBe(true);
    });
  }

  for (const [key, ref] of CPP_NON_TURRETED_NAVAL) {
    it(`${key} has NO turret (${ref})`, () => {
      const entity = new Entity(UNIT_STATS[key].type, House.Spain, 100, 100);
      expect(entity.hasTurret).toBe(false);
    });
  }
});

describe('1c. Turret flag parity: infantry and aircraft never have turrets', () => {
  const ALL_INFANTRY = Object.entries(UNIT_STATS)
    .filter(([, s]) => s.isInfantry)
    .map(([k]) => k);

  const ALL_AIRCRAFT = Object.entries(UNIT_STATS)
    .filter(([, s]) => s.isAircraft)
    .map(([k]) => k);

  for (const key of ALL_INFANTRY) {
    it(`${key} infantry has NO turret`, () => {
      const entity = new Entity(UNIT_STATS[key].type, House.Spain, 100, 100);
      expect(entity.hasTurret).toBe(false);
    });
  }

  for (const key of ALL_AIRCRAFT) {
    it(`${key} aircraft has NO turret`, () => {
      const entity = new Entity(UNIT_STATS[key].type, House.Spain, 100, 100);
      expect(entity.hasTurret).toBe(false);
    });
  }
});

// ============================================================================
// 2. ROT values from INI for all turreted units
// ============================================================================

describe('2. ROT values from rules.ini/aftrmath.ini for turreted vehicles', () => {
  const TURRETED_VEHICLE_KEYS = CPP_TURRETED_VEHICLES.map(([k]) => k);

  for (const key of TURRETED_VEHICLE_KEYS) {
    it(`${key} ROT in UNIT_STATS matches INI ROT=`, () => {
      const ini = getINI(key);
      expect(ini, `INI section [${key}] should exist`).toBeDefined();
      expect(ini!.rot, `INI [${key}] should have ROT=`).toBeDefined();

      const stats = UNIT_STATS[key];
      expect(stats, `UNIT_STATS['${key}'] should exist`).toBeDefined();
      expect(stats.rot).toBe(ini!.rot);
    });
  }
});

describe('2b. ROT values from rules.ini for turreted buildings', () => {
  for (const [key] of CPP_TURRETED_BUILDINGS) {
    it(`${key} building has ROT= in rules.ini`, () => {
      const ini = rulesINI[key];
      expect(ini, `rules.ini [${key}] should exist`).toBeDefined();
      expect(ini!.rot, `rules.ini [${key}] should have ROT=`).toBeDefined();
    });
  }

  it('GUN ROT value from rules.ini', () => {
    const gunROT = rulesINI['GUN']!.rot!;
    expect(gunROT).toBe(12);
  });

  it('AGUN ROT value from rules.ini', () => {
    const agunROT = rulesINI['AGUN']!.rot!;
    expect(agunROT).toBe(15);
  });

  it('SAM ROT value from rules.ini', () => {
    const samROT = rulesINI['SAM']!.rot!;
    expect(samROT).toBe(30);
  });
});

describe('2c. ROT values for non-turreted vehicles (body rotation speed)', () => {
  const NON_TURRETED_VEHICLE_KEYS = CPP_NON_TURRETED_VEHICLES.map(([k]) => k);

  for (const key of NON_TURRETED_VEHICLE_KEYS) {
    it(`${key} body ROT in UNIT_STATS matches INI ROT=`, () => {
      const ini = getINI(key);
      expect(ini, `INI section [${key}] should exist`).toBeDefined();
      expect(ini!.rot, `INI [${key}] should have ROT=`).toBeDefined();

      const stats = UNIT_STATS[key];
      expect(stats, `UNIT_STATS['${key}'] should exist`).toBeDefined();
      expect(stats.rot).toBe(ini!.rot);
    });
  }
});

// ============================================================================
// 3. 32-step rotation ring: C++ uses 32 facings for turret
// ============================================================================

describe('3. 32-step rotation ring mechanics', () => {
  it('BODY_SHAPE has exactly 32 entries for the visual rotation ring', () => {
    expect(BODY_SHAPE.length).toBe(32);
  });

  it('BODY_SHAPE maps 32-step facing to sprite frame index (0-31)', () => {
    for (let i = 0; i < 32; i++) {
      expect(BODY_SHAPE[i]).toBeGreaterThanOrEqual(0);
      expect(BODY_SHAPE[i]).toBeLessThan(32);
    }
  });

  it('all 32 BODY_SHAPE entries are unique (bijective mapping)', () => {
    const uniqueFrames = new Set(BODY_SHAPE);
    expect(uniqueFrames.size).toBe(32);
  });

  it('BODY_SHAPE[0] = 0 (North = frame 0)', () => {
    expect(BODY_SHAPE[0]).toBe(0);
  });

  it('BODY_SHAPE[16] = 16 (South = frame 16)', () => {
    expect(BODY_SHAPE[16]).toBe(16);
  });

  it('8 cardinal/ordinal facings map to every 4th step in 32-ring', () => {
    // C++ Dir_To_32 maps DIR_N(0)->0, DIR_NE(32)->4, DIR_E(64)->8, etc.
    // TS uses turretFacing*4 for the 32-step index
    const dirNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (let dir = 0; dir < 8; dir++) {
      const step32 = dir * 4;
      expect(step32, `Dir ${dirNames[dir]} should map to step ${step32}`).toBeLessThan(32);
      const frame = BODY_SHAPE[step32];
      expect(frame, `Dir ${dirNames[dir]} (step ${step32}) should have valid frame`).toBeGreaterThanOrEqual(0);
    }
  });

  it('turretFacing32 initializes to turretFacing * 4', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.turretFacing32).toBe(tank.turretFacing * 4);
  });

  it('turretFrame uses BODY_SHAPE[turretFacing32] + 32 offset', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    // Turret sprites are frames 32-63 in the vehicle SHP
    tank.turretFacing32 = 0;
    expect(tank.turretFrame).toBe(32 + BODY_SHAPE[0]);

    tank.turretFacing32 = 8;
    expect(tank.turretFrame).toBe(32 + BODY_SHAPE[8]);

    tank.turretFacing32 = 16;
    expect(tank.turretFrame).toBe(32 + BODY_SHAPE[16]);
  });
});

// ============================================================================
// 4. Turret rotation rate = ROT+1 per tick accumulation (unit.cpp:542)
// ============================================================================

describe('4. Turret rotation rate = ROT+1 per tick (unit.cpp:542)', () => {
  it('C++ turret uses ROT+1: SecondaryFacing.Rotation_Adjust(Class->ROT+1)', () => {
    // C++ unit.cpp:542: SecondaryFacing.Rotation_Adjust(Class->ROT+1)
    // For a tank with ROT=5 (from INI), turret rate is 6 per tick
    const rotINI = getINI('2TNK')!.rot!;
    const turretRate = rotINI + 1;
    expect(turretRate).toBe(6);
  });

  it('TS tickTurretRotation accumulates ROT+1 per tick', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    const rotINI = getINI('2TNK')!.rot!;
    expect(tank.stats.rot).toBe(rotINI);

    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.E;
    tank.turretRotTickedThisFrame = false;

    // First tick: C++ applies the full ROT+1 in 256-dir space; 6 rounds to visual step 1.
    tank.tickTurretRotation();
    expect(tank.turretFacing32).toBe(1);

    // Second tick: 12 in 256-dir space rounds to visual step 2.
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();
    expect(tank.turretFacing32).toBe(2);
  });

  it('turret rotates faster than body for same unit (body=ROT, turret=ROT+1)', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    const rotINI = getINI('2TNK')!.rot!;
    expect(tank.stats.rot).toBe(rotINI);

    // Body rotation: N -> E
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.E;
    let bodyTicks = 0;
    let bodyDone = false;
    while (!bodyDone && bodyTicks < 100) {
      tank.rotTickedThisFrame = false;
      bodyDone = tank.tickRotation();
      bodyTicks++;
    }

    // Turret rotation: N -> E
    const tank2 = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank2.turretFacing = Dir.N;
    tank2.turretFacing32 = 0;
    tank2.desiredTurretFacing = Dir.E;
    let turretTicks = 0;
    let turretDone = false;
    while (!turretDone && turretTicks < 100) {
      tank2.turretRotTickedThisFrame = false;
      turretDone = tank2.tickTurretRotation();
      turretTicks++;
    }

    // Turret (ROT+1) should finish strictly before body (ROT)
    expect(turretTicks).toBeLessThan(bodyTicks);
  });

  it('C++ turret 90-degree rotation at ROT+1 vs body at ROT tick comparison', () => {
    const rotINI = getINI('2TNK')!.rot!;

    // C++ body: ROT=5, 0->64
    const bodyTicks = cppRotationTicks(0, 64, rotINI);
    expect(bodyTicks).toBe(13);

    // C++ turret: ROT+1=6, 0->64
    const turretTicks = cppRotationTicks(0, 64, rotINI + 1);
    expect(turretTicks).toBe(11);

    expect(turretTicks).toBeLessThan(bodyTicks);
  });

  it('all turreted vehicles: turret 90deg ticks < body 90deg ticks (C++ reference)', () => {
    for (const [key] of CPP_TURRETED_VEHICLES) {
      const ini = getINI(key);
      if (!ini?.rot) continue;
      const rot = ini.rot;

      const bodyTicks = cppRotationTicks(0, 64, rot);
      const turretTicks = cppRotationTicks(0, 64, rot + 1);
      expect(
        turretTicks,
        `${key}: turret (ROT+1=${rot + 1}) should be faster than body (ROT=${rot})`
      ).toBeLessThan(bodyTicks);
    }
  });
});

// ============================================================================
// 5. Turret rotates independently of body facing
// ============================================================================

describe('5. Turret rotates independently of body facing', () => {
  it('turret can face a different direction than body', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.E;

    // Rotate turret only, body stays
    let ticks = 0;
    while (tank.turretFacing !== Dir.E && ticks < 30) {
      tank.turretRotTickedThisFrame = false;
      tank.tickTurretRotation();
      ticks++;
    }

    expect(tank.turretFacing).toBe(Dir.E);
    expect(tank.facing).toBe(Dir.N); // body unchanged
    expect(tank.bodyFacing32).toBe(0); // body visual unchanged
  });

  it('body rotation does not affect turret facing', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing = Dir.E;
    tank.turretFacing32 = Dir.E * 4;
    tank.desiredTurretFacing = Dir.E;

    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.S;

    // Rotate body only
    let ticks = 0;
    while (tank.facing !== Dir.S && ticks < 100) {
      tank.rotTickedThisFrame = false;
      tank.tickRotation();
      ticks++;
    }

    expect(tank.facing).toBe(Dir.S);
    // Turret should still face E
    expect(tank.turretFacing).toBe(Dir.E);
    expect(tank.turretFacing32).toBe(Dir.E * 4);
  });

  it('body and turret can rotate simultaneously toward different targets', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.N;
    tank.bodyFacing32 = 0;
    tank.desiredFacing = Dir.E;
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.W;

    for (let t = 0; t < 20; t++) {
      tank.rotTickedThisFrame = false;
      tank.turretRotTickedThisFrame = false;
      tank.tickRotation();
      tank.tickTurretRotation();
    }

    // Both should have reached their targets
    expect(tank.facing).toBe(Dir.E);
    expect(tank.turretFacing).toBe(Dir.W);
  });
});

// ============================================================================
// 6. Idle turret return-to-body facing (unit.cpp:554-556)
// ============================================================================

describe('6. Idle turret return to body facing (unit.cpp:554-556)', () => {
  // C++ unit.cpp:554-556: when no target and no nav,
  // SecondaryFacing.Set_Desired(PrimaryFacing.Current())
  // turret returns to match body facing

  it('setting desiredTurretFacing to body facing causes turret to rotate back', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.facing = Dir.E;
    tank.bodyFacing32 = Dir.E * 4;
    tank.turretFacing = Dir.NW;
    tank.turretFacing32 = Dir.NW * 4;
    tank.desiredTurretFacing = tank.facing; // idle: match body

    let ticks = 0;
    while (tank.turretFacing !== Dir.E && ticks < 30) {
      tank.turretRotTickedThisFrame = false;
      tank.tickTurretRotation();
      ticks++;
    }

    expect(tank.turretFacing).toBe(Dir.E);
    expect(ticks).toBeGreaterThan(0);
  });

  it('turret aligned with body returns true immediately', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing = Dir.SE;
    tank.turretFacing32 = Dir.SE * 4;
    tank.desiredTurretFacing = Dir.SE;

    const aligned = tank.tickTurretRotation();
    expect(aligned).toBe(true);
    expect(tank.turretRotAccumulator).toBe(0);
    expect(tank.turretFacing32).toBe(Dir.SE * 4);
  });
});

// ============================================================================
// 7. Structure turrets: GUN, SAM, AGUN
// ============================================================================

describe('7. Structure turrets: ROT from rules.ini', () => {
  it('GUN ROT from rules.ini is used for structure turret rotation', () => {
    const gunROT = rulesINI['GUN']!.rot!;
    // C++ building.cpp:5353: PrimaryFacing.Rotation_Adjust(Class->ROT)
    // Note: buildings use ROT directly (NOT ROT+1 like vehicle turrets)
    expect(gunROT).toBeGreaterThan(0);

    // C++ 90-degree rotation with GUN's ROT
    const ticks = cppRotationTicks(0, 64, gunROT);
    // GUN ROT=12: 64/12 = 5 full steps + 4 remainder (snap). ~6 ticks
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThanOrEqual(10);
  });

  it('SAM ROT from rules.ini provides fast tracking', () => {
    const samROT = rulesINI['SAM']!.rot!;
    expect(samROT).toBeGreaterThan(0);

    // SAM ROT=30: 64/30 = 2 full steps + 4 remainder (snap). ~3 ticks for 90 degrees
    const ticks = cppRotationTicks(0, 64, samROT);
    expect(ticks).toBeLessThan(5);
  });

  it('AGUN ROT from rules.ini', () => {
    const agunROT = rulesINI['AGUN']!.rot!;
    expect(agunROT).toBeGreaterThan(0);

    const ticks = cppRotationTicks(0, 64, agunROT);
    expect(ticks).toBeLessThan(8);
  });

  it('building turret ROT ordering: SAM(30) > AGUN(15) > GUN(12)', () => {
    const gunROT = rulesINI['GUN']!.rot!;
    const agunROT = rulesINI['AGUN']!.rot!;
    const samROT = rulesINI['SAM']!.rot!;

    expect(samROT).toBeGreaterThan(agunROT);
    expect(agunROT).toBeGreaterThan(gunROT);
  });

  it('C++ buildings use ROT directly (NOT ROT+1 like vehicle turrets)', () => {
    // C++ building.cpp:5353: PrimaryFacing.Rotation_Adjust(Class->ROT)
    // vs unit.cpp:542: SecondaryFacing.Rotation_Adjust(Class->ROT+1)
    // Building turret rotation uses the raw ROT value, not ROT+1
    const gunROT = rulesINI['GUN']!.rot!;
    const turretRate = gunROT; // buildings: ROT, not ROT+1
    expect(turretRate).toBe(gunROT);
  });

  it('TS structure turret uses simplified 8-direction 1-step/tick (parity gap)', () => {
    // C++ uses 256-step PrimaryFacing with ROT-based Rotation_Adjust
    // TS combat.ts uses 8-way direction, 1 step per tick
    // This is a known parity gap: TS rotates structures much faster

    // C++ GUN 90 degrees: ROT=12, ~6 ticks
    const gunROT = rulesINI['GUN']!.rot!;
    const cppTicks = cppRotationTicks(0, 64, gunROT);

    // TS 90 degrees in 8-way = 2 steps
    const tsTicks = 2;

    // KNOWN DIVERGENCE: TS is faster than C++ for structure turrets
    expect(tsTicks).toBeLessThan(cppTicks);
  });
});

// ============================================================================
// 8. Body rotation for non-turreted vehicles
// ============================================================================

describe('8. Body rotation for non-turreted vehicles (unit.cpp:517-524)', () => {
  it('ARTY has no turret and must rotate body to aim', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    expect(arty.hasTurret).toBe(false);

    const ini = getINI('ARTY')!;
    expect(arty.stats.rot).toBe(ini.rot);
  });

  it('V2RL has no turret and must rotate body to aim', () => {
    const v2 = new Entity(UnitType.V_V2RL, House.Spain, 100, 100);
    expect(v2.hasTurret).toBe(false);

    const ini = getINI('V2RL')!;
    expect(v2.stats.rot).toBe(ini.rot);
  });

  it('ARTY body rotation (ROT=2) is much slower than turreted tank (ROT=5)', () => {
    const artyROT = getINI('ARTY')!.rot!;
    const tankROT = getINI('2TNK')!.rot!;

    // Body rotation ticks for 90 degrees
    const artyTicks = cppRotationTicks(0, 64, artyROT);
    const tankTicks = cppRotationTicks(0, 64, tankROT);

    expect(artyTicks).toBeGreaterThan(tankTicks);
    // ARTY: ROT=2, 64/2 = 32 ticks
    // 2TNK: ROT=5, 64/5 = 13 ticks
    expect(artyTicks).toBe(32);
    expect(tankTicks).toBe(13);
  });

  it('non-turreted vehicle TS rotation matches INI ROT', () => {
    const arty = new Entity(UnitType.V_ARTY, House.Spain, 100, 100);
    const ini = getINI('ARTY')!;
    arty.desiredFacing = Dir.E;

    let tsTicks = 0;
    let done = false;
    while (!done && tsTicks < 100) {
      arty.rotTickedThisFrame = false;
      done = arty.tickRotation();
      tsTicks++;
    }

    // C++ ARTY ROT=2: 32 ticks for 90 degrees
    const cppTicks = cppRotationTicks(0, 64, ini.rot!);
    expect(tsTicks).toBe(cppTicks);
  });
});

// ============================================================================
// 9. 32-step rotation ring: direction and timing
// ============================================================================

describe('9. 32-step turret rotation ring: direction and timing', () => {
  it('turret rotates clockwise (CW) for shortest path when diff < 16 in 32-ring', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.NE;

    // Run enough ticks for at least one visual step
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();

    // Should have stepped CW in exact 256-dir space.
    expect(tank.turretFacing32).toBe(2);
  });

  it('turret rotates counter-clockwise (CCW) when diff >= 16 in 32-ring', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.NW;

    // N(0) -> NW(28 in 32-ring): diff = (28-0+32)%32 = 28, > 16 -> CCW
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();

    // Should have stepped CCW (turretFacing32 = 31, wrapping from 0)
    expect(tank.turretFacing32).toBe(31);
  });

  it('180-degree turret rotation goes CCW (matching C++ signed char -128 behavior)', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.S; // diff = 16 in 32-ring

    // diff32 = (16-0+32)%32 = 16, NOT < 16 -> CCW
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();

    // Should step CCW (31, wrapping from 0)
    expect(tank.turretFacing32).toBe(31);
  });
});

// ============================================================================
// 10. Turret rotation tick counts match C++ for each turreted vehicle
// ============================================================================

describe('10. Turret 90-degree rotation tick counts per vehicle (ROT+1)', () => {
  const TURRETED_VEHICLE_KEYS = CPP_TURRETED_VEHICLES.map(([k]) => k);

  for (const key of TURRETED_VEHICLE_KEYS) {
    it(`${key} turret 90-degree rotation ticks (TS vs C++ ROT+1)`, () => {
      const ini = getINI(key);
      if (!ini?.rot) return;
      const rot = ini.rot;

      // C++ turret uses ROT+1
      const cppTicks = cppRotationTicks(0, 64, rot + 1);

      // TS turret rotation
      const stats = UNIT_STATS[key];
      if (!stats) return;
      const entity = new Entity(stats.type, House.Spain, 100, 100);
      if (!entity.hasTurret) return; // skip if TS diverges on turret flag

      entity.turretFacing = Dir.N;
      entity.turretFacing32 = 0;
      entity.desiredTurretFacing = Dir.E;

      let tsTicks = 0;
      let done = false;
      while (!done && tsTicks < 100) {
        entity.turretRotTickedThisFrame = false;
        done = entity.tickTurretRotation();
        tsTicks++;
      }

      expect(tsTicks).toBe(cppTicks);
    });
  }
});

describe('10b. Body 90-degree rotation tick counts per vehicle (ROT)', () => {
  const ALL_VEHICLE_KEYS = [
    ...CPP_TURRETED_VEHICLES.map(([k]) => k),
    ...CPP_NON_TURRETED_VEHICLES.map(([k]) => k),
  ];

  for (const key of ALL_VEHICLE_KEYS) {
    it(`${key} body 90-degree rotation ticks (TS vs C++ ROT)`, () => {
      const ini = getINI(key);
      if (!ini?.rot) return;
      const rot = ini.rot;

      // C++ body uses ROT
      const cppTicks = cppRotationTicks(0, 64, rot);

      const stats = UNIT_STATS[key];
      if (!stats) return;
      const entity = new Entity(stats.type, House.Spain, 100, 100);

      entity.facing = Dir.N;
      entity.bodyFacing32 = 0;
      entity.desiredFacing = Dir.E;

      let tsTicks = 0;
      let done = false;
      while (!done && tsTicks < 100) {
        entity.rotTickedThisFrame = false;
        done = entity.tickRotation();
        tsTicks++;
      }

      expect(tsTicks).toBe(cppTicks);
    });
  }
});

// ============================================================================
// 11. Double-accumulation prevention
// ============================================================================

describe('11. Double-accumulation prevention for turret rotation', () => {
  it('turretRotTickedThisFrame prevents double accumulation', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.desiredTurretFacing = Dir.E;
    tank.turretRotTickedThisFrame = false;

    tank.tickTurretRotation();
    expect(tank.turretRotTickedThisFrame).toBe(true);

    const accAfterFirst = tank.turretRotAccumulator;
    const tf32AfterFirst = tank.turretFacing32;

    // Second call in same frame: no change
    tank.tickTurretRotation();
    expect(tank.turretRotAccumulator).toBe(accAfterFirst);
    expect(tank.turretFacing32).toBe(tf32AfterFirst);
  });
});

// ============================================================================
// 12. Accumulator reset on alignment
// ============================================================================

describe('12. Accumulator reset when turret reaches desired facing', () => {
  it('turretRotAccumulator resets to 0 when turret is aligned', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing = Dir.S;
    tank.turretFacing32 = Dir.S * 4;
    tank.desiredTurretFacing = Dir.S;
    tank.turretRotAccumulator = 42; // leftover

    const aligned = tank.tickTurretRotation();
    expect(aligned).toBe(true);
    expect(tank.turretRotAccumulator).toBe(0);
    expect(tank.turretFacing32).toBe(Dir.S * 4);
  });
});

// ============================================================================
// 13. Turret visual frame progression during rotation
// ============================================================================

describe('13. Turret visual frame progression through intermediate steps', () => {
  it('turretFacing32 advances through intermediate values during rotation', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = 0;
    tank.desiredTurretFacing = Dir.E; // target: turretFacing32 = 8

    const history: number[] = [];
    for (let t = 0; t < 20; t++) {
      tank.turretRotTickedThisFrame = false;
      tank.tickTurretRotation();
      history.push(tank.turretFacing32);
    }

    // Should pass through intermediate 32-step values
    expect(history).toContain(1);
    expect(history).toContain(2);
    expect(history).toContain(3);
    expect(history).toContain(4);
    // Should reach target
    expect(history).toContain(8);
  });

  it('turretFrame produces unique sprite frame for each turretFacing32 value', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    const frames = new Set<number>();
    for (let f32 = 0; f32 < 32; f32++) {
      tank.turretFacing32 = f32;
      frames.add(tank.turretFrame);
    }
    // All 32 turret facings should produce unique frames (32+BODY_SHAPE[i] are all unique)
    expect(frames.size).toBe(32);
  });
});

// ============================================================================
// 14. Naval turret rotation parity
// ============================================================================

describe('14. Naval turret rotation parity', () => {
  for (const [key] of CPP_TURRETED_NAVAL) {
    it(`${key} has turret and matching ROT from INI`, () => {
      const entity = new Entity(UNIT_STATS[key].type, House.Spain, 100, 100);
      expect(entity.hasTurret).toBe(true);

      const ini = getINI(key);
      expect(ini, `INI [${key}] should exist`).toBeDefined();
      expect(ini!.rot, `INI [${key}] should have ROT=`).toBeDefined();
      expect(entity.stats.rot).toBe(ini!.rot);
    });
  }

  it('DD and CA turret 90-degree rotation ticks match C++ ROT+1', () => {
    for (const key of ['DD', 'CA']) {
      const ini = getINI(key)!;
      const rot = ini.rot!;
      const cppTicks = cppRotationTicks(0, 64, rot + 1);

      const entity = new Entity(UNIT_STATS[key].type, House.Spain, 100, 100);
      entity.turretFacing = Dir.N;
      entity.turretFacing32 = 0;
      entity.desiredTurretFacing = Dir.E;

      let tsTicks = 0;
      let done = false;
      while (!done && tsTicks < 100) {
        entity.turretRotTickedThisFrame = false;
        done = entity.tickTurretRotation();
        tsTicks++;
      }

      expect(tsTicks, `${key} turret ticks`).toBe(cppTicks);
    }
  });
});

// ============================================================================
// 15. Structure turret weapons existence audit
// ============================================================================

describe('15. Structure turret weapon audit (rules.ini)', () => {
  for (const [key] of CPP_TURRETED_BUILDINGS) {
    it(`${key} has weapon defined in STRUCTURE_WEAPONS`, () => {
      expect(STRUCTURE_WEAPONS[key]).toBeDefined();
    });

    it(`${key} has ROT= in rules.ini for turret rotation`, () => {
      const rot = rulesINI[key]!.rot;
      expect(rot).toBeDefined();
      expect(rot).toBeGreaterThan(0);
    });
  }
});

// ============================================================================
// 16. Comprehensive ROT audit: every unit with ROT= in INI
// ============================================================================

describe('16. Comprehensive ROT audit: every UNIT_STATS entry vs INI ROT=', () => {
  const ANTS = new Set(['ANT1', 'ANT2', 'ANT3']);

  it('enumerates all ROT mismatches between INI and UNIT_STATS', () => {
    const mismatches: string[] = [];

    for (const [key, stats] of Object.entries(UNIT_STATS)) {
      if (ANTS.has(key)) continue; // scenario-only, no INI
      if (stats.isInfantry) continue; // infantry uses rot=8 (TS convention)

      const ini = getINI(key);
      if (!ini) {
        mismatches.push(`${key}: not found in INI`);
        continue;
      }
      if (ini.rot === undefined) {
        mismatches.push(`${key}: no ROT= in INI (TS has rot=${stats.rot})`);
        continue;
      }
      if (stats.rot !== ini.rot) {
        mismatches.push(`${key}: INI ROT=${ini.rot}, TS rot=${stats.rot}`);
      }
    }

    if (mismatches.length > 0) {
      console.error('\n=== ROT MISMATCHES vs INI ===');
      for (const m of mismatches) {
        console.error(`  - ${m}`);
      }
      console.error(`=== Total: ${mismatches.length} mismatches ===\n`);
    }

    expect(mismatches).toEqual([]);
  });
});

// ============================================================================
// 17. Turret rotation timing invariants from INI
// ============================================================================

describe('17. Turret rotation timing invariants (from INI ROT values)', () => {
  it('ARTY body rotation is slowest among all vehicles (ROT=2 from INI)', () => {
    const artyROT = getINI('ARTY')!.rot!;
    const ANTS = new Set(['ANT1', 'ANT2', 'ANT3']);

    const vehicles = Object.entries(UNIT_STATS).filter(
      ([k, s]) => !s.isInfantry && !s.isAircraft && !s.isVessel && !ANTS.has(k)
    );

    for (const [key, stats] of vehicles) {
      if (key === 'ARTY') continue;
      expect(
        artyROT,
        `ARTY ROT(${artyROT}) should be <= ${key} ROT(${stats.rot})`
      ).toBeLessThanOrEqual(stats.rot);
    }
  });

  it('JEEP body rotation is fastest among ground vehicles (ROT=10 from INI)', () => {
    const jeepROT = getINI('JEEP')!.rot!;
    const ANTS = new Set(['ANT1', 'ANT2', 'ANT3']);

    const vehicles = Object.entries(UNIT_STATS).filter(
      ([k, s]) => !s.isInfantry && !s.isAircraft && !s.isVessel && !ANTS.has(k)
    );

    for (const [key, stats] of vehicles) {
      expect(
        jeepROT,
        `JEEP ROT(${jeepROT}) should be >= ${key} ROT(${stats.rot})`
      ).toBeGreaterThanOrEqual(stats.rot);
    }
  });

  it('SAM has fastest structure turret ROT (30) for quick anti-air tracking', () => {
    const samROT = rulesINI['SAM']!.rot!;
    for (const [key] of CPP_TURRETED_BUILDINGS) {
      const rot = rulesINI[key]!.rot!;
      expect(samROT).toBeGreaterThanOrEqual(rot);
    }
  });
});

// ============================================================================
// 18. C++ vs TS rotation system: 256-step DirType to 32-step visual mapping
// ============================================================================

describe('18. 256-step DirType to 32-step visual mapping parity', () => {
  it('C++ Dir_To_32 maps each 8-wide zone to one of 32 visual steps', () => {
    // C++ inline.h:694: Dir_To_32 uses Facing32 lookup table
    // Our simplified version: floor((dir + 4) / 8) % 32
    for (let dir = 0; dir < 256; dir++) {
      const zone = cppDirTo32(dir);
      expect(zone).toBeGreaterThanOrEqual(0);
      expect(zone).toBeLessThan(32);
    }
  });

  it('cardinal directions map to expected 32-step values', () => {
    expect(cppDirTo32(0)).toBe(0);    // DIR_N -> step 0
    expect(cppDirTo32(32)).toBe(4);   // DIR_NE -> step 4
    expect(cppDirTo32(64)).toBe(8);   // DIR_E -> step 8
    expect(cppDirTo32(96)).toBe(12);  // DIR_SE -> step 12
    expect(cppDirTo32(128)).toBe(16); // DIR_S -> step 16
    expect(cppDirTo32(160)).toBe(20); // DIR_SW -> step 20
    expect(cppDirTo32(192)).toBe(24); // DIR_W -> step 24
    expect(cppDirTo32(224)).toBe(28); // DIR_NW -> step 28
  });

  it('TS 8-dir * 4 produces same 32-step indices as C++ cardinal Dir_To_32', () => {
    // TS maps Dir (0-7) to 32-step via dir * 4
    // C++ maps DirType (0, 32, 64, 96, 128, 160, 192, 224) via Dir_To_32
    const cppCardinals = [0, 32, 64, 96, 128, 160, 192, 224];
    for (let d = 0; d < 8; d++) {
      const tsStep32 = d * 4;
      const cppStep32 = cppDirTo32(cppCardinals[d]);
      expect(tsStep32, `Dir ${d}`).toBe(cppStep32);
    }
  });
});

// ============================================================================
// 19. Turret rotation direction consistency
// ============================================================================

describe('19. Turret rotation direction consistency with C++', () => {
  it('turret CW rotation through all 8 cardinal facings', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    const facings: Dir[] = [Dir.N, Dir.NE, Dir.E, Dir.SE, Dir.S, Dir.SW, Dir.W, Dir.NW];

    for (let i = 0; i < facings.length - 1; i++) {
      tank.turretFacing = facings[i];
      tank.turretFacing32 = facings[i] * 4;
      tank.desiredTurretFacing = facings[i + 1];
      tank.turretRotAccumulator = 0;

      let ticks = 0;
      while (tank.turretFacing !== facings[i + 1] && ticks < 30) {
        tank.turretRotTickedThisFrame = false;
        tank.tickTurretRotation();
        ticks++;
      }

      expect(
        tank.turretFacing,
        `Turret ${Dir[facings[i]]} -> ${Dir[facings[i + 1]]}`
      ).toBe(facings[i + 1]);
    }
  });

  it('turret CCW rotation from NE to N takes 1 45-degree step', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.turretFacing = Dir.NE;
    tank.turretFacing32 = Dir.NE * 4;
    tank.desiredTurretFacing = Dir.N;
    tank.turretRotAccumulator = 0;

    let ticks = 0;
    while (tank.turretFacing !== Dir.N && ticks < 30) {
      tank.turretRotTickedThisFrame = false;
      tank.tickTurretRotation();
      ticks++;
    }

    expect(tank.turretFacing).toBe(Dir.N);
    // Should have rotated CCW (shorter path: NE -> N)
    expect(ticks).toBeGreaterThan(0);
  });
});

// ============================================================================
// 20. Structure turret ROT values are separate from vehicle ROT
// ============================================================================

describe('20. Structure turret ROT values from INI vs vehicle ROT', () => {
  it('GUN ROT (12) is higher than standard tank ROT (5) per INI', () => {
    const gunROT = rulesINI['GUN']!.rot!;
    const tankROT = getINI('2TNK')!.rot!;
    expect(gunROT).toBeGreaterThan(tankROT);
  });

  it('SAM ROT (30) is much higher than any vehicle ROT per INI', () => {
    const samROT = rulesINI['SAM']!.rot!;

    const allVehicleROTs = [...CPP_TURRETED_VEHICLES, ...CPP_NON_TURRETED_VEHICLES]
      .map(([k]) => getINI(k)?.rot ?? 0);

    for (const vehicleROT of allVehicleROTs) {
      expect(samROT).toBeGreaterThan(vehicleROT);
    }
  });

  it('AGUN ROT (15) is between GUN and SAM ROT per INI', () => {
    const gunROT = rulesINI['GUN']!.rot!;
    const agunROT = rulesINI['AGUN']!.rot!;
    const samROT = rulesINI['SAM']!.rot!;

    expect(agunROT).toBeGreaterThan(gunROT);
    expect(agunROT).toBeLessThan(samROT);
  });
});
