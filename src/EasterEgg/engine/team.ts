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
import { House, Mission, worldDist, worldDistLeptons, leptonDist, STRAY_DISTANCE, type WorldPos, CELL_SIZE, LEPTON_SIZE, UNIT_STATS, UnitType, pixelToLepton, leptonToPixel } from './types';
import { type MapStructure, STRUCTURE_WEAPONS, STRUCTURE_SIZE } from './scenario';
import { ScenarioRandom } from './random';

/** Optional context for building-based retreat targeting (C++ team.cpp:590-616) */
export interface TeamAIContext {
  structures?: MapStructure[];
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

    // Copy mission list to entity for per-entity processing (reinforcement teams).
    // CREATE_TEAM entities don't get pre-assigned teamMissions — they're handled
    // by the TeamInstance coordinator, so this copy gives them the coordinator's
    // mission list for per-entity fallback.
    entity.teamMissions = this.missionList;
    entity.teamMissionIndex = Math.max(0, this.currentMission);

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

    for (const dm of this.desiredMembers) {
      let current = 0;
      for (const m of this._members) {
        if (m.alive && (m.type === dm.type || m.type === dm.type.toUpperCase())) current++;
      }
      if (current >= dm.count) continue;

      const targetType = dm.type.toUpperCase();
      const stats = UNIT_STATS[targetType as UnitType];
      const isUnitOrVessel = stats && !stats.isInfantry && !stats.isAircraft;

      if (isUnitOrVessel) {
        // C++ UNIT/VESSEL case (team.cpp:1250-1322): iteration-based add.
        // Each iteration where a closer match is found triggers Add.
        let bestEntity: Entity | null = null;
        let bestDist = -1;
        for (const e of entities) {
          if (!e.alive || e.inLimbo) continue;
          if (e.type !== targetType) continue;
          if (e.house !== this.house) continue;
          if (e.teamRef === this) continue; // already a member of THIS team
          if (e.teamRef) continue; // C++ Can_Add: priority check (simplified)
          if (e.mission !== Mission.GUARD && e.mission !== Mission.AREA_GUARD) continue;
          if (e.target || e.moveTarget) continue;
          // C++ Can_Add: team must not be full of this type
          if (current >= dm.count) break;

          const d = recruitCenter
            ? worldDist(e.pos, recruitCenter)
            : 0;
          // C++ team.cpp:1262: (d < bestdist || bestdist == -1)
          if (bestDist === -1 || d < bestDist) {
            bestDist = d;
            bestEntity = e;
            // C++ team.cpp:1269-1283: Add(best) inside the for loop, each
            // time best is updated. The previous best stays in the team
            // (Add() is a no-op for existing members).
            this.add(bestEntity);
            current++;
          }
        }
        continue;
      }

      // C++ INFANTRY/AIRCRAFT case (team.cpp:1208-1247): loop-then-add. Find
      // the single closest match across all entities, then Add once.
      let bestEntity: Entity | null = null;
      let bestDist = -1;
      for (const e of entities) {
        if (!e.alive || e.inLimbo) continue;
        if (e.type !== targetType) continue;
        if (e.house !== this.house) continue;
        if (e.teamRef) continue;
        if (e.mission !== Mission.GUARD && e.mission !== Mission.AREA_GUARD) continue;
        if (e.target || e.moveTarget) continue;
        const d = recruitCenter
          ? worldDist(e.pos, recruitCenter)
          : 0;
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
          this.coordinateMove(waypoints);
        }
        return;
      } else {
        this.zone = null;
      }
    }

    // ── Activate at full strength (C++ team.cpp:627-652) ──
    // C++ CREATE_TEAM: team is empty at creation, recruits on next tick, activates on tick after.
    // _skipActivationOnce delays activation by 1 ai() call to match this timing.
    if (this._skipActivationOnce) {
      this._skipActivationOnce = false;
    } else if (!this.isMoving && (this.isFullStrength || this.isForcedActive)) {
      this.isMoving = true;
      this.isHasBeen = true;
      this.isUnderStrength = false;

      // C++ team.cpp:637: Percent_Chance(50) → if true, all initiated members
      // Do_Action(DO_GESTURE1). DO_GESTURE1 is non-interruptible (MasterDoControls
      // Interrupt=false), blocking Commence for 3 frames × rate 2 = 6 ticks.
      // This prevents team members from accepting queued missions during the gesture.
      const doGesture = ScenarioRandom.percentChance(50);
      if (doGesture) {
        for (const m of this._members) {
          if (m.alive && m.stats.isInfantry) {
            // C++ WASM data: Doing=16 (DO_GESTURE1) blocks ticks 4-8 (5 ticks),
            // gesture set at tick 2. Gate opens tick 9, Commence fires, handler
            // fires tick 10. Total blocking: 8 ticks from gesture set.
            m.nonInterruptAnimTicks = 8;
          }
        }
      }

      if (this.isReforming || this.isForcedActive) {
        // All members become initiated
      }

      this.currentMission = -1;
      this.isNextMission = true;
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
          this.coordinateMove(waypoints);
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
        this.coordinateMove(waypoints);
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
        // Member too far — order to move to zone
        unit.mission = Mission.MOVE;
        unit.moveTarget = { lx: pixelToLepton(this.zone.x), ly: pixelToLepton(this.zone.y) };
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
  coordinateMove(_waypoints?: Map<number, { cx: number; cy: number }>): void {
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
        // Not yet arrived — order move
        if (unit.mission !== Mission.MOVE || !unit.moveTarget) {
          unit.mission = Mission.MOVE;
          unit.moveTarget = { lx: pixelToLepton(this.target.x), ly: pixelToLepton(this.target.y) };
          // C++ Commence() resets Timer=0 when mission changes (team.cpp:354).
          // This triggers Mission_Move() → Random_Pick(0,2) on next entity AI tick.
          unit.missionTimer = 0;
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
        if (unit.mission !== Mission.MOVE || !unit.moveTarget) {
          unit.mission = Mission.MOVE;
          unit.moveTarget = { lx: pixelToLepton(this.target.x), ly: pixelToLepton(this.target.y) };
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
        unit.mission = Mission.UNLOAD;
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
  for (const team of _activeTeams) {
    if (!team.dissolved) {
      team.ai(waypoints, ctx);
    }
  }
  cleanupTeams();
}
