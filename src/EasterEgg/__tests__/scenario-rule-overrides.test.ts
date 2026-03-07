import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseScenarioINI } from '../engine/scenario';
import { buildScenarioRuleOverrides } from '../engine/scenarioRules';

const scenarioPath = path.resolve(process.cwd(), 'public/ra/assets/SCA01EA.ini');
const scenarioText = fs.readFileSync(scenarioPath, 'utf8');
const parsed = parseScenarioINI(scenarioText);
const overrides = buildScenarioRuleOverrides(parsed.rawSections);

describe('scenario rule overrides', () => {
  it('applies SCA01EA unit ownership override for E2', () => {
    expect(overrides.scenarioUnitStats.E2.owner).toBe('allied');
    expect(overrides.scenarioProductionItems.find(item => item.type === 'E2')?.faction).toBe('allied');
  });

  it('applies SCA01EA production tech-level override for E3', () => {
    expect(overrides.scenarioProductionItems.find(item => item.type === 'E3')?.techLevel).toBe(-1);
  });

  it('applies SCA01EA Super warhead overrides', () => {
    expect(overrides.scenarioWarheadMeta.Super.destroysWalls).toBe(true);
    expect(overrides.scenarioWarheadProps.Super.infantryDeath).toBe(2);
  });
});
