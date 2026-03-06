export interface AgentLikeUnit {
  id: number;
  t: string;
  cx: number;
  cy: number;
  hp: number;
}

export interface AgentLikeStructure {
  t: string;
  cx: number;
  cy: number;
  hp: number;
  ally: boolean;
}

export interface AgentLikeState {
  tick: number;
  credits: number;
  power: { produced: number; consumed: number };
  units: AgentLikeUnit[];
  enemies: AgentLikeUnit[];
  structures: AgentLikeStructure[];
  production?: Array<{ t: string; prog?: number }>;
  error?: string;
}

export interface StateDiff {
  kind: string;
  key: string;
  ts: unknown;
  wasm: unknown;
}

export interface StateDiffReport {
  diffCount: number;
  diffs: StateDiff[];
}

function groupCounts(items: Array<{ t: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.t] = (counts[item.t] ?? 0) + 1;
  }
  return counts;
}

function groupCells(items: Array<{ t: string; cx: number; cy: number }>): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const item of items) {
    (grouped[item.t] ??= []).push(`${item.cx},${item.cy}`);
  }
  for (const values of Object.values(grouped)) {
    values.sort();
  }
  return grouped;
}

function groupHp(items: Array<{ t: string; hp: number }>): Record<string, number[]> {
  const grouped: Record<string, number[]> = {};
  for (const item of items) {
    (grouped[item.t] ??= []).push(item.hp);
  }
  for (const values of Object.values(grouped)) {
    values.sort((a, b) => a - b);
  }
  return grouped;
}

function pushRecordDiffs(
  diffs: StateDiff[],
  kind: string,
  keyPrefix: string,
  tsRecord: Record<string, unknown>,
  wasmRecord: Record<string, unknown>,
): void {
  const keys = new Set([...Object.keys(tsRecord), ...Object.keys(wasmRecord)]);
  for (const key of [...keys].sort()) {
    const tsValue = tsRecord[key];
    const wasmValue = wasmRecord[key];
    if (JSON.stringify(tsValue) !== JSON.stringify(wasmValue)) {
      diffs.push({
        kind,
        key: `${keyPrefix}.${key}`,
        ts: tsValue ?? null,
        wasm: wasmValue ?? null,
      });
    }
  }
}

export function compareStates(tsState: AgentLikeState, wasmState: AgentLikeState): StateDiffReport {
  const diffs: StateDiff[] = [];

  if (tsState.error || wasmState.error) {
    if (tsState.error !== wasmState.error) {
      diffs.push({ kind: 'state', key: 'error', ts: tsState.error ?? null, wasm: wasmState.error ?? null });
    }
    return { diffCount: diffs.length, diffs };
  }

  if (tsState.credits !== wasmState.credits) {
    diffs.push({ kind: 'top_level', key: 'credits', ts: tsState.credits, wasm: wasmState.credits });
  }
  if (tsState.power.produced !== wasmState.power.produced) {
    diffs.push({
      kind: 'top_level',
      key: 'power.produced',
      ts: tsState.power.produced,
      wasm: wasmState.power.produced,
    });
  }
  if (tsState.power.consumed !== wasmState.power.consumed) {
    diffs.push({
      kind: 'top_level',
      key: 'power.consumed',
      ts: tsState.power.consumed,
      wasm: wasmState.power.consumed,
    });
  }

  pushRecordDiffs(diffs, 'unit_counts', 'units', groupCounts(tsState.units), groupCounts(wasmState.units));
  pushRecordDiffs(diffs, 'unit_counts', 'enemies', groupCounts(tsState.enemies), groupCounts(wasmState.enemies));
  pushRecordDiffs(diffs, 'unit_cells', 'units', groupCells(tsState.units), groupCells(wasmState.units));
  pushRecordDiffs(diffs, 'unit_cells', 'enemies', groupCells(tsState.enemies), groupCells(wasmState.enemies));
  pushRecordDiffs(diffs, 'unit_hp', 'units', groupHp(tsState.units), groupHp(wasmState.units));
  pushRecordDiffs(diffs, 'unit_hp', 'enemies', groupHp(tsState.enemies), groupHp(wasmState.enemies));

  const tsAlliedStructures = tsState.structures.filter(structure => structure.ally);
  const wasmAlliedStructures = wasmState.structures.filter(structure => structure.ally);
  const tsEnemyStructures = tsState.structures.filter(structure => !structure.ally);
  const wasmEnemyStructures = wasmState.structures.filter(structure => !structure.ally);

  pushRecordDiffs(diffs, 'structure_counts', 'structures.ally', groupCounts(tsAlliedStructures), groupCounts(wasmAlliedStructures));
  pushRecordDiffs(diffs, 'structure_counts', 'structures.enemy', groupCounts(tsEnemyStructures), groupCounts(wasmEnemyStructures));
  pushRecordDiffs(diffs, 'structure_cells', 'structures.ally', groupCells(tsAlliedStructures), groupCells(wasmAlliedStructures));
  pushRecordDiffs(diffs, 'structure_cells', 'structures.enemy', groupCells(tsEnemyStructures), groupCells(wasmEnemyStructures));
  pushRecordDiffs(diffs, 'structure_hp', 'structures.ally', groupHp(tsAlliedStructures), groupHp(wasmAlliedStructures));
  pushRecordDiffs(diffs, 'structure_hp', 'structures.enemy', groupHp(tsEnemyStructures), groupHp(wasmEnemyStructures));

  const tsProduction = (tsState.production ?? []).map(item => item.t).sort();
  const wasmProduction = (wasmState.production ?? []).map(item => item.t).sort();
  if (JSON.stringify(tsProduction) !== JSON.stringify(wasmProduction)) {
    diffs.push({ kind: 'production', key: 'types', ts: tsProduction, wasm: wasmProduction });
  }

  return { diffCount: diffs.length, diffs };
}
