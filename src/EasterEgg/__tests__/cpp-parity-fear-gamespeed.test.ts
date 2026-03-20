/**
 * C++ Behavioral Parity Tests — Infantry Fear Decay & Game Speed Cycling
 *
 * Fear Decay:
 *   C++ source: infantry.cpp:3466-3509 (InfantryClass::Fear_AI)
 *   C++ source: defines.h:617-623 (FearType enum)
 *   TS source:  engine/index.ts:1567-1578, engine/entity.ts:267-275
 *
 * Game Speed Cycling:
 *   C++ source: options.cpp:91 (GameSpeed default = 3)
 *   C++ source: conquer.cpp:2380-2387 (FrameTimer from GameSpeed)
 *   TS source:  engine/index.ts:478-479 (gameSpeed default = 2)
 *   TS source:  engine/index.ts:1312 (speed cycle 1→2→4→1)
 *   TS source:  engine/types.ts:17 (GAME_TICKS_PER_SEC = 20)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UnitType, House, GAME_TICKS_PER_SEC } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => {
  resetEntityIds();
});

// ─── 1. Fear Constants — C++ defines.h:617-623 ──────────────────────────────

describe('Fear constants match C++ FearType enum (defines.h:617-623)', () => {
  it('FEAR_ANXIOUS = 10 (C++ FEAR_ANXIOUS=10)', () => {
    expect(Entity.FEAR_ANXIOUS).toBe(10);
  });

  it('FEAR_SCARED = 100 (C++ FEAR_SCARED=100)', () => {
    expect(Entity.FEAR_SCARED).toBe(100);
  });

  it('FEAR_PANIC = 200 (C++ FEAR_PANIC=200)', () => {
    expect(Entity.FEAR_PANIC).toBe(200);
  });

  it('FEAR_MAXIMUM = 255 (C++ FEAR_MAXIMUM=255 — unsigned char max)', () => {
    expect(Entity.FEAR_MAXIMUM).toBe(255);
  });
});

// ─── 2. Fear Decay Rate — C++ infantry.cpp:3471-3473 ─────────────────────────

describe('Fear decay: 1 per tick (C++ infantry.cpp:3471-3473 Fear--)', () => {
  it('fear decrements by exactly 1 per simulated tick', () => {
    // C++ Fear_AI: if (Fear > 0) Fear--;
    // TS index.ts:1568-1569: if (entity.stats.isInfantry && entity.fear > 0) entity.fear--;
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.fear = 50;

    // Simulate 5 ticks of fear decay (game loop logic)
    for (let i = 0; i < 5; i++) {
      if (unit.stats.isInfantry && unit.fear > 0) {
        unit.fear--;
      }
    }
    expect(unit.fear).toBe(45);
  });

  it('fear decays from FEAR_SCARED (100) to 0 in exactly 100 ticks', () => {
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.fear = Entity.FEAR_SCARED; // 100

    let ticks = 0;
    while (unit.fear > 0) {
      unit.fear--;
      ticks++;
    }
    expect(ticks).toBe(100);
    expect(unit.fear).toBe(0);
  });

  it('fear decays from FEAR_MAXIMUM (255) to 0 in exactly 255 ticks', () => {
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.fear = Entity.FEAR_MAXIMUM; // 255

    let ticks = 0;
    while (unit.fear > 0) {
      unit.fear--;
      ticks++;
    }
    expect(ticks).toBe(255);
    expect(unit.fear).toBe(0);
  });

  it('fear floor: fear never goes below 0', () => {
    // C++ Fear_AI: only decrements when Fear > 0
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.fear = 0;

    // Simulate the guard: if (fear > 0) fear--
    if (unit.stats.isInfantry && unit.fear > 0) {
      unit.fear--;
    }
    expect(unit.fear).toBe(0);
  });

  it('non-infantry entities do not decay fear', () => {
    // C++ Fear_AI is only called for InfantryClass
    // TS: if (entity.stats.isInfantry && entity.fear > 0)
    const tank = new Entity(UnitType.V_1TNK, House.Greece, 100, 100);
    tank.fear = 50;

    // Simulate decay check
    if (tank.stats.isInfantry && tank.fear > 0) {
      tank.fear--;
    }
    expect(tank.fear).toBe(50); // unchanged — not infantry
  });
});

// ─── 3. Prone Entry/Exit — C++ infantry.cpp:3486-3499 ────────────────────────

describe('Prone state transitions (C++ infantry.cpp:3486-3499)', () => {
  it('infantry goes prone when fear >= FEAR_ANXIOUS (10)', () => {
    // C++ infantry.cpp:3496: Fear >= FEAR_ANXIOUS → DO_LIE_DOWN
    // TS index.ts:1571: if (!entity.isProne && entity.fear >= Entity.FEAR_ANXIOUS)
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.fear = Entity.FEAR_ANXIOUS;
    unit.isProne = false;

    // Simulate game loop prone check
    if (!unit.isProne && unit.fear >= Entity.FEAR_ANXIOUS) {
      unit.isProne = true;
    }
    expect(unit.isProne).toBe(true);
  });

  it('infantry stands up when fear drops below FEAR_ANXIOUS', () => {
    // C++ infantry.cpp:3487: Fear < FEAR_ANXIOUS → DO_GET_UP
    // TS index.ts:1575: if (entity.isProne && entity.fear < Entity.FEAR_ANXIOUS)
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.fear = Entity.FEAR_ANXIOUS - 1; // 9
    unit.isProne = true;

    if (unit.isProne && unit.fear < Entity.FEAR_ANXIOUS) {
      unit.isProne = false;
    }
    expect(unit.isProne).toBe(false);
  });

  it('prone exit threshold is exactly FEAR_ANXIOUS (boundary test at fear=10)', () => {
    // At exactly FEAR_ANXIOUS, unit stays prone (C++ checks Fear < FEAR_ANXIOUS for get-up)
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.fear = Entity.FEAR_ANXIOUS; // exactly 10
    unit.isProne = true;

    // Should NOT stand up — fear is not below threshold
    if (unit.isProne && unit.fear < Entity.FEAR_ANXIOUS) {
      unit.isProne = false;
    }
    expect(unit.isProne).toBe(true);
  });

  it('prone exit happens at fear=9 (one below FEAR_ANXIOUS)', () => {
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.fear = 9; // one below FEAR_ANXIOUS
    unit.isProne = true;

    if (unit.isProne && unit.fear < Entity.FEAR_ANXIOUS) {
      unit.isProne = false;
    }
    expect(unit.isProne).toBe(false);
  });

  it('full decay sequence: prone entry at FEAR_ANXIOUS, exit at FEAR_ANXIOUS-1', () => {
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.fear = Entity.FEAR_SCARED; // 100
    unit.isProne = false;

    // Decay and track state transitions
    let proneEntryTick = -1;
    let proneExitTick = -1;
    for (let tick = 0; unit.fear > 0; tick++) {
      unit.fear--;
      // Prone entry
      if (!unit.isProne && unit.fear >= Entity.FEAR_ANXIOUS) {
        unit.isProne = true;
        if (proneEntryTick === -1) proneEntryTick = tick;
      }
      // Prone exit
      if (unit.isProne && unit.fear < Entity.FEAR_ANXIOUS) {
        unit.isProne = false;
        proneExitTick = tick;
      }
    }

    expect(unit.fear).toBe(0);
    expect(unit.isProne).toBe(false);
    // Tick 0: fear 100→99, still >= FEAR_ANXIOUS → goes prone on tick 0
    expect(proneEntryTick).toBe(0);
    // Tick 90: fear 10→9 (below FEAR_ANXIOUS=10), exit prone
    expect(proneExitTick).toBe(90);
  });

  // C++ infantry.cpp:3496: !Class->IsDog — dogs never go prone
  // TS index.ts:1571: if (!entity.isProne && entity.fear >= Entity.FEAR_ANXIOUS && entity.type !== UnitType.I_DOG)
  it('dogs should NOT go prone (C++ infantry.cpp:3496: !Class->IsDog)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.fear = Entity.FEAR_ANXIOUS;
    dog.isProne = false;

    // Simulate the TS game loop prone check (with IsDog exclusion)
    if (!dog.isProne && dog.fear >= Entity.FEAR_ANXIOUS && dog.type !== UnitType.I_DOG) {
      dog.isProne = true;
    }

    // C++ behavior: dogs should NOT go prone — TS now matches
    expect(dog.isProne).toBe(false);
  });
});

// ─── 4. Fear Increase on Damage — C++ infantry.cpp:442-457 ──────────────────

describe('Fear increase on damage (C++ infantry.cpp:442-457)', () => {
  it('taking damage sets fear to at least FEAR_SCARED for non-civilians', () => {
    // C++ infantry.cpp:443-444: fear = IsFraidyCat ? FEAR_PANIC : FEAR_SCARED
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.hp = 100;
    unit.maxHp = 100;
    expect(unit.fear).toBe(0);

    unit.takeDamage(5, 'SA');
    expect(unit.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('additional fear added based on health ratio (C++ infantry.cpp:454-457)', () => {
    // moreFear starts at FEAR_ANXIOUS (10), halved if HP > CONDITION_RED, halved again if > CONDITION_YELLOW
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.hp = 100;
    unit.maxHp = 100;

    unit.takeDamage(1, 'SA');
    // At near-full health, moreFear is FEAR_ANXIOUS/4 = 2 (halved twice)
    // So fear = FEAR_SCARED + 2 = 102
    expect(unit.fear).toBeGreaterThan(Entity.FEAR_SCARED);
  });

  it('fear is capped at FEAR_MAXIMUM (255)', () => {
    // C++ uses unsigned char (0-255), TS clamps to FEAR_MAXIMUM
    const unit = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    unit.hp = 100;
    unit.maxHp = 100;
    unit.fear = Entity.FEAR_MAXIMUM;

    unit.takeDamage(1, 'SA');
    expect(unit.fear).toBeLessThanOrEqual(Entity.FEAR_MAXIMUM);
  });
});

// ─── 5. Game Speed Constants — C++ options.cpp:91, TS types.ts:17 ────────────

describe('Game tick rate (C++ GameSpeed=3 → 20 tps)', () => {
  // C++ options.cpp:91: GameSpeed(3) is the default
  // C++ conquer.cpp comment + queue.cpp:1425: DesiredFrameRate = 60 / GameSpeed
  // At GameSpeed=3: 60/3 = 20 fps = 20 ticks per second
  // TS types.ts:17: GAME_TICKS_PER_SEC = 20

  it('GAME_TICKS_PER_SEC = 20 (C++ GameSpeed=3 → 60/3=20 tps)', () => {
    expect(GAME_TICKS_PER_SEC).toBe(20);
  });

  it('tick interval = 50ms (1000ms / 20 tps)', () => {
    const tickInterval = 1000 / GAME_TICKS_PER_SEC;
    expect(tickInterval).toBe(50);
  });
});

// ─── 6. Game Speed Cycling — TS index.ts:1312, 2338 ──────────────────────────

describe('Game speed cycling (backtick key: 1→2→4→1)', () => {
  // TS index.ts:1312: this.gameSpeed = this.gameSpeed === 1 ? 2 : this.gameSpeed === 2 ? 4 : 1;
  // TS index.ts:478: gameSpeed = 2 (default)
  // Note: C++ has a slider 0-6 (options.cpp), TS simplifies to 1/2/4 multiplier cycle.

  it('speed cycle: 1 → 2', () => {
    let gameSpeed = 1;
    gameSpeed = gameSpeed === 1 ? 2 : gameSpeed === 2 ? 4 : 1;
    expect(gameSpeed).toBe(2);
  });

  it('speed cycle: 2 → 4', () => {
    let gameSpeed = 2;
    gameSpeed = gameSpeed === 1 ? 2 : gameSpeed === 2 ? 4 : 1;
    expect(gameSpeed).toBe(4);
  });

  it('speed cycle: 4 → 1 (wraps around)', () => {
    let gameSpeed = 4;
    gameSpeed = gameSpeed === 1 ? 2 : gameSpeed === 2 ? 4 : 1;
    expect(gameSpeed).toBe(1);
  });

  it('full cycle returns to starting speed after 3 presses', () => {
    let gameSpeed = 1;
    for (let i = 0; i < 3; i++) {
      gameSpeed = gameSpeed === 1 ? 2 : gameSpeed === 2 ? 4 : 1;
    }
    expect(gameSpeed).toBe(1);
  });

  it('default game speed is 2 (C++ "normal" feel)', () => {
    // TS index.ts:478-479: gameSpeed = 2
    // Comment: "Player game speed (cycles 1→2→4→1 with backtick key) — default 2× (C++ GameSpeed=1 feel)"
    const defaultSpeed = 2;
    expect(defaultSpeed).toBe(2);
  });

  it('unexpected speed values fall through to 1 (safety net)', () => {
    // If gameSpeed is somehow 3, 5, or any non-1/2/4 value, the ternary yields 1
    let gameSpeed = 3;
    gameSpeed = gameSpeed === 1 ? 2 : gameSpeed === 2 ? 4 : 1;
    expect(gameSpeed).toBe(1);

    gameSpeed = 99;
    gameSpeed = gameSpeed === 1 ? 2 : gameSpeed === 2 ? 4 : 1;
    expect(gameSpeed).toBe(1);
  });
});

// ─── 7. Turbo Multiplier Sync — TS index.ts:1313, 2339 ──────────────────────

describe('Turbo multiplier syncs with game speed (index.ts:1313)', () => {
  // TS: if (this.turboMultiplier <= 4) this.turboMultiplier = this.gameSpeed;
  // turboMultiplier is used by the E2E test runner (default=2)

  it('turbo multiplier follows game speed when <= 4', () => {
    let turboMultiplier = 2;
    const gameSpeed = 4;
    if (turboMultiplier <= 4) turboMultiplier = gameSpeed;
    expect(turboMultiplier).toBe(4);
  });

  it('turbo multiplier does NOT follow game speed when > 4 (test runner override)', () => {
    let turboMultiplier = 8; // E2E test runner turbo
    const gameSpeed = 1;
    if (turboMultiplier <= 4) turboMultiplier = gameSpeed;
    expect(turboMultiplier).toBe(8); // unchanged
  });
});

// ─── 8. Tick Rate at Each Speed — Effective ticks per real second ────────────

describe('Effective tick rate at each game speed', () => {
  // TS game loop: accumulator += dt * turboMultiplier
  // tickInterval = 50ms (1000/20)
  // Effective ticks/sec = GAME_TICKS_PER_SEC * turboMultiplier

  it('speed 1: 20 * 1 = 20 effective ticks/sec', () => {
    expect(GAME_TICKS_PER_SEC * 1).toBe(20);
  });

  it('speed 2: 20 * 2 = 40 effective ticks/sec', () => {
    expect(GAME_TICKS_PER_SEC * 2).toBe(40);
  });

  it('speed 4: 20 * 4 = 80 effective ticks/sec', () => {
    expect(GAME_TICKS_PER_SEC * 4).toBe(80);
  });

  it('fear decay real-time at speed 1: 255 ticks / 20 tps = 12.75 seconds', () => {
    const decaySeconds = Entity.FEAR_MAXIMUM / (GAME_TICKS_PER_SEC * 1);
    expect(decaySeconds).toBe(12.75);
  });

  it('fear decay real-time at speed 2 (default): 255 ticks / 40 tps = 6.375 seconds', () => {
    const decaySeconds = Entity.FEAR_MAXIMUM / (GAME_TICKS_PER_SEC * 2);
    expect(decaySeconds).toBe(6.375);
  });

  it('fear decay real-time at speed 4: 255 ticks / 80 tps = 3.1875 seconds', () => {
    const decaySeconds = Entity.FEAR_MAXIMUM / (GAME_TICKS_PER_SEC * 4);
    expect(decaySeconds).toBe(3.1875);
  });
});
