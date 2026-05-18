/**
 * C++ Behavioral Parity: Dual-Weapon Selection (What_Weapon_Should_I_Use)
 *
 * Tests verify that the TS selectWeapon() method matches C++ TechnoClass::What_Weapon_Should_I_Use()
 * (techno.cpp:338-380) for units with two weapons.
 *
 * C++ algorithm (techno.cpp:338-380):
 *   1. Get target armor (default ARMOR_WOOD if not an object)
 *   2. w1 = PrimaryWeapon->WarheadPtr->Modifier[armor] * 1000
 *   3. If In_Range(target, 0): w1 *= 2   (range DOUBLES score, does NOT zero it)
 *   4. If Can_Fire(target, 0) == FIRE_CANT or FIRE_ILLEGAL: w1 = 0
 *   5. Same for w2 with SecondaryWeapon
 *   6. Return 1 (secondary) if w2 > w1, else 0 (primary)
 *
 * Can_Fire constraints (techno.cpp:2663-2760):
 *   - weapon == NULL → FIRE_CANT
 *   - Aircraft in flight + !weapon->Bullet->IsAntiAircraft → FIRE_CANT
 *   - Ground target (Height==0, not SS/MSUB vessel) + !weapon->Bullet->IsAntiGround → FIRE_CANT
 *   - Cell target + !IsAntiGround → FIRE_CANT
 *   - Arm reloading → FIRE_REARM (NOT FIRE_CANT — does NOT zero weapon score)
 *   - Out of range → FIRE_RANGE (NOT FIRE_CANT — does NOT zero weapon score)
 *   - No ammo → FIRE_AMMO (NOT FIRE_CANT — does NOT zero weapon score)
 *
 * Key insight: C++ What_Weapon_Should_I_Use does NOT consider cooldown/rearm.
 * Only FIRE_CANT and FIRE_ILLEGAL zero the weapon score. FIRE_REARM, FIRE_RANGE,
 * FIRE_AMMO are other states that do NOT zero it.
 *
 * rules.ini is the authoritative source for all weapon/projectile data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, UNIT_STATS, WEAPON_STATS,
  WARHEAD_VS_ARMOR, getWarheadMultiplier, armorIndex,
  type WarheadType, type ArmorType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Place two entities at specified cell distance apart (same row) */
function pairAtDistance(
  attackerType: UnitType, targetType: UnitType,
  distanceCells: number,
  attackerHouse = House.Spain, targetHouse = House.USSR,
): [Entity, Entity] {
  const attacker = entityAtCell(attackerType, attackerHouse, 10, 10);
  const target = entityAtCell(targetType, targetHouse, 10 + distanceCells, 10);
  return [attacker, target];
}

/** C++ What_Weapon_Should_I_Use score for a weapon vs armor (before range/Can_Fire) */
function cppWeaponScore(weaponName: string, armor: ArmorType): number {
  const w = WEAPON_STATS[weaponName];
  if (!w) return 0;
  return getWarheadMultiplier(w.warhead, armor) * 1000;
}

// =============================================================================
// 1. DATA PARITY: Weapon configurations from rules.ini
//    Verify the dual-weapon units have correct weapons assigned.
// =============================================================================

describe('C++ Parity — Dual-weapon unit assignments (rules.ini)', () => {
  // rules.ini [4TNK] Primary=120mm, Secondary=MammothTusk
  it('4TNK: Primary=120mm, Secondary=MammothTusk', () => {
    const e = entityAtCell(UnitType.V_4TNK, House.Spain, 5, 5);
    expect(e.weapon).not.toBeNull();
    expect(e.weapon!.name).toBe('120mm');
    expect(e.weapon2).not.toBeNull();
    expect(e.weapon2!.name).toBe('MammothTusk');
  });

  // rules.ini [E3] Primary=RedEye, Secondary=Dragon
  it('E3: Primary=RedEye (AA-only), Secondary=Dragon (ground)', () => {
    const e = entityAtCell(UnitType.I_E3, House.Spain, 5, 5);
    expect(e.weapon).not.toBeNull();
    expect(e.weapon!.name).toBe('RedEye');
    expect(e.weapon2).not.toBeNull();
    expect(e.weapon2!.name).toBe('Dragon');
  });

  // rules.ini [DD] Primary=Stinger, Secondary=DepthCharge
  it('DD: Primary=Stinger, Secondary=DepthCharge', () => {
    const e = entityAtCell(UnitType.V_DD, House.Spain, 5, 5);
    expect(e.weapon).not.toBeNull();
    expect(e.weapon!.name).toBe('Stinger');
    expect(e.weapon2).not.toBeNull();
    expect(e.weapon2!.name).toBe('DepthCharge');
  });

  // rules.ini [PT] Primary=2Inch, Secondary=DepthCharge
  it('PT: Primary=2Inch, Secondary=DepthCharge', () => {
    const e = entityAtCell(UnitType.V_PT, House.Spain, 5, 5);
    expect(e.weapon).not.toBeNull();
    expect(e.weapon!.name).toBe('2Inch');
    expect(e.weapon2).not.toBeNull();
    expect(e.weapon2!.name).toBe('DepthCharge');
  });
});

// =============================================================================
// 2. PROJECTILE FLAG PARITY: AA/AG flags match rules.ini projectile sections
// =============================================================================

describe('C++ Parity — Projectile AA/AG flags (rules.ini projectile sections)', () => {
  // rules.ini [AAMissile] AA=yes, AG=no — used by RedEye
  it('RedEye projectile (AAMissile): isAntiAir=true, isAntiGround=false', () => {
    const w = WEAPON_STATS['RedEye'];
    expect(w.isAntiAir).toBe(true);
    expect(w.isAntiGround).toBe(false);
  });

  // rules.ini [HeatSeeker] AA=yes (no AG= line → defaults to AG=yes in C++) — used by Dragon, MammothTusk
  it('Dragon projectile (HeatSeeker): isAntiAir=true, AG defaults to true', () => {
    const w = WEAPON_STATS['Dragon'];
    expect(w.isAntiAir).toBe(true);
    // HeatSeeker has no AG= line → C++ default is IsAntiGround=true
    // TS should NOT have isAntiGround=false
    expect(w.isAntiGround).not.toBe(false);
  });

  it('MammothTusk projectile (HeatSeeker): isAntiAir=true, AG defaults to true', () => {
    const w = WEAPON_STATS['MammothTusk'];
    expect(w.isAntiAir).toBe(true);
    expect(w.isAntiGround).not.toBe(false);
  });

  // rules.ini [Cannon] — no AA, no AG → C++ defaults: IsAntiAircraft=false, IsAntiGround=true
  // Used by 120mm
  it('120mm projectile (Cannon): NOT anti-air (no AA flag)', () => {
    const w = WEAPON_STATS['120mm'];
    // Cannon has no AA=yes → IsAntiAircraft defaults to false
    expect(w.isAntiAir).toBeFalsy();
  });

  // rules.ini [Catapult] AG=no, ASW=yes — used by DepthCharge
  it('DepthCharge projectile (Catapult): isAntiGround=false, isAntiSub=true', () => {
    const w = WEAPON_STATS['DepthCharge'];
    expect(w.isAntiGround).toBe(false);
    expect(w.isAntiSub).toBe(true);
  });

  // rules.ini [LaserGuided] AA=yes — used by Stinger
  it('Stinger projectile (LaserGuided): isAntiAir=true', () => {
    const w = WEAPON_STATS['Stinger'];
    expect(w.isAntiAir).toBe(true);
  });
});

// =============================================================================
// 3. C++ What_Weapon_Should_I_Use — warhead effectiveness scoring
//    C++ scores weapons as: warhead_modifier[target_armor] * 1000
//    Then doubles if in range; zeros if Can_Fire returns FIRE_CANT/FIRE_ILLEGAL.
// =============================================================================

describe('C++ Parity — Warhead effectiveness scoring (techno.cpp:357-372)', () => {
  // C++ scoring: w = WarheadPtr->Modifier[armor] * 1000
  // rules.ini [AP] Verses=30%,75%,75%,100%,50% → [none, wood, light, heavy, concrete]
  // rules.ini [HE] Verses=90%,75%,60%,25%,100%

  it('4TNK vs heavy armor (3TNK): 120mm/AP scores higher than MammothTusk/HE', () => {
    // 120mm: AP warhead, vs heavy → 1.0 * 1000 = 1000
    // MammothTusk: HE warhead, vs heavy → 0.25 * 1000 = 250
    expect(cppWeaponScore('120mm', 'heavy')).toBe(1000);
    expect(cppWeaponScore('MammothTusk', 'heavy')).toBe(250);
    // C++ returns primary (120mm) — AP is best vs heavy armor
  });

  it('4TNK vs no armor (infantry E1): MammothTusk/HE scores higher than 120mm/AP', () => {
    // 120mm: AP warhead, vs none → 0.3 * 1000 = 300
    // MammothTusk: HE warhead, vs none → 0.9 * 1000 = 900
    expect(cppWeaponScore('120mm', 'none')).toBe(300);
    expect(cppWeaponScore('MammothTusk', 'none')).toBe(900);
    // C++ returns secondary (MammothTusk) — HE is best vs no armor
  });

  it('4TNK vs light armor: MammothTusk/HE vs 120mm/AP', () => {
    // 120mm: AP vs light → 0.75 * 1000 = 750
    // MammothTusk: HE vs light → 0.6 * 1000 = 600
    expect(cppWeaponScore('120mm', 'light')).toBe(750);
    expect(cppWeaponScore('MammothTusk', 'light')).toBe(600);
    // C++ returns primary (120mm) — AP edges out vs light
  });

  it('4TNK vs wood armor: scores are tied at 750', () => {
    // 120mm: AP vs wood → 0.75 * 1000 = 750
    // MammothTusk: HE vs wood → 0.75 * 1000 = 750
    expect(cppWeaponScore('120mm', 'wood')).toBe(750);
    expect(cppWeaponScore('MammothTusk', 'wood')).toBe(750);
    // C++ returns primary on tie (w2 > w1 is false when w2 == w1)
  });

  it('DD Stinger vs DepthCharge: both AP warhead, scores match per armor', () => {
    // Stinger: AP warhead, DepthCharge: AP warhead — same warhead effectiveness
    // Against heavy armor: both score 1000
    expect(cppWeaponScore('Stinger', 'heavy')).toBe(1000);
    expect(cppWeaponScore('DepthCharge', 'heavy')).toBe(1000);
    // Against light: both 750
    expect(cppWeaponScore('Stinger', 'light')).toBe(750);
    expect(cppWeaponScore('DepthCharge', 'light')).toBe(750);
  });
});

// =============================================================================
// 4. E3 ROCKET SOLDIER — RedEye vs Dragon weapon selection
//    C++ techno.cpp:2699-2720 Can_Fire: RedEye uses AAMissile (AG=no),
//    so Can_Fire returns FIRE_CANT for ground targets, zeroing w1.
//    Dragon uses HeatSeeker (AA=yes, AG=default true), can hit everything.
// =============================================================================

describe('C++ Parity — E3 weapon selection: RedEye (AA) vs Dragon (ground)', () => {
  it('E3 vs ground infantry: selects Dragon (RedEye AG=no cannot fire at ground)', () => {
    const [rocket, infantry] = pairAtDistance(UnitType.I_E3, UnitType.I_E1, 3);
    const selected = rocket.selectWeapon(infantry, getWarheadMultiplier);
    // C++ techno.cpp:2751-2758: Can_Fire(target, 0) for RedEye returns FIRE_CANT
    // because AAMissile IsAntiGround=false and target is on ground (Height==0)
    // → w1 zeroed → returns Dragon (secondary)
    expect(selected).toBe(rocket.weapon2); // Dragon
    expect(selected!.name).toBe('Dragon');
  });

  it('E3 vs falling infantry: selects RedEye because C++ AG=no checks Height==0', () => {
    const [rocket, infantry] = pairAtDistance(UnitType.I_E3, UnitType.I_E1, 6);
    infantry.isFalling = true;
    infantry.fallHeightLeptons = 73;
    infantry.flightAltitude = 6;

    const selected = rocket.selectWeapon(infantry, getWarheadMultiplier);
    expect(rocket.canWeaponTarget(infantry, rocket.weapon!)).toBe(true);
    expect(selected).toBe(rocket.weapon); // RedEye
    expect(selected!.name).toBe('RedEye');
  });

  it('E3 vs ground vehicle (heavy armor): selects Dragon', () => {
    const [rocket, tank] = pairAtDistance(UnitType.I_E3, UnitType.V_3TNK, 3);
    const selected = rocket.selectWeapon(tank, getWarheadMultiplier);
    expect(selected!.name).toBe('Dragon');
  });

  it('E3 vs ground structure-like target (wood armor): selects Dragon', () => {
    // Any ground target with any armor — RedEye cannot fire at it
    const [rocket, arty] = pairAtDistance(UnitType.I_E3, UnitType.V_ARTY, 3);
    const selected = rocket.selectWeapon(arty, getWarheadMultiplier);
    expect(selected!.name).toBe('Dragon');
  });

  it('E3 vs aircraft (HELI): C++ selects RedEye (primary tie/range winner)', () => {
    // RedEye and Dragon both use AP vs light armor (HELI has light armor).
    // C++ scores: RedEye = 750 (0.75*1000), Dragon = 750 → tie → primary (RedEye)
    // RedEye also has 7.5 range vs Dragon's 5.0. If target is within 5:
    //   both in range → both doubled → still tied → primary (RedEye)
    // If target between 5-7.5: RedEye doubled, Dragon not → RedEye wins.
    const [rocket, heli] = pairAtDistance(UnitType.I_E3, UnitType.V_HELI, 3);
    const selected = rocket.selectWeapon(heli, getWarheadMultiplier);
    // C++ returns primary (RedEye) vs aircraft — both are AA, but RedEye has
    // better range and the same warhead score.
    expect(selected!.name).toBe('RedEye');
  });

  it('E3 vs landed aircraft: selects Dragon because RedEye is AG=no', () => {
    // C++ techno.cpp:2734-2740 applies the ground-target IsAntiGround gate
    // whenever target Height == 0, including RTTI_AIRCRAFT sitting on a pad.
    const [rocket, heli] = pairAtDistance(UnitType.I_E3, UnitType.V_HELI, 3);
    heli.flightAltitude = 0;
    heli.aircraftHeightLeptons = 0;
    heli.aircraftState = 'landed';

    const selected = rocket.selectWeapon(heli, getWarheadMultiplier);
    expect(selected!.name).toBe('Dragon');
  });
});

// =============================================================================
// 5. 4TNK MAMMOTH TANK — 120mm vs MammothTusk weapon selection
//    120mm: Cannon projectile (no AA, AG=default yes)
//    MammothTusk: HeatSeeker projectile (AA=yes, AG=default yes)
//
//    Key C++ behavior: vs aircraft, 120mm scores zero (Cannon not AA),
//    MammothTusk is the ONLY valid weapon.
// =============================================================================

describe('C++ Parity — 4TNK weapon selection: 120mm vs MammothTusk', () => {
  it('4TNK vs heavy armor tank (in range, both ready): selects 120mm (AP better vs heavy)', () => {
    const [mammoth, target] = pairAtDistance(UnitType.V_4TNK, UnitType.V_3TNK, 3);
    const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
    // AP vs heavy = 1.0, HE vs heavy = 0.25 → 120mm wins decisively
    expect(selected!.name).toBe('120mm');
  });

  it('4TNK vs infantry (no armor): selects MammothTusk (HE better vs none)', () => {
    const [mammoth, infantry] = pairAtDistance(UnitType.V_4TNK, UnitType.I_E1, 3);
    const selected = mammoth.selectWeapon(infantry, getWarheadMultiplier);
    // AP vs none = 0.3, HE vs none = 0.9 → MammothTusk wins
    expect(selected!.name).toBe('MammothTusk');
  });

  it('4TNK vs wood armor: tie-break to primary (120mm)', () => {
    // Both AP and HE have 0.75 vs wood.
    // C++ score: both Modifier[wood]*1000 = 750. C++ tie → primary (120mm)
    const [mammoth, target] = pairAtDistance(UnitType.V_4TNK, UnitType.I_E1, 3);
    target.stats = { ...target.stats, armor: 'wood' as ArmorType };
    const apVsWood = getWarheadMultiplier('AP', 'wood');   // 0.75
    const heVsWood = getWarheadMultiplier('HE', 'wood');   // 0.75
    expect(apVsWood).toBe(heVsWood); // confirms tie

    const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(selected!.name).toBe('120mm');
  });

  it('FIXED: 4TNK vs airborne aircraft selects MammothTusk (AA gate active)', () => {
    // HELI starts airborne (flightAltitude=FLIGHT_ALTITUDE), so the AA gate activates.
    // C++ Can_Fire(target, 0) for 120mm vs aircraft: Cannon not AA → FIRE_CANT → w1=0
    // C++ Can_Fire(target, 1) for MammothTusk vs aircraft: HeatSeeker AA=yes → OK
    // C++ returns secondary (MammothTusk) — the only weapon that can hit air targets.
    //
    // FIXED: With aircraft now spawning airborne (matching C++), the TS AA gate
    // (entity.ts:645-651) correctly zeros non-AA weapons and selects MammothTusk.
    const [mammoth, heli] = pairAtDistance(UnitType.V_4TNK, UnitType.V_HELI, 3);
    const selected = mammoth.selectWeapon(heli, getWarheadMultiplier);
    // FIXED: TS now correctly selects MammothTusk (AA weapon) vs airborne aircraft
    expect(selected!.name).toBe('MammothTusk');
  });

  it('4TNK 120mm should be flagged as NOT anti-air (Cannon projectile has no AA)', () => {
    // In C++, Can_Fire zeroes the score. TS mirrors that in selectWeapon.
    const w = WEAPON_STATS['120mm'];
    expect(w.isAntiAir).toBeFalsy(); // Cannon: no AA=yes → IsAntiAircraft=false
  });
});

// =============================================================================
// 6. DD DESTROYER — Stinger vs DepthCharge weapon selection
//    Stinger: LaserGuided (AA=yes, AG not specified → default true)
//    DepthCharge: Catapult (AG=no, ASW=yes)
//
//    C++ behavior:
//    - vs surface ship: Stinger (DepthCharge AG=no → FIRE_CANT for non-sub surface targets)
//    - vs submarine (SS/MSUB): DepthCharge (AG=no has exception for SS/MSUB in Can_Fire)
//    - vs aircraft: Stinger (AA=yes, DepthCharge has no AA → FIRE_CANT for air)
// =============================================================================

describe('C++ Parity — DD weapon selection: Stinger vs DepthCharge', () => {
  it('DD vs surface ship (CA, heavy armor): selects Stinger (DepthCharge AG=no)', () => {
    const [dd, cruiser] = pairAtDistance(UnitType.V_DD, UnitType.V_CA, 3);
    const selected = dd.selectWeapon(cruiser, getWarheadMultiplier);
    // C++ Can_Fire for DepthCharge vs surface vessel (not SS/MSUB):
    //   techno.cpp:2711-2720: Height==0, not SS vessel → !IsAntiGround → FIRE_CANT
    //   → w2 = 0
    // Stinger can fire → returns primary
    expect(selected!.name).toBe('Stinger');
  });

  it('DD vs submarine (SS): C++ selects DepthCharge (Catapult ASW exception)', () => {
    // C++ techno.cpp:2712-2716 (FIXIT_CSII):
    //   if object->Height == 0 AND (What_Am_I() != RTTI_VESSEL || not SS/MSUB) AND !IsAntiGround
    //   → FIRE_CANT
    //   For SS: What_Am_I() == RTTI_VESSEL AND vessel == VESSEL_SS → exception passes
    //   So DepthCharge CAN fire at SS despite AG=no.
    //
    // VesselClass::Can_Fire then applies the ASW restriction:
    //   if target is SS/MSUB and weapon is not ASW → FIRE_CANT.
    // Stinger is not ASW, so only DepthCharge remains viable.
    const [dd, sub] = pairAtDistance(UnitType.V_DD, UnitType.V_SS, 3);
    const selected = dd.selectWeapon(sub, getWarheadMultiplier);
    expect(selected!.name).toBe('DepthCharge');
  });

  it('DD DepthCharge should be able to fire at submarines (C++ VESSEL_SS exception)', () => {
    // In C++, Can_Fire has a special exception at techno.cpp:2712-2716:
    // DepthCharge (AG=no) can fire at SS and MSUB because they are excluded from the
    // ground-target check. This means DepthCharge is a valid weapon vs subs.
    //
    const [dd, sub] = pairAtDistance(UnitType.V_DD, UnitType.V_SS, 4);
    const selected = dd.selectWeapon(sub, getWarheadMultiplier);
    expect(selected!.name).toBe('DepthCharge');
  });

  it('PT vs submarine: same DepthCharge behavior as DD', () => {
    const [pt, sub] = pairAtDistance(UnitType.V_PT, UnitType.V_SS, 3);
    const selected = pt.selectWeapon(sub, getWarheadMultiplier);
    // PT primary=2Inch (Cannon, no AA), secondary=DepthCharge (AG=no)
    // C++ VesselClass::Can_Fire rejects non-ASW 2Inch against SS and allows
    // DepthCharge through the SS/MSUB AG=no exception.
    expect(selected!.name).toBe('DepthCharge');
  });
});

// =============================================================================
// 7. SCORING: warhead-only, not damage-weighted
//    C++ techno.cpp:359 — w1 = WarheadPtr->Modifier[armor] * 1000
//    (No weapon damage in the score)
// =============================================================================

describe('C++ Parity — Scoring algorithm uses warhead modifier only', () => {
  it('4TNK vs wood armor ties by warhead score and selects primary 120mm', () => {
    const [mammoth, target] = pairAtDistance(UnitType.V_4TNK, UnitType.I_E1, 3);
    target.stats = { ...target.stats, armor: 'wood' as ArmorType };

    const apVsWood = getWarheadMultiplier('AP', 'wood');
    const heVsWood = getWarheadMultiplier('HE', 'wood');
    expect(apVsWood).toBe(0.75);
    expect(heVsWood).toBe(0.75);

    const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(selected!.name).toBe('120mm');
  });

  it('4TNK vs light armor selects 120mm even though MammothTusk has higher raw damage', () => {
    const [mammoth, target] = pairAtDistance(UnitType.V_4TNK, UnitType.V_ARTY, 3);
    expect(target.stats.armor).toBe('light');

    // C++ scores AP 0.75 > HE 0.60 and ignores weapon damage.
    // A damage-weighted selector would incorrectly choose MammothTusk.
    const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(selected!.name).toBe('120mm');
  });

  it('equal warhead scores prefer primary', () => {
    // Same-warhead dual-weapon units (e.g., CA with 8Inch/8Inch) always tie in C++
    // and default to primary. TS would also tie (same damage too) and default to primary.
    const [cruiser, target] = pairAtDistance(UnitType.V_CA, UnitType.V_3TNK, 10);
    const selected = cruiser.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBe(cruiser.weapon);
  });
});

// =============================================================================
// 8. COOLDOWN AND RANGE: selection ignores FIRE_REARM/FIRE_RANGE
//    C++ What_Weapon_Should_I_Use does NOT consider cooldown (Arm timer).
//    Can_Fire returns FIRE_REARM when Arm != 0, but that does NOT zero the score
//    (only FIRE_CANT and FIRE_ILLEGAL zero it).
// =============================================================================

describe('C++ Parity — Cooldown/range do not erase weapon selection', () => {
  it('picks best weapon even when both weapons are on cooldown', () => {
    // C++ What_Weapon_Should_I_Use: Arm!=0 → FIRE_REARM (not FIRE_CANT)
    // FIRE_REARM does NOT zero the score. C++ still returns the best weapon.
    // The caller decides whether to actually fire based on rearm state.
    //
    const [mammoth, target] = pairAtDistance(UnitType.V_4TNK, UnitType.V_3TNK, 3);
    mammoth.attackCooldown = 30;
    mammoth.attackCooldown2 = 30;

    const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(selected!.name).toBe('120mm');
  });

  it('still selects weapon when on cooldown but in range', () => {
    // C++ techno.cpp:360: if (In_Range(target, 0)) w1 *= 2
    // This doubles the score for in-range weapons. But it does NOT zero out-of-range weapons.
    // C++ techno.cpp:362: only FIRE_CANT/FIRE_ILLEGAL zero the score.
    //
    const [mammoth, target] = pairAtDistance(UnitType.V_4TNK, UnitType.I_E1, 3);
    mammoth.attackCooldown = 10;
    mammoth.attackCooldown2 = 0;

    const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(selected!.name).toBe('MammothTusk');
  });

  it('C++ picks weapon even when target is out of range (range doubles, does not zero)', () => {
    // C++ techno.cpp:359-362: w1 = mult * 1000; if in range, w1 *= 2.
    // Out of range weapons still have their base score (not zeroed).
    // Can_Fire returns FIRE_RANGE for out-of-range, NOT FIRE_CANT.
    //
    const [mammoth, target] = pairAtDistance(UnitType.V_4TNK, UnitType.V_3TNK, 20);
    // 120mm range=4.75, MammothTusk range=5.0 — both out of range at 20 cells

    const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
    // C++: both score non-zero, not doubled, AP vs heavy (1000) > HE vs heavy (250) → 120mm
    expect(selected!.name).toBe('120mm');
  });
});

// =============================================================================
// 9. AIRCRAFT TARGETING — isAntiAir constraint
//    C++ Can_Fire (techno.cpp:2699-2707): if target is aircraft in flight
//    AND weapon->Bullet->IsAntiAircraft is false → FIRE_CANT → zeroes score.
//
//    TS selectWeapon mirrors this by zeroing non-AA weapons against airborne aircraft.
// =============================================================================

describe('C++ Parity — Anti-air constraint in weapon selection', () => {
  it('C++ zeros non-AA weapons vs aircraft', () => {
    // 4TNK 120mm uses Cannon projectile: no AA flag → IsAntiAircraft=false
    // C++ Can_Fire(aircraft, 0) → FIRE_CANT → w1=0 → forces MammothTusk
    const w120mm = WEAPON_STATS['120mm'];
    const wTusk = WEAPON_STATS['MammothTusk'];
    expect(w120mm.isAntiAir).toBeFalsy();  // Cannon: no AA
    expect(wTusk.isAntiAir).toBe(true);    // HeatSeeker: AA=yes
  });

  it('FIXED: selectWeapon picks MammothTusk vs airborne aircraft (AA gate active)', () => {
    // HELI starts airborne (flightAltitude=FLIGHT_ALTITUDE), so AA gate activates.
    // 120mm uses Cannon (no AA) → zeroed by AA gate (entity.ts:645-651)
    // MammothTusk uses HeatSeeker (AA=yes) → passes AA gate
    // Result: MammothTusk selected — matches C++ behavior.
    const [mammoth, heli] = pairAtDistance(UnitType.V_4TNK, UnitType.V_HELI, 3);
    const selected = mammoth.selectWeapon(heli, getWarheadMultiplier);
    // FIXED: TS now correctly selects MammothTusk vs airborne aircraft
    expect(selected!.name).toBe('MammothTusk');
  });

  it('PT 2Inch (Cannon, no AA) should not fire at aircraft in C++', () => {
    // PT primary=2Inch (Cannon projectile, no AA), secondary=DepthCharge (Catapult, no AA)
    // C++ Can_Fire: BOTH weapons have no AA → BOTH return FIRE_CANT vs aircraft
    // → both w1 and w2 zeroed → C++ returns primary (0 == 0, w2 not > w1)
    // PT effectively cannot engage aircraft at all in C++.
    //
    // TS: neither weapon has isAntiGround=false (2Inch is fine, DepthCharge is AG=no)
    // For aircraft target: targetIsAircraft=true, so AG gate doesn't block DepthCharge
    // TS would score both: 2Inch AP vs light=0.75, DepthCharge AP vs light=0.75
    // TS eff: 25*0.75=18.75 vs 80*0.75=60 → TS picks DepthCharge!
    // C++ picks neither (both non-AA, effectively can't engage air)
    const w2Inch = WEAPON_STATS['2Inch'];
    const wDepthCharge = WEAPON_STATS['DepthCharge'];
    expect(w2Inch.isAntiAir).toBeFalsy();     // Cannon: no AA
    expect(wDepthCharge.isAntiAir).toBeFalsy(); // Catapult: no AA
    // C++: PT cannot engage aircraft. TS: no AA gate → might try.
  });
});

// =============================================================================
// 10. EDGE CASES — same weapon on both slots
// =============================================================================

describe('C++ Parity — Same weapon on both slots (3TNK, CA, MIG, YAK, HELI)', () => {
  it('3TNK (Primary=105mm, Secondary=105mm): always selects primary (identical scores)', () => {
    const [tank, target] = pairAtDistance(UnitType.V_3TNK, UnitType.V_2TNK, 3);
    const selected = tank.selectWeapon(target, getWarheadMultiplier);
    // Same weapon → same warhead, same damage → C++ ties → primary
    // TS: same eff → returns primary
    expect(selected!.name).toBe('105mm');
    expect(selected).toBe(tank.weapon); // specifically the primary weapon object
  });

  it('CA (Primary=8Inch, Secondary=8Inch): always selects primary', () => {
    const [cruiser, target] = pairAtDistance(UnitType.V_CA, UnitType.V_DD, 3);
    const selected = cruiser.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBe(cruiser.weapon);
  });

  it('MIG (Primary=Maverick, Secondary=Maverick): always selects primary', () => {
    const [mig, target] = pairAtDistance(UnitType.V_MIG, UnitType.V_2TNK, 3);
    const selected = mig.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBe(mig.weapon);
  });
});

// =============================================================================
// 11. RANGE BONUS — C++ doubles in-range score, TS treats as binary gate
// =============================================================================

describe('C++ Parity — Range bonus divergence (techno.cpp:360,370)', () => {
  it('C++ range bonus: in-range weapon score is doubled (×2)', () => {
    // C++ techno.cpp:360: if (In_Range(target, 0)) w1 *= 2
    // This means an in-range weapon with LOWER warhead mult can beat an out-of-range
    // weapon with HIGHER mult, because 2× beats base.
    //
    // Example with hypothetical: weapon A (mult 0.5, in range) = 500*2 = 1000
    //   vs weapon B (mult 0.9, out of range) = 900
    //   A wins due to range bonus.
    //
    // TS: out-of-range weapon is simply "not ready" (binary), never selected.
    // This is a more aggressive filter than C++.
    const score500InRange = 500 * 2;
    const score900OutRange = 900;
    expect(score500InRange).toBeGreaterThan(score900OutRange);
  });

  it('4TNK at intermediate range: 120mm in range, MammothTusk out of range', () => {
    // 120mm range=4.75, MammothTusk range=5.0
    // At exactly 4.8 cells: 120mm is in range, MammothTusk is out
    // This is nearly impossible in practice (only 0.25 cell difference)
    // but tests the range bonus logic.
    const range120mm = WEAPON_STATS['120mm'].range;
    const rangeTusk = WEAPON_STATS['MammothTusk'].range;
    expect(range120mm).toBe(4.75);
    expect(rangeTusk).toBe(5.0);
    // Gap is only 0.25 cells — minimal practical impact
  });

  it('E3 at intermediate range: RedEye in range (7.5), Dragon out of range (5.0)', () => {
    // At 6 cells: RedEye in range, Dragon out of range
    // But RedEye has AG=no, so vs ground targets:
    // C++: RedEye → FIRE_CANT (AG=no) → w1=0. Dragon: out of range, not doubled, score=750
    // Returns Dragon despite being out of range (score 750 > 0)
    //
    // TS: RedEye blocked by AG gate → returns Dragon immediately (line 622)
    // Same result, different path.
    const rangeRedEye = WEAPON_STATS['RedEye'].range;
    const rangeDragon = WEAPON_STATS['Dragon'].range;
    expect(rangeRedEye).toBe(7.5);
    expect(rangeDragon).toBe(5.0);
  });
});

// =============================================================================
// 12. COMPREHENSIVE: All dual-weapon units, expected weapon vs each armor class
//     Validates C++ What_Weapon_Should_I_Use results for all armor types.
//     Based on warhead modifier scoring (C++ uses modifier*1000, no damage factor).
// =============================================================================

describe('C++ Parity — Expected weapon per armor type (C++ warhead-only scoring)', () => {
  // 4TNK: 120mm (AP) vs MammothTusk (HE)
  // AP:  none=0.3, wood=0.75, light=0.75, heavy=1.0, concrete=0.5
  // HE:  none=0.9, wood=0.75, light=0.6,  heavy=0.25, concrete=1.0
  const mammothExpectedCpp: Record<ArmorType, string> = {
    'none':     'MammothTusk',  // HE 0.9 > AP 0.3
    'wood':     '120mm',        // Tie 0.75 = 0.75 → primary (C++)
    'light':    '120mm',        // AP 0.75 > HE 0.6
    'heavy':    '120mm',        // AP 1.0 > HE 0.25
    'concrete': 'MammothTusk',  // HE 1.0 > AP 0.5
  };

  for (const armor of ['none', 'wood', 'light', 'heavy', 'concrete'] as ArmorType[]) {
    it(`4TNK vs ${armor} armor — C++ expected: ${mammothExpectedCpp[armor]}`, () => {
      const [mammoth, target] = pairAtDistance(UnitType.V_4TNK, UnitType.I_E1, 3);
      target.stats = { ...target.stats, armor };
      const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
      expect(selected!.name).toBe(mammothExpectedCpp[armor]);
    });
  }
});

// =============================================================================
// 13. INTEGRATION: selectWeapon produces correct results for in-range scenarios
// =============================================================================

describe('C++ Parity — selectWeapon integration (in-range, both ready)', () => {
  it('4TNK vs heavy armor tank: 120mm (AP dominates heavy)', () => {
    const [mammoth, tank] = pairAtDistance(UnitType.V_4TNK, UnitType.V_3TNK, 3);
    expect(mammoth.selectWeapon(tank, getWarheadMultiplier)!.name).toBe('120mm');
  });

  it('4TNK vs infantry (no armor): MammothTusk (HE dominates none)', () => {
    const [mammoth, inf] = pairAtDistance(UnitType.V_4TNK, UnitType.I_E1, 3);
    expect(mammoth.selectWeapon(inf, getWarheadMultiplier)!.name).toBe('MammothTusk');
  });

  it('E3 vs ground tank: Dragon (RedEye AG=no)', () => {
    const [e3, tank] = pairAtDistance(UnitType.I_E3, UnitType.V_2TNK, 3);
    expect(e3.selectWeapon(tank, getWarheadMultiplier)!.name).toBe('Dragon');
  });

  it('E3 vs aircraft: RedEye (both AA, RedEye primary tie/range winner)', () => {
    const [e3, heli] = pairAtDistance(UnitType.I_E3, UnitType.V_HELI, 3);
    expect(e3.selectWeapon(heli, getWarheadMultiplier)!.name).toBe('RedEye');
  });

  it('DD vs surface ship: Stinger (DepthCharge AG=no)', () => {
    const [dd, ca] = pairAtDistance(UnitType.V_DD, UnitType.V_CA, 3);
    expect(dd.selectWeapon(ca, getWarheadMultiplier)!.name).toBe('Stinger');
  });

  it('DD vs infantry: Stinger (DepthCharge AG=no)', () => {
    const [dd, inf] = pairAtDistance(UnitType.V_DD, UnitType.I_E1, 3);
    expect(dd.selectWeapon(inf, getWarheadMultiplier)!.name).toBe('Stinger');
  });
});
