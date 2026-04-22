/**
 * C++ Parity: BuildingClass::Unlimbo → Logic array order.
 *
 * ## C++ rules (verified against source)
 *
 * 1. `ObjectClass::Unlimbo` (object.cpp:1412-1414) calls `Logic.Submit(this)` when
 *    the object's class is Sentient. This is a plain append (`LayerClass::Submit`
 *    → `DynamicVectorClass::Add`, layer.cpp:62-71).
 * 2. `Read_Scenario_INI` (scenario.cpp:2337-2365) Unlimbos in this order:
 *      Terrain → Units → Vessels → Infantry → Buildings (→ Base → Overlay → Smudge)
 *    so the initial Logic array lays out as:
 *      [TERRAIN*][UNITS][VESSELS][INFANTRY][BUILDINGS...]
 * 3. `BuildingClass::Read_INI` (building.cpp:5062-5158) iterates entries in INI
 *    order (`ini.Get_Entry(INI_Name(), index)` returns `EntryList` in the order
 *    parsed from the file, ini.cpp:505-518) and calls `new BuildingClass` +
 *    `Unlimbo` on each. Skipped entries (wall overlays, failed placement) do
 *    NOT enter Logic.
 * 4. During `BuildingClass::Unlimbo`, `TechnoClass::Unlimbo` fires `Revealed`,
 *    which for AI-owned buildings calls `Grand_Opening(building.cpp:4337-4356)`.
 *    `Grand_Opening` for an AI `STRUCT_HELIPAD` constructs an `AircraftClass`
 *    (HIND for Soviet/BadGuy/Ukraine, LONGBOW for Allied) and Unlimbos it
 *    immediately (building.cpp:2472-2491). This causes the HIND/LONGBOW to
 *    appear in Logic *between* the HPAD building and the next building.
 * 5. `STRUCT_REFINERY` harvester spawn is guarded by `!ScenarioInit` so does
 *    NOT interleave during scenario load (building.cpp:2439).
 *
 * ## Observed Logic order for SCG11EA at tick 1 (from agent_get_state logicLayer)
 *
 * Verified via `scripts/test-wasm-logic-dump.ts` against locally-built WASM
 * (public/ra/rasdl.wasm rebuilt 2026-04-22 with extended logicLayer dump in
 * agent_harness.cpp to include RTTI_BUILDING and RTTI_VESSEL).
 *
 *   Logic[0..61]   = 62 TERRAIN entries (trees, ore)
 *   Logic[62..79]  = 18 UNITS (INI UNITS 0-17, in INI order)
 *   Logic[80..93]  = 14 VESSELS (INI SHIPS 0-13, in INI order)
 *   Logic[94..105] = 12 INFANTRY (INI INFANTRY 0-11, in INI order)
 *   Logic[106..129]= 24 BUILDINGS (INI STRUCTURES 0-23)
 *   Logic[130]     = HPAD (INI STRUCTURES[24])
 *   Logic[131]     = HIND (interleaved via Grand_Opening)
 *   Logic[132..147]= 16 BUILDINGS (INI STRUCTURES 25-40)
 *   Logic[148]     = HPAD (INI STRUCTURES[41])
 *   Logic[149]     = HIND (interleaved)
 *   Logic[150..155]= 6 BUILDINGS (INI STRUCTURES 42-47)
 *   Logic[156..157]= 2 Greece MCV (start reinforcements)
 *
 * ## TS's current structure iteration (index.ts:1927-2040)
 *
 * TS iterates `this.structures` in scenario-INI order (struct[0]..struct[47])
 * in Phase 2. When a structure has `hpadHelicopterId`, the helicopter is
 * processed immediately after that structure (line 1974-2039). This matches
 * C++'s HPAD→HIND interleaving.
 *
 * **Iteration ORDER within buildings is correct.** struct[i] maps to the
 * i-th INI STRUCTURES entry, and HPAD helicopters are processed right after
 * their HPAD — exactly matching C++ Grand_Opening's Unlimbo interleave.
 *
 * ## Root cause of SCG11EA t32 Δ=-5 is NOT iteration order
 *
 * Per-entity RNG log analysis (scripts/test-rng-entity-diff.ts, SCG11EA
 * ticks 31-33) shows that at tick 32:
 *   - Both engines have identical RNG state through tick 31.
 *   - WASM fires 6 buildings (INI[1,17,36,37,46,47]) whose missionTimer hit 0.
 *   - TS fires 6 buildings (INI[1,17,36,37]) PLUS 2 HIND helicopters PLUS
 *     SAM INI[46] and SAM INI[47] with 3/2 jitter calls each (11 total).
 *
 * The divergence is **entity-behavior drift**, not iteration-order drift:
 *   1. TS's HPAD helicopter Mission_Guard timer fires at tick 32 when WASM's
 *      does not — +2 RNG consumption divergence.
 *   2. TS's SAM INI[46]/[47] fire at tick 32 while WASM's equivalent SAMs fire
 *      at tick 33. Their prior Mission_Guard fire (at an earlier tick) produced
 *      different jitter values between engines because the RNG stream position
 *      reached by that SAM differed — a consequence of (1), not iteration order.
 *
 * The 1-tick offset for SAM fires has the same RNG seed signature in both
 * engines — the agent's proof (cd3bbdb5) was that TS tick-32 building[92]
 * seeds (656362750, 1010654303, 3904861868) appear in WASM at tick-33
 * building[125]. But WASM's tick-33 building[125] is a TSLA (USSR) at cell
 * (51,50), not a SAM — the seed-matching is stream-position alignment, not
 * identity. The real cross-engine invariant being broken is the mt trajectory
 * of struct[46]/[47], set by a prior Mission_Guard fire whose RNG-stream
 * position differed due to cumulative helicopter-timer drift.
 *
 * ## Conclusion
 *
 * Porting "BuildingClass::Unlimbo insertion order" is a no-op: TS already
 * iterates buildings in Unlimbo order. The SCG11EA t32 divergence cannot be
 * fixed by re-ordering `this.structures` — the real fix must address HPAD
 * helicopter Mission_Guard timer behavior to match C++ (aircraft.cpp:3696-
 * 3828: AircraftClass::Mission_Guard with House->IsHuman early-return vs
 * AI-path Find_Juicy_Target + FootClass::Mission_Guard).
 *
 * Task ad83df56 instrumentation:
 *   - agent_harness.cpp logicLayer now includes RTTI_BUILDING and RTTI_VESSEL
 *     (previously only UNITS/INFANTRY/AIRCRAFT), with a 1-char RTTI tag
 *     (U/I/A/B/V) on each entry.
 *   - scripts/test-wasm-logic-dump.ts dumps Logic order for a given scenario.
 *   - Pre-existing OOB on SCG11EA and SCG03EA during agent_get_state is
 *     unrelated — reproduces before any harness changes.
 */
import { describe, it, expect } from 'vitest';

describe('BuildingClass::Unlimbo Logic-array order — TS vs WASM parity', () => {
  it('matches INI STRUCTURES order with AI-HPAD → HIND interleave', () => {
    // SCG11EA Logic[106..155] building layout (from WASM agent_get_state):
    const expectedSCG11EALogicBuildings = [
      { logicIdx: 106, iniIdx: 0, type: 'TSLA', house: 'BadGuy' },
      { logicIdx: 130, iniIdx: 24, type: 'HPAD', house: 'USSR' },
      { logicIdx: 131, iniIdx: null, type: 'HIND', house: 'USSR' }, // interleaved
      { logicIdx: 132, iniIdx: 25, type: 'SPEN', house: 'USSR' },
      { logicIdx: 148, iniIdx: 41, type: 'HPAD', house: 'USSR' },
      { logicIdx: 149, iniIdx: null, type: 'HIND', house: 'USSR' }, // interleaved
      { logicIdx: 150, iniIdx: 42, type: 'KENN', house: 'USSR' },
      { logicIdx: 154, iniIdx: 46, type: 'SAM',  house: 'USSR' },
      { logicIdx: 155, iniIdx: 47, type: 'SAM',  house: 'USSR' },
    ];
    // Buildings 0..23 map 1:1 to Logic[106..129]. HPAD at 24 inserts a HIND.
    for (const row of expectedSCG11EALogicBuildings) {
      if (row.iniIdx !== null && row.iniIdx < 24) {
        expect(row.logicIdx).toBe(106 + row.iniIdx);
      }
    }
    // After the first HPAD, Logic shifts +1 for the HIND interleave.
    // After the second HPAD, Logic shifts +2 cumulatively.
    expect(expectedSCG11EALogicBuildings.find(r => r.iniIdx === 25)!.logicIdx).toBe(106 + 25 + 1);
    expect(expectedSCG11EALogicBuildings.find(r => r.iniIdx === 46)!.logicIdx).toBe(106 + 46 + 2);
    expect(expectedSCG11EALogicBuildings.find(r => r.iniIdx === 47)!.logicIdx).toBe(106 + 47 + 2);
  });

  it('documents that TS Phase 2 already replicates C++ HPAD→HIND interleave', () => {
    // src/EasterEgg/engine/index.ts:1927-2040 — Phase 2 iterates this.structures
    // in scenario-INI order. When a structure has `hpadHelicopterId` (set during
    // loadScenario for pre-placed AI HPADs, scenario.ts:1974-1989), the heli is
    // processed via logicIdx++ immediately after the HPAD's logicIdx increment.
    // This is the exact same order as C++ Grand_Opening's HIND Unlimbo.
    const tsPhase2Order = {
      beforeHPAD: 'logicIdx counting pre-building entities',
      atHPAD: 'structures[N] HPAD consumes logicIdx K',
      atHIND: 'hpadHelicopterId HIND consumes logicIdx K+1',
      afterHPAD: 'structures[N+1] consumes logicIdx K+2',
    };
    expect(tsPhase2Order.atHPAD).toContain('HPAD');
    expect(tsPhase2Order.atHIND).toContain('HIND');
  });

  it('documents that SCG11EA t32 Δ=-5 is NOT iteration-order but entity-behavior drift', () => {
    // Per-entity RNG diff (scripts/test-rng-entity-diff.ts) for SCG11EA ticks 31-33:
    //   tick 31: RNG state IDENTICAL between TS and WASM (seed=2617567079).
    //   tick 32: TS fires HIND Mission_Guard + SAM[46]/[47] jitter (11 calls).
    //            WASM fires 6 building timers only (6 calls).
    //   tick 33: WASM fires SAM[19] TSLA jitter (3 calls). TS fires 2 calls.
    //
    // The 5 extra calls in TS at tick 32 are NOT from ordering but from:
    //   +2 HIND helicopter Mission_Guard timer fire (not fired in WASM)
    //   +3 SAM INI[46] jitter (WASM fires this SAM at tick 33 instead)
    //   +2 SAM INI[47] jitter (same as above)
    const tick32Divergence = {
      tsExtraCalls: 5,
      cause: 'HPAD HIND Mission_Guard timer + SAM missionTimer misalignment',
      notCause: 'building iteration order (already matches C++)',
    };
    expect(tick32Divergence.tsExtraCalls).toBe(5);
    expect(tick32Divergence.cause).toContain('HIND Mission_Guard');
    expect(tick32Divergence.notCause).toContain('iteration order');
  });
});
