/**
 * C++ parity: Retaliation TarCom-assignment chain.
 *
 * C++ implementation chain (the port target):
 *   - foot.cpp:1166-1234  FootClass::Take_Damage — unified retaliation entry point.
 *       Called via TechnoClass::Take_Damage for all Foot descendants (Infantry,
 *       Drive/Unit, Vessel, Aircraft). On non-fatal damage with a known source:
 *         1. Team->Took_Damage() if unit is on a team (skips retaliation).
 *         2. MissionControl[Mission].IsNoThreat && !IsZombie → Enter_Idle_Mode.
 *         3. Is_Allowed_To_Retaliate(source) → Assign_Target(source->As_Target())
 *            gated by `In_Range(source, primary) || !House->IsHuman` (foot.cpp:1205).
 *         4. If Mission == MISSION_AMBUSH → Assign_Mission(MISSION_HUNT).
 *         5. Else → Scatter if mission.IsScatter && no TarCom/NavCom.
 *
 *   - techno.cpp:4924-5030 TechnoClass::Is_Allowed_To_Retaliate(source) gates:
 *       1. source != NULL                                          (line 4929)
 *       2. MissionControl[Mission].IsRetaliate                     (line 4934)
 *       3. !(RTTI_AIRCRAFT && IsFixedWing)                         (line 4939)
 *       4. !House->Is_Ally(source)                                 (line 4947)
 *       5. Combat_Damage() > 0 && Is_Weapon_Equipped()             (line 4952)
 *       6. PrimaryWeapon->WarheadPtr->Modifier[source->armor] != 0 (line 4958)
 *       7. !(source IS RTTI_INFANTRY && source->Class->IsDog)      (line 4968)
 *       8. !(source IS RTTI_AIRCRAFT) || PrimaryWeapon->Bullet->IsAntiAircraft (line 4973)
 *       9. !(House->IsHuman || PlayerControl) || source != RTTI_BUILDING || !IsBomber (line 4980)
 *      10. !House->IsHuman || Rule.IsSmartDefense || Tanya vs infantry exception (line 4988)
 *      11. !(IsSuicide team)                                       (line 4993)
 *      12. AI-only 50% threat comparison                           (lines 5001-5019)
 *
 *   - rules.ini [General] PlayerReturnFire=no → Rule.IsSmartDefense = false.
 *   - rules.ini [HUNT] Retaliate=no, [Sleep] Retaliate=no, etc.
 *
 * Port commit reference: b7c130d7 gated Mission_Guard scan to dog-only (correct per
 * C++ Greatest_Threat mask=0 no-op). Regular units now acquire targets only via
 * retaliation (TarCom = source), which this test validates at the behavioural level.
 *
 * TS implementation: combat.ts triggerRetaliation() — called from inside damageEntity()
 * so EVERY damage event (direct hit, splash, projectile detonation) runs retaliation,
 * matching C++ FootClass::Take_Damage unified semantics.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE,
  Mission, MISSION_CONTROL,
  COUNTRY_BONUSES,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { type CombatContext, triggerRetaliation, damageEntity } from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';
import { ScenarioRandom } from '../engine/random';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeMockCtx(overrides: Partial<CombatContext> = {}): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities: [],
    entityById: new Map<number, Entity>(),
    structures: [],
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'SCG01EA',
    killCount: 0,
    lossCount: 0,
    pointTotal: 0,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
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
    warheadMuzzleColor: () => '#ff0',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    powerConsumed: 0,
    powerProduced: 100,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  } as CombatContext;
}

// ---------------------------------------------------------------------------
// Core chain: AI unit on GUARD retaliates when damaged (restores b7c130d7 gap)
// ---------------------------------------------------------------------------
describe('retaliation TarCom-assignment chain (C++ foot.cpp:1166-1234)', () => {
  it('AI tank on GUARD acquires attacker as TarCom when damaged', () => {
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    victim.mission = Mission.GUARD;
    expect(victim.target).toBeNull();

    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, victim, attacker);

    // C++ foot.cpp:1206 — Assign_Target(source->As_Target())
    expect(victim.target).toBe(attacker);
    // C++ Assign_Target only updates TarCom; Mission remains GUARD.
    expect(victim.mission).toBe(Mission.GUARD);
  });

  it('AI infantry on GUARD retaliates against enemy infantry', () => {
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    victim.mission = Mission.GUARD;

    const attacker = makeEntity(UnitType.I_E1, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, victim, attacker);

    expect(victim.target).toBe(attacker);
    expect(victim.mission).toBe(Mission.GUARD);
  });

  it('retaliation is integrated into damageEntity (unified C++ Take_Damage entry point)', () => {
    // C++ FootClass::Take_Damage is the ONLY place retaliation runs — every damage
    // event funnels through it. TS damageEntity is the equivalent chokepoint.
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    victim.mission = Mission.GUARD;
    ctx.entities.push(victim);

    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);

    // Call damageEntity directly (not triggerRetaliation) — retaliation should fire.
    damageEntity(ctx, victim, 10, 'AP', attacker);
    expect(victim.target).toBe(attacker);
    expect(victim.mission).toBe(Mission.GUARD);
  });

  it('damageEntity without attacker does NOT retaliate (no source — gate 1)', () => {
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    victim.mission = Mission.GUARD;

    damageEntity(ctx, victim, 10, 'AP'); // no attacker
    expect(victim.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gate 2: MissionControl[Mission].IsRetaliate
// ---------------------------------------------------------------------------
describe('C++ techno.cpp:4934 gate — MissionControl[Mission].IsRetaliate', () => {
  it.each([
    [Mission.SLEEP, 'Sleep'],
    [Mission.HUNT, 'Hunt'],  // Hunt.Retaliate=no in rules.ini
    [Mission.HARVEST, 'Harvest'],
    [Mission.CAPTURE, 'Capture'],
    [Mission.ENTER, 'Enter'],
    [Mission.UNLOAD, 'Unload'],
    [Mission.RETREAT, 'Retreat'],
  ])('mission %s (%s) with isRetaliate=false blocks retaliation', (mission, name) => {
    expect(MISSION_CONTROL[mission].isRetaliate, `${name} should have isRetaliate=false`).toBe(false);
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    victim.mission = mission;
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, victim, attacker);
    expect(victim.target).toBeNull();
  });

  it.each([
    [Mission.GUARD, 'Guard'],
    [Mission.AREA_GUARD, 'Area Guard'],
    [Mission.MOVE, 'Move'],
    [Mission.ATTACK, 'Attack'],
  ])('mission %s (%s) with isRetaliate=true allows retaliation', (mission, name) => {
    expect(MISSION_CONTROL[mission].isRetaliate, `${name} should have isRetaliate=true`).toBe(true);
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    victim.mission = mission;
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, victim, attacker);
    expect(victim.target).toBe(attacker);
  });
});

// ---------------------------------------------------------------------------
// Gate 3: Fixed-wing aircraft cannot retaliate (C++ techno.cpp:4939)
// ---------------------------------------------------------------------------
describe('C++ techno.cpp:4939 gate — fixed-wing aircraft', () => {
  it('MIG (fixed-wing) does NOT retaliate even when damaged', () => {
    const ctx = makeMockCtx();
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 100, 100);
    mig.mission = Mission.GUARD;
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, mig, attacker);
    expect(mig.target).toBeNull();
  });

  it('HELI (helicopter, not fixed-wing) can retaliate', () => {
    const ctx = makeMockCtx();
    const heli = makeEntity(UnitType.V_HELI, House.USSR, 100, 100);
    heli.mission = Mission.GUARD;
    // Ground attacker (not airborne)
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, heli, attacker);
    // HELI has ChainGun weapon which is isAntiGround (targets ground units)
    expect(heli.target).toBe(attacker);
  });
});

// ---------------------------------------------------------------------------
// Gate 4: Allied attacker — no friendly retaliation (C++ techno.cpp:4947)
// ---------------------------------------------------------------------------
describe('C++ techno.cpp:4947 gate — allied attacker blocks retaliation', () => {
  it('does not retaliate against allied unit', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.mission = Mission.GUARD;
    // Greece and Spain are both Allied — they are allies
    const ally = makeEntity(UnitType.V_2TNK, House.USSR, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, tank, ally);
    expect(tank.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gate 5: Unarmed units cannot retaliate (C++ techno.cpp:4952)
// ---------------------------------------------------------------------------
describe('C++ techno.cpp:4952 gate — unarmed units cannot retaliate', () => {
  it('MCV (unarmed) does not retaliate', () => {
    const ctx = makeMockCtx();
    const mcv = makeEntity(UnitType.V_MCV, House.USSR, 100, 100);
    mcv.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, mcv, enemy);
    expect(mcv.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gate 7: Source is dog blocks retaliation (C++ techno.cpp:4968)
// ---------------------------------------------------------------------------
describe('C++ techno.cpp:4968 gate — source is dog', () => {
  it('victim does NOT retaliate against attacking dog (dogs use special targeting)', () => {
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    victim.mission = Mission.GUARD;
    const dog = makeEntity(UnitType.I_DOG, House.Spain, 100 + CELL_SIZE * 0.5, 100);
    triggerRetaliation(ctx, victim, dog);
    expect(victim.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gate 8: Aircraft source requires AA weapon (C++ techno.cpp:4973)
// ---------------------------------------------------------------------------
describe('C++ techno.cpp:4973 gate — aircraft source requires AA weapon', () => {
  it('ground unit without AA cannot retaliate against aircraft', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    tank.mission = Mission.GUARD;
    // HELI is an aircraft (non-fixed-wing)
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 100 + CELL_SIZE, 100);
    heli.flightAltitude = 5; // airborne
    triggerRetaliation(ctx, tank, heli);
    expect(tank.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gate 10: Human (player) house + !IsSmartDefense blocks retaliation
// ---------------------------------------------------------------------------
describe('C++ techno.cpp:4988 gate — human house + PlayerReturnFire=no', () => {
  it('player tank does NOT auto-retaliate (PlayerReturnFire=no)', () => {
    const ctx = makeMockCtx({ playerHouse: House.Spain });
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.V_3TNK, House.USSR, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, tank, enemy);
    expect(tank.target).toBeNull();
  });

  it('player-allied computer house still auto-retaliates (strict House->IsHuman)', () => {
    const alliances = buildDefaultAlliances();
    alliances.get(House.Spain)?.add(House.England);
    alliances.get(House.England)?.add(House.Spain);
    const ctx = makeMockCtx({
      playerHouse: House.Spain,
      isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
      entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
      // Game.isPlayerControlled means "player or ally"; C++ House->IsHuman does not.
      isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    });
    const englishInf = makeEntity(UnitType.I_E1, House.England, 100, 100);
    englishInf.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.I_E4, House.USSR, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, englishInf, enemy);

    expect(englishInf.target).toBe(enemy);
    expect(englishInf.mission).toBe(Mission.GUARD);
  });

  it('Tanya retaliates against infantry even without SmartDefense (C++ exception)', () => {
    const ctx = makeMockCtx({ playerHouse: House.Spain });
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain, 100, 100);
    tanya.mission = Mission.GUARD;
    const infEnemy = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, tanya, infEnemy);
    expect(tanya.target).toBe(infEnemy);
  });

  it('Tanya does NOT retaliate against vehicle (source not infantry, gate applies)', () => {
    const ctx = makeMockCtx({ playerHouse: House.Spain });
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain, 100, 100);
    tanya.mission = Mission.GUARD;
    const tankEnemy = makeEntity(UnitType.V_3TNK, House.USSR, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, tanya, tankEnemy);
    expect(tanya.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gate 11: Suicide team members cannot retaliate (C++ techno.cpp:4993)
// ---------------------------------------------------------------------------
describe('C++ techno.cpp:4993 gate — suicide team members', () => {
  it('suicide team member does NOT retaliate', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.mission = Mission.GUARD;
    tank.isSuicide = true;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, tank, enemy);
    expect(tank.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Retaliation propagation via damageEntity (unified entry point)
// ---------------------------------------------------------------------------
describe('retaliation runs from every damage path via damageEntity', () => {
  it('AI unit with existing alive target runs C++ 50% threat comparison roll', () => {
    // C++ techno.cpp:5027 — AI always consumes Percent_Chance(50) before
    // deciding whether to keep the current target. With seed=0 the roll enters
    // the comparison path; equal AP threats keep the old target.
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.mission = Mission.ATTACK;
    const oldTarget = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    tank.target = oldTarget;
    const newAttacker = makeEntity(UnitType.V_4TNK, House.Spain, 100 + CELL_SIZE * 2, 100);
    const savedSeed = ScenarioRandom.seed;
    const savedCallCount = ScenarioRandom.callCount;
    ScenarioRandom.seed = 0;
    ScenarioRandom.callCount = 0;
    const callsBefore = ScenarioRandom.callCount;
    triggerRetaliation(ctx, tank, newAttacker);

    expect(ScenarioRandom.callCount).toBe(callsBefore + 1);
    expect(tank.target).toBe(oldTarget);
    ScenarioRandom.seed = savedSeed;
    ScenarioRandom.callCount = savedCallCount;
  });

  it('AI unit with dead target retargets on retaliation', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.mission = Mission.GUARD;
    const deadTarget = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);
    deadTarget.alive = false;
    tank.target = deadTarget;
    const newAttacker = makeEntity(UnitType.V_4TNK, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, tank, newAttacker);
    expect(tank.target).toBe(newAttacker);
  });

  it('dead victim does not retaliate', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.alive = false;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, tank, enemy);
    expect(tank.target).toBeNull();
  });

  it('dead attacker does not trigger retaliation', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    enemy.alive = false;
    triggerRetaliation(ctx, tank, enemy);
    expect(tank.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Team mission gate (TS-specific — scripted teams aren't interrupted)
// ---------------------------------------------------------------------------
describe('scripted team mission gate (TS addition)', () => {
  it('entity with team missions (non-HUNT) does NOT retaliate — preserves script', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.mission = Mission.ATTACK;
    tank.teamMissions = [{ mission: 0, data: 0 }];
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, tank, enemy);
    expect(tank.target).toBeNull();
  });
});
