/**
 * C++ Behavioral Parity: Team member retaliation delegation (SCG06EA tick 67)
 *
 * C++ foot.cpp:1166-1234 FootClass::Take_Damage:
 *
 *   ResultType FootClass::Take_Damage(int & damage, int distance,
 *                                     WarheadType warhead,
 *                                     TechnoClass * source, bool forced)
 *   {
 *       ResultType result = TechnoClass::Take_Damage(damage, distance,
 *                                                   warhead, source, forced);
 *
 *       if (result != RESULT_NONE && Team) {
 *           Team->Took_Damage(this, result, source);   // ← line 1172-1174
 *       } else {
 *           // ... IsNoThreat snap, Is_Allowed_To_Retaliate + Assign_Target, Scatter ...
 *       }
 *   }
 *
 * When the victim belongs to a team, damage handling is DELEGATED to
 * TeamClass::Took_Damage (team.cpp:1574-1618). The team may adjust its collective
 * Target pointer under specific conditions (team.cpp:1580 IsMoving gate, 1589
 * source-type exclusions, 1596-1604 don't-swap-firepower check) but it NEVER
 * calls Assign_Target on the individual unit. The per-unit retaliation branch
 * (the else at foot.cpp:1176) is skipped entirely.
 *
 * Empirical divergence (SCG06EA RNG log):
 *   - Tick 65: Greek E1 @(19,65) fires invisible-bullet rifle; BadGuy E1 @(18,68)
 *     takes damage. This unit is a BadGuy team member in MOVE mission.
 *   - WASM: FootClass::Take_Damage sees Team != NULL → Team->Took_Damage handles
 *     it. BadGuy stays in MOVE. No Mission_Move jitter RNG re-fires.
 *   - TS (pre-fix): triggerRetaliation set victim.target = Greek E1 and
 *     victim.mission = ATTACK, then team.coordinateMove re-queued MOVE, Commence
 *     popped missionQueue and reset missionTimer to 0. Tick 67's MOVE handler
 *     then fired 14 + Random_Pick(0, 2) for the new timer, consuming 1 RNG call
 *     that WASM did not. First-divergence advanced 67→next.
 *
 * Port: combat.ts triggerRetaliation() adds an early-return when victim.teamRef
 * is set, mirroring the C++ `if (result != RESULT_NONE && Team)` delegation.
 * The existing `victim.teamMissions.length > 0` guard only fires for units with
 * per-entity team-mission scripts (reinforcement entry scripts); pure team
 * members coordinated by TeamInstance have empty teamMissions but a non-null
 * teamRef.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE,
  Mission,
  COUNTRY_BONUSES,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { type CombatContext, triggerRetaliation, damageEntity } from '../engine/combat';
import { GameMap } from '../engine/map';
import { Team } from '../engine/team';
import type { Effect } from '../engine/renderer';

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
    scenarioId: 'SCG06EA',
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

function makeMovingTeam(member: Entity): Team {
  const team = new Team({
    house: member.house,
    desiredMembers: [{ type: member.type, count: 1 }],
    missionList: [],
    isReinforcable: false,
  });
  team.add(member);
  team.isMoving = true;
  return team;
}

describe('SCG06EA tick 67 — team member retaliation delegation (C++ foot.cpp:1172)', () => {
  it('team member in MOVE sets TarCom but does NOT change mission (C++ team.cpp:1613 + 1715-1718)', () => {
    // Repro of the SCG06EA tick 65 event: a BadGuy E1 in MOVE mission, part of a
    // team, is hit by a Greek E1's rifle. C++ foot.cpp:1172 delegates to
    // TeamClass::Took_Damage → sets Team->Target = source (team.cpp:1613). Team
    // dispatch (Coordinate_Attack at team.cpp:1715-1718) propagates Team->Target
    // to the individual unit's TarCom via Assign_Target. The unit's Mission
    // remains MOVE — no Commence MOVE→ATTACK→MOVE cycle, so no rogue
    // Mission_Move jitter RNG fires.
    //
    // TS parity: in triggerRetaliation, set victim.target = attacker when the
    // victim is a team member (and has no existing valid target), but preserve
    // mission and missionTimer. The paired Firing_AI-in-MOVE branch in
    // index.ts then starts the pre-fire animation on the next tick.
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.I_E1, House.BadGuy, 18 * CELL_SIZE, 68 * CELL_SIZE);
    victim.mission = Mission.MOVE;
    const originalTimer = 12;
    victim.missionTimer = originalTimer;
    const team = makeMovingTeam(victim);

    const attacker = makeEntity(UnitType.I_E1, House.Greece, 19 * CELL_SIZE, 65 * CELL_SIZE);

    triggerRetaliation(ctx, victim, attacker);

    // FootClass::Take_Damage delegates to Team::Took_Damage. That sets the
    // collective Team target; individual TarCom is propagated later by team AI.
    expect(team.targetEntityRef).toBe(attacker);
    expect(victim.target).toBeNull();
    // Mission and timer MUST remain untouched — this is the critical tick-67
    // quiet-tick parity. A mission change would set missionTimer=0 via
    // Commence, triggering a rogue Mission_Move jitter RNG at the next tick.
    expect(victim.mission).toBe(Mission.MOVE);
    expect(victim.missionTimer).toBe(originalTimer);
  });

  it('non-team unit on MOVE still retaliates (regression guard)', () => {
    // Non-team AI units must still retaliate per-unit — that's the C++ else branch
    // at foot.cpp:1176. Only the teamRef path is the new short-circuit.
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    victim.mission = Mission.GUARD; // retaliate-capable mission
    victim.teamRef = null;

    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    triggerRetaliation(ctx, victim, attacker);

    expect(victim.target).toBe(attacker);
    expect(victim.mission).toBe(Mission.GUARD);
  });

  it('damageEntity honours the teamRef target-only path (unified entry point)', () => {
    // damageEntity is the TS equivalent of C++ FootClass::Take_Damage. The
    // teamRef branch must set TarCom without changing mission whether
    // retaliation is invoked directly or via the damage chain.
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.I_E1, House.BadGuy, 18 * CELL_SIZE, 68 * CELL_SIZE);
    victim.mission = Mission.MOVE;
    victim.missionTimer = 8;
    const team = makeMovingTeam(victim);
    ctx.entities.push(victim);

    const attacker = makeEntity(UnitType.I_E1, House.Greece, 19 * CELL_SIZE, 65 * CELL_SIZE);
    damageEntity(ctx, victim, 15, 'SA', attacker);

    expect(team.targetEntityRef).toBe(attacker);
    expect(victim.target).toBeNull();
    // Mission/timer preserved — no Commence cycle, no Mission_Move jitter RNG.
    expect(victim.mission).toBe(Mission.MOVE);
    expect(victim.missionTimer).toBe(8);
  });

  it('team member with pre-existing valid target is untouched (C++ team.cpp:1596-1604)', () => {
    // Sanity: even the pre-existing "don't steal a valid target" guard still
    // applies. The teamRef short-circuit runs after it (line order in
    // triggerRetaliation), but the outcome for this case is the same — no change.
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.I_E1, House.BadGuy, 100, 100);
    victim.mission = Mission.ATTACK;
    const team = makeMovingTeam(victim);
    const existingTarget = makeEntity(UnitType.I_E1, House.Greece, 200, 100);
    victim.target = existingTarget;

    const attacker = makeEntity(UnitType.I_E1, House.Greece, 150, 150);
    triggerRetaliation(ctx, victim, attacker);

    expect(victim.target).toBe(existingTarget);
    expect(team.targetEntityRef).toBe(attacker);
  });
});
