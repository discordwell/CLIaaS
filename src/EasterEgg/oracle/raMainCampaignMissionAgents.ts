import {
  auditMission,
  formatAuditMarkdown,
  formatMissionSequence,
  getCampaignMissionAgents as getCoreCampaignMissionAgents,
  MissionAuditContext,
  type MissionAuditAgent,
  type MissionAuditFact,
  type MissionAuditReport,
} from './raAlliedMissionAgents';

interface TriggerValueExpectation {
  type: number;
  data?: number;
}

interface TriggerExpectation {
  name: string;
  event1?: TriggerValueExpectation;
  event2?: TriggerValueExpectation;
  action1?: TriggerValueExpectation;
  action2?: TriggerValueExpectation;
  action1Team?: string;
  action2Team?: string;
  action1Trigger?: string;
  action2Trigger?: string;
}

interface TeamMissionCountExpectation {
  mission: number;
  count: number;
}

interface TeamExpectation {
  name: string;
  trigger?: string;
  missions?: Array<{ mission: number; data: number }>;
  requiresMission?: number;
  minMissionCounts?: TeamMissionCountExpectation[];
}

interface MissionAuditSpec {
  scenarioId: string;
  title: string;
  facts: MissionAuditFact[];
  triggers?: TriggerExpectation[];
  teams?: TeamExpectation[];
  extra?: (ctx: MissionAuditContext) => void;
}

function applyTriggerExpectation(ctx: MissionAuditContext, expectation: TriggerExpectation): void {
  const trigger = ctx.requireTrigger(expectation.name);
  if (!trigger) return;

  if (expectation.event1) {
    ctx.expectEvent(expectation.name, trigger.event1, expectation.event1.type, expectation.event1.data);
  }
  if (expectation.event2) {
    ctx.expectEvent(expectation.name, trigger.event2, expectation.event2.type, expectation.event2.data);
  }
  if (expectation.action1) {
    ctx.expectAction(expectation.name, trigger.action1, expectation.action1.type, expectation.action1.data);
  }
  if (expectation.action2) {
    ctx.expectAction(expectation.name, trigger.action2, expectation.action2.type, expectation.action2.data);
  }
  if (expectation.action1Team) {
    ctx.expectActionTeam(expectation.name, 'action1', expectation.action1Team);
  }
  if (expectation.action2Team) {
    ctx.expectActionTeam(expectation.name, 'action2', expectation.action2Team);
  }
  if (expectation.action1Trigger) {
    ctx.expectActionTrigger(expectation.name, 'action1', expectation.action1Trigger);
  }
  if (expectation.action2Trigger) {
    ctx.expectActionTrigger(expectation.name, 'action2', expectation.action2Trigger);
  }
}

function applyTeamExpectation(ctx: MissionAuditContext, expectation: TeamExpectation): void {
  const team = ctx.requireTeam(expectation.name);
  if (!team) return;

  if (expectation.trigger) {
    ctx.expectTeamTrigger(expectation.name, expectation.trigger);
  }
  if (expectation.missions) {
    ctx.expectTeamMissions(expectation.name, expectation.missions);
  }
  if (expectation.requiresMission !== undefined && !team.missions.some((mission) => mission.mission === expectation.requiresMission)) {
    ctx.error(
      'missing-team-mission',
      `${ctx.scenarioId}: team "${expectation.name}" should use ${expectation.requiresMission} somewhere in ${formatMissionSequence(team.missions)}`,
    );
  }
  if (expectation.minMissionCounts) {
    for (const minCount of expectation.minMissionCounts) {
      const actual = team.missions.filter((mission) => mission.mission === minCount.mission).length;
      if (actual < minCount.count) {
        ctx.error(
          'team-mission-count-mismatch',
          `${ctx.scenarioId}: team "${expectation.name}" should use mission ${minCount.mission} at least ${minCount.count} times, found ${actual}`,
        );
      }
    }
  }
}

function createSpecAgent(spec: MissionAuditSpec): MissionAuditAgent {
  return {
    scenarioId: spec.scenarioId,
    title: spec.title,
    analyze(ctx) {
      for (const trigger of spec.triggers ?? []) {
        applyTriggerExpectation(ctx, trigger);
      }
      for (const team of spec.teams ?? []) {
        applyTeamExpectation(ctx, team);
      }
      for (const fact of spec.facts) {
        ctx.fact(fact.key, fact.value);
      }
      spec.extra?.(ctx);
    },
  };
}

const additionalCampaignMissionAgents: MissionAuditAgent[] = [
  createSpecAgent({
    scenarioId: 'SCG03EB',
    title: 'Allied 3B bridge demolition branch',
    triggers: [
      { name: 'Win', event1: { type: 31 }, action1: { type: 1 } },
      { name: 'Los1', event1: { type: 7 }, action1: { type: 2 } },
      { name: 'help', event1: { type: 7 }, action1: { type: 5 }, action1Team: 'fsqd', action2: { type: 4 }, action2Team: 'help' },
      { name: 'boom', event1: { type: 7 }, action1: { type: 22 }, action1Trigger: 'det1' },
      { name: 'bom1', event1: { type: 7 }, action1: { type: 22 }, action1Trigger: 'det2' },
      { name: 'bom2', event1: { type: 7 }, action1: { type: 22 }, action1Trigger: 'det3' },
      { name: 'bom3', event1: { type: 7 }, action1: { type: 22 }, action1Trigger: 'det4' },
    ],
    facts: [
      { key: 'victory-hook', value: 'Win: ALL_BRIDGES_DESTROYED -> WIN' },
      { key: 'bridge-chain', value: 'boom/bom1/bom2/bom3 force the det1..det4 trap triggers' },
      { key: 'rescue-chain', value: 'help swaps fsqd for the scripted help team on destroy' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCG05EB',
    title: 'Allied 5B spy prison break branch',
    triggers: [
      { name: 'spy', event1: { type: 2, data: 1 }, action1: { type: 22 }, action1Trigger: 'frc1', action2: { type: 3 } },
      { name: 'frc1', action1: { type: 12 }, action1Trigger: 'los1', action2: { type: 4 }, action2Team: 'truk' },
      { name: 'tnya', action1: { type: 32 }, action2: { type: 28, data: 1 } },
      { name: 'tya2', event1: { type: 13, data: 1 }, event2: { type: 27, data: 1 }, action1: { type: 7 }, action1Team: 'tanya' },
      { name: 'grf1', event1: { type: 18 }, action1: { type: 7 }, action1Team: 'grf1' },
      { name: 'time', event1: { type: 13, data: 1 }, action1: { type: 27, data: 150 } },
      { name: 'etmr', event1: { type: 14 }, action1: { type: 2 } },
      { name: 'win', event1: { type: 11, data: 2 }, action1: { type: 1 } },
      { name: 'lose', event1: { type: 11, data: 1 }, event2: { type: 27, data: 3 }, action1: { type: 2 } },
    ],
    teams: [
      { name: 'spy2', requiresMission: 15 },
      { name: 'tanya', trigger: 'los2' },
      { name: 'grf2', requiresMission: 12 },
    ],
    facts: [
      { key: 'spy-chain', value: 'spy -> frc1 clears los1 and starts the truck breakout' },
      { key: 'tanya-chain', value: 'tnya/tya2 gate the Tanya reinforcement after the prison spy event' },
      { key: 'timer-chain', value: 'time sets the 150-tick cap and etmr loses on expiry' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCG06EB',
    title: 'Allied 6B iron curtain naval branch',
    triggers: [
      { name: 'los3', event1: { type: 2, data: 1 }, action1: { type: 28, data: 24 }, action2: { type: 28, data: 25 } },
      { name: 'win1', event1: { type: 11, data: 2 }, event2: { type: 27, data: 24 }, action1: { type: 1 } },
      { name: 'prod', event1: { type: 13, data: 0 }, action1: { type: 3 } },
      { name: 'los7', event1: { type: 27, data: 25 }, event2: { type: 27, data: 26 }, action1: { type: 28, data: 29 } },
      { name: 'los8', event1: { type: 27, data: 29 }, event2: { type: 28, data: 24 }, action2: { type: 2 } },
    ],
    facts: [
      { key: 'spy-chain', value: 'los3 still promotes the spy objective through globals 24 and 25' },
      { key: 'naval-loss-chain', value: 'los7 and los8 convert the double-failure path into the late loss state' },
      { key: 'production-hook', value: 'prod keeps Soviet production enabled alongside the sea/air response triggers' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCG08EB',
    title: 'Allied 8B chronosphere defense branch',
    triggers: [
      { name: 'timr', event1: { type: 13, data: 0 }, action1: { type: 27, data: 450 } },
      { name: 'endg', event1: { type: 14 }, action2: { type: 22 }, action2Trigger: 'end2' },
      { name: 'end2', action2: { type: 28, data: 18 } },
      { name: 'end3', event1: { type: 13, data: 1 }, event2: { type: 27, data: 18 }, action1: { type: 1 } },
      { name: 'los3', event1: { type: 14 }, event2: { type: 30, data: 1 }, action1: { type: 2 } },
      { name: 'saut', event1: { type: 13, data: 40 }, event2: { type: 19, data: 12 }, action1: { type: 13 } },
    ],
    teams: [
      { name: 'smcv', missions: [{ mission: 3, data: 9 }, { mission: 9, data: 0 }] },
      { name: 'nark', requiresMission: 12 },
    ],
    facts: [
      { key: 'timer-chain', value: 'timr -> endg -> end2/end3 drives the chronosphere timer win path' },
      { key: 'loss-hook', value: 'los3 still loses on timer expiry while power is low' },
      { key: 'deploy-hook', value: 'smcv still relies on TMISSION_DEPLOY before the defense phase' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCG09EB',
    title: 'Allied 9B Kosygin extraction branch',
    triggers: [
      { name: 'Spyd', event1: { type: 27, data: 22 }, action1: { type: 7 }, action1Team: 'Offcr', action2: { type: 4 }, action2Team: 'dog8' },
      { name: 'spy2', event1: { type: 27, data: 1 }, action1: { type: 4 }, action1Team: 'dog7', action2: { type: 4 }, action2Team: 'dog9' },
      { name: 'kos?', event1: { type: 2, data: 1 }, action1: { type: 28, data: 22 }, action2: { type: 28, data: 23 } },
      { name: 'los3', event1: { type: 27, data: 23 }, event2: { type: 28, data: 22 }, action1: { type: 2 } },
      { name: 'wina', event1: { type: 24, data: 9 }, action1: { type: 7 }, action1Team: 'chinook', action2: { type: 28, data: 29 } },
      { name: 'wait', event1: { type: 13, data: 2 }, event2: { type: 27, data: 29 }, action1: { type: 1 } },
    ],
    teams: [
      { name: 'Offcr', trigger: 'los2', missions: [{ mission: 12, data: 1 }, { mission: 3, data: 94 }] },
      { name: 'chinook', missions: [{ mission: 3, data: 2 }, { mission: 12, data: 18 }] },
    ],
    facts: [
      { key: 'spy-chain', value: 'kos? promotes the officer/dog reaction only after the spy global chain completes' },
      { key: 'extraction-chain', value: 'wina spawns the chinook and wait converts global 29 into the final win' },
      { key: 'escort-hook', value: 'Offcr and chinook both depend on TMISSION_SET_GLOBAL state changes' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCG10EB',
    title: 'Allied 10B evidence branch',
    triggers: [
      { name: 'win1', event1: { type: 1, data: 8 }, action2: { type: 28, data: 1 } },
      { name: 'win2', event1: { type: 1, data: 8 }, action2: { type: 28, data: 2 } },
      { name: 'win3', event1: { type: 1, data: 8 }, action2: { type: 28, data: 3 } },
      { name: 'win4', event1: { type: 1, data: 8 }, action2: { type: 28, data: 4 } },
      { name: 'prt1', event1: { type: 27, data: 1 }, event2: { type: 27, data: 2 }, action1: { type: 28, data: 5 } },
      { name: 'prt2', event1: { type: 27, data: 3 }, event2: { type: 27, data: 4 }, action1: { type: 28, data: 6 } },
      { name: 'win', event1: { type: 27, data: 5 }, event2: { type: 27, data: 6 }, action2: { type: 1 } },
      { name: 'lose', event1: { type: 11, data: 8 }, event2: { type: 11, data: 8 }, action1: { type: 2 } },
      { name: 'los2', event1: { type: 14 }, action2: { type: 2 } },
    ],
    teams: [{ name: 'tanya', trigger: 'los3' }],
    facts: [
      { key: 'evidence-chain', value: 'win1..win4 raise globals 1..4, prt1/prt2 fold them into globals 5 and 6' },
      { key: 'final-win', value: 'win requires both evidence globals before the mission can complete' },
      { key: 'tanya-hook', value: 'Tanya still carries the los3 fail trigger in the alternate branch' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCG11EA',
    title: 'Allied 11A convoy escape',
    triggers: [
      { name: 'timr', event1: { type: 13, data: 0 }, action1: { type: 27, data: 1200 }, action2: { type: 23 } },
      { name: 'win1', event1: { type: 11, data: 2 }, event2: { type: 11, data: 9 }, action1: { type: 22 }, action1Trigger: 'sea1' },
      { name: 'sea1', event1: { type: 14 }, action1: { type: 7 }, action1Team: 'sea1', action2: { type: 7 }, action2Team: 'sea2' },
      { name: 'win2', event1: { type: 23 }, action1: { type: 28, data: 12 } },
      { name: 'win3', event1: { type: 23 }, action1: { type: 28, data: 13 } },
      { name: 'win4', event1: { type: 27, data: 12 }, event2: { type: 27, data: 13 }, action1: { type: 1 } },
      { name: 'los2', event1: { type: 11, data: 3 }, event2: { type: 27, data: 15 }, action1: { type: 2 } },
      { name: 'auto', event1: { type: 6 }, action1: { type: 13 } },
    ],
    teams: [
      { name: 'sea1', requiresMission: 12 },
      { name: 'sea2', requiresMission: 12 },
      { name: 'sub1', trigger: 'sub1', missions: [{ mission: 11, data: 14 }] },
    ],
    facts: [
      { key: 'timer-chain', value: 'timr arms the 1200-tick convoy escape window' },
      { key: 'escape-chain', value: 'win1 -> sea1/sea2, then win2/win3 set globals 12 and 13 before win4 fires' },
      { key: 'escort-hook', value: 'sea1 and sea2 both depend on TMISSION_SET_GLOBAL during the evacuation path' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCG11EB',
    title: 'Allied 11B convoy survival branch',
    triggers: [
      { name: 'timr', event1: { type: 13, data: 0 }, action1: { type: 27, data: 1200 }, action2: { type: 23 } },
      { name: 'win1', event1: { type: 11, data: 2 }, event2: { type: 11, data: 9 }, action1: { type: 28, data: 0 } },
      { name: 'sea1', event1: { type: 14 }, event2: { type: 27, data: 0 }, action1: { type: 7 }, action1Team: 'sea1', action2: { type: 7 }, action2Team: 'sea2' },
      { name: 'win2', event1: { type: 23 }, event2: { type: 23 }, action1: { type: 1 } },
      { name: 'los4', event1: { type: 27, data: 16 }, event2: { type: 27, data: 17 }, action1: { type: 2 } },
      { name: 'auto', event1: { type: 13, data: 250 }, event2: { type: 1, data: 1 }, action1: { type: 13 } },
    ],
    teams: [
      { name: 'sea1', requiresMission: 12 },
      { name: 'sea2', requiresMission: 12 },
      { name: 'sub1', trigger: 'sub1', missions: [{ mission: 11, data: 14 }] },
    ],
    facts: [
      { key: 'branch-chain', value: 'win1 raises global 0 so sea1 can convert the timer expiry into the evacuation phase' },
      { key: 'final-win', value: 'win2 waits for both convoy groups to leave the map instead of the paired globals used in 11A' },
      { key: 'loss-chain', value: 'los4 still combines the dual convoy failure globals into a hard loss' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCG12EA',
    title: 'Allied 12 takedown',
    triggers: [
      { name: 'nuke', event1: { type: 6 }, event2: { type: 27, data: 6 }, action1: { type: 33 } },
      { name: 'win', event1: { type: 27, data: 8 }, event2: { type: 27, data: 4 }, action1: { type: 1 } },
      { name: 'lose', event1: { type: 11, data: 1 }, event2: { type: 27, data: 9 }, action1: { type: 2 } },
      { name: 'air', event1: { type: 13, data: 300 }, action1: { type: 28, data: 11 } },
      { name: 'g12+', event1: { type: 1, data: 1 }, action1: { type: 28, data: 12 } },
      { name: 'nukx', event1: { type: 7 }, action1: { type: 12 }, action1Trigger: 'nuke' },
    ],
    facts: [
      { key: 'nuke-hook', value: 'nuke uses 1_SPECIAL once global 6 is set and the launch site is attacked' },
      { key: 'air-chain', value: 'air gates the late reinforcement waves through global 11' },
      { key: 'final-win', value: 'win requires globals 8 and 4 after the takedown objectives complete' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCG13EA',
    title: 'Allied 13 focused blast',
    triggers: [
      { name: 'g09+', event1: { type: 27, data: 1 }, event2: { type: 27, data: 2 }, action1: { type: 28, data: 9 }, action2: { type: 7 }, action2Team: 'arnf2' },
      { name: 'g10+', event1: { type: 27, data: 3 }, event2: { type: 27, data: 4 }, action1: { type: 28, data: 10 } },
      { name: 'g11+', event1: { type: 27, data: 5 }, event2: { type: 27, data: 6 }, action1: { type: 28, data: 11 } },
      { name: 'g12+', event1: { type: 27, data: 7 }, event2: { type: 27, data: 8 }, action1: { type: 28, data: 12 } },
      { name: 'g13+', event1: { type: 27, data: 9 }, event2: { type: 27, data: 10 }, action1: { type: 28, data: 13 } },
      { name: 'g14+', event1: { type: 27, data: 11 }, event2: { type: 27, data: 12 }, action1: { type: 28, data: 14 } },
      { name: 'win', event1: { type: 27, data: 13 }, event2: { type: 27, data: 14 }, action1: { type: 1 } },
      { name: 'los1', event1: { type: 11, data: 1 }, event2: { type: 11, data: 8 }, action1: { type: 2 } },
      { name: 'los2', event1: { type: 14 }, action1: { type: 2 } },
      { name: 'set0', event1: { type: 13, data: 0 }, action1: { type: 27, data: 450 } },
    ],
    facts: [
      { key: 'capture-chain', value: 'eight player-entered hooks raise globals 1..8, then g09+ through g14+ fold them into the final win pair' },
      { key: 'timer-chain', value: 'set0 starts the 450-tick cap while los2 remains the hard timeout' },
      { key: 'final-win', value: 'win requires globals 13 and 14 after both half-chains complete' },
    ],
    extra(ctx) {
      for (let i = 1; i <= 8; i++) {
        const triggerName = i === 3 ? 'G03+' : `g0${i}+`;
        const trigger = ctx.requireTrigger(triggerName);
        if (!trigger) continue;
        ctx.expectEvent(triggerName, trigger.event1, 1, 8);
        ctx.expectAction(triggerName, trigger.action1, 28, i);
      }
    },
  }),
  createSpecAgent({
    scenarioId: 'SCG14EA',
    title: 'Allied 14 final assault',
    triggers: [
      { name: 'nuke', event1: { type: 6 }, action1: { type: 35 }, action2: { type: 33 } },
      { name: 'set0', event1: { type: 13, data: 0 }, action1: { type: 7 }, action1Team: 'tanya', action2: { type: 4 }, action2Team: 'tbarrel' },
      { name: 'set1', event1: { type: 13, data: 0 }, action1: { type: 17, data: 1 }, action2: { type: 4 }, action2Team: 'truk' },
      { name: 'win1', event1: { type: 11, data: 2 }, event2: { type: 11, data: 9 }, action1: { type: 1 } },
      { name: 'los1', event1: { type: 7 }, action1: { type: 2 } },
      { name: 'los2', event1: { type: 11, data: 1 }, event2: { type: 27, data: 2 }, action1: { type: 2 } },
      { name: 'air1', event1: { type: 13, data: 68 }, event2: { type: 27, data: 17 }, action1: { type: 7 }, action1Team: 'navmigs' },
    ],
    teams: [{ name: 'tanya', trigger: 'los1' }],
    facts: [
      { key: 'opening-chain', value: 'set0 and set1 open with Tanya reinforcements, barrels, reveal, and the truck script' },
      { key: 'nuke-hook', value: 'nuke uses preferred-target plus 1_SPECIAL once the base starts fighting back' },
      { key: 'final-win', value: 'win1 still requires both Soviet houses to be wiped out' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU02EB',
    title: 'Soviet 2B alternate command-center defense',
    triggers: [
      { name: 'prod', event1: { type: 1, data: 2 }, action1: { type: 3 }, action2: { type: 12 }, action2Trigger: 'prd1' },
      { name: 'win', event1: { type: 11, data: 1 }, action1: { type: 1 } },
      { name: 'lose', event1: { type: 11, data: 2 }, action1: { type: 2 } },
      { name: 'los1', event1: { type: 7 }, action1: { type: 2 } },
      { name: 'atk7', event1: { type: 7, data: 2 }, action1: { type: 4 }, action1Team: 'grc4' },
    ],
    facts: [
      { key: 'production-hook', value: 'prod only starts after the player crosses the trigger zone' },
      { key: 'alternate-win', value: 'the B branch only requires ALL_DESTROYED house 1 for victory' },
      { key: 'failure-hook', value: 'los1 still loses immediately if the protected unit dies' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU04EB',
    title: 'Soviet 4B alternate communications raid',
    triggers: [
      { name: 'win1', event1: { type: 11, data: 1 }, action1: { type: 15 } },
      { name: 'win2', event1: { type: 10, data: 8 }, action1: { type: 1 } },
      { name: 'prod', event1: { type: 13, data: 10 }, action1: { type: 3 } },
      { name: 'auto', event1: { type: 13, data: 130 }, action1: { type: 13 } },
      { name: 'lose', event1: { type: 11, data: 2 }, action1: { type: 2 } },
    ],
    facts: [
      { key: 'allow-win-chain', value: 'win1 allows victory once house 1 is gone, win2 closes it when house 8 buildings are destroyed' },
      { key: 'production-chain', value: 'prod and auto are purely timer driven in the alternate branch' },
      { key: 'loss-chain', value: 'lose still fails the mission if the Soviet force is wiped out' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU06EA',
    title: 'Soviet 6A bridge over the River Grotzny',
    triggers: [
      { name: 'lose', event1: { type: 7 }, action1: { type: 2 } },
      { name: 'auto', event1: { type: 19, data: 12 }, event2: { type: 6 }, action1: { type: 3 }, action2: { type: 22 }, action2Trigger: 'atk1' },
      { name: 'atk1', action1: { type: 4 }, action1Team: 'atk1', action2: { type: 13 } },
      { name: 'win1', event1: { type: 1, data: 9 }, action1: { type: 1 } },
      { name: 'ent1', event1: { type: 1, data: 2 }, action1: { type: 4 }, action1Team: 'ship', action2: { type: 17, data: 78 } },
    ],
    teams: [{ name: 'tnk5', requiresMission: 12 }],
    facts: [
      { key: 'startup-chain', value: 'auto requires both the tech build and an attack before production and autocreate start' },
      { key: 'bridge-win', value: 'win1 is a straight PLAYER_ENTERED zone victory in the original branch' },
      { key: 'special-hook', value: 'para still grants the full special in support of the bridge push' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU06EB',
    title: 'Soviet 6B bridge over the River VizchGoi',
    triggers: [
      { name: 'lose', event1: { type: 7 }, action1: { type: 2 } },
      { name: 'dst1', event1: { type: 7 }, action1: { type: 12 }, action1Trigger: 'rspd' },
      { name: 'dst2', event1: { type: 7 }, action1: { type: 28, data: 11 } },
      { name: 'auto', event1: { type: 13, data: 30 }, event2: { type: 27, data: 11 }, action1: { type: 3 }, action2: { type: 22 }, action2Trigger: 'atk1' },
      { name: 'atk1', action1: { type: 4 }, action1Team: 'atk1', action2: { type: 13 } },
      { name: 'win1', event1: { type: 1, data: 9 }, action1: { type: 1 } },
      { name: 'ent1', event1: { type: 1, data: 2 }, action1: { type: 4 }, action1Team: 'ship', action2: { type: 17, data: 78 } },
    ],
    teams: [{ name: 'tnk5', requiresMission: 12 }],
    facts: [
      { key: 'startup-chain', value: 'dst2 raises global 11 so the delayed auto trigger can start production and atk1' },
      { key: 'bridge-win', value: 'win1 remains a zone-entry victory in the alternate river crossing' },
      { key: 'support-chain', value: 'ent1 still brings in the ship team and reveal on the lower bridge approach' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU07EA',
    title: 'Soviet 7 core of the matter',
    triggers: [
      { name: 'win1', event1: { type: 27, data: 1 }, event2: { type: 27, data: 2 }, action1: { type: 15 } },
      { name: 'win2', event1: { type: 27, data: 3 }, event2: { type: 27, data: 4 }, action1: { type: 15 } },
      { name: 'set6', event1: { type: 27, data: 1 }, event2: { type: 27, data: 2 }, action1: { type: 28, data: 6 } },
      { name: 'set7', event1: { type: 27, data: 3 }, event2: { type: 27, data: 4 }, action1: { type: 28, data: 7 }, action2: { type: 3 } },
      { name: 'set5', event1: { type: 27, data: 6 }, event2: { type: 27, data: 7 }, action1: { type: 28, data: 5 } },
      { name: 'win5', event1: { type: 27, data: 8 }, event2: { type: 13, data: 5 }, action1: { type: 1 } },
      { name: 'tim1', event1: { type: 13, data: 0 }, action1: { type: 22 }, action1Trigger: 'tim2', action2: { type: 27, data: 300 } },
      { name: 'los2', event1: { type: 13, data: 200 }, action1: { type: 2 } },
    ],
    facts: [
      { key: 'allow-win-chain', value: 'win1/win2 set the two ALLOWWIN gates, then set6/set7 fold them into global 5' },
      { key: 'final-win', value: 'win5 waits for global 8 and five ticks before resolving victory' },
      { key: 'timer-chain', value: 'tim1/tim2 start the mission timer while los2 remains the hard time loss' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU08EA',
    title: 'Soviet 8A naval trap',
    triggers: [
      { name: 'set0', event1: { type: 13, data: 0 }, action1: { type: 17, data: 79 }, action2: { type: 11, data: 5 } },
      { name: 'auto', event1: { type: 13, data: 280 }, action1: { type: 13 } },
      { name: 'win', event1: { type: 11, data: 1 }, action1: { type: 1 } },
      { name: 'lose', event1: { type: 11, data: 2 }, action1: { type: 2 } },
      { name: 'heli', event1: { type: 19, data: 15 }, action1: { type: 28, data: 14 } },
      { name: 'air1', event1: { type: 13, data: 150 }, event2: { type: 27, data: 14 }, action1: { type: 7 }, action1Team: 'air2', action2: { type: 7 }, action2Team: 'air3' },
      { name: 'prod', event1: { type: 13, data: 90 }, action1: { type: 3 } },
    ],
    teams: [
      { name: 'mine2', minMissionCounts: [{ mission: 9, count: 5 }] },
      { name: 'mine3', minMissionCounts: [{ mission: 9, count: 5 }] },
      { name: 'mine4', minMissionCounts: [{ mission: 9, count: 5 }] },
    ],
    facts: [
      { key: 'naval-chain', value: 'set0 opens with reveal/text, then auto and prod bring the AI online' },
      { key: 'helicopter-chain', value: 'heli raises global 14 so air1 can launch the aircraft response' },
      { key: 'mine-hook', value: 'mine2/mine3/mine4 all depend on repeated TMISSION_DEPLOY mine drops' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU08EB',
    title: 'Soviet 8B naval trap branch',
    triggers: [
      { name: 'set0', event1: { type: 13, data: 0 }, action1: { type: 3 }, action2: { type: 17, data: 79 } },
      { name: 'auto', event1: { type: 13, data: 250 }, action1: { type: 13 } },
      { name: 'win', event1: { type: 11, data: 1 }, action1: { type: 1 } },
      { name: 'lose', event1: { type: 11, data: 2 }, action1: { type: 2 } },
    ],
    teams: [
      { name: 'mine2', minMissionCounts: [{ mission: 9, count: 5 }] },
      { name: 'mine3', minMissionCounts: [{ mission: 9, count: 5 }] },
      { name: 'mine4', minMissionCounts: [{ mission: 9, count: 5 }] },
    ],
    facts: [
      { key: 'opening-chain', value: 'set0 starts production immediately instead of waiting for the helicopter tech gate' },
      { key: 'mine-hook', value: 'the alternate branch still uses the same repeated TMISSION_DEPLOY mine teams' },
      { key: 'final-win', value: 'win remains ALL_DESTROYED house 1 with lose on Soviet wipeout' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU09EA',
    title: 'Soviet 9 liability elimination',
    triggers: [
      { name: 'prod', event1: { type: 13, data: 0 }, action1: { type: 3 } },
      { name: 'los2', event1: { type: 23 }, event2: { type: 23 }, action1: { type: 2 } },
      { name: 'win2', event1: { type: 7 }, action1: { type: 1 }, action2: { type: 28, data: 2 } },
      { name: 'los1', event1: { type: 7 }, action1: { type: 2 } },
      { name: 'ent1', event1: { type: 1, data: 2 }, action1: { type: 4 }, action1Team: 'mnlayr', action2: { type: 17, data: 52 } },
      { name: 'win3', event1: { type: 16, data: 1 }, action1: { type: 1 } },
    ],
    teams: [
      { name: 'eMCV', missions: [{ mission: 3, data: 22 }, { mission: 9, data: 0 }] },
      { name: 'mnlayr', minMissionCounts: [{ mission: 9, count: 4 }] },
    ],
    facts: [
      { key: 'convoy-loss', value: 'los2 still loses if the paired truck teams escape the map' },
      { key: 'truck-kill-win', value: 'win2 flips the mission once the scripted truck target is destroyed' },
      { key: 'deploy-hook', value: 'eMCV and mnlayr both depend on TMISSION_DEPLOY during the kill box setup' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU10EA',
    title: 'Soviet 10 overseer',
    triggers: [
      { name: 'losc', event1: { type: 7 }, action1: { type: 2 } },
      { name: 'win', event1: { type: 1, data: 7 }, action1: { type: 1 } },
      { name: 'los2', event1: { type: 11, data: 7 }, event2: { type: 27, data: 1 }, action1: { type: 2 } },
      { name: 'auto', event1: { type: 1, data: 9 }, event2: { type: 1, data: 7 }, action1: { type: 13 }, action2: { type: 3 } },
      { name: 'timr', event1: { type: 7 }, action1: { type: 27, data: 150 } },
      { name: 'tim2', event1: { type: 1, data: 9 }, action1: { type: 22 }, action1Trigger: 'timr' },
    ],
    teams: [{ name: 'conv2', trigger: 'losc', missions: [{ mission: 3, data: 0 }, { mission: 10, data: 0 }, { mission: 6, data: 1 }] }],
    facts: [
      { key: 'convoy-chain', value: 'conv2 uses MOVE -> HOUND_DOG -> LOOP under the losc fail trigger' },
      { key: 'auto-start', value: 'auto only enables production once both monitored zones are crossed' },
      { key: 'timer-chain', value: 'tim2 force-fires timr when the player enters the final zone' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU11EA',
    title: 'Soviet 11A beachhead assault',
    triggers: [
      { name: 'win1', event1: { type: 11, data: 1 }, event2: { type: 11, data: 8 }, action1: { type: 1 } },
      { name: 'los1', event1: { type: 11, data: 2 }, action1: { type: 2 } },
      { name: 'prod', event1: { type: 13, data: 0 }, action1: { type: 3 } },
      { name: 'auto', event1: { type: 7 }, action1: { type: 3 }, action2: { type: 13 } },
      { name: 'para', event1: { type: 19, data: 16 }, action1: { type: 34 }, action2: { type: 34 } },
    ],
    teams: [
      { name: 'mcv1', missions: [{ mission: 3, data: 3 }, { mission: 9, data: 0 }] },
      { name: 'crs1', requiresMission: 2 },
      { name: 'lst5', minMissionCounts: [{ mission: 9, count: 5 }] },
    ],
    facts: [
      { key: 'deploy-hook', value: 'mcv1 and lst5 both require TMISSION_DEPLOY for the beachhead setup' },
      { key: 'formation-hook', value: 'crs1 is one of the later-team cases that depends on TMISSION_CHANGE_FORMATION' },
      { key: 'special-chain', value: 'para grants the dual FULL_SPECIAL actions once the support build appears' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU11EB',
    title: 'Soviet 11B beachhead assault branch',
    triggers: [
      { name: 'win1', event1: { type: 11, data: 1 }, event2: { type: 11, data: 13 }, action1: { type: 1 } },
      { name: 'los1', event1: { type: 11, data: 2 }, action1: { type: 2 } },
      { name: 'prod', event1: { type: 13, data: 0 }, action1: { type: 3 } },
      { name: 'auto', event1: { type: 7 }, action1: { type: 3 }, action2: { type: 13 } },
      { name: 'para', event1: { type: 19, data: 16 }, action1: { type: 34 }, action2: { type: 34 } },
    ],
    teams: [
      { name: 'mcv1', missions: [{ mission: 3, data: 3 }, { mission: 9, data: 0 }] },
      { name: 'lst5', minMissionCounts: [{ mission: 9, count: 5 }] },
    ],
    facts: [
      { key: 'deploy-hook', value: 'the alternate branch still needs MCV and LST deploy scripts to establish the landing zone' },
      { key: 'escort-hook', value: 'the alternate branch keeps the coastal escort loop but drops the formation change from crs1' },
      { key: 'special-chain', value: 'para retains the dual FULL_SPECIAL support unlock' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU12EA',
    title: 'Soviet 12 capture network',
    triggers: [
      { name: 'cap1', event1: { type: 1, data: 2 }, action1: { type: 28, data: 2 }, action2: { type: 2 } },
      { name: 'cap2', event1: { type: 1, data: 2 }, action1: { type: 28, data: 3 }, action2: { type: 2 } },
      { name: 'cap3', event1: { type: 1, data: 2 }, action1: { type: 28, data: 4 }, action2: { type: 2 } },
      { name: 'g1+', event1: { type: 27, data: 5 }, event2: { type: 27, data: 4 }, action1: { type: 28, data: 1 } },
      { name: 'g5+', event1: { type: 27, data: 2 }, event2: { type: 27, data: 3 }, action1: { type: 28, data: 5 } },
      { name: 'g6+1', event1: { type: 27, data: 2 }, event2: { type: 28, data: 6 }, action1: { type: 28, data: 6 }, action2: { type: 27, data: 50 } },
      { name: 'fail', event1: { type: 14 }, action1: { type: 22 }, action1Trigger: 'det1', action2: { type: 2 } },
      { name: 'lose', event1: { type: 11, data: 2 }, event2: { type: 27, data: 8 }, action1: { type: 2 } },
      { name: 'g7+', event1: { type: 19, data: 11 }, action1: { type: 28, data: 7 } },
      { name: 'g9+', event1: { type: 19, data: 16 }, event2: { type: 19, data: 14 }, action1: { type: 28, data: 9 } },
      { name: 'win', event1: { type: 27, data: 1 }, action1: { type: 12 }, action1Trigger: 'g12?', action2: { type: 22 }, action2Trigger: 'win2' },
      { name: 'win2', action2: { type: 1 } },
    ],
    teams: [{ name: 'gr-lst1', minMissionCounts: [{ mission: 9, count: 5 }] }],
    facts: [
      { key: 'capture-chain', value: 'cap1/cap2/cap3 and g1+/g5+/g6+ fold the three capture globals into the win state' },
      { key: 'timer-chain', value: 'fail still detonates det1 and loses when the mission timer expires' },
      { key: 'deploy-hook', value: 'gr-lst1 repeatedly uses TMISSION_DEPLOY to establish the beach defenses' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU13EA',
    title: 'Soviet 13A chronosphere strike',
    triggers: [
      { name: 'ENT1', event1: { type: 1, data: 2 }, action1: { type: 3 }, action2: { type: 22 }, action2Trigger: 'auto' },
      { name: 'prod', event1: { type: 13, data: 0 }, action1: { type: 3 } },
      { name: 'auto', event1: { type: 13, data: 150 }, action1: { type: 13 }, action2: { type: 13 } },
      { name: 'win1', event1: { type: 11, data: 1 }, event2: { type: 11, data: 8 }, action1: { type: 1 } },
      { name: 'chro', event1: { type: 7 }, event2: { type: 1, data: 2 }, action1: { type: 2 }, action2: { type: 1 } },
      { name: 'los4', event1: { type: 27, data: 1 }, event2: { type: 1, data: 2 }, action2: { type: 22 }, action2Trigger: 'win2' },
      { name: 'win2', action1: { type: 1 } },
      { name: 'los3', event1: { type: 10, data: 5 }, action1: { type: 2 } },
      { name: 'para', event1: { type: 19, data: 16 }, action1: { type: 34 }, action2: { type: 34 } },
    ],
    teams: [
      { name: 'hunt1', requiresMission: 2 },
      { name: 'mlay1', minMissionCounts: [{ mission: 9, count: 5 }] },
      { name: 'lst8', requiresMission: 12, minMissionCounts: [{ mission: 9, count: 5 }] },
    ],
    facts: [
      { key: 'chrono-hook', value: 'chro remains the mixed lose/win trigger around the chronosphere target' },
      { key: 'formation-hook', value: 'hunt1 is another late-campaign user of TMISSION_CHANGE_FORMATION' },
      { key: 'deploy-hook', value: 'mlay1 and lst8 both require repeated TMISSION_DEPLOY passes' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU13EB',
    title: 'Soviet 13B chronosphere strike branch',
    triggers: [
      { name: 'prod', event1: { type: 13, data: 0 }, action1: { type: 3 } },
      { name: 'auto', event1: { type: 13, data: 162 }, action1: { type: 13 }, action2: { type: 13 } },
      { name: 'win1', event1: { type: 11, data: 1 }, event2: { type: 11, data: 8 }, action1: { type: 1 } },
      { name: 'chro', event1: { type: 7 }, event2: { type: 1, data: 2 }, action1: { type: 2 }, action2: { type: 1 } },
      { name: 'los3', event1: { type: 10, data: 5 }, action1: { type: 2 } },
      { name: 'los4', event1: { type: 27, data: 1 }, event2: { type: 1, data: 2 }, action2: { type: 22 }, action2Trigger: 'win2' },
      { name: 'win2', action2: { type: 1 } },
      { name: 'setg', event1: { type: 13, data: 0 }, action1: { type: 28, data: 5 }, action2: { type: 22 }, action2Trigger: 'set7' },
      { name: 'set7', action1: { type: 28, data: 6 }, action2: { type: 28, data: 7 } },
      { name: 'para', event1: { type: 19, data: 16 }, action1: { type: 34 }, action2: { type: 34 } },
    ],
    teams: [
      { name: 'hunt1', requiresMission: 2 },
      { name: 'mlay1', minMissionCounts: [{ mission: 9, count: 5 }] },
    ],
    facts: [
      { key: 'chrono-hook', value: 'chro still guards the chronosphere objective in the alternate branch' },
      { key: 'global-chain', value: 'setg -> set7 seeds globals 5/6/7 for the late reinforcement lattice' },
      { key: 'formation-hook', value: 'hunt1 keeps the CHANGE_FORMATION dependency in the B branch as well' },
    ],
  }),
  createSpecAgent({
    scenarioId: 'SCU14EA',
    title: 'Soviet 14 final assault',
    triggers: [
      { name: 'bld1', event1: { type: 19, data: 2 }, event2: { type: 19, data: 28 }, action1: { type: 28, data: 1 }, action2: { type: 12 }, action2Trigger: 'set1' },
      { name: 'pro1', event1: { type: 27, data: 1 }, action1: { type: 3 }, action2: { type: 4 }, action2Team: 'sea1' },
      { name: 'pro2', event1: { type: 13, data: 0 }, action1: { type: 3 } },
      { name: 'win1', event1: { type: 11, data: 1 }, action1: { type: 1 } },
      { name: 'los1', event1: { type: 11, data: 2 }, action1: { type: 2 } },
      { name: 'exp3', event1: { type: 27, data: 4 }, action1: { type: 4 }, action1Team: 'sacr' },
      { name: 'auto', event1: { type: 6 }, event2: { type: 13, data: 300 }, action1: { type: 13 } },
      { name: 'para', event1: { type: 19, data: 16 }, action1: { type: 34 }, action2: { type: 34 } },
    ],
    teams: [
      { name: 'general', missions: [{ mission: 15, data: 16 }] },
      { name: 'auto1', requiresMission: 2 },
      { name: 'auto2', requiresMission: 2 },
    ],
    facts: [
      { key: 'build-chain', value: 'bld1 and pro1/pro2 are the final production gates around the build objectives' },
      { key: 'spy-hook', value: 'general uses TMISSION_SPY to trip the late sacrificial response' },
      { key: 'formation-hook', value: 'auto1 and auto2 are the last main-campaign users of TMISSION_CHANGE_FORMATION' },
    ],
  }),
];

const campaignMissionAgents: MissionAuditAgent[] = [
  ...getCoreCampaignMissionAgents(),
  ...additionalCampaignMissionAgents,
];

export function runCampaignMissionAgents(): MissionAuditReport[] {
  return campaignMissionAgents.map((agent) => auditMission(agent));
}

export function getCampaignMissionAgents(): MissionAuditAgent[] {
  return campaignMissionAgents.slice();
}

export { formatAuditMarkdown };
