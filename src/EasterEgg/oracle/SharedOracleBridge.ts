import type {
  AgentCommand,
  AgentState,
  AgentStructure,
  AgentUnit,
} from '../engine/agentHarness.js';
import {
  OracleStrategy,
  type OracleDecision,
  type OracleResult,
} from './OracleStrategy.js';
import type {
  RAGameState,
  RAEntity,
  RAStructure,
} from './WasmAdapter.js';

const TS_STRUCTURE_ID_OFFSET = 1_000_000_000;

const TS_MISSION_CODES: Record<string, number> = {
  SLEEP: 0,
  GUARD: 5,
  AREA_GUARD: 18,
};

export interface TsOracleDecision {
  normalizedState: RAGameState;
  oracleDecision: OracleDecision;
  commands: AgentCommand[];
  warnings: string[];
}

export interface TsStateBridge {
  normalizedState: RAGameState;
  structureIndexById: Map<number, number>;
}

function toMissionCode(mission: string): number {
  return TS_MISSION_CODES[mission] ?? -1;
}

function toRaEntity(unit: AgentUnit, ally: boolean): RAEntity {
  return {
    id: unit.id,
    t: unit.t,
    house: unit.h,
    cx: unit.cx,
    cy: unit.cy,
    hp: unit.hp,
    mhp: unit.mhp,
    m: toMissionCode(unit.m),
    ally,
    cargo: unit.cargo,
    cargoTop: unit.cargoTop,
  };
}

function toRaStructure(structure: AgentStructure, id: number): RAStructure {
  return {
    id,
    t: structure.t,
    house: structure.h,
    cx: structure.cx,
    cy: structure.cy,
    hp: structure.hp,
    mhp: structure.mhp,
    m: 0,
    ally: structure.ally,
    repairing: Boolean(structure.rep),
  };
}

export function normalizeTsState(state: AgentState): TsStateBridge {
  const alliedHouses = new Set(state.alliedHouses);
  const units: RAEntity[] = state.units.map((unit) => toRaEntity(unit, true));
  const enemies: RAEntity[] = [];

  for (const unit of state.enemies) {
    if (alliedHouses.has(unit.h)) {
      units.push(toRaEntity(unit, true));
      continue;
    }
    enemies.push(toRaEntity(unit, false));
  }

  const structureIndexById = new Map<number, number>();
  const structures = state.structures.map((structure) => {
    const id = TS_STRUCTURE_ID_OFFSET + structure.idx;
    structureIndexById.set(id, structure.idx);
    return toRaStructure(structure, id);
  });

  return {
    structureIndexById,
    normalizedState: {
      tick: state.tick,
      credits: state.credits,
      playerHouse: state.playerHouse,
      alliedHouses: [...state.alliedHouses],
      globals: [...state.globals],
      missionTimer: state.missionTimer,
      missionTimerActive: state.missionTimer > 0,
      civEvacuated: state.civiliansEvacuated > 0,
      winPending: state.state === 'won',
      losePending: state.state === 'lost',
      power: {
        produced: state.power.produced,
        consumed: state.power.consumed,
      },
      units,
      enemies,
      structures,
      production: state.production.map((item) => ({
        t: item.t,
        prog: Math.round(item.prog * 100),
      })),
    },
  };
}

export function translateOracleDecisionToTs(
  decision: OracleDecision,
  bridge: TsStateBridge,
): { commands: AgentCommand[]; warnings: string[] } {
  const commands: AgentCommand[] = [];
  const warnings: string[] = [];

  for (const command of decision.commands) {
    const kind = typeof command.cmd === 'string' ? command.cmd : '';
    const ids = Array.isArray(command.ids)
      ? command.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
      : [];

    if (kind === 'move' && typeof command.cx === 'number' && typeof command.cy === 'number') {
      commands.push({ cmd: 'move', unitIds: ids, cx: command.cx, cy: command.cy });
      continue;
    }

    if (kind === 'attack_move' && typeof command.cx === 'number' && typeof command.cy === 'number') {
      commands.push({ cmd: 'attack_move', unitIds: ids, cx: command.cx, cy: command.cy });
      continue;
    }

    if (kind === 'attack' && typeof command.target === 'number') {
      const structureIndex = bridge.structureIndexById.get(command.target);
      if (structureIndex !== undefined) {
        commands.push({ cmd: 'attack_struct', unitIds: ids, structIdx: structureIndex });
      } else {
        commands.push({ cmd: 'attack', unitIds: ids, targetId: command.target });
      }
      continue;
    }

    if (kind === 'stop') {
      commands.push({ cmd: 'stop', unitIds: ids });
      continue;
    }

    if (kind === 'enter' && typeof command.target === 'number' && ids.length === 1) {
      commands.push({ cmd: 'enter', unitId: ids[0], transportId: command.target });
      continue;
    }

    if (kind === 'deploy' && ids.length === 1) {
      commands.push({ cmd: 'deploy', unitId: ids[0] });
      continue;
    }

    warnings.push(`Unsupported oracle command for TS bridge: ${JSON.stringify(command)}`);
  }

  return { commands, warnings };
}

export class SharedTsOracleStrategy {
  private readonly oracle: OracleStrategy;

  constructor(scenario: string) {
    this.oracle = new OracleStrategy(scenario);
  }

  checkResult(state: AgentState): OracleResult {
    const bridge = normalizeTsState(state);
    const oracleResult = this.oracle.checkResult(bridge.normalizedState);
    if (oracleResult !== 'playing') {
      return oracleResult;
    }
    if (state.state === 'won') {
      return 'victory';
    }
    if (state.state === 'lost') {
      return 'defeat';
    }
    return 'playing';
  }

  decide(state: AgentState): TsOracleDecision {
    const bridge = normalizeTsState(state);
    const oracleDecision = this.oracle.decide(bridge.normalizedState);
    const translated = translateOracleDecisionToTs(oracleDecision, bridge);
    return {
      normalizedState: bridge.normalizedState,
      oracleDecision,
      commands: translated.commands,
      warnings: translated.warnings,
    };
  }

  summarize(state: AgentState, iteration: number, decision: TsOracleDecision): string {
    const summary = this.oracle.summarize(
      decision.normalizedState,
      iteration,
      decision.oracleDecision,
    );
    if (decision.warnings.length === 0) {
      return summary;
    }
    return `${summary} warnings=${decision.warnings.length}`;
  }
}
