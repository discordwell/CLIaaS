/**
 * Entity system — units, structures, and their state.
 */

import {
  type WorldPos, type CellPos, type UnitStats, type WeaponStats,
  Dir, Mission, AnimState, House, UnitType,
  UNIT_STATS, WEAPON_STATS, CELL_SIZE,
  INFANTRY_ANIMS, BODY_SHAPE, ANT_ANIM,
  worldToCell, worldDist, directionTo, DIR_DX, DIR_DY,
} from './types';

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

  // Health
  hp: number;
  maxHp: number;
  alive = true;

  // Mission / AI
  mission: Mission = Mission.GUARD;
  target: Entity | null = null;
  moveTarget: WorldPos | null = null;
  path: CellPos[] = [];
  pathIndex = 0;

  // Animation
  animState: AnimState = AnimState.IDLE;
  animFrame = 0;
  animTick = 0;

  // Death / visual
  deathTick = 0;       // ticks since death (for corpse fade + cleanup)
  damageFlash = 0;     // ticks remaining for damage flash effect

  // AI rate-limiting
  lastGuardScan = 0;   // tick when guard last scanned
  lastAIScan = 0;      // tick when ant AI last scanned
  lastPathRecalc = 0;  // tick when path was last recalculated (for blocked paths)

  // Combat
  attackCooldown = 0;
  weapon: WeaponStats | null;

  // Selection
  selected = false;

  // Infantry sub-cell position (0-4 for the 5 sub-positions within a cell)
  subCell = 0;

  // Team mission script: ordered list of missions the unit executes sequentially
  teamMissions: TeamMissionEntry[] = [];
  teamMissionIndex = 0;
  teamMissionWaiting = 0;  // ticks to wait at current mission (for GUARD duration)

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
  }

  get cell(): CellPos {
    return worldToCell(this.pos.x, this.pos.y);
  }

  get isPlayerUnit(): boolean {
    return this.house === House.Spain || this.house === House.Greece;
  }

  get hasTurret(): boolean {
    return !this.stats.isInfantry && !this.isAnt &&
      this.type !== UnitType.V_APC && this.type !== UnitType.V_HARV &&
      this.type !== UnitType.V_MCV && this.type !== UnitType.V_ARTY &&
      this.type !== UnitType.V_JEEP;
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

  /** Calculate the sprite frame index for the current state */
  get spriteFrame(): number {
    const dir = this.facing;

    // --- Ant units: 104-frame layout (stand/walk/attack) ---
    if (this.isAnt) {
      switch (this.animState) {
        case AnimState.WALK:
          return ANT_ANIM.walkBase + dir * ANT_ANIM.walkCount + (this.animFrame % ANT_ANIM.walkCount);
        case AnimState.ATTACK:
          return ANT_ANIM.attackBase + dir * ANT_ANIM.attackCount + (this.animFrame % ANT_ANIM.attackCount);
        case AnimState.DIE:
          // Use last attack frame fading out
          return ANT_ANIM.attackBase + dir * ANT_ANIM.attackCount;
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
          const d = anim.die1;
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
        return 32 + Math.min(this.animFrame, 7);
      default:
        return bodyFrame;
    }
  }

  /** Take damage, return true if killed */
  takeDamage(amount: number): boolean {
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
   *  Returns true if facing matches desiredFacing. */
  tickRotation(): boolean {
    if (this.facing === this.desiredFacing) return true;
    // rot determines how fast we turn: 8=instant (infantry), lower=slower
    // rot 8 = snap, rot 4 = 2 ticks per step, rot 1 = 8 ticks per step
    if (this.stats.rot >= 8) {
      this.facing = this.desiredFacing;
      return true;
    }
    // Calculate shortest rotation direction (clockwise or counter-clockwise)
    const diff = (this.desiredFacing - this.facing + 8) % 8;
    if (diff <= 4) {
      this.facing = ((this.facing + 1) % 8) as Dir;
    } else {
      this.facing = ((this.facing + 7) % 8) as Dir; // -1 mod 8
    }
    return this.facing === this.desiredFacing;
  }

  /** Move toward a world position at the unit's speed */
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
    this.tickRotation();
    this.pos.x += (dx / dist) * speed;
    this.pos.y += (dy / dist) * speed;
    return false;
  }
}
