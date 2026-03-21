/**
 * C++ Behavioral Parity: Audio File Mappings
 *
 * Verifies that TS sound names map to the correct C++ .AUD source files.
 * The extraction script (scripts/extract-ra-audio.ts) defines the mapping.
 *
 * C++ Source References:
 *   audio.cpp:114-155   — SFX filename table (VOC_* enum → .AUD file)
 *   audio.cpp:475-599   — Speech filename table (VOX_* enum → .AUD file)
 *   defines.h:3270-3300 — VOX enum definition
 *   unit.cpp:2658       — VOX_MADTANK_DEPLOYED = "TANK01" (speech, English only)
 *
 * Key parity issue found: TANK01.AUD was incorrectly mapped as 'explode_lg'.
 * TANK01.AUD is VOX_MADTANK_DEPLOYED speech ("M.A.D. Tank Deployed"), NOT an explosion.
 * The correct explosion sound is KABOOM22.AUD (VOC_KABOOM22 — "Long explosion (sharp)").
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const EXTRACT_SCRIPT = join(process.cwd(), 'scripts', 'extract-ra-audio.ts');
let scriptSource: string;
try {
  scriptSource = readFileSync(EXTRACT_SCRIPT, 'utf-8');
} catch {
  scriptSource = '';
}

describe('Audio extraction mappings match C++ audio.cpp', () => {

  // C++ audio.cpp:497 — "TANK01" is VOX_MADTANK_DEPLOYED, a SPEECH file.
  // It should NEVER be used as an explosion sound effect.
  it('explode_lg does NOT use TANK01.AUD (that is MAD Tank Deployed speech)', () => {
    // Find the explode_lg mapping line
    const explodeLgMatch = scriptSource.match(
      /outputName:\s*'explode_lg'.*?audFile:\s*'([^']+)'/s
    );
    expect(explodeLgMatch).toBeTruthy();
    const audFile = explodeLgMatch![1];
    expect(audFile).not.toBe('TANK01.AUD');
  });

  // C++ audio.cpp:127 — VOC_KABOOM22 = "KABOOM22" — Long explosion (sharp)
  it('explode_lg uses KABOOM22.AUD (C++ VOC_KABOOM22 — long sharp explosion)', () => {
    const explodeLgMatch = scriptSource.match(
      /outputName:\s*'explode_lg'.*?audFile:\s*'([^']+)'/s
    );
    expect(explodeLgMatch).toBeTruthy();
    expect(explodeLgMatch![1]).toBe('KABOOM22.AUD');
  });

  // C++ audio.cpp:123 — VOC_KABOOM1 = "KABOOM1" — Long explosion (muffled)
  // Other valid explosion options: KABOOM1, KABOOM12, KABOOM15, KABOOM25, KABOOM30
  it('explosion sounds use KABOOM or GUN series, never TANK/speech files', () => {
    const explosionMappings = [
      { name: 'explode_sm', expected: /^(GUN|KABOOM)/ },
      { name: 'explode_lg', expected: /^(GUN|KABOOM)/ },
      { name: 'building_explode', expected: /^(CRUMBLE|IRONCUR|KABOOM)/ },
    ];
    for (const { name, expected } of explosionMappings) {
      const match = scriptSource.match(
        new RegExp(`outputName:\\s*'${name}'.*?audFile:\\s*'([^']+)'`, 's')
      );
      expect(match, `${name} should have a mapping`).toBeTruthy();
      expect(match![1]).toMatch(expected);
    }
  });

  // C++ audio.cpp:497 — TANK01 maps to VOX_MADTANK_DEPLOYED
  // C++ unit.cpp:2658 — Speak(VOX_MADTANK_DEPLOYED) only during MAD Tank deployment
  it('TANK01.AUD is documented as MAD Tank speech, not an SFX', () => {
    // The script should have a comment noting TANK01 is speech
    expect(scriptSource).toContain('TANK01.AUD is VOX_MADTANK_DEPLOYED speech');
  });

  // Verify weapon sound mappings against C++ audio.cpp SFX table
  const WEAPON_MAPPINGS: [string, string, string][] = [
    // [outputName, expectedAudFile, C++ reference]
    ['rifle',       'GUN5.AUD',      'audio.cpp:109 VOC_RIFLE'],
    ['machinegun',  'GUN11.AUD',     'audio.cpp:115 VOC_MGUN11'],
    ['cannon',      'CANNON1.AUD',   'audio.cpp:99 VOC_CANNON1'],
    ['artillery',   'CANNON2.AUD',   'audio.cpp:100 VOC_CANNON2'],
    ['teslazap',    'TESLA1.AUD',    'audio.cpp:103 VOC_TESLA1'],
    ['grenade',     'GRENADE1.AUD',  'audio.cpp:101 VOC_GRENADE1'],
  ];

  for (const [name, audFile, cppRef] of WEAPON_MAPPINGS) {
    it(`${name} uses ${audFile} (${cppRef})`, () => {
      const match = scriptSource.match(
        new RegExp(`outputName:\\s*'${name}'.*?audFile:\\s*'([^']+)'`, 's')
      );
      expect(match, `${name} should exist in extraction script`).toBeTruthy();
      expect(match![1]).toBe(audFile);
    });
  }

  // EVA speech mappings against C++ audio.cpp speech table
  const EVA_MAPPINGS: [string, string, string][] = [
    ['eva_unit_ready',             'UNITRDY1.AUD',  'audio.cpp:480 VOX_UNIT_READY'],
    ['eva_construction_complete',  'BLDGINF1.AUD',  'audio.cpp:479 VOX_CONSTRUCTION'],
    ['eva_base_attack',            'BASEATK1.AUD',  'audio.cpp:478 VOX_BASE_UNDER_ATTACK'],
    ['eva_low_power',              'LOPOWER1.AUD',  'audio.cpp:481 VOX_LOW_POWER'],
    ['eva_new_options',            'NEWOPT1.AUD',    'audio.cpp:482 VOX_NEW_OPTIONS'],
    ['eva_reinforcements',         'REINFOR1.AUD',   'audio.cpp:476 VOX_REINFORCEMENTS'],
  ];

  for (const [name, audFile, cppRef] of EVA_MAPPINGS) {
    it(`${name} uses ${audFile} (${cppRef})`, () => {
      const match = scriptSource.match(
        new RegExp(`outputName:\\s*'${name}'.*?audFile:\\s*'([^']+)'`, 's')
      );
      expect(match, `${name} should exist in extraction script`).toBeTruthy();
      expect(match![1]).toBe(audFile);
    });
  }

  // Ant-specific sounds from Aftermath expansion
  it('ant sounds use Aftermath expansion files (ANTBITE, ANTDIE, BUZZY1)', () => {
    const antMappings = [
      ['mandible', 'ANTBITE.AUD'],
      ['die_ant', 'ANTDIE.AUD'],
      ['fireball', 'BUZZY1.AUD'],
    ];
    for (const [name, audFile] of antMappings) {
      const match = scriptSource.match(
        new RegExp(`outputName:\\s*'${name}'.*?audFile:\\s*'([^']+)'`, 's')
      );
      expect(match, `${name} should exist`).toBeTruthy();
      expect(match![1]).toBe(audFile);
    }
  });
});
