/**
 * Tests for AI production gate — C++ parity: AI houses only produce units
 * and build structures after the BEGIN_PRODUCTION trigger fires.
 *
 * In the original C++ Red Alert, AI production is gated behind the
 * TACTION_BEGIN_PRODUCTION (action type 3) trigger action. Without it,
 * AI houses with pre-placed bases sit idle — they guard, patrol, and
 * use existing units, but do not produce new ones or build structures.
 *
 * SCG01EA (Allied Mission 1) is a key test case: USSR has a full base
 * (FACT, WEAP, BARR, PROC, etc.) but no BEGIN_PRODUCTION trigger,
 * so Soviets should NOT produce heavy tanks or any other units.
 */

import { describe, it, expect } from 'vitest';
import {
  parseScenarioINI,
  executeTriggerAction,
  type TriggerAction,
  type ScenarioTrigger,
} from '../engine/scenario';
import { PRODUCTION_ITEMS } from '../engine/types';
import * as fs from 'fs';
import * as path from 'path';

// TACTION_BEGIN_PRODUCTION = 3 (from TACTION.H)
const TACTION_BEGIN_PRODUCTION = 3;

// Helper: read a scenario INI from the assets directory
function readScenarioINI(scenarioId: string): string {
  const filePath = path.resolve(
    __dirname, '..', '..', '..', 'public', 'ra', 'assets', `${scenarioId}.ini`
  );
  return fs.readFileSync(filePath, 'utf-8');
}

// Helper: check if any trigger in a scenario has BEGIN_PRODUCTION action
function hasBeginProductionTrigger(triggers: ScenarioTrigger[]): boolean {
  for (const t of triggers) {
    if (t.action1.action === TACTION_BEGIN_PRODUCTION) return true;
    if (t.action2.action === TACTION_BEGIN_PRODUCTION) return true;
  }
  return false;
}

describe('AI production gate — BEGIN_PRODUCTION trigger requirement', () => {
  it('SCG01EA has no BEGIN_PRODUCTION trigger — USSR should not produce', () => {
    const ini = readScenarioINI('SCG01EA');
    const data = parseScenarioINI(ini);
    expect(data.triggers.length).toBeGreaterThan(0);
    expect(hasBeginProductionTrigger(data.triggers)).toBe(false);
  });

  it('SCG01EA USSR has Credits=25 (raw INI value) — very limited budget', () => {
    const ini = readScenarioINI('SCG01EA');
    const data = parseScenarioINI(ini);
    // parseScenarioINI stores the raw Credits= value (before x100 in loadScenario)
    const ussrCredits = data.houseCredits.get('USSR');
    expect(ussrCredits).toBe(25);
  });

  it('SCG01EA USSR has FACT and WEAP — would trigger auto AI state creation', () => {
    const ini = readScenarioINI('SCG01EA');
    const data = parseScenarioINI(ini);
    // parseScenarioINI returns house as raw string
    const ussrStructures = data.structures.filter(s => s.house === 'USSR');
    const hasFact = ussrStructures.some(s => s.type === 'FACT');
    const hasWeap = ussrStructures.some(s => s.type === 'WEAP');
    expect(hasFact).toBe(true);
    expect(hasWeap).toBe(true);
  });

  it('SCG01EA [Base] Count=0 — no base rebuild list', () => {
    const ini = readScenarioINI('SCG01EA');
    const data = parseScenarioINI(ini);
    // parseScenarioINI returns baseStructures (not baseBlueprint)
    expect(data.baseStructures).toHaveLength(0);
  });

  it('SCG01EA TeamTypes contain no tanks — only infantry, dogs, civilians', () => {
    const ini = readScenarioINI('SCG01EA');
    const data = parseScenarioINI(ini);
    const tankTypes = ['1TNK', '2TNK', '3TNK', '4TNK', 'V2RL', 'ARTY'];
    for (const team of data.teamTypes) {
      for (const member of team.members) {
        expect(tankTypes).not.toContain(member.type);
      }
    }
  });

  it('3TNK (Heavy Tank) is soviet faction with WEAP prerequisite', () => {
    const heavyTank = PRODUCTION_ITEMS.find(p => p.type === '3TNK');
    expect(heavyTank).toBeDefined();
    expect(heavyTank!.faction).toBe('soviet');
    expect(heavyTank!.prerequisite).toBe('WEAP');
    expect(heavyTank!.cost).toBe(950);
  });

  it('4TNK (Mammoth Tank) requires STEK tech center prerequisite', () => {
    const mammoth = PRODUCTION_ITEMS.find(p => p.type === '4TNK');
    expect(mammoth).toBeDefined();
    expect(mammoth!.faction).toBe('soviet');
    expect(mammoth!.techPrereq).toBe('STEK');
    expect(mammoth!.cost).toBe(1700);
  });
});

describe('Later missions DO have BEGIN_PRODUCTION triggers', () => {
  // These missions have active Soviet AI bases that should produce
  const missionsWithProduction = [
    'SCG05EA',  // BAS1 trigger: action2=3 (BEGIN_PRODUCTION)
    'SCG08EA',  // sbld trigger: action2=3 (BEGIN_PRODUCTION)
    'SCG10EA',  // alrt trigger: action2=3 (BEGIN_PRODUCTION)
  ];

  for (const scenarioId of missionsWithProduction) {
    it(`${scenarioId} has at least one BEGIN_PRODUCTION trigger`, () => {
      const ini = readScenarioINI(scenarioId);
      const data = parseScenarioINI(ini);
      expect(hasBeginProductionTrigger(data.triggers)).toBe(true);
    });
  }
});

describe('executeTriggerAction emits beginProduction for action type 3', () => {
  it('BEGIN_PRODUCTION action returns house index in beginProduction field', () => {
    const action: TriggerAction = { action: TACTION_BEGIN_PRODUCTION, team: -1, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, [], new Map(), new Set(), [], 2 /* USSR house index */
    );
    expect(result.beginProduction).toBe(2);
  });

  it('non-BEGIN_PRODUCTION action does not set beginProduction', () => {
    // action type 7 = REINFORCEMENTS
    const action: TriggerAction = { action: 7, team: 0, trigger: -1, data: 0 };
    const result = executeTriggerAction(
      action, [], new Map(), new Set(), [], 2
    );
    expect(result.beginProduction).toBeUndefined();
  });
});
