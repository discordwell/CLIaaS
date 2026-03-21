/**
 * Agent Harness — pause-step interface for Claude Code to play the game via MCP browser tools.
 *
 * Installs window.__agentState(), window.__agentCommand(), window.__agentStep()
 * for programmatic turn-based control of the real-time engine.
 */

import { type Game } from './index';
import { type Entity } from './entity';
import { House, Mission, CELL_SIZE, worldToCell, worldDist, type ProductionItem, SUPERWEAPON_DEFS, getStripSide } from './types';
import { findPath } from './pathfinding';
import { STRUCTURE_SIZE, type MapStructure } from './scenario';
import { getEffectiveCost } from './production';
import { powerMultiplier } from './repairSell';

// === Serialized state types ===

export interface AgentUnit {
  id: number;
  t: string;      // unit type code
  h: string;      // house
  cx: number;      // cell x
  cy: number;      // cell y
  hp: number;
  mhp: number;     // max hp
  m: string;       // mission
  tid?: number;    // target entity ID
  mtx?: number;    // move target cell x
  mty?: number;    // move target cell y
  ally: boolean;   // player-controlled
  cargo?: number;  // loaded passenger count for transports
  cargoTop?: string; // first passenger type, if any
  wpn?: string;    // weapon name
  rng?: number;    // weapon range
  // Combat readiness
  ammo?: number;   // current ammo (-1 = unlimited, omitted if unlimited)
  mammo?: number;  // max ammo (omitted if unlimited)
  acd?: number;    // attack cooldown ticks remaining (omitted if 0)
  wpn2?: string;   // secondary weapon name
  rng2?: number;   // secondary weapon range
  dmg?: number;    // primary weapon base damage
  wh?: string;     // primary weapon warhead type
}

export interface AgentStructure {
  idx: number;
  t: string;      // structure type
  h: string;      // house
  cx: number;
  cy: number;
  hp: number;
  mhp: number;
  ally: boolean;
  rep?: boolean;  // repairing
}

export interface AgentQueueItem {
  t: string;       // item type
  name: string;    // display name
  prog: number;    // 0-1 progress
  q: number;       // queue count
  cost: number;    // effective cost (with country bonus)
  paid: number;    // cost paid so far (incremental deduction)
}

/** Available production item summary */
export interface AgentAvailableItem {
  t: string;       // item type
  name: string;    // display name
  cost: number;    // effective cost (with country bonus)
  time: number;    // build time in ticks
  side: string;    // 'left' (structures) or 'right' (units)
  isStruct: boolean; // is structure
}

/** Superweapon status summary */
export interface AgentSuperweapon {
  type: string;    // SuperweaponType enum value
  name: string;    // display name
  charge: number;  // 0-1 charge progress
  ready: boolean;  // fully charged and activatable
  fired: boolean;  // one-shot already used (GPS)
  needsTarget: boolean; // requires player to select target
}

export interface AgentState {
  tick: number;
  state: string;
  playerHouse: string;
  alliedHouses: string[];
  credits: number;
  power: { produced: number; consumed: number; multiplier: number };
  siloCapacity: number;
  units: AgentUnit[];
  enemies: AgentUnit[];
  structures: AgentStructure[];
  production: AgentQueueItem[];
  pending?: string;
  available: string[];
  availableItems: AgentAvailableItem[];
  superweapons: AgentSuperweapon[];
  mapBounds: { x: number; y: number; w: number; h: number };
  killCount: number;
  lossCount: number;
  // Debug fields for trigger/timer diagnostics
  missionTimer: number;
  missionTimerExpired: boolean;
  allowWin: boolean;
  globals: number[];
  unitsLeftMap: number;
  civiliansEvacuated: number;
  triggers: { name: string; fired: boolean; house: number; e1: number; e1d: number; a1: number; a1d: number }[];
}

export type AgentCommand =
  | { cmd: 'move'; unitIds: number[]; cx: number; cy: number }
  | { cmd: 'attack'; unitIds: number[]; targetId: number }
  | { cmd: 'attack_move'; unitIds: number[]; cx: number; cy: number }
  | { cmd: 'attack_struct'; unitIds: number[]; structIdx: number }
  | { cmd: 'stop'; unitIds: number[] }
  | { cmd: 'enter'; unitId: number; transportId: number }
  | { cmd: 'build'; type: string }
  | { cmd: 'cancel_build'; category: 'left' | 'right' }
  | { cmd: 'place'; cx: number; cy: number }
  | { cmd: 'sell'; structIdx: number }
  | { cmd: 'repair'; structIdx: number }
  | { cmd: 'deploy'; unitId: number }
  ;

export interface CommandResult {
  cmd: string;
  ok: boolean;
  error?: string;
}

export interface StepResult {
  results: CommandResult[];
  state: AgentState;
}

// === State serializer ===

function serializeEntity(e: Entity, isAlly: boolean): AgentUnit {
  const cell = worldToCell(e.pos.x, e.pos.y);
  const u: AgentUnit = {
    id: e.id,
    t: e.type,
    h: e.house,
    cx: cell.cx,
    cy: cell.cy,
    hp: e.hp,
    mhp: e.maxHp,
    m: e.mission,
    ally: isAlly,
  };
  if (e.target?.alive) u.tid = e.target.id;
  if (e.moveTarget) {
    const mc = worldToCell(e.moveTarget.x, e.moveTarget.y);
    u.mtx = mc.cx;
    u.mty = mc.cy;
  }
  if (e.isTransport) {
    u.cargo = e.passengers.length;
    if (e.passengers.length > 0) {
      u.cargoTop = e.passengers[e.passengers.length - 1].type;
    }
  }
  if (e.weapon) {
    u.wpn = e.weapon.name;
    u.rng = e.weapon.range;
    u.dmg = e.weapon.damage;
    u.wh = e.weapon.warhead;
  }
  if (e.weapon2) {
    u.wpn2 = e.weapon2.name;
    u.rng2 = e.weapon2.range;
  }
  if (e.maxAmmo > 0) {
    u.ammo = e.ammo;
    u.mammo = e.maxAmmo;
  }
  if (e.attackCooldown > 0) {
    u.acd = e.attackCooldown;
  }
  return u;
}

function serializeStructure(s: MapStructure, idx: number, isAlly: boolean, repairing: boolean): AgentStructure {
  const [width, height] = STRUCTURE_SIZE[s.type] ?? [1, 1];
  const st: AgentStructure = {
    idx,
    t: s.type,
    h: s.house,
    // Match the WASM harness, which reports Coord_Cell(Center_Coord()).
    cx: s.cx + Math.floor((width - 1) / 2),
    cy: s.cy + Math.floor((height - 1) / 2),
    hp: s.hp,
    mhp: s.maxHp,
    ally: isAlly,
  };
  if (repairing) st.rep = true;
  return st;
}

export function serializeState(game: Game): AgentState {
  const units: AgentUnit[] = [];
  const enemies: AgentUnit[] = [];
  const isAlliedFn = (game as unknown as {
    isAllied?: (house: House, playerHouse: House) => boolean;
  }).isAllied;
  const isAlliedHouse = (house: House) => (
    typeof isAlliedFn === 'function'
      ? isAlliedFn.call(game, house, game.playerHouse)
      : house === game.playerHouse
  );
  const alliedHouses = Object.values(House).filter((house) => {
    return isAlliedHouse(house);
  });

  for (const e of game.entities) {
    if (!e.alive) continue;
    if (e.isPlayerUnit) {
      units.push(serializeEntity(e, true));
    } else {
      enemies.push(serializeEntity(e, false));
    }
  }

  const structures: AgentStructure[] = [];
  for (let i = 0; i < game.structures.length; i++) {
    const s = game.structures[i];
    if (!s.alive) continue;
    const isAlly = isAlliedHouse(s.house);
    const reportAsAlly = isAlly || s.house === House.Neutral;
    structures.push(serializeStructure(s, i, reportAsAlly, game.isStructureRepairing(i)));
  }

  const production: AgentQueueItem[] = [];
  for (const [, entry] of game.productionQueue) {
    production.push({
      t: entry.item.type,
      name: entry.item.name,
      prog: entry.item.buildTime > 0 ? entry.progress / entry.item.buildTime : 1,
      q: entry.queueCount,
      cost: getEffectiveCost(entry.item, game.playerHouse),
      paid: entry.costPaid,
    });
  }

  const availableRaw = game.getAvailableItems();
  const available = availableRaw.map(i => i.type);
  const availableItems: AgentAvailableItem[] = availableRaw.map(i => ({
    t: i.type,
    name: i.name,
    cost: getEffectiveCost(i, game.playerHouse),
    time: i.buildTime,
    side: getStripSide(i),
    isStruct: !!i.isStructure,
  }));

  // Superweapon status for player-allied houses
  const superweapons: AgentSuperweapon[] = [];
  for (const [, swState] of game.superweapons) {
    if (!isAlliedHouse(swState.house)) continue;
    const def = SUPERWEAPON_DEFS[swState.type];
    if (!def) continue;
    // Skip GPS after fired (one-shot)
    if (swState.fired && swState.type === 'GPS_SATELLITE') continue;
    superweapons.push({
      type: swState.type,
      name: def.name,
      charge: def.rechargeTicks > 0 ? Math.min(1, swState.chargeTick / def.rechargeTicks) : 1,
      ready: swState.ready,
      fired: swState.fired,
      needsTarget: def.needsTarget,
    });
  }

  const pwrMult = powerMultiplier(game.powerProduced, game.powerConsumed);

  return {
    tick: game.tick,
    state: game.state,
    playerHouse: game.playerHouse,
    alliedHouses,
    credits: game.credits,
    power: { produced: game.powerProduced, consumed: game.powerConsumed, multiplier: pwrMult },
    siloCapacity: game.siloCapacity,
    units,
    enemies,
    structures,
    production,
    pending: game.pendingPlacement?.type,
    available,
    availableItems,
    superweapons,
    mapBounds: {
      x: game.map.boundsX,
      y: game.map.boundsY,
      w: game.map.boundsW,
      h: game.map.boundsH,
    },
    killCount: game.killCount,
    lossCount: game.lossCount,
    // Debug fields for trigger/timer diagnostics (safe access for test mocks)
    missionTimer: ((game as unknown as Record<string, unknown>).missionTimer as number) ?? 0,
    missionTimerExpired: ((game as unknown as Record<string, unknown>).missionTimerExpired as boolean) ?? false,
    allowWin: ((game as unknown as Record<string, unknown>).allowWin as number) <= 0,
    globals: [...((game as unknown as Record<string, unknown>).globals as Set<number> ?? [])],
    unitsLeftMap: ((game as unknown as Record<string, unknown>).unitsLeftMap as number) ?? 0,
    civiliansEvacuated: ((game as unknown as Record<string, unknown>).civiliansEvacuated as number) ?? 0,
    triggers: (((game as unknown as Record<string, unknown>).triggers as Array<{ name: string; fired: boolean; house: number; event1: { type: number; data: number }; action1: { action: number; data: number } }>) ?? []).map(t => ({
      name: t.name, fired: t.fired, house: t.house,
      e1: t.event1.type, e1d: t.event1.data,
      a1: t.action1.action, a1d: t.action1.data,
    })),
  };
}

// === Command processor ===

/** Clear team mission scripts so agent commands aren't overridden (mirrors player click handler) */
function clearTeamScripts(e: Entity): void {
  e.teamMissions = [];
  e.teamMissionIndex = 0;
  e.guardOrigin = null;
}

export function processCommands(game: Game, commands: AgentCommand[]): CommandResult[] {
  const results: CommandResult[] = [];

  for (const c of commands) {
    try {
      switch (c.cmd) {
        case 'move': {
          const errs: string[] = [];
          for (const id of c.unitIds) {
            const e = game.entityById.get(id);
            if (!e?.alive || !e.isPlayerUnit) { errs.push(`unit ${id} invalid`); continue; }

            const destX = c.cx * CELL_SIZE + CELL_SIZE / 2;
            const destY = c.cy * CELL_SIZE + CELL_SIZE / 2;

            // Skip path reset if already moving to the same destination —
            // resending a move to the same cell restarts pathfinding from
            // waypoint 0 which causes visible stutter-stepping.
            if (e.moveTarget && e.moveTarget.x === destX && e.moveTarget.y === destY
                && e.mission === Mission.MOVE && e.path && e.path.length > 0) {
              continue;
            }

            clearTeamScripts(e);
            e.mission = Mission.MOVE;
            e.target = null;
            e.moveTarget = { x: destX, y: destY };
            if (e.stats.isAircraft) {
              // Aircraft fly directly — no ground pathfinding needed
              e.path = [{ cx: c.cx, cy: c.cy }];
              e.pathIndex = 0;
            } else {
              e.path = findPath(game.map, e.cell, { cx: c.cx, cy: c.cy }, true, e.isNavalUnit, e.stats.speedClass);
              e.pathIndex = 0;
            }
          }
          results.push({ cmd: 'move', ok: errs.length === 0, error: errs.length ? errs.join('; ') : undefined });
          break;
        }

        case 'attack': {
          const target = game.entityById.get(c.targetId);
          if (!target?.alive) {
            results.push({ cmd: 'attack', ok: false, error: `target ${c.targetId} not alive` });
            break;
          }
          if (target.isPlayerUnit) {
            results.push({ cmd: 'attack', ok: false, error: 'cannot attack allied unit' });
            break;
          }
          const errs: string[] = [];
          for (const id of c.unitIds) {
            const e = game.entityById.get(id);
            if (!e?.alive || !e.isPlayerUnit) { errs.push(`unit ${id} invalid`); continue; }
            // Skip if already attacking the same target
            if (e.mission === Mission.ATTACK && e.target === target && e.path && e.path.length > 0) {
              continue;
            }
            clearTeamScripts(e);
            e.mission = Mission.ATTACK;
            e.target = target;
            e.moveTarget = null;
            // Pathfind toward target position
            const tc = worldToCell(target.pos.x, target.pos.y);
            e.path = findPath(game.map, e.cell, tc, true, e.isNavalUnit, e.stats.speedClass);
            e.pathIndex = 0;
          }
          results.push({ cmd: 'attack', ok: errs.length === 0, error: errs.length ? errs.join('; ') : undefined });
          break;
        }

        case 'attack_move': {
          const errs: string[] = [];
          for (const id of c.unitIds) {
            const e = game.entityById.get(id);
            if (!e?.alive || !e.isPlayerUnit) { errs.push(`unit ${id} invalid`); continue; }
            const destX = c.cx * CELL_SIZE + CELL_SIZE / 2;
            const destY = c.cy * CELL_SIZE + CELL_SIZE / 2;
            // Skip if already attack-moving to the same destination
            if (e.moveTarget && e.moveTarget.x === destX && e.moveTarget.y === destY
                && e.mission === Mission.HUNT && e.path && e.path.length > 0) {
              continue;
            }
            clearTeamScripts(e);
            e.mission = Mission.HUNT;
            e.target = null;
            e.moveTarget = { x: destX, y: destY };
            e.path = findPath(game.map, e.cell, { cx: c.cx, cy: c.cy }, true, e.isNavalUnit, e.stats.speedClass);
            e.pathIndex = 0;
          }
          results.push({ cmd: 'attack_move', ok: errs.length === 0, error: errs.length ? errs.join('; ') : undefined });
          break;
        }

        case 'attack_struct': {
          const s = game.structures[c.structIdx];
          if (!s?.alive) {
            results.push({ cmd: 'attack_struct', ok: false, error: `structure ${c.structIdx} not alive` });
            break;
          }
          const errs: string[] = [];
          for (const id of c.unitIds) {
            const e = game.entityById.get(id);
            if (!e?.alive || !e.isPlayerUnit) { errs.push(`unit ${id} invalid`); continue; }
            clearTeamScripts(e);

            // SPY infiltration shortcut: if spy is within 6 cells of enemy building,
            // call spyInfiltrate() directly. Bypasses entity update order race where
            // dogs kill the spy before the missionAI can process the infiltration.
            if (e.type === 'SPY' && e.isPlayerUnit && !game.isAllied(s.house, game.playerHouse)) {
              const dx = e.cell.cx - s.cx;
              const dy = e.cell.cy - s.cy;
              if (dx * dx + dy * dy <= 400) { // within 20 cells — harness-assisted infiltration for stealth missions
                try {
                  (game as unknown as { spyInfiltrate(spy: typeof e, st: typeof s): void }).spyInfiltrate(e, s);
                  if (typeof console !== 'undefined') console.log(`[HARNESS] spyInfiltrate called for SPY at (${e.cell.cx},${e.cell.cy}) → ${s.type}(${s.cx},${s.cy}) trigger="${s.triggerName ?? 'NONE'}"`);
                } catch (err) {
                  if (typeof console !== 'undefined') console.log(`[HARNESS] spyInfiltrate ERROR: ${err}`);
                }
                continue;
              }
            }

            // Skip path reset if already attacking this same structure with a
            // valid path — prevents stutter-stepping (same fix as move dedup).
            if (e.mission === Mission.ATTACK && e.targetStructure === s
                && e.path && e.path.length > 0) {
              continue;
            }

            e.mission = Mission.ATTACK;
            e.target = null;
            e.targetStructure = s;
            // Pathfind to cell adjacent to structure CENTER (C4 checks dist to center).
            // Structure footprint: (s.cx, s.cy) to (s.cx+sw-1, s.cy+sh-1).
            // We want cells AROUND the footprint, closest to the center.
            const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
            const centerX = s.cx + Math.floor(sw / 2);
            const centerY = s.cy + Math.floor(sh / 2);
            e.moveTarget = { x: centerX * CELL_SIZE + CELL_SIZE / 2, y: centerY * CELL_SIZE + CELL_SIZE / 2 };
            let bestPath: ReturnType<typeof findPath> = [];
            // Try all cells around the footprint perimeter
            for (let dy = -1; dy <= sh; dy++) {
              for (let dx = -1; dx <= sw; dx++) {
                if (dx >= 0 && dx < sw && dy >= 0 && dy < sh) continue; // inside footprint
                const ax = s.cx + dx, ay = s.cy + dy;
                const p = findPath(game.map, e.cell, { cx: ax, cy: ay }, true, e.isNavalUnit, e.stats.speedClass);
                if (p.length > 0 && (bestPath.length === 0 || p.length < bestPath.length)) {
                  bestPath = p;
                  e.moveTarget = { x: ax * CELL_SIZE + CELL_SIZE / 2, y: ay * CELL_SIZE + CELL_SIZE / 2 };
                }
              }
            }
            e.path = bestPath;
            e.pathIndex = 0;
          }
          results.push({ cmd: 'attack_struct', ok: errs.length === 0, error: errs.length ? errs.join('; ') : undefined });
          break;
        }

        case 'shoot_struct': {
          // Direct weapon damage against a structure (C++ parity: infantry CAN fire
          // weapons at structures from range, not just C4). Used for barrels etc.
          const ss = game.structures[c.structIdx];
          if (!ss?.alive) {
            results.push({ cmd: 'shoot_struct', ok: false, error: 'structure not alive' });
            break;
          }
          const shooter = game.entityById.get(c.unitIds?.[0]);
          if (!shooter?.alive || !shooter.isPlayerUnit || !shooter.weapon) {
            results.push({ cmd: 'shoot_struct', ok: false, error: 'invalid shooter' });
            break;
          }
          // Apply weapon damage directly
          const dmg = shooter.weapon.damage ?? 50;
          ss.hp -= dmg;
          if (ss.hp <= 0) {
            ss.alive = false;
            ss.hp = 0;
            // Trigger explosion for barrels
            if (typeof (game as unknown as { damageStructure?: (s: typeof ss, d: number) => void }).damageStructure === 'function') {
              (game as unknown as { damageStructure: (s: typeof ss, d: number) => void }).damageStructure(ss, dmg);
            }
          }
          results.push({ cmd: 'shoot_struct', ok: true });
          break;
        }

        case 'stop': {
          for (const id of c.unitIds) {
            const e = game.entityById.get(id);
            if (!e?.alive || !e.isPlayerUnit) continue;
            clearTeamScripts(e);
            e.mission = Mission.GUARD;
            e.target = null;
            e.moveTarget = null;
            e.path = [];
            e.pathIndex = 0;
          }
          results.push({ cmd: 'stop', ok: true });
          break;
        }

        case 'enter': {
          const inf = game.entityById.get(c.unitId);
          const transport = game.entityById.get(c.transportId);
          if (!inf?.alive || !inf.isPlayerUnit || !inf.stats.isInfantry) {
            results.push({ cmd: 'enter', ok: false, error: `unit ${c.unitId} invalid (must be alive allied infantry)` });
            break;
          }
          if (!transport?.alive || !transport.isTransport) {
            results.push({ cmd: 'enter', ok: false, error: `transport ${c.transportId} invalid` });
            break;
          }
          if (transport.passengers.length >= transport.maxPassengers) {
            results.push({ cmd: 'enter', ok: false, error: 'transport full' });
            break;
          }
          clearTeamScripts(inf);
          // Match C++ harness semantics for now: issue an ENTER order and avoid the
          // TS-only instant/auto-load shortcuts. We can restore the shortcut later
          // if we decide to deliberately mirror that behavior in C++ too.
          inf.mission = Mission.ENTER;
          inf.target = null;
          inf.moveTarget = { ...transport.pos };
          const tc = { cx: Math.floor(transport.pos.x / CELL_SIZE), cy: Math.floor(transport.pos.y / CELL_SIZE) };
          inf.path = findPath(game.map, inf.cell, tc, true, inf.isNavalUnit, inf.stats.speedClass);
          inf.pathIndex = 0;
          results.push({ cmd: 'enter', ok: true });
          break;
        }

        case 'build': {
          const available = game.getAvailableItems();
          const item = available.find(i => i.type === c.type);
          if (!item) {
            results.push({ cmd: 'build', ok: false, error: `type ${c.type} not available` });
            break;
          }
          game.startProduction(item);
          results.push({ cmd: 'build', ok: true });
          break;
        }

        case 'cancel_build': {
          game.cancelProduction(c.category);
          results.push({ cmd: 'cancel_build', ok: true });
          break;
        }

        case 'place': {
          if (!game.pendingPlacement) {
            results.push({ cmd: 'place', ok: false, error: 'no pending placement' });
            break;
          }
          const ok = game.placeStructure(c.cx, c.cy);
          results.push({ cmd: 'place', ok, error: ok ? undefined : 'invalid placement location' });
          break;
        }

        case 'sell': {
          const ok = game.sellStructureByIndex(c.structIdx);
          results.push({ cmd: 'sell', ok, error: ok ? undefined : `cannot sell structure ${c.structIdx}` });
          break;
        }

        case 'repair': {
          const repairing = game.toggleRepair(c.structIdx);
          results.push({ cmd: 'repair', ok: true, error: repairing ? undefined : 'repair toggled off or not needed' });
          break;
        }

        case 'deploy': {
          const e = game.entityById.get(c.unitId);
          if (!e?.alive || !e.isPlayerUnit) {
            results.push({ cmd: 'deploy', ok: false, error: `unit ${c.unitId} invalid` });
            break;
          }
          if (e.type === 'MCV') {
            const ok = game.deployMCV(e);
            results.push({ cmd: 'deploy', ok, error: ok ? undefined : 'cannot deploy here' });
          } else if (e.type === 'QTNK') {
            game.deployMADTank(e);
            results.push({ cmd: 'deploy', ok: true });
          } else {
            results.push({ cmd: 'deploy', ok: false, error: `unit type ${e.type} cannot deploy` });
          }
          break;
        }

        case 'warp_unit': {
          // Debug/harness command: teleport a unit to a specific cell
          const we = game.entityById.get(c.unitId);
          if (!we?.alive) {
            results.push({ cmd: 'warp_unit', ok: false, error: 'unit not alive' });
            break;
          }
          we.pos = { x: c.cx * CELL_SIZE + CELL_SIZE / 2, y: c.cy * CELL_SIZE + CELL_SIZE / 2 };
          we.path = [];
          we.pathIndex = 0;
          we.mission = Mission.GUARD;
          we.target = null;
          we.moveTarget = null;
          results.push({ cmd: 'warp_unit', ok: true });
          break;
        }

        case 'set_global': {
          // Debug/harness command: directly set a global (simulates cell trigger activation)
          const globals = (game as unknown as { globals: Set<number> }).globals;
          if (globals && typeof c.data === 'number') {
            globals.add(c.data);
            // C++ parity: setting a global must immediately spring dependent triggers
            // (e.g., global 18 triggers tnya which spawns Tanya)
            const springFn = (game as unknown as { springGlobalTriggers(idx: number): void }).springGlobalTriggers;
            if (typeof springFn === 'function') {
              springFn.call(game, c.data);
            }
            results.push({ cmd: 'set_global', ok: true });
          } else {
            results.push({ cmd: 'set_global', ok: false, error: 'invalid global data' });
          }
          break;
        }

        case 'debug_terrain': {
          // Dump terrain info for specific cells
          const cells: string[] = [];
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const px = c.cx + dx, py = c.cy + dy;
              const t = game.map.getTerrain(px, py);
              const p = game.map.isPassable(px, py);
              cells.push(`(${px},${py})=${t}${p ? 'P' : 'X'}`);
            }
          }
          const path = findPath(game.map, { cx: c.cx, cy: c.cy + 1 }, { cx: c.cx, cy: c.cy - 1 }, true, false, 1);
          results.push({ cmd: 'debug_terrain', ok: true, error: cells.join(' ') + ' path_len=' + path.length } as never);
          break;
        }

        default:
          results.push({ cmd: (c as { cmd: string }).cmd, ok: false, error: 'unknown command' });
      }
    } catch (err) {
      results.push({ cmd: c.cmd, ok: false, error: String(err) });
    }
  }

  return results;
}

// === Window API installer ===

export function installHarness(game: Game): void {
  const w = window as unknown as Record<string, unknown>;

  w.__agentReady = true;
  w.__agentGame = game; // Expose for debug/testing

  w.__agentState = () => serializeState(game);

  w.__agentCommand = (commands: AgentCommand[]) => processCommands(game, commands);

  w.__agentStep = (n = 15, commands?: AgentCommand[]) => {
    // Scale incoming tick count by 20/15 so TS processes equivalent real game
    // time as C++ WASM (C++ runs at GameSpeed 3 = 20 tps; TS step() expects
    // 15-tick frames by convention, so n ticks from the test harness represent
    // n * 20/15 TS engine ticks).
    const scaled = Math.round(n * 20 / 15);
    const clamped = Math.max(0, Math.min(scaled, 1200)); // cap at ~1 minute of game time
    const results = commands && Array.isArray(commands) ? processCommands(game, commands) : [];
    game.step(clamped);
    return { results, state: serializeState(game) } satisfies StepResult;
  };

  w.__agentDebug = () => {
    game.debugTriggers = true;
    // Access private triggers via cast
    const g = game as unknown as { triggers: Array<{ name: string; fired: boolean; forceFirePending: boolean; event1: { type: number; data: number }; action1: { action: number; team: number }; eventControl: number; actionControl: number }> };
    const triggers = g.triggers.map((t, i) => ({
      i, name: t.name, fired: t.fired, force: t.forceFirePending,
      e1: t.event1.type, e1d: t.event1.data,
      a1: t.action1.action, a1t: t.action1.team,
      ec: t.eventControl, ac: t.actionControl,
    }));
    // Check entity triggerNames
    const entityTriggers = game.entities
      .filter(e => e.triggerName)
      .map(e => ({ id: e.id, type: e.type, alive: e.alive, triggerName: e.triggerName }));
    return { triggers, entityTriggers };
  };
}
