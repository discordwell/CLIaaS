/**
 * Entity system — units, structures, and their state.
 */

import {
  type WorldPos, type CellPos, type UnitStats, type WeaponStats,
  type WarheadType, type ArmorType,
  Dir, Mission, AnimState, House, UnitType, Stance,
  UNIT_STATS, WEAPON_STATS, CELL_SIZE,
  INFANTRY_ANIMS, BODY_SHAPE, ANT_ANIM, WARHEAD_PROPS,
  WARHEAD_VS_ARMOR,
  worldToCell, worldDist, directionTo, DIR_DX, DIR_DY,
} from './types';
// Structure reference is typed loosely to avoid circular dependency with scenario.ts
export interface StructureRef {
  alive: boolean;
  cx: number;
  cy: number;
}

export interface TeamMissionEntry {
  mission: number;  // TMISSION_* type
  data: number;     // waypoint index or other param
}


let nextId = 1;

export function resetEntityIds(): void {
  nextId = 1;
}

export class Entity {
  id = nextId++;
  type: UnitType;
  stats: UnitStats;
  house: House;

  // Position
  pos: WorldPos;
  facing: Dir = Dir.N;
  desiredFacing: Dir = Dir.N; // target facing for gradual rotation
  turretFacing: Dir = Dir.N;  // turret direction (for turreted vehicles)
  desiredTurretFacing: Dir = Dir.N; // target turret facing for gradual rotation

  // Health
  hp: number;
  maxHp: number;
  alive = true;

  // Mission / AI
  mission: Mission = Mission.GUARD;
  stance: Stance = Stance.AGGRESSIVE; // default aggressive (like original RA)
  target: Entity | null = null;
  targetStructure: StructureRef | null = null; // for attacking buildings
  forceFirePos: WorldPos | null = null; // force-fire ground position (Ctrl+right-click)
  moveTarget: WorldPos | null = null;
  moveQueue: WorldPos[] = []; // shift+click waypoint queue
  path: CellPos[] = [];
  pathIndex = 0;

  // Animation
  animState: AnimState = AnimState.IDLE;
  animFrame = 0;
  animTick = 0;

  // Death / visual
  deathTick = 0;       // ticks since death (for corpse fade + cleanup)
  deathVariant = 0;    // 0=die1, 1=die2 (selected randomly on death)
  damageFlash = 0;     // ticks remaining for damage flash effect

  // AI rate-limiting
  lastGuardScan = 0;   // tick when guard last scanned
  lastAIScan = 0;      // tick when ant AI last scanned
  lastPathRecalc = 0;  // tick when path was last recalculated (for blocked paths)

  // Rotation accumulators (C++ ROT system: accumulate rot per tick, advance facing when >= threshold)
  rotAccumulator = 0;
  turretRotAccumulator = 0;
  rotTickedThisFrame = false;       // prevents double-accumulation per game tick
  turretRotTickedThisFrame = false;  // prevents double-accumulation per game tick

  // 32-step visual facing for smooth vehicle rotation (C++ Dir_To_32)
  // Game logic uses 8-dir `facing`; visual rendering uses 32-step for smooth sprite animation
  bodyFacing32 = 0;   // 0-31, initialized to facing * 4
  turretFacing32 = 0; // 0-31, initialized to turretFacing * 4

  // Recoil (C++ unit.cpp:125 Recoil_Adjust — 1-tick visual kickback on fire)
  isInRecoilState = false;

  // S5: NoMovingFire setup time (C++ unit.cpp:1760-1764 — Arm = Rearm_Delay(true)/4 when stopping)
  wasMoving = false;  // tracks movement state for setup time detection

  // Combat
  attackCooldown = 0;
  attackCooldown2 = 0;
  weapon: WeaponStats | null;
  weapon2: WeaponStats | null = null;
  kills = 0;      // kills by this unit
  veterancy = 0;  // 0=rookie, 1=veteran, 2=elite

  // Burst fire (C++ weapon.cpp:78 Weapon.Burst — multiple shots per trigger pull)
  burstCount = 0;   // remaining shots in current burst
  burstDelay = 0;   // ticks between burst shots (3 ticks between each)

  // Moving-platform tracking (C++ techno.cpp:3106-3108 — units firing while moving get extra inaccuracy)
  prevPos: WorldPos = { x: 0, y: 0 }; // position from previous tick, for detecting movement

  /** Damage multiplier from veterancy (1.0 / 1.25 / 1.5) */
  get damageMultiplier(): number {
    return this.veterancy === 2 ? 1.5 : this.veterancy === 1 ? 1.25 : 1.0;
  }

  /** Credit a kill and check for promotion */
  creditKill(): void {
    this.kills++;
    const oldVet = this.veterancy;
    if (this.kills >= 6 && this.veterancy < 2) {
      this.veterancy = 2;
    } else if (this.kills >= 3 && this.veterancy < 1) {
      this.veterancy = 1;
    }
    // On promotion, scale max HP and heal the bonus amount
    if (this.veterancy > oldVet) {
      const hpRatio = this.veterancy === 2 ? 1.5 : 1.25;
      const newMax = Math.round(this.stats.strength * hpRatio);
      const bonus = newMax - this.maxHp;
      this.maxHp = newMax;
      this.hp = Math.min(this.hp + bonus, this.maxHp);
    }
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

  // Saved move target for AI target acquisition while moving (C++ foot.cpp:492-505)
  // When an AI unit spots an enemy during MOVE, it switches to ATTACK but saves its destination
  savedMoveTarget: WorldPos | null = null;

  // Wave coordination: ants from the same trigger share a waveId
  waveId = 0;              // 0 = no wave group
  waveRallyTick = 0;       // tick when wave should start attacking (rally delay)

  // Transport passengers
  passengers: Entity[] = [];       // loaded infantry (hidden from entity list)
  transportRef: Entity | null = null; // reference to transport carrying this unit

  // Harvester economy
  oreLoad = 0;                     // credits worth of ore currently carried
  static readonly ORE_CAPACITY = 700; // max ore value per trip
  harvesterState: 'idle' | 'seeking' | 'harvesting' | 'returning' | 'unloading' = 'idle';
  harvestTick = 0;                 // ticks spent harvesting current cell

  // M7: Crate speed bias — multiplier from speed crate pickups (default 1.0, boosted to 1.5)
  speedBias = 1.0;

  constructor(type: UnitType, house: House, x: number, y: number) {
    this.type = type;
    this.stats = UNIT_STATS[type] ?? UNIT_STATS.E1;
    this.house = house;
    this.pos = { x, y };
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
    this.turretFacing32 = this.turretFacing * 4;
    // Initialize prevPos to starting position (C5: moving-platform inaccuracy detection)
    this.prevPos = { x, y };
  }

  get cell(): CellPos {
    return worldToCell(this.pos.x, this.pos.y);
  }

  get isPlayerUnit(): boolean {
    return this.house === House.Spain || this.house === House.Greece;
  }

  get isTransport(): boolean {
    return (this.stats.passengers ?? 0) > 0;
  }

  get maxPassengers(): number {
    return this.stats.passengers ?? 0;
  }

  /** Air units fly over terrain, ignoring pathfinding and ground passability */
  get isAirUnit(): boolean {
    return this.type === UnitType.V_TRAN;
  }

  /** Naval units can traverse water tiles */
  get isNavalUnit(): boolean {
    return this.type === UnitType.V_LST;
  }

  /** Flight altitude offset (pixels) — visual only, for rendering above ground */
  flightAltitude = 0;
  static readonly FLIGHT_ALTITUDE = 20; // pixels above ground when airborne

  get hasTurret(): boolean {
    return !this.stats.isInfantry && !this.isAnt &&
      this.type !== UnitType.V_APC && this.type !== UnitType.V_HARV &&
      this.type !== UnitType.V_MCV && this.type !== UnitType.V_ARTY &&
      this.type !== UnitType.V_JEEP && this.type !== UnitType.V_TRUK &&
      this.type !== UnitType.V_TRAN && this.type !== UnitType.V_LST;
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

    // --- Infantry: DoControls layout (base + facing*jump + animFrame%count) ---
    if (this.stats.isInfantry) {
      const anim = INFANTRY_ANIMS[this.type] ?? INFANTRY_ANIMS.E1;
      switch (this.animState) {
        case AnimState.WALK: {
          const d = anim.walk;
          return d.frame + dir * d.jump + (this.animFrame % d.count);
        }
        case AnimState.ATTACK: {
          const d = anim.fire;
          return d.frame + dir * d.jump + (this.animFrame % d.count);
        }
        case AnimState.DIE: {
          const d = (this.deathVariant === 1 && anim.die2) ? anim.die2 : anim.die1;
          return d.frame + Math.min(this.animFrame, d.count - 1);
        }
        default: {
          // Idle: use idle fidget if available after a variable delay (per-unit)
          const fidgetDelay = 12 + (this.id * 7) % 20; // 12-31 frames
          if (anim.idle && this.animFrame > fidgetDelay) {
            const d = anim.idle;
            return d.frame + (this.animFrame % d.count);
          }
          const d = anim.ready;
          return d.frame + dir * d.jump;
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

  /** Take damage, return true if killed. warhead affects death animation. */
  takeDamage(amount: number, warhead?: string): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.damageFlash = 4;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.mission = Mission.DIE;
      this.animState = AnimState.DIE;
      this.animFrame = 0;
      this.animTick = 0;
      this.deathTick = 0;
      // R7: Use warhead's infantryDeath property from C++ warhead.cpp InfantryDeath
      // 0=normal (die1), 1=fire death (die2), 2=explode (die2)
      const whProps = warhead ? WARHEAD_PROPS[warhead as WarheadType] : undefined;
      if (whProps && whProps.infantryDeath > 0) {
        this.deathVariant = 1; // die2 for fire death (1) and explode (2)
      } else if (whProps && whProps.infantryDeath === 0) {
        this.deathVariant = 0; // die1 for normal death
      } else {
        this.deathVariant = Math.random() < 0.4 ? 1 : 0; // fallback: random
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

  /** Check if target is in weapon range */
  inRange(other: Entity): boolean {
    if (!this.weapon) return false;
    return worldDist(this.pos, other.pos) <= this.weapon.range;
  }

  /** Update animation frame — uses per-type rate overrides from C++ MasterDoControls */
  tickAnimation(): void {
    this.animTick++;
    // Per-type animation rate overrides (R3: C++ MasterDoControls variable timing)
    const typeAnim = this.stats.isInfantry ? INFANTRY_ANIMS[this.type] : undefined;
    const defaultWalk = 3;
    const defaultAttack = 5;
    const defaultIdle = 4;
    const rate = this.animState === AnimState.WALK ? (typeAnim?.walkRate ?? defaultWalk) :
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

    // Infantry and fast-rotating units snap instantly (rot >= 8)
    if (this.stats.rot >= 8) {
      this.facing = this.desiredFacing;
      this.bodyFacing32 = this.facing * 4;
      this.rotAccumulator = 0;
      return true;
    }

    // 32-step vehicle rotation: accumulate ROT per tick, advance bodyFacing32 by ±1 when >= 8
    const desiredFacing32 = this.desiredFacing * 4;
    this.rotAccumulator += this.stats.rot;
    if (this.rotAccumulator >= 8) {
      this.rotAccumulator -= 8;
      // Shortest path in 32-step ring
      const diff32 = (desiredFacing32 - this.bodyFacing32 + 32) % 32;
      if (diff32 <= 16) {
        this.bodyFacing32 = (this.bodyFacing32 + 1) % 32;
      } else {
        this.bodyFacing32 = (this.bodyFacing32 + 31) % 32; // -1 mod 32
      }
    }
    // Derive 8-dir facing from bodyFacing32 for game logic compatibility
    this.facing = Math.floor(this.bodyFacing32 / 4) as Dir;
    return this.facing === this.desiredFacing;
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
    const desiredTurretFacing32 = this.desiredTurretFacing * 4;
    this.turretRotAccumulator += this.stats.rot + 1;
    if (this.turretRotAccumulator >= 8) {
      this.turretRotAccumulator -= 8;
      const diff32 = (desiredTurretFacing32 - this.turretFacing32 + 32) % 32;
      if (diff32 <= 16) {
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
   *  M7: speed is multiplied by speedBias (crate pickup bonus). */
  moveToward(target: WorldPos, speed: number): boolean {
    // M7: Apply crate speed bias multiplier
    const effectiveSpeed = speed * this.speedBias;

    const dx = target.x - this.pos.x;
    const dy = target.y - this.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= effectiveSpeed) {
      this.pos.x = target.x;
      this.pos.y = target.y;
      return true; // arrived
    }

    const oldFacing = this.facing;
    this.desiredFacing = directionTo(this.pos, target);
    const facingAligned = this.tickRotation();

    // Vehicles: stop-rotate-move (don't slide sideways while turning)
    if (!this.stats.isInfantry && !facingAligned) {
      // M5: Three-point turn for JEEP (C++ drive.cpp:339 — wheeled vehicles)
      // When the JEEP needs a large turn (>= 90 degrees), drift backward slightly
      // during rotation to simulate a three-point turn maneuver.
      if (this.type === UnitType.V_JEEP) {
        const diff8 = (this.desiredFacing - oldFacing + 8) % 8;
        const absDiff = diff8 <= 4 ? diff8 : 8 - diff8;
        if (absDiff >= 4) {
          this.pos.x -= DIR_DX[this.facing] * 0.3;
          this.pos.y -= DIR_DY[this.facing] * 0.3;
        }
      }
      return false; // still rotating — don't move yet
    }

    // Infantry move while rotating (nimble), vehicles move once facing is aligned
    this.pos.x += (dx / dist) * effectiveSpeed;
    this.pos.y += (dy / dist) * effectiveSpeed;
    return false;
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

/** Helper: map ArmorType string to WARHEAD_VS_ARMOR index */
function armorIndex(armor: ArmorType): number {
  switch (armor) {
    case 'none': return 0;
    case 'wood': return 1;
    case 'light': return 2;
    case 'heavy': return 3;
    case 'concrete': return 4;
  }
}

/** Calculate threat score for guard targeting (inspired by C++ techno.cpp Evaluate_Object).
 *  Higher score = higher priority target. Pure function for testability.
 *  @param scanner The unit doing the scanning
 *  @param target The potential target being evaluated
 *  @param dist Distance between scanner and target (in cells)
 *  @param isTargetAttackingAlly Whether the target is currently attacking an allied unit
 *  @param closingSpeed Rate of distance change (positive = target approaching). A9: zone-aware threat. */
export function threatScore(
  scanner: Entity, target: Entity, dist: number, isTargetAttackingAlly: boolean,
  closingSpeed?: number,
): number {
  // Base value by unit class
  let score: number;
  if (target.type === UnitType.ANT2) score = 30;        // Fire ants are most dangerous
  else if (target.type === UnitType.ANT1) score = 20;    // Warrior ants next
  else if (target.type === UnitType.ANT3) score = 15;    // Scout ants less threatening
  else if (target.stats.isInfantry) score = 10;
  else score = 25; // vehicles are high-value

  // Kill count bonus: experienced enemies are more dangerous
  score += target.kills * 3;

  // Wounded bonus: finish off weakened targets (HP < 50% → 1.5x)
  if (target.hp < target.maxHp * 0.5) score *= 1.5;

  // Retaliation bonus: enemy currently attacking allies → 2x priority
  if (isTargetAttackingAlly) {
    score *= 2;
  }

  // A9: Zone-aware threat — enemies closing distance get +25% priority
  // (C++ uses spatial zones; we approximate with closing speed detection)
  if (closingSpeed !== undefined && closingSpeed > 0) {
    score *= 1.25;
  }

  // A11: Warhead effectiveness — prefer targets we can actually damage
  // (C++ per-weapon-class threat multipliers from techno.cpp)
  if (scanner.weapon) {
    const warhead = scanner.weapon.warhead;
    const verses = WARHEAD_VS_ARMOR[warhead];
    if (verses) {
      const mult = verses[armorIndex(target.stats.armor)];
      if (mult > 1.0) {
        score *= 1.5;   // scanner's weapon is effective vs this armor → boost
      } else if (mult < 0.5) {
        score *= 0.5;   // scanner's weapon is poor vs this armor → deprioritize
      }
    }
  }

  // A12: Target weapon danger — enemies with bigger weapons are more threatening
  // (C++ techno.cpp evaluates target's weapon damage as part of threat)
  const weaponDanger = Math.min((target.weapon?.damage ?? 0) * 0.2, 20);
  score += weaponDanger;

  // Inverse distance weighting: closer targets score higher
  // Avoid division by zero; at dist=0 full score, at max sight range ~0.3x
  const maxRange = scanner.stats.sight * 1.5;
  const distFactor = Math.max(0.3, 1 - (dist / maxRange) * 0.7);
  score *= distFactor;

  return score;
}
