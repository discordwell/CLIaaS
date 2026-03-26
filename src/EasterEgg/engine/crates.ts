/**
 * Crate subsystem — extracted from Game class (index.ts).
 * Handles crate spawning, weighted type selection, and pickup reward application.
 */

import {
  type WorldPos, type House,
  CELL_SIZE, GAME_TICKS_PER_SEC,
  UnitType, Mission, worldDist,
  EXPLOSION_FRAMES, WEAPON_STATS,
} from './types';
import { ScenarioRandom } from './random';
import { Entity, SONAR_PULSE_DURATION } from './entity';
import { type GameMap } from './map';
import { type Effect } from './renderer';
import { type MapStructure } from './scenario';

/**
 * C++ rules.cpp:262: CrateRadius = 0x0280 = 640 leptons.
 * 1 cell = 256 leptons (CELL_LEPTON_W), so CrateRadius = 640/256 = 2.5 cells.
 * Upgrade crates (armor, speed, firepower) affect all friendly units within this radius.
 */
export const CRATE_RADIUS = 3.0;

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
  surface?: 'land' | 'water'; // C++ cell.cpp:2286: OVERLAY_WATER_CRATE vs OVERLAY_WOOD_CRATE
}

// ── Static data (moved from Game class) ─────────────────────────────────────

/** Map INI crate reward name to our CrateType */
export const CRATE_NAME_MAP: Record<string, CrateType> = {
  money: 'money', heal: 'heal', veterancy: 'heal', unit: 'unit',
  armor: 'armor', firepower: 'firepower', speed: 'speed',
  reveal: 'reveal', darkness: 'darkness', explosion: 'explosion',
  squad: 'squad', heal_base: 'heal_base', healbase: 'heal_base', napalm: 'napalm',
  cloak: 'cloak', invulnerability: 'invulnerability',
  parabomb: 'parabomb', sonar: 'sonar', icbm: 'icbm',
  timequake: 'timequake', vortex: 'vortex', chronalvortex: 'vortex',
};

/**
 * Crate type → animation sprite mapping (C++ CrateAnims[], populated from RULES.INI [Powerups]).
 * Each entry's second field in RULES.INI specifies the animation sprite name.
 * null/undefined means ANIM_NONE (no crate-specific animation).
 *
 * C++ refs: const.cpp:402-421 (defaults), rules.cpp:801 (RULES.INI override),
 *           cell.cpp:2319-2321 (animation trigger on pickup)
 * RULES.INI: public/ra/assets/rules.ini:2819-2836
 */
export const CRATE_ANIM_MAP: Partial<Record<CrateType, string>> = {
  money:            'dollar',    // RULES.INI Money=50,DOLLAR,2000
  armor:            'armor',     // RULES.INI Armor=10,ARMOR,2.0
  speed:            'speed',     // RULES.INI Speed=10,SPEED,1.7
  firepower:        'fpower',    // RULES.INI Firepower=10,FPOWER,2.0
  cloak:            'stealth2',  // RULES.INI Cloak=0,STEALTH2
  darkness:         'empulse',   // RULES.INI Darkness=1,EMPULSE
  reveal:           'earth',     // RULES.INI Reveal=1,EARTH
  heal_base:        'invun',     // RULES.INI HealBase=1,INVUN
  sonar:            'sonarbox',  // RULES.INI Sonar=3,SONARBOX
  icbm:             'missile2',  // RULES.INI ICBM=1,MISSILE2
  timequake:        'tquake',    // RULES.INI TimeQuake=3,TQUAKE
  invulnerability:  'invulbox',  // RULES.INI Invulnerability=3,INVULBOX,1.0
  parabomb:         'parabox',   // RULES.INI ParaBomb=3,PARABOX
  // unit, explosion, napalm, squad, heal, vortex → ANIM_NONE (no crate animation)
};

/**
 * CR9: Weighted crate share distribution — must match C++ RULES.INI [Powerups] section.
 * C++ refs: const.cpp:381-400 (defaults), rules.cpp:778-816 (RULES.INI override),
 *           rules.ini:2819-2836 (actual values), defines.h:759-781 (CrateType enum order)
 *
 * Order matches C++ CrateType enum: CRATE_MONEY(0) through CRATE_VORTEX(17).
 * ChronalVortex is NOT in RULES.INI → uses const.cpp default of 5.
 */
export const CRATE_SHARES: Array<{ type: CrateType; shares: number }> = [
  { type: 'money', shares: 50 },           // Money=50,DOLLAR,2000
  { type: 'unit', shares: 20 },            // Unit=20,NONE
  { type: 'parabomb', shares: 3 },         // ParaBomb=3,PARABOX
  { type: 'heal_base', shares: 1 },        // HealBase=1,INVUN
  { type: 'cloak', shares: 0 },            // Cloak=0,STEALTH2 (disabled in RULES.INI)
  { type: 'explosion', shares: 5 },        // Explosion=5,NONE,500
  { type: 'napalm', shares: 5 },           // Napalm=5,NONE,600
  { type: 'squad', shares: 20 },           // Squad=20,NONE
  { type: 'darkness', shares: 1 },         // Darkness=1,EMPULSE
  { type: 'reveal', shares: 1 },           // Reveal=1,EARTH
  { type: 'sonar', shares: 3 },            // Sonar=3,SONARBOX
  { type: 'armor', shares: 10 },           // Armor=10,ARMOR,2.0
  { type: 'speed', shares: 10 },           // Speed=10,SPEED,1.7
  { type: 'firepower', shares: 10 },       // Firepower=10,FPOWER,2.0
  { type: 'icbm', shares: 1 },             // ICBM=1,MISSILE2
  { type: 'timequake', shares: 3 },        // TimeQuake=3,TQUAKE
  { type: 'invulnerability', shares: 3 },   // Invulnerability=3,INVULBOX,1.0
  { type: 'vortex', shares: 5 },           // ChronalVortex — const.cpp default=5
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
  isMultiplayer?: boolean; // C++ Session.Type != GAME_NORMAL — multiplayer money uses Random_Pick

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

/** CR9: Select a crate type using weighted random distribution.
 *  C++ cell.cpp:2148-2154: uses 1-indexed Random_Pick(1, total_shares) (integer, inclusive).
 *  We match the C++ algorithm: pick integer in [1, total], accumulate shares, break on pick <= sum. */
export function weightedCrateType(): CrateType {
  const shares = CRATE_SHARES;
  const totalShares = shares.reduce((sum, s) => sum + s.shares, 0);
  // C++ Random_Pick(1, total_shares) — uniform integer over [1, total]
  const pick = ScenarioRandom.nextInRange(1, totalShares);
  let shareCount = 0;
  for (const entry of shares) {
    shareCount += entry.shares;
    if (pick <= shareCount) return entry.type;
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
  const crateTimeMin = 3; // minutes (RULES.INI CrateRegen=3, overrides C++ default 10)
  const minLifetime = crateTimeMin / 2; // C++ CrateTime * (TICKS_PER_MINUTE/2) = 1350 ticks — no truncation
  const maxLifetime = crateTimeMin * 2; // 20 minutes
  const lifetimeMinutes = minLifetime + ScenarioRandom.float() * (maxLifetime - minLifetime);
  const lifetimeTicks = Math.floor(lifetimeMinutes * 60 * GAME_TICKS_PER_SEC);
  // C++ map.cpp:1177 — try up to 1000 random cells to find a valid spawn
  for (let attempt = 0; attempt < 1000; attempt++) {
    const cx = ctx.map.boundsX + ScenarioRandom.nextInRange(0, ctx.map.boundsW - 1);
    const cy = ctx.map.boundsY + ScenarioRandom.nextInRange(0, ctx.map.boundsH - 1);
    if (!ctx.map.isPassable(cx, cy)) continue;
    if (ctx.map.getVisibility(cx, cy) === 0) continue; // must be explored
    const x = cx * CELL_SIZE + CELL_SIZE / 2;
    const y = cy * CELL_SIZE + CELL_SIZE / 2;
    ctx.crates.push({ x, y, type, tick: ctx.tick, lifetime: lifetimeTicks });
    return;
  }
}

/** C++ cell.cpp:2161-2296 — check if the selected crate type would be redundant/invalid.
 *  Returns 'money' if the crate should fall back, or the original type if it's valid.
 *  C++ falls back to CRATE_MONEY when the powerup would have no effect. */
export function crateFallbackCheck(type: CrateType, unit: Entity, ctx: CrateContext, crate?: Crate): CrateType {
  // C++ cell.cpp:2264-2270: Force MCV when player lost all buildings
  const allPlayerStructures = ctx.structures.filter(s => ctx.isAllied(s.house, ctx.playerHouse));
  const alivePlayerStructures = allPlayerStructures.filter(s => s.alive);
  const hasMCV = ctx.entities.some(e => e.alive && e.house === unit.house && e.type === UnitType.V_MCV);
  if (alivePlayerStructures.length === 0 && allPlayerStructures.length > 0 && !hasMCV) {
    return 'unit'; // force_mcv
  }

  // C++ cell.cpp:2276-2280: Force money when player has ConYard but no refinery
  const hasConyard = alivePlayerStructures.some(s => s.type === 'FACT');
  const hasRefinery = alivePlayerStructures.some(s => s.type === 'PROC');
  if (hasConyard && !hasRefinery && ctx.credits < 2000 && type !== 'money') {
    return 'money';
  }

  switch (type) {
    case 'armor':
      if (unit.armorBias !== 1.0) return 'money';
      break;
    case 'speed':
      if (unit.speedBias !== 1.0 || unit.isAirUnit) return 'money';
      break;
    case 'firepower':
      if (unit.firepowerBias !== 1.0 || !unit.weapon) return 'money';
      break;
    case 'cloak':
      if (unit.isCloakable) return 'money';
      break;
    case 'reveal':
      // C++ cell.cpp:2186-2194: second reveal falls back to darkness
      if (ctx.visionaryHouses.has(unit.house)) return 'darkness';
      break;
    case 'unit': {
      const houseUnits = ctx.entities.filter(e => e.alive && e.house === unit.house && !e.stats.isInfantry).length;
      if (houseUnits > 50) return 'money';
      if (crate?.surface === 'water') return 'money';
      break;
    }
    case 'squad': {
      const houseInfantry = ctx.entities.filter(e => e.alive && e.house === unit.house && e.stats.isInfantry).length;
      if (houseInfantry > 100) return 'money';
      if (crate?.surface === 'water') return 'money';
      break;
    }
  }
  return type;
}

/** Apply crate bonus to the unit that picked it up */
export function pickupCrate(ctx: CrateContext, crate: Crate, unit: Entity): void {
  ctx.playSoundAt('crate_pickup', crate.x, crate.y);
  // C++ cell.cpp:2161-2296: fallback to money when selected type would be redundant
  const effectiveType = crateFallbackCheck(crate.type, unit, ctx, crate);
  // C++ cell.cpp:2319-2321: CrateAnims[powerup] — type-specific animation at pickup location
  // Falls back to generic piffpiff if no crate-specific animation defined (ANIM_NONE)
  const crateSprite = CRATE_ANIM_MAP[effectiveType];
  ctx.effects.push({
    type: 'explosion', x: crate.x, y: crate.y,
    frame: 0, maxFrames: 10, size: 8, sprite: crateSprite ?? 'piffpiff', spriteStart: 0,
  });
  switch (effectiveType) {
    case 'money': {
      // C++ cell.cpp:2335-2341: solo = SoloCrateMoney=2000, MP = Random_Pick(2000, 2900)
      const amount = ctx.isMultiplayer
        ? ScenarioRandom.nextInRange(2000, 2900)
        : 2000;
      ctx.addCredits(amount, true);
      ctx.evaMessages.push({ text: 'MONEY CRATE', tick: ctx.tick });
      break;
    }
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
      const uType = types[ScenarioRandom.nextInRange(0, types.length - 1)];
      const bonus = new Entity(uType, ctx.playerHouse, crate.x + CELL_SIZE, crate.y);
      bonus.mission = Mission.GUARD;
      ctx.entities.push(bonus);
      ctx.entityById.set(bonus.id, bonus);
      ctx.evaMessages.push({ text: 'REINFORCEMENTS', tick: ctx.tick });
      break;
    }
    case 'armor': {
      // CR2: C++ cell.cpp:2552-2561 — apply armor upgrade to ALL friendly units
      // within CrateRadius (~2.5 cells), not just the collector.
      // Always apply to the collector as well (may not be in ctx.entities).
      unit.armorBias = 2;
      const armorPos = { x: crate.x, y: crate.y };
      for (const e of ctx.entities) {
        if (!e.alive || e.id === unit.id) continue;
        if (!ctx.isAllied(e.house, ctx.playerHouse)) continue;
        if (worldDist(armorPos, e.pos) >= CRATE_RADIUS) continue;
        e.armorBias = 2;
      }
      ctx.evaMessages.push({ text: 'ARMOR UPGRADE', tick: ctx.tick });
      break;
    }
    case 'firepower': {
      // CR3: C++ cell.cpp:2580-2592 — apply firepower upgrade to ALL friendly units
      // within CrateRadius (~2.5 cells), not just the collector.
      // Always apply to the collector as well (may not be in ctx.entities).
      unit.firepowerBias = 2;
      const fpPos = { x: crate.x, y: crate.y };
      for (const e of ctx.entities) {
        if (!e.alive || e.id === unit.id) continue;
        if (!ctx.isAllied(e.house, ctx.playerHouse)) continue;
        if (worldDist(fpPos, e.pos) >= CRATE_RADIUS) continue;
        e.firepowerBias = 2;
      }
      ctx.evaMessages.push({ text: 'FIREPOWER UPGRADE', tick: ctx.tick });
      break;
    }
    case 'speed': {
      // CR7: C++ cell.cpp:2565-2577 — apply speed upgrade to ALL friendly ground units
      // within CrateRadius (~2.5 cells). Excludes aircraft (cell.cpp:2569).
      // C++ is multiplicative: SpeedBias *= fixed(CrateData[powerup], 256) ≈ 1.7
      // Always apply to the collector as well (may not be in ctx.entities).
      // C++ duration: TICKS_PER_MINUTE * 1.0 = 900 ticks (same formula as invulnerability)
      const speedDuration = 900;
      unit.speedBias *= 1.7;
      unit.speedTick = speedDuration;
      const speedPos = { x: crate.x, y: crate.y };
      for (const e of ctx.entities) {
        if (!e.alive || e.id === unit.id) continue;
        if (!ctx.isAllied(e.house, ctx.playerHouse)) continue;
        if (e.isAirUnit) continue; // C++ cell.cpp:2569: excludes RTTI_AIRCRAFT
        if (worldDist(speedPos, e.pos) >= CRATE_RADIUS) continue;
        e.speedBias *= 1.7;
        e.speedTick = speedDuration;
      }
      ctx.evaMessages.push({ text: 'SPEED UPGRADE', tick: ctx.tick });
      break;
    }
    case 'reveal':
      // CR4: Reveal entire map for the player's house (C++ IsVisionary equivalent)
      ctx.visionaryHouses.add(unit.house);
      ctx.map.revealAll();
      ctx.evaMessages.push({ text: 'MAP REVEALED', tick: ctx.tick });
      break;
    case 'darkness': {
      // C++ cell.cpp:2347-2351: Map.Shroud_The_Map() — shrouds ENTIRE map
      // Normal fog-of-war update will re-reveal around player units next tick.
      ctx.map.shroudAll();
      ctx.evaMessages.push({ text: 'DARKNESS', tick: ctx.tick });
      break;
    }
    case 'explosion': {
      // 200 HP damage to all units in 3-cell radius
      for (const e of ctx.entities) {
        if (!e.alive) continue;
        const d = worldDist(e.pos, { x: crate.x, y: crate.y });
        if (d <= 3) {
          ctx.damageEntity(e, 500, 'HE');
        }
      }
      ctx.effects.push({ type: 'explosion', x: crate.x, y: crate.y, frame: 0, maxFrames: EXPLOSION_FRAMES.atomsfx, size: 20, sprite: 'atomsfx', spriteStart: 0, blendMode: 'screen' });
      ctx.evaMessages.push({ text: 'BOOBY TRAP!', tick: ctx.tick });
      break;
    }
    case 'squad': {
      // C++ cell.cpp:2443-2457: spawn 5 infantry from weighted pool.
      // C++ pool: {E1x6, E2, E3, RENOVATOR} — 9 entries, E1 at 67% probability.
      // INFANTRY_RENOVATOR = engineer (E6 in TS).
      const infTypes = [
        UnitType.I_E1, UnitType.I_E1, UnitType.I_E1, UnitType.I_E1, UnitType.I_E1, UnitType.I_E1,
        UnitType.I_E2,
        UnitType.I_E3,
        UnitType.I_E6, // INFANTRY_RENOVATOR (engineer)
      ];
      for (let i = 0; i < 5; i++) {
        const t = infTypes[ScenarioRandom.nextInRange(0, infTypes.length - 1)];
        const ox = (ScenarioRandom.float() - 0.5) * CELL_SIZE * 2;
        const oy = (ScenarioRandom.float() - 0.5) * CELL_SIZE * 2;
        const inf = new Entity(t, ctx.playerHouse, crate.x + ox, crate.y + oy);
        inf.mission = Mission.GUARD;
        ctx.entities.push(inf);
        ctx.entityById.set(inf.id, inf);
      }
      ctx.evaMessages.push({ text: 'SQUAD REINFORCEMENT', tick: ctx.tick });
      break;
    }
    case 'heal_base': {
      // C++ cell.cpp:2529-2540: heal ALL allied objects (units + buildings) to FULL HP
      for (const e of ctx.entities) {
        if (e.alive && ctx.isAllied(e.house, ctx.playerHouse)) {
          e.hp = e.maxHp;
        }
      }
      for (const s of ctx.structures) {
        if (s.alive && ctx.isAllied(s.house, ctx.playerHouse)) {
          s.hp = s.maxHp;
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
            if (d <= 1) ctx.damageEntity(e, 600, 'Fire');
          }
        }
      }
      ctx.evaMessages.push({ text: 'NAPALM STRIKE', tick: ctx.tick });
      break;
    }
    case 'cloak': {
      // C++ cell.cpp:2516-2524: all LAYER_GROUND techno within CrateRadius get IsCloakable.
      // C++ does NOT filter by house — even enemy units get cloaked.
      for (const e of ctx.entities) {
        if (!e.alive) continue;
        if (worldDist({ x: crate.x, y: crate.y }, e.pos) >= CRATE_RADIUS) continue;
        e.isCloakable = true;
      }
      // Always cloak the collector too (may not be in ctx.entities)
      unit.isCloakable = true;
      ctx.evaMessages.push({ text: 'UNIT CLOAKED', tick: ctx.tick });
      break;
    }
    case 'invulnerability': {
      // C++ cell.cpp:2594-2603: all LAYER_GROUND techno within CrateRadius get IronCurtain.
      // Duration: TICKS_PER_MINUTE * 1.0 = 900 ticks = 60s at 15 Hz (C++ cell.cpp:2596)
      // C++ does NOT filter by house — even enemy units get invulnerability.
      const invulnDuration = 900;
      for (const e of ctx.entities) {
        if (!e.alive) continue;
        if (worldDist({ x: crate.x, y: crate.y }, e.pos) >= CRATE_RADIUS) continue;
        e.invulnTick = invulnDuration;
      }
      // Always apply to the collector too (may not be in ctx.entities)
      unit.invulnTick = invulnDuration;
      ctx.evaMessages.push({ text: 'INVULNERABILITY', tick: ctx.tick });
      break;
    }
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
        const target = enemyStructs[ScenarioRandom.nextInRange(0, enemyStructs.length - 1)];
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
        const dmg = ScenarioRandom.nextInRange(100, 300); // 100-300
        ctx.damageEntity(e, dmg, 'HE');
      }
      for (const s of ctx.structures) {
        if (!s.alive) continue;
        const dmg = ScenarioRandom.nextInRange(100, 300);
        ctx.damageStructure(s, dmg);
      }
      ctx.screenShake = Math.max(ctx.screenShake, 15);
      ctx.playSound('explode_lg');
      ctx.evaMessages.push({ text: 'TIME QUAKE', tick: ctx.tick });
      break;
    }
    case 'vortex': {
      // C++ cell.cpp:2608-2614: singleton — only spawn if no vortex already active.
      // C++ ChronalVortex.Is_Active() check prevents multiple vortices.
      if (ctx.activeVortices.length === 0) {
        ctx.activeVortices.push({
          x: crate.x, y: crate.y, angle: ScenarioRandom.float() * Math.PI * 2, ticksLeft: 450, id: ctx.tick,
        });
        ctx.playSound('teslazap');
        ctx.evaMessages.push({ text: 'VORTEX SPAWNED', tick: ctx.tick });
      }
      break;
    }
  }
}
