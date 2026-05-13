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

import { Entity, CloakState, threatScore as computeThreatScore, type TeamMissionEntry } from './entity';
import { House, Mission, MISSION_CONTROL, worldDist, worldDistLeptons, leptonDist, STRAY_DISTANCE, type WorldPos, type CellPos, type LeptonPos, CELL_SIZE, LEPTON_SIZE, MAP_CELLS, UNIT_STATS, UnitType, pixelToLepton, leptonToPixel, cellTargetToLepton, cellIndexToPos, PRODUCTION_ITEMS } from './types';
import { type MapStructure, STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP, structureCenterLeptons as cppStructureCenterLeptons } from './scenario';
import { ScenarioRandom } from './random';
import { MoveResult, type GameMap } from './map';
import { findPath, nearbyLocation } from './pathfinding';
import { greatestThreatRangeTarget, movementZoneCells, type GreatestThreatRangeContext } from './missionAI';
// TEAM_START_DRIVER_REFACTOR flag was removed along with its `false` branch
// in Step 6 of the C++-parity refactor. The flag remains in perCellProcess.ts
// as documentation but is no longer read.
import { assignMission, commence } from './missionLifecycle';

function facingFromCellStep(from: { cx: number; cy: number }, to: { cx: number; cy: number }): number {
  const dx = Math.sign(to.cx - from.cx);
  const dy = Math.sign(to.cy - from.cy);
  if (dx === 0 && dy < 0) return 0;   // N
  if (dx > 0 && dy < 0) return 1;     // NE
  if (dx > 0 && dy === 0) return 2;   // E
  if (dx > 0 && dy > 0) return 3;     // SE
  if (dx === 0 && dy > 0) return 4;   // S
  if (dx < 0 && dy > 0) return 5;     // SW
  if (dx < 0 && dy === 0) return 6;   // W
  if (dx < 0 && dy < 0) return 7;     // NW
  return 0;
}

/**
 * Optional context threaded through Team.ai() for a full per-tick pass.
 *
 * `structures`     — used by coordinateRegroup retreat-target search (C++ team.cpp:590-616).
 * `entities`       — used by TeamClass::Recruit (team.cpp:1180-1328) to find candidates.
 * `map`            — used by drive-class Coordinate_Move to mirror
 *                    DriveClass::Assign_Destination -> Start_Of_Move.
 * `canEnterCell`   — virtual FootClass::Can_Enter_Cell predicate. For
 *                    infantry this must call InfantryClass::Can_Enter_Cell;
 *                    for drive-class units it should call Unit/Vessel
 *                    Can_Enter_Cell. Coordinate_Move uses it to gate the eager
 *                    IsDriving=true flip, matching C++ `Start_Of_Move`
 *                    semantics that only fire `Start_Driver` when Basic_Path's
 *                    first cell is enterable (drive.cpp:638-640 +
 *                    foot.cpp:313-500).
 * `startDriveClassMove` — C++ DriveClass::Assign_Destination immediate
 *                    Start_Of_Move hook for vehicles/vessels.
 */
export interface TeamAIContext {
  structures?: MapStructure[];
  entities?: Entity[];
  map?: GameMap;
  canEnterCell?: (entity: Entity, cx: number, cy: number) => boolean;
  startDriveClassMove?: (entity: Entity) => void;
  /** C++ InfantryClass::Stop_Driver — clear Head_To_Coord claim, occupy current coord. */
  stopInfantryDriver?: (entity: Entity) => void;
  /** C++ InfantryClass::Assign_Destination line 1046 predicate:
   *  Stop_Driver only when Map[Center_Coord()].Is_Clear_To_Move(Class->Speed,
   *  ignoreinfantry=true, ignorevehicles=false) is true. */
  canStopInfantryDriverForAssignDestination?: (entity: Entity) => boolean;
  /** Context required by C++ TechnoClass::Greatest_Threat for patrol scans. */
  playerHouse?: House;
  entitiesAllied?: (a: Entity, b: Entity) => boolean;
  housesAllied?: (a: House, b: House) => boolean;
  isPlayerControlled?: (entity: Entity) => boolean;
  isDiscoveredByPlayer?: (entity: Entity) => boolean;
  isDiscoveredStructureByPlayer?: (structure: MapStructure) => boolean;
  isRevealedToHouse?: (cx: number, cy: number, houseIdx: number) => boolean;
  /** C++ TechnoClass::Evaluate_Object value calculation, including AI house bias. */
  threatScore?: (scanner: Entity, target: Entity, distCells: number) => number;
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

export function shouldDelayCreateTeamFirstAi(members: Array<{ type: string }>): boolean {
  return members.some(m => {
    const type = m.type.toUpperCase();
    return type === 'SS' || type === 'MSUB';
  });
}

// C++ defines.h:2422-2438 QuarryType.
const QUARRY_NONE = 0;
const QUARRY_ANYTHING = 1;
const QUARRY_BUILDINGS = 2;
const QUARRY_HARVESTERS = 3;
const QUARRY_INFANTRY = 4;
const QUARRY_VEHICLES = 5;
const QUARRY_VESSELS = 6;
const QUARRY_FACTORIES = 7;
const QUARRY_DEFENSE = 8;
const QUARRY_THREAT = 9;
const QUARRY_POWER = 10;
const QUARRY_FAKES = 11;

/** RTTI flags matching C++ RTTIType bit positions used by TechnoClass::Greatest_Threat. */
const enum TeamThreatRTTI {
  INFANTRY = 1 << 1,
  UNIT = 1 << 2,
  VESSEL = 1 << 3,
  BUILDING = 1 << 4,
  AIRCRAFT = 1 << 5,
}

type TeamThreatTarget =
  | { pos: WorldPos; entity: Entity; structure?: null }
  | { pos: WorldPos; entity?: null; structure: MapStructure };

const STRUCTURE_POINTS: Record<string, number> = {};
for (const item of PRODUCTION_ITEMS) {
  if (item.isStructure) STRUCTURE_POINTS[item.type] = item.points ?? item.cost;
}

const FAKE_STRUCTURE_TYPES = new Set(['FACF', 'WEAF', 'SYRF', 'SPEF', 'DOMF']);
const FACTORY_STRUCTURE_TYPES = new Set(['FACT', 'WEAP', 'TENT', 'BARR', 'HPAD', 'AFLD', 'SYRD', 'SPEN']);

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
  /** Scenario [TeamTypes] key, retained as INI identity/debug metadata. */
  readonly typeName: string | null;
  /** Scenario TeamTypes array index, used to mirror C++ TeamTypeClass::Number. */
  readonly teamTypeIndex: number | null;

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

  /** Mission timeout value (C++ TimeOut.Value()). */
  timeOut = 0;
  /** C++ CDTimerClass<FrameTimerClass> backing state for TimeOut. */
  private timeOutDelay = 0;
  private timeOutStartedFrame = 0;
  /** Fallback frame counter for unit tests that call Team.ai() without a game tick. */
  private localFrame = 0;

  /** Team target — current objective (C++ Target) */
  target: WorldPos | null = null;
  /** Cell identity for C++ RTTI_CELL Target values. WorldPos alone loses the
   *  target.cpp As_Target(CELL) → As_Coord(TARGET) +0x88 coordinate quirk. */
  private targetCell: CellPos | null = null;
  /** C++ Target carries RTTI. Preserve whether target is a Techno vs a coord. */
  targetEntityRef: Entity | null = null;
  /** C++ Target may also resolve from a cell to a BuildingClass object. */
  private targetStructureRef: MapStructure | null = null;

  /** Mission target — the scripted objective (C++ MissionTarget) */
  missionTarget: WorldPos | null = null;
  private missionTargetCell: CellPos | null = null;
  /** C++ MissionTarget can be an object TARGET, not just a cell/coord. */
  private missionTargetEntityRef: Entity | null = null;
  private missionTargetStructureRef: MapStructure | null = null;

  /** Team center/zone (C++ Zone) — average position of members */
  zone: WorldPos | null = null;
  /** Zone in lepton space for C++ parity distance comparisons */
  zoneLeptonX = 0;
  zoneLeptonY = 0;

  /** Has any member left the map? (C++ IsLeaveMap) */
  isLeaveMap = false;
  /** C++ CREATE_TEAM parity for submerged submarine teams.
   *
   *  SCG07EA subz trigger empirical WASM trace:
   *    WASM tick 1: team exists, total=0       (team created, no AI yet)
   *    WASM tick 2: total=1                    (recruit adds 1 SS)
   *    WASM tick 3: total=3                    (recruit adds 2 SS inside-loop)
   *    WASM tick 4: fs=true, mv=true           (Percent_Chance fires)
   *
   *  Surface-vessel CREATE_TEAM types do not share this delay: SCG12EA engcru
   *  (CA:1) recruits on tick 1 and activates on tick 2. The caller therefore
   *  only sets this for submarine-class members (SS/MSUB), not for every vessel. */
  private _skipFirstAiCall = false;

  /** Is team dissolved? */
  dissolved = false;

  constructor(opts: {
    typeName?: string;
    teamTypeIndex?: number;
    house: House;
    desiredMembers: Array<{ type: string; count: number }>;
    missionList: TeamMissionEntry[];
    recruitPriority?: number;
    isReinforcable?: boolean;
    isSuicide?: boolean;
    origin?: WorldPos | null;
    forcedActive?: boolean;
    /** Skip entire first ai() call for CREATE_TEAM submarine teams. */
    skipFirstAiCall?: boolean;
  }) {
    this.id = nextTeamId++;
    this.house = opts.house;
    this.typeName = opts.typeName ?? null;
    this.teamTypeIndex = opts.teamTypeIndex ?? null;
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

  /** C++ TeamClass::Is_Leaving_Map (team.cpp:2453-2466).
   *  A moving team gives members permission to leave the radar rectangle only
   *  while its current script entry is TMISSION_MOVE to an off-radar waypoint. */
  isLeavingMap(map: Pick<GameMap, 'inBounds'>, waypoints?: Map<number, { cx: number; cy: number }>): boolean {
    if (!this.isMoving || this.currentMission < 0) return false;
    const mission = this.missionList[this.currentMission];
    if (!mission || mission.mission !== TMISSION_MOVE) return false;
    const waypoint = waypoints?.get(mission.data);
    if (!waypoint) return false;
    return !map.inBounds(waypoint.cx, waypoint.cy);
  }

  /** Current C++ Frame equivalent for this Team::AI call.
   *
   * Runtime passes `ctx.tick` from the game loop. Unit tests sometimes call
   * Team.ai() directly; for those, `localFrame` advances once per AI call.
   */
  private currentFrame(ctx?: TeamAIContext): number {
    return ctx?.tick ?? this.localFrame;
  }

  /** C++ CDTimerClass assignment (`TimeOut = value`).
   *
   * `CDTimerClass(set)` stores DelayTime=set and Started=Frame. Reading it in
   * the same frame returns the full delay, then it counts down automatically
   * as Frame advances. This differs from decrementing an integer inside the
   * same mission branch.
   */
  private setTimeOut(delay: number, ctx?: TeamAIContext): void {
    this.timeOutDelay = Math.max(0, delay | 0);
    this.timeOutStartedFrame = this.currentFrame(ctx);
    this.refreshTimeOut(ctx);
  }

  /** Refresh public TimeOut.Value() from the CDTimer backing state. */
  private refreshTimeOut(ctx?: TeamAIContext): number {
    const elapsed = Math.max(0, this.currentFrame(ctx) - this.timeOutStartedFrame);
    this.timeOut = Math.max(0, this.timeOutDelay - elapsed);
    return this.timeOut;
  }

  // ── Add / Remove (C++ team.cpp:891-936, 1053-1158) ──

  /**
   * Add entity to this team (C++ TeamClass::Add).
   * - If entity is in another team, removes from it first (team.cpp:904-906)
   * - First member gets IsInitiated = true (team.cpp:912)
   * - New members are inserted at the head of the member chain
   *   (team.cpp:913-914: obj->Member = Member; Member = obj)
   * - Sets entity.teamRef back-pointer
   */
  add(entity: Entity): boolean {
    if (!entity.alive) return false;
    if (this._members.includes(entity)) return false;

    // C++ TeamClass::Can_Add (team.cpp:1025) only allows a transfer from
    // another team when this team has strictly higher RecruitPriority.
    if (entity.teamRef && entity.teamRef !== this &&
        entity.teamRef.recruitPriority >= this.recruitPriority) {
      return false;
    }

    // C++ team.cpp:904-906 — remove from old team first
    if (entity.teamRef && entity.teamRef !== this) {
      entity.teamRef.remove(entity);
    }

    const isFirstMember = this._members.length === 0;
    this._members.unshift(entity);
    entity.teamRef = this;
    entity.teamInitiated = isFirstMember;

    // C++ parity: Team::Add does NOT copy missions to entity members.
    // The TeamInstance coordinator (coordinateMove/coordinateDo) handles
    // mission dispatch. Clear any per-entity teamMissions to prevent
    // updateTeamMission from competing with the coordinator.
    entity.teamMissions = [];
    entity.teamMissionIndex = 0;

    // C++ team.cpp:912-914 — first member is initiated, but the linked
    // Member chain is newest-first. Several team coordinators depend on
    // this order because Coordinate_Conscript can initiate or move later
    // recruits before older members are processed.
    // (In C++ this means "has reached team center and is an active participant")

    // Mark team composition as altered for re-evaluation
    this.isAltered = true;

    if (this.zone === null && entity.alive) {
      this.calcCenter();
    }

    return true;
  }

  /** C++ team.cpp:141 _Is_It_Playing — active, breathing, initiated member. */
  private isItPlaying(unit: Entity): boolean {
    // C++ _Is_It_Breathing excludes IsInLimbo after ScenarioInit. Loaded
    // transport cargo is TS's limbo equivalent: it remains in the Team member
    // chain, but must not participate in Calc_Center/Coordinate_Move until
    // TMission_Unload unlimbos it.
    if (unit.transportRef) return false;
    return unit.alive && (unit.teamInitiated || unit.isAirUnit);
  }

  private assignTeamMoveDestination(
    unit: Entity,
    target: LeptonPos,
    ctx?: TeamAIContext,
    targetEntityRef: Entity | null = null,
  ): void {
    unit.moveTarget = { ...target };
    unit.moveTargetEntityRef = targetEntityRef;
    unit.moveTargetEntityRefLX = target.lx;
    unit.moveTargetEntityRefLY = target.ly;
    unit.pathThreshold = 1; // C++ MOVE_CLOAK
    if (unit.stats.isInfantry) {
      unit.path = [];
      unit.pathIndex = 0;
      return;
    }
    if (!unit.isAirUnit) {
      if (ctx?.startDriveClassMove) {
        ctx.startDriveClassMove(unit);
      } else {
        unit.path = [];
        unit.pathIndex = 0;
      }
    }
  }

  /** C++ team.cpp:2285 Coordinate_Conscript.
   *  Non-initiated members move toward the team Zone until close enough, then
   *  become initiated and participate in Coordinate_Move/Attack. */
  private coordinateConscript(unit: Entity, ctx?: TeamAIContext): boolean {
    // C++ _Is_It_Breathing (team.cpp:99-120) rejects IsInLimbo members after
    // ScenarioInit. Transport cargo is limboed by CargoClass::Attach
    // (cargo.cpp:87-95), so loaded passengers must not receive conscript MOVE
    // orders while still inside a BADR/APC/LST. Their mission queue is assigned
    // when they are actually detached/unlimboed.
    if (unit.transportRef || unit.inLimbo) return false;
    if (!unit.alive || unit.teamInitiated || unit.isAirUnit) return false;
    if (!this.zone) {
      unit.teamInitiated = true;
      return false;
    }
    if (leptonDist(unit.leptonX, unit.leptonY, this.zoneLeptonX, this.zoneLeptonY) > STRAY_DISTANCE) {
      if (!unit.moveTarget) {
        assignMission(unit, Mission.MOVE);
        unit.target = null;
        unit.formationOffset = null;
        // C++ Coordinate_Conscript calls Assign_Destination(Zone). For
        // DriveClass members that immediately clears Path[0] and calls
        // Start_Of_Move, so the same object AI tick can spend a rotation step.
        this.assignTeamMoveDestination(unit, {
          lx: this.zoneLeptonX,
          ly: this.zoneLeptonY,
        }, ctx);
      }
      return true;
    }
    unit.teamInitiated = true;
    return false;
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
   *   UNIT/VESSEL (team.cpp:1250-1322): first filter to the requested vehicle
   *   class, then the `if (best)` Add call is INSIDE the for loop. Each
   *   iteration where `best` is updated to a new closer unit triggers another
   *   Add — so MULTIPLE units of that class can be recruited in a single call.
   *   Each "improvement" of best produces an Add of the new unit (previous bests
   *   are already members and Add() is a no-op for them).
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
    // C++ team.cpp:961-1029 Can_Add: returns true if the entity can join the team
    // on a matching typeindex with room. For infantry/aircraft Recruit scans the
    // whole RTTI list and Can_Add can land on any open slot in that list. For
    // units/vessels C++ prefilters by the requested class before Can_Add.
    const canAdd = (e: Entity): boolean => {
      // C++ paradropped infantry are active/unlimboed while Height > 0, but
      // TechnoClass::AI returns before MissionClass::AI and the team recruit
      // pass does not pull those falling objects back into a team. Treat the
      // falling window as not recruitable so a just-dropped passenger keeps its
      // queued HUNT order until it lands.
      if (!e.alive || e.inLimbo || e.isFalling) return false;
      // C++ TeamClass::Can_Add (team.cpp:980): candidates in radio contact
      // are considered busy and cannot be recruited. TS uses `isTethered` for
      // BuildingClass::Exit_Object / transport radio contact until the first
      // Per_Cell_Process tether cut.
      if (e.isTethered || e.transportRef) return false;
      if (e.house !== this.house) return false;
      if (e.teamRef === this) return false; // already member
      if (e.teamRef && e.teamRef.recruitPriority >= this.recruitPriority) return false;
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
    // For each typeindex slot needing fill, scan the same RTTI list C++ scans.
    // Infantry/aircraft can redirect within that list through Can_Add; units
    // and vessels additionally require an exact class match before Can_Add.
    for (const dm of this.desiredMembers) {
      let current = 0;
      for (const m of this._members) {
        if (m.alive && (m.type === dm.type || m.type === dm.type.toUpperCase())) current++;
      }
      if (current >= dm.count) continue;

      const targetType = dm.type.toUpperCase();
      const stats = UNIT_STATS[targetType as UnitType];
      const isUnitOrVessel = stats && !stats.isInfantry && !stats.isAircraft;
      const matchesRecruitList = (e: Entity): boolean => {
        // C++ TeamClass::Recruit switches on the desired member RTTI and scans
        // that object list only. The UNIT/VESSEL branches also check
        // obj->Class == Class->Members[typeindex].Class before Can_Add.
        if (!stats) return false;
        if (stats.isInfantry) return e.stats.isInfantry;
        if (stats.isAircraft) return !!e.stats.isAircraft;
        if (stats.isVessel) return !!e.stats.isVessel && e.type === targetType;
        return !e.stats.isInfantry && !e.stats.isAircraft && !e.stats.isVessel && e.type === targetType;
      };

      // C++ center = As_Coord(Zone); if Class->Origin != -1, center = waypoint.
      // If Zone is TARGET_NONE, As_Coord returns 0 (map origin) — unit->Distance(0)
      // still produces different distances per-unit. TS must match this: use (0,0)
      // as fallback when no recruitCenter, so each entity gets a unique distance.
      const centerPos: WorldPos = center ?? this.origin ?? this.zone ?? { x: 0, y: 0 };

      if (isUnitOrVessel) {
        // C++ UNIT/VESSEL case (team.cpp:1250-1322): iteration-based add.
        // Each iteration where a closer match is found triggers Add.
        // The Can_Add(obj, typeindex) call may modify typeindex to ANY matching class
        // in this RTTI list, so this slot's recruit can end up adding a different
        // class type than expected within the same object collection.
        let bestDist = -1;
        for (const e of entities) {
          if (!matchesRecruitList(e)) continue;
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
        if (!matchesRecruitList(e)) continue;
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
  remove(entity: Entity, ctx?: TeamAIContext): boolean {
    const idx = this._members.indexOf(entity);
    if (idx === -1) return true; // C++ returns true if not a member

    this._members.splice(idx, 1);
    entity.teamRef = null;
    entity.teamInitiated = false;
    // C++ team.cpp:2285-2289 — clears IsFormationMove when member is removed/dies
    entity.formationOffset = null;
    this.isAltered = true;

    // C++ team.cpp:1139 — a member that breaks off a team immediately runs
    // its virtual Enter_Idle_Mode(). If it still has NavCom, this is a MOVE
    // no-op; if not, it queues the class idle mission. This is load-bearing for
    // TeamClass::Suspend_Teams during base-defense response: low-priority
    // teams release members without continuing Coordinate_Move on later ticks.
    this.enterIdleAfterTeamRelease(entity, ctx);

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
    if (ctx?.tick === undefined) {
      this.localFrame++;
    }

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
          this.dissolve(ctx);
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
        this.calcCenter(ctx);
        // C++ team.cpp:590-616 — retreat to nearest friendly unarmed building
        // Prefer STRUCT_REPAIR (FIX) — distance halved for repair facility.
        // Scans Buildings[] for b.House == House && b.PrimaryWeapon == NULL.
        const retreatTarget = this.findRetreatBuilding(ctx?.structures);
        if (retreatTarget) {
          this.setTarget(retreatTarget);
        } else if (this.zone) {
          // Fallback to zone center if no buildings available
          this.setTarget(this.zone);
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
      // Animation duration is Class->DoControls[DO_GESTURE*].Count multiplied
      // by MasterDoControls[DO_GESTURE*].Rate. For E1/E2/E3/E4/E6 this is
      // Count=3 × Rate=2 = 6 ticks; for dogs Count=1 × Rate=2 = 2 ticks.
      //
      // Store the raw C++ animation duration. TS decrements before the infantry
      // Commence gate and runs Doing_AI after the gate, so when the counter
      // reaches 0 on tick N, the gesture still blocks tick N Commence and
      // transitions to stand_ready afterward; the queue can pop on tick N+1.
      //
      // Consume the RNG to keep the chain aligned (same call as C++), but apply
      // the block regardless of outcome — TS previously only set niat on TRUE,
      // missing ~50% of team activations and firing Mission_Move too early.
      ScenarioRandom.percentChance(50);
      for (const m of this._members) {
        // C++ team.cpp:638-640 gates the startup gesture through
        // _Is_It_Breathing(). CargoClass::Attach limbos passengers, so loaded
        // BADR/APC/LST cargo stays in the member chain but does not receive the
        // non-interruptible gesture until it is actually on the map.
        if (m.alive && m.stats.isInfantry && !m.transportRef && !m.inLimbo && m.nonInterruptAnimTicks <= 0) {
          if (m.type === UnitType.I_SPY) {
            // C++ InfantryClass::Do_Action special-case (infantry.cpp:1975):
            // team activation DO_GESTURE1/2 maps spies to DO_IDLE1/2 and
            // consumes Random_Pick(0,1), keeping the animation interruptible.
            ScenarioRandom.nextInRange(0, 1);
            m.doing = 'idle_anim';
            continue;
          }
          // Phase 7B — track Doing state for C++-faithful Commence gate
          // (entity.ts isDoingInterruptible). Mirrors C++ Do_Action(DO_GESTURE1).
          // doingAI transitions back to stand_ready when niat reaches 0.
          // Only set for currently-interruptible members (mirrors C++ Do_Action
          // semantics — won't override an in-progress non-interruptible animation).
          if (m.doing !== 'gesture') {
            m.startTransportUnloadGesture(ctx?.tick ?? -1);
          }
        }
      }

      if (this.isReforming || this.isForcedActive) {
        // All members become initiated
        for (const m of this._members) {
          if (m.alive) m.teamInitiated = true;
        }
      }

      this.currentMission = -1;
      this.isNextMission = true;
    }

    // ── Recalc center (C++ team.cpp:658-660) ──
    if (this.isReforming || this.isMoving || this.zone === null) {
      this.calcCenter(ctx);
    }

    // ── Recruit while forming/reforming (C++ team.cpp:666-673) ──
    // Once a team is moving, C++ does not top off ordinary losses unless the
    // team has first crossed the under-strength path above and stopped moving.
    if (!this.isMoving && !this.isFullStrength && ctx?.entities) {
      this.recruit(ctx.entities);
    }

    // ── Dissolve if empty and has been active (C++ team.cpp:679-697) ──
    if (this.isEmpty && this.isHasBeen) {
      this.dissolve(ctx);
      return;
    }

    // ── Advance mission (C++ team.cpp:704-753) ──
    if (this.isMoving && !this.isReforming && this.isNextMission) {
      this.isNextMission = false;
      this.currentMission++;

      if (this.currentMission < this.missionList.length) {
        const mission = this.missionList[this.currentMission];

        // C++ team.cpp:710 — TimeOut is a CDTimerClass, not a manually
        // decremented integer. Assignment starts the countdown at the current
        // Frame, so the value remains full for this AI call.
        this.setTimeOut(mission.data * 90, ctx); // TICKS_PER_MINUTE/10 = 900/10 = 90
        this.setTarget(null);

        // Set mission target based on mission type
        switch (mission.mission) {
          case TMISSION_MOVECELL:
            // C++ team.cpp:715 — Assign_Mission_Target(::As_Target((CELL)data)).
            {
              const cell = cellIndexToPos(mission.data);
              const worldTarget: WorldPos = {
                x: cell.cx * CELL_SIZE + CELL_SIZE / 2,
                y: cell.cy * CELL_SIZE + CELL_SIZE / 2,
              };
              this.setMissionTarget(worldTarget, cell);
            }
            break;

          case TMISSION_MOVE:
          case TMISSION_ATT_WAYPT:
          case TMISSION_PATROL:
          case TMISSION_SPY:
            // Move/attack/patrol to waypoint
            if (waypoints) {
              const wp = waypoints.get(mission.data);
              if (wp) {
                let cell = { cx: wp.cx, cy: wp.cy };
                if (mission.mission === TMISSION_MOVE) {
                  // C++ team.cpp:721-724 — TMISSION_MOVE adjusts the waypoint
                  // through Map.Nearby_Location when the team leader cannot
                  // enter the exact waypoint cell. TMISSION_PATROL/ATT_WAYPT/SPY
                  // do not apply this adjustment.
                  const leader = this._members.find(m => m.alive);
                  let canEnter = true;
                  if (leader?.stats.isInfantry && ctx?.map) {
                    canEnter = ctx.map.canEnterCell(
                      cell.cx,
                      cell.cy,
                      leader.isNavalUnit,
                      undefined,
                      true,
                      leader.id,
                    ) === MoveResult.OK;
                  } else if (leader && ctx?.canEnterCell) {
                    canEnter = ctx.canEnterCell(leader, cell.cx, cell.cy);
                  } else if (leader && ctx?.map) {
                    canEnter = ctx.map.canEnterCell(
                      cell.cx,
                      cell.cy,
                      leader.isNavalUnit,
                      id => ctx.entities?.find(e => e.id === id)?.isDriving ?? false,
                      false,
                      leader.id,
                    ) === MoveResult.OK;
                  }
                  // C++ team.cpp:749-752 skips Nearby_Location when
                  // Is_Leaving_Map() is true, preserving the off-map waypoint
                  // as NavCom so DriveClass can handle the exit path.
                  const leavingMap = ctx?.map
                    ? this.isLeavingMap(ctx.map, waypoints)
                    : false;
                  if (leader && canEnter === false && ctx?.map && !leavingMap) {
                    const nearby = nearbyLocation(
                      ctx.map,
                      cell,
                      leader.isNavalUnit,
                      Math.max(0, (ctx.tick ?? 1) - 1),
                    );
                    if (nearby) cell = nearby;
                  }
                }
                const worldTarget: WorldPos = {
                  x: cell.cx * CELL_SIZE + CELL_SIZE / 2,
                  y: cell.cy * CELL_SIZE + CELL_SIZE / 2,
                };
                this.setMissionTarget(worldTarget, cell);
                this.setTarget(worldTarget, cell);
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
        this.dissolve(ctx);
        return;
      }
    }

    // ── Execute current mission (C++ team.cpp:758-870) ──
    if (!this.isEmpty && this.isMoving && !this.isReforming && !this.isUnderStrength) {
      if (!this.isTargetLegal() && this.missionTarget) {
        this.copyMissionTargetToTarget();
      }

      const mission = this.missionList[this.currentMission];
      if (!mission) return;

      switch (mission.mission) {
        case TMISSION_PATROL:
          this.coordinatePatrol(waypoints, ctx);
          break;

        case TMISSION_ATTACK:
          this.tMissionAttack(ctx);
          break;

        case TMISSION_ATTACKTARCOM:
        case TMISSION_ATT_WAYPT:
          this.coordinateAttack(ctx);
          break;

        case TMISSION_MOVE:
        case TMISSION_MOVECELL:
          this.coordinateMove(waypoints, ctx);
          break;

        case TMISSION_GUARD:
          this.coordinateRegroup(ctx);
          // C++ team.cpp:856-858 — guard times out when CDTimer value is 0.
          if (this.refreshTimeOut(ctx) <= 0) {
            this.isNextMission = true;
          }
          break;

        case TMISSION_UNLOAD:
          this.tMissionUnload(ctx);
          break;

        case TMISSION_DEPLOY:
          this.tMissionDeploy();
          break;

        case TMISSION_LOOP:
          this.tMissionLoop();
          break;

        case TMISSION_DO:
          this.coordinateDo(mission, ctx);
          break;

        case TMISSION_HOUND_DOG:
          this.tMissionFollow(ctx);
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

      // C++ team.cpp:1757 then 1759 — Coordinate_Regroup first gives
      // non-initiated recruits a chance to move toward the team zone, then
      // only runs regroup orders for _Is_It_Playing members. This prevents
      // later recruits from immediately executing the main team move on the
      // activation tick.
      this.coordinateConscript(unit, ctx);
      if (!this.isItPlaying(unit)) continue;

      // C++ rules.cpp:260: StrayDistance = 0x0200 = 512 leptons
      // C++ team.cpp:2054-2056: aircraft get 3x stray distance
      const stray = unit.isAirUnit ? STRAY_DISTANCE * 3 : STRAY_DISTANCE;
      if (this.zone && leptonDist(unit.leptonX, unit.leptonY, this.zoneLeptonX, this.zoneLeptonY) > stray) {
        // C++ team.cpp:1761-1776 only marks regroup as incomplete when NavCom
        // is illegal and this call assigns a fresh destination. If a far member
        // already has a NavCom, retval remains true; the next Team::AI can clear
        // IsReforming even while that member continues moving.
        if (!unit.moveTarget) {
          // C++ team.cpp:1765 Coordinate_Regroup → Assign_Mission(MISSION_MOVE).
          // Per mission.cpp:388: Assign_Mission queues when Mission != order.
          assignMission(unit, Mission.MOVE);
          this.assignTeamMoveDestination(unit, {
            lx: this.zoneLeptonX,
            ly: this.zoneLeptonY,
          }, ctx);
          regrouped = false;
        }
      } else {
        // Close enough — guard (C++ team.cpp:1783 Assign_Mission(MISSION_GUARD))
        // Session 23: route through queue instead of direct Mission set to
        // match C++ mission.cpp:388 Assign_Mission semantics. moveTarget=null
        // mirrors Assign_Destination(TARGET_NONE).
        if (unit.mission !== Mission.AREA_GUARD && unit.mission !== Mission.GUARD) {
          assignMission(unit, Mission.GUARD);
          unit.moveTarget = null;
          unit.moveTargetEntityRef = null;
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
    if (!this.isTargetLegal() && this.missionTarget) {
      this.copyMissionTargetToTarget();
    }
    if (!this.isTargetLegal()) return;
    const targetLepton = this.targetLepton();
    if (!targetLepton) return;

    let finished = true;
    let found = false;

    for (const unit of this._members) {
      if (!unit.alive) continue;
      // C++ vessel/aircraft loaner transports auto-retreat after unloading and
      // must NOT be re-grouped by the team they were spawned with.
      if (unit.mission === Mission.RETREAT) continue;
      if (this.coordinateConscript(unit, ctx)) {
        finished = false;
        continue;
      }
      if (unit.mission === Mission.UNLOAD || unit.missionQueue === Mission.UNLOAD) {
        finished = false;
      }
      if (!this.isItPlaying(unit)) continue;
      if (unit.mission === Mission.UNLOAD || unit.missionQueue === Mission.UNLOAD) {
        continue;
      }
      found = true;

      // C++ team.cpp:1908-1910: stray = Rule.StrayDistance; aircraft *= 3
      // Use leptonDist for C++ parity (coord.cpp Distance in lepton space)
      const stray = unit.isAirUnit ? STRAY_DISTANCE * 3 : STRAY_DISTANCE;
      const targetLX = targetLepton.lx;
      const targetLY = targetLepton.ly;
      const dist = leptonDist(unit.leptonX, unit.leptonY, targetLX, targetLY);
      const targetCell = {
        cx: Math.floor(targetLX / LEPTON_SIZE),
        cy: Math.floor(targetLY / LEPTON_SIZE),
      };
      const flyingAircraftNeedsTargetCell =
        unit.isAirUnit &&
        unit.flightAltitude > 0 &&
        !unit.isFixedWing &&
        (unit.cell.cx !== targetCell.cx || unit.cell.cy !== targetCell.cy) &&
        this.missionList[this.currentMission + 1]?.mission !== TMISSION_MOVE;
      if (dist > stray || flyingAircraftNeedsTargetCell) {
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
        const nextMoveTarget = { ...targetLepton };
        const targetEntityRef = this.targetEntityRef;
        const sameObjectTarget =
          targetEntityRef !== null && unit.moveTargetEntityRef === targetEntityRef;
        const targetChanged = sameObjectTarget
          ? !unit.moveTarget
          : !unit.moveTarget ||
            unit.moveTargetEntityRef !== targetEntityRef ||
            unit.moveTarget.lx !== nextMoveTarget.lx ||
            unit.moveTarget.ly !== nextMoveTarget.ly;

        assignMission(unit, Mission.MOVE);

        if (targetChanged) {
          unit.moveTarget = nextMoveTarget;
          unit.moveTargetEntityRef = targetEntityRef;
          unit.moveTargetEntityRefLX = nextMoveTarget.lx;
          unit.moveTargetEntityRefLY = nextMoveTarget.ly;
          unit.pathThreshold = 1;

          if (unit.stats.isInfantry) {
            // C++ InfantryClass::Assign_Destination override (infantry.cpp:1044):
            // if a moving infantry unit receives a legal destination and is not
            // formation-moving, Stop_Driver() first. Then, for ordinary
            // destinations (non ENTER), infantry.cpp:1099 sets Path[0] =
            // FACING_NONE before FootClass::Assign_Destination updates NavCom
            // + PathThreshhold. TS stores a cell path plus pathIndex, so clearing
            // the path is the Path[0]=FACING_NONE equivalent and forces the next
            // Movement_AI pass to Basic_Path from the current cell.
            //
            // SCG06EA t66: team retaliation changes the team Target while the
            // BadGuy E1 is mid-hop. C++ stops the old driver and invalidates
            // Path[0], so the next Movement_AI computes a fresh northward path.
            // Preserving TS's stale path sends the unit southwest and delays the
            // follow-up rifle shot that becomes the tick-100 bullet[121] impact.
            if (unit.isDriving && !unit.formationOffset &&
                (ctx?.canStopInfantryDriverForAssignDestination?.(unit) ?? true)) {
              if (ctx?.stopInfantryDriver) {
                ctx.stopInfantryDriver(unit);
              } else {
                unit.isDriving = false;
                unit.headToLX = 0;
                unit.headToLY = 0;
                unit.doStopDriverAction(ctx?.tick ?? -1);
              }
            }
            unit.path = [];
            unit.pathIndex = 0;
          } else if (!ctx?.startDriveClassMove) {
            unit.path = [];
            unit.pathIndex = 0;
          }

          // C++ DriveClass::Assign_Destination immediately calls Start_Of_Move
          // after clearing Path[0] (drive.cpp:638-645). The Game callback owns
          // Basic_Path, Do_Turn, Can_Enter_Cell, and real Start_Driver state.
          if (ctx?.startDriveClassMove && !unit.stats.isInfantry && !unit.isAirUnit) {
            ctx.startDriveClassMove(unit);
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
        // Important C++ quirk: this is inside TeamClass, so the unqualified
        // `Distance(unit->NavCom)` resolves to TeamClass::Distance(), not
        // unit->Distance(). TeamClass never updates AbstractClass::Coord from
        // 0xFFFFFFFF, so this does NOT behave as a per-unit close-enough check.
        // Treat only the explicit `!Target_Legal(unit->NavCom)` half as
        // behaviorally effective. TS previously used unit-to-NavCom distance
        // here, forcing SCG11EA MCV teams into GUARD while WASM kept MOVE.
        if (unit.mission === Mission.MOVE && !unit.moveTarget) {
          assignMission(unit, Mission.GUARD);
        }
        // C++ team.cpp:2032-2040 — even when close enough to the team target,
        // a member with a legal NavCom keeps the movement mission in progress.
        // This prevents early team mission advancement/dissolve while units are
        // still finishing their assigned path.
        if (unit.moveTarget) {
          finished = false;
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
   * C++ TMission_Attack (team.cpp:2704-2766).
   *
   * If MissionTarget is empty, the team leader runs Greatest_Threat() with the
   * mission's quarry mask, then Coordinate_Attack assigns that TARGET as each
   * member's TarCom. TS previously skipped this dispatcher and called
   * Coordinate_Attack with no target, so one-mission "hunt*" teams dissolved or
   * fell back to GUARD instead of attacking the selected quarry.
   */
  private tMissionAttack(ctx?: TeamAIContext): void {
    if (!this.isMissionTargetLegal()) {
      const mission = this.missionList[this.currentMission];
      const candidate = this.fetchLeader();
      const target = candidate && mission
        ? this.greatestThreatForTeamAttack(candidate, mission.data, ctx)
        : null;

      if (target) {
        this.setMissionTarget(
          { x: target.pos.x, y: target.pos.y },
          null,
          target.entity ?? null,
          target.structure ?? null,
        );
      } else {
        this.setMissionTarget(null);
        this.isNextMission = true;
      }
    }

    this.coordinateAttack(ctx);
  }

  private isMissionTargetLegal(): boolean {
    return this.missionTarget !== null;
  }

  private greatestThreatForTeamAttack(scanner: Entity, quarry: number, ctx?: TeamAIContext): TeamThreatTarget | null {
    if (!ctx?.entities || !ctx.map || !ctx.entitiesAllied) return null;
    if (quarry === QUARRY_NONE) return null;

    const baseMask = this.teamAttackQuarryMask(quarry);
    // C++ virtual dispatch matters here. UnitClass/InfantryClass always OR
    // PrimaryWeapon->Allowed_Threats before FootClass::Greatest_Threat, but
    // AircraftClass does not override Greatest_Threat at all and therefore
    // reaches TechnoClass::Greatest_Threat with only the requested quarry bits.
    // This is visible in SCU01EA: YAK QUARRY_FAKES must not widen to vehicles.
    const shouldApplyWeaponMask = !scanner.isAirUnit && (!scanner.isNavalUnit || baseMask === 0);
    let mask = baseMask | (shouldApplyWeaponMask
      ? this.weaponAllowedThreatMask(scanner, ctx.isPlayerControlled?.(scanner) ?? false)
      : 0);
    if (mask & TeamThreatRTTI.UNIT) mask |= TeamThreatRTTI.AIRCRAFT;
    if (mask === 0) return null;

    const zone = (!scanner.isNavalUnit && !scanner.isAirUnit)
      ? movementZoneCells(ctx.map, scanner.cell, false)
      : null;
    const useZone = !!zone && !!zone[scanner.cell.cy * MAP_CELLS + scanner.cell.cx];

    const sorted = [...ctx.entities].sort((a, b) => {
      const aAir = a.isAirUnit && a.flightAltitude > 0 ? 0 : 1;
      const bAir = b.isAirUnit && b.flightAltitude > 0 ? 0 : 1;
      if (aAir !== bAir) return aAir - bAir;
      return this.groundLayerSortKey(a) - this.groundLayerSortKey(b);
    });

    let best: TeamThreatTarget | null = null;
    let bestValue = -1;
    for (const other of sorted) {
      // C++ full-map Greatest_Threat scans Map.Layer[LAYER_GROUND]. TS keeps
      // some removed records around for debug/blocker state, so only scan
      // entities that still correspond to a C++ logic-layer object. Infantry
      // playing a non-instant death animation remain in that layer even with
      // Strength==0; Assign_Target later clears the member TarCom.
      if (!other.occupiesCppLogic()) continue;
      if (ctx.entitiesAllied(scanner, other)) continue;
      if (MISSION_CONTROL[other.mission]?.isNoThreat) continue;
      if (other.cloakState === CloakState.CLOAKED) continue;
      if (other.type === UnitType.I_SPY && scanner.type !== UnitType.I_DOG) continue;
      if (!(this.teamThreatRttiBit(other) & mask)) continue;
      if (quarry === QUARRY_HARVESTERS && other.type !== UnitType.V_HARV) continue;
      if (useZone && zone && !zone[other.cell.cy * MAP_CELLS + other.cell.cx]) continue;
      if (!this.isVisibleToPlayerForThreat(ctx, other)) continue;
      if (other.isAirUnit && other.flightAltitude > 0 && !(scanner.weapon?.isAntiAir || scanner.weapon2?.isAntiAir)) continue;

      const distCells = leptonDist(scanner.leptonX, scanner.leptonY, other.leptonX, other.leptonY) / LEPTON_SIZE;
      const value = ctx.threatScore
        ? ctx.threatScore(scanner, other, distCells)
        : computeThreatScore(scanner, other, distCells);
      if (value > bestValue) {
        bestValue = value;
        best = { pos: { x: other.pos.x, y: other.pos.y }, entity: other };
      }
    }

    if (mask & TeamThreatRTTI.BUILDING) {
      for (const structure of ctx.structures ?? []) {
        if (!this.isStructureThreatCandidate(scanner, structure, quarry, ctx)) continue;
        const center = cppStructureCenterLeptons(structure);
        if (useZone && zone && !zone[Math.floor(center.ly / LEPTON_SIZE) * MAP_CELLS + Math.floor(center.lx / LEPTON_SIZE)]) {
          continue;
        }

        const distCells = leptonDist(scanner.leptonX, scanner.leptonY, center.lx, center.ly) / LEPTON_SIZE;
        const value = this.structureThreatScore(structure, quarry, distCells);
        if (value > bestValue) {
          bestValue = value;
          best = {
            pos: {
              x: Math.trunc(center.lx * CELL_SIZE / LEPTON_SIZE),
              y: Math.trunc(center.ly * CELL_SIZE / LEPTON_SIZE),
            },
            structure,
          };
        }
      }
    }
    return best;
  }

  private isStructureThreatCandidate(
    scanner: Entity,
    structure: MapStructure,
    quarry: number,
    ctx: TeamAIContext,
  ): boolean {
    if (!structure.alive || structure.hp <= 0) return false;
    const allied = ctx.housesAllied
      ? ctx.housesAllied(scanner.house, structure.house)
      : scanner.house === structure.house;
    if (allied) return false;
    if (!this.isVisibleStructureToPlayerForThreat(ctx, structure)) return false;

    switch (quarry) {
      case QUARRY_FAKES:
        return FAKE_STRUCTURE_TYPES.has(structure.type);
      case QUARRY_POWER:
        return (structure.power ?? 0) > 0 || structure.type === 'POWR' || structure.type === 'APWR';
      case QUARRY_FACTORIES:
        return FACTORY_STRUCTURE_TYPES.has(structure.type);
      case QUARRY_DEFENSE:
        return !!STRUCTURE_WEAPONS[structure.type];
      default:
        return true;
    }
  }

  private structureThreatScore(structure: MapStructure, quarry: number, distCells: number): number {
    let value = Math.trunc((STRUCTURE_POINTS[structure.type] ?? STRUCTURE_MAX_HP[structure.type] ?? structure.maxHp ?? 256) * 2);

    switch (quarry) {
      case QUARRY_FAKES:
        if (!FAKE_STRUCTURE_TYPES.has(structure.type)) return 0;
        break;
      case QUARRY_POWER: {
        const power = structure.power ?? (structure.type === 'POWR' ? 100 : structure.type === 'APWR' ? 200 : 0);
        if (power <= 0) return 0;
        value += power * 1000;
        break;
      }
      case QUARRY_FACTORIES:
        if (!FACTORY_STRUCTURE_TYPES.has(structure.type)) return 0;
        break;
      case QUARRY_DEFENSE:
        if (!STRUCTURE_WEAPONS[structure.type]) return 0;
        break;
      default:
        break;
    }

    if (value <= 0) return 0;
    return Math.max(1, Math.trunc((value * 32000) / (Math.floor(distCells) + 1)));
  }

  private teamAttackQuarryMask(quarry: number): number {
    switch (quarry) {
      case QUARRY_BUILDINGS:
      case QUARRY_FACTORIES:
      case QUARRY_DEFENSE:
      case QUARRY_POWER:
      case QUARRY_FAKES:
        return TeamThreatRTTI.BUILDING;
      case QUARRY_HARVESTERS:
        return TeamThreatRTTI.UNIT | TeamThreatRTTI.BUILDING;
      case QUARRY_INFANTRY:
        return TeamThreatRTTI.INFANTRY;
      case QUARRY_VEHICLES:
      case QUARRY_THREAT:
        return TeamThreatRTTI.UNIT | TeamThreatRTTI.AIRCRAFT;
      case QUARRY_VESSELS:
        return TeamThreatRTTI.VESSEL;
      case QUARRY_ANYTHING:
      default:
        return 0;
    }
  }

  private weaponAllowedThreatMask(entity: Entity, isHumanControlled: boolean): number {
    if (entity.type === UnitType.I_DOG) return TeamThreatRTTI.INFANTRY;
    if (entity.type === UnitType.I_MEDI) return TeamThreatRTTI.INFANTRY;
    if (entity.type === UnitType.I_MECH) return TeamThreatRTTI.UNIT | TeamThreatRTTI.AIRCRAFT;

    const w1 = entity.weapon;
    const w2 = entity.weapon2;
    if (!w1 && !w2) return 0;

    const anyAG = (!!w1 && w1.isAntiGround !== false) || (!!w2 && w2.isAntiGround !== false);
    const anyAA = !!(w1?.isAntiAir || w2?.isAntiAir);
    let mask = 0;
    if (anyAG) mask |= TeamThreatRTTI.INFANTRY | TeamThreatRTTI.UNIT | TeamThreatRTTI.VESSEL | TeamThreatRTTI.BUILDING;
    if (anyAA) mask |= TeamThreatRTTI.AIRCRAFT;
    if (mask & TeamThreatRTTI.UNIT) mask |= TeamThreatRTTI.AIRCRAFT;

    if (entity.stats.isInfantry && w1?.warhead === 'Organic') {
      mask &= ~(TeamThreatRTTI.BUILDING | TeamThreatRTTI.UNIT | TeamThreatRTTI.VESSEL | TeamThreatRTTI.AIRCRAFT);
    }
    if (entity.stats.isInfantry && isHumanControlled) {
      mask &= ~TeamThreatRTTI.BUILDING;
    }
    return mask;
  }

  private teamThreatRttiBit(other: Entity): number {
    if (other.stats.isInfantry) return TeamThreatRTTI.INFANTRY;
    if (other.isNavalUnit) return TeamThreatRTTI.VESSEL;
    if (other.isAirUnit) return TeamThreatRTTI.AIRCRAFT;
    return TeamThreatRTTI.UNIT;
  }

  private groundLayerSortKey(entity: Entity): number {
    const yOffset = entity.stats.isInfantry ? 0x30 : 0x80;
    return (entity.leptonY + yOffset) * 0x10000 + entity.leptonX;
  }

  private isVisibleToPlayerForThreat(ctx: TeamAIContext, other: Entity): boolean {
    if (other.house === ctx.playerHouse) return true;
    if (other.isAirUnit) return true;
    if (ctx.isDiscoveredByPlayer) return ctx.isDiscoveredByPlayer(other);
    return true;
  }

  private isVisibleStructureToPlayerForThreat(ctx: TeamAIContext, structure: MapStructure): boolean {
    if (structure.house === ctx.playerHouse) return true;
    if (ctx.isDiscoveredStructureByPlayer) return ctx.isDiscoveredStructureByPlayer(structure);
    return true;
  }

  /** C++ TechnoClass::Assign_Target object-target guard.
   *  TeamClass::Coordinate_Attack passes its Target through each member's
   *  Assign_Target(), which converts inactive or zero-strength objects to
   *  TARGET_NONE (techno.cpp:2952-2958). */
  private assignMemberTarget(unit: Entity, target: Entity | null): void {
    if (unit.stats.isInfantry && !unit.isDriving) {
      unit.path = [];
      unit.pathIndex = 0;
    }
    if (!target || target.inLimbo || !target.alive || target.hp <= 0) {
      unit.target = null;
      unit.targetStructure = null;
      unit.forceFirePos = null;
      return;
    }
    unit.target = target;
    unit.targetStructure = null;
    unit.forceFirePos = null;
  }

  /**
   * C++ Coordinate_Attack (team.cpp:1636-1721)
   * All members attack the team's target. If target is invalid, advance mission.
   */
  coordinateAttack(ctx?: TeamAIContext): void {
    if (!this.isTargetLegal()) {
      if (this.missionTarget) {
        this.copyMissionTargetToTarget();
      } else {
        this.isNextMission = true;
        return;
      }
    }

    this.resolveCellAttackTarget(ctx);

    if (!this.isTargetLegal()) {
      this.isNextMission = true;
      return;
    }

    const targetLepton = this.targetLepton();

    for (const unit of this._members) {
      if (!unit.alive) continue;
      // C++ team.cpp parity: loaner units in RETREAT don't get re-assigned by
      // the team coordinator. Empty BADR transports (paratrooper carriers that
      // already dropped their cargo) are in IsALoaner+RETREAT state and are
      // flying off-map. Forcing them back to ATTACK lets them keep firing
      // their ParaBomb at player units (SCG04EA: BADR killing the player MCV
      // after its E2 paratroopers were dropped).
      if (unit.isALoaner && unit.mission === Mission.RETREAT) continue;

      // C++ team.cpp:1685-1687 — Coordinate_Attack always runs
      // Coordinate_Conscript first, then only assigns ATTACK/TarCom to
      // _Is_It_Playing members. This is important for reinforcement cargo:
      // loaded passengers are in limbo and must not have their post-paradrop
      // HUNT queue overwritten by team MOVE/ATTACK coordination.
      this.coordinateConscript(unit, ctx);
      if (!this.isItPlaying(unit)) continue;

      // C++ team.cpp:1705-1710 — when changing into ATTACK, clear TarCom and
      // NavCom after queueing the mission. InfantryClass::Assign_Destination
      // with TARGET_NONE invalidates pending Path[0] but does not stop an
      // active Head_To_Coord hop; TS preserves path while driving so the current
      // hop can complete, and clears queued path when not driving.
      if (unit.mission !== Mission.ATTACK &&
          unit.mission !== Mission.ENTER &&
          unit.mission !== Mission.CAPTURE) {
        assignMission(unit, Mission.ATTACK);
        unit.moveTarget = null;
        unit.moveTargetEntityRef = null;
        unit.target = null;
        unit.targetStructure = null;
        unit.forceFirePos = null;
        unit.pathThreshold = 1; // C++ MOVE_CLOAK
        if (!unit.isDriving) {
          unit.path = [];
          unit.pathIndex = 0;
        }
      }

      if (this.targetEntityRef && unit.target !== this.targetEntityRef) {
        this.assignMemberTarget(unit, this.targetEntityRef);
      } else if (this.targetStructureRef && unit.targetStructure !== this.targetStructureRef) {
        unit.target = null;
        // C++ Coordinate_Attack may resolve a cell TARGET to a destroyed
        // building that is still occupying the cell until CountDown removes it.
        // TechnoClass::Assign_Target rejects zero-strength objects, but the
        // team TARGET itself remains legal for this AI call.
        unit.targetStructure = this.isStructureTargetAssignable(this.targetStructureRef)
          ? this.targetStructureRef
          : null;
        unit.forceFirePos = null;
      } else if (!this.targetEntityRef && !this.targetStructureRef && unit.isAirUnit && targetLepton) {
        // C++ allows aircraft teams to attack an empty cell (paradrops and
        // parabombs). Keep the waypoint as the aircraft's fly-to/drop NavCom.
        unit.moveTarget = { ...targetLepton };
        unit.moveTargetEntityRef = null;
      } else if (!this.targetEntityRef && !this.targetStructureRef && unit.target == null && targetLepton) {
        // Bridge cell fallback: no TS bridge object exists, so keep a coordinate
        // TarCom surrogate. Non-bridge empty cells were invalidated above.
        unit.moveTarget = { ...targetLepton };
        unit.moveTargetEntityRef = null;
      }
    }
  }

  /**
   * C++ Coordinate_Do (team.cpp:1809-1856)
   * Assign a specific mission to all members.
   */
  coordinateDo(mission: TeamMissionEntry, ctx?: TeamAIContext): void {
    // C++ team.cpp:1822-1854 Coordinate_Do does NOT blindly queue the DO
    // mission. It first lets conscripts move toward Zone, then only assigns the
    // special mission when both TarCom and NavCom are illegal. Members already
    // attacking or moving are left alone.
    const doMission = this.mapCppMission(mission.data);

    for (const unit of this._members) {
      if (!unit.alive) continue;
      this.coordinateConscript(unit, ctx);
      if (!this.isItPlaying(unit)) continue;

      const hasTarCom = (unit.target?.alive ?? false) || (unit.targetStructure?.alive ?? false);
      const hasNavCom = !!unit.moveTarget;
      if (hasTarCom || hasNavCom) continue;

      if (this.zone && leptonDist(unit.leptonX, unit.leptonY, this.zoneLeptonX, this.zoneLeptonY) > STRAY_DISTANCE * 2) {
        // C++ line 1835: regroup strays before assigning do_mission.
        assignMission(unit, Mission.MOVE);
        this.assignTeamMoveDestination(unit, {
          lx: this.zoneLeptonX,
          ly: this.zoneLeptonY,
        }, ctx);
        continue;
      }

      if (unit.mission !== doMission) {
        unit.target = null;
        unit.targetStructure = null;
        unit.moveTarget = null;
        unit.moveTargetEntityRef = null;
        assignMission(unit, doMission);
      }
    }

    // C++ team.cpp:1813-1860 Coordinate_Do does not set IsNextMission.
    // The team remains on the DO mission and keeps coordinating members there.
    // Advancing here dissolves short mission lists such as SCG06EA `inf5`
    // (MOVE, DO ATTACK), clearing member Team pointers and incorrectly routing
    // later damage through standalone FootClass retaliation instead of
    // TeamClass::Took_Damage.
  }

  /**
   * Patrol to waypoint — move but attack enemies en route
   * (C++ TMission_Patrol, team.cpp:2883)
   */
  coordinatePatrol(_waypoints?: Map<number, { cx: number; cy: number }>, ctx?: TeamAIContext): void {
    // Patrol combines MOVE + ATTACK behaviors
    // If any member is in combat, let it fight; otherwise, move toward target
    if (!this.isTargetLegal() && this.missionTarget) {
      this.copyMissionTargetToTarget();
    }
    // C++ TMission_Patrol (team.cpp:2949-2958): if Target was cleared
    // prematurely, restore the current patrol waypoint before scanning/moving.
    if (!this.isTargetLegal() && _waypoints) {
      const mission = this.missionList[this.currentMission];
      if (mission?.mission === TMISSION_PATROL) {
        const wp = _waypoints.get(mission.data);
        if (wp) {
          const cell = { cx: wp.cx, cy: wp.cy };
          const worldTarget: WorldPos = {
            x: wp.cx * CELL_SIZE + CELL_SIZE / 2,
            y: wp.cy * CELL_SIZE + CELL_SIZE / 2,
          };
          this.setMissionTarget(worldTarget, cell);
          this.setTarget(worldTarget, cell);
        }
      }
    }
    if (!this.isTargetLegal()) {
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
    // C++ Greatest_Threat doesn't consume RNG (techno.cpp:1987-2300 — pure scan).
    // Use the same cell-based THREAT_RANGE scan as Mission_Guard; do not use a
    // proximity shortcut, because C++ filters by visibility, RTTI mask, weapon
    // range, occupier LIFO order, and the TechnoClass bestval overwrite bug.
    // C++ Frame is 0-indexed (starts at 0); TS tick is 1-indexed (starts at 1).
    // C++ Frame % 14 == 0 fires at Frame 0, 14, 28, ..., 98, 112.
    // TS tick at scan fire = Frame + 1, so scan fires when (tick-1) % 14 == 0.
    const PATROL_TIME_TICKS = 14;
    if (ctx?.tick !== undefined && ctx.tick > 0 && (ctx.tick - 1) % PATROL_TIME_TICKS === 0) {
      const leader = this._members.find(m => m.alive);
      if (leader && ctx.entities && ctx.map && ctx.playerHouse !== undefined &&
          ctx.entitiesAllied && ctx.isPlayerControlled && ctx.isRevealedToHouse) {
        const threatCtx: GreatestThreatRangeContext = {
          entities: ctx.entities,
          map: ctx.map,
          tick: ctx.tick,
          playerHouse: ctx.playerHouse,
          entitiesAllied: ctx.entitiesAllied,
          isPlayerControlled: ctx.isPlayerControlled,
          isDiscoveredByPlayer: ctx.isDiscoveredByPlayer,
          isRevealedToHouse: ctx.isRevealedToHouse,
        };
        const foundThreat = greatestThreatRangeTarget(threatCtx, leader);
        if (foundThreat) {
          this.setMissionTarget(
            { x: leptonToPixel(foundThreat.leptonX), y: leptonToPixel(foundThreat.leptonY) },
            null,
            foundThreat,
          );
        } else {
          this.setMissionTarget(null);
        }
      }
    }

    if ((this.targetEntityRef && !this.isEntityTargetAssignable(this.targetEntityRef)) ||
        (this.targetStructureRef && !this.isStructureTargetAssignable(this.targetStructureRef))) {
      // C++ TeamClass can keep a raw object TARGET that TechnoClass::Assign_Target
      // would reject because the object is already zero-strength. Do not treat
      // that stale object TARGET as a coordinate move destination; the team
      // holds the target until Detach_All clears it while members finish their
      // current orders.
      return;
    }

    if (this.targetEntityRef || this.targetStructureRef) {
      this.coordinateAttack(ctx);
      return;
    }

    const targetLepton = this.targetLepton();
    if (!targetLepton) return;

    let allArrived = true;
    for (const unit of this._members) {
      if (!unit.alive) continue;
      if (this.coordinateConscript(unit, ctx)) {
        allArrived = false;
        continue;
      }
      if (!this.isItPlaying(unit)) continue;

      if (unit.mission === Mission.ATTACK && unit.target?.alive) {
        allArrived = false;
        continue; // let it fight
      }

      // C++ team.cpp:1908-1910: stray = Rule.StrayDistance; aircraft *= 3
      // Use leptonDist for C++ parity (coord.cpp Distance in lepton space)
      const stray = unit.isAirUnit ? STRAY_DISTANCE * 3 : STRAY_DISTANCE;
      const targetLX = targetLepton.lx;
      const targetLY = targetLepton.ly;
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
            // C++ Coordinate_Move calls InfantryClass::Assign_Destination.
            // infantry.cpp:1046 stops an already-driving, non-formation infantry
            // before FootClass::Assign_Destination writes the new legal NavCom;
            // infantry.cpp:1099 also clears Path[0]. coordinateMove already ports
            // this; patrol shares the same Coordinate_Move implementation in C++.
            if (unit.isDriving && !unit.formationOffset &&
                (ctx?.canStopInfantryDriverForAssignDestination?.(unit) ?? true)) {
              if (ctx?.stopInfantryDriver) {
                ctx.stopInfantryDriver(unit);
              } else {
                unit.isDriving = false;
                unit.headToLX = 0;
                unit.headToLY = 0;
                unit.doStopDriverAction(ctx?.tick ?? -1);
              }
            }
            unit.path = [];
            unit.pathIndex = 0;
            unit.moveTarget = { ...targetLepton };
            unit.moveTargetEntityRef = null;
            unit.pathThreshold = 1;
          }
        } else {
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
          const targetLXlepton = targetLepton.lx;
          const targetLYlepton = targetLepton.ly;
          const targetChanged =
            !unit.moveTarget ||
            unit.moveTargetEntityRef !== null ||
            unit.moveTarget.lx !== targetLXlepton ||
            unit.moveTarget.ly !== targetLYlepton;
          if (!targetChanged) {
            // C++ TMission_Patrol falls through to Coordinate_Move
            // (team.cpp:2995-2999). Coordinate_Move queues MISSION_MOVE when
            // needed, but calls Assign_Destination only when unit->NavCom !=
            // Target (team.cpp:1955-1977). Preserve the existing DriveClass
            // Path[] when NavCom already points at the patrol target.
            assignMission(unit, Mission.MOVE);
            allArrived = false;
            continue;
          }
          // Session 21: route through queue (Assign_Mission). Commence
          // resets Timer=0 when it pops (mission.cpp:354); manual reset
          // removed to match C++ exactly.
          assignMission(unit, Mission.MOVE);
          unit.moveTarget = { lx: targetLXlepton, ly: targetLYlepton };
          unit.moveTargetEntityRef = null;
          if (ctx?.startDriveClassMove && !unit.stats.isInfantry && !unit.isAirUnit) {
            // C++ DriveClass::Assign_Destination immediately calls Start_Of_Move
            // after clearing Path[0] (drive.cpp:638-645). Do not synthesize
            // isDriving in TeamClass; Start_Driver sets it only when a real
            // track has been selected and reserved.
            ctx.startDriveClassMove(unit);
          }
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
        // See coordinateMove for the TeamClass::Distance quirk: the distance
        // half is not a usable per-unit close-enough check in the shipped C++.
        if (unit.mission === Mission.MOVE && !unit.moveTarget) {
          assignMission(unit, Mission.GUARD);
        }
        // C++ team.cpp:1980-1985 — Coordinate_Patrol falls through the same
        // Coordinate_Move logic; legal NavCom means the patrol move is not yet
        // finished even if the unit is within stray distance of the target.
        if (unit.moveTarget) {
          allArrived = false;
        }
      }
    }

    if (allArrived) {
      this.isNextMission = true;
    }
  }

  /**
   * C++ TMission_Follow / HOUND_DOG (team.cpp:2910-2914).
   *
   * The team's zone becomes the nearest friendly foot object outside this team
   * to the linked-list head member. Members then coordinate-move toward that
   * moving object target.
   */
  private tMissionFollow(ctx?: TeamAIContext): void {
    const target = this.houndDogFollowTarget(ctx);
    if (!target) {
      this.zone = null;
      this.setTarget(null);
      return;
    }

    this.zoneLeptonX = target.leptonX;
    this.zoneLeptonY = target.leptonY;
    this.zone = {
      x: Math.trunc(target.leptonX * 24 / 256),
      y: Math.trunc(target.leptonY * 24 / 256),
    };
    this.setTarget({ x: target.pos.x, y: target.pos.y }, null, target);
    this.coordinateMove(undefined, ctx);
  }

  /**
   * C++ TMission_Unload (team.cpp:2110-2176)
   * Tell transports to unload passengers.
   */
  tMissionUnload(ctx?: TeamAIContext): void {
    let finished = true;
    for (const unit of this._members) {
      if (!unit.alive) continue;
      if (unit.passengers && unit.passengers.length > 0) {
        // C++ team.cpp:2148-2152: do this even while aircraft are landing.
        // AircraftClass::AI's Commence gate handles IsLanding/IsTakingOff; the
        // team mission does not wait for a TS aircraft state label.
        if (unit.mission !== Mission.UNLOAD) {
          unit.moveTarget = null;          // Assign_Destination(TARGET_NONE)
          unit.moveTargetEntityRef = null;
          unit.target = null;              // Assign_Target(TARGET_NONE)
          unit.targetStructure = null;
          const alreadyQueuedUnload = unit.missionQueue === Mission.UNLOAD;
          assignMission(unit, Mission.UNLOAD);
          if (!alreadyQueuedUnload && unit.missionQueue === Mission.UNLOAD) {
            unit.missionQueueSetTick = ctx?.tick ?? -1;
          }
        }
        finished = false;
      } else if (unit.isALoaner) {
        // C++ team.cpp:2165-2170 — once a loaner transport has offloaded all
        // cargo, remove it from the team and immediately start RETREAT.
        this.remove(unit);
        assignMission(unit, Mission.RETREAT);
        commence(unit, 'TeamClass::TMission_Unload loaner retreat');
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
    let finished = true;
    for (const unit of this._members) {
      if (!unit.alive) continue;
      if (unit.type === UnitType.V_MCV) {
        if (unit.mission !== Mission.UNLOAD) {
          unit.moveTarget = null;
          unit.moveTargetEntityRef = null;
          unit.target = null;
          unit.targetStructure = null;
          assignMission(unit, Mission.UNLOAD);
          finished = false;
        }
      }
      if (unit.type === UnitType.V_MNLY && unit.ammo !== 0) {
        if (unit.mission !== Mission.UNLOAD) {
          unit.moveTarget = null;
          unit.moveTargetEntityRef = null;
          unit.target = null;
          unit.targetStructure = null;
          assignMission(unit, Mission.UNLOAD);
          finished = false;
        }
      }
    }
    if (finished) {
      this.isNextMission = true;
    }
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
  tookDamage(member: Entity, source: Entity | MapStructure | null, ctx?: Pick<TeamAIContext, 'entities'>): void {
    if (this.isSuicide) return;
    if (!source || !source.alive) return;
    const sourceIsEntity = source instanceof Entity;
    if (sourceIsEntity && this._members.includes(source)) return; // don't target own team

    const head = this._members.find(m => m.alive);
    if (!head) return;
    // C++ team.cpp:1587-1589 — moving teams respond to attacks, but not if
    // the team head is aircraft or an LST/transport vessel.
    if (head.stats.isAircraft || (head.stats.isVessel && head.isTransport)) return;

    // C++ team.cpp:1606-1610 — don't change to sources the team member class
    // cannot normally attack.
    if (sourceIsEntity) {
      if (source.isAirUnit) return;
      if (source.stats.isVessel && !head.stats.isVessel) return;
    }

    // C++ team.cpp:1596-1603 — don't shuffle away from an existing armed
    // target if that target can fire on the team zone.
    if (this.targetEntityRef?.alive && this.targetEntityRef.weapon) {
      if (this.primaryWeaponInRangeOfTeamZone(this.targetEntityRef)) {
        return;
      }
    }
    if (this.targetStructureRef?.alive && this.targetStructureRef.weapon) {
      if (this.structurePrimaryWeaponInRangeOfTeamZone(this.targetStructureRef)) {
        return;
      }
    }

    // C++ team.cpp:1590-1613 — moving teams retarget to their attacker.
    // This updates Team::Target, not the individual member TarCom. The current
    // mission target remains unchanged, so later code can resume the scripted
    // destination after the immediate threat is handled.
    if (this.isMoving) {
      if (sourceIsEntity) {
        this.setTarget({ x: source.pos.x, y: source.pos.y }, null, source);
      } else {
        const center = cppStructureCenterLeptons(source);
        this.setTarget({
          x: center.lx * CELL_SIZE / LEPTON_SIZE,
          y: center.ly * CELL_SIZE / LEPTON_SIZE,
        }, null, null, source);
      }
    }
  }

  // ── Internal helpers ──

  private teamZoneLeptons(): LeptonPos {
    return this.zone ? { lx: this.zoneLeptonX, ly: this.zoneLeptonY } : { lx: 0, ly: 0 };
  }

  /** C++ TechnoClass::In_Range(As_Coord(Team::Zone), 0). */
  private primaryWeaponInRangeOfTeamZone(entity: Entity): boolean {
    const weapon = entity.weapon;
    if (!weapon) return false;
    const zone = this.teamZoneLeptons();
    const fire = entity.fireCoordForWeapon(weapon);
    return leptonDist(fire.lx, fire.ly, zone.lx, zone.ly) <= weapon.range * LEPTON_SIZE;
  }

  /** C++ TechnoClass::In_Range(As_Coord(Team::Zone), 0) for structure targets.
   *  The full building Fire_Coord offsets live in combat.ts; using the C++
   *  structure center here still fixes the unit mismatch and keeps this module
   *  free of a team/combat import cycle. */
  private structurePrimaryWeaponInRangeOfTeamZone(structure: MapStructure): boolean {
    const weapon = structure.weapon;
    if (!weapon) return false;
    const zone = this.teamZoneLeptons();
    const fire = cppStructureCenterLeptons(structure);
    return leptonDist(fire.lx, fire.ly, zone.lx, zone.ly) <= weapon.range * LEPTON_SIZE;
  }

  private setTarget(
    newTarget: WorldPos | null,
    cell: CellPos | null = null,
    entityRef: Entity | null = null,
    structureRef: MapStructure | null = null,
  ): void {
    this.target = newTarget ? { ...newTarget } : null;
    this.targetCell = cell ? { ...cell } : null;
    this.targetEntityRef = entityRef;
    this.targetStructureRef = structureRef;
  }

  private copyMissionTargetToTarget(): void {
    this.setTarget(
      this.missionTarget,
      this.missionTargetCell,
      this.missionTargetEntityRef,
      this.missionTargetStructureRef,
    );
  }

  /** C++ team.cpp:1652-1672 — non-air teams attacking a cell first convert the
   * cell target into its Cell_Object target; empty non-bridge cells invalidate
   * Target so the team advances to the next mission. */
  private resolveCellAttackTarget(ctx?: TeamAIContext): void {
    if (!this.targetCell || !this.target) return;
    if (!ctx) return;

    const leader = this.fetchLeader();
    if (!leader || leader.isAirUnit) return;

    const cell = this.targetCell;
    const entityTarget = ctx.entities?.find(e =>
      e.occupiesCppLogic() &&
      !e.isAirUnit &&
      e.cell.cx === cell.cx &&
      e.cell.cy === cell.cy);
    if (entityTarget) {
      this.setTarget({ x: entityTarget.pos.x, y: entityTarget.pos.y }, null, entityTarget);
      return;
    }

    const structureTarget = this.structureAtCell(ctx.structures, cell);
    if (structureTarget) {
      const [w, h] = STRUCTURE_SIZE[structureTarget.type] ?? [1, 1];
      this.setTarget({
        x: (structureTarget.cx + w / 2) * CELL_SIZE,
        y: (structureTarget.cy + h / 2) * CELL_SIZE,
      }, null, null, structureTarget);
      return;
    }

    if (ctx.map?.isBridgeCell(cell.cx, cell.cy)) {
      return;
    }

    this.setTarget(null);
  }

  private structureAtCell(structures: MapStructure[] | undefined, cell: CellPos): MapStructure | null {
    if (!structures) return null;
    for (const s of structures) {
      if (!this.structureOccupiesCellObjectChain(s)) continue;
      const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
      if (cell.cx >= s.cx && cell.cx < s.cx + w &&
          cell.cy >= s.cy && cell.cy < s.cy + h) {
        return s;
      }
    }
    return null;
  }

  private structureOccupiesCellObjectChain(s: MapStructure): boolean {
    return s.alive || (!s.debrisDropped && s.debrisCountdown !== undefined);
  }

  private isStructureTargetAssignable(s: MapStructure): boolean {
    return s.alive && s.hp > 0;
  }

  private isEntityTargetAssignable(e: Entity): boolean {
    return e.alive && e.hp > 0 && !e.inLimbo;
  }

  /** C++ TeamClass::Fetch_A_Leader (team.cpp:3070-3092).
   *  Prefer the first active, initiated, weapon-equipped member; if none exists,
   *  fall back to the first member in the linked list. This matters for mixed
   *  aircraft/passenger teams: the BADR remains the leader while paradropping,
   *  so attack-waypoint cells are not converted to Cell_Object targets. */
  private fetchLeader(): Entity | null {
    for (const m of this._members) {
      if (this.isItPlaying(m) && m.weapon) return m;
    }
    return this._members[0] ?? null;
  }

  /** C++ TeamClass::Detach (team.cpp:1348-1363).
   *  Called from ObjectClass::Detach_All/Detach_This_From_All when a target is
   *  removed from targeting systems, including TechnoClass::Do_Cloak()
   *  (techno.cpp:4144-4150, all=false). If the team Target points at that
   *  techno, clear it so the next mission coordinator falls back to
   *  MissionTarget. */
  detachTargetEntity(target: Entity): void {
    if (this.targetEntityRef === target) {
      this.setTarget(null);
    }
    if (this.missionTargetEntityRef === target) {
      this.missionTarget = null;
      this.missionTargetCell = null;
      this.missionTargetEntityRef = null;
      this.missionTargetStructureRef = null;
    }
  }

  detachTargetStructure(target: MapStructure): void {
    if (this.targetStructureRef === target) {
      this.setTarget(null);
    }
    if (this.missionTargetStructureRef === target) {
      this.missionTarget = null;
      this.missionTargetCell = null;
      this.missionTargetEntityRef = null;
      this.missionTargetStructureRef = null;
    }
  }

  detachTargetCell(cell: CellPos): void {
    if (this.targetCell?.cx === cell.cx && this.targetCell.cy === cell.cy) {
      this.setTarget(null);
    }
    if (this.missionTargetCell?.cx === cell.cx && this.missionTargetCell.cy === cell.cy) {
      this.missionTarget = null;
      this.missionTargetCell = null;
      this.missionTargetEntityRef = null;
      this.missionTargetStructureRef = null;
    }
  }

  private isTargetLegal(): boolean {
    // C++ builds use the inline Target_Legal from function.h:
    //   target != TARGET_NONE
    // The stronger target.cpp implementation that checks Strength/limbo is
    // behind #ifdef NEVER. Team logic therefore treats a non-empty TARGET as
    // legal until Detach_All explicitly clears it.
    return this.target !== null;
  }

  private targetLepton(): LeptonPos | null {
    if (!this.isTargetLegal()) return null;
    const target = this.target;
    if (this.targetEntityRef) {
      return { lx: this.targetEntityRef.leptonX, ly: this.targetEntityRef.leptonY };
    }
    if (this.targetStructureRef) {
      const [w, h] = STRUCTURE_SIZE[this.targetStructureRef.type] ?? [1, 1];
      return {
        lx: Math.trunc((this.targetStructureRef.cx + w / 2) * LEPTON_SIZE),
        ly: Math.trunc((this.targetStructureRef.cy + h / 2) * LEPTON_SIZE),
      };
    }
    if (this.targetCell) {
      return cellTargetToLepton(this.targetCell.cx, this.targetCell.cy);
    }
    if (!target) return null;
    return { lx: pixelToLepton(target.x), ly: pixelToLepton(target.y) };
  }

  private missionTargetLepton(): LeptonPos | null {
    if (!this.missionTarget) return null;
    if (this.missionTargetEntityRef) {
      return { lx: this.missionTargetEntityRef.leptonX, ly: this.missionTargetEntityRef.leptonY };
    }
    if (this.missionTargetStructureRef) {
      const [w, h] = STRUCTURE_SIZE[this.missionTargetStructureRef.type] ?? [1, 1];
      return {
        lx: Math.trunc((this.missionTargetStructureRef.cx + w / 2) * LEPTON_SIZE),
        ly: Math.trunc((this.missionTargetStructureRef.cy + h / 2) * LEPTON_SIZE),
      };
    }
    if (this.missionTargetCell) {
      return cellTargetToLepton(this.missionTargetCell.cx, this.missionTargetCell.cy);
    }
    return { lx: pixelToLepton(this.missionTarget.x), ly: pixelToLepton(this.missionTarget.y) };
  }

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
  calcCenter(ctx?: TeamAIContext): void {
    const currentMission = this.missionList[this.currentMission];
    if (currentMission?.mission === TMISSION_HOUND_DOG) {
      const target = this.houndDogFollowTarget(ctx);
      if (!target) {
        this.zone = null;
        return;
      }
      this.zoneLeptonX = target.leptonX;
      this.zoneLeptonY = target.leptonY;
      this.zone = {
        x: Math.trunc(target.leptonX * 24 / 256),
        y: Math.trunc(target.leptonY * 24 / 256),
      };
      return;
    }

    // C++ team.cpp:1495-1517 — Calc_Center only counts _Is_It_Playing
    // members (breathing + initiated, or aircraft). New recruits that have
    // not reached the team center do not pull the regroup zone toward
    // themselves.
    const playing = this._members.filter(m => this.isItPlaying(m));
    if (playing.length === 0) {
      this.zone = null;
      return;
    }

    // C++ team.cpp:1390 Calc_Center uses lepton coordinates.
    // Compute average in lepton space, then convert to pixel WorldPos.
    let lx = 0, ly = 0;
    let closest: Entity | null = null;
    let closestDist = Infinity;
    const targetLepton = this.targetLepton();
    const distanceAnchor = targetLepton ?? { lx: 0, ly: 0 };
    for (const m of playing) {
      lx += m.leptonX;
      ly += m.leptonY;
      const d = leptonDist(m.leptonX, m.leptonY, distanceAnchor.lx, distanceAnchor.ly);
      if (closest === null || d < closestDist) {
        closest = m;
        closestDist = d;
      }
    }
    lx = Math.trunc(lx / playing.length);
    ly = Math.trunc(ly / playing.length);

    // C++ team.cpp:1578 — this is intentionally inverted by the C++ source:
    // `if (!closest->Can_Enter_Cell(As_Cell(center)))`. MOVE_OK is enum value
    // 0, so an enterable averaged center falls back to the closest member's
    // CELL target, while non-OK results keep the averaged center.
    if (closest && ctx?.canEnterCell) {
      const centerCx = Math.floor(leptonToPixel(lx) / CELL_SIZE);
      const centerCy = Math.floor(leptonToPixel(ly) / CELL_SIZE);
      if (ctx.canEnterCell(closest, centerCx, centerCy)) {
        const closestCellTarget = cellTargetToLepton(closest.cell.cx, closest.cell.cy);
        lx = closestCellTarget.lx;
        ly = closestCellTarget.ly;
      }
    }

    this.zoneLeptonX = lx;
    this.zoneLeptonY = ly;
    this.zone = { x: Math.trunc(lx * 24 / 256), y: Math.trunc(ly * 24 / 256) };
  }

  /** C++ Calc_Center HOUND_DOG branch scans Units, Infantry, then Vessels. */
  private houndDogFollowTarget(ctx?: TeamAIContext): Entity | null {
    // C++ Calc_Center uses TeamClass::Member as the HOUND_DOG anchor. For
    // reinforcement teams TS preserves coordinator iteration order in
    // `_members`, while the C++ linked member head corresponds to the tail of
    // this array after the reinforcement object-list reversal. Use that C++
    // anchor for follow-target selection without changing team iteration order.
    const head = this._members[this._members.length - 1];
    if (!head || !ctx?.entities) return null;

    let closest: Entity | null = null;
    let closestDist = -1;
    const consider = (candidate: Entity): void => {
      if (!candidate.alive || candidate.inLimbo || candidate.transportRef) return;
      if (candidate.teamRef === this) return;
      const allied = ctx.housesAllied
        ? ctx.housesAllied(candidate.house, this.house)
        : candidate.house === this.house;
      if (!allied) return;
      const dist = leptonDist(head.leptonX, head.leptonY, candidate.leptonX, candidate.leptonY);
      if (closestDist === -1 || dist < closestDist) {
        closestDist = dist;
        closest = candidate;
      }
    };

    // C++ scans Units.Count(), then Infantry.Count(), then Vessels.Count().
    // Equal distances keep the first object found because the comparison is
    // strict `<`. TS entity storage can be member/reinforcement ordered, so
    // sort each RTTI bucket by creation id to mirror the object vectors.
    const cxxObjectOrder = (a: Entity, b: Entity): number => a.id - b.id;
    const scanBucket = (predicate: (candidate: Entity) => boolean): void => {
      for (const candidate of ctx.entities!.filter(predicate).sort(cxxObjectOrder)) {
        consider(candidate);
      }
    };

    scanBucket(candidate =>
      !candidate.stats.isInfantry && !candidate.stats.isAircraft && !candidate.stats.isVessel);
    scanBucket(candidate => candidate.stats.isInfantry);
    scanBucket(candidate => candidate.stats.isVessel);

    return closest;
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
  private setMissionTarget(
    newTarget: WorldPos | null,
    cell: CellPos | null = null,
    entityRef: Entity | null = null,
    structureRef: MapStructure | null = null,
  ): void {
    const oldTarget = this.missionTarget;
    const oldEntityRef = this.missionTargetEntityRef;
    const oldStructureRef = this.missionTargetStructureRef;
    if (oldTarget) {
      // Convert old target to lepton target cell for NavCom comparison.
      const oldTargetLepton = this.missionTargetLepton();
      const oldTargetLX = oldTargetLepton ? oldTargetLepton.lx : pixelToLepton(oldTarget.x);
      const oldTargetLY = oldTargetLepton ? oldTargetLepton.ly : pixelToLepton(oldTarget.y);
      for (const unit of this._members) {
        if (!unit.alive) continue;
        const navMatch = unit.moveTarget && (oldEntityRef
          ? unit.moveTargetEntityRef === oldEntityRef
          : unit.moveTarget.lx === oldTargetLX && unit.moveTarget.ly === oldTargetLY);
        const tarMatch = oldEntityRef
          ? unit.target === oldEntityRef
          : oldStructureRef
            ? unit.targetStructure === oldStructureRef
            : !!(unit.target &&
                oldTarget.x === Math.trunc(unit.target.leptonX * CELL_SIZE / LEPTON_SIZE) &&
                oldTarget.y === Math.trunc(unit.target.leptonY * CELL_SIZE / LEPTON_SIZE));
        if (navMatch || tarMatch) {
          assignMission(unit, Mission.GUARD);
          if (navMatch) {
            unit.moveTarget = null;
            unit.moveTargetEntityRef = null;
            unit.path = [];
            unit.pathIndex = 0;
          }
          if (tarMatch) {
            unit.target = null;
            unit.targetStructure = null;
          }
        }
      }
    }

    const targetWasMissionTarget =
      (oldEntityRef !== null && this.targetEntityRef === oldEntityRef) ||
      (oldStructureRef !== null && this.targetStructureRef === oldStructureRef) ||
      (!!this.target && !!this.missionTarget &&
        this.target.x === this.missionTarget.x && this.target.y === this.missionTarget.y);

    if (targetWasMissionTarget || !this.isTargetLegal()) {
      this.missionTarget = newTarget;
      this.missionTargetCell = cell ? { ...cell } : null;
      this.missionTargetEntityRef = entityRef;
      this.missionTargetStructureRef = structureRef;
      this.setTarget(newTarget, cell, entityRef, structureRef);
    } else {
      this.missionTarget = newTarget;
      this.missionTargetCell = cell ? { ...cell } : null;
      this.missionTargetEntityRef = entityRef;
      this.missionTargetStructureRef = structureRef;
    }
  }

  /**
   * Dissolve the team — remove all member references, mark as dissolved.
   * (C++ team.cpp:292-312 destructor + team.cpp:560 delete this)
   */
  dissolve(ctx?: TeamAIContext): void {
    for (const m of this._members) {
      m.teamRef = null;
      m.teamInitiated = false;
      this.enterIdleAfterTeamRelease(m, ctx);
    }
    this._members = [];
    this.dissolved = true;
  }

  /**
   * C++ team.cpp:1139 — TeamClass::Remove calls the member's virtual
   * Enter_Idle_Mode() after clearing Team. InfantryClass::Enter_Idle_Mode
   * (infantry.cpp:1663-1721) checks TarCom before NavCom; if an infantryman is
   * already attacking a legal target, Assign_Mission(MISSION_ATTACK) is a true
   * no-op and preserves any existing MissionQueue.
   */
  private enterIdleAfterTeamRelease(entity: Entity, ctx?: TeamAIContext): void {
    if (!entity.alive || entity.mission === Mission.RETREAT) return;

    if (entity.stats.isAircraft && entity.isFixedWing) {
      this.enterFixedWingIdleAfterTeamRelease(entity, ctx);
      return;
    }

    if (entity.stats.isInfantry) {
      const hasLegalTarget = (entity.target?.alive ?? false) || (entity.targetStructure?.alive ?? false);
      if (hasLegalTarget) {
        let order = Mission.ATTACK;
        if (entity.mission === Mission.SABOTAGE || entity.mission === Mission.CAPTURE) {
          order = entity.mission;
        }
        assignMission(entity, order);
        return;
      }

      if (entity.moveTarget) {
        let order = Mission.MOVE;
        if (entity.mission === Mission.SABOTAGE || entity.mission === Mission.CAPTURE) {
          order = entity.mission;
        }
        assignMission(entity, order);
        return;
      }
    } else {
      // C++ UnitClass::Enter_Idle_Mode (unit.cpp:1300-1303) consumes the
      // IsToScatter flag set by LST unload (vessel.cpp:1779) before selecting
      // the idle mission:
      //
      //   if (IsToScatter) { IsToScatter = false; Scatter(0, true); }
      //
      // UnitClass::Scatter(0,true) assigns NavCom via
      // Map.Nearby_Location(Coord_Cell(Coord), Class->Speed), then
      // Enter_Idle_Mode sees Target_Legal(NavCom) and Assign_Mission(MOVE).
      // Team dissolution uses this same virtual Enter_Idle_Mode path in C++
      // (team.cpp destructor/Remove), so cargo that just left an LST keeps
      // rolling to a nearby clear spot instead of idling into GUARD.
      if (!entity.isAirUnit && !entity.isNavalUnit && entity.isToScatter) {
        entity.isToScatter = false;
        if (!entity.moveTarget && ctx?.map) {
          const nearby = nearbyLocation(
            ctx.map,
            entity.cell,
            false,
            Math.max(0, (ctx.tick ?? 1) - 1),
          );
          if (nearby) {
            entity.moveTarget = cellTargetToLepton(nearby.cx, nearby.cy);
            entity.pathThreshold = MoveResult.CLOAK;
            if (!entity.isDriving && entity.mission !== Mission.UNLOAD) {
              ctx.startDriveClassMove?.(entity);
            }
          }
        }
      }

      if (entity.moveTarget) {
        assignMission(entity, Mission.MOVE);
        return;
      }
    }

    if (!entity.stats.isInfantry && entity.moveTarget) {
      assignMission(entity, Mission.MOVE);
      return;
    }

    const control = MISSION_CONTROL[entity.mission];
    if (
      entity.mission === Mission.GUARD ||
      entity.mission === Mission.AREA_GUARD ||
      control?.isParalyzed ||
      control?.isZombie
    ) {
      return;
    }
    assignMission(entity, Mission.GUARD);
  }

  /**
   * C++ AircraftClass::Enter_Idle_Mode fixed-wing branch (aircraft.cpp:1893-1940).
   * TeamClass::Remove clears Team before invoking the virtual idle handler, so a
   * released YAK/MIG must seek an owned airstrip via MISSION_ENTER rather than
   * falling through the generic GUARD path.
   */
  private enterFixedWingIdleAfterTeamRelease(entity: Entity, ctx?: TeamAIContext): void {
    const onGround = entity.flightAltitude <= 0 || entity.aircraftState === 'landed';

    if (onGround) {
      entity.moveTarget = null;
      entity.moveTargetEntityRef = null;
      entity.target = null;
      entity.targetStructure = null;
      assignMission(entity, entity.isALoaner ? Mission.RETREAT : Mission.GUARD);
      commence(entity, 'AircraftClass::Enter_Idle_Mode fixed-wing ground');
      return;
    }

    if (entity.isALoaner && entity.ammo === 0 && entity.weapon) {
      entity.moveTarget = null;
      entity.moveTargetEntityRef = null;
      assignMission(entity, Mission.HUNT);
      commence(entity, 'AircraftClass::Enter_Idle_Mode fixed-wing loaner empty');
      return;
    }

    if (!entity.isALoaner) {
      const padIdx = this.findOwnedAircraftDockingBay(entity, ctx);
      entity.moveTarget = null;
      entity.moveTargetEntityRef = null;
      if (padIdx >= 0 && ctx?.structures) {
        entity.aircraftDockingStructure = padIdx;
        entity.aircraftEnterStatus = 0;
        entity.aircraftState = 'returning';
        ctx.structures[padIdx].dockedAircraft = entity.id;
        assignMission(entity, Mission.ENTER);
      } else {
        entity.aircraftDockingStructure = -1;
        entity.aircraftState = 'flying';
        assignMission(entity, Mission.RETREAT);
      }
      commence(entity, 'AircraftClass::Enter_Idle_Mode fixed-wing airborne');
      return;
    }

    entity.moveTarget = null;
    entity.moveTargetEntityRef = null;
    entity.aircraftState = 'flying';
    assignMission(entity, Mission.GUARD);
    commence(entity, 'AircraftClass::Enter_Idle_Mode fixed-wing loaner guard');
  }

  private findOwnedAircraftDockingBay(entity: Entity, ctx?: TeamAIContext): number {
    const padType = entity.stats.landingBuilding;
    if (!padType || !ctx?.structures) return -1;

    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < ctx.structures.length; i++) {
      const s = ctx.structures[i];
      if (!s.alive || s.type !== padType || s.house !== entity.house) continue;
      if (s.dockedAircraft !== undefined && s.dockedAircraft > 0 && s.dockedAircraft !== entity.id) continue;

      const center = cppStructureCenterLeptons(s);
      const dist = leptonDist(entity.leptonX, entity.leptonY, center.lx, center.ly);
      if (bestDist === -1 || dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
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
      case 3: return Mission.QMOVE;
      case 4: return Mission.RETREAT;
      case 5: return Mission.GUARD;
      case 6: return Mission.STICKY;
      case 7: return Mission.ENTER;
      case 8: return Mission.CAPTURE;
      case 9: return Mission.HARVEST;
      case 10: return Mission.AREA_GUARD;
      case 11: return Mission.RETURN;
      case 12: return Mission.STOP;
      case 13: return Mission.AMBUSH;
      case 14: return Mission.HUNT;
      case 15: return Mission.UNLOAD;
      case 16: return Mission.SABOTAGE;
      case 17: return Mission.CONSTRUCTION;
      case 18: return Mission.DECONSTRUCTION;
      case 19: return Mission.REPAIR;
      case 20: return Mission.RESCUE;
      case 21: return Mission.MISSILE;
      case 22: return Mission.HARMLESS;
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
  for (let i = 0; i < _activeTeams.length; i++) {
    const team = _activeTeams[i];
    if (!team.dissolved) {
      team.ai(waypoints, ctx);
    }
    if (team.dissolved && _activeTeams[i] === team) {
      // C++ logic.cpp:269 iterates Teams[] by index. TeamClass::AI can delete
      // itself, and Teams.Free compacts the heap immediately; the for-loop then
      // increments and skips the team that shifted into this slot.
      _activeTeams.splice(i, 1);
    }
  }
  cleanupTeams();
}

/** C++ TeamClass::Suspend_Teams (team.cpp:2365-2383).
 *  Base defense removes every member from teams below Rule.SuspendPriority,
 *  then suspends the empty team for Rule.SuspendDelay minutes. The released
 *  members keep any active NavCom/path and continue under their own mission AI.
 */
export function suspendTeamsByPriority(
  house: House,
  priority: number,
  suspendDelayTicks = 2 * 900, // Rule.SuspendDelay=2, TICKS_PER_MINUTE=900
  ctx?: TeamAIContext,
): void {
  for (const team of _activeTeams) {
    if (team.dissolved || team.house !== house || team.recruitPriority >= priority) continue;
    while (team.members.length > 0) {
      team.remove(team.members[0], ctx);
    }
    team.isAltered = true;
    team.suspendTimer = suspendDelayTicks;
    team.suspended = true;
  }
}
