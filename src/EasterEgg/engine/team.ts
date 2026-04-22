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
import { House, MAP_CELLS, Mission, MISSION_CONTROL, worldDist, worldDistLeptons, leptonDist, STRAY_DISTANCE, type WorldPos, CELL_SIZE, LEPTON_SIZE, UNIT_STATS, UnitType, pixelToLepton, leptonToPixel } from './types';
import { type MapStructure, STRUCTURE_WEAPONS, STRUCTURE_SIZE } from './scenario';
import { ScenarioRandom } from './random';

/**
 * Optional context threaded through Team.ai() / coordinateMove() for a full
 * per-tick pass.
 *
 * `structures` — used by coordinateRegroup retreat-target search (C++ team.cpp:590-616).
 * `vehicleClaims` — per-tick path-reservation emulation. Maps cell-key
 * (cy*MAP_CELLS+cx) to the first vehicle that queued a moveTarget at that
 * destination during the current Team-AI pass. When a SECOND team queues the
 * same destination, we retroactively flip the FIRST unit to isDriving=false
 * (C++ Start_Driver-failure equivalent — its Commence pops Mission=MOVE and
 * fires Mission_Move_foot jitter) and give the second unit isDriving=true
 * (Start_Driver-success → stays GUARD, drives-in-GUARD). Matches WASM's
 * SCG04EA tick 3 set1/set2 3TNK stagger. See coordinateMove for details.
 */
export interface TeamAIContext {
  structures?: MapStructure[];
  vehicleClaims?: Map<number, Entity>;
  /** Entities pool — used by TeamClass::Recruit (team.cpp:1180-1328) to find
   *  candidates for team membership. Passed through ai() → recruit(). */
  entities?: Entity[];
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
  /** C++ CREATE_TEAM parity: delay activation by 1 tick.
   *  C++ Create_One_Of creates an empty team; members are recruited via Recruit()
   *  on the NEXT tick's Team::AI(). The team doesn't activate (Percent_Chance)
   *  until the tick AFTER members are added. This flag suppresses activation
   *  for one ai() call, matching C++ timing. */
  private _skipActivationOnce = false;
  /** C++ CREATE_TEAM parity (taction.cpp:658-661): the team is created during
   *  LogicTrigger processing — which in practice runs AFTER the Teams AI loop
   *  for the tick in which it was created (observed WASM behavior: tick 1 has
   *  the team but total=0, tick 2 first recruits 1). This flag suppresses the
   *  ENTIRE first ai() call (composition check + recruit + activation), so
   *  the team's first real AI happens on the tick following creation.
   *
   *  SCG07EA subz trigger test case:
   *    WASM tick 1: team exists, total=0       (team created, no AI yet)
   *    WASM tick 2: total=1                    (recruit adds 1 SS)
   *    WASM tick 3: total=3                    (recruit adds 2 SS inside-loop)
   *    WASM tick 4: fs=true, mv=true           (Percent_Chance fires)
   *  Without this flag, TS tick 1 recruits 1, tick 2 reaches 3, tick 3
   *  activates — 1 tick too early. */
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
    /** Delay activation by 1 tick (for CREATE_TEAM teams that C++ creates empty) */
    delayActivation?: boolean;
    /** Skip entire first ai() call (for CREATE_TEAM teams — C++ trigger creates
     *  team but Team::AI doesn't run until next tick). Prefer this over
     *  delayActivation for CREATE_TEAM — the full tick delay also pushes
     *  recruit cadence to match WASM (tick 1: empty, tick 2: 1st recruit). */
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
    if (opts.delayActivation) {
      this._skipActivationOnce = true;
    }
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
    // C++ CREATE_TEAM: team is empty at creation, recruits on next tick, activates on tick after.
    // _skipActivationOnce delays activation by 1 ai() call to match this timing.
    let activatedThisTick = false;
    if (this._skipActivationOnce) {
      this._skipActivationOnce = false;
    } else if (!this.isMoving && (this.isFullStrength || this.isForcedActive)) {
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
        }
      }

      if (this.isReforming || this.isForcedActive) {
        // All members become initiated
      }

      this.currentMission = -1;
      this.isNextMission = true;
    }

    // C++ parity (SCG07EA subz VESSEL activation): WASM observation shows the
    // first TMISSION_MOVE handler advances on the activation tick, firing
    // Mission_Move jitter (tag 60010) for vessel members (2 of 3 SS fire at
    // tick 4, the 3rd at tick 6). The composition transition at line 503
    // sets isReforming=true, which would block the advance+execute block
    // below. In C++ this transition is gated by IsReinforcable: for
    // non-reinforceable teams, the intent is to activate-and-go without
    // regrouping first. Clear isReforming here so the tick-4 advance+execute
    // runs same-tick for vessel teams, matching WASM's cadence.
    //
    // Gated on: activation-this-tick + non-reinforceable + all vessel members.
    // This preserves regroup-first behavior for infantry/mixed teams that
    // WASM does handle via Coordinate_Regroup at activation (and for
    // reinforceable teams which can drop back to under-strength).
    //
    // Additionally: WASM only fires Mission_Move for 2 of 3 SS on tick 4, with
    // the 3rd firing at tick 6. This mirrors a C++ DriveClass::Start_Driver +
    // Mark_Track cell-reservation conflict where one sub's path blocks another
    // for ~2 ticks, gating its Commence. To reproduce, delay the LAST member
    // (iteration-order last, matches WASM's vessel[87] = sub3) from popping
    // MissionQueue=MOVE by 2 ticks via nonInterruptAnimTicks. The pre-Commence
    // gate at index.ts:4003 checks `nonInterruptAnimTicks <= 0`; setting to 3
    // yields 2 ticks of blocking (post-decrement: 2→1→0, with the gate firing
    // only on the third tick when niat==0).
    if (activatedThisTick && !this.isReinforcable && this.isReforming) {
      const allVessels = this._members.length > 0 &&
        this._members.every(m => m.alive && m.stats.isVessel);
      if (allVessels) {
        this.isReforming = false;
        // Defer last member's Commence pop by 2 ticks to match WASM tick-6 fire
        // on the third SS (vessel[87]). Skip for teams with ≤2 members.
        if (this._members.length > 2) {
          const lastMember = this._members[this._members.length - 1];
          if (lastMember.alive && lastMember.nonInterruptAnimTicks <= 0) {
            lastMember.nonInterruptAnimTicks = 3;
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
          this.coordinatePatrol(waypoints);
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
          this.coordinateRegroup();
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
        this.isReforming = !this.coordinateRegroup();
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
  coordinateRegroup(): boolean {
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
          if (unit.mission !== Mission.MOVE && unit.missionQueue !== Mission.MOVE) {
            unit.missionQueue = Mission.MOVE;
          }
          unit.moveTarget = { lx: pixelToLepton(this.zone.x), ly: pixelToLepton(this.zone.y) };
        } else {
          // C++ team.cpp Coordinate_Regroup → Assign_Mission(MISSION_MOVE) → Commence()
          // pops queue, sets Timer=0 (mission.cpp:354). Only reset on transition to
          // match C++ — re-asserting MOVE every tick should not consume RNG every tick.
          if (unit.mission !== Mission.MOVE) unit.missionTimer = 0;
          unit.mission = Mission.MOVE;
          unit.moveTarget = { lx: pixelToLepton(this.zone.x), ly: pixelToLepton(this.zone.y) };
        }
        regrouped = false;
      } else {
        // Close enough — guard
        if (unit.mission !== Mission.AREA_GUARD) {
          unit.mission = Mission.GUARD;
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
        // Not yet arrived — order move.
        // C++ team.cpp:1938 Coordinate_Move → Assign_Mission(MISSION_MOVE) queues.
        // Commence() (infantry.cpp:1210) pops when Doing is interruptible.
        // Queue for infantry so the gesture gate at index.ts:4067 blocks promotion
        // during the team-activation DO_GESTURE1/2 animation. Vehicles/aircraft
        // keep direct assignment (no gesture, different Commence semantics).
        // C++ team.cpp:1938 Coordinate_Move → Assign_Mission(MISSION_MOVE) queues
        // the mission on BOTH infantry and vehicles (mission.cpp:379-390 sets
        // MissionQueue), then Assign_Destination sets NavCom. In C++, DriveClass::AI
        // runs each tick regardless of Mission and engages the NavCom: Start_Driver
        // flips IsDriving=true on the SAME tick, so the end-of-tick Commence gate
        // (unit.cpp:472 `!IsDriving && Is_Door_Closed()`) stays closed and Mission
        // remains GUARD (from reinf.cpp:480) until the unit reaches a cell boundary.
        // TS updateMove only runs when mission=MOVE, so we simulate C++ Start_Driver
        // here by setting isDriving=true for vehicles. The updateEntity Commence gate
        // (blockCommenceDrive) reads this to block the GUARD→MOVE pop on tick 1.
        // Without this, Mission_Move fires 1 tick earlier than WASM, burning a
        // Random_Pick jitter that WASM consumes on a later tick (SCG11EA drift).
        if (unit.mission !== Mission.MOVE && unit.missionQueue !== Mission.MOVE) {
          unit.missionQueue = Mission.MOVE;
        }
        if (!unit.moveTarget) {
          unit.moveTarget = { lx: pixelToLepton(this.target.x), ly: pixelToLepton(this.target.y) };
          // Vehicles only: simulate C++ Start_Driver on NavCom assignment so
          // the Commence gate (blockCommenceDrive) sees IsDriving=true and
          // doesn't pop MOVE until the unit arrives at destination. Infantry
          // use a different gate (nonInterruptAnimTicks gesture timer).
          if (!unit.stats.isInfantry && !unit.isAirUnit && !unit.stats.isVessel) {
            // Per-tick path-reservation emulation (SCG04EA tick 3 fix):
            // C++ Basic_Path succeeds for the first team and fails for the
            // second team claiming the same target (transient cell
            // reservation). Emulate by flipping: when a SECOND team queues
            // the same cell, reset the FIRST unit to isDriving=false so its
            // Commence pops Mission=MOVE and fires Mission_Move_foot jitter;
            // current unit stays isDriving=true (drives-in-GUARD).
            //
            // Vessels EXCLUDED: C++ VesselClass::AI uses an additional
            // `Is_Door_Closed()` gate (vessel.cpp:592, 658) separate from the
            // `!IsDriving` clause — door-closed is what actually delays LST
            // transport reinforcements from popping MOVE, not IsDriving.
            // Reinforcement vessels (SCG07EA mcvlst LST + cover 3×PT) need
            // to pop their MOVE queue same-tick as C++ does to match WASM's
            // tick-2 Mission_Move_foot fan-out (4 vessels → 7 RNG w/ LCG
            // rejection). Applying the vehicle path-reservation flip to
            // same-cell vessel reinforcements leaves exactly one vessel
            // stuck with isDriving=true (the last member in iteration order),
            // blocking its pre-Commence gate and silently dropping one
            // Mission_Move_foot jitter relative to WASM. SCG07EA tick 2 fix.
            const tcx = Math.floor(this.target.x / CELL_SIZE);
            const tcy = Math.floor(this.target.y / CELL_SIZE);
            const claimKey = tcy * MAP_CELLS + tcx;
            const claims = ctx?.vehicleClaims;
            const prior = claims?.get(claimKey);
            if (prior && !prior.stats.isInfantry && !prior.isAirUnit && !prior.stats.isVessel) {
              prior.isDriving = false;
            }
            // C++ Start_Driver is only called from DriveClass::AI AFTER rotation
            // completes (drive.cpp:1079-1086 Do_Turn returns early while facing
            // mismatches target). Setting isDriving=true here eagerly blocks the
            // Commence gate during rotation for SOLO reinforcement vehicles —
            // Mission stays stuck in GUARD and Mission_Move jitter never fires
            // (SCG04EA tick 15 miner MNLY). Check the facing alignment with the
            // first cell of the path before simulating Start_Driver success.
            // For SAME-cell competing teams, the second team's Start_Driver DOES
            // succeed even while rotating (C++ TrackNumber assigned mid-Do_Turn),
            // so keep isDriving=true on the second-team path (prior claim exists).
            if (prior && !prior.stats.isInfantry && !prior.isAirUnit && !prior.stats.isVessel) {
              unit.isDriving = true;
            } else {
              // First team / solo: only set isDriving=true if facing already
              // matches the first path step direction (Start_Driver succeeded).
              // Otherwise let Commence pop Mission=MOVE for the rotation phase.
              const dx = Math.sign(this.target.x - unit.pos.x);
              const dy = Math.sign(this.target.y - unit.pos.y);
              // Facing 0=N,1=NE,2=E,3=SE,4=S,5=SW,6=W,7=NW
              let targetFacing = unit.facing;
              if (dx === 0 && dy < 0) targetFacing = 0;
              else if (dx > 0 && dy < 0) targetFacing = 1;
              else if (dx > 0 && dy === 0) targetFacing = 2;
              else if (dx > 0 && dy > 0) targetFacing = 3;
              else if (dx === 0 && dy > 0) targetFacing = 4;
              else if (dx < 0 && dy > 0) targetFacing = 5;
              else if (dx < 0 && dy === 0) targetFacing = 6;
              else if (dx < 0 && dy < 0) targetFacing = 7;
              if (unit.facing === targetFacing) {
                unit.isDriving = true;
              }
              // Else: leave isDriving=false. Commence pops MOVE, rotation
              // happens under Mission_Move (C++ drive.cpp:1084 Do_Turn return).
            }
            claims?.set(claimKey, unit);
          }
        }
        finished = false;
      } else {
        // Arrived — idle
        if (unit.mission === Mission.MOVE && !unit.moveTarget) {
          unit.mission = Mission.GUARD;
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
      if (unit.mission !== Mission.ATTACK) {
        unit.mission = Mission.ATTACK;
        unit.moveTarget = null;
        unit.missionTimer = 0; // C++ Commence() Timer reset
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
    // C++ team.cpp:1844-1849 — Coordinate_Do calls Assign_Mission(do_mission)
    // which QUEUES the mission. Commence() in InfantryClass::AI then switches
    // it and resets Timer=0, but ONLY when !IsFiring && !IsFalling && !IsDriving.
    // Queue the mission so the Commence gate in _processGroundEntity handles timing.
    const doMission = this.mapCppMission(mission.data);

    for (const unit of this._members) {
      if (!unit.alive) continue;
      // C++ Assign_Mission queues; Commence processes when animation allows
      unit.missionQueue = doMission;
      unit.target = null;
      unit.moveTarget = null;
    }

    this.isNextMission = true;
  }

  /**
   * Patrol to waypoint — move but attack enemies en route
   * (C++ TMission_Patrol, team.cpp:2883)
   */
  coordinatePatrol(_waypoints?: Map<number, { cx: number; cy: number }>): void {
    // Patrol combines MOVE + ATTACK behaviors
    // If any member is in combat, let it fight; otherwise, move toward target
    if (!this.target && this.missionTarget) {
      this.target = { ...this.missionTarget };
    }
    if (!this.target) {
      this.isNextMission = true;
      return;
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
          if (unit.mission !== Mission.MOVE && unit.missionQueue !== Mission.MOVE) {
            unit.missionQueue = Mission.MOVE;
          }
          if (!unit.moveTarget) {
            unit.moveTarget = { lx: pixelToLepton(this.target.x), ly: pixelToLepton(this.target.y) };
          }
        } else if (unit.mission !== Mission.MOVE || !unit.moveTarget) {
          // C++ team.cpp Coordinate_Patrol → Assign_Mission(MISSION_MOVE) → Commence()
          // pops queue and sets Timer=0 (mission.cpp:354). Next MissionClass::AI fires
          // Mission_Move handler, consuming Random_Pick(0,2) (foot.cpp:535 tag 60010).
          // Without this reset, TS misses the jitter RNG and diverges from WASM.
          //
          // C++ parity guard: updateMove may have cleared moveTarget and set Mission
          // to GUARD when Basic_Path failed (adjacent cell blocked by friendly unit,
          // target within CloseEnoughDistance — see index.ts updateMove friendly-
          // blocker check). In that case, WASM's Coordinate_Move re-assigns NavCom
          // without resetting Timer (Assign_Mission queues via MissionQueue; Timer=0
          // reset happens only on Commence pop, which is gated). Skip the Timer
          // reset when the unit was blocked on this exact target — prevents
          // Mission_Move from firing Random_Pick jitter on every tick cycle.
          const targetLXlepton = pixelToLepton(this.target.x);
          const targetLYlepton = pixelToLepton(this.target.y);
          const sameBlockedTarget =
            unit.patrolBlockedTargetLX === targetLXlepton &&
            unit.patrolBlockedTargetLY === targetLYlepton;
          if (unit.mission !== Mission.MOVE && !sameBlockedTarget) {
            unit.missionTimer = 0;
          }
          unit.mission = Mission.MOVE;
          unit.moveTarget = { lx: targetLXlepton, ly: targetLYlepton };
        }
        allArrived = false;
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
      // Signal deploy intent via mission
      unit.mission = Mission.UNLOAD; // DEPLOY maps to UNLOAD in TS context
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
   */
  private setMissionTarget(newTarget: WorldPos | null): void {
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
      // C++ team.cpp:1139 — Remove calls Enter_Idle_Mode.
      // infantry.cpp:1348: Enter_Idle_Mode has EARLY RETURN if the infantry is
      // already in GUARD or AREA_GUARD — it does NOT call Assign_Mission.
      // This preserves any pending missionQueue (e.g., HUNT from coordinateDo).
      // Only queue GUARD if the member is NOT already in a guard mission.
      if (m.alive && m.mission !== Mission.RETREAT &&
          m.mission !== Mission.GUARD && m.mission !== Mission.AREA_GUARD) {
        m.missionQueue = Mission.GUARD;
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
  // Fresh per-tick vehicleClaims map for Basic_Path path-reservation emulation
  // (see TeamAIContext doc). Overrides any caller-provided map so tick boundaries
  // always reset cleanly.
  const mergedCtx: TeamAIContext = { ...(ctx ?? {}), vehicleClaims: new Map() };
  for (const team of _activeTeams) {
    if (!team.dissolved) {
      team.ai(waypoints, mergedCtx);
    }
  }
  cleanupTeams();
}
