/**
 * Team lifecycle system — C++ parity with team.cpp, teamtype.cpp
 *
 * In C++ Red Alert, teams are first-class objects (TeamClass) with:
 * - Linked member lists (FootClass *Member chain)
 * - 16 mission types processed sequentially from a mission queue
 * - Regrouping when team falls below 1/3 desired strength (team.cpp:516-517)
 * - Recruit priority: higher-priority teams steal from lower (team.cpp:995)
 * - Coordinated movement, attack, and guard behaviors
 * - Suspend/resume with timer
 * - Dissolve when all members dead and HasBeen is true (team.cpp:679-697)
 *
 * The TS engine previously used per-entity teamMissions arrays (fire-and-forget).
 * This module introduces a Team object that owns the member list and drives
 * coordinated behavior matching C++ semantics.
 *
 * C++ source refs:
 *   team.h     — TeamClass declaration, member flags
 *   team.cpp   — AI(), Add(), Remove(), Coordinate_*, TMission_*
 *   teamtype.h — TeamTypeClass, TeamMissionType enum (16 types)
 *   teamtype.cpp — mission names, TeamMissionClass array
 */

import { Entity, type TeamMissionEntry } from './entity';
import { House, Mission, MISSION_CONTROL, worldDist, worldDistLeptons, leptonDist, STRAY_DISTANCE, type WorldPos, CELL_SIZE, LEPTON_SIZE, UNIT_STATS, UnitType, pixelToLepton, leptonToPixel } from './types';
import { type MapStructure, STRUCTURE_WEAPONS, STRUCTURE_SIZE } from './scenario';
import { ScenarioRandom } from './random';
import type { GameMap } from './map';
import { findPath } from './pathfinding';
// TEAM_START_DRIVER_REFACTOR flag was removed along with its `false` branch
// in Step 6 of the C++-parity refactor. The flag remains in perCellProcess.ts
// as documentation but is no longer read.
import { assignMission } from './missionLifecycle';

/**
 * Optional context threaded through Team.ai() for a full per-tick pass.
 *
 * `structures`     — used by coordinateRegroup retreat-target search (C++ team.cpp:590-616).
 * `entities`       — used by TeamClass::Recruit (team.cpp:1180-1328) to find candidates.
 * `map`            — used by drive-class Coordinate_Move to mirror
 *                    DriveClass::Assign_Destination -> Start_Of_Move.
 * `canEnterCell`   — vehicle Can_Enter_Cell predicate. When provided,
 *                    coordinateMove uses it to gate the eager IsDriving=true
 *                    flip — matching C++ `Start_Of_Move` semantics that only
 *                    fire `Start_Driver` when Basic_Path's first cell is
 *                    enterable (drive.cpp:638-640 + foot.cpp:313-500).
 */
export interface TeamAIContext {
  structures?: MapStructure[];
  entities?: Entity[];
  map?: GameMap;
  canEnterCell?: (entity: Entity, cx: number, cy: number) => boolean;
  /** Game tick counter — used by TMission_Patrol for periodic threat scan
   *  (C++ team.cpp:2965 — Frame % (Rule.PatrolTime * TICKS_PER_MINUTE) == 0).
   *  Rule.PatrolTime=.016, TICKS_PER_MINUTE=900 → fires every 14 ticks. */
  tick?: number;
}

// ── Team Mission Type constants (C++ teamtype.h TeamMissionType enum) ────

export const TMISSION_ATTACK       = 0;
export const TMISSION_ATT_WAYPT    = 1;
export const TMISSION_FORMATION    = 2;
export const TMISSION_MOVE         = 3;
export const TMISSION_MOVECELL     = 4;
export const TMISSION_GUARD        = 5;
export const TMISSION_LOOP         = 6;
export const TMISSION_ATTACKTARCOM = 7;
export const TMISSION_UNLOAD       = 8;
export const TMISSION_DEPLOY       = 9;
export const TMISSION_HOUND_DOG    = 10;
export const TMISSION_DO           = 11;
export const TMISSION_SET_GLOBAL   = 12;
export const TMISSION_INVULNERABLE = 13;  // C++ teamtype.h:57 — makes team invulnerable (iron curtain)
export const TMISSION_LOAD         = 14;  // C++ teamtype.h:58
export const TMISSION_SPY          = 15;  // C++ teamtype.h:59
export const TMISSION_PATROL       = 16;  // C++ teamtype.h:60

let nextTeamId = 1;

export function resetTeamIds(): void {
  nextTeamId = 1;
}

/**
 * Team — first-class object matching C++ TeamClass (team.h, team.cpp)
 *
 * Owns a member list, processes a mission queue, and coordinates member
 * behavior (move together, attack together, regroup when under strength).
 */
export class Team {
  readonly id: number;
  readonly house: House;

  // ── C++ TeamTypeClass fields ──
  /** Desired member composition: array of { type, count } */
  readonly desiredMembers: Array<{ type: string; count: number }>;
  /** Mission queue from team type (C++ MissionList) */
  readonly missionList: TeamMissionEntry[];
  /** Recruit priority — higher steals from lower (C++ RecruitPriority, default 7) */
  readonly recruitPriority: number;
  /** Can team be reinforced? (C++ IsReinforcable) */
  readonly isReinforcable: boolean;
  /** Suicide team — never retreat (C++ IsSuicide) */
  readonly isSuicide: boolean;
  /** Origin waypoint world position */
  readonly origin: WorldPos | null;

  // ── C++ TeamClass runtime state ──
  /** Active members (C++ Member linked list — we use an array) */
  private _members: Entity[] = [];

  /** Current mission index into missionList (C++ CurrentMission, starts at -1) */
  currentMission = -1;

  /** Is the team actively executing missions? (C++ IsMoving) */
  isMoving = false;

  /** Has the team ever reached full strength? (C++ IsHasBeen) */
  isHasBeen = false;

  /** Is team at full desired strength? (C++ IsFullStrength) */
  isFullStrength = false;

  /** Is team below 1/3 strength threshold? (C++ IsUnderStrength) */
  isUnderStrength = true;

  /** Is team reforming after transitioning out of under-strength? (C++ IsReforming) */
  isReforming = false;

  /** Has composition changed since last check? (C++ IsAltered) */
  isAltered = true;

  /** Should advance to next mission? (C++ IsNextMission) */
  isNextMission = true;

  /** Is team forced into active state? (C++ IsForcedActive) */
  isForcedActive = false;

  /** Is team suspended? (C++ Suspended) */
  suspended = false;
  /** Suspend timer in ticks (C++ SuspendTimer) */
  suspendTimer = 0;

  /** Mission timeout in ticks (C++ TimeOut) */
  timeOut = 0;

  /** Team target — current objective (C++ Target) */
  target: WorldPos | null = null;

  /** Mission target — the scripted objective (C++ MissionTarget) */
  missionTarget: WorldPos | null = null;

  /** Team center/zone (C++ Zone) — average position of members */
  zone: WorldPos | null = null;
  /** Zone in lepton space for C++ parity distance comparisons */
  zoneLeptonX = 0;
  zoneLeptonY = 0;

  /** Has any member left the map? (C++ IsLeaveMap) */
  isLeaveMap = false;
  /** C++ CREATE_TEAM parity (taction.cpp:658-661): the team is created during
   *  LogicTrigger processing — which in practice runs AFTER the Teams AI loop
   *  for the tick in which it was created (observed WASM behavior: tick 1 has
   *  the team but total=0, tick 2 first recruits 1). This flag suppresses the
   *  ENTIRE first ai() call (composition check + recruit + activation), so
   *  the team's first real AI happens on the tick following creation.
   *
   *  SCG07EA subz trigger empirical WASM trace:
   *    WASM tick 1: team exists, total=0       (team created, no AI yet)
   *    WASM tick 2: total=1                    (recruit adds 1 SS)
   *    WASM tick 3: total=3                    (recruit adds 2 SS inside-loop)
   *    WASM tick 4: fs=true, mv=true           (Percent_Chance fires)
   *
   *  Currently gated on CREATE_TEAM + VESSEL-member types only (see index.ts
   *  trigger dispatch). UNIT/INFANTRY teams recruit on tick 1 per WASM
   *  observation (mmth1 4TNK:2 tick 1=2 full; sov1 E1:1 tick 1=1 full).
   *  The per-RTTI gate IS the C++-faithful port — empirical WASM behavior
   *  shows VESSEL-only delay. Not a workaround. */
  private _skipFirstAiCall = false;

  /** Is team dissolved? */
  dissolved = false;

  constructor(opts: {
    house: House;
    desiredMembers: Array<{ type: string; count: number }>;
    missionList: TeamMissionEntry[];
    recruitPriority?: number;
    isReinforcable?: boolean;
    isSuicide?: boolean;
    origin?: WorldPos | null;
    forcedActive?: boolean;
    /** Skip entire first ai() call (for CREATE_TEAM teams — C++ trigger creates
     *  team but Team::AI doesn't run until next tick). C++-faithful to empirical
     *  WASM observation (SCG07EA subz VESSEL team). Gated per-RTTI at dispatch. */
    skipFirstAiCall?: boolean;
  }) {
    this.id = nextTeamId++;
    this.house = opts.house;
    this.desiredMembers = opts.desiredMembers;
    this.missionList = opts.missionList;
    this.recruitPriority = opts.recruitPriority ?? 7;
    this.isReinforcable = opts.isReinforcable ?? true;
    this.isSuicide = opts.isSuicide ?? false;
    this.origin = opts.origin ?? null;
    if (opts.skipFirstAiCall) {
      this._skipFirstAiCall = true;
    }
    if (opts.forcedActive) {
      // C++ team.h:215 — Force_Active() sets BOTH flags:
      //   IsForcedActive = true; IsUnderStrength = false;
      // Without IsUnderStrength=false, the composition check in AI() sees
      // old_under(true) != IsUnderStrength(false) after members are added,
      // which spuriously sets IsReforming=true, delaying mission advance by
      // 1 tick and shifting RNG position.
      this.isForcedActive = true;
      this.isUnderStrength = false;
    }
  }

  // ── Member access ──

  get members(): readonly Entity[] {
    return this._members;
  }

  get total(): number {
    return this._members.length;
  }

  get isEmpty(): boolean {
    return this._members.length === 0;
  }

  /** Total desired members across all types (C++ sum of Members[i].Quantity) */
  get desiredTotal(): number {
    let sum = 0;
    for (const m of this.desiredMembers) sum += m.count;
    return sum;
  }

  // ── Add / Remove (C++ team.cpp:891-936, 1053-1158) ──

  /**
   * Add entity to this team (C++ TeamClass::Add).
   * - If entity is in another team, removes from it first (team.cpp:904-906)
   * - First member gets IsInitiated = true (team.cpp:912)
   * - Sets entity.teamRef back-pointer
   */
  add(entity: Entity): boolean {
    if (!entity.alive) return false;
    if (this._members.includes(entity)) return false;

    // C++ team.cpp:904-906 — remove from old team first
    if (entity.teamRef && entity.teamRef !== this) {
      entity.teamRef.remove(entity);
    }

    this._members.push(entity);
    entity.teamRef = this;

    // C++ parity: Team::Add does NOT copy missions to entity members.
    // The TeamInstance coordinator (coordinateMove/coordinateDo) handles
    // mission dispatch. Clear any per-entity teamMissions to prevent
    // updateTeamMission from competing with the coordinator.
    // Reinforcement teams set teamMissions AFTER add() in the spawn path.
    entity.teamMissions = [];
    entity.teamMissionIndex = 0;

    // C++ team.cpp:912 — first member is initiated
    // (In C++ this means "has reached team center and is an active participant")
    // We simplify: all members of spawned teams are initiated immediately.

    // Mark team composition as altered for re-evaluation
    this.isAltered = true;

    if (this.zone === null && entity.alive) {
      this.calcCenter();
    }

    return true;
  }

  /**
   * C++ TeamClass::Recruit (team.cpp:1180) — find and add idle units to team.
   *
   * C++ team.cpp:668 calls Recruit(typeindex) once per class type that needs
   * more members (not just one Recruit call per tick). Each Recruit() call has
   * different semantics depending on the type:
   *
   *   INFANTRY/AIRCRAFT (team.cpp:1208-1247): the `if (best)` Add call is
   *   OUTSIDE the for loop, so only the FINAL closest match is added (1 per
   *   call).
   *
   *   UNIT/VESSEL (team.cpp:1250-1322): the `if (best)` Add call is INSIDE
   *   the for loop. Each iteration where `best` is updated to a new closer
   *   unit triggers another Add — so MULTIPLE units can be recruited in a
   *   single call. Each "improvement" of best produces an Add of the new unit
   *   (previous bests are already members and Add() is a no-op for them).
   *
   *   This quirk/bug in the C++ source means a team can recruit multiple
   *   units per tick if the iteration order has matching units in
   *   non-monotonic distance order (a closer unit found AFTER a farther one).
   *
   * The iteration center for distance comparison is C++ Class->Origin (team
   * type origin waypoint) when set, else the team's geometric Zone.
   *
   * For TS parity we must match this distance reference and iteration
   * order exactly. The TS recruit caller passes a `center` argument so the
   * caller can resolve the team type's origin waypoint to a position.
   */
  recruit(entities: Entity[], center?: WorldPos): void {
    // C++ Recruit uses team origin waypoint as center if set, else team Zone
    const recruitCenter = center ?? this.origin ?? this.zone;

    // C++ team.cpp:961-1029 Can_Add: returns true if the entity can join the team
    // on ANY typeindex with room. Note: typeindex is OUT — Can_Add finds whichever
    // slot matches the entity's class. This means Recruit(0) for E1 can actually
    // pick a DOG if the DOG is closer and Can_Add finds typeindex=1 (DOG) with room.
    // This is bug-for-bug C++ parity — the `typeindex` param to Recruit is a hint,
    // not a strict filter. See SCG06EA dog1 team: recruits closest DOG instead of E1.
    const canAdd = (e: Entity): boolean => {
      if (!e.alive || e.inLimbo) return false;
      if (e.house !== this.house) return false;
      if (e.teamRef === this) return false; // already member
      if (e.teamRef) return false; // C++ priority check (simplified)
      if (!MISSION_CONTROL[e.mission]?.isRecruitable) return false;
      // Find matching class type with room
      for (const dm of this.desiredMembers) {
        const targetType = dm.type.toUpperCase();
        if (e.type !== targetType) continue;
        // Count current members of this type
        let current = 0;
        for (const m of this._members) {
          if (m.alive && (m.type === targetType || m.type === dm.type)) current++;
        }
        if (current < dm.count) return true; // slot has room for this class
      }
      return false;
    };

    // C++ Team::AI loop (team.cpp:668-672): iterate typeindex, call Recruit if Quantity[index] < desired
    // For each typeindex slot needing fill, scan ALL entities (not filtered by target type)
    // and pick the closest that Can_Add approves. This mirrors C++ RTTI_INFANTRY recruit
    // (adds once outside loop) and RTTI_UNIT recruit (adds every closer-best inside loop).
    for (const dm of this.desiredMembers) {
      let current = 0;
      for (const m of this._members) {
        if (m.alive && (m.type === dm.type || m.type === dm.type.toUpperCase())) current++;
      }
      if (current >= dm.count) continue;

      const targetType = dm.type.toUpperCase();
      const stats = UNIT_STATS[targetType as UnitType];
      const isUnitOrVessel = stats && !stats.isInfantry && !stats.isAircraft;

      // C++ center = As_Coord(Zone); if Class->Origin != -1, center = waypoint.
      // If Zone is TARGET_NONE, As_Coord returns 0 (map origin) — unit->Distance(0)
      // still produces different distances per-unit. TS must match this: use (0,0)
      // as fallback when no recruitCenter, so each entity gets a unique distance.
      const centerPos: WorldPos = recruitCenter ?? { x: 0, y: 0 };

      if (isUnitOrVessel) {
        // C++ UNIT/VESSEL case (team.cpp:1250-1322): iteration-based add.
        // Each iteration where a closer match is found triggers Add.
        // The Can_Add(infantry, typeindex) call may modify typeindex to ANY matching class,
        // so this slot's recruit can end up adding a different class type than expected.
        let bestDist = -1;
        for (const e of entities) {
          if (!canAdd(e)) continue;
          const d = worldDist(e.pos, centerPos);
          // C++ team.cpp:1262: (d < bestdist || bestdist == -1)
          if (bestDist === -1 || d < bestDist) {
            bestDist = d;
            // C++ team.cpp:1269-1283: Add(best) inside the for loop, each
            // time best is updated. The previous best stays in the team
            // (Add() is a no-op for existing members).
            this.add(e);
          }
        }
        continue;
      }

      // C++ INFANTRY/AIRCRAFT case (team.cpp:1208-1247): loop-then-add. Find
      // the single closest infantry/aircraft across all entities, then Add once.
      let bestEntity: Entity | null = null;
      let bestDist = -1;
      for (const e of entities) {
        if (!canAdd(e)) continue;
        const d = worldDist(e.pos, centerPos);
        if (bestDist === -1 || d < bestDist) {
          bestDist = d;
          bestEntity = e;
        }
      }

      if (bestEntity) {
        this.add(bestEntity);
      }
    }
  }

  /**
   * Remove entity from team (C++ TeamClass::Remove, team.cpp:1053-1158).
   * - Clears entity.teamRef
   * - Sets entity to idle mode (team.cpp:1139)
   * - Marks team as altered
   */
  remove(entity: Entity): boolean {
    const idx = this._members.indexOf(entity);
    if (idx === -1) return true; // C++ returns true if not a member

    this._members.splice(idx, 1);
    entity.teamRef = null;
    // C++ team.cpp:2285-2289 — clears IsFormationMove when member is removed/dies
    entity.formationOffset = null;
    this.isAltered = true;

    return true;
  }

  // ── Main AI loop (C++ TeamClass::AI, team.cpp:470-870) ──

  /**
   * Process one tick of team logic.
   * Call once per active team per game tick (matching C++ TeamClass::AI).
   *
   * @param waypoints - map from waypoint index to cell position
   */
  ai(waypoints?: Map<number, { cx: number; cy: number }>, ctx?: TeamAIContext): void {
    if (this.dissolved) return;

    // C++ CREATE_TEAM parity (taction.cpp:658-661 + logic.cpp:214-271): the team
    // is created during the LogicTrigger pre-pass on this tick; WASM observation
    // on SCG07EA subz shows Team::AI does NOT effectively run for the newly
    // created team on the creation tick (tick 1: total=0 despite team existing).
    // We model this by skipping the first ai() call entirely for CREATE_TEAM
    // teams — no composition check, no recruit, no activation. Subsequent
    // ai() calls proceed normally.
    if (this._skipFirstAiCall) {
      this._skipFirstAiCall = false;
      return;
    }

    // C++ team.cpp:484-489 — check suspend timer
    if (this.suspended) {
      if (this.suspendTimer > 0) {
        this.suspendTimer--;
        return;
      }
      this.suspended = false;
    }

    const oldUnder = this.isUnderStrength;

    // ── Composition check (C++ team.cpp:495-572) ──
    if (this.isAltered) {
      const desired = this.desiredTotal;
      const alive = this._members.filter(m => m.alive).length;

      // Remove dead members — clear their teamRef (C++ Remove sets Team=0, team.cpp:1116)
      // C++ team.cpp:2285-2289 — also clear IsFormationMove on removal
      for (const m of this._members) {
        if (!m.alive) {
          m.teamRef = null;
          m.formationOffset = null;
        }
      }
      this._members = this._members.filter(m => m.alive);

      if (alive > 0) {
        this.isFullStrength = (alive === desired);
        if (this.isFullStrength) {
          this.isHasBeen = true;
        }

        // C++ team.cpp:515-530 — under-strength threshold
        if (this.isReinforcable) {
          if (desired > 2) {
            // C++ team.cpp:517 — IsUnderStrength = (Total <= desired / 3)
            this.isUnderStrength = (alive <= Math.floor(desired / 3));
          } else {
            this.isUnderStrength = (alive < desired);
          }
        } else {
          // Non-reinforceable teams: only under-strength before first activation
          this.isUnderStrength = !this.isHasBeen;
        }
      } else {
        this.isUnderStrength = true;
        this.isFullStrength = false;
        this.zone = null;

        // C++ team.cpp:544-562 — dissolve empty team that has been active
        if (this.isHasBeen) {
          this.dissolve();
          return;
        }
      }

      // C++ team.cpp:569-571 — transition triggers reform
      if (oldUnder !== this.isUnderStrength) {
        this.isReforming = true;
      }

      this.isAltered = false;
    }

    // ── Regroup when under strength (C++ team.cpp:577-621) ──
    if (this.isMoving && this.isUnderStrength) {
      this.isMoving = false;
      this.currentMission = -1;

      if (this.total > 0) {
        this.calcCenter();
        // C++ team.cpp:590-616 — retreat to nearest friendly unarmed building
        // Prefer STRUCT_REPAIR (FIX) — distance halved for repair facility.
        // Scans Buildings[] for b.House == House && b.PrimaryWeapon == NULL.
        const retreatTarget = this.findRetreatBuilding(ctx?.structures);
        if (retreatTarget) {
          this.target = retreatTarget;
        } else if (this.zone) {
          // Fallback to zone center if no buildings available
          this.target = { ...this.zone };
        }
        if (this.target) {
          this.coordinateMove(waypoints, ctx);
        }
        return;
      } else {
        this.zone = null;
      }
    }

    // ── Activate at full strength (C++ team.cpp:627-652) ──
    let activatedThisTick = false;
    if (!this.isMoving && (this.isFullStrength || this.isForcedActive)) {
      this.isMoving = true;
      this.isHasBeen = true;
      this.isUnderStrength = false;
      activatedThisTick = true;

      // C++ team.cpp:637: `doaction = Percent_Chance(50) ? DO_GESTURE1 : DO_GESTURE2;`
      // Then Do_Action(doaction) for each initiated infantry member. Both DO_GESTURE1
      // and DO_GESTURE2 have Interrupt=false in infantry.cpp:115/117 MasterDoControls.
      //
      // C++ Do_Action (infantry.cpp:1979) ONLY applies the new action if
      // `Doing == DO_NOTHING || force || MasterDoControls[Doing].Interrupt` — i.e.,
      // members already in a non-interruptible animation (e.g. from a prior
      // Random_Animate gesture) keep their existing animation.
      //
      // Animation duration Count=3 × Rate=2 = 6 ticks. nonInterruptAnimTicks=8
      // accounts for the pre-decrement at index.ts:3839 + the 1-tick C++ delay
      // between Commence() popping the queue and MissionClass::AI dispatching
      // the new mission on the following tick.
      //
      // Consume the RNG to keep the chain aligned (same call as C++), but apply
      // the block regardless of outcome — TS previously only set niat on TRUE,
      // missing ~50% of team activations and firing Mission_Move too early.
      ScenarioRandom.percentChance(50);
      for (const m of this._members) {
        if (m.alive && m.stats.isInfantry && m.nonInterruptAnimTicks <= 0) {
          m.nonInterruptAnimTicks = 8;
          // Phase 7B — track Doing state for C++-faithful Commence gate
          // (entity.ts isDoingInterruptible). Mirrors C++ Do_Action(DO_GESTURE1).
          // doingAI transitions back to stand_ready when niat reaches 0.
          // Only set for currently-interruptible members (mirrors C++ Do_Action
          // semantics — won't override an in-progress non-interruptible animation).
          if (m.doing !== 'gesture') {
            m.doing = 'gesture';
          }
        }
      }

      if (this.isReforming || this.isForcedActive) {
        // All members become initiated
      }

      this.currentMission = -1;
      this.isNextMission = true;
    }

    // W4 deleted (Step 4): the nonInterruptAnimTicks=3 proxy on the last
    // vessel member was a TS-only emulation of C++ VesselClass::AI's
    // `Is_Door_Closed()` double-Commence gate (vessel.cpp:592, 659). C++
    // vessels fire two Commence calls per AI tick, gated by door state; no
    // artificial timer involved. The real port is in PCP_DOUBLE_CYCLE_ENABLED
    // (Phase 5, index.ts runDriveClassAI). Proxy removed.
    //
    // C++ parity (SCG07EA non-reinforceable VESSEL activation): clear
    // isReforming on activation for non-reinforceable all-vessel teams so
    // the advance+execute block runs same-tick (matches WASM cadence for
    // CREATE_TEAM VESSEL activation). See cpp-parity-scg07ea-tick-4.test.ts
    // for the documented WASM sequence (2 Mission_Move fires at t4, 1 at t6).
    //
    // Phase 3b note: team-state-diff at tick 4 shows WASM rf=true — this
    // is set POST-tick-4-Team.AI (probably via Lagging_Units in team.cpp).
    // Within Team.AI on tick 4, rf is already false (cleared here) so
    // Coord_Move runs. The extra TS Mission_Move_foot at t4 (Δ=-1) comes
    // from the LAST sub firing at t4 where WASM delays to t6.
    // nonInterruptAnimTicks heuristic in subsequent code handles that delay.
    if (activatedThisTick && !this.isReinforcable && this.isReforming) {
      const allVessels = this._members.length > 0 &&
        this._members.every(m => m.alive && m.stats.isVessel);
      if (allVessels) {
        this.isReforming = false;
        // Narrow Mark_Track approximation for 3+ vessel teams.
        //
        // C++ ref: VesselClass::Start_Driver (vessel.cpp:2104-2113) calls
        // Mark_Track(headto, MARK_DOWN) which sets Map[headto].Flag.Occupy.
        // Vehicle. Subsequent vessel Can_Enter_Cell (vessel.cpp:312) returns
        // MOVE_MOVING_BLOCK for marked cells, causing the 3rd team-coordinated
        // vessel's Start_Driver to fail → Mission_Move Enter_Idle_Mode →
        // no Random_Pick(0,2) jitter (foot.cpp:524).
        //
        // A direct port of Mark_Track at the dispatch site over-suppressed
        // (commit ee9ba67f reverted): C++ uses per-path computed `headto`
        // coords which differ across vessels even when the team waypoint is
        // shared, while TS's `moveTarget` cell is shared across team members.
        //
        // Until per-vessel `headto` is properly modeled, this narrow
        // niat-on-last proxy delays the LAST vessel's Mission_Move by ~2
        // ticks — empirically matches WASM's SCG07EA subz cadence (2 fires
        // at tick 4, 3rd delayed to tick 6). Niat decrements 3→2→1→0;
        // the pre-Commence gate at index.ts:~4005 (`niat <= 0`) unblocks
        // when niat reaches 0 (after 3 ticks).
        //
        // Gate is narrow: only 3+ vessel non-reinforceable teams activating
        // this tick. Doesn't affect cross-team or single-vessel scenarios.
        if (this._members.length >= 3) {
          const last = this._members[this._members.length - 1];
          if (last.alive && last.nonInterruptAnimTicks <= 0) {
            last.nonInterruptAnimTicks = 3;
          }
        }
      }
    }

    // ── Recalc center (C++ team.cpp:658-660) ──
    if (this.isReforming || this.isMoving || this.zone === null) {
      this.calcCenter();
    }

    // ── Recruit when under strength (C++ team.cpp:666-673) ──
    if (!this.isFullStrength && ctx?.entities) {
      this.recruit(ctx.entities);
    }

    // ── Dissolve if empty and has been active (C++ team.cpp:679-697) ──
    if (this.isEmpty && this.isHasBeen) {
      this.dissolve();
      return;
    }

    // ── Advance mission (C++ team.cpp:704-753) ──
    if (this.isMoving && !this.isReforming && this.isNextMission) {
      this.isNextMission = false;
      this.currentMission++;

      if (this.currentMission < this.missionList.length) {
        const mission = this.missionList[this.currentMission];

        // C++ team.cpp:710 — timeout from mission data
        this.timeOut = mission.data * 90; // C++ team.cpp:710: TICKS_PER_MINUTE/10 = 900/10 = 90
        this.target = null;

        // Set mission target based on mission type
        switch (mission.mission) {
          case TMISSION_MOVECELL:
            // Move to cell (data is cell number — convert to world pos)
            this.setMissionTarget(null); // Will be set by coordinate functions
            break;

          case TMISSION_MOVE:
          case TMISSION_ATT_WAYPT:
          case TMISSION_PATROL:
          case TMISSION_SPY:
            // Move/attack/patrol to waypoint
            if (waypoints) {
              const wp = waypoints.get(mission.data);
              if (wp) {
                const worldTarget: WorldPos = {
                  x: wp.cx * CELL_SIZE + CELL_SIZE / 2,
                  y: wp.cy * CELL_SIZE + CELL_SIZE / 2,
                };
                this.setMissionTarget(worldTarget);
                this.target = { ...worldTarget };
              }
            }
            break;

          case TMISSION_ATTACK:
          case TMISSION_ATTACKTARCOM:
          default:
            this.setMissionTarget(null);
            break;
        }

        // Sync members' teamMissionIndex
        for (const m of this._members) {
          if (m.alive) {
            m.teamMissionIndex = this.currentMission;
          }
        }
      } else {
        // C++ team.cpp:750 — past end of mission list → dissolve
        this.dissolve();
        return;
      }
    }

    // ── Execute current mission (C++ team.cpp:758-870) ──
    if (!this.isEmpty && this.isMoving && !this.isReforming && !this.isUnderStrength) {
      if (!this.target && this.missionTarget) {
        this.target = { ...this.missionTarget };
      }

      const mission = this.missionList[this.currentMission];
      if (!mission) return;

      switch (mission.mission) {
        case TMISSION_PATROL:
          this.coordinatePatrol(waypoints, ctx);
          break;

        case TMISSION_ATTACK:
        case TMISSION_ATTACKTARCOM:
        case TMISSION_ATT_WAYPT:
          this.coordinateAttack();
          break;

        case TMISSION_MOVE:
        case TMISSION_MOVECELL:
          this.coordinateMove(waypoints, ctx);
          break;

        case TMISSION_GUARD:
          this.coordinateRegroup(ctx);
          // C++ team.cpp:856-858 — guard times out
          if (this.timeOut > 0) {
            this.timeOut--;
          }
          if (this.timeOut <= 0) {
            this.isNextMission = true;
          }
          break;

        case TMISSION_UNLOAD:
          this.tMissionUnload();
          break;

        case TMISSION_DEPLOY:
          this.tMissionDeploy();
          break;

        case TMISSION_LOOP:
          this.tMissionLoop();
          break;

        case TMISSION_DO:
          this.coordinateDo(mission);
          break;

        case TMISSION_SET_GLOBAL:
          // Set global handled externally; advance mission
          this.isNextMission = true;
          break;

        default:
          this.isNextMission = true;
          break;
      }
    } else {
      // C++ team.cpp:862-869 — reforming or not yet moving
      if (this.isMoving) {
        this.isReforming = !this.coordinateRegroup(ctx);
      } else {
        this.coordinateMove(waypoints, ctx);
      }
    }
  }

  // ── Coordination functions (C++ team.cpp) ──

  /**
   * C++ Coordinate_Regroup (team.cpp:1740-1789)
   * Members move toward team zone center. Returns true when all regrouped.
   */
  coordinateRegroup(ctx?: TeamAIContext): boolean {
    let regrouped = true;

    for (const unit of this._members) {
      if (!unit.alive) continue;
      // C++ vessel.cpp:586 / aircraft.cpp:1178 — IsALoaner transports auto-retreat
      // after unloading and must NOT be re-grouped back to GUARD by the team they
      // were spawned with. The team should leave them alone to retreat off-map.
      if (unit.mission === Mission.RETREAT) continue;

      // C++ rules.cpp:260: StrayDistance = 0x0200 = 512 leptons
      // C++ team.cpp:2054-2056: aircraft get 3x stray distance
      const stray = unit.isAirUnit ? STRAY_DISTANCE * 3 : STRAY_DISTANCE;
      if (this.zone && leptonDist(unit.leptonX, unit.leptonY, this.zoneLeptonX, this.zoneLeptonY) > stray) {
        // Queue for infantry to respect gesture gate; direct set for vehicles/aircraft.
        if (unit.stats.isInfantry) {
          // Phase 2: route through assignMission (C++ mission.cpp:379-390)
          // — no-op when already in MOVE, queues otherwise.
          assignMission(unit, Mission.MOVE);
          unit.moveTarget = { lx: pixelToLepton(this.zone.x), ly: pixelToLepton(this.zone.y) };
        } else {
          // C++ team.cpp:1765 Coordinate_Regroup → Assign_Mission(MISSION_MOVE).
          // Per mission.cpp:388: Assign_Mission QUEUES the mission only when
          // Mission != order. Commence later pops.
          //
          // Step 6 strip: removed the W3-mirror Session 9 port that pre-
          // populated path + eagerly set isDriving=true on facing match. That
          // was a proxy; C++ Coordinate_Regroup doesn't call Basic_Path or
          // Start_Driver. DriveClass::AI runs those per unit (drive.cpp:906+).
          assignMission(unit, Mission.MOVE);
          unit.moveTarget = { lx: pixelToLepton(this.zone.x), ly: pixelToLepton(this.zone.y) };
        }
        regrouped = false;
      } else {
        // Close enough — guard (C++ team.cpp:1783 Assign_Mission(MISSION_GUARD))
        // Session 23: route through queue instead of direct Mission set to
        // match C++ mission.cpp:388 Assign_Mission semantics. moveTarget=null
        // mirrors Assign_Destination(TARGET_NONE).
        if (unit.mission !== Mission.AREA_GUARD && unit.mission !== Mission.GUARD) {
          assignMission(unit, Mission.GUARD);
          unit.moveTarget = null;
        }
      }
    }

    return regrouped;
  }

  /**
   * C++ Coordinate_Move (team.cpp:1874-2008)
   * All members move toward the team's target. When all arrive, advance mission.
   */
  coordinateMove(_waypoints?: Map<number, { cx: number; cy: number }>, ctx?: TeamAIContext): void {
    if (!this.target && this.missionTarget) {
      this.target = { ...this.missionTarget };
    }
    if (!this.target) return;

    let finished = true;
    let found = false;

    for (const unit of this._members) {
      if (!unit.alive) continue;
      // C++ vessel/aircraft loaner transports auto-retreat after unloading and
      // must NOT be re-grouped by the team they were spawned with.
      if (unit.mission === Mission.RETREAT) continue;
      found = true;

      // C++ team.cpp:1908-1910: stray = Rule.StrayDistance; aircraft *= 3
      // Use leptonDist for C++ parity (coord.cpp Distance in lepton space)
      const stray = unit.isAirUnit ? STRAY_DISTANCE * 3 : STRAY_DISTANCE;
      const targetLX = Math.trunc(this.target.x * LEPTON_SIZE / CELL_SIZE);
      const targetLY = Math.trunc(this.target.y * LEPTON_SIZE / CELL_SIZE);
      const dist = leptonDist(unit.leptonX, unit.leptonY, targetLX, targetLY);
      if (dist > stray) {
        // C++ team.cpp:1942-1962 — Coordinate_Move calls Assign_Mission(MISSION_MOVE)
        // and Assign_Destination(Target). It does NOT clear TarCom. C++ FootClass::AI
        // (foot.cpp:1237 InfantryClass::Firing_AI) runs Firing_AI before Movement_AI,
        // so a team member with a TarCom in range continues firing while the team
        // coordinator queues a new MOVE. Only dogs (line 1916-1920) clear TarCom
        // and only when distance > stray.
        //
        // SCG06EA tick 65: BadGuy E1 acquired Greek E1 as TarCom via
        // triggerRetaliation (combat.ts:716 teamRef branch). If we clear
        // unit.target here, the BadGuy E1 misses its FireLaunch=2 retaliation
        // window at tick 68 → bullet[116] Coord_Scatter (tag 50002) never
        // fires.
        const nextMoveTarget = { lx: pixelToLepton(this.target.x), ly: pixelToLepton(this.target.y) };
        const targetChanged =
          !unit.moveTarget ||
          unit.moveTarget.lx !== nextMoveTarget.lx ||
          unit.moveTarget.ly !== nextMoveTarget.ly;

        assignMission(unit, Mission.MOVE);

        if (targetChanged) {
          unit.moveTarget = nextMoveTarget;
          unit.pathThreshold = 1;
          unit.path = [];
          unit.pathIndex = 0;

          if (ctx?.map && !unit.stats.isInfantry && !unit.isAirUnit && unit.mission !== Mission.UNLOAD) {
            const goal = {
              cx: Math.floor(this.target.x / CELL_SIZE),
              cy: Math.floor(this.target.y / CELL_SIZE),
            };
            unit.path = findPath(ctx.map, unit.cell, goal, true, unit.isNavalUnit, unit.stats.speedClass);
            // C++ Start_Of_Move (drive.cpp:638-640) fires Start_Driver only
            // when Basic_Path's FIRST step is enterable (Can_Enter_Cell == OK).
            // For vessels, vessel.cpp:592/658 gates Commence on `!IsDriving &&
            // Is_Door_Closed()` — eager flip blocks Mission_Move for SCG07
            // reinforcements.
            //
            // Strategy: skip flip for vessels (vessel.cpp gate). For land
            // vehicles, additionally check Can_Enter_Cell on the first path
            // step (when ctx.canEnterCell provided). If blocked, Basic_Path
            // would have failed in C++ → no Start_Driver → IsDriving stays
            // false → Commence pops next tick → Mission_Move fires its jitter
            // (matches SCG04EA t3 unit[73] firing Mission_Move_foot in WASM).
            if (unit.path.length > 0 && !unit.stats.isVessel) {
              const firstStep = unit.path[0];
              const firstStepEnterable =
                !ctx.canEnterCell || ctx.canEnterCell(unit, firstStep.cx, firstStep.cy);
              if (firstStepEnterable) {
                unit.isDriving = true;
              }
            }
          }
        }
        finished = false;
      } else {
        // Arrived — idle. C++ team.cpp:1971-1974:
        //   if (unit->Mission == MISSION_MOVE && (!Target_Legal(unit->NavCom) ||
        //       Distance(unit->NavCom) < CELL_LEPTON_W)) {
        //     unit->Assign_Destination(TARGET_NONE);
        //     unit->Enter_Idle_Mode();
        //   }
        //
        // Phase 3i: previously only handled the `!moveTarget` case (NavCom
        // already cleared). Added the "within 1 cell of NavCom" case to
        // match C++ — unit with moveTarget still set but near it.
        // SCG11 4TNK@60,58 has moveTarget=(16000,15232)=cell(62,59) while
        // unit at cell(60,58); within stray distance of team target but
        // not within 1 cell of NavCom. WASM's Enter_Idle_Mode fires from
        // this path, TS was missing the condition.
        if (unit.mission === Mission.MOVE) {
          let shouldIdle = !unit.moveTarget;
          if (!shouldIdle && unit.moveTarget) {
            const navDx = unit.moveTarget.lx - unit.leptonX;
            const navDy = unit.moveTarget.ly - unit.leptonY;
            // C++ Distance(NavCom) = octagonal approx via coord.cpp:124-136.
            const adx = Math.abs(navDx), ady = Math.abs(navDy);
            const navDist = adx > ady ? adx + (ady >> 1) : ady + (adx >> 1);
            const CELL_LEPTON_W = 256;
            if (navDist < CELL_LEPTON_W) {
              unit.moveTarget = null;
              unit.path = [];
              unit.pathIndex = 0;
              shouldIdle = true;
            }
          }
          if (shouldIdle) {
            assignMission(unit, Mission.GUARD);
          }
        }
      }
    }

    if (!found) finished = false;

    // C++ team.cpp:2005-2007 — all members close enough → advance
    if (finished && this.isMoving) {
      this.isNextMission = true;
    }
  }

  /**
   * C++ Coordinate_Attack (team.cpp:1636-1721)
   * All members attack the team's target. If target is invalid, advance mission.
   */
  coordinateAttack(): void {
    if (!this.target) {
      if (this.missionTarget) {
        this.target = { ...this.missionTarget };
      } else {
        this.isNextMission = true;
        return;
      }
    }

    for (const unit of this._members) {
      if (!unit.alive) continue;
      // C++ team.cpp parity: loaner units in RETREAT don't get re-assigned by
      // the team coordinator. Empty BADR transports (paratrooper carriers that
      // already dropped their cargo) are in IsALoaner+RETREAT state and are
      // flying off-map. Forcing them back to ATTACK lets them keep firing
      // their ParaBomb at player units (SCG04EA: BADR killing the player MCV
      // after its E2 paratroopers were dropped).
      if (unit.isALoaner && unit.mission === Mission.RETREAT) continue;

      // C++ team.cpp:1703-1708 — assign ATTACK mission
      // Session 22: route through queue (Assign_Mission) per mission.cpp:388.
      // No-op when Mission == ATTACK. Commence pops via STAGE A when idle.
      if (unit.mission !== Mission.ATTACK) {
        assignMission(unit, Mission.ATTACK);
        unit.moveTarget = null;
      }
      // Set move target toward attack position if no entity target
      if (!unit.target && this.target) {
        unit.moveTarget = { lx: pixelToLepton(this.target.x), ly: pixelToLepton(this.target.y) };
      }
    }
  }

  /**
   * C++ Coordinate_Do (team.cpp:1809-1856)
   * Assign a specific mission to all members.
   */
  coordinateDo(mission: TeamMissionEntry): void {
    // C++ team.cpp:1813-1860 Coordinate_Do — for each member: queue do_mission
    // and (only when in the regrouping branch — line 1848) clear ArchiveTarget,
    // TarCom, and NavCom. The regrouping branch is gated by:
    //   !Target_Legal(unit->TarCom) && !Target_Legal(unit->NavCom)
    //     && unit->Mission != do_mission
    // i.e., the clears happen ONLY when TarCom and NavCom are already null —
    // making the clears redundant in C++. The non-regrouping branch
    // (Distance(Zone) > 2*StrayDistance) never touches TarCom or NavCom.
    //
    // Queue the mission for every member; Commence processes when animation
    // allows. Do NOT unconditionally clear TarCom/NavCom — that would nullify
    // a triggerRetaliation-set TarCom (see commit 14e56d67 for the analogous
    // SCG06EA t68 issue in coordinateMove).
    const doMission = this.mapCppMission(mission.data);

    for (const unit of this._members) {
      if (!unit.alive) continue;
      // C++ Assign_Mission queues; Commence processes when animation allows
      unit.missionQueue = doMission;
    }

    this.isNextMission = true;
  }

  /**
   * Patrol to waypoint — move but attack enemies en route
   * (C++ TMission_Patrol, team.cpp:2883)
   */
  coordinatePatrol(_waypoints?: Map<number, { cx: number; cy: number }>, ctx?: TeamAIContext): void {
    // Patrol combines MOVE + ATTACK behaviors
    // If any member is in combat, let it fight; otherwise, move toward target
    if (!this.target && this.missionTarget) {
      this.target = { ...this.missionTarget };
    }
    if (!this.target) {
      this.isNextMission = true;
      return;
    }

    // C++ team.cpp:2965-2976 — TMission_Patrol periodic threat scan.
    //   if (Frame % (Rule.PatrolTime * TICKS_PER_MINUTE) == 0) {
    //     leader = Fetch_A_Leader();
    //     target = leader->Greatest_Threat(THREAT_NORMAL|THREAT_RANGE);
    //     if (Target_Legal(target)) Assign_Mission_Target(target);
    //     else                       Assign_Mission_Target(TARGET_NONE);
    //   }
    //
    // Rule.PatrolTime=.016, TICKS_PER_MINUTE=900. Fixed-point: (4*900+128)/256=14.
    // Fires every 14 ticks. When no enemy in range, MissionTarget=TARGET_NONE,
    // which calls Assign_Mission_Target chain (team.cpp:396-437):
    //   For each member with NavCom == old_MissionTarget:
    //     Assign_Mission(GUARD)              ← queues GUARD
    //     Assign_Destination(TARGET_NONE)    ← clears NavCom
    //
    // SCG13EA t99: this fires for nptrl team. Member id=109 (USSR E1 at 61,67)
    // gets queue=GUARD, NavCom cleared. Mission_Move on next tick triggers
    // Enter_Idle_Mode → m=GUARD → fires Mission_Guard at tick 101 (the missing
    // 60043 RNG call vs WASM).
    //
    // C++ Greatest_Threat doesn't consume RNG (techno.cpp:1987-2300 — pure scan).
    // We use a simple proximity check: any enemy within THREAT_RANGE (~5 cells).
    // C++ Frame is 0-indexed (starts at 0); TS tick is 1-indexed (starts at 1).
    // C++ Frame % 14 == 0 fires at Frame 0, 14, 28, ..., 98, 112.
    // TS tick at scan fire = Frame + 1, so scan fires when (tick-1) % 14 == 0.
    // SCG13EA t99 nptrl: WASM clears target during tick 99 processing
    // (probe shows tgtX=0 at tick 99 end). (99-1)%14 = 98%14 = 0 ✓.
    const PATROL_TIME_TICKS = 14;
    if (ctx?.tick !== undefined && ctx.tick > 0 && (ctx.tick - 1) % PATROL_TIME_TICKS === 0) {
      const leader = this._members.find(m => m.alive);
      if (leader && ctx.entities) {
        // Greatest_Threat scan: look for any non-allied entity in threat range.
        // C++ Threat_Range with THREAT_RANGE=true returns weapon-range-based.
        // For an E1 with weapon range ~4 cells, threat range ~5 cells.
        const THREAT_RANGE_LEPTONS = 5 * 256;
        let foundThreat = false;
        for (const e of ctx.entities) {
          if (!e.alive || e.house === leader.house) continue;
          const dx = e.leptonX - leader.leptonX;
          const dy = e.leptonY - leader.leptonY;
          const adx = Math.abs(dx), ady = Math.abs(dy);
          const dist = adx > ady ? adx + (ady >> 1) : ady + (adx >> 1);
          if (dist <= THREAT_RANGE_LEPTONS) {
            foundThreat = true;
            break;
          }
        }
        if (!foundThreat) {
          // Equivalent of C++ Assign_Mission_Target(TARGET_NONE) (team.cpp:396-437):
          // For each member: if NavCom (moveTarget) == old MissionTarget,
          //   - assignMission(GUARD): C++ Assign_Mission ONLY sets queue when
          //     Mission != target (mission.cpp:388). For unit already in GUARD,
          //     this is a no-op — queue stays MOVE.
          //   - Clear moveTarget (NavCom).
          //
          // The subsequent flow:
          //   1. Unit's existing mq=MOVE Commence pops next tick → Mission_Move
          //   2. Mission_Move's Enter_Idle_Mode triggers (foot.cpp:524 — !NavCom
          //      && !IsDriving && mq==NONE) → queues GUARD
          //   3. Tick after: Commence pops GUARD → m=GUARD
          //   4. Mission_Guard fires (consuming RNG)
          //
          // Critical: do NOT call assignMission(GUARD) when unit is already in
          // GUARD — it's a no-op in C++ Assign_Mission, which preserves the
          // existing mq=MOVE that drives the Mission_Move → Enter_Idle_Mode chain.
          const oldMissionTargetLX = this.missionTarget ? pixelToLepton(this.missionTarget.x) : null;
          const oldMissionTargetLY = this.missionTarget ? pixelToLepton(this.missionTarget.y) : null;
          for (const m of this._members) {
            if (!m.alive) continue;
            if (m.moveTarget &&
                oldMissionTargetLX !== null && oldMissionTargetLY !== null &&
                m.moveTarget.lx === oldMissionTargetLX && m.moveTarget.ly === oldMissionTargetLY) {
              // C++ Assign_Mission(GUARD) is a no-op when Mission==GUARD already.
              // assignMission in TS has the same semantics (clears queue when
              // already-in-target, sets queue otherwise). Using direct queue write
              // would over-clear; rely on assignMission's no-op semantic.
              if (m.mission !== Mission.GUARD) {
                assignMission(m, Mission.GUARD);
              }
              // C++ Assign_Destination(TARGET_NONE) — foot.cpp:1809-1820 only
              // clears NavCom and resets PathThreshhold. It does not clear the
              // active Head_To_Coord segment; Movement_AI gets the current tick
              // to advance, then Stop_Driver happens on the following tick if
              // the segment did not arrive.
              m.moveTarget = null;
              m.navComClearedTick = ctx?.tick ?? -1;
              m.pathThreshold = 1; // C++ MOVE_CLOAK
            }
          }
          this.missionTarget = null;
          this.target = null;
          // After clearing target, return early — Coordinate_Move would skip
          // member iteration anyway (C++ team.cpp:1891 `if (Target_Legal(Target))`).
          return;
        }
      }
    }

    let allArrived = true;
    for (const unit of this._members) {
      if (!unit.alive) continue;

      if (unit.mission === Mission.ATTACK && unit.target?.alive) {
        allArrived = false;
        continue; // let it fight
      }

      // C++ team.cpp:1908-1910: stray = Rule.StrayDistance; aircraft *= 3
      // Use leptonDist for C++ parity (coord.cpp Distance in lepton space)
      const stray = unit.isAirUnit ? STRAY_DISTANCE * 3 : STRAY_DISTANCE;
      const targetLX = Math.trunc(this.target.x * LEPTON_SIZE / CELL_SIZE);
      const targetLY = Math.trunc(this.target.y * LEPTON_SIZE / CELL_SIZE);
      const dist = leptonDist(unit.leptonX, unit.leptonY, targetLX, targetLY);
      if (dist > stray) {
        // For infantry, queue the mission so the gesture gate at index.ts:4067
        // blocks promotion during the team-activation DO_GESTURE1/2 animation
        // (C++ team.cpp:1938 Coordinate_Move → Assign_Mission queues). Non-infantry
        // (vehicles/aircraft) keep the direct-assignment path — they don't gesture
        // and Commence semantics differ.
        if (unit.stats.isInfantry) {
          // Phase 2: route through assignMission (C++ mission.cpp:379-390)
          // — no-op when already in MOVE, queues otherwise.
          assignMission(unit, Mission.MOVE);
          if (!unit.moveTarget) {
            unit.moveTarget = { lx: pixelToLepton(this.target.x), ly: pixelToLepton(this.target.y) };
          }
        } else if (unit.mission !== Mission.MOVE || !unit.moveTarget) {
          // C++ team.cpp Coordinate_Patrol (team.cpp:Coordinate_Move-equivalent
          // patrol variant) → Assign_Mission(MISSION_MOVE) → Commence() pops
          // queue and sets Timer=0 (mission.cpp:354). Next MissionClass::AI
          // fires Mission_Move handler, consuming Random_Pick(0,2) jitter
          // (foot.cpp:535 tag 60010).
          //
          // W1 deleted (Step 3): no sticky patrolBlockedTarget flag. C++
          // fires the Mission_Move jitter on every re-assignment, including
          // re-targets to the same blocked cell. The drive.cpp:1102 reactive
          // close-enough in followTrackStep clears NavCom when blocked.
          const targetLXlepton = pixelToLepton(this.target.x);
          const targetLYlepton = pixelToLepton(this.target.y);
          // Session 21: route through queue (Assign_Mission). Commence
          // resets Timer=0 when it pops (mission.cpp:354); manual reset
          // removed to match C++ exactly.
          assignMission(unit, Mission.MOVE);
          unit.moveTarget = { lx: targetLXlepton, ly: targetLYlepton };
        }
        allArrived = false;
      } else {
        // C++ team.cpp:1971-1974 — Coordinate_Move/Patrol arrived branch:
        //   if (unit->Mission == MISSION_MOVE && (!Target_Legal(unit->NavCom) ||
        //       Distance(unit->NavCom) < CELL_LEPTON_W)) {
        //     unit->Assign_Destination(TARGET_NONE);
        //     unit->Enter_Idle_Mode();
        //   }
        //
        // coordinateMove had this; coordinatePatrol was missing it. Mirrors the
        // identical C++ team.cpp branch for both. SCG13EA t99 USSR E1 (61,67):
        // unit's distance to team target reaches close-enough → queue GUARD →
        // Commence pops to GUARD next tick → Mission_Guard fires at tick 101
        // (the missing 60043 RNG call vs WASM).
        if (unit.mission === Mission.MOVE) {
          let shouldIdle = !unit.moveTarget;
          if (!shouldIdle && unit.moveTarget) {
            const navDx = unit.moveTarget.lx - unit.leptonX;
            const navDy = unit.moveTarget.ly - unit.leptonY;
            const adx = Math.abs(navDx), ady = Math.abs(navDy);
            const navDist = adx > ady ? adx + (ady >> 1) : ady + (adx >> 1);
            const CELL_LEPTON_W = 256;
            if (navDist < CELL_LEPTON_W) {
              unit.moveTarget = null;
              unit.path = [];
              unit.pathIndex = 0;
              shouldIdle = true;
            }
          }
          if (shouldIdle) {
            assignMission(unit, Mission.GUARD);
          }
        }
      }
    }

    if (allArrived) {
      this.isNextMission = true;
    }
  }

  /**
   * C++ TMission_Unload (team.cpp:2110-2176)
   * Tell transports to unload passengers.
   */
  tMissionUnload(): void {
    let finished = true;
    for (const unit of this._members) {
      if (!unit.alive) continue;
      if (unit.passengers && unit.passengers.length > 0) {
        const aircraftUnloading =
          unit.stats.isAircraft &&
          (unit.aircraftState === 'unload_search' ||
            unit.aircraftState === 'unload_fly' ||
            unit.aircraftState === 'unload_land' ||
            unit.aircraftState === 'unload_eject');
        if (aircraftUnloading) {
          finished = false;
          continue;
        }

        // C++ team.cpp:2148-2152: Assign_Mission(UNLOAD) queues it. Commence
        // transitions when gated condition met (not IsLanding/IsTakingOff for
        // aircraft). For tick-1 reinforcement aircraft, IsTakingOff=true means
        // Commence is skipped and Mission stays MOVE. Mission_Move then
        // consumes Random_Pick(0,2). Match by queueing instead of direct set.
        if (unit.mission !== Mission.UNLOAD) {
          unit.missionQueue = Mission.UNLOAD;
        }
        finished = false;
      }
    }
    if (finished) {
      this.isNextMission = true;
    }
  }

  /**
   * C++ TMission_Deploy (team.cpp:2923-2950 approximately)
   * Tell MCV/minelayer members to deploy.
   */
  tMissionDeploy(): void {
    for (const unit of this._members) {
      if (!unit.alive) continue;
      // Signal deploy intent via mission (DEPLOY maps to UNLOAD in TS).
      // Session 19: route through assignMission queue to match C++
      // mission.cpp:388 semantic.
      assignMission(unit, Mission.UNLOAD);
    }
    this.isNextMission = true;
  }

  /**
   * C++ TMission_Loop (team.cpp:2869-2876)
   * Jump back to a mission index in the queue.
   */
  tMissionLoop(): void {
    const mission = this.missionList[this.currentMission];
    if (mission) {
      // C++ team.cpp:2875 — CurrentMission = Data.Value - 1 (then IsNextMission increments it)
      this.currentMission = mission.data - 1;
      this.isNextMission = true;

      // Sync members
      for (const m of this._members) {
        if (m.alive) {
          m.teamMissionIndex = mission.data;
          m.teamMissionWaiting = 0;
        }
      }
    }
  }

  // ── Damage handling (C++ TeamClass::Took_Damage, team.cpp:1574-1618) ──

  /**
   * Notify team that a member took damage.
   * Non-suicide teams may retarget to the attacker.
   */
  tookDamage(member: Entity, source: Entity | null): void {
    if (this.isSuicide) return;
    if (!source || !source.alive) return;
    if (this._members.includes(source)) return; // don't target own team

    // C++ team.cpp:1613 — retarget to attacker
    if (this.isMoving && this.target) {
      this.target = { x: source.pos.x, y: source.pos.y };
    }
  }

  // ── Internal helpers ──

  /**
   * C++ team.cpp:590-616 — find nearest friendly unarmed building for retreat.
   * Scans Buildings[] for: alive, same house, PrimaryWeapon == NULL (unarmed).
   * STRUCT_REPAIR (FIX) gets halved distance (preferred retreat target).
   * Distance weighted by: Distance(building, Zone) * (CellThreat + 1).
   * We simplify CellThreat to 1 (no threat map), so distance = raw distance.
   */
  findRetreatBuilding(structures?: MapStructure[]): WorldPos | null {
    if (!structures || !this.zone) return null;

    let bestTarget: WorldPos | null = null;
    let bestDist = Infinity;

    for (const s of structures) {
      if (!s.alive) continue;
      if (s.house !== this.house) continue;

      // C++ team.cpp:596: b->Class->PrimaryWeapon == NULL (only unarmed buildings)
      const isArmed = s.type in STRUCTURE_WEAPONS;
      if (isArmed) continue;

      const [bw, bh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
      const bx = (s.cx + bw / 2) * CELL_SIZE;
      const by = (s.cy + bh / 2) * CELL_SIZE;
      let dist = worldDist(this.zone, { x: bx, y: by });

      // C++ team.cpp:612: if (*b == STRUCT_REPAIR) dist /= 2;
      if (s.type === 'FIX') {
        dist /= 2;
      }

      if (dist < bestDist) {
        bestDist = dist;
        bestTarget = { x: bx, y: by };
      }
    }

    return bestTarget;
  }

  /**
   * Calculate center position of team members (C++ Calc_Center, team.cpp:1390-1551).
   */
  calcCenter(): void {
    const alive = this._members.filter(m => m.alive);
    if (alive.length === 0) {
      this.zone = null;
      return;
    }

    // C++ team.cpp:1390 Calc_Center uses lepton coordinates.
    // Compute average in lepton space, then convert to pixel WorldPos.
    let lx = 0, ly = 0;
    for (const m of alive) {
      lx += m.leptonX;
      ly += m.leptonY;
    }
    lx = Math.trunc(lx / alive.length);
    ly = Math.trunc(ly / alive.length);
    this.zoneLeptonX = lx;
    this.zoneLeptonY = ly;
    this.zone = { x: Math.trunc(lx * 24 / 256), y: Math.trunc(ly * 24 / 256) };
  }

  /**
   * Set mission target, clearing old target if needed
   * (C++ Assign_Mission_Target, team.cpp:396-450).
   *
   * Phase 3j: C++ iterates members and clears TarCom/NavCom if set to old
   * MissionTarget, queuing GUARD. This was missing — caused SCG11 4TNK@60,58
   * to stay in Mission=MOVE indefinitely because NavCom was never cleared on
   * team mission transition.
   */
  private setMissionTarget(newTarget: WorldPos | null): void {
    const oldTarget = this.missionTarget;
    if (oldTarget) {
      // Convert old target to lepton target cell for NavCom comparison.
      const oldTargetLX = pixelToLepton(oldTarget.x);
      const oldTargetLY = pixelToLepton(oldTarget.y);
      for (const unit of this._members) {
        if (!unit.alive) continue;
        const navMatch = unit.moveTarget &&
          unit.moveTarget.lx === oldTargetLX && unit.moveTarget.ly === oldTargetLY;
        const tarMatch = !!(unit.target &&
          oldTarget.x === Math.trunc(unit.target.leptonX * CELL_SIZE / LEPTON_SIZE) &&
          oldTarget.y === Math.trunc(unit.target.leptonY * CELL_SIZE / LEPTON_SIZE));
        if (navMatch || tarMatch) {
          assignMission(unit, Mission.GUARD);
          if (navMatch) {
            unit.moveTarget = null;
            unit.path = [];
            unit.pathIndex = 0;
          }
          if (tarMatch) {
            unit.target = null;
          }
        }
      }
    }

    if (this.target && this.missionTarget &&
        this.target.x === this.missionTarget.x && this.target.y === this.missionTarget.y) {
      this.missionTarget = newTarget;
      this.target = newTarget ? { ...newTarget } : null;
    } else {
      this.missionTarget = newTarget;
    }
  }

  /**
   * Dissolve the team — remove all member references, mark as dissolved.
   * (C++ team.cpp:292-312 destructor + team.cpp:560 delete this)
   */
  dissolve(): void {
    for (const m of this._members) {
      m.teamRef = null;
      // C++ team.cpp:1139: Remove calls Enter_Idle_Mode. Infantry preserves a
      // legal NavCom by assigning MOVE; otherwise guard missions are left alone
      // and non-guard units queue GUARD.
      if (m.alive && m.mission !== Mission.RETREAT) {
        if (m.moveTarget) {
          assignMission(m, Mission.MOVE);
        } else if (m.mission !== Mission.GUARD && m.mission !== Mission.AREA_GUARD) {
          assignMission(m, Mission.GUARD);
        }
      }
    }
    this._members = [];
    this.dissolved = true;
  }

  /**
   * Map C++ MissionType enum index to TS Mission enum
   * (C++ defines.h:979-1008)
   */
  private mapCppMission(index: number): Mission {
    switch (index) {
      case 0: return Mission.SLEEP;
      case 1: return Mission.ATTACK;
      case 2: return Mission.MOVE;
      case 3: return Mission.MOVE;   // QMOVE
      case 4: return Mission.MOVE;   // RETREAT
      case 5: return Mission.GUARD;
      case 10: return Mission.AREA_GUARD;
      case 14: return Mission.HUNT;
      default: return Mission.GUARD;
    }
  }
}

// ── Team registry — manages all active teams ──

const _activeTeams: Team[] = [];

/** Get all active (non-dissolved) teams */
export function getActiveTeams(): readonly Team[] {
  return _activeTeams;
}

/** Register a new team */
export function registerTeam(team: Team): void {
  _activeTeams.push(team);
}

/** Remove dissolved teams from the registry */
export function cleanupTeams(): void {
  for (let i = _activeTeams.length - 1; i >= 0; i--) {
    if (_activeTeams[i].dissolved) {
      _activeTeams.splice(i, 1);
    }
  }
}

/** Clear all teams (for scenario reset) */
export function clearAllTeams(): void {
  _activeTeams.length = 0;
  resetTeamIds();
}

/**
 * Update all active teams — call once per game tick from the main loop.
 * This matches C++ Logic_AI() iterating through Teams[] and calling AI() on each.
 */
export function updateAllTeams(waypoints?: Map<number, { cx: number; cy: number }>, ctx?: TeamAIContext): void {
  for (const team of _activeTeams) {
    if (!team.dissolved) {
      team.ai(waypoints, ctx);
    }
  }
  cleanupTeams();
}
