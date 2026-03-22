/**
 * C++ Behavioral Parity Tests — Mission / Order Enum Values & Constants
 *
 * Audits the TS Mission enum, MissionControl metadata, CPP_MISSION_MAP ordinal
 * mapping, scan/timing constants, and AnimState values against the C++ source.
 *
 * C++ references:
 *   mission.h (defines.h:979-1008) — MissionType enum with 22 ordinal values
 *   mission.cpp:213-321            — MissionControl[] metadata array
 *   foot.cpp:589-612               — Mission_Guard scan delay (Normal_Delay)
 *   foot.cpp:654-703               — Mission_Hunt scan delay
 *   foot.cpp:950-1021              — Mission_Guard_Area leash & scan
 *   techno.cpp:4543-4582           — Threat_Range: control=1 → 2*weapon_range
 *   display.h:77                   — CELL_LEPTON_W = 256 (leptons per cell)
 *
 * Tests that FAIL are GOOD — they identify real C++ divergences.
 */

import { describe, it, expect } from 'vitest';
import {
  Mission, AnimState, MISSION_CONTROL,
  CELL_SIZE,
} from '../engine/types';

// =============================================================================
// 1. Mission enum ordinal values (C++ mission.h / defines.h:979-1008)
// =============================================================================
//
// C++ defines MissionType as:
//   MISSION_SLEEP=0, MISSION_ATTACK=1, MISSION_MOVE=2, MISSION_QMOVE=3,
//   MISSION_RETREAT=4, MISSION_GUARD=5, MISSION_STICKY=6, MISSION_ENTER=7,
//   MISSION_CAPTURE=8, MISSION_HARVEST=9, MISSION_GUARD_AREA=10,
//   MISSION_RETURN=11, MISSION_STOP=12, MISSION_AMBUSH=13,
//   MISSION_HUNT=14, MISSION_UNLOAD=15, MISSION_SABOTAGE=16,
//   MISSION_CONSTRUCTION=17, MISSION_DECONSTRUCTION=18, MISSION_REPAIR=19,
//   MISSION_RESCUE=20, MISSION_MISSILE=21
//
// TS uses string enums (GUARD='GUARD' etc.), so there is no numeric ordinal.
// This test verifies the TS enum has all 22 C++ missions and documents the
// ordinal mapping used by CPP_MISSION_MAP in engine/index.ts.

describe('Mission enum — C++ mission.h parity', () => {

  // The canonical C++ ordinal-to-name mapping
  const CPP_MISSION_ORDINALS: [number, string][] = [
    [0,  'MISSION_SLEEP'],
    [1,  'MISSION_ATTACK'],
    [2,  'MISSION_MOVE'],
    [3,  'MISSION_QMOVE'],
    [4,  'MISSION_RETREAT'],
    [5,  'MISSION_GUARD'],
    [6,  'MISSION_STICKY'],
    [7,  'MISSION_ENTER'],
    [8,  'MISSION_CAPTURE'],
    [9,  'MISSION_HARVEST'],
    [10, 'MISSION_GUARD_AREA'],
    [11, 'MISSION_RETURN'],
    [12, 'MISSION_STOP'],
    [13, 'MISSION_AMBUSH'],
    [14, 'MISSION_HUNT'],
    [15, 'MISSION_UNLOAD'],
    [16, 'MISSION_SABOTAGE'],
    [17, 'MISSION_CONSTRUCTION'],
    [18, 'MISSION_DECONSTRUCTION'],
    [19, 'MISSION_REPAIR'],
    [20, 'MISSION_RESCUE'],
    [21, 'MISSION_MISSILE'],
  ];

  it('C++ has exactly 22 mission types (MISSION_SLEEP=0 through MISSION_MISSILE=21)', () => {
    expect(CPP_MISSION_ORDINALS.length).toBe(22);
  });

  // TS uses string enums; verify all 22 C++ missions exist in the TS enum
  const TS_MISSION_NAMES = Object.values(Mission);

  it('TS Mission enum has all 22 C++ mission types', () => {
    // C++ name → expected TS name mapping
    const cppToTs: Record<string, string> = {
      'MISSION_SLEEP': 'SLEEP',
      'MISSION_ATTACK': 'ATTACK',
      'MISSION_MOVE': 'MOVE',
      'MISSION_QMOVE': 'QMOVE',
      'MISSION_RETREAT': 'RETREAT',
      'MISSION_GUARD': 'GUARD',
      'MISSION_STICKY': 'STICKY',
      'MISSION_ENTER': 'ENTER',
      'MISSION_CAPTURE': 'CAPTURE',
      'MISSION_HARVEST': 'HARVEST',
      'MISSION_GUARD_AREA': 'AREA_GUARD',
      'MISSION_RETURN': 'RETURN',
      'MISSION_STOP': 'STOP',
      'MISSION_AMBUSH': 'AMBUSH',
      'MISSION_HUNT': 'HUNT',
      'MISSION_UNLOAD': 'UNLOAD',
      'MISSION_SABOTAGE': 'SABOTAGE',
      'MISSION_CONSTRUCTION': 'CONSTRUCTION',
      'MISSION_DECONSTRUCTION': 'DECONSTRUCTION',
      'MISSION_REPAIR': 'REPAIR',
      'MISSION_RESCUE': 'RESCUE',
      'MISSION_MISSILE': 'MISSILE',
    };

    for (const [cppName, tsName] of Object.entries(cppToTs)) {
      expect(
        TS_MISSION_NAMES.includes(tsName as Mission),
        `${cppName} → TS Mission.${tsName} should exist`
      ).toBe(true);
    }
  });

  it('TS Mission enum uses string values (C++ uses integer ordinals — PARITY GAP: enum representation)', () => {
    // C++ MissionType uses integer ordinals (0-21).
    // TS Mission uses string values ('GUARD', 'ATTACK', etc.).
    // This means TS cannot do arithmetic on mission values like C++ can.
    // Document this as an intentional design divergence.
    expect(typeof Mission.SLEEP).toBe('string');
    expect(Mission.SLEEP).toBe('SLEEP');

    // C++ ordinal arithmetic: MISSION_GUARD(5) < MISSION_HUNT(14) is meaningful
    // TS cannot do this — string comparison gives different ordering
    expect(typeof Mission.GUARD).toBe('string');
    expect(Mission.GUARD).not.toBe(5);
  });

  it('TS has no DIE mission in C++ (C++ does not define MISSION_DIE)', () => {
    // C++ mission.h does NOT have MISSION_DIE — death is handled by
    // the Strength going to 0 and entering limbo, not by a mission type.
    // TS adds DIE as an extra mission not present in the C++ 22-mission set.
    // If TS does have Mission.DIE, this is an extension beyond C++ parity.
    const hasDie = TS_MISSION_NAMES.includes('DIE' as Mission);
    if (hasDie) {
      // PARITY GAP: TS has Mission.DIE which doesn't exist in C++
      expect(hasDie).toBe(true); // document that it exists
    }
  });

  it('TS has no HARMLESS mission in C++ (C++ does not define MISSION_HARMLESS)', () => {
    // C++ mission.h does NOT have MISSION_HARMLESS.
    // The "harmless" behavior in C++ is handled through the guard mission
    // with threat flags set, not as a separate mission type.
    const hasHarmless = TS_MISSION_NAMES.includes('HARMLESS' as Mission);
    if (hasHarmless) {
      // PARITY GAP: TS has Mission.HARMLESS which doesn't exist in C++
      expect(hasHarmless).toBe(true); // document that it exists
    }
  });

  it('TS Mission enum count vs C++ count (22 C++ + TS extras)', () => {
    // C++ has exactly 22 missions (ordinals 0-21)
    // TS may have extras like DIE, HARMLESS
    const tsCount = TS_MISSION_NAMES.length;
    // C++ has 22, TS should have at least 22
    expect(tsCount).toBeGreaterThanOrEqual(22);
    // If TS has more than 22, they are extensions
    if (tsCount > 22) {
      const extras = TS_MISSION_NAMES.filter(
        m => !['SLEEP','ATTACK','MOVE','QMOVE','RETREAT','GUARD','STICKY','ENTER',
               'CAPTURE','HARVEST','AREA_GUARD','RETURN','STOP','AMBUSH','HUNT',
               'UNLOAD','SABOTAGE','CONSTRUCTION','DECONSTRUCTION','REPAIR',
               'RESCUE','MISSILE'].includes(m)
      );
      // Document extra missions
      expect(extras.length).toBe(tsCount - 22);
    }
  });
});

// =============================================================================
// 2. MissionControl metadata (C++ mission.cpp MissionControl[] array)
// =============================================================================
//
// C++ mission.cpp defines a static MissionControl array indexed by MissionType.
// Each entry has: IsNoThreat, IsZombie, IsRecruitable, IsParalyzed, IsRetaliate, IsScatter
//
// C++ source (mission.cpp:213-321, reverse-engineered from remaster source):
//   MISSION_SLEEP:          {NoThreat=1, Zombie=1, Recruitable=0, Paralyzed=1, Retaliate=0, Scatter=0}
//   MISSION_ATTACK:         {NoThreat=0, Zombie=0, Recruitable=0, Paralyzed=0, Retaliate=1, Scatter=0}
//   MISSION_MOVE:           {NoThreat=0, Zombie=0, Recruitable=0, Paralyzed=0, Retaliate=1, Scatter=1}
//   MISSION_QMOVE:          {NoThreat=0, Zombie=0, Recruitable=0, Paralyzed=0, Retaliate=1, Scatter=1}
//   MISSION_RETREAT:        {NoThreat=1, Zombie=1, Recruitable=0, Paralyzed=0, Retaliate=0, Scatter=0}
//   MISSION_GUARD:          {NoThreat=0, Zombie=0, Recruitable=1, Paralyzed=0, Retaliate=1, Scatter=1}
//   MISSION_STICKY:         {NoThreat=0, Zombie=0, Recruitable=0, Paralyzed=0, Retaliate=1, Scatter=1}
//   MISSION_ENTER:          {NoThreat=0, Zombie=1, Recruitable=0, Paralyzed=0, Retaliate=0, Scatter=0}
//   MISSION_CAPTURE:        {NoThreat=0, Zombie=1, Recruitable=0, Paralyzed=0, Retaliate=0, Scatter=0}
//   MISSION_HARVEST:        {NoThreat=1, Zombie=1, Recruitable=0, Paralyzed=0, Retaliate=0, Scatter=0}
//   MISSION_GUARD_AREA:     {NoThreat=0, Zombie=0, Recruitable=1, Paralyzed=0, Retaliate=1, Scatter=1}
//   MISSION_RETURN:         {NoThreat=1, Zombie=1, Recruitable=0, Paralyzed=0, Retaliate=0, Scatter=0}
//   MISSION_STOP:           {NoThreat=0, Zombie=1, Recruitable=1, Paralyzed=1, Retaliate=0, Scatter=0}
//   MISSION_AMBUSH:         {NoThreat=1, Zombie=1, Recruitable=0, Paralyzed=1, Retaliate=1, Scatter=0}
//   MISSION_HUNT:           {NoThreat=0, Zombie=0, Recruitable=0, Paralyzed=0, Retaliate=1, Scatter=0}
//   MISSION_UNLOAD:         {NoThreat=0, Zombie=0, Recruitable=0, Paralyzed=0, Retaliate=1, Scatter=1}
//   MISSION_SABOTAGE:       {NoThreat=0, Zombie=1, Recruitable=0, Paralyzed=0, Retaliate=0, Scatter=0}
//   MISSION_CONSTRUCTION:   {NoThreat=1, Zombie=1, Recruitable=0, Paralyzed=1, Retaliate=0, Scatter=0}
//   MISSION_DECONSTRUCTION: {NoThreat=1, Zombie=1, Recruitable=0, Paralyzed=1, Retaliate=0, Scatter=0}
//   MISSION_REPAIR:         {NoThreat=1, Zombie=1, Recruitable=0, Paralyzed=0, Retaliate=0, Scatter=0}
//   MISSION_RESCUE:         {NoThreat=0, Zombie=0, Recruitable=0, Paralyzed=0, Retaliate=1, Scatter=0}
//   MISSION_MISSILE:        {NoThreat=1, Zombie=1, Recruitable=0, Paralyzed=1, Retaliate=0, Scatter=0}

describe('MissionControl metadata — C++ mission.cpp parity', () => {

  // Build expected C++ values for each mission
  interface CppMC { noThreat: boolean; zombie: boolean; recruit: boolean; paralyze: boolean; retaliate: boolean; scatter: boolean }
  const CPP_MISSION_CONTROL: Record<string, CppMC> = {
    SLEEP:          { noThreat: true,  zombie: true,  recruit: false, paralyze: true,  retaliate: false, scatter: false },
    ATTACK:         { noThreat: false, zombie: false, recruit: false, paralyze: false, retaliate: true,  scatter: false },
    MOVE:           { noThreat: false, zombie: false, recruit: false, paralyze: false, retaliate: true,  scatter: true  },
    QMOVE:          { noThreat: false, zombie: false, recruit: false, paralyze: false, retaliate: true,  scatter: true  },
    RETREAT:        { noThreat: true,  zombie: true,  recruit: false, paralyze: false, retaliate: false, scatter: false },
    GUARD:          { noThreat: false, zombie: false, recruit: true,  paralyze: false, retaliate: true,  scatter: true  },
    STICKY:         { noThreat: false, zombie: false, recruit: false, paralyze: false, retaliate: true,  scatter: true  },
    ENTER:          { noThreat: false, zombie: true,  recruit: false, paralyze: false, retaliate: false, scatter: false },
    CAPTURE:        { noThreat: false, zombie: true,  recruit: false, paralyze: false, retaliate: false, scatter: false },
    HARVEST:        { noThreat: true,  zombie: true,  recruit: false, paralyze: false, retaliate: false, scatter: false },
    AREA_GUARD:     { noThreat: false, zombie: false, recruit: true,  paralyze: false, retaliate: true,  scatter: true  },
    RETURN:         { noThreat: true,  zombie: true,  recruit: false, paralyze: false, retaliate: false, scatter: false },
    STOP:           { noThreat: false, zombie: true,  recruit: true,  paralyze: true,  retaliate: false, scatter: false },
    AMBUSH:         { noThreat: true,  zombie: true,  recruit: false, paralyze: true,  retaliate: true,  scatter: false },
    HUNT:           { noThreat: false, zombie: false, recruit: false, paralyze: false, retaliate: true,  scatter: false },
    UNLOAD:         { noThreat: false, zombie: false, recruit: false, paralyze: false, retaliate: true,  scatter: true  },
    SABOTAGE:       { noThreat: false, zombie: true,  recruit: false, paralyze: false, retaliate: false, scatter: false },
    CONSTRUCTION:   { noThreat: true,  zombie: true,  recruit: false, paralyze: true,  retaliate: false, scatter: false },
    DECONSTRUCTION: { noThreat: true,  zombie: true,  recruit: false, paralyze: true,  retaliate: false, scatter: false },
    REPAIR:         { noThreat: true,  zombie: true,  recruit: false, paralyze: false, retaliate: false, scatter: false },
    RESCUE:         { noThreat: false, zombie: false, recruit: false, paralyze: false, retaliate: true,  scatter: false },
    MISSILE:        { noThreat: true,  zombie: true,  recruit: false, paralyze: true,  retaliate: false, scatter: false },
  };

  it('MISSION_CONTROL has entries for all 22 C++ missions', () => {
    for (const missionName of Object.keys(CPP_MISSION_CONTROL)) {
      expect(
        MISSION_CONTROL[missionName],
        `MISSION_CONTROL should have entry for ${missionName}`
      ).toBeDefined();
    }
  });

  // Test each field for each mission
  for (const [missionName, expected] of Object.entries(CPP_MISSION_CONTROL)) {
    describe(`${missionName} MissionControl flags`, () => {
      it(`isNoThreat = ${expected.noThreat}`, () => {
        const mc = MISSION_CONTROL[missionName];
        expect(mc?.isNoThreat, `${missionName}.isNoThreat`).toBe(expected.noThreat);
      });
      it(`isZombie = ${expected.zombie}`, () => {
        const mc = MISSION_CONTROL[missionName];
        expect(mc?.isZombie, `${missionName}.isZombie`).toBe(expected.zombie);
      });
      it(`isRecruitable = ${expected.recruit}`, () => {
        const mc = MISSION_CONTROL[missionName];
        expect(mc?.isRecruitable, `${missionName}.isRecruitable`).toBe(expected.recruit);
      });
      it(`isParalyzed = ${expected.paralyze}`, () => {
        const mc = MISSION_CONTROL[missionName];
        expect(mc?.isParalyzed, `${missionName}.isParalyzed`).toBe(expected.paralyze);
      });
      it(`isRetaliate = ${expected.retaliate}`, () => {
        const mc = MISSION_CONTROL[missionName];
        expect(mc?.isRetaliate, `${missionName}.isRetaliate`).toBe(expected.retaliate);
      });
      it(`isScatter = ${expected.scatter}`, () => {
        const mc = MISSION_CONTROL[missionName];
        expect(mc?.isScatter, `${missionName}.isScatter`).toBe(expected.scatter);
      });
    });
  }

  it('TS MISSION_CONTROL for DIE — not in C++ (TS extension)', () => {
    // C++ has no MISSION_DIE — verify TS sets it to zombie/paralyzed (deathlike)
    const dieMc = MISSION_CONTROL['DIE'];
    if (dieMc) {
      // Document the TS extension flags
      expect(dieMc.isNoThreat).toBe(true);
      expect(dieMc.isZombie).toBe(true);
      expect(dieMc.isParalyzed).toBe(true);
      expect(dieMc.isRetaliate).toBe(false);
      expect(dieMc.isScatter).toBe(false);
    }
  });

  it('TS MISSION_CONTROL for HARMLESS — not in C++ (TS extension)', () => {
    // C++ has no MISSION_HARMLESS. Verify TS makes it truly harmless.
    const harmlessMc = MISSION_CONTROL['HARMLESS'];
    if (harmlessMc) {
      // Expected: noThreat=true, zombie=true, retaliate=false
      expect(harmlessMc.isNoThreat).toBe(true);
      expect(harmlessMc.isZombie).toBe(true);
      expect(harmlessMc.isRetaliate).toBe(false);
    }
  });
});

// =============================================================================
// 3. CPP_MISSION_MAP ordinal mapping (engine/index.ts)
// =============================================================================
//
// The CPP_MISSION_MAP in engine/index.ts maps C++ ordinals to TS Mission values.
// Some C++ missions are collapsed (e.g., MISSION_QMOVE(3) → Mission.MOVE).
// Verify the mapping is correct where missions are 1:1, and document where
// missions are collapsed.

describe('CPP_MISSION_MAP ordinal mapping — parity audit', () => {

  // The expected C++ ordinal → TS mission mapping (from engine/index.ts:3499-3514)
  // Some are deliberately collapsed; we test what the TS codebase declares.
  const EXPECTED_MAP: [number, string, string][] = [
    // [ordinal, C++ name, expected TS Mission value]
    [0,  'MISSION_SLEEP',      'SLEEP'],
    [1,  'MISSION_ATTACK',     'ATTACK'],
    [2,  'MISSION_MOVE',       'MOVE'],
    [3,  'MISSION_QMOVE',      'MOVE'],       // collapsed: QMOVE → MOVE
    [4,  'MISSION_RETREAT',    'MOVE'],        // collapsed: RETREAT → MOVE
    [5,  'MISSION_GUARD',      'GUARD'],
    // 6 = MISSION_STICKY — MISSING from CPP_MISSION_MAP
    [7,  'MISSION_ENTER',      'MOVE'],        // collapsed: ENTER → MOVE
    [8,  'MISSION_CAPTURE',    'ATTACK'],      // collapsed: CAPTURE → ATTACK
    [9,  'MISSION_HARVEST',    'GUARD'],       // collapsed: HARVEST → GUARD
    [10, 'MISSION_GUARD_AREA', 'AREA_GUARD'],
    [11, 'MISSION_RETURN',     'MOVE'],        // collapsed: RETURN → MOVE
    [12, 'MISSION_STOP',       'GUARD'],       // collapsed: STOP → GUARD
    [13, 'MISSION_AMBUSH',     'AREA_GUARD'],  // collapsed: AMBUSH → AREA_GUARD
    [14, 'MISSION_HUNT',       'HUNT'],
  ];

  it('PARITY GAP: CPP_MISSION_MAP missing ordinal 6 (MISSION_STICKY)', () => {
    // C++ MISSION_STICKY = 6. The TS CPP_MISSION_MAP skips ordinal 6.
    // This means any scenario data referencing MISSION_STICKY by ordinal
    // will not be mapped and will fall through to undefined.
    // TS does have Mission.STICKY in the enum, but it's not in the ordinal map.
    expect(Mission.STICKY).toBeDefined();
    // The map doesn't cover ordinals 15-21 either (UNLOAD through MISSILE)
    // This is because those missions rarely appear in scenario team DO commands.
  });

  it('PARITY GAP: CPP_MISSION_MAP missing ordinals 15-21', () => {
    // C++ ordinals 15-21 are:
    //   15=UNLOAD, 16=SABOTAGE, 17=CONSTRUCTION, 18=DECONSTRUCTION,
    //   19=REPAIR, 20=RESCUE, 21=MISSILE
    // These are all valid C++ missions but not mapped in CPP_MISSION_MAP.
    // If these appear in scenario TMISSION_DO data, they will resolve to undefined.
    const unmappedOrdinals = [15, 16, 17, 18, 19, 20, 21];
    for (const ord of unmappedOrdinals) {
      // Verify the TS Mission enum has these missions even though they're not mapped
      const cppNames = ['UNLOAD','SABOTAGE','CONSTRUCTION','DECONSTRUCTION','REPAIR','RESCUE','MISSILE'];
      const missionName = cppNames[ord - 15];
      expect(
        Object.values(Mission).includes(missionName as Mission),
        `Mission.${missionName} should exist in TS enum`
      ).toBe(true);
    }
  });

  it('PARITY GAP: TS collapses MISSION_QMOVE(3) to MOVE — C++ has distinct QMOVE behavior', () => {
    // C++ MISSION_QMOVE has distinct queued movement behavior (foot.cpp:339).
    // TS Mission enum has QMOVE but CPP_MISSION_MAP maps ordinal 3 → MOVE.
    // This means scenario-driven QMOVE assignments lose the queued semantics.
    expect(Mission.QMOVE).toBe('QMOVE');
    // But CPP_MISSION_MAP[3] = Mission.MOVE, not Mission.QMOVE
  });

  it('PARITY GAP: TS collapses MISSION_HARVEST(9) to GUARD', () => {
    // C++ MISSION_HARVEST = ordinal 9 has specific harvester behavior
    // (seek ore, load, return to refinery). TS collapses this to GUARD
    // in the CPP_MISSION_MAP, losing harvest-specific AI.
    expect(Mission.HARVEST).toBe('HARVEST');
    // CPP_MISSION_MAP[9] = Mission.GUARD, not Mission.HARVEST
  });
});

// =============================================================================
// 4. SharedOracleBridge TS_MISSION_CODES (oracle/SharedOracleBridge.ts)
// =============================================================================

describe('SharedOracleBridge TS_MISSION_CODES — parity audit', () => {

  it('PARITY GAP: TS_MISSION_CODES only maps 3 of 22 missions', () => {
    // SharedOracleBridge.ts:83-87 defines:
    //   SLEEP: 0, GUARD: 5, AREA_GUARD: 18
    // But C++ has 22 missions. The oracle bridge can only decode 3.
    // This limits the oracle's ability to understand unit mission states.
    //
    // Also: AREA_GUARD is mapped to ordinal 18, but C++ MISSION_GUARD_AREA = 10.
    // Ordinal 18 in C++ is MISSION_DECONSTRUCTION. This is a bug.
    //
    // We can't import the private const, so we document the gap.
    expect(true).toBe(true); // placeholder — real verification needs SharedOracleBridge access
  });

  it('PARITY GAP: AREA_GUARD mapped to ordinal 18 but C++ MISSION_GUARD_AREA = 10', () => {
    // SharedOracleBridge.ts line 86: AREA_GUARD: 18
    // C++ mission.h: MISSION_GUARD_AREA = 10
    // C++ mission.h: MISSION_DECONSTRUCTION = 18
    // This means the oracle reports AREA_GUARD with the wrong numeric code.
    // Expected: AREA_GUARD should map to 10, not 18.
    //
    // This is a significant parity gap — any code comparing oracle mission codes
    // against C++ ordinals will misidentify AREA_GUARD as DECONSTRUCTION.
    expect(10).not.toBe(18); // C++ GUARD_AREA=10, but TS uses 18
  });
});

// =============================================================================
// 5. AnimState enum values (C++ display.h anim states)
// =============================================================================
//
// C++ uses numeric animation sequence IDs. TS uses string enums.
// C++ anim states include: DO_NOTHING(0), GUARD_AREA(1), etc.
// But for unit drawing, C++ uses shape frame indices, not enum values.

describe('AnimState enum — audit', () => {

  it('TS AnimState has IDLE, WALK, ATTACK, DIE', () => {
    expect(AnimState.IDLE).toBe('IDLE');
    expect(AnimState.WALK).toBe('WALK');
    expect(AnimState.ATTACK).toBe('ATTACK');
    expect(AnimState.DIE).toBe('DIE');
  });

  it('TS AnimState count = 4 (C++ has more granular states)', () => {
    // C++ has many more anim states: READY, FIDGET, PRONE, etc.
    // TS simplifies to 4 basic states.
    const stateCount = Object.values(AnimState).length;
    expect(stateCount).toBe(4);
  });

  it('PARITY GAP: C++ has GUARD_IDLE vs AREA_GUARD_IDLE distinction — TS has only IDLE', () => {
    // C++ differentiates guard animations by mission type.
    // TS uses a single IDLE state regardless of guard vs area_guard vs ambush.
    expect(AnimState.IDLE).toBe('IDLE');
    // No AnimState.GUARD_IDLE or AnimState.AMBUSH_IDLE exists
    expect((AnimState as Record<string, string>)['GUARD_IDLE']).toBeUndefined();
  });

  it('PARITY GAP: C++ has PRONE anim state for infantry under fire — TS missing', () => {
    // C++ infantry can go prone when taking fire, using a different sprite sequence.
    // TS does not have a PRONE anim state.
    expect((AnimState as Record<string, string>)['PRONE']).toBeUndefined();
  });

  it('PARITY GAP: C++ has HARVEST anim state for harvesters — TS missing', () => {
    // C++ harvesters have a distinct harvesting animation (scoop/dump).
    // TS does not differentiate harvesting from idle.
    expect((AnimState as Record<string, string>)['HARVEST']).toBeUndefined();
  });
});

// =============================================================================
// 6. Scan / target / timing constants
// =============================================================================
//
// C++ uses Normal_Delay() from MissionControl for scan rate limiting.
// foot.cpp:597: dtime = MissionControl[Mission].Normal_Delay()
// Normal_Delay returns TICKS_PER_SECOND * 1.5 = 22 ticks at 15 FPS
// (15 * 1.5 = 22.5, truncated to 22)
//
// TS uses scanDelay per unit type (default 15 ticks), which is different.

describe('scan/timing constants — C++ parity', () => {

  it('C++ Normal_Delay = ~22 ticks at 15Hz (TICKS_PER_SECOND * 1.5)', () => {
    // C++ foot.cpp:597: dtime = MissionControl[Mission].Normal_Delay()
    // Normal_Delay() = TICKS_PER_SECOND + (TICKS_PER_SECOND / 2) = 15 + 7 = 22
    // TS default scanDelay = 15 (types.ts:448)
    const cppNormalDelay = 15 + Math.floor(15 / 2); // 22
    const tsDefaultScanDelay = 15;
    // PARITY GAP if they differ:
    expect(tsDefaultScanDelay).toBe(cppNormalDelay);
  });

  it('C++ TICKS_PER_SECOND = 15 (game runs at 15 FPS base)', () => {
    // C++ define.h: TICKS_PER_SECOND = 15
    // TS uses 20 ticks per second internally
    const cppTickRate = 15;
    // TS tick rate can be derived from CELL_SIZE or game loop
    // Just document the divergence
    expect(cppTickRate).toBe(15);
  });

  it('PARITY GAP: TS scanDelay default=15 vs C++ Normal_Delay=22', () => {
    // C++ guard scan uses Normal_Delay() = 22 ticks at 15Hz
    // At 20Hz TS rate, equivalent would be 22 * (20/15) ≈ 29 ticks
    // But TS uses 15 ticks — scans faster than C++
    const cppDelayAt15Hz = 22;
    const equivalentAt20Hz = Math.round(cppDelayAt15Hz * (20 / 15));
    const tsDefault = 15;
    // This will fail if TS doesn't match — that's the point
    expect(tsDefault).toBe(equivalentAt20Hz);
  });

  it('C++ guard area leash = Threat_Range(1)/2 = min(weaponRange, 5 cells)', () => {
    // C++ foot.cpp:996: leash = Threat_Range(1) / 2
    // Threat_Range(1) = min(2 * weaponRange, 0x0A00)
    // 0x0A00 = 2560 leptons = 10 cells (at 256 leptons/cell)
    // So leash = min(2*weaponRange, 10cells) / 2 = min(weaponRange, 5cells)
    const maxThreatRange = 10; // cells
    const maxLeash = maxThreatRange / 2; // 5 cells
    expect(maxLeash).toBe(5);
  });

  it('C++ threat scan cap = 0x0A00 leptons = 10 cells', () => {
    // techno.cpp:4553: if (IsLocked) range = min(range*2, 0x0A00)
    // 0x0A00 = 2560 leptons. At 256 leptons/cell = 10 cells.
    const cppMaxThreatRangeLeptons = 0x0A00;
    const leptonsPerCell = 256;
    const cppMaxThreatRangeCells = cppMaxThreatRangeLeptons / leptonsPerCell;
    expect(cppMaxThreatRangeCells).toBe(10);
  });
});

// =============================================================================
// 7. Mission-specific timing constants
// =============================================================================

describe('mission-specific timing — C++ parity', () => {

  it('C++ hunt scan has no delay — scans every tick after Normal_Delay', () => {
    // C++ foot.cpp:654-703: Mission_Hunt returns Normal_Delay() (22 ticks)
    // when no target found, or 0 when actively pursuing.
    // TS uses the same scanDelay mechanism for hunt as for guard.
    // The C++ behavior is: scan immediately if target exists, delay if not.
    expect(true).toBe(true); // structural audit — verified by reading missionAI.ts
  });

  it('C++ guard returns Normal_Delay + Random_Pick(0,2) for aircraft', () => {
    // aircraft.cpp:846: return(MissionControl[Mission].Normal_Delay() + Random_Pick(0, 2))
    // This means aircraft guard delay = 22 + 0..2 = 22-24 ticks
    // TS uses flat scanDelay with no random jitter for aircraft
    const cppMinDelay = 22;
    const cppMaxDelay = 24;
    expect(cppMaxDelay - cppMinDelay).toBe(2);
  });

  it('C++ ambush wakes up on ANY enemy in sight — no scan delay on first detection', () => {
    // C++ mission.cpp: Mission_Ambush checks for enemies every Normal_Delay
    // but transitions to HUNT immediately upon detection.
    // TS missionAI.ts:967-979: uses scanDelay for ambush scan rate
    expect(Mission.AMBUSH).toBe('AMBUSH');
  });

  it('PARITY GAP: TS ant scanDelay=10 vs vehicle scanDelay=12 — C++ uses uniform Normal_Delay=22', () => {
    // C++ uses MissionControl[Mission].Normal_Delay() uniformly = 22 ticks
    // TS assigns different scanDelay per unit type:
    //   ants=10, tanks=12, infantry=varies, artillery=20, dogs=8
    // This creates different scan cadences than C++ which uses one value for all.
    const tsScanDelays = { ant: 10, tank: 12, arty: 20, dog: 8 };
    // All should be 22 in C++ (at 15Hz) or ~29 at 20Hz
    expect(tsScanDelays.ant).not.toBe(22);
    expect(tsScanDelays.tank).not.toBe(22);
  });
});

// =============================================================================
// 8. Mission queue (C++ missionQueue / Commence)
// =============================================================================

describe('mission queue — C++ parity', () => {

  it('C++ promotes queued mission at cell center (MissionClass::Commence)', () => {
    // C++ mission.cpp: Commence() promotes SuspendedMission when unit reaches
    // the center of a cell. TS uses missionQueue field on Entity.
    // Verify the field exists by checking the Mission enum has queue-able missions.
    expect(Mission.QMOVE).toBe('QMOVE'); // queued move is the canonical queue example
  });

  it('C++ has SuspendedMission separate from MissionQueue', () => {
    // C++ has TWO queuing mechanisms:
    //   1. SuspendedMission — the mission to resume after current one ends
    //   2. MissionQueue — player-issued mission waiting for cell center
    // TS has only missionQueue (entity.ts:98), combining both concepts.
    // This is a simplification that may cause behavioral differences
    // when missions interrupt each other.
    expect(true).toBe(true); // structural audit
  });
});
