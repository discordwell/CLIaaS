/**
 * Superweapon subsystem — extracted from Game class (index.ts).
 * Handles charging, auto-fire (GPS/Sonar), AI superweapon usage,
 * activation of all 8 superweapon types, and nuke detonation.
 */

import {
  type WorldPos, CELL_SIZE,
  type House, UnitType, Mission,
  SuperweaponType, SUPERWEAPON_DEFS, type SuperweaponState,
  IRON_CURTAIN_DURATION, NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_FLIGHT_TICKS,
  NUKE_MIN_FALLOFF, CHRONO_SHIFT_VISUAL_TICKS, SONAR_REVEAL_TICKS,
  worldDist, worldToCell, type WarheadType,
  WEAPON_STATS,
} from './types';
import { Entity } from './entity';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { type Effect } from './renderer';
import { Terrain } from './map';

// ---------------------------------------------------------------------------
// Context interface — everything the superweapon functions need from Game
// ---------------------------------------------------------------------------

export interface SuperweaponContext {
  structures: MapStructure[];
  entities: Entity[];
  entityById: Map<number, Entity>;
  superweapons: Map<string, SuperweaponState>;
  effects: Effect[];
  tick: number;
  playerHouse: House;
  powerProduced: number;
  powerConsumed: number;
  killCount: number;
  lossCount: number;
  map: {
    revealAll(): void;
    isPassable(cx: number, cy: number): boolean;
    setVisibility(cx: number, cy: number, v: number): void;
    inBounds(cx: number, cy: number): boolean;
    setTerrain(cx: number, cy: number, terrain: Terrain): void;
    unjamRadius(cx: number, cy: number, radius: number): void;
  };
  sonarSpiedTarget: Map<House, House>;
  gapGeneratorCells: Map<number, { cx: number; cy: number; radius: number }>;

  // Nuke tracking state
  nukePendingTarget: WorldPos | null;
  nukePendingTick: number;
  nukePendingSource: WorldPos | null;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  isPlayerControlled(e: Entity): boolean;
  pushEva(text: string): void;
  playSound(name: string): void;
  playSoundAt(name: string, x: number, y: number): void;
  damageEntity(target: Entity, amount: number, warhead: string): boolean;
  damageStructure(s: MapStructure, damage: number): boolean;
  addEntity(e: Entity): void;
  aiIQ(house: House): number;
  getWarheadMult(warhead: string, armor: string): number;

  // Camera info for GPS sweep effect
  cameraX: number;
  cameraY: number;
  cameraViewWidth: number;

  // Renderer
  screenShake: number;
  screenFlash: number;
}

// ---------------------------------------------------------------------------
// 1. updateSuperweapons — scan structures, charge timers, auto-fire, AI usage
// ---------------------------------------------------------------------------

export function updateSuperweapons(ctx: SuperweaponContext): void {
  const isLowPower = ctx.powerConsumed > ctx.powerProduced && ctx.powerProduced > 0;
  const activeBuildings = new Set<string>(); // track which sw keys have active buildings

  // Scan structures for superweapon buildings
  for (let i = 0; i < ctx.structures.length; i++) {
    const s = ctx.structures[i];
    if (!s.alive || (s.buildProgress !== undefined && s.buildProgress < 1)) continue;

    // Check each superweapon def to see if this structure provides it
    for (const def of Object.values(SUPERWEAPON_DEFS)) {
      if (s.type !== def.building) continue;

      const key = `${s.house}:${def.type}`;
      activeBuildings.add(key);

      let state = ctx.superweapons.get(key);
      if (!state) {
        state = {
          type: def.type,
          house: s.house,
          chargeTick: 0,
          ready: false,
          structureIndex: i,
          fired: false,
        };
        ctx.superweapons.set(key, state);
      }
      state.structureIndex = i;

      // Charge: increment if building is alive and powered
      if (!state.ready && !state.fired) {
        const chargeRate = (def.requiresPower && isLowPower &&
          ctx.isAllied(s.house, ctx.playerHouse)) ? 0.25 : 1;
        state.chargeTick = Math.min(state.chargeTick + chargeRate, def.rechargeTicks);
        if (state.chargeTick >= def.rechargeTicks) {
          state.ready = true;
          // EVA announcement for player
          if (ctx.isAllied(s.house, ctx.playerHouse)) {
            ctx.pushEva(`${def.name} ready`);
          }
        }
      }

      // Auto-fire GPS Satellite (one-shot)
      if (def.type === SuperweaponType.GPS_SATELLITE && state.ready && !state.fired) {
        ctx.map.revealAll();
        state.fired = true;
        state.ready = false;
        if (ctx.isAllied(s.house, ctx.playerHouse)) {
          ctx.pushEva('GPS satellite launched');
          // GPS sweep visual
          ctx.effects.push({
            type: 'marker', x: ctx.cameraX + ctx.cameraViewWidth / 2,
            y: ctx.cameraY, frame: 0, maxFrames: 60, size: 2,
            markerColor: 'rgba(80,200,255,0.3)',
          });
        }
      }

      // Auto-fire Sonar Pulse
      if (def.type === SuperweaponType.SONAR_PULSE && state.ready) {
        // Reveal all enemy submarines for 450 ticks
        for (const e of ctx.entities) {
          if (!e.alive || !e.stats.isCloakable) continue;
          if (ctx.isAllied(e.house, s.house)) continue;
          e.sonarPulseTimer = SONAR_REVEAL_TICKS;
        }
        state.ready = false;
        state.chargeTick = 0;
        // AU5: Sonar SFX — play sonar ping sound
        ctx.playSound('cannon'); // sonar ping approximation
        if (ctx.isAllied(s.house, ctx.playerHouse)) {
          ctx.pushEva('Sonar pulse activated');
        }
      }
    }
  }

  // Spy-granted sonar pulse: charge, auto-fire, and maintenance (C++ house.cpp:1605-1627)
  for (const [key, state] of ctx.superweapons) {
    if (state.type !== SuperweaponType.SONAR_PULSE) continue;
    // Maintenance: check if spied enemy SPEN still exists (C++ house.cpp:1611-1625)
    const spyHouse = state.house as House;
    const targetHouse = ctx.sonarSpiedTarget.get(spyHouse);
    if (targetHouse !== undefined) {
      const enemySpenAlive = ctx.structures.some(s =>
        s.alive && s.house === targetHouse && s.type === 'SPEN'
      );
      if (!enemySpenAlive) {
        ctx.superweapons.delete(key);
        ctx.sonarSpiedTarget.delete(spyHouse);
        if (ctx.isAllied(spyHouse, ctx.playerHouse)) {
          ctx.pushEva('Sonar pulse lost');
        }
        continue;
      }
    }
    activeBuildings.add(key); // prevent cleanup from deleting spy-granted sonar
    if (!state.ready && !state.fired) {
      const chargeRate = (isLowPower && ctx.isAllied(state.house as House, ctx.playerHouse)) ? 0.25 : 1;
      state.chargeTick = Math.min(state.chargeTick + chargeRate, SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks);
      if (state.chargeTick >= SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks) {
        state.ready = true;
        if (ctx.isAllied(state.house as House, ctx.playerHouse)) {
          ctx.pushEva('Sonar pulse ready');
        }
      }
    }
    if (state.ready) {
      for (const e of ctx.entities) {
        if (!e.alive || !e.stats.isCloakable) continue;
        if (ctx.isAllied(e.house, state.house as House)) continue;
        e.sonarPulseTimer = SONAR_REVEAL_TICKS;
      }
      state.ready = false;
      state.chargeTick = 0;
      ctx.playSound('cannon');
      if (ctx.isAllied(state.house as House, ctx.playerHouse)) {
        ctx.pushEva('Sonar pulse activated');
      }
    }
  }

  // Remove entries for destroyed buildings (spy-granted sonar exempted above)
  for (const [key] of ctx.superweapons) {
    if (!activeBuildings.has(key)) {
      ctx.superweapons.delete(key);
    }
  }

  // AI superweapon usage — C++ parity: IQ >= 3 houses fire superweapons automatically
  for (const [, state] of ctx.superweapons) {
    if (!state.ready) continue;
    if (ctx.isAllied(state.house as House, ctx.playerHouse)) continue;
    const def = SUPERWEAPON_DEFS[state.type];
    if (!def.needsTarget) continue; // GPS/Sonar auto-fire handled above

    // IQ gate: AI must have IQ >= 3 to use superweapons
    const iq = ctx.aiIQ(state.house as House);
    if (iq < 3) continue;

    if (state.type === SuperweaponType.NUKE) {
      // AI nuke: target player's highest-value structure cluster
      const target = findBestNukeTarget(ctx, state.house);
      if (target) {
        activateSuperweapon(ctx, SuperweaponType.NUKE, state.house, target);
      }
    } else if (state.type === SuperweaponType.IRON_CURTAIN) {
      // AI Iron Curtain: prefer attacking units, fall back to most expensive unit
      let bestUnit: Entity | null = null;
      let bestScore = 0;
      for (const e of ctx.entities) {
        if (!e.alive || e.house !== state.house || e.stats.isInfantry) continue;
        // Prefer units currently attacking or hunting — they benefit most from invulnerability
        const missionBonus = (e.mission === Mission.ATTACK || e.mission === Mission.HUNT) ? 2 : 1;
        const value = (e.stats.cost ?? e.stats.strength) * missionBonus;
        if (value > bestScore) {
          bestScore = value;
          bestUnit = e;
        }
      }
      if (bestUnit) {
        activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, state.house, bestUnit.pos);
      }
    } else if (state.type === SuperweaponType.CHRONOSPHERE) {
      // AI Chronosphere: teleport best tank near enemy base (IQ >= 3)
      if (iq >= 3) {
        let bestTank: Entity | null = null;
        let bestValue = 0;
        for (const e of ctx.entities) {
          if (!e.alive || e.house !== state.house) continue;
          if (e.stats.isInfantry || e.stats.isAircraft || e.stats.isVessel) continue;
          if (e.type === UnitType.V_HARV || e.type === UnitType.V_MCV || e.type === UnitType.V_CTNK) continue;
          const val = e.stats.cost ?? e.stats.strength;
          if (val > bestValue) { bestValue = val; bestTank = e; }
        }
        if (bestTank) {
          // Find enemy base structure to teleport near
          let targetPos: WorldPos | null = null;
          for (const s of ctx.structures) {
            if (!s.alive || ctx.isAllied(s.house, state.house as House)) continue;
            if (s.type === 'FACT' || s.type === 'WEAP' || s.type === 'PROC') {
              const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
              targetPos = {
                x: (s.cx + w / 2) * CELL_SIZE,
                y: (s.cy + h / 2 + 2) * CELL_SIZE, // 2 cells below structure
              };
              break;
            }
          }
          if (targetPos) {
            // Mark the tank as "selected" temporarily so activateSuperweapon can find it
            bestTank.selected = true;
            activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, state.house as House, targetPos);
            bestTank.selected = false;
          }
        }
      }
    } else if (state.type === SuperweaponType.PARABOMB) {
      // AI Parabomb: target player's largest unit cluster
      const target = findBestNukeTarget(ctx, state.house);
      if (target) {
        activateSuperweapon(ctx, SuperweaponType.PARABOMB, state.house, target);
      }
    } else if (state.type === SuperweaponType.PARAINFANTRY) {
      // AI Paratroopers: drop near own base as reinforcements
      const aiStructs = ctx.structures.filter(s => s.alive && s.house === state.house);
      if (aiStructs.length > 0) {
        const base = aiStructs[0];
        const tx = base.cx * CELL_SIZE + CELL_SIZE * 3;
        const ty = base.cy * CELL_SIZE + CELL_SIZE * 3;
        activateSuperweapon(ctx, SuperweaponType.PARAINFANTRY, state.house, { x: tx, y: ty });
      }
    } else if (state.type === SuperweaponType.SPY_PLANE) {
      // AI Spy Plane: reveal area around enemy base
      for (const s of ctx.structures) {
        if (!s.alive || ctx.isAllied(s.house, state.house as House)) continue;
        const [w, h] = STRUCTURE_SIZE[s.type] ?? [1, 1];
        const target = {
          x: (s.cx + w / 2) * CELL_SIZE,
          y: (s.cy + h / 2) * CELL_SIZE,
        };
        activateSuperweapon(ctx, SuperweaponType.SPY_PLANE, state.house as House, target);
        break; // one target is enough
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. activateSuperweapon — activate a superweapon at a target position
// ---------------------------------------------------------------------------

export function activateSuperweapon(
  ctx: SuperweaponContext,
  type: SuperweaponType,
  house: House,
  target: WorldPos,
): void {
  const key = `${house}:${type}`;
  const state = ctx.superweapons.get(key);
  if (!state || !state.ready) return;

  const def = SUPERWEAPON_DEFS[type];
  state.ready = false;
  state.chargeTick = 0;

  switch (type) {
    case SuperweaponType.CHRONOSPHERE: {
      // Teleport first selected player unit to target (C++: CTNK excluded — has own teleport)
      const selected = ctx.entities.filter(e =>
        e.alive && e.selected && e.house === house && !e.stats.isInfantry
        && e.type !== UnitType.V_CTNK
      );
      const unit = selected[0];
      if (unit) {
        const origin = { x: unit.pos.x, y: unit.pos.y };
        unit.pos.x = target.x;
        unit.pos.y = target.y;
        unit.prevPos.x = target.x;
        unit.prevPos.y = target.y;
        unit.chronoShiftTick = CHRONO_SHIFT_VISUAL_TICKS;
        // Blue flash effects at origin and destination
        ctx.effects.push({
          type: 'explosion', x: origin.x, y: origin.y,
          frame: 0, maxFrames: 20, size: 24,
          sprite: 'litning', spriteStart: 0,
        });
        ctx.effects.push({
          type: 'explosion', x: target.x, y: target.y,
          frame: 0, maxFrames: 20, size: 24,
          sprite: 'litning', spriteStart: 0,
        });
        ctx.playSound('chrono');
        if (ctx.isAllied(house, ctx.playerHouse)) {
          ctx.pushEva('Chronosphere activated');
        }
      }
      break;
    }
    case SuperweaponType.IRON_CURTAIN: {
      // Find unit or structure nearest to target
      let bestEntity: Entity | null = null;
      let bestDist = Infinity;
      for (const e of ctx.entities) {
        if (!e.alive || !ctx.isAllied(e.house, house)) continue;
        const d = worldDist(e.pos, target);
        if (d < bestDist && d < 3) {
          bestDist = d;
          bestEntity = e;
        }
      }
      if (bestEntity) {
        bestEntity.ironCurtainTick = IRON_CURTAIN_DURATION;
        ctx.effects.push({
          type: 'explosion', x: bestEntity.pos.x, y: bestEntity.pos.y,
          frame: 0, maxFrames: 15, size: 20,
        });
        ctx.playSound('iron_curtain');
        if (ctx.isAllied(house, ctx.playerHouse)) {
          ctx.pushEva('Iron Curtain activated');
        }
      }
      break;
    }
    case SuperweaponType.NUKE: {
      // Launch missile from MSLO — arrives after 45 ticks
      const s = ctx.structures[state.structureIndex];
      if (s) {
        ctx.nukePendingTarget = { x: target.x, y: target.y };
        ctx.nukePendingTick = NUKE_FLIGHT_TICKS;
        ctx.nukePendingSource = { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
        // Rising missile effect from silo
        ctx.effects.push({
          type: 'projectile',
          x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE,
          startX: s.cx * CELL_SIZE + CELL_SIZE, startY: s.cy * CELL_SIZE + CELL_SIZE,
          endX: target.x, endY: target.y,
          frame: 0, maxFrames: 45, size: 4,
          projStyle: 'rocket',
        });
        ctx.playSound('nuke_launch');
        if (ctx.isAllied(house, ctx.playerHouse)) {
          ctx.pushEva('Nuclear warhead launched');
        } else {
          // Warn player when enemy launches nuke
          ctx.pushEva('Warning: nuclear launch detected');
        }
      }
      break;
    }
    case SuperweaponType.PARABOMB: {
      // SW6: Parabomb — Badger bomber drops bombs in a line (C++ RULES.INI ParaBomb weapon)
      const pbDmg = WEAPON_STATS.ParaBomb.damage;
      const bombCount = 7;
      const spacing = CELL_SIZE;
      for (let i = -Math.floor(bombCount / 2); i <= Math.floor(bombCount / 2); i++) {
        const bx = target.x + i * spacing;
        const by = target.y;
        const delay = (i + Math.floor(bombCount / 2)) * 5; // staggered detonation
        // Deferred bomb explosion — uses timed effects
        ctx.effects.push({
          type: 'explosion', x: bx, y: by,
          frame: -delay, maxFrames: 17 + delay, size: 14,
        });
        // Damage entities at each bomb point after delay (approximate via immediate splash)
        for (const e of ctx.entities) {
          if (!e.alive) continue;
          const d = worldDist(e.pos, { x: bx, y: by });
          if (d <= 1.5) {
            const falloff = Math.max(0.3, 1 - d / 1.5);
            ctx.damageEntity(e, Math.round(pbDmg * falloff), 'HE');
          }
        }
        for (const st of ctx.structures) {
          if (!st.alive) continue;
          const [sw, sh] = STRUCTURE_SIZE[st.type] ?? [2, 2];
          const sx = st.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
          const sy = st.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
          const d = worldDist({ x: bx, y: by }, { x: sx, y: sy });
          if (d <= 1.5) ctx.damageStructure(st, Math.round(pbDmg * Math.max(0.3, 1 - d / 1.5)));
        }
      }
      ctx.screenShake = Math.max(ctx.screenShake, 10);
      ctx.playSound('explode_lg');
      if (ctx.isAllied(house, ctx.playerHouse)) {
        ctx.pushEva('Parabombs away');
      }
      break;
    }
    case SuperweaponType.PARAINFANTRY: {
      // SW6: Paratroopers — drop 5 rifle infantry at target location
      const paraTypes = [
        UnitType.I_E1, UnitType.I_E1, UnitType.I_E1,
        UnitType.I_E1, UnitType.I_E1,
      ];
      for (let i = 0; i < paraTypes.length; i++) {
        const px = target.x + ((i % 3) - 1) * CELL_SIZE;
        const py = target.y + Math.floor(i / 3) * CELL_SIZE;
        const pc = worldToCell(px, py);
        if (!ctx.map.isPassable(pc.cx, pc.cy)) continue;
        const inf = new Entity(paraTypes[i], house, px, py);
        inf.mission = Mission.GUARD;
        ctx.addEntity(inf);
        ctx.entityById.set(inf.id, inf);
        // Parachute drop visual
        ctx.effects.push({
          type: 'marker', x: px, y: py,
          frame: 0, maxFrames: 20, size: 14, markerColor: 'rgba(200,200,255,0.8)',
        });
      }
      ctx.playSound('eva_reinforcements');
      if (ctx.isAllied(house, ctx.playerHouse)) {
        ctx.pushEva('Reinforcements have arrived');
      }
      break;
    }
    case SuperweaponType.SPY_PLANE: {
      // SW6: Spy Plane — permanently reveals 10-cell radius around target (matches C++ fog behavior)
      const revealRadius = 10;
      const tc = worldToCell(target.x, target.y);
      const r2 = revealRadius * revealRadius;
      for (let dy = -revealRadius; dy <= revealRadius; dy++) {
        for (let dx = -revealRadius; dx <= revealRadius; dx++) {
          if (dx * dx + dy * dy <= r2) {
            ctx.map.setVisibility(tc.cx + dx, tc.cy + dy, 2);
          }
        }
      }
      // Visual flyover effect — marker sweeps across reveal zone
      ctx.effects.push({
        type: 'marker', x: target.x, y: target.y,
        frame: 0, maxFrames: 30, size: 20, markerColor: 'rgba(100,200,255,0.5)',
      });
      ctx.playSound('eva_acknowledged');
      if (ctx.isAllied(house, ctx.playerHouse)) {
        ctx.pushEva('Spy plane mission complete');
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// 3. detonateNuke — nuke detonation with blast damage, effects, scorched earth
// ---------------------------------------------------------------------------

export function detonateNuke(ctx: SuperweaponContext, target: WorldPos): void {
  // AU5: Nuke detonation SFX
  ctx.playSound('nuke_explode');
  // Intense screen flash + extended shake (C++ nuke visual impact)
  ctx.screenFlash = 30;
  ctx.screenShake = 30;

  // Apply nuke damage in blast radius using Super warhead
  const blastRadius = CELL_SIZE * NUKE_BLAST_CELLS;

  // Damage entities in splash radius
  for (const e of ctx.entities) {
    if (!e.alive) continue;
    const dist = worldDist(e.pos, target);
    if (dist > blastRadius) continue;
    const falloff = Math.max(NUKE_MIN_FALLOFF, 1 - dist / blastRadius);
    const mult = ctx.getWarheadMult('Super', e.stats.armor);
    const dmg = Math.max(1, Math.round(NUKE_DAMAGE * mult * falloff));
    const killed = ctx.damageEntity(e, dmg, 'Super');
    if (killed) {
      if (e.isPlayerUnit) ctx.lossCount++;
      else ctx.killCount++;
    }
  }

  // Damage structures in blast radius
  for (const s of ctx.structures) {
    if (!s.alive) continue;
    const sx = s.cx * CELL_SIZE + CELL_SIZE;
    const sy = s.cy * CELL_SIZE + CELL_SIZE;
    const dist = worldDist({ x: sx, y: sy }, target);
    if (dist > blastRadius) continue;
    const falloff = Math.max(NUKE_MIN_FALLOFF, 1 - dist / blastRadius);
    const dmg = Math.max(1, Math.round(NUKE_DAMAGE * falloff));
    ctx.damageStructure(s, dmg);
  }

  // Mushroom cloud effect (large, long-lasting)
  ctx.effects.push({
    type: 'explosion', x: target.x, y: target.y,
    frame: 0, maxFrames: 45, size: 48,
    sprite: 'atomsfx', spriteStart: 0,
    blendMode: 'screen',
  });

  // Secondary ground explosions — ring of staggered blasts around impact (C++ large explosion radius)
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
    const dist = CELL_SIZE * (1.5 + Math.random() * 2);
    const gx = target.x + Math.cos(angle) * dist;
    const gy = target.y + Math.sin(angle) * dist;
    ctx.effects.push({
      type: 'explosion', x: gx, y: gy,
      frame: -i * 3, maxFrames: 20, size: 16,
      sprite: 'fball1', spriteStart: 0,
    });
  }

  // Scorched earth at ground zero
  const tc = worldToCell(target.x, target.y);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy > 9) continue;
      const cx = tc.cx + dx;
      const cy = tc.cy + dy;
      if (ctx.map.inBounds(cx, cy)) {
        ctx.map.setTerrain(cx, cy, Terrain.ROCK);
      }
    }
  }

  ctx.playSound('nuke_explode');
}

// ---------------------------------------------------------------------------
// 4. findBestNukeTarget — find best AI nuke target (structure cluster scoring)
// ---------------------------------------------------------------------------

export function findBestNukeTarget(ctx: SuperweaponContext, aiHouse: House): WorldPos | null {
  let bestScore = 0;
  let bestPos: WorldPos | null = null;

  for (const s of ctx.structures) {
    if (!s.alive) continue;
    if (ctx.isAllied(s.house, aiHouse)) continue;
    // Count nearby structures within 5 cells
    let score = 0;
    const sx = s.cx * CELL_SIZE + CELL_SIZE;
    const sy = s.cy * CELL_SIZE + CELL_SIZE;
    for (const other of ctx.structures) {
      if (!other.alive) continue;
      if (ctx.isAllied(other.house, aiHouse)) continue;
      const ox = other.cx * CELL_SIZE + CELL_SIZE;
      const oy = other.cy * CELL_SIZE + CELL_SIZE;
      const dist = worldDist({ x: sx, y: sy }, { x: ox, y: oy });
      if (dist < 5) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPos = { x: sx, y: sy };
    }
  }
  return bestPos;
}
