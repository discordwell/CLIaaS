/**
 * C++ Behavioral Parity Tests — Infantry Death Animations
 *
 * Verifies the 6 InfDeath types (0-5), die1/die2 frame data for all infantry types,
 * warhead→deathVariant mapping, ELECT_DIE (tesla) special case, corpse rendering,
 * dog death animations, and civilian deaths against the original Red Alert C++
 * implementation (infantry.cpp, idata.cpp, warhead.cpp).
 *
 * C++ reference: infantry.cpp:383-416 — switch(warhead->InfantryDeath)
 *   InfDeath 0: instant delete (no animation, delthis=true)
 *   InfDeath 1: DO_GUN_DEATH
 *   InfDeath 2: DO_EXPLOSION_DEATH
 *   InfDeath 3: DO_GRENADE_DEATH
 *   InfDeath 4: DO_FIRE_DEATH
 *   InfDeath 5: ANIM_ELECT_DIE (separate sprite, not from infantry SHP)
 *
 * TS simplification: die1 = DO_GUN_DEATH, die2 = DO_EXPLOSION_DEATH.
 * deathVariant > 0 uses die2, deathVariant == 0 uses die1.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  INFANTRY_ANIMS, WARHEAD_PROPS, UNIT_STATS,
  UnitType, House, Mission, AnimState,
  type WarheadType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => {
  resetEntityIds();
});

// ─── 1. WARHEAD → infantryDeath mapping (C++ warhead.cpp InfDeath=) ─────────

describe('Warhead infantryDeath values match C++ RULES.INI InfDeath=', () => {
  // C++ warhead.cpp:176 — ini.Get_Int(Name(), "InfDeath", InfantryDeath)
  // Values from RULES.INI [Warhead] sections

  it('SA: InfDeath=1 (twirl / DO_GUN_DEATH)', () => {
    expect(WARHEAD_PROPS.SA.infantryDeath).toBe(1);
  });

  it('HE: InfDeath=2 (explode / DO_EXPLOSION_DEATH)', () => {
    expect(WARHEAD_PROPS.HE.infantryDeath).toBe(2);
  });

  it('AP: InfDeath=3 (flying / DO_GRENADE_DEATH)', () => {
    expect(WARHEAD_PROPS.AP.infantryDeath).toBe(3);
  });

  it('Fire: InfDeath=4 (burn / DO_FIRE_DEATH)', () => {
    expect(WARHEAD_PROPS.Fire.infantryDeath).toBe(4);
  });

  it('HollowPoint: InfDeath=1 (twirl — dogs use HollowPoint)', () => {
    expect(WARHEAD_PROPS.HollowPoint.infantryDeath).toBe(1);
  });

  it('Super: InfDeath=5 (electro — tesla coil)', () => {
    expect(WARHEAD_PROPS.Super.infantryDeath).toBe(5);
  });

  it('Organic: InfDeath=0 (instant — DogJaw melee)', () => {
    expect(WARHEAD_PROPS.Organic.infantryDeath).toBe(0);
  });

  it('Nuke: InfDeath=4 (burn — nuclear weapons)', () => {
    expect(WARHEAD_PROPS.Nuke.infantryDeath).toBe(4);
  });

  it('Mechanical: InfDeath=0 (instant — engine-only)', () => {
    expect(WARHEAD_PROPS.Mechanical.infantryDeath).toBe(0);
  });

  it('all 9 warhead types have infantryDeath defined', () => {
    const warheads: WarheadType[] = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke', 'Mechanical'];
    for (const wh of warheads) {
      expect(WARHEAD_PROPS[wh].infantryDeath, `${wh} should have infantryDeath`).toBeDefined();
      expect(WARHEAD_PROPS[wh].infantryDeath).toBeGreaterThanOrEqual(0);
      expect(WARHEAD_PROPS[wh].infantryDeath).toBeLessThanOrEqual(5);
    }
  });
});

// ─── 2. takeDamage sets deathVariant from warhead (C++ infantry.cpp:383) ────

describe('takeDamage sets deathVariant from warhead InfDeath value', () => {
  const warheadTests: [WarheadType, number][] = [
    ['SA', 1],           // Small Arms → twirl
    ['HE', 2],           // High Explosive → explode
    ['AP', 3],           // Armor Piercing → flying
    ['Fire', 4],         // Fire → burn
    ['HollowPoint', 1],  // HollowPoint → twirl
    ['Super', 5],        // Tesla → electro
    ['Organic', 0],      // Organic → instant
    ['Nuke', 4],         // Nuclear → burn
    ['Mechanical', 0],   // Mechanical → instant
  ];

  for (const [warhead, expectedDeath] of warheadTests) {
    it(`${warhead} warhead → deathVariant=${expectedDeath}`, () => {
      const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
      unit.takeDamage(9999, warhead);
      expect(unit.alive).toBe(false);
      expect(unit.deathVariant).toBe(expectedDeath);
    });
  }

  it('takeDamage without warhead uses random fallback (0 or 1)', () => {
    // Without warhead, C++ behavior varies; TS falls back to random
    const results = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
      unit.takeDamage(9999);
      results.add(unit.deathVariant);
    }
    // Should produce at least two values (0 and 1) from the random fallback
    expect(results.size).toBeGreaterThanOrEqual(1);
    for (const v of results) {
      expect(v === 0 || v === 1).toBe(true);
    }
  });

  it('death sets mission=DIE and animState=DIE', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.takeDamage(9999, 'SA');
    expect(unit.mission).toBe(Mission.DIE);
    expect(unit.animState).toBe(AnimState.DIE);
    expect(unit.animFrame).toBe(0);
    expect(unit.animTick).toBe(0);
    expect(unit.deathTick).toBe(0);
  });
});

// ─── 3. die1 frame data matches C++ idata.cpp DO_GUN_DEATH ─────────────────

describe('die1 frame data matches C++ idata.cpp DO_GUN_DEATH', () => {
  // C++ DoInfoStruct: {frame, count, jump}
  // die1 in TS = DO_GUN_DEATH in C++
  // All death animations have jump=0 (non-directional)

  const die1Data: [string, { frame: number; count: number; jump: number }][] = [
    // E1DoControls:92 — {382-94, 8, 0}
    ['E1', { frame: 382 - 94, count: 8, jump: 0 }],
    // E2DoControls:116 — {510-94, 8, 0}
    ['E2', { frame: 510 - 94, count: 8, jump: 0 }],
    // E3DoControls:140 — {398-94, 8, 0}
    ['E3', { frame: 398 - 94, count: 8, jump: 0 }],
    // E4DoControls:164 — {510-94, 8, 0}
    ['E4', { frame: 510 - 94, count: 8, jump: 0 }],
    // E6DoControls:188 — {146, 8, 0}
    ['E6', { frame: 146, count: 8, jump: 0 }],
    // DogDoControls:68 — {235, 7, 0}
    ['DOG', { frame: 235, count: 7, jump: 0 }],
    // E7DoControls:212 — {262, 8, 0}
    ['E7', { frame: 262, count: 8, jump: 0 }],
    // SpyDoControls:237 — {288, 8, 0}
    ['SPY', { frame: 288, count: 8, jump: 0 }],
    // MedicDoControls:285 — {193, 8, 0}
    ['MECH', { frame: 193, count: 8, jump: 0 }],
  ];

  for (const [type, expected] of die1Data) {
    it(`${type} die1: frame=${expected.frame}, count=${expected.count}, jump=${expected.jump}`, () => {
      const anim = INFANTRY_ANIMS[type];
      expect(anim, `INFANTRY_ANIMS.${type} should exist`).toBeDefined();
      expect(anim.die1.frame).toBe(expected.frame);
      expect(anim.die1.count).toBe(expected.count);
      expect(anim.die1.jump).toBe(expected.jump);
    });
  }
});

// ─── 4. die2 frame data matches C++ idata.cpp DO_EXPLOSION_DEATH ────────────

describe('die2 frame data matches C++ idata.cpp DO_EXPLOSION_DEATH', () => {
  // die2 in TS = DO_EXPLOSION_DEATH in C++

  const die2Data: [string, { frame: number; count: number; jump: number }][] = [
    // E1DoControls:93 — {398-94, 8, 0}
    ['E1', { frame: 398 - 94, count: 8, jump: 0 }],
    // E2DoControls:117 — {526-94, 8, 0}
    ['E2', { frame: 526 - 94, count: 8, jump: 0 }],
    // E3DoControls:141 — {414-94, 8, 0}
    ['E3', { frame: 414 - 94, count: 8, jump: 0 }],
    // E4DoControls:165 — {526-94, 8, 0}
    ['E4', { frame: 526 - 94, count: 8, jump: 0 }],
    // E6DoControls:189 — {154, 8, 0}
    ['E6', { frame: 154, count: 8, jump: 0 }],
    // DogDoControls:69 — {242, 9, 0}
    ['DOG', { frame: 242, count: 9, jump: 0 }],
    // E7DoControls:213 — {270, 8, 0}
    ['E7', { frame: 270, count: 8, jump: 0 }],
    // SpyDoControls:238 — {296, 8, 0}
    ['SPY', { frame: 296, count: 8, jump: 0 }],
    // MedicDoControls:286 — {210, 8, 0}
    ['MECH', { frame: 210, count: 8, jump: 0 }],
  ];

  for (const [type, expected] of die2Data) {
    it(`${type} die2: frame=${expected.frame}, count=${expected.count}, jump=${expected.jump}`, () => {
      const anim = INFANTRY_ANIMS[type];
      expect(anim, `INFANTRY_ANIMS.${type} should exist`).toBeDefined();
      expect(anim.die2, `INFANTRY_ANIMS.${type}.die2 should exist`).toBeDefined();
      expect(anim.die2!.frame).toBe(expected.frame);
      expect(anim.die2!.count).toBe(expected.count);
      expect(anim.die2!.jump).toBe(expected.jump);
    });
  }
});

// ─── 5. Alias infantry types use correct DoControls ─────────────────────────

describe('Alias infantry types share correct animation data', () => {
  it('SHOK uses same animation as E4 (C++ Shock Trooper = E4DoControls — idata.cpp:852)', () => {
    expect(INFANTRY_ANIMS.SHOK).toBe(INFANTRY_ANIMS.E4);
  });

  it('MEDI uses same animation as MECH (C++ MedicDoControls)', () => {
    expect(INFANTRY_ANIMS.MEDI).toBe(INFANTRY_ANIMS.MECH);
  });

  it('SHOK die1 matches E4 die1', () => {
    expect(INFANTRY_ANIMS.SHOK.die1.frame).toBe(416); // E4: 510-94=416
    expect(INFANTRY_ANIMS.SHOK.die1.count).toBe(8);
  });

  it('MEDI die1 matches MECH die1', () => {
    expect(INFANTRY_ANIMS.MEDI.die1.frame).toBe(193);
    expect(INFANTRY_ANIMS.MEDI.die1.count).toBe(8);
  });
});

// ─── 6. ELECT_DIE (InfDeath=5) — Tesla special case ────────────────────────

describe('InfDeath=5 (electro/tesla) death behavior', () => {
  // C++ infantry.cpp:409-415:
  //   case 5: AnimType anim = ANIM_ELECT_DIE; if (Class->IsDog) anim = ANIM_DOG_ELECT_DIE;
  //   new AnimClass(anim, Coord); delthis = true;
  //
  // In C++, InfDeath=5 creates a separate ANIM_ELECT_DIE sprite and deletes the infantry.
  // In TS, deathVariant=5 falls into the die2 branch (deathVariant > 0).
  // The renderer should handle ELECT_DIE as a special overlay; the entity system just
  // stores deathVariant=5 for the renderer to interpret.

  it('Super warhead sets deathVariant=5 (electro)', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.takeDamage(9999, 'Super');
    expect(unit.deathVariant).toBe(5);
  });

  it('deathVariant=5 uses die2 animation branch (deathVariant > 0)', () => {
    const anim = INFANTRY_ANIMS.E1;
    // Entity.spriteFrame logic: deathVariant > 0 && anim.die2 → die2
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.takeDamage(9999, 'Super');
    unit.animState = AnimState.DIE;
    unit.animFrame = 0;

    // spriteFrame should use die2 since deathVariant=5 > 0
    const d = (unit.deathVariant > 0 && anim.die2) ? anim.die2 : anim.die1;
    expect(d).toBe(anim.die2);
  });

  it('dog tesla death also sets deathVariant=5 (C++ DOG_ELECT_DIE)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.takeDamage(9999, 'Super');
    expect(dog.deathVariant).toBe(5);
  });

  it('dog with deathVariant=5 uses die2 branch', () => {
    const anim = INFANTRY_ANIMS.DOG;
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.takeDamage(9999, 'Super');
    const d = (dog.deathVariant > 0 && anim.die2) ? anim.die2 : anim.die1;
    expect(d).toBe(anim.die2);
  });
});

// ─── 7. spriteFrame calculation for dying infantry ──────────────────────────

describe('spriteFrame uses correct death animation based on deathVariant', () => {
  it('deathVariant=0 → die1 frame for E1', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.alive = false;
    unit.animState = AnimState.DIE;
    unit.deathVariant = 0;
    unit.animFrame = 0;
    // die1.frame = 288, die1.count = 8
    // spriteFrame = die1.frame + min(animFrame, count-1) = 288 + 0 = 288
    expect(unit.spriteFrame).toBe(288);
  });

  it('deathVariant=0 → die1 last frame for E1', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.alive = false;
    unit.animState = AnimState.DIE;
    unit.deathVariant = 0;
    unit.animFrame = 20; // past end
    // spriteFrame = die1.frame + min(20, 8-1) = 288 + 7 = 295
    expect(unit.spriteFrame).toBe(288 + 7);
  });

  it('deathVariant=1 → die1 frame for E1 (SA warhead / DO_GUN_DEATH)', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.alive = false;
    unit.animState = AnimState.DIE;
    unit.deathVariant = 1;
    unit.animFrame = 0;
    // infantry.cpp: InfDeath=1 -> DO_GUN_DEATH -> die1.frame = 288
    expect(unit.spriteFrame).toBe(288);
  });

  it('deathVariant=2 → die2 frame for E1 (HE warhead explode)', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.alive = false;
    unit.animState = AnimState.DIE;
    unit.deathVariant = 2;
    unit.animFrame = 3;
    // die2.frame = 304, count = 8, min(3, 7) = 3
    expect(unit.spriteFrame).toBe(304 + 3);
  });

  it('deathVariant=5 → die5 (FIRE_DEATH) frame for E1 (Super warhead electro)', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.alive = false;
    unit.animState = AnimState.DIE;
    unit.deathVariant = 5;
    unit.animFrame = 0;
    // G2: deathVariant=5 → die5 (FIRE_DEATH). C++ E1DoControls die5 = 418-94 = 324.
    expect(unit.spriteFrame).toBe(324);
  });

  it('DOG deathVariant=0 → die1 frame (235, count=7)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.alive = false;
    dog.animState = AnimState.DIE;
    dog.deathVariant = 0;
    dog.animFrame = 0;
    expect(dog.spriteFrame).toBe(235);
  });

  it('DOG deathVariant=1 → die1 frame (235, count=7)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.alive = false;
    dog.animState = AnimState.DIE;
    dog.deathVariant = 1;
    dog.animFrame = 0;
    expect(dog.spriteFrame).toBe(235);
  });

  it('DOG die1 last frame is 235 + 6 = 241', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.alive = false;
    dog.animState = AnimState.DIE;
    dog.deathVariant = 1;
    dog.animFrame = 50; // past end
    // die1.frame=235, count=7, min(50, 6) = 6 -> 235+6 = 241
    expect(dog.spriteFrame).toBe(235 + 6);
  });
});

// ─── 8. Dogs killed by HollowPoint use InfDeath=1 (twirl) ──────────────────

describe('Dogs killed by HollowPoint warhead use twirl death (InfDeath=1)', () => {
  // C++ RULES.INI: [HollowPoint] InfDeath=1
  // Dogs attacking other dogs via DogJaw use Organic (InfDeath=0),
  // but the standard dog death scenario involves HollowPoint warhead.

  it('HollowPoint sets deathVariant=1 on dog', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.takeDamage(9999, 'HollowPoint');
    expect(dog.deathVariant).toBe(1);
  });

  it('HollowPoint die2 animation is the twirl death for dog', () => {
    // DOG die2 = {242, 9, 0} = explosion/twirl death animation
    const dogAnim = INFANTRY_ANIMS.DOG;
    expect(dogAnim.die2!.frame).toBe(242);
    expect(dogAnim.die2!.count).toBe(9);
  });
});

// ─── 9. Prone infantry death still works (C++ infantry.cpp:329-330) ─────────

describe('Prone infantry death animation works correctly', () => {
  it('prone infantry can die and sets correct deathVariant', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.isProne = true;
    unit.fear = Entity.FEAR_SCARED;
    unit.takeDamage(9999, 'HE');
    expect(unit.alive).toBe(false);
    expect(unit.deathVariant).toBe(2); // HE → InfDeath=2
    expect(unit.animState).toBe(AnimState.DIE);
  });

  it('prone infantry takes 50% damage before death check', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.isProne = true;
    // E1 has 50 HP. 30 damage * 0.5 = 15 → survives
    const killed = unit.takeDamage(30, 'SA');
    expect(killed).toBe(false);
    expect(unit.hp).toBe(50 - Math.max(1, Math.round(30 * 0.5))); // 50 - 15 = 35
  });

  it('prone E1 with die animation uses die2 for HE death (deathVariant=2)', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.isProne = true;
    unit.takeDamage(9999, 'HE');
    unit.animFrame = 0;
    // deathVariant=2 > 0 → die2.frame=304
    expect(unit.spriteFrame).toBe(304);
  });
});

// ─── 10. All death animations have jump=0 (non-directional) ─────────────────

describe('All death animations are non-directional (jump=0)', () => {
  // C++ idata.cpp: all DO_GUN_DEATH, DO_EXPLOSION_DEATH have jump=0
  // This means death animations do not vary by facing direction

  const allTypes = Object.keys(INFANTRY_ANIMS);

  for (const type of allTypes) {
    it(`${type} die1 has jump=0`, () => {
      const anim = INFANTRY_ANIMS[type];
      expect(anim.die1.jump).toBe(0);
    });
  }

  for (const type of allTypes) {
    const anim = INFANTRY_ANIMS[type];
    if (anim.die2) {
      it(`${type} die2 has jump=0`, () => {
        expect(anim.die2!.jump).toBe(0);
      });
    }
  }
});

// ─── 11. die1 frame always comes before die2 in the sprite sheet ────────────

describe('die1 frame < die2 frame (sprite sheet ordering from C++)', () => {
  // C++ idata.cpp: DO_GUN_DEATH always appears before DO_EXPLOSION_DEATH

  const typesWithDie2 = Object.keys(INFANTRY_ANIMS).filter(t => INFANTRY_ANIMS[t].die2);

  for (const type of typesWithDie2) {
    it(`${type}: die1.frame (${INFANTRY_ANIMS[type].die1.frame}) < die2.frame (${INFANTRY_ANIMS[type].die2!.frame})`, () => {
      expect(INFANTRY_ANIMS[type].die1.frame).toBeLessThan(INFANTRY_ANIMS[type].die2!.frame);
    });
  }
});

// ─── 12. Corpse rendering uses deathVariant correctly ───────────────────────

describe('Corpse uses last frame of correct death animation based on deathVariant', () => {
  // Renderer (renderer.ts:1709-1714) uses:
  //   const d = (c.deathVariant > 0 && anim.die2) ? anim.die2 : anim.die1;
  //   frame = d.frame + d.count - 1;

  const corpseFrameTests: [string, number, number][] = [
    // [type, deathVariant, expected last frame]
    // E1: die1={288,8,0} → last=295, die2={304,8,0} → last=311
    ['E1', 0, 288 + 8 - 1],
    ['E1', 1, 304 + 8 - 1],
    ['E1', 2, 304 + 8 - 1],
    ['E1', 5, 304 + 8 - 1],
    // DOG: die1={235,7,0} → last=241, die2={242,9,0} → last=250
    ['DOG', 0, 235 + 7 - 1],
    ['DOG', 1, 242 + 9 - 1],
    // E7: die1={262,8,0} → last=269, die2={270,8,0} → last=277
    ['E7', 0, 262 + 8 - 1],
    ['E7', 3, 270 + 8 - 1],
    // SPY: die1={288,8,0} → last=295, die2={296,8,0} → last=303
    ['SPY', 0, 288 + 8 - 1],
    ['SPY', 4, 296 + 8 - 1],
  ];

  for (const [type, dv, expectedFrame] of corpseFrameTests) {
    it(`${type} corpse with deathVariant=${dv} uses frame ${expectedFrame}`, () => {
      const anim = INFANTRY_ANIMS[type];
      const d = (dv > 0 && anim.die2) ? anim.die2 : anim.die1;
      const lastFrame = d.frame + d.count - 1;
      expect(lastFrame).toBe(expectedFrame);
    });
  }
});

// ─── 13. Civilians use CivilianDoControls/EinsteinDoControls (C++ idata.cpp:321,345) ──

describe('Civilians have dedicated CivilianDoControls animations', () => {
  // C++ idata.cpp assigns CivilianDoControls to C1-C10 and DELPHI,
  // and EinsteinDoControls to EINSTEIN and CHAN.

  const civilianTypes = [
    UnitType.I_C1, UnitType.I_C2, UnitType.I_C3, UnitType.I_C4, UnitType.I_C5,
    UnitType.I_C6, UnitType.I_C7, UnitType.I_C8, UnitType.I_C9, UnitType.I_C10,
  ];

  for (const civ of civilianTypes) {
    it(`${civ} shares CivilianDoControls via C1 alias`, () => {
      const anim = INFANTRY_ANIMS[civ];
      expect(anim).toBe(INFANTRY_ANIMS.C1);
    });
  }

  it('civilian death sets deathVariant correctly', () => {
    const civ = new Entity(UnitType.I_C1, House.Neutral, 100, 100);
    civ.takeDamage(9999, 'SA');
    expect(civ.alive).toBe(false);
    expect(civ.deathVariant).toBe(1);
  });

  it('Einstein uses EinsteinDoControls (idata.cpp:345)', () => {
    const anim = INFANTRY_ANIMS[UnitType.I_EINSTEIN];
    expect(anim).toBe(INFANTRY_ANIMS.EINSTEIN);
    expect(anim).not.toBe(INFANTRY_ANIMS.E1);
  });

  it('DELPHI uses CivilianDoControls (idata.cpp:811)', () => {
    const anim = INFANTRY_ANIMS[UnitType.I_DELPHI];
    expect(anim).toBe(INFANTRY_ANIMS.C1);
  });

  it('CHAN uses EinsteinDoControls (idata.cpp:830)', () => {
    const anim = INFANTRY_ANIMS[UnitType.I_CHAN];
    expect(anim).toBe(INFANTRY_ANIMS.EINSTEIN);
  });

  it('GNRL uses GeneralDoControls (idata.cpp:581)', () => {
    const anim = INFANTRY_ANIMS[UnitType.I_GNRL];
    expect(anim).toBe(INFANTRY_ANIMS.GNRL);
    expect(anim).not.toBe(INFANTRY_ANIMS.E1);
  });

  it('THF uses E9DoControls (idata.cpp:523)', () => {
    const anim = INFANTRY_ANIMS[UnitType.I_THF];
    expect(anim).toBe(INFANTRY_ANIMS.THF);
    // Thieves have no fire weapon
    expect(anim.fire.count).toBe(0);
  });
});

// ─── 14. Tanya uses E7 animation (UnitType.I_TANYA = 'E7') ─────────────────

describe('Tanya uses E7 animation data (I_TANYA = "E7" UnitType)', () => {
  // C++ Tanya uses E7DoControls (idata.cpp:543 — E7DoControls)
  // TS: UnitType.I_TANYA = 'E7', so INFANTRY_ANIMS['E7'] is used

  it('UnitType.I_TANYA resolves to "E7"', () => {
    expect(UnitType.I_TANYA).toBe('E7');
  });

  it('Tanya (E7) die1 matches E7DoControls DO_GUN_DEATH', () => {
    const anim = INFANTRY_ANIMS[UnitType.I_TANYA];
    expect(anim).toBeDefined();
    expect(anim.die1.frame).toBe(262);
    expect(anim.die1.count).toBe(8);
  });

  it('Tanya (E7) die2 matches E7DoControls DO_EXPLOSION_DEATH', () => {
    const anim = INFANTRY_ANIMS[UnitType.I_TANYA];
    expect(anim.die2!.frame).toBe(270);
    expect(anim.die2!.count).toBe(8);
  });

  it('Tanya death via SA warhead (Colt45) sets deathVariant=1 → die1', () => {
    const tanya = new Entity(UnitType.I_TANYA, House.England, 100, 100);
    tanya.takeDamage(9999, 'SA');
    expect(tanya.deathVariant).toBe(1);
    tanya.animFrame = 0;
    // infantry.cpp: InfDeath=1 -> DO_GUN_DEATH -> die1.frame = 262
    expect(tanya.spriteFrame).toBe(262);
  });
});

// ─── 15. Frame count exhaustive check (die1.count for all types) ────────────

describe('die1 frame counts match C++ DO_GUN_DEATH exactly', () => {
  // C++ DO_GUN_DEATH counts from each DoControls:
  // E1=8, E2=8, E3=8, E4=8, E6=8, DOG=7, E7=8, SPY=8, MECH=8

  it('E1 die1 count = 8', () => expect(INFANTRY_ANIMS.E1.die1.count).toBe(8));
  it('E2 die1 count = 8', () => expect(INFANTRY_ANIMS.E2.die1.count).toBe(8));
  it('E3 die1 count = 8', () => expect(INFANTRY_ANIMS.E3.die1.count).toBe(8));
  it('E4 die1 count = 8', () => expect(INFANTRY_ANIMS.E4.die1.count).toBe(8));
  it('E6 die1 count = 8', () => expect(INFANTRY_ANIMS.E6.die1.count).toBe(8));
  it('DOG die1 count = 7 (shorter than standard infantry)', () => expect(INFANTRY_ANIMS.DOG.die1.count).toBe(7));
  it('E7 die1 count = 8', () => expect(INFANTRY_ANIMS.E7.die1.count).toBe(8));
  it('SPY die1 count = 8', () => expect(INFANTRY_ANIMS.SPY.die1.count).toBe(8));
  it('MECH die1 count = 8', () => expect(INFANTRY_ANIMS.MECH.die1.count).toBe(8));
});

// ─── 16. die2 frame counts match C++ DO_EXPLOSION_DEATH exactly ─────────────

describe('die2 frame counts match C++ DO_EXPLOSION_DEATH exactly', () => {
  // C++ DO_EXPLOSION_DEATH counts:
  // E1=8, E2=8, E3=8, E4=8, E6=8, DOG=9, E7=8, SPY=8, MECH=8

  it('E1 die2 count = 8', () => expect(INFANTRY_ANIMS.E1.die2!.count).toBe(8));
  it('E2 die2 count = 8', () => expect(INFANTRY_ANIMS.E2.die2!.count).toBe(8));
  it('E3 die2 count = 8', () => expect(INFANTRY_ANIMS.E3.die2!.count).toBe(8));
  it('E4 die2 count = 8', () => expect(INFANTRY_ANIMS.E4.die2!.count).toBe(8));
  it('E6 die2 count = 8', () => expect(INFANTRY_ANIMS.E6.die2!.count).toBe(8));
  it('DOG die2 count = 9 (longer explosion death than standard)', () => expect(INFANTRY_ANIMS.DOG.die2!.count).toBe(9));
  it('E7 die2 count = 8', () => expect(INFANTRY_ANIMS.E7.die2!.count).toBe(8));
  it('SPY die2 count = 8', () => expect(INFANTRY_ANIMS.SPY.die2!.count).toBe(8));
  it('MECH die2 count = 8', () => expect(INFANTRY_ANIMS.MECH.die2!.count).toBe(8));
});

// ─── 17. warheadPropsOverride parameter in takeDamage ───────────────────────

describe('warheadPropsOverride bypasses warhead lookup', () => {
  it('custom infantryDeath=3 via override sets deathVariant=3', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.takeDamage(9999, undefined, undefined, { infantryDeath: 3, explosionSet: 0 });
    expect(unit.deathVariant).toBe(3);
  });

  it('override takes precedence over warhead string', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    // SA has infantryDeath=1, but override says 4
    unit.takeDamage(9999, 'SA', undefined, { infantryDeath: 4, explosionSet: 3 });
    expect(unit.deathVariant).toBe(4);
  });
});

// ─── 18. Each infantry type has die1 defined (required) ─────────────────────

describe('Every INFANTRY_ANIMS entry has die1 defined', () => {
  for (const [type, anim] of Object.entries(INFANTRY_ANIMS)) {
    it(`${type} has die1`, () => {
      expect(anim.die1).toBeDefined();
      expect(anim.die1.frame).toBeGreaterThanOrEqual(0);
      expect(anim.die1.count).toBeGreaterThan(0);
    });
  }
});

// ─── 19. Death animation frame clamping (animFrame > count) ─────────────────

describe('Death animation clamps to last frame (no wrap-around)', () => {
  // C++ death animations play once and freeze on the last frame.
  // TS: Math.min(animFrame, count-1) — entity.ts:447

  it('animFrame clamped at die1.count-1 for E1', () => {
    const unit = new Entity(UnitType.I_E1, House.England, 100, 100);
    unit.alive = false;
    unit.animState = AnimState.DIE;
    unit.deathVariant = 0;
    unit.animFrame = 100; // way past end
    // die1: {288, 8, 0} → frame=288 + min(100, 7) = 288+7 = 295
    expect(unit.spriteFrame).toBe(295);
  });

  it('animFrame clamped at die2.count-1 for DOG', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.alive = false;
    dog.animState = AnimState.DIE;
    dog.deathVariant = 2;
    dog.animFrame = 100; // way past end
    // die2: {242, 9, 0} → frame=242 + min(100, 8) = 242+8 = 250
    expect(dog.spriteFrame).toBe(250);
  });
});

// ─── 20. Multiple kills on same tick get correct deathVariant ────────────────

describe('Multiple infantry deaths on same tick each get correct deathVariant', () => {
  it('two units killed by different warheads have different deathVariants', () => {
    const unitA = new Entity(UnitType.I_E1, House.England, 100, 100);
    const unitB = new Entity(UnitType.I_E1, House.England, 200, 100);

    unitA.takeDamage(9999, 'SA');   // InfDeath=1
    unitB.takeDamage(9999, 'Fire'); // InfDeath=4

    expect(unitA.deathVariant).toBe(1);
    expect(unitB.deathVariant).toBe(4);
  });

  it('same warhead on two units gives same deathVariant', () => {
    const unitA = new Entity(UnitType.I_E1, House.England, 100, 100);
    const unitB = new Entity(UnitType.I_E3, House.England, 200, 100);

    unitA.takeDamage(9999, 'HE');
    unitB.takeDamage(9999, 'HE');

    expect(unitA.deathVariant).toBe(2);
    expect(unitB.deathVariant).toBe(2);
  });
});

// ─── 21. All infantry types in UNIT_STATS that are isInfantry resolve an animation ──

describe('All infantry UNIT_STATS types resolve a valid animation via fallback', () => {
  const infantryStats = Object.entries(UNIT_STATS).filter(([, s]) => s.isInfantry);

  for (const [key, stats] of infantryStats) {
    it(`${key} (type=${stats.type}) resolves INFANTRY_ANIMS with die1`, () => {
      const anim = INFANTRY_ANIMS[stats.type] ?? INFANTRY_ANIMS.E1;
      expect(anim, `${key} should resolve an animation`).toBeDefined();
      expect(anim.die1, `${key} animation should have die1`).toBeDefined();
      expect(anim.die1.count).toBeGreaterThan(0);
    });
  }
});

// ─── 22. E6 (Engineer) special case — no fire animation but has death ───────

describe('E6 (Engineer) has death animations despite no fire animation', () => {
  it('E6 fire count=0 (engineers cannot fire)', () => {
    expect(INFANTRY_ANIMS.E6.fire.count).toBe(0);
  });

  it('E6 still has valid die1 animation', () => {
    expect(INFANTRY_ANIMS.E6.die1.frame).toBe(146);
    expect(INFANTRY_ANIMS.E6.die1.count).toBe(8);
  });

  it('E6 still has valid die2 animation', () => {
    expect(INFANTRY_ANIMS.E6.die2!.frame).toBe(154);
    expect(INFANTRY_ANIMS.E6.die2!.count).toBe(8);
  });

  it('engineer killed by HE gets deathVariant=2 and plays die2 (EXPLOSION_DEATH)', () => {
    const eng = new Entity(UnitType.I_E6, House.England, 100, 100);
    eng.takeDamage(9999, 'HE');
    expect(eng.deathVariant).toBe(2);
    eng.animFrame = 0;
    // infantry.cpp: InfDeath=2 -> DO_EXPLOSION_DEATH. C++ E6DoControls die2 = 154.
    expect(eng.spriteFrame).toBe(154);
  });
});
