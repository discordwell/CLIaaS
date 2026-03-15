import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  calculateHouseEdgeSpawnCell,
  executeTriggerAction,
  houseIdToHouse,
  parseScenarioINI,
  resolveTeamOriginCell,
  type ScenarioTrigger,
  type TeamMission,
  type TeamType,
  type TriggerActionResult,
} from '../engine/scenario';
import { House, Mission, UNIT_STATS, worldToCell } from '../engine/types';
import { getCampaignMissionAgents } from './raMainCampaignMissionAgents';

type ScenarioData = ReturnType<typeof parseScenarioINI>;
type Severity = 'error' | 'warn';
type SpawnActionSlot = 'action1' | 'action2';
type SpawnedEntity = TriggerActionResult['spawned'][number];

export interface TriggerSpawnIssue {
  severity: Severity;
  code: string;
  message: string;
}

export interface TriggerSpawnCheck {
  triggerName: string;
  slot: SpawnActionSlot;
  actionType: number;
  teamName: string;
  teamIndex: number;
  counts: {
    declaredMembers: number;
    supportedMembers: number;
    visibleEntities: number;
    loadedPassengers: number;
  };
  issues: TriggerSpawnIssue[];
}

export interface TriggerSpawnReport {
  scenarioId: string;
  issues: TriggerSpawnIssue[];
  checks: TriggerSpawnCheck[];
  counts: {
    spawnActions: number;
    declaredMembers: number;
    supportedMembers: number;
    visibleEntities: number;
    loadedPassengers: number;
    unsupportedMemberTypes: number;
  };
}

const SPAWN_ACTIONS = new Set([4, 7]);

function normalizeHouse(name: string): House {
  switch (name.toLowerCase()) {
    case 'spain': return House.Spain;
    case 'greece': return House.Greece;
    case 'england': return House.England;
    case 'france': return House.France;
    case 'ussr': return House.USSR;
    case 'ukraine': return House.Ukraine;
    case 'germany': return House.Germany;
    case 'turkey': return House.Turkey;
    case 'goodguy': return House.GoodGuy;
    case 'badguy': return House.BadGuy;
    case 'neutral':
    case 'special':
    default:
      return House.Neutral;
  }
}

function loadScenarioData(scenarioId: string): ScenarioData {
  const scenarioPath = path.join(process.cwd(), 'public', 'ra', 'assets', `${scenarioId}.ini`);
  const text = fs.readFileSync(scenarioPath, 'utf8');
  return parseScenarioINI(text);
}

function withFixedRandom<T>(fn: () => T): T {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function formatActionType(actionType: number): string {
  return actionType === 4 ? 'CREATE_TEAM' : 'REINFORCEMENTS';
}

function formatMissionSequence(missions: TeamMission[]): string {
  return missions.map((mission) => `${mission.mission}:${mission.data}`).join(' -> ');
}

function countDeclaredMembers(team: TeamType, supportedOnly = false): number {
  let total = 0;
  for (const member of team.members) {
    if (supportedOnly && !UNIT_STATS[member.type]) {
      continue;
    }
    total += member.count;
  }
  return total;
}

function collectUnsupportedMemberTypes(team: TeamType): string[] {
  return [...new Set(team.members.filter((member) => !UNIT_STATS[member.type]).map((member) => member.type))].sort();
}

function countTypeMultiset(team: TeamType): Map<string, number> {
  const counts = new Map<string, number>();
  for (const member of team.members) {
    if (!UNIT_STATS[member.type]) {
      continue;
    }
    counts.set(member.type, (counts.get(member.type) ?? 0) + member.count);
  }
  return counts;
}

function countEntityTypes(entities: Array<{ type: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
  }
  return counts;
}

function diffTypeMultisets(expected: Map<string, number>, actual: Map<string, number>): { missing: string[]; extra: string[] } {
  const actualCounts = new Map(actual);
  const missing: string[] = [];

  for (const [type, count] of expected) {
    const actualCount = actualCounts.get(type) ?? 0;
    if (actualCount < count) {
      missing.push(`${type} x${count - actualCount}`);
    }
    if (actualCount > count) {
      actualCounts.set(type, actualCount - count);
    } else {
      actualCounts.delete(type);
    }
  }

  const extra = [...actualCounts.entries()].map(([type, count]) => `${type} x${count}`).sort();
  return { missing: missing.sort(), extra };
}

function collectCreatedEntities(visible: SpawnedEntity[]): SpawnedEntity[] {
  const created: SpawnedEntity[] = [];
  const stack = [...visible];
  while (stack.length > 0) {
    const entity = stack.shift()!;
    created.push(entity);
    for (const passenger of entity.passengers ?? []) {
      stack.push(passenger);
    }
  }
  return created;
}

function getFirstSupportedTransportCapacity(team: TeamType): number {
  for (const member of team.members) {
    const stats = UNIT_STATS[member.type];
    const passengers = stats?.passengers ?? 0;
    if (passengers > 0) {
      return passengers;
    }
  }
  return 0;
}

function countSupportedInfantry(team: TeamType): number {
  let total = 0;
  for (const member of team.members) {
    const stats = UNIT_STATS[member.type];
    if (stats?.isInfantry) {
      total += member.count;
    }
  }
  return total;
}

function buildHouseEdges(data: ScenarioData): Map<House, string> {
  const houseEdges = new Map<House, string>([
    [House.Spain, 'North'],
    [House.Greece, 'North'],
    [House.England, 'North'],
    [House.France, 'North'],
    [House.USSR, 'North'],
    [House.Ukraine, 'North'],
    [House.Germany, 'North'],
    [House.Turkey, 'North'],
    [House.GoodGuy, 'North'],
    [House.BadGuy, 'North'],
    [House.Neutral, 'North'],
  ]);

  for (const [houseName, edge] of data.houseEdges.entries()) {
    houseEdges.set(normalizeHouse(houseName), edge);
  }

  return houseEdges;
}

function resolveOriginCell(
  team: TeamType,
  data: ScenarioData,
  houseEdges: Map<House, string>,
): { cell?: { cx: number; cy: number }; entryCell?: { cx: number; cy: number }; issue?: string } {
  const house = houseIdToHouse(team.house);
  const cell = resolveTeamOriginCell(team.origin, house, data.waypoints, houseEdges, data.mapBounds, () => 0.5);
  if (cell) {
    return {
      cell,
      entryCell: calculateHouseEdgeSpawnCell(house, houseEdges, data.mapBounds, cell, () => 0.5) ?? cell,
    };
  }

  const fallback = calculateHouseEdgeSpawnCell(house, houseEdges, data.mapBounds, undefined, () => 0.5);
  if (fallback) {
    return { cell: fallback, entryCell: fallback };
  }

  const edge = (houseEdges.get(house) ?? 'North').toLowerCase();
  return { issue: `house ${House[house] ?? team.house} uses unknown edge "${edge}"` };
}

function cellsEqual(a: { cx: number; cy: number }, b: { cx: number; cy: number }): boolean {
  return a.cx === b.cx && a.cy === b.cy;
}

function compareTeamMissions(expected: TeamMission[], actual: TeamMission[] | null | undefined): boolean {
  if (expected.length === 0) {
    return !actual || actual.length === 0;
  }
  if (!actual || actual.length !== expected.length) {
    return false;
  }
  return expected.every((mission, index) =>
    actual[index].mission === mission.mission && actual[index].data === mission.data,
  );
}

function auditSpawnCheck(
  scenarioId: string,
  trigger: ScenarioTrigger,
  slot: SpawnActionSlot,
  data: ScenarioData,
): TriggerSpawnCheck {
  const action = trigger[slot];
  const issues: TriggerSpawnIssue[] = [];
  const team = data.teamTypes[action.team];

  if (!team) {
    return {
      triggerName: trigger.name,
      slot,
      actionType: action.action,
      teamName: `missing:${action.team}`,
      teamIndex: action.team,
      counts: {
        declaredMembers: 0,
        supportedMembers: 0,
        visibleEntities: 0,
        loadedPassengers: 0,
      },
      issues: [{
        severity: 'error',
        code: 'missing-spawn-team',
        message: `${scenarioId}: trigger "${trigger.name}" ${slot} uses ${formatActionType(action.action)} with missing team index ${action.team}`,
      }],
    };
  }

  const declaredMembers = countDeclaredMembers(team);
  const supportedMembers = countDeclaredMembers(team, true);
  const unsupportedMemberTypes = collectUnsupportedMemberTypes(team);
  const houseEdges = buildHouseEdges(data);
  const origin = resolveOriginCell(team, data, houseEdges);

  if (unsupportedMemberTypes.length > 0) {
    issues.push({
      severity: 'error',
      code: 'unsupported-team-member-type',
      message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" uses unsupported spawn types: ${unsupportedMemberTypes.join(', ')}`,
    });
  }
  if (origin.issue) {
    issues.push({
      severity: 'error',
      code: 'invalid-spawn-origin',
      message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" cannot resolve spawn origin: ${origin.issue}`,
    });
  }

  const result = withFixedRandom(() => executeTriggerAction(
    action,
    data.teamTypes,
    data.waypoints,
    new Set<number>(),
    data.triggers,
    undefined,
    houseEdges,
    data.mapBounds,
  ));
  const visibleEntities = result.spawned;
  const createdEntities = collectCreatedEntities(visibleEntities);
  const loadedPassengers = createdEntities.length - visibleEntities.length;
  const hasInvalidOrigin = Boolean(origin.issue);

  if (!hasInvalidOrigin && supportedMembers > 0 && createdEntities.length === 0) {
    issues.push({
      severity: 'error',
      code: 'spawned-no-entities',
      message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" should create ${supportedMembers} supported members but spawned nothing`,
    });
  }

  if (!hasInvalidOrigin && createdEntities.length !== supportedMembers) {
    issues.push({
      severity: 'error',
      code: 'spawn-count-mismatch',
      message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" created ${createdEntities.length} entities/passengers, expected ${supportedMembers} supported members`,
    });
  }

  const typeDiff = diffTypeMultisets(countTypeMultiset(team), countEntityTypes(createdEntities));
  if (!hasInvalidOrigin && (typeDiff.missing.length > 0 || typeDiff.extra.length > 0)) {
    issues.push({
      severity: 'error',
      code: 'spawn-type-mismatch',
      message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" type mismatch; missing [${typeDiff.missing.join(', ') || 'none'}], extra [${typeDiff.extra.join(', ') || 'none'}]`,
    });
  }

  const expectedTransportCapacity = getFirstSupportedTransportCapacity(team);
  const expectedLoadedPassengers = Math.min(countSupportedInfantry(team), expectedTransportCapacity);
  if (loadedPassengers !== expectedLoadedPassengers) {
    issues.push({
      severity: 'error',
      code: 'transport-passenger-mismatch',
      message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" loaded ${loadedPassengers} passengers, expected ${expectedLoadedPassengers}`,
    });
  }

  const expectedHouse = houseIdToHouse(team.house);
  const expectedTriggerName = team.trigger >= 0 && team.trigger < data.triggers.length
    ? data.triggers[team.trigger].name
    : '';
  const expectedSuicide = (team.flags & 2) !== 0;
  const missionSummary = formatMissionSequence(team.missions);

  let houseMismatch = 0;
  let triggerMismatch = 0;
  let suicideMismatch = 0;
  let missionMismatch = 0;
  let missionIndexMismatch = 0;

  for (const entity of createdEntities) {
    if (entity.house !== expectedHouse) {
      houseMismatch += 1;
    }
    if ((entity.triggerName ?? '') !== expectedTriggerName) {
      triggerMismatch += 1;
    }
    if (Boolean(entity.isSuicide) !== expectedSuicide) {
      suicideMismatch += 1;
    }
    if (!compareTeamMissions(team.missions, entity.teamMissions)) {
      missionMismatch += 1;
    }
    if (team.missions.length > 0 && entity.teamMissionIndex !== 0) {
      missionIndexMismatch += 1;
    }
  }

  if (houseMismatch > 0) {
    issues.push({
      severity: 'error',
      code: 'spawn-house-mismatch',
      message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" spawned ${houseMismatch} members with the wrong house`,
    });
  }
  if (triggerMismatch > 0) {
    issues.push({
      severity: 'error',
      code: 'spawn-trigger-mismatch',
      message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" spawned ${triggerMismatch} members with trigger "${expectedTriggerName || 'None'}" mismatch`,
    });
  }
  if (suicideMismatch > 0) {
    issues.push({
      severity: 'error',
      code: 'spawn-suicide-flag-mismatch',
      message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" mismatched the IsSuicide flag on ${suicideMismatch} spawned members`,
    });
  }
  if (missionMismatch > 0) {
    issues.push({
      severity: 'error',
      code: 'spawn-team-mission-mismatch',
      message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" spawned ${missionMismatch} members with the wrong team mission script (${missionSummary || 'none'})`,
    });
  }
  if (missionIndexMismatch > 0) {
    issues.push({
      severity: 'error',
      code: 'spawn-team-mission-index-mismatch',
      message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" did not reset teamMissionIndex to 0 on ${missionIndexMismatch} spawned members`,
    });
  }

  if (origin.cell) {
    for (const entity of visibleEntities) {
      const cell = worldToCell(entity.pos.x, entity.pos.y);
      if (entity.stats.isAircraft) {
        if (origin.entryCell && !cellsEqual(cell, origin.entryCell)) {
          issues.push({
            severity: 'error',
            code: 'aircraft-spawn-position-mismatch',
            message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> aircraft team "${team.name}" spawned ${entity.type} at (${cell.cx},${cell.cy}) instead of (${origin.entryCell.cx},${origin.entryCell.cy})`,
          });
        }
        if (entity.mission !== Mission.MOVE || !entity.moveTarget || !cellsEqual(worldToCell(entity.moveTarget.x, entity.moveTarget.y), origin.cell)) {
          issues.push({
            severity: 'error',
            code: 'aircraft-spawn-target-mismatch',
            message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> aircraft team "${team.name}" did not start with MOVE toward (${origin.cell.cx},${origin.cell.cy})`,
          });
        }
      } else if (!cellsEqual(cell, origin.cell)) {
        issues.push({
          severity: 'error',
          code: 'ground-spawn-position-mismatch',
          message: `${scenarioId}: trigger "${trigger.name}" ${slot} -> team "${team.name}" spawned ${entity.type} at (${cell.cx},${cell.cy}) instead of (${origin.cell.cx},${origin.cell.cy})`,
        });
      }
    }
  }

  return {
    triggerName: trigger.name,
    slot,
    actionType: action.action,
    teamName: team.name,
    teamIndex: action.team,
    counts: {
      declaredMembers,
      supportedMembers,
      visibleEntities: visibleEntities.length,
      loadedPassengers,
    },
    issues,
  };
}

export function auditScenarioTriggerSpawns(scenarioId: string): TriggerSpawnReport {
  const data = loadScenarioData(scenarioId);
  const checks: TriggerSpawnCheck[] = [];

  for (const trigger of data.triggers) {
    for (const slot of ['action1', 'action2'] as const) {
      if (!SPAWN_ACTIONS.has(trigger[slot].action) || trigger[slot].team < 0) {
        continue;
      }
      checks.push(auditSpawnCheck(scenarioId, trigger, slot, data));
    }
  }

  const issues = checks.flatMap((check) => check.issues);
  const unsupportedMemberTypes = new Set<string>();
  for (const check of checks) {
    for (const issue of check.issues) {
      if (issue.code !== 'unsupported-team-member-type') {
        continue;
      }
      const match = issue.message.match(/unsupported spawn types: (.+)$/);
      if (!match) {
        continue;
      }
      for (const type of match[1].split(',').map((value) => value.trim())) {
        unsupportedMemberTypes.add(type);
      }
    }
  }

  return {
    scenarioId,
    issues,
    checks,
    counts: {
      spawnActions: checks.length,
      declaredMembers: checks.reduce((sum, check) => sum + check.counts.declaredMembers, 0),
      supportedMembers: checks.reduce((sum, check) => sum + check.counts.supportedMembers, 0),
      visibleEntities: checks.reduce((sum, check) => sum + check.counts.visibleEntities, 0),
      loadedPassengers: checks.reduce((sum, check) => sum + check.counts.loadedPassengers, 0),
      unsupportedMemberTypes: unsupportedMemberTypes.size,
    },
  };
}

export function runCampaignTriggerSpawnAudit(): TriggerSpawnReport[] {
  const scenarioIds = [...new Set(getCampaignMissionAgents().map((agent) => agent.scenarioId))];
  return scenarioIds.map((scenarioId) => auditScenarioTriggerSpawns(scenarioId));
}

export function formatCampaignTriggerSpawnMarkdown(reports: TriggerSpawnReport[]): string {
  const lines: string[] = [
    '# Campaign Trigger Spawn Parity',
    '',
  ];

  for (const report of reports) {
    lines.push(`## ${report.scenarioId}`);
    lines.push('');
    lines.push(`- Spawn actions: ${report.counts.spawnActions}`);
    lines.push(`- Declared members: ${report.counts.declaredMembers}`);
    lines.push(`- Supported members: ${report.counts.supportedMembers}`);
    lines.push(`- Visible entities: ${report.counts.visibleEntities}`);
    lines.push(`- Loaded passengers: ${report.counts.loadedPassengers}`);
    lines.push(`- Unsupported member types: ${report.counts.unsupportedMemberTypes}`);
    if (report.issues.length === 0) {
      lines.push('- Issues: none');
    } else {
      for (const issue of report.issues) {
        lines.push(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
