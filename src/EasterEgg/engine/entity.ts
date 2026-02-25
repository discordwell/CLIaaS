/**
 * Entity system — units, structures, and their state.
 */

import {
  type WorldPos, type CellPos, type UnitStats, type WeaponStats,
  Dir, Mission, AnimState, House, UnitType, Stance,
  UNIT_STATS, WEAPON_STATS, CELL_SIZE,
  INFANTRY_ANIMS, BODY_SHAPE, ANT_ANIM,
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

  // Rotation accumulators (C++ ROT system: accumulate rot per tick, advance facing when >= 32)
  rotAccumulator = 0;
  turretRotAccumulator = 0;
  rotTickedThisFrame = false;       // prevents double-accumulation per game tick
  turretRotTickedThisFrame = false;  // prevents double-accumulation per game tick

  // Combat
  attackCooldown = 0;
  attackCooldown2 = 0;
  weapon: WeaponStats | null;
  weapon2: WeaponStats | null = null;
  kills = 0;      // kills by this unit
  veterancy = 0;  // 0=rookie, 1=veteran, 2=elite

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
    const facingIndex = this.turretFacing * 4; // 8 directions → 32-step index
    return 32 + BODY_SHAPE[facingIndex];
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
    const facingIndex = dir * 4; // 8 directions → 32-step index
    const bodyFrame = BODY_SHAPE[facingIndex];

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
      // Fire/Tesla/Super warheads always use die2 (explosive death); others random
      if (warhead === 'Fire' || warhead === 'Super') {
        this.deathVariant = 1;
      } else {
        this.deathVariant = Math.random() < 0.4 ? 1 : 0;
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

  /** Update animation frame */
  tickAnimation(): void {
    this.animTick++;
    const rate = this.animState === AnimState.WALK ? 3 :
                 this.animState === AnimState.ATTACK ? 5 : 4;
    if (this.animTick >= rate) {
      this.animTick = 0;
      this.animFrame++;
    }
    if (!this.alive) this.deathTick++;
    if (this.damageFlash > 0) this.damageFlash--;
  }

  /** Gradually rotate facing toward desiredFacing based on rot speed.
   *  C++ RA rotation: ROT accumulates per tick; one facing step when accumulator >= 32.
   *  Infantry (rot >= 8) snap instantly. Returns true if facing matches desiredFacing. */
  tickRotation(): boolean {
    if (this.facing === this.desiredFacing) {
      this.rotAccumulator = 0;
      return true;
    }
    // Guard against double-accumulation in the same game tick
    if (this.rotTickedThisFrame) return this.facing === this.desiredFacing;
    this.rotTickedThisFrame = true;

    // Infantry and fast-rotating units snap instantly (rot >= 8)
    if (this.stats.rot >= 8) {
      this.facing = this.desiredFacing;
      this.rotAccumulator = 0;
      return true;
    }

    // Accumulate rotation: higher ROT = faster turning
    // One facing step (of 8) costs 32 accumulator points
    this.rotAccumulator += this.stats.rot;
    if (this.rotAccumulator >= 32) {
      this.rotAccumulator -= 32;
      // Calculate shortest rotation direction (clockwise or counter-clockwise)
      const diff = (this.desiredFacing - this.facing + 8) % 8;
      if (diff <= 4) {
        this.facing = ((this.facing + 1) % 8) as Dir;
      } else {
        this.facing = ((this.facing + 7) % 8) as Dir; // -1 mod 8
      }
    }
    return this.facing === this.desiredFacing;
  }

  /** Gradually rotate turret toward desiredTurretFacing.
   *  C++ RA: turret rotates at 2x body ROT speed (accumulates rot*2 per tick). */
  tickTurretRotation(): boolean {
    if (this.turretFacing === this.desiredTurretFacing) {
      this.turretRotAccumulator = 0;
      return true;
    }
    // Guard against double-accumulation in the same game tick
    if (this.turretRotTickedThisFrame) return this.turretFacing === this.desiredTurretFacing;
    this.turretRotTickedThisFrame = true;

    // Turret rotates at 2x body speed
    this.turretRotAccumulator += this.stats.rot * 2;
    if (this.turretRotAccumulator >= 32) {
      this.turretRotAccumulator -= 32;
      const diff = (this.desiredTurretFacing - this.turretFacing + 8) % 8;
      if (diff <= 4) {
        this.turretFacing = ((this.turretFacing + 1) % 8) as Dir;
      } else {
        this.turretFacing = ((this.turretFacing + 7) % 8) as Dir;
      }
    }
    return this.turretFacing === this.desiredTurretFacing;
  }

  /** Move toward a world position at the unit's speed.
   *  C++ RA drive.cpp: vehicles stop, rotate to face destination, THEN move.
   *  Infantry are nimble and move while rotating. */
  moveToward(target: WorldPos, speed: number): boolean {
    const dx = target.x - this.pos.x;
    const dy = target.y - this.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= speed) {
      this.pos.x = target.x;
      this.pos.y = target.y;
      return true; // arrived
    }

    this.desiredFacing = directionTo(this.pos, target);
    const facingAligned = this.tickRotation();

    // Vehicles: stop-rotate-move (don't slide sideways while turning)
    if (!this.stats.isInfantry && !facingAligned) {
      return false; // still rotating — don't move yet
    }

    // Infantry move while rotating (nimble), vehicles move once facing is aligned
    this.pos.x += (dx / dist) * speed;
    this.pos.y += (dy / dist) * speed;
    return false;
  }
}

/** Calculate threat score for guard targeting (inspired by C++ techno.cpp Evaluate_Object).
 *  Higher score = higher priority target. Pure function for testability.
 *  @param scanner The unit doing the scanning
 *  @param target The potential target being evaluated
 *  @param dist Distance between scanner and target (in cells)
 *  @param isTargetAttackingAlly Whether the target is currently attacking an allied unit */
export function threatScore(
  scanner: Entity, target: Entity, dist: number, isTargetAttackingAlly: boolean,
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

  // Inverse distance weighting: closer targets score higher
  // Avoid division by zero; at dist=0 full score, at max sight range ~0.3x
  const maxRange = scanner.stats.sight * 1.5;
  const distFactor = Math.max(0.3, 1 - (dist / maxRange) * 0.7);
  score *= distFactor;

  return score;
}
