/**
 * Fog of war unit visibility tests — verify enemy units are visible in
 * explored-but-not-in-sight (fogged) cells, matching C++ behavior.
 *
 * C++ reference:
 *   display.cpp:2113-2151 — Redraw_Icons only calls Draw_It for IsMapped cells
 *   cell.cpp:1275 — Draw_It renders objects if Visual_Character == VISUAL_NORMAL
 *   techno.cpp:4159-4194 — Visual_Character() uses cloaking, NOT fog
 *   Fog dimming: SHADOW.SHP overlay (Redraw_Shadow / renderFogOfWar) handles
 *     visual darkening; objects rendered at full brightness underneath.
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

  it('skips rendering entities in shroud (vis=0) — single cell check, no neighbors', () => {
    // C++ (display.cpp:2113): only the cell containing the object is checked.
    // IsMapped must be true. No neighboring cell lookups.
    const shroudSkip = /getVisibility\(ecx, ecy\) === 0\) continue/;
    expect(rendererSource).toMatch(shroudSkip);
  });

  it('does NOT double-dim entities in fog (shadow overlay handles dimming)', () => {
    // C++ renders objects at full brightness; SHADOW.SHP overlay provides fog darkening.
    // Entity-level alpha reduction (globalAlpha *= 0.6) would cause double-dimming
    // since renderFogOfWar draws shadow overlays on top of entities.
    const doubleDimPattern = /inFog[\s\S]{0,100}globalAlpha\s*\*=/;
    expect(rendererSource).not.toMatch(doubleDimPattern);
  });

  it('does NOT check neighboring cells for entity visibility', () => {
    // C++ checks only the object's own cell. No neighbor lookups.
    // Verify the shroud check doesn't reference ecx-1, ecx+1, etc.
    const neighborPattern = /ecx\s*[-+]\s*1|ecy\s*[-+]\s*1/;
    // Find lines near the visibility check (first 20 lines of entity loop)
    const entityLoop = rendererSource.match(/for \(const entity of sorted\)[\s\S]{0,800}Render interpolation/);
    expect(entityLoop).toBeTruthy();
    expect(entityLoop![0]).not.toMatch(neighborPattern);
  });
});
