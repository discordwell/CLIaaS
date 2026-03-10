/**
 * Briefing text parity tests — verify that the BriefingRenderer's text
 * matches the original Red Alert scenario INI files verbatim.
 *
 * The INI [Briefing] section uses numbered keys (1=, 2=, ...) whose values
 * are concatenated, with @@ as the paragraph separator.
 */
import { describe, it, expect } from 'vitest';
import { INI_BRIEFING_TEXT } from '../engine/briefing';
import { MISSIONS } from '../engine/scenario';

// === Original INI briefing text (ground truth, copied from INI files) ===

const EXPECTED_INI_TEXT: Record<string, string> = {
  SCA01EA:
    "We've lost contact with one of our outposts. Before it went off-line, we " +
    'recieved a brief communique about giant ants. We\'re unsure what to make ' +
    'of this report, so we want you to investigate.' +
    '@@Scout the area, bring the outpost back on-line, and report your findings. ' +
    'If there is a threat, reinforcements will be sent in to help you.' +
    "@@Keep the base functional and radio contact open -- we don't want to lose the outpost again.",

  SCA02EA:
    "Who would've believed it -- Giant Ants." +
    "@@Now that your MCV has arrived, we must evacuate the civilians in the area " +
    "-- they don't stand a chance against these ants." +
    '@@There are two villages in your immediate area. Locate them and evacuate ' +
    "the civilians to the island in the northwest. You'll also have to take out " +
    'all the bridges in this area to stop the ants from completely overrunning you.' +
    '@@You must destroy the bridges, and evac at least one civilian from each town ' +
    'for the mission to be a success.',

  SCA03EA:
    "The source of the ant's activity has been pinpointed in this area. We " +
    'suspect that their nests are in this area -- they must be destroyed ' +
    '@@A team of civilian specialists are en-route to your location. Use them to ' +
    'gas all the ant nests in the area. In addition, destroy all ants that you encounter.' +
    '@@Be careful -- these things can chew through anything. Good luck.',

  SCA04EA:
    "We've discovered a series of tunnels underneath the ruined base. Now that " +
    "we've cut off their escape routes, the ants have nowhere left to run to." +
    '@@Perform a sweep and clear of all the tunnels, and find the cause of ' +
    "these abominations. Destroy anything that isn't human!" +
    '@@The power to the tunnel lights has been knocked out, which will limit ' +
    'visibility. Find the generator controls, and you can re-activate the lights.',
};

describe('Briefing text parity with original INI files', () => {
  const SCENARIO_IDS = ['SCA01EA', 'SCA02EA', 'SCA03EA', 'SCA04EA'] as const;

  it('INI_BRIEFING_TEXT covers all four ant missions', () => {
    for (const id of SCENARIO_IDS) {
      expect(INI_BRIEFING_TEXT[id], `${id} should be defined`).toBeDefined();
    }
  });

  for (const id of SCENARIO_IDS) {
    it(`${id} briefing text matches original INI exactly`, () => {
      expect(INI_BRIEFING_TEXT[id]).toBe(EXPECTED_INI_TEXT[id]);
    });
  }

  it('SCA01EA preserves the original "recieved" typo', () => {
    expect(INI_BRIEFING_TEXT.SCA01EA).toContain('recieved');
    expect(INI_BRIEFING_TEXT.SCA01EA).not.toContain('received');
  });

  it('SCA03EA preserves the space-before-@@ quirk from the INI', () => {
    // The original INI has "destroyed @@A" (space before @@)
    expect(INI_BRIEFING_TEXT.SCA03EA).toContain('destroyed @@');
  });

  it('all @@ separators are preserved in raw text', () => {
    // SCA01EA has 2 @@ (3 paragraphs)
    expect(INI_BRIEFING_TEXT.SCA01EA.split('@@').length).toBe(3);
    // SCA02EA has 3 @@ (4 paragraphs)
    expect(INI_BRIEFING_TEXT.SCA02EA.split('@@').length).toBe(4);
    // SCA03EA has 2 @@ (3 paragraphs)
    expect(INI_BRIEFING_TEXT.SCA03EA.split('@@').length).toBe(3);
    // SCA04EA has 2 @@ (3 paragraphs)
    expect(INI_BRIEFING_TEXT.SCA04EA.split('@@').length).toBe(3);
  });
});

describe('MISSIONS briefing text matches INI source', () => {
  // MISSIONS stores @@ as \n\n — verify they are equivalent
  for (const id of ['SCA01EA', 'SCA02EA', 'SCA03EA', 'SCA04EA'] as const) {
    it(`${id} MISSIONS.briefing matches INI text (with @@→\\n\\n)`, () => {
      const mission = MISSIONS.find(m => m.id === id);
      expect(mission, `${id} should exist in MISSIONS`).toBeDefined();
      // Convert INI @@ to \n\n and trim whitespace around breaks for comparison
      const expected = INI_BRIEFING_TEXT[id]
        .split('@@')
        .map(p => p.trim())
        .join('\n\n');
      expect(mission!.briefing).toBe(expected);
    });
  }
});
