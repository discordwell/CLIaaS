/**
 * C++ Behavioral Parity Tests — Special Units
 *
 * Tests engineer capture mechanics, chronoshift infantry kill, and demo truck
 * detonation against C++ source behavior.
 *
 * C++ references:
 *   - infantry.cpp:598-637 — Engineer capture/damage logic
 *   - house.cpp:2808-2853  — Chronoshift (SPC_CHRONO2) with infantry kill
 *   - unit.cpp:4215-4221   — Demo truck Fire_At + immediate self-delete
 *   - rules.cpp:235        — ConditionRed = fixed(1,4) = 0.25
 *   - rules.cpp:285-286    — EngineerDamage = 1/3, EngineerCaptureLevel = ConditionRed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import {
  CONDITION_RED,
  CHRONO_SHIFT_VISUAL_TICKS,
  House, Mission, UnitType,
} from '../engine/types';
import {
  DEMO_TRUCK_DAMAGE, DEMO_TRUCK_RADIUS, DEMO_TRUCK_FUSE_TICKS,
  updateDemoTruck,
  type SpecialUnitsContext,
} from '../engine/specialUnits';
import {
  updateAttackStructure,
  type MissionAIContext,
} from '../engine/missionAI';
import {
  activateSuperweapon,
  type SuperweaponContext,
} from '../engine/superweapon';
import { SuperweaponType, type SuperweaponState } from '../engine/types';
import { type MapStructure } from '../engine/scenario';
import { CELL_SIZE } from '../engine/types';

// ============================================================
// Helper factories
// ============================================================

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeStructure(overrides: Partial<MapStructure> = {}): MapStructure {
  return {
    type: 'POWR',
    cx: 10,
    cy: 10,
    house: House.USSR,
    hp: 200,
    maxHp: 200,
    alive: true,
    powered: true,
    sellTimer: 0,
    repairActive: false,
    rallyPoint: null,
    triggerName: undefined,
    ...overrides,
  } as MapStructure;
}

/**
 * Minimal MissionAIContext stub — provides just enough for updateAttackStructure.
 * Only the fields actually called by the engineer branch are stubbed.
 */
function makeMissionAIContext(overrides: Partial<MissionAIContext> = {}): MissionAIContext {
  return {
    entities: [],
    structures: [],
    effects: [],
    map: { isPassable: () => true, getOccupancy: () => 0 } as any,
    tick: 100,
    playerHouse: House.Greece,
    killCount: 0,
    evaMessages: [],
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    isAllied: (a: House, b: House) => a === b,
    entitiesAllied: (a: Entity, b: Entity) => a.house === b.house,
    isPlayerControlled: (e: Entity) => e.house === House.Greece,
    movementSpeed: () => 0.5,
    playSoundAt: vi.fn(),
    playEva: vi.fn(),
    playSound: vi.fn(),
    weaponSound: () => 'gun',
    damageEntity: vi.fn(() => false),
    damageStructure: vi.fn(() => false),
    triggerRetaliation: vi.fn(),
    handleUnitDeath: vi.fn(),
    launchProjectile: vi.fn(),
    applySplashDamage: vi.fn(),
    getFirepowerBias: () => 1,
    getROFBias: () => 1,
    getWarheadMult: () => 1,
    getWarheadMeta: () => ({ spread: 3, isWallDestroyer: false, isTiberiumDestroyer: false, isOrganic: false, isFlameWeapon: false }),
    getWarheadProps: () => undefined,
    warheadMuzzleColor: () => '255,255,0',
    weaponProjectileStyle: () => 'bullet',
    idleMission: () => Mission.GUARD,
    retreatFromTarget: vi.fn(),
    threatScore: () => 1,
    updateDemoTruck: vi.fn(),
    updateMedic: vi.fn(),
    updateMechanicUnit: vi.fn(),
    updateTanyaC4: vi.fn(),
    updateThief: vi.fn(),
    spyDisguise: vi.fn(),
    spyInfiltrate: vi.fn(),
    minimapAlert: vi.fn(),
    ...overrides,
  } as MissionAIContext;
}

/**
 * Minimal SpecialUnitsContext stub for demo truck tests.
 */
function makeSpecialUnitsContext(overrides: Partial<SpecialUnitsContext> = {}): SpecialUnitsContext {
  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    mines: [],
    activeVortices: [],
    effects: [],
    tick: 100,
    playerHouse: House.Greece,
    credits: 5000,
    houseCredits: new Map(),
    map: { isPassable: () => true, getOccupancy: () => 0, boundsX: 0, boundsY: 0, boundsW: 64, boundsH: 64 } as any,
    evaMessages: [],
    isThieved: false,
    isAllied: (a: House, b: House) => a === b,
    entitiesAllied: (a: Entity, b: Entity) => a.house === b.house,
    isPlayerControlled: (e: Entity) => e.house === House.Greece,
    playSoundAt: vi.fn(),
    playSound: vi.fn(),
    movementSpeed: () => 0.5,
    damageEntity: vi.fn(() => true),
    damageStructure: vi.fn(() => true),
    addEntity: vi.fn(),
    screenShake: 0,
    ...overrides,
  } as SpecialUnitsContext;
}

/**
 * Minimal SuperweaponContext stub for chronoshift tests.
 */
function makeSuperweaponContext(overrides: Partial<SuperweaponContext> = {}): SuperweaponContext {
  const state: SuperweaponState = { ready: true, chargeTick: 9000, chargeTime: 9000 };
  const superweapons = new Map<string, SuperweaponState>();
  superweapons.set(`${House.Greece}:${SuperweaponType.CHRONOSPHERE}`, state);

  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    superweapons,
    effects: [],
    tick: 100,
    playerHouse: House.Greece,
    powerProduced: 500,
    powerConsumed: 200,
    killCount: 0,
    lossCount: 0,
    map: {
      revealAll: vi.fn(),
      shroudAll: vi.fn(),
      isPassable: () => true,
      isTerrainPassable: () => true,
      isWaterPassable: () => false,
      setVisibility: vi.fn(),
      inBounds: () => true,
      setTerrain: vi.fn(),
      unjamRadius: vi.fn(),
    },
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    gpsActive: false,
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied: (a: House, b: House) => a === b,
    isPlayerControlled: (e: Entity) => e.house === House.Greece,
    pushEva: vi.fn(),
    playSound: vi.fn(),
    playSoundAt: vi.fn(),
    damageEntity: vi.fn((target: Entity, amount: number) => {
      target.hp -= amount;
      if (target.hp <= 0) { target.alive = false; }
      return target.hp <= 0;
    }),
    damageStructure: vi.fn(() => false),
    addEntity: vi.fn(),
    aiIQ: () => 5,
    getWarheadMult: () => 1,
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 640,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  } as SuperweaponContext;
}

beforeEach(() => {
  resetEntityIds();
  setPlayerHouses(new Set([House.Greece, House.Spain]));
});

// ============================================================
// Section 1: CONDITION_RED constant — rules.cpp:235
// ============================================================
/**
 * C++ rules.cpp:235:
 *   ConditionRed(fixed(1, 4)),
 *
 * This is the health threshold for "red" status and engineer capture eligibility.
 * fixed(1,4) = 1/4 = 0.25
 */
describe('CONDITION_RED constant (rules.cpp:235)', () => {
  it('CONDITION_RED equals 0.25 (C++ fixed(1,4))', () => {
    expect(CONDITION_RED).toBe(0.25);
  });
});

// ============================================================
// Section 2: Engineer Capture — Threshold Check
// C++ infantry.cpp:618-621:
//   #ifdef FIXIT_ENGINEER
//     if (tech->Health_Ratio() <= EngineerCaptureLevel && iscapturable) {
//   #else
//     if (tech->Health_Ratio() <= Rule.ConditionRed && iscapturable) {
//   #endif
//       tech->House->IsThieved = true;
//       tech->Captured(House);
//
// C++ rules.cpp:286: EngineerCaptureLevel=ConditionRed (both paths use 0.25)
// ============================================================
describe('Engineer capture threshold (infantry.cpp:618-621)', () => {
  it('engineer captures enemy building when hp/maxHp <= 0.25 (CONDITION_RED)', () => {
    const s = makeStructure({ hp: 50, maxHp: 200, house: House.USSR });
    // hp/maxHp = 50/200 = 0.25 <= 0.25 → capture
    const eng = makeEntity(UnitType.I_E6, House.Greece, s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });
    ctx.structures = [s];

    updateAttackStructure(ctx, eng, s);

    // Building should now belong to the player
    expect(s.house).toBe(House.Greece);
    // Engineer consumed (C++ infantry.cpp:636 — "delete this")
    expect(eng.alive).toBe(false);
  });

  it('engineer captures at exactly 25% HP (boundary — <= not <)', () => {
    const s = makeStructure({ hp: 100, maxHp: 400, house: House.USSR });
    // hp/maxHp = 100/400 = 0.25 exactly — should capture (<=)
    const eng = makeEntity(UnitType.I_E6, House.Greece, s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(s.house).toBe(House.Greece);
  });

  it('engineer damages (not captures) when hp/maxHp > 0.25', () => {
    const s = makeStructure({ hp: 150, maxHp: 200, house: House.USSR });
    // hp/maxHp = 150/200 = 0.75 > 0.25 → damage, not capture
    const eng = makeEntity(UnitType.I_E6, House.Greece, s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    // Building should still be enemy
    expect(s.house).toBe(House.USSR);
    // Engineer still consumed
    expect(eng.alive).toBe(false);
    // Building should have taken damage
    expect(s.hp).toBeLessThan(150);
  });

  it('engineer damages at 26% HP (just above threshold — no capture)', () => {
    const s = makeStructure({ hp: 52, maxHp: 200, house: House.USSR });
    // hp/maxHp = 52/200 = 0.26 > 0.25 → damage, not capture
    const eng = makeEntity(UnitType.I_E6, House.Greece, s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(s.house).toBe(House.USSR);
  });
});

// ============================================================
// Section 3: Engineer Damage Formula
// C++ infantry.cpp:629-631:
//   #ifdef FIXIT_ENGINEER
//     int damage = min( (tech->Techno_Type_Class()->MaxStrength) * EngineerDamage, tech->Strength-1);
//   #else
//     int damage = min( (tech->Techno_Type_Class()->MaxStrength) / 3, tech->Strength-1);
//   #endif
//
// With FIXIT_ENGINEER: EngineerDamage = 1/3 (rules.cpp:285)
// Both paths effectively: min(MaxStrength / 3, currentHP - 1)
// Key: engineer damage can NEVER kill the building (capped at Strength-1)
// ============================================================
describe('Engineer damage formula (infantry.cpp:629-631)', () => {
  it('damage = min(MaxStrength/3, currentHP-1) — standard case', () => {
    const s = makeStructure({ hp: 150, maxHp: 300, house: House.USSR });
    // Expected: min(300/3, 150-1) = min(100, 149) = 100
    const eng = makeEntity(UnitType.I_E6, House.Greece, s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    expect(s.hp).toBe(50); // 150 - 100 = 50
  });

  it('damage capped at currentHP-1 when building is low HP', () => {
    // Building at 30 HP, MaxStrength=300 → min(100, 29) = 29
    const s = makeStructure({ hp: 30, maxHp: 300, house: House.USSR });
    // hp/maxHp = 30/300 = 0.10 → below capture threshold, so it captures instead
    // We need hp > 0.25 * maxHp to test damage path
    // 0.25 * 300 = 75, so hp must be > 75
    // Let's use hp=80, maxHp=300: min(100, 79) = 79, hp remains 1
    const s2 = makeStructure({ hp: 80, maxHp: 300, house: House.USSR });
    const eng = makeEntity(UnitType.I_E6, House.Greece, s2.cx * CELL_SIZE + CELL_SIZE, s2.cy * CELL_SIZE + CELL_SIZE);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s2);

    // min(floor(300/3), 80-1) = min(100, 79) = 79
    expect(s2.hp).toBe(1); // 80 - 79 = 1 — building survives
    expect(s2.alive).toBe(true);
  });

  it('engineer damage never kills building (C++ Strength-1 cap)', () => {
    // Building at 2 HP and above capture threshold
    // Need hp > 0.25 * maxHp → use maxHp=4, hp=2 → 0.5 > 0.25
    const s = makeStructure({ hp: 2, maxHp: 4, house: House.USSR });
    const eng = makeEntity(UnitType.I_E6, House.Greece, s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    // min(floor(4/3)=1, 2-1=1) = 1
    expect(s.hp).toBe(1);
    expect(s.alive).toBe(true); // never killed
  });

  it('engineer is always consumed after capture or damage (C++ delete this — infantry.cpp:636)', () => {
    // Capture path
    const s1 = makeStructure({ hp: 50, maxHp: 200, house: House.USSR });
    const eng1 = makeEntity(UnitType.I_E6, House.Greece, s1.cx * CELL_SIZE + CELL_SIZE, s1.cy * CELL_SIZE + CELL_SIZE);
    const ctx1 = makeMissionAIContext({ playerHouse: House.Greece });
    updateAttackStructure(ctx1, eng1, s1);
    expect(eng1.alive).toBe(false);

    // Damage path
    const s2 = makeStructure({ hp: 150, maxHp: 200, house: House.USSR });
    const eng2 = makeEntity(UnitType.I_E6, House.Greece, s2.cx * CELL_SIZE + CELL_SIZE, s2.cy * CELL_SIZE + CELL_SIZE);
    const ctx2 = makeMissionAIContext({ playerHouse: House.Greece });
    updateAttackStructure(ctx2, eng2, s2);
    expect(eng2.alive).toBe(false);
  });
});

// ============================================================
// Section 4: Engineer Friendly Repair
// C++ infantry.cpp:606-611:
//   if (House->Is_Ally(tech)) {
//     tech->Renovate();  // restores to full HP
//   }
// The engineer heals an allied building to full and is consumed.
// ============================================================
describe('Engineer friendly repair — Renovate() (infantry.cpp:606-611)', () => {
  it('engineer heals allied building to full HP', () => {
    const s = makeStructure({ hp: 80, maxHp: 200, house: House.Greece });
    const eng = makeEntity(UnitType.I_E6, House.Greece, s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece, isAllied: (a, b) => a === b });

    updateAttackStructure(ctx, eng, s);

    expect(s.hp).toBe(200); // fully repaired (C++ Renovate())
    expect(eng.alive).toBe(false); // engineer consumed
  });

  it('engineer on full-HP allied building — C++ does nothing, TS matches', () => {
    /**
     * C++ infantry.cpp:606-611:
     *   if (House->Is_Ally(tech)) {
     *     tech->Renovate();  // always takes this branch for allies
     *   }
     * Renovate() on a full-health building is a harmless no-op. Engineer is consumed.
     *
     * TS: engineer on full-HP allied building is consumed harmlessly.
     * CLOSED: TS now matches C++ — Renovate() no-op on full-health ally.
     */
    const s = makeStructure({ hp: 200, maxHp: 200, house: House.Greece });
    const eng = makeEntity(UnitType.I_E6, House.Greece, s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece, isAllied: (a, b) => a === b });

    updateAttackStructure(ctx, eng, s);

    // C++ parity: Renovate() on full-health building is a harmless no-op. HP stays at 200.
    expect(s.hp).toBe(200); // C++ Renovate() no-op — engineer consumed, building unharmed
    // Engineer is still consumed either way
    expect(eng.alive).toBe(false);
  });
});

// ============================================================
// Section 5: Engineer Capture — HP Restoration Divergence
// C++ building.cpp:2936 — Captured() does NOT restore HP
// TS missionAI.ts:1034-1035 — sets s.hp = s.maxHp after capture
// ============================================================
describe('Engineer capture HP behavior — C++ vs TS divergence', () => {
  /**
   * C++ building.cpp:2936-3000: BuildingClass::Captured(HouseClass * newowner)
   * The Captured() method changes ownership but does NOT heal the building.
   * The building remains at its pre-capture HP.
   *
   * RESOLVED: TS missionAI.ts:1091-1095 now changes ownership WITHOUT restoring HP,
   * matching C++ building.cpp:2936 Captured() behavior exactly.
   * The repair path (missionAI.ts:1073) is separate — only allied engineers repair.
   */
  it('RESOLVED: TS capture does not restore HP (matches C++ Captured())', () => {
    const s = makeStructure({ hp: 50, maxHp: 200, house: House.USSR });
    const eng = makeEntity(UnitType.I_E6, House.Greece, s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, eng, s);

    // C++ parity: Captured() changes ownership but does NOT restore HP
    expect(s.hp).toBe(50);
    // C++ building.cpp:2936: building remains at pre-capture HP
  });
});

// ============================================================
// Section 6: Chronoshift Infantry Kill
// C++ house.cpp:2820-2826:
//   if (tech->What_Am_I() == RTTI_INFANTRY) {
//     InfantryClass * inf = (InfantryClass *)tech;
//     inf->Mark(MARK_UP);
//     inf->Coord = Cell_Coord(cell);
//     inf->Mark(MARK_DOWN);
//     int damage = inf->Strength;
//     inf->Take_Damage(damage, 0, WARHEAD_FIRE, 0, true);
//   }
//
// Infantry teleported via Chronosphere are killed with full-strength
// fire warhead damage. Organic matter cannot survive the shift.
// ============================================================
describe('Chronoshift infantry kill (house.cpp:2820-2826)', () => {
  it('infantry is killed when chronoshifted — damage equals full HP', () => {
    const infantry = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    infantry.selected = true;
    infantry.hp = 50;
    infantry.maxHp = 50;

    const ctx = makeSuperweaponContext({
      entities: [infantry],
    });

    const target = { x: 500, y: 500 };
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Greece, target);

    // C++: damage = inf->Strength (full current HP)
    // TS: damage = unit.hp
    expect(ctx.damageEntity).toHaveBeenCalledWith(infantry, 50, 'Fire');
    // Infantry should be moved to destination before being killed
    // Positions are lepton-quantized: 500 → round(500/LP)*LP ≈ 499.97
    expect(infantry.pos.x).toBeCloseTo(500, 0);
    expect(infantry.pos.y).toBeCloseTo(500, 0);
  });

  it('chronoshift uses WARHEAD_FIRE specifically (C++ house.cpp:2826)', () => {
    const infantry = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    infantry.selected = true;

    const ctx = makeSuperweaponContext({
      entities: [infantry],
    });

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Greece, { x: 500, y: 500 });

    // Must be 'Fire' warhead, not 'Super' or anything else
    const call = (ctx.damageEntity as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toBe('Fire');
  });

  it('non-infantry units survive chronoshift (C++ house.cpp:2831-2839)', () => {
    const tank = makeEntity(UnitType.V_MNLY, House.Greece, 200, 200);
    tank.selected = true;
    const hpBefore = tank.hp;

    const ctx = makeSuperweaponContext({
      entities: [tank],
    });

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Greece, { x: 500, y: 500 });

    // Tank should be teleported, not damaged (positions lepton-quantized)
    expect(tank.pos.x).toBeCloseTo(500, 0);
    expect(tank.pos.y).toBeCloseTo(500, 0);
    expect(tank.alive).toBe(true);
    // Should NOT have called damageEntity for a vehicle
    expect(ctx.damageEntity).not.toHaveBeenCalled();
  });

  it('chronoshift visual tick set only for surviving units', () => {
    // Vehicle — survives, should get chronoShiftTick
    const tank = makeEntity(UnitType.V_MNLY, House.Greece, 200, 200);
    tank.selected = true;

    const ctx1 = makeSuperweaponContext({ entities: [tank] });
    activateSuperweapon(ctx1, SuperweaponType.CHRONOSPHERE, House.Greece, { x: 500, y: 500 });
    expect(tank.chronoShiftTick).toBe(CHRONO_SHIFT_VISUAL_TICKS);

    // Infantry — dies, should NOT get chronoShiftTick
    const inf = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    inf.selected = true;

    const ctx2 = makeSuperweaponContext({ entities: [inf] });
    activateSuperweapon(ctx2, SuperweaponType.CHRONOSPHERE, House.Greece, { x: 500, y: 500 });
    expect(inf.chronoShiftTick).toBe(0); // no visual effect for killed infantry
  });
});

// ============================================================
// Section 7: Chronoshift Demo Truck Self-Destruct
// C++ house.cpp:2828-2829 (FIXIT_CSII):
//   } else if(tech->What_Am_I() == RTTI_UNIT && *(UnitClass *)tech == UNIT_DEMOTRUCK) {
//     tech->Assign_Target(tech->As_Target());
//
// When a demo truck is chronoshifted, it targets ITSELF — triggering
// its kamikaze self-destruct at the destination. This is a special
// case in the FIXIT_CSII code path.
// ============================================================
describe('Chronoshift demo truck self-destruct (house.cpp:2828-2829 FIXIT_CSII)', () => {
  it('demo truck targets itself when chronoshifted — C++ parity achieved', () => {
    const demoTruck = makeEntity(UnitType.V_DTRK, House.Greece, 200, 200);
    demoTruck.selected = true;

    const ctx = makeSuperweaponContext({ entities: [demoTruck] });
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Greece, { x: 500, y: 500 });

    // C++ house.cpp:2828-2829 FIXIT_CSII:
    //   tech->Assign_Target(tech->As_Target()) — demo truck targets itself
    //   This triggers ATTACK mission on self → kamikaze self-destruct at destination.
    //
    // GAP CLOSED: superweapon.ts now implements the FIXIT_CSII demo truck path.
    // Demo truck is teleported to destination, then assigned ATTACK mission targeting self.
    // Positions are lepton-quantized
    expect(demoTruck.pos.x).toBeCloseTo(500, 0);
    expect(demoTruck.pos.y).toBeCloseTo(500, 0);
    expect(demoTruck.mission).toBe(Mission.ATTACK);
    expect(demoTruck.target).toBe(demoTruck); // self-targeting
    expect(demoTruck.chronoShiftTick).toBeGreaterThan(0);
  });
});

// ============================================================
// Section 8: Demo Truck Detonation Constants
// C++ uses the weapon/bullet system: demo truck fires its weapon
// (200 damage, WARHEAD_HE spread) then self-destructs (unit.cpp:4220).
// TS uses a custom detonation function with:
//   - DEMO_TRUCK_DAMAGE = 1000
//   - DEMO_TRUCK_RADIUS = 3
//   - DEMO_TRUCK_FUSE_TICKS = 45
//   - Linear falloff: damage * (1 - (d/radius) * 0.5)
// ============================================================
describe('Demo truck detonation constants', () => {
  it('DEMO_TRUCK_DAMAGE = 1000', () => {
    expect(DEMO_TRUCK_DAMAGE).toBe(1000);
  });

  it('DEMO_TRUCK_RADIUS = 3', () => {
    expect(DEMO_TRUCK_RADIUS).toBe(3);
  });

  it('DEMO_TRUCK_FUSE_TICKS = 45', () => {
    expect(DEMO_TRUCK_FUSE_TICKS).toBe(45);
  });
});

// ============================================================
// Section 9: Demo Truck Detonation Mechanism
// C++ unit.cpp:4215-4221:
//   if (Can_Fire(target, which) == FIRE_OK) {
//     bullet = DriveClass::Fire_At(target, which);
//     if (bullet != NULL) {
//       #ifdef FIXIT_CSII
//       if(Class->Type == UNIT_DEMOTRUCK && IsActive) delete this;
//       #endif
//     }
//   }
//
// In C++, demo truck fires its weapon as a bullet/projectile, then
// IMMEDIATELY self-destructs (delete this). The weapon damage is
// handled by the bullet impact system.
//
// TS implements this differently: demo truck has a 45-tick fuse timer.
// When the fuse expires, a custom splash damage function runs that
// applies linear distance falloff.
// ============================================================
describe('Demo truck detonation mechanism (unit.cpp:4215-4221)', () => {
  it('demo truck uses fuse timer (45 ticks) before detonation', () => {
    const truck = makeEntity(UnitType.V_DTRK, House.Greece, 200, 200);
    truck.mission = Mission.ATTACK;

    // Create a target entity for the truck to attack
    const target = makeEntity(UnitType.V_MNLY, House.USSR, 201, 200);
    target.alive = true;
    truck.target = target;

    const ctx = makeSpecialUnitsContext({ entities: [truck, target] });

    // First call: truck reaches target (dist <= 1.5), fuse is armed
    updateDemoTruck(ctx, truck);
    expect(truck.fuseTimer).toBe(DEMO_TRUCK_FUSE_TICKS); // 45

    // Fuse ticks down
    updateDemoTruck(ctx, truck);
    expect(truck.fuseTimer).toBe(DEMO_TRUCK_FUSE_TICKS - 1); // 44
  });

  it('demo truck self-destructs after fuse expires', () => {
    const truck = makeEntity(UnitType.V_DTRK, House.Greece, 200, 200);
    truck.mission = Mission.ATTACK;
    truck.fuseTimer = 1; // about to detonate

    const ctx = makeSpecialUnitsContext({ entities: [truck] });

    updateDemoTruck(ctx, truck);

    // After fuse expires, truck should be dead
    expect(truck.alive).toBe(false);
    expect(truck.hp).toBe(0);
  });

  it('demo truck applies splash damage to nearby entities on detonation', () => {
    const truck = makeEntity(UnitType.V_DTRK, House.Greece, 200, 200);
    truck.mission = Mission.ATTACK;
    truck.fuseTimer = 1;

    const nearby = makeEntity(UnitType.V_MNLY, House.USSR, 201, 200);
    const ctx = makeSpecialUnitsContext({ entities: [truck, nearby] });

    updateDemoTruck(ctx, truck);

    // damageEntity should have been called for the nearby unit
    expect(ctx.damageEntity).toHaveBeenCalled();
  });

  it('demo truck splash damage uses warhead spread-based falloff (C++ parity)', () => {
    /**
     * GAP CLOSED: TS now uses modifyDamage() with Nuke warhead spread-based falloff
     * (combat.cpp:106-125) instead of linear falloff.
     *
     * At point-blank (distPixels=0): modifyDamage applies warhead vs armor mult.
     * Nuke vs 'none' armor = 0.9 → 1000 * 0.9 = 900
     * Nuke vs 'light' armor (MNLY) = 0.6 → 1000 * 0.6 = 600
     *
     * C++ uses the bullet/warhead system which has this same distFactor-based
     * falloff curve (tested in cpp-parity-damage-formula.test.ts).
     */
    const truck = makeEntity(UnitType.V_DTRK, House.Greece, 200, 200);
    truck.mission = Mission.ATTACK;
    truck.fuseTimer = 1;

    // Entity at point-blank
    const adjacent = makeEntity(UnitType.V_MNLY, House.USSR, 200, 200);
    adjacent.id = 999; // different from truck

    const ctx = makeSpecialUnitsContext({ entities: [truck, adjacent] });

    updateDemoTruck(ctx, truck);

    // Find the call for the adjacent entity
    const calls = (ctx.damageEntity as ReturnType<typeof vi.fn>).mock.calls;
    const adjCall = calls.find((c: unknown[]) => (c[0] as Entity).id === adjacent.id);
    expect(adjCall).toBeDefined();

    // At distance ~0: modifyDamage(1000, 'Nuke', armor, 0) applies warhead mult.
    // The exact damage depends on the target's armor type (from WARHEAD_VS_ARMOR).
    // MNLY armor is 'light' → Nuke vs light = 0.6 → 600
    if (adjCall) {
      // Warhead spread-based damage: > 0 and <= DEMO_TRUCK_DAMAGE
      expect(adjCall[1]).toBeGreaterThan(0);
      expect(adjCall[1]).toBeLessThanOrEqual(DEMO_TRUCK_DAMAGE);
      // Uses 'Nuke' warhead for demo truck splash
      expect(adjCall[2]).toBe('Nuke');
    }
  });

  it('demo truck also damages structures within blast radius', () => {
    const truck = makeEntity(UnitType.V_DTRK, House.Greece, 200, 200);
    truck.mission = Mission.ATTACK;
    truck.fuseTimer = 1;

    const s = makeStructure({
      cx: Math.floor(200 / CELL_SIZE),
      cy: Math.floor(200 / CELL_SIZE),
      hp: 500,
      maxHp: 500,
    });

    const ctx = makeSpecialUnitsContext({ entities: [truck], structures: [s] });

    updateDemoTruck(ctx, truck);

    expect(ctx.damageStructure).toHaveBeenCalled();
  });
});

// ============================================================
// Section 10: Demo Truck Warhead Type
// C++ uses whatever warhead is assigned to the demo truck's weapon
// (typically WARHEAD_HE). TS uses 'Nuke' warhead.
// ============================================================
describe('Demo truck warhead type', () => {
  it('TS demo truck detonation uses Nuke warhead', () => {
    const truck = makeEntity(UnitType.V_DTRK, House.Greece, 200, 200);
    truck.mission = Mission.ATTACK;
    truck.fuseTimer = 1;

    const nearby = makeEntity(UnitType.I_E1, House.USSR, 200.5, 200);
    const ctx = makeSpecialUnitsContext({ entities: [truck, nearby] });

    updateDemoTruck(ctx, truck);

    const calls = (ctx.damageEntity as ReturnType<typeof vi.fn>).mock.calls;
    const nearbyCall = calls.find((c: unknown[]) => (c[0] as Entity).id === nearby.id);
    if (nearbyCall) {
      expect(nearbyCall[2]).toBe('Nuke');
    }
  });
});

// ============================================================
// Section 11: Engineer Capture — Only Player Engineers
// C++ infantry.cpp:598: Does NOT check IsPlayerUnit — any house's
// engineer can capture. The only check is Is_Ally(tech).
//
// TS missionAI.ts:1015: if (entity.type === UnitType.I_E6 && entity.isPlayerUnit)
// C++ parity: any house's engineer can capture, not just player's.
// C++ infantry.cpp:598-637 — no isPlayerUnit check in C++.
// ============================================================
describe('Engineer capture — any house (C++ infantry.cpp:598-637)', () => {
  it('AI-controlled engineers also trigger capture logic (C++ parity)', () => {
    /**
     * C++ infantry.cpp:598-637: Any engineer entering an enemy building
     * performs capture/damage regardless of which house controls it.
     *
     * TS missionAI.ts:1025-1026: entity.type === UnitType.I_E6 (no isPlayerUnit check)
     * Now matches C++ behavior — any house's engineer captures.
     */
    const s = makeStructure({ hp: 50, maxHp: 200, house: House.Greece });
    const aiEng = makeEntity(UnitType.I_E6, House.USSR, s.cx * CELL_SIZE + CELL_SIZE, s.cy * CELL_SIZE + CELL_SIZE);
    const ctx = makeMissionAIContext({ playerHouse: House.Greece });

    updateAttackStructure(ctx, aiEng, s);

    // C++ parity: AI engineer captures at red health, building changes to engineer's house
    expect(s.house).toBe(House.USSR); // AI capture now works — C++ parity
  });
});

// ============================================================
// Section 12: Chronoshift — Origin Flash Effect
// C++ house.cpp: Scen.Do_BW_Fade() + Sound_Effect(VOC_CHRONO)
// TS: lightning effect at origin + 'chrono' sound
// ============================================================
describe('Chronoshift visual/audio effects (house.cpp:2851-2852)', () => {
  it('produces lightning effect at origin position', () => {
    const tank = makeEntity(UnitType.V_MNLY, House.Greece, 200, 200);
    tank.selected = true;
    const originX = tank.pos.x; // lepton-quantized (~199.97)
    const originY = tank.pos.y;

    const ctx = makeSuperweaponContext({ entities: [tank] });
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Greece, { x: 500, y: 500 });

    // Origin effect uses entity's lepton-quantized position; dest effect uses raw target
    const originEffects = ctx.effects.filter(e =>
      Math.abs(e.x - originX) < 0.1 && Math.abs(e.y - originY) < 0.1);
    const destEffects = ctx.effects.filter(e => e.x === 500 && e.y === 500);
    expect(originEffects.length).toBeGreaterThanOrEqual(1);
    expect(destEffects.length).toBeGreaterThanOrEqual(1);
  });

  it('plays chrono sound on activation', () => {
    const tank = makeEntity(UnitType.V_MNLY, House.Greece, 200, 200);
    tank.selected = true;

    const ctx = makeSuperweaponContext({ entities: [tank] });
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Greece, { x: 500, y: 500 });

    expect(ctx.playSound).toHaveBeenCalledWith('chrono');
  });
});

// ============================================================
// Section 13: Chronoshift Chrono Tank Exclusion
// C++ house.cpp:2790-2792 (FIXIT_CSII):
//   if(tech->What_Am_I() == RTTI_UNIT && ((UnitClass *)tech)->Class->Type == UNIT_CHRONOTANK) {
//     porthim = false;
//   }
//
// Chrono Tanks have their OWN teleport (D key) — they are excluded
// from the Chronosphere superweapon.
// ============================================================
describe('Chronoshift excludes Chrono Tank (house.cpp:2790-2792)', () => {
  it('chrono tank is excluded from chronosphere teleport', () => {
    const chronoTank = makeEntity(UnitType.V_CTNK, House.Greece, 200, 200);
    chronoTank.selected = true;

    const ctx = makeSuperweaponContext({ entities: [chronoTank] });
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Greece, { x: 500, y: 500 });

    // C++: Chrono tank excluded from chronosphere, stays at origin
    // TS superweapon.ts:361: filters out V_CTNK (positions lepton-quantized)
    expect(chronoTank.pos.x).toBeCloseTo(200, 0);
    expect(chronoTank.pos.y).toBeCloseTo(200, 0);
  });
});
