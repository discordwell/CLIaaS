/**
 * Entity system — units, structures, and their state.
 */

import {
  type WorldPos, type CellPos, type UnitStats, type WeaponStats,
  Dir, Mission, AnimState, House, UnitType,
  UNIT_STATS, WEAPON_STATS, CELL_SIZE,
  worldToCell, worldDist, directionTo, DIR_DX, DIR_DY,
} from './types';

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

  // Combat
  attackCooldown = 0;
  weapon: WeaponStats | null;

  // Selection
  selected = false;

  // Infantry sub-cell position (0-4 for the 5 sub-positions within a cell)
  subCell = 0;

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

  get isAnt(): boolean {
    return this.type === UnitType.ANT1 ||
           this.type === UnitType.ANT2 ||
           this.type === UnitType.ANT3;
  }

  /** Calculate the sprite frame index for the current state */
  get spriteFrame(): number {
    const dir = this.facing;
    const stats = this.stats;

    if (stats.isInfantry) {
      // Infantry frame layout:
      // Walk: dir*8 + walkFrame (0-7 per direction, 8 directions)
      // Fire: 64 + dir*2 + fireFrame
      // Die: 80+ (death sequence)
      // Idle: dir*8 (first walk frame)
      switch (this.animState) {
        case AnimState.WALK:
          return dir * 8 + (this.animFrame % 6);
        case AnimState.ATTACK:
          return 48 + dir * 2 + (this.animFrame % 2);
        case AnimState.DIE:
          return 64 + Math.min(this.animFrame, 7);
        default:
          return dir * 8; // idle = first walk frame
      }
    }

    // Vehicle/ant frame layout:
    // 32 rotation frames (body), each at 360/32 = 11.25° intervals
    // For 8-direction facing: dir * 4 gives the base frame
    const bodyFrame = dir * 4;

    switch (this.animState) {
      case AnimState.WALK:
        return bodyFrame; // vehicles don't animate walk
      case AnimState.ATTACK:
        return bodyFrame; // attack = same frame (fire effect is separate)
      case AnimState.DIE:
        return 32 + Math.min(this.animFrame, 7); // damaged frames
      default:
        return bodyFrame;
    }
  }

  /** Take damage, return true if killed */
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.mission = Mission.DIE;
      this.animState = AnimState.DIE;
      this.animFrame = 0;
      this.animTick = 0;
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

    this.facing = directionTo(this.pos, target);
    this.pos.x += (dx / dist) * speed;
    this.pos.y += (dy / dist) * speed;
    return false;
  }
}
