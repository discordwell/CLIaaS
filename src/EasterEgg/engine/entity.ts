/**
 * Entity system — units, structures, and their state.
 */

import {
  type WorldPos, type CellPos, type UnitStats, type WeaponStats,
  type WarheadProps, type WarheadType, type ArmorType,
  Dir, Mission, AnimState, House, UnitType, Stance,
  UNIT_STATS, WEAPON_STATS, CELL_SIZE, MPH_TO_PX,
  INFANTRY_ANIMS, INFANTRY_SHAPE, BODY_SHAPE, ANT_ANIM, WARHEAD_PROPS,
  WARHEAD_VS_ARMOR, PRONE_DAMAGE_BIAS, CONDITION_RED, CONDITION_YELLOW,
  CIVILIAN_UNIT_TYPES, worldToCell, worldDist, directionTo, directionToLeptons, DIR_DX, DIR_DY,
  armorIndex, PRODUCTION_ITEMS,
} from './types';
import { LP, PIXEL_LEPTON_W } from './tracks';
import { ScenarioRandom, NonCriticalRandom } from './random';

// === C++ Points lookup (techno.cpp:6290: Risk = Reward = Points) ===
// Used by threatScore() to compute C++ Value() = Risk + Reward = 2 * Points
const UNIT_POINTS: Record<string, number> = {};
for (const item of PRODUCTION_ITEMS) {
  UNIT_POINTS[item.type] = item.points ?? item.cost;
}

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
  // Ground units continue to use the 8-dir `facing` field.
  facing256 = -1;          // -1 = not using 256-step (ground units); 0-255 for aircraft
  desiredFacing256 = -1;   // -1 = not active

  // Health
  hp: number;
  maxHp: number;
  alive = true;

  // Mission / AI (AI1: 22-mission system with queue)
  mission: Mission = Mission.GUARD;
  missionQueue: Mission | null = null; // AI1: next mission to promote at cell center
  stance: Stance = Stance.AGGRESSIVE; // default aggressive (like original RA)
  target: Entity | null = null;
  healTarget: Entity | null = null;  // medic auto-heal target (C++ infantry.cpp AI)
  targetStructure: StructureRef | null = null; // for attacking buildings
  forceFirePos: WorldPos | null = null; // force-fire ground position (Ctrl+right-click)
  moveTarget: WorldPos | null = null;
  moveQueue: WorldPos[] = []; // shift+click waypoint queue (C++ NavQueue[10] — capped at 10)
  static readonly NAV_QUEUE_MAX = 10; // C++ foot.h:189: TARGET NavQueue[10]
  navQueueLoop = false;               // C++ foot.h:146: IsNavQueueLoop — patrol loop mode
  navQueueOriginal: WorldPos[] = [];  // saved waypoints for loop re-population
  path: CellPos[] = [];
  pathIndex = 0;

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
  idleAnimTimer = 2;   // C++ parity: Doing=DO_NOTHING at init prevents Random_Animate on first guard scan

  // C++ infantry.h Doing state — gates Is_Ready_To_Random_Animate.
  // DO_NOTHING = initial state. Transitions to DO_STAND_READY via Doing_AI when animation completes.
  // DO_STAND_READY = idle standing pose. Random_Animate allowed.
  // DO_WALK/DO_FIRE = active states. Random_Animate blocked.
  doing: 'nothing' | 'stand_ready' | 'walk' | 'fire' | 'idle_anim' = 'nothing';
  // C++ foot.h IsDriving — true while infantry is moving cell-to-cell
  isDriving = false;
  // C++ infantry.cpp IsFiring — true during weapon fire animation
  isFiringAnim = false;

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
  bodyFacing32 = 0;   // 0-31, initialized to facing * 4
  prevBodyFacing32 = 0;   // previous tick bodyFacing32 for visual interpolation
  turretFacing32 = 0; // 0-31, initialized to turretFacing * 4
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
  attackCooldown2 = 0;
  weapon: WeaponStats | null;
  weapon2: WeaponStats | null = null;
  kills = 0;      // kills by this unit

  // Burst fire (C++ weapon.cpp:78 Weapon.Burst — multiple shots per trigger pull)
  burstCount = 0;   // remaining shots in current burst
  burstDelay = 0;   // ticks between burst shots (3 ticks between each)

  // CF12: Dual-weapon IsSecondShot cadence (C++ techno.cpp:2857-2870)
  // For dual-weapon units: first shot gets 3-tick rearm, second shot gets full ROF
  isSecondShot = false;

  // Moving-platform tracking (C++ techno.cpp:3106-3108 — units firing while moving get extra inaccuracy)
  prevPos: WorldPos = { x: 0, y: 0 }; // position from previous tick, for detecting movement

  /** Set pixel position and sync integer lepton coordinates. Use for teleports, spawns,
   *  and any direct position assignment (NOT movement — movement writes leptons directly). */
  setPosition(x: number, y: number): void {
    this.pos.x = x;
    this.pos.y = y;
    this.leptonX = Math.round(x / LP);
    this.leptonY = Math.round(y / LP);
  }

  /** Sync pixel pos from lepton coordinates. Called after lepton-space movement. */
  syncPosFromLeptons(): void {
    this.pos.x = this.leptonX * LP;
    this.pos.y = this.leptonY * LP;
  }

  /** C++ InfantryClass::Doing_AI — transition Doing state when animation completes.
   *  Called once per tick after mission processing. Doing=DO_NOTHING transitions
   *  to DO_STAND_READY (idle pose) if not driving. */
  doingAI(): void {
    if (!this.stats.isInfantry) return;
    // C++ infantry.cpp:3685: fires when Doing==DO_NOTHING OR animation completed
    if (this.doing === 'nothing' || this.doing === 'idle_anim' || this.doing === 'fire') {
      if (this.isDriving) {
        this.doing = 'walk';
      } else {
        this.doing = 'stand_ready';
      }
    }
  }

  /** C++ InfantryClass::Is_Ready_To_Random_Animate — checks all gates.
   *  Returns true only when infantry is truly idle: standing, not moving,
   *  not firing, idle timer expired. */
  isReadyToRandomAnimate(): boolean {
    if (!this.stats.isInfantry) return false;
    if (this.idleAnimTimer > 0) return false;   // IdleTimer not expired
    if (this.doing !== 'stand_ready') return false; // Must be in idle stance
    if (this.isDriving) return false;            // Not while moving
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

  // MV1: Track-table movement state (C++ drive.cpp — vehicles follow pre-computed turn tracks)
  trackNumber = -1;    // C++ track number (1-13), -1 = not on a track
  trackIndex = 0;      // current step within the track
  trackFlags = 0;      // TrackControl flags (F_T|F_X|F_Y) for Smooth_Turn transformation
  trackCellSpan = 1;   // cells covered by current track: 1=short, 2=long 2-cell track
  trackControlIndex = -1; // C++ TrackNumber: index into TrackControl[] table (0-66), for track jumping
  speedAccum = 0;      // C++ SpeedAccum: sub-pixel movement remainder (leptons)

  // Saved move target for AI target acquisition while moving (C++ foot.cpp:492-505)
  // When an AI unit spots an enemy during MOVE, it switches to ATTACK but saves its destination
  savedMoveTarget: WorldPos | null = null;

  // Wave coordination: ants from the same trigger share a waveId
  waveId = 0;              // 0 = no wave group
  waveRallyTick = 0;       // tick when wave should start attacking (rally delay)

  // Transport passengers
  passengers: Entity[] = [];       // loaded cargo: infantry + vehicles (hidden from entity list)
  transportRef: Entity | null = null; // reference to transport carrying this unit

  // Harvester economy (EC3: bail-based capacity — 28 bails max per harvester load)
  oreLoad = 0;                     // number of bails currently carried
  oreCreditValue = 0;              // total credit value of carried bails
  static readonly BAIL_COUNT = 28; // max bails per trip (C++ UnitTypeClass::Max_Pips)
  static readonly ORE_CAPACITY = 28; // alias for BAIL_COUNT (backward compat)
  harvesterState: 'idle' | 'seeking' | 'harvesting' | 'returning' | 'unloading' = 'idle';
  harvestTick = 0;                 // ticks spent harvesting current cell
  /** C++ unit.cpp:2794-2797, 2851 — ArchiveTarget: remembers last known ore location.
   *  When returning to refinery, saves current cell. On next idle seek, heads there first. */
  archiveTarget: { cx: number; cy: number } | null = null;
  /** Harvester animation stage — C++ Fetch_Stage() while IsDumping/IsHarvesting.
   *  During 'unloading': advances 0..21 over 22 ticks (Harvester_Dump_List).
   *  During 'harvesting' (stationary at ore): advances 0..8 (Harvester_Load_List). */
  harvesterAnimStage = 0;
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

  // Superweapon effect timers
  ironCurtainTick = 0;  // ticks remaining for Iron Curtain invulnerability
  chronoShiftTick = 0;  // visual effect timer after being chronoshifted

  // C++ IsAnimAttached mirror (unit.cpp:1113, vessel.cpp:975) — tick at which the
  // attached SMOKE_M damage anim was spawned. -1 means no smoke attached (i.e. !IsAnimAttached).
  // Renderer anchors frame advancement to this tick so the sprite plays as one continuous anim.
  damageSmokeStartTick = -1;

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
  landedAtStructure = -1;       // structure index, -1 = airborne
  aircraftState: 'idle' | 'takeoff' | 'flying' | 'attacking' | 'returning' | 'landing' | 'landed' | 'rearming' | 'unload_search' | 'unload_fly' | 'unload_land' | 'unload_eject' = 'idle';
  _unloadSearchTicks = 0; // C++ SEARCH_FOR_LZ delay counter
  _flyToTicks = 0; // C++ FLY_TO_LZ Process_Fly_To call interval counter
  rearmTimer = 0;
  attackRunPhase: 'flyToTarget' | 'dropBombs' | 'regroup' = 'flyToTarget';
  circleBreakTimer = 0;
  /** C++ aircraft.cpp:2899-2928 — speed fraction (0.0-1.0) during takeoff/landing.
   *  Modulates effective movement speed. 0xFF=1.0, 0x40=0.25, 0x20=0.125, 0x00=0.0.
   *  cpp-parity: helicopters ramp speed during takeoff and stop at half-height during landing. */
  aircraftSpeedFraction = 1.0;
  /** C++ aircraft.cpp:441-445 — helicopter hover jitter offset (pixels).
   *  Applied when at FLIGHT_ALTITUDE and speed < 3 (hovering). Pattern repeats every 16 ticks.
   *  cpp-parity: {0,0,0,0,1,1,1,0,0,0,0,0,-1,-1,-1,0} indexed by frame%16. */
  hoverJitter = 0;
  /** C++ building.cpp:1298 — IsTechnician flag on infantry survivors.
   *  Set when infantry is spawned from building sell/destruction (E1 only).
   *  cpp-parity: building.cpp:3473 — IsNominal infantry get IsTechnician=true. */
  isTechnician = false;

  constructor(type: UnitType, house: House, x: number, y: number) {
    this.type = type;
    this.stats = UNIT_STATS[type] ?? UNIT_STATS.E1;
    this.house = house;
    this.pos = { x, y };
    this.leptonX = Math.round(x / LP);
    this.leptonY = Math.round(y / LP);
    this.hp = this.stats.strength;
    this.maxHp = this.stats.strength;
    this.weapon = this.stats.primaryWeapon
      ? WEAPON_STATS[this.stats.primaryWeapon] ?? null
      : null;
    this.weapon2 = this.stats.secondaryWeapon
      ? WEAPON_STATS[this.stats.secondaryWeapon] ?? null
      : null;
    // Initialize 32-step visual facing from 8-dir facing
    this.bodyFacing32 = this.facing * 4;
    this.prevBodyFacing32 = this.bodyFacing32;
    this.turretFacing32 = this.turretFacing * 4;
    this.prevTurretFacing32 = this.turretFacing32;
    // Initialize prevPos to starting position (C5: moving-platform inaccuracy detection)
    this.prevPos = { x, y };
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

  /** C++ foot.cpp:2275-2307 Queue_Navigation_List — append waypoint, cap at 10.
   *  Returns true if appended, false if queue is full (C++ silently drops). */
  queueWaypoint(pos: WorldPos): boolean {
    if (this.moveQueue.length >= Entity.NAV_QUEUE_MAX) return false;
    this.moveQueue.push(pos);
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

  /** Flight altitude offset (pixels) — visual only, for rendering above ground */
  flightAltitude = 0;
  static readonly FLIGHT_ALTITUDE = 24; // pixels above ground when airborne (C++ FLIGHT_LEVEL = 24)

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
          // C++ InfantryDeath 0-5 → die1..die5 (warhead.cpp InfDeath mapping):
          //   0=GUN_DEATH (die1), 1=EXPLOSION_DEATH (die2), 2=EXPLOSION2_DEATH (die3),
          //   3=GRENADE_DEATH (die4), 4=FIRE_DEATH (die5), 5=electro → reuses die5.
          // Falls back through die2→die1 if a specific variant is missing.
          let d: { frame: number; count: number; jump: number } | undefined;
          switch (this.deathVariant) {
            case 0: d = anim.die1; break;
            case 1: d = anim.die2 ?? anim.die1; break;
            case 2: d = anim.die3 ?? anim.die2 ?? anim.die1; break;
            case 3: d = anim.die4 ?? anim.die2 ?? anim.die1; break;
            case 4: d = anim.die5 ?? anim.die2 ?? anim.die1; break;
            case 5: d = anim.die5 ?? anim.die2 ?? anim.die1; break;
            default: d = anim.die1;
          }
          return d.frame + Math.min(this.animFrame, Math.max(d.count - 1, 0));
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
  takeDamage(amount: number, warhead?: string, attacker?: Entity, warheadPropsOverride?: WarheadProps): boolean {
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
    if (this.armorBias > 1.0 && amount > 0) {
      amount = Math.max(1, Math.round(amount / this.armorBias));
    }
    // C++ infantry.cpp:329-330 — prone infantry take 50% damage (ProneDamageBias)
    // C++ only applies ProneDamageBias in infantry.cpp, not unit.cpp — vehicles are unaffected
    if (this.isProne && amount > 0 && this.stats.isInfantry) {
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
      if (attacker && this.fear < Entity.FEAR_SCARED) {
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
      // R7: Use warhead's infantryDeath property from C++ warhead.cpp InfantryDeath
      // Pass through the full C++ InfDeath value (0-5) for 6 distinct death animations:
      //   0=instant (die1), 1=twirl (die2), 2=explode (die2), 3=flying (die2), 4=burn (die2), 5=electro (die2)
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
      }
      this.passengers = [];
      return true;
    }
    return false;
  }

  /** Check if target is in range of any weapon (primary or secondary) */
  inRange(other: Entity): boolean {
    const dist = worldDist(this.pos, other.pos);
    if (this.weapon && dist <= this.weapon.range) return true;
    if (this.weapon2 && dist <= this.weapon2.range) return true;
    return false;
  }

  /** Check if target is in range of a specific weapon */
  inRangeWith(other: Entity, weapon: WeaponStats): boolean {
    return worldDist(this.pos, other.pos) <= weapon.range;
  }

  /**
   * Select the best weapon against a target based on effective damage (C++ TechnoClass::Can_Fire).
   * Returns the weapon that deals more effective damage considering warhead-vs-armor multipliers.
   * If one weapon is on cooldown but the other is ready, prefers the ready one.
   * Never returns both — only one weapon fires per tick (C++ alternating behavior).
   */
  selectWeapon(target: Entity, getWarheadMult: (warhead: WarheadType, armor: ArmorType) => number): WeaponStats | null {
    const dist = worldDist(this.pos, target.pos);
    const w1 = this.weapon;
    const w2 = this.weapon2;

    // Single-weapon unit: just return primary
    if (!w2) return w1;
    if (!w1) return w2;

    // C++ techno.cpp:1898-1941 What_Weapon_Should_I_Use — AG/AA projectile constraints
    // If primary weapon has AG=no (isAntiGround===false, e.g. RedEye/AAMissile), it cannot
    // fire at ground targets. Use secondary for ground targets.
    const targetIsAircraft = !!target.stats.isAircraft;
    const targetIsAirborne = targetIsAircraft && target.flightAltitude > 0;
    if (w1.isAntiGround === false && !targetIsAircraft && w2) return w2;
    if (w2.isAntiGround === false && !targetIsAircraft && w1) return w1;

    // C++ techno.cpp:2702-2707 — AA gate: weapons without isAntiAir cannot hit airborne aircraft
    // (returns FIRE_CANT). This makes 4TNK use MammothTusk missiles vs helicopters instead of 120mm cannon.
    if (targetIsAirborne) {
      const w1AA = !!w1.isAntiAir;
      const w2AA = !!w2.isAntiAir;
      if (!w1AA && w2AA) return w2;
      if (w1AA && !w2AA) return w1;
      if (!w1AA && !w2AA) return null; // neither weapon can hit airborne targets
    }

    const w1InRange = dist <= w1.range;
    const w2InRange = dist <= w2.range;
    const w1Ready = this.attackCooldown <= 0 && w1InRange;
    const w2Ready = this.attackCooldown2 <= 0 && w2InRange;

    // Neither ready — return null (both on cooldown)
    if (!w1Ready && !w2Ready) return null;

    // Only one ready — use that one
    if (w1Ready && !w2Ready) return w1;
    if (!w1Ready && w2Ready) return w2;

    // Both ready — pick the one with higher effective damage vs target armor
    const mult1 = getWarheadMult(w1.warhead, target.stats.armor);
    const mult2 = getWarheadMult(w2.warhead, target.stats.armor);
    const eff1 = w1.damage * mult1;
    const eff2 = w2.damage * mult2;

    // Prefer higher effective damage; on tie, prefer primary
    return eff2 > eff1 ? w2 : w1;
  }

  /** Update animation frame — uses per-type rate overrides from C++ MasterDoControls */
  tickAnimation(): void {
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
    // Ants: faster walk animation (1 frame/tick) — C++ ties body frames to track steps,
    // but our animation is decoupled. Rate 1 matches their fast movement speed.
    const antWalk = 1;
    const antAttack = 3;
    const rate = this.isAnt
      ? (this.animState === AnimState.WALK ? antWalk : this.animState === AnimState.ATTACK ? antAttack : defaultIdle)
      : this.animState === AnimState.WALK ? (typeAnim?.walkRate ?? defaultWalk) :
                 this.animState === AnimState.ATTACK ? (typeAnim?.attackRate ?? defaultAttack) :
                 (typeAnim?.idleRate ?? defaultIdle);
    if (this.animTick >= rate) {
      this.animTick = 0;
      this.animFrame++;
    }
    if (!this.alive) this.deathTick++;
    if (this.damageFlash > 0) this.damageFlash--;
  }

  /** Gradually rotate facing toward desiredFacing based on rot speed.
   *  C++ RA rotation: 32-step visual rotation. ROT accumulates per tick; one visual step
   *  when accumulator >= 8 (256 values / 32 steps = 8 per step). Game-logic 8-dir `facing`
   *  is derived from bodyFacing32. Infantry (rot >= 8) snap instantly.
   *  Returns true if facing matches desiredFacing. */
  tickRotation(): boolean {
    if (this.facing === this.desiredFacing) {
      this.rotAccumulator = 0;
      // Snap visual facing to match game-logic facing
      this.bodyFacing32 = this.facing * 4;
      return true;
    }
    // Guard against double-accumulation in the same game tick
    if (this.rotTickedThisFrame) return this.facing === this.desiredFacing;
    this.rotTickedThisFrame = true;

    // Infantry snap instantly — C++ doesn't use Rotation_Adjust for infantry body facing.
    // Vehicles always use the accumulator regardless of ROT value (e.g. JEEP ROT=10
    // still takes 7 ticks for 90 degrees in C++).
    if (this.stats.isInfantry) {
      this.facing = this.desiredFacing;
      this.bodyFacing32 = this.facing * 4;
      this.rotAccumulator = 0;
      return true;
    }

    // 32-step vehicle rotation: accumulate ROT per tick, advance bodyFacing32 by ±1 when >= 8
    // MV9: groundspeedBias multiplies rotation rate (C++ GroundSpeed affects ROT accumulation)
    // C++ Rotation_Adjust uses a while loop — high ROT can advance multiple steps per tick.
    const desiredFacing32 = this.desiredFacing * 4;
    this.rotAccumulator += this.stats.rot * this.groundspeedBias;
    while (this.rotAccumulator >= 8 && this.bodyFacing32 !== desiredFacing32) {
      this.rotAccumulator -= 8;
      // Shortest path in 32-step ring
      // C++ facing.cpp:168-172: (signed char)(desired-current). When diff==128 (half circle),
      // signed char gives -128 → counterclockwise. In 32-step: diff==16 → CCW to match C++.
      const diff32 = (desiredFacing32 - this.bodyFacing32 + 32) % 32;
      if (diff32 > 0 && diff32 < 16) {
        this.bodyFacing32 = (this.bodyFacing32 + 1) % 32;
      } else {
        this.bodyFacing32 = (this.bodyFacing32 + 31) % 32; // -1 mod 32 (counterclockwise)
      }
    }
    // Derive 8-dir facing from bodyFacing32 for game logic compatibility
    this.facing = Math.floor(this.bodyFacing32 / 4) as Dir;
    return this.facing === this.desiredFacing;
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
      this.facing = Math.floor(this.facing256 / 32) as Dir;
      this.bodyFacing32 = Math.floor(this.facing256 / 8) % 32;
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

    if (Math.abs(diff) <= rate) {
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
    this.facing = (Math.floor(this.facing256 / 32) % 8) as Dir;
    this.bodyFacing32 = Math.floor(this.facing256 / 8) % 32;
    this.desiredFacing = (Math.floor(this.desiredFacing256 / 32) % 8) as Dir;
    return this.facing256 === this.desiredFacing256;
  }

  /** Gradually rotate turret toward desiredTurretFacing.
   *  C++ RA unit.cpp:542: SecondaryFacing.Rotation_Adjust(Class->ROT+1).
   *  Turret rotates at ROT+1 (not ROT*2); one visual step when accumulator >= 8. */
  tickTurretRotation(): boolean {
    if (this.turretFacing === this.desiredTurretFacing) {
      this.turretRotAccumulator = 0;
      this.turretFacing32 = this.turretFacing * 4;
      return true;
    }
    // Guard against double-accumulation in the same game tick
    if (this.turretRotTickedThisFrame) return this.turretFacing === this.desiredTurretFacing;
    this.turretRotTickedThisFrame = true;

    // 32-step turret rotation at ROT+1 (C++ unit.cpp:542)
    // C++ Rotation_Adjust uses a while loop — high ROT can advance multiple steps per tick.
    const desiredTurretFacing32 = this.desiredTurretFacing * 4;
    this.turretRotAccumulator += this.stats.rot + 1;
    while (this.turretRotAccumulator >= 8 && this.turretFacing32 !== desiredTurretFacing32) {
      this.turretRotAccumulator -= 8;
      // C++ facing.cpp:168-172: diff==16 (180°) → counterclockwise (signed char -128)
      const diff32 = (desiredTurretFacing32 - this.turretFacing32 + 32) % 32;
      if (diff32 > 0 && diff32 < 16) {
        this.turretFacing32 = (this.turretFacing32 + 1) % 32;
      } else {
        this.turretFacing32 = (this.turretFacing32 + 31) % 32;
      }
    }
    // Derive 8-dir turretFacing from turretFacing32 for game logic
    this.turretFacing = Math.floor(this.turretFacing32 / 4) as Dir;
    return this.turretFacing === this.desiredTurretFacing;
  }

  /** Move toward a world position at the unit's speed.
   *  C++ RA drive.cpp: vehicles stop, rotate to face destination, THEN move.
   *  Infantry are nimble and move while rotating.
   *  M7: speed is multiplied by speedBias (crate pickup bonus).
   *
   *  Uses integer lepton accumulator matching C++ fly.cpp:62-106 / drive.cpp SpeedAccum:
   *    SpeedAdd (leptons/tick) is accumulated; movement emits whole-pixel steps
   *    of PIXEL_LEPTON_W leptons each. Sub-pixel remainder carries across ticks. */
  moveToward(target: WorldPos, speed: number): boolean {
    // M7: Apply crate speed bias multiplier
    const effectiveSpeed = speed * this.speedBias;

    const dx = target.x - this.pos.x;
    const dy = target.y - this.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // C++ infantry snaps at Distance < 0x0010 (16 leptons). Vehicles at sub-pixel.
    const snapLeptons = this.stats.isInfantry ? 16 : 5;
    const distLeptonsTotal = Math.round(dist / LP);
    if (distLeptonsTotal < snapLeptons) {
      this.setPosition(target.x, target.y);
      this.speedAccum = 0;
      this.isDriving = false; // C++ Stop_Driver
      return true;
    }

    // C++ Start_Driver: entity is now in motion
    if (this.stats.isInfantry) this.isDriving = true;

    const oldFacing = this.facing;
    // C++ uses integer lepton coordinates for direction computation (Desired_Facing8).
    // Using pixel coords causes different diagonal boundary decisions due to float rounding.
    // For entities with lepton coordinates, compute direction in lepton space.
    if (this.leptonX !== 0 || this.leptonY !== 0) {
      const targetLX = Math.round(target.x / LP);
      const targetLY = Math.round(target.y / LP);
      this.desiredFacing = directionToLeptons(this.leptonX, this.leptonY, targetLX, targetLY);
    } else {
      this.desiredFacing = directionTo(this.pos, target);
    }
    const facingAligned = this.tickRotation();

    // Vehicles: stop-rotate-move (don't slide sideways while turning)
    // Aircraft always move forward — never stop to rotate in flight
    // Note: C++ three-point turn code (drive.cpp:339) is behind #ifdef TOFIX — NOT compiled
    if (!this.stats.isInfantry && !this.stats.isAircraft && !facingAligned) {
      return false; // still rotating — don't move yet
    }

    // --- Infantry path: C++ infantry.cpp:4019 moves at constant speed per tick ---
    // C++ uses maxspeed * fixed(movespeed, 256) where movespeed is distance to
    // the next sub-cell position (~128-256 leptons). At that scale, the proportional
    // factor is ~1.0, making movement effectively constant at maxspeed.
    // We use constant speed matching _Scale_To_256 with integer Coord_Move truncation.
    if (this.stats.isInfantry) {
      const face = this.desiredFacing;
      const fdx = DIR_DX[face];
      const fdy = DIR_DY[face];
      const isDiagonal = fdx !== 0 && fdy !== 0;

      // C++ infantry.cpp:3990-4019:
      //   movespeed = Speed;  // TechnoClass::Speed = current speed fraction (0-255)
      //   if (IsDog && TarCom) movespeed *= 2;
      //   Coord_Move(dir, maxspeed * fixed(movespeed, 256));
      //
      // Speed=255 for full speed. maxspeed = _Scale_To_256(MaxSpeed).
      // maxspeed * fixed(255, 256) = maxspeed * 255/256 ≈ maxspeed.
      // With canine sprint: movespeed=510 → maxspeed * 510/256 ≈ 2*maxspeed.
      //
      // effectiveSpeed already includes canine sprint: Speed * MPH_TO_PX * 2.
      // maxspeed = floor(effectiveSpeed / LP) directly matches the C++ result.
      const sinFactor = isDiagonal ? 90 : 127;
      const maxspeed = Math.floor(effectiveSpeed / LP);
      const axisLeptons = (maxspeed * sinFactor) >> 7;

      // Integer lepton movement — write to leptonX/Y, derive pos
      const targetLeptonX = Math.round(target.x / LP);
      const targetLeptonY = Math.round(target.y / LP);
      const dxL = targetLeptonX - this.leptonX;
      const dyL = targetLeptonY - this.leptonY;
      const stepLX = Math.min(Math.abs(fdx * axisLeptons), Math.abs(dxL)) * Math.sign(dxL || fdx);
      const stepLY = Math.min(Math.abs(fdy * axisLeptons), Math.abs(dyL)) * Math.sign(dyL || fdy);
      this.leptonX += stepLX;
      this.leptonY += stepLY;
      this.syncPosFromLeptons();

      const steppedL = Math.abs(stepLX) + Math.abs(stepLY);
      return steppedL >= distLeptonsTotal - 16;
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
    const speedAdd = Math.floor((maxSpeedLeptons * 255) / 256); // C++ fixed(0xFF, 256) fraction
    const actual = speedAdd + this.speedAccum;
    const remainder = actual % PIXEL_LEPTON_W;
    this.speedAccum = remainder;
    const moveLeptons = actual - remainder;

    if (moveLeptons <= 0) {
      return false; // not enough accumulated for a pixel step this tick
    }

    // Convert back to pixels for position update
    const movePixels = moveLeptons * LP;

    // C++ parity: Coord_Move uses integer sin/cos lookup tables indexed by facing,
    // not floating-point (dx/dist) unit vectors. The irrational float from (dx/dist)
    // accumulates sub-lepton error over many ticks, causing cell boundary crossings
    // 1-2 ticks before the C++ integer position.
    // Use DIR_DX/DIR_DY lookup (matching the 8-direction facing) for the movement
    // direction, with sqrt(2) correction for diagonals.
    // Integer lepton movement for vehicles/aircraft (C++ drive.cpp / fly.cpp)
    const face = this.desiredFacing;
    const fdx = DIR_DX[face];
    const fdy = DIR_DY[face];
    const isDiagonal = fdx !== 0 && fdy !== 0;
    // C++ Coord_Move: per-axis (moveLeptons * sin/cos_table) >> 7
    // Cardinal: sinFactor=127, Diagonal: sinFactor=90
    const sinFactor = isDiagonal ? 90 : 127;
    const axisLeptons = (moveLeptons * sinFactor) >> 7;

    const targetLeptonX = Math.round(target.x / LP);
    const targetLeptonY = Math.round(target.y / LP);
    const dxL = targetLeptonX - this.leptonX;
    const dyL = targetLeptonY - this.leptonY;
    const stepLX = Math.min(Math.abs(fdx * axisLeptons), Math.abs(dxL)) * Math.sign(dxL || fdx);
    const stepLY = Math.min(Math.abs(fdy * axisLeptons), Math.abs(dyL)) * Math.sign(dyL || fdy);
    this.leptonX += stepLX;
    this.leptonY += stepLY;
    this.syncPosFromLeptons();

    return Math.abs(dxL) + Math.abs(dyL) <= axisLeptons + 5;
  }
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
 *  @param nearFriendlyStructureCount AI5: count of friendly structures within splash radius of target */
export function threatScore(
  scanner: Entity, target: Entity, dist: number,
  designatedEnemy?: House | null,
  nearFriendlyStructureCount?: number,
  isTargetOutOfZone?: boolean,
  nervousBias?: number,
): number {
  // AI6: Spy target exclusion — spies are not normal targets (except for dogs)
  // C++ techno.cpp:1557-1563
  if (target.type === UnitType.I_SPY && scanner.type !== UnitType.I_DOG) {
    return 0;
  }

  // C++ techno.cpp:1651-1652: value = object->Value() + object->Crew.Kills
  // Value() = Risk() + Reward = 2 * Points (techno.cpp:4519, 6290: Risk = Reward = Points)
  // Points comes from RULES.INI "Points=" — separate from Cost= (C++ techno.cpp:6290)
  // Lookup: UNIT_STATS.points > PRODUCTION_ITEMS points > strength fallback
  const points = target.stats.points ?? UNIT_POINTS[target.type] ?? target.stats.strength;
  let value = Math.trunc(points * 2) + target.kills;  // Value() + Crew.Kills

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
  // Only applies when scanner has splash weapon (proxy for C++ IsSupressed flag)
  if (nearFriendlyStructureCount !== undefined && nearFriendlyStructureCount > 0 &&
      scanner.weapon?.splash && scanner.weapon.splash > 0) {
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
