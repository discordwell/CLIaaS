/**
 * Agent Harness — pause-step interface for Claude Code to play the game via MCP browser tools.
 *
 * Installs window.__agentState(), window.__agentCommand(), window.__agentStep()
 * for programmatic turn-based control of the real-time engine.
 */

import { type Game } from './index';
import { type Entity } from './entity';
import { House, Mission, CELL_SIZE, worldToCell, worldDist, type ProductionItem, getStripSide } from './types';
import { findPath } from './pathfinding';
import { STRUCTURE_SIZE, type MapStructure } from './scenario';

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
  wpn?: string;    // weapon name
  rng?: number;    // weapon range
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
}

export interface AgentState {
  tick: number;
  state: string;
  credits: number;
  power: { produced: number; consumed: number };
  siloCapacity: number;
  units: AgentUnit[];
  enemies: AgentUnit[];
  structures: AgentStructure[];
  production: AgentQueueItem[];
  pending?: string;
  available: string[];
  mapBounds: { x: number; y: number; w: number; h: number };
  killCount: number;
  lossCount: number;
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
  if (e.weapon) {
    u.wpn = e.weapon.name;
    u.rng = e.weapon.range;
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
    const isAlly = typeof game.isAllied === 'function'
      ? game.isAllied(s.house, game.playerHouse)
      : s.house === game.playerHouse;
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
    });
  }

  const available = game.getAvailableItems().map(i => i.type);

  return {
    tick: game.tick,
    state: game.state,
    credits: game.credits,
    power: { produced: game.powerProduced, consumed: game.powerConsumed },
    siloCapacity: game.siloCapacity,
    units,
    enemies,
    structures,
    production,
    pending: game.pendingPlacement?.type,
    available,
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
    allowWin: ((game as unknown as Record<string, unknown>).allowWin as boolean) ?? false,
    globals: [...((game as unknown as Record<string, unknown>).globals as Set<number> ?? [])],
    unitsLeftMap: ((game as unknown as Record<string, unknown>).unitsLeftMap as number) ?? 0,
    triggers: (game.triggers ?? []).map(t => ({
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
            clearTeamScripts(e);
            e.mission = Mission.MOVE;
            e.target = null;
            e.moveTarget = { x: c.cx * CELL_SIZE + CELL_SIZE / 2, y: c.cy * CELL_SIZE + CELL_SIZE / 2 };
            if (e.stats.isAircraft) {
              // Aircraft fly directly — no ground pathfinding needed
              e.path = [{ cx: c.cx, cy: c.cy }];
              e.pathIndex = 0;
            } else {
              const path = findPath(game.map, e.cell, { cx: c.cx, cy: c.cy }, true, e.isNavalUnit, e.stats.speedClass);
              if (path.length === 0) { errs.push(`no path for ${id}`); continue; }
              e.path = path;
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
            clearTeamScripts(e);
            e.mission = Mission.HUNT;
            e.target = null;
            e.moveTarget = { x: c.cx * CELL_SIZE + CELL_SIZE / 2, y: c.cy * CELL_SIZE + CELL_SIZE / 2 };
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
            e.mission = Mission.ATTACK;
            e.target = null;
            e.targetStructure = s;
            e.moveTarget = { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
            e.path = findPath(game.map, e.cell, { cx: s.cx, cy: s.cy }, true, e.isNavalUnit, e.stats.speedClass);
            e.pathIndex = 0;
          }
          results.push({ cmd: 'attack_struct', ok: errs.length === 0, error: errs.length ? errs.join('; ') : undefined });
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
          // If close enough, load directly (generous threshold for agent use)
          const loadDist = worldDist(inf.pos, transport.pos);
          if (loadDist < 2.0) {
            transport.passengers.push(inf);
            inf.transportRef = transport;
            inf.mission = Mission.SLEEP;
            inf.selected = false;
            // Clear cell occupancy (mirrors engine auto-load at index.ts:2528)
            game.map.setOccupancy(inf.cell.cx, inf.cell.cy, 0);
            // Remove from world (will be re-added on unload)
            game.entities = game.entities.filter((e: Entity) => e.id !== inf.id);
            game.entityById.delete(inf.id);
            results.push({ cmd: 'enter', ok: true });
          } else {
            // Move infantry toward transport — proximity auto-load handles boarding
            inf.mission = Mission.MOVE;
            inf.target = null;
            inf.moveTarget = { ...transport.pos };
            const tc = { cx: Math.floor(transport.pos.x / CELL_SIZE), cy: Math.floor(transport.pos.y / CELL_SIZE) };
            inf.path = findPath(game.map, inf.cell, tc, true, inf.isNavalUnit, inf.stats.speedClass);
            inf.pathIndex = 0;
            results.push({ cmd: 'enter', ok: true });
          }
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
    const clamped = Math.max(0, Math.min(n, 900)); // cap at 1 minute of game time
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
