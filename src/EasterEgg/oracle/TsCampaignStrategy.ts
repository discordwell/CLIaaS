import type {
  AgentCommand,
  AgentState,
  AgentStructure,
  AgentUnit,
  CommandResult,
} from '../engine/agentHarness.js';

export interface TsOracleDecision {
  commands: AgentCommand[];
  note: string;
}

export type TsOracleResult = 'playing' | 'won' | 'lost';

const RETREAT_HP_FRACTION = 0.35;
const NON_HOSTILE_TYPES = new Set([
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10',
  'EINSTEIN', 'CHAN',
]);
const NON_HOSTILE_HOUSES = new Set(['Neutral', 'Turkey']);
const ECON_STRUCTURES = ['POWR', 'APWR', 'PROC', 'SILO', 'TENT', 'BARR', 'WEAP', 'FIX', 'AFLD'];
const STRUCTURE_BUILD_ORDER = ['POWR', 'APWR', 'PROC', 'TENT', 'BARR', 'WEAP', 'FIX', 'AFLD'];
const UNIT_BUILD_ORDER = ['HARV', '2TNK', '1TNK', '3TNK', '4TNK', 'LTNK', 'MTNK', 'APC', 'ARTY', 'JEEP', 'E1', 'DOG'];
const PLACEMENT_OFFSETS = [
  { dx: 4, dy: 0 }, { dx: 0, dy: 4 }, { dx: -4, dy: 0 }, { dx: 0, dy: -4 },
  { dx: 6, dy: 2 }, { dx: 2, dy: 6 }, { dx: -6, dy: 2 }, { dx: 2, dy: -6 },
  { dx: 6, dy: -2 }, { dx: -2, dy: 6 }, { dx: -6, dy: -2 }, { dx: -2, dy: -6 },
];

export class TsCampaignStrategy {
  private exploreIndex = 0;
  private placementIndex = 0;
  private readonly scenarioId: string;

  constructor(scenarioId: string) {
    this.scenarioId = scenarioId.toUpperCase();
  }

  checkResult(state: AgentState): TsOracleResult {
    if (state.state === 'won') return 'won';
    if (state.state === 'lost') return 'lost';
    return 'playing';
  }

  decide(state: AgentState, previousResults: CommandResult[] = []): TsOracleDecision {
    const decision = this.scenarioId === 'SCG01EA'
      ? this.decideScg01(state)
      : this.decideGeneric(state);

    const failedPlacement = previousResults.some((result) => result.cmd === 'place' && !result.ok);
    if (failedPlacement) {
      this.placementIndex++;
    }

    return decision;
  }

  summarize(state: AgentState, iteration: number, decision: TsOracleDecision): string {
    return [
      `[TS-Oracle] #${iteration}`,
      `tick=${state.tick}`,
      `state=${state.state}`,
      `units=${state.units.length}`,
      `hostiles=${this.hostileUnits(state).length}`,
      `enemyStructs=${this.hostileStructures(state).length}`,
      `credits=${state.credits}`,
      `power=${state.power.produced}/${state.power.consumed}`,
      decision.note,
    ].join(' ');
  }

  private decideScg01(state: AgentState): TsOracleDecision {
    const flare = { cx: 54, cy: 48 };
    const einsteinSpawn = { cx: 62, cy: 61 };
    const prisonGuardAnchors = [{ cx: 61, cy: 63 }, { cx: 63, cy: 63 }];
    const combatUnits = this.combatUnits(state);
    const escortUnits = combatUnits.filter((unit) => unit.t !== 'E7');
    const hostiles = this.hostileUnits(state);
    const einstein = this.visibleFriendlies(state).find((unit) => unit.t === 'EINSTEIN');
    const tanya = state.units.find((unit) => unit.t === 'E7');
    const rescueTriggered = state.globals.includes(1)
      || state.triggers.some((trigger) => (
        (trigger.name === 'eins' || trigger.name === 'ein2' || trigger.name === 'ein3')
        && trigger.fired
      ));
    const prisonGuards = hostiles.filter((unit) => (
      unit.t === 'E1'
      && prisonGuardAnchors.some((anchor) => this.cellDist(unit, anchor) <= 1.5)
    ));
    const objectiveThreats = hostiles.filter((unit) => (
      this.cellDist(unit, einsteinSpawn) <= 10
      || (einstein ? this.cellDist(unit, einstein) <= 8 : false)
      || (tanya ? this.cellDist(unit, tanya) <= 8 : false)
    ));
    const localThreats = hostiles.filter((unit) => {
      const escortAnchor = escortUnits[0] ?? flare;
      return this.cellDist(unit, escortAnchor) <= 8;
    });
    const commands: AgentCommand[] = [];
    const notes: string[] = [];

    if (!rescueTriggered && prisonGuards.length > 0 && combatUnits.length > 0) {
      const target = this.nearestUnit(einsteinSpawn, prisonGuards);
      commands.push({ cmd: 'attack', unitIds: combatUnits.map((unit) => unit.id), targetId: target.id });
      notes.push(`scg01 kill guard ${target.t}@${target.cx},${target.cy}`);
      return {
        commands,
        note: notes.join('; '),
      };
    }

    if (objectiveThreats.length > 0 && escortUnits.length > 0) {
      const target = einstein
        ? this.nearestUnit(einstein, objectiveThreats)
        : this.nearestUnit(einsteinSpawn, objectiveThreats);
      commands.push({ cmd: 'attack', unitIds: escortUnits.map((unit) => unit.id), targetId: target.id });
      notes.push(`scg01 clear ${target.t}@${target.cx},${target.cy}`);
    } else if (localThreats.length > 0 && escortUnits.length > 0) {
      const target = this.nearestUnit(escortUnits[0], localThreats);
      commands.push({ cmd: 'attack', unitIds: escortUnits.map((unit) => unit.id), targetId: target.id });
      notes.push(`scg01 skirmish ${target.t}@${target.cx},${target.cy}`);
    } else if (!einstein && escortUnits.length > 0) {
      const advance = escortUnits.filter((unit) => this.cellDist(unit, einsteinSpawn) > 5);
      if (advance.length > 0) {
        commands.push({ cmd: 'move', unitIds: advance.map((unit) => unit.id), cx: einsteinSpawn.cx - 1, cy: einsteinSpawn.cy - 2 });
        notes.push('scg01 move to prison');
      }
    } else if (einstein && escortUnits.length > 0) {
      const target = this.cellDist(einstein, flare) > 4 ? einstein : flare;
      const lagging = escortUnits.filter((unit) => this.cellDist(unit, target) > 5);
      if (lagging.length > 0) {
        commands.push({ cmd: 'move', unitIds: lagging.map((unit) => unit.id), cx: target.cx, cy: target.cy });
        notes.push('scg01 escort vip');
      }
    }

    if (tanya && this.cellDist(tanya, flare) > 6) {
      commands.push({ cmd: 'move', unitIds: [tanya.id], cx: flare.cx, cy: flare.cy });
      notes.push('scg01 keep tanya safe');
    }

    if (commands.length === 0 && hostiles.length > 0 && escortUnits.length > 0) {
      const target = einstein
        ? this.nearestUnit(einstein, hostiles)
        : this.nearestToArmy(state, hostiles);
      commands.push({ cmd: 'attack', unitIds: escortUnits.map((unit) => unit.id), targetId: target.id });
      notes.push(`scg01 fallback ${target.t}@${target.cx},${target.cy}`);
    }

    return {
      commands,
      note: notes.join('; ') || 'scg01 hold',
    };
  }

  private decideGeneric(state: AgentState): TsOracleDecision {
    const commands: AgentCommand[] = [];
    const notes: string[] = [];
    const combatUnits = this.combatUnits(state);
    const hostiles = this.hostileUnits(state);
    const hostileStructures = this.hostileStructures(state);

    const injured = combatUnits.filter((unit) => unit.hp / Math.max(1, unit.mhp) < RETREAT_HP_FRACTION);
    if (injured.length > 0) {
      const fallback = this.baseAnchor(state) ?? { cx: state.mapBounds.x + 2, cy: state.mapBounds.y + 2 };
      commands.push({ cmd: 'move', unitIds: injured.map((unit) => unit.id), cx: fallback.cx, cy: fallback.cy });
      notes.push(`retreat ${injured.length}`);
    }

    const healthy = combatUnits.filter((unit) => !injured.some((other) => other.id === unit.id));
    if (hostiles.length > 0 && healthy.length > 0) {
      const target = this.nearestToArmy(state, hostiles);
      commands.push({ cmd: 'attack', unitIds: healthy.map((unit) => unit.id), targetId: target.id });
      notes.push(`attack ${target.t}@${target.cx},${target.cy}`);
    } else if (hostileStructures.length > 0 && healthy.length > 0) {
      const target = this.nearestStructureToArmy(state, hostileStructures);
      commands.push({ cmd: 'attack_struct', unitIds: healthy.map((unit) => unit.id), structIdx: target.idx });
      notes.push(`attack-struct ${target.t}@${target.cx},${target.cy}`);
    } else if (healthy.length > 0) {
      const waypoint = this.exploreWaypoint(state);
      commands.push({ cmd: 'attack_move', unitIds: healthy.map((unit) => unit.id), cx: waypoint.cx, cy: waypoint.cy });
      notes.push(`explore ${waypoint.cx},${waypoint.cy}`);
    }

    const economy = this.chooseBuild(state);
    if (state.pending) {
      const placement = this.choosePlacement(state);
      commands.push({ cmd: 'place', cx: placement.cx, cy: placement.cy });
      notes.push(`place ${state.pending}@${placement.cx},${placement.cy}`);
    } else if (economy) {
      commands.push(economy);
      notes.push(`build ${economy.type}`);
    }

    return {
      commands,
      note: notes.join('; ') || 'hold',
    };
  }

  private hostileUnits(state: AgentState): AgentUnit[] {
    const allied = new Set(state.alliedHouses);
    return state.enemies.filter((unit) => {
      if (NON_HOSTILE_TYPES.has(unit.t)) return false;
      if (allied.has(unit.h)) return false;
      if (NON_HOSTILE_HOUSES.has(unit.h) && !unit.wpn) return false;
      return true;
    });
  }

  private visibleFriendlies(state: AgentState): AgentUnit[] {
    const allied = new Set(state.alliedHouses);
    return state.enemies.filter((unit) => allied.has(unit.h) || NON_HOSTILE_TYPES.has(unit.t));
  }

  private hostileStructures(state: AgentState): AgentStructure[] {
    const allied = new Set(state.alliedHouses);
    return state.structures.filter((structure) => !structure.ally && !allied.has(structure.h) && !NON_HOSTILE_HOUSES.has(structure.h));
  }

  private combatUnits(state: AgentState): AgentUnit[] {
    return state.units.filter((unit) => !!unit.wpn);
  }

  private chooseBuild(state: AgentState): Extract<AgentCommand, { cmd: 'build' }> | null {
    if (state.production.length > 0 || state.pending) return null;

    const alliedStructures = state.structures.filter((structure) => structure.ally);
    if (alliedStructures.length === 0) return null;

    const available = new Map(state.availableItems.map((item) => [item.t, item]));
    const structureCounts = this.counts(alliedStructures.map((structure) => structure.t));
    const unitCounts = this.counts(state.units.map((unit) => unit.t));

    if (available.has('POWR') && state.power.produced < state.power.consumed) {
      return { cmd: 'build', type: 'POWR' };
    }
    if (available.has('APWR') && state.power.produced < state.power.consumed) {
      return { cmd: 'build', type: 'APWR' };
    }
    if (!structureCounts.has('PROC') && available.has('PROC')) {
      return { cmd: 'build', type: 'PROC' };
    }
    if ((unitCounts.get('HARV') ?? 0) < 2 && available.has('HARV')) {
      return { cmd: 'build', type: 'HARV' };
    }

    const missingCore = STRUCTURE_BUILD_ORDER.find((type) => available.has(type) && !structureCounts.has(type));
    if (missingCore) {
      return { cmd: 'build', type: missingCore };
    }

    const preferredUnit = UNIT_BUILD_ORDER.find((type) => available.has(type));
    if (preferredUnit) {
      return { cmd: 'build', type: preferredUnit };
    }

    const economicStructure = ECON_STRUCTURES.find((type) => available.has(type));
    return economicStructure ? { cmd: 'build', type: economicStructure } : null;
  }

  private choosePlacement(state: AgentState): { cx: number; cy: number } {
    const anchor = this.baseAnchor(state) ?? this.mapCenter(state);
    const offset = PLACEMENT_OFFSETS[this.placementIndex % PLACEMENT_OFFSETS.length];
    return this.clampToBounds(state, anchor.cx + offset.dx, anchor.cy + offset.dy);
  }

  private exploreWaypoint(state: AgentState): { cx: number; cy: number } {
    const { x, y, w, h } = state.mapBounds;
    const points = [
      { cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) },
      { cx: x + 2, cy: y + 2 },
      { cx: x + w - 3, cy: y + 2 },
      { cx: x + w - 3, cy: y + h - 3 },
      { cx: x + 2, cy: y + h - 3 },
      { cx: x + Math.floor(w / 2), cy: y + 2 },
      { cx: x + w - 3, cy: y + Math.floor(h / 2) },
      { cx: x + Math.floor(w / 2), cy: y + h - 3 },
      { cx: x + 2, cy: y + Math.floor(h / 2) },
    ];
    const point = points[this.exploreIndex % points.length];
    this.exploreIndex++;
    return point;
  }

  private baseAnchor(state: AgentState): { cx: number; cy: number } | null {
    const alliedStructures = state.structures.filter((structure) => structure.ally);
    if (alliedStructures.length === 0) return null;

    const preferred = ['FACT', 'PROC', 'WEAP', 'TENT', 'BARR'];
    for (const type of preferred) {
      const found = alliedStructures.find((structure) => structure.t === type);
      if (found) return found;
    }
    return alliedStructures[0] ?? null;
  }

  private mapCenter(state: AgentState): { cx: number; cy: number } {
    return {
      cx: state.mapBounds.x + Math.floor(state.mapBounds.w / 2),
      cy: state.mapBounds.y + Math.floor(state.mapBounds.h / 2),
    };
  }

  private nearestToArmy(state: AgentState, units: AgentUnit[]): AgentUnit {
    const army = this.combatUnits(state);
    if (army.length === 0) return units[0];

    const centroid = army.reduce(
      (acc, unit) => ({ cx: acc.cx + unit.cx, cy: acc.cy + unit.cy }),
      { cx: 0, cy: 0 },
    );
    const origin = {
      cx: centroid.cx / army.length,
      cy: centroid.cy / army.length,
    };
    return this.nearestUnit(origin, units);
  }

  private nearestStructureToArmy(state: AgentState, structures: AgentStructure[]): AgentStructure {
    const army = this.combatUnits(state);
    if (army.length === 0) return structures[0];

    const centroid = army.reduce(
      (acc, unit) => ({ cx: acc.cx + unit.cx, cy: acc.cy + unit.cy }),
      { cx: 0, cy: 0 },
    );
    const origin = {
      cx: centroid.cx / army.length,
      cy: centroid.cy / army.length,
    };

    let best = structures[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const structure of structures) {
      const dist = this.cellDist(origin, structure);
      if (dist < bestDist) {
        best = structure;
        bestDist = dist;
      }
    }
    return best;
  }

  private nearestUnit(origin: { cx: number; cy: number }, units: AgentUnit[]): AgentUnit {
    let best = units[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const unit of units) {
      const dist = this.cellDist(origin, unit);
      if (dist < bestDist) {
        best = unit;
        bestDist = dist;
      }
    }
    return best;
  }

  private clampToBounds(state: AgentState, cx: number, cy: number): { cx: number; cy: number } {
    return {
      cx: Math.max(state.mapBounds.x + 1, Math.min(state.mapBounds.x + state.mapBounds.w - 2, cx)),
      cy: Math.max(state.mapBounds.y + 1, Math.min(state.mapBounds.y + state.mapBounds.h - 2, cy)),
    };
  }

  private counts(values: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }

  private cellDist(a: { cx: number; cy: number }, b: { cx: number; cy: number }): number {
    return Math.hypot(a.cx - b.cx, a.cy - b.cy);
  }
}
