/**
 * Data parity tests — verify all UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR,
 * STRUCTURE_MAX_HP, SUPERWEAPON_DEFS, and PRODUCTION_ITEMS match C++ source values.
 */
import { describe, it, expect } from 'vitest';
import {
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, WARHEAD_PROPS, WARHEAD_META,
  SUPERWEAPON_DEFS, SuperweaponType, IRON_CURTAIN_DURATION,
  PRODUCTION_ITEMS, UnitType, COUNTRY_BONUSES, TERRAIN_SPEED,
  NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_FLIGHT_TICKS, NUKE_MIN_FALLOFF,
  CHRONO_SHIFT_VISUAL_TICKS, SONAR_REVEAL_TICKS, IC_TARGET_RANGE,
  BODY_SHAPE, DIR_DX, DIR_DY, ANT_ANIM, HOUSE_FACTION,
  SUB_CELL_OFFSETS, CIVILIAN_UNIT_TYPES,
  CELL_SIZE, LEPTON_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC,
  MAX_DAMAGE, REPAIR_STEP, REPAIR_PERCENT, CONDITION_RED, CONDITION_YELLOW,
  PRONE_DAMAGE_BIAS, TEMPLATE_ROAD_MIN, TEMPLATE_ROAD_MAX,
  MAX_PROJECTILE_FRAMES, DEFAULT_PROJECTILE_FRAMES,
} from '../engine/types';
import { STRUCTURE_MAX_HP, STRUCTURE_WEAPONS, STRUCTURE_SIZE } from '../engine/scenario';
import { CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION, RECOIL_OFFSETS } from '../engine/entity';

// ============================================================
// UNIT_STATS parity
// ============================================================
describe('UNIT_STATS parity', () => {
  // --- Infantry ---
  describe('Infantry', () => {
    it('E1 (Rifle Infantry)', () => {
      const u = UNIT_STATS.E1;
      expect(u.strength).toBe(50);
      expect(u.speed).toBe(8);
      expect(u.armor).toBe('none');
      expect(u.sight).toBe(4);
      expect(u.rot).toBe(8);
      expect(u.primaryWeapon).toBe('M1Carbine');
      expect(u.isInfantry).toBe(true);
    });

    it('E2 (Grenadier) — soviet owner', () => {
      const u = UNIT_STATS.E2;
      expect(u.strength).toBe(50);
      expect(u.speed).toBe(8);
      expect(u.armor).toBe('none');
      expect(u.primaryWeapon).toBe('Grenade');
      expect(u.owner).toBe('soviet');
    });

    it('E3 (Rocket Soldier) — weapons swapped, allied owner', () => {
      const u = UNIT_STATS.E3;
      expect(u.strength).toBe(45);
      expect(u.speed).toBe(4);
      expect(u.primaryWeapon).toBe('RedEye');
      expect(u.secondaryWeapon).toBe('Dragon');
      expect(u.owner).toBe('allied');
    });

    it('E4 (Flamethrower)', () => {
      const u = UNIT_STATS.E4;
      expect(u.strength).toBe(40);
      expect(u.speed).toBe(6);
      expect(u.primaryWeapon).toBe('Flamer');
    });

    it('E6 (Engineer)', () => {
      const u = UNIT_STATS.E6;
      expect(u.strength).toBe(25);
      expect(u.speed).toBe(6);
      expect(u.primaryWeapon).toBeNull();
    });

    it('DOG (Attack Dog)', () => {
      const u = UNIT_STATS.DOG;
      expect(u.strength).toBe(12);
      expect(u.speed).toBe(14);
      expect(u.sight).toBe(5);
      expect(u.primaryWeapon).toBe('DogJaw');
    });

    it('GNRL (Stavros) — strength=80, speed=8, sight=3, weapon=Pistol', () => {
      const u = UNIT_STATS.GNRL;
      expect(u.strength).toBe(80);
      expect(u.speed).toBe(8);
      expect(u.sight).toBe(3);
      expect(u.primaryWeapon).toBe('Pistol');
    });

    it('CHAN (Specialist) — strength=25, speed=8, sight=2', () => {
      const u = UNIT_STATS.CHAN;
      expect(u.strength).toBe(25);
      expect(u.speed).toBe(8);
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
      expect(u.speed).toBe(10);
      expect(u.armor).toBe('none');
      expect(u.sight).toBe(6);
      expect(u.rot).toBe(8);
      expect(u.primaryWeapon).toBe('Colt45');
      expect(u.secondaryWeapon).toBe('Colt45');
      expect(u.isInfantry).toBe(true);
      expect(u.owner).toBe('both');
    });

    it('THF (Thief) — new entry', () => {
      const u = UNIT_STATS.THF;
      expect(u).toBeDefined();
      expect(u.strength).toBe(25);
      expect(u.speed).toBe(8);
      expect(u.armor).toBe('none');
      expect(u.sight).toBe(5);
      expect(u.primaryWeapon).toBeNull();
      expect(u.owner).toBe('allied');
    });

    it('Civilians (C1-C10) — strength=25, speed=4, sight=2, rot=8, armor=none', () => {
      const armedCivs = ['C1', 'C7']; // these carry a Pistol
      for (let i = 1; i <= 10; i++) {
        const key = `C${i}`;
        const u = UNIT_STATS[key];
        expect(u, `${key} should exist`).toBeDefined();
        expect(u.strength, `${key}.strength`).toBe(25);
        expect(u.speed, `${key}.speed`).toBe(4);
        expect(u.sight, `${key}.sight`).toBe(2);
        expect(u.rot, `${key}.rot`).toBe(8);
        expect(u.armor, `${key}.armor`).toBe('none');
        expect(u.isInfantry, `${key}.isInfantry`).toBe(true);
        if (armedCivs.includes(key)) {
          expect(u.primaryWeapon, `${key}.primaryWeapon`).toBe('Pistol');
        } else {
          expect(u.primaryWeapon, `${key}.primaryWeapon`).toBeNull();
        }
      }
    });

    it('EINSTEIN (Prof. Einstein) — strength=25, speed=6, sight=2, rot=8, no weapon', () => {
      const u = UNIT_STATS.EINSTEIN;
      expect(u).toBeDefined();
      expect(u.strength).toBe(25);
      expect(u.armor).toBe('none');
      expect(u.speed).toBe(6);
      expect(u.sight).toBe(2);
      expect(u.rot).toBe(8);
      expect(u.primaryWeapon).toBeNull();
    });
  });

  // --- Vehicles ---
  describe('Vehicles', () => {
    it('1TNK (Light Tank)', () => {
      const u = UNIT_STATS['1TNK'];
      expect(u.strength).toBe(300);
      expect(u.speed).toBe(14);
      expect(u.armor).toBe('heavy');
      expect(u.primaryWeapon).toBe('75mm');
      expect(u.crusher).toBe(true);
    });

    it('2TNK (Medium Tank)', () => {
      const u = UNIT_STATS['2TNK'];
      expect(u.strength).toBe(400);
      expect(u.speed).toBe(12);
      expect(u.primaryWeapon).toBe('90mm');
    });

    it('3TNK (Heavy Tank) — has secondary weapon 105mm', () => {
      const u = UNIT_STATS['3TNK'];
      expect(u.strength).toBe(400);
      expect(u.speed).toBe(10);
      expect(u.primaryWeapon).toBe('105mm');
      expect(u.secondaryWeapon).toBe('105mm');
    });

    it('4TNK (Mammoth Tank)', () => {
      const u = UNIT_STATS['4TNK'];
      expect(u.strength).toBe(600);
      expect(u.speed).toBe(6);
      expect(u.primaryWeapon).toBe('120mm');
      expect(u.secondaryWeapon).toBe('MammothTusk');
    });

    it('JEEP (Ranger)', () => {
      const u = UNIT_STATS.JEEP;
      expect(u.strength).toBe(150);
      expect(u.speed).toBe(14);
      expect(u.armor).toBe('light');
    });

    it('APC', () => {
      const u = UNIT_STATS.APC;
      expect(u.strength).toBe(200);
      expect(u.speed).toBe(14);
      expect(u.passengers).toBe(5);
    });

    it('ARTY (Artillery)', () => {
      const u = UNIT_STATS.ARTY;
      expect(u.strength).toBe(75);
      expect(u.speed).toBe(10);
      expect(u.primaryWeapon).toBe('155mm');
    });

    it('TRUK (Supply Truck) — armor=light, speed=14, sight=3', () => {
      const u = UNIT_STATS.TRUK;
      expect(u.strength).toBe(110);
      expect(u.armor).toBe('light');
      expect(u.speed).toBe(14);
      expect(u.sight).toBe(3);
    });

    it('TTNK (Tesla Tank) — strength=110, speed=12, sight=7', () => {
      const u = UNIT_STATS.TTNK;
      expect(u.strength).toBe(110);
      expect(u.speed).toBe(12);
      expect(u.sight).toBe(7);
      expect(u.primaryWeapon).toBe('TTankZap');
    });

    it('CTNK (Chrono Tank) — strength=350, speed=12, armor=light, weapon=APTusk', () => {
      const u = UNIT_STATS.CTNK;
      expect(u.strength).toBe(350);
      expect(u.speed).toBe(12);
      expect(u.armor).toBe('light');
      expect(u.primaryWeapon).toBe('APTusk');
    });

    it('QTNK (MAD Tank) — strength=300, speed=6, sight=6', () => {
      const u = UNIT_STATS.QTNK;
      expect(u.strength).toBe(300);
      expect(u.speed).toBe(6);
      expect(u.sight).toBe(6);
    });

    it('DTRK (Demo Truck) — strength=110, armor=light, speed=14', () => {
      const u = UNIT_STATS.DTRK;
      expect(u.strength).toBe(110);
      expect(u.armor).toBe('light');
      expect(u.speed).toBe(14);
    });

    it('STNK (Phase Transport) — full stats', () => {
      const u = UNIT_STATS.STNK;
      expect(u.strength).toBe(200);
      expect(u.speed).toBe(14);
      expect(u.armor).toBe('heavy');
      expect(u.sight).toBe(5);
      expect(u.rot).toBe(5);
      expect(u.primaryWeapon).toBe('APTusk');
      expect(u.passengers).toBe(1);
      expect(u.crusher).toBe(true);
      expect(u.isCloakable).toBe(true);
    });

    it('HARV (Harvester) — strength=600, heavy armor, no weapon, crusher', () => {
      const u = UNIT_STATS.HARV;
      expect(u).toBeDefined();
      expect(u.strength).toBe(600);
      expect(u.armor).toBe('heavy');
      expect(u.speed).toBe(12);
      expect(u.sight).toBe(4);
      expect(u.rot).toBe(5);
      expect(u.primaryWeapon).toBeNull();
      expect(u.crusher).toBe(true);
    });

    it('MCV — strength=600, light armor, no weapon, crusher', () => {
      const u = UNIT_STATS.MCV;
      expect(u).toBeDefined();
      expect(u.strength).toBe(600);
      expect(u.armor).toBe('light');
      expect(u.speed).toBe(10);
      expect(u.sight).toBe(4);
      expect(u.rot).toBe(5);
      expect(u.primaryWeapon).toBeNull();
      expect(u.crusher).toBe(true);
    });

    it('V2RL (V2 Rocket) — new entry', () => {
      const u = UNIT_STATS.V2RL;
      expect(u).toBeDefined();
      expect(u.strength).toBe(150);
      expect(u.speed).toBe(10);
      expect(u.armor).toBe('light');
      expect(u.sight).toBe(5);
      expect(u.rot).toBe(5);
      expect(u.primaryWeapon).toBe('SCUD');
      expect(u.owner).toBe('soviet');
    });

    it('MNLY (Minelayer) — new entry', () => {
      const u = UNIT_STATS.MNLY;
      expect(u).toBeDefined();
      expect(u.strength).toBe(100);
      expect(u.speed).toBe(14);
      expect(u.armor).toBe('heavy');
      expect(u.primaryWeapon).toBeNull();
      expect(u.owner).toBe('both');
    });

  });

  // --- Naval ---
  describe('Naval', () => {
    it('DD (Destroyer) — ROT=7, sight=6, speed=12', () => {
      const u = UNIT_STATS.DD;
      expect(u.strength).toBe(400);
      expect(u.speed).toBe(12);
      expect(u.sight).toBe(6);
      expect(u.rot).toBe(7);
      expect(u.primaryWeapon).toBe('Stinger');
      expect(u.secondaryWeapon).toBe('DepthCharge');
    });

    it('CA (Cruiser) — ROT=5, sight=7, speed=8, weapon=8Inch', () => {
      const u = UNIT_STATS.CA;
      expect(u.strength).toBe(700);
      expect(u.speed).toBe(8);
      expect(u.sight).toBe(7);
      expect(u.rot).toBe(5);
      expect(u.primaryWeapon).toBe('8Inch');
    });

    it('SS (Submarine) — ROT=7, sight=6, speed=10', () => {
      const u = UNIT_STATS.SS;
      expect(u.strength).toBe(120);
      expect(u.speed).toBe(10);
      expect(u.sight).toBe(6);
      expect(u.rot).toBe(7);
      expect(u.isCloakable).toBe(true);
    });

    it('MSUB (Missile Sub) — ROT=7, sight=6, speed=10', () => {
      const u = UNIT_STATS.MSUB;
      expect(u.strength).toBe(150);
      expect(u.speed).toBe(10);
      expect(u.sight).toBe(6);
      expect(u.rot).toBe(7);
      expect(u.primaryWeapon).toBe('SubSCUD');
    });

    it('PT (Gunboat) — ROT=7, sight=7, speed=14, weapon=2Inch', () => {
      const u = UNIT_STATS.PT;
      expect(u.strength).toBe(200);
      expect(u.speed).toBe(14);
      expect(u.sight).toBe(7);
      expect(u.rot).toBe(7);
      expect(u.primaryWeapon).toBe('2Inch');
    });

    it('LST (Transport) — ROT=10, sight=6, speed=12', () => {
      const u = UNIT_STATS.LST;
      expect(u.strength).toBe(350);
      expect(u.speed).toBe(12);
      expect(u.sight).toBe(6);
      expect(u.rot).toBe(10);
    });
  });

  // --- Aircraft ---
  describe('Aircraft', () => {
    it('HELI (Longbow) — strength=225, speed=18, ROT=4, maxAmmo=6', () => {
      const u = UNIT_STATS.HELI;
      expect(u.strength).toBe(225);
      expect(u.speed).toBe(18);
      expect(u.rot).toBe(4);
      expect(u.maxAmmo).toBe(6);
      expect(u.primaryWeapon).toBe('Hellfire');
    });

    it('HIND — strength=225, speed=18, ROT=4, maxAmmo=12, weapon=ChainGun', () => {
      const u = UNIT_STATS.HIND;
      expect(u.strength).toBe(225);
      expect(u.speed).toBe(18);
      expect(u.rot).toBe(4);
      expect(u.maxAmmo).toBe(12);
      expect(u.primaryWeapon).toBe('ChainGun');
    });

    it('TRAN (Chinook) — strength=90, speed=18, ROT=5', () => {
      const u = UNIT_STATS.TRAN;
      expect(u.strength).toBe(90);
      expect(u.speed).toBe(18);
      expect(u.rot).toBe(5);
    });

    it('MIG — strength=50, speed=24, ROT=5, maxAmmo=3, weapon=Maverick', () => {
      const u = UNIT_STATS.MIG;
      expect(u.strength).toBe(50);
      expect(u.speed).toBe(24);
      expect(u.rot).toBe(5);
      expect(u.maxAmmo).toBe(3);
      expect(u.primaryWeapon).toBe('Maverick');
    });

    it('YAK — strength=60, speed=24, ROT=5, maxAmmo=15, weapon=ChainGun', () => {
      const u = UNIT_STATS.YAK;
      expect(u.strength).toBe(60);
      expect(u.speed).toBe(24);
      expect(u.rot).toBe(5);
      expect(u.maxAmmo).toBe(15);
      expect(u.primaryWeapon).toBe('ChainGun');
    });
  });

  // --- Ants ---
  describe('Ants', () => {
    it('ANT1 (Warrior)', () => {
      const u = UNIT_STATS.ANT1;
      expect(u.strength).toBe(125);
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

  it('Sniper — damage=100, rof=5, range=3.75, warhead=HollowPoint', () => {
    const w = WEAPON_STATS.Sniper;
    expect(w.damage).toBe(100);
    expect(w.rof).toBe(5);
    expect(w.range).toBe(3.75);
    expect(w.warhead).toBe('HollowPoint');
  });

  it('Colt45 (Tanya) — new weapon', () => {
    const w = WEAPON_STATS.Colt45;
    expect(w).toBeDefined();
    expect(w.damage).toBe(50);
    expect(w.rof).toBe(5);
    expect(w.range).toBe(5.75);
    expect(w.warhead).toBe('HollowPoint');
  });

  it('Pistol — new weapon', () => {
    const w = WEAPON_STATS.Pistol;
    expect(w).toBeDefined();
    expect(w.damage).toBe(1);
    expect(w.rof).toBe(7);
    expect(w.range).toBe(1.75);
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

  it('APTusk — damage=75, rof=80, range=5.0, warhead=AP, burst=2', () => {
    const w = WEAPON_STATS.APTusk;
    expect(w.damage).toBe(75);
    expect(w.rof).toBe(80);
    expect(w.range).toBe(5.0);
    expect(w.warhead).toBe('AP');
    expect(w.burst).toBe(2);
  });

  it('SCUD (V2 Rocket) — new weapon', () => {
    const w = WEAPON_STATS.SCUD;
    expect(w).toBeDefined();
    expect(w.damage).toBe(600);
    expect(w.rof).toBe(400);
    expect(w.range).toBe(10.0);
    expect(w.warhead).toBe('HE');
  });

  // Naval weapons
  it('Stinger — damage=30, rof=60, range=9.0, warhead=AP', () => {
    const w = WEAPON_STATS.Stinger;
    expect(w.damage).toBe(30);
    expect(w.rof).toBe(60);
    expect(w.range).toBe(9.0);
    expect(w.warhead).toBe('AP');
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
    expect(w.rof).toBe(160);
    expect(w.range).toBe(22.0);
    expect(w.warhead).toBe('HE');
  });

  it('2Inch (Gunboat) — new weapon', () => {
    const w = WEAPON_STATS['2Inch'];
    expect(w).toBeDefined();
    expect(w.damage).toBe(25);
    expect(w.rof).toBe(60);
    expect(w.range).toBe(5.5);
    expect(w.warhead).toBe('AP');
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

  // --- Infantry weapons (missing) ---
  it('Flamer — damage=70, rof=50, range=3.5, warhead=Fire', () => {
    const w = WEAPON_STATS.Flamer;
    expect(w.damage).toBe(70);
    expect(w.rof).toBe(50);
    expect(w.range).toBe(3.5);
    expect(w.warhead).toBe('Fire');
  });

  it('DogJaw — damage=100, rof=10, range=2.2, warhead=Organic', () => {
    const w = WEAPON_STATS.DogJaw;
    expect(w.damage).toBe(100);
    expect(w.rof).toBe(10);
    expect(w.range).toBe(2.2);
    expect(w.warhead).toBe('Organic');
  });

  it('Heal — damage=-50, rof=80, range=1.83, warhead=Organic', () => {
    const w = WEAPON_STATS.Heal;
    expect(w.damage).toBe(-50);
    expect(w.rof).toBe(80);
    expect(w.range).toBe(1.83);
    expect(w.warhead).toBe('Organic');
  });

  // --- Vehicle weapons (missing) ---
  it('M60mg — damage=15, rof=20, range=4.0, warhead=SA', () => {
    const w = WEAPON_STATS.M60mg;
    expect(w.damage).toBe(15);
    expect(w.rof).toBe(20);
    expect(w.range).toBe(4.0);
    expect(w.warhead).toBe('SA');
  });

  it('75mm — damage=25, rof=40, range=4.0, warhead=AP', () => {
    const w = WEAPON_STATS['75mm'];
    expect(w.damage).toBe(25);
    expect(w.rof).toBe(40);
    expect(w.range).toBe(4.0);
    expect(w.warhead).toBe('AP');
  });

  it('90mm — damage=30, rof=50, range=4.75, warhead=AP', () => {
    const w = WEAPON_STATS['90mm'];
    expect(w.damage).toBe(30);
    expect(w.rof).toBe(50);
    expect(w.range).toBe(4.75);
    expect(w.warhead).toBe('AP');
  });

  it('105mm — damage=30, rof=70, range=4.75, warhead=AP', () => {
    const w = WEAPON_STATS['105mm'];
    expect(w.damage).toBe(30);
    expect(w.rof).toBe(70);
    expect(w.range).toBe(4.75);
    expect(w.warhead).toBe('AP');
  });

  it('MammothTusk — damage=75, rof=80, range=5.0, warhead=HE, burst=2', () => {
    const w = WEAPON_STATS.MammothTusk;
    expect(w.damage).toBe(75);
    expect(w.rof).toBe(80);
    expect(w.range).toBe(5.0);
    expect(w.warhead).toBe('HE');
    expect(w.burst).toBe(2);
  });

  it('155mm — damage=150, rof=65, range=6.0, warhead=HE', () => {
    const w = WEAPON_STATS['155mm'];
    expect(w.damage).toBe(150);
    expect(w.rof).toBe(65);
    expect(w.range).toBe(6.0);
    expect(w.warhead).toBe('HE');
  });

  // --- Expansion weapons (missing) ---
  it('PortaTesla — damage=45, rof=70, range=3.5, warhead=Super', () => {
    const w = WEAPON_STATS.PortaTesla;
    expect(w.damage).toBe(45);
    expect(w.rof).toBe(70);
    expect(w.range).toBe(3.5);
    expect(w.warhead).toBe('Super');
  });

  it('GoodWrench — damage=-100, rof=80, range=1.83, warhead=Mechanical', () => {
    const w = WEAPON_STATS.GoodWrench;
    expect(w.damage).toBe(-100);
    expect(w.rof).toBe(80);
    expect(w.range).toBe(1.83);
    expect(w.warhead).toBe('Mechanical');
  });

  it('TTankZap — damage=100, rof=120, range=7.0, warhead=Super', () => {
    const w = WEAPON_STATS.TTankZap;
    expect(w.damage).toBe(100);
    expect(w.rof).toBe(120);
    expect(w.range).toBe(7.0);
    expect(w.warhead).toBe('Super');
  });

  // --- Naval weapons (missing) ---
  it('Tomahawk — damage=50, rof=80, range=10.0, warhead=HE, burst=2', () => {
    const w = WEAPON_STATS.Tomahawk;
    expect(w.damage).toBe(50);
    expect(w.rof).toBe(80);
    expect(w.range).toBe(10.0);
    expect(w.warhead).toBe('HE');
    expect(w.burst).toBe(2);
  });

  it('SeaSerpent — damage=35, rof=50, range=8.0, warhead=HE, burst=2', () => {
    const w = WEAPON_STATS.SeaSerpent;
    expect(w.damage).toBe(35);
    expect(w.rof).toBe(50);
    expect(w.range).toBe(8.0);
    expect(w.warhead).toBe('HE');
    expect(w.burst).toBe(2);
  });

  // --- Ant weapons (missing) ---
  it('Mandible — damage=50, rof=15, range=1.5, warhead=Super', () => {
    const w = WEAPON_STATS.Mandible;
    expect(w.damage).toBe(50);
    expect(w.rof).toBe(15);
    expect(w.range).toBe(1.5);
    expect(w.warhead).toBe('Super');
  });

  it('TeslaZap — damage=60, rof=25, range=1.75, warhead=Super', () => {
    const w = WEAPON_STATS.TeslaZap;
    expect(w.damage).toBe(60);
    expect(w.rof).toBe(25);
    expect(w.range).toBe(1.75);
    expect(w.warhead).toBe('Super');
  });

  it('FireballLauncher — damage=125, rof=50, range=4.0, warhead=Fire', () => {
    const w = WEAPON_STATS.FireballLauncher;
    expect(w.damage).toBe(125);
    expect(w.rof).toBe(50);
    expect(w.range).toBe(4.0);
    expect(w.warhead).toBe('Fire');
  });

  it('Napalm — damage=100, rof=20, range=4.5, warhead=Fire', () => {
    const w = WEAPON_STATS.Napalm;
    expect(w.damage).toBe(100);
    expect(w.rof).toBe(20);
    expect(w.range).toBe(4.5);
    expect(w.warhead).toBe('Fire');
  });

});

// ============================================================
// WARHEAD_VS_ARMOR parity
// ============================================================
describe('WARHEAD_VS_ARMOR parity', () => {
  it('has all 9 warhead types', () => {
    const keys = Object.keys(WARHEAD_VS_ARMOR);
    expect(keys).toHaveLength(9);
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

  it('each row has 5 entries', () => {
    for (const [key, row] of Object.entries(WARHEAD_VS_ARMOR)) {
      expect(row, `${key} should have 5 entries`).toHaveLength(5);
    }
  });

  // Full array assertions for all 9 warhead types [none, wood, light, heavy, concrete]
  it('SA — [1.0, 0.5, 0.6, 0.25, 0.25]', () => {
    expect(WARHEAD_VS_ARMOR.SA).toEqual([1.0, 0.5, 0.6, 0.25, 0.25]);
  });

  it('HE — [0.9, 0.75, 0.6, 0.25, 1.0]', () => {
    expect(WARHEAD_VS_ARMOR.HE).toEqual([0.9, 0.75, 0.6, 0.25, 1.0]);
  });

  it('AP — [0.3, 0.75, 0.75, 1.0, 0.5]', () => {
    expect(WARHEAD_VS_ARMOR.AP).toEqual([0.3, 0.75, 0.75, 1.0, 0.5]);
  });

  it('Fire — [0.9, 1.0, 0.6, 0.25, 0.5]', () => {
    expect(WARHEAD_VS_ARMOR.Fire).toEqual([0.9, 1.0, 0.6, 0.25, 0.5]);
  });

  it('HollowPoint — [1.0, 0.05, 0.05, 0.05, 0.05]', () => {
    expect(WARHEAD_VS_ARMOR.HollowPoint).toEqual([1.0, 0.05, 0.05, 0.05, 0.05]);
  });

  it('Super — [1.0, 1.0, 1.0, 1.0, 1.0]', () => {
    expect(WARHEAD_VS_ARMOR.Super).toEqual([1.0, 1.0, 1.0, 1.0, 1.0]);
  });

  it('Organic — [1.0, 0.0, 0.0, 0.0, 0.0]', () => {
    expect(WARHEAD_VS_ARMOR.Organic).toEqual([1.0, 0.0, 0.0, 0.0, 0.0]);
  });

  it('Nuke — [0.9, 1.0, 0.6, 0.25, 0.5]', () => {
    expect(WARHEAD_VS_ARMOR.Nuke).toEqual([0.9, 1.0, 0.6, 0.25, 0.5]);
  });

  it('Mechanical — [1.0, 1.0, 1.0, 1.0, 1.0]', () => {
    expect(WARHEAD_VS_ARMOR.Mechanical).toEqual([1.0, 1.0, 1.0, 1.0, 1.0]);
  });
});

// ============================================================
// WARHEAD_PROPS parity (Nuke + Mechanical)
// ============================================================
describe('WARHEAD_PROPS parity', () => {
  it('has all 9 warhead types', () => {
    expect(Object.keys(WARHEAD_PROPS)).toHaveLength(9);
  });

  it('SA — infantryDeath=1, explosionSet=piff', () => {
    expect(WARHEAD_PROPS.SA).toEqual({ infantryDeath: 1, explosionSet: 'piff' });
  });

  it('HE — infantryDeath=2, explosionSet=veh-hit1', () => {
    expect(WARHEAD_PROPS.HE).toEqual({ infantryDeath: 2, explosionSet: 'veh-hit1' });
  });

  it('AP — infantryDeath=3, explosionSet=piff', () => {
    expect(WARHEAD_PROPS.AP).toEqual({ infantryDeath: 3, explosionSet: 'piff' });
  });

  it('Fire — infantryDeath=4, explosionSet=napalm1', () => {
    expect(WARHEAD_PROPS.Fire).toEqual({ infantryDeath: 4, explosionSet: 'napalm1' });
  });

  it('HollowPoint — infantryDeath=1, explosionSet=piff', () => {
    expect(WARHEAD_PROPS.HollowPoint).toEqual({ infantryDeath: 1, explosionSet: 'piff' });
  });

  it('Super — infantryDeath=5, explosionSet=atomsfx', () => {
    expect(WARHEAD_PROPS.Super).toEqual({ infantryDeath: 5, explosionSet: 'atomsfx' });
  });

  it('Organic — infantryDeath=0, explosionSet=piff', () => {
    expect(WARHEAD_PROPS.Organic).toEqual({ infantryDeath: 0, explosionSet: 'piff' });
  });

  it('Nuke — infantryDeath=4, explosionSet=atomsfx', () => {
    expect(WARHEAD_PROPS.Nuke).toEqual({ infantryDeath: 4, explosionSet: 'atomsfx' });
  });

  it('Mechanical — infantryDeath=0, explosionSet=piff', () => {
    expect(WARHEAD_PROPS.Mechanical).toEqual({ infantryDeath: 0, explosionSet: 'piff' });
  });
});

// ============================================================
// WARHEAD_META parity (Nuke + Mechanical)
// ============================================================
describe('WARHEAD_META parity', () => {
  it('has all 9 warhead types', () => {
    expect(Object.keys(WARHEAD_META)).toHaveLength(9);
  });

  it('SA — spreadFactor=3', () => {
    expect(WARHEAD_META.SA).toEqual({ spreadFactor: 3 });
  });

  it('HE — spreadFactor=6, destroysWalls, destroysWood, destroysOre', () => {
    expect(WARHEAD_META.HE).toEqual({ spreadFactor: 6, destroysWalls: true, destroysWood: true, destroysOre: true });
  });

  it('AP — spreadFactor=3, destroysWalls, destroysWood', () => {
    expect(WARHEAD_META.AP).toEqual({ spreadFactor: 3, destroysWalls: true, destroysWood: true });
  });

  it('Fire — spreadFactor=8, destroysWood', () => {
    expect(WARHEAD_META.Fire).toEqual({ spreadFactor: 8, destroysWood: true });
  });

  it('HollowPoint — spreadFactor=1', () => {
    expect(WARHEAD_META.HollowPoint).toEqual({ spreadFactor: 1 });
  });

  it('Super — spreadFactor=1', () => {
    expect(WARHEAD_META.Super).toEqual({ spreadFactor: 1 });
  });

  it('Organic — spreadFactor=0', () => {
    expect(WARHEAD_META.Organic).toEqual({ spreadFactor: 0 });
  });

  it('Nuke — spreadFactor=6, destroysWalls, destroysWood, destroysOre', () => {
    expect(WARHEAD_META.Nuke).toEqual({ spreadFactor: 6, destroysWalls: true, destroysWood: true, destroysOre: true });
  });

  it('Mechanical — spreadFactor=0', () => {
    expect(WARHEAD_META.Mechanical).toEqual({ spreadFactor: 0 });
  });
});

// ============================================================
// STRUCTURE_MAX_HP parity
// ============================================================
const CIVILIAN_STRUCTURE_2X2 = ['V01', 'V02', 'V03', 'V04', 'V20', 'V21', 'V24', 'V25'];
const CIVILIAN_STRUCTURE_2X1 = ['V05', 'V06', 'V07', 'V22', 'V26', 'V30', 'V31', 'V32', 'V33'];
const CIVILIAN_STRUCTURE_1X1 = [
  'V08', 'V09', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17', 'V18', 'V19',
  'V23', 'V27', 'V28', 'V29', 'V34', 'V35', 'V36',
];
const CIVILIAN_STRUCTURE_4X2 = ['V37'];
const CIVILIAN_STRUCTURE_TYPES = [
  ...CIVILIAN_STRUCTURE_2X2,
  ...CIVILIAN_STRUCTURE_2X1,
  ...CIVILIAN_STRUCTURE_1X1,
  ...CIVILIAN_STRUCTURE_4X2,
];

describe('STRUCTURE_MAX_HP parity', () => {
  const expected: Record<string, number> = {
    POWR: 400, APWR: 700, PROC: 900, TENT: 800, BARR: 800,
    WEAP: 1000, AFLD: 1000, HPAD: 800, DOME: 1000,
    GUN: 400, SAM: 400, TSLA: 400, GAP: 1000,
    PBOX: 400, HBOX: 600, AGUN: 400, FTUR: 400, KENN: 400,
    ATEK: 400, STEK: 600, IRON: 400, PDOX: 400, MSLO: 400,
    FIX: 800, SILO: 300, FACT: 1000,
    SYRD: 1000, SPEN: 1000, BIO: 600, HOSP: 400,
    FACF: 30, DOMF: 30, WEAF: 30,
    QUEE: 800, LAR1: 25, LAR2: 50,
    MINP: 1, MINV: 1,
    BARL: 10, BRL3: 10,
    SBAG: 1, FENC: 1, BARB: 1, BRIK: 1, WOOD: 1, CYCL: 1,
    FCOM: 400, MISS: 400,
    ...Object.fromEntries(CIVILIAN_STRUCTURE_TYPES.map(type => [type, 400] as const)),
  };

  for (const [type, hp] of Object.entries(expected)) {
    it(`${type} = ${hp}`, () => {
      expect(STRUCTURE_MAX_HP[type], `${type} HP`).toBe(hp);
    });
  }

  it('test covers every key in STRUCTURE_MAX_HP', () => {
    const sourceKeys = Object.keys(STRUCTURE_MAX_HP).sort();
    const testedKeys = Object.keys(expected).sort();
    expect(testedKeys).toEqual(sourceKeys);
  });
});

// ============================================================
// SUPERWEAPON_DEFS parity
// ============================================================
describe('SUPERWEAPON_DEFS parity', () => {
  it('covers all 7 superweapon types', () => {
    expect(Object.keys(SUPERWEAPON_DEFS)).toHaveLength(7);
  });

  it('CHRONOSPHERE — all fields', () => {
    const d = SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE];
    expect(d.building).toBe('PDOX');
    expect(d.rechargeTicks).toBe(6300);
    expect(d.faction).toBe('allied');
    expect(d.requiresPower).toBe(true);
    expect(d.needsTarget).toBe(true);
    expect(d.targetMode).toBe('ground');
  });

  it('IRON_CURTAIN — all fields', () => {
    const d = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN];
    expect(d.building).toBe('IRON');
    expect(d.rechargeTicks).toBe(9900);
    expect(d.faction).toBe('soviet');
    expect(d.requiresPower).toBe(true);
    expect(d.needsTarget).toBe(true);
    expect(d.targetMode).toBe('unit');
  });

  it('NUKE — all fields', () => {
    const d = SUPERWEAPON_DEFS[SuperweaponType.NUKE];
    expect(d.building).toBe('MSLO');
    expect(d.rechargeTicks).toBe(11700);
    expect(d.faction).toBe('soviet');
    expect(d.requiresPower).toBe(true);
    expect(d.needsTarget).toBe(true);
    expect(d.targetMode).toBe('ground');
  });

  it('GPS_SATELLITE — all fields', () => {
    const d = SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE];
    expect(d.building).toBe('ATEK');
    expect(d.rechargeTicks).toBe(7200);
    expect(d.faction).toBe('allied');
    expect(d.requiresPower).toBe(true);
    expect(d.needsTarget).toBe(false);
    expect(d.targetMode).toBe('none');
  });

  it('SONAR_PULSE — all fields', () => {
    const d = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE];
    expect(d.building).toBe('SPEN');
    expect(d.rechargeTicks).toBe(9000);
    expect(d.faction).toBe('both');
    expect(d.requiresPower).toBe(true);
    expect(d.needsTarget).toBe(false);
    expect(d.targetMode).toBe('none');
  });

  it('PARABOMB — all fields', () => {
    const d = SUPERWEAPON_DEFS[SuperweaponType.PARABOMB];
    expect(d.building).toBe('AFLD');
    expect(d.rechargeTicks).toBe(9000);
    expect(d.faction).toBe('soviet');
    expect(d.requiresPower).toBe(true);
    expect(d.needsTarget).toBe(true);
    expect(d.targetMode).toBe('ground');
  });

  it('PARAINFANTRY — all fields', () => {
    const d = SUPERWEAPON_DEFS[SuperweaponType.PARAINFANTRY];
    expect(d.building).toBe('AFLD');
    expect(d.rechargeTicks).toBe(9000);
    expect(d.faction).toBe('soviet');
    expect(d.requiresPower).toBe(true);
    expect(d.needsTarget).toBe(true);
    expect(d.targetMode).toBe('ground');
  });

  // Superweapon constants
  it('IRON_CURTAIN_DURATION = 675 (45s)', () => {
    expect(IRON_CURTAIN_DURATION).toBe(675);
  });

  it('NUKE_DAMAGE = 1000', () => {
    expect(NUKE_DAMAGE).toBe(1000);
  });

  it('NUKE_BLAST_CELLS = 10', () => {
    expect(NUKE_BLAST_CELLS).toBe(10);
  });

  it('NUKE_FLIGHT_TICKS = 45', () => {
    expect(NUKE_FLIGHT_TICKS).toBe(45);
  });

  it('NUKE_MIN_FALLOFF = 0.1', () => {
    expect(NUKE_MIN_FALLOFF).toBe(0.1);
  });

  it('CHRONO_SHIFT_VISUAL_TICKS = 30', () => {
    expect(CHRONO_SHIFT_VISUAL_TICKS).toBe(30);
  });

  it('SONAR_REVEAL_TICKS = 450', () => {
    expect(SONAR_REVEAL_TICKS).toBe(450);
  });

  it('IC_TARGET_RANGE = 3', () => {
    expect(IC_TARGET_RANGE).toBe(3);
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
  it('E7 (Tanya) cost = 1200, faction = both', () => {
    const item = findItem('E7');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(1200);
    expect(item!.faction).toBe('both');
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

  it('MNLY cost = 800, faction = both', () => {
    const item = findItem('MNLY');
    expect(item).toBeDefined();
    expect(item!.cost).toBe(800);
    expect(item!.faction).toBe('both');
  });

});

// ============================================================
// COUNTRY_BONUSES parity
// ============================================================
describe('COUNTRY_BONUSES parity', () => {
  const allCountries = ['Spain', 'Greece', 'England', 'France', 'Germany',
    'Turkey', 'USSR', 'Ukraine', 'GoodGuy', 'BadGuy', 'Neutral'];

  it('has all 11 countries', () => {
    expect(Object.keys(COUNTRY_BONUSES).sort()).toEqual(allCountries.sort());
  });

  // Countries with non-default bonuses
  it('England — armorMult=1.1', () => {
    const b = COUNTRY_BONUSES.England;
    expect(b.costMult).toBe(1.0);
    expect(b.firepowerMult).toBe(1.0);
    expect(b.armorMult).toBe(1.1);
    expect(b.groundspeedMult).toBe(1.0);
    expect(b.rofMult).toBe(1.0);
  });

  it('France — rofMult=1.1', () => {
    const b = COUNTRY_BONUSES.France;
    expect(b.costMult).toBe(1.0);
    expect(b.firepowerMult).toBe(1.0);
    expect(b.armorMult).toBe(1.0);
    expect(b.groundspeedMult).toBe(1.0);
    expect(b.rofMult).toBe(1.1);
  });

  it('Germany — firepowerMult=1.1', () => {
    const b = COUNTRY_BONUSES.Germany;
    expect(b.costMult).toBe(1.0);
    expect(b.firepowerMult).toBe(1.1);
    expect(b.armorMult).toBe(1.0);
    expect(b.groundspeedMult).toBe(1.0);
    expect(b.rofMult).toBe(1.0);
  });

  it('USSR — costMult=0.9', () => {
    const b = COUNTRY_BONUSES.USSR;
    expect(b.costMult).toBe(0.9);
    expect(b.firepowerMult).toBe(1.0);
    expect(b.armorMult).toBe(1.0);
    expect(b.groundspeedMult).toBe(1.0);
    expect(b.rofMult).toBe(1.0);
  });

  it('Ukraine — groundspeedMult=1.1', () => {
    const b = COUNTRY_BONUSES.Ukraine;
    expect(b.costMult).toBe(1.0);
    expect(b.firepowerMult).toBe(1.0);
    expect(b.armorMult).toBe(1.0);
    expect(b.groundspeedMult).toBe(1.1);
    expect(b.rofMult).toBe(1.0);
  });

  // Countries with all-default bonuses
  const defaultCountries = ['Spain', 'Greece', 'Turkey', 'GoodGuy', 'BadGuy', 'Neutral'];
  for (const name of defaultCountries) {
    it(`${name} — all multipliers are 1.0`, () => {
      const b = COUNTRY_BONUSES[name];
      expect(b.costMult, `${name}.costMult`).toBe(1.0);
      expect(b.firepowerMult, `${name}.firepowerMult`).toBe(1.0);
      expect(b.armorMult, `${name}.armorMult`).toBe(1.0);
      expect(b.groundspeedMult, `${name}.groundspeedMult`).toBe(1.0);
      expect(b.rofMult, `${name}.rofMult`).toBe(1.0);
    });
  }
});

// ============================================================
// TERRAIN_SPEED parity
// ============================================================
describe('TERRAIN_SPEED parity', () => {
  it('has 9 terrain types', () => {
    expect(Object.keys(TERRAIN_SPEED)).toHaveLength(9);
  });

  // Full array assertions: [Foot, Track, Wheel, Winged, Float]
  const expected: Record<string, [number, number, number, number, number]> = {
    Clear:  [0.90, 0.80, 0.60, 1.0, 0.0],
    Rough:  [0.80, 0.70, 0.40, 1.0, 0.0],
    Road:   [1.00, 1.00, 1.00, 1.0, 0.0],
    Water:  [0.00, 0.00, 0.00, 1.0, 1.0],
    Rock:   [0.00, 0.00, 0.00, 1.0, 0.0],
    Wall:   [0.00, 0.00, 0.00, 1.0, 0.0],
    Ore:    [0.90, 0.70, 0.50, 1.0, 0.0],
    Beach:  [0.80, 0.70, 0.40, 1.0, 0.0],
    River:  [0.00, 0.00, 0.00, 1.0, 0.0],
  };

  for (const [terrain, speeds] of Object.entries(expected)) {
    it(`${terrain} — [${speeds.join(', ')}]`, () => {
      expect(TERRAIN_SPEED[terrain]).toEqual(speeds);
    });
  }

  it('test covers every key in TERRAIN_SPEED', () => {
    expect(Object.keys(expected).sort()).toEqual(Object.keys(TERRAIN_SPEED).sort());
  });
});

// ============================================================
// STRUCTURE_WEAPONS parity
// ============================================================
describe('STRUCTURE_WEAPONS parity', () => {
  it('has 8 entries', () => {
    expect(Object.keys(STRUCTURE_WEAPONS)).toHaveLength(8);
  });

  it('HBOX — damage=40, range=5, rof=40, warhead=SA, projSpeed=100', () => {
    const w = STRUCTURE_WEAPONS.HBOX;
    expect(w.damage).toBe(40);
    expect(w.range).toBe(5);
    expect(w.rof).toBe(40);
    expect(w.warhead).toBe('SA');
    expect(w.projSpeed).toBe(100);
  });

  it('PBOX — damage=40, range=5, rof=40, warhead=SA, projSpeed=100', () => {
    const w = STRUCTURE_WEAPONS.PBOX;
    expect(w.damage).toBe(40);
    expect(w.range).toBe(5);
    expect(w.rof).toBe(40);
    expect(w.warhead).toBe('SA');
    expect(w.projSpeed).toBe(100);
  });

  it('GUN — damage=40, range=6, rof=50, warhead=AP, splash=0.5, projSpeed=40', () => {
    const w = STRUCTURE_WEAPONS.GUN;
    expect(w.damage).toBe(40);
    expect(w.range).toBe(6);
    expect(w.rof).toBe(50);
    expect(w.warhead).toBe('AP');
    expect(w.splash).toBe(0.5);
    expect(w.projSpeed).toBe(40);
  });

  it('TSLA — damage=100, range=8.5, rof=120, warhead=Super, splash=1, projSpeed=100', () => {
    const w = STRUCTURE_WEAPONS.TSLA;
    expect(w.damage).toBe(100);
    expect(w.range).toBe(8.5);
    expect(w.rof).toBe(120);
    expect(w.warhead).toBe('Super');
    expect(w.splash).toBe(1);
    expect(w.projSpeed).toBe(100);
  });

  it('SAM — damage=50, range=7.5, rof=20, warhead=AP, projSpeed=50, isAntiAir', () => {
    const w = STRUCTURE_WEAPONS.SAM;
    expect(w.damage).toBe(50);
    expect(w.range).toBe(7.5);
    expect(w.rof).toBe(20);
    expect(w.warhead).toBe('AP');
    expect(w.projSpeed).toBe(50);
    expect(w.isAntiAir).toBe(true);
  });

  it('AGUN — damage=25, range=6, rof=10, warhead=AP, projSpeed=100, isAntiAir', () => {
    const w = STRUCTURE_WEAPONS.AGUN;
    expect(w.damage).toBe(25);
    expect(w.range).toBe(6);
    expect(w.rof).toBe(10);
    expect(w.warhead).toBe('AP');
    expect(w.projSpeed).toBe(100);
    expect(w.isAntiAir).toBe(true);
  });

  it('FTUR — damage=125, range=4, rof=50, warhead=Fire, projSpeed=12', () => {
    const w = STRUCTURE_WEAPONS.FTUR;
    expect(w.damage).toBe(125);
    expect(w.range).toBe(4);
    expect(w.rof).toBe(50);
    expect(w.warhead).toBe('Fire');
    expect(w.projSpeed).toBe(12);
  });

  it('QUEE — damage=60, range=5, rof=30, splash=1, warhead=Super, projSpeed=40', () => {
    const w = STRUCTURE_WEAPONS.QUEE;
    expect(w.damage).toBe(60);
    expect(w.range).toBe(5);
    expect(w.rof).toBe(30);
    expect(w.splash).toBe(1);
    expect(w.warhead).toBe('Super');
    expect(w.projSpeed).toBe(40);
  });
});

// ============================================================
// BODY_SHAPE parity (32-entry vehicle rotation lookup)
// ============================================================
describe('BODY_SHAPE parity', () => {
  it('has 32 entries', () => {
    expect(BODY_SHAPE).toHaveLength(32);
  });

  it('full array matches C++ BodyShape[32]', () => {
    expect(BODY_SHAPE).toEqual([
      0, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17,
      16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
  });

  it('index 0 = frame 0 (north facing)', () => {
    expect(BODY_SHAPE[0]).toBe(0);
  });

  it('index 16 = frame 16 (south facing)', () => {
    expect(BODY_SHAPE[16]).toBe(16);
  });
});

// ============================================================
// DIR_DX / DIR_DY parity (8-direction vectors)
// ============================================================
describe('DIR_DX / DIR_DY parity', () => {
  it('DIR_DX has 8 entries', () => {
    expect(DIR_DX).toHaveLength(8);
  });

  it('DIR_DY has 8 entries', () => {
    expect(DIR_DY).toHaveLength(8);
  });

  it('DIR_DX — [0, 1, 1, 1, 0, -1, -1, -1]', () => {
    expect(DIR_DX).toEqual([0, 1, 1, 1, 0, -1, -1, -1]);
  });

  it('DIR_DY — [-1, -1, 0, 1, 1, 1, 0, -1]', () => {
    expect(DIR_DY).toEqual([-1, -1, 0, 1, 1, 1, 0, -1]);
  });

  it('N direction = (0, -1)', () => {
    expect(DIR_DX[0]).toBe(0);
    expect(DIR_DY[0]).toBe(-1);
  });

  it('S direction = (0, 1)', () => {
    expect(DIR_DX[4]).toBe(0);
    expect(DIR_DY[4]).toBe(1);
  });
});

// ============================================================
// ANT_ANIM parity
// ============================================================
describe('ANT_ANIM parity', () => {
  it('standBase = 0', () => expect(ANT_ANIM.standBase).toBe(0));
  it('walkBase = 8, walkCount = 8', () => {
    expect(ANT_ANIM.walkBase).toBe(8);
    expect(ANT_ANIM.walkCount).toBe(8);
  });
  it('attackBase = 72, attackCount = 4', () => {
    expect(ANT_ANIM.attackBase).toBe(72);
    expect(ANT_ANIM.attackCount).toBe(4);
  });
  it('deathBase = 104, deathCount = 8', () => {
    expect(ANT_ANIM.deathBase).toBe(104);
    expect(ANT_ANIM.deathCount).toBe(8);
  });
  it('has exactly 7 fields', () => {
    expect(Object.keys(ANT_ANIM)).toHaveLength(7);
  });
});

// ============================================================
// HOUSE_FACTION parity (11 houses)
// ============================================================
describe('HOUSE_FACTION parity', () => {
  it('has 11 houses', () => {
    expect(Object.keys(HOUSE_FACTION)).toHaveLength(11);
  });

  const expected: Record<string, string> = {
    Spain: 'allied', Greece: 'allied', England: 'allied', France: 'allied',
    Germany: 'allied', Turkey: 'allied', GoodGuy: 'allied',
    USSR: 'soviet', Ukraine: 'soviet', BadGuy: 'soviet',
    Neutral: 'both',
  };

  for (const [house, faction] of Object.entries(expected)) {
    it(`${house} = ${faction}`, () => {
      expect(HOUSE_FACTION[house]).toBe(faction);
    });
  }

  it('test covers every key', () => {
    expect(Object.keys(expected).sort()).toEqual(Object.keys(HOUSE_FACTION).sort());
  });
});

// ============================================================
// SUB_CELL_OFFSETS parity (5 positions)
// ============================================================
describe('SUB_CELL_OFFSETS parity', () => {
  it('has 5 entries', () => {
    expect(SUB_CELL_OFFSETS).toHaveLength(5);
  });

  it('0: center (0, 0)', () => {
    expect(SUB_CELL_OFFSETS[0]).toEqual({ x: 0, y: 0 });
  });

  it('1: top-left (-7, -7)', () => {
    expect(SUB_CELL_OFFSETS[1]).toEqual({ x: -7, y: -7 });
  });

  it('2: top-right (7, -7)', () => {
    expect(SUB_CELL_OFFSETS[2]).toEqual({ x: 7, y: -7 });
  });

  it('3: bottom-left (-7, 7)', () => {
    expect(SUB_CELL_OFFSETS[3]).toEqual({ x: -7, y: 7 });
  });

  it('4: bottom-right (7, 7)', () => {
    expect(SUB_CELL_OFFSETS[4]).toEqual({ x: 7, y: 7 });
  });
});

// ============================================================
// CIVILIAN_UNIT_TYPES parity (13 types)
// ============================================================
describe('CIVILIAN_UNIT_TYPES parity', () => {
  it('has 13 entries', () => {
    expect(CIVILIAN_UNIT_TYPES.size).toBe(13);
  });

  const expected = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'EINSTEIN', 'GNRL', 'CHAN'];
  for (const type of expected) {
    it(`includes ${type}`, () => {
      expect(CIVILIAN_UNIT_TYPES.has(type)).toBe(true);
    });
  }

  it('no extra types', () => {
    expect([...CIVILIAN_UNIT_TYPES].sort()).toEqual(expected.sort());
  });
});

// ============================================================
// STRUCTURE_SIZE parity
// ============================================================
describe('STRUCTURE_SIZE parity', () => {
  const expected: Record<string, [number, number]> = {
    FACT: [3, 3], WEAP: [3, 2], POWR: [2, 2], APWR: [2, 2], BARR: [2, 2], TENT: [2, 2],
    PROC: [3, 2], FIX: [3, 2], SILO: [1, 1], DOME: [2, 2],
    GUN: [1, 1], SAM: [2, 1], HBOX: [1, 1], TSLA: [1, 1], AGUN: [1, 1], GAP: [1, 1], PBOX: [1, 1],
    HPAD: [2, 2], AFLD: [2, 2], ATEK: [2, 2], STEK: [2, 2], PDOX: [2, 2], IRON: [2, 2], MSLO: [2, 2], KENN: [1, 1],
    SYRD: [3, 3], SPEN: [3, 3], BIO: [2, 2], HOSP: [2, 2],
    FACF: [3, 3], DOMF: [2, 2], WEAF: [3, 2],
    QUEE: [2, 2], LAR1: [1, 1], LAR2: [1, 1], FTUR: [1, 1],
    BARL: [1, 1], BRL3: [1, 1],
    MINP: [1, 1], MINV: [1, 1],
    SBAG: [1, 1], FENC: [1, 1], BARB: [1, 1], BRIK: [1, 1], WOOD: [1, 1], CYCL: [1, 1],
    FCOM: [2, 2], MISS: [3, 2],
    ...Object.fromEntries(CIVILIAN_STRUCTURE_2X2.map(type => [type, [2, 2]] as const)),
    ...Object.fromEntries(CIVILIAN_STRUCTURE_2X1.map(type => [type, [2, 1]] as const)),
    ...Object.fromEntries(CIVILIAN_STRUCTURE_1X1.map(type => [type, [1, 1]] as const)),
    ...Object.fromEntries(CIVILIAN_STRUCTURE_4X2.map(type => [type, [4, 2]] as const)),
  };

  for (const [type, size] of Object.entries(expected)) {
    it(`${type} = [${size[0]}, ${size[1]}]`, () => {
      expect(STRUCTURE_SIZE[type]).toEqual(size);
    });
  }

  it('test covers every key in STRUCTURE_SIZE', () => {
    expect(Object.keys(expected).sort()).toEqual(Object.keys(STRUCTURE_SIZE).sort());
  });
});

// ============================================================
// Scalar constants parity (C++ rules.ini defaults)
// ============================================================
describe('Scalar constants parity', () => {
  it('CELL_SIZE = 24', () => expect(CELL_SIZE).toBe(24));
  it('LEPTON_SIZE = 256', () => expect(LEPTON_SIZE).toBe(256));
  it('MAP_CELLS = 128', () => expect(MAP_CELLS).toBe(128));
  it('GAME_TICKS_PER_SEC = 15', () => expect(GAME_TICKS_PER_SEC).toBe(15));
  it('MAX_DAMAGE = 1000', () => expect(MAX_DAMAGE).toBe(1000));
  it('REPAIR_STEP = 5', () => expect(REPAIR_STEP).toBe(5));
  it('REPAIR_PERCENT = 0.20', () => expect(REPAIR_PERCENT).toBe(0.20));
  it('CONDITION_RED = 0.25', () => expect(CONDITION_RED).toBe(0.25));
  it('CONDITION_YELLOW = 0.5', () => expect(CONDITION_YELLOW).toBe(0.5));
  it('PRONE_DAMAGE_BIAS = 0.5', () => expect(PRONE_DAMAGE_BIAS).toBe(0.5));
  it('TEMPLATE_ROAD_MIN = 173', () => expect(TEMPLATE_ROAD_MIN).toBe(173));
  it('TEMPLATE_ROAD_MAX = 228', () => expect(TEMPLATE_ROAD_MAX).toBe(228));
  it('MAX_PROJECTILE_FRAMES = 45', () => expect(MAX_PROJECTILE_FRAMES).toBe(45));
  it('DEFAULT_PROJECTILE_FRAMES = 5', () => expect(DEFAULT_PROJECTILE_FRAMES).toBe(5));
});

// ============================================================
// Entity constants parity (entity.ts)
// ============================================================
describe('Entity constants parity', () => {
  it('CLOAK_TRANSITION_FRAMES = 38', () => expect(CLOAK_TRANSITION_FRAMES).toBe(38));
  it('SONAR_PULSE_DURATION = 225', () => expect(SONAR_PULSE_DURATION).toBe(225));
});

// ============================================================
// RECOIL_OFFSETS parity (8 directions)
// ============================================================
describe('RECOIL_OFFSETS parity', () => {
  it('has 8 entries', () => {
    expect(RECOIL_OFFSETS).toHaveLength(8);
  });

  it('full array matches C++ Recoil_Adjust', () => {
    expect(RECOIL_OFFSETS).toEqual([
      { dx: 0, dy: 1 },   // N — kicks down
      { dx: -1, dy: 1 },  // NE
      { dx: -1, dy: 0 },  // E
      { dx: -1, dy: -1 }, // SE
      { dx: 0, dy: -1 },  // S
      { dx: 1, dy: -1 },  // SW
      { dx: 1, dy: 0 },   // W
      { dx: 1, dy: 1 },   // NW
    ]);
  });
});
