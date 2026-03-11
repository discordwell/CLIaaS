/**
 * Crate subsystem — extracted from Game class (index.ts).
 * Handles crate spawning, weighted type selection, and pickup reward application.
 */

import {
  type WorldPos, type House,
  CELL_SIZE, GAME_TICKS_PER_SEC,
  UnitType, Mission, worldToCell, worldDist,
  EXPLOSION_FRAMES, WEAPON_STATS,
} from './types';
import { Entity, SONAR_PULSE_DURATION } from './entity';
import { type GameMap } from './map';
import { type Effect } from './renderer';
import { type MapStructure } from './scenario';

// ── Crate types ─────────────────────────────────────────────────────────────

export type CrateType =
  | 'money' | 'heal' | 'unit' | 'armor' | 'firepower' | 'speed'
  | 'reveal' | 'darkness' | 'explosion' | 'squad' | 'heal_base' | 'napalm'
  | 'cloak' | 'invulnerability' | 'parabomb' | 'sonar' | 'icbm'
  | 'timequake' | 'vortex';

export interface Crate {
  x: number;
  y: number;
  type: CrateType;
  tick: number;     // tick when spawned
  lifetime: number; // CR6: ticks until expiry
}

// ── Static data (moved from Game class) ─────────────────────────────────────

/** Map INI crate reward name to our CrateType */
export const CRATE_NAME_MAP: Record<string, CrateType> = {
  money: 'money', heal: 'heal', veterancy: 'heal', unit: 'unit',
  armor: 'armor', firepower: 'firepower', speed: 'speed',
  reveal: 'reveal', darkness: 'darkness', explosion: 'explosion',
  squad: 'squad', heal_base: 'heal_base', napalm: 'napalm',
  cloak: 'cloak', invulnerability: 'invulnerability',
  parabomb: 'parabomb', sonar: 'sonar', icbm: 'icbm',
  timequake: 'timequake', vortex: 'vortex',
};

/** CR9: Weighted crate share distribution (C++ CrateShares from rules.ini) */
export const CRATE_SHARES: Array<{ type: CrateType; shares: number }> = [
  { type: 'money', shares: 50 },
  { type: 'unit', shares: 20 },
  { type: 'speed', shares: 10 },
  { type: 'firepower', shares: 10 },
  { type: 'armor', shares: 10 },
  { type: 'reveal', shares: 5 },
  { type: 'cloak', shares: 3 },
  { type: 'heal', shares: 15 },
  { type: 'explosion', shares: 5 },
  { type: 'parabomb', shares: 3 },
  { type: 'sonar', shares: 2 },
  { type: 'icbm', shares: 1 },
  { type: 'timequake', shares: 1 },
  { type: 'vortex', shares: 1 },
];

// ── Context interface ───────────────────────────────────────────────────────

export interface CrateContext {
  // Mutable game state
  crates: Crate[];
  entities: Entity[];
  entityById: Map<number, Entity>;
  structures: MapStructure[];
  effects: Effect[];
  evaMessages: { text: string; tick: number }[];
  activeVortices: Array<{ x: number; y: number; angle: number; ticksLeft: number; id: number }>;
  visionaryHouses: Set<House>;
  credits: number;
  tick: number;
  playerHouse: House;
  screenShake: number;
  map: GameMap;
  crateOverrides: { silver?: string; wood?: string; water?: string };

  // Callbacks
  addCredits(amount: number, bypassSiloCap: boolean): void;
  playSoundAt(name: string, x: number, y: number): void;
  playSound(name: string): void;
  damageEntity(entity: Entity, damage: number, warhead: string): void;
  damageStructure(structure: MapStructure, damage: number): void;
  detonateNuke(target: WorldPos): void;
  isAllied(a: House, b: House): boolean;
}

// ── Pure functions ──────────────────────────────────────────────────────────

/** CR9: Select a crate type using weighted random distribution */
export function weightedCrateType(): CrateType {
  const shares = CRATE_SHARES;
  const totalShares = shares.reduce((sum, s) => sum + s.shares, 0);
  let roll = Math.random() * totalShares;
  for (const entry of shares) {
    roll -= entry.shares;
    if (roll <= 0) return entry.type;
  }
  return shares[shares.length - 1].type; // fallback
}

// ── Mutating functions ──────────────────────────────────────────────────────

export function spawnCrate(ctx: CrateContext): void {
  // CR9: Use weighted CrateShares distribution (C++ rules.ini)
  let type = weightedCrateType();
  // Apply INI crate overrides if present
  if (ctx.crateOverrides.silver) {
    const t = CRATE_NAME_MAP[ctx.crateOverrides.silver];
    if (t) type = t;
  }
  // CR6: Crate lifetime = Random(CrateTime/2, CrateTime*2) in minutes, default CrateTime=10
  // So 5-20 minutes, converted to ticks (x 15 FPS x 60 seconds/min)
  const crateTimeMin = 10; // minutes (C++ default CrateTime)
  const minLifetime = Math.floor(crateTimeMin / 2); // 5 minutes
  const maxLifetime = crateTimeMin * 2; // 20 minutes
  const lifetimeMinutes = minLifetime + Math.random() * (maxLifetime - minLifetime);
  const lifetimeTicks = Math.floor(lifetimeMinutes * 60 * GAME_TICKS_PER_SEC);
  // Try up to 20 random cells to find a valid spawn
  for (let attempt = 0; attempt < 20; attempt++) {
    const cx = ctx.map.boundsX + Math.floor(Math.random() * ctx.map.boundsW);
    const cy = ctx.map.boundsY + Math.floor(Math.random() * ctx.map.boundsH);
    if (!ctx.map.isPassable(cx, cy)) continue;
    if (ctx.map.getVisibility(cx, cy) === 0) continue; // must be explored
    const x = cx * CELL_SIZE + CELL_SIZE / 2;
    const y = cy * CELL_SIZE + CELL_SIZE / 2;
    ctx.crates.push({ x, y, type, tick: ctx.tick, lifetime: lifetimeTicks });
    return;
  }
}

/** Apply crate bonus to the unit that picked it up */
export function pickupCrate(ctx: CrateContext, crate: Crate, unit: Entity): void {
  ctx.playSoundAt('crate_pickup', crate.x, crate.y);
  ctx.effects.push({
    type: 'explosion', x: crate.x, y: crate.y,
    frame: 0, maxFrames: 10, size: 8, sprite: 'piffpiff', spriteStart: 0,
  });
  switch (crate.type) {
    case 'money':
      // CR1: C++ solo play gives 2000 credits from money crate
      ctx.addCredits(2000, true);
      ctx.evaMessages.push({ text: 'MONEY CRATE', tick: ctx.tick });
      break;
    case 'heal':
      unit.hp = unit.maxHp;
      ctx.evaMessages.push({ text: 'UNIT HEALED', tick: ctx.tick });
      break;
    case 'unit': {
      // Spawn a random unit nearby — includes expansion units
      const types = [
        UnitType.I_E1, UnitType.I_E2, UnitType.I_E3, UnitType.I_E4,
        UnitType.I_SHOK, UnitType.I_MECH,          // CS/Aftermath infantry
        UnitType.V_JEEP, UnitType.V_1TNK,            // base vehicles
        UnitType.V_STNK, UnitType.V_CTNK,           // CS expansion vehicles
      ];
      const uType = types[Math.floor(Math.random() * types.length)];
      const bonus = new Entity(uType, ctx.playerHouse, crate.x + CELL_SIZE, crate.y);
      bonus.mission = Mission.GUARD;
      ctx.entities.push(bonus);
      ctx.entityById.set(bonus.id, bonus);
      ctx.evaMessages.push({ text: 'REINFORCEMENTS', tick: ctx.tick });
      break;
    }
    case 'armor':
      // CR2: Set armorBias = 2 (half damage taken) — C++ ArmorBias, NOT double maxHp
      unit.armorBias = 2;
      ctx.evaMessages.push({ text: 'ARMOR UPGRADE', tick: ctx.tick });
      break;
    case 'firepower':
      // CR3: Set firepowerBias = 2 (double damage output) — C++ FirepowerBias
      unit.firepowerBias = 2;
      ctx.evaMessages.push({ text: 'FIREPOWER UPGRADE', tick: ctx.tick });
      break;
    case 'speed':
      // CR7: 1.5× speed boost — C++ rules.cpp SpeedBias=1.5 (verified)
      unit.speedBias = 1.5;
      ctx.evaMessages.push({ text: 'SPEED UPGRADE', tick: ctx.tick });
      break;
    case 'reveal':
      // CR4: Reveal entire map for the player's house (C++ IsVisionary equivalent)
      ctx.visionaryHouses.add(unit.house);
      ctx.map.revealAll();
      ctx.evaMessages.push({ text: 'MAP REVEALED', tick: ctx.tick });
      break;
    case 'darkness': {
      // Shroud 7x7 cells around crate
      const cc = worldToCell(crate.x, crate.y);
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          ctx.map.setVisibility(cc.cx + dx, cc.cy + dy, 0);
        }
      }
      ctx.evaMessages.push({ text: 'DARKNESS', tick: ctx.tick });
      break;
    }
    case 'explosion': {
      // 200 HP damage to all units in 3-cell radius
      for (const e of ctx.entities) {
        if (!e.alive) continue;
        const d = worldDist(e.pos, { x: crate.x, y: crate.y });
        if (d <= 3) {
          ctx.damageEntity(e, 200, 'HE');
        }
      }
      ctx.effects.push({ type: 'explosion', x: crate.x, y: crate.y, frame: 0, maxFrames: EXPLOSION_FRAMES.atomsfx, size: 20, sprite: 'atomsfx', spriteStart: 0, blendMode: 'screen' });
      ctx.evaMessages.push({ text: 'BOOBY TRAP!', tick: ctx.tick });
      break;
    }
    case 'squad': {
      // Spawn 5 random infantry at crate location
      const infTypes = [UnitType.I_E1, UnitType.I_E2, UnitType.I_E3, UnitType.I_E4, UnitType.I_E1];
      for (let i = 0; i < 5; i++) {
        const t = infTypes[Math.floor(Math.random() * infTypes.length)];
        const ox = (Math.random() - 0.5) * CELL_SIZE * 2;
        const oy = (Math.random() - 0.5) * CELL_SIZE * 2;
        const inf = new Entity(t, ctx.playerHouse, crate.x + ox, crate.y + oy);
        inf.mission = Mission.GUARD;
        ctx.entities.push(inf);
        ctx.entityById.set(inf.id, inf);
      }
      ctx.evaMessages.push({ text: 'SQUAD REINFORCEMENT', tick: ctx.tick });
      break;
    }
    case 'heal_base': {
      // Heal all player structures +20% HP
      for (const s of ctx.structures) {
        if (s.alive && ctx.isAllied(s.house, ctx.playerHouse)) {
          s.hp = Math.min(s.maxHp, s.hp + Math.ceil(s.maxHp * 0.2));
        }
      }
      ctx.evaMessages.push({ text: 'BASE REPAIRED', tick: ctx.tick });
      break;
    }
    case 'napalm': {
      // Fire effects in 3x3 grid
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const fx = crate.x + dx * CELL_SIZE;
          const fy = crate.y + dy * CELL_SIZE;
          ctx.effects.push({ type: 'explosion', x: fx, y: fy, frame: 0, maxFrames: EXPLOSION_FRAMES.napalm1, size: 12, sprite: 'napalm1', spriteStart: 0, blendMode: 'screen' });
          // Damage units in each cell
          for (const e of ctx.entities) {
            if (!e.alive) continue;
            const d = worldDist(e.pos, { x: fx, y: fy });
            if (d <= 1) ctx.damageEntity(e, 80, 'Fire');
          }
        }
      }
      ctx.evaMessages.push({ text: 'NAPALM STRIKE', tick: ctx.tick });
      break;
    }
    case 'cloak':
      // CR5: Permanent cloaking ability (C++ IsCloakable from crate)
      unit.isCloakable = true;
      ctx.evaMessages.push({ text: 'UNIT CLOAKED', tick: ctx.tick });
      break;
    case 'invulnerability':
      // 20 seconds invincibility (300 ticks)
      unit.invulnTick = 300;
      ctx.evaMessages.push({ text: 'INVULNERABILITY', tick: ctx.tick });
      break;
    case 'parabomb': {
      // CR8: ParaBomb — airstrike at crate location (C++ RULES.INI ParaBomb weapon)
      const crateBombDmg = WEAPON_STATS.ParaBomb.damage;
      for (let i = -3; i <= 3; i++) {
        const bx = crate.x + i * CELL_SIZE;
        const by = crate.y;
        ctx.effects.push({
          type: 'explosion', x: bx, y: by,
          frame: 0, maxFrames: EXPLOSION_FRAMES['art-exp1'] ?? 22, size: 16,
          sprite: 'art-exp1', spriteStart: 0,
        });
        for (const e of ctx.entities) {
          if (!e.alive) continue;
          if (worldDist(e.pos, { x: bx, y: by }) <= 1.5) {
            ctx.damageEntity(e, crateBombDmg, 'HE');
          }
        }
      }
      ctx.playSound('explode_lg');
      ctx.evaMessages.push({ text: 'PARABOMB STRIKE', tick: ctx.tick });
      break;
    }
    case 'sonar':
      // CR8: Sonar — activate sonar pulse (reveal all subs for SONAR_PULSE_DURATION ticks)
      for (const e of ctx.entities) {
        if (!e.alive || !e.stats.isCloakable) continue;
        if (ctx.isAllied(e.house, unit.house)) continue;
        e.sonarPulseTimer = SONAR_PULSE_DURATION;
      }
      ctx.playSound('cannon'); // sonar ping
      ctx.evaMessages.push({ text: 'SONAR PULSE', tick: ctx.tick });
      break;
    case 'icbm': {
      // CR8: ICBM — trigger a nuke strike at a random enemy structure
      const enemyStructs = ctx.structures.filter(s =>
        s.alive && !ctx.isAllied(s.house, unit.house)
      );
      if (enemyStructs.length > 0) {
        const target = enemyStructs[Math.floor(Math.random() * enemyStructs.length)];
        const tx = target.cx * CELL_SIZE + CELL_SIZE;
        const ty = target.cy * CELL_SIZE + CELL_SIZE;
        ctx.detonateNuke({ x: tx, y: ty });
        ctx.evaMessages.push({ text: 'ICBM LAUNCHED', tick: ctx.tick });
      } else {
        // No enemy structures — fallback to money crate
        ctx.addCredits(2000, true);
        ctx.evaMessages.push({ text: 'MONEY CRATE', tick: ctx.tick });
      }
      break;
    }
    case 'timequake': {
      // CR8: TimeQuake — damages ALL units AND structures on map (friend and foe) for 100-300 random damage
      for (const e of ctx.entities) {
        if (!e.alive) continue;
        const dmg = 100 + Math.floor(Math.random() * 201); // 100-300
        ctx.damageEntity(e, dmg, 'HE');
      }
      for (const s of ctx.structures) {
        if (!s.alive) continue;
        const dmg = 100 + Math.floor(Math.random() * 201);
        ctx.damageStructure(s, dmg);
      }
      ctx.screenShake = Math.max(ctx.screenShake, 15);
      ctx.playSound('explode_lg');
      ctx.evaMessages.push({ text: 'TIME QUAKE', tick: ctx.tick });
      break;
    }
    case 'vortex': {
      // CR8: Vortex — spawns a wandering energy vortex that damages nearby units for ~30 seconds
      ctx.activeVortices.push({
        x: crate.x, y: crate.y, angle: Math.random() * Math.PI * 2, ticksLeft: 450, id: ctx.tick,
      });
      ctx.playSound('teslazap');
      ctx.evaMessages.push({ text: 'VORTEX SPAWNED', tick: ctx.tick });
      break;
    }
  }
}
