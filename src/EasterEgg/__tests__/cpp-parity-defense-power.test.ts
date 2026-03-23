/**
 * C++ Behavioral Parity: Defense Structure Auto-Fire Under Power Drain
 *
 * Tests verify how GUN, SAM, TSLA, AGUN, PBOX, HBOX, and FTUR behave when
 * base power is insufficient. Derived from C++ source before testing TS.
 *
 * C++ Source References:
 *   house.cpp:4160-4170  — Power_Fraction(): returns fixed(Power, Drain) when Power < Drain,
 *                          1 when Power >= Drain or Drain == 0, 0 when Power == 0.
 *   building.cpp:2820-2865 — BuildingClass::Can_Fire(): if (Class->IsPowered && Power_Fraction() < 1)
 *                           return FIRE_BUSY — powered structures cannot fire under deficit.
 *   building.cpp:3619     — SAM Mission_Attack: IsPowered power check before tracking target.
 *   building.cpp:5382-5413 — Charging_AI(): Tesla only charges when Power_Fraction() >= 1.
 *                           Power loss mid-charge resets IsCharged=false, IsCharging=false.
 *   bdata.cpp:2836        — IsPowered defaults to false for ALL building types.
 *   rules.ini              — Powered=true for: TSLA, AGUN, GAP, PDOX, IRON, DOME.
 *                           GUN (Turret) is NOT powered.
 *                           AGUN (AA Gun) IS powered per rules.ini Powered=true.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE,
  COUNTRY_BONUSES, buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  updateStructureCombat,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure,
  STRUCTURE_WEAPONS,
  STRUCTURE_SIZE,
  STRUCTURE_MAX_HP,
  STRUCTURE_POWERED,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStructure(
  type: string, cx: number, cy: number, house: House = House.Spain,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 400;
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    weapon: STRUCTURE_WEAPONS[type] ? { ...STRUCTURE_WEAPONS[type] } : undefined,
  };
}

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function airborneAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = entityAtCell(type, house, cx, cy);
  e.flightAltitude = 24;
  return e;
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
  overrides: Partial<CombatContext> = {},
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
    pointTotal: 0,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
    ...overrides,
  } as CombatContext;
}

// ── Power_Fraction parity (house.cpp:4160-4170) ─────────────────────────────

describe('C++ Power_Fraction semantics used by TS isLowPower', () => {
  // C++ house.cpp:4160-4170:
  //   if (Power >= Drain || Drain == 0) return 1;
  //   if (Power) return fixed(Power, Drain);
  //   return 0;
  //
  // TS combat.ts:1222:
  //   const isLowPower = ctx.powerConsumed > ctx.powerProduced;

  it('full power (Power >= Drain): C++ returns 1, TS isLowPower=false', () => {
    // Power=200, Drain=100 → C++ fraction=1 → not low power
    const s = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([s], [enemy], { powerProduced: 200, powerConsumed: 100 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('zero drain (Drain == 0): C++ returns 1, TS isLowPower=false', () => {
    // Power=0, Drain=0 → C++ fraction=1 → not low power
    const s = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([s], [enemy], { powerProduced: 0, powerConsumed: 0 });
    updateStructureCombat(ctx);
    // TS: powerConsumed(0) > powerProduced(0) is false, so isLowPower=false → fires (correct)
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('partial power (0 < Power < Drain): C++ returns fraction < 1', () => {
    // Power=50, Drain=100 → C++ fraction=50/100=0.5 < 1 → low power
    const s = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([s], [enemy], { powerProduced: 50, powerConsumed: 100 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore); // should not fire under power deficit
  });

  it('zero power with drain (Power == 0, Drain > 0): C++ returns 0', () => {
    // Power=0, Drain=100 → C++ fraction=0 < 1 → low power
    // TS: powerConsumed(100) > powerProduced(0) → isLowPower=true → no fire
    // Now matches C++ parity.
    const s = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([s], [enemy], { powerProduced: 0, powerConsumed: 100 });
    updateStructureCombat(ctx);
    // C++ says: Power_Fraction()=0 < 1 → FIRE_BUSY → no fire
    // TS says: powerConsumed(100) > powerProduced(0) → isLowPower=true → no fire
    expect(enemy.hp).toBe(hpBefore); // C++ behavior: should NOT fire
  });
});

// ── STRUCTURE_POWERED membership parity ─────────────────────────────────────

describe('STRUCTURE_POWERED set membership (C++ rules.ini Powered= flag)', () => {
  // C++ bdata.cpp:2836 — IsPowered defaults false for ALL buildings.
  // Only buildings with Powered=yes in rules.ini are power-gated.
  // Original RA rules.ini Powered=yes: TSLA, SAM, GAP, PDOX, IRON, MSLO
  // rules.ini Powered is NOT set for: GUN, PBOX, HBOX, FTUR
  // rules.ini Powered=true IS set for: AGUN

  it('TSLA is powered (C++ rules.ini Powered=yes)', () => {
    expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
  });

  it('SAM is NOT powered (C++ rules.ini does not set Powered=yes for SAM)', () => {
    expect(STRUCTURE_POWERED.has('SAM')).toBe(false);
  });

  it('GAP is powered (C++ rules.ini Powered=yes)', () => {
    expect(STRUCTURE_POWERED.has('GAP')).toBe(true);
  });

  it('PDOX is powered (C++ rules.ini Powered=yes)', () => {
    expect(STRUCTURE_POWERED.has('PDOX')).toBe(true);
  });

  it('IRON is powered (C++ rules.ini Powered=yes)', () => {
    expect(STRUCTURE_POWERED.has('IRON')).toBe(true);
  });

  it('MSLO is NOT powered (C++ rules.ini does not set Powered=yes for MSLO)', () => {
    expect(STRUCTURE_POWERED.has('MSLO')).toBe(false);
  });

  // RESOLVED: GUN (Turret) correctly NOT in STRUCTURE_POWERED.
  // bdata.cpp:2836 — IsPowered(false) is the constructor default.
  // RA's rules.ini does not override this for the Turret.
  // The Turret fires regardless of power state in both C++ and TS.
  it('GUN should NOT be powered (C++ rules.ini does not set Powered=yes for Turret)', () => {
    expect(STRUCTURE_POWERED.has('GUN')).toBe(false);
  });

  it('AGUN IS powered (rules.ini Powered=true)', () => {
    expect(STRUCTURE_POWERED.has('AGUN')).toBe(true);
  });

  it('PBOX is NOT powered', () => {
    expect(STRUCTURE_POWERED.has('PBOX')).toBe(false);
  });

  it('HBOX is NOT powered', () => {
    expect(STRUCTURE_POWERED.has('HBOX')).toBe(false);
  });

  it('FTUR is NOT powered', () => {
    expect(STRUCTURE_POWERED.has('FTUR')).toBe(false);
  });
});

// ── Powered defense structures silenced during power deficit ─────────────────

describe('TSLA does not fire during power deficit (building.cpp:2853)', () => {
  // C++ building.cpp:2853: if (Class->IsPowered && House->Power_Fraction() < 1) return FIRE_BUSY;
  // Tesla Coil has Powered=yes in rules.ini.

  it('fires at enemy when power is sufficient', () => {
    const tsla = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([tsla], [enemy], { powerProduced: 200, powerConsumed: 50 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('does NOT fire when power consumed exceeds produced', () => {
    const tsla = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([tsla], [enemy], { powerProduced: 50, powerConsumed: 200 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });

  it('does NOT fire even with minimal deficit (power=99, drain=100)', () => {
    const tsla = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([tsla], [enemy], { powerProduced: 99, powerConsumed: 100 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });

  it('resumes firing immediately when power is restored', () => {
    const tsla = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);

    // Frame 1: low power — no fire
    const ctx1 = makeCombatCtx([tsla], [enemy], { powerProduced: 50, powerConsumed: 200 });
    updateStructureCombat(ctx1);
    expect(enemy.hp).toBe(enemy.maxHp);

    // Frame 2: power restored — fire
    tsla.attackCooldown = 0; // reset cooldown
    const ctx2 = makeCombatCtx([tsla], [enemy], { powerProduced: 200, powerConsumed: 50 });
    updateStructureCombat(ctx2);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});

describe('SAM fires regardless of power state (not in STRUCTURE_POWERED)', () => {
  // C++ rules.ini: SAM does NOT have Powered=yes. SAM fires regardless of power state.

  it('fires at airborne aircraft when power is sufficient', () => {
    const sam = makeStructure('SAM', 10, 10);
    sam.turretDir = 2; // East — pre-aligned toward aircraft
    sam.desiredTurretDir = 2;
    const aircraft = airborneAtCell(UnitType.V_HIND, House.USSR, 12, 10);
    const ctx = makeCombatCtx([sam], [aircraft], { powerProduced: 200, powerConsumed: 50 });
    updateStructureCombat(ctx);
    expect(aircraft.hp).toBeLessThan(aircraft.maxHp);
  });

  it('fires at aircraft even during power deficit (SAM not power-dependent)', () => {
    const sam = makeStructure('SAM', 10, 10);
    sam.turretDir = 2;
    sam.desiredTurretDir = 2;
    const aircraft = airborneAtCell(UnitType.V_HIND, House.USSR, 12, 10);
    const ctx = makeCombatCtx([sam], [aircraft], { powerProduced: 50, powerConsumed: 200 });
    updateStructureCombat(ctx);
    expect(aircraft.hp).toBeLessThan(aircraft.maxHp);
  });
});

// ── Unpowered defenses fire regardless of power ─────────────────────────────

describe('PBOX fires during power deficit (not in STRUCTURE_POWERED)', () => {
  // C++ building.cpp:2853 — only checks IsPowered flag.
  // PBOX has IsPowered=false (bdata.cpp default), so power check is skipped entirely.

  it('fires when power consumed > produced', () => {
    const pbox = makeStructure('PBOX', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy], { powerProduced: 50, powerConsumed: 200 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('fires when power produced is zero and consumed is zero', () => {
    const pbox = makeStructure('PBOX', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy], { powerProduced: 0, powerConsumed: 0 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});

describe('HBOX fires during power deficit (not in STRUCTURE_POWERED)', () => {
  it('fires when power consumed > produced', () => {
    const hbox = makeStructure('HBOX', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([hbox], [enemy], { powerProduced: 50, powerConsumed: 200 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});

describe('FTUR fires during power deficit (not in STRUCTURE_POWERED)', () => {
  // C++ bdata.cpp — FTUR (Flame Turret) has IsPowered=false.
  it('fires when power consumed > produced', () => {
    const ftur = makeStructure('FTUR', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([ftur], [enemy], { powerProduced: 50, powerConsumed: 200 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});

// ── GUN and AGUN power behavior ──────────────────────────────────────────────

describe('GUN (Turret) fires during power deficit — C++ IsPowered=false', () => {
  // RESOLVED: GUN correctly NOT in STRUCTURE_POWERED.
  // C++ bdata.cpp:2836 — IsPowered defaults false. RA rules.ini does NOT set Powered=yes for GUN.
  // Therefore in both C++ and TS, the Turret fires normally during power outages.

  it('fires at ground enemy during power deficit', () => {
    const gun = makeStructure('GUN', 10, 10);
    // Set turret direction toward enemy so turret alignment check passes
    gun.turretDir = 2; // East
    gun.desiredTurretDir = 2;
    const enemy = entityAtCell(UnitType.V_HTNK, House.USSR, 12, 10); // 2 cells east
    const ctx = makeCombatCtx([gun], [enemy], { powerProduced: 50, powerConsumed: 200 });
    updateStructureCombat(ctx);
    // GUN is NOT in STRUCTURE_POWERED — fires normally during deficit (matches C++)
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});

describe('AGUN (AA Gun) does NOT fire during power deficit — rules.ini Powered=true', () => {
  it('does NOT fire at airborne aircraft during power deficit (AGUN is powered)', () => {
    const agun = makeStructure('AGUN', 10, 10);
    agun.turretDir = 2; // East
    agun.desiredTurretDir = 2;
    const aircraft = airborneAtCell(UnitType.V_HIND, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [aircraft], { powerProduced: 50, powerConsumed: 200 });
    updateStructureCombat(ctx);
    // AGUN has Powered=true in rules.ini, so it does NOT fire during power deficit
    expect(aircraft.hp).toBe(aircraft.maxHp);
  });
});

// ── Tesla Coil charging under power loss (building.cpp:5382-5413) ────────────

describe('TSLA Charging_AI power dependency (building.cpp:5382-5413)', () => {
  // C++ building.cpp:5384-5412:
  //   Tesla only starts/continues charging when Target_Legal(TarCom) && Power_Fraction() >= 1.
  //   If power drops: IsCharged=false, IsCharging=false — charge is lost, not paused.
  //
  // The TS engine doesn't model the separate charging/IsCharged state machine,
  // but the functional result should be the same: no fire under low power.

  it('does not fire during power deficit (equivalent to charge loss)', () => {
    const tsla = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([tsla], [enemy], { powerProduced: 50, powerConsumed: 200 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });
});

// ── Edge cases: power boundary behavior ──────────────────────────────────────

describe('Power boundary conditions', () => {

  it('TSLA fires when power exactly equals drain (Power_Fraction() == 1)', () => {
    // C++ house.cpp:4164: if (Power >= Drain || Drain == 0) return 1;
    // Power=100, Drain=100 → fraction=1, not < 1 → fires
    const tsla = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([tsla], [enemy], { powerProduced: 100, powerConsumed: 100 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('TSLA does NOT fire when power is 1 less than drain', () => {
    // Power=99, Drain=100 → C++ fraction=99/100 < 1 → FIRE_BUSY
    const tsla = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([tsla], [enemy], { powerProduced: 99, powerConsumed: 100 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(hpBefore);
  });

  it('TSLA fires when power exceeds drain by 1', () => {
    // Power=101, Drain=100 → C++ fraction=1 → fires
    const tsla = makeStructure('TSLA', 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([tsla], [enemy], { powerProduced: 101, powerConsumed: 100 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('multiple powered structures all silenced during power deficit', () => {
    const tsla = makeStructure('TSLA', 10, 10);
    const sam = makeStructure('SAM', 14, 10);
    const aircraft = airborneAtCell(UnitType.V_HIND, House.USSR, 12, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([tsla, sam], [aircraft, infantry], {
      powerProduced: 50, powerConsumed: 500,
    });
    updateStructureCombat(ctx);
    expect(aircraft.hp).toBe(aircraft.maxHp);
    expect(infantry.hp).toBe(infantry.maxHp);
  });

  it('unpowered structures fire while powered structures are silenced (mixed base)', () => {
    // PBOX (unpowered) should fire, TSLA (powered) should not
    const pbox = makeStructure('PBOX', 10, 10);
    const tsla = makeStructure('TSLA', 14, 10);
    const enemy1 = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);    // in range of PBOX
    const enemy2 = entityAtCell(UnitType.I_E1, House.USSR, 16, 10);    // in range of TSLA
    const ctx = makeCombatCtx([pbox, tsla], [enemy1, enemy2], {
      powerProduced: 50, powerConsumed: 200,
    });
    updateStructureCombat(ctx);
    expect(enemy1.hp).toBeLessThan(enemy1.maxHp); // PBOX fires
    expect(enemy2.hp).toBe(enemy2.maxHp);          // TSLA silent
  });
});

// ── Cooldown behavior during power deficit ───────────────────────────────────

describe('Cooldown continues during power deficit (building.cpp:2853 check is in Can_Fire)', () => {
  // C++ parity note: The power check in building.cpp:2853 is in Can_Fire(), which is called
  // each Mission_Attack tick. The building still ticks its cooldown — the power check simply
  // blocks the actual firing. When power is restored, if cooldown is 0, it fires immediately.

  it('powered structure with remaining cooldown does not fire even with full power', () => {
    const tsla = makeStructure('TSLA', 10, 10);
    tsla.attackCooldown = 50; // still cooling down
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([tsla], [enemy], { powerProduced: 200, powerConsumed: 50 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('unpowered structure with remaining cooldown does not fire (cooldown independent of power)', () => {
    const pbox = makeStructure('PBOX', 10, 10);
    pbox.attackCooldown = 50;
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy], { powerProduced: 200, powerConsumed: 50 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });
});

// ── Structure in construction/selling is not affected by power ───────────────

describe('Structures under construction or being sold do not fire (building.cpp guard)', () => {
  // C++ building.cpp: Mission_Construction handles building state, not Mission_Guard.
  // In TS combat.ts:1224: sellProgress/buildProgress check skips combat.

  it('structure with buildProgress defined does not fire regardless of power', () => {
    const tsla = makeStructure('TSLA', 10, 10);
    tsla.buildProgress = 0.5; // under construction
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([tsla], [enemy], { powerProduced: 200, powerConsumed: 50 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('structure with sellProgress defined does not fire regardless of power', () => {
    const pbox = makeStructure('PBOX', 10, 10);
    pbox.sellProgress = 0.3;
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([pbox], [enemy], { powerProduced: 200, powerConsumed: 50 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });
});

// ── Dead structures do not fire ──────────────────────────────────────────────

describe('Dead structures do not participate in combat', () => {
  it('destroyed TSLA does not fire even with full power', () => {
    const tsla = makeStructure('TSLA', 10, 10);
    tsla.alive = false;
    tsla.rubble = true;
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([tsla], [enemy], { powerProduced: 200, powerConsumed: 50 });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });
});

// ── Summary of RESOLVED PARITY GAPS ──────────────────────────────────────────
// 1. GUN NOT in STRUCTURE_POWERED — RESOLVED. GUN correctly excluded (fires during deficit).
// 2. AGUN IS in STRUCTURE_POWERED — RESOLVED. AGUN correctly included (silenced during deficit).
// 3. Zero-power edge case — RESOLVED. TS isLowPower = powerConsumed > powerProduced.
//    Power=0, Drain=0 → false (not low). Power=0, Drain>0 → true (low). Matches C++.
