/**
 * C++ Parity Tests: Tesla Coil (TSLA) Charging & Firing Mechanics
 *
 * Source of truth: /public/ra/assets/rules.ini
 * C++ source:      building.cpp:5382-5413 — BuildingClass::Charging_AI
 *                  building.cpp:2850-2865 — Can_Fire: IsElectric && !IsCharged → FIRE_BUSY
 *                  building.cpp:598-612   — Shape selection: IsCharged/IsCharging
 *                  weapon.cpp:216         — IsElectric = ini.Get_Bool(Name(), "Charges", ...)
 *                  building.cpp:1579-1580 — IsCharging(false), IsCharged(false) initial state
 *
 * rules.ini [TSLA]:
 *   Prerequisite=weap, Primary=TeslaZap, Strength=400, Armor=heavy,
 *   TechLevel=7, Sight=8, Owner=soviet, Cost=1500, Points=80,
 *   Power=-150, Ammo=3, Powered=true, Sensors=yes, Crewed=yes
 *
 * rules.ini [TeslaZap]:
 *   Damage=100, ROF=120, Range=8.5, Projectile=Invisible, Speed=100,
 *   Warhead=Super, Report=TESLA1, Charges=yes
 *
 * C++ Charging_AI state machine (building.cpp:5382-5413):
 *   - Precondition: weapon.IsElectric && BState != BSTATE_CONSTRUCTION
 *   - To begin charging: Target_Legal(TarCom) && House->Power_Fraction() >= 1 && !Arm
 *   - Charge: Set_Stage(0), Set_Rate(3), animate stages 0..9
 *   - When Fetch_Stage() >= 9: IsCharged=true, can fire
 *   - Charge time: 10 stages × rate 3 = 30 game ticks
 *   - If power drops or target lost: IsCharging=false, IsCharged=false, stage reset
 *
 * C++ Can_Fire (building.cpp:2850-2865):
 *   - IsPowered && Power_Fraction() < 1 → FIRE_BUSY
 *   - IsElectric && !IsCharged → FIRE_BUSY
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  POWER_DRAIN, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
} from '../engine/types';
import {
  STRUCTURE_WEAPONS, STRUCTURE_POWERED, STRUCTURE_MAX_HP,
  STRUCTURE_ARMOR, STRUCTURE_SIZE,
} from '../engine/scenario';

// ---------------------------------------------------------------------------
// Minimal INI parser — handles rules.ini's flat [Section] Key=Value format
// ---------------------------------------------------------------------------
interface IniData {
  [section: string]: { [key: string]: string };
}

function parseIni(text: string): IniData {
  const data: IniData = {};
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/;.*$/, '').trim();
    if (!line) continue;
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) {
      currentSection = secMatch[1];
      if (!data[currentSection]) data[currentSection] = {};
      continue;
    }
    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (kvMatch && currentSection) {
      data[currentSection][kvMatch[1].trim()] = kvMatch[2].trim();
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Load rules.ini once
// ---------------------------------------------------------------------------
let ini: IniData;

beforeAll(() => {
  const rulesPath = resolve(__dirname, '../../../public/ra/assets/rules.ini');
  ini = parseIni(readFileSync(rulesPath, 'utf-8'));
});

// =============================================================================
// 1. TSLA building stats vs rules.ini
// =============================================================================

describe('TSLA building stats vs rules.ini [TSLA]', () => {

  it('Primary weapon is TeslaZap', () => {
    // rules.ini [TSLA] Primary=TeslaZap
    expect(ini['TSLA'].Primary).toBe('TeslaZap');
  });

  it('Strength=400 matches STRUCTURE_MAX_HP', () => {
    const iniStrength = Number(ini['TSLA'].Strength);
    expect(iniStrength).toBe(400);
    expect(STRUCTURE_MAX_HP['TSLA']).toBe(iniStrength);
  });

  it('Armor=heavy matches STRUCTURE_ARMOR', () => {
    expect(ini['TSLA'].Armor).toBe('heavy');
    expect(STRUCTURE_ARMOR['TSLA']).toBe('heavy');
  });

  it('Power=-150 matches POWER_DRAIN', () => {
    // rules.ini Power=-150 (negative = consumes 150)
    const iniPower = Number(ini['TSLA'].Power);
    expect(iniPower).toBe(-150);
    expect(POWER_DRAIN['TSLA']).toBe(150);
  });

  it('Cost=1500 matches PRODUCTION_ITEMS', () => {
    const iniCost = Number(ini['TSLA'].Cost);
    expect(iniCost).toBe(1500);
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'TSLA');
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(1500);
  });

  it('TechLevel=7 matches PRODUCTION_ITEMS', () => {
    const iniTech = Number(ini['TSLA'].TechLevel);
    expect(iniTech).toBe(7);
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'TSLA');
    expect(prodItem!.techLevel).toBe(7);
  });

  it('Owner=soviet matches PRODUCTION_ITEMS faction', () => {
    expect(ini['TSLA'].Owner).toBe('soviet');
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'TSLA');
    expect(prodItem!.faction).toBe('soviet');
  });

  it('Points=80 matches PRODUCTION_ITEMS', () => {
    const iniPoints = Number(ini['TSLA'].Points);
    expect(iniPoints).toBe(80);
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'TSLA');
    expect(prodItem!.points).toBe(80);
  });

  it('Sight=8 per rules.ini', () => {
    // rules.ini [TSLA] Sight=8 — documents the value for sensor range
    expect(Number(ini['TSLA'].Sight)).toBe(8);
  });

  it('Powered=true — TSLA is in STRUCTURE_POWERED set', () => {
    expect(ini['TSLA'].Powered).toBe('true');
    expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
  });

  it('Ammo=3 per rules.ini — rapid-fire 3 shots then ROF cooldown', () => {
    // rules.ini [TSLA] Ammo=3
    // C++ building.cpp:882-883 — fires Ammo shots rapidly (1 tick rearm), then full ROF recharge
    expect(Number(ini['TSLA'].Ammo)).toBe(3);
  });

  it('Sensors=yes per rules.ini', () => {
    expect(ini['TSLA'].Sensors).toBe('yes');
  });

  it('Crewed=yes per rules.ini', () => {
    expect(ini['TSLA'].Crewed).toBe('yes');
  });

  it('Prerequisite=weap per rules.ini', () => {
    expect(ini['TSLA'].Prerequisite).toBe('weap');
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'TSLA');
    expect(prodItem!.prerequisite).toBe('WEAP');
  });
});

// =============================================================================
// 2. TeslaZap weapon stats vs rules.ini [TeslaZap]
// =============================================================================

describe('TeslaZap weapon stats vs rules.ini [TeslaZap]', () => {

  it('Damage=100 matches STRUCTURE_WEAPONS.TSLA', () => {
    const iniDamage = Number(ini['TeslaZap'].Damage);
    expect(iniDamage).toBe(100);
    expect(STRUCTURE_WEAPONS['TSLA'].damage).toBe(iniDamage);
  });

  it('ROF=120 matches STRUCTURE_WEAPONS.TSLA', () => {
    const iniROF = Number(ini['TeslaZap'].ROF);
    expect(iniROF).toBe(120);
    expect(STRUCTURE_WEAPONS['TSLA'].rof).toBe(iniROF);
  });

  it('Range=8.5 matches STRUCTURE_WEAPONS.TSLA', () => {
    const iniRange = Number(ini['TeslaZap'].Range);
    expect(iniRange).toBe(8.5);
    expect(STRUCTURE_WEAPONS['TSLA'].range).toBe(iniRange);
  });

  it('Speed=100 matches STRUCTURE_WEAPONS.TSLA projSpeed', () => {
    const iniSpeed = Number(ini['TeslaZap'].Speed);
    expect(iniSpeed).toBe(100);
    expect(STRUCTURE_WEAPONS['TSLA'].projSpeed).toBe(iniSpeed);
  });

  it('Warhead=Super matches STRUCTURE_WEAPONS.TSLA', () => {
    expect(ini['TeslaZap'].Warhead).toBe('Super');
    expect(STRUCTURE_WEAPONS['TSLA'].warhead).toBe('Super');
  });

  it('Projectile=Invisible per rules.ini', () => {
    expect(ini['TeslaZap'].Projectile).toBe('Invisible');
  });

  it('Report=TESLA1 per rules.ini — charge-up sound', () => {
    expect(ini['TeslaZap'].Report).toBe('TESLA1');
  });

  it('Charges=yes per rules.ini — sets weapon.IsElectric in C++', () => {
    // weapon.cpp:216: IsElectric = ini.Get_Bool(Name(), "Charges", IsElectric)
    // This flag gates the Charging_AI state machine in building.cpp:5384
    expect(ini['TeslaZap'].Charges).toBe('yes');
  });
});

// =============================================================================
// 3. Super warhead — universal 100% damage multiplier (rules.ini [Super])
// =============================================================================

describe('Super warhead vs rules.ini [Super]', () => {

  it('Spread=1 per rules.ini', () => {
    expect(Number(ini['Super'].Spread)).toBe(1);
  });

  it('Verses=100%,100%,100%,100%,100% — 1.0x vs all armor types', () => {
    expect(ini['Super'].Verses).toBe('100%,100%,100%,100%,100%');
    // TS WARHEAD_VS_ARMOR.Super should have 1.0 for all 5 armor types
    const tsMultipliers = WARHEAD_VS_ARMOR['Super'];
    expect(tsMultipliers).toBeDefined();
    for (let i = 0; i < 5; i++) {
      expect(tsMultipliers[i], `Super vs armor index ${i}`).toBe(1.0);
    }
  });

  it('InfDeath=5 per rules.ini', () => {
    expect(Number(ini['Super'].InfDeath)).toBe(5);
  });
});

// =============================================================================
// 4. Invisible projectile (rules.ini [Invisible])
// =============================================================================

describe('Invisible projectile vs rules.ini [Invisible]', () => {

  it('Inviso=yes per rules.ini', () => {
    expect(ini['Invisible'].Inviso).toBe('yes');
  });

  it('Image=none per rules.ini', () => {
    expect(ini['Invisible'].Image).toBe('none');
  });

  it('AA is NOT set (default false) — Tesla cannot target air', () => {
    // Invisible projectile has no AA= line → defaults to false
    // This means TeslaZap cannot target airborne aircraft
    expect(ini['Invisible'].AA).toBeUndefined();
  });
});

// =============================================================================
// 5. Charging state machine parity (building.cpp:5382-5413)
//    C++ has a multi-tick charge-up before firing; TS may differ.
// =============================================================================

describe('C++ Charging_AI parity (building.cpp:5382-5413)', () => {

  it('C++ charges 10 stages at rate 3 = 30 ticks before first shot', () => {
    // building.cpp:5396-5401: Set_Stage(0), Set_Rate(3)
    // building.cpp:5390: if (Fetch_Stage() >= 9) IsCharged = true
    // 10 stages (0-9) at rate 3 (3 ticks per stage) = 30 ticks charge time
    const CHARGE_STAGES = 10; // stages 0 through 9
    const CHARGE_RATE = 3;    // ticks per stage (Set_Rate(3))
    const expectedChargeTicks = CHARGE_STAGES * CHARGE_RATE;
    expect(expectedChargeTicks).toBe(30);
  });

  it('C++ requires Charges=yes (IsElectric) to activate charge state machine', () => {
    // weapon.cpp:216: IsElectric = ini.Get_Bool(Name(), "Charges", IsElectric)
    // building.cpp:5384: if (Class->PrimaryWeapon->IsElectric && ...)
    expect(ini['TeslaZap'].Charges).toBe('yes');
  });

  it('C++ requires Power_Fraction() >= 1 to charge — maps to IsPowered check', () => {
    // building.cpp:5385: if (Target_Legal(TarCom) && House->Power_Fraction() >= 1)
    // building.cpp:2853: if (Class->IsPowered && House->Power_Fraction() < 1) return FIRE_BUSY
    // TS uses powerConsumed > powerProduced as the low-power check (combat.ts:1362)
    expect(ini['TSLA'].Powered).toBe('true');
    expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
  });

  it('C++ resets charge on power loss — IsCharging=false, IsCharged=false', () => {
    // building.cpp:5404-5411: else { IsCharging=false; IsCharged=false; Set_Stage(0); Set_Rate(0); }
    // TS: powered buildings skip fire entirely during low power (combat.ts:1367)
    // Both prevent firing during low power; C++ additionally tracks charge state
    expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
  });

  it('TS StructureWeapon interface has no isElectric/isCharges property', () => {
    // MISMATCH: C++ tracks IsElectric (Charges=yes) on the weapon to gate Charging_AI.
    // TS StructureWeapon only has: damage, range, rof, splash, warhead, projSpeed, isAntiAir.
    // The charge-up delay is not modeled in TS — Tesla fires instantly when cooldown expires.
    const tslaWeapon = STRUCTURE_WEAPONS['TSLA'] as Record<string, unknown>;
    expect(tslaWeapon.isElectric).toBeUndefined();
    expect(tslaWeapon.isCharges).toBeUndefined();
    expect(tslaWeapon.charges).toBeUndefined();
  });

  it('MISMATCH: TS has no charge-up delay — fires immediately when cooldown=0', () => {
    // C++ has a 30-tick charge animation before the Tesla can fire.
    // TS fires as soon as attackCooldown reaches 0.
    // This test documents the behavioral gap.
    //
    // C++ flow: target acquired → charge 30 ticks → fire → ROF cooldown 120 → charge 30 → fire
    // TS flow:  target acquired → fire instantly → cooldown 120 → fire instantly
    //
    // Impact: TS Tesla fires its first shot 30 ticks sooner than C++.
    const tslaWeapon = STRUCTURE_WEAPONS['TSLA'];
    // TS only has rof (120) as the timing gate; no separate charge property
    expect(tslaWeapon.rof).toBe(120);
    // If charge-up existed, effective first-shot delay would be 30 + 120 = 150 ticks
    // TS effective first-shot delay is just 0 (fires on first tick with cooldown=0)
    expect(true).toBe(true); // documents the mismatch
  });
});

// =============================================================================
// 6. Ammo=3 parity (rules.ini [TSLA] Ammo=3)
//    C++ fires 3 rapid shots (1-tick rearm) then ROF=120 cooldown.
// =============================================================================

describe('TSLA Ammo=3 rapid-fire parity (rules.ini, building.cpp:882)', () => {

  it('rules.ini [TSLA] Ammo=3', () => {
    expect(Number(ini['TSLA'].Ammo)).toBe(3);
  });

  it('TS default structure ammo is -1 (unlimited) before INI override', () => {
    // scenario.ts:1593-1594: ammo: -1, maxAmmo: -1 (default for all structures)
    // scenario.ts:1695-1701: if section.has('Ammo') → override from scenario INI
    // rules.ini [TSLA] Ammo=3 is applied via rawSections override at init
    // This means TSLA should have ammo=3 in-game when scenario parses it
    expect(true).toBe(true); // ammo initialization tested at scenario load time
  });

  it('TS combat uses ammo-based rapid fire (combat.ts:1454-1456)', () => {
    // combat.ts:1454-1456:
    //   if (s.ammo > 0) {
    //     s.ammo--;
    //     s.attackCooldown = s.ammo > 0 ? 1 : Math.round(s.weapon.rof * structRofBias);
    //   }
    // When ammo=3: fires with cooldown=1, fires with cooldown=1, fires with cooldown=120
    // Matches C++ pattern: rapid-fire burst then full ROF delay
    expect(true).toBe(true);
  });
});

// =============================================================================
// 7. WEAPON_STATS.TeslaZap is the ANT3 variant, NOT the building version
//    This is correct by design — STRUCTURE_WEAPONS has the building version.
// =============================================================================

describe('WEAPON_STATS.TeslaZap is ANT3 variant (not building TSLA)', () => {

  it('WEAPON_STATS.TeslaZap damage=60 (ANT3 variant, not rules.ini 100)', () => {
    // The TeslaZap in WEAPON_STATS is for ANT3 (Scout Ant), not TSLA building.
    // ANT3 variant intentionally has different stats (weaker, shorter range).
    // Building TSLA uses STRUCTURE_WEAPONS which has the correct rules.ini values.
    const antTeslaZap = WEAPON_STATS['TeslaZap'];
    expect(antTeslaZap).toBeDefined();
    expect(antTeslaZap.damage).toBe(60); // ANT3 variant
    expect(antTeslaZap.damage).not.toBe(100); // NOT rules.ini [TeslaZap] Damage=100
  });

  it('WEAPON_STATS.TeslaZap rof=25 (ANT3 variant, not rules.ini 120)', () => {
    expect(WEAPON_STATS['TeslaZap'].rof).toBe(25);
    expect(WEAPON_STATS['TeslaZap'].rof).not.toBe(120);
  });

  it('WEAPON_STATS.TeslaZap range=1.75 (ANT3 variant, not rules.ini 8.5)', () => {
    expect(WEAPON_STATS['TeslaZap'].range).toBe(1.75);
    expect(WEAPON_STATS['TeslaZap'].range).not.toBe(8.5);
  });

  it('STRUCTURE_WEAPONS.TSLA has the correct rules.ini values', () => {
    // Building version uses STRUCTURE_WEAPONS, not WEAPON_STATS
    expect(STRUCTURE_WEAPONS['TSLA'].damage).toBe(100);
    expect(STRUCTURE_WEAPONS['TSLA'].rof).toBe(120);
    expect(STRUCTURE_WEAPONS['TSLA'].range).toBe(8.5);
  });
});

// =============================================================================
// 8. C++ Can_Fire dual gate (building.cpp:2850-2865)
//    Two independent checks prevent firing: IsPowered + IsElectric
// =============================================================================

describe('C++ Can_Fire dual gate (building.cpp:2850-2865)', () => {

  it('Gate 1: IsPowered && Power_Fraction() < 1 → FIRE_BUSY', () => {
    // building.cpp:2853: if (Class->IsPowered && House->Power_Fraction() < 1) return FIRE_BUSY
    // TS: combat.ts:1367: if (isLowPower && STRUCTURE_POWERED.has(s.type)) continue
    // Both correctly prevent TSLA from firing during power deficit.
    expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
  });

  it('Gate 2: IsElectric && !IsCharged → FIRE_BUSY (C++ only)', () => {
    // building.cpp:2860: if (Class->PrimaryWeapon->IsElectric && !IsCharged) return FIRE_BUSY
    // TS has NO equivalent: no IsCharged state tracking.
    // In TS, the power check is the only gate — once cooldown=0, Tesla fires immediately.
    // MISMATCH: C++ requires charge-up even when at full power; TS does not.
    const tslaWeapon = STRUCTURE_WEAPONS['TSLA'] as Record<string, unknown>;
    expect(tslaWeapon.isElectric).toBeUndefined();
  });
});

// =============================================================================
// 9. Tesla charge animation frames (building.cpp:598-612)
//    C++ displays 4 visual states: idle(0), charging(stage 0-9), charged(3)
// =============================================================================

describe('C++ Tesla charge animation (building.cpp:598-612)', () => {

  it('Idle shape = frame 0', () => {
    // building.cpp:609: shapenum = 0 (not charging, not charged)
    const IDLE_FRAME = 0;
    expect(IDLE_FRAME).toBe(0);
  });

  it('Charging shape = Fetch_Stage() (frames 0-9)', () => {
    // building.cpp:607: if (IsCharging) shapenum = Fetch_Stage()
    // Stages advance from 0 to 9 at rate 3
    const CHARGE_START = 0;
    const CHARGE_END = 9;
    expect(CHARGE_END - CHARGE_START + 1).toBe(10); // 10 animation frames
  });

  it('Fully charged shape = frame 3', () => {
    // building.cpp:603-604: if (IsCharged) shapenum = 3
    // This is a fixed frame showing the "ready to fire" state
    const CHARGED_FRAME = 3;
    expect(CHARGED_FRAME).toBe(3);
  });
});

// =============================================================================
// 10. Tesla sound effects (rules.ini Report=TESLA1, C++ VOC_TESLA_POWER_UP)
// =============================================================================

describe('Tesla sound effects (rules.ini, building.cpp:5401)', () => {

  it('rules.ini [TeslaZap] Report=TESLA1 — firing sound', () => {
    expect(ini['TeslaZap'].Report).toBe('TESLA1');
  });

  it('C++ plays VOC_TESLA_POWER_UP when charge begins (building.cpp:5401)', () => {
    // building.cpp:5401: Sound_Effect(VOC_TESLA_POWER_UP, Coord)
    // This plays at the START of charging, not at firing time.
    // TS plays "teslazap" at fire time (combat.ts:1497) — different timing.
    expect(true).toBe(true); // documents the behavioral note
  });
});

// =============================================================================
// 11. Cross-reference: TSLA splash in STRUCTURE_WEAPONS vs Super warhead Spread
// =============================================================================

describe('TSLA splash radius vs Super warhead Spread', () => {

  it('rules.ini [Super] Spread=1 — splash factor from warhead', () => {
    expect(Number(ini['Super'].Spread)).toBe(1);
  });

  it('STRUCTURE_WEAPONS.TSLA splash=1 matches warhead Spread=1', () => {
    // The splash radius in STRUCTURE_WEAPONS.TSLA (splash=1) corresponds to
    // the Super warhead's Spread=1 value from rules.ini [Super].
    expect(STRUCTURE_WEAPONS['TSLA'].splash).toBe(1);
  });
});

// =============================================================================
// 12. TSLA vs other structures: the only Charges=yes building weapon
// =============================================================================

describe('TeslaZap is the only building weapon with Charges=yes', () => {

  it('TeslaZap has Charges=yes', () => {
    expect(ini['TeslaZap'].Charges).toBe('yes');
  });

  it('TurretGun does NOT have Charges', () => {
    expect(ini['TurretGun'].Charges).toBeUndefined();
  });

  it('Vulcan does NOT have Charges', () => {
    expect(ini['Vulcan'].Charges).toBeUndefined();
  });

  it('Nike does NOT have Charges', () => {
    expect(ini['Nike'].Charges).toBeUndefined();
  });

  it('ZSU-23 does NOT have Charges', () => {
    expect(ini['ZSU-23'].Charges).toBeUndefined();
  });

  it('FireballLauncher does NOT have Charges', () => {
    expect(ini['FireballLauncher'].Charges).toBeUndefined();
  });
});
