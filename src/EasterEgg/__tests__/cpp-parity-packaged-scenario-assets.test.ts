import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { extractAllMIX } from '../../../scripts/ra-assets/gamedata.js';
import { MixFile } from '../../../scripts/ra-assets/mix.js';

const projectRoot = resolve(__dirname, '../../..');
const gamedataPath = resolve(projectRoot, 'public/ra/gamedata.data');
const gamedataJsPath = resolve(projectRoot, 'public/ra/gamedata.js');
const assetsDir = resolve(projectRoot, 'public/ra/assets');

function baseCampaignScenarioIds(): string[] {
  const ids: string[] = [];
  for (let i = 1; i <= 14; i++) {
    const num = i.toString().padStart(2, '0');
    ids.push(`SCG${num}EA`, `SCG${num}EB`, `SCU${num}EA`, `SCU${num}EB`);
  }
  return ids;
}

describe('C++ parity: packaged scenario assets', () => {
  it('keeps TS base campaign INIs byte-identical to the C++ GENERAL.MIX source', () => {
    const mixes = extractAllMIX(gamedataPath, gamedataJsPath);
    const generalMixData = mixes.get('GENERAL.MIX');
    expect(generalMixData, 'GENERAL.MIX is packaged for the C++ harness').toBeDefined();

    const generalMix = MixFile.fromBuffer(generalMixData!);
    let packedScenarioCount = 0;

    for (const scenarioId of baseCampaignScenarioIds()) {
      const packed = generalMix.readFile(`${scenarioId}.INI`);
      if (!packed) continue;
      packedScenarioCount++;

      const assetPath = resolve(assetsDir, `${scenarioId}.ini`);
      expect(existsSync(assetPath), `${scenarioId}.ini exists in TS assets`).toBe(true);
      expect(
        readFileSync(assetPath).equals(packed),
        `${scenarioId}.ini must match GENERAL.MIX; stale extracted assets change initial map state before tick 0`,
      ).toBe(true);
    }

    expect(packedScenarioCount).toBeGreaterThan(20);
  });
});
