/**
 * C++ Behavioral Parity: AGUN — AA Gun
 *
 * Tests verify AA Gun defense behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * AGUN key stats (rules.ini / building.cpp):
 *   HP 400, Size 1x2, Cost 600, Allied faction
 *   Weapon: ZSU-23 → projectile Ack → AA=true, AG=false (AIR-ONLY, like SAM)
 *   AP warhead, 25 damage, range 6, ROF 10 (rapid fire)
 *   NOT power-dependent: fires regardless of power state (C++ bdata.cpp:2836 IsPowered=false)
 *   CANNOT target ground units, infantry, or buildings — air targets only
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  updateStructureCombat,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, STRUCTURE_WEAPONS, STRUCTURE_POWERED,
  STRUCTURE_SIZE, STRUCTURE_MAX_HP,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeAGUN(cx: number, cy: number, house: House = House.Greece, hp?: number, facing: number = 2): MapStructure {
  const weapon = STRUCTURE_WEAPONS['AGUN'];
  const maxHp = hp ?? STRUCTURE_MAX_HP['AGUN'] ?? 400;
  return {
    type: 'AGUN', image: 'agun', house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    weapon,
    turretDir: facing,          // pre-aligned to target direction (default East)
    desiredTurretDir: facing,
    firingFlash: 0,
  };
}

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Place an airborne aircraft at the center of a cell */
function airborneAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  e.flightAltitude = Entity.FLIGHT_ALTITUDE; // make airborne
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
    isRevealedToHouse: () => true,
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
    ...overrides,
  } as CombatContext;
}

// ── Structure Stats (rules.ini parity) ──────────────────────────────────────

describe('AGUN structure stats (rules.ini)', () => {
  it('has HP 400', () => {
    expect(STRUCTURE_MAX_HP['AGUN']).toBe(400);
  });

  it('has size 1x2', () => {
    expect(STRUCTURE_SIZE['AGUN']).toEqual([1, 2]);
  });

  it('IS in STRUCTURE_POWERED set (rules.ini Powered=true)', () => {
    expect(STRUCTURE_POWERED.has('AGUN')).toBe(true);
  });
});

// ── Weapon Stats (rules.ini parity) ─────────────────────────────────────────

describe('AGUN weapon stats (rules.ini)', () => {
  const weapon = STRUCTURE_WEAPONS['AGUN'];

  it('has weapon entry in STRUCTURE_WEAPONS', () => {
    expect(weapon).toBeDefined();
  });

  it('uses AP warhead', () => {
    expect(weapon.warhead).toBe('AP');
  });

  it('deals 25 base damage per shot', () => {
    expect(weapon.damage).toBe(25);
  });

  it('has range 6 cells', () => {
    expect(weapon.range).toBe(6);
  });

  it('has ROF 10 (rapid fire — fastest structure weapon)', () => {
    expect(weapon.rof).toBe(10);
  });

  it('is anti-air (isAntiAir=true)', () => {
    expect(weapon.isAntiAir).toBe(true);
  });

  it('ROF 10 is the fastest of all structure weapons', () => {
    for (const [type, w] of Object.entries(STRUCTURE_WEAPONS)) {
      expect(w.rof, `${type} ROF ${w.rof} should be >= AGUN ROF 10`).toBeGreaterThanOrEqual(weapon.rof);
    }
  });
});

// ── Anti-Air Targeting (building.cpp) ───────────────────────────────────────

describe('AGUN anti-air targeting (building.cpp)', () => {
  it('CAN target airborne aircraft', () => {
    const agun = makeAGUN(10, 10);
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    const hpBefore = heli.hp;
    updateStructureCombat(ctx);
    expect(heli.hp).toBeLessThan(hpBefore);
  });

  it('CAN target airborne fixed-wing aircraft', () => {
    const agun = makeAGUN(10, 10);
    const mig = airborneAtCell(UnitType.V_MIG, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [mig]);
    const hpBefore = mig.hp;
    updateStructureCombat(ctx);
    expect(mig.hp).toBeLessThan(hpBefore);
  });

  it('prefers airborne aircraft over ground targets when both in range', () => {
    const agun = makeAGUN(10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 13, 10);
    const ctx = makeCombatCtx([agun], [tank, heli]);
    updateStructureCombat(ctx);
    // AA override: AGUN should prefer the airborne helicopter
    expect(heli.hp).toBeLessThan(heli.maxHp);
  });

  it('CANNOT target ground units (air-only per ZSU-23 → Ack → AG=false)', () => {
    const agun = makeAGUN(10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [tank]);
    updateStructureCombat(ctx);
    expect(tank.hp).toBe(tank.maxHp);
  });

  it('CANNOT target ground infantry (air-only per ZSU-23 → Ack → AG=false)', () => {
    const agun = makeAGUN(10, 10);
    const inf = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [inf]);
    updateStructureCombat(ctx);
    expect(inf.hp).toBe(inf.maxHp);
  });
});

// ── Range Enforcement ───────────────────────────────────────────────────────

describe('AGUN range enforcement (range=6 cells)', () => {
  it('fires at airborne aircraft within range 6', () => {
    const agun = makeAGUN(10, 10);
    // Place airborne heli at ~5 cells away
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 15, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBeLessThan(heli.maxHp);
  });

  it('does NOT fire at airborne aircraft beyond range 6', () => {
    const agun = makeAGUN(10, 10);
    // Place airborne heli at ~7 cells away — beyond range 6
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 17, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });

  it('does NOT fire at airborne aircraft beyond range 6', () => {
    const agun = makeAGUN(10, 10);
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 17, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });
});

// ── Power Dependence (rules.ini Powered=true) ───────────────────────────────
// AGUN IS power-dependent per rules.ini. It stops firing during power deficit.

describe('AGUN is powered — fires only with sufficient power (rules.ini Powered=true)', () => {
  it('fires at aircraft when power is sufficient (produced >= consumed)', () => {
    const agun = makeAGUN(10, 10);
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli], {
      powerProduced: 100,
      powerConsumed: 50,
    });
    updateStructureCombat(ctx);
    expect(heli.hp).toBeLessThan(heli.maxHp);
  });

  it('does NOT fire at aircraft during power deficit (AGUN is powered)', () => {
    const agun = makeAGUN(10, 10);
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli], {
      powerProduced: 50,
      powerConsumed: 100,
    });
    updateStructureCombat(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });

  it('does NOT fire AA during power deficit (AGUN is powered)', () => {
    const agun = makeAGUN(10, 10);
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli], {
      powerProduced: 50,
      powerConsumed: 100,
    });
    updateStructureCombat(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });

  it('fires at aircraft when powerProduced=powerConsumed=0 (no power grid)', () => {
    const agun = makeAGUN(10, 10);
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli], {
      powerProduced: 0,
      powerConsumed: 0,
    });
    updateStructureCombat(ctx);
    // When produced=consumed=0, isLowPower is false (0 > 0 is false), so AGUN fires
    expect(heli.hp).toBeLessThan(heli.maxHp);
  });
});

// ── Rapid Fire (ROF 10) ────────────────────────────────────────────────────

describe('AGUN rapid fire — ROF 10 (building.cpp)', () => {
  it('fires immediately when cooldown is 0', () => {
    const agun = makeAGUN(10, 10);
    agun.attackCooldown = 0;
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBeLessThan(heli.maxHp);
  });

  it('sets cooldown to ROF (10) after firing (unlimited ammo)', () => {
    const agun = makeAGUN(10, 10);
    agun.attackCooldown = 0;
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    expect(agun.attackCooldown).toBe(10);
  });

  it('does NOT fire while cooldown > 0', () => {
    const agun = makeAGUN(10, 10);
    agun.attackCooldown = 5;
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });

  it('decrements cooldown each tick', () => {
    const agun = makeAGUN(10, 10);
    agun.attackCooldown = 5;
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    expect(agun.attackCooldown).toBe(4);
  });

  it('fires more often than GUN (ROF 50) over same interval', () => {
    // AGUN ROF=10 vs GUN ROF=50 — AGUN fires 5x more often
    expect(STRUCTURE_WEAPONS['AGUN'].rof).toBeLessThan(STRUCTURE_WEAPONS['GUN'].rof);
    expect(STRUCTURE_WEAPONS['GUN'].rof / STRUCTURE_WEAPONS['AGUN'].rof).toBe(5);
  });
});

// ── Damage Output (AP warhead, 25 base damage) ─────────────────────────────

describe('AGUN damage output (AP warhead, 25 base) — air targets only', () => {
  it('deals damage using AP warhead vs airborne helicopter', () => {
    const agun = makeAGUN(10, 10);
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const hpBefore = heli.hp;
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    // AP warhead × 25 base damage applied to aircraft
    expect(heli.hp).toBeLessThan(hpBefore);
  });

  it('deals damage to airborne fixed-wing aircraft', () => {
    const agun = makeAGUN(10, 10);
    const mig = airborneAtCell(UnitType.V_MIG, House.USSR, 12, 10);
    const hpBefore = mig.hp;
    const ctx = makeCombatCtx([agun], [mig]);
    updateStructureCombat(ctx);
    expect(mig.hp).toBeLessThan(hpBefore);
  });

  it('low per-shot damage (25) does not one-shot helicopter', () => {
    const agun = makeAGUN(10, 10);
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    expect(heli.alive).toBe(true);
  });

  it('cumulative rapid fire wears down aircraft over many ticks', () => {
    const agun = makeAGUN(10, 10);
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    // Simulate many ticks: fire, cooldown, fire, cooldown...
    for (let tick = 0; tick < 200; tick++) {
      ctx.tick = tick;
      updateStructureCombat(ctx);
    }
    // After 200 ticks with ROF 10: ~20 shots × 25 damage — should destroy helicopter
    expect(heli.alive).toBe(false);
  });
});

// ── Alliance Behavior ───────────────────────────────────────────────────────

describe('AGUN alliance behavior (building.cpp)', () => {
  it('does NOT fire at allied aircraft', () => {
    // AGUN owned by Greece (allied with Spain/player)
    const agun = makeAGUN(10, 10, House.Greece);
    const friendly = airborneAtCell(UnitType.V_HELI, House.Spain, 12, 10);
    const ctx = makeCombatCtx([agun], [friendly]);
    updateStructureCombat(ctx);
    expect(friendly.hp).toBe(friendly.maxHp);
  });

  it('does NOT fire at own-house aircraft', () => {
    const agun = makeAGUN(10, 10, House.Greece);
    const own = airborneAtCell(UnitType.V_HELI, House.Greece, 12, 10);
    const ctx = makeCombatCtx([agun], [own]);
    updateStructureCombat(ctx);
    expect(own.hp).toBe(own.maxHp);
  });

  it('fires at enemy-house aircraft', () => {
    const agun = makeAGUN(10, 10, House.Greece);
    const enemy = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});

// ── Dead / Inactive Guards ──────────────────────────────────────────────────

describe('AGUN does NOT fire when dead or selling', () => {
  it('does NOT fire when destroyed (alive=false)', () => {
    const agun = makeAGUN(10, 10);
    agun.alive = false;
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });

  it('does NOT fire when being sold (sellProgress defined)', () => {
    const agun = makeAGUN(10, 10);
    agun.sellProgress = 0.5;
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });
});

// ── Flak Visual Effect (C++ FLAK.SHP) ──────────────────────────────────────

describe('AGUN flak visual effect on air targets', () => {
  it('produces flak explosion sprite when hitting airborne aircraft', () => {
    const agun = makeAGUN(10, 10);
    const heli = airborneAtCell(UnitType.V_HELI, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    // Should have a 'flak' sprite explosion effect
    const flakEffects = ctx.effects.filter(
      e => e.type === 'explosion' && (e as any).sprite === 'flak'
    );
    expect(flakEffects.length).toBeGreaterThan(0);
  });

  it('produces no effects at all when only ground units present (air-only)', () => {
    const agun = makeAGUN(10, 10);
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 12, 10);
    const ctx = makeCombatCtx([agun], [tank]);
    updateStructureCombat(ctx);
    // AGUN is air-only — cannot target ground units, so no effects produced
    expect(ctx.effects.length).toBe(0);
    expect(tank.hp).toBe(tank.maxHp);
  });
});
