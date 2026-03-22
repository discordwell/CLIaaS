/**
 * C++ Behavioral Parity: Aftermath/Counterstrike Expansion Unit Stats Audit
 *
 * Audits ALL expansion unit stats from UNIT_STATS and WEAPON_STATS against
 * authoritative INI values (aftrmath.ini overrides rules.ini).
 *
 * INI sources:
 *   - aftrmath.ini: SHOK, MECH, STNK, CTNK, TTNK, QTNK, DTRK, MSUB
 *   - rules.ini:    V2RL, MNLY, MRJ, MGG (not overridden by aftrmath.ini)
 *
 * Tests that FAIL indicate real C++ divergences in the TS engine.
 */

import { describe, it, expect } from 'vitest';
import { UNIT_STATS, WEAPON_STATS, PRODUCTION_ITEMS } from '../engine/types';

// ============================================================================
// Helper: find production item by type code
// ============================================================================
function prodItem(type: string) {
  return PRODUCTION_ITEMS.find(p => p.type === type);
}

// ============================================================================
// Section 1: Expansion Units from aftrmath.ini
// ============================================================================

// -- SHOK (Shock Trooper) — aftrmath.ini [SHOK] lines 124-138 ----------------
describe('SHOK stats audit (aftrmath.ini [SHOK])', () => {
  const stats = UNIT_STATS.SHOK;
  const prod = prodItem('SHOK');

  it('Strength=80 (aftrmath.ini line 128)', () => {
    expect(stats.strength).toBe(80);
  });

  it('Armor=none (aftrmath.ini line 129)', () => {
    expect(stats.armor).toBe('none');
  });

  it('Speed=3 (aftrmath.ini line 132)', () => {
    expect(stats.speed).toBe(3);
  });

  it('Sight=4 (aftrmath.ini line 131)', () => {
    expect(stats.sight).toBe(4);
  });

  it('isInfantry=true (infantry unit)', () => {
    expect(stats.isInfantry).toBe(true);
  });

  it('Primary=PortaTesla (aftrmath.ini line 127)', () => {
    expect(stats.primaryWeapon).toBe('PortaTesla');
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=7 (aftrmath.ini line 130)', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(7);
  });

  it('Owner=soviet (aftrmath.ini line 133)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('soviet');
  });

  it('Cost=900 (aftrmath.ini line 134)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(900);
  });

  it('Crushable=no (aftrmath.ini line 138) — unique among infantry', () => {
    expect(stats.crushable).toBe(false);
  });

  it('NoMovingFire=yes (aftrmath.ini line 137) — must stop to fire', () => {
    // aftrmath.ini: NoMovingFire=yes
    expect(stats.noMovingFire).toBe(true);
  });
});

// -- MECH (Mechanic) — aftrmath.ini [MECH] lines 140-151 ---------------------
describe('MECH stats audit (aftrmath.ini [MECH])', () => {
  const stats = UNIT_STATS.MECH;
  const prod = prodItem('MECH');

  it('Strength=60 (aftrmath.ini line 144)', () => {
    expect(stats.strength).toBe(60);
  });

  it('Armor=none (aftrmath.ini line 145)', () => {
    expect(stats.armor).toBe('none');
  });

  it('Speed=4 (aftrmath.ini line 148)', () => {
    expect(stats.speed).toBe(4);
  });

  it('Sight=3 (aftrmath.ini line 147)', () => {
    expect(stats.sight).toBe(3);
  });

  it('isInfantry=true (infantry unit)', () => {
    expect(stats.isInfantry).toBe(true);
  });

  it('Primary=GoodWrench (aftrmath.ini line 143)', () => {
    expect(stats.primaryWeapon).toBe('GoodWrench');
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=7 (aftrmath.ini line 146)', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(7);
  });

  it('Owner=allies (aftrmath.ini line 149)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('allied');
  });

  it('Cost=950 (aftrmath.ini line 150)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(950);
  });

  it('crushable=true (default infantry, no Crushable=no override)', () => {
    expect(stats.crushable).toBe(true);
  });
});

// -- STNK (Phase Transport) — aftrmath.ini [STNK] lines 13-28 ---------------
describe('STNK stats audit (aftrmath.ini [STNK])', () => {
  const stats = UNIT_STATS.STNK;
  const prod = prodItem('STNK');

  it('Strength=200 (aftrmath.ini line 16)', () => {
    expect(stats.strength).toBe(200);
  });

  it('Armor=heavy (aftrmath.ini line 17)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed=10 (aftrmath.ini line 20)', () => {
    expect(stats.speed).toBe(10);
  });

  it('Sight=5 (aftrmath.ini line 19)', () => {
    expect(stats.sight).toBe(5);
  });

  it('ROT=5 (aftrmath.ini line 24)', () => {
    expect(stats.rot).toBe(5);
  });

  it('Primary=APTusk (aftrmath.ini line 15)', () => {
    expect(stats.primaryWeapon).toBe('APTusk');
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=-1 (aftrmath.ini line 18) — not directly buildable', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(-1);
  });

  it('Owner=allies,soviet (aftrmath.ini line 21)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('both');
  });

  it('Cost=800 (aftrmath.ini line 22)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(800);
  });

  it('Passengers=1 (aftrmath.ini line 26)', () => {
    expect(stats.passengers).toBe(1);
  });

  it('Cloakable=yes (aftrmath.ini line 27)', () => {
    expect(stats.isCloakable).toBe(true);
  });

  it('Tracked=yes (aftrmath.ini line 25) — crusher', () => {
    expect(stats.crusher).toBe(true);
  });

  it('isInfantry=false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });
});

// -- CTNK (Chrono Tank) — aftrmath.ini [CTNK] lines 45-58 -------------------
describe('CTNK stats audit (aftrmath.ini [CTNK])', () => {
  const stats = UNIT_STATS.CTNK;
  const prod = prodItem('CTNK');

  it('Strength=350 (aftrmath.ini line 49)', () => {
    expect(stats.strength).toBe(350);
  });

  it('Armor=light (aftrmath.ini line 50) — unusual for a tank', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed=5 (aftrmath.ini line 53)', () => {
    expect(stats.speed).toBe(5);
  });

  it('Sight=5 (aftrmath.ini line 52)', () => {
    expect(stats.sight).toBe(5);
  });

  it('ROT=5 (aftrmath.ini line 57)', () => {
    expect(stats.rot).toBe(5);
  });

  it('Primary=APTusk (aftrmath.ini line 48)', () => {
    expect(stats.primaryWeapon).toBe('APTusk');
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=12 (aftrmath.ini line 51)', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(12);
  });

  it('Owner=allies (aftrmath.ini line 54)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('allied');
  });

  it('Cost=2400 (aftrmath.ini line 55)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(2400);
  });

  it('Tracked=yes (aftrmath.ini line 58) — crusher', () => {
    expect(stats.crusher).toBe(true);
  });

  it('isInfantry=false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });
});

// -- TTNK (Tesla Tank) — aftrmath.ini [TTNK] lines 60-74 --------------------
describe('TTNK stats audit (aftrmath.ini [TTNK])', () => {
  const stats = UNIT_STATS.TTNK;
  const prod = prodItem('TTNK');

  it('Strength=110 (aftrmath.ini line 64)', () => {
    expect(stats.strength).toBe(110);
  });

  it('Armor=light (aftrmath.ini line 65)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed=8 (aftrmath.ini line 68)', () => {
    expect(stats.speed).toBe(8);
  });

  it('Sight=7 (aftrmath.ini line 67)', () => {
    expect(stats.sight).toBe(7);
  });

  it('ROT=5 (aftrmath.ini line 72)', () => {
    expect(stats.rot).toBe(5);
  });

  it('Primary=TTankZap (aftrmath.ini line 63)', () => {
    expect(stats.primaryWeapon).toBe('TTankZap');
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=8 (aftrmath.ini line 66)', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(8);
  });

  it('Owner=soviet (aftrmath.ini line 69)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('soviet');
  });

  it('Cost=1500 (aftrmath.ini line 70)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(1500);
  });

  it('Tracked=yes (aftrmath.ini line 73) — crusher', () => {
    expect(stats.crusher).toBe(true);
  });

  it('NoMovingFire=yes (aftrmath.ini line 75) — must stop to fire', () => {
    // aftrmath.ini: NoMovingFire=yes for TTNK
    expect(stats.noMovingFire).toBe(true);
  });

  it('isInfantry=false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });
});

// -- QTNK (M.A.D. Tank) — aftrmath.ini [QTNK] lines 92-106 -----------------
describe('QTNK stats audit (aftrmath.ini [QTNK])', () => {
  const stats = UNIT_STATS.QTNK;
  const prod = prodItem('QTNK');

  it('Strength=300 (aftrmath.ini line 97)', () => {
    expect(stats.strength).toBe(300);
  });

  it('Armor=heavy (aftrmath.ini line 98)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed=3 (aftrmath.ini line 100)', () => {
    expect(stats.speed).toBe(3);
  });

  it('Sight=6 (aftrmath.ini line 99)', () => {
    expect(stats.sight).toBe(6);
  });

  it('ROT=5 (aftrmath.ini line 104)', () => {
    expect(stats.rot).toBe(5);
  });

  it('Primary=none (aftrmath.ini line 95) — no conventional weapon', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=10 (aftrmath.ini line 98)', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(10);
  });

  it('Owner=soviet (aftrmath.ini line 101)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('soviet');
  });

  it('Cost=2300 (aftrmath.ini line 102)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(2300);
  });

  it('Tracked=yes (aftrmath.ini line 105) — crusher', () => {
    expect(stats.crusher).toBe(true);
  });

  it('isInfantry=false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });
});

// -- DTRK (Demo Truck) — aftrmath.ini [DTRK] lines 77-90 --------------------
describe('DTRK stats audit (aftrmath.ini [DTRK])', () => {
  const stats = UNIT_STATS.DTRK;
  const prod = prodItem('DTRK');

  it('Strength=110 (aftrmath.ini line 82)', () => {
    expect(stats.strength).toBe(110);
  });

  it('Armor=light (aftrmath.ini line 83)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed=8 (aftrmath.ini line 85)', () => {
    expect(stats.speed).toBe(8);
  });

  it('Sight=3 (aftrmath.ini line 84)', () => {
    expect(stats.sight).toBe(3);
  });

  it('ROT=5 (aftrmath.ini line 89)', () => {
    expect(stats.rot).toBe(5);
  });

  it('Primary=Democharge (aftrmath.ini line 80)', () => {
    expect(stats.primaryWeapon).toBe('Democharge');
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=13 (aftrmath.ini line 83)', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(13);
  });

  it('Owner=allies,soviet (aftrmath.ini line 86)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('both');
  });

  it('Cost=2400 (aftrmath.ini line 87)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(2400);
  });

  it('isInfantry=false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('not a crusher — no Tracked=yes in aftrmath.ini', () => {
    // aftrmath.ini DTRK section has no Tracked=yes line
    expect(stats.crusher ?? false).toBe(false);
  });
});

// -- MSUB (Missile Sub) — aftrmath.ini [MSUB] lines 108-122 ------------------
describe('MSUB stats audit (aftrmath.ini [MSUB])', () => {
  const stats = UNIT_STATS.MSUB;
  const prod = prodItem('MSUB');

  it('Strength=150 (aftrmath.ini line 112)', () => {
    expect(stats.strength).toBe(150);
  });

  it('Armor=light (aftrmath.ini line 113)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed=5 (aftrmath.ini line 116)', () => {
    expect(stats.speed).toBe(5);
  });

  it('Sight=6 (aftrmath.ini line 115)', () => {
    expect(stats.sight).toBe(6);
  });

  it('ROT=7 (aftrmath.ini line 120)', () => {
    expect(stats.rot).toBe(7);
  });

  it('Primary=SubSCUD (aftrmath.ini line 111)', () => {
    expect(stats.primaryWeapon).toBe('SubSCUD');
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=9 (aftrmath.ini line 114)', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(9);
  });

  it('Owner=soviet (aftrmath.ini line 117)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('soviet');
  });

  it('Cost=1650 (aftrmath.ini line 118)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(1650);
  });

  it('Cloakable=yes (aftrmath.ini line 121)', () => {
    expect(stats.isCloakable).toBe(true);
  });

  it('isVessel=true (naval unit)', () => {
    expect(stats.isVessel).toBe(true);
  });

  it('isInfantry=false', () => {
    expect(stats.isInfantry).toBe(false);
  });
});

// ============================================================================
// Section 2: Base-game Units Relevant to Expansion (from rules.ini only)
// ============================================================================

// -- V2RL (V2 Rocket Launcher) — rules.ini [V2RL] lines 481-496 --------------
describe('V2RL stats audit (rules.ini [V2RL])', () => {
  const stats = UNIT_STATS.V2RL;
  const prod = prodItem('V2RL');

  it('Strength=150 (rules.ini line 484)', () => {
    expect(stats.strength).toBe(150);
  });

  it('Armor=light (rules.ini line 485)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed=7 (rules.ini line 488)', () => {
    expect(stats.speed).toBe(7);
  });

  it('Sight=5 (rules.ini line 487)', () => {
    expect(stats.sight).toBe(5);
  });

  it('ROT=5 (rules.ini line 492)', () => {
    expect(stats.rot).toBe(5);
  });

  it('Primary=SCUD (rules.ini line 483)', () => {
    expect(stats.primaryWeapon).toBe('SCUD');
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=4 (rules.ini line 486)', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(4);
  });

  it('Owner=soviet (rules.ini line 489)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('soviet');
  });

  it('Cost=700 (rules.ini line 490)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(700);
  });

  it('Tracked=yes (rules.ini line 493) — crusher', () => {
    expect(stats.crusher).toBe(true);
  });

  it('Ammo=1 (rules.ini line 494) — single shot before reload', () => {
    expect(stats.maxAmmo).toBe(1);
  });

  it('NoMovingFire=yes (rules.ini line 496) — must stop to fire', () => {
    expect(stats.noMovingFire).toBe(true);
  });

  it('isInfantry=false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });
});

// -- MNLY (Minelayer) — rules.ini [MNLY] lines 673-686 -----------------------
describe('MNLY stats audit (rules.ini [MNLY])', () => {
  const stats = UNIT_STATS.MNLY;
  const prod = prodItem('MNLY');

  it('Strength=100 (rules.ini line 675)', () => {
    expect(stats.strength).toBe(100);
  });

  it('Armor=heavy (rules.ini line 676)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed=9 (rules.ini line 679)', () => {
    expect(stats.speed).toBe(9);
  });

  it('Sight=5 (rules.ini line 678)', () => {
    expect(stats.sight).toBe(5);
  });

  it('ROT=5 (rules.ini line 683)', () => {
    expect(stats.rot).toBe(5);
  });

  it('no primary weapon (minelayer drops mines, no direct fire)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=3 (rules.ini line 677)', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(3);
  });

  it('Owner=allies,soviet (rules.ini line 680)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('both');
  });

  it('Cost=800 (rules.ini line 681)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(800);
  });

  it('Tracked=yes (rules.ini line 684) — crusher', () => {
    expect(stats.crusher).toBe(true);
  });

  it('Ammo=5 (rules.ini line 685) — 5 mines carried', () => {
    expect(stats.maxAmmo).toBe(5);
  });

  it('isInfantry=false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });
});

// -- MRJ (Radar Jammer) — rules.ini [MRJ] lines 566-578 ----------------------
describe('MRJ stats audit (rules.ini [MRJ])', () => {
  const stats = UNIT_STATS.MRJ;
  const prod = prodItem('MRJ');

  it('Strength=110 (rules.ini line 568)', () => {
    expect(stats.strength).toBe(110);
  });

  it('Armor=light (rules.ini line 569)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed=9 (rules.ini line 572)', () => {
    expect(stats.speed).toBe(9);
  });

  it('Sight=7 (rules.ini line 571)', () => {
    expect(stats.sight).toBe(7);
  });

  it('ROT=5 (rules.ini line 576)', () => {
    expect(stats.rot).toBe(5);
  });

  it('no primary weapon (jamming is passive)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=12 (rules.ini line 570)', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(12);
  });

  it('Owner=allies (rules.ini line 573)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('allied');
  });

  it('Cost=600 (rules.ini line 574)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(600);
  });

  it('Tracked=yes (rules.ini line 577) — crusher', () => {
    expect(stats.crusher).toBe(true);
  });

  it('isInfantry=false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });
});

// -- MGG (Mobile Gap Generator) — rules.ini [MGG] lines 581-592 --------------
describe('MGG stats audit (rules.ini [MGG])', () => {
  const stats = UNIT_STATS.MGG;
  const prod = prodItem('MGG');

  it('Strength=110 (rules.ini line 583)', () => {
    expect(stats.strength).toBe(110);
  });

  it('Armor=light (rules.ini line 584)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed=9 (rules.ini line 587)', () => {
    expect(stats.speed).toBe(9);
  });

  it('Sight=4 (rules.ini line 586)', () => {
    expect(stats.sight).toBe(4);
  });

  it('ROT=5 (rules.ini line 591)', () => {
    expect(stats.rot).toBe(5);
  });

  it('no primary weapon (gap generation is passive)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon ?? null).toBeNull();
  });

  it('TechLevel=11 (rules.ini line 585)', () => {
    expect(prod).toBeDefined();
    expect(prod!.techLevel).toBe(11);
  });

  it('Owner=allies (rules.ini line 588)', () => {
    expect(prod).toBeDefined();
    expect(prod!.faction).toBe('allied');
  });

  it('Cost=600 (rules.ini line 589)', () => {
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(600);
  });

  it('IS a crusher (C++ udata.cpp:265 IsCrusher=true)', () => {
    // C++ udata.cpp:265 IsCrusher=true — crusher despite no Tracked=yes in rules.ini
    expect(stats.crusher).toBe(true);
  });

  it('isInfantry=false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });
});

// ============================================================================
// Section 3: Expansion Weapon Stats Audit (aftrmath.ini weapon sections)
// ============================================================================

// -- PortaTesla — aftrmath.ini [PortaTesla] lines 162-171 --------------------
describe('PortaTesla weapon audit (aftrmath.ini [PortaTesla])', () => {
  const w = WEAPON_STATS.PortaTesla;

  it('Damage=45 (aftrmath.ini line 164)', () => {
    expect(w.damage).toBe(45);
  });

  it('ROF=70 (aftrmath.ini line 165)', () => {
    expect(w.rof).toBe(70);
  });

  it('Range=3.5 (aftrmath.ini line 166)', () => {
    expect(w.range).toBe(3.5);
  });

  it('Warhead=Super (aftrmath.ini line 169)', () => {
    expect(w.warhead).toBe('Super');
  });

  it('Speed=100 (aftrmath.ini line 168)', () => {
    expect(w.projSpeed).toBe(100);
  });

  it('Projectile=Invisible (aftrmath.ini line 167)', () => {
    expect(w.isInvisible).toBe(true);
  });
});

// -- TTankZap — aftrmath.ini [TTankZap] lines 173-182 ------------------------
describe('TTankZap weapon audit (aftrmath.ini [TTankZap])', () => {
  const w = WEAPON_STATS.TTankZap;

  it('Damage=100 (aftrmath.ini line 175)', () => {
    expect(w.damage).toBe(100);
  });

  it('ROF=120 (aftrmath.ini line 176)', () => {
    expect(w.rof).toBe(120);
  });

  it('Range=7 (aftrmath.ini line 177)', () => {
    expect(w.range).toBe(7.0);
  });

  it('Warhead=Super (aftrmath.ini line 180)', () => {
    expect(w.warhead).toBe('Super');
  });

  it('Speed=100 (aftrmath.ini line 179)', () => {
    expect(w.projSpeed).toBe(100);
  });

  it('Projectile=Invisible (aftrmath.ini line 178)', () => {
    expect(w.isInvisible).toBe(true);
  });
});

// -- GoodWrench — aftrmath.ini [GoodWrench] lines 184-192 --------------------
describe('GoodWrench weapon audit (aftrmath.ini [GoodWrench])', () => {
  const w = WEAPON_STATS.GoodWrench;

  it('Damage=-100 (aftrmath.ini line 186) — negative = healing', () => {
    expect(w.damage).toBe(-100);
  });

  it('ROF=80 (aftrmath.ini line 187)', () => {
    expect(w.rof).toBe(80);
  });

  it('Range=1.83 (aftrmath.ini line 188)', () => {
    expect(w.range).toBe(1.83);
  });

  it('Warhead=Mechanical (aftrmath.ini line 191)', () => {
    expect(w.warhead).toBe('Mechanical');
  });

  it('Speed=100 (aftrmath.ini line 190)', () => {
    expect(w.projSpeed).toBe(100);
  });

  it('Projectile=Invisible (aftrmath.ini line 189)', () => {
    expect(w.isInvisible).toBe(true);
  });
});

// -- APTusk — aftrmath.ini [APTusk] lines 211-220 ----------------------------
describe('APTusk weapon audit (aftrmath.ini [APTusk])', () => {
  const w = WEAPON_STATS.APTusk;

  it('Damage=75 (aftrmath.ini line 213)', () => {
    expect(w.damage).toBe(75);
  });

  it('ROF=80 (aftrmath.ini line 214)', () => {
    expect(w.rof).toBe(80);
  });

  it('Range=5 (aftrmath.ini line 215)', () => {
    expect(w.range).toBe(5.0);
  });

  it('Warhead=AP (aftrmath.ini line 218)', () => {
    expect(w.warhead).toBe('AP');
  });

  it('Speed=30 (aftrmath.ini line 217)', () => {
    expect(w.projSpeed).toBe(30);
  });

  it('Burst=2 (aftrmath.ini line 220)', () => {
    expect(w.burst).toBe(2);
  });

  it('Projectile=HeatSeeker (aftrmath.ini line 216) — isHigh + isInaccurate + isFueled', () => {
    expect(w.isHigh).toBe(true);
    expect(w.isInaccurate).toBe(true);
    expect(w.isFueled).toBe(true);
  });
});

// -- SubSCUD — aftrmath.ini [SubSCUD] lines 200-209 --------------------------
describe('SubSCUD weapon audit (aftrmath.ini [SubSCUD])', () => {
  const w = WEAPON_STATS.SubSCUD;

  it('Damage=400 (aftrmath.ini line 202)', () => {
    expect(w.damage).toBe(400);
  });

  it('ROF=120 (aftrmath.ini line 203)', () => {
    expect(w.rof).toBe(120);
  });

  it('Range=14 (aftrmath.ini line 204)', () => {
    expect(w.range).toBe(14.0);
  });

  it('Warhead=HE (aftrmath.ini line 207)', () => {
    expect(w.warhead).toBe('HE');
  });

  it('Speed=20 (aftrmath.ini line 206)', () => {
    expect(w.projSpeed).toBe(20);
  });

  it('Burst=2 (aftrmath.ini line 209)', () => {
    expect(w.burst).toBe(2);
  });

  it('Projectile=HeatSeeker (aftrmath.ini line 205) — homing missile', () => {
    expect(w.isHigh).toBe(true);
    expect(w.isFueled).toBe(true);
  });
});

// -- Democharge — aftrmath.ini [Democharge] lines 222-230 --------------------
describe('Democharge weapon audit (aftrmath.ini [Democharge])', () => {
  const w = WEAPON_STATS.Democharge;

  it('Damage=500 (aftrmath.ini line 225)', () => {
    expect(w.damage).toBe(500);
  });

  it('ROF=80 (aftrmath.ini line 230)', () => {
    expect(w.rof).toBe(80);
  });

  it('Range=1.75 (aftrmath.ini line 227)', () => {
    expect(w.range).toBe(1.75);
  });

  it('Warhead=Nuke (aftrmath.ini line 229)', () => {
    expect(w.warhead).toBe('Nuke');
  });

  it('Speed=100 (aftrmath.ini line 226)', () => {
    expect(w.projSpeed).toBe(100);
  });

  it('Projectile=Invisible (aftrmath.ini line 228)', () => {
    expect(w.isInvisible).toBe(true);
  });
});

// ============================================================================
// Section 4: Cross-unit Comparisons (sanity checks)
// ============================================================================

describe('Expansion unit cross-comparisons (INI sanity)', () => {
  it('STNK is faster than CTNK (10 vs 5)', () => {
    expect(UNIT_STATS.STNK.speed).toBeGreaterThan(UNIT_STATS.CTNK.speed);
  });

  it('QTNK is slowest expansion vehicle (Speed=3)', () => {
    const expansionVehicles = ['STNK', 'CTNK', 'TTNK', 'QTNK', 'DTRK', 'MSUB'];
    for (const id of expansionVehicles) {
      expect(UNIT_STATS[id].speed).toBeGreaterThanOrEqual(UNIT_STATS.QTNK.speed);
    }
  });

  it('QTNK has no primary weapon (M.A.D. ability, not conventional)', () => {
    expect(UNIT_STATS.QTNK.primaryWeapon).toBeNull();
  });

  it('only STNK and MSUB are cloakable among expansion units', () => {
    expect(UNIT_STATS.STNK.isCloakable).toBe(true);
    expect(UNIT_STATS.MSUB.isCloakable).toBe(true);
    expect(UNIT_STATS.CTNK.isCloakable ?? false).toBe(false);
    expect(UNIT_STATS.TTNK.isCloakable ?? false).toBe(false);
    expect(UNIT_STATS.QTNK.isCloakable ?? false).toBe(false);
    expect(UNIT_STATS.DTRK.isCloakable ?? false).toBe(false);
  });

  it('only STNK has passengers among expansion vehicles', () => {
    expect(UNIT_STATS.STNK.passengers).toBe(1);
    expect(UNIT_STATS.CTNK.passengers ?? 0).toBe(0);
    expect(UNIT_STATS.TTNK.passengers ?? 0).toBe(0);
    expect(UNIT_STATS.QTNK.passengers ?? 0).toBe(0);
    expect(UNIT_STATS.DTRK.passengers ?? 0).toBe(0);
  });

  it('SHOK is the only infantry with crushable=false', () => {
    // All other infantry default to crushable=true
    expect(UNIT_STATS.SHOK.crushable).toBe(false);
    expect(UNIT_STATS.MECH.crushable).toBe(true);
    expect(UNIT_STATS.E1.crushable).toBe(true);
    expect(UNIT_STATS.E2.crushable).toBe(true);
    expect(UNIT_STATS.E3.crushable).toBe(true);
  });

  it('SubSCUD has the longest range of all expansion weapons (14 cells)', () => {
    const expansionWeapons = ['PortaTesla', 'TTankZap', 'GoodWrench', 'APTusk', 'SubSCUD', 'Democharge'];
    for (const wName of expansionWeapons) {
      expect(WEAPON_STATS[wName].range).toBeLessThanOrEqual(WEAPON_STATS.SubSCUD.range);
    }
  });

  it('Democharge does the most damage of expansion weapons (500)', () => {
    // SubSCUD=400, Democharge=500 (TTankZap=100, APTusk=75, PortaTesla=45, GoodWrench=-100)
    expect(WEAPON_STATS.Democharge.damage).toBeGreaterThan(WEAPON_STATS.SubSCUD.damage);
    expect(WEAPON_STATS.Democharge.damage).toBe(500);
  });
});
