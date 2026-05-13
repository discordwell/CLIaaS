/**
 * C++ parity: OverlayPack wall cells carry CellClass::Owner.
 *
 * C++ OverlayClass::Read_INI loads buildings before overlays, then assigns each
 * wall overlay cell to the nearest BuildingClass owner. TechnoClass::Evaluate_Just_Cell
 * uses that owner to decide whether AI may auto-target the wall.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { House } from '../engine/types';
import { loadScenario } from '../engine/scenario';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubScenarioFetch(scenarioId: string): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    const requested = url.split('/').pop()?.replace(/\.ini$/i, '');
    if (requested !== scenarioId) {
      return { ok: false, text: async () => '' } as Response;
    }
    const text = readFileSync(join(__dirname, `../../../public/ra/assets/${scenarioId}.ini`), 'utf-8');
    return { ok: true, text: async () => text } as Response;
  });
}

describe('OverlayPack wall ownership (overlay.cpp:268-352)', () => {
  it('SCU06EA sandbag at (74,35) is owned by nearest building house', async () => {
    stubScenarioFetch('SCU06EA');

    const scenario = await loadScenario('SCU06EA');

    expect(scenario.map.getWallType(74, 35)).toBe('SBAG');
    expect(scenario.map.getWallOwner(74, 35)).toBe(House.Spain);
  });
});
