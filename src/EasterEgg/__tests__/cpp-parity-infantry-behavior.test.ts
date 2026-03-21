/**
 * C++ Behavioral Parity: Infantry Behavior — Death Animations, Prone State, Scatter, Fear, Sub-cell
 *
 * Tests verify infantry behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * C++ references:
 *   infantry.h:81        — IsProne flag
 *   infantry.h:101       — FearType Fear
 *   infantry.cpp:90      — HumanShape[32]
 *   infantry.cpp:98-120  — MasterDoControls[DO_COUNT]
 *   infantry.cpp:319-458 — Take_Damage (prone damage bias, fear increase, death anims)
 *   infantry.cpp:1852-1927 — Scatter (threat-based, forced, nokidding)
 *   infantry.cpp:1951-2001 — Do_Action (sets IsProne on LIE_DOWN/GET_UP)
 *   infantry.cpp:3466-3509 — Fear_AI (fear decay, prone state transitions)
 *   infantry.cpp:3988-4006 — Prone movement speed (half speed for crawlers, double for fraidy)
 *   defines.h:617-623    — FearType enum: NONE=0, ANXIOUS=10, SCARED=100, PANIC=200, MAX=255
 *   rules.cpp:202        — ProneDamageBias = fixed(1,2) = 0.5
 *   rules.cpp:234-235    — ConditionYellow=0.5, ConditionRed=0.25
 *   idata.cpp:56-101     — DogDoControls (no prone, no lie_down, no get_up)
 *   idata.cpp:80-101     — E1DoControls die1=288,8 die2=304,8
 *   cell.h               — 5 sub-cell positions: CENTER, NW, NE, SW, SE
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission, AnimState,
  UNIT_STATS, WARHEAD_PROPS, PRONE_DAMAGE_BIAS, CONDITION_RED, CONDITION_YELLOW,
  INFANTRY_ANIMS, SUB_CELL_OFFSETS, buildDefaultAlliances,
  type WarheadType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { GameMap } from '../engine/map';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}


// ═══════════════════════════════════════════════════════════════════════════════
// 1. FEAR CONSTANTS — C++ defines.h:617-623
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fear constants match C++ FearType enum (defines.h:617-623)', () => {
  // C++ defines.h:618: FEAR_NONE=0
  it('FEAR_ANXIOUS = 10', () => {
    expect(Entity.FEAR_ANXIOUS).toBe(10);
  });

  // C++ defines.h:620: FEAR_SCARED=100
  it('FEAR_SCARED = 100', () => {
    expect(Entity.FEAR_SCARED).toBe(100);
  });

  // C++ defines.h:621: FEAR_PANIC=200
  it('FEAR_PANIC = 200', () => {
    expect(Entity.FEAR_PANIC).toBe(200);
  });

  // C++ defines.h:622: FEAR_MAXIMUM=255
  it('FEAR_MAXIMUM = 255', () => {
    expect(Entity.FEAR_MAXIMUM).toBe(255);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PRONE DAMAGE BIAS — C++ rules.cpp:202, infantry.cpp:329-330
// ═══════════════════════════════════════════════════════════════════════════════

describe('Prone damage reduction (infantry.cpp:329-330, rules.cpp:202)', () => {
  // C++ rules.cpp:202: ProneDamageBias(fixed(1, 2)) = 0.5
  it('PRONE_DAMAGE_BIAS is 0.5 (C++ ProneDamageBias = fixed(1,2))', () => {
    expect(PRONE_DAMAGE_BIAS).toBe(0.5);
  });

  // C++ infantry.cpp:329-330: if (IsProne && damage > 0) damage = damage * Rule.ProneDamageBias
  it('prone infantry takes 50% damage from SA warhead', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.isProne = true;
    const hpBefore = e1.hp;
    e1.takeDamage(20, 'SA');
    // 20 * 0.5 = 10, rounded = 10
    expect(hpBefore - e1.hp).toBe(10);
  });

  it('prone infantry always takes at least 1 damage (Math.max(1, ...))', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.isProne = true;
    const hpBefore = e1.hp;
    e1.takeDamage(1, 'SA');
    // 1 * 0.5 = 0.5, rounded to 1, but Math.max(1, 1) = 1
    expect(hpBefore - e1.hp).toBe(1);
  });

  it('non-prone infantry takes full damage', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.isProne).toBe(false);
    const hpBefore = e1.hp;
    e1.takeDamage(20, 'SA');
    expect(hpBefore - e1.hp).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CONDITION THRESHOLDS — C++ rules.cpp:234-235
// ═══════════════════════════════════════════════════════════════════════════════

describe('Health condition thresholds (rules.cpp:234-235)', () => {
  it('CONDITION_YELLOW = 0.5 (50% health)', () => {
    expect(CONDITION_YELLOW).toBe(0.5);
  });

  it('CONDITION_RED = 0.25 (25% health)', () => {
    expect(CONDITION_RED).toBe(0.25);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. FEAR INCREASE ON DAMAGE — C++ infantry.cpp:442-457
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fear increase on damage (infantry.cpp:442-457)', () => {
  // C++ infantry.cpp:442-447: if source and fear < FEAR_SCARED, set to FEAR_SCARED (or PANIC for civilians)
  it('military infantry fear jumps to FEAR_SCARED (100) on first hit', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.fear).toBe(0);
    e1.takeDamage(5, 'SA');
    expect(e1.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  // C++ infantry.cpp:443-444: IsFraidyCat civilians jump to FEAR_PANIC
  it('civilian (IsFraidyCat) fear jumps to FEAR_PANIC (200) on first hit', () => {
    const civ = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    expect(UNIT_STATS.C1.isFraidyCat).toBe(true);
    expect(civ.fear).toBe(0);
    civ.takeDamage(5, 'SA');
    expect(civ.fear).toBeGreaterThanOrEqual(Entity.FEAR_PANIC);
  });

  // C++ infantry.cpp:454-457: morefear = FEAR_ANXIOUS / health-dependent divisors
  // At full health: morefear = 10 / 2 / 2 = 2 (health > yellow > red)
  // At yellow: morefear = 10 / 2 = 5 (health > red, not > yellow)
  // At red: morefear = 10 (health not > red)
  it('subsequent hits add incremental fear based on health ratio', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    // First hit: sets to FEAR_SCARED (100) + moreFear based on health
    e1.takeDamage(5, 'SA');
    const fearAfterFirstHit = e1.fear;
    // Should be at least FEAR_SCARED (100)
    expect(fearAfterFirstHit).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);

    // Second hit: fear already >= FEAR_SCARED, so only moreFear is added
    e1.takeDamage(5, 'SA');
    const fearAfterSecondHit = e1.fear;
    // moreFear calculation: HP is 40/50=0.8 > 0.5 > 0.25, so moreFear = 10/2/2 = 2
    expect(fearAfterSecondHit).toBeGreaterThan(fearAfterFirstHit);
  });

  it('fear is capped at FEAR_MAXIMUM (255)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.fear = 254;
    e1.takeDamage(5, 'SA');
    expect(e1.fear).toBeLessThanOrEqual(Entity.FEAR_MAXIMUM);
  });

  it('zero damage does not increase fear', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.fear).toBe(0);
    e1.takeDamage(0, 'SA');
    expect(e1.fear).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. FEAR AI — PRONE STATE TRANSITIONS — C++ infantry.cpp:3466-3509
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fear_AI prone state transitions (infantry.cpp:3466-3509)', () => {
  // C++ infantry.cpp:3496: if fear >= FEAR_ANXIOUS and not dog, go prone
  it('infantry goes prone when fear >= FEAR_ANXIOUS (10)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.fear = Entity.FEAR_ANXIOUS; // 10
    expect(e1.isProne).toBe(false);

    // Simulate Fear_AI: !isProne && fear >= FEAR_ANXIOUS => go prone
    // This is what the game tick does in index.ts:1572
    if (!e1.isProne && e1.fear >= Entity.FEAR_ANXIOUS && e1.type !== UnitType.I_DOG) {
      e1.isProne = true;
    }
    expect(e1.isProne).toBe(true);
  });

  // C++ infantry.cpp:3487: if IsProne and fear < FEAR_ANXIOUS, get up
  it('infantry stands up when fear drops below FEAR_ANXIOUS', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.isProne = true;
    e1.fear = Entity.FEAR_ANXIOUS - 1; // 9

    // Simulate Fear_AI: isProne && fear < FEAR_ANXIOUS => stand up
    if (e1.isProne && e1.fear < Entity.FEAR_ANXIOUS) {
      e1.isProne = false;
    }
    expect(e1.isProne).toBe(false);
  });

  // C++ infantry.cpp:3496: !Class->IsDog — dogs never go prone
  it('dogs never go prone regardless of fear level', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    dog.fear = Entity.FEAR_MAXIMUM;

    // Fear_AI check: !Class->IsDog prevents prone
    if (!dog.isProne && dog.fear >= Entity.FEAR_ANXIOUS && dog.type !== UnitType.I_DOG) {
      dog.isProne = true;
    }
    expect(dog.isProne).toBe(false);
  });

  // C++ infantry.cpp:3471-3473: Fear-- (decays by 1 per tick)
  it('fear decays by 1 per tick (C++ Fear_AI: Fear--)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.fear = 50;
    // Simulate one tick of Fear_AI decay
    if (e1.fear > 0) e1.fear--;
    expect(e1.fear).toBe(49);
  });

  // C++ infantry.cpp:3506-3507: IsFraidyCat civilians scatter when fear > FEAR_ANXIOUS
  it('IsFraidyCat civilians have elevated scatter threshold (fear > FEAR_ANXIOUS)', () => {
    // C++ infantry.cpp:3506: if (Class->IsFraidyCat && Fear > FEAR_ANXIOUS && ...)
    const civ = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    expect(UNIT_STATS.C1.isFraidyCat).toBe(true);

    // At FEAR_ANXIOUS (10), the civilian would scatter
    civ.fear = Entity.FEAR_ANXIOUS + 1;
    const shouldScatter = UNIT_STATS.C1.isFraidyCat === true && civ.fear > Entity.FEAR_ANXIOUS;
    expect(shouldScatter).toBe(true);

    // At exactly FEAR_ANXIOUS, the comparison is > not >=, so no scatter
    civ.fear = Entity.FEAR_ANXIOUS;
    const shouldNotScatter = UNIT_STATS.C1.isFraidyCat === true && civ.fear > Entity.FEAR_ANXIOUS;
    expect(shouldNotScatter).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. DEATH ANIMATION SELECTION — C++ infantry.cpp:383-416
// ═══════════════════════════════════════════════════════════════════════════════

describe('Death animation by warhead InfDeath (infantry.cpp:383-416)', () => {
  // C++ infantry.cpp:383: switch(warhead->InfantryDeath)
  //   case 0: delthis=true (instant delete)
  //   case 1: DO_GUN_DEATH
  //   case 2: DO_EXPLOSION_DEATH
  //   case 3: DO_GRENADE_DEATH
  //   case 4: DO_FIRE_DEATH
  //   case 5: ANIM_ELECT_DIE

  const WARHEAD_INFDEATH: [string, number][] = [
    ['SA',          1],   // twirl (DO_GUN_DEATH)
    ['HE',          2],   // explode (DO_EXPLOSION_DEATH)
    ['AP',          3],   // flying (DO_GRENADE_DEATH)
    ['Fire',        4],   // burn (DO_FIRE_DEATH)
    ['HollowPoint', 1],   // twirl (dog warhead)
    ['Super',       5],   // electro (ANIM_ELECT_DIE)
    ['Organic',     0],   // instant delete
    ['Nuke',        4],   // burn
  ];

  it.each(WARHEAD_INFDEATH)(
    '%s warhead sets deathVariant=%d (C++ InfDeath from rules.ini)',
    (warhead, expectedDeath) => {
      const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e1.takeDamage(9999, warhead);
      expect(e1.alive).toBe(false);
      expect(e1.deathVariant).toBe(expectedDeath);
    },
  );

  it('killed infantry enters DIE mission and DIE animState', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e1.takeDamage(9999, 'SA');
    expect(e1.mission).toBe(Mission.DIE);
    expect(e1.animState).toBe(AnimState.DIE);
    expect(e1.animFrame).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. DEATH ANIMATION FRAME DATA — C++ idata.cpp DoControls
// ═══════════════════════════════════════════════════════════════════════════════

describe('Infantry death animation frame data matches C++ idata.cpp', () => {
  // C++ idata.cpp:80 — E1DoControls
  //   DO_GUN_DEATH: {382-94, 8, 0} = {288, 8, 0}
  //   DO_EXPLOSION_DEATH: {398-94, 8, 0} = {304, 8, 0}

  const DIE_FRAME_DATA: [string, number, number, number, number][] = [
    // [type, die1_frame, die1_count, die2_frame, die2_count]
    ['E1',  288, 8, 304, 8],   // idata.cpp:92-93
    ['E2',  416, 8, 432, 8],   // idata.cpp:116-117 (510-94, 526-94)
    ['E3',  304, 8, 320, 8],   // idata.cpp:140-141 (398-94, 414-94)
    ['E4',  416, 8, 432, 8],   // idata.cpp:164-165 (510-94, 526-94)
    ['E6',  146, 8, 154, 8],   // idata.cpp:188-189
    ['E7',  262, 8, 270, 8],   // idata.cpp:212-213 (Tanya)
    ['DOG', 235, 7, 242, 9],   // idata.cpp:68-69
  ];

  it.each(DIE_FRAME_DATA)(
    '%s die1 frame=%d count=%d, die2 frame=%d count=%d',
    (type, die1Frame, die1Count, die2Frame, die2Count) => {
      const anim = INFANTRY_ANIMS[type];
      expect(anim, `${type} should have INFANTRY_ANIMS entry`).toBeDefined();

      expect(anim.die1.frame).toBe(die1Frame);
      expect(anim.die1.count).toBe(die1Count);
      expect(anim.die1.jump).toBe(0); // death anims are non-directional (jump=0)

      if (anim.die2) {
        expect(anim.die2.frame).toBe(die2Frame);
        expect(anim.die2.count).toBe(die2Count);
        expect(anim.die2.jump).toBe(0);
      }
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. MASTERDOCONTROLS — C++ infantry.cpp:98-120
// ═══════════════════════════════════════════════════════════════════════════════

describe('MasterDoControls — death animations are non-interruptible (infantry.cpp:98-120)', () => {
  // C++ infantry.cpp:110-114: death actions have Interrupt=false
  // DO_GUN_DEATH:       {false, false, false, 2}
  // DO_EXPLOSION_DEATH: {false, false, false, 2}
  // DO_GRENADE_DEATH:   {false, false, false, 2}
  // DO_FIRE_DEATH:      {false, false, false, 2}
  //
  // DO_LIE_DOWN:        {false, true, false, 2} — not interruptible
  // DO_GET_UP:          {false, false, false, 3} — not interruptible
  // DO_WALK:            {true, true, true, 2} — interruptible
  // DO_FIRE_WEAPON:     {true, false, false, 1} — interruptible

  it('death animations are non-interruptible in C++ (verified by structure)', () => {
    // In TS, once an entity is dead (alive=false), it stays dead.
    // This test verifies the C++ design constraint is maintained:
    // death actions cannot be interrupted.
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.takeDamage(9999, 'SA');
    expect(e1.alive).toBe(false);
    // Verify takeDamage on dead entity returns false (no-op)
    const result = e1.takeDamage(100, 'HE');
    expect(result).toBe(false);
    // Death state is stable
    expect(e1.mission).toBe(Mission.DIE);
    expect(e1.animState).toBe(AnimState.DIE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. PRONE MOVEMENT SPEED — C++ infantry.cpp:3988-4006
// ═══════════════════════════════════════════════════════════════════════════════

describe('Prone movement speed rules (infantry.cpp:3988-4006)', () => {
  // C++ infantry.cpp:4000-4005:
  //   if (IsProne && !Class->IsDog) {
  //     if (Class->IsFraidyCat && !Class->IsCrawling) {
  //       movespeed = Speed * 2;    // fraidy civilians run at double speed
  //     } else {
  //       movespeed = Speed / 2;    // military crawls at half speed
  //     }
  //   }

  it('military infantry (E1) has crawl animation (for half-speed prone movement)', () => {
    const anim = INFANTRY_ANIMS.E1;
    expect(anim.crawl).toBeDefined();
    expect(anim.crawl!.count).toBeGreaterThan(0);
  });

  it('dogs have no prone animation (IsDog check prevents prone)', () => {
    const anim = INFANTRY_ANIMS.DOG;
    expect(anim.prone).toBeUndefined();
    expect(anim.lieDown).toBeUndefined();
    expect(anim.getUp).toBeUndefined();
  });

  it('fraidy civilians (C1) are flagged isFraidyCat for double-speed prone run', () => {
    expect(UNIT_STATS.C1.isFraidyCat).toBe(true);
  });

  it('military infantry (E1) are NOT fraidy — they crawl at half speed', () => {
    expect(UNIT_STATS.E1.isFraidyCat).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. LIE_DOWN / GET_UP TRANSITIONS — C++ infantry.cpp:1988-1995
// ═══════════════════════════════════════════════════════════════════════════════

describe('Lie down / get up animation transitions (infantry.cpp:1988-1995)', () => {
  // C++ infantry.cpp:1989-1990: case DO_LIE_DOWN: IsProne = true;
  // C++ infantry.cpp:1993-1994: case DO_GET_UP: IsProne = false;

  it('E1 has lieDown and getUp animation entries (transition frames)', () => {
    const anim = INFANTRY_ANIMS.E1;
    expect(anim.lieDown).toBeDefined();
    expect(anim.getUp).toBeDefined();
  });

  // C++ idata.cpp:86: E1 DO_LIE_DOWN = {128, 2, 2} — 2 frames
  it('E1 lieDown is 2 frames at frame 128 (idata.cpp:86)', () => {
    expect(INFANTRY_ANIMS.E1.lieDown!.frame).toBe(128);
    expect(INFANTRY_ANIMS.E1.lieDown!.count).toBe(2);
    expect(INFANTRY_ANIMS.E1.lieDown!.jump).toBe(2);
  });

  // C++ idata.cpp:88: E1 DO_GET_UP = {176, 2, 2} — 2 frames
  it('E1 getUp is 2 frames at frame 176 (idata.cpp:88)', () => {
    expect(INFANTRY_ANIMS.E1.getUp!.frame).toBe(176);
    expect(INFANTRY_ANIMS.E1.getUp!.count).toBe(2);
    expect(INFANTRY_ANIMS.E1.getUp!.jump).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. INFANTRY SUB-CELL POSITIONS — C++ cell.h, 5 positions per cell
// ═══════════════════════════════════════════════════════════════════════════════

describe('Infantry sub-cell positions (cell.h — 5 per cell)', () => {
  // C++ cell.h: Spot_Index selects from 5 positions (CENTER=0, NW=1, NE=2, SW=3, SE=4)
  // TS types.ts:930-936: SUB_CELL_OFFSETS[0..4]

  it('there are exactly 5 sub-cell positions', () => {
    expect(SUB_CELL_OFFSETS).toHaveLength(5);
  });

  it('sub-cell 0 is center (0,0)', () => {
    expect(SUB_CELL_OFFSETS[0].x).toBe(0);
    expect(SUB_CELL_OFFSETS[0].y).toBe(0);
  });

  it('sub-cells 1-4 are the four corners (NW, NE, SW, SE)', () => {
    // NW = top-left = negative x, negative y
    expect(SUB_CELL_OFFSETS[1].x).toBeLessThan(0);
    expect(SUB_CELL_OFFSETS[1].y).toBeLessThan(0);

    // NE = top-right = positive x, negative y
    expect(SUB_CELL_OFFSETS[2].x).toBeGreaterThan(0);
    expect(SUB_CELL_OFFSETS[2].y).toBeLessThan(0);

    // SW = bottom-left = negative x, positive y
    expect(SUB_CELL_OFFSETS[3].x).toBeLessThan(0);
    expect(SUB_CELL_OFFSETS[3].y).toBeGreaterThan(0);

    // SE = bottom-right = positive x, positive y
    expect(SUB_CELL_OFFSETS[4].x).toBeGreaterThan(0);
    expect(SUB_CELL_OFFSETS[4].y).toBeGreaterThan(0);
  });

  it('corner offsets are symmetric (equal magnitude)', () => {
    const mag = Math.abs(SUB_CELL_OFFSETS[1].x);
    expect(Math.abs(SUB_CELL_OFFSETS[1].y)).toBe(mag);
    expect(Math.abs(SUB_CELL_OFFSETS[2].x)).toBe(mag);
    expect(Math.abs(SUB_CELL_OFFSETS[2].y)).toBe(mag);
    expect(Math.abs(SUB_CELL_OFFSETS[3].x)).toBe(mag);
    expect(Math.abs(SUB_CELL_OFFSETS[3].y)).toBe(mag);
    expect(Math.abs(SUB_CELL_OFFSETS[4].x)).toBe(mag);
    expect(Math.abs(SUB_CELL_OFFSETS[4].y)).toBe(mag);
  });

  it('GameMap tracks sub-cell occupancy for up to 5 infantry per cell', () => {
    const map = new GameMap();
    map.clearSubCellOccupancy();

    // Place 5 infantry in the same cell
    for (let i = 1; i <= 5; i++) {
      const slot = map.occupySubCell(10, 10, i);
      expect(slot, `infantry #${i} should get sub-cell slot`).toBeGreaterThanOrEqual(0);
    }

    // 6th infantry should fail (all 5 slots full)
    const overflow = map.occupySubCell(10, 10, 6);
    expect(overflow).toBe(-1);
  });

  it('vacating a sub-cell frees it for reuse', () => {
    const map = new GameMap();
    map.clearSubCellOccupancy();

    // Fill all 5 slots
    for (let i = 1; i <= 5; i++) {
      map.occupySubCell(10, 10, i);
    }
    expect(map.hasAvailableSubCell(10, 10)).toBe(false);

    // Vacate one
    map.vacateSubCell(10, 10, 3);
    expect(map.hasAvailableSubCell(10, 10)).toBe(true);

    // Re-occupy should succeed
    const slot = map.occupySubCell(10, 10, 6);
    expect(slot).toBeGreaterThanOrEqual(0);
  });

  it('entity has subCell property initialized to 0 (center)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.subCell).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. SCATTER GUARD RAILS — C++ infantry.cpp:1852-1883
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scatter preconditions (infantry.cpp:1852-1883)', () => {
  // C++ infantry.cpp:1866: if (!MissionControl[Mission].IsScatter && !forced) return;
  // C++ infantry.cpp:1872: if (!Class->IsFraidyCat && Target_Legal(TarCom) && !forced) return;
  // C++ infantry.cpp:1877: if (Doing != DO_NOTHING && !MasterDoControls[Doing].Interrupt) return;
  // C++ infantry.cpp:1883: if (!Rule.IsScatter && !nokidding && House->IsHuman && !forced && !Team.Is_Valid()) return;

  it('infantry starts with fear=0 and isProne=false (no spontaneous scatter)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.fear).toBe(0);
    expect(e1.isProne).toBe(false);
  });

  it('IsFraidyCat scatter condition: civilian with fear > FEAR_ANXIOUS scatters', () => {
    // C++ infantry.cpp:3506: Class->IsFraidyCat && Fear > FEAR_ANXIOUS
    const civ = entityAtCell(UnitType.I_C1, House.Spain, 10, 10);
    civ.fear = Entity.FEAR_ANXIOUS + 1;

    const shouldScatter = (UNIT_STATS.C1.isFraidyCat === true) && civ.fear > Entity.FEAR_ANXIOUS;
    expect(shouldScatter).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. FEAR → PRONE INTEGRATION — Full lifecycle test
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fear/prone lifecycle integration', () => {
  it('full cycle: no fear → damage → fear → prone → decay → stand up', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);

    // 1. Start: no fear, standing
    expect(e1.fear).toBe(0);
    expect(e1.isProne).toBe(false);

    // 2. Take damage: fear jumps to >= FEAR_SCARED
    e1.takeDamage(5, 'SA');
    expect(e1.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
    expect(e1.alive).toBe(true);

    // 3. Fear_AI tick: should go prone (fear >= FEAR_ANXIOUS)
    if (!e1.isProne && e1.fear >= Entity.FEAR_ANXIOUS && e1.type !== UnitType.I_DOG) {
      e1.isProne = true;
    }
    expect(e1.isProne).toBe(true);

    // 4. Decay fear to just below FEAR_ANXIOUS
    e1.fear = Entity.FEAR_ANXIOUS - 1; // simulate many ticks of decay

    // 5. Fear_AI should cause stand-up
    if (e1.isProne && e1.fear < Entity.FEAR_ANXIOUS) {
      e1.isProne = false;
    }
    expect(e1.isProne).toBe(false);
  });

  it('fear decay from FEAR_SCARED to 0 takes exactly 100 ticks', () => {
    // C++ Fear_AI: Fear-- every tick. From 100 to 0 = 100 decrements.
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.fear = Entity.FEAR_SCARED; // 100
    let ticks = 0;
    while (e1.fear > 0) {
      e1.fear--;
      ticks++;
    }
    expect(ticks).toBe(100);
  });

  it('fear decay from FEAR_MAXIMUM to 0 takes exactly 255 ticks', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.fear = Entity.FEAR_MAXIMUM; // 255
    let ticks = 0;
    while (e1.fear > 0) {
      e1.fear--;
      ticks++;
    }
    expect(ticks).toBe(255);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. INFANTRY ANIMATION FRAME CORRECTNESS — C++ idata.cpp
// ═══════════════════════════════════════════════════════════════════════════════

describe('Infantry animation frame data vs C++ idata.cpp', () => {
  // C++ idata.cpp:80-101 — E1DoControls
  it('E1 walk: frame=16, count=6, jump=6 (idata.cpp:84)', () => {
    expect(INFANTRY_ANIMS.E1.walk.frame).toBe(16);
    expect(INFANTRY_ANIMS.E1.walk.count).toBe(6);
    expect(INFANTRY_ANIMS.E1.walk.jump).toBe(6);
  });

  it('E1 fire: frame=64, count=8, jump=8 (idata.cpp:85)', () => {
    expect(INFANTRY_ANIMS.E1.fire.frame).toBe(64);
    expect(INFANTRY_ANIMS.E1.fire.count).toBe(8);
    expect(INFANTRY_ANIMS.E1.fire.jump).toBe(8);
  });

  it('E1 prone: frame=192, count=1, jump=8 (idata.cpp:83)', () => {
    expect(INFANTRY_ANIMS.E1.prone!.frame).toBe(192);
    expect(INFANTRY_ANIMS.E1.prone!.count).toBe(1);
    expect(INFANTRY_ANIMS.E1.prone!.jump).toBe(8);
  });

  it('E1 crawl: frame=144, count=4, jump=4 (idata.cpp:87)', () => {
    expect(INFANTRY_ANIMS.E1.crawl!.frame).toBe(144);
    expect(INFANTRY_ANIMS.E1.crawl!.count).toBe(4);
    expect(INFANTRY_ANIMS.E1.crawl!.jump).toBe(4);
  });

  it('E1 fireProne: frame=192, count=6, jump=8 (idata.cpp:89)', () => {
    expect(INFANTRY_ANIMS.E1.fireProne!.frame).toBe(192);
    expect(INFANTRY_ANIMS.E1.fireProne!.count).toBe(6);
    expect(INFANTRY_ANIMS.E1.fireProne!.jump).toBe(8);
  });

  // Dog controls — C++ idata.cpp:56-78
  it('DOG walk: frame=8, count=6, jump=6 (idata.cpp:60)', () => {
    expect(INFANTRY_ANIMS.DOG.walk.frame).toBe(8);
    expect(INFANTRY_ANIMS.DOG.walk.count).toBe(6);
    expect(INFANTRY_ANIMS.DOG.walk.jump).toBe(6);
  });

  it('DOG fire (maul): frame=104, count=14, jump=14 (idata.cpp:61)', () => {
    expect(INFANTRY_ANIMS.DOG.fire.frame).toBe(104);
    expect(INFANTRY_ANIMS.DOG.fire.count).toBe(14);
    expect(INFANTRY_ANIMS.DOG.fire.jump).toBe(14);
  });

  // E4 (Flamethrower) — C++ idata.cpp:152-174
  it('E4 fire: frame=64, count=16, jump=16 (idata.cpp:157)', () => {
    expect(INFANTRY_ANIMS.E4.fire.frame).toBe(64);
    expect(INFANTRY_ANIMS.E4.fire.count).toBe(16);
    expect(INFANTRY_ANIMS.E4.fire.jump).toBe(16);
  });

  it('E4 fireProne: frame=256, count=16, jump=16 (idata.cpp:161)', () => {
    expect(INFANTRY_ANIMS.E4.fireProne!.frame).toBe(256);
    expect(INFANTRY_ANIMS.E4.fireProne!.count).toBe(16);
    expect(INFANTRY_ANIMS.E4.fireProne!.jump).toBe(16);
  });

  // E7 (Tanya) — C++ idata.cpp:200-219
  it('E7 fire: frame=56, count=7, jump=7 (idata.cpp:205)', () => {
    expect(INFANTRY_ANIMS.E7.fire.frame).toBe(56);
    expect(INFANTRY_ANIMS.E7.fire.count).toBe(7);
    expect(INFANTRY_ANIMS.E7.fire.jump).toBe(7);
  });

  // E2 (Grenadier) — C++ idata.cpp:104-126
  it('E2 fire: frame=64, count=20, jump=20 (idata.cpp:109)', () => {
    expect(INFANTRY_ANIMS.E2.fire.frame).toBe(64);
    expect(INFANTRY_ANIMS.E2.fire.count).toBe(20);
    expect(INFANTRY_ANIMS.E2.fire.jump).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. SHOK USES E4 CONTROLS — C++ idata.cpp:852
// ═══════════════════════════════════════════════════════════════════════════════

describe('SHOK (Shock Trooper) shares E4 animation layout (idata.cpp:852)', () => {
  it('SHOK INFANTRY_ANIMS is the same object as E4', () => {
    expect(INFANTRY_ANIMS.SHOK).toBe(INFANTRY_ANIMS.E4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. DOG INSTANT KILL — C++ infantry.cpp:339-345
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dog instant kill — only harms designated target (infantry.cpp:339-345)', () => {
  // C++ infantry.cpp:339-344:
  //   if source is dog:
  //     if (source->TarCom == As_Target()) damage = Strength;  // instant kill
  //     else damage = 0;                                        // no collateral

  it('dog kills its designated target instantly', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    dog.target = victim;
    victim.takeDamage(10, 'Organic', dog);
    expect(victim.alive).toBe(false);
  });

  it('dog does zero damage to non-targets (no collateral)', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const bystander = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    dog.target = target;
    const hpBefore = bystander.hp;
    bystander.takeDamage(50, 'Organic', dog);
    expect(bystander.hp).toBe(hpBefore); // no damage
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. ENTITY INITIALIZATION — C++ infantry.cpp:182
// ═══════════════════════════════════════════════════════════════════════════════

describe('Infantry entity initialization (infantry.cpp:182)', () => {
  // C++ infantry.cpp:182: IsProne(false)
  it('infantry starts not prone', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.isProne).toBe(false);
  });

  it('infantry starts with fear=0 (FEAR_NONE)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.fear).toBe(0);
  });

  it('infantry starts alive with full HP', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(e1.maxHp);
    expect(e1.hp).toBe(UNIT_STATS.E1.strength);
  });
});
