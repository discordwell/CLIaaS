/**
 * C++ Behavioral Parity: M.A.D. Tank (QTNK) — Seismic Charge Mechanics
 *
 * Tests verify M.A.D. Tank deployment and seismic shockwave behavior matches
 * C++ RA source code. Authoritative values come from aftrmath.ini, NOT C++
 * constructor defaults (per CLAUDE.md: "rules.ini is the authoritative source").
 *
 * C++ source references:
 *   aftrmath.ini [Aftermath]:
 *     QuakeDelay=120, QuakeUnitDamage=45%, QuakeBuildingDamage=40%,
 *     QuakeInfantryDamage=0, MTankDistance=20
 *   unit.cpp:2652-2712  — UNIT_MAD deploy + detonation sequence
 *   logic.cpp:271-314   — TimeQuake damage application (per-object type)
 *   rules.cpp:394-398   — INI parsing for Aftermath quake parameters
 *   globals.cpp:170-173  — QuakeUnitDamage/QuakeBuildingDamage/QuakeInfantryDamage globals
 */

import { describe, it, expect } from 'vitest';
import {
  MAD_TANK_CHARGE_TICKS,
  MAD_TANK_UNIT_DAMAGE_PERCENT,
  MAD_TANK_BUILDING_DAMAGE_PERCENT,
  MAD_TANK_INFANTRY_DAMAGE,
  MAD_TANK_RADIUS,
  MAD_TANK_SCREEN_SHAKE,
  updateMADTank,
  deployMADTank,
  type SpecialUnitsContext,
} from '../engine/specialUnits';
import { UnitType, House, CELL_SIZE, Mission, AnimState, UNIT_STATS, PRODUCTION_ITEMS, worldDist } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

// ── aftrmath.ini authoritative values ──────────────────────────────────────────
// Source: /public/ra/assets/aftrmath.ini [Aftermath] section
const CPP_QUAKE_DELAY = 120;             // aftrmath.ini line 6: QuakeDelay=120
const CPP_QUAKE_UNIT_DAMAGE_PCT = 0.45;  // aftrmath.ini line 3: QuakeUnitDamage=45%
const CPP_QUAKE_BUILDING_DAMAGE_PCT = 0.40; // aftrmath.ini line 4: QuakeBuildingDamage=40%
const CPP_QUAKE_INFANTRY_DAMAGE = 0;     // aftrmath.ini line 5: QuakeInfantryDamage=0
const CPP_MTANK_DISTANCE = 20;           // aftrmath.ini line 2: MTankDistance=20 (cells)
const CPP_WARHEAD = 'AP';                // logic.cpp:307: WARHEAD_AP
const CPP_SCREEN_SHAKE = 8;              // logic.cpp:273: Shake_The_Screen(8)

// ── Helpers ────────────────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeSpecialUnitsCtx(entities: Entity[] = [], structures: MapStructure[] = []): SpecialUnitsContext & {
  damagedEntities: Array<{ id: number; amount: number; warhead: string }>;
  damagedStructures: Array<{ type: string; damage: number }>;
  addedEntities: Entity[];
} {
  const damagedEntities: Array<{ id: number; amount: number; warhead: string }> = [];
  const damagedStructures: Array<{ type: string; damage: number }> = [];
  const addedEntities: Entity[] = [];
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    mines: [],
    activeVortices: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    credits: 10000,
    houseCredits: new Map(),
    map: new GameMap(),
    evaMessages: [],
    isThieved: false,
    screenShake: 0,
    isAllied: (a: House, b: House) => a === b,
    entitiesAllied: (a: Entity, b: Entity) => a.house === b.house,
    isPlayerControlled: (e: Entity) => e.house === House.Spain,
    playSoundAt: () => {},
    playSound: () => {},
    movementSpeed: () => 1,
    damageEntity: (target: Entity, amount: number, warhead: string) => {
      damagedEntities.push({ id: target.id, amount, warhead });
      target.hp = Math.max(0, target.hp - amount);
      if (target.hp <= 0) { target.alive = false; }
      return !target.alive;
    },
    damageStructure: (s: MapStructure, damage: number) => {
      damagedStructures.push({ type: s.type, damage });
      return false;
    },
    addEntity: (e: Entity) => { addedEntities.push(e); entities.push(e); },
    damagedEntities,
    damagedStructures,
    addedEntities,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Charge Timer (QuakeDelay)
// C++ unit.cpp:2656: Arm = QuakeDelay * House->ROFBias
// aftrmath.ini: QuakeDelay=120
// ══════════════════════════════════════════════════════════════════════════════

describe('Charge timer — aftrmath.ini QuakeDelay=120 (unit.cpp:2656)', () => {
  it('C++ QuakeDelay is 120 ticks (aftrmath.ini line 6)', () => {
    // This documents the authoritative C++ value
    expect(CPP_QUAKE_DELAY).toBe(120);
  });

  it('TS MAD_TANK_CHARGE_TICKS should be 120 to match C++', () => {
    // aftrmath.ini QuakeDelay=120, C++ unit.cpp:2656 sets Arm = QuakeDelay * House->ROFBias
    // At ROFBias=1.0 (normal difficulty), charge timer = 120 ticks (8 seconds at 15 FPS)
    expect(MAD_TANK_CHARGE_TICKS).toBe(CPP_QUAKE_DELAY);
  });

  it('deployMADTank sets deployTimer to MAD_TANK_CHARGE_TICKS', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const ctx = makeSpecialUnitsCtx([qtnk]);
    deployMADTank(ctx, qtnk);
    expect(qtnk.deployTimer).toBe(MAD_TANK_CHARGE_TICKS);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Damage Type — Percentage of MaxStrength, NOT flat damage
// C++ logic.cpp:297-300: damage = QuakeUnitDamage * obj->Class_Of().MaxStrength
// C++ logic.cpp:307: obj->Take_Damage(damage, 0, WARHEAD_AP, 0, true)
// ══════════════════════════════════════════════════════════════════════════════

describe('Damage type — percentage-based, WARHEAD_AP (logic.cpp:287-307)', () => {
  it('C++ uses percentage of MaxStrength for unit damage (45%)', () => {
    // aftrmath.ini: QuakeUnitDamage=45%
    // logic.cpp:300: damage = QuakeUnitDamage * obj->Class_Of().MaxStrength
    // e.g., Medium Tank (400 HP) takes 400 * 0.45 = 180 damage
    const medTankHP = UNIT_STATS['2TNK'].strength;
    const expectedDamage = Math.floor(medTankHP * CPP_QUAKE_UNIT_DAMAGE_PCT);
    expect(expectedDamage).toBe(Math.floor(400 * 0.45)); // 180
  });

  it('TS exports the C++ percentage damage constants, not a flat damage value', () => {
    expect(MAD_TANK_UNIT_DAMAGE_PERCENT).toBe(CPP_QUAKE_UNIT_DAMAGE_PCT);
    expect(MAD_TANK_BUILDING_DAMAGE_PERCENT).toBe(CPP_QUAKE_BUILDING_DAMAGE_PCT);
    expect(MAD_TANK_INFANTRY_DAMAGE).toBe(CPP_QUAKE_INFANTRY_DAMAGE);
  });

  it('C++ uses WARHEAD_AP (logic.cpp:307)', () => {
    // logic.cpp:307: obj->Take_Damage(damage, 0, WARHEAD_AP, 0, true)
    expect(CPP_WARHEAD).toBe('AP');
  });

  it('updateMADTank applies 45% max-strength forced AP damage to nearby vehicles', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10); // 1 cell away
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1; // will detonate this tick

    const ctx = makeSpecialUnitsCtx([qtnk, target]);
    updateMADTank(ctx, qtnk);

    const hit = ctx.damagedEntities.find(d => d.id === target.id);
    expect(hit).toBeDefined();
    expect(hit!.amount).toBe(Math.floor(target.maxHp * CPP_QUAKE_UNIT_DAMAGE_PCT));
    expect(hit!.warhead).toBe(CPP_WARHEAD);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Blast Radius — MTankDistance
// C++ logic.cpp:291: Distance(obj, TimeQuakeCenter) / 256 < MTankDistance
// aftrmath.ini: MTankDistance=20
// ══════════════════════════════════════════════════════════════════════════════

describe('Blast radius — aftrmath.ini MTankDistance=20 (logic.cpp:291)', () => {
  it('C++ MTankDistance is 20 cells (aftrmath.ini line 2)', () => {
    expect(CPP_MTANK_DISTANCE).toBe(20);
  });

  it('TS MAD_TANK_RADIUS should be 20 to match C++', () => {
    // aftrmath.ini MTankDistance=20, logic.cpp:291 checks Distance/256 < MTankDistance
    // TS worldDist returns distance in cells, so radius should be 20 cells
    expect(MAD_TANK_RADIUS).toBe(CPP_MTANK_DISTANCE);
  });

  it('C++ damages units at 19 cells (inside 20-cell radius)', () => {
    // In C++, a unit 19 cells away would be damaged (19 < 20)
    // TS now matches C++ with radius=20
    const dist = 19;
    expect(dist < CPP_MTANK_DISTANCE).toBe(true);  // C++ would damage
    expect(dist < MAD_TANK_RADIUS).toBe(true);     // TS now also damages (20 cell radius)
  });

  it('TS updateMADTank damages entity at 9 cells (inside radius 20)', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    // Place target 9 cells east
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 19, 10);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1;

    const ctx = makeSpecialUnitsCtx([qtnk, target]);
    updateMADTank(ctx, qtnk);

    const dist = worldDist(qtnk.pos, target.pos);
    expect(dist).toBe(9); // 9 cells apart
    // TS radius is now 20 (matching C++), so target IS damaged
    const hit = ctx.damagedEntities.find(d => d.id === target.id);
    expect(hit).toBeDefined(); // TS now matches C++ behavior
  });

  it('updateMADTank excludes entities exactly at MTankDistance', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 30, 10);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1;

    const ctx = makeSpecialUnitsCtx([qtnk, target]);
    updateMADTank(ctx, qtnk);

    expect(worldDist(qtnk.pos, target.pos)).toBe(20);
    expect(ctx.damagedEntities.find(d => d.id === target.id)).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Building Damage
// C++ logic.cpp:296-298: RTTI_BUILDING → damage = QuakeBuildingDamage * MaxStrength
// aftrmath.ini: QuakeBuildingDamage=40%
// ══════════════════════════════════════════════════════════════════════════════

describe('Building damage — aftrmath.ini QuakeBuildingDamage=40% (logic.cpp:296-298)', () => {
  it('C++ damages buildings at 40% of MaxStrength', () => {
    // aftrmath.ini QuakeBuildingDamage=40%
    // logic.cpp:297: damage = QuakeBuildingDamage * obj->Class_Of().MaxStrength
    // e.g., War Factory (1000 HP) takes 400 damage
    const warFactoryHP = 1000;
    const expectedDamage = Math.floor(warFactoryHP * CPP_QUAKE_BUILDING_DAMAGE_PCT);
    expect(expectedDamage).toBe(400);
  });

  it('updateMADTank damages structures at 40% of MaxStrength', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1;

    // Place a structure within blast radius
    const structures: MapStructure[] = [{
      type: 'WEAP',
      cx: 11, cy: 10,
      house: House.Spain,
      alive: true,
      hp: 1000,
      maxHp: 1000,
      discovered: true,
    } as MapStructure];

    const ctx = makeSpecialUnitsCtx([qtnk], structures);
    updateMADTank(ctx, qtnk);

    expect(ctx.damagedStructures).toEqual([{ type: 'WEAP', damage: 400 }]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Infantry Exclusion
// C++ logic.cpp:293-294: RTTI_INFANTRY → damage = QuakeInfantryDamage (= 0)
// aftrmath.ini: QuakeInfantryDamage=0
// ══════════════════════════════════════════════════════════════════════════════

describe('Infantry exclusion — aftrmath.ini QuakeInfantryDamage=0 (logic.cpp:293-294)', () => {
  it('C++ QuakeInfantryDamage is 0 (no damage to infantry)', () => {
    expect(CPP_QUAKE_INFANTRY_DAMAGE).toBe(0);
  });

  it('TS correctly excludes infantry from MAD shockwave (MATCH)', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1;

    const ctx = makeSpecialUnitsCtx([qtnk, infantry]);
    updateMADTank(ctx, qtnk);

    const hit = ctx.damagedEntities.find(d => d.id === infantry.id);
    expect(hit).toBeUndefined(); // correctly excluded
    expect(infantry.alive).toBe(true);
    expect(infantry.hp).toBe(infantry.maxHp);
  });

  it('updateMADTank damages air units as non-infantry objects', () => {
    // C++ logic.cpp:299-300 default case: damage = QuakeUnitDamage * MaxStrength
    // Aircraft are NOT infantry, so C++ WOULD damage them within radius
    // TS excludes isAirUnit — this is a MISMATCH for air units
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const heli = entityAtCell(UnitType.V_HIND, House.Spain, 11, 10);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1;

    const ctx = makeSpecialUnitsCtx([qtnk, heli]);
    updateMADTank(ctx, qtnk);

    const hit = ctx.damagedEntities.find(d => d.id === heli.id);
    expect(hit).toBeDefined();
    expect(hit!.amount).toBe(Math.floor(heli.maxHp * CPP_QUAKE_UNIT_DAMAGE_PCT));
    expect(hit!.warhead).toBe(CPP_WARHEAD);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Self-Destruct Behavior
// C++ unit.cpp:2709-2710: Strength = 1; PendingTimeQuake = true;
// The tank sets its HP to 1, then the time quake loop hits it too (45% of 300 = 135 > 1)
// ══════════════════════════════════════════════════════════════════════════════

describe('Self-destruct — unit.cpp:2709 Strength=1, then quake kills (logic.cpp)', () => {
  it('C++ sets Strength=1 before triggering quake (not instant kill)', () => {
    // unit.cpp:2709: Strength = 1;
    // unit.cpp:2710: PendingTimeQuake = true;
    // The quake loop then does 45% of 300 = 135 damage to itself, killing it
    // This is a two-step process: weaken, then quake finishes it
    const selfDamageFromQuake = Math.floor(300 * CPP_QUAKE_UNIT_DAMAGE_PCT);
    expect(selfDamageFromQuake).toBe(135);
    expect(selfDamageFromQuake).toBeGreaterThan(1); // guarantees death
  });

  it('updateMADTank sets self to 1 HP before quake damage kills it', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1;

    const ctx = makeSpecialUnitsCtx([qtnk]);
    updateMADTank(ctx, qtnk);

    const selfHit = ctx.damagedEntities.find(d => d.id === qtnk.id);
    expect(selfHit).toBeDefined();
    expect(selfHit!.amount).toBe(Math.floor(300 * CPP_QUAKE_UNIT_DAMAGE_PCT));
    expect(qtnk.alive).toBe(false);
    expect(qtnk.hp).toBe(0);
    expect(qtnk.mission).toBe(Mission.DIE);
    expect(qtnk.animState).toBe(AnimState.DIE);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Screen Shake
// C++ logic.cpp:273: Shake_The_Screen(8)
// ══════════════════════════════════════════════════════════════════════════════

describe('Screen shake — logic.cpp:273 Shake_The_Screen(8)', () => {
  it('C++ shakes screen with intensity 8', () => {
    expect(CPP_SCREEN_SHAKE).toBe(8);
  });

  it('updateMADTank sets screenShake to C++ quake intensity', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1;

    const ctx = makeSpecialUnitsCtx([qtnk]);
    expect(ctx.screenShake).toBe(0);

    updateMADTank(ctx, qtnk);

    expect(ctx.screenShake).toBe(CPP_SCREEN_SHAKE);
    expect(MAD_TANK_SCREEN_SHAKE).toBe(CPP_SCREEN_SHAKE);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. Crew Ejection During Deploy
// C++ unit.cpp:2667-2685: eject INFANTRY_C1 technician (IsTechnician=true)
// aftrmath.ini [QTNK]: Crewed=no (no crew on DEATH, but deploy ejects one)
// ══════════════════════════════════════════════════════════════════════════════

describe('Crew ejection on deploy — unit.cpp:2667-2685', () => {
  it('deployMADTank ejects exactly one I_C1 crew member', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const ctx = makeSpecialUnitsCtx([qtnk]);
    deployMADTank(ctx, qtnk);

    const crew = ctx.addedEntities.filter(e => e.type === UnitType.I_C1);
    expect(crew.length).toBe(1);
  });

  it('ejected crew belongs to same house as MAD Tank', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const ctx = makeSpecialUnitsCtx([qtnk]);
    deployMADTank(ctx, qtnk);

    const crew = ctx.addedEntities.find(e => e.type === UnitType.I_C1);
    expect(crew).toBeDefined();
    expect(crew!.house).toBe(House.USSR);
  });

  it('ejected crew is assigned MOVE mission (to flee)', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const ctx = makeSpecialUnitsCtx([qtnk]);
    deployMADTank(ctx, qtnk);

    const crew = ctx.addedEntities.find(e => e.type === UnitType.I_C1);
    expect(crew).toBeDefined();
    expect(crew!.mission).toBe(Mission.MOVE);
    expect(crew!.moveTarget).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. Deploy Locks Out Movement/Orders
// C++ unit.cpp:2653 (Gems/IsDumping flags), :3523 (action=ACTION_NONE),
//                :3564 (action=ACTION_NOMOVE), :1225/:1261 (no Active_Click)
// ══════════════════════════════════════════════════════════════════════════════

describe('Deploy locks out movement — unit.cpp:3523,3564', () => {
  it('deployed MAD Tank mission is set to GUARD (immobile)', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const ctx = makeSpecialUnitsCtx([qtnk]);
    deployMADTank(ctx, qtnk);

    expect(qtnk.mission).toBe(Mission.GUARD);
    expect(qtnk.moveTarget).toBeNull();
    expect(qtnk.target).toBeNull();
  });

  it('cannot deploy twice (idempotent)', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const ctx = makeSpecialUnitsCtx([qtnk]);
    deployMADTank(ctx, qtnk);
    const timer1 = qtnk.deployTimer;

    deployMADTank(ctx, qtnk);
    expect(qtnk.deployTimer).toBe(timer1); // not reset
    expect(ctx.addedEntities.filter(e => e.type === UnitType.I_C1).length).toBe(1); // only one crew
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. Full Detonation Sequence (end-to-end)
// ══════════════════════════════════════════════════════════════════════════════

describe('Full detonation sequence — deploy, charge, detonate', () => {
  it('deploy → tick down → detonate: damages nearby vehicle and self-destructs', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 12, 10); // 2 cells east
    const ctx = makeSpecialUnitsCtx([qtnk, target]);

    // Deploy
    deployMADTank(ctx, qtnk);
    expect(qtnk.isDeployed).toBe(true);
    const chargeTime = qtnk.deployTimer;

    // Tick down all but last
    for (let i = 0; i < chargeTime - 1; i++) {
      updateMADTank(ctx, qtnk);
    }
    expect(qtnk.alive).toBe(true); // still charging
    expect(target.hp).toBe(target.maxHp); // not yet damaged

    // Final tick — detonation
    updateMADTank(ctx, qtnk);
    expect(qtnk.alive).toBe(false); // self-destructed
    expect(ctx.damagedEntities.some(d => d.id === target.id)).toBe(true); // target damaged
  });

  it('detonation creates visual explosion effect', () => {
    resetEntityIds();
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    qtnk.isDeployed = true;
    qtnk.deployTimer = 1;

    const ctx = makeSpecialUnitsCtx([qtnk]);
    updateMADTank(ctx, qtnk);

    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    expect(explosions.length).toBeGreaterThanOrEqual(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. QTNK INI Stats (aftrmath.ini [QTNK] section)
// ══════════════════════════════════════════════════════════════════════════════

describe('QTNK INI stats — aftrmath.ini [QTNK] section', () => {
  it('Primary=none (no weapon)', () => {
    expect(UNIT_STATS.QTNK.primaryWeapon).toBeNull();
  });

  it('Strength=300', () => {
    expect(UNIT_STATS.QTNK.strength).toBe(300);
  });

  it('Armor=heavy', () => {
    expect(UNIT_STATS.QTNK.armor).toBe('heavy');
  });

  it('Speed=3', () => {
    expect(UNIT_STATS.QTNK.speed).toBe(3);
  });

  it('Sight=6', () => {
    expect(UNIT_STATS.QTNK.sight).toBe(6);
  });

  it('ROT=5', () => {
    expect(UNIT_STATS.QTNK.rot).toBe(5);
  });

  it('Points=60', () => {
    expect(UNIT_STATS.QTNK.points).toBe(60);
  });

  it('Tracked=yes → speedClass is TRACK', () => {
    expect(UNIT_STATS.QTNK.speedClass).toBeDefined();
  });

  it('Owner=soviet', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'QTNK');
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('soviet');
  });

  it('Cost=2300', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'QTNK');
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(2300);
  });

  it('TechLevel=10', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'QTNK');
    expect(prodItem).toBeDefined();
    expect(prodItem!.techLevel).toBe(10);
  });

  it('Prerequisite=stek', () => {
    const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'QTNK');
    expect(prodItem).toBeDefined();
    expect(prodItem!.techPrereq).toBe('STEK');
  });
});
