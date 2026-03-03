/**
 * Data parity tests — verify all UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR,
 * STRUCTURE_MAX_HP, SUPERWEAPON_DEFS, and PRODUCTION_ITEMS match C++ source values.
 */
import { describe, it, expect } from 'vitest';
import {
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, WARHEAD_PROPS, WARHEAD_META,
  SUPERWEAPON_DEFS, SuperweaponType, IRON_CURTAIN_DURATION,
  PRODUCTION_ITEMS, UnitType,
} from '../engine/types';
import { STRUCTURE_MAX_HP } from '../engine/scenario';

// ============================================================
// UNIT_STATS parity
// ============================================================
describe('UNIT_STATS parity', () => {
  // --- Infantry ---
  describe('Infantry', () => {
    it('E1 (Rifle Infantry)', () => {
      const u = UNIT_STATS.E1;
      expect(u.strength).toBe(50);
      expect(u.speed).toBe(4);
      expect(u.armor).toBe('none');
      expect(u.sight).toBe(4);
      expect(u.rot).toBe(8);
      expect(u.primaryWeapon).toBe('M1Carbine');
      expect(u.isInfantry).toBe(true);
    });

    it('E2 (Grenadier) — soviet owner', () => {
      const u = UNIT_STATS.E2;
      expect(u.strength).toBe(50);
      expect(u.speed).toBe(5);
      expect(u.armor).toBe('none');
      expect(u.primaryWeapon).toBe('Grenade');
      expect(u.owner).toBe('soviet');
    });

    it('E3 (Rocket Soldier) — weapons swapped, allied owner', () => {
      const u = UNIT_STATS.E3;
      expect(u.strength).toBe(45);
      expect(u.speed).toBe(3);
      expect(u.primaryWeapon).toBe('RedEye');
      expect(u.secondaryWeapon).toBe('Dragon');
      expect(u.owner).toBe('allied');
    });

    it('E4 (Flamethrower)', () => {
      const u = UNIT_STATS.E4;
      expect(u.strength).toBe(40);
      expect(u.speed).toBe(3);
      expect(u.primaryWeapon).toBe('Flamer');
    });

    it('E6 (Engineer)', () => {
      const u = UNIT_STATS.E6;
      expect(u.strength).toBe(25);
      expect(u.speed).toBe(4);
      expect(u.primaryWeapon).toBeNull();
    });

    it('DOG (Attack Dog)', () => {
      const u = UNIT_STATS.DOG;
      expect(u.strength).toBe(12);
      expect(u.speed).toBe(4);
      expect(u.sight).toBe(5);
      expect(u.primaryWeapon).toBe('DogJaw');
    });

    it('GNRL (Stavros) — strength=80, speed=5, sight=3, no weapon', () => {
      const u = UNIT_STATS.GNRL;
      expect(u.strength).toBe(80);
      expect(u.speed).toBe(5);
      expect(u.sight).toBe(3);
      expect(u.primaryWeapon).toBeNull();
    });

    it('CHAN (Specialist) — strength=25, speed=5, sight=2', () => {
      const u = UNIT_STATS.CHAN;
      expect(u.strength).toBe(25);
      expect(u.speed).toBe(5);
      expect(u.sight).toBe(2);
    });

    it('SPY — sight=5', () => {
      const u = UNIT_STATS.SPY;
      expect(u.strength).toBe(25);
      expect(u.sight).toBe(5);
    });

    it('MEDI (Medic)', () => {
      const u = UNIT_STATS.MEDI;
      expect(u.strength).toBe(80);
      expect(u.primaryWeapon).toBe('Heal');
    });

    it('SHOK (Shock Trooper)', () => {
      const u = UNIT_STATS.SHOK;
      expect(u.strength).toBe(80);
      expect(u.primaryWeapon).toBe('PortaTesla');
    });

    it('MECH (Mechanic) — strength=60', () => {
      const u = UNIT_STATS.MECH;
      expect(u.strength).toBe(60);
      expect(u.primaryWeapon).toBe('GoodWrench');
    });

    it('E7 (Tanya) — new entry', () => {
      const u = UNIT_STATS.E7;
      expect(u).toBeDefined();
      expect(u.strength).toBe(100);
      expect(u.speed).toBe(6);
      expect(u.armor).toBe('none');
      expect(u.sight).toBe(5);
      expect(u.rot).toBe(8);
      expect(u.primaryWeapon).toBe('Colt45');
      expect(u.secondaryWeapon).toBeNull();
      expect(u.isInfantry).toBe(true);
      expect(u.owner).toBe('allied');
    });

    it('THF (Thief) — new entry', () => {
      const u = UNIT_STATS.THF;
      expect(u).toBeDefined();
      expect(u.strength).toBe(25);
      expect(u.speed).toBe(6);
      expect(u.armor).toBe('none');
      expect(u.sight).toBe(4);
      expect(u.primaryWeapon).toBeNull();
      expect(u.owner).toBe('allied');
    });

    it('Civilians (C1-C10) — strength=25, speed=5', () => {
      for (let i = 1; i <= 10; i++) {
        const key = `C${i}`;
        const u = UNIT_STATS[key];
        expect(u, `${key} should exist`).toBeDefined();
        expect(u.strength, `${key}.strength`).toBe(25);
        expect(u.speed, `${key}.speed`).toBe(5);
        expect(u.isInfantry, `${key}.isInfantry`).toBe(true);
      }
    });
  });

  // --- Vehicles ---
  describe('Vehicles', () => {
    it('1TNK (Light Tank)', () => {
      const u = UNIT_STATS['1TNK'];
      expect(u.strength).toBe(300);
      expect(u.speed).toBe(9);
      expect(u.armor).toBe('heavy');
      expect(u.primaryWeapon).toBe('75mm');
      expect(u.crusher).toBe(true);
    });

    it('2TNK (Medium Tank)', () => {
      const u = UNIT_STATS['2TNK'];
      expect(u.strength).toBe(400);
      expect(u.speed).toBe(8);
      expect(u.primaryWeapon).toBe('90mm');
    });

    it('3TNK (Heavy Tank) — has secondary weapon 105mm', () => {
      const u = UNIT_STATS['3TNK'];
      expect(u.strength).toBe(400);
      expect(u.speed).toBe(7);
      expect(u.primaryWeapon).toBe('105mm');
      expect(u.secondaryWeapon).toBe('105mm');
    });

    it('4TNK (Mammoth Tank)', () => {
      const u = UNIT_STATS['4TNK'];
      expect(u.strength).toBe(600);
      expect(u.speed).toBe(4);
      expect(u.primaryWeapon).toBe('120mm');
      expect(u.secondaryWeapon).toBe('MammothTusk');
    });

    it('JEEP (Ranger)', () => {
      const u = UNIT_STATS.JEEP;
      expect(u.strength).toBe(150);
      expect(u.speed).toBe(10);
      expect(u.armor).toBe('light');
    });

    it('APC', () => {
      const u = UNIT_STATS.APC;
      expect(u.strength).toBe(200);
      expect(u.speed).toBe(10);
      expect(u.passengers).toBe(5);
    });

    it('ARTY (Artillery)', () => {
      const u = UNIT_STATS.ARTY;
      expect(u.strength).toBe(75);
      expect(u.speed).toBe(6);
      expect(u.primaryWeapon).toBe('155mm');
    });

    it('TRUK (Supply Truck) — armor=light, speed=10, sight=3', () => {
      const u = UNIT_STATS.TRUK;
      expect(u.strength).toBe(110);
      expect(u.armor).toBe('light');
      expect(u.speed).toBe(10);
      expect(u.sight).toBe(3);
    });

    it('TTNK (Tesla Tank) — strength=110, speed=8, sight=7', () => {
      const u = UNIT_STATS.TTNK;
      expect(u.strength).toBe(110);
      expect(u.speed).toBe(8);
      expect(u.sight).toBe(7);
      expect(u.primaryWeapon).toBe('TTankZap');
    });

    it('CTNK (Chrono Tank) — strength=350, speed=5, armor=light, weapon=APTusk', () => {
      const u = UNIT_STATS.CTNK;
      expect(u.strength).toBe(350);
      expect(u.speed).toBe(5);
      expect(u.armor).toBe('light');
      expect(u.primaryWeapon).toBe('APTusk');
    });

    it('QTNK (MAD Tank) — strength=300, speed=3, sight=6', () => {
      const u = UNIT_STATS.QTNK;
      expect(u.strength).toBe(300);
      expect(u.speed).toBe(3);
      expect(u.sight).toBe(6);
    });

    it('DTRK (Demo Truck) — strength=110, armor=light, speed=8', () => {
      const u = UNIT_STATS.DTRK;
      expect(u.strength).toBe(110);
      expect(u.armor).toBe('light');
      expect(u.speed).toBe(8);
    });

    it('STNK (Phase Transport) — has crusher and isCloakable', () => {
      const u = UNIT_STATS.STNK;
      expect(u.strength).toBe(110);
      expect(u.crusher).toBe(true);
      expect(u.isCloakable).toBe(true);
    });

    it('V2RL (V2 Rocket) — new entry', () => {
      const u = UNIT_STATS.V2RL;
      expect(u).toBeDefined();
      expect(u.strength).toBe(150);
      expect(u.speed).toBe(7);
      expect(u.armor).toBe('light');
      expect(u.sight).toBe(6);
      expect(u.rot).toBe(3);
      expect(u.primaryWeapon).toBe('SCUD');
      expect(u.owner).toBe('soviet');
    });

    it('MNLY (Minelayer) — new entry', () => {
      const u = UNIT_STATS.MNLY;
      expect(u).toBeDefined();
      expect(u.strength).toBe(110);
      expect(u.speed).toBe(8);
      expect(u.armor).toBe('light');
      expect(u.primaryWeapon).toBeNull();
      expect(u.owner).toBe('allied');
    });

    it('MRLS — new entry', () => {
      const u = UNIT_STATS.MRLS;
      expect(u).toBeDefined();
      expect(u.strength).toBe(75);
      expect(u.speed).toBe(9);
      expect(u.armor).toBe('light');
      expect(u.primaryWeapon).toBe('Nike');
      expect(u.secondaryWeapon).toBe('Nike');
      expect(u.owner).toBe('allied');
    });
  });

  // --- Naval ---
  describe('Naval', () => {
    it('DD (Destroyer) — ROT=5, sight=5, speed=12', () => {
      const u = UNIT_STATS.DD;
      expect(u.strength).toBe(400);
      expect(u.speed).toBe(12);
      expect(u.sight).toBe(5);
      expect(u.rot).toBe(5);
      expect(u.primaryWeapon).toBe('Stinger');
      expect(u.secondaryWeapon).toBe('DepthCharge');
    });

    it('CA (Cruiser) — ROT=3, sight=8, speed=8, weapon=8Inch', () => {
      const u = UNIT_STATS.CA;
      expect(u.strength).toBe(700);
      expect(u.speed).toBe(8);
      expect(u.sight).toBe(8);
      expect(u.rot).toBe(3);
      expect(u.primaryWeapon).toBe('8Inch');
    });

    it('SS (Submarine) — ROT=3, sight=5, speed=6', () => {
      const u = UNIT_STATS.SS;
      expect(u.strength).toBe(120);
      expect(u.speed).toBe(6);
      expect(u.sight).toBe(5);
      expect(u.rot).toBe(3);
      expect(u.isCloakable).toBe(true);
    });

    it('MSUB (Missile Sub) — ROT=3, sight=5, speed=6', () => {
      const u = UNIT_STATS.MSUB;
      expect(u.strength).toBe(150);
      expect(u.speed).toBe(6);
      expect(u.sight).toBe(5);
      expect(u.rot).toBe(3);
    });

    it('PT (Gunboat) — ROT=5, sight=5, speed=14, weapon=2Inch', () => {
      const u = UNIT_STATS.PT;
      expect(u.strength).toBe(200);
      expect(u.speed).toBe(14);
      expect(u.sight).toBe(5);
      expect(u.rot).toBe(5);
      expect(u.primaryWeapon).toBe('2Inch');
    });

    it('LST (Transport) — ROT=4, sight=4, speed=10', () => {
      const u = UNIT_STATS.LST;
      expect(u.strength).toBe(400);
      expect(u.speed).toBe(10);
      expect(u.sight).toBe(4);
      expect(u.rot).toBe(4);
    });
  });

  // --- Aircraft ---
  describe('Aircraft', () => {
    it('HELI (Longbow) — strength=100, speed=40, ROT=8, maxAmmo=8', () => {
      const u = UNIT_STATS.HELI;
      expect(u.strength).toBe(100);
      expect(u.speed).toBe(40);
      expect(u.rot).toBe(8);
      expect(u.maxAmmo).toBe(8);
      expect(u.primaryWeapon).toBe('Hellfire');
    });

    it('HIND — strength=100, speed=40, ROT=8, maxAmmo=4, weapon=ChainGun', () => {
      const u = UNIT_STATS.HIND;
      expect(u.strength).toBe(100);
      expect(u.speed).toBe(40);
      expect(u.rot).toBe(8);
      expect(u.maxAmmo).toBe(4);
      expect(u.primaryWeapon).toBe('ChainGun');
    });

    it('TRAN (Chinook) — strength=90, speed=30, ROT=8', () => {
      const u = UNIT_STATS.TRAN;
      expect(u.strength).toBe(90);
      expect(u.speed).toBe(30);
      expect(u.rot).toBe(8);
    });

    it('MIG — strength=60, speed=50, ROT=8, maxAmmo=2, weapon=Maverick', () => {
      const u = UNIT_STATS.MIG;
      expect(u.strength).toBe(60);
      expect(u.speed).toBe(50);
      expect(u.rot).toBe(8);
      expect(u.maxAmmo).toBe(2);
      expect(u.primaryWeapon).toBe('Maverick');
    });

    it('YAK — strength=50, speed=50, ROT=8, maxAmmo=2, weapon=ChainGun', () => {
      const u = UNIT_STATS.YAK;
      expect(u.strength).toBe(50);
      expect(u.speed).toBe(50);
      expect(u.rot).toBe(8);
      expect(u.maxAmmo).toBe(2);
      expect(u.primaryWeapon).toBe('ChainGun');
    });
  });

  // --- Ants ---
  describe('Ants', () => {
    it('ANT1 (Warrior)', () => {
      const u = UNIT_STATS.ANT1;
      expect(u.strength).toBe(150);
      expect(u.primaryWeapon).toBe('Mandible');
      expect(u.crushable).toBe(true);
    });

    it('ANT2 (Fire)', () => {
      const u = UNIT_STATS.ANT2;
      expect(u.strength).toBe(75);
      expect(u.primaryWeapon).toBe('FireballLauncher');
    });

    it('ANT3 (Scout)', () => {
      const u = UNIT_STATS.ANT3;
      expect(u.strength).toBe(85);
      expect(u.primaryWeapon).toBe('TeslaZap');
    });
  });
});

// ============================================================
// WEAPON_STATS parity
// ============================================================
describe('WEAPON_STATS parity', () => {
  // Infantry weapons
  it('M1Carbine', () => {
    const w = WEAPON_STATS.M1Carbine;
    expect(w.damage).toBe(15);
    expect(w.rof).toBe(20);
    expect(w.range).toBe(3.0);
    expect(w.warhead).toBe('SA');
  });

  it('Grenade', () => {
    const w = WEAPON_STATS.Grenade;
    expect(w.damage).toBe(50);
    expect(w.rof).toBe(60);
    expect(w.range).toBe(4.0);
    expect(w.warhead).toBe('HE');
  });

  it('Dragon', () => {
    const w = WEAPON_STATS.Dragon;
    expect(w.damage).toBe(35);
    expect(w.warhead).toBe('AP');
  });

  it('RedEye', () => {
    const w = WEAPON_STATS.RedEye;
    expect(w.damage).toBe(50);
    expect(w.warhead).toBe('AP');
    expect(w.isAntiAir).toBe(true);
  });

  it('Sniper — damage=100, rof=60, range=3.75, warhead=SA', () => {
    const w = WEAPON_STATS.Sniper;
    expect(w.damage).toBe(100);
    expect(w.rof).toBe(60);
    expect(w.range).toBe(3.75);
    expect(w.warhead).toBe('SA');
  });

  it('Colt45 (Tanya) — new weapon', () => {
    const w = WEAPON_STATS.Colt45;
    expect(w).toBeDefined();
    expect(w.damage).toBe(50);
    expect(w.rof).toBe(20);
    expect(w.range).toBe(5.0);
    expect(w.warhead).toBe('SA');
  });

  it('Pistol — new weapon', () => {
    const w = WEAPON_STATS.Pistol;
    expect(w).toBeDefined();
    expect(w.damage).toBe(1);
    expect(w.rof).toBe(30);
    expect(w.range).toBe(2.0);
    expect(w.warhead).toBe('SA');
  });

  // Vehicle weapons
  it('120mm — has burst: 2', () => {
    const w = WEAPON_STATS['120mm'];
    expect(w.damage).toBe(40);
    expect(w.burst).toBe(2);
  });

  it('TeslaCannon — damage=100, rof=120, range=8.5', () => {
    const w = WEAPON_STATS.TeslaCannon;
    expect(w.damage).toBe(100);
    expect(w.rof).toBe(120);
    expect(w.range).toBe(8.5);
    expect(w.warhead).toBe('Super');
  });

  it('APTusk — damage=75, rof=60, range=6.0, warhead=AP', () => {
    const w = WEAPON_STATS.APTusk;
    expect(w.damage).toBe(75);
    expect(w.rof).toBe(60);
    expect(w.range).toBe(6.0);
    expect(w.warhead).toBe('AP');
  });

  it('SCUD (V2 Rocket) — new weapon', () => {
    const w = WEAPON_STATS.SCUD;
    expect(w).toBeDefined();
    expect(w.damage).toBe(200);
    expect(w.rof).toBe(100);
    expect(w.range).toBe(10.0);
    expect(w.warhead).toBe('HE');
  });

  // Naval weapons
  it('Stinger — damage=30, rof=60, range=9.0, warhead=HE', () => {
    const w = WEAPON_STATS.Stinger;
    expect(w.damage).toBe(30);
    expect(w.rof).toBe(60);
    expect(w.range).toBe(9.0);
    expect(w.warhead).toBe('HE');
  });

  it('TorpTube — damage=90, rof=60, range=9.0', () => {
    const w = WEAPON_STATS.TorpTube;
    expect(w.damage).toBe(90);
    expect(w.rof).toBe(60);
    expect(w.range).toBe(9.0);
    expect(w.warhead).toBe('AP');
  });

  it('DepthCharge — damage=80, rof=60, range=5.0', () => {
    const w = WEAPON_STATS.DepthCharge;
    expect(w.damage).toBe(80);
    expect(w.rof).toBe(60);
    expect(w.range).toBe(5.0);
    expect(w.warhead).toBe('AP');
  });

  it('8Inch (Cruiser) — new weapon', () => {
    const w = WEAPON_STATS['8Inch'];
    expect(w).toBeDefined();
    expect(w.damage).toBe(500);
    expect(w.rof).toBe(120);
    expect(w.range).toBe(10.0);
    expect(w.warhead).toBe('AP');
  });

  it('2Inch (Gunboat) — new weapon', () => {
    const w = WEAPON_STATS['2Inch'];
    expect(w).toBeDefined();
    expect(w.damage).toBe(20);
    expect(w.rof).toBe(20);
    expect(w.range).toBe(5.0);
    expect(w.warhead).toBe('SA');
  });

  // Aircraft weapons
  it('Maverick — damage=50, rof=3, range=6.0', () => {
    const w = WEAPON_STATS.Maverick;
    expect(w.damage).toBe(50);
    expect(w.rof).toBe(3);
    expect(w.range).toBe(6.0);
    expect(w.warhead).toBe('AP');
  });

  it('Hellfire — damage=40, rof=60, range=4.0, warhead=AP', () => {
    const w = WEAPON_STATS.Hellfire;
    expect(w.damage).toBe(40);
    expect(w.rof).toBe(60);
    expect(w.range).toBe(4.0);
    expect(w.warhead).toBe('AP');
  });

  it('ChainGun — damage=40, rof=3, range=5.0, warhead=SA', () => {
    const w = WEAPON_STATS.ChainGun;
    expect(w.damage).toBe(40);
    expect(w.rof).toBe(3);
    expect(w.range).toBe(5.0);
    expect(w.warhead).toBe('SA');
  });

  it('Nike — damage=50, rof=20, range=7.5, warhead=AP', () => {
    const w = WEAPON_STATS.Nike;
    expect(w.damage).toBe(50);
    expect(w.rof).toBe(20);
    expect(w.range).toBe(7.5);
    expect(w.warhead).toBe('AP');
  });
});

// ============================================================
// WARHEAD_VS_ARMOR parity
// ============================================================
describe('WARHEAD_VS_ARMOR parity', () => {
  it('has all 9 warhead types', () => {
    const keys = Object.keys(WARHEAD_VS_ARMOR);
    expect(keys).toContain('SA');
    expect(keys).toContain('HE');
    expect(keys).toContain('AP');
    expect(keys).toContain('Fire');
    expect(keys).toContain('HollowPoint');
    expect(keys).toContain('Super');
    expect(keys).toContain('Organic');
    expect(keys).toContain('Nuke');
    expect(keys).toContain('Mechanical');
  });

  it('Nuke — equal damage vs all armor', () => {
    expect(WARHEAD_VS_ARMOR.Nuke).toEqual([1.0, 1.0, 1.0, 1.0, 1.0]);
  });

  it('Mechanical — zero damage vs all armor', () => {
    expect(WARHEAD_VS_ARMOR.Mechanical).toEqual([0.0, 0.0, 0.0, 0.0, 0.0]);
  });

  it('SA (Small Arms) — good vs none, bad vs heavy', () => {
    expect(WARHEAD_VS_ARMOR.SA[0]).toBe(1.0);   // none
    expect(WARHEAD_VS_ARMOR.SA[3]).toBe(0.25);   // heavy
  });

  it('AP (Armor Piercing) — best vs heavy', () => {
    expect(WARHEAD_VS_ARMOR.AP[3]).toBe(1.0);    // heavy
  });

  it('each row has 5 entries', () => {
    for (const [key, row] of Object.entries(WARHEAD_VS_ARMOR)) {
      expect(row, `${key} should have 5 entries`).toHaveLength(5);
    }
  });
});

// ============================================================
// WARHEAD_PROPS parity (Nuke + Mechanical)
// ============================================================
describe('WARHEAD_PROPS parity', () => {
  it('Nuke entry exists with infantryDeath=2', () => {
    expect(WARHEAD_PROPS.Nuke).toBeDefined();
    expect(WARHEAD_PROPS.Nuke.infantryDeath).toBe(2);
  });

  it('Mechanical entry exists with infantryDeath=0', () => {
    expect(WARHEAD_PROPS.Mechanical).toBeDefined();
    expect(WARHEAD_PROPS.Mechanical.infantryDeath).toBe(0);
  });
});

// ============================================================
// WARHEAD_META parity (Nuke + Mechanical)
// ============================================================
describe('WARHEAD_META parity', () => {
  it('Nuke — spreadFactor=8, destroys walls and wood', () => {
    expect(WARHEAD_META.Nuke).toBeDefined();
    expect(WARHEAD_META.Nuke.spreadFactor).toBe(8);
    expect(WARHEAD_META.Nuke.destroysWalls).toBe(true);
    expect(WARHEAD_META.Nuke.destroysWood).toBe(true);
  });

  it('Mechanical — spreadFactor=0, no destruction', () => {
    expect(WARHEAD_META.Mechanical).toBeDefined();
    expect(WARHEAD_META.Mechanical.spreadFactor).toBe(0);
  });
});

// ============================================================
// STRUCTURE_MAX_HP parity
// ============================================================
describe('STRUCTURE_MAX_HP parity', () => {
  const expected: Record<string, number> = {
    POWR: 400, APWR: 700, PROC: 900, TENT: 800, BARR: 800,
    WEAP: 1000, AFLD: 500, HPAD: 400, DOME: 1000,
    GUN: 400, SAM: 400, TSLA: 500, GAP: 1000,
    ATEK: 600, STEK: 600, IRON: 600, PDOX: 600, MSLO: 800,
    FIX: 800, SILO: 300, FACT: 1000, HBOX: 600,
  };

  for (const [type, hp] of Object.entries(expected)) {
    it(`${type} = ${hp}`, () => {
      expect(STRUCTURE_MAX_HP[type], `${type} HP`).toBe(hp);
    });
  }
});

// ============================================================
// SUPERWEAPON_DEFS parity
// ============================================================
describe('SUPERWEAPON_DEFS parity', () => {
  it('Chronosphere recharge = 2700 ticks (3 minutes)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].rechargeTicks).toBe(2700);
  });

  it('Sonar Pulse recharge = 12600 ticks (14 minutes)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks).toBe(12600);
  });

  it('Nuke recharge = 12600 ticks', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].rechargeTicks).toBe(12600);
  });

  it('Iron Curtain recharge = 6300 ticks', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].rechargeTicks).toBe(6300);
  });

  it('IRON_CURTAIN_DURATION = 450 (~30s at 15fps)', () => {
    expect(IRON_CURTAIN_DURATION).toBe(450);
  });
});

// ============================================================
// PRODUCTION_ITEMS cost parity
// ============================================================
describe('PRODUCTION_ITEMS cost parity', () => {
  function findItem(type: string) {
    return PRODUCTION_ITEMS.find(i => i.type === type);
  }

  it('AFLD cost = 600', () => {
    expect(findItem('AFLD')?.cost).toBe(600);
  });

  it('SHOK cost = 900', () => {
    expect(findItem('SHOK')?.cost).toBe(900);
  });

  it('MECH cost = 950', () => {
    expect(findItem('MECH')?.cost).toBe(950);
  });

  it('TRAN cost = 1200', () => {
    expect(findItem('TRAN')?.cost).toBe(1200);
  });

  it('STNK cost = 800', () => {
    expect(findItem('STNK')?.cost).toBe(800);
  });

  it('CTNK cost = 2400', () => {
    expect(findItem('CTNK')?.cost).toBe(2400);
  });

  // New production items
  it('E7 (Tanya) cost = 1200, faction = allied', () => {
    const item = findItem('E7');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(1200);
    expect(item!.faction).toBe('allied');
  });

  it('THF (Thief) cost = 500, faction = allied', () => {
    const item = findItem('THF');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(500);
    expect(item!.faction).toBe('allied');
  });

  it('V2RL cost = 700, faction = soviet', () => {
    const item = findItem('V2RL');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(700);
    expect(item!.faction).toBe('soviet');
  });

  it('MNLY cost = 800, faction = allied', () => {
    const item = findItem('MNLY');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(800);
    expect(item!.faction).toBe('allied');
  });

  it('MRLS cost = 800, faction = allied', () => {
    const item = findItem('MRLS');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(800);
    expect(item!.faction).toBe('allied');
  });
});
