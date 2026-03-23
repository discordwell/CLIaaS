/**
 * C++ parity tests: Alliance group name expansion for "soviet" and "allies" keywords
 *
 * C++ source refs:
 *   - conquer.cpp:5490-5506 — Get_Owners() parses Allies= field tokens:
 *     - "soviet"          → (1<<HOUSE_USSR) | (1<<HOUSE_UKRAINE) | (1<<HOUSE_BAD)
 *     - "allies"/"allied" → (1<<HOUSE_SPAIN) | (1<<HOUSE_GREECE) | (1<<HOUSE_ENGLAND)
 *                         | (1<<HOUSE_GERMANY) | (1<<HOUSE_FRANCE) | (1<<HOUSE_TURKEY)
 *                         | (1<<HOUSE_GOOD)
 *     - Individual house names resolve to their single house bit
 *   - house.cpp:7156 — Read_INI calls Get_Owners(hname, "Allies", (1<<HOUSE_NEUTRAL))
 *
 * Bug: Previously, "soviet" mapped to House.Neutral via toHouse() default case,
 *      and "allies"/"allied" similarly fell through to Neutral.
 *
 * Affected scenarios: SCG14EA, SCG11EB, SCG12EA, SCG20EA, SCG03EB, SCA04EA, SCU07EA, SCU10EA
 */

import { describe, it, expect } from 'vitest';
import { House } from '../engine/types';
import { expandAllyToken } from '../engine/scenario';

describe('C++ parity: alliance group keyword expansion (conquer.cpp:5490-5506)', () => {
  describe('expandAllyToken', () => {
    it('"soviet" expands to USSR, Ukraine, BadGuy', () => {
      const result = expandAllyToken('soviet');
      expect(result).toContain(House.USSR);
      expect(result).toContain(House.Ukraine);
      expect(result).toContain(House.BadGuy);
      expect(result).toHaveLength(3);
    });

    it('"Soviet" (mixed case) expands to USSR, Ukraine, BadGuy', () => {
      const result = expandAllyToken('Soviet');
      expect(result).toContain(House.USSR);
      expect(result).toContain(House.Ukraine);
      expect(result).toContain(House.BadGuy);
      expect(result).toHaveLength(3);
    });

    it('"allies" expands to Spain, Greece, England, Germany, France, Turkey, GoodGuy', () => {
      const result = expandAllyToken('allies');
      expect(result).toContain(House.Spain);
      expect(result).toContain(House.Greece);
      expect(result).toContain(House.England);
      expect(result).toContain(House.Germany);
      expect(result).toContain(House.France);
      expect(result).toContain(House.Turkey);
      expect(result).toContain(House.GoodGuy);
      expect(result).toHaveLength(7);
    });

    it('"allied" expands identically to "allies"', () => {
      const allies = expandAllyToken('allies');
      const allied = expandAllyToken('allied');
      expect(new Set(allied)).toEqual(new Set(allies));
      expect(allied).toHaveLength(allies.length);
    });

    it('"Allied" (mixed case) expands correctly', () => {
      const result = expandAllyToken('Allied');
      expect(result).toContain(House.Spain);
      expect(result).toContain(House.Greece);
      expect(result).toContain(House.England);
      expect(result).toContain(House.Germany);
      expect(result).toContain(House.France);
      expect(result).toContain(House.Turkey);
      expect(result).toContain(House.GoodGuy);
      expect(result).toHaveLength(7);
    });

    it('individual house name "Greece" passes through as single-element array', () => {
      const result = expandAllyToken('Greece');
      expect(result).toEqual([House.Greece]);
    });

    it('individual house name "USSR" passes through as single-element array', () => {
      const result = expandAllyToken('USSR');
      expect(result).toEqual([House.USSR]);
    });

    it('individual house name "BadGuy" passes through as single-element array', () => {
      const result = expandAllyToken('BadGuy');
      expect(result).toEqual([House.BadGuy]);
    });

    it('individual house name "GoodGuy" passes through as single-element array', () => {
      const result = expandAllyToken('GoodGuy');
      expect(result).toEqual([House.GoodGuy]);
    });

    it('"soviet" does NOT expand to Neutral (regression: was the old bug)', () => {
      const result = expandAllyToken('soviet');
      expect(result).not.toContain(House.Neutral);
    });

    it('"allies" does NOT expand to Neutral (regression: was the old bug)', () => {
      const result = expandAllyToken('allies');
      expect(result).not.toContain(House.Neutral);
    });

    it('"soviet" does NOT include any Allied houses', () => {
      const result = expandAllyToken('soviet');
      const alliedHouses = [House.Spain, House.Greece, House.England, House.Germany,
                            House.France, House.Turkey, House.GoodGuy];
      for (const h of alliedHouses) {
        expect(result).not.toContain(h);
      }
    });

    it('"allies" does NOT include any Soviet houses', () => {
      const result = expandAllyToken('allies');
      const sovietHouses = [House.USSR, House.Ukraine, House.BadGuy];
      for (const h of sovietHouses) {
        expect(result).not.toContain(h);
      }
    });
  });

  describe('flatMap integration: Allies= with mixed tokens', () => {
    // Simulates what happens at scenario.ts line 1795:
    //   v.flatMap(expandAllyToken)
    // This is the actual code path used during scenario loading.

    it('["soviet","Special"] expands to USSR, Ukraine, BadGuy, Special', () => {
      const tokens = ['soviet', 'Special'];
      const result = tokens.flatMap(expandAllyToken);
      expect(result).toContain(House.USSR);
      expect(result).toContain(House.Ukraine);
      expect(result).toContain(House.BadGuy);
      expect(result).toContain(House.Special);
      expect(result).toHaveLength(4);
    });

    it('["allies","USSR"] expands to all Allied houses + USSR', () => {
      const tokens = ['allies', 'USSR'];
      const result = tokens.flatMap(expandAllyToken);
      expect(result).toContain(House.Spain);
      expect(result).toContain(House.Greece);
      expect(result).toContain(House.England);
      expect(result).toContain(House.Germany);
      expect(result).toContain(House.France);
      expect(result).toContain(House.Turkey);
      expect(result).toContain(House.GoodGuy);
      expect(result).toContain(House.USSR);
      expect(result).toHaveLength(8);
    });

    it('["Greece","England"] stays as two individual houses', () => {
      const tokens = ['Greece', 'England'];
      const result = tokens.flatMap(expandAllyToken);
      expect(result).toEqual([House.Greece, House.England]);
    });
  });
});
