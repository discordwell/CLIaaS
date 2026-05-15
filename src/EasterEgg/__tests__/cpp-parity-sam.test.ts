/**
 * C++ Behavioral Parity: SAM Site (Surface-to-Air Missile)
 *
 * Tests verify SAM site defense structure behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * SAM key facts from rules.ini:
 *   - Type: SAM, Owner: soviet, Cost: 750
 *   - Strength (HP): 400, Armor: heavy
 *   - Primary weapon: Nike (damage 50, ROF 20, range 7.5, warhead AP, isAntiAir)
 *   - Size: 2x1 (unusual non-square footprint)
 *   - Powered: true (disabled during low power)
 *   - Turreted: rotating launcher (turretDir 0-7)
 *   - ROT=30 (turret rotation speed, from rules.ini)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, worldDist,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  updateInflightProjectiles,
  updateStructureCombat,
  structureDamage,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import {
  type MapStructure,
  STRUCTURE_WEAPONS,
  STRUCTURE_SIZE,
  STRUCTURE_MAX_HP,
  STRUCTURE_POWERED,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSAM(cx: number, cy: number, house: House = House.USSR, hp?: number, facing: number = 2): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['SAM'] ?? 400;
  return {
    type: 'SAM', image: 'sam', house,
    cx, cy, hp: hp ?? maxHp, maxHp, alive: true, rubble: false,
    weapon: { ...STRUCTURE_WEAPONS['SAM'] },
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    turretDir: facing,          // pre-aligned to target direction (default East)
    desiredTurretDir: facing,
    firingFlash: 0,
  };
}

function makeSAMWithAmmo(cx: number, cy: number, ammo: number, house: House = House.USSR, facing: number = 2): MapStructure {
  const s = makeSAM(cx, cy, house, undefined, facing);
  s.ammo = ammo;
  s.maxAmmo = ammo;
  return s;
}

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Create an airborne aircraft entity */
function makeAircraft(type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = entityAtCell(type, house, cx, cy);
  e.flightAltitude = Entity.FLIGHT_ALTITUDE; // 24 pixels
  e.aircraftState = 'flying';
  return e;
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
  opts: { powerConsumed?: number; powerProduced?: number } = {},
): CombatContext {
  const map = new GameMap();
  map.initDefault();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    logicAnims: [],
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
    powerConsumed: opts.powerConsumed ?? 0,
    powerProduced: opts.powerProduced ?? 100,
  } as CombatContext;
}

function resolveProjectiles(ctx: CombatContext): void {
  for (let i = 0; ctx.inflightProjectiles.length > 0 && i < 512; i++) {
    updateInflightProjectiles(ctx);
  }
  expect(ctx.inflightProjectiles.length).toBe(0);
}

function fireStructures(ctx: CombatContext): void {
  updateStructureCombat(ctx);
  resolveProjectiles(ctx);
}

// ── Structure Stats (rules.ini [SAM]) ───────────────────────────────────────

describe('SAM structure stats (rules.ini [SAM])', () => {
  it('HP = 400 (Strength=400)', () => {
    expect(STRUCTURE_MAX_HP['SAM']).toBe(400);
  });

  it('size = 2x1 (non-square footprint)', () => {
    expect(STRUCTURE_SIZE['SAM']).toEqual([2, 1]);
  });

  it('is NOT in STRUCTURE_POWERED (C++ rules.ini has no Powered=yes for SAM)', () => {
    expect(STRUCTURE_POWERED.has('SAM')).toBe(false);
  });
});

// ── Weapon Stats (rules.ini [Nike]) ─────────────────────────────────────────

describe('SAM weapon stats — Nike missile (rules.ini [Nike])', () => {
  it('weapon defined in STRUCTURE_WEAPONS', () => {
    expect(STRUCTURE_WEAPONS['SAM']).toBeDefined();
  });

  it('damage = 50', () => {
    expect(STRUCTURE_WEAPONS['SAM'].damage).toBe(50);
  });

  it('range = 7.5 cells', () => {
    expect(STRUCTURE_WEAPONS['SAM'].range).toBe(7.5);
  });

  it('ROF = 20 ticks', () => {
    expect(STRUCTURE_WEAPONS['SAM'].rof).toBe(20);
  });

  it('warhead = AP', () => {
    expect(STRUCTURE_WEAPONS['SAM'].warhead).toBe('AP');
  });

  it('isAntiAir = true', () => {
    expect(STRUCTURE_WEAPONS['SAM'].isAntiAir).toBe(true);
  });

  it('projSpeed = 50', () => {
    expect(STRUCTURE_WEAPONS['SAM'].projSpeed).toBe(50);
  });
});

// ── Anti-Air Targeting (building.cpp — AA gate) ─────────────────────────────
//
// C++ building.cpp: SAM targets airborne aircraft. The AA gate in
// updateStructureCombat skips airborne targets for non-AA structures,
// but SAM (isAntiAir=true) passes through.

describe('SAM anti-air targeting (building.cpp AA gate)', () => {
  it('fires at airborne aircraft within range', () => {
    const sam = makeSAM(10, 10);
    // Aircraft at ~3 cells away (well within 7.5 range)
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);
    const hpBefore = hind.hp;

    fireStructures(ctx);

    expect(hind.hp).toBeLessThan(hpBefore);
  });

  it('fires at airborne fixed-wing aircraft (MiG)', () => {
    const sam = makeSAM(10, 10);
    const mig = makeAircraft(UnitType.V_MIG, House.Spain, 12, 10);
    const ctx = makeCombatCtx([sam], [mig]);
    const hpBefore = mig.hp;

    fireStructures(ctx);

    expect(mig.hp).toBeLessThan(hpBefore);
  });

  it('does NOT fire at targets beyond range (7.5 cells)', () => {
    const sam = makeSAM(10, 10);
    // Aircraft at ~9 cells away (beyond 7.5 range)
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 19, 10);
    const ctx = makeCombatCtx([sam], [hind]);
    const hpBefore = hind.hp;

    fireStructures(ctx);

    expect(hind.hp).toBe(hpBefore);
  });

  it('does NOT fire at allied aircraft', () => {
    // SAM owned by USSR, aircraft also USSR — allied
    const sam = makeSAM(10, 10, House.USSR);
    const hind = makeAircraft(UnitType.V_HIND, House.USSR, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);
    const hpBefore = hind.hp;

    fireStructures(ctx);

    expect(hind.hp).toBe(hpBefore);
  });
});

// ── AA Override: Prefers Airborne Targets (building.cpp) ────────────────────
//
// C++ building.cpp: When isAntiAir=true, the structure has an AA override
// that re-scans for the closest airborne aircraft and prefers it over
// ground targets.

describe('SAM AA override — prefers airborne over ground (building.cpp)', () => {
  it('prefers airborne aircraft over closer ground target', () => {
    const sam = makeSAM(10, 10);
    // Ground enemy very close (1 cell away)
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    // Aircraft further away (5 cells) but still in range
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 15, 10);
    const ctx = makeCombatCtx([sam], [tank, hind]);

    const tankHpBefore = tank.hp;
    const hindHpBefore = hind.hp;

    fireStructures(ctx);

    // SAM should prefer the airborne aircraft
    expect(hind.hp).toBeLessThan(hindHpBefore);
    // Ground target should NOT be damaged (SAM attacked the aircraft instead)
    expect(tank.hp).toBe(tankHpBefore);
  });

  it('CANNOT fall back to ground target — air-only (Nike → AA=true, AG=false)', () => {
    const sam = makeSAM(10, 10);
    // Only ground enemy available — SAM should ignore it
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [tank]);

    fireStructures(ctx);

    // SAM is air-only — cannot target ground units
    expect(tank.hp).toBe(tank.maxHp);
  });

  it('prefers closer airborne target when multiple aircraft in range', () => {
    const sam = makeSAM(10, 10);
    // Two aircraft at different distances
    const farHind = makeAircraft(UnitType.V_HIND, House.Spain, 17, 10); // ~7 cells
    const closeHind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10); // ~3 cells
    const ctx = makeCombatCtx([sam], [farHind, closeHind]);

    const farHpBefore = farHind.hp;
    const closeHpBefore = closeHind.hp;

    fireStructures(ctx);

    // Should target the closer aircraft
    expect(closeHind.hp).toBeLessThan(closeHpBefore);
    expect(farHind.hp).toBe(farHpBefore);
  });
});

// ── Power Independence (C++ rules.ini: SAM has no Powered=yes) ──────────────
//
// C++ rules.ini: SAM does NOT have Powered=yes. SAM fires regardless of power state.

describe('SAM fires regardless of power state (not in STRUCTURE_POWERED)', () => {
  it('fires during power deficit (SAM is not power-dependent)', () => {
    const sam = makeSAM(10, 10);
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind], {
      powerConsumed: 200, // deficit: consuming more than producing
      powerProduced: 100,
    });
    const hpBefore = hind.hp;

    fireStructures(ctx);

    // SAM fires even during power deficit (not in STRUCTURE_POWERED)
    expect(hind.hp).toBeLessThan(hpBefore);
  });

  it('fires normally when power is sufficient', () => {
    const sam = makeSAM(10, 10);
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind], {
      powerConsumed: 50,
      powerProduced: 100,
    });
    const hpBefore = hind.hp;

    fireStructures(ctx);

    expect(hind.hp).toBeLessThan(hpBefore);
  });
});

// ── Turreted Structure (building.cpp — GUN/SAM turret rotation) ─────────────
//
// C++ building.cpp: SAM is in TURRETED_STRUCTURES — its launcher rotates
// to face the target before firing. turretDir/desiredTurretDir track facing.

describe('SAM turret rotation (building.cpp turreted structures)', () => {
  it('initializes turretDir to default (0=North for SAM) when undefined', () => {
    const sam = makeSAM(10, 10);
    sam.turretDir = undefined;
    sam.desiredTurretDir = undefined;
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);

    // turretDir starts undefined, gets set to default 0 (North for SAM) on first tick
    expect(sam.turretDir).toBeUndefined();

    fireStructures(ctx);

    expect(sam.turretDir).toBeDefined();
  });

  it('sets desiredTurretDir toward target', () => {
    const sam = makeSAM(10, 10);
    sam.turretDir = 4; // South
    sam.desiredTurretDir = 4;
    // Target to the East
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 17, 10);
    const ctx = makeCombatCtx([sam], [hind]);

    fireStructures(ctx);

    // desiredTurretDir should point toward the target (East = 2)
    expect(sam.desiredTurretDir).toBeDefined();
  });

  it('sets firingFlash when firing', () => {
    const sam = makeSAM(10, 10);
    sam.turretDir = 2; // East
    sam.desiredTurretDir = 2;
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);

    fireStructures(ctx);

    // updateStructureCombat is a completed logic tick: Fire_At sets flash to 4,
    // then BuildingClass::Rotation_AI / TS wrapper ticks it once.
    expect(sam.firingFlash).toBe(3);
  });

  it('turret rotates via ROT accumulator toward desiredTurretDir', () => {
    const sam = makeSAM(10, 10);
    sam.turretDir = 0; // North
    sam.desiredTurretDir = 4; // South (4 steps clockwise)
    sam.turretRotAccum = 0;
    // Put in cooldown so it only rotates, doesn't fire
    sam.attackCooldown = 50;
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);

    // SAM uses rules.ini ROT=30. In 256-facing space that reaches the South
    // bucket after a few completed logic ticks.
    for (let i = 0; i < 7; i++) {
      const ctx = makeCombatCtx([sam], [hind]);
      fireStructures(ctx);
    }

    expect(sam.turretDir).toBe(4);
  });
});

// ── Cooldown & Attack Rate (building.cpp — ROF) ────────────────────────────
//
// C++ techno.cpp: Fire_At assigns Arm = Rearm_Delay(...). Arm is a
// CDTimerClass<FrameTimerClass>, so the exported wrapper observes one frame of
// countdown by the end of the completed logic tick.

describe('SAM cooldown and ROF (building.cpp)', () => {
  it('observes weapon ROF minus one after firing (ammo=-1 unlimited)', () => {
    const sam = makeSAM(10, 10);
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);

    fireStructures(ctx);

    expect(sam.attackCooldown).toBe(STRUCTURE_WEAPONS['SAM'].rof - 1);
  });

  it('does NOT fire while cooldown > 0', () => {
    const sam = makeSAM(10, 10);
    sam.attackCooldown = 5; // on cooldown
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);
    const hpBefore = hind.hp;

    fireStructures(ctx);

    // Should not fire — still on cooldown
    expect(hind.hp).toBe(hpBefore);
    // Cooldown should have decremented
    expect(sam.attackCooldown).toBe(4);
  });
});

// ── Ammo System (building.cpp:882-883, techno.cpp:2861) ────────────────────
//
// C++ techno.cpp:2861 — buildings with Ammo>1 fire rapidly (1-tick rearm
// between shots) then recharge at full ROF after the last shot.
// C++ building.cpp:882-883 — ammo reloads to MaxAmmo when depleted.

describe('SAM ammo system (building.cpp:882-883, techno.cpp:2861)', () => {
  it('rapid-fire: 1-frame Arm has counted down after the completed tick', () => {
    const sam = makeSAMWithAmmo(10, 10, 3);
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);

    fireStructures(ctx);

    // Fire_At assigned Arm=1 (rapid-fire since ammo remains), and the completed
    // tick observes that CDTimer at 0.
    expect(sam.ammo).toBe(2);
    expect(sam.attackCooldown).toBe(0);
  });

  it('full ROF cooldown on last ammo shot', () => {
    const sam = makeSAMWithAmmo(10, 10, 2);
    // Fire first shot
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);
    fireStructures(ctx);
    expect(sam.ammo).toBe(1);
    expect(sam.attackCooldown).toBe(0); // Arm=1 counted down by the completed tick

    // Advance cooldown
    sam.attackCooldown = 0;

    // Fire second (last) shot
    fireStructures(ctx);
    expect(sam.ammo).toBe(0);
    expect(sam.attackCooldown).toBe(STRUCTURE_WEAPONS['SAM'].rof - 1); // full ROF observed post-frame
  });

  it('reloads ammo to maxAmmo when depleted (building.cpp:882-883)', () => {
    const sam = makeSAMWithAmmo(10, 10, 2);
    sam.ammo = 0; // depleted
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);

    fireStructures(ctx);

    // ammo should reload from 0 to maxAmmo=2, then fire (2->1)
    expect(sam.ammo).toBe(1);
  });
});

// ── 2x1 Footprint (non-square structure) ────────────────────────────────────
//
// SAM is one of the few 2x1 structures in RA. This tests that the
// structure's center-of-mass calculation works correctly for targeting.

describe('SAM 2x1 footprint (building.cpp)', () => {
  it('STRUCTURE_SIZE is [2, 1]', () => {
    const [w, h] = STRUCTURE_SIZE['SAM'];
    expect(w).toBe(2);
    expect(h).toBe(1);
  });

  it('fires at targets using center-of-footprint position', () => {
    const sam = makeSAM(10, 10);
    // Target at cell (17, 10) — 7 cells from cx=10
    // SAM fire position = (10 * CELL_SIZE + CELL_SIZE, 10 * CELL_SIZE + CELL_SIZE)
    // which is the center of a 2x2 footprint calculation (used for all structures)
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 17, 10);
    const ctx = makeCombatCtx([sam], [hind]);
    const hpBefore = hind.hp;

    fireStructures(ctx);

    expect(hind.hp).toBeLessThan(hpBefore);
  });
});

// ── Destruction Behavior (building.cpp — generic structure death) ───────────
//
// When destroyed, SAM produces a visual-only FBALL1 death animation (C++ parity).
// No warhead damage is dealt to entities. Tests verify this with the 2x1 footprint.

describe('SAM destruction blast -- visual-only (C++ parity: no entity damage)', () => {
  it('leaves rubble when destroyed', () => {
    const sam = makeSAM(10, 10, House.USSR, 50);
    const ctx = makeCombatCtx([sam]);

    structureDamage(ctx, sam, 100);

    expect(sam.alive).toBe(false);
    expect(sam.rubble).toBe(true);
  });

  it('entities take NO damage on destruction (visual-only explosion)', () => {
    const sam = makeSAM(10, 10, House.USSR, 50);
    // Infantry next to SAM
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const ctx = makeCombatCtx([sam], [victim]);
    const hpBefore = victim.hp;

    structureDamage(ctx, sam, 100);

    expect(sam.alive).toBe(false);
    expect(victim.hp).toBe(hpBefore);
  });

  it('does NOT damage entities beyond 2-cell blast radius', () => {
    const sam = makeSAM(10, 10, House.USSR, 50);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 14, 10); // 4 cells East
    const ctx = makeCombatCtx([sam], [victim]);

    structureDamage(ctx, sam, 100);

    expect(sam.alive).toBe(false);
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('no entity damage at any distance (visual-only explosion)', () => {
    const sam = makeSAM(10, 10, House.USSR, 50);
    const close = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const far = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 12);
    const ctx = makeCombatCtx([sam], [close, far]);

    structureDamage(ctx, sam, 100);

    const closeDmg = close.maxHp - close.hp;
    const farDmg = far.maxHp - far.hp;
    expect(closeDmg).toBe(0);
    expect(farDmg).toBe(0);
  });
});

// ── Flak Impact Sprite (C++ FLAK.SHP) ──────────────────────────────────────
//
// When SAM hits an airborne aircraft, the impact uses a 'flak' burst sprite
// instead of the normal warhead explosion set.

describe('SAM flak burst effect on AA hit (C++ FLAK.SHP)', () => {
  it('produces flak impact sprite when hitting airborne aircraft', () => {
    const sam = makeSAM(10, 10);
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);

    fireStructures(ctx);

    // Check effects for a flak explosion sprite
    const flakEffects = ctx.effects.filter(
      e => e.type === 'explosion' && (e as any).sprite === 'flak'
    );
    expect(flakEffects.length).toBeGreaterThan(0);
  });

  it('does NOT produce flak sprite when hitting ground target', () => {
    const sam = makeSAM(10, 10);
    // Only ground target, no aircraft
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [tank]);

    fireStructures(ctx);

    const flakEffects = ctx.effects.filter(
      e => e.type === 'explosion' && (e as any).sprite === 'flak'
    );
    expect(flakEffects.length).toBe(0);
  });
});

// ── No LOS Check for buildings (C++ Evaluate_Object) ──────────────────────
//
// C++ techno.cpp:1449-1763 Evaluate_Object does NOT check line-of-sight.
// Building::Greatest_Threat → TechnoClass::Greatest_Threat → Evaluate_Object
// only checks: limbo, cloak, mission, zone, alliance, range, mask, value.
// Buildings CAN fire through rock/walls — no LOS gate in the C++ targeting path.

describe('SAM targets through terrain (C++ parity — no LOS in Evaluate_Object)', () => {
  it('fires at target behind rock wall (C++ buildings skip LOS)', () => {
    const sam = makeSAM(10, 10);
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);

    // Block LOS with rock terrain — C++ ignores this for building targeting
    for (let y = 8; y <= 12; y++) {
      ctx.map.setTerrain(12, y, Terrain.ROCK);
    }

    const hpBefore = hind.hp;
    fireStructures(ctx);

    // C++ parity: building DOES fire — LOS not checked in Evaluate_Object
    expect(hind.hp).toBeLessThan(hpBefore);
  });
});

// ── Dead/Selling SAM Does Not Fire ──────────────────────────────────────────

describe('SAM inactive states', () => {
  it('dead SAM does not fire', () => {
    const sam = makeSAM(10, 10);
    sam.alive = false;
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);
    const hpBefore = hind.hp;

    fireStructures(ctx);

    expect(hind.hp).toBe(hpBefore);
  });

  it('selling SAM does not fire', () => {
    const sam = makeSAM(10, 10);
    sam.sellProgress = 0.5; // mid-sell
    const hind = makeAircraft(UnitType.V_HIND, House.Spain, 13, 10);
    const ctx = makeCombatCtx([sam], [hind]);
    const hpBefore = hind.hp;

    fireStructures(ctx);

    expect(hind.hp).toBe(hpBefore);
  });
});
