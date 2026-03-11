/**
 * Fog of war unit visibility tests — verify enemy units are visible in
 * explored-but-not-in-sight (fogged) cells, matching C++ behavior.
 *
 * C++ reference:
 *   cell.cpp:1275 — objects drawn if IsMapped (vis >= 1)
 *   techno.cpp:4159-4194 — Visual_Character() uses cloaking, NOT fog
 *   display.cpp:2136-2146 — fog only dims terrain, doesn't hide units
 *   Fog dimming: SHADOW.SHP overlay (renderFogOfWar) handles visual darkening;
 *     no entity-level alpha reduction needed.
 *
 * Bug: renderer.ts had `if (vis === 1 && !entity.isPlayerUnit) continue;`
 * which incorrectly hid enemy units in fogged cells.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const RENDERER_PATH = join(__dirname, '../engine/renderer.ts');
const rendererSource = readFileSync(RENDERER_PATH, 'utf-8');

describe('Fog of war unit visibility (C++ parity)', () => {
  it('does NOT skip rendering non-player entities in fogged cells (vis=1)', () => {
    // The old bug: `if (map.getVisibility(ecx, ecy) === 1 && !entity.isPlayerUnit) continue;`
    // This pattern hides enemy units in fog, contradicting C++ behavior.
    const bugPattern = /getVisibility.*===\s*1\s*&&\s*!entity\.isPlayerUnit.*continue/;
    expect(rendererSource).not.toMatch(bugPattern);
  });

  it('still skips rendering entities in shroud (vis=0)', () => {
    // Entities in unexplored cells should never be rendered
    const shroudSkip = /getVisibility.*===\s*0\)\s*continue/;
    expect(rendererSource).toMatch(shroudSkip);
  });

  it('does NOT double-dim entities in fog (shadow overlay handles dimming)', () => {
    // C++ renders objects at full brightness; SHADOW.SHP overlay provides fog darkening.
    // Entity-level alpha reduction (globalAlpha *= 0.6) would cause double-dimming
    // since renderFogOfWar draws shadow overlays on top of entities.
    // Verify no "inFog" alpha reduction exists in the entity rendering loop.
    const doubleDimPattern = /inFog[\s\S]{0,100}globalAlpha\s*\*=/;
    expect(rendererSource).not.toMatch(doubleDimPattern);
  });
});
