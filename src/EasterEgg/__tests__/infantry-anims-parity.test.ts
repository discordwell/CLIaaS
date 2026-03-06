/**
 * Infantry animation data parity tests — verify all INFANTRY_ANIMS entries
 * match C++ idata.cpp DoControls values for frame, count, jump per anim state.
 */
import { describe, it, expect } from 'vitest';
import { INFANTRY_ANIMS, INFANTRY_SHAPE } from '../engine/types';

// ============================================================
// INFANTRY_SHAPE parity
// ============================================================
describe('INFANTRY_SHAPE parity', () => {
  it('has 8 direction entries', () => {
    expect(INFANTRY_SHAPE).toHaveLength(8);
  });

  it('maps Dir enum order to SHP sprite direction order', () => {
    // Dir: N(0), NE(1), E(2), SE(3), S(4), SW(5), W(6), NW(7)
    // SHP: N(0), NW(1), W(2), SW(3), S(4), SE(5), E(6), NE(7)
    expect(INFANTRY_SHAPE).toEqual([0, 7, 6, 5, 4, 3, 2, 1]);
  });
});

// ============================================================
// INFANTRY_ANIMS parity — all unit types
// ============================================================
describe('INFANTRY_ANIMS parity', () => {
  it('has 11 keys (9 base + 2 aliases)', () => {
    // E1, E2, E3, E4, E6, DOG, E7, SPY, MECH + SHOK(=E7), MEDI(=MECH)
    expect(Object.keys(INFANTRY_ANIMS)).toHaveLength(11);
  });

  // --- E1 (Rifle Infantry) ---
  describe('E1 (Rifle Infantry)', () => {
    const a = INFANTRY_ANIMS.E1;

    it('ready', () => expect(a.ready).toEqual({ frame: 0, count: 1, jump: 1 }));
    it('guard', () => expect(a.guard).toEqual({ frame: 8, count: 1, jump: 1 }));
    it('walk', () => expect(a.walk).toEqual({ frame: 16, count: 6, jump: 6 }));
    it('fire', () => expect(a.fire).toEqual({ frame: 64, count: 8, jump: 8 }));
    it('prone', () => expect(a.prone).toEqual({ frame: 192, count: 1, jump: 8 }));
    it('crawl', () => expect(a.crawl).toEqual({ frame: 144, count: 4, jump: 4 }));
    it('fireProne', () => expect(a.fireProne).toEqual({ frame: 192, count: 6, jump: 8 }));
    it('lieDown', () => expect(a.lieDown).toEqual({ frame: 128, count: 2, jump: 2 }));
    it('getUp', () => expect(a.getUp).toEqual({ frame: 176, count: 2, jump: 2 }));
    it('die1', () => expect(a.die1).toEqual({ frame: 288, count: 8, jump: 0 }));
    it('die2', () => expect(a.die2).toEqual({ frame: 304, count: 8, jump: 0 }));
    it('idle', () => expect(a.idle).toEqual({ frame: 256, count: 16, jump: 0 }));
    it('idle2', () => expect(a.idle2).toEqual({ frame: 272, count: 16, jump: 0 }));
    it('no attackRate override', () => expect(a.attackRate).toBeUndefined());
  });

  // --- E2 (Grenadier) ---
  describe('E2 (Grenadier)', () => {
    const a = INFANTRY_ANIMS.E2;

    it('ready', () => expect(a.ready).toEqual({ frame: 0, count: 1, jump: 1 }));
    it('guard', () => expect(a.guard).toEqual({ frame: 8, count: 1, jump: 1 }));
    it('walk', () => expect(a.walk).toEqual({ frame: 16, count: 6, jump: 6 }));
    it('fire', () => expect(a.fire).toEqual({ frame: 64, count: 20, jump: 20 }));
    it('prone', () => expect(a.prone).toEqual({ frame: 288, count: 1, jump: 12 }));
    it('crawl', () => expect(a.crawl).toEqual({ frame: 240, count: 4, jump: 4 }));
    it('fireProne', () => expect(a.fireProne).toEqual({ frame: 288, count: 8, jump: 12 }));
    it('lieDown', () => expect(a.lieDown).toEqual({ frame: 224, count: 2, jump: 2 }));
    it('getUp', () => expect(a.getUp).toEqual({ frame: 272, count: 2, jump: 2 }));
    it('die1', () => expect(a.die1).toEqual({ frame: 416, count: 8, jump: 0 }));
    it('die2', () => expect(a.die2).toEqual({ frame: 432, count: 8, jump: 0 }));
    it('idle', () => expect(a.idle).toEqual({ frame: 384, count: 16, jump: 0 }));
    it('idle2', () => expect(a.idle2).toEqual({ frame: 400, count: 16, jump: 0 }));
    it('attackRate = 6', () => expect(a.attackRate).toBe(6));
  });

  // --- E3 (Rocket Soldier) ---
  describe('E3 (Rocket Soldier)', () => {
    const a = INFANTRY_ANIMS.E3;

    it('ready', () => expect(a.ready).toEqual({ frame: 0, count: 1, jump: 1 }));
    it('guard', () => expect(a.guard).toEqual({ frame: 8, count: 1, jump: 1 }));
    it('walk', () => expect(a.walk).toEqual({ frame: 16, count: 6, jump: 6 }));
    it('fire', () => expect(a.fire).toEqual({ frame: 64, count: 8, jump: 8 }));
    it('prone', () => expect(a.prone).toEqual({ frame: 192, count: 1, jump: 10 }));
    it('crawl', () => expect(a.crawl).toEqual({ frame: 144, count: 4, jump: 4 }));
    it('fireProne', () => expect(a.fireProne).toEqual({ frame: 192, count: 10, jump: 10 }));
    it('lieDown', () => expect(a.lieDown).toEqual({ frame: 128, count: 2, jump: 2 }));
    it('getUp', () => expect(a.getUp).toEqual({ frame: 176, count: 2, jump: 2 }));
    it('die1', () => expect(a.die1).toEqual({ frame: 304, count: 8, jump: 0 }));
    it('die2', () => expect(a.die2).toEqual({ frame: 320, count: 8, jump: 0 }));
    it('idle', () => expect(a.idle).toEqual({ frame: 272, count: 16, jump: 0 }));
    it('idle2', () => expect(a.idle2).toEqual({ frame: 288, count: 16, jump: 0 }));
    it('no attackRate override', () => expect(a.attackRate).toBeUndefined());
  });

  // --- E4 (Flamethrower) ---
  describe('E4 (Flamethrower)', () => {
    const a = INFANTRY_ANIMS.E4;

    it('ready', () => expect(a.ready).toEqual({ frame: 0, count: 1, jump: 1 }));
    it('guard', () => expect(a.guard).toEqual({ frame: 8, count: 1, jump: 1 }));
    it('walk', () => expect(a.walk).toEqual({ frame: 16, count: 6, jump: 6 }));
    it('fire', () => expect(a.fire).toEqual({ frame: 64, count: 16, jump: 16 }));
    it('prone', () => expect(a.prone).toEqual({ frame: 256, count: 1, jump: 16 }));
    it('crawl', () => expect(a.crawl).toEqual({ frame: 208, count: 4, jump: 4 }));
    it('fireProne', () => expect(a.fireProne).toEqual({ frame: 256, count: 16, jump: 16 }));
    it('lieDown', () => expect(a.lieDown).toEqual({ frame: 192, count: 2, jump: 2 }));
    it('getUp', () => expect(a.getUp).toEqual({ frame: 240, count: 2, jump: 2 }));
    it('die1', () => expect(a.die1).toEqual({ frame: 416, count: 8, jump: 0 }));
    it('die2', () => expect(a.die2).toEqual({ frame: 432, count: 8, jump: 0 }));
    it('idle', () => expect(a.idle).toEqual({ frame: 384, count: 16, jump: 0 }));
    it('idle2', () => expect(a.idle2).toEqual({ frame: 400, count: 16, jump: 0 }));
    it('attackRate = 4', () => expect(a.attackRate).toBe(4));
  });

  // --- E6 (Engineer) ---
  describe('E6 (Engineer)', () => {
    const a = INFANTRY_ANIMS.E6;

    it('ready', () => expect(a.ready).toEqual({ frame: 0, count: 1, jump: 1 }));
    it('guard', () => expect(a.guard).toEqual({ frame: 8, count: 1, jump: 1 }));
    it('walk', () => expect(a.walk).toEqual({ frame: 16, count: 6, jump: 6 }));
    it('fire (no fire)', () => expect(a.fire).toEqual({ frame: 0, count: 0, jump: 0 }));
    it('prone', () => expect(a.prone).toEqual({ frame: 82, count: 1, jump: 4 }));
    it('crawl', () => expect(a.crawl).toEqual({ frame: 82, count: 4, jump: 4 }));
    it('no fireProne', () => expect(a.fireProne).toBeUndefined());
    it('lieDown', () => expect(a.lieDown).toEqual({ frame: 67, count: 2, jump: 2 }));
    it('getUp', () => expect(a.getUp).toEqual({ frame: 114, count: 2, jump: 2 }));
    it('die1', () => expect(a.die1).toEqual({ frame: 146, count: 8, jump: 0 }));
    it('die2', () => expect(a.die2).toEqual({ frame: 154, count: 8, jump: 0 }));
    it('idle', () => expect(a.idle).toEqual({ frame: 130, count: 16, jump: 0 }));
    it('no idle2', () => expect(a.idle2).toBeUndefined());
  });

  // --- DOG (Attack Dog) ---
  describe('DOG (Attack Dog)', () => {
    const a = INFANTRY_ANIMS.DOG;

    it('ready', () => expect(a.ready).toEqual({ frame: 0, count: 1, jump: 1 }));
    it('no guard', () => expect(a.guard).toBeUndefined());
    it('walk', () => expect(a.walk).toEqual({ frame: 8, count: 6, jump: 6 }));
    it('fire', () => expect(a.fire).toEqual({ frame: 104, count: 14, jump: 14 }));
    it('no prone', () => expect(a.prone).toBeUndefined());
    it('crawl', () => expect(a.crawl).toEqual({ frame: 56, count: 6, jump: 6 }));
    it('no fireProne', () => expect(a.fireProne).toBeUndefined());
    it('no lieDown', () => expect(a.lieDown).toBeUndefined());
    it('no getUp', () => expect(a.getUp).toBeUndefined());
    it('die1', () => expect(a.die1).toEqual({ frame: 235, count: 7, jump: 0 }));
    it('die2', () => expect(a.die2).toEqual({ frame: 242, count: 9, jump: 0 }));
    it('idle', () => expect(a.idle).toEqual({ frame: 216, count: 18, jump: 0 }));
    it('no idle2', () => expect(a.idle2).toBeUndefined());
    it('walkRate = 2', () => expect(a.walkRate).toBe(2));
  });

  // --- E7 (Shock Trooper / Tanya) ---
  describe('E7 (Shock Trooper)', () => {
    const a = INFANTRY_ANIMS.E7;

    it('ready', () => expect(a.ready).toEqual({ frame: 0, count: 1, jump: 1 }));
    it('no guard', () => expect(a.guard).toBeUndefined());
    it('walk', () => expect(a.walk).toEqual({ frame: 8, count: 6, jump: 6 }));
    it('fire', () => expect(a.fire).toEqual({ frame: 56, count: 7, jump: 7 }));
    it('prone', () => expect(a.prone).toEqual({ frame: 128, count: 1, jump: 4 }));
    it('crawl', () => expect(a.crawl).toEqual({ frame: 128, count: 4, jump: 4 }));
    it('fireProne', () => expect(a.fireProne).toEqual({ frame: 176, count: 7, jump: 7 }));
    it('lieDown', () => expect(a.lieDown).toEqual({ frame: 113, count: 2, jump: 2 }));
    it('getUp', () => expect(a.getUp).toEqual({ frame: 161, count: 2, jump: 2 }));
    it('die1', () => expect(a.die1).toEqual({ frame: 262, count: 8, jump: 0 }));
    it('die2', () => expect(a.die2).toEqual({ frame: 270, count: 8, jump: 0 }));
    it('idle', () => expect(a.idle).toEqual({ frame: 232, count: 17, jump: 0 }));
    it('idle2', () => expect(a.idle2).toEqual({ frame: 249, count: 13, jump: 0 }));
  });

  // --- SPY ---
  describe('SPY', () => {
    const a = INFANTRY_ANIMS.SPY;

    it('ready', () => expect(a.ready).toEqual({ frame: 0, count: 1, jump: 1 }));
    it('guard', () => expect(a.guard).toEqual({ frame: 8, count: 1, jump: 1 }));
    it('walk', () => expect(a.walk).toEqual({ frame: 16, count: 6, jump: 6 }));
    it('fire', () => expect(a.fire).toEqual({ frame: 64, count: 8, jump: 8 }));
    it('prone', () => expect(a.prone).toEqual({ frame: 144, count: 1, jump: 4 }));
    it('crawl', () => expect(a.crawl).toEqual({ frame: 144, count: 4, jump: 4 }));
    it('fireProne', () => expect(a.fireProne).toEqual({ frame: 192, count: 8, jump: 8 }));
    it('lieDown', () => expect(a.lieDown).toEqual({ frame: 128, count: 2, jump: 2 }));
    it('getUp', () => expect(a.getUp).toEqual({ frame: 176, count: 2, jump: 2 }));
    it('die1', () => expect(a.die1).toEqual({ frame: 288, count: 8, jump: 0 }));
    it('die2', () => expect(a.die2).toEqual({ frame: 296, count: 8, jump: 0 }));
    it('idle', () => expect(a.idle).toEqual({ frame: 256, count: 14, jump: 0 }));
    it('idle2', () => expect(a.idle2).toEqual({ frame: 270, count: 18, jump: 0 }));
  });

  // --- MECH (Mechanic) ---
  describe('MECH (Mechanic)', () => {
    const a = INFANTRY_ANIMS.MECH;

    it('ready', () => expect(a.ready).toEqual({ frame: 0, count: 1, jump: 1 }));
    it('no guard', () => expect(a.guard).toBeUndefined());
    it('walk', () => expect(a.walk).toEqual({ frame: 8, count: 6, jump: 6 }));
    it('fire (heal)', () => expect(a.fire).toEqual({ frame: 56, count: 28, jump: 0 }));
    it('prone', () => expect(a.prone).toEqual({ frame: 130, count: 1, jump: 4 }));
    it('crawl', () => expect(a.crawl).toEqual({ frame: 130, count: 4, jump: 4 }));
    it('no fireProne', () => expect(a.fireProne).toBeUndefined());
    it('lieDown', () => expect(a.lieDown).toEqual({ frame: 114, count: 2, jump: 2 }));
    it('getUp', () => expect(a.getUp).toEqual({ frame: 162, count: 2, jump: 2 }));
    it('die1', () => expect(a.die1).toEqual({ frame: 193, count: 8, jump: 0 }));
    it('die2', () => expect(a.die2).toEqual({ frame: 210, count: 8, jump: 0 }));
    it('idle', () => expect(a.idle).toEqual({ frame: 178, count: 15, jump: 0 }));
    it('no idle2', () => expect(a.idle2).toBeUndefined());
  });

  // --- Aliases ---
  describe('aliases', () => {
    it('SHOK is same reference as E7', () => {
      expect(INFANTRY_ANIMS.SHOK).toBe(INFANTRY_ANIMS.E7);
    });

    it('MEDI is same reference as MECH', () => {
      expect(INFANTRY_ANIMS.MEDI).toBe(INFANTRY_ANIMS.MECH);
    });
  });

  // --- Completeness ---
  it('every key in INFANTRY_ANIMS is tested', () => {
    const expected = ['E1', 'E2', 'E3', 'E4', 'E6', 'DOG', 'E7', 'SPY', 'MECH', 'SHOK', 'MEDI'];
    expect(Object.keys(INFANTRY_ANIMS).sort()).toEqual(expected.sort());
  });
});
