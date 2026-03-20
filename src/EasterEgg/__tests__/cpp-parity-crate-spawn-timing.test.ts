/**
 * C++ Behavioral Parity Tests: Crate Spawn Timing
 *
 * Tests initial delay, periodic respawn rate, per-crate lifetime, maximum
 * concurrent crates, and tick-based pacing against the original C++ Red Alert
 * source code.
 *
 * C++ source references:
 *   - defines.h:3031-3032   — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *   - rules.cpp:157-158     — CrateMinimum=1, CrateMaximum=255
 *   - rules.cpp:207         — CrateTime=10 (minutes)
 *   - map.h:152             — CrateClass Crates[256] (max 256 concurrent)
 *   - crate.h:52            — Is_Expired: Is_Valid() && Timer == 0
 *   - crate.h:61            — CDTimerClass<FrameTimerClass> Timer (per-crate countdown)
 *   - crate.cpp:98          — Timer = Random_Pick(CrateTime*(TICKS_PER_MINUTE/2), CrateTime*(TICKS_PER_MINUTE*2))
 *   - map.cpp:994-1005      — Logic(): for each expired crate → Remove_It() + Place_Random_Crate()
 *   - map.cpp:1160-1185     — Place_Random_Crate(): find free slot, try 1000 random cells
 *   - scenario.cpp:2436-2441 — Initial placement: max(CrateMinimum, NumPlayers) at tick 0
 *
 * Summary of C++ behavior:
 *   1. At scenario start (tick 0), max(CrateMinimum=1, NumPlayers) crates placed immediately
 *   2. Each crate gets its own countdown timer: Random(CrateTime/2, CrateTime*2) minutes
 *      = Random(5, 20) minutes = Random(4500, 18000) ticks at 15 TPS
 *   3. When a crate's timer expires, it is removed and a new one placed (per-crate respawn)
 *   4. Maximum concurrent crates: 256 (Crates[256] array)
 *   5. Crate regeneration only in multiplayer (Session.Type != GAME_NORMAL)
 *   6. Respawn is per-crate expiry driven, NOT a global periodic timer
 */

import { describe, it, expect } from 'vitest';
import { GAME_TICKS_PER_SEC } from '../engine/types';
import { spawnCrate, type CrateContext, type Crate } from '../engine/crates';

// ── C++ reference constants ────────────────────────────────────────────────

/** C++ defines.h:3031 */
const CPP_TICKS_PER_SECOND = 15;

/** C++ defines.h:3032 */
const CPP_TICKS_PER_MINUTE = 900;

/** C++ rules.cpp:207 — default CrateTime in minutes */
const CPP_CRATE_TIME = 10;

/** C++ rules.cpp:157 — CrateMinimum default */
const CPP_CRATE_MINIMUM = 1;

/** C++ rules.cpp:158 — CrateMaximum default */
const CPP_CRATE_MAXIMUM = 255;

/** C++ map.h:152 — Crates[256] array size = max concurrent crates */
const CPP_MAX_CONCURRENT_CRATES = 256;

/**
 * C++ crate.cpp:98 — per-crate timer range in ticks
 * Timer = Random_Pick(CrateTime * (TICKS_PER_MINUTE/2), CrateTime * (TICKS_PER_MINUTE*2))
 * = Random_Pick(10 * 450, 10 * 1800) = Random_Pick(4500, 18000)
 */
const CPP_CRATE_TIMER_MIN = CPP_CRATE_TIME * (CPP_TICKS_PER_MINUTE / 2); // 4500 ticks = 5 minutes
const CPP_CRATE_TIMER_MAX = CPP_CRATE_TIME * (CPP_TICKS_PER_MINUTE * 2); // 18000 ticks = 20 minutes

// =============================================================================
// Section 1: Tick Rate
// C++ defines.h:3031 — TICKS_PER_SECOND = 15
// =============================================================================

describe('CPP parity: tick rate', () => {
  it('C++ TICKS_PER_SECOND = 15 (defines.h:3031)', () => {
    // C++: TICKS_PER_SECOND = 15
    // TS:  GAME_TICKS_PER_SEC = 20
    expect(GAME_TICKS_PER_SEC).toBe(CPP_TICKS_PER_SECOND);
    // PARITY GAP: TS uses 20 ticks/sec, C++ uses 15
    // This propagates to ALL timing calculations throughout the engine
  });
});

// =============================================================================
// Section 2: Initial Crate Placement Delay
// C++ scenario.cpp:2436-2441 — crates placed at scenario init (tick 0)
// TS: index.ts:1073 — nextCrateTick = GAME_TICKS_PER_SEC * 60 (60-second delay)
// =============================================================================

describe('CPP parity: initial crate placement', () => {
  it('C++ places initial crates at tick 0 during scenario init (scenario.cpp:2436-2441)', () => {
    // C++ code:
    //   if (Session.Options.Goodies) {
    //     int count = max(Rule.CrateMinimum, Session.NumPlayers);
    //     count = min(count, Rule.CrateMaximum);
    //     for (int index = 0; index < count; index++) {
    //       Map.Place_Random_Crate();
    //     }
    //   }
    //
    // This runs during Read_INI / scenario initialization — i.e., at tick 0.
    // There is NO initial delay before the first crate appears on the map.

    // TS sets: this.nextCrateTick = GAME_TICKS_PER_SEC * 60  (index.ts:1073)
    // This means no crate spawns until 60 seconds have elapsed.
    const TS_INITIAL_DELAY = GAME_TICKS_PER_SEC * 60; // 1200 ticks at 20 TPS
    const CPP_INITIAL_DELAY = 0; // Crates placed during scenario init

    expect(TS_INITIAL_DELAY).toBe(CPP_INITIAL_DELAY);
    // PARITY GAP: TS delays first crate by 60 seconds, C++ places at tick 0
  });

  it('C++ initial crate count = max(CrateMinimum, NumPlayers) (scenario.cpp:2437)', () => {
    // C++ places max(1, NumPlayers) crates at start, capped at CrateMaximum=255
    // For solo play (NumPlayers=1): max(1, 1) = 1 crate at start
    // For 4-player: max(1, 4) = 4 crates at start
    expect(CPP_CRATE_MINIMUM).toBe(1);
    expect(CPP_CRATE_MAXIMUM).toBe(255);

    // Solo game: 1 crate at tick 0
    const soloCount = Math.max(CPP_CRATE_MINIMUM, 1);
    expect(soloCount).toBe(1);

    // 4-player game: 4 crates at tick 0
    const fourPlayerCount = Math.min(Math.max(CPP_CRATE_MINIMUM, 4), CPP_CRATE_MAXIMUM);
    expect(fourPlayerCount).toBe(4);
  });
});

// =============================================================================
// Section 3: Maximum Concurrent Crates
// C++ map.h:152 — CrateClass Crates[256]
// TS: index.ts:1663 — this.crates.length < 3
// =============================================================================

describe('CPP parity: maximum concurrent crates', () => {
  it('C++ supports up to 256 concurrent crates (map.h:152)', () => {
    // C++ has a fixed-size array: CrateClass Crates[256]
    // Place_Random_Crate scans for a free slot (Is_Valid() == false)
    // Only fails if all 256 slots are occupied

    // TS caps at 3: if (this.crates.length < 3) { this.spawnCrate(); }
    const TS_MAX_CRATES = 3;

    expect(TS_MAX_CRATES).toBe(CPP_MAX_CONCURRENT_CRATES);
    // PARITY GAP: TS limits to 3 concurrent crates, C++ allows up to 256
  });
});

// =============================================================================
// Section 4: Per-Crate Lifetime / Expiry Timer
// C++ crate.cpp:98 — Timer = Random_Pick(CrateTime*(TICKS_PER_MINUTE/2),
//                                        CrateTime*(TICKS_PER_MINUTE*2))
// =============================================================================

describe('CPP parity: per-crate lifetime', () => {
  it('C++ crate lifetime range is [4500, 18000] ticks at 15 TPS (crate.cpp:98)', () => {
    // C++ Timer = Random_Pick(CrateTime * (TICKS_PER_MINUTE/2), CrateTime * (TICKS_PER_MINUTE*2))
    // CrateTime = 10 minutes
    // TICKS_PER_MINUTE = 900
    // min = 10 * 450 = 4500 ticks (5 minutes)
    // max = 10 * 1800 = 18000 ticks (20 minutes)
    expect(CPP_CRATE_TIMER_MIN).toBe(4500);
    expect(CPP_CRATE_TIMER_MAX).toBe(18000);

    // In real-world seconds at 15 TPS:
    expect(CPP_CRATE_TIMER_MIN / CPP_TICKS_PER_SECOND).toBe(300);  // 5 minutes
    expect(CPP_CRATE_TIMER_MAX / CPP_TICKS_PER_SECOND).toBe(1200); // 20 minutes
  });

  it('TS crate lifetime uses correct minute range [5, 20] but wrong tick rate', () => {
    // TS (crates.ts:156-160):
    //   const crateTimeMin = 10; // minutes
    //   const minLifetime = Math.floor(crateTimeMin / 2); // 5 minutes
    //   const maxLifetime = crateTimeMin * 2; // 20 minutes
    //   const lifetimeTicks = Math.floor(lifetimeMinutes * 60 * GAME_TICKS_PER_SEC);
    //
    // The minute range [5, 20] matches C++.
    // But the tick conversion uses GAME_TICKS_PER_SEC=20 instead of 15.

    const TS_MIN_LIFETIME_TICKS = 5 * 60 * GAME_TICKS_PER_SEC;  // 5 * 60 * 20 = 6000
    const TS_MAX_LIFETIME_TICKS = 20 * 60 * GAME_TICKS_PER_SEC; // 20 * 60 * 20 = 24000

    // C++ equivalents (at 15 TPS):
    expect(TS_MIN_LIFETIME_TICKS).toBe(CPP_CRATE_TIMER_MIN);
    // PARITY GAP: TS min = 6000 ticks, C++ = 4500 ticks
    // The lifetime in real-world seconds IS the same (300s = 5 minutes),
    // but the tick count differs because TPS differs.
    // This means the lifetime comparison only works if game loop runs at
    // the correct tick rate.

    expect(TS_MAX_LIFETIME_TICKS).toBe(CPP_CRATE_TIMER_MAX);
    // PARITY GAP: TS max = 24000 ticks, C++ = 18000 ticks
  });
});

// =============================================================================
// Section 5: Respawn Mechanism — Per-Crate Expiry vs Global Timer
// C++ map.cpp:994-1005 — each tick, check each crate's timer individually
// TS: index.ts:1662-1665 — global nextCrateTick timer, fires every 60-90 seconds
// =============================================================================

describe('CPP parity: respawn mechanism', () => {
  it('C++ uses per-crate expiry-driven respawn, not a global timer (map.cpp:1000-1004)', () => {
    // C++ logic in MapClass::Logic():
    //   for (int index = 0; index < ARRAY_SIZE(Crates); index++) {
    //     if (Crates[index].Is_Expired()) {      // per-crate countdown hit 0
    //       Crates[index].Remove_It();
    //       Place_Random_Crate();                  // immediate replacement
    //     }
    //   }
    //
    // Key behaviors:
    // 1. Each crate has its own independent CDTimerClass countdown
    // 2. When expired, the crate is immediately removed and replaced
    // 3. No global spawn interval — respawn is driven by individual crate timers
    // 4. Multiple crates can expire on the same tick

    // TS uses a completely different approach (index.ts:1662-1665):
    //   if (this.tick >= this.nextCrateTick && this.crates.length < 3) {
    //     this.spawnCrate();
    //     this.nextCrateTick = this.tick + GAME_TICKS_PER_SEC * (60 + Math.random() * 30);
    //   }
    //
    // TS spawns a NEW crate every 60-90 seconds regardless of existing crate state.
    // C++ only spawns a NEW crate when an existing one EXPIRES.
    // These are fundamentally different algorithms.

    // Test the TS global respawn interval in ticks
    const TS_RESPAWN_MIN_TICKS = GAME_TICKS_PER_SEC * 60;  // 1200 ticks (60 seconds)
    const TS_RESPAWN_MAX_TICKS = GAME_TICKS_PER_SEC * 90;  // 1800 ticks (90 seconds)

    // C++ per-crate timer range (which drives respawn):
    // 4500-18000 ticks (5-20 minutes)

    // The respawn interval should match the per-crate expiry timer
    // because in C++, a new crate spawns only when an old one expires.
    expect(TS_RESPAWN_MIN_TICKS).toBe(CPP_CRATE_TIMER_MIN);
    // PARITY GAP: TS respawn interval is 60-90 seconds.
    // C++ respawn is driven by per-crate lifetime of 5-20 MINUTES.
    // TS spawns crates ~10-20x faster than C++.

    expect(TS_RESPAWN_MAX_TICKS).toBe(CPP_CRATE_TIMER_MAX);
    // PARITY GAP: same issue — fundamentally different respawn architecture
  });

  it('C++ crate expiry triggers immediate 1:1 replacement (map.cpp:1002-1003)', () => {
    // C++: Remove_It() then Place_Random_Crate()
    // The number of active crates stays constant (barring placement failure).
    // TS: Expired crates are just spliced out (index.ts:1672-1674),
    // new crates come from the global timer independently.

    // In C++, if a crate expires at tick T, a new crate is placed at tick T
    // with a fresh timer. The crate count is maintained at the initial count.

    // In TS, expired crate removal (index.ts:1672) and new crate spawning
    // (index.ts:1663) are decoupled — they happen in different code paths.

    // This is a structural/architectural divergence, not a numeric one.
    // Documenting for completeness.
    expect(true).toBe(true); // Structural observation — passes by design
  });
});

// =============================================================================
// Section 6: Crate Regeneration — Multiplayer Only
// C++ map.cpp:994 — if (Session.Type != GAME_NORMAL && Session.Options.Goodies)
// TS: index.ts:1663 — only checks !scenarioId.startsWith('SCA')
// =============================================================================

describe('CPP parity: crate regeneration context', () => {
  it('C++ only regenerates crates in multiplayer with Goodies enabled (map.cpp:994)', () => {
    // C++ guard: Session.Type != GAME_NORMAL && Session.Options.Goodies
    // This means NO crate regeneration in single-player campaign missions.
    // Campaign crates are placed only via scenario scripts or the initial
    // scenario.cpp placement (which also checks Session.Options.Goodies).

    // TS guard: !this.scenarioId.startsWith('SCA')
    // This only excludes ant missions, not single-player campaign missions.
    // Single-player campaign missions (SCG*, SCU*) will get periodic crate spawns.

    // PARITY GAP: TS spawns crates in single-player campaign missions,
    // C++ does not regenerate crates in GAME_NORMAL (single-player) mode.
    // C++ only has overlay crates in campaign maps (pre-placed in the map editor).

    // We cannot directly test this without the game engine running, but we
    // document the divergence. A proper fix would check game mode, not just
    // scenario prefix.
    const tsExcludesOnlyAnts = true;
    const cppExcludesSinglePlayer = true;

    // TS should exclude single-player campaign, not just ant missions
    expect(tsExcludesOnlyAnts).toBe(!cppExcludesSinglePlayer);
    // PARITY GAP: TS does not exclude single-player campaigns from crate regen
  });
});

// =============================================================================
// Section 7: Place_Random_Crate — Attempt Count
// C++ map.cpp:1177 — tries up to 1000 random locations
// TS: crates.ts:162 — tries up to 20 random locations
// =============================================================================

describe('CPP parity: crate placement attempts', () => {
  it('C++ tries 1000 random locations for crate placement (map.cpp:1177)', () => {
    // C++: for (int index = 0; index < 1000; index++) {
    //        CELL cell = Map.Pick_Random_Location();
    //        if (Crates[crateindex].Create_Crate(cell)) return true;
    //      }
    //
    // TS (crates.ts:162): for (let attempt = 0; attempt < 20; attempt++)
    const CPP_MAX_PLACEMENT_ATTEMPTS = 1000;
    const TS_MAX_PLACEMENT_ATTEMPTS = 20;

    expect(TS_MAX_PLACEMENT_ATTEMPTS).toBe(CPP_MAX_PLACEMENT_ATTEMPTS);
    // PARITY GAP: TS tries only 20 locations, C++ tries 1000.
    // On sparse maps, TS may fail to place crates that C++ would place.
  });
});

// =============================================================================
// Section 8: spawnCrate lifetime calculation validation
// Direct test of the crates.ts spawnCrate function
// =============================================================================

describe('CPP parity: spawnCrate lifetime tick values', () => {
  it('spawned crate lifetime is in C++ tick range [4500, 18000]', () => {
    // Build a minimal CrateContext to test spawnCrate
    const crates: Crate[] = [];
    const ctx: CrateContext = {
      crates,
      entities: [],
      entityById: new Map(),
      structures: [],
      effects: [],
      evaMessages: [],
      activeVortices: [],
      visionaryHouses: new Set(),
      credits: 0,
      tick: 100,
      playerHouse: 'GoodGuy' as any,
      screenShake: 0,
      map: {
        boundsX: 0, boundsY: 0, boundsW: 50, boundsH: 50,
        isPassable: () => true,
        getVisibility: () => 1,
        revealAll: () => {},
        setVisibility: () => {},
      } as any,
      crateOverrides: {},
      addCredits: () => {},
      playSoundAt: () => {},
      playSound: () => {},
      damageEntity: () => {},
      damageStructure: () => {},
      detonateNuke: () => {},
      isAllied: () => false,
    };

    // Spawn many crates and check their lifetimes
    const lifetimes: number[] = [];
    for (let i = 0; i < 100; i++) {
      crates.length = 0;
      spawnCrate(ctx);
      if (crates.length > 0) {
        lifetimes.push(crates[0].lifetime);
      }
    }

    expect(lifetimes.length).toBeGreaterThan(0);

    // All lifetimes should be in C++ range [4500, 18000] ticks
    for (const lt of lifetimes) {
      expect(lt).toBeGreaterThanOrEqual(CPP_CRATE_TIMER_MIN);
      // PARITY GAP: TS lifetimes will be in [6000, 24000] due to 20 TPS
      expect(lt).toBeLessThanOrEqual(CPP_CRATE_TIMER_MAX);
      // PARITY GAP: TS lifetimes will exceed 18000 due to 20 TPS
    }
  });
});
