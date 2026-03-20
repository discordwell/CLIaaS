/**
 * C++ parity tests: alliance handling
 *
 * C++ source: house.cpp:7156-7163 (INI alliance loading)
 *   p->Make_Ally(h) sets Allies |= (1L << h) — ONE-WAY only
 *
 * C++ source: house.cpp:2023-2028 (Is_Ally check)
 *   return ((1 << house) & Allies) != 0 — checks caller's bitfield only
 *
 * Key behavior: [Germany] Allies=Greece means Germany considers Greece
 * an ally, but Greece does NOT automatically consider Germany an ally
 * unless [Greece] Allies=Germany is also specified.
 */

import { describe, it, expect } from 'vitest';
import { buildAlliancesFromINI, House } from '../engine/types';

describe('Alliance table — C++ parity', () => {
  it('alliances are one-way: [Germany] Allies=Greece does not make Greece allied to Germany', () => {
    const alliesMap = new Map<House, House[]>([
      [House.Germany, [House.Greece]],
    ]);
    const table = buildAlliancesFromINI(alliesMap, House.Greece);

    // Germany considers Greece an ally
    expect(table.get(House.Germany)!.has(House.Greece)).toBe(true);
    // Greece does NOT consider Germany an ally (one-way)
    expect(table.get(House.Greece)!.has(House.Germany)).toBe(false);
  });

  it('mutual alliances require both sides to declare', () => {
    const alliesMap = new Map<House, House[]>([
      [House.Greece, [House.England]],
      [House.England, [House.Greece]],
    ]);
    const table = buildAlliancesFromINI(alliesMap, House.Greece);

    // Both sides declared — mutual alliance
    expect(table.get(House.Greece)!.has(House.England)).toBe(true);
    expect(table.get(House.England)!.has(House.Greece)).toBe(true);
  });

  it('every house is always allied with itself', () => {
    const table = buildAlliancesFromINI(new Map(), House.Greece);
    expect(table.get(House.Greece)!.has(House.Greece)).toBe(true);
    expect(table.get(House.USSR)!.has(House.USSR)).toBe(true);
  });

  it('GoodGuy is always mutually allied with the player', () => {
    const table = buildAlliancesFromINI(new Map(), House.Greece);
    expect(table.get(House.GoodGuy)!.has(House.Greece)).toBe(true);
    expect(table.get(House.Greece)!.has(House.GoodGuy)).toBe(true);
  });

  it('every house considers Neutral an ally (one-way, house.cpp:7158)', () => {
    const table = buildAlliancesFromINI(new Map(), House.Greece);
    // Every house has Neutral in its alliance set (Make_Ally(HOUSE_NEUTRAL))
    expect(table.get(House.Greece)!.has(House.Neutral)).toBe(true);
    expect(table.get(House.USSR)!.has(House.Neutral)).toBe(true);
    // But Neutral does NOT auto-ally everyone — its alliances come from INI
    // With no Allies= specified, Neutral only allies itself
    expect(table.get(House.Neutral)!.has(House.Greece)).toBe(false);
    expect(table.get(House.Neutral)!.has(House.USSR)).toBe(false);
  });

  it('SCG08EA: Germany DOME should not be allied to player Greece', () => {
    // SCG08EA.ini: [Germany] Allies=Greece, [Greece] has no Allies= entry
    const alliesMap = new Map<House, House[]>([
      [House.Germany, [House.Greece]],
      [House.Greece, [House.Spain, House.England, House.France, House.Turkey]],
    ]);
    const table = buildAlliancesFromINI(alliesMap, House.Greece);

    // Germany→Greece is one-way: Greece should NOT consider Germany an ally
    expect(table.get(House.Greece)!.has(House.Germany)).toBe(false);
    // Germany considers Greece an ally
    expect(table.get(House.Germany)!.has(House.Greece)).toBe(true);
  });
});
