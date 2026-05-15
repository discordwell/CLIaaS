/**
 * Special unit subsystem — extracted from Game class (engine/index.ts).
 *
 * Handles: Tanya C4, Thief, Minelayer, Chrono Tank, MAD Tank, Demo Truck,
 * Vehicle Cloak, Mechanic, Medic, and Vortices.
 */

import {
  type WorldPos, CELL_SIZE,
  type House, UnitType, Mission, AnimState,
  worldDist, worldToCell, pixelToLepton, CHRONO_SHIFT_VISUAL_TICKS, CONDITION_RED,
  directionTo, HOUSE_FACTION,
  WARHEAD_META, modifyDamage, type WarheadType,
} from './types';
import { Entity, CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION } from './entity';
import { type MapStructure, STRUCTURE_SIZE, isMineStructureType } from './scenario';
import { type Effect } from './renderer';
import { type GameMap } from './map';
import { ScenarioRandom } from './random';
import { type LogicAnim, spawnLogicAnimForSprite } from './logicAnim';

// === Constants ===
export const MAX_MINES_PER_HOUSE = 50;
export const DEMO_TRUCK_DAMAGE = 1000;
export const DEMO_TRUCK_RADIUS = 3;
export const DEMO_TRUCK_FUSE_TICKS = 45;
export const CHRONO_TANK_COOLDOWN = 2700;
export const MAD_TANK_CHARGE_TICKS = 120;  // aftrmath.ini QuakeDelay=120
export const MAD_TANK_UNIT_DAMAGE_PERCENT = 0.45;     // aftrmath.ini QuakeUnitDamage=45%
export const MAD_TANK_BUILDING_DAMAGE_PERCENT = 0.40; // aftrmath.ini QuakeBuildingDamage=40%
export const MAD_TANK_INFANTRY_DAMAGE = 0;            // aftrmath.ini QuakeInfantryDamage=0
export const MAD_TANK_RADIUS = 20;         // aftrmath.ini MTankDistance=20
export const MAD_TANK_SCREEN_SHAKE = 8;    // logic.cpp:278 Shake_The_Screen(8)
export const MECHANIC_HEAL_RANGE = 6;
export const MECHANIC_HEAL_AMOUNT = 100; // C++ GoodWrench weapon Damage=-100 (heals 100 HP per application)
export const AP_MINE_DAMAGE = 1000;
export const AV_MINE_DAMAGE = 1200;

// === Context Interface ===
export interface SpecialUnitsContext {
  entities: Entity[];
  entityById: Map<number, Entity>;
  structures: MapStructure[];
  mines: Array<{ cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' }>;
  activeVortices: Array<{ x: number; y: number; angle: number; ticksLeft: number; id: number }>;
  effects: Effect[];
  logicAnims?: LogicAnim[];
  logicAnimsAlreadyProcessed?: boolean;
  tick: number;
  playerHouse: House;
  credits: number;
  houseCredits: Map<House, number>;
  map: GameMap;
  evaMessages: Array<{ text: string; tick: number }>;
  isThieved: boolean;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  entitiesAllied(a: Entity, b: Entity): boolean;
  isPlayerControlled(e: Entity): boolean;
  playSoundAt(name: string, x: number, y: number): void;
  playSound(name: string): void;
  movementSpeed(entity: Entity): number;
  damageEntity(
    target: Entity,
    amount: number,
    warhead: string,
    options?: { forced?: boolean },
  ): boolean;
  damageStructure(s: MapStructure, damage: number): boolean;
  handleUnitDeath?(victim: Entity, opts: {
    screenShake: number;
    explosionSize: number;
    debris: boolean;
    decal: { infantry: number; vehicle: number; opacity: number } | null;
    explodeLgSound: boolean;
    attackerIsPlayer: boolean;
    trackLoss: boolean;
    friendlyFireLoss?: boolean;
    attacker?: Entity;
  }): void;
  addEntity(entity: Entity): void;
  logicIndexHintForNewObject?(): number;
  reserveAnimSlot?(): boolean;

  // Renderer
  screenShake: number;
}

// === 1. Tanya C4 Placement ===

/** Tanya moves to structure, plants a C4 timer. */
export function updateTanyaC4(ctx: SpecialUnitsContext, entity: Entity): void {
  if (entity.type !== UnitType.I_TANYA || !entity.alive) return;
  if (!entity.targetStructure || !(entity.targetStructure as MapStructure).alive) return;
  const s = entity.targetStructure as MapStructure;
  const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
  const scx = s.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
  const scy = s.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
  const dist = worldDist(entity.pos, { x: scx, y: scy });
  // C4 plant range: for small buildings (1x1) use 1.5 from center.
  // For larger buildings, Tanya can't enter the footprint — extend range
  // by half the building diagonal so she can plant from an adjacent cell.
  // C++ Tanya walks INTO the building cell. TS pathfinder won't route to
  // WALL cells, so extend range by halfDiag + 1.5 to plant from outside.
  const halfDiag = Math.sqrt(sw * sw + sh * sh) / 2;
  const plantRange = Math.max(1.5, halfDiag + 3.0);
  if (dist > plantRange) {
    entity.animState = AnimState.WALK;
    // Follow A* path if available (from harness attack_struct), otherwise direct moveToward
    if (entity.path && entity.path.length > 0 && entity.pathIndex < entity.path.length) {
      const nextCell = entity.path[entity.pathIndex];
      const wp = { lx: nextCell.cx * 256 + 128, ly: nextCell.cy * 256 + 128 };
      if (entity.moveToward(wp, ctx.movementSpeed(entity))) {
        entity.pathIndex++;
      }
    } else {
      entity.moveToward({ lx: pixelToLepton(scx), ly: pixelToLepton(scy) }, ctx.movementSpeed(entity));
    }
    return;
  }
  // C++ infantry.cpp:841 — Iron Curtain blocks C4 placement
  if (s.ironCurtainTicks && s.ironCurtainTicks > 0) {
    entity.targetStructure = null;
    entity.target = null;
    entity.mission = Mission.GUARD;
    return;
  }
  entity.animState = AnimState.ATTACK;
  const sAny = s as MapStructure & { c4Timer?: number };
  if (sAny.c4Timer === undefined || sAny.c4Timer <= 0) {
    sAny.c4Timer = 27; // C++ rules.ini C4Delay=0.03 min * 900 ticks/min = 27 ticks
    s.whomToRepayEntityId = entity.id; // C++ BuildingClass::WhomToRepay, infantry.cpp:845
    ctx.playSoundAt('building_explode', scx, scy);
    ctx.evaMessages.push({ text: 'C4 PLANTED', tick: ctx.tick });
  }
  entity.targetStructure = null;
  entity.target = null;
  entity.mission = Mission.GUARD;
}

// === 2. C4 Timer Tick ===

/** Tick C4 timers on structures. */
export function tickC4Timers(ctx: SpecialUnitsContext): void {
  for (const s of ctx.structures) {
    if (!s.alive) continue;
    const sAny = s as MapStructure & { c4Timer?: number };
    if (sAny.c4Timer && sAny.c4Timer > 0) {
      sAny.c4Timer--;
      if (sAny.c4Timer <= 0) ctx.damageStructure(s, 9999);
    }
  }
}

// === 3. Thief ===

/** Thief infiltrates enemy buildings. Steals 50% credits from PROC/SILO.
 *  C++ infantry.cpp:676 — IsThieved set on ANY building entry.
 *  C++ infantry.cpp:706 — Thief dies after entering ANY building, not just storage. */
export function updateThief(ctx: SpecialUnitsContext, entity: Entity): void {
  if (entity.type !== UnitType.I_THF || !entity.alive) return;
  if (!entity.targetStructure || !(entity.targetStructure as MapStructure).alive) return;
  const s = entity.targetStructure as MapStructure;
  if (ctx.isAllied(entity.house, s.house)) { entity.targetStructure = null; entity.mission = Mission.GUARD; return; }
  const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
  const scx = s.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
  const scy = s.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
  const dist = worldDist(entity.pos, { x: scx, y: scy });
  if (dist > 1.5) { entity.animState = AnimState.WALK; entity.moveToward({ lx: pixelToLepton(scx), ly: pixelToLepton(scy) }, ctx.movementSpeed(entity)); return; }
  // Credit theft only applies to PROC/SILO
  if (s.type === 'PROC' || s.type === 'SILO') {
    const enemyCredits = ctx.houseCredits.get(s.house) ?? 0;
    const stolen = Math.floor(enemyCredits * 0.5);
    if (stolen > 0) {
      ctx.houseCredits.set(s.house, enemyCredits - stolen);
      if (entity.isPlayerUnit) { ctx.credits += stolen; } else { ctx.houseCredits.set(entity.house, (ctx.houseCredits.get(entity.house) ?? 0) + stolen); }
      ctx.evaMessages.push({ text: `CREDITS STOLEN: ${stolen}`, tick: ctx.tick });
    }
  }
  // C++ infantry.cpp:676 — IsThieved on ANY building entry
  ctx.isThieved = true;
  // C++ infantry.cpp:706 — Thief always dies after entering any building
  entity.alive = false; entity.mission = Mission.DIE; entity.animState = AnimState.DIE; entity.animFrame = 0; entity.deathTick = 0;
}

// === 4. Minelayer ===

/** Minelayer places AP/AV mines from MISSION_UNLOAD.
 *
 * C++ UnitClass::Mission_Unload handles UNIT_MINELAYER as a deploy state
 * machine (unit.cpp:2580-2636). Ordinary MISSION_MOVE is still just
 * DriveClass movement; there is no separate minelayer AI that moves toward
 * NavCom. Keep this function side-effect-only for mine deployment so MNLY
 * movement remains owned by DriveClass.
 */
export function updateMinelayer(ctx: SpecialUnitsContext, entity: Entity): void {
  if (entity.type !== UnitType.V_MNLY || !entity.alive || entity.mission !== Mission.UNLOAD) return;
  const targetCell = entity.cell;
  // C++ parity: minelayer carries limited ammo (Ammo=5 in rules.ini)
  if (entity.ammo === 0 && entity.maxAmmo > 0) { entity.moveTarget = null; entity.mission = Mission.GUARD; entity.animState = AnimState.IDLE; return; }
  const houseMines = ctx.mines.filter(m => m.house === entity.house).length;
  if (houseMines >= MAX_MINES_PER_HOUSE) { entity.moveTarget = null; entity.mission = Mission.GUARD; entity.animState = AnimState.IDLE; return; }
  if (!ctx.mines.find(m => m.cx === targetCell.cx && m.cy === targetCell.cy)) {
    // C++ unit.cpp:2616: Soviet houses (USSR, Ukraine, BadGuy) place AP mines, Allied place AV mines
    const faction = HOUSE_FACTION[entity.house] ?? 'allied';
    const mineType: 'AP' | 'AV' = faction === 'soviet' ? 'AP' : 'AV';
    // C++ rules.ini: APMineDamage=1000, AVMineDamage=1200
    const mineDamage = mineType === 'AP' ? AP_MINE_DAMAGE : AV_MINE_DAMAGE;
    ctx.mines.push({ cx: targetCell.cx, cy: targetCell.cy, house: entity.house, damage: mineDamage, type: mineType });
    entity.mineCount++;
    if (entity.ammo > 0) entity.ammo--;
  }
  entity.moveTarget = null; entity.mission = Mission.GUARD; entity.animState = AnimState.IDLE;
}

// === 5. Mine Trigger ===

type MineLike = { cx: number; cy: number; house: House; damage: number; type: 'AP' | 'AV' };

function handleMineDamage(ctx: SpecialUnitsContext, target: Entity, amount: number, warhead: WarheadType): void {
  const killed = ctx.damageEntity(target, amount, warhead);
  if (!killed) return;

  // C++ mine detonation calls UnitClass/InfantryClass::Take_Damage with source=NULL.
  // The death aftermath still runs: class explosion, detached targets, scoring/loss
  // bookkeeping, and vehicle crew ejection for Crewed=yes non-transports.
  ctx.handleUnitDeath?.(target, {
    screenShake: target.stats.isInfantry ? 0 : 4,
    explosionSize: target.stats.isInfantry ? 8 : 12,
    debris: !target.stats.isInfantry,
    decal: null,
    explodeLgSound: false,
    attackerIsPlayer: false,
    trackLoss: ctx.isPlayerControlled(target),
  });
}

function detonateMineOnEntity(ctx: SpecialUnitsContext, mine: MineLike, e: Entity): boolean {
  if (!e.alive || ctx.isAllied(e.house, mine.house) || e.isAirUnit) return false;
  if (e.cell.cx !== mine.cx || e.cell.cy !== mine.cy) return false;

  const isInfantry = e.stats.isInfantry;

  // C++ infantry.cpp:920: infantry only triggers AP mines (not AV)
  if (isInfantry && mine.type === 'AV') return false;

  const blastX = mine.cx * CELL_SIZE + CELL_SIZE / 2;
  const blastY = mine.cy * CELL_SIZE + CELL_SIZE / 2;

  // C++ unit.cpp:1823-1824 / infantry.cpp:923-924 creates ANIM_VEH_HIT2 at
  // the mine cell before applying damage. This occupies a normal AnimClass
  // Logic slot and must precede any death explosion/crew survivor objects.
  const logicAnims = ctx.logicAnims ?? (ctx.logicAnims = []);
  spawnLogicAnimForSprite(
    logicAnims,
    ctx.effects,
    'veh-hit2',
    blastX,
    blastY,
    true,
    ctx.logicAnimsAlreadyProcessed === true,
    ctx.logicIndexHintForNewObject?.(),
    ctx.logicIndexHintForNewObject,
    ctx.reserveAnimSlot,
  );

  if (mine.type === 'AP' && isInfantry) {
    // C++ infantry.cpp:928-936: AP mine splash damages all infantry within
    // 0xC0 leptons, roughly three TS cells in this engine's world units.
    // This TS damageEntity hook expects the ObjectClass-modified amount, so
    // apply WARHEAD_HE verses before entering the shared HP/death path.
    const SPLASH_RANGE = 3;
    for (const other of ctx.entities) {
      if (!other.alive || !other.stats.isInfantry || other.isAirUnit) continue;
      const dist = worldDist(other.pos, { x: blastX, y: blastY });
      if (dist <= SPLASH_RANGE) {
        const damage = modifyDamage(mine.damage, 'HE', other.stats.armor, 0);
        handleMineDamage(ctx, other, damage, 'HE');
      }
    }
  } else if (!isInfantry) {
    // C++ unit.cpp:1815-1837: vehicles trigger both mine types. AP mines use
    // raw damage 10, then ObjectClass::Take_Damage applies WARHEAD_HE verses.
    const rawDamage = mine.type === 'AV' ? mine.damage : 10;
    const damage = modifyDamage(rawDamage, 'HE', e.stats.armor, 0);
    handleMineDamage(ctx, e, damage, 'HE');
  }

  ctx.playSoundAt('building_explode', mine.cx * CELL_SIZE, mine.cy * CELL_SIZE);
  return true;
}

function structureMineAsMine(s: MapStructure): MineLike | null {
  if (!s.alive || !isMineStructureType(s.type)) return null;
  return {
    cx: s.cx,
    cy: s.cy,
    house: s.house,
    type: s.type === 'MINV' ? 'AV' : 'AP',
    damage: s.type === 'MINV' ? AV_MINE_DAMAGE : AP_MINE_DAMAGE,
  };
}

/** Mine trigger check — enemy enters mined cell.
 *  C++ parity (infantry.cpp:920-937, unit.cpp:1815-1837):
 *  - AP mines (STRUCT_APMINE) only trigger on infantry (infantry.cpp:920)
 *  - AV mines (STRUCT_AVMINE) only trigger on vehicles (unit.cpp:1815)
 *  - Both use WARHEAD_HE (infantry.cpp:925, unit.cpp:1827)
 *  - Vehicles hitting AP mines take only 10 damage (unit.cpp:1829)
 *  - AP mine splash damages all infantry within 0xC0 leptons (~3 cells) (infantry.cpp:928-936)
 *  - Scenario MINP/MINV are BuildingClass mines and use the same trigger
 *    rules as minelayer-created mines.
 */
export function tickMines(ctx: SpecialUnitsContext): void {
  for (let i = ctx.mines.length - 1; i >= 0; i--) {
    const mine = ctx.mines[i];
    for (const e of ctx.entities) {
      if (detonateMineOnEntity(ctx, mine, e)) {
        ctx.mines.splice(i, 1);
        break;
      }
    }
  }
}

/** C++ UnitClass/InfantryClass::Per_Cell_Process mine trigger.
 *  Scenario MINP/MINV are BuildingClass mines, so they detonate when the
 *  moving object reaches PCP_END, not from a global per-tick occupancy scan. */
export function triggerMineAtCell(ctx: SpecialUnitsContext, e: Entity): boolean {
  for (let i = ctx.mines.length - 1; i >= 0; i--) {
    const mine = ctx.mines[i];
    if (detonateMineOnEntity(ctx, mine, e)) {
      ctx.mines.splice(i, 1);
      return true;
    }
  }

  for (const s of ctx.structures) {
    const mine = structureMineAsMine(s);
    if (!mine) continue;
    if (detonateMineOnEntity(ctx, mine, e)) {
      s.alive = false;
      s.hp = 0;
      s.rubble = false;
      return true;
    }
  }
  return false;
}

// === 6. Chrono Tank Cooldown ===

/** Tick Chrono Tank cooldown only — teleport is player-initiated via D key + click. */
export function updateChronoTank(ctx: SpecialUnitsContext, entity: Entity): void {
  if (entity.type !== UnitType.V_CTNK || !entity.alive) return;
  if (entity.chronoCooldown > 0) entity.chronoCooldown--;
}

// === 7. Chrono Tank Teleport ===

/** Execute Chrono Tank teleport to target position. C++ SPC_CHRONO2 handler (house.cpp:2808). */
export function teleportChronoTank(ctx: SpecialUnitsContext, entity: Entity, target: WorldPos): void {
  if (!entity.alive || entity.chronoCooldown > 0) return;
  const tc = worldToCell(target.x, target.y);
  if (!ctx.map.isPassable(tc.cx, tc.cy)) return;
  // Blue flash at origin
  ctx.effects.push({
    type: 'explosion', x: entity.pos.x, y: entity.pos.y,
    frame: 0, maxFrames: 20, size: 24,
    sprite: 'litning', spriteStart: 0,
  });
  // Teleport — also snap prevPos to prevent interpolation swoosh
  entity.setPosition(target.x, target.y);
  entity.prevPos.x = target.x;
  entity.prevPos.y = target.y;
  // Blue flash at destination
  ctx.effects.push({
    type: 'explosion', x: entity.pos.x, y: entity.pos.y,
    frame: 0, maxFrames: 20, size: 24,
    sprite: 'litning', spriteStart: 0,
  });
  entity.chronoShiftTick = CHRONO_SHIFT_VISUAL_TICKS;
  entity.chronoCooldown = CHRONO_TANK_COOLDOWN;
  entity.moveTarget = null;
  entity.target = null;
  entity.mission = Mission.GUARD;
  ctx.playSound('chrono');
}

// === 8. MAD Tank Update ===

/** Deployed MAD Tank ticks down, then applies the C++ time-quake damage rule. */
export function updateMADTank(ctx: SpecialUnitsContext, entity: Entity): void {
  if (!entity.alive || !entity.isDeployed) return;
  entity.deployTimer--;
  entity.animState = AnimState.IDLE;
  if (entity.deployTimer <= 0) {
    const radius = MAD_TANK_RADIUS;
    entity.hp = Math.min(entity.hp, 1); // unit.cpp:2709 Strength = 1 before quake damage.
    ctx.screenShake = Math.max(ctx.screenShake, MAD_TANK_SCREEN_SHAKE);

    for (const other of ctx.entities) {
      if (!other.alive) continue;
      if (worldDist(entity.pos, other.pos) < radius) {
        const damage = other.stats.isInfantry
          ? MAD_TANK_INFANTRY_DAMAGE
          : Math.floor(other.maxHp * MAD_TANK_UNIT_DAMAGE_PERCENT);
        if (damage > 0) {
          ctx.damageEntity(other, damage, 'AP', { forced: true });
          ctx.effects.push({
            type: 'explosion',
            x: other.pos.x,
            y: other.pos.y,
            frame: 0,
            maxFrames: 20,
            size: 16,
            sprite: 'veh-hit2',
            spriteStart: 0,
          });
        }
      }
    }

    for (const s of ctx.structures) {
      if (!s.alive) continue;
      const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
      const sx = (s.cx + sw / 2) * CELL_SIZE;
      const sy = (s.cy + sh / 2) * CELL_SIZE;
      if (worldDist(entity.pos, { x: sx, y: sy }) < radius) {
        const damage = Math.floor(s.maxHp * MAD_TANK_BUILDING_DAMAGE_PERCENT);
        if (damage > 0) {
          ctx.damageStructure(s, damage);
          ctx.effects.push({
            type: 'explosion',
            x: sx,
            y: sy,
            frame: 0,
            maxFrames: 20,
            size: 16,
            sprite: 'veh-hit2',
            spriteStart: 0,
          });
        }
      }
    }

    ctx.effects.push({ type: 'explosion', x: entity.pos.x, y: entity.pos.y, frame: 0, maxFrames: 20, size: 24 });
    ctx.playSoundAt('building_explode', entity.pos.x, entity.pos.y);
    if (entity.hp <= 0) {
      entity.hp = 0; entity.alive = false; entity.mission = Mission.DIE; entity.animState = AnimState.DIE; entity.animFrame = 0; entity.deathTick = 0;
    }
  }
}

// === 9. MAD Tank Deploy ===

/** Eject crew (I_C1), set isDeployed=true, deployTimer=MAD_TANK_CHARGE_TICKS. */
export function deployMADTank(ctx: SpecialUnitsContext, entity: Entity): void {
  if (entity.isDeployed) return;
  // C++ unit.cpp:2667-2685 — eject INFANTRY_C1 technician before detonation
  const ec = entity.cell;
  const DIR_OFFSETS: [number, number][] = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  for (const [dx, dy] of DIR_OFFSETS) {
    const nx = ec.cx + dx, ny = ec.cy + dy;
    if (ctx.map.isPassable(nx, ny) && ctx.map.getOccupancy(nx, ny) === 0) {
      const crew = new Entity(UnitType.I_C1, entity.house,
        nx * CELL_SIZE + CELL_SIZE / 2, ny * CELL_SIZE + CELL_SIZE / 2);
      crew.mission = Mission.MOVE;
      // Move away from tank
      const awayX = crew.pos.x + dx * CELL_SIZE * 3;
      const awayY = crew.pos.y + dy * CELL_SIZE * 3;
      crew.moveTarget = { lx: pixelToLepton(awayX), ly: pixelToLepton(awayY) };
      ctx.addEntity(crew);
      break;
    }
  }
  entity.isDeployed = true; entity.deployTimer = MAD_TANK_CHARGE_TICKS;
  entity.moveTarget = null; entity.target = null; entity.mission = Mission.GUARD;
}

// === 10. Demo Truck Update ===

/** Demo Truck kamikaze — move to target, arm fuse, tick down, detonate. */
export function updateDemoTruck(ctx: SpecialUnitsContext, entity: Entity): void {
  if (entity.type !== UnitType.V_DTRK || !entity.alive || entity.mission !== Mission.ATTACK) return;

  // Fuse countdown — once armed, tick down to detonation
  if (entity.fuseTimer > 0) {
    entity.fuseTimer--;
    entity.animState = AnimState.IDLE;
    if (entity.fuseTimer <= 0) {
      detonateDemoTruck(ctx, entity);
    }
    return;
  }

  let targetPos: WorldPos | null = null;
  if (entity.target && entity.target.alive) { targetPos = entity.target.pos; }
  else if (entity.targetStructure && (entity.targetStructure as MapStructure).alive) {
    const s = entity.targetStructure as MapStructure;
    const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    targetPos = { x: s.cx * CELL_SIZE + (sw * CELL_SIZE) / 2, y: s.cy * CELL_SIZE + (sh * CELL_SIZE) / 2 };
  }
  if (!targetPos) { entity.mission = Mission.GUARD; return; }
  const dist = worldDist(entity.pos, targetPos);
  if (dist > 1.5) { entity.animState = AnimState.WALK; entity.moveToward({ lx: pixelToLepton(targetPos.x), ly: pixelToLepton(targetPos.y) }, ctx.movementSpeed(entity)); return; }
  // Reached target — arm the fuse
  entity.fuseTimer = DEMO_TRUCK_FUSE_TICKS;
}

// === 11. Demo Truck Detonation (NOT exported) ===

/** Detonate Demo Truck — splash damage centered on truck position.
 *  C++ parity: uses warhead spread-based falloff from modifyDamage (combat.cpp:106-125)
 *  instead of linear falloff. Nuke warhead has spreadFactor=6, giving wider splash. */
function detonateDemoTruck(ctx: SpecialUnitsContext, entity: Entity): void {
  const blastRadius = DEMO_TRUCK_RADIUS;
  const warhead: WarheadType = 'Nuke';
  for (const other of ctx.entities) {
    if (!other.alive || other.id === entity.id) continue;
    const d = worldDist(entity.pos, other.pos);
    if (d <= blastRadius) {
      // C++ parity: use warhead spread-based falloff (combat.cpp:106-125)
      // distPixels = distance in cells * CELL_SIZE (pixel distance for modifyDamage)
      const distPixels = d * CELL_SIZE;
      const dmg = modifyDamage(DEMO_TRUCK_DAMAGE, warhead, other.stats.armor ?? 'none', distPixels);
      if (dmg > 0) ctx.damageEntity(other, dmg, 'Nuke');
    }
  }
  for (const s of ctx.structures) {
    if (!s.alive) continue;
    const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    const d = worldDist(entity.pos, { x: s.cx * CELL_SIZE + (sw * CELL_SIZE) / 2, y: s.cy * CELL_SIZE + (sh * CELL_SIZE) / 2 });
    if (d <= blastRadius) {
      const distPixels = d * CELL_SIZE;
      // Structures use 'heavy' armor in C++ (ARMOR_STEEL)
      const dmg = modifyDamage(DEMO_TRUCK_DAMAGE, warhead, 'heavy', distPixels);
      if (dmg > 0) ctx.damageStructure(s, dmg);
    }
  }
  ctx.effects.push({ type: 'explosion', x: entity.pos.x, y: entity.pos.y, frame: 0, maxFrames: 20, size: 24 });
  ctx.playSoundAt('building_explode', entity.pos.x, entity.pos.y);
  entity.hp = 0; entity.alive = false; entity.mission = Mission.DIE; entity.animState = AnimState.DIE; entity.animFrame = 0; entity.deathTick = 0;
}

// === 12. Vehicle Cloak ===

/** Vehicle cloak — same as sub cloak but for non-vessel cloakable (STNK). */
export function updateVehicleCloak(ctx: SpecialUnitsContext, entity: Entity): void {
  if (!entity.stats.isCloakable || entity.stats.isVessel) return;
  switch (entity.cloakState) {
    case CloakState.CLOAKING: entity.cloakTimer--; if (entity.cloakTimer <= 0) { entity.cloakState = CloakState.CLOAKED; entity.cloakTimer = 0; } break;
    case CloakState.UNCLOAKING: entity.cloakTimer--; if (entity.cloakTimer <= 0) { entity.cloakState = CloakState.UNCLOAKED; entity.cloakTimer = 0; } break;
    case CloakState.UNCLOAKED:
      if (entity.sonarPulseTimer > 0) break;
      if (entity.mission === Mission.ATTACK) break;
      if (entity.weapon && entity.attackCooldown > 0) break;
      if (entity.hp / entity.maxHp <= CONDITION_RED && ScenarioRandom.float() > 0.04) break;
      entity.cloakState = CloakState.CLOAKING; entity.cloakTimer = CLOAK_TRANSITION_FRAMES; break;
    case CloakState.CLOAKED: break;
  }
}

// === 13. Mechanic Unit ===

/** Mechanic auto-heals vehicles, 5 HP/tick, 6-cell scan range. Fear/flee logic. */
export function updateMechanicUnit(ctx: SpecialUnitsContext, entity: Entity): void {
  if (entity.type !== UnitType.I_MECH || !entity.alive) return;
  // Cooldown decrement handled at index.ts:3814 (per-tick, all entities).
  if (entity.fear >= Entity.FEAR_SCARED) {
    let ned = Infinity; let nep: WorldPos | null = null;
    for (const o of ctx.entities) { if (!o.alive || ctx.entitiesAllied(entity, o)) continue; const d = worldDist(entity.pos, o.pos); if (d < entity.stats.sight && d < ned) { ned = d; nep = o.pos; } }
    if (nep) { const dx = entity.pos.x - nep.x; const dy = entity.pos.y - nep.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; entity.animState = AnimState.WALK; entity.moveToward({ lx: pixelToLepton(entity.pos.x + (dx / d) * CELL_SIZE * 3), ly: pixelToLepton(entity.pos.y + (dy / d) * CELL_SIZE * 3) }, ctx.movementSpeed(entity)); entity.healTarget = null; return; }
  }
  if (entity.healTarget) { const ht = entity.healTarget; if (!ht.alive || ht.hp >= ht.maxHp || !ctx.isAllied(entity.house, ht.house) || ht.stats.isInfantry || ht.isAirUnit || ht.id === entity.id) entity.healTarget = null; }
  const hsd = entity.stats.scanDelay ?? 22; // C++ Normal_Delay = 22 ticks
  if (!entity.healTarget && ctx.tick - entity.lastGuardScan >= hsd) {
    entity.lastGuardScan = ctx.tick;
    let best: Entity | null = null; let lhr = 1.0; let bd = Infinity; const sr = MECHANIC_HEAL_RANGE;
    for (const o of ctx.entities) { if (!o.alive || o.id === entity.id || !ctx.isAllied(entity.house, o.house) || o.stats.isInfantry || o.isAirUnit || o.hp >= o.maxHp) continue; const d = worldDist(entity.pos, o.pos); if (d > sr) continue; const hr = o.hp / o.maxHp; if (hr < lhr || (hr === lhr && d < bd)) { lhr = hr; bd = d; best = o; } }
    if (best) entity.healTarget = best;
  }
  if (entity.healTarget) {
    const ht = entity.healTarget; const dist = worldDist(entity.pos, ht.pos);
    if (dist <= 1.5) {
      entity.animState = AnimState.ATTACK; entity.desiredFacing = directionTo(entity.pos, ht.pos); entity.tickRotation();
      if (entity.attackCooldown <= 0) {
        const prev = ht.hp; ht.hp = Math.min(ht.maxHp, ht.hp + MECHANIC_HEAL_AMOUNT); const healed = ht.hp - prev; entity.attackCooldown = entity.weapon?.rof ?? 80;
        if (healed > 0) { ctx.playSoundAt('heal', ht.pos.x, ht.pos.y); ctx.effects.push({ type: 'muzzle', x: ht.pos.x, y: ht.pos.y - 4, frame: 0, maxFrames: 6, size: 4, muzzleColor: '80,200,255' }); ctx.effects.push({ type: 'text', x: ht.pos.x, y: ht.pos.y - 8, frame: 0, maxFrames: 30, size: 0, text: `+${healed}`, textColor: 'rgba(80,200,255,1)' }); }
        if (ht.hp >= ht.maxHp) entity.healTarget = null;
      }
    } else { entity.animState = AnimState.WALK; entity.moveToward({ lx: ht.leptonX, ly: ht.leptonY }, ctx.movementSpeed(entity)); }
    return;
  }
  entity.animState = AnimState.IDLE;
}

// === 14. Medic Unit ===

/** Medic auto-heal AI — C++ infantry.cpp InfantryClass::AI() medic behavior.
 *  Medics scan for nearest damaged friendly infantry within sight range,
 *  move toward them, and heal when adjacent. Medics are non-combat units
 *  and never attack enemies. They flee when frightened (fear/prone system). */
export function updateMedic(ctx: SpecialUnitsContext, entity: Entity): void {
  // Cooldown decrement handled at index.ts:3814 (per-tick, all entities).

  // Medics flee when frightened (C++ infantry.cpp fear system) — run from nearest enemy
  if (entity.fear >= Entity.FEAR_SCARED) {
    let nearestEnemyDist = Infinity;
    let nearestEnemyPos: WorldPos | null = null;
    for (const other of ctx.entities) {
      if (!other.alive || other.inLimbo || ctx.entitiesAllied(entity, other)) continue;
      const dist = worldDist(entity.pos, other.pos);
      if (dist < entity.stats.sight && dist < nearestEnemyDist) {
        nearestEnemyDist = dist;
        nearestEnemyPos = other.pos;
      }
    }
    if (nearestEnemyPos) {
      // Flee in opposite direction
      const dx = entity.pos.x - nearestEnemyPos.x;
      const dy = entity.pos.y - nearestEnemyPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const fleeX = entity.pos.x + (dx / dist) * CELL_SIZE * 3;
      const fleeY = entity.pos.y + (dy / dist) * CELL_SIZE * 3;
      entity.animState = AnimState.WALK;
      entity.moveToward({ lx: pixelToLepton(fleeX), ly: pixelToLepton(fleeY) }, ctx.movementSpeed(entity));
      entity.healTarget = null; // drop heal target when fleeing
      return;
    }
  }

  // Validate existing heal target: must still be alive, friendly infantry, damaged, and in range
  if (entity.healTarget) {
    const ht = entity.healTarget;
    if (!ht.alive || ht.hp >= ht.maxHp ||
        !ctx.isAllied(entity.house, ht.house) || !ht.stats.isInfantry ||
        ht.id === entity.id) {
      entity.healTarget = null;
    }
  }

  // Scan for heal target (rate-limited by scan delay)
  const healScanDelay = entity.stats.scanDelay ?? 22; // C++ Normal_Delay = 22 ticks
  if (!entity.healTarget && ctx.tick - entity.lastGuardScan >= healScanDelay) {
    entity.lastGuardScan = ctx.tick;

    let bestTarget: Entity | null = null;
    let lowestHpRatio = 1.0;
    let bestDist = Infinity;
    const healScanRange = entity.stats.sight * 1.5; // C++ sight * 1.5 for medic search

    for (const other of ctx.entities) {
      if (!other.alive || other.id === entity.id) continue;
      if (!ctx.isAllied(entity.house, other.house)) continue;
      if (!other.stats.isInfantry) continue;
      if (other.hp >= other.maxHp) continue;
      // Don't heal ants (they are infantry-like but not player infantry)
      if (other.isAnt) continue;
      const dist = worldDist(entity.pos, other.pos);
      if (dist > healScanRange) continue;
      // Prefer most damaged unit (lowest HP ratio), then closest
      const hpRatio = other.hp / other.maxHp;
      if (hpRatio < lowestHpRatio || (hpRatio === lowestHpRatio && dist < bestDist)) {
        lowestHpRatio = hpRatio;
        bestDist = dist;
        bestTarget = other;
      }
    }

    if (bestTarget) {
      entity.healTarget = bestTarget;
    }
  }

  // Act on heal target
  if (entity.healTarget) {
    const ht = entity.healTarget;
    const dist = worldDist(entity.pos, ht.pos);

    if (dist <= 1.5) {
      // Adjacent — perform heal
      entity.animState = AnimState.ATTACK; // heal animation (MedicDoControls fire anim)
      entity.desiredFacing = directionTo(entity.pos, ht.pos);
      entity.tickRotation();

      if (entity.attackCooldown <= 0) {
        // Heal amount: use weapon damage (negative = heal) or default 5 HP per tick
        const healWeapon = entity.weapon;
        const healAmount = healWeapon ? Math.abs(healWeapon.damage) : 5;
        const healRof = healWeapon?.rof ?? 15;

        const prevHp = ht.hp;
        ht.hp = Math.min(ht.maxHp, ht.hp + healAmount);
        const healed = ht.hp - prevHp;
        entity.attackCooldown = healRof;

        if (healed > 0) {
          ctx.playSoundAt('heal', ht.pos.x, ht.pos.y);
          // Green heal sparkle on target
          ctx.effects.push({
            type: 'muzzle', x: ht.pos.x, y: ht.pos.y - 4,
            frame: 0, maxFrames: 6, size: 4, muzzleColor: '80,255,80',
          });
          // Floating "+HP" text effect
          ctx.effects.push({
            type: 'text', x: ht.pos.x, y: ht.pos.y - 8,
            frame: 0, maxFrames: 30, size: 0,
            text: `+${healed}`, textColor: 'rgba(80,255,80,1)',
          });
        }

        // Check if target is fully healed — clear and scan for next
        if (ht.hp >= ht.maxHp) {
          entity.healTarget = null;
        }
      }
    } else {
      // Move toward heal target
      entity.animState = AnimState.WALK;
      entity.moveToward({ lx: ht.leptonX, ly: ht.leptonY }, ctx.movementSpeed(entity));
    }
    return;
  }

  // No heal target — idle
  entity.animState = AnimState.IDLE;
}

// === 15. Vortices ===

/** Tick active vortex entities — wander randomly, damage nearby units/structures. */
export function tickVortices(ctx: SpecialUnitsContext): void {
  for (let i = ctx.activeVortices.length - 1; i >= 0; i--) {
    const v = ctx.activeVortices[i];
    v.ticksLeft--;
    if (v.ticksLeft <= 0) {
      ctx.activeVortices.splice(i, 1);
      continue;
    }
    // Random wandering — adjust angle slightly each tick
    v.angle += (ScenarioRandom.float() - 0.5) * 0.4;
    v.x += Math.cos(v.angle) * CELL_SIZE * 0.15;
    v.y += Math.sin(v.angle) * CELL_SIZE * 0.15;
    // Clamp to map bounds
    const minX = ctx.map.boundsX * CELL_SIZE;
    const maxX = (ctx.map.boundsX + ctx.map.boundsW) * CELL_SIZE;
    const minY = ctx.map.boundsY * CELL_SIZE;
    const maxY = (ctx.map.boundsY + ctx.map.boundsH) * CELL_SIZE;
    if (v.x < minX || v.x > maxX) { v.angle = Math.PI - v.angle; v.x = Math.max(minX, Math.min(maxX, v.x)); }
    if (v.y < minY || v.y > maxY) { v.angle = -v.angle; v.y = Math.max(minY, Math.min(maxY, v.y)); }
    // Damage units and structures within 1 cell radius — 50 damage every 3 ticks (~250 DPS)
    if (v.ticksLeft % 3 === 0) {
      for (const e of ctx.entities) {
        if (!e.alive) continue;
        const dx = e.pos.x - v.x;
        const dy = e.pos.y - v.y;
        if (dx * dx + dy * dy <= CELL_SIZE * CELL_SIZE) {
          ctx.damageEntity(e, 50, 'Super');
        }
      }
      for (const s of ctx.structures) {
        if (!s.alive) continue;
        const sx = s.cx * CELL_SIZE + CELL_SIZE / 2;
        const sy = s.cy * CELL_SIZE + CELL_SIZE / 2;
        const dx = sx - v.x;
        const dy = sy - v.y;
        if (dx * dx + dy * dy <= CELL_SIZE * CELL_SIZE) {
          ctx.damageStructure(s, 50);
        }
      }
    }
    // Visual effect — rotating translucent circle
    ctx.effects.push({
      type: 'explosion', x: v.x, y: v.y,
      frame: 0, maxFrames: 2, size: 18,
      sprite: 'atomsfx', spriteStart: 0, blendMode: 'screen',
    });
  }
}
