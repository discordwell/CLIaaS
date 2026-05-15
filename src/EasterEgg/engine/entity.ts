/**
 * Entity system — units, structures, and their state.
 */

import {
  type WorldPos, type CellPos, type UnitStats, type WeaponStats,
  type WarheadProps, type WarheadType, type ArmorType, type LeptonPos,
  Dir, Mission, AnimState, House, UnitType, Stance,
  UNIT_STATS, WEAPON_STATS, CELL_SIZE, MPH_TO_PX,
  SpeedClass,
  INFANTRY_ANIMS, INFANTRY_SHAPE, BODY_SHAPE, ANT_ANIM, WARHEAD_PROPS,
  WARHEAD_VS_ARMOR, PRONE_DAMAGE_BIAS, CONDITION_RED, CONDITION_YELLOW,
  CIVILIAN_UNIT_TYPES, worldToCell, leptonDist, directionTo, directionToLeptons,
  directionToLeptons256, DIR_DX, DIR_DY,
  armorIndex, PRODUCTION_ITEMS, LEPTON_SIZE, pixelToLepton,
  COS_TABLE_256, SIN_TABLE_256,
} from './types';
import { LP, PIXEL_LEPTON_W } from './tracks';
import { ScenarioRandom, NonCriticalRandom } from './random';
import { RANDOM_ANIMATE_CPP_FAITHFUL } from './perCellProcess';

// === C++ Points lookup (techno.cpp:6290: Risk = Reward = Points) ===
// Used by threatScore() to compute C++ Value() = Risk + Reward = 2 * Points
const UNIT_POINTS: Record<string, number> = {};
for (const item of PRODUCTION_ITEMS) {
  UNIT_POINTS[item.type] = item.points ?? item.cost;
}

function technoBaseValue(entity: Entity): number {
  const points = entity.stats.points ?? UNIT_POINTS[entity.type] ?? entity.stats.strength;
  return Math.trunc(points * 2);
}

function technoValue(entity: Entity, includeTransportContents: boolean, seen = new Set<number>()): number {
  if (seen.has(entity.id)) return 0;
  seen.add(entity.id);

  let value = technoBaseValue(entity);

  // C++ techno.cpp:4549-4566 — TechnoClass::Value includes attached cargo
  // only when Rule.Diff[House->Difficulty].IsContentScan or House->IQ >=
  // Rule.IQContentScan. Crew.Kills is not part of Value(); Evaluate_Object
  // adds the root object's Crew.Kills separately.
  if (includeTransportContents && entity.passengers.length > 0) {
    for (const passenger of entity.passengers) {
      value += technoValue(passenger, includeTransportContents, seen);
    }
  }

  return value;
}

interface FireCoordOffsets {
  vertical: number;
  primary: number;
  lateral: number;
  secondary: number;
  secondaryLateral: number;
}

const INFANTRY_FIRE_COORD_OFFSETS: FireCoordOffsets = {
  vertical: 0x0035, // idata.cpp:394 et al.
  primary: 0x0010,  // idata.cpp:395 et al.
  lateral: 0x0000,
  secondary: 0x0000,
  secondaryLateral: 0x0000,
};

const DOG_FIRE_COORD_OFFSETS: FireCoordOffsets = {
  vertical: 0x0015, // idata.cpp:374
  primary: 0x0010,  // idata.cpp:375
  lateral: 0x0000,
  secondary: 0x0000,
  secondaryLateral: 0x0000,
};

// C++ udata.cpp UnitTypeClass constructor offsets and aadata.cpp
// AircraftTypeClass constructor offsets:
//   VerticalOffset, PrimaryOffset, PrimaryLateral, SecondaryOffset, SecondaryLateral.
// TechnoClass::Fire_Coord uses these for vehicle launch/range coordinates.
const UNIT_FIRE_COORD_OFFSETS: Partial<Record<UnitType, FireCoordOffsets>> = {
  [UnitType.V_V2RL]: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_1TNK]: { vertical: 0x0020, primary: 0x00C0, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_3TNK]: { vertical: 0x0040, primary: 0x0080, lateral: 0x0018, secondary: 0x0080, secondaryLateral: 0x0018 },
  [UnitType.V_2TNK]: { vertical: 0x0030, primary: 0x00C0, lateral: 0x0000, secondary: 0x00C0, secondaryLateral: 0x0000 },
  [UnitType.V_4TNK]: { vertical: 0x0020, primary: 0x00C0, lateral: 0x0028, secondary: 0x0008, secondaryLateral: 0x0040 },
  [UnitType.V_MRJ]:  { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_MGG]:  { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_ARTY]: { vertical: 0x0040, primary: 0x0060, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_HARV]: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_MCV]:  { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_JEEP]: { vertical: 0x0030, primary: 0x0030, lateral: 0x0000, secondary: 0x0030, secondaryLateral: 0x0000 },
  [UnitType.V_APC]:  { vertical: 0x0030, primary: 0x0030, lateral: 0x0000, secondary: 0x0030, secondaryLateral: 0x0000 },
  [UnitType.V_MNLY]: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_TRUK]: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_CTNK]: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_TTNK]: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_QTNK]: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_DTRK]: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_STNK]: { vertical: 0x0030, primary: 0x0030, lateral: 0x0000, secondary: 0x0030, secondaryLateral: 0x0000 },
  [UnitType.V_BADR]: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_U2]:   { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_MIG]:  { vertical: 0x0000, primary: 0x0020, lateral: 0x0020, secondary: 0x0020, secondaryLateral: 0x0020 },
  [UnitType.V_YAK]:  { vertical: 0x0000, primary: 0x0020, lateral: 0x0020, secondary: 0x0020, secondaryLateral: 0x0020 },
  [UnitType.V_TRAN]: { vertical: 0x0000, primary: 0x0000, lateral: 0x0000, secondary: 0x0000, secondaryLateral: 0x0000 },
  [UnitType.V_HELI]: { vertical: 0x0000, primary: 0x0040, lateral: 0x0000, secondary: 0x0040, secondaryLateral: 0x0000 },
  [UnitType.V_HIND]: { vertical: 0x0000, primary: 0x0040, lateral: 0x0000, secondary: 0x0040, secondaryLateral: 0x0000 },
};

// === Submarine Cloak State Machine ===
export enum CloakState {
  UNCLOAKED = 0,
  CLOAKING = 1,
  CLOAKED = 2,
  UNCLOAKING = 3,
}

/** Frames for cloak/uncloak transition (~2.5 seconds at 15 FPS, C++ CLOAK_STAGES) */
export const CLOAK_TRANSITION_FRAMES = 38;

/** Frames before recloak allowed after sonar detection (15 seconds at 15 FPS, C++ SONAR_TIME) */
export const SONAR_PULSE_DURATION = 225;

/** C++ techno.cpp:2468: CloakDelay = Rule.CloakDelay * TICKS_PER_MINUTE
 *  Rule.CloakDelay is read from RULES.INI "SubmergeDelay=.02".
 *  .02 * 900 (TICKS_PER_MINUTE at 15Hz) = 18 ticks. Prevents immediate recloak after uncloaking. */
export const CLOAK_DELAY_TICKS = 18;

// Structure reference is typed loosely to avoid circular dependency with scenario.ts
export interface StructureRef {
  alive: boolean;
  cx: number;
  cy: number;
  type?: string;
  house?: string; // optional house for defense targeting retaliation check
}

export interface TeamMissionEntry {
  mission: number;  // TMISSION_* type
  data: number;     // waypoint index or other param
}


let nextId = 1;

export function resetEntityIds(): void {
  nextId = 1;
}

// Dynamic player house set — updated by Game.start() for each scenario.
// Used by Entity.isPlayerUnit so all existing code that checks isPlayerUnit
// works correctly for both ant missions and campaign missions.
let _playerHouses: Set<House> = new Set([House.Spain, House.Greece]);

/** Set the player-controlled houses for the current scenario.
 *  Called by Game.start() after loading the scenario and building alliances. */
export function setPlayerHouses(houses: Set<House>): void {
  _playerHouses = houses;
}

/** Get the current player houses set (for renderer and other modules) */
export function getPlayerHouses(): Set<House> {
  return _playerHouses;
}

/** C++ inline.h:630 Dir_Facing — round 256-step DirType to 8-way FacingType. */
export function dir256ToFacing8(dir: number): Dir {
  return ((((dir + 0x10) & 0xff) >> 5) % 8) as Dir;
}

/** C++ coord.cpp Dir_To_32 equivalent for visual body facing. */
export function dir256ToFacing32(dir: number): number {
  return (((dir + 4) & 0xff) >> 3) % 32;
}

export class Entity {
  id = nextId++;
  type: UnitType;
  stats: UnitStats;
  house: House;

  // Position — pixel coordinates derived from integer leptons each tick.
  pos: WorldPos;
  // Integer lepton coordinates — C++ COORDINATE parity.
  // 1 cell = 256 leptons. All movement math operates on these.
  // pos.x/pos.y are derived via pos.x = leptonX * LP each tick.
  leptonX = 0;
  leptonY = 0;
  facing: Dir = Dir.N;
  desiredFacing: Dir = Dir.N; // target facing for gradual rotation
  turretFacing: Dir = Dir.N;  // turret direction (for turreted vehicles)
  desiredTurretFacing: Dir = Dir.N; // target turret facing for gradual rotation

  // C++ 256-step facing for aircraft (coord.cpp DirType 0-255).
  // 0=N, 64=E, 128=S, 192=W. Used for precise curved flight paths.
  facing256 = -1;          // -1 = not using 256-step (ground units); 0-255 for aircraft
  desiredFacing256 = -1;   // -1 = not active

  // Health
  hp: number;
  maxHp: number;
  alive = true;

  // Mission / AI (AI1: 22-mission system with queue)
  mission: Mission = Mission.GUARD;
  missionQueue: Mission | null = null; // AI1: next mission to promote at cell center
  /** Tick when TeamClass assigned the current missionQueue. Used where TS team
   *  AI runs before an object's AI but C++ exposes that queue to the next object
   *  pass (not the same frame). */
  missionQueueSetTick = -1;
  stance: Stance = Stance.AGGRESSIVE; // default aggressive (like original RA)
  target: Entity | null = null;
  healTarget: Entity | null = null;  // medic auto-heal target (C++ infantry.cpp AI)
  targetStructure: StructureRef | null = null; // for attacking buildings
  forceFirePos: WorldPos | null = null; // force-fire ground position (Ctrl+right-click)
  moveTarget: LeptonPos | null = null;
  /** C++ NavCom can hold an object TARGET. `moveTarget` is the current
   *  coordinate view of that target; this ref preserves the TARGET identity. */
  moveTargetEntityRef: Entity | null = null;
  moveTargetEntityRefLX = 0;
  moveTargetEntityRefLY = 0;
  moveQueue: LeptonPos[] = []; // shift+click waypoint queue (C++ NavQueue[10] — capped at 10)
  static readonly NAV_QUEUE_MAX = 10; // C++ foot.h:189: TARGET NavQueue[10]
  navQueueLoop = false;               // C++ foot.h:146: IsNavQueueLoop — patrol loop mode
  navQueueOriginal: LeptonPos[] = [];  // saved waypoints for loop re-population
  path: CellPos[] = [];
  pathIndex = 0;
  /** C++ FootClass::Path[] mirror for DriveClass objects.
   *  TS keeps `path` as absolute cells for existing callers/debug traces; this
   *  stores the remaining FacingType commands that C++ consumes with memmove()
   *  in DriveClass::Start_Of_Move and While_Moving track jumps. */
  drivePathFacings: number[] = [];
  /** C++ can clear Path[0] while an infantry Head_To_Coord hop remains active
   *  (for example InfantryClass::Assign_Target during Mission_Move). TS keeps
   *  the active hop's facing so arrival can still consume it, but this flag marks
   *  that the first stored facing is not copyable as C++ Path[0]. */
  drivePathHeadCleared = false;

  // W1 deleted (Step 3): patrolBlockedTargetLX/LY was a sticky flag used
  // by team.coordinatePatrol to skip Mission_Move jitter RNG on re-assignment
  // to the same blocked target. That suppression has no C++ counterpart —
  // C++ Mission_Move always fires Random_Pick(0,2) on Commence pop
  // (foot.cpp:535). Removed.

  // Animation
  animState: AnimState = AnimState.IDLE;
  animFrame = 0;
  animTick = 0;
  prevAnimState: AnimState = AnimState.IDLE;  // G6: detect state transitions for Random_Animate start frame

  // Death / visual
  deathTick = 0;       // ticks since death (for corpse fade + cleanup)
  deathVariant = 0;    // C++ InfantryDeath: 0=instant, 1=twirl, 2=explode, 3=flying, 4=burn, 5=electro
  damageFlash = 0;     // ticks remaining for damage flash effect

  // C++ MissionClass::Timer — gates when mission handler fires.
  // Counts down each tick. Handler runs when timer reaches 0.
  // Handler returns Normal_Delay+Random_Pick(0,2) which becomes new timer.
  missionTimer = 0; // C++ Timer starts at 0 → first handler fires immediately
  idleAnimTimer = 0;   // C++ techno.cpp:611: IdleTimer(0) — initialized to 0. Doing=DO_NOTHING blocks Random_Animate on tick 1 anyway.

  // C++ infantry.h Doing state — gates Is_Ready_To_Random_Animate.
  // DO_NOTHING = initial state. Transitions to DO_STAND_READY via Doing_AI when animation completes.
  // DO_STAND_READY = idle standing pose. Random_Animate allowed.
  // DO_WALK/DO_FIRE = active states. Random_Animate blocked.
  // C++ Is_Ready_To_Random_Animate blocks RA at tick 1 — IdleTimer CDTimerClass
  // behavior makes it non-zero at Frame 0. doing='nothing' matches this in TS.
  // After tick 1, doingAI transitions to 'stand_ready' (enabling future RA).
  //
  // 'gesture' represents C++ DO_GESTURE1/DO_GESTURE2/DO_SALUTE1/DO_SALUTE2 —
  // non-interruptible animations triggered by team activation (team.cpp:637).
  // C++ MasterDoControls.Interrupt=false for all gesture types. Used by the
  // STAGE A/E Commence gate to defer MissionQueue pop until animation
  // completes (infantry.cpp:1208 — `Doing == DO_NOTHING || Interrupt`).
  doing: 'nothing' | 'stand_ready' | 'walk' | 'fire' | 'idle_anim' | 'gesture' | 'lie_down' | 'prone' | 'get_up' | 'dog_maul' = 'nothing';
  // C++ StageClass backing the current infantry Doing animation. Only a subset
  // of Doing values currently need logic, but the fields mirror Stage/Rate/Timer
  // so Firing_AI can read Fetch_Stage() even when Do_Action(DO_FIRE_*) is blocked
  // by a non-interruptible action such as DO_LIE_DOWN.
  doingStage = 0;
  doingRate = 0;
  doingRateTimer = 0;
  doingSetTick = -1;
  // C++ foot.h IsDriving — true while infantry is moving cell-to-cell
  isDriving = false;
  // C++ TechnoClass::IsLocked — false for off-map reinforcements until the
  // object enters the playable radar rectangle, then remains true.
  isLocked = false;
  // C++ HeadToCoord — the sub-cell lepton position the infantry is walking to.
  // Set by infantryStartDriver, used by movement code for waypoint target.
  headToLX = 0;
  headToLY = 0;
  // Tick when NavCom was cleared while a HeadToCoord segment was active.
  // Lets infantry finish the clear tick's movement, then Stop_Driver next tick.
  navComClearedTick = -1;
  // Cell+subcell that this infantry has CLAIMED via Set_Occupy_Bit.
  // Tracks the heading-to reservation for sub-cell occupancy parity.
  claimedCellIdx = -1;
  claimedSubCell = -1;
  // C++ infantry.cpp IsFiring — true during weapon fire animation.
  // Stays true for firingAnimTicks after weapon fire; cleared when counter reaches 0.
  isFiringAnim = false;
  firingAnimTicks = 0; // countdown for fire animation duration
  // C++ InfantryClass::Firing_AI (infantry.cpp:3580-3670) — FireLaunch animation-stage gate.
  //   !IsFiring && FIRE_OK → Do_Action(DO_FIRE_WEAPON), Set_Stage(0), IsFiring=true.
  //   IsFiring && Fetch_Stage()==FireLaunch → Fire_At (actual bullet launch).
  // E1 FireLaunch=2 (idata.cpp:404): 2 ticks between "decide to fire" and "launch".
  // Vehicles fire same-tick (unit.cpp:656-663 has no stage gate). firePrepActive
  // mirrors C++ IsFiring DURING the pre-fire stage; the post-fire anim uses the
  // existing isFiringAnim/firingAnimTicks fields.
  firePrepActive = false;
  firePrepStage = 0;
  // C++ Firing_AI ignores Do_Action's return value: if DO_FIRE_PRONE/WEAPON is
  // blocked by the current non-interruptible Doing, IsFiring still becomes true
  // and Fire_At gates on the current StageClass stage. TS uses this flag for
  // that path instead of the independent firePrepStage counter.
  firePrepUsesDoingStage = false;
  // C++ infantry.cpp:3621-3623 latches PrimaryFacing when IsFiring starts.
  // Retargeting while the fire animation is running must not move the muzzle.
  firePrepFacing256 = -1;
  // C++ Doing state: non-interruptible animation timer.
  // When > 0, Commence() is blocked (gesture, salute, lie down, get up animations).
  // Set by Random_Animate (guard scan idle animations) and Fear_AI.
  nonInterruptAnimTicks = 0;
  // Frame on which nonInterruptAnimTicks was set. C++ StageClass::Set_Rate()
  // starts a CDTimer at the current Frame; Graphic_Logic cannot immediately
  // consume one tick in that same frame. TS uses this to avoid decrementing a
  // newly started gesture during the same game tick.
  nonInterruptAnimSetTick = -1;

  // Legacy fields (kept for compatibility but no longer used for timing)
  lastGuardScan = 0;
  guardScanJitter = 0;
  lastHuntScan = 0;
  missionCycleTimer = 0;
  lastAIScan = 0;      // tick when ant AI last scanned
  lastPathRecalc = 0;  // tick when path was last recalculated (for blocked paths)

  // C++ PathThreshhold escalation system (foot.cpp:396-411, foot.h:232-240)
  // When pathfinding fails, threshold escalates: CLOAK(1) → MOVING_BLOCK(2) → DESTROYABLE(3) → TEMP(4)
  // allowing movement through increasingly difficult obstacles.
  pathThreshold = 1;   // starts at MOVE_CLOAK (C++ foot.cpp:125 — constructor init)
  pathDelay = 0;       // ticks until next path recalc allowed (C++ foot.cpp:463 — Rule.PathDelay * TICKS_PER_MINUTE)
  tryCount = 10;       // retries remaining before giving up (C++ foot.h:239 — PATH_RETRY=10)

  // Rotation accumulators (C++ ROT system: accumulate rot per tick, advance facing when >= threshold)
  rotAccumulator = 0;
  turretRotAccumulator = 0;
  rotTickedThisFrame = false;       // prevents double-accumulation per game tick
  turretRotTickedThisFrame = false;  // prevents double-accumulation per game tick

  // 32-step visual facing for smooth vehicle rotation (C++ Dir_To_32)
  // Game logic uses 8-dir `facing`; visual rendering uses 32-step for smooth sprite animation
  // Exact C++ PrimaryFacing.Current() for ground/naval vehicles.
  // Movement start is gated on exact DesiredFacing equality, not rounded 8-dir parity.
  bodyFacing256 = -1; // lazy init from facing * 32 for legacy callers
  bodyFacing32 = 0;   // 0-31, initialized to facing * 4
  prevBodyFacing32 = 0;   // previous tick bodyFacing32 for visual interpolation
  // Exact C++ SecondaryFacing.Current()/Desired() for turreted units (unit.h:115).
  // Logic uses this 256-step state; turretFacing32 is only the visual derivative.
  turretFacing256 = -1; // lazy init from turretFacing/turretFacing32
  desiredTurretFacing256 = -1;
  turretFacing32 = 0; // 0-31, initialized to turretFacing * 4
  // Mirrors UnitClass::IsRotating as left by the previous Rotation_AI pass.
  // Can_Fire reads this stored flag before this tick updates a drifting target
  // direction, so it is not always equivalent to Current()!=Desired.
  turretIsRotating = false;
  prevTurretFacing32 = 0; // previous tick turretFacing32 for visual interpolation

  // Recoil (C++ unit.cpp:125 Recoil_Adjust — 1-tick visual kickback on fire)
  isInRecoilState = false;

  // S5: NoMovingFire setup time (C++ unit.cpp:1760-1764 — Arm = Rearm_Delay(true)/4 when stopping)
  wasMoving = false;  // tracks movement state for setup time detection

  // Trigger attachment (from INI — for TEVENT_DESTROYED on entities)
  triggerName?: string;
  triggerDeathProcessed = false; // C++ Spring() parity: death already detected by trigger system

  // Combat
  attackCooldown = 0;
  // C++ CDTimerClass Arm.Value() as observed at this object's Logic/AI entry.
  // TS currently decrements attackCooldown explicitly near the start of updateEntity;
  // mission handlers that mirror C++ pre-Frame++ reads use this snapshot instead.
  attackCooldownAtLogicStart = 0;
  attackCooldown2 = 0;
  attackCooldown2AtLogicStart = 0;
  /** C++ FootClass::BaseAttackTimer suppresses repeated base-defense calls from the same attacker. */
  baseAttackTimer = 0;
  weapon: WeaponStats | null;
  weapon2: WeaponStats | null = null;
  kills = 0;      // kills by this unit
  suppressFiringAITick = -1; // C++ Arm-return path: block same-tick TS post-decrement fire

  // Burst fire (C++ weapon.cpp:78 Weapon.Burst — multiple shots per trigger pull)
  // Legacy diagnostics only. C++ does not keep a separate queued burst state;
  // Weapon.Burst only participates through TechnoTypeClass::Is_Two_Shooter().
  burstCount = 0;
  burstDelay = 0;

  // C++ TechnoClass::IsSecondShot. This is NOT a primary/secondary cooldown
  // selector: C++ has one shared Arm timer. IsSecondShot only gives a quick
  // follow-up shot for true two-shooters (Primary == Secondary or Burst > 1).
  isSecondShot = true;

  // Moving-platform tracking (C++ techno.cpp:3106-3108 — units firing while moving get extra inaccuracy)
  prevPos: WorldPos = { x: 0, y: 0 }; // position from previous tick, for detecting movement

  /** Set pixel position and sync integer lepton coordinates. Use for teleports, spawns,
   *  and any direct position assignment (NOT movement — movement writes leptons directly).
   *  C++ parity: all positions are lepton-quantized. Pixel pos is derived from leptons. */
  setPosition(x: number, y: number): void {
    // C++ parity: integer truncation (toward zero), not rounding.
    // C++ positions are integer leptons; pixel = lepton * CELL_SIZE / LEPTON_SIZE.
    this.leptonX = Math.trunc(x / LP);
    this.leptonY = Math.trunc(y / LP);
    this.pos.x = this.leptonX * LP;
    this.pos.y = this.leptonY * LP;
  }

  /** Sync pixel pos from lepton coordinates. Called after lepton-space movement. */
  syncPosFromLeptons(): void {
    this.pos.x = this.leptonX * LP;
    this.pos.y = this.leptonY * LP;
  }

  private clearFirePrepLatchedToBlockedDoing(): void {
    if (!this.firePrepActive || !this.firePrepUsesDoingStage) return;
    this.firePrepActive = false;
    this.firePrepStage = 0;
    this.firePrepUsesDoingStage = false;
    this.firePrepFacing256 = -1;
  }

  /** C++ InfantryClass::Doing_AI — transition Doing state when animation completes.
   *  Called once per tick after mission processing. Doing=DO_NOTHING transitions
   *  to DO_STAND_READY (idle pose) if not driving.
   *
   *  Phase 7A (RANDOM_ANIMATE_CPP_FAITHFUL): C++ infantry.cpp:3700-3732 also
   *  transitions DO_WALK → DO_STAND_READY when `Fetch_Stage() >= DoControls[DO_WALK].Count`
   *  and `!IsDriving`. Without this transition, infantry that stopped walking
   *  stay stuck at `doing === 'walk'` and `Random_Animate` is permanently gated
   *  off (see SCG07EA tick 17 missing-3-RA divergence).
   */
  doingAI(): void {
    if (!this.stats.isInfantry) return;
    if (this.doing === 'lie_down' && this.doingStage >= this.infantryLieDownDoingCount()) {
      // Firing_AI can latch IsFiring while Do_Action(DO_FIRE_*) is blocked by
      // a non-interruptible animation. If that animation finishes before the
      // launch frame, C++ starts a fresh fire Doing on a later tick rather than
      // reading the reset prone/ready stage forever.
      this.clearFirePrepLatchedToBlockedDoing();
      this.doing = 'prone';
      this.doingStage = 0;
      this.doingRate = 0;
      this.doingRateTimer = 0;
      return;
    }
    if (this.doing === 'get_up' && this.doingStage >= this.infantryGetUpDoingCount()) {
      this.clearFirePrepLatchedToBlockedDoing();
      this.doing = 'stand_ready';
      this.doingStage = 0;
      this.doingRate = 0;
      this.doingRateTimer = 0;
      return;
    }
    if (this.doing === 'dog_maul' && this.doingStage >= this.infantryDogMaulDoingCount()) {
      this.doing = 'stand_ready';
      this.doingStage = 0;
      this.doingRate = 0;
      this.doingRateTimer = 0;
      return;
    }
    // C++ infantry.cpp:3685: fires when Doing==DO_NOTHING OR animation completed.
    // Phase 7A flag ON: include 'walk' so stopping infantry transitions back to
    // DO_STAND_READY, enabling Random_Animate on subsequent Mission_Guard ticks.
    //
    // Phase 7B: 'stand_ready' is added — C++ DoControls[DO_STAND_READY].Count=0,
    // so Fetch_Stage() >= 0 is always true → Doing_AI fires every tick. When
    // IsDriving, transitions to DO_WALK. Without this, units in stand_ready that
    // start walking (e.g., team patrol re-MOVE) keep doing='stand_ready' forever,
    // blocking the C++ DO_WALK → DO_STAND_READY chain that signals walk
    // completion to the Commence gate.
    //
    // 'gesture' transitions to stand_ready when nonInterruptAnimTicks reaches 0
    // (the duration counter set by team activation in team.ts). Mirrors C++
    // Doing_AI's `Fetch_Stage() >= DoControls[DO_GESTURE1].Count` check.
    const fireAnimComplete =
      this.doing === 'fire' && this.doingStage >= this.infantryFireDoingCount();
    if (fireAnimComplete) {
      this.isFiringAnim = false;
      this.firingAnimTicks = 0;
    }
    const canTransition =
      this.doing === 'nothing' ||
      this.doing === 'idle_anim' ||
      fireAnimComplete ||
      this.doing === 'stand_ready' ||
      (RANDOM_ANIMATE_CPP_FAITHFUL && this.doing === 'walk') ||
      (this.doing === 'gesture' && this.nonInterruptAnimTicks <= 0);
    if (canTransition) {
      if (this.doing === 'gesture') {
        this.clearFirePrepLatchedToBlockedDoing();
      }
      if (this.isDriving) {
        this.doing = 'walk';
        this.doingStage = 0;
        this.doingRate = 2;
        this.doingRateTimer = 2;
      } else {
        this.doing = 'stand_ready';
        this.doingStage = 0;
        this.doingRate = 0;
        this.doingRateTimer = 0;
      }
    }
  }

  /** C++ infantry.cpp:1208 Commence gate — `Doing == DO_NOTHING || MasterDoControls[Doing].Interrupt`.
   *  Returns true when the entity's current Doing state allows MissionQueue
   *  pop. Mirrors the C++ MasterDoControls Interrupt flags (infantry.cpp:98-120).
   *
   *  Interruptible: stand_ready, walk, fire, idle_anim, nothing.
   *  Non-interruptible: gesture (DO_GESTURE1/2 + DO_SALUTE1/2 + death animations).
   *
   *  Called from STAGE A/E Commence gates in updateEntity. */
  isDoingInterruptible(): boolean {
    if (this.doing === 'gesture') return false;
    if (this.doing === 'lie_down' || this.doing === 'get_up') return false;
    if (this.doing === 'dog_maul') return false;
    return true;
  }

  /** C++ InfantryClass::Stop_Driver -> Do_Action(DO_STAND_READY/DO_PRONE).
   *  Do_Action only replaces the current Doing state when it is interruptible;
   *  gestures and other locked actions continue to gate Commence().
   */
  doStopDriverAction(tick: number): void {
    if (!this.stats.isInfantry) return;
    if (this.doing !== 'nothing' && !this.isDoingInterruptible()) return;
    this.doing = this.type === UnitType.I_DOG || !this.isProne ? 'stand_ready' : 'prone';
    this.doingStage = 0;
    this.doingRate = 0;
    this.doingRateTimer = 0;
    this.doingSetTick = tick;
  }

  /** C++ InfantryClass::Start_Driver -> Do_Action(DO_WALK). */
  doWalkAction(tick: number): void {
    if (!this.stats.isInfantry) return;
    if (this.doing !== 'nothing' && !this.isDoingInterruptible()) return;
    this.doing = 'walk';
    this.doingStage = 0;
    this.doingRate = 2;
    this.doingRateTimer = 2;
    this.doingSetTick = tick;
  }

  isDogMaulMovementBlocking(): boolean {
    return this.doing === 'dog_maul' && this.doingStage < this.infantryDogMaulDoingCount();
  }

  /** C++ InfantryClass::Do_Action gesture/salute effective duration.
   *  MasterDoControls[DO_GESTURE*].Rate is 2 for all infantry; the per-type
   *  DoInfo Count comes from idata.cpp. Tanya/civilians/dogs use Count=1,
   *  while common combat infantry use Count=3.
   */
  infantryGestureDurationTicks(): number {
    const anim = INFANTRY_ANIMS[this.type];
    const count = anim?.gesture1?.count ?? anim?.gesture2?.count ?? 1;
    return Math.max(1, count * 2);
  }

  startGestureDoing(tick: number, gestureDoInfo?: { frame: number; count: number; jump: number } | null): void {
    if (!this.stats.isInfantry) return;
    this.gestureDoInfo = gestureDoInfo ?? this.gestureDoInfo;
    this.nonInterruptAnimTicks = this.infantryGestureDurationTicks();
    this.nonInterruptAnimSetTick = tick;
    this.doing = 'gesture';
    this.doingStage = 0;
    this.doingRate = 2;
    this.doingRateTimer = 2;
    this.doingSetTick = tick;
  }

  /** C++ infantry.cpp:878-889 tether cut.
   *  When infantry reaches its first cell after exiting a transport or
   *  infantry factory, Per_Cell_Process sends RADIO_UNLOADED and calls
   *  Do_Action(DO_GESTURE1) for Soviet-side houses, otherwise DO_GESTURE2.
   *  C++ notes that the tether parent can be a building.
   */
  startTransportUnloadGesture(tick: number): void {
    if (!this.stats.isInfantry) return;
    if (!this.isDoingInterruptible()) return;

    if (this.type === UnitType.I_SPY) {
      // C++ InfantryClass::Do_Action special-case: spy gesture/salute requests
      // remap to DO_IDLE1/2 and consume Random_Pick(0,1).
      ScenarioRandom.nextInRange(0, 1);
      this.doing = 'idle_anim';
      return;
    }

    const anim = INFANTRY_ANIMS[this.type];
    const sovietSide = this.house === House.USSR || this.house === House.Ukraine;
    const gesture = sovietSide
      ? (anim?.gesture1 ?? anim?.gesture2 ?? null)
      : (anim?.gesture2 ?? anim?.gesture1 ?? null);
    this.startGestureDoing(tick, gesture);
  }

  /** C++ StageClass::Graphic_Logic for infantry Doing animations. */
  advanceDoingStage(tick: number): void {
    if (!this.stats.isInfantry || this.doingRate <= 0 || this.doingSetTick === tick) return;
    if (this.doingRateTimer > 0) this.doingRateTimer--;
    if (this.doingRateTimer <= 0) {
      this.doingStage++;
      this.doingRateTimer = this.doingRate;
    }
  }

  /** C++ Class->DoControls[DO_FIRE_WEAPON/DO_FIRE_PRONE].Count. */
  infantryFireDoingCount(): number {
    const anim = INFANTRY_ANIMS[this.type];
    if (!anim) return 0;
    if (this.isProne) return (anim.fireProne ?? anim.fire).count;
    return anim.fire.count;
  }

  /** C++ DOG DoControls[DO_DOG_MAUL] at idata.cpp:77: {106, 12, 14}. */
  infantryDogMaulDoingCount(): number {
    return this.type === UnitType.I_DOG ? 12 : 1;
  }

  /** C++ per-type DoControls[DO_LIE_DOWN].Count.
   *  Civilians/Einstein have no real lie-down art but still have Count=1 in
   *  idata.cpp, so they become DO_PRONE sooner than E1/E3-style soldiers. */
  infantryLieDownDoingCount(): number {
    return INFANTRY_ANIMS[this.type]?.lieDown?.count ?? 1;
  }

  /** C++ per-type DoControls[DO_GET_UP].Count. */
  infantryGetUpDoingCount(): number {
    return INFANTRY_ANIMS[this.type]?.getUp?.count ?? 1;
  }

  infantryDeathDurationTicks(): number {
    if (!this.stats.isInfantry) return 0;
    if (this.deathVariant === 0 || this.deathVariant === 5) {
      // C++ InfantryClass::Take_Damage deletes instant/electro deaths as
      // InfantryClass objects immediately; electro uses a separate AnimClass.
      return 0;
    }
    const anim = INFANTRY_ANIMS[this.type] ?? INFANTRY_ANIMS.E1;
    const dieInfo =
      this.deathVariant === 1 ? anim.die1 :
      this.deathVariant === 2 ? (anim.die2 ?? anim.die1) :
      this.deathVariant === 3 ? (anim.die4 ?? anim.die2 ?? anim.die1) :
      this.deathVariant === 4 ? (anim.die5 ?? anim.die2 ?? anim.die1) :
      anim.die1;
    return Math.max(0, dieInfo.count * 2);
  }

  isInfantryDeathAnimationComplete(): boolean {
    return this.stats.isInfantry && !this.alive && this.deathTick >= this.infantryDeathDurationTicks();
  }

  occupiesCppLogic(): boolean {
    if (this.inLimbo) return false;
    if (this.alive) return true;
    return this.stats.isInfantry &&
      this.mission === Mission.DIE &&
      this.deathVariant >= 1 &&
      this.deathVariant <= 4 &&
      !this.isInfantryDeathAnimationComplete();
  }

  /** Start C++ DO_FIRE_WEAPON / DO_FIRE_PRONE for InfantryClass::Firing_AI.
   *
   *  C++ Do_Action sets Doing, Set_Rate(MasterDoControls[Doing].Rate), and
   *  Set_Stage(0). Firing_AI then gates Fire_At on Fetch_Stage()==FireLaunch.
   *
   *  TS ticks increment at update entry; C++ Frame++ happens after object AI
   *  (conquer.cpp:2542). In serialized tick terms, a freshly started rate=1
   *  DO_FIRE_WEAPON uses MasterDoControls rate=1 (infantry.cpp:103), so the
   *  stage advances once per object AI tick after the action starts.
   */
  startFireDoing(tick: number): boolean {
    if (!this.stats.isInfantry) return false;
    if (this.infantryFireDoingCount() <= 0) return false;
    if (this.doing !== 'nothing' && !this.isDoingInterruptible()) return false;
    if (this.doing === 'fire') return false;
    this.doing = 'fire';
    this.doingStage = 0;
    this.doingRate = 1;
    this.doingRateTimer = 1;
    this.doingSetTick = tick;
    return true;
  }

  /** Start C++ DO_DOG_MAUL (MasterDoControls rate=2, DOG count=12). */
  startDogMaulDoing(tick: number): void {
    if (!this.stats.isInfantry || this.type !== UnitType.I_DOG) return;
    this.doing = 'dog_maul';
    this.doingStage = 0;
    this.doingRate = 2;
    this.doingRateTimer = 2;
    this.doingSetTick = tick;
    this.animState = AnimState.ATTACK;
    this.animFrame = 0;
  }

  /** Start C++ DO_LIE_DOWN (MasterDoControls rate=2, E1 DoControls count=2). */
  startLieDownDoing(tick: number): void {
    if (!this.stats.isInfantry) return;
    if (this.doing !== 'nothing' && !this.isDoingInterruptible()) return;
    this.doing = 'lie_down';
    this.doingStage = 0;
    this.doingRate = 2;
    this.doingRateTimer = 2;
    this.doingSetTick = tick;
  }

  /** Start C++ DO_GET_UP (MasterDoControls rate=3, E1 DoControls count=2). */
  startGetUpDoing(tick: number): void {
    if (!this.stats.isInfantry) return;
    if (this.doing !== 'nothing' && !this.isDoingInterruptible()) return;
    this.doing = 'get_up';
    this.doingStage = 0;
    this.doingRate = 3;
    this.doingRateTimer = 3;
    this.doingSetTick = tick;
  }

  /** C++ InfantryClass::Is_Ready_To_Random_Animate — checks all gates.
   *  Returns true only when infantry is truly idle: standing, not moving,
   *  not firing, idle timer expired. */
  isReadyToRandomAnimate(): boolean {
    if (!this.stats.isInfantry) return false;
    if (this.idleAnimTimer > 0) return false;   // IdleTimer not expired
    if (this.doing !== 'stand_ready') return false; // Must be in idle stance
    if (this.isDriving) return false;            // Not while moving
    if (this.isProne) return false;              // C++ infantry.cpp:4137 — no prone idle anims
    if (this.isFiringAnim) return false;         // Not while firing
    return true;
  }

  /** Credit a kill (RA1: no promotion system, just tracks kill count) */
  creditKill(): void {
    this.kills++;
  }

  // Selection
  selected = false;

  // Infantry sub-cell position (0-4 for the 5 sub-positions within a cell)
  subCell = 0;

  // Team mission script: ordered list of missions the unit executes sequentially
  teamMissions: TeamMissionEntry[] = [];
  teamMissionIndex = 0;
  teamMissionWaiting = 0;  // ticks to wait at current mission (for GUARD duration)

  // Area Guard: remember spawn origin so unit returns if it strays too far
  guardOrigin: WorldPos | null = null; // set when unit spawns with Area Guard mission

  // U3: Formation movement offset (C++ foot.h:139-175 XFormOffset/YFormOffset)
  formationOffset: WorldPos | null = null;
  // C++ FootClass formation movement fields. TeamClass::TMission_Formation
  // sets these so DriveClass movement can use the team's slowest speed.
  isFormationMove = false;
  formationSpeedClass: SpeedClass = SpeedClass.FOOT;
  formationMaxSpeed = 0;

  // MV1: Track-table movement state (C++ drive.cpp — vehicles follow pre-computed turn tracks)
  trackNumber = -1;    // C++ track number (1-13), -1 = not on a track
  trackIndex = 0;      // current step within the track
  trackFlags = 0;      // TrackControl flags (F_T|F_X|F_Y) for Smooth_Turn transformation
  trackCellSpan = 1;   // cells covered by current track: 1=short, 2=long 2-cell track
  trackControlIndex = -1; // C++ TrackNumber: index into TrackControl[] table (0-66), for track jumping
  speedAccum = 0;      // C++ SpeedAccum: sub-pixel movement remainder (leptons)
  // C++ FootClass::Speed throttle for active DriveClass tracks. Start_Of_Move
  // sets this from destination terrain; track jumps preserve it via
  // drive.cpp:767-788 `oldspeed = Speed` / `Set_Speed(oldspeed)`.
  driveSpeed = 0;
  // C++ DriveClass::Mark_Track reservation bits. Stores absolute cell indices
  // currently marked by this unit so Stop_Driver can clear them.
  trackReservationCells: number[] = [];
  /** Cell where DriveClass::Mark_Track(MARK_UP) cleared the shared vehicle
   *  occupancy flag while the physical occupier can still matter to
   *  UnitClass::Can_Enter_Cell. Used by CellClass::Is_Clear_To_Move parity. */
  driveTrackFlagClearedCellIdx = -1;

  // === PCP refactor debug/dedup fields (Session 1 — track-jump PCP) ===
  // Reset at top of updateEntity each tick. Instrumented via DEBUG_PCP_LOG env
  // flag in index.ts for first-divergence diagnostics. Plan §5, §6.
  /** Leptons advanced by followTrackStep this tick. C++ drive.cpp:481-490 mirror. */
  speedBudgetConsumed = 0;
  /** Number of cell-boundary crossings this tick (track completions + track-jumps). */
  cellBoundaryCrossings = 0;
  /** Per-tick Commence dedup: C++ obj->AI() runs Commence once per-tick before
   *  MissionClass::AI — TS track-jump PCP must not double-fire Mission_Move jitter
   *  when a second PCP_END fires later in the same tick. */
  _commenceFiredThisTick = false;
  /** Per-boundary Commence dedup. Keyed `${trackIndex}-${pathIndex}` at moment
   *  of PCP_END call-site. Plan §6 MCV-157 double-fire nuance. */
  _commenceFiredBoundaries: Set<string> = new Set();
  // === Phase 0 — additive debug fields (JOINT-REFACTOR plan §0 line 133-135) ===
  // These are ADDITIVE and gated. They MUST NOT affect behavior when debug
  // env flags are unset. All Phase 0 instrumentation lives behind either
  //   - `undefined` defaults (cheap; no work until a writer populates them)
  //   - `process.env.DEBUG_PCP_TRACE === "1"` or similar env gates elsewhere.
  // See scripts/test-dispatch-order.ts + scripts/test-cdtimer-cross-entity-read.ts.
  /** Tick at which MissionClass::AI most recently dispatched the Timer==0 branch
   *  for this entity. Written only when a mission handler actually fires.
   *  `undefined` = no dispatch yet observed. Not reset — carries across ticks
   *  so diagnostic scripts can see "last dispatch was N ticks ago". */
  _missionDispatchTick?: number;
  /** Commence() trace buffer — populated only when the caller is running under
   *  a debug env flag. Each entry: `{tick, from: Mission-before, to: Mission-after, reason}`.
   *  Left empty by default (zero allocation cost); debug-only writers push
   *  entries. Consumers trim / clear as needed. */
  _commenceTrace?: Array<{ tick: number; from: string; to: string; reason: string }>;

  // Saved move target for AI target acquisition while moving (C++ foot.cpp:492-505)
  // When an AI unit spots an enemy during MOVE, it switches to ATTACK but saves its destination
  savedMoveTarget: LeptonPos | null = null;

  /** C++ MissionClass/TechnoClass/FootClass suspended state for
   *  Override_Mission, used when DriveClass temporarily attacks a destroyable
   *  blocker and later restores the interrupted order on Detach. */
  suspendedMission: Mission | null = null;
  suspendedTarget: Entity | null = null;
  suspendedTargetStructure: StructureRef | null = null;
  suspendedForceFirePos: WorldPos | null = null;
  suspendedMoveTarget: LeptonPos | null = null;
  suspendedMoveTargetEntityRef: Entity | null = null;
  suspendedMoveTargetEntityRefLX = 0;
  suspendedMoveTargetEntityRefLY = 0;

  // Wave coordination: ants from the same trigger share a waveId
  waveId = 0;              // 0 = no wave group
  waveRallyTick = 0;       // tick when wave should start attacking (rally delay)

  // Transport passengers
  passengers: Entity[] = [];       // loaded cargo: infantry + vehicles (hidden from entity list)
  transportRef: Entity | null = null; // transport carrying or radio-tethered to this unit
  // C++ RadioClass IsTethered while an unloaded passenger is still in radio
  // contact with its transport. UnitClass/InfantryClass::Per_Cell_Process sends
  // RADIO_UNLOADED on the first cell boundary; infantry also plays the
  // house-specific unload gesture.
  isTethered = false;

  // Harvester economy (EC3: bail-based capacity — 28 bails max per harvester load)
  oreLoad = 0;                     // number of bails currently carried
  oreCreditValue = 0;              // total credit value of carried bails
  static readonly BAIL_COUNT = 28; // max bails per trip (C++ UnitTypeClass::Max_Pips)
  static readonly ORE_CAPACITY = 28; // alias for BAIL_COUNT (backward compat)
  harvesterState: 'idle' | 'seeking' | 'harvesting' | 'returning' | 'headinghome' | 'goingtoidle' | 'unloading' = 'idle';
  harvestTick = 0;                 // legacy mirror of harvesterAnimStage while loading
  /** C++ unit.cpp:2794-2797, 2851 — ArchiveTarget: remembers last known ore location.
   *  When returning to refinery, saves current cell. On next idle seek, heads there first. */
  archiveTarget: { cx: number; cy: number } | null = null;
  /** C++ TARGET object form for ArchiveTarget. Used when Base_Is_Attacked stores
   *  the guarded techno itself, so As_Coord(ArchiveTarget) follows moving units. */
  archiveTargetEntity: Entity | null = null;
  /** Exact ArchiveTarget coordinate when C++ stores an object/coordinate target rather than a cell target. */
  archiveTargetLeptons: { lx: number; ly: number } | null = null;
  /** Harvester animation stage — C++ Fetch_Stage() while IsDumping/IsHarvesting.
   *  During 'unloading': advances 0..21 over 22 ticks (Harvester_Dump_List).
   *  During 'harvesting' (stationary at ore): advances 0..8 (Harvester_Load_List). */
  harvesterAnimStage = 0;
  /** C++ StageClass::Rate/Timer for the harvester load animation. Mission_Harvest
   *  starts the first load pass at rate 2, then Harvesting() uses Rule.OreDumpRate
   *  (1) after each bail. */
  harvesterAnimRate = 0;
  harvesterAnimTimer = 0;
  /** True while harvester is stopped at ore cell mining (C++ IsHarvesting).
   *  Renderer uses this to draw scoop animation frames 32-95. */
  isHarvesterMining = false;
  /** True while harvester is docked at refinery dumping ore (C++ IsDumping).
   *  Renderer uses this to draw dump animation frames 96-110. */
  isHarvesterDumping = false;

  // M7: Crate speed bias — multiplier from speed crate pickups (default 1.0, boosted to 1.7)
  speedBias = 1.0;

  // MV9: Ground speed bias — multiplies rotation rate (C++ GroundSpeed affects ROT accumulation)
  groundspeedBias = 1.0;

  // CR2: Armor crate bias — damage reduction multiplier (C++ ArmorBias, default 1.0, crate sets to 2 = half damage)
  // Applied in takeDamage: effective damage = damage / armorBias. Agent 1 owns takeDamage integration.
  armorBias = 1.0;

  // CR3: Firepower crate bias — damage output multiplier (C++ FirepowerBias, default 1.0, crate sets to 2 = double damage)
  firepowerBias = 1.0;

  // CR5: Crate-granted permanent cloak ability (C++ IsCloakable from crate pickup)
  isCloakable = false;

  // Crate effect timers
  cloakTick = 0;    // ticks remaining for cloak invisibility (from crate)
  invulnTick = 0;   // ticks remaining for invulnerability (from crate)
  speedTick = 0;    // ticks remaining for speed boost (from crate, C++ TICKS_PER_MINUTE = 900)

  // Team behavior flags
  isSuicide = false; // IsSuicide team flag: don't retreat, fight to death
  isALoaner?: boolean; // C++ reinf.cpp:251: transport doesn't count toward limits, auto-retreats after unload

  // C++ parity: back-pointer to owning Team object (C++ FootClass::Team in team.h)
  // Set by Team.add(), cleared by Team.remove() and Team.dissolve()
  // Typed loosely to avoid circular dependency (team.ts imports entity.ts)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  teamRef: any = null;
  // C++ FootClass::IsInitiated — only initiated team members participate in
  // TeamClass Coordinate_Move/Attack. Non-initiated members first regroup to
  // the team Zone via Coordinate_Conscript.
  teamInitiated = false;

  // Superweapon effect timers
  ironCurtainTick = 0;  // ticks remaining for Iron Curtain invulnerability
  chronoShiftTick = 0;  // visual effect timer after being chronoshifted

  // C++ IsAnimAttached mirror (unit.cpp:1113, vessel.cpp:975) — tick at which the
  // attached SMOKE_M damage anim was spawned. -1 means no smoke attached (i.e. !IsAnimAttached).
  // Renderer anchors frame advancement to this tick so the sprite plays as one continuous anim.
  damageSmokeStartTick = -1;
  damageSmokeLogicIndexHint?: number;
  damageSmokeCppLogicReleased = false;

  // Moebius return fields (C++ drive.h:62-74 — IsMoebius, MoebiusCountDown, MoebiusCell)
  // After chronoshift, unit saves origin cell and returns after ChronoDuration expires.
  moebiusCell: WorldPos | null = null;  // origin position before chronoshift
  moebiusCountDown = 0;                 // ticks remaining before return-to-origin

  // IA1: Infantry fidget randomization (C++ infantry.cpp:1748-1821)
  // Use NonCriticalRandom — fidget is cosmetic, doesn't consume Scen.RandomNumber in C++.
  // C++ IdleTimer is initialized by MissionClass::Timer, not at construction.
  fidgetDelay = NonCriticalRandom.nextInRange(12, 31); // random 12-31 frames
  fidgetVariant = NonCriticalRandom.float(); // selects idle1 vs idle2 animation

  // Fear/Prone system (C++ infantry.cpp — FearType 0-255)
  // Fear increases on damage, decrements 1/tick. IsProne when fear >= FEAR_ANXIOUS (10).
  // Prone infantry take 50% damage (C++ rules.cpp:202 ProneDamageBias=1/2).
  fear = 0;
  isProne = false;
  prevIsProne = false; // G3: track prone transitions for LIE_DOWN/GET_UP animations
  gestureDoInfo: { frame: number; count: number; jump: number } | null = null; // G8: active gesture/salute DoInfo
  static readonly FEAR_ANXIOUS = 10;
  static readonly FEAR_SCARED = 100;
  static readonly FEAR_PANIC = 200;
  static readonly FEAR_MAXIMUM = 255;

  // Spy disguise system (Gap #4)
  disguisedAs: House | null = null;  // when disguised, appears as this house's unit

  // Submarine cloak state machine (SS, MSUB)
  cloakState: CloakState = CloakState.UNCLOAKED;
  cloakTimer = 0;         // frames remaining in cloaking/uncloaking transition
  sonarPulseTimer = 0;    // frames remaining before recloak allowed (after detection)
  cloakDelay = 0;         // C++ techno.cpp:2468: CloakDelay cooldown after uncloaking completes

  // Dog-rides-bullet limbo state (C++ bullet.cpp:96-175, infantry.cpp:3649-3654)
  // When a dog fires its DogJaw weapon, it enters limbo (hidden, untargetable, removed from map).
  // The dog rides the bullet to the target and unlimbos at impact coordinates.
  inLimbo = false;

  // LST door state
  doorOpen = false;
  doorTimer = 0;          // countdown to auto-close
  doorOpeningTicks = 0;   // C++ DoorClass Open_Door(5, 6): 5 * (6 - 1)
  doorClosingTicks = 0;   // C++ DoorClass Close_Door(5, 6): 5 * (6 - 1)
  /** C++ VesselClass::Mission_Unload Status enum:
   *  0 INITIAL_CHECK, 1 MANEUVERING, 2 OPENING_DOOR, 3 UNLOADING, 4 CLOSING_DOOR. */
  vesselUnloadStatus = 0;
  /** C++ FootClass/VesselClass::Mission_Retreat Status:
   *  0 PICK_RETREAT_POINT/FIND_EDGE, 1 TRAVEL. */
  retreatStatus = 0;
  /** C++ DriveClass::Assign_Destination calls Start_Of_Move immediately before
   *  DriveClass::AI's same-zone guard can run. */
  skipDriveZoneCheckOnce = false;
  /** C++ UnitClass::Mission_Unload Status for UNIT_MCV:
   *  0 clear path, 1 try deploy when stopped, 2 wait for deploy rotation. */
  mcvUnloadStatus = 0;
  /** C++ FootClass::IsDeploying for UNIT_MCV deploy-after-rotation. */
  mcvIsDeploying = false;

  // Agent 9: New unit special ability fields
  c4Timer = 0;              // C4 countdown on structures (Tanya)
  mineCount = 0;            // mines placed by this player/house
  chronoCooldown = 0;       // Chrono Tank teleport cooldown
  isDeployed = false;       // for MAD Tank deployment state
  deployTimer = 0;          // deployment charge-up timer
  fuseTimer = 0;            // Demo Truck fuse countdown (45 ticks)

  // Aircraft state machine
  ammo = -1;                    // -1 = unlimited
  maxAmmo = -1;
  /** C++ UnitClass::Reload CDTimer. Used by V2 launchers between rockets. */
  reloadTimer = 0;
  landedAtStructure = -1;       // structure index, -1 = airborne
  aircraftState: 'idle' | 'takeoff' | 'flying' | 'attacking' | 'returning' | 'landing' | 'landed' | 'rearming' | 'unload_search' | 'unload_fly' | 'unload_land' | 'unload_wait' | 'unload_eject' = 'idle';
  /** C++ AircraftClass::Mission_Enter Status for fixed-wing landing pattern:
   *  INITIAL=0, TAKEOFF=1, ALTITUDE=2, STACK=3, DOWNWIND=4, CROSSWIND=5,
   *  TRAVEL=6, LANDING=7. */
  aircraftEnterStatus = 0;
  /** C++ AircraftClass::Mission_Move Status for helicopter movement:
   *  VALIDATE_LZ=0, TAKE_OFF=1, FLY_TO_LZ=2, LAND=3. */
  aircraftMoveStatus = 0;
  /** C++ NavCom radio contact target for fixed-wing Mission_Enter. Separate from
   *  landedAtStructure, which is only the pad the aircraft has actually touched. */
  aircraftDockingStructure = -1;
  _unloadSearchTicks = 0; // C++ SEARCH_FOR_LZ delay counter
  _flyToTicks = 0; // C++ FLY_TO_LZ Process_Fly_To call interval counter
  rearmTimer = 0;
  attackRunPhase: 'flyToTarget' | 'dropBombs' | 'regroup' = 'flyToTarget';
  circleBreakTimer = 0;
  /** C++ aircraft.cpp:2899-2928 — speed fraction (0.0-1.0) during takeoff/landing.
   *  Modulates effective movement speed. 0xFF=1.0, 0x40=0.25, 0x20=0.125, 0x00=0.0.
   *  cpp-parity: helicopters ramp speed during takeoff and stop at half-height during landing. */
  aircraftSpeedFraction = 1.0;
  /** C++ AircraftClass::Status (aircraft.cpp:2418-2425) for MISSION_ATTACK state machine.
   *  Tracks VALIDATE_AZ=0 → PICK_ATTACK_LOCATION=1 → TAKE_OFF=2 → FLY_TO_POSITION=3 →
   *  FIRE_AT_TARGET=4 → FIRE_AT_TARGET2=5 → RETURN_TO_BASE=6. TS's aircraft state
   *  machine (aircraftState) covers most of these implicitly, but the landed-no-target
   *  transition path (VALIDATE_AZ → RETURN_TO_BASE → Enter_Idle_Mode → GUARD) requires
   *  a two-stage timer fire that the high-level aircraftState doesn't capture — this
   *  field bridges that gap for the Phase 2 HPAD helicopter Mission_Attack handler.
   *  Currently used only for: 0 = VALIDATE_AZ (initial), 6 = RETURN_TO_BASE (post-target-lost).
   *  C++ ref: aircraft.cpp:2432-2438 (VALIDATE_AZ→RETURN_TO_BASE on !Target_Legal),
   *  aircraft.cpp:2603-2614 (RETURN_TO_BASE runs Enter_Idle_Mode). */
  aircraftAttackStatus: number = 0;
  /** C++ AircraftClass::Passenger flag. Set when aircraft unlimbos with cargo
   *  attached and intentionally remains true after the last passenger drops, so
   *  Can_Fire returns FIRE_AMMO and Mission_Hunt enters REGROUP/RETREAT. */
  aircraftPassengerCarrier = false;
  /** C++ aircraft.cpp:441-445 — helicopter hover jitter offset (pixels).
   *  Applied when at FLIGHT_ALTITUDE and speed < 3 (hovering). Pattern repeats every 16 ticks.
   *  cpp-parity: {0,0,0,0,1,1,1,0,0,0,0,0,-1,-1,-1,0} indexed by frame%16. */
  hoverJitter = 0;
  /** C++ building.cpp:1298 — IsTechnician flag on infantry survivors.
   *  Set when infantry is spawned from building sell/destruction (E1 only).
   *  cpp-parity: building.cpp:3473 — IsNominal infantry get IsTechnician=true. */
  isTechnician = false;

  /** C++ ScenarioInit Unlimbo semantics.
   *  InfantryClass::Unlimbo calls Closest_Free_Spot(coord, ScenarioInit). When
   *  ScenarioInit is true, C++ ignores occupancy but still snaps the requested
   *  coordinate to the nearest StoppingCoordAbs infantry sub-cell. Trigger
   *  reinforcements and building survivor spawns use this path, so several
   *  infantry can briefly share the same stopping coord until Start_Driver
   *  claims their first walking sub-cell. */
  scenarioInitUnlimbo = false;
  /** C++ UnitClass::IsToScatter.
   *  VesselClass::Mission_Unload sets this on RTTI_UNIT passengers after they
   *  leave an LST. The next UnitClass::Enter_Idle_Mode consumes the flag and
   *  calls Scatter(0, true), assigning a clear nearby destination instead of
   *  falling straight into GUARD. */
  isToScatter = false;
  /** Frame when this object was unlimboed into Logic during another object's AI.
   *  Informational only. C++ logic.cpp re-reads Logic.Count() while iterating,
   *  so transport cargo appended by Unlimbo can run later in the same frame. */
  unlimboTick = -1;
  /** Last frame this object ran active LogicClass AI. In-limbo visits do not count. */
  lastLogicProcessedTick = -1;
  /** Tick when a dog entered the dog-rides-bullet limbo path. */
  dogRiderLimboStartTick = -1;
  /** C++ Logic vector index at submit time for runtime-created techno objects.
   *  Used to keep bullets/anims and later-spawned infantry in the same relative
   *  order when TS has to batch parts of the Logic array. */
  logicIndexHint?: number;
  /** C++ building.cpp:2438-2455 — HPAD auto-spawned helicopter RNG parity.
   *  In C++, HPAD helicopters enter the Logic array right after their HPAD building
   *  and are processed interleaved with buildings, NOT in the aircraft pass.
   *  Set to true during tickStructuresInterleaved(); checked+reset in Pass 4. */
  _processedInBuildingPass = false;

  constructor(type: UnitType, house: House, x: number, y: number) {
    this.type = type;
    this.stats = UNIT_STATS[type] ?? UNIT_STATS.E1;
    this.house = house;
    // C++ parity: all positions are stored as integer lepton coordinates.
    // Pixel position is always derived from leptons to avoid sub-lepton drift.
    this.leptonX = Math.trunc(x / LP);
    this.leptonY = Math.trunc(y / LP);
    this.pos = { x: this.leptonX * LP, y: this.leptonY * LP };
    this.hp = this.stats.strength;
    this.maxHp = this.stats.strength;
    this.weapon = this.stats.primaryWeapon
      ? WEAPON_STATS[this.stats.primaryWeapon] ?? null
      : null;
    this.weapon2 = this.stats.secondaryWeapon
      ? WEAPON_STATS[this.stats.secondaryWeapon] ?? null
      : null;
    // C++ unit/vessel/infantry constructors set IsSecondShot = !Class->Is_Two_Shooter().
    this.isSecondShot = !this.isTwoShooter();
    // Initialize 32-step visual facing from 8-dir facing
    this.bodyFacing256 = (this.facing * 32) & 0xff;
    this.bodyFacing32 = this.facing * 4;
    this.prevBodyFacing32 = this.bodyFacing32;
    this.turretFacing256 = (this.turretFacing * 32) & 0xff;
    this.desiredTurretFacing256 = this.turretFacing256;
    this.turretFacing32 = this.turretFacing * 4;
    this.prevTurretFacing32 = this.turretFacing32;
    // Initialize prevPos to lepton-rounded starting position (matches pos so no interpolation jump)
    this.prevPos = { x: this.pos.x, y: this.pos.y };
    // Aircraft init: set ammo from stats
    if (this.stats.maxAmmo && this.stats.maxAmmo > 0) {
      this.ammo = this.stats.maxAmmo;
      this.maxAmmo = this.stats.maxAmmo;
    }
    // C++ aircraft.cpp:249: Height = FLIGHT_LEVEL — aircraft are created airborne.
    // Callers that need aircraft on pads (production, scenario init) override afterwards.
    if (this.stats.isAircraft) {
      this.aircraftState = 'flying';
      this.flightAltitude = Entity.FLIGHT_ALTITUDE;
      this.aircraftHeightLeptons = Entity.FLIGHT_LEVEL_LEPTONS;
    }
  }

  get cell(): CellPos {
    // C++ Coord_Cell: extract cell index from upper byte of 16-bit lepton coordinate.
    // Uses integer lepton division (>>8) instead of pixel-based Math.floor(px/24)
    // to avoid floating-point boundary rounding differences.
    return {
      cx: (this.leptonX >> 8) & 0x7F,
      cy: (this.leptonY >> 8) & 0x7F,
    };
  }

  /** Lepton position — direct access to integer lepton coordinates (no pixel conversion) */
  get lpos(): { lx: number; ly: number } {
    return { lx: this.leptonX, ly: this.leptonY };
  }

  /** C++ foot.cpp:2275-2307 Queue_Navigation_List — append waypoint, cap at 10.
   *  Returns true if appended, false if queue is full (C++ silently drops).
   *  Accepts both LeptonPos {lx,ly} and legacy WorldPos {x,y}. */
  queueWaypoint(pos: LeptonPos | WorldPos): boolean {
    if (this.moveQueue.length >= Entity.NAV_QUEUE_MAX) return false;
    const lp: LeptonPos = 'lx' in pos ? pos : { lx: Math.trunc(pos.x * LEPTON_SIZE / CELL_SIZE), ly: Math.trunc(pos.y * LEPTON_SIZE / CELL_SIZE) };
    this.moveQueue.push(lp);
    return true;
  }

  /** Dynamic check: true if this entity's house is in the player-controlled set.
   *  The set is updated by Game.start() via setPlayerHouses() for each scenario. */
  get isPlayerUnit(): boolean {
    return _playerHouses.has(this.house);
  }

  get isTransport(): boolean {
    return (this.stats.passengers ?? 0) > 0;
  }

  get maxPassengers(): number {
    return this.stats.passengers ?? 0;
  }

  /** Air units fly over terrain, ignoring pathfinding and ground passability */
  get isAirUnit(): boolean {
    return this.stats.isAircraft === true;
  }

  /** Fixed-wing aircraft — cannot hover, always moves forward */
  get isFixedWing(): boolean {
    return this.stats.isFixedWing === true;
  }

  /** Helicopter — aircraft that can hover in place */
  get isHelicopter(): boolean {
    return this.stats.isAircraft === true && !this.stats.isFixedWing;
  }

  /** Has rotor animation overlay (helicopters only, not fixed-wing) */
  get isRotorEquipped(): boolean {
    return this.stats.isRotorEquipped === true;
  }

  /** Naval units can traverse water tiles */
  get isNavalUnit(): boolean {
    return this.stats.isVessel === true;
  }

  /** Unit is invulnerable (from crate or Iron Curtain superweapon) */
  get isInvulnerable(): boolean {
    return this.invulnTick > 0 || this.ironCurtainTick > 0;
  }

  /** Flight altitude offset (pixels) — renderer-facing value derived from C++ Height. */
  flightAltitude = 0;
  static readonly FLIGHT_ALTITUDE = 24; // pixels above ground when airborne (C++ FLIGHT_LEVEL = 24)
  /** C++ AircraftClass/ObjectClass::Height for aircraft, stored in leptons.
   *  flightAltitude is the rounded Lepton_To_Pixel view of this value. */
  aircraftHeightLeptons = 0;
  /** C++ ObjectClass::Height while IsFalling, stored in leptons.
   *  ObjectClass::FLIGHT_LEVEL is 256 leptons; renderer-facing
   *  flightAltitude is derived with Lepton_To_Pixel. */
  fallHeightLeptons = 0;
  /** C++ ObjectClass::IsFalling/Riser. Used by paradropped infantry and any
   *  future non-air falling object. TechnoClass::AI returns early while
   *  Height > 0 for non-aircraft. */
  isFalling = false;
  fallRiser = 0;
  /** C++ ObjectClass::Paradrop attaches an AnimClass parachute, so falling
   *  uses the IsAnimAttached branch: Riser -= 1, clamped to -3. */
  fallHasAttachedAnim = false;
  /** C++ ANIM_PARACHUTE attached to paradropped infantry. It occupies the
   *  fixed AnimClass heap/Logic vector even though TS renders falling directly
   *  from object height. */
  fallParachuteAnimActive = false;
  fallParachuteAnimLogicIndexHint?: number;
  fallParachuteAnimStage = 0;
  fallParachuteAnimTimer = 4;
  fallParachuteAnimLoops = 15;
  fallParachuteAnimIsBrandNew = false;
  fallParachuteAnimProcessedTick = -1;
  static readonly FLIGHT_LEVEL_LEPTONS = 256; // C++ object.h: FLIGHT_LEVEL

  get hasTurret(): boolean {
    return !this.stats.isInfantry && !this.isAnt && !this.stats.isAircraft &&
      this.type !== UnitType.V_APC && this.type !== UnitType.V_HARV &&
      this.type !== UnitType.V_MCV && this.type !== UnitType.V_ARTY &&
      this.type !== UnitType.V_TRUK &&
      this.type !== UnitType.V_MRJ && this.type !== UnitType.V_MGG &&
      this.type !== UnitType.V_LST &&
      // CS/Aftermath expansion: non-turreted per C++ udata.cpp
      this.type !== UnitType.V_CTNK &&
      this.type !== UnitType.V_TTNK && this.type !== UnitType.V_QTNK &&
      this.type !== UnitType.V_DTRK &&
      this.type !== UnitType.V_V2RL && this.type !== UnitType.V_MNLY &&
      // Naval: SS, MSUB have no turret; DD, CA, PT do have turrets
      this.type !== UnitType.V_SS && this.type !== UnitType.V_MSUB;
  }

  /** Turret sprite frame (frames 32-63 in the vehicle SHP) */
  get turretFrame(): number {
    // Use 32-step turretFacing32 for smooth visual turret rotation
    return 32 + BODY_SHAPE[this.turretFacing32];
  }

  get isAnt(): boolean {
    return this.type === UnitType.ANT1 ||
           this.type === UnitType.ANT2 ||
           this.type === UnitType.ANT3;
  }

  get isCivilian(): boolean {
    const t = this.type;
    return t === UnitType.I_C1 || t === UnitType.I_C2 || t === UnitType.I_C3 ||
           t === UnitType.I_C4 || t === UnitType.I_C5 || t === UnitType.I_C6 ||
           t === UnitType.I_C7 || t === UnitType.I_C8 || t === UnitType.I_C9 ||
           t === UnitType.I_C10;
  }

  /** Calculate the sprite frame index for the current state */
  get spriteFrame(): number {
    const dir = this.facing;

    // --- Ant units: 112-frame layout (stand/walk/attack/death) ---
    if (this.isAnt) {
      switch (this.animState) {
        case AnimState.WALK:
          return ANT_ANIM.walkBase + dir * ANT_ANIM.walkCount + (this.animFrame % ANT_ANIM.walkCount);
        case AnimState.ATTACK:
          return ANT_ANIM.attackBase + dir * ANT_ANIM.attackCount + (this.animFrame % ANT_ANIM.attackCount);
        case AnimState.DIE:
          return ANT_ANIM.deathBase + Math.min(this.animFrame, ANT_ANIM.deathCount - 1);
        default:
          return ANT_ANIM.standBase + dir;
      }
    }

    // --- Infantry: C++ Shape_Number (infantry.cpp:479) ---
    // frame + INFANTRY_SHAPE[dir] * jump + animFrame % count
    if (this.stats.isInfantry) {
      const anim = INFANTRY_ANIMS[this.type] ?? INFANTRY_ANIMS.E1;
      const sdir = INFANTRY_SHAPE[dir]; // SHP direction index (C++ HumanShape remap)
      switch (this.animState) {
        case AnimState.WALK: {
          // Prone crawl if isProne and crawl animation exists
          const d = (this.isProne && anim.crawl) ? anim.crawl : anim.walk;
          return d.frame + sdir * d.jump + (this.animFrame % Math.max(d.count, 1));
        }
        case AnimState.ATTACK: {
          // Prone fire if isProne and fireProne animation exists
          const d = (this.isProne && anim.fireProne) ? anim.fireProne : anim.fire;
          if (!d.count) return 0; // no fire animation (engineer)
          return d.frame + sdir * d.jump + (this.animFrame % d.count);
        }
        case AnimState.DIE: {
          // C++ infantry.cpp:383-416 InfDeath mapping:
          //   0=delete immediately, 1=DO_GUN_DEATH, 2=DO_EXPLOSION_DEATH,
          //   3=DO_GRENADE_DEATH, 4=DO_FIRE_DEATH, 5=electro anim + delete.
          // The DIE state should normally only render variants 1..4.
          let d: { frame: number; count: number; jump: number } | undefined;
          switch (this.deathVariant) {
            case 1: d = anim.die1; break;
            case 2: d = anim.die2 ?? anim.die1; break;
            case 3: d = anim.die4 ?? anim.die2 ?? anim.die1; break;
            case 4: d = anim.die5 ?? anim.die2 ?? anim.die1; break;
            case 5: d = anim.die5 ?? anim.die2 ?? anim.die1; break;
            default: d = anim.die1;
          }
          return d.frame + Math.min(this.animFrame, Math.max(d.count - 1, 0));
        }
        // G3: LIE_DOWN transition animation — plays while going from standing to prone
        case AnimState.LIE_DOWN: {
          const d = anim.lieDown ?? anim.ready;
          return d.frame + sdir * d.jump + Math.min(this.animFrame, Math.max(d.count - 1, 0));
        }
        // G3: GET_UP transition animation — plays while going from prone to standing
        case AnimState.GET_UP: {
          const d = anim.getUp ?? anim.ready;
          return d.frame + sdir * d.jump + Math.min(this.animFrame, Math.max(d.count - 1, 0));
        }
        // G8: Gesture/Salute animation — triggered during idle fidget
        case AnimState.GESTURE: {
          if (this.gestureDoInfo) {
            const d = this.gestureDoInfo;
            // Directional gestures (jump > 0) use facing, non-directional (jump == 0) don't
            if (d.jump > 0) {
              return d.frame + sdir * d.jump + Math.min(this.animFrame, Math.max(d.count - 1, 0));
            }
            return d.frame + Math.min(this.animFrame, Math.max(d.count - 1, 0));
          }
          // Fallback to ready if gestureDoInfo somehow null
          const d = anim.ready;
          return d.frame + sdir * d.jump;
        }
        default: {
          // Prone idle
          if (this.isProne && anim.prone) {
            const d = anim.prone;
            return d.frame + sdir * d.jump;
          }
          // IA1: Idle fidget after random delay (C++ infantry.cpp:1748-1821 — Random_Pick timing)
          if (anim.idle && this.animFrame > this.fidgetDelay) {
            // C++ selects between idle1 and idle2 randomly
            const useIdle2 = anim.idle2 && this.fidgetVariant >= 0.5;
            const d = useIdle2 ? anim.idle2! : anim.idle;
            return d.frame + (this.animFrame % d.count);
          }
          // G5: DO_STAND_GUARD uses anim.guard when unit is in guard/area-guard mission.
          // C++ infantry.cpp Shape_Number reads DoControls[DO_STAND_GUARD] when Doing==DO_STAND_GUARD.
          // Falls back to ready for types without a separate guard pose.
          if ((this.mission === Mission.GUARD || this.mission === Mission.AREA_GUARD) && anim.guard) {
            const d = anim.guard;
            return d.frame + sdir * d.jump;
          }
          const d = anim.ready;
          return d.frame + sdir * d.jump;
        }
      }
    }

    // --- Vehicles: 32-frame body rotation via BodyShape lookup ---
    // Use 32-step bodyFacing32 for smooth visual rotation (C++ Dir_To_32)
    const bodyFrame = BODY_SHAPE[this.bodyFacing32];

    switch (this.animState) {
      case AnimState.WALK:
        return bodyFrame;
      case AnimState.ATTACK:
        return bodyFrame; // fire effect is separate
      case AnimState.DIE:
        return bodyFrame; // freeze at last facing; explosion effect handles visual
      default:
        return bodyFrame;
    }
  }

  /** Take damage, return true if killed. warhead affects death animation.
   *  Optional attacker parameter enables DG1: dog instant-kill when attacking its designated target. */
  takeDamage(
    amount: number,
    warhead?: string,
    attacker?: Entity,
    warheadPropsOverride?: WarheadProps,
    options: { skipArmorBias?: boolean; skipProneBias?: boolean; hasDamageSource?: boolean } = {},
  ): boolean {
    if (!this.alive) return false;
    if (this.isInvulnerable) return false; // invulnerability (crate or Iron Curtain)
    // DG2: Dog collateral prevention — dogs only hurt their designated target (C++ combat.cpp)
    if (attacker && attacker.alive && attacker.type === UnitType.I_DOG && attacker.target !== this) {
      return false; // not the dog's target, no damage
    }
    // DG1: Dog instant-kill — if attacker is a living dog and this is the dog's target, instant kill
    // Use maxHp to guarantee kill even for high-HP targets like 200hp spies (C++ infantry.cpp)
    if (attacker && attacker.alive && attacker.type === UnitType.I_DOG && attacker.target === this) {
      amount = this.maxHp; // override damage to guaranteed kill (not this.hp which could leave at 0)
    }
    // CR2: Apply armor bias (damage reduction multiplier from crate, default 1.0)
    if (!options.skipArmorBias && this.armorBias > 1.0 && amount > 0) {
      amount = Math.max(1, Math.round(amount / this.armorBias));
    }
    // C++ infantry.cpp:329-330 — prone infantry take 50% damage (ProneDamageBias)
    // C++ only applies ProneDamageBias in infantry.cpp, not unit.cpp — vehicles are unaffected
    if (!options.skipProneBias && this.isProne && amount > 0 && this.stats.isInfantry) {
      amount = Math.max(1, Math.round(amount * PRONE_DAMAGE_BIAS));
    }
    this.hp -= amount;
    // C++ object.cpp:1614 — Strength capped at MaxStrength (healing cannot exceed max HP)
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    this.damageFlash = 4;
    // Force-uncloak cloaked subs on damage
    if (this.stats.isCloakable && (this.cloakState === CloakState.CLOAKED || this.cloakState === CloakState.CLOAKING)) {
      this.cloakState = CloakState.UNCLOAKING;
      this.cloakTimer = CLOAK_TRANSITION_FRAMES;
    }
    // C++ infantry.cpp:442-457 — fear on damage (mutually exclusive branches)
    // Branch A: known attacker + low fear → jump to SCARED/PANIC
    // Branch B: no attacker OR already scared → incremental moreFear
    if (this.stats.isInfantry && amount > 0) {
      if ((attacker || options.hasDamageSource) && this.fear < Entity.FEAR_SCARED) {
        this.fear = this.stats.isFraidyCat ? Entity.FEAR_PANIC : Entity.FEAR_SCARED;
      } else {
        let moreFear = Entity.FEAR_ANXIOUS;
        const hpRatio = this.hp / this.maxHp;
        if (hpRatio > CONDITION_RED) moreFear = Math.floor(moreFear / 2);
        if (hpRatio > CONDITION_YELLOW) moreFear = Math.floor(moreFear / 2);
        this.fear = Math.min(this.fear + moreFear, Entity.FEAR_MAXIMUM);
      }
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.mission = Mission.DIE;
      this.animState = AnimState.DIE;
      this.animFrame = 0;
      this.animTick = 0;
      this.deathTick = 0;
      // R7: Use warhead's infantryDeath property from C++ warhead.cpp InfantryDeath.
      // Pass through the full C++ InfDeath value:
      //   0=instant delete, 1=DO_GUN_DEATH, 2=DO_EXPLOSION_DEATH,
      //   3=DO_GRENADE_DEATH, 4=DO_FIRE_DEATH, 5=electro anim + delete.
      const whProps = warheadPropsOverride ?? (warhead ? WARHEAD_PROPS[warhead as WarheadType] : undefined);
      if (whProps !== undefined) {
        this.deathVariant = whProps.infantryDeath; // full 0-5 range from C++
      } else {
        this.deathVariant = ScenarioRandom.float() < 0.4 ? 1 : 0; // fallback: random
      }
      // Kill all passengers when transport is destroyed
      for (const p of this.passengers) {
        p.alive = false;
        p.mission = Mission.DIE;
        p.transportRef = null;
        p.isTethered = false;
      }
      this.passengers = [];
      return true;
    }
    return false;
  }

  /** C++ ObjectClass::Target_Coord for this entity.
   *  This differs from Center_Coord while falling/airborne: As_Coord(TARGET)
   *  subtracts object Height, and TechnoClass::Can_Fire/In_Range(TARGET) use
   *  that coordinate rather than the object center. */
  targetCoordLeptons(): LeptonPos {
    const height = this.stats.isAircraft
      ? this.aircraftHeightLeptons
      : (this.fallHeightLeptons > 0
          ? this.fallHeightLeptons
          : (this.flightAltitude > 0 ? pixelToLepton(this.flightAltitude) : 0));
    return { lx: this.leptonX, ly: this.leptonY - height };
  }

  /** C++ TechnoClass::In_Range(TARGET): Fire_Coord(which) to As_Coord(target).
   *  Uses C++ Fire_Coord(which), then Distance() octagonal approximation
   *  (max+min/2) via leptonDist(). Evaluate_Object's Object* overload is
   *  separate and uses target Center_Coord; guard scan code performs that
   *  center check directly. */
  inRange(other: Entity): boolean {
    const targetCoord = other.targetCoordLeptons();
    return this.inRangeCoord(targetCoord.lx, targetCoord.ly);
  }

  /** C++ FootClass::Likely_Coord — use Head_To_Coord when a foot target is mid-hop. */
  likelyCoord(): LeptonPos {
    if (this.headToLX > 0 && this.headToLY > 0) {
      return { lx: this.headToLX, ly: this.headToLY };
    }
    return { lx: this.leptonX, ly: this.leptonY };
  }

  /** C++ TechnoClass::In_Range(COORDINATE, weapon) variant used by PCP path-shorten. */
  inRangeCoord(lx: number, ly: number): boolean {
    if (this.weapon) {
      const fc = this.fireCoordForWeapon(this.weapon);
      if (leptonDist(fc.lx, fc.ly, lx, ly) <= this.weapon.range * LEPTON_SIZE) return true;
    }
    if (this.weapon2) {
      const fc = this.fireCoordForWeapon(this.weapon2);
      if (leptonDist(fc.lx, fc.ly, lx, ly) <= this.weapon2.range * LEPTON_SIZE) return true;
    }
    return false;
  }

  /** C++ foot.cpp:1475-1477 path-shorten: use target FootClass::Likely_Coord(). */
  inRangeOfLikelyCoord(other: Entity): boolean {
    const coord = other.likelyCoord();
    return this.inRangeCoord(coord.lx, coord.ly);
  }

  /** Check if target is in range of a specific weapon */
  inRangeWith(other: Entity, weapon: WeaponStats): boolean {
    const targetCoord = other.targetCoordLeptons();
    return this.inRangeWithCoord(targetCoord.lx, targetCoord.ly, weapon);
  }

  inRangeWithCoord(lx: number, ly: number, weapon: WeaponStats): boolean {
    const fc = this.fireCoordForWeapon(weapon);
    return leptonDist(fc.lx, fc.ly, lx, ly) <= weapon.range * LEPTON_SIZE;
  }

  /** C++ TechnoClass::Can_Fire target-class legality used by What_Weapon_Should_I_Use.
   *  This mirrors only FIRE_CANT/FIRE_ILLEGAL target gates; range and Arm timers are
   *  handled by the caller's actual fire gate. */
  canWeaponTarget(target: Entity, weapon: WeaponStats): boolean {
    const targetIsAircraft = !!target.stats.isAircraft;
    const targetIsAirborne = targetIsAircraft && target.flightAltitude > 0;
    const targetIsSubmarine = target.type === UnitType.V_SS || target.type === UnitType.V_MSUB;
    const targetIsSea = target.isNavalUnit;
    const targetIsGrounded = !targetIsAircraft || target.flightAltitude <= 0;

    if (targetIsAirborne && !weapon.isAntiAir) return false;
    if (weapon.isAntiGround === false && targetIsGrounded && !targetIsSubmarine) return false;

    if (targetIsSubmarine && !weapon.isAntiSub) return false;
    if (weapon.isAntiSub) {
      if (!targetIsSea) return false;
      if (target.isNavalUnit && !targetIsSubmarine && !weapon.isSubSurface) return false;
    }

    return true;
  }

  /** C++ TechnoClass::Fire_Coord(which), with VesselClass overrides. */
  fireCoordForWeapon(weapon: WeaponStats | null): { lx: number; ly: number } {
    const which = weapon && this.weapon2 && weapon === this.weapon2 ? 1 : 0;
    const move = (coord: { lx: number; ly: number }, dir256: number, dist: number) => {
      const dir = dir256 & 0xFF;
      return {
        lx: coord.lx + ((COS_TABLE_256[dir] * dist) >> 7),
        ly: coord.ly - ((SIN_TABLE_256[dir] * dist) >> 7),
      };
    };

    if (this.type === UnitType.V_PT) {
      // C++ vessel.cpp:1177-1180 — PT uses this override for both 2Inch and
      // DepthCharge: PrimaryFacing 0x80, north 0x20, Turret_Facing 0x10.
      let coord = { lx: this.leptonX, ly: this.leptonY };
      const primaryFacing = this.bodyFacing256 >= 0 ? this.bodyFacing256 & 0xFF : (this.facing * 32) & 0xFF;
      const turretFacing = this.turretFacing256 >= 0 ? this.turretFacing256 & 0xFF : (this.turretFacing * 32) & 0xFF;
      coord = move(coord, primaryFacing, 0x0080);
      coord = move(coord, 0, 0x0020);
      coord = move(coord, turretFacing, 0x0010);
      return coord;
    }

    if (this.type === UnitType.V_CA) {
      // C++ vessel.cpp:1163-1174 — cruiser alternates fore/aft by IsSecondShot,
      // then applies a north and turret offset. The `which` parameter is ignored.
      let coord = { lx: this.leptonX, ly: this.leptonY };
      const primaryFacing = this.bodyFacing256 >= 0 ? this.bodyFacing256 & 0xFF : (this.facing * 32) & 0xFF;
      const turretFacing = this.turretFacing256 >= 0 ? this.turretFacing256 & 0xFF : (this.turretFacing * 32) & 0xFF;
      coord = move(coord, this.isSecondShot ? (primaryFacing + 128) : primaryFacing, 0x0100);
      coord = move(coord, 0, 0x0030);
      coord = move(coord, turretFacing, 0x0040);
      return coord;
    }

    return this.fireCoordByWeaponIndex(which);
  }

  /**
   * C++ `TechnoClass::Fire_Coord(0)` — bullet-launch coordinate, in leptons.
   * (techno.cpp:491-517.) Applies three Coord_Move offsets in order:
   *
   *   1. DIR_N by (VerticalOffset + Height)
   *   2. (turret + DIR_W) by PrimaryLateral      (IsSecondShot ? DIR_E)
   *   3. turret by PrimaryOffset
   *
   * Used by `In_Range` (techno.cpp:1289) inside `Evaluate_Object` when the
   * radial-scan caller passes `range == 0` (THREAT_RANGE).
   *
   * Per-type offsets ported from C++ type constructors:
   * - Vehicles: udata.cpp UnitTypeClass initializers
   * - Infantry: idata.cpp:370-864, DOG VO=0x15/PO=0x10, all others
   *   VO=0x35/PO=0x10. Infantry Turret_Facing resolves to body facing.
   *
   * `IsSecondShot` is false in the Mission_Guard scan path (no active
   * second-shot cycle when acquiring a fresh TarCom), so we use DIR_W for
   * lateral offset. Height is 0 for ground units.
   */
  fireCoordPrimary(): { lx: number; ly: number } {
    return this.fireCoordByWeaponIndex(0);
  }

  /** C++ TechnoClass::Fire_Coord(0) evaluated from a temporary Coord.
   *
   *  FootClass::Mission_Guard_Area temporarily swaps `Coord` to ArchiveTarget
   *  before calling Target_Something_Nearby(THREAT_AREA). TechnoClass::
   *  Greatest_Threat seeds its ring scan from Coord_Cell(Fire_Coord(0)), so
   *  the temporary coordinate still receives infantry/vehicle muzzle offsets. */
  fireCoordPrimaryFrom(lx: number, ly: number): { lx: number; ly: number } {
    return this.fireCoordByWeaponIndex(0, lx, ly);
  }

  private fireCoordByWeaponIndex(which: 0 | 1, baseLX = this.leptonX, baseLY = this.leptonY): { lx: number; ly: number } {
    let lx = baseLX;
    let ly = baseLY;
    const offsets =
      this.type === UnitType.I_DOG ? DOG_FIRE_COORD_OFFSETS :
      this.stats.isInfantry ? INFANTRY_FIRE_COORD_OFFSETS :
      UNIT_FIRE_COORD_OFFSETS[this.type];
    if (!offsets) return { lx, ly };
    const forwardOffset = which === 0 ? offsets.primary : offsets.secondary;
    const lateralOffset = which === 0 ? offsets.lateral : offsets.secondaryLateral;

    // Step 1: move north by VerticalOffset + Height.
    //   DIR_N in the 256-step facing table is index 0; CosTable[0]=0,
    //   SinTable[0]=127. x += calcx(0, d) = 0. y += calcy(127, d) = -d.
    //   (calcy returns -(v*d)>>7; with v=127, -(127*d)>>7 ≈ -d.)
    // C++ Height is stored in leptons. Aircraft keep exact Height in
    // aircraftHeightLeptons; falling non-aircraft use fallHeightLeptons.
    const height = this.stats.isAircraft
      ? this.aircraftHeightLeptons
      : this.fallHeightLeptons;
    const dN = offsets.vertical + height;
    // calcy(SIN_TABLE_256[0]=127, dN) = -(127*dN)>>7
    ly += -((127 * dN) >> 7);
    // calcx(COS_TABLE_256[0]=0, dN) = 0 → no x change.

    // Step 2: move (turret + DIR_W) by Primary/SecondaryLateral.
    //   DIR_W = 192 in the 256-step table. (turret + DIR_W) wraps via & 0xFF.
    //   C++ uses DIR_E instead when IsSecondShot is true.
    //   For lateral=0, this is a no-op; skip the math.
    const turret256 = this.stats.isInfantry
      ? (this.bodyFacing256 >= 0 ? this.bodyFacing256 & 0xFF : (this.facing * 32) & 0xFF)
      : this.turretFacing256 >= 0 &&
        dir256ToFacing32(this.turretFacing256) === this.turretFacing32 &&
        dir256ToFacing8(this.turretFacing256) === this.turretFacing
          ? this.turretFacing256 & 0xFF
          : (this.turretFacing32 * 8) & 0xFF;
    if (lateralOffset !== 0) {
      const lateralBase = this.isSecondShot ? 64 : 192; // DIR_E or DIR_W
      const dir2 = (turret256 + lateralBase) & 0xFF;
      const c2 = COS_TABLE_256[dir2];
      const s2 = SIN_TABLE_256[dir2];
      lx += (c2 * lateralOffset) >> 7;
      ly += -((s2 * lateralOffset) >> 7);
    }

    // Step 3: move turret dir by Primary/SecondaryOffset.
    const c3 = COS_TABLE_256[turret256];
    const s3 = SIN_TABLE_256[turret256];
    lx += (c3 * forwardOffset) >> 7;
    ly += -((s3 * forwardOffset) >> 7);
    return { lx, ly };
  }

  /** C++ TechnoClass::What_Weapon_Should_I_Use (techno.cpp:342-384).
   *  Scores weapons by warhead-vs-armor modifier only, doubles the score when
   *  that weapon is in range, and zeros only Can_Fire results that are
   *  FIRE_CANT/FIRE_ILLEGAL. Cooldown (FIRE_REARM), range (FIRE_RANGE), ammo,
   *  facing, and movement gates do not change the selected weapon; the caller's
   *  fire gate decides whether the selected weapon can actually fire this tick. */
  selectWeapon(target: Entity, getWarheadMult: (warhead: WarheadType, armor: ArmorType) => number): WeaponStats | null {
    const w1 = this.weapon;
    const w2 = this.weapon2;

    // Single-weapon unit: just return primary
    if (!w2) return w1;
    if (!w1) return w2;

    const scoreWeapon = (weapon: WeaponStats): number => {
      if (!this.canWeaponTarget(target, weapon)) return 0;
      let score = getWarheadMult(weapon.warhead, target.stats.armor) * 1000;
      if (this.inRangeWith(target, weapon)) score *= 2;
      return score;
    };

    const score1 = scoreWeapon(w1);
    const score2 = scoreWeapon(w2);

    return score2 > score1 ? w2 : w1;
  }

  /** C++ TechnoTypeClass::Is_Two_Shooter (techno.cpp:6262-6268). */
  isTwoShooter(): boolean {
    if (!this.weapon) return false;
    return this.weapon === this.weapon2 || (this.weapon.burst ?? 1) > 1;
  }

  /** Update animation frame — uses per-type rate overrides from C++ MasterDoControls */
  tickAnimation(): void {
    // G3: Detect prone transitions for LIE_DOWN/GET_UP animations.
    // C++ infantry.cpp: Do_Action(DO_LIE_DOWN) before entering prone, DO_GET_UP before standing.
    // Only trigger on actual transitions, not every tick while prone.
    // Only play transition when idle-ish — if unit is actively walking/attacking/dying,
    // the prone visual switches immediately (C++ also interrupts transitions on move orders).
    if (this.stats.isInfantry && this.isProne !== this.prevIsProne) {
      const anim = INFANTRY_ANIMS[this.type];
      const isIdleLike = this.animState === AnimState.IDLE || this.animState === AnimState.GUARD_IDLE
        || this.animState === AnimState.AREA_GUARD_IDLE || this.animState === AnimState.PRONE
        || this.animState === AnimState.GESTURE;
      if (isIdleLike) {
        if (this.isProne && !this.prevIsProne && anim?.lieDown) {
          // Standing → Prone: play LIE_DOWN first
          this.animState = AnimState.LIE_DOWN;
          this.animFrame = 0;
          this.animTick = 0;
        } else if (!this.isProne && this.prevIsProne && anim?.getUp) {
          // Prone → Standing: play GET_UP first
          this.animState = AnimState.GET_UP;
          this.animFrame = 0;
          this.animTick = 0;
        }
      }
      this.prevIsProne = this.isProne;
    }

    // G3: Handle LIE_DOWN/GET_UP animation completion.
    // When transition animation finishes, advance to the target state.
    if (this.stats.isInfantry) {
      const anim = INFANTRY_ANIMS[this.type];
      if (this.animState === AnimState.LIE_DOWN && anim?.lieDown) {
        // LIE_DOWN uses directional frames (jump > 0), count is frames per facing
        if (this.animFrame >= anim.lieDown.count) {
          this.animState = AnimState.IDLE; // prone idle is handled by IDLE+isProne in spriteFrame
          this.animFrame = 0;
          this.animTick = 0;
        }
      } else if (this.animState === AnimState.GET_UP && anim?.getUp) {
        if (this.animFrame >= anim.getUp.count) {
          this.animState = AnimState.IDLE;
          this.animFrame = 0;
          this.animTick = 0;
        }
      }

      // G8: Handle GESTURE animation completion — return to IDLE when done.
      if (this.animState === AnimState.GESTURE && this.gestureDoInfo) {
        if (this.animFrame >= this.gestureDoInfo.count) {
          this.animState = AnimState.IDLE;
          this.animFrame = 0;
          this.animTick = 0;
          this.gestureDoInfo = null;
        }
      }
    }

    // G6: Random_Animate frame-start for WALK/CRAWL (C++ MasterDoControls RandomStart=true).
    // When infantry enters WALK state, start at a random offset into the walk cycle so groups
    // of infantry don't all animate in lockstep. Same applies to crawl (same count as walk).
    // C++ infantry.cpp:1964 Do_Action: start stage is randomized when IsRandom flag set.
    // Also re-randomize the idle fidget variant on every fresh idle transition (G7).
    if (this.animState !== this.prevAnimState) {
      if (this.stats.isInfantry) {
        if (this.animState === AnimState.WALK) {
          const ta = INFANTRY_ANIMS[this.type];
          const walkD = (this.isProne && ta?.crawl) ? ta.crawl : ta?.walk;
          const cnt = walkD ? Math.max(walkD.count, 1) : 1;
          this.animFrame = NonCriticalRandom.nextInRange(0, cnt - 1);
          this.animTick = 0;
        } else if (this.animState === AnimState.IDLE || this.animState === AnimState.GUARD_IDLE) {
          // G7: re-randomize idle fidget selection each time unit returns to idle.
          this.fidgetDelay = NonCriticalRandom.nextInRange(12, 31);
          this.fidgetVariant = NonCriticalRandom.float();
        }
      }
      this.prevAnimState = this.animState;
    }
    this.animTick++;
    // Per-type animation rate overrides (R3: C++ MasterDoControls variable timing)
    const typeAnim = this.stats.isInfantry ? INFANTRY_ANIMS[this.type] : undefined;
    // C++ infantry.cpp:98 MasterDoControls defaults:
    //   DO_WALK rate=2, DO_CRAWL rate=2, DO_FIRE_WEAPON rate=1, DO_IDLE1/2 rate=2.
    // Default walk=2 per MasterDoControls (G4).
    const defaultWalk = 2;
    const defaultAttack = 5;
    const defaultIdle = 4;
    // G3: LIE_DOWN/GET_UP use rate=2 per C++ MasterDoControls (same as walk/crawl).
    const defaultTransition = 2;
    // Ants: faster walk animation (1 frame/tick) — C++ ties body frames to track steps,
    // but our animation is decoupled. Rate 1 matches their fast movement speed.
    const antWalk = 1;
    const antAttack = 3;
    const rate = this.isAnt
      ? (this.animState === AnimState.WALK ? antWalk : this.animState === AnimState.ATTACK ? antAttack : defaultIdle)
      : this.animState === AnimState.WALK ? (typeAnim?.walkRate ?? defaultWalk) :
                 this.animState === AnimState.ATTACK ? (typeAnim?.attackRate ?? defaultAttack) :
                 this.animState === AnimState.DIE ? 2 :
                 this.animState === AnimState.LIE_DOWN || this.animState === AnimState.GET_UP ? defaultTransition :
                 this.animState === AnimState.GESTURE ? defaultIdle :
                 (typeAnim?.idleRate ?? defaultIdle);
    if (this.animTick >= rate) {
      this.animTick = 0;
      this.animFrame++;
    }

    // G8: Gesture/salute trigger during idle fidget (~5% chance, C++ infantry.cpp:886-888).
    // When idle fidget delay expires and fidgetVariant lands in the gesture range,
    // transition to GESTURE state instead of playing idle1/idle2.
    if (this.stats.isInfantry && !this.isProne
        && (this.animState === AnimState.IDLE || this.animState === AnimState.GUARD_IDLE)
        && this.animFrame > this.fidgetDelay && this.fidgetVariant < 0.05) {
      const ta = INFANTRY_ANIMS[this.type];
      if (ta && (ta.gesture1 || ta.gesture2 || ta.salute1 || ta.salute2)) {
        const candidates: { frame: number; count: number; jump: number }[] = [];
        if (ta.gesture1) candidates.push(ta.gesture1);
        if (ta.gesture2) candidates.push(ta.gesture2);
        if (ta.salute1) candidates.push(ta.salute1);
        if (ta.salute2) candidates.push(ta.salute2);
        // Use fidgetVariant to deterministically select which gesture
        const idx = Math.floor((this.fidgetVariant / 0.05) * candidates.length) % candidates.length;
        this.gestureDoInfo = candidates[idx];
        this.animState = AnimState.GESTURE;
        this.animFrame = 0;
        this.animTick = 0;
      }
    }

    if (!this.alive) this.deathTick++;
    if (this.damageFlash > 0) this.damageFlash--;
  }

  /** Gradually rotate facing toward desiredFacing based on rot speed.
   *  C++ facing.cpp:142-180 FacingClass::Rotation_Adjust.
   *  Vehicles rotate in exact 256-step DirType space and only report ready
   *  when PrimaryFacing.Current() == DesiredFacing. The 8-way facing is a
   *  rounded derivative for compatibility/rendering, not the movement gate.
   *  Infantry snap instantly. */
  tickRotation(): boolean {
    // Infantry snap instantly — C++ doesn't use Rotation_Adjust for infantry body facing.
    if (this.stats.isInfantry) {
      this.facing = this.desiredFacing;
      this.bodyFacing256 = (this.facing * 32) & 0xff;
      this.bodyFacing32 = this.facing * 4;
      this.rotAccumulator = 0;
      return true;
    }

    if (
      this.bodyFacing256 >= 0 &&
      dir256ToFacing8(this.bodyFacing256) !== this.facing
    ) {
      this.bodyFacing256 = (this.facing * 32) & 0xff;
      this.bodyFacing32 = this.facing * 4;
    } else if (this.bodyFacing256 < 0) {
      this.bodyFacing256 = (this.facing * 32) & 0xff;
    }

    // C++ PrimaryFacing is a FacingClass with 256-step Current/Desired.
    // `desiredFacing` is only the rounded 8-way derivative. Use the exact
    // desiredFacing256 when a class AI path (for example VesselClass::Combat_AI)
    // has set it; otherwise fall back to the legacy 8-way desired.
    const desiredFacing256 = this.desiredFacing256 >= 0
      ? (this.desiredFacing256 & 0xff)
      : ((this.desiredFacing * 32) & 0xff);
    if (this.bodyFacing256 === desiredFacing256) {
      this.rotAccumulator = 0;
      this.facing = dir256ToFacing8(this.bodyFacing256);
      this.bodyFacing32 = dir256ToFacing32(this.bodyFacing256);
      this.desiredFacing = dir256ToFacing8(desiredFacing256);
      return true;
    }

    // Guard against double-rotation in the same game tick.
    if (this.rotTickedThisFrame) return this.bodyFacing256 === desiredFacing256;
    this.rotTickedThisFrame = true;

    // C++ Rotation_Adjust clamps rate to 127 and applies the whole rate in
    // 256-dir space. GroundspeedBias is an 8.8 fixed-point value; multiplying
    // ROT by it uses fixed::operator*(int), which rounds with +128 before /256.
    const groundspeedRaw = Math.trunc(this.groundspeedBias * 256 + 1e-9);
    const rate = Math.min(Math.trunc((this.stats.rot * groundspeedRaw + 128) / 256), 127);
    if (rate > 0) {
      let diff = (desiredFacing256 - this.bodyFacing256) & 0xff;
      if (diff >= 128) diff -= 256; // C++ signed char wrap
      if (Math.abs(diff) < rate) {
        this.bodyFacing256 = desiredFacing256;
      } else if (diff < 0) {
        this.bodyFacing256 = (this.bodyFacing256 - rate + 256) & 0xff;
      } else {
        this.bodyFacing256 = (this.bodyFacing256 + rate) & 0xff;
      }
    }

    this.facing = dir256ToFacing8(this.bodyFacing256);
    this.bodyFacing32 = dir256ToFacing32(this.bodyFacing256);
    this.desiredFacing = dir256ToFacing8(desiredFacing256);
    return this.bodyFacing256 === desiredFacing256;
  }

  /** C++ facing.cpp:142 Rotation_Adjust for aircraft 256-step facing.
   *  Adjusts facing256 toward desiredFacing256 by up to ROT per tick.
   *  Difference is computed as (signed byte)(desired - current), matching
   *  C++ (signed char) cast for shortest-path direction.
   *  Syncs 8-dir `facing` and 32-step `bodyFacing32` from facing256.
   *  Returns true if facing256 === desiredFacing256. */
  tickRotation256(): boolean {
    if (this.facing256 < 0) return this.tickRotation(); // not using 256-step

    if (this.facing256 === this.desiredFacing256) {
      // Already aligned — sync derived facings
      this.facing = dir256ToFacing8(this.facing256);
      this.bodyFacing32 = dir256ToFacing32(this.facing256);
      return true;
    }

    // Guard against double-rotation per tick
    if (this.rotTickedThisFrame) return this.facing256 === this.desiredFacing256;
    this.rotTickedThisFrame = true;

    const rate = this.stats.rot;
    // C++ facing.cpp:152: diff = (signed char)(DesiredFacing - CurrentFacing)
    // signed char range: -128 to 127. Positive = CW, negative = CCW.
    let diff = (this.desiredFacing256 - this.facing256) & 0xFF;
    if (diff > 127) diff -= 256; // convert to signed: 128..255 → -128..-1

    if (Math.abs(diff) < rate) {
      // Snap to desired (C++ facing.cpp:159-160)
      this.facing256 = this.desiredFacing256;
    } else if (diff < 0) {
      // CCW (C++ facing.cpp:168-169)
      this.facing256 = (this.facing256 - rate + 256) & 0xFF;
    } else {
      // CW (C++ facing.cpp:171)
      this.facing256 = (this.facing256 + rate) & 0xFF;
    }

    // Sync derived facings for rendering and game logic
    this.facing = dir256ToFacing8(this.facing256);
    this.bodyFacing32 = dir256ToFacing32(this.facing256);
    this.desiredFacing = dir256ToFacing8(this.desiredFacing256);
    return this.facing256 === this.desiredFacing256;
  }

  /** Gradually rotate turret toward desiredTurretFacing.
   *  C++ RA unit.cpp:542: SecondaryFacing.Rotation_Adjust(Class->ROT+1).
   *  Turret rotates in exact 256-step DirType space; 32-step turretFacing32 is
   *  only the rounded sprite-facing derivative. */
  tickTurretRotation(): boolean {
    if (this.turretFacing256 < 0 ||
        dir256ToFacing32(this.turretFacing256) !== this.turretFacing32 ||
        dir256ToFacing8(this.turretFacing256) !== this.turretFacing) {
      this.turretFacing32 = this.turretFacing * 4;
      this.turretFacing256 = (this.turretFacing * 32) & 0xff;
    }
    if (this.desiredTurretFacing256 < 0 ||
        dir256ToFacing8(this.desiredTurretFacing256) !== this.desiredTurretFacing) {
      this.desiredTurretFacing256 = (this.desiredTurretFacing * 32) & 0xff;
    }

    const desired256 = this.desiredTurretFacing256 & 0xff;
    if (this.turretFacing256 === desired256) {
      this.turretRotAccumulator = 0;
      this.turretIsRotating = false;
      this.turretFacing = dir256ToFacing8(this.turretFacing256);
      this.desiredTurretFacing = dir256ToFacing8(desired256);
      this.turretFacing32 = dir256ToFacing32(this.turretFacing256);
      return true;
    }
    // Guard against double-accumulation in the same game tick
    if (this.turretRotTickedThisFrame) return !this.turretIsRotating;
    this.turretRotTickedThisFrame = true;

    // C++ FacingClass::Rotation_Adjust: clamp to 127, then apply the full rate
    // in 256-dir space using signed-char shortest-path difference.
    const rate = Math.min(this.stats.rot + 1, 127);
    if (rate > 0) {
      let diff = (desired256 - this.turretFacing256) & 0xff;
      if (diff >= 128) diff -= 256;
      if (Math.abs(diff) < rate) {
        this.turretFacing256 = desired256;
      } else if (diff < 0) {
        this.turretFacing256 = (this.turretFacing256 - rate + 256) & 0xff;
      } else {
        this.turretFacing256 = (this.turretFacing256 + rate) & 0xff;
      }
    }

    this.turretFacing = dir256ToFacing8(this.turretFacing256);
    this.desiredTurretFacing = dir256ToFacing8(desired256);
    this.turretFacing32 = dir256ToFacing32(this.turretFacing256);
    this.turretIsRotating = this.turretFacing256 !== desired256;
    return !this.turretIsRotating;
  }

  /** Move toward a world position at the unit's speed.
   *  C++ RA drive.cpp: vehicles stop, rotate to face destination, THEN move.
   *  Infantry are nimble and move while rotating.
   *  M7: speed is multiplied by speedBias (crate pickup bonus).
   *
   *  Uses C++ Coord_Move integer arithmetic (coord.cpp:440-554):
   *    - 256-step direction from Desired_Facing256 (face.cpp:150-227)
   *    - COS_TABLE_256 / SIN_TABLE_256 lookup with >> 7 shift
   *    - x += (CosTable[dir] * distance) >> 7
   *    - y -= (SinTable[dir] * distance) >> 7
   *  All arithmetic is integer; no floating point in the movement path. */
  moveToward(target: LeptonPos | WorldPos, speed: number, preserveDrivingOnArrival = false): boolean {
    // M7: Apply crate speed bias multiplier
    const effectiveSpeed = speed * this.speedBias;

    // ALL distance computation in integer lepton space (C++ parity).
    // Accept both LeptonPos {lx,ly} and legacy WorldPos {x,y} for backward compat.
    const targetLeptonX = 'lx' in target ? target.lx : Math.trunc(target.x / LP);
    const targetLeptonY = 'ly' in target ? target.ly : Math.trunc(target.y / LP);
    const dxL = targetLeptonX - this.leptonX;
    const dyL = targetLeptonY - this.leptonY;
    // C++ Distance() octagonal approximation for snap distance
    const distLeptonsTotal = leptonDist(this.leptonX, this.leptonY, targetLeptonX, targetLeptonY);

    // C++ infantry snaps at Distance < 0x0010 (16 leptons). Vehicles at sub-pixel.
    const snapLeptons = this.stats.isInfantry ? 16 : 5;
    if (distLeptonsTotal < snapLeptons) {
      this.leptonX = targetLeptonX;
      this.leptonY = targetLeptonY;
      this.syncPosFromLeptons();
      this.speedAccum = 0;
      if (!preserveDrivingOnArrival) this.isDriving = false;
      return true;
    }

    // C++ Start_Driver: entity is now in motion
    if (this.stats.isInfantry) this.isDriving = true;

    // C++ uses integer lepton coordinates for direction computation (Desired_Facing8).
    this.desiredFacing = directionToLeptons(this.leptonX, this.leptonY, targetLeptonX, targetLeptonY);
    if (!this.stats.isInfantry) this.desiredFacing256 = (this.desiredFacing * 32) & 0xff;
    const facingAligned = this.tickRotation();

    // Vehicles: stop-rotate-move (don't slide sideways while turning)
    // Aircraft always move forward — never stop to rotate in flight
    // Note: C++ three-point turn code (drive.cpp:339) is behind #ifdef TOFIX — NOT compiled
    if (!this.stats.isInfantry && !this.stats.isAircraft && !facingAligned) {
      return false; // still rotating — don't move yet
    }

    // --- Infantry path: C++ infantry.cpp:4020-4056 ---
    // C++: Coord_Move(Coord, Direction(Head_To_Coord()), maxspeed * fixed(movespeed, 256))
    // Direction() is Desired_Facing256 — full 256-step precision toward the target.
    // This is NOT the 8-dir visual facing; it's the precise direction for movement math.
    if (this.stats.isInfantry) {
      // C++ infantry.cpp:4020-4036:
      //   movespeed = Speed;  // TechnoClass::Speed = current speed fraction (0-255)
      //   if (IsDog && TarCom) movespeed *= 2;
      //   if (IsProne && !IsDog) {
      //     if (IsFraidyCat && !IsCrawling) movespeed = Speed*2;
      //     else movespeed = Speed/2;
      //   }
      //   Coord_Move(dir, maxspeed * fixed(movespeed, 256));
      //
      // Speed=255 for full speed. maxspeed = _Scale_To_256(MaxSpeed).
      // movementSpeed() already folds in canine sprint for the existing TS call
      // path; apply the prone/crawling modifier here so prone combat infantry
      // crawl at half speed instead of walking full speed.
      // maxspeed = floor(effectiveSpeed / LP) directly matches the C++ _Scale_To_256 result.
      const maxspeed = Math.floor(effectiveSpeed / LP);
      let movespeed = 255;
      if (this.isProne && !this.stats.isCanine) {
        movespeed = (this.stats.isFraidyCat && !this.stats.isCrawling) ? 510 : 127;
      }
      const distance = Math.trunc((maxspeed * movespeed + 128) / 256);

      // C++ Coord_Move: 256-step direction from Desired_Facing256(Coord, Head_To_Coord())
      const dir256 = directionToLeptons256(this.leptonX, this.leptonY, targetLeptonX, targetLeptonY);
      // C++ coord.cpp calcx/calcy: (table_value * distance) >> 7
      const stepLX = (COS_TABLE_256[dir256] * distance) >> 7;
      const stepLY = -((SIN_TABLE_256[dir256] * distance) >> 7);


      // C++ infantry.cpp:3992-4048 has no post-move per-axis clamp.
      // It snaps only before moving when Distance(Head_To_Coord()) < 0x10,
      // then applies Coord_Move in the exact 256-step direction. Per-axis
      // clamping lets TS flatten one axis early (e.g. y reaches HeadToCoord
      // while x keeps walking), which changes later weapon range checks.
      this.leptonX += stepLX;
      this.leptonY += stepLY;
      this.syncPosFromLeptons();

      // C++ does NOT have a post-movement snap check for infantry.
      // The only snap is the pre-movement Distance < 0x0010 check at the top.
      // Infantry moves via Coord_Move and the snap triggers on the NEXT tick's
      // pre-movement check when Distance(Head_To_Coord()) < 16.
      return false;
    }

    // --- Vehicle / aircraft path: SpeedAccum lepton accumulator ---
    // C++ lepton accumulator (fly.cpp:62-106 / drive.cpp SpeedAccum):
    //   SpeedAdd = MaxSpeed * fixed(0xFF, 256)  — 255/256 fraction, never truly 100%
    //   actual = (int)SpeedAdd + SpeedAccum;
    //   result = div(actual, PIXEL_LEPTON_W);
    //   SpeedAccum = result.rem;
    //   actual -= result.rem;
    //
    // Replicate the exact C++ integer truncation chain:
    //   1. _Scale_To_256: MaxSpeed = floor(iniSpeed * 256 / 100)
    //   2. Apply multipliers (damage, bias, terrain, canine) to MaxSpeed
    //   3. Set_Speed: SpeedAdd = floor(MaxSpeed * 255 / 256)  — the 255/256 fraction
    //   4. Accumulate SpeedAdd, emit in PIXEL_LEPTON_W (10) chunks
    //
    // effectiveSpeed arrives as pixels/tick (= iniSpeed * MPH_TO_PX * multipliers).
    // Convert back to MaxSpeed leptons: effectiveSpeed / LP = iniSpeed * 256/100 * multipliers.
    // Then apply the 255/256 fraction to match C++ Set_Speed.
    const maxSpeedLeptons = Math.floor(effectiveSpeed / LP); // = _Scale_To_256(speed) * multipliers
    // C++ drive.cpp:671: actual = SpeedAccum + maxspeed * fixed(Speed, 256)
    // fixed(0xFF, 256).Raw = 255. int * fixed = ((255 * maxspeed) + 128) / 256
    // The +128 is C++ fixed::operator*(int) rounding — without it, slow units
    // (MCV Speed=6 → maxspeed=15) get speedAdd=14 instead of 15 (7% slower).
    const speedAdd = Math.floor((maxSpeedLeptons * 255 + 128) / 256);
    const actual = speedAdd + this.speedAccum;
    const remainder = actual % PIXEL_LEPTON_W;
    this.speedAccum = remainder;
    const moveLeptons = actual - remainder;

    if (moveLeptons <= 0) {
      return false; // not enough accumulated for a pixel step this tick
    }

    // C++ parity: Coord_Move uses 256-step sin/cos lookup tables.
    // For vehicles: facing is aligned with desired (stop-rotate-move), so
    //   facing * 32 maps 8-dir to 256-step center. This gives exact C++ table values
    //   for the 8 cardinal/diagonal directions.
    // For aircraft: this path is a fallback (aircraft use aircraftFlyTo in aircraft.ts
    //   which has its own 256-step Coord_Move). If reached, use facing * 32.
    const dir256 = this.facing * 32;
    const cosVal = COS_TABLE_256[dir256]; // X component
    const sinVal = SIN_TABLE_256[dir256]; // Y component
    // C++ coord.cpp calcx/calcy: (table_value * distance) >> 7
    const stepLX = (cosVal * moveLeptons) >> 7;
    const stepLY = -((sinVal * moveLeptons) >> 7);

    // C++ fly.cpp:88: aircraft Coord_Move moves in the FACING direction without
    // clamping to the target position. This allows aircraft to fly past/away from
    // their target when facing perpendicular, creating curved flight paths.
    // Ground vehicles clamp to avoid overshooting the waypoint.
    // dxL/dyL already computed at top of function in integer lepton space.
    let finalLX: number;
    let finalLY: number;
    if (this.stats.isAircraft) {
      finalLX = stepLX;
      finalLY = stepLY;
    } else {
      finalLX = Math.abs(stepLX) <= Math.abs(dxL) ? stepLX : dxL;
      finalLY = Math.abs(stepLY) <= Math.abs(dyL) ? stepLY : dyL;
    }
    this.leptonX += finalLX;
    this.leptonY += finalLY;
    this.syncPosFromLeptons();

    // Check arrival: for vehicles, compare remaining distance to step size + tolerance
    const movedL = Math.abs(finalLX) + Math.abs(finalLY);
    return Math.abs(dxL) + Math.abs(dyL) <= movedL + 5;
  }
}

export function clearFallingParachuteAnim(entity: Entity): void {
  entity.fallParachuteAnimActive = false;
  entity.fallParachuteAnimLogicIndexHint = undefined;
  entity.fallParachuteAnimStage = 0;
  entity.fallParachuteAnimTimer = 4;
  entity.fallParachuteAnimLoops = 15;
  entity.fallParachuteAnimIsBrandNew = false;
  entity.fallParachuteAnimProcessedTick = -1;
  entity.fallHasAttachedAnim = false;
}

export function attachFallingParachuteAnim(
  entity: Entity,
  logicIndexHintForNewObject?: () => number | undefined,
  reserveAnimSlot?: () => boolean,
): boolean {
  if (reserveAnimSlot && !reserveAnimSlot()) {
    clearFallingParachuteAnim(entity);
    return false;
  }

  const logicIndexHint = logicIndexHintForNewObject?.();
  entity.fallHasAttachedAnim = true;
  entity.fallParachuteAnimActive = true;
  entity.fallParachuteAnimLogicIndexHint = logicIndexHint;
  entity.fallParachuteAnimStage = 0;
  entity.fallParachuteAnimTimer = 4;
  entity.fallParachuteAnimLoops = 15;
  entity.fallParachuteAnimIsBrandNew = true;
  entity.fallParachuteAnimProcessedTick = -1;
  return true;
}

/** C++ Shorten_Attached_Anims sets attached AnimClass::Loops to 0 when the
 * paradropped object lands. The parachute remains in the fixed AnimClass heap
 * until its current pass reaches the final frame. */
export function shortenFallingParachuteAnim(entity: Entity): void {
  if (entity.fallParachuteAnimActive) {
    entity.fallParachuteAnimLoops = 0;
  }
  entity.fallHasAttachedAnim = false;
}

export function processFallingParachuteAnim(entity: Entity): void {
  if (!entity.fallParachuteAnimActive) return;

  if (entity.fallParachuteAnimIsBrandNew) {
    entity.fallParachuteAnimIsBrandNew = false;
    return;
  }

  if (entity.fallParachuteAnimTimer > 0) entity.fallParachuteAnimTimer--;
  if (entity.fallParachuteAnimTimer > 0) return;
  entity.fallParachuteAnimTimer = 4;
  entity.fallParachuteAnimStage++;

  if (entity.fallParachuteAnimStage >= 16) {
    if (entity.fallParachuteAnimLoops > 0) entity.fallParachuteAnimLoops--;
    if (entity.fallParachuteAnimLoops > 0) {
      entity.fallParachuteAnimStage = 7;
    } else {
      clearFallingParachuteAnim(entity);
    }
  }
}

export function activeFallingParachuteAnimCount(entities: Entity[]): number {
  return entities.filter(entity => entity.fallParachuteAnimActive).length;
}

/** Recoil pixel offsets per 8-dir facing (C++ unit.cpp Recoil_Adjust, collapsed from 32-entry).
 *  Pushes turret/body back 1px in the opposite direction of the barrel for 1 tick. */
export const RECOIL_OFFSETS: Array<{ dx: number; dy: number }> = [
  { dx: 0, dy: 1 },   // N  — barrel points up, body kicks down
  { dx: -1, dy: 1 },  // NE
  { dx: -1, dy: 0 },  // E
  { dx: -1, dy: -1 }, // SE
  { dx: 0, dy: -1 },  // S
  { dx: 1, dy: -1 },  // SW
  { dx: 1, dy: 0 },   // W
  { dx: 1, dy: 1 },   // NW
];


/** AI2: Calculate threat score for guard targeting (C++ techno.cpp:1449-1763 Evaluate_Object).
 *  Higher score = higher priority target. Pure function for testability.
 *
 *  C++ algorithm (Evaluate_Object):
 *    1. value = object->Value() + object->Crew.Kills         (line 1651-1652)
 *       where Value() = Risk() + Reward = 2 * Points         (techno.cpp:4519, 6290)
 *    2. Designated enemy: value += 500; value *= 3;           (line 1659-1662)
 *    3. Area_Modify: value = areamod * value;                 (line 1732-1735)
 *    4. Distance: value = (value * 32000) / ((dist/256)+1);   (line 1752)
 *    5. value = max(value, 1);                                (line 1756)
 *    Integer arithmetic throughout.
 *
 *  @param scanner The unit doing the scanning
 *  @param target The potential target being evaluated
 *  @param dist Distance between scanner and target (in cells)
 *  @param isTargetAttackingAlly Whether the target is currently attacking an allied unit (unused, C++ handles elsewhere)
 *  @param closingSpeed Rate of distance change (unused, C++ has no equivalent)
 *  @param designatedEnemy AI4: enemy house that gets massive bonus (or null)
 *  @param nearFriendlyStructureCount AI5: count of friendly structures near target for Area_Modify */
export function threatScore(
  scanner: Entity, target: Entity, dist: number,
  designatedEnemy?: House | null,
  nearFriendlyStructureCount?: number,
  isTargetOutOfZone?: boolean,
  nervousBias?: number,
  includeTransportContents = false,
): number {
  // AI6: Spy target exclusion — spies are not normal targets (except for dogs)
  // C++ techno.cpp:1557-1563
  if (target.type === UnitType.I_SPY && scanner.type !== UnitType.I_DOG) {
    return 0;
  }

  // C++ techno.cpp:1651-1652: value = object->Value() + object->Crew.Kills
  // Value() = Risk() + Reward + attached cargo value (techno.cpp:4549-4566).
  let value = technoValue(target, includeTransportContents) + target.kills;

  // AI4: Designated enemy house bonus — +500 then multiply by 3
  // C++ techno.cpp:1659-1662
  if (designatedEnemy != null && target.house === designatedEnemy) {
    value = (value + 500) * 3;
  }

  // C++ techno.cpp:1668-1670: targets outside their own base zone get 2x value
  // Encourages attacking exposed/straggling units
  if (isTargetOutOfZone) {
    value *= 2;
  }

  // AI5: Area_Modify — reduce threat when target is near friendly structures
  // C++ techno.cpp:1732-1735: applied to value BEFORE distance (integer multiply)
  // C++ techno.cpp:1342-1401: odds /= 2 per nearby building (exponential halving)
  // C++ techno.cpp:1345: only applies when the primary weapon has IsSupressed.
  if (nearFriendlyStructureCount !== undefined && nearFriendlyStructureCount > 0 &&
      scanner.weapon?.isSupressed) {
    value = Math.trunc(value * Math.pow(0.5, nearFriendlyStructureCount));
  }

  // C++ techno.cpp:1742-1744: NervousBias — boost targets near scanner's own base
  // rules.ini [General] BaseBias=2 (overrides C++ default of 1)
  if (nervousBias !== undefined && nervousBias !== 1) {
    value = Math.trunc(value * nervousBias);
  }

  // AI2: Hyperbolic distance falloff (C++ techno.cpp:1752)
  // C++ integer division: dist/ICON_LEPTON_W truncates to cell count
  // dist is in cells already, so distCells = floor(dist)
  const distCells = Math.floor(dist);
  let score = Math.trunc((value * 32000) / (distCells + 1));

  // C++ techno.cpp:1756: value = max(value, 1)
  score = Math.max(score, 1);

  return score;
}
