/**
 * @vitest-environment jsdom
 *
 * C++ Parity: Random_Animate gate (Phase 7A).
 *
 * Pins the C++ `InfantryClass::Is_Ready_To_Random_Animate` contract against
 * the TS `Entity.isReadyToRandomAnimate()` gate. The TS gate was historically
 * stricter than C++'s because (a) TS lacked a DO_WALK → DO_STAND_READY
 * transition in `doingAI` and (b) the TS `doing` enum collapses DO_STAND_GUARD
 * and DO_STAND_READY into a single `'stand_ready'` value.
 *
 * The C++ gate permits idle animations when ALL of the following hold:
 *   1. TechnoClass::Is_Ready_To_Random_Animate: IdleTimer == 0
 *   2. Height == 0 (not paradropping)
 *   3. !IsDriving
 *   4. !IsProne
 *   5. !IsFiring
 *   6. Doing is DO_STAND_GUARD or DO_STAND_READY (idle stances)
 *
 * ## C++ refs
 *
 *   - `src/EasterEgg/CnC_and_Red_Alert/RA/infantry.cpp:4087-4158`  Is_Ready_To_Random_Animate
 *   - `src/EasterEgg/CnC_and_Red_Alert/RA/techno.cpp:5350-5368`    base class (IdleTimer==0)
 *   - `src/EasterEgg/CnC_and_Red_Alert/RA/infantry.cpp:3698-3760`  Doing_AI (DO_WALK → DO_STAND_READY)
 *   - `src/EasterEgg/CnC_and_Red_Alert/RA/foot.cpp:638-698`        Mission_Guard Random_Animate dispatch
 *
 * ## TS refs
 *
 *   - `src/EasterEgg/engine/entity.ts:283-293`                     isReadyToRandomAnimate gate
 *   - `src/EasterEgg/engine/entity.ts:268-281`                     doingAI transitions
 *   - `src/EasterEgg/engine/perCellProcess.ts` RANDOM_ANIMATE_CPP_FAITHFUL  flip-switch
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House, Mission } from '../engine/types';
import { RANDOM_ANIMATE_CPP_FAITHFUL } from '../engine/perCellProcess';

class FakeAudio {
  src = ''; volume = 1; loop = false; preload = '';
  play(): Promise<void> { return Promise.resolve(); }
  pause(): void {}
  load(): void {}
  addEventListener(_event: string, _cb: () => void): void {}
  removeEventListener(_event: string, _cb: () => void): void {}
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  return canvas;
}

function mkInfantry(type: UnitType = UnitType.I_E1): Entity {
  const e = new Entity(type, House.USSR, 64 * 24 + 12, 64 * 24 + 12);
  e.alive = true;
  return e;
}

beforeEach(() => { resetEntityIds(); });

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { fillRect: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 10 })), createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })), putImageData: vi.fn() } as unknown as CanvasRenderingContext2D
  ));
});

describe('C++ Random_Animate gate (Phase 7A contract)', () => {
  it('blocks when idleAnimTimer > 0 (TechnoClass base gate — IdleTimer)', () => {
    const e = mkInfantry();
    e.doing = 'stand_ready';
    e.idleAnimTimer = 5;
    expect(e.isReadyToRandomAnimate()).toBe(false);
  });

  it('blocks when doing === "walk" (C++ Doing == DO_WALK)', () => {
    const e = mkInfantry();
    e.doing = 'walk';
    e.idleAnimTimer = 0;
    expect(e.isReadyToRandomAnimate()).toBe(false);
  });

  it('blocks when isDriving (C++ IsDriving check)', () => {
    const e = mkInfantry();
    e.doing = 'stand_ready';
    e.isDriving = true;
    expect(e.isReadyToRandomAnimate()).toBe(false);
  });

  it('blocks when isFiringAnim (C++ IsFiring check)', () => {
    const e = mkInfantry();
    e.doing = 'stand_ready';
    e.isFiringAnim = true;
    expect(e.isReadyToRandomAnimate()).toBe(false);
  });

  it('clears the IsFiring gate when DO_FIRE_WEAPON completes', () => {
    // C++ clears IsFiring once the fire StageClass has run out, before the next
    // Mission_Hunt/Mission_Guard Random_Animate gate is evaluated.
    const e = mkInfantry();
    e.doing = 'fire';
    e.doingStage = e.infantryFireDoingCount();
    e.isFiringAnim = true;
    e.firingAnimTicks = 2;
    e.idleAnimTimer = 0;

    e.doingAI();

    expect(e.doing).toBe('stand_ready');
    expect(e.isFiringAnim).toBe(false);
    expect(e.firingAnimTicks).toBe(0);
    expect(e.isReadyToRandomAnimate()).toBe(true);
  });

  it('clears stale IsFiring before InfantryClass::AI Commence pops MissionQueue', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(0, 0, 128, 128);
    const e = mkInfantry(UnitType.I_E3);
    e.mission = Mission.GUARD;
    e.missionQueue = Mission.ATTACK;
    e.missionTimer = 4;
    e.doing = 'stand_ready';
    e.doingStage = 0;
    e.doingRate = 0;
    e.isFiringAnim = true;
    e.firingAnimTicks = 5;
    game.entities.push(e);
    game.entityById.set(e.id, e);

    (game as unknown as { updateEntity(e: Entity): void }).updateEntity(e);

    expect(e.isFiringAnim).toBe(false);
    expect(e.firingAnimTicks).toBe(0);
    expect(e.mission).toBe(Mission.ATTACK);
    expect(e.missionQueue).toBeNull();
    expect(e.missionTimer).toBe(0);
  });

  it('allows when doing === "stand_ready" and all other gates clear', () => {
    const e = mkInfantry();
    e.doing = 'stand_ready';
    e.idleAnimTimer = 0;
    e.isDriving = false;
    e.isFiringAnim = false;
    expect(e.isReadyToRandomAnimate()).toBe(true);
  });

  it('reads IdleTimer before decrementing it for this object AI tick', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(0, 0, 32, 32);
    const e = new Entity(UnitType.I_E1, House.USSR, 10 * 64 + 32, 10 * 64 + 32);
    e.mission = Mission.GUARD;
    e.missionTimer = 0;
    e.idleAnimTimer = 1;
    e.doing = 'stand_ready';
    game.entities.push(e);
    game.entityById.set(e.id, e);

    (game as unknown as { updateEntity(e: Entity): void }).updateEntity(e);

    // C++ CDTimerClass::Value() is checked by Random_Animate before Frame++
    // ticks IdleTimer down. A value of 1 must block Random_Animate this tick
    // and become 0 only after object AI completes.
    expect(e.idleAnimTimer).toBe(0);
  });

  it('runs the InfantryClass tail while paradropping, before landing-tick Random_Animate', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(0, 0, 128, 128);
    const e = new Entity(UnitType.I_E2, House.USSR, 37 * 64 + 32, 39 * 64 + 32);
    e.mission = Mission.GUARD;
    e.missionTimer = 0;
    e.doing = 'nothing';
    e.fear = Entity.FEAR_ANXIOUS + 12;
    e.isFalling = true;
    e.fallHasAttachedAnim = true;
    e.fallHeightLeptons = 4;
    e.fallRiser = -3;
    e.flightAltitude = 1;
    game.entities.push(e);
    game.entityById.set(e.id, e);

    (game as unknown as { updateEntity(e: Entity): void }).updateEntity(e);

    // C++ MissionClass::AI returns while Height > 0, but InfantryClass::AI
    // still runs Fear_AI and Doing_AI. The infantry must be standing-ready
    // before the later landing tick so Random_Animate can pass its C++ gate.
    expect(e.isFalling).toBe(true);
    expect(e.fallHeightLeptons).toBe(1);
    expect(e.fear).toBe(Entity.FEAR_ANXIOUS + 11);
    expect(e.isProne).toBe(false);
    expect(e.doing).toBe('stand_ready');
    expect(e.missionTimer).toBe(0);

    (game as unknown as { updateEntity(e: Entity): void }).updateEntity(e);

    expect(e.isFalling).toBe(false);
    expect(e.idleAnimTimer).toBeGreaterThan(0);
    expect(e.missionTimer).toBeGreaterThan(0);
    expect(e.isProne).toBe(true);
    expect(e.doing).toBe('lie_down');
  });

  it('blocks non-infantry entirely (Random_Animate is InfantryClass-only)', () => {
    const veh = new Entity(UnitType.V_MCV, House.USSR, 0, 0);
    veh.alive = true;
    expect(veh.isReadyToRandomAnimate()).toBe(false);
  });

  it('phase-7A flag RANDOM_ANIMATE_CPP_FAITHFUL is exported and boolean', () => {
    // Flag scaffolding gates the C++-faithful gate. When OFF the gate remains
    // strict (doing === 'stand_ready'). When ON, the gate becomes C++-faithful
    // (doing != 'walk' && doing != 'idle_anim', mirroring C++'s check that
    // Doing is DO_STAND_GUARD/DO_STAND_READY — post-doingAI auto-transition).
    expect(typeof RANDOM_ANIMATE_CPP_FAITHFUL).toBe('boolean');
  });

  describe('C++ Doing_AI DO_WALK → DO_STAND_READY transition (flag OFF parity hole)', () => {
    // C++ infantry.cpp:3700-3732: when Fetch_Stage() >= DoControls[Doing].Count,
    // Doing_AI transitions DO_WALK → DO_STAND_READY if !IsDriving. TS's doingAI
    // only handles {nothing, idle_anim, fire}; `walk` is sticky once set. This
    // is the parity hole Phase 7A closes.
    it('flag OFF: doing === "walk" persists after isDriving=false (current TS behavior)', () => {
      const e = mkInfantry();
      e.doing = 'walk';
      e.isDriving = false;
      e.doingAI();
      // Flag-OFF path: `walk` is NOT in the transition whitelist.
      if (!RANDOM_ANIMATE_CPP_FAITHFUL) {
        expect(e.doing).toBe('walk');
      }
    });

    it('flag ON: doing === "walk" transitions to "stand_ready" when not driving', () => {
      const e = mkInfantry();
      e.doing = 'walk';
      e.doingStage = e.infantryWalkDoingCount();
      e.isDriving = false;
      e.doingAI();
      if (RANDOM_ANIMATE_CPP_FAITHFUL) {
        expect(e.doing).toBe('stand_ready');
      }
    });
  });
});
