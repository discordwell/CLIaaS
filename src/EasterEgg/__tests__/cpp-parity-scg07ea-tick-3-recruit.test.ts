/**
 * C++ Parity: SCG07EA tick 3 CREATE_TEAM Recruit cadence (subz vessel team)
 *
 * At SCG07EA tick 1, trigger `subz` (TEVENT_TIME=0) fires TACTION_CREATE_TEAM
 * and creates team `subz` (BadGuy, SS:3, origin=waypoint 13). WASM observation
 * shows the following Team state timeline:
 *
 *   tick 1 end: total=0  (team exists, no members recruited yet)
 *   tick 2 end: total=1  (Recruit adds one SS — the closest BadGuy SS to WP13)
 *   tick 3 end: total=3  (Recruit adds two more SS via VESSEL inside-loop Add)
 *   tick 4     : Percent_Chance(50) activation fires, IsMoving=true
 *
 * Before this fix, TS followed a different cadence:
 *
 *   tick 1 end: total=1  (Team::AI runs on the creation tick, recruits 1)
 *   tick 2 end: total=3  (Recruit adds 2 more — reaches full strength)
 *   tick 3     : Percent_Chance fires 1 tick EARLY
 *
 * The divergence surfaced as an extra `TeamAI` RNG call at tick 3 (stag=1)
 * in TS that WASM didn't fire until tick 4. First-divergence test pinned
 * SCG07EA at tick 3.
 *
 * C++ source refs:
 *   - team.cpp:1288-1322  — VESSEL Recruit inside-loop `if (best) { Add(best); }`
 *   - team.cpp:1250-1286  — UNIT Recruit inside-loop (same pattern, different iter)
 *   - team.cpp:1202-1224  — INFANTRY Recruit outside-loop `if (best)` (adds 1 max)
 *   - team.cpp:627-652    — Activation: Percent_Chance(50) when IsFullStrength
 *   - team.cpp:666-673    — Recruit dispatch in TeamClass::AI
 *   - taction.cpp:658-661 — TACTION_CREATE_TEAM: ScenarioInit++ → Create_One_Of
 *   - logic.cpp:214-271   — LogicTrigger pre-pass then Teams AI loop
 *
 * Compared behaviors:
 *   (a) subz (SS:3 VESSEL, origin=13) — tick 1 skipped by skipFirstAiCall
 *   (b) sov1 (E1:1 INFANTRY, SCG03EA, origin=1) — tick 1 recruits immediately
 *   (c) mmth1 (4TNK:2 UNIT, SCG11EA, origin=-1) — tick 1 recruits both immediately
 *
 * The rule in TS (index.ts TACTION_CREATE_TEAM branch):
 *   skipFirstAiCall = teamType.members.some(m => isVesselType(m.type))
 *
 * A deeper C++ analysis would identify the exact mechanism that causes WASM
 * VESSEL Recruit to yield 0 members on the creation tick — currently the TS
 * heuristic is calibrated against observed WASM state dumps (see
 * `scripts/test-scg07-subz-wasm-trace.ts` and `scripts/test-scg11-mmth1-trace.ts`).
 * The tests below pin the TS-side cadence matching WASM.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { House, UnitType } from '../engine/types';
import {
  Team,
  TMISSION_ATT_WAYPT,
  clearAllTeams,
  registerTeam,
  resetTeamIds,
} from '../engine/team';

beforeEach(() => {
  resetEntityIds();
  resetTeamIds();
  clearAllTeams();
});

describe('SCG07EA subz VESSEL CREATE_TEAM cadence — skipFirstAiCall delays recruit by 1 tick', () => {
  it('vessel team with skipFirstAiCall skips its first ai() entirely (total stays 0)', () => {
    // Three BadGuy SSes in the world (like SCG07EA BadGuy submarines near WP13)
    const ss1 = new Entity(UnitType.V_SS, House.BadGuy, 101 * 24 + 12, 50 * 24 + 12);
    const ss2 = new Entity(UnitType.V_SS, House.BadGuy, 99 * 24 + 12, 51 * 24 + 12);
    const ss3 = new Entity(UnitType.V_SS, House.BadGuy, 99 * 24 + 12, 48 * 24 + 12);
    const entities = [ss1, ss2, ss3];

    const team = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: 'SS', count: 3 }],
      missionList: [{ mission: TMISSION_ATT_WAYPT, data: 42 }],
      origin: { x: 100 * 24 + 12, y: 49 * 24 + 12 }, // WP13
      skipFirstAiCall: true,
    });
    registerTeam(team);

    // Tick 1: skipFirstAiCall gates the ai() call entirely.
    team.ai(undefined, { entities });
    expect(team.total, 'tick 1 must be empty — C++ Teams loop effectively skipped').toBe(0);
    expect(team.isFullStrength).toBe(false);
    expect(team.isMoving).toBe(false);
  });

  it('vessel team recruits 1 on tick 2 (closest SS wins bestdist, no subsequent improvement)', () => {
    const ss1 = new Entity(UnitType.V_SS, House.BadGuy, 101 * 24 + 12, 50 * 24 + 12);
    const ss2 = new Entity(UnitType.V_SS, House.BadGuy, 99 * 24 + 12, 51 * 24 + 12);
    const ss3 = new Entity(UnitType.V_SS, House.BadGuy, 99 * 24 + 12, 48 * 24 + 12);
    const entities = [ss1, ss2, ss3];

    const team = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: 'SS', count: 3 }],
      missionList: [{ mission: TMISSION_ATT_WAYPT, data: 42 }],
      origin: { x: 100 * 24 + 12, y: 49 * 24 + 12 },
      skipFirstAiCall: true,
    });
    registerTeam(team);

    team.ai(undefined, { entities });               // tick 1 — skipped
    team.ai(undefined, { entities });               // tick 2 — recruit
    // C++ VESSEL Recruit inside-loop: the closest SS (ss1 @ dist √2) wins best
    // first; ss2 (dist √5) does not improve bestdist; ss3 (dist √2) TIES and
    // `d < bestdist` is strict, so ss3 does NOT beat ss1 either. Single Add.
    expect(team.total, 'tick 2 must recruit exactly one SS').toBe(1);
    expect(team.isFullStrength).toBe(false);
  });

  it('vessel team reaches full strength on tick 3 and activates on tick 4', () => {
    const ss1 = new Entity(UnitType.V_SS, House.BadGuy, 101 * 24 + 12, 50 * 24 + 12);
    const ss2 = new Entity(UnitType.V_SS, House.BadGuy, 99 * 24 + 12, 51 * 24 + 12);
    const ss3 = new Entity(UnitType.V_SS, House.BadGuy, 99 * 24 + 12, 48 * 24 + 12);
    const entities = [ss1, ss2, ss3];

    const team = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: 'SS', count: 3 }],
      missionList: [{ mission: TMISSION_ATT_WAYPT, data: 42 }],
      origin: { x: 100 * 24 + 12, y: 49 * 24 + 12 },
      skipFirstAiCall: true,
    });
    registerTeam(team);

    team.ai(undefined, { entities }); // tick 1 — skipped
    team.ai(undefined, { entities }); // tick 2 — total=1
    team.ai(undefined, { entities }); // tick 3 — recruit 2 more
    // Tick 3 Recruit: ss1 is already a member (Can_Add false). ss2 qualifies
    // first (bestdist==-1 → best=ss2, Add). ss3 is closer than ss2 → best=ss3,
    // Add. Total now 3. isFullStrength flips true on composition check at
    // start of tick 4.
    expect(team.total, 'tick 3 must reach full strength').toBe(3);
    expect(team.isMoving, 'tick 3 — activation not yet — isAltered flag still pending').toBe(false);

    team.ai(undefined, { entities }); // tick 4 — composition check → fs=true → activate
    expect(team.isFullStrength).toBe(true);
    expect(team.isMoving, 'tick 4 — Percent_Chance activates team').toBe(true);
  });
});

describe('SCG03EA sov1 INFANTRY CREATE_TEAM cadence — no skipFirstAiCall, recruits on tick 1', () => {
  it('infantry team WITHOUT skipFirstAiCall reaches full strength on tick 1 (desired=1)', () => {
    const e1 = new Entity(UnitType.I_E1, House.USSR, 40 * 24 + 12, 30 * 24 + 12);
    const entities = [e1];

    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: 'E1', count: 1 }],
      missionList: [{ mission: TMISSION_ATT_WAYPT, data: 1 }],
      origin: { x: 40 * 24 + 12, y: 30 * 24 + 12 },
      skipFirstAiCall: false, // INFANTRY member — no skip
    });
    registerTeam(team);

    team.ai(undefined, { entities }); // tick 1 — recruit E1
    expect(team.total, 'tick 1 INFANTRY recruit adds 1 (outside-loop Add)').toBe(1);

    team.ai(undefined, { entities }); // tick 2 — composition + activation
    expect(team.isFullStrength).toBe(true);
    expect(team.isMoving).toBe(true);
  });
});

describe('SCG11EA mmth1 UNIT CREATE_TEAM cadence — no skipFirstAiCall, recruits on tick 1', () => {
  it('unit team WITHOUT skipFirstAiCall reaches full strength on tick 1 (4TNK:2)', () => {
    // 4TNK positions — WASM observes mmth1 tick 1 has 2 members (4TNK:2 full).
    // With origin=-1 (mmth1 has no waypoint), C++ center = As_Coord(TARGET_NONE) = 0.
    // Distance from (0,0): positions further out produce monotonically closer
    // distances as iteration finds closer candidates — allowing multiple Adds.
    const t1 = new Entity(UnitType.V_4TNK, House.USSR, 80 * 24 + 12, 80 * 24 + 12);
    const t2 = new Entity(UnitType.V_4TNK, House.USSR, 50 * 24 + 12, 50 * 24 + 12);
    const entities = [t1, t2];

    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: '4TNK', count: 2 }],
      missionList: [{ mission: TMISSION_ATT_WAYPT, data: 1 }],
      origin: null, // origin=-1 → no waypoint
      skipFirstAiCall: false, // UNIT member — no skip
    });
    registerTeam(team);

    team.ai(undefined, { entities }); // tick 1 — recruit both via inside-loop Add
    expect(team.total, 'tick 1 UNIT recruit with origin=null and descending dist should add both').toBe(2);
  });
});

describe('skipFirstAiCall semantics — one-shot flag that clears after first ai() call', () => {
  it('flag clears after first skipped call — subsequent ai() calls process normally', () => {
    const ss = new Entity(UnitType.V_SS, House.BadGuy, 100 * 24 + 12, 49 * 24 + 12);
    const entities = [ss];

    const team = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: 'SS', count: 1 }],
      missionList: [{ mission: TMISSION_ATT_WAYPT, data: 0 }],
      origin: { x: 100 * 24 + 12, y: 49 * 24 + 12 },
      skipFirstAiCall: true,
    });
    registerTeam(team);

    team.ai(undefined, { entities });
    expect(team.total).toBe(0); // first call skipped

    team.ai(undefined, { entities });
    expect(team.total, 'second call recruits normally').toBe(1);
  });
});
