import type {
  AgentCommand,
  AgentState,
  AgentStructure,
  AgentUnit,
} from '../engine/agentHarness';
import {
  OracleStrategy,
  type OracleDecision,
  type OracleResult,
} from './OracleStrategy';
import type {
  RAGameState,
  RAEntity,
  RAStructure,
} from './WasmAdapter';

const TS_STRUCTURE_ID_OFFSET = 1_000_000_000;

// Infantry type names — must match OracleStrategy.INFANTRY_TYPES
const INFANTRY_TYPES = new Set([
  'E1','E2','E3','E4','E6','E7','SPY','THF','MEDI','GNRL','DOG',
  'C1','C2','C3','C4','C5','C6','C7','C8','C9','C10','EINSTEIN','CHAN','DELPHI',
]);

// Vessel type names
const VESSEL_TYPES = new Set(['SS','DD','CA','LST','PT','MSUB']);

const RTTI_BUILDINGTYPE = 6;
const RTTI_UNITTYPE = 29;
const RTTI_INFANTRYTYPE = 14;
const RTTI_VESSELTYPE = 31;

// Reverse mappings: type_id -> type name (from C++ defines.h StructType enum)
const BUILDING_ID_TO_NAME: Record<number, string> = {
  0: 'ATEK', 1: 'IRON', 2: 'WEAP', 3: 'PDOX', 4: 'PBOX', 5: 'HBOX',
  6: 'DOME', 7: 'GAP',  8: 'GUN',  9: 'AGUN', 10: 'FTUR', 11: 'FACT',
  12: 'PROC', 13: 'SILO', 14: 'HPAD', 15: 'SAM', 16: 'AFLD', 17: 'POWR',
  18: 'APWR', 19: 'STEK', 20: 'HOSP', 21: 'BARR', 22: 'TENT', 23: 'KENN',
  24: 'FIX',  25: 'BIO',  26: 'MISS', 27: 'SYRD', 28: 'SPEN', 29: 'MSLO',
  30: 'FCOM', 31: 'TSLA',
};

const UNIT_ID_TO_NAME: Record<number, string> = {
  0: '4TNK', 1: '3TNK', 2: '2TNK', 3: '1TNK', 4: 'APC', 5: 'MNLY',
  6: 'JEEP', 7: 'HARV', 8: 'ARTY', 9: 'MRJ', 10: 'MGG', 11: 'MCV',
  12: 'V2RL', 13: 'TRUK',
};

const INFANTRY_ID_TO_NAME: Record<number, string> = {
  0: 'E1', 1: 'E2', 2: 'E3', 3: 'E4', 4: 'E6', 5: 'E7',
  6: 'SPY', 7: 'THF', 8: 'MEDI', 9: 'GNRL', 10: 'DOG',
};

const VESSEL_ID_TO_NAME: Record<number, string> = {
  0: 'SS', 1: 'DD', 2: 'CA', 3: 'LST', 4: 'PT', 5: 'MSUB',
};

// Reverse lookup: type name → RTTI category (for production state normalization)
const BUILDING_NAMES = new Set(Object.values(BUILDING_ID_TO_NAME));
const UNIT_NAMES = new Set(Object.values(UNIT_ID_TO_NAME));
const INFANTRY_NAMES = new Set(Object.values(INFANTRY_ID_TO_NAME));
const VESSEL_NAMES = new Set(Object.values(VESSEL_ID_TO_NAME));

function nameToRtti(name: string): number | undefined {
  if (BUILDING_NAMES.has(name)) return RTTI_BUILDINGTYPE;
  if (UNIT_NAMES.has(name)) return RTTI_UNITTYPE;
  if (INFANTRY_NAMES.has(name)) return RTTI_INFANTRYTYPE;
  if (VESSEL_NAMES.has(name)) return RTTI_VESSELTYPE;
  return undefined;
}

function rttiToName(rtti: number, typeId: number): string | undefined {
  switch (rtti) {
    case RTTI_BUILDINGTYPE: return BUILDING_ID_TO_NAME[typeId];
    case RTTI_UNITTYPE: return UNIT_ID_TO_NAME[typeId];
    case RTTI_INFANTRYTYPE: return INFANTRY_ID_TO_NAME[typeId];
    case RTTI_VESSELTYPE: return VESSEL_ID_TO_NAME[typeId];
    default: return undefined;
  }
}

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

function toBuildable(state: AgentState): { structures: string[]; units: string[]; infantry: string[]; vessels: string[] } {
  const structures: string[] = [];
  const units: string[] = [];
  const infantry: string[] = [];
  const vessels: string[] = [];

  for (const item of state.availableItems) {
    if (item.isStruct) {
      structures.push(item.t);
    } else if (INFANTRY_TYPES.has(item.t)) {
      infantry.push(item.t);
    } else if (VESSEL_TYPES.has(item.t)) {
      vessels.push(item.t);
    } else {
      units.push(item.t);
    }
  }

  return { structures, units, infantry, vessels };
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
        rtti: nameToRtti(item.t),
        done: item.prog >= 1,
      })),
      buildable: toBuildable(state),
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

    if (kind === 'set_global' && typeof (command as { data?: number }).data === 'number') {
      commands.push({ cmd: 'set_global', data: (command as { data: number }).data } as never);
      continue;
    }

    if (kind === 'warp_unit' && ids.length === 1) {
      commands.push({ cmd: 'warp_unit', unitId: ids[0], cx: command.cx ?? 0, cy: command.cy ?? 0 } as never);
      continue;
    }

    if (kind === 'shoot_struct' && typeof command.target === 'number' && ids.length >= 1) {
      const sIdx = bridge.structureIndexById.get(command.target);
      if (sIdx !== undefined) {
        commands.push({ cmd: 'shoot_struct', unitIds: ids, structIdx: sIdx } as never);
      }
      continue;
    }

    if (kind === 'enter' && typeof command.target === 'number' && ids.length === 1) {
      commands.push({ cmd: 'enter', unitId: ids[0], transportId: command.target });
      continue;
    }

    if (kind === 'load_passenger' && typeof command.target === 'number' && ids.length === 1) {
      commands.push({ cmd: 'load_passenger', unitId: ids[0], transportId: command.target } as never);
      continue;
    }

    if (kind === 'deploy' && ids.length === 1) {
      commands.push({ cmd: 'deploy', unitId: ids[0] });
      continue;
    }

    if (kind === 'produce' && typeof command.rtti === 'number' && typeof command.type_id === 'number') {
      const typeName = rttiToName(command.rtti, command.type_id);
      if (typeName) {
        commands.push({ cmd: 'build', type: typeName });
      } else {
        warnings.push(`Unknown produce rtti=${command.rtti} type_id=${command.type_id}`);
      }
      continue;
    }

    if (kind === 'place') {
      if (typeof command.cx === 'number' && typeof command.cy === 'number') {
        commands.push({ cmd: 'place', cx: command.cx, cy: command.cy });
      }
      continue;
    }

    if (kind === 'sell' && typeof command.target === 'number') {
      const structureIndex = bridge.structureIndexById.get(command.target);
      if (structureIndex !== undefined) {
        commands.push({ cmd: 'sell', structIdx: structureIndex });
      } else {
        warnings.push(`sell: structure id ${command.target} not found`);
      }
      continue;
    }

    if (kind === 'repair' && typeof command.target === 'number') {
      const structureIndex = bridge.structureIndexById.get(command.target);
      if (structureIndex !== undefined) {
        commands.push({ cmd: 'repair', structIdx: structureIndex });
      } else {
        warnings.push(`repair: structure id ${command.target} not found`);
      }
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

  /**
   * Provide INI text for dynamic coastal cell detection via MapPack parsing.
   * Call this after construction if the INI data is available (e.g. from fetch).
   */
  setINIText(text: string): void {
    this.oracle.setINIText(text);
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
