import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  parseScenarioINI,
  type ScenarioTrigger,
  type TeamMission,
  type TeamType,
  type TriggerAction,
  type TriggerEvent,
} from '../engine/scenario';

type ScenarioData = ReturnType<typeof parseScenarioINI>;

type Severity = 'error' | 'warn';

export interface MissionAuditIssue {
  severity: Severity;
  code: string;
  message: string;
}

export interface MissionAuditFact {
  key: string;
  value: string;
}

export interface MissionAuditRuntimeCoverage {
  teamMissionIds: number[];
  unsupportedTeamMissionIds: number[];
  eventIds: number[];
  unsupportedEventIds: number[];
  actionIds: number[];
  unsupportedActionIds: number[];
}

export interface MissionAuditReport {
  scenarioId: string;
  title: string;
  issues: MissionAuditIssue[];
  facts: MissionAuditFact[];
  runtime: MissionAuditRuntimeCoverage;
  counts: {
    triggers: number;
    teams: number;
    cellTriggers: number;
    attachedObjectTriggers: number;
  };
}

export interface MissionAuditAgent {
  scenarioId: string;
  title: string;
  analyze(ctx: MissionAuditContext): void;
}

type TriggerSlot = 'event1' | 'event2' | 'action1' | 'action2';

const TEVENT_NAMES: Record<number, string> = {
  0: 'NONE',
  1: 'PLAYER_ENTERED',
  2: 'SPIED',
  3: 'THIEVED',
  4: 'DISCOVERED',
  5: 'HOUSE_DISCOVERED',
  6: 'ATTACKED',
  7: 'DESTROYED',
  8: 'ANY',
  9: 'UNITS_DESTROYED',
  10: 'BUILDINGS_DESTROYED',
  11: 'ALL_DESTROYED',
  12: 'CREDITS',
  13: 'TIME',
  14: 'MISSION_TIMER_EXPIRED',
  15: 'NBUILDINGS_DESTROYED',
  16: 'NUNITS_DESTROYED',
  17: 'NOFACTORIES',
  18: 'EVAC_CIVILIAN',
  19: 'BUILD',
  20: 'BUILD_UNIT',
  21: 'BUILD_INFANTRY',
  22: 'BUILD_AIRCRAFT',
  23: 'LEAVES_MAP',
  24: 'ENTERS_ZONE',
  25: 'CROSS_HORIZONTAL',
  26: 'CROSS_VERTICAL',
  27: 'GLOBAL_SET',
  28: 'GLOBAL_CLEAR',
  29: 'FAKES_DESTROYED',
  30: 'LOW_POWER',
  31: 'ALL_BRIDGES_DESTROYED',
  32: 'BUILDING_EXISTS',
};

const TACTION_NAMES: Record<number, string> = {
  0: 'NONE',
  1: 'WIN',
  2: 'LOSE',
  3: 'BEGIN_PRODUCTION',
  4: 'CREATE_TEAM',
  5: 'DESTROY_TEAM',
  6: 'ALL_HUNT',
  7: 'REINFORCEMENTS',
  8: 'DZ',
  9: 'FIRE_SALE',
  10: 'PLAY_MOVIE',
  11: 'TEXT_TRIGGER',
  12: 'DESTROY_TRIGGER',
  13: 'AUTOCREATE',
  15: 'ALLOWWIN',
  16: 'REVEAL_MAP',
  17: 'REVEAL_SOME',
  18: 'REVEAL_ZONE',
  19: 'PLAY_SOUND',
  20: 'PLAY_MUSIC',
  21: 'PLAY_SPEECH',
  22: 'FORCE_TRIGGER',
  23: 'START_TIMER',
  24: 'STOP_TIMER',
  25: 'TIMER_EXTEND',
  26: 'SUB_TIMER',
  27: 'SET_TIMER',
  28: 'SET_GLOBAL',
  29: 'CLEAR_GLOBAL',
  31: 'CREEP_SHADOW',
  32: 'DESTROY_OBJECT',
  33: '1_SPECIAL',
  34: 'FULL_SPECIAL',
  35: 'PREFERRED_TARGET',
  36: 'LAUNCH_NUKES',
};

const TMISSION_NAMES: Record<number, string> = {
  0: 'ATTACK',
  1: 'ATT_WAYPT',
  2: 'CHANGE_FORMATION',
  3: 'MOVE',
  4: 'MOVECELL',
  5: 'GUARD',
  6: 'LOOP',
  7: 'ATTACKTARCOM',
  8: 'UNLOAD',
  9: 'DEPLOY',
  10: 'HOUND_DOG',
  11: 'DO',
  12: 'SET_GLOBAL',
  13: 'IDLE',
  14: 'LOAD',
  15: 'SPY',
  16: 'PATROL',
};

const SUPPORTED_TRIGGER_EVENTS = new Set<number>([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 29, 30, 31, 32,
]);

const SUPPORTED_TRIGGER_ACTIONS = new Set<number>([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 31, 32, 33, 34, 35, 36,
]);

export const SUPPORTED_TEAM_MISSIONS = new Set<number>([
  0, 1, 3, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]);

const EVENT_TYPES_WITH_TEAM_REFS = new Set<number>([
  23, // LEAVES_MAP
]);

const ACTION_TYPES_WITH_TEAM_REFS = new Set<number>([
  4, // CREATE_TEAM
  5, // DESTROY_TEAM
  7, // REINFORCEMENTS
]);

const ACTION_TYPES_WITH_TRIGGER_REFS = new Set<number>([
  12, // DESTROY_TRIGGER
  22, // FORCE_TRIGGER
]);

const ALLIED_MISSION_TITLES: Record<string, string> = {
  SCG01EA: 'Allied 1',
  SCG02EA: 'Allied 2',
  SCG03EA: 'Allied 3',
  SCG04EA: 'Allied 4',
  SCG05EA: 'Allied 5',
  SCG06EA: 'Allied 6',
  SCG07EA: 'Allied 7',
  SCG08EA: 'Allied 8',
  SCG09EA: 'Allied 9',
  SCG10EA: 'Allied 10',
  SCU01EA: 'Soviet 1',
  SCU02EA: 'Soviet 2',
  SCU03EA: 'Soviet 3',
  SCU04EA: 'Soviet 4',
  SCU05EA: 'Soviet 5',
};

function uniqueSorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function missionName(id: number): string {
  return TMISSION_NAMES[id] ?? `UNKNOWN_${id}`;
}

function eventName(id: number): string {
  return TEVENT_NAMES[id] ?? `UNKNOWN_${id}`;
}

function actionName(id: number): string {
  return TACTION_NAMES[id] ?? `UNKNOWN_${id}`;
}

function formatMissionSequence(missions: TeamMission[]): string {
  return missions.map((mission) => `${missionName(mission.mission)}(${mission.data})`).join(' -> ');
}

function resolveScenarioPath(scenarioId: string): string {
  return path.join(process.cwd(), 'public', 'ra', 'assets', `${scenarioId}.ini`);
}

function loadScenarioData(scenarioId: string): ScenarioData {
  const scenarioPath = resolveScenarioPath(scenarioId);
  return parseScenarioINI(fs.readFileSync(scenarioPath, 'utf8'));
}

function buildRuntimeCoverage(data: ScenarioData): MissionAuditRuntimeCoverage {
  const teamMissionIds = uniqueSorted(
    data.teamTypes.flatMap((team) => team.missions.map((mission) => mission.mission)),
  );
  const eventIds = uniqueSorted(
    data.triggers.flatMap((trigger) => [trigger.event1.type, trigger.event2.type]),
  );
  const actionIds = uniqueSorted(
    data.triggers.flatMap((trigger) => [trigger.action1.action, trigger.action2.action]),
  );

  return {
    teamMissionIds,
    unsupportedTeamMissionIds: teamMissionIds.filter((id) => !SUPPORTED_TEAM_MISSIONS.has(id)),
    eventIds,
    unsupportedEventIds: eventIds.filter((id) => !SUPPORTED_TRIGGER_EVENTS.has(id)),
    actionIds,
    unsupportedActionIds: actionIds.filter((id) => !SUPPORTED_TRIGGER_ACTIONS.has(id)),
  };
}

function isRealTriggerName(value: string | undefined): value is string {
  if (!value) return false;
  const normalized = value.trim();
  return normalized !== '' && normalized.toLowerCase() !== 'none' && normalized !== '<none>';
}

class MissionAuditContext {
  readonly issues: MissionAuditIssue[] = [];
  readonly facts: MissionAuditFact[] = [];
  readonly triggerByName: Map<string, ScenarioTrigger>;
  readonly triggerNameByIndex: string[];
  readonly triggerIndexByName: Map<string, number>;
  readonly teamByName: Map<string, TeamType>;
  readonly teamNameByIndex: string[];
  readonly teamIndexByName: Map<string, number>;
  readonly runtime: MissionAuditRuntimeCoverage;
  readonly data: ScenarioData;
  readonly scenarioId: string;
  readonly title: string;

  constructor(scenarioId: string, title: string, data: ScenarioData) {
    this.scenarioId = scenarioId;
    this.title = title;
    this.data = data;
    this.triggerByName = new Map(data.triggers.map((trigger) => [trigger.name, trigger]));
    this.triggerNameByIndex = data.triggers.map((trigger) => trigger.name);
    this.triggerIndexByName = new Map(this.triggerNameByIndex.map((name, index) => [name, index]));
    this.teamByName = new Map(data.teamTypes.map((team) => [team.name, team]));
    this.teamNameByIndex = data.teamTypes.map((team) => team.name);
    this.teamIndexByName = new Map(this.teamNameByIndex.map((name, index) => [name, index]));
    this.runtime = buildRuntimeCoverage(data);
  }

  fact(key: string, value: string): void {
    this.facts.push({ key, value });
  }

  error(code: string, message: string): void {
    this.issues.push({ severity: 'error', code, message });
  }

  warn(code: string, message: string): void {
    this.issues.push({ severity: 'warn', code, message });
  }

  requireTrigger(name: string): ScenarioTrigger | undefined {
    const trigger = this.triggerByName.get(name);
    if (!trigger) {
      this.error('missing-trigger', `${this.scenarioId}: trigger "${name}" is missing`);
    }
    return trigger;
  }

  requireTeam(name: string): TeamType | undefined {
    const team = this.teamByName.get(name);
    if (!team) {
      this.error('missing-team', `${this.scenarioId}: team "${name}" is missing`);
    }
    return team;
  }

  expectEvent(triggerName: string, event: TriggerEvent, expectedType: number, expectedData?: number): void {
    if (event.type !== expectedType || (expectedData !== undefined && event.data !== expectedData)) {
      const actual = `${eventName(event.type)}(${event.data})`;
      const expected = `${eventName(expectedType)}(${expectedData ?? event.data})`;
      this.error('trigger-event-mismatch', `${this.scenarioId}: trigger "${triggerName}" expected ${expected}, found ${actual}`);
    }
  }

  expectAction(triggerName: string, action: TriggerAction, expectedType: number, expectedData?: number): void {
    if (action.action !== expectedType || (expectedData !== undefined && action.data !== expectedData)) {
      const actual = `${actionName(action.action)}(${action.data})`;
      const expected = `${actionName(expectedType)}(${expectedData ?? action.data})`;
      this.error('trigger-action-mismatch', `${this.scenarioId}: trigger "${triggerName}" expected ${expected}, found ${actual}`);
    }
  }

  expectActionTeam(triggerName: string, slot: 'action1' | 'action2', expectedTeam: string): void {
    const trigger = this.requireTrigger(triggerName);
    if (!trigger) return;
    const action = trigger[slot];
    const actualTeam = this.teamNameByIndex[action.team];
    if (actualTeam !== expectedTeam) {
      this.error(
        'trigger-team-ref-mismatch',
        `${this.scenarioId}: trigger "${triggerName}" ${slot} expected team "${expectedTeam}", found "${actualTeam ?? action.team}"`,
      );
    }
  }

  expectActionTrigger(triggerName: string, slot: 'action1' | 'action2', expectedTrigger: string): void {
    const trigger = this.requireTrigger(triggerName);
    if (!trigger) return;
    const action = trigger[slot];
    const actualTrigger = this.triggerNameByIndex[action.trigger];
    if (actualTrigger !== expectedTrigger) {
      this.error(
        'trigger-trigger-ref-mismatch',
        `${this.scenarioId}: trigger "${triggerName}" ${slot} expected trigger "${expectedTrigger}", found "${actualTrigger ?? action.trigger}"`,
      );
    }
  }

  expectTeamTrigger(teamName: string, expectedTrigger: string): void {
    const team = this.requireTeam(teamName);
    if (!team) return;
    const actualTrigger = this.triggerNameByIndex[team.trigger];
    if (actualTrigger !== expectedTrigger) {
      this.error(
        'team-trigger-ref-mismatch',
        `${this.scenarioId}: team "${teamName}" expected trigger "${expectedTrigger}", found "${actualTrigger ?? team.trigger}"`,
      );
    }
  }

  expectTeamMissions(teamName: string, expected: Array<{ mission: number; data: number }>): void {
    const team = this.requireTeam(teamName);
    if (!team) return;
    const actual = team.missions.map((mission) => ({ mission: mission.mission, data: mission.data }));
    const wanted = expected.map((mission) => ({ mission: mission.mission, data: mission.data }));
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      this.error(
        'team-mission-sequence-mismatch',
        `${this.scenarioId}: team "${teamName}" expected ${formatMissionSequence(expected)}, found ${formatMissionSequence(team.missions)}`,
      );
    }
  }

  runGenericChecks(): void {
    for (const [index, trigger] of this.data.triggers.entries()) {
      this.checkTriggerRef(index, trigger, 'event1');
      this.checkTriggerRef(index, trigger, 'event2');
      this.checkTriggerRef(index, trigger, 'action1');
      this.checkTriggerRef(index, trigger, 'action2');
    }

    for (const [index, team] of this.data.teamTypes.entries()) {
      if (team.trigger >= 0 && !this.triggerNameByIndex[team.trigger]) {
        this.error(
          'dangling-team-trigger',
          `${this.scenarioId}: team "${team.name}" has missing trigger index ${team.trigger} at team slot ${index}`,
        );
      }
      for (const mission of team.missions) {
        if (!SUPPORTED_TEAM_MISSIONS.has(mission.mission)) {
          this.error(
            'unsupported-team-mission',
            `${this.scenarioId}: team "${team.name}" uses unsupported team mission ${missionName(mission.mission)}(${mission.data})`,
          );
        }
      }
    }

    for (const triggerName of this.data.cellTriggers.values()) {
      if (!this.triggerByName.has(triggerName)) {
        this.error('dangling-cell-trigger', `${this.scenarioId}: cell trigger "${triggerName}" does not exist in [Trigs]`);
      }
    }

    for (const source of [...this.data.units, ...this.data.infantry, ...this.data.structures]) {
      if (isRealTriggerName(source.trigger) && !this.triggerByName.has(source.trigger)) {
        this.error(
          'dangling-object-trigger',
          `${this.scenarioId}: attached trigger "${source.trigger}" is referenced by a placed object but missing from [Trigs]`,
        );
      }
    }

    for (const id of this.runtime.unsupportedEventIds) {
      this.error('unsupported-trigger-event', `${this.scenarioId}: scenario uses unsupported trigger event ${eventName(id)}(${id})`);
    }
    for (const id of this.runtime.unsupportedActionIds) {
      this.error('unsupported-trigger-action', `${this.scenarioId}: scenario uses unsupported trigger action ${actionName(id)}(${id})`);
    }
  }

  private checkTriggerRef(index: number, trigger: ScenarioTrigger, slot: TriggerSlot): void {
    if (slot === 'event1' || slot === 'event2') {
      const event = trigger[slot];
      if (EVENT_TYPES_WITH_TEAM_REFS.has(event.type) && event.team >= 0 && !this.teamNameByIndex[event.team]) {
        this.error(
          'dangling-event-team-ref',
          `${this.scenarioId}: trigger "${trigger.name}" ${slot} references missing team index ${event.team} at trigger slot ${index}`,
        );
      }
      return;
    }

    const action = trigger[slot];
    if (ACTION_TYPES_WITH_TEAM_REFS.has(action.action) && action.team >= 0 && !this.teamNameByIndex[action.team]) {
      this.error(
        'dangling-action-team-ref',
        `${this.scenarioId}: trigger "${trigger.name}" ${slot} references missing team index ${action.team} at trigger slot ${index}`,
      );
    }
    if (ACTION_TYPES_WITH_TRIGGER_REFS.has(action.action) && action.trigger >= 0 && !this.triggerNameByIndex[action.trigger]) {
      this.error(
        'dangling-action-trigger-ref',
        `${this.scenarioId}: trigger "${trigger.name}" ${slot} references missing trigger index ${action.trigger} at trigger slot ${index}`,
      );
    }
  }
}

const alliedMissionAgents: MissionAuditAgent[] = [
  {
    scenarioId: 'SCG01EA',
    title: 'Allied 1 rescue chain',
    analyze(ctx) {
      const win = ctx.requireTrigger('win');
      if (win) {
        ctx.expectEvent('win', win.event1, 18);
        ctx.expectAction('win', win.action1, 1);
      }

      const eins = ctx.requireTrigger('eins');
      if (eins) {
        ctx.expectEvent('eins', eins.event1, 7);
        ctx.expectAction('eins', eins.action1, 7);
        ctx.expectActionTeam('eins', 'action1', 'einst');
        ctx.expectAction('eins', eins.action2, 22);
        ctx.expectActionTrigger('eins', 'action2', 'ein2');
      }

      const ein2 = ctx.requireTrigger('ein2');
      if (ein2) {
        ctx.expectAction('ein2', ein2.action1, 8, 0);
        ctx.expectAction('ein2', ein2.action2, 28, 1);
      }

      const ein3 = ctx.requireTrigger('ein3');
      if (ein3) {
        ctx.expectEvent('ein3', ein3.event1, 27, 1);
        ctx.expectAction('ein3', ein3.action1, 7);
        ctx.expectActionTeam('ein3', 'action1', 'heli');
      }

      ctx.expectTeamTrigger('heli', 'dcop');
      ctx.expectTeamMissions('heli', [
        { mission: 3, data: 23 },
        { mission: 3, data: 24 },
        { mission: 6, data: 2 },
      ]);

      const heli = ctx.requireTeam('heli');
      if (heli) {
        ctx.fact('heli-sequence', formatMissionSequence(heli.missions));
      }
      ctx.fact('victory-hook', 'win: EVAC_CIVILIAN -> WIN');
      ctx.fact('rescue-chain', 'eins -> ein2 -> ein3 -> heli');
    },
  },
  {
    scenarioId: 'SCG02EA',
    title: 'Allied 2 convoy and deploy chain',
    analyze(ctx) {
      const truk = ctx.requireTrigger('truk');
      if (truk) {
        ctx.expectEvent('truk', truk.event1, 14);
        ctx.expectAction('truk', truk.action1, 28, 1);
        ctx.expectAction('truk', truk.action2, 28, 2);
      }

      const cnvy = ctx.requireTrigger('cnvy');
      if (cnvy) {
        ctx.expectEvent('cnvy', cnvy.event1, 27, 2);
        ctx.expectAction('cnvy', cnvy.action2, 7);
        ctx.expectActionTeam('cnvy', 'action2', 'trks');
      }

      const win = ctx.requireTrigger('win');
      if (win) {
        ctx.expectEvent('win', win.event1, 23);
        if (win.event1.team !== 0) {
          ctx.error('convoy-win-team-mismatch', `${ctx.scenarioId}: win trigger should watch team 0, found ${win.event1.team}`);
        }
        ctx.expectAction('win', win.action1, 1);
      }

      ctx.expectTeamMissions('trks', [
        { mission: 3, data: 1 },
        { mission: 3, data: 2 },
        { mission: 3, data: 3 },
        { mission: 3, data: 4 },
        { mission: 3, data: 25 },
      ]);

      const amcv = ctx.requireTeam('amcv');
      if (amcv) {
        const deployMission = amcv.missions.find((mission) => mission.mission === 9);
        if (!deployMission) {
          ctx.error('missing-deploy-hook', `${ctx.scenarioId}: team "amcv" should use TMISSION_DEPLOY`);
        }
        ctx.fact('amcv-sequence', formatMissionSequence(amcv.missions));
      }

      ctx.fact('convoy-win', 'win: LEAVES_MAP(team trks) -> WIN');
      ctx.fact('timer-chain', 'ctdn -> truk -> cnvy -> trks');
    },
  },
  {
    scenarioId: 'SCG03EA',
    title: 'Allied 3 bridge and trap chain',
    analyze(ctx) {
      const win = ctx.requireTrigger('win');
      if (win) {
        ctx.expectEvent('win', win.event1, 31);
        ctx.expectAction('win', win.action1, 1);
      }

      const acrt = ctx.requireTrigger('acrt');
      if (acrt) {
        ctx.expectEvent('acrt', acrt.event1, 1);
        ctx.expectAction('acrt', acrt.action1, 13);
        ctx.expectAction('acrt', acrt.action2, 3);
      }

      ctx.expectActionTrigger('trp1', 'action1', 'bom1');
      ctx.expectActionTrigger('trp2', 'action1', 'bom2');
      ctx.expectActionTrigger('trp3', 'action1', 'bom3');
      ctx.expectActionTrigger('cmd', 'action1', 'blow');

      const para = ctx.requireTrigger('para');
      if (para) {
        ctx.expectAction('para', para.action1, 7);
        ctx.expectActionTeam('para', 'action1', 'para');
      }

      ctx.fact('victory-hook', 'win: ALL_BRIDGES_DESTROYED -> WIN');
      ctx.fact('bridge-traps', 'trp1/bom1, trp2/bom2, trp3/bom3, cmd/blow');
      ctx.fact('production-hook', 'acrt: PLAYER_ENTERED -> AUTOCREATE + BEGIN_PRODUCTION');
    },
  },
  {
    scenarioId: 'SCG04EA',
    title: 'Allied 4 timed waves and autocreate',
    analyze(ctx) {
      const win = ctx.requireTrigger('win');
      if (win) {
        ctx.expectEvent('win', win.event1, 11, 9);
        ctx.expectEvent('win', win.event2, 11, 2);
        ctx.expectAction('win', win.action1, 1);
      }

      const auto = ctx.requireTrigger('auto');
      if (auto) {
        ctx.expectEvent('auto', auto.event1, 13, 100);
        ctx.expectAction('auto', auto.action1, 13);
      }

      const off = ctx.requireTrigger('off');
      if (off) {
        ctx.expectEvent('off', off.event1, 32, 11);
        ctx.expectAction('off', off.action1, 28, 11);
        ctx.expectAction('off', off.action2, 12);
        ctx.expectActionTrigger('off', 'action2', 'cons');
      }

      const gmcv = ctx.requireTeam('gmcv');
      if (gmcv) {
        ctx.fact('gmcv-sequence', formatMissionSequence(gmcv.missions));
      }

      ctx.fact('victory-hook', 'win: ALL_DESTROYED house 9 AND house 2 -> WIN');
      ctx.fact('timed-chain', 'set1..set6, tm01/tm09/tm13/tm19, auto/aut2');
    },
  },
  {
    scenarioId: 'SCG05EA',
    title: 'Allied 5 spy, evac, and allow-win chain',
    analyze(ctx) {
      const spys = ctx.requireTrigger('SPYS');
      if (spys) {
        ctx.expectEvent('SPYS', spys.event1, 2);
        ctx.expectAction('SPYS', spys.action1, 22);
        ctx.expectActionTrigger('SPYS', 'action1', 'frc5');
        ctx.expectAction('SPYS', spys.action2, 3);
      }

      const win2 = ctx.requireTrigger('win2');
      if (win2) {
        ctx.expectEvent('win2', win2.event1, 18);
        ctx.expectAction('win2', win2.action1, 15);
      }

      const win3 = ctx.requireTrigger('win3');
      if (win3) {
        ctx.expectEvent('win3', win3.event1, 11, 2);
        ctx.expectEvent('win3', win3.event2, 11, 9);
        ctx.expectAction('win3', win3.action1, 1);
      }

      const lose = ctx.requireTrigger('lose');
      if (lose) {
        ctx.expectEvent('lose', lose.event1, 14);
        ctx.expectAction('lose', lose.action1, 2);
      }

      const newSpy = ctx.requireTeam('new');
      if (newSpy) {
        const usesSpyMission = newSpy.missions.some((mission) => mission.mission === 15);
        if (!usesSpyMission) {
          ctx.error('missing-spy-hook', `${ctx.scenarioId}: team "new" should use TMISSION_SPY`);
        }
        ctx.fact('new-team-sequence', formatMissionSequence(newSpy.missions));
      }

      const chin = ctx.requireTeam('chin');
      if (chin) {
        ctx.expectTeamTrigger('chin', 'los2');
        ctx.fact('chin-sequence', formatMissionSequence(chin.missions));
      }

      ctx.fact('spy-chain', 'SPYS -> frc5 + BEGIN_PRODUCTION');
      ctx.fact('evac-chain', 'win2: EVAC_CIVILIAN -> ALLOWWIN');
      ctx.fact('final-win', 'win3: ALL_DESTROYED house 2 AND house 9 -> WIN');
    },
  },
];

const extendedCampaignMissionAgents: MissionAuditAgent[] = [
  {
    scenarioId: 'SCU01EA',
    title: 'Soviet 1 village purge',
    analyze(ctx) {
      const win1 = ctx.requireTrigger('win1');
      if (win1) {
        ctx.expectEvent('win1', win1.event1, 11, 6);
        ctx.expectAction('win1', win1.action1, 15);
      }

      const win2 = ctx.requireTrigger('win2');
      if (win2) {
        ctx.expectEvent('win2', win2.event1, 15, 12);
        ctx.expectAction('win2', win2.action1, 1);
      }

      const lose = ctx.requireTrigger('lose');
      if (lose) {
        ctx.expectEvent('lose', lose.event1, 11, 2);
        ctx.expectAction('lose', lose.action1, 2);
      }

      const rspd = ctx.requireTrigger('rspd');
      if (rspd) {
        ctx.expectEvent('rspd', rspd.event1, 6);
        ctx.expectAction('rspd', rspd.action1, 7);
        ctx.expectAction('rspd', rspd.action2, 7);
      }

      const rsp2 = ctx.requireTrigger('rsp2');
      if (rsp2) {
        ctx.expectEvent('rsp2', rsp2.event1, 6);
        ctx.expectAction('rsp2', rsp2.action1, 7);
        ctx.expectAction('rsp2', rsp2.action2, 7);
      }

      ctx.fact('win-chain', 'win1: ALL_DESTROYED house 6 -> ALLOWWIN; win2: NBUILDINGS_DESTROYED 12 -> WIN');
      ctx.fact('loss-chain', 'lose: ALL_DESTROYED house 2 -> LOSE');
      ctx.fact('counterattacks', 'rspd and rsp2 both answer ATTACKED with reinforcements');
    },
  },
  {
    scenarioId: 'SCU02EA',
    title: 'Soviet 2 hold the command center',
    analyze(ctx) {
      const set = ctx.requireTrigger('set');
      if (set) {
        ctx.expectEvent('set', set.event1, 13, 20);
        ctx.expectAction('set', set.action1, 4);
        ctx.expectAction('set', set.action2, 3);
      }

      const win = ctx.requireTrigger('win');
      if (win) {
        ctx.expectEvent('win', win.event1, 11, 1);
        ctx.expectEvent('win', win.event2, 11, 8);
        ctx.expectAction('win', win.action1, 1);
      }

      const los1 = ctx.requireTrigger('los1');
      if (los1) {
        ctx.expectAction('los1', los1.action1, 2);
      }

      const hunt = ctx.requireTrigger('hunt');
      if (hunt) {
        ctx.expectEvent('hunt', hunt.event1, 10, 1);
        ctx.expectAction('hunt', hunt.action1, 9);
        ctx.expectAction('hunt', hunt.action2, 28, 3);
      }

      ctx.fact('win-chain', 'win: ALL_DESTROYED house 1 AND house 8 -> WIN');
      ctx.fact('loss-chain', 'los1 and los2 are the command-center/base-failure hooks');
      ctx.fact('startup', 'set: TIME 20 -> CREATE_TEAM + BEGIN_PRODUCTION');
    },
  },
  {
    scenarioId: 'SCU03EA',
    title: 'Soviet 3 spy hunt',
    analyze(ctx) {
      const win1 = ctx.requireTrigger('win1');
      if (win1) {
        ctx.expectEvent('win1', win1.event1, 7);
        ctx.expectAction('win1', win1.action1, 1);
      }

      const los2 = ctx.requireTrigger('los2');
      if (los2) {
        ctx.expectEvent('los2', los2.event1, 23);
        ctx.expectAction('los2', los2.action1, 2);
      }

      const los4 = ctx.requireTrigger('los4');
      if (los4) {
        ctx.expectEvent('los4', los4.event1, 23);
        ctx.expectEvent('los4', los4.event2, 23);
        ctx.expectAction('los4', los4.action1, 2);
      }

      const los3 = ctx.requireTrigger('los3');
      if (los3) {
        ctx.expectEvent('los3', los3.event1, 14);
        ctx.expectAction('los3', los3.action1, 2);
      }

      const spy1 = ctx.requireTrigger('spy1');
      if (spy1) {
        ctx.expectEvent('spy1', spy1.event1, 13, 0);
        ctx.expectAction('spy1', spy1.action1, 4);
        ctx.expectActionTeam('spy1', 'action1', 'spy1');
      }

      const spy2 = ctx.requireTrigger('spy2');
      if (spy2) {
        ctx.expectEvent('spy2', spy2.event1, 27, 29);
        ctx.expectAction('spy2', spy2.action1, 4);
        ctx.expectActionTeam('spy2', 'action1', 'spy11');
      }

      for (const name of ['spy2', 'spy4', 'spy6', 'spy7', 'spy11']) {
        const team = ctx.requireTeam(name);
        if (team && !team.missions.some((mission) => mission.mission === 15)) {
          ctx.error('missing-spy-hook', `${ctx.scenarioId}: team "${name}" should use TMISSION_SPY`);
        }
      }

      ctx.fact('win-chain', 'win1: attached DESTROYED -> WIN');
      ctx.fact('loss-chain', 'los2/los4: spy LEAVES_MAP -> LOSE; los3: timer expiry -> LOSE');
      ctx.fact('spy-teams', 'spy2, spy4, spy6, spy7, and spy11 all rely on TMISSION_SPY');
    },
  },
  {
    scenarioId: 'SCU04EA',
    title: 'Soviet 4 cut allied communications',
    analyze(ctx) {
      const win = ctx.requireTrigger('win!');
      if (win) {
        ctx.expectEvent('win!', win.event1, 11, 1);
        ctx.expectAction('win!', win.action1, 1);
      }

      const lose = ctx.requireTrigger('lose');
      if (lose) {
        ctx.expectEvent('lose', lose.event1, 11, 2);
        ctx.expectAction('lose', lose.action1, 2);
      }

      const prod = ctx.requireTrigger('prod');
      if (prod) {
        ctx.expectEvent('prod', prod.event1, 13, 0);
        ctx.expectAction('prod', prod.action1, 3);
      }

      const auto = ctx.requireTrigger('auto');
      if (auto) {
        ctx.expectEvent('auto', auto.event1, 6);
        ctx.expectAction('auto', auto.action1, 13);
        ctx.expectAction('auto', auto.action2, 29, 3);
      }

      const gaps = ctx.requireTrigger('gaps');
      if (gaps) {
        ctx.expectEvent('gaps', gaps.event1, 27, 2);
        ctx.expectEvent('gaps', gaps.event2, 27, 3);
        ctx.expectAction('gaps', gaps.action1, 3);
      }

      ctx.fact('win-chain', 'win!: ALL_DESTROYED house 1 -> WIN');
      ctx.fact('loss-chain', 'lose: ALL_DESTROYED house 2 -> LOSE');
      ctx.fact('production', 'prod and gaps gate BEGIN_PRODUCTION, auto gates AUTOCREATE');
    },
  },
  {
    scenarioId: 'SCU05EA',
    title: 'Soviet 5 capture the radar island',
    analyze(ctx) {
      const auto = ctx.requireTrigger('auto');
      if (auto) {
        ctx.expectEvent('auto', auto.event1, 19, 11);
        ctx.expectAction('auto', auto.action1, 3);
        ctx.expectAction('auto', auto.action2, 7);
        ctx.expectActionTeam('auto', 'action2', 'basdef');
      }

      const capt = ctx.requireTrigger('capt');
      if (capt) {
        ctx.expectAction('capt', capt.action1, 28, 25);
        ctx.expectAction('capt', capt.action2, 28, 27);
      }

      const cap2 = ctx.requireTrigger('cap2');
      if (cap2) {
        ctx.expectEvent('cap2', cap2.event1, 27, 25);
        ctx.expectAction('cap2', cap2.action1, 15);
      }

      const win1 = ctx.requireTrigger('win1');
      if (win1) {
        ctx.expectEvent('win1', win1.event1, 11, 8);
        ctx.expectEvent('win1', win1.event2, 27, 11);
        ctx.expectAction('win1', win1.action1, 28, 26);
      }

      const win3 = ctx.requireTrigger('win3');
      if (win3) {
        ctx.expectEvent('win3', win3.event1, 27, 26);
        ctx.expectAction('win3', win3.action1, 1);
      }

      const los2 = ctx.requireTrigger('los2');
      if (los2) {
        ctx.expectEvent('los2', los2.event1, 27, 27);
        ctx.expectAction('los2', los2.action2, 2);
      }

      ctx.expectTeamMissions('amcv2', [
        { mission: 3, data: 10 },
        { mission: 3, data: 11 },
        { mission: 12, data: 11 },
        { mission: 8, data: 0 },
        { mission: 3, data: 12 },
        { mission: 9, data: 0 },
      ]);

      const minemid = ctx.requireTeam('minemid');
      if (minemid && minemid.missions.filter((mission) => mission.mission === 9).length < 3) {
        ctx.error('deploy-sequence-too-short', `${ctx.scenarioId}: team "minemid" should repeatedly use TMISSION_DEPLOY`);
      }

      ctx.fact('win-chain', 'capt -> cap2(ALLOWWIN), win1 -> global 26, win3 -> WIN');
      ctx.fact('loss-chain', 'los2: GLOBAL_SET 27 -> LOSE');
      ctx.fact('deploy-teams', 'amcv2 and minemid both depend on TMISSION_DEPLOY');
    },
  },
  {
    scenarioId: 'SCG06EA',
    title: 'Allied 6 iron curtain infiltration',
    analyze(ctx) {
      const los3 = ctx.requireTrigger('los3');
      if (los3) {
        ctx.expectEvent('los3', los3.event1, 2, 1);
        ctx.expectAction('los3', los3.action1, 28, 24);
        ctx.expectAction('los3', los3.action2, 28, 25);
      }

      const spy1 = ctx.requireTrigger('spy1');
      if (spy1) {
        ctx.expectEvent('spy1', spy1.event1, 27, 24);
        ctx.expectAction('spy1', spy1.action1, 21);
      }

      const win1 = ctx.requireTrigger('win1');
      if (win1) {
        ctx.expectEvent('win1', win1.event1, 11, 2);
        ctx.expectEvent('win1', win1.event2, 27, 24);
        ctx.expectAction('win1', win1.action1, 1);
      }

      const prod = ctx.requireTrigger('prod');
      if (prod) {
        ctx.expectEvent('prod', prod.event1, 13, 0);
        ctx.expectAction('prod', prod.action1, 3);
      }

      const los8 = ctx.requireTrigger('los8');
      if (los8) {
        ctx.expectEvent('los8', los8.event1, 27, 29);
        ctx.expectEvent('los8', los8.event2, 28, 24);
        ctx.expectAction('los8', los8.action2, 2);
      }

      ctx.fact('spy-chain', 'los3: SPIED -> globals 24/25; spy1 reacts to global 24');
      ctx.fact('win-chain', 'win1: ALL_DESTROYED house 2 AND global 24 -> WIN');
      ctx.fact('failure-chain', 'los8: wrong spy outcome / cleared global 24 -> LOSE');
    },
  },
  {
    scenarioId: 'SCG07EA',
    title: 'Allied 7 capture radar and sink the sub base',
    analyze(ctx) {
      const win = ctx.requireTrigger('win');
      if (win) {
        ctx.expectEvent('win', win.event1, 1, 1);
        ctx.expectAction('win', win.action1, 28, 21);
        ctx.expectAction('win', win.action2, 22);
        ctx.expectActionTrigger('win', 'action2', 'xp1');
      }

      const rad1 = ctx.requireTrigger('rad1');
      if (rad1) {
        ctx.expectEvent('rad1', rad1.event1, 27, 21);
        ctx.expectAction('rad1', rad1.action1, 15);
      }

      const win2 = ctx.requireTrigger('win2');
      if (win2) {
        ctx.expectEvent('win2', win2.event1, 7);
        ctx.expectAction('win2', win2.action2, 28, 22);
      }

      const subw = ctx.requireTrigger('subw');
      if (subw) {
        ctx.expectEvent('subw', subw.event1, 27, 22);
        ctx.expectAction('subw', subw.action2, 1);
      }

      const prod = ctx.requireTrigger('prod');
      if (prod) {
        ctx.expectAction('prod', prod.action1, 3);
        ctx.expectAction('prod', prod.action2, 7);
      }

      ctx.fact('allow-win-chain', 'win -> global 21; rad1: global 21 -> ALLOWWIN');
      ctx.fact('final-win-chain', 'win2 -> global 22; subw: global 22 -> WIN');
      ctx.fact('ai-startup', 'prod and bact activate Soviet production/autocreate');
    },
  },
  {
    scenarioId: 'SCG08EA',
    title: 'Allied 8 chronosphere timer defense',
    analyze(ctx) {
      const timr = ctx.requireTrigger('timr');
      if (timr) {
        ctx.expectEvent('timr', timr.event1, 13, 0);
        ctx.expectAction('timr', timr.action1, 27, 450);
      }

      const endg = ctx.requireTrigger('endg');
      if (endg) {
        ctx.expectEvent('endg', endg.event1, 14);
        ctx.expectAction('endg', endg.action2, 22);
        ctx.expectActionTrigger('endg', 'action2', 'end3');
      }

      const end3 = ctx.requireTrigger('end3');
      if (end3) {
        ctx.expectEvent('end3', end3.event1, 13, 450);
        ctx.expectEvent('end3', end3.event2, 27, 18);
        ctx.expectAction('end3', end3.action1, 1);
      }

      const los3 = ctx.requireTrigger('los3');
      if (los3) {
        ctx.expectEvent('los3', los3.event1, 14);
        ctx.expectEvent('los3', los3.event2, 30, 1);
        ctx.expectAction('los3', los3.action1, 2);
      }

      const sbld = ctx.requireTrigger('sbld');
      if (sbld) {
        ctx.expectEvent('sbld', sbld.event1, 27, 29);
        ctx.expectAction('sbld', sbld.action1, 13);
        ctx.expectAction('sbld', sbld.action2, 3);
      }

      ctx.expectTeamMissions('smcv', [
        { mission: 3, data: 9 },
        { mission: 12, data: 29 },
        { mission: 9, data: 0 },
      ]);

      ctx.fact('timer-chain', 'timr sets timer 450; endg forces end3 when the timer expires');
      ctx.fact('win-chain', 'end3: TIME 450 AND global 18 -> WIN');
      ctx.fact('loss-chain', 'los3: TIMER_EXPIRED AND LOW_POWER -> LOSE');
    },
  },
  {
    scenarioId: 'SCG09EA',
    title: 'Allied 9 Kosygin extraction',
    analyze(ctx) {
      const spyd = ctx.requireTrigger('Spyd');
      if (spyd) {
        ctx.expectEvent('Spyd', spyd.event1, 2, 1);
        ctx.expectAction('Spyd', spyd.action1, 7);
        ctx.expectActionTeam('Spyd', 'action1', 'Offcr');
        ctx.expectAction('Spyd', spyd.action2, 4);
        ctx.expectActionTeam('Spyd', 'action2', 'dog8');
      }

      const spy2 = ctx.requireTrigger('spy2');
      if (spy2) {
        ctx.expectEvent('spy2', spy2.event1, 27, 1);
        ctx.expectAction('spy2', spy2.action1, 4);
        ctx.expectActionTeam('spy2', 'action1', 'dog7');
        ctx.expectAction('spy2', spy2.action2, 4);
        ctx.expectActionTeam('spy2', 'action2', 'dog9');
      }

      const wina = ctx.requireTrigger('wina');
      if (wina) {
        ctx.expectEvent('wina', wina.event1, 24, 9);
        ctx.expectAction('wina', wina.action1, 7);
        ctx.expectActionTeam('wina', 'action1', 'chinook');
      }

      const winb = ctx.requireTrigger('winb');
      if (winb) {
        ctx.expectEvent('winb', winb.event1, 27, 18);
        ctx.expectEvent('winb', winb.event2, 13, 3);
        ctx.expectAction('winb', winb.action1, 1);
      }

      ctx.expectTeamMissions('chinook', [
        { mission: 3, data: 2 },
        { mission: 12, data: 18 },
      ]);

      ctx.expectTeamTrigger('Offcr', 'los2');

      ctx.fact('spy-chain', 'Spyd: SPIED -> Offcr reinforcements + dog8 team; spy2 adds dog7/dog9');
      ctx.fact('extraction-chain', 'wina spawns chinook, then winb waits for global 18 and 3 ticks before WIN');
      ctx.fact('escort-hook', 'chinook sets global 18 through TMISSION_SET_GLOBAL');
    },
  },
  {
    scenarioId: 'SCG10EA',
    title: 'Allied 10 atomic launch site',
    analyze(ctx) {
      const alrt = ctx.requireTrigger('alrt');
      if (alrt) {
        ctx.expectEvent('alrt', alrt.event1, 1, 1);
        ctx.expectAction('alrt', alrt.action1, 13);
        ctx.expectAction('alrt', alrt.action2, 3);
      }

      const lch1 = ctx.requireTrigger('lch1');
      if (lch1) {
        ctx.expectEvent('lch1', lch1.event1, 27, 1);
        ctx.expectAction('lch1', lch1.action1, 21);
        ctx.expectAction('lch1', lch1.action2, 22);
        ctx.expectActionTrigger('lch1', 'action2', 'lch2');
      }

      const lch2 = ctx.requireTrigger('lch2');
      if (lch2) {
        ctx.expectAction('lch2', lch2.action1, 17, 19);
        ctx.expectAction('lch2', lch2.action2, 28, 2);
      }

      const lch3 = ctx.requireTrigger('lch3');
      if (lch3) {
        ctx.expectEvent('lch3', lch3.event1, 13, 2);
        ctx.expectEvent('lch3', lch3.event2, 27, 2);
        ctx.expectAction('lch3', lch3.action1, 10);
        ctx.expectAction('lch3', lch3.action2, 22);
        ctx.expectActionTrigger('lch3', 'action2', 'lch4');
      }

      const lch4 = ctx.requireTrigger('lch4');
      if (lch4) {
        ctx.expectAction('lch4', lch4.action1, 27, 596);
        ctx.expectAction('lch4', lch4.action2, 11, 24);
      }

      const lch5 = ctx.requireTrigger('lch5');
      if (lch5) {
        ctx.expectEvent('lch5', lch5.event1, 27, 2);
        ctx.expectAction('lch5', lch5.action1, 36);
      }

      const los2 = ctx.requireTrigger('los2');
      if (los2) {
        ctx.expectEvent('los2', los2.event1, 14);
        ctx.expectAction('los2', los2.action1, 2);
      }

      ctx.fact('launch-chain', 'lch1 -> lch2 -> lch3 -> lch4 stages the atomic launch response');
      ctx.fact('nuke-hook', 'lch5: GLOBAL_SET 2 -> LAUNCH_NUKES');
      ctx.fact('loss-chain', 'los2: mission timer expiry -> LOSE');
    },
  },
];

const campaignMissionAgents: MissionAuditAgent[] = [
  ...alliedMissionAgents,
  ...extendedCampaignMissionAgents,
];

export function auditMission(agent: MissionAuditAgent): MissionAuditReport {
  const data = loadScenarioData(agent.scenarioId);
  const ctx = new MissionAuditContext(agent.scenarioId, agent.title, data);
  ctx.runGenericChecks();
  agent.analyze(ctx);

  return {
    scenarioId: agent.scenarioId,
    title: agent.title,
    issues: ctx.issues,
    facts: ctx.facts,
    runtime: ctx.runtime,
    counts: {
      triggers: data.triggers.length,
      teams: data.teamTypes.length,
      cellTriggers: data.cellTriggers.size,
      attachedObjectTriggers: [...data.units, ...data.infantry, ...data.structures].filter((item) => isRealTriggerName(item.trigger)).length,
    },
  };
}

export function runAlliedMissionAgents(): MissionAuditReport[] {
  return alliedMissionAgents.map((agent) => auditMission(agent));
}

export function getAlliedMissionAgents(): MissionAuditAgent[] {
  return alliedMissionAgents.slice();
}

export function runCampaignMissionAgents(): MissionAuditReport[] {
  return campaignMissionAgents.map((agent) => auditMission(agent));
}

export function getCampaignMissionAgents(): MissionAuditAgent[] {
  return campaignMissionAgents.slice();
}

export function formatAuditMarkdown(reports: MissionAuditReport[], title = 'Allied Mission Audit'): string {
  const lines: string[] = [
    `# ${title}`,
    '',
  ];

  for (const report of reports) {
    lines.push(`## ${report.scenarioId} - ${report.title}`);
    lines.push('');
    lines.push(`- Trigger count: ${report.counts.triggers}`);
    lines.push(`- Team count: ${report.counts.teams}`);
    lines.push(`- Runtime team missions: ${report.runtime.teamMissionIds.map((id) => missionName(id)).join(', ') || 'none'}`);
    if (report.facts.length > 0) {
      for (const fact of report.facts) {
        lines.push(`- ${fact.key}: ${fact.value}`);
      }
    }
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

export function getAlliedMissionTitle(scenarioId: string): string {
  return ALLIED_MISSION_TITLES[scenarioId] ?? scenarioId;
}
