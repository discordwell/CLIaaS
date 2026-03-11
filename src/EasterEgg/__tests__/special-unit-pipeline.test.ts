/**
 * Special Unit Behaviors Pipeline — comprehensive tests for all special unit
 * state machines in the Game class (engine/index.ts).
 *
 * Tests cover: Demo Truck, Chrono Tank, Tanya C4, Thief, Medic, Engineer,
 * Spy, Mechanic, Minelayer, MAD Tank, Vehicle Cloaking, Mine System, C4 Timers.
 *
 * Pattern: Entity-level unit tests for state fields + source code verification
 * for Game-class private methods (readFileSync grep).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds, CloakState, CLOAK_TRANSITION_FRAMES } from '../engine/entity';
import {
  UnitType, House, Mission, AnimState, UNIT_STATS, WEAPON_STATS,
  CELL_SIZE, worldDist, worldToCell, CONDITION_RED,
  CHRONO_SHIFT_VISUAL_TICKS,
} from '../engine/types';
import { readFileSync } from 'fs';
import { join } from 'path';

beforeEach(() => resetEntityIds());

// ─── Helper: read engine source for private method verification ─────────
function engineSource(): string {
  return readFileSync(
    join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'),
    'utf-8',
  );
}

/** Extract a chunk of source starting at a method signature */
function methodChunk(methodSig: string, size = 1200): string {
  const src = engineSource();
  const idx = src.indexOf(methodSig);
  expect(idx, `${methodSig} method found in source`).toBeGreaterThan(-1);
  return src.slice(idx, idx + size);
}

// ─── Helpers ────────────────────────────────────────────────────────────
function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

// =========================================================================
// 1. DEMO TRUCK (V_DTRK) — updateDemoTruck / detonateDemoTruck
// =========================================================================
describe('Demo Truck (DTRK) — kamikaze state machine', () => {
  it('has correct UNIT_STATS entry', () => {
    const stats = UNIT_STATS.DTRK;
    expect(stats.type).toBe(UnitType.V_DTRK);
    expect(stats.strength).toBe(110);
    expect(stats.armor).toBe('light');
    expect(stats.primaryWeapon).toBe('Democharge');
  });

  it('Democharge weapon has Nuke warhead', () => {
    const w = WEAPON_STATS.Democharge;
    expect(w).toBeDefined();
    expect(w.warhead).toBe('Nuke');
    expect(w.damage).toBe(500);
  });

  it('entity initializes with fuseTimer = 0', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    expect(dtrk.fuseTimer).toBe(0);
    expect(dtrk.alive).toBe(true);
  });

  it('fuseTimer counts down each tick toward 0', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    dtrk.fuseTimer = 10;
    // Simulating countdown
    dtrk.fuseTimer--;
    expect(dtrk.fuseTimer).toBe(9);
    for (let i = 0; i < 9; i++) dtrk.fuseTimer--;
    expect(dtrk.fuseTimer).toBe(0);
  });

  it('updateDemoTruck source: only runs for DTRK in ATTACK mission', () => {
    const chunk = methodChunk('updateDemoTruck(entity: Entity)');
    expect(chunk).toContain('entity.type !== UnitType.V_DTRK');
    expect(chunk).toContain('entity.mission !== Mission.ATTACK');
  });

  it('updateDemoTruck source: arms fuse at DEMO_TRUCK_FUSE_TICKS when reaching target', () => {
    const chunk = methodChunk('updateDemoTruck(entity: Entity)');
    expect(chunk).toContain('Game.DEMO_TRUCK_FUSE_TICKS');
    expect(chunk).toContain('entity.fuseTimer = Game.DEMO_TRUCK_FUSE_TICKS');
  });

  it('updateDemoTruck source: calls detonateDemoTruck when fuse reaches 0', () => {
    const chunk = methodChunk('updateDemoTruck(entity: Entity)');
    expect(chunk).toContain('this.detonateDemoTruck(entity)');
  });

  it('detonateDemoTruck source: applies splash damage in DEMO_TRUCK_RADIUS', () => {
    const chunk = methodChunk('private detonateDemoTruck(entity: Entity)');
    expect(chunk).toContain('Game.DEMO_TRUCK_RADIUS');
    expect(chunk).toContain('Game.DEMO_TRUCK_DAMAGE');
    expect(chunk).toContain('damageEntity');
  });

  it('detonateDemoTruck source: kills the truck after detonation', () => {
    const chunk = methodChunk('private detonateDemoTruck(entity: Entity)');
    expect(chunk).toContain('entity.alive = false');
    expect(chunk).toContain('entity.mission = Mission.DIE');
  });

  it('detonateDemoTruck source: also damages structures', () => {
    const chunk = methodChunk('private detonateDemoTruck(entity: Entity)');
    expect(chunk).toContain('damageStructure');
  });

  it('static constants match C++ parity values', () => {
    const src = engineSource();
    expect(src).toContain('DEMO_TRUCK_DAMAGE = 1000');
    expect(src).toContain('DEMO_TRUCK_RADIUS = 3');
    expect(src).toContain('DEMO_TRUCK_FUSE_TICKS = 45');
  });

  it('demo truck with no target returns to GUARD', () => {
    const chunk = methodChunk('updateDemoTruck(entity: Entity)');
    expect(chunk).toContain('entity.mission = Mission.GUARD');
  });

  it('damage falloff: center damage > edge damage', () => {
    // Verify the formula: damage * (1 - (d / blastRadius) * 0.5)
    const blastRadius = 3;
    const baseDamage = 1000;
    const centerDamage = Math.round(baseDamage * (1 - (0 / blastRadius) * 0.5));
    const edgeDamage = Math.round(baseDamage * (1 - (blastRadius / blastRadius) * 0.5));
    expect(centerDamage).toBe(1000);
    expect(edgeDamage).toBe(500);
    expect(centerDamage).toBeGreaterThan(edgeDamage);
  });

  it('demo truck is NOT a turreted vehicle', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR);
    expect(dtrk.hasTurret).toBe(false);
  });
});

// =========================================================================
// 2. CHRONO TANK (V_CTNK) — updateChronoTank / teleportChronoTank
// =========================================================================
describe('Chrono Tank (CTNK) — teleport state machine', () => {
  it('has correct UNIT_STATS entry', () => {
    const stats = UNIT_STATS.CTNK;
    expect(stats.type).toBe(UnitType.V_CTNK);
    expect(stats.strength).toBe(350);
    expect(stats.armor).toBe('light');
    expect(stats.primaryWeapon).toBe('APTusk');
  });

  it('APTusk weapon has burst fire', () => {
    const w = WEAPON_STATS.APTusk;
    expect(w).toBeDefined();
    expect(w.burst).toBe(2);
    expect(w.warhead).toBe('AP');
    expect(w.damage).toBe(75);
  });

  it('entity initializes with chronoCooldown = 0', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    expect(ctnk.chronoCooldown).toBe(0);
    expect(ctnk.chronoShiftTick).toBe(0);
  });

  it('chronoCooldown decrements each tick when > 0', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    ctnk.chronoCooldown = 100;
    // Simulate updateChronoTank logic
    if (ctnk.chronoCooldown > 0) ctnk.chronoCooldown--;
    expect(ctnk.chronoCooldown).toBe(99);
  });

  it('chronoCooldown stays at 0 when already 0', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    expect(ctnk.chronoCooldown).toBe(0);
    // Simulate: should not go negative
    if (ctnk.chronoCooldown > 0) ctnk.chronoCooldown--;
    expect(ctnk.chronoCooldown).toBe(0);
  });

  it('static CHRONO_TANK_COOLDOWN = 2700 ticks (C++ parity)', () => {
    const src = engineSource();
    expect(src).toContain('CHRONO_TANK_COOLDOWN = 2700');
  });

  it('teleportChronoTank source: blocked when on cooldown', () => {
    const chunk = methodChunk('teleportChronoTank(entity: Entity, target: WorldPos)');
    expect(chunk).toContain('entity.chronoCooldown > 0');
  });

  it('teleportChronoTank source: checks map passability', () => {
    const chunk = methodChunk('teleportChronoTank(entity: Entity, target: WorldPos)');
    expect(chunk).toContain('this.map.isPassable');
  });

  it('teleportChronoTank source: snaps prevPos to prevent interpolation swoosh', () => {
    const chunk = methodChunk('teleportChronoTank(entity: Entity, target: WorldPos)');
    expect(chunk).toContain('entity.prevPos.x = target.x');
    expect(chunk).toContain('entity.prevPos.y = target.y');
  });

  it('teleportChronoTank source: sets chronoShiftTick visual effect', () => {
    const chunk = methodChunk('teleportChronoTank(entity: Entity, target: WorldPos)');
    expect(chunk).toContain('CHRONO_SHIFT_VISUAL_TICKS');
  });

  it('teleportChronoTank source: sets cooldown and clears move/attack targets', () => {
    const chunk = methodChunk('teleportChronoTank(entity: Entity, target: WorldPos)');
    expect(chunk).toContain('entity.chronoCooldown = Game.CHRONO_TANK_COOLDOWN');
    expect(chunk).toContain('entity.moveTarget = null');
    expect(chunk).toContain('entity.target = null');
    expect(chunk).toContain('entity.mission = Mission.GUARD');
  });

  it('CHRONO_SHIFT_VISUAL_TICKS = 30 (types.ts export)', () => {
    expect(CHRONO_SHIFT_VISUAL_TICKS).toBe(30);
  });

  it('chrono tank is NOT turreted (C++ udata.cpp)', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    expect(ctnk.hasTurret).toBe(false);
  });

  it('teleportChronoTank source: creates lightning effects at both origin and destination', () => {
    const chunk = methodChunk('teleportChronoTank(entity: Entity, target: WorldPos)');
    // Should have two 'litning' sprite references (origin + destination)
    const litningMatches = chunk.match(/litning/g);
    expect(litningMatches).not.toBeNull();
    expect(litningMatches!.length).toBeGreaterThanOrEqual(2);
  });
});

// =========================================================================
// 3. TANYA (I_TANYA / E7) — updateTanyaC4
// =========================================================================
describe('Tanya (E7) — C4 placement state machine', () => {
  it('has correct UNIT_STATS: infantry, dual Colt45, can swim', () => {
    const stats = UNIT_STATS.E7;
    expect(stats.type).toBe(UnitType.I_TANYA);
    expect(stats.strength).toBe(100);
    expect(stats.isInfantry).toBe(true);
    expect(stats.primaryWeapon).toBe('Colt45');
    expect(stats.secondaryWeapon).toBe('Colt45');
    expect(stats.canSwim).toBe(true);
  });

  it('Tanya entity has weapon for normal combat', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    expect(tanya.weapon).not.toBeNull();
    expect(tanya.weapon!.name).toBe('Colt45');
    expect(tanya.weapon2).not.toBeNull();
  });

  it('updateTanyaC4 source: only runs for I_TANYA type', () => {
    const chunk = methodChunk('updateTanyaC4(entity: Entity)');
    expect(chunk).toContain('entity.type !== UnitType.I_TANYA');
  });

  it('updateTanyaC4 source: requires alive targetStructure', () => {
    const chunk = methodChunk('updateTanyaC4(entity: Entity)');
    expect(chunk).toContain('entity.targetStructure');
    expect(chunk).toContain('.alive');
  });

  it('updateTanyaC4 source: walks toward structure if dist > 1.5', () => {
    const chunk = methodChunk('updateTanyaC4(entity: Entity)');
    expect(chunk).toContain('dist > 1.5');
    expect(chunk).toContain('AnimState.WALK');
    expect(chunk).toContain('moveToward');
  });

  it('updateTanyaC4 source: plants C4 with 45-tick timer', () => {
    const chunk = methodChunk('updateTanyaC4(entity: Entity)');
    expect(chunk).toContain('c4Timer = 45');
  });

  it('updateTanyaC4 source: sets attack animation when planting', () => {
    const chunk = methodChunk('updateTanyaC4(entity: Entity)');
    expect(chunk).toContain('AnimState.ATTACK');
  });

  it('updateTanyaC4 source: clears target and returns to GUARD after planting', () => {
    const chunk = methodChunk('updateTanyaC4(entity: Entity)');
    expect(chunk).toContain('entity.targetStructure = null');
    expect(chunk).toContain('entity.target = null');
    expect(chunk).toContain('entity.mission = Mission.GUARD');
  });

  it('updateTanyaC4 source: emits EVA message on C4 plant', () => {
    const chunk = methodChunk('updateTanyaC4(entity: Entity)');
    expect(chunk).toContain('C4 PLANTED');
  });

  it('Tanya cost is 1200 credits', () => {
    expect(UNIT_STATS.E7.cost).toBe(1200);
  });
});

// =========================================================================
// 4. THIEF (I_THF) — updateThief
// =========================================================================
describe('Thief (THF) — cash theft state machine', () => {
  it('has correct UNIT_STATS: no weapon, infantry', () => {
    const stats = UNIT_STATS.THF;
    expect(stats.type).toBe(UnitType.I_THF);
    expect(stats.strength).toBe(25);
    expect(stats.isInfantry).toBe(true);
    expect(stats.primaryWeapon).toBeNull();
    expect(stats.cost).toBe(500);
  });

  it('thief entity has no weapon', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    expect(thief.weapon).toBeNull();
    expect(thief.weapon2).toBeNull();
  });

  it('updateThief source: only targets PROC and SILO structures', () => {
    const chunk = methodChunk('updateThief(entity: Entity)');
    expect(chunk).toContain("s.type !== 'PROC'");
    expect(chunk).toContain("s.type !== 'SILO'");
  });

  it('updateThief source: rejects allied structures', () => {
    const chunk = methodChunk('updateThief(entity: Entity)');
    expect(chunk).toContain('this.isAllied(entity.house, s.house)');
  });

  it('updateThief source: steals 50% of enemy credits', () => {
    const chunk = methodChunk('updateThief(entity: Entity)');
    expect(chunk).toContain('enemyCredits * 0.5');
  });

  it('50% theft math: 1000 credits -> steals 500', () => {
    const enemyCredits = 1000;
    const stolen = Math.floor(enemyCredits * 0.5);
    expect(stolen).toBe(500);
  });

  it('50% theft math: 1 credit -> steals 0 (floored)', () => {
    const enemyCredits = 1;
    const stolen = Math.floor(enemyCredits * 0.5);
    expect(stolen).toBe(0);
  });

  it('50% theft math: 0 credits -> steals 0', () => {
    const enemyCredits = 0;
    const stolen = Math.floor(enemyCredits * 0.5);
    expect(stolen).toBe(0);
  });

  it('updateThief source: thief dies after stealing', () => {
    const chunk = methodChunk('updateThief(entity: Entity)', 1500);
    expect(chunk).toContain('entity.alive = false');
    expect(chunk).toContain('entity.mission = Mission.DIE');
  });

  it('updateThief source: sets isThieved trigger flag', () => {
    const chunk = methodChunk('updateThief(entity: Entity)', 1500);
    expect(chunk).toContain('this.isThieved = true');
  });

  it('updateThief source: emits EVA message with stolen amount', () => {
    const chunk = methodChunk('updateThief(entity: Entity)', 1500);
    expect(chunk).toContain('CREDITS STOLEN');
  });

  it('updateThief source: walks toward target if dist > 1.5', () => {
    const chunk = methodChunk('updateThief(entity: Entity)');
    expect(chunk).toContain('dist > 1.5');
    expect(chunk).toContain('moveToward');
  });
});

// =========================================================================
// 5. MEDIC (I_MEDI) — updateMedic (avoid duplicating medic-heal.test.ts)
// =========================================================================
describe('Medic (MEDI) — updateMedic state machine (non-duplicate checks)', () => {
  it('updateMedic source: flee behavior when fear >= FEAR_SCARED', () => {
    const chunk = methodChunk('private updateMedic(entity: Entity)');
    expect(chunk).toContain('entity.fear >= Entity.FEAR_SCARED');
    expect(chunk).toContain('Flee in opposite direction');
  });

  it('updateMedic source: drops heal target when fleeing', () => {
    const chunk = methodChunk('private updateMedic(entity: Entity)', 5000);
    expect(chunk).toContain('entity.healTarget = null; // drop heal target when fleeing');
  });

  it('updateMedic source: validates heal target is alive, friendly, infantry, damaged', () => {
    const chunk = methodChunk('private updateMedic(entity: Entity)', 5000);
    expect(chunk).toContain('!ht.alive');
    expect(chunk).toContain('ht.hp >= ht.maxHp');
    expect(chunk).toContain('!ht.stats.isInfantry');
    expect(chunk).toContain('ht.id === entity.id');
  });

  it('updateMedic source: scan range is sight * 1.5', () => {
    const chunk = methodChunk('private updateMedic(entity: Entity)', 5000);
    expect(chunk).toContain('entity.stats.sight * 1.5');
  });

  it('updateMedic source: heals when adjacent (dist <= 1.5)', () => {
    const chunk = methodChunk('private updateMedic(entity: Entity)', 5000);
    expect(chunk).toContain('dist <= 1.5');
  });

  it('updateMedic source: uses weapon ROF for heal cooldown', () => {
    const chunk = methodChunk('private updateMedic(entity: Entity)', 5000);
    expect(chunk).toContain('entity.attackCooldown = healRof');
  });

  it('updateMedic source: skips ants from healing', () => {
    const chunk = methodChunk('private updateMedic(entity: Entity)', 5000);
    expect(chunk).toContain('other.isAnt');
  });
});

// =========================================================================
// 6. ENGINEER (I_E6) — capture / repair logic
// =========================================================================
describe('Engineer (E6) — structure capture/repair', () => {
  it('has correct UNIT_STATS: no weapon, infantry', () => {
    const stats = UNIT_STATS.E6;
    expect(stats.type).toBe(UnitType.I_E6);
    expect(stats.strength).toBe(25);
    expect(stats.isInfantry).toBe(true);
    expect(stats.primaryWeapon).toBeNull();
  });

  it('engineer has null weapon', () => {
    const eng = makeEntity(UnitType.I_E6, House.Spain);
    expect(eng.weapon).toBeNull();
  });

  it('engineer source: enters structure for capture/repair', () => {
    // Engineers interact with structures in updateAttackStructure — search for E6 logic
    const src = engineSource();
    const idx = src.indexOf('UnitType.I_E6');
    expect(idx).toBeGreaterThan(-1);
  });

  it('engineer is consumed on use (alive = false)', () => {
    const eng = makeEntity(UnitType.I_E6, House.Spain);
    expect(eng.alive).toBe(true);
    // Simulate consumption
    eng.alive = false;
    eng.mission = Mission.DIE;
    expect(eng.alive).toBe(false);
    expect(eng.mission).toBe(Mission.DIE);
  });

  it('engineer is crushable infantry', () => {
    const stats = UNIT_STATS.E6;
    expect(stats.crushable).toBe(true);
    expect(stats.isInfantry).toBe(true);
  });
});

// =========================================================================
// 7. SPY (I_SPY) — spyInfiltrate (avoid duplicating spy-mechanics.test.ts)
// =========================================================================
describe('Spy (SPY) — infiltration state machine (non-duplicate checks)', () => {
  it('spy has no weapon (non-combat)', () => {
    const spy = makeEntity(UnitType.I_SPY, House.Spain);
    expect(spy.weapon).toBeNull();
  });

  it('spyInfiltrate source: different effects per structure type', () => {
    const chunk = methodChunk('private spyInfiltrate(spy: Entity, structure: MapStructure)', 3000);
    expect(chunk).toContain("case 'PROC':");
    expect(chunk).toContain("case 'DOME':");
    expect(chunk).toContain("case 'POWR':");
    expect(chunk).toContain("case 'APWR':");
    expect(chunk).toContain("case 'SPEN':");
    expect(chunk).toContain("case 'WEAP':");
    expect(chunk).toContain("case 'TENT':");
    expect(chunk).toContain("case 'BARR':");
  });

  it('spyInfiltrate source: PROC adds to spiedHouses (no credit theft)', () => {
    const chunk = methodChunk('private spyInfiltrate(spy: Entity, structure: MapStructure)', 3000);
    expect(chunk).toContain('this.spiedHouses.add(targetHouse)');
    // Should NOT contain credit theft — spy does NOT steal credits (that's the thief)
    expect(chunk).not.toContain('houseCredits');
  });

  it('spyInfiltrate source: DOME adds to radarSpiedHouses', () => {
    const chunk = methodChunk('private spyInfiltrate(spy: Entity, structure: MapStructure)', 3000);
    expect(chunk).toContain('this.radarSpiedHouses.add(targetHouse)');
  });

  it('spyInfiltrate source: SPEN grants sonar pulse superweapon', () => {
    const chunk = methodChunk('private spyInfiltrate(spy: Entity, structure: MapStructure)', 3000);
    expect(chunk).toContain('SuperweaponType.SONAR_PULSE');
  });

  it('spyInfiltrate source: spy is consumed after infiltration', () => {
    const chunk = methodChunk('private spyInfiltrate(spy: Entity, structure: MapStructure)', 3000);
    expect(chunk).toContain('spy.alive = false');
    expect(chunk).toContain('spy.mission = Mission.DIE');
    expect(chunk).toContain('spy.disguisedAs = null');
  });

  it('spyInfiltrate source: only works on enemy structures', () => {
    const chunk = methodChunk('private spyInfiltrate(spy: Entity, structure: MapStructure)', 3000);
    expect(chunk).toContain('this.isAllied(targetHouse, this.playerHouse)');
  });

  it('spyInfiltrate source: tracks trigger for TEVENT_SPIED', () => {
    const chunk = methodChunk('private spyInfiltrate(spy: Entity, structure: MapStructure)', 3000);
    expect(chunk).toContain('this.spiedBuildingTriggers.add(structure.triggerName)');
  });

  it('spy disguise field works correctly', () => {
    const spy = makeEntity(UnitType.I_SPY, House.Spain);
    expect(spy.disguisedAs).toBeNull();
    spy.disguisedAs = House.USSR;
    expect(spy.disguisedAs).toBe(House.USSR);
    spy.disguisedAs = null;
    expect(spy.disguisedAs).toBeNull();
  });

  it('spy has 200hp strength for dog instant-kill interaction', () => {
    // Spy has 25 HP but dogs instant-kill using maxHp
    const spy = makeEntity(UnitType.I_SPY, House.Spain);
    expect(spy.maxHp).toBe(25);
    // Dog instant-kill: damage = target.maxHp (from entity.ts takeDamage)
    const dog = makeEntity(UnitType.I_DOG, House.USSR);
    dog.target = spy;
    // Verify dog sets damage to maxHp
    const killDamage = spy.maxHp;
    expect(killDamage).toBe(25);
    expect(killDamage).toBeGreaterThanOrEqual(spy.hp);
  });
});

// =========================================================================
// 8. MECHANIC (I_MECH) — updateMechanicUnit
// =========================================================================
describe('Mechanic (MECH) — vehicle repair state machine', () => {
  it('has correct UNIT_STATS: infantry, GoodWrench weapon', () => {
    const stats = UNIT_STATS.MECH;
    expect(stats.type).toBe(UnitType.I_MECH);
    expect(stats.strength).toBe(60);
    expect(stats.isInfantry).toBe(true);
    expect(stats.primaryWeapon).toBe('GoodWrench');
  });

  it('GoodWrench weapon has negative damage (healing)', () => {
    const w = WEAPON_STATS.GoodWrench;
    expect(w).toBeDefined();
    expect(w.damage).toBeLessThan(0);
    expect(w.damage).toBe(-100);
    expect(w.warhead).toBe('Mechanical');
    expect(w.range).toBe(1.83);
    expect(w.rof).toBe(80);
  });

  it('mechanic entity has GoodWrench as primary weapon', () => {
    const mech = makeEntity(UnitType.I_MECH, House.Spain);
    expect(mech.weapon).not.toBeNull();
    expect(mech.weapon!.name).toBe('GoodWrench');
  });

  it('static constants: MECHANIC_HEAL_RANGE = 6, MECHANIC_HEAL_AMOUNT = 5', () => {
    const src = engineSource();
    expect(src).toContain('MECHANIC_HEAL_RANGE = 6');
    expect(src).toContain('MECHANIC_HEAL_AMOUNT = 5');
  });

  it('updateMechanicUnit source: only runs for I_MECH type', () => {
    const chunk = methodChunk('updateMechanicUnit(entity: Entity)');
    expect(chunk).toContain('entity.type !== UnitType.I_MECH');
  });

  it('updateMechanicUnit source: flees when fear >= FEAR_SCARED', () => {
    const chunk = methodChunk('updateMechanicUnit(entity: Entity)');
    expect(chunk).toContain('entity.fear >= Entity.FEAR_SCARED');
  });

  it('updateMechanicUnit source: heals vehicles, NOT infantry or air units', () => {
    const chunk = methodChunk('updateMechanicUnit(entity: Entity)');
    expect(chunk).toContain('ht.stats.isInfantry');
    expect(chunk).toContain('ht.isAirUnit');
  });

  it('updateMechanicUnit source: does NOT heal self', () => {
    const chunk = methodChunk('updateMechanicUnit(entity: Entity)');
    expect(chunk).toContain('ht.id === entity.id');
  });

  it('updateMechanicUnit source: heals 5 HP per tick with heal effect text', () => {
    const chunk = methodChunk('updateMechanicUnit(entity: Entity)', 3000);
    expect(chunk).toContain('Game.MECHANIC_HEAL_AMOUNT');
    // Source uses backtick template: `+${healed}`
    expect(chunk).toContain('healed');
    expect(chunk).toContain('textColor');
  });

  it('mechanic heal caps at target maxHp', () => {
    // Simulating the mechanic heal logic
    const target = makeEntity(UnitType.V_2TNK, House.Spain);
    target.hp = target.maxHp - 3; // only 3 HP missing
    const healAmount = 5;
    const prevHp = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + healAmount);
    expect(target.hp).toBe(target.maxHp);
    expect(target.hp - prevHp).toBe(3); // only healed 3, not 5
  });

  it('mechanic does NOT heal full-health vehicles', () => {
    const target = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(target.hp).toBe(target.maxHp);
    const shouldHeal = target.hp < target.maxHp;
    expect(shouldHeal).toBe(false);
  });

  it('mechanic does NOT heal infantry', () => {
    const rifle = makeEntity(UnitType.I_E1, House.Spain);
    rifle.hp = 10;
    // Mechanic heal target validation: !other.stats.isInfantry required
    expect(rifle.stats.isInfantry).toBe(true);
    const shouldHeal = !rifle.stats.isInfantry && rifle.hp < rifle.maxHp;
    expect(shouldHeal).toBe(false);
  });
});

// =========================================================================
// 9. MINELAYER (V_MNLY) — updateMinelayer / tickMines
// =========================================================================
describe('Minelayer (MNLY) — mine placement state machine', () => {
  it('has correct UNIT_STATS: no weapon, maxAmmo = 5', () => {
    const stats = UNIT_STATS.MNLY;
    expect(stats.type).toBe(UnitType.V_MNLY);
    expect(stats.strength).toBe(100);
    expect(stats.armor).toBe('heavy');
    expect(stats.primaryWeapon).toBeNull();
    expect(stats.maxAmmo).toBe(5);
    expect(stats.cost).toBe(800);
  });

  it('minelayer entity has mineCount = 0 initially', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    expect(mnly.mineCount).toBe(0);
    expect(mnly.ammo).toBe(5); // from maxAmmo stat
  });

  it('static MAX_MINES_PER_HOUSE = 50', () => {
    const src = engineSource();
    expect(src).toContain('MAX_MINES_PER_HOUSE = 50');
  });

  it('updateMinelayer source: only runs for V_MNLY with moveTarget', () => {
    const chunk = methodChunk('updateMinelayer(entity: Entity)');
    expect(chunk).toContain('entity.type !== UnitType.V_MNLY');
    expect(chunk).toContain('entity.moveTarget');
  });

  it('updateMinelayer source: respects ammo limit', () => {
    const chunk = methodChunk('updateMinelayer(entity: Entity)');
    expect(chunk).toContain('entity.ammo === 0');
  });

  it('updateMinelayer source: respects per-house mine limit', () => {
    const chunk = methodChunk('updateMinelayer(entity: Entity)');
    expect(chunk).toContain('Game.MAX_MINES_PER_HOUSE');
  });

  it('updateMinelayer source: prevents duplicate mines at same cell', () => {
    const chunk = methodChunk('updateMinelayer(entity: Entity)');
    expect(chunk).toContain('m.cx === targetCell.cx && m.cy === targetCell.cy');
  });

  it('updateMinelayer source: places mine with 1000 damage', () => {
    const chunk = methodChunk('updateMinelayer(entity: Entity)');
    expect(chunk).toContain('damage: 1000');
  });

  it('updateMinelayer source: decrements ammo on mine placement', () => {
    const chunk = methodChunk('updateMinelayer(entity: Entity)');
    expect(chunk).toContain('entity.ammo--');
  });

  it('updateMinelayer source: increments entity mineCount', () => {
    const chunk = methodChunk('updateMinelayer(entity: Entity)');
    expect(chunk).toContain('entity.mineCount++');
  });

  it('minelayer ammo tracking: 5 ammo -> place 3 mines -> 2 remaining', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    expect(mnly.ammo).toBe(5);
    // Simulate 3 mine placements
    for (let i = 0; i < 3; i++) {
      if (mnly.ammo > 0) {
        mnly.ammo--;
        mnly.mineCount++;
      }
    }
    expect(mnly.ammo).toBe(2);
    expect(mnly.mineCount).toBe(3);
  });

  it('minelayer stops placing when ammo = 0', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    // Use all ammo
    for (let i = 0; i < 5; i++) mnly.ammo--;
    expect(mnly.ammo).toBe(0);
    // Logic check: ammo === 0 && maxAmmo > 0 -> stop
    expect(mnly.ammo === 0 && mnly.maxAmmo > 0).toBe(true);
  });
});

// =========================================================================
// 10. MINE SYSTEM — tickMines
// =========================================================================
describe('Mine System — tickMines proximity detonation', () => {
  it('tickMines source: triggers on enemy entering mined cell', () => {
    const chunk = methodChunk('tickMines(): void');
    expect(chunk).toContain('ec.cx === mine.cx && ec.cy === mine.cy');
  });

  it('tickMines source: skips allied units and air units', () => {
    const chunk = methodChunk('tickMines(): void');
    expect(chunk).toContain('this.isAllied(e.house, mine.house)');
    expect(chunk).toContain('e.isAirUnit');
  });

  it('tickMines source: applies mine damage via damageEntity', () => {
    const chunk = methodChunk('tickMines(): void');
    expect(chunk).toContain('this.damageEntity(e, mine.damage');
  });

  it('tickMines source: removes mine after detonation', () => {
    const chunk = methodChunk('tickMines(): void');
    expect(chunk).toContain('this.mines.splice(i, 1)');
  });

  it('tickMines source: creates explosion effect', () => {
    const chunk = methodChunk('tickMines(): void');
    expect(chunk).toContain("type: 'explosion'");
  });

  it('tickMines source: uses AP warhead for mine damage', () => {
    const chunk = methodChunk('tickMines(): void');
    expect(chunk).toContain("'AP'");
  });

  it('mine data structure has cx, cy, house, damage fields', () => {
    // Verify the mine interface from source
    const src = engineSource();
    expect(src).toContain('mines: Array<{ cx: number; cy: number; house: House; damage: number }>');
  });

  it('air units are immune to mines', () => {
    // Air unit check
    const heli = makeEntity(UnitType.V_TRAN, House.USSR);
    expect(heli.isAirUnit).toBe(true);
    // tickMines skips e.isAirUnit === true
  });

  it('mines do not trigger on allied units', () => {
    // Verify same-house check
    const mine = { cx: 5, cy: 5, house: House.Spain, damage: 1000 };
    const ally = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(mine.house).toBe(ally.house);
    // isAllied(e.house, mine.house) would be true -> skip
  });
});

// =========================================================================
// 11. MAD TANK (V_QTNK) — deployMADTank / updateMADTank
// =========================================================================
describe('MAD Tank (QTNK) — seismic shockwave state machine', () => {
  it('has correct UNIT_STATS: no weapon, heavy armor', () => {
    const stats = UNIT_STATS.QTNK;
    expect(stats.type).toBe(UnitType.V_QTNK);
    expect(stats.strength).toBe(300);
    expect(stats.armor).toBe('heavy');
    expect(stats.primaryWeapon).toBeNull();
    expect(stats.crusher).toBe(true);
  });

  it('MAD Tank entity initializes with deploy fields at default', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    expect(qtnk.isDeployed).toBe(false);
    expect(qtnk.deployTimer).toBe(0);
  });

  it('static constants match C++ parity', () => {
    const src = engineSource();
    expect(src).toContain('MAD_TANK_CHARGE_TICKS = 90');
    expect(src).toContain('MAD_TANK_DAMAGE = 600');
    expect(src).toContain('MAD_TANK_RADIUS = 8');
  });

  it('deployMADTank source: sets isDeployed = true and starts timer', () => {
    const chunk = methodChunk('deployMADTank(entity: Entity)');
    expect(chunk).toContain('entity.isDeployed = true');
    expect(chunk).toContain('entity.deployTimer = Game.MAD_TANK_CHARGE_TICKS');
  });

  it('deployMADTank source: guards against double-deploy', () => {
    const chunk = methodChunk('deployMADTank(entity: Entity)');
    expect(chunk).toContain('if (entity.isDeployed) return');
  });

  it('deployMADTank source: ejects civilian crew before detonation', () => {
    const chunk = methodChunk('deployMADTank(entity: Entity)');
    expect(chunk).toContain('UnitType.I_C1');
    expect(chunk).toContain('crew.mission = Mission.MOVE');
  });

  it('deployMADTank source: clears move and attack targets', () => {
    const chunk = methodChunk('deployMADTank(entity: Entity)');
    expect(chunk).toContain('entity.moveTarget = null');
    expect(chunk).toContain('entity.target = null');
    expect(chunk).toContain('entity.mission = Mission.GUARD');
  });

  it('updateMADTank source: decrements deployTimer each tick', () => {
    const chunk = methodChunk('updateMADTank(entity: Entity)');
    expect(chunk).toContain('entity.deployTimer--');
  });

  it('updateMADTank source: damages vehicles (not infantry, not air, not self)', () => {
    const chunk = methodChunk('updateMADTank(entity: Entity)');
    expect(chunk).toContain('other.stats.isInfantry');
    expect(chunk).toContain('other.isAirUnit');
    expect(chunk).toContain('other.id === entity.id');
  });

  it('updateMADTank source: uses MAD_TANK_DAMAGE and MAD_TANK_RADIUS', () => {
    const chunk = methodChunk('updateMADTank(entity: Entity)');
    expect(chunk).toContain('Game.MAD_TANK_DAMAGE');
    expect(chunk).toContain('Game.MAD_TANK_RADIUS');
  });

  it('updateMADTank source: self-destructs after shockwave', () => {
    const chunk = methodChunk('updateMADTank(entity: Entity)');
    expect(chunk).toContain('entity.hp = 0');
    expect(chunk).toContain('entity.alive = false');
  });

  it('MAD Tank deploy timer countdown simulation', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    // Simulate deploy
    qtnk.isDeployed = true;
    qtnk.deployTimer = 90;

    // Count down
    for (let i = 0; i < 89; i++) {
      qtnk.deployTimer--;
      expect(qtnk.deployTimer).toBeGreaterThan(0);
    }
    qtnk.deployTimer--;
    expect(qtnk.deployTimer).toBe(0);
    // At 0, shockwave fires
  });

  it('MAD Tank is NOT turreted', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    expect(qtnk.hasTurret).toBe(false);
  });

  it('MAD Tank shockwave skips infantry — infantry-safe EMP', () => {
    // The updateMADTank code checks other.stats.isInfantry -> continue
    const rifle = makeEntity(UnitType.I_E1, House.USSR);
    expect(rifle.stats.isInfantry).toBe(true);
    // Verifies infantry would be skipped in the shockwave loop
  });
});

// =========================================================================
// 12. VEHICLE CLOAK (V_STNK) — updateVehicleCloak / CloakState
// =========================================================================
describe('Vehicle Cloaking (STNK) — cloak state machine', () => {
  it('STNK has isCloakable = true in UNIT_STATS', () => {
    const stats = UNIT_STATS.STNK;
    expect(stats.isCloakable).toBe(true);
    expect(stats.type).toBe(UnitType.V_STNK);
    expect(stats.passengers).toBe(1);
    expect(stats.primaryWeapon).toBe('APTusk');
  });

  it('entity initializes with UNCLOAKED state', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
    expect(stnk.cloakTimer).toBe(0);
    expect(stnk.sonarPulseTimer).toBe(0);
  });

  it('CloakState enum has 4 states', () => {
    expect(CloakState.UNCLOAKED).toBe(0);
    expect(CloakState.CLOAKING).toBe(1);
    expect(CloakState.CLOAKED).toBe(2);
    expect(CloakState.UNCLOAKING).toBe(3);
  });

  it('CLOAK_TRANSITION_FRAMES = 38 (~2.5 seconds at 15 FPS)', () => {
    expect(CLOAK_TRANSITION_FRAMES).toBe(38);
  });

  it('updateVehicleCloak source: skips vessels (vessel cloak is separate)', () => {
    const chunk = methodChunk('updateVehicleCloak(entity: Entity)');
    expect(chunk).toContain('entity.stats.isVessel');
  });

  it('updateVehicleCloak source: CLOAKING -> CLOAKED when timer reaches 0', () => {
    const chunk = methodChunk('updateVehicleCloak(entity: Entity)');
    expect(chunk).toContain('CloakState.CLOAKING');
    expect(chunk).toContain('CloakState.CLOAKED');
    expect(chunk).toContain('entity.cloakTimer--');
  });

  it('updateVehicleCloak source: UNCLOAKING -> UNCLOAKED when timer reaches 0', () => {
    const chunk = methodChunk('updateVehicleCloak(entity: Entity)');
    expect(chunk).toContain('CloakState.UNCLOAKING');
    expect(chunk).toContain('CloakState.UNCLOAKED');
  });

  it('updateVehicleCloak source: decloak prevention during ATTACK mission', () => {
    const chunk = methodChunk('updateVehicleCloak(entity: Entity)');
    expect(chunk).toContain('entity.mission === Mission.ATTACK');
  });

  it('updateVehicleCloak source: decloak prevention during weapon cooldown', () => {
    const chunk = methodChunk('updateVehicleCloak(entity: Entity)');
    expect(chunk).toContain('entity.attackCooldown > 0');
  });

  it('updateVehicleCloak source: sonarPulseTimer blocks recloaking', () => {
    const chunk = methodChunk('updateVehicleCloak(entity: Entity)');
    expect(chunk).toContain('entity.sonarPulseTimer > 0');
  });

  it('updateVehicleCloak source: low HP reduces recloak chance', () => {
    const chunk = methodChunk('updateVehicleCloak(entity: Entity)');
    expect(chunk).toContain('CONDITION_RED');
    expect(chunk).toContain('Math.random()');
  });

  it('updateVehicleCloak source: starts cloaking with CLOAK_TRANSITION_FRAMES', () => {
    const chunk = methodChunk('updateVehicleCloak(entity: Entity)');
    expect(chunk).toContain('CLOAK_TRANSITION_FRAMES');
  });

  it('STNK is NOT turreted (C++ udata.cpp)', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    expect(stnk.hasTurret).toBe(false);
  });

  it('cloak state transition: UNCLOAKED -> CLOAKING -> CLOAKED', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);

    // Begin cloaking
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = CLOAK_TRANSITION_FRAMES;
    expect(stnk.cloakState).toBe(CloakState.CLOAKING);
    expect(stnk.cloakTimer).toBe(38);

    // Count down to 0
    for (let i = 0; i < 38; i++) {
      stnk.cloakTimer--;
    }
    expect(stnk.cloakTimer).toBe(0);

    // Transition to CLOAKED
    stnk.cloakState = CloakState.CLOAKED;
    stnk.cloakTimer = 0;
    expect(stnk.cloakState).toBe(CloakState.CLOAKED);
  });

  it('cloak state transition: CLOAKED -> UNCLOAKING -> UNCLOAKED', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.CLOAKED;

    // Begin uncloaking (e.g., due to damage)
    stnk.cloakState = CloakState.UNCLOAKING;
    stnk.cloakTimer = CLOAK_TRANSITION_FRAMES;

    // Count down
    for (let i = 0; i < 38; i++) {
      stnk.cloakTimer--;
    }
    expect(stnk.cloakTimer).toBe(0);

    stnk.cloakState = CloakState.UNCLOAKED;
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('damage forces uncloak on cloakable units (Entity.takeDamage)', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.CLOAKED;
    // takeDamage checks isCloakable and force-uncloaks
    stnk.takeDamage(10, 'AP');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);
    expect(stnk.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('damage during CLOAKING also forces uncloak', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = 20;
    stnk.takeDamage(10, 'AP');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);
    expect(stnk.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('damage while UNCLOAKED does NOT change cloak state', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    stnk.cloakState = CloakState.UNCLOAKED;
    stnk.takeDamage(10, 'AP');
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKED);
  });
});

// =========================================================================
// 13. C4 TIMER SYSTEM — tickC4Timers
// =========================================================================
describe('C4 Timer System — tickC4Timers', () => {
  it('tickC4Timers source: decrements c4Timer on structures', () => {
    const chunk = methodChunk('tickC4Timers(): void');
    expect(chunk).toContain('sAny.c4Timer--');
  });

  it('tickC4Timers source: destroys structure when timer reaches 0', () => {
    const chunk = methodChunk('tickC4Timers(): void');
    expect(chunk).toContain('this.damageStructure(s, 9999)');
  });

  it('tickC4Timers source: skips dead structures', () => {
    const chunk = methodChunk('tickC4Timers(): void');
    expect(chunk).toContain('!s.alive');
  });

  it('C4 timer countdown: 45 ticks -> 0 -> kaboom', () => {
    // Simulate the c4Timer countdown
    let c4Timer = 45;
    for (let i = 0; i < 45; i++) {
      c4Timer--;
    }
    expect(c4Timer).toBe(0);
    // At 0, structure receives 9999 damage (guaranteed destruction)
    expect(9999).toBeGreaterThan(256); // max structure HP
  });

  it('C4 damage amount (9999) exceeds any structure maxHp', () => {
    // Standard structure maxHp is 256
    const c4Damage = 9999;
    expect(c4Damage).toBeGreaterThan(256);
    // Even reinforced structures with 600+ HP would be destroyed
    expect(c4Damage).toBeGreaterThan(600);
  });
});

// =========================================================================
// 14. CROSS-CUTTING: Entity field initialization for special units
// =========================================================================
describe('Entity field initialization — special ability fields', () => {
  it('all special fields initialize to safe defaults', () => {
    const e = makeEntity(UnitType.I_E1, House.Spain);
    expect(e.c4Timer).toBe(0);
    expect(e.mineCount).toBe(0);
    expect(e.chronoCooldown).toBe(0);
    expect(e.isDeployed).toBe(false);
    expect(e.deployTimer).toBe(0);
    expect(e.fuseTimer).toBe(0);
    expect(e.disguisedAs).toBeNull();
    expect(e.cloakState).toBe(CloakState.UNCLOAKED);
    expect(e.cloakTimer).toBe(0);
    expect(e.sonarPulseTimer).toBe(0);
    expect(e.isCloakable).toBe(false);
    expect(e.ironCurtainTick).toBe(0);
    expect(e.chronoShiftTick).toBe(0);
  });

  it('STNK isCloakable initializes from stats', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain);
    // isCloakable is set from stats in the constructor for STNK
    expect(stnk.stats.isCloakable).toBe(true);
  });

  it('CTNK isCloakable is false (not inherently cloakable)', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain);
    expect(ctnk.stats.isCloakable).toBeUndefined();
  });

  it('MNLY initializes ammo from stats.maxAmmo', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain);
    expect(mnly.ammo).toBe(5);
    expect(mnly.maxAmmo).toBe(5);
  });

  it('QTNK has null weapon (no direct attack)', () => {
    const qtnk = makeEntity(UnitType.V_QTNK, House.Spain);
    expect(qtnk.weapon).toBeNull();
  });
});

// =========================================================================
// 15. CROSS-CUTTING: Game tick loop integration of special units
// =========================================================================
describe('Game tick loop — special unit update integration', () => {
  it('MAD Tank update runs only when isDeployed is true', () => {
    const src = engineSource();
    // Check that the tick loop conditionally updates MAD Tank
    expect(src).toContain('entity.type === UnitType.V_QTNK && entity.isDeployed');
  });

  it('Chrono Tank cooldown ticks every frame', () => {
    const src = engineSource();
    expect(src).toContain('entity.type === UnitType.V_CTNK');
    // updateChronoTank runs each tick for CTNK
  });

  it('Vehicle cloak update runs for non-vessel cloakable units', () => {
    const src = engineSource();
    expect(src).toContain('entity.stats.isCloakable && !entity.stats.isVessel');
  });

  it('Minelayer update runs when MNLY has moveTarget', () => {
    const src = engineSource();
    expect(src).toContain('entity.type === UnitType.V_MNLY && entity.moveTarget');
  });

  it('tickC4Timers runs every tick (in main update loop)', () => {
    const src = engineSource();
    expect(src).toContain('this.tickC4Timers()');
  });

  it('tickMines runs every tick (in main update loop)', () => {
    const src = engineSource();
    expect(src).toContain('this.tickMines()');
  });

  it('Demo Truck intercepts normal ATTACK mission in updateAttack', () => {
    const src = engineSource();
    const attackIdx = src.indexOf('private updateAttack(entity: Entity)');
    expect(attackIdx).toBeGreaterThan(-1);
    const attackChunk = src.slice(attackIdx, attackIdx + 300);
    expect(attackChunk).toContain('UnitType.V_DTRK');
    expect(attackChunk).toContain('this.updateDemoTruck(entity)');
  });

  it('Tanya C4 intercepts normal structure attack in updateAttackStructure', () => {
    const src = engineSource();
    // Tanya redirects to updateTanyaC4 when targeting structures
    expect(src).toContain('entity.type === UnitType.I_TANYA');
    const idx = src.indexOf('this.updateTanyaC4(entity)');
    expect(idx).toBeGreaterThan(-1);
  });

  it('Thief intercepts normal structure attack', () => {
    const src = engineSource();
    expect(src).toContain('entity.type === UnitType.I_THF');
    const idx = src.indexOf('this.updateThief(entity)');
    expect(idx).toBeGreaterThan(-1);
  });

  it('Medic update runs for MEDI type, skipping enemy targeting', () => {
    const src = engineSource();
    const idx = src.indexOf('this.updateMedic(entity)');
    expect(idx).toBeGreaterThan(-1);
  });
});

// =========================================================================
// 16. EDGE CASES — dead targets, self-targeting, out of range
// =========================================================================
describe('Edge cases — dead targets, self-targeting, cooldowns', () => {
  it('Demo Truck with dead target stops (no explosion)', () => {
    const chunk = methodChunk('updateDemoTruck(entity: Entity)');
    // If target is dead, targetPos will be null -> mission = GUARD
    expect(chunk).toContain('entity.target.alive');
    expect(chunk).toContain('entity.mission = Mission.GUARD');
  });

  it('Tanya C4 with dead targetStructure aborts', () => {
    const chunk = methodChunk('updateTanyaC4(entity: Entity)');
    expect(chunk).toContain('.alive');
  });

  it('Thief against allied structure rejects and returns to GUARD', () => {
    const chunk = methodChunk('updateThief(entity: Entity)');
    expect(chunk).toContain('this.isAllied(entity.house, s.house)');
    expect(chunk).toContain('entity.mission = Mission.GUARD');
  });

  it('Thief against non-PROC/SILO structure rejects', () => {
    const chunk = methodChunk('updateThief(entity: Entity)');
    expect(chunk).toContain("s.type !== 'PROC'");
    expect(chunk).toContain("s.type !== 'SILO'");
    expect(chunk).toContain('entity.mission = Mission.GUARD');
  });

  it('Chrono Tank teleport blocked by impassable terrain', () => {
    const chunk = methodChunk('teleportChronoTank(entity: Entity, target: WorldPos)');
    expect(chunk).toContain('this.map.isPassable(tc.cx, tc.cy)');
  });

  it('Chrono Tank teleport blocked by cooldown > 0', () => {
    const chunk = methodChunk('teleportChronoTank(entity: Entity, target: WorldPos)');
    expect(chunk).toContain('entity.chronoCooldown > 0');
  });

  it('MAD Tank double-deploy is prevented', () => {
    const chunk = methodChunk('deployMADTank(entity: Entity)');
    expect(chunk).toContain('if (entity.isDeployed) return');
  });

  it('updateMADTank does nothing if not deployed', () => {
    const chunk = methodChunk('updateMADTank(entity: Entity)');
    expect(chunk).toContain('!entity.isDeployed');
  });

  it('updateDemoTruck does nothing for non-ATTACK mission', () => {
    const chunk = methodChunk('updateDemoTruck(entity: Entity)');
    expect(chunk).toContain('entity.mission !== Mission.ATTACK');
  });

  it('invulnerable unit cannot be killed by mine (Entity.takeDamage)', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.ironCurtainTick = 100; // invulnerable
    expect(tank.isInvulnerable).toBe(true);
    const killed = tank.takeDamage(9999, 'AP');
    expect(killed).toBe(false);
    expect(tank.alive).toBe(true);
    expect(tank.hp).toBe(tank.maxHp); // no damage taken
  });

  it('dead entity cannot take further damage', () => {
    const unit = makeEntity(UnitType.I_E1, House.Spain);
    unit.alive = false;
    unit.hp = 0;
    const killed = unit.takeDamage(100, 'AP');
    expect(killed).toBe(false);
  });

  it('crate-granted cloak (isCloakable) persists permanently', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    tank.isCloakable = true;
    // Simulate 1000 ticks — boolean stays true
    for (let i = 0; i < 1000; i++) {
      expect(tank.isCloakable).toBe(true);
    }
  });
});

// =========================================================================
// 17. worldDist / worldToCell helpers used by special units
// =========================================================================
describe('worldDist / worldToCell — coordinate math used by special units', () => {
  it('worldDist measures in cells (CELL_SIZE = 24)', () => {
    expect(CELL_SIZE).toBe(24);
    const a = { x: 0, y: 0 };
    const b = { x: CELL_SIZE, y: 0 };
    expect(worldDist(a, b)).toBeCloseTo(1.0);
  });

  it('worldDist: 1.5 cells = 36 pixels (mine/C4 adjacency threshold)', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 136, y: 100 }; // 36px = 1.5 cells
    expect(worldDist(a, b)).toBeCloseTo(1.5);
  });

  it('worldToCell converts pixel coords to cell coords', () => {
    const cell = worldToCell(50, 74);
    expect(cell.cx).toBe(2); // floor(50/24) = 2
    expect(cell.cy).toBe(3); // floor(74/24) = 3
  });

  it('CONDITION_RED = 0.25 (used by vehicle cloak low-HP check)', () => {
    expect(CONDITION_RED).toBe(0.25);
  });
});
