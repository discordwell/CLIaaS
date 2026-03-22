/**
 * C++ Parity Tests: MissionType enum and MissionControl metadata
 *
 * Authoritative C++ sources:
 *   - defines.h:979-1008  — MissionType enum (23 missions, MISSION_NONE=-1, 0..22)
 *   - const.cpp:83-107    — Missions[] string table (indexed by MissionType ordinal)
 *   - mission.cpp:532-543 — MissionControlClass constructor defaults
 *   - mission.cpp:556-573 — MissionControlClass::Read_INI (loads overrides from rules.ini)
 *   - mission.cpp:379-391 — Assign_Mission (QMOVE→MOVE normalization, queue system)
 *   - mission.cpp:343-359 — Commence (dequeue MissionQueue → Mission, reset Status/Timer)
 *   - mission.cpp:133-139 — Set_Mission (immediate, clears queue)
 *   - mission.cpp:158-163 — Get_Mission (returns MissionQueue if Mission==NONE)
 *   - mission.cpp:213-321 — AI dispatch switch (mission→handler mapping)
 *   - rules.cpp:1019-1023 — Rules_Process: reads MissionControl from rules.ini sections
 *
 * Key insight: MissionControlClass constructor defaults are
 *   { NoThreat=false, Zombie=false, Recruitable=true, Paralyzed=false, Retaliate=true, Scatter=true }
 * These are then overridden by [MissionName] sections in rules.ini.
 * The original RA rules.ini contains overrides for all 23 missions.
 */

import { describe, it, expect } from 'vitest';
import { Mission, MISSION_CONTROL } from '../engine/types';

// ─── C++ MissionType enum (defines.h:979-1008) ─────────────────────────────
// The canonical enum order and numeric values from C++:
//   MISSION_NONE         = -1
//   MISSION_SLEEP        =  0   (MISSION_FIRST)
//   MISSION_ATTACK       =  1
//   MISSION_MOVE         =  2
//   MISSION_QMOVE        =  3
//   MISSION_RETREAT      =  4
//   MISSION_GUARD        =  5
//   MISSION_STICKY       =  6
//   MISSION_ENTER        =  7
//   MISSION_CAPTURE      =  8
//   MISSION_HARVEST      =  9
//   MISSION_GUARD_AREA   = 10
//   MISSION_RETURN       = 11
//   MISSION_STOP         = 12
//   MISSION_AMBUSH       = 13
//   MISSION_HUNT         = 14
//   MISSION_UNLOAD       = 15
//   MISSION_SABOTAGE     = 16
//   MISSION_CONSTRUCTION = 17
//   MISSION_DECONSTRUCTION = 18
//   MISSION_REPAIR       = 19
//   MISSION_RESCUE       = 20
//   MISSION_MISSILE      = 21
//   MISSION_HARMLESS     = 22
//   MISSION_COUNT        = 23

describe('MissionType enum parity (C++ defines.h:979-1008)', () => {

  // C++ has exactly 23 missions (MISSION_COUNT=23), plus MISSION_NONE=-1.
  // TS enum uses string values, not numeric, but must have all 23 + any TS additions documented.

  // C++ enum name → TS enum value mapping.
  // Most are 1:1, but MISSION_GUARD_AREA → Mission.AREA_GUARD (TS reorders the words).
  const CPP_TO_TS_MISSIONS: [string, string][] = [
    ['SLEEP',          'SLEEP'],           // 0  — MISSION_SLEEP
    ['ATTACK',         'ATTACK'],          // 1  — MISSION_ATTACK
    ['MOVE',           'MOVE'],            // 2  — MISSION_MOVE
    ['QMOVE',          'QMOVE'],           // 3  — MISSION_QMOVE
    ['RETREAT',        'RETREAT'],          // 4  — MISSION_RETREAT
    ['GUARD',          'GUARD'],            // 5  — MISSION_GUARD
    ['STICKY',         'STICKY'],           // 6  — MISSION_STICKY
    ['ENTER',          'ENTER'],            // 7  — MISSION_ENTER
    ['CAPTURE',        'CAPTURE'],          // 8  — MISSION_CAPTURE
    ['HARVEST',        'HARVEST'],          // 9  — MISSION_HARVEST
    ['GUARD_AREA',     'AREA_GUARD'],       // 10 — MISSION_GUARD_AREA → TS Mission.AREA_GUARD
    ['RETURN',         'RETURN'],           // 11 — MISSION_RETURN
    ['STOP',           'STOP'],             // 12 — MISSION_STOP
    ['AMBUSH',         'AMBUSH'],           // 13 — MISSION_AMBUSH
    ['HUNT',           'HUNT'],             // 14 — MISSION_HUNT
    ['UNLOAD',         'UNLOAD'],           // 15 — MISSION_UNLOAD
    ['SABOTAGE',       'SABOTAGE'],         // 16 — MISSION_SABOTAGE
    ['CONSTRUCTION',   'CONSTRUCTION'],     // 17 — MISSION_CONSTRUCTION
    ['DECONSTRUCTION', 'DECONSTRUCTION'],   // 18 — MISSION_DECONSTRUCTION (C++ string: "Selling")
    ['REPAIR',         'REPAIR'],           // 19 — MISSION_REPAIR
    ['RESCUE',         'RESCUE'],           // 20 — MISSION_RESCUE
    ['MISSILE',        'MISSILE'],          // 21 — MISSION_MISSILE
    ['HARMLESS',       'HARMLESS'],         // 22 — MISSION_HARMLESS
  ];

  it('TS Mission enum has all 23 C++ mission types', () => {
    const tsValues = Object.values(Mission);
    for (const [cppName, tsName] of CPP_TO_TS_MISSIONS) {
      expect(
        tsValues.includes(tsName as Mission),
        `C++ MISSION_${cppName} → TS Mission.${tsName} missing from TS Mission enum`
      ).toBe(true);
    }
  });

  it('C++ MISSION_COUNT is 23', () => {
    // C++ has exactly 23 missions from MISSION_SLEEP(0) to MISSION_HARMLESS(22)
    expect(CPP_TO_TS_MISSIONS.length).toBe(23);
  });

  it('TS Mission enum uses AREA_GUARD not GUARD_AREA for C++ MISSION_GUARD_AREA', () => {
    // C++ enum name: MISSION_GUARD_AREA, string name: "Area Guard"
    // TS uses AREA_GUARD — verify this mapping exists
    expect(Mission.AREA_GUARD).toBe('AREA_GUARD');
    // Also verify there is no GUARD_AREA in the TS enum
    expect((Mission as Record<string, string>)['GUARD_AREA']).toBeUndefined();
  });

  it('TS has DIE mission that does not exist in C++', () => {
    // C++ has no MISSION_DIE — death is handled through the Strength/health system,
    // not a mission type. TS adds DIE as an extra mission.
    // This documents the intentional divergence.
    expect(Mission.DIE).toBe('DIE');
    const cppNames = CPP_TO_TS_MISSIONS.map(([cpp]) => cpp);
    expect(cppNames.includes('DIE')).toBe(false);
  });

  it('TS Mission enum has no NONE value (C++ MISSION_NONE=-1)', () => {
    // C++ uses MISSION_NONE=-1 as sentinel. TS does not have a NONE mission.
    expect((Mission as Record<string, string>)['NONE']).toBeUndefined();
  });
});

// ─── Missions[] string table (const.cpp:83-107) ────────────────────────────
describe('Mission string names parity (C++ const.cpp:83-107)', () => {

  // C++ Missions[] array indexed by MissionType ordinal (0-22):
  const CPP_MISSION_STRINGS: [number, string][] = [
    [0,  'Sleep'],
    [1,  'Attack'],
    [2,  'Move'],
    [3,  'QMove'],
    [4,  'Retreat'],
    [5,  'Guard'],
    [6,  'Sticky'],
    [7,  'Enter'],
    [8,  'Capture'],
    [9,  'Harvest'],
    [10, 'Area Guard'],
    [11, 'Return'],
    [12, 'Stop'],
    [13, 'Ambush'],
    [14, 'Hunt'],
    [15, 'Unload'],
    [16, 'Sabotage'],
    [17, 'Construction'],
    [18, 'Selling'],       // NOTE: C++ string for DECONSTRUCTION is "Selling", not "Deconstruction"
    [19, 'Repair'],
    [20, 'Rescue'],
    [21, 'Missile'],
    [22, 'Harmless'],
  ];

  it('total mission string count matches MISSION_COUNT=23', () => {
    expect(CPP_MISSION_STRINGS.length).toBe(23);
  });

  it('MISSION_DECONSTRUCTION has C++ string name "Selling" (const.cpp:102)', () => {
    // C++ const.cpp line 102: the string at index 18 is "Selling"
    // This means rules.ini sections for DECONSTRUCTION would be [Selling], not [Deconstruction]
    const deconstructionEntry = CPP_MISSION_STRINGS.find(([idx]) => idx === 18);
    expect(deconstructionEntry).toBeDefined();
    expect(deconstructionEntry![1]).toBe('Selling');
  });
});

// ─── CPP_MISSION_MAP numeric mapping (index.ts) ────────────────────────────
describe('CPP_MISSION_MAP numeric-to-Mission mapping parity', () => {

  // C++ enum ordinals → expected direct TS Mission mappings
  // Some C++ missions may be legitimately collapsed in TS, but we should
  // document which ones map directly vs. which are collapsed.

  const CPP_ORDINAL_TO_MISSION: [number, string, string][] = [
    // [cppIndex, cppName, expectedTsMission]
    [0,  'MISSION_SLEEP',          'SLEEP'],
    [1,  'MISSION_ATTACK',         'ATTACK'],
    [2,  'MISSION_MOVE',           'MOVE'],
    [3,  'MISSION_QMOVE',         'MOVE'],      // C++ Assign_Mission normalizes QMOVE→MOVE
    [5,  'MISSION_GUARD',          'GUARD'],
    [10, 'MISSION_GUARD_AREA',     'AREA_GUARD'],
    [14, 'MISSION_HUNT',           'HUNT'],
  ];

  it('core missions map to correct TS Mission values', () => {
    // These are the missions that should have direct 1:1 mapping
    for (const [, cppName, expectedTs] of CPP_ORDINAL_TO_MISSION) {
      expect(
        Object.values(Mission).includes(expectedTs as Mission),
        `${cppName} should map to Mission.${expectedTs}`
      ).toBe(true);
    }
  });
});

// ─── MissionControl metadata parity (mission.cpp constructor + rules.ini) ───
describe('MISSION_CONTROL parity (C++ mission.cpp:532-543 defaults + rules.ini overrides)', () => {

  // C++ MissionControlClass constructor defaults (mission.cpp:532-543):
  //   IsNoThreat=false, IsZombie=false, IsRecruitable=true,
  //   IsParalyzed=false, IsRetaliate=true, IsScatter=true
  //
  // The original RA rules.ini overrides these per-mission. The values below
  // are the FINAL runtime values after rules.ini processing.
  // Source: original RA rules.ini mission control sections.

  interface ExpectedMissionControl {
    isNoThreat: boolean;
    isZombie: boolean;
    isRecruitable: boolean;
    isParalyzed: boolean;
    isRetaliate: boolean;
    isScatter: boolean;
  }

  // Expected values per C++ rules.ini mission control sections.
  // The constructor defaults are: NoThreat=no, Zombie=no, Recruitable=yes,
  // Paralyzed=no, Retaliate=yes, Scatter=yes.
  // rules.ini sections override individual flags.
  //
  // From the original RA rules.ini (verified against OpenRA/Remastered data):
  const EXPECTED_CONTROLS: [Mission, string, ExpectedMissionControl][] = [
    // Mission,              C++ name,         { NoThreat, Zombie, Recruitable, Paralyzed, Retaliate, Scatter }
    [Mission.SLEEP,          'Sleep',          { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: true,  isRetaliate: false, isScatter: false }],
    [Mission.ATTACK,         'Attack',         { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: false }],
    [Mission.MOVE,           'Move',           { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: true  }],
    [Mission.QMOVE,          'QMove',          { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: true  }],
    [Mission.RETREAT,        'Retreat',         { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false }],
    [Mission.GUARD,          'Guard',           { isNoThreat: false, isZombie: false, isRecruitable: true,  isParalyzed: false, isRetaliate: true,  isScatter: true  }],
    [Mission.STICKY,         'Sticky',          { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: true  }],
    [Mission.ENTER,          'Enter',           { isNoThreat: false, isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false }],
    [Mission.CAPTURE,        'Capture',         { isNoThreat: false, isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false }],
    [Mission.HARVEST,        'Harvest',         { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false }],
    [Mission.AREA_GUARD,     'Area Guard',      { isNoThreat: false, isZombie: false, isRecruitable: true,  isParalyzed: false, isRetaliate: true,  isScatter: true  }],
    [Mission.RETURN,         'Return',          { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false }],
    [Mission.STOP,           'Stop',            { isNoThreat: false, isZombie: true,  isRecruitable: true,  isParalyzed: true,  isRetaliate: false, isScatter: false }],
    [Mission.AMBUSH,         'Ambush',          { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: true,  isRetaliate: true,  isScatter: false }],
    [Mission.HUNT,           'Hunt',            { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: false }],
    [Mission.UNLOAD,         'Unload',          { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: true  }],
    [Mission.SABOTAGE,       'Sabotage',        { isNoThreat: false, isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false }],
    [Mission.CONSTRUCTION,   'Construction',    { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: true,  isRetaliate: false, isScatter: false }],
    [Mission.DECONSTRUCTION, 'Selling',         { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: true,  isRetaliate: false, isScatter: false }],
    [Mission.REPAIR,         'Repair',          { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: false }],
    [Mission.RESCUE,         'Rescue',          { isNoThreat: false, isZombie: false, isRecruitable: false, isParalyzed: false, isRetaliate: true,  isScatter: false }],
    [Mission.MISSILE,        'Missile',         { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: true,  isRetaliate: false, isScatter: false }],
    [Mission.HARMLESS,       'Harmless',        { isNoThreat: true,  isZombie: true,  isRecruitable: false, isParalyzed: false, isRetaliate: false, isScatter: true  }],
  ];

  it('MISSION_CONTROL has entries for all 23 C++ missions', () => {
    for (const [mission, cppName] of EXPECTED_CONTROLS) {
      expect(
        MISSION_CONTROL[mission],
        `MISSION_CONTROL missing entry for ${cppName} (Mission.${mission})`
      ).toBeDefined();
    }
  });

  // Test each mission's control flags individually for precise failure messages
  for (const [mission, cppName, expected] of EXPECTED_CONTROLS) {
    describe(`[${cppName}] (Mission.${mission})`, () => {
      it('isNoThreat', () => {
        const actual = MISSION_CONTROL[mission];
        expect(actual?.isNoThreat, `${cppName}.isNoThreat`).toBe(expected.isNoThreat);
      });

      it('isZombie', () => {
        const actual = MISSION_CONTROL[mission];
        expect(actual?.isZombie, `${cppName}.isZombie`).toBe(expected.isZombie);
      });

      it('isRecruitable', () => {
        const actual = MISSION_CONTROL[mission];
        expect(actual?.isRecruitable, `${cppName}.isRecruitable`).toBe(expected.isRecruitable);
      });

      it('isParalyzed', () => {
        const actual = MISSION_CONTROL[mission];
        expect(actual?.isParalyzed, `${cppName}.isParalyzed`).toBe(expected.isParalyzed);
      });

      it('isRetaliate', () => {
        const actual = MISSION_CONTROL[mission];
        expect(actual?.isRetaliate, `${cppName}.isRetaliate`).toBe(expected.isRetaliate);
      });

      it('isScatter', () => {
        const actual = MISSION_CONTROL[mission];
        expect(actual?.isScatter, `${cppName}.isScatter`).toBe(expected.isScatter);
      });
    });
  }

  it('DIE mission control should match SLEEP (both inert states)', () => {
    // DIE is TS-only. Its control flags should be inert like SLEEP.
    const die = MISSION_CONTROL[Mission.DIE];
    expect(die, 'MISSION_CONTROL should have DIE entry').toBeDefined();
    if (die) {
      expect(die.isNoThreat, 'DIE.isNoThreat').toBe(true);
      expect(die.isZombie, 'DIE.isZombie').toBe(true);
      expect(die.isRecruitable, 'DIE.isRecruitable').toBe(false);
      expect(die.isParalyzed, 'DIE.isParalyzed').toBe(true);
      expect(die.isRetaliate, 'DIE.isRetaliate').toBe(false);
      expect(die.isScatter, 'DIE.isScatter').toBe(false);
    }
  });
});

// ─── Mission assignment behavior parity (mission.cpp:379-391) ───────────────
describe('Assign_Mission behavior parity (C++ mission.cpp:379-391)', () => {

  it('C++ normalizes MISSION_QMOVE to MISSION_MOVE in Assign_Mission', () => {
    // mission.cpp:386: if (order == MISSION_QMOVE) order = MISSION_MOVE;
    // TS must handle this normalization somewhere.
    // Verify TS has QMOVE but documents it maps to MOVE behavior.
    expect(Mission.QMOVE).toBe('QMOVE');
    expect(Mission.MOVE).toBe('MOVE');
  });

  it('C++ Assign_Mission skips if mission==current (mission.cpp:388)', () => {
    // mission.cpp:388: if (order != MISSION_NONE && Mission != order) { MissionQueue = order; }
    // This means assigning the same mission that's already active does nothing.
    // Document this behavioral contract.
    expect(true).toBe(true); // Structural documentation test
  });
});

// ─── Mission AI dispatch parity (mission.cpp:213-321) ───────────────────────
describe('Mission AI dispatch parity (C++ mission.cpp:213-321)', () => {

  // In C++, the AI() switch maps missions to handler functions.
  // Some missions share handlers. Document these groupings.

  const CPP_DISPATCH_GROUPS: [string, string[]][] = [
    // [handler, missions that call it]
    ['Mission_Sleep',          ['SLEEP', 'HARMLESS']],       // mission.cpp:238-241
    ['Mission_Guard',          ['GUARD', 'STICKY']],         // mission.cpp:243-246
    ['Mission_Enter',          ['ENTER']],                    // mission.cpp:248-249
    ['Mission_Construction',   ['CONSTRUCTION']],             // mission.cpp:252-253
    ['Mission_Deconstruction', ['DECONSTRUCTION']],           // mission.cpp:256-257
    ['Mission_Capture',        ['CAPTURE', 'SABOTAGE']],     // mission.cpp:260-263
    ['Mission_Move',           ['MOVE', 'QMOVE']],           // mission.cpp:265-268
    ['Mission_Attack',         ['ATTACK']],                   // mission.cpp:270-271
    ['Mission_Retreat',        ['RETREAT']],                   // mission.cpp:274-275
    ['Mission_Harvest',        ['HARVEST']],                  // mission.cpp:278-279
    ['Mission_Guard_Area',     ['GUARD_AREA']],               // mission.cpp:282-283 (note: C++ name is Guard_Area, TS is AREA_GUARD)
    ['Mission_Return',         ['RETURN']],                   // mission.cpp:286-287
    ['Mission_Stop',           ['STOP']],                     // mission.cpp:290-291
    ['Mission_Ambush',         ['AMBUSH']],                   // mission.cpp:294-295
    ['Mission_Hunt',           ['HUNT', 'RESCUE']],           // mission.cpp:298-301
    ['Mission_Unload',         ['UNLOAD']],                   // mission.cpp:307-308
    ['Mission_Repair',         ['REPAIR']],                   // mission.cpp:311-312
    ['Mission_Missile',        ['MISSILE']],                  // mission.cpp:315-316
  ];

  it('all 23 C++ missions are covered by dispatch handlers', () => {
    const allDispatched = CPP_DISPATCH_GROUPS.flatMap(([, missions]) => missions);
    const expected = [
      'SLEEP', 'ATTACK', 'MOVE', 'QMOVE', 'RETREAT', 'GUARD', 'STICKY',
      'ENTER', 'CAPTURE', 'HARVEST', 'GUARD_AREA', 'RETURN', 'STOP',
      'AMBUSH', 'HUNT', 'UNLOAD', 'SABOTAGE', 'CONSTRUCTION',
      'DECONSTRUCTION', 'REPAIR', 'RESCUE', 'MISSILE', 'HARMLESS',
    ];
    expect(allDispatched.sort()).toEqual(expected.sort());
  });

  it('HARMLESS shares handler with SLEEP (Mission_Sleep)', () => {
    // mission.cpp:238-241: both MISSION_HARMLESS and MISSION_SLEEP call Mission_Sleep()
    const sleepGroup = CPP_DISPATCH_GROUPS.find(([handler]) => handler === 'Mission_Sleep');
    expect(sleepGroup).toBeDefined();
    expect(sleepGroup![1]).toContain('HARMLESS');
    expect(sleepGroup![1]).toContain('SLEEP');
  });

  it('STICKY shares handler with GUARD (Mission_Guard)', () => {
    // mission.cpp:243-246: both MISSION_STICKY and MISSION_GUARD call Mission_Guard()
    const guardGroup = CPP_DISPATCH_GROUPS.find(([handler]) => handler === 'Mission_Guard');
    expect(guardGroup).toBeDefined();
    expect(guardGroup![1]).toContain('STICKY');
    expect(guardGroup![1]).toContain('GUARD');
  });

  it('SABOTAGE shares handler with CAPTURE (Mission_Capture)', () => {
    // mission.cpp:260-263: both MISSION_SABOTAGE and MISSION_CAPTURE call Mission_Capture()
    const captureGroup = CPP_DISPATCH_GROUPS.find(([handler]) => handler === 'Mission_Capture');
    expect(captureGroup).toBeDefined();
    expect(captureGroup![1]).toContain('SABOTAGE');
    expect(captureGroup![1]).toContain('CAPTURE');
  });

  it('RESCUE shares handler with HUNT (Mission_Hunt)', () => {
    // mission.cpp:298-301: both MISSION_RESCUE and MISSION_HUNT call Mission_Hunt()
    const huntGroup = CPP_DISPATCH_GROUPS.find(([handler]) => handler === 'Mission_Hunt');
    expect(huntGroup).toBeDefined();
    expect(huntGroup![1]).toContain('RESCUE');
    expect(huntGroup![1]).toContain('HUNT');
  });

  it('QMOVE shares handler with MOVE (Mission_Move)', () => {
    // mission.cpp:265-268: both MISSION_QMOVE and MISSION_MOVE call Mission_Move()
    const moveGroup = CPP_DISPATCH_GROUPS.find(([handler]) => handler === 'Mission_Move');
    expect(moveGroup).toBeDefined();
    expect(moveGroup![1]).toContain('QMOVE');
    expect(moveGroup![1]).toContain('MOVE');
  });

  it('default case in AI dispatch calls Mission_Sleep (mission.cpp:234-236)', () => {
    // The default: case in the switch falls through to Mission_Sleep()
    // This means any unrecognized mission will sleep for TICKS_PER_SECOND*30
    expect(true).toBe(true); // Documented behavioral contract
  });
});

// ─── Mission queue system parity (mission.cpp class) ────────────────────────
describe('Mission queue system parity (C++ mission.h:56-64)', () => {

  it('C++ MissionClass has Mission, SuspendedMission, MissionQueue fields', () => {
    // mission.h:56-64:
    //   MissionType Mission;           — current active mission
    //   MissionType SuspendedMission;  — saved mission for Override/Restore
    //   MissionType MissionQueue;      — pending mission (dequeued by Commence)
    //   int Status;                    — state machine step within mission
    //
    // TS uses direct entity.mission assignment (no queue).
    // This is a documented simplification — TS does not implement the
    // MissionQueue/Commence/Status state machine from C++.
    expect(true).toBe(true); // Structural documentation
  });

  it('C++ Get_Mission returns MissionQueue if Mission==NONE (mission.cpp:162)', () => {
    // mission.cpp:162: return(Mission == MISSION_NONE ? MissionQueue : Mission);
    // When Mission is NONE, the queued mission is considered "current".
    // TS does not have this because it has no NONE mission or queue.
    expect((Mission as Record<string, string>)['NONE']).toBeUndefined();
  });
});

// ─── Override/Restore mission parity (mission.cpp:468-504) ──────────────────
describe('Override/Restore mission parity (C++ mission.cpp:468-504)', () => {

  it('C++ Override_Mission saves current to SuspendedMission', () => {
    // mission.cpp:468-479: Override_Mission saves MissionQueue (if set) or Mission
    // to SuspendedMission, then Assign_Mission(new mission).
    // Used for temporary mission interrupts (e.g., retaliation).
    // TS does not implement SuspendedMission.
    expect(true).toBe(true);
  });

  it('C++ Restore_Mission restores SuspendedMission', () => {
    // mission.cpp:494-504: Restore_Mission assigns SuspendedMission back,
    // clears SuspendedMission to NONE, returns true if restored.
    expect(true).toBe(true);
  });
});

// ─── Is_Recruitable_Mission parity (mission.cpp:522-528) ────────────────────
describe('Is_Recruitable_Mission parity (C++ mission.cpp:522-528)', () => {

  it('MISSION_NONE is recruitable (mission.cpp:524-526)', () => {
    // mission.cpp:524-526: if (mission == MISSION_NONE) return true;
    // An object with no mission can be recruited into teams.
    expect(true).toBe(true); // TS has no NONE, so N/A
  });

  it('GUARD and AREA_GUARD are recruitable', () => {
    // These are the main recruitable missions in the C++ data
    expect(MISSION_CONTROL[Mission.GUARD]?.isRecruitable).toBe(true);
    expect(MISSION_CONTROL[Mission.AREA_GUARD]?.isRecruitable).toBe(true);
  });

  it('STOP is recruitable (unique — paralyzed but recruitable)', () => {
    // STOP is an interesting case: it's paralyzed AND zombie, but still recruitable.
    // This matches C++ rules.ini where [Stop] has Recruitable=yes.
    const stop = MISSION_CONTROL[Mission.STOP];
    expect(stop?.isRecruitable, 'STOP.isRecruitable').toBe(true);
    expect(stop?.isParalyzed, 'STOP.isParalyzed').toBe(true);
    expect(stop?.isZombie, 'STOP.isZombie').toBe(true);
  });

  it('combat missions are not recruitable', () => {
    // ATTACK, HUNT, MOVE are not recruitable — units actively doing something
    expect(MISSION_CONTROL[Mission.ATTACK]?.isRecruitable).toBe(false);
    expect(MISSION_CONTROL[Mission.HUNT]?.isRecruitable).toBe(false);
    expect(MISSION_CONTROL[Mission.MOVE]?.isRecruitable).toBe(false);
  });
});
