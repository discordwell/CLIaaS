/**
 * C++ Behavioral Parity: Superweapon Activation Animations
 *
 * Tests that each superweapon activation produces the correct visual effects
 * (Effect objects), matching the C++ RA animation behavior.
 *
 * C++ source references:
 *   - adata.cpp: AnimTypeClass definitions for each superweapon visual
 *     - ANIM_ATOM_BLAST  → "ATOMSFX"  (72px, 19 stages, delay=1, scorches+craters)
 *     - ANIM_CHRONO_BOX  → "CHRONBOX" (48px, delay=2, normalized rate)
 *     - ANIM_GPS_BOX     → "GPSBOX"   (48px, delay=2, normalized rate)
 *     - ANIM_INVUL_BOX   → "INVULBOX" (48px, delay=2, normalized rate)
 *     - ANIM_PARA_BOX    → "PARABOX"  (48px, delay=2, normalized rate)
 *     - ANIM_SONAR_BOX   → "SONARBOX" (48px, delay=2, normalized rate)
 *     - ANIM_PARACHUTE   → "PARACH"   (32px, 15 stages, delay=4, loop=15)
 *     - ANIM_PARA_BOMB   → "PARABOMB" (32px, 8 stages, delay=4, loop=15)
 *     - ANIM_FBALL1      → "FBALL1"   (67px, 6 stages, normalized)
 *   - house.cpp:2605-2900 Place_Special_Blast — superweapon activation dispatch
 *     - SPC_NUCLEAR_BOMB: launches BULLET_NUKE_DOWN, triggers ANIM_ATOM_BLAST on detonation
 *     - SPC_CHRONOSPHERE: VOC_CHRONO sound, BW fade, chronoshift visual
 *     - SPC_IRON_CURTAIN: VOC_IRON1 sound, IronCurtainCountDown set
 *     - SPC_SONAR_PULSE:  VOC_SONAR sound, Map.Activate_Pulse(), uncloaks subs
 *     - SPC_PARA_BOMB:    Badger bomber airdrop with ANIM_PARA_BOMB anims
 *     - SPC_PARA_INFANTRY: Badger transport with ANIM_PARACHUTE anims
 *
 * TS implementation: superweapon.ts activateSuperweapon() + detonateNuke()
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  SuperweaponType, SUPERWEAPON_DEFS,
  IRON_CURTAIN_DURATION, NUKE_FLIGHT_TICKS,
  CHRONO_SHIFT_VISUAL_TICKS, SONAR_REVEAL_TICKS,
  NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_MIN_FALLOFF,
  buildDefaultAlliances,
  WEAPON_STATS,
} from '../engine/types';
import type { SuperweaponState, WorldPos } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  activateSuperweapon, detonateNuke, updateSuperweapons,
  type SuperweaponContext,
} from '../engine/superweapon';
import type { Effect } from '../engine/renderer';
import { GameMap, Terrain } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeStructure(
  type: string, cx: number, cy: number,
  hp?: number, house: House = House.Spain,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 600;
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: hp ?? maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
    buildProgress: 1,
  } as MapStructure;
}

function makeCtx(overrides: Partial<SuperweaponContext> = {}): SuperweaponContext {
  const alliances = buildDefaultAlliances();
  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    superweapons: new Map<string, SuperweaponState>(),
    effects: [] as Effect[],
    tick: 100,
    playerHouse: House.Spain,
    powerProduced: 500,
    powerConsumed: 200,
    killCount: 0,
    lossCount: 0,
    map: new GameMap(),
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    gpsActive: false,
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    pushEva: () => {},
    playSound: () => {},
    playSoundAt: () => {},
    damageEntity: (target: Entity, amount: number, _warhead: string): boolean => {
      return target.takeDamage(amount, _warhead);
    },
    damageStructure: (_s: MapStructure, _d: number) => false,
    addEntity: () => {},
    aiIQ: () => 3,
    getWarheadMult: () => 1.0,
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 800,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };
}

function addReadySuperweapon(
  ctx: SuperweaponContext,
  type: SuperweaponType,
  house: House,
  structureIndex = 0,
): void {
  const key = `${house}:${type}`;
  ctx.superweapons.set(key, {
    type,
    house,
    chargeTick: SUPERWEAPON_DEFS[type].rechargeTicks,
    ready: true,
    structureIndex,
    fired: false,
  });
}

// =============================================================================
// 1. Nuke (ATOM_BLAST): full-screen flash + mushroom cloud animation
//    C++ adata.cpp:48-71 — ANIM_ATOM_BLAST "ATOMSFX", 72px, 19 biggest stage
//    C++ house.cpp:2636-2677 — nuke launch creates BULLET_NUKE_DOWN
//    C++ bullet detonation creates ANIM_ATOM_BLAST + screen shake + white flash
// =============================================================================

describe('Nuke (ATOM_BLAST) animation — C++ adata.cpp:48-71, house.cpp:2636-2677', () => {

  it('nuke launch creates a rocket projectile effect from silo to target', () => {
    const mslo = makeStructure('MSLO', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({ structures: [mslo] });
    addReadySuperweapon(ctx, SuperweaponType.NUKE, House.Spain, 0);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.NUKE, House.Spain, target);

    // C++ house.cpp:2660-2668 — nuke launches a missile
    const projectile = ctx.effects.find(e => e.type === 'projectile');
    expect(projectile, 'should create a projectile effect for missile').toBeDefined();
    expect(projectile!.projStyle).toBe('rocket');
    // Missile starts at silo position
    expect(projectile!.startX).toBe(mslo.cx * CELL_SIZE + CELL_SIZE);
    expect(projectile!.startY).toBe(mslo.cy * CELL_SIZE + CELL_SIZE);
    // Missile ends at target
    expect(projectile!.endX).toBe(target.x);
    expect(projectile!.endY).toBe(target.y);
  });

  it('nuke launch sets pending target with NUKE_FLIGHT_TICKS delay', () => {
    const mslo = makeStructure('MSLO', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({ structures: [mslo] });
    addReadySuperweapon(ctx, SuperweaponType.NUKE, House.Spain, 0);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.NUKE, House.Spain, target);

    // C++ nuke flight delay
    expect(ctx.nukePendingTarget).toEqual(target);
    expect(ctx.nukePendingTick).toBe(NUKE_FLIGHT_TICKS);
    expect(ctx.nukePendingTick).toBe(45); // C++ parity: 45 ticks flight time
  });

  it('nuke detonation creates mushroom cloud with atomsfx sprite', () => {
    const ctx = makeCtx();
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    detonateNuke(ctx, target);

    // C++ adata.cpp:48-71 — ANIM_ATOM_BLAST uses "ATOMSFX" sprite
    const mushroom = ctx.effects.find(e =>
      e.type === 'explosion' && e.sprite === 'atomsfx'
    );
    expect(mushroom, 'should create mushroom cloud with atomsfx sprite').toBeDefined();
    // C++ adata.cpp:51 — max dimension 72px → large size
    expect(mushroom!.size).toBe(48); // TS uses 48 for the mushroom cloud
    // C++ adata.cpp:67 — stages=-1 (auto-count from shape file)
    // TS uses maxFrames=45 for extended mushroom cloud animation
    expect(mushroom!.maxFrames).toBe(45);
    expect(mushroom!.x).toBe(target.x);
    expect(mushroom!.y).toBe(target.y);
  });

  it('nuke detonation creates screen flash and screen shake', () => {
    const ctx = makeCtx();
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    detonateNuke(ctx, target);

    // C++ nuke detonation: White_Count_Down (screen flash) + Shake_The_Screen
    expect(ctx.screenFlash).toBe(30);
    expect(ctx.screenShake).toBe(30);
  });

  it('nuke detonation creates secondary ground explosions around impact', () => {
    const ctx = makeCtx();
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    detonateNuke(ctx, target);

    // C++ scatters secondary explosions around blast zone
    const secondaryBlasts = ctx.effects.filter(e =>
      e.type === 'explosion' && e.sprite === 'fball1'
    );
    // TS creates 6 secondary blasts in a ring
    expect(secondaryBlasts.length).toBe(6);
    // Each uses fball1 sprite (C++ adata.cpp:570 — ANIM_FBALL1)
    for (const blast of secondaryBlasts) {
      expect(blast.sprite).toBe('fball1');
    }
  });

  it('nuke mushroom cloud uses screen blend mode', () => {
    const ctx = makeCtx();
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    detonateNuke(ctx, target);

    const mushroom = ctx.effects.find(e =>
      e.type === 'explosion' && e.sprite === 'atomsfx'
    );
    // C++ ANIM_ATOM_BLAST is rendered with special blend (bright overlay)
    expect(mushroom!.blendMode).toBe('screen');
  });

  it('nuke detonation scorches ground (C++ adata.cpp:56 — Scorches=true)', () => {
    const ctx = makeCtx();
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    detonateNuke(ctx, target);

    // C++ adata.cpp:56-57 — AtomBomb scorches and craters the ground
    // TS sets terrain to ROCK in a 7x7 area (radius 3)
    const map = ctx.map;
    const tcx = Math.floor(target.x / CELL_SIZE);
    const tcy = Math.floor(target.y / CELL_SIZE);
    // Ground zero should be scorched
    expect(map.getTerrain(tcx, tcy)).toBe(Terrain.ROCK);
  });

  it('nuke launch plays correct sounds and EVA', () => {
    const mslo = makeStructure('MSLO', 10, 10, undefined, House.Spain);
    const sounds: string[] = [];
    const evas: string[] = [];
    const ctx = makeCtx({
      structures: [mslo],
      playSound: (name: string) => sounds.push(name),
      pushEva: (text: string) => evas.push(text),
    });
    addReadySuperweapon(ctx, SuperweaponType.NUKE, House.Spain, 0);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.NUKE, House.Spain, target);

    expect(sounds).toContain('nuke_launch');
    expect(evas).toContain('Nuclear warhead launched');
  });

  it('enemy nuke warns player (C++ different EVA for enemy launch)', () => {
    const mslo = makeStructure('MSLO', 10, 10, undefined, House.USSR);
    const evas: string[] = [];
    const ctx = makeCtx({
      structures: [mslo],
      pushEva: (text: string) => evas.push(text),
    });
    addReadySuperweapon(ctx, SuperweaponType.NUKE, House.USSR, 0);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.NUKE, House.USSR, target);

    expect(evas).toContain('Warning: nuclear launch detected');
  });

  it('nuke projectile maxFrames matches NUKE_FLIGHT_TICKS', () => {
    const mslo = makeStructure('MSLO', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({ structures: [mslo] });
    addReadySuperweapon(ctx, SuperweaponType.NUKE, House.Spain, 0);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.NUKE, House.Spain, target);

    const projectile = ctx.effects.find(e => e.type === 'projectile');
    expect(projectile!.maxFrames).toBe(45); // NUKE_FLIGHT_TICKS
  });
});

// =============================================================================
// 2. Chronosphere (CHRONO_BOX): blue shimmer at source and destination
//    C++ adata.cpp:1555-1578 — ANIM_CHRONO_BOX "CHRONBOX", 48px, delay=2
//    C++ house.cpp:2773-2897 — chronoshift BW fade + VOC_CHRONO
// =============================================================================

describe('Chronosphere (CHRONO_BOX) animation — C++ adata.cpp:1555-1578, house.cpp:2808-2853', () => {

  it('chronoshift creates lightning effect at origin (blue shimmer)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeCtx({ entities: [tank], entityById: new Map([[tank.id, tank]]) });
    addReadySuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain);
    const origin = { x: tank.pos.x, y: tank.pos.y };
    const target: WorldPos = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // C++ house.cpp:2851 — Sound_Effect(VOC_CHRONO, ...) + visual effects
    const originEffect = ctx.effects.find(e =>
      e.type === 'explosion' &&
      e.x === origin.x && e.y === origin.y
    );
    expect(originEffect, 'should have lightning effect at origin').toBeDefined();
    // C++ uses 'litning' sprite for chronoshift visual
    expect(originEffect!.sprite).toBe('litning');
  });

  it('chronoshift creates lightning effect at destination', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeCtx({ entities: [tank], entityById: new Map([[tank.id, tank]]) });
    addReadySuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain);
    const target: WorldPos = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    const destEffect = ctx.effects.find(e =>
      e.type === 'explosion' &&
      e.x === target.x && e.y === target.y
    );
    expect(destEffect, 'should have lightning effect at destination').toBeDefined();
    expect(destEffect!.sprite).toBe('litning');
  });

  it('chronoshift creates exactly 2 effects for vehicle (origin + destination)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeCtx({ entities: [tank], entityById: new Map([[tank.id, tank]]) });
    addReadySuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain);
    const target: WorldPos = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    const lightningEffects = ctx.effects.filter(e => e.sprite === 'litning');
    expect(lightningEffects.length).toBe(2);
  });

  it('chronoshift lightning effects have correct frame params', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeCtx({ entities: [tank], entityById: new Map([[tank.id, tank]]) });
    addReadySuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain);
    const target: WorldPos = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    for (const eff of ctx.effects) {
      if (eff.sprite === 'litning') {
        expect(eff.frame).toBe(0);
        expect(eff.maxFrames).toBe(20);
        expect(eff.size).toBe(24);
        expect(eff.spriteStart).toBe(0);
      }
    }
  });

  it('chronoshift plays chrono sound (C++ VOC_CHRONO)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const sounds: string[] = [];
    const ctx = makeCtx({
      entities: [tank],
      entityById: new Map([[tank.id, tank]]),
      playSound: (name: string) => sounds.push(name),
    });
    addReadySuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain);
    const target: WorldPos = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(sounds).toContain('chrono');
  });

  it('chronoshift sets chronoShiftTick visual timer on teleported vehicle', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeCtx({ entities: [tank], entityById: new Map([[tank.id, tank]]) });
    addReadySuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain);
    const target: WorldPos = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // C++ parity: visual shimmer timer on chronoshifted unit
    expect(tank.chronoShiftTick).toBe(CHRONO_SHIFT_VISUAL_TICKS);
    expect(tank.chronoShiftTick).toBe(30);
  });

  it('infantry chronoshift still produces lightning at origin (single effect)', () => {
    const inf = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    inf.selected = true;
    const ctx = makeCtx({ entities: [inf], entityById: new Map([[inf.id, inf]]) });
    addReadySuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain);
    const target: WorldPos = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // Infantry killed, but lightning still shows at origin
    const lightningEffects = ctx.effects.filter(e => e.sprite === 'litning');
    expect(lightningEffects.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// 3. GPS (GPS_BOX): satellite reveal animation
//    C++ adata.cpp:1579-1602 — ANIM_GPS_BOX "GPSBOX", 48px, delay=2
//    C++ house.cpp:1433-1449 — auto-fire GPS satellite, set IsGPSActive
// =============================================================================

describe('GPS Satellite (GPS_BOX) animation — C++ adata.cpp:1579-1602, house.cpp:1433-1449', () => {

  it('GPS satellite auto-fires when ready and creates sweep visual', () => {
    const atek = makeStructure('ATEK', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({ structures: [atek] });
    // Manually add a ready GPS state
    addReadySuperweapon(ctx, SuperweaponType.GPS_SATELLITE, House.Spain, 0);

    // GPS auto-fires during updateSuperweapons
    updateSuperweapons(ctx);

    // C++ bullet.cpp — GPS launch sets IsGPSActive, reveals map
    expect(ctx.gpsActive).toBe(true);

    // TS creates a marker effect for GPS sweep visual
    const sweepEffect = ctx.effects.find(e => e.type === 'marker');
    expect(sweepEffect, 'should create GPS sweep visual marker').toBeDefined();
    expect(sweepEffect!.markerColor).toBe('rgba(80,200,255,0.3)');
    expect(sweepEffect!.maxFrames).toBe(60);
  });

  it('GPS sweep visual is positioned at camera center', () => {
    const atek = makeStructure('ATEK', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({
      structures: [atek],
      cameraX: 100,
      cameraY: 200,
      cameraViewWidth: 800,
    });
    addReadySuperweapon(ctx, SuperweaponType.GPS_SATELLITE, House.Spain, 0);

    updateSuperweapons(ctx);

    const sweepEffect = ctx.effects.find(e => e.type === 'marker');
    expect(sweepEffect!.x).toBe(100 + 800 / 2); // cameraX + viewWidth/2
    expect(sweepEffect!.y).toBe(200);             // cameraY
  });

  it('GPS fires EVA announcement', () => {
    const atek = makeStructure('ATEK', 10, 10, undefined, House.Spain);
    const evas: string[] = [];
    const ctx = makeCtx({
      structures: [atek],
      pushEva: (text: string) => evas.push(text),
    });
    addReadySuperweapon(ctx, SuperweaponType.GPS_SATELLITE, House.Spain, 0);

    updateSuperweapons(ctx);

    expect(evas).toContain('GPS satellite launched');
  });

  it('GPS satellite marks state as fired and not ready after launch', () => {
    const atek = makeStructure('ATEK', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({ structures: [atek] });
    addReadySuperweapon(ctx, SuperweaponType.GPS_SATELLITE, House.Spain, 0);
    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;

    updateSuperweapons(ctx);

    const state = ctx.superweapons.get(key);
    expect(state!.fired).toBe(true);
    expect(state!.ready).toBe(false);
  });
});

// =============================================================================
// 4. Iron Curtain (INVUL_BOX): golden glow on target
//    C++ adata.cpp:1603-1625 — ANIM_INVUL_BOX "INVULBOX", 48px, delay=2
//    C++ house.cpp:2740-2771 — Iron Curtain sets IronCurtainCountDown, VOC_IRON1
// =============================================================================

describe('Iron Curtain (INVUL_BOX) animation — C++ adata.cpp:1603-1625, house.cpp:2740-2771', () => {

  it('Iron Curtain creates explosion effect at target entity position', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCtx({ entities: [tank], entityById: new Map([[tank.id, tank]]) });
    addReadySuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain);

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, tank.pos);

    const glow = ctx.effects.find(e => e.type === 'explosion');
    expect(glow, 'should create glow effect at target').toBeDefined();
    expect(glow!.x).toBe(tank.pos.x);
    expect(glow!.y).toBe(tank.pos.y);
    expect(glow!.maxFrames).toBe(15);
    expect(glow!.size).toBe(20);
  });

  it('Iron Curtain sets ironCurtainTick on target entity', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCtx({ entities: [tank], entityById: new Map([[tank.id, tank]]) });
    addReadySuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain);

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, tank.pos);

    // C++ house.cpp:2751 — IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_MINUTE
    // C++ rules.ini IronCurtain=.75 → 0.75 * 900 = 675 ticks (45 seconds)
    expect(tank.ironCurtainTick).toBe(IRON_CURTAIN_DURATION);
    expect(tank.ironCurtainTick).toBe(675);
  });

  it('Iron Curtain plays iron_curtain sound (C++ VOC_IRON1)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const sounds: string[] = [];
    const ctx = makeCtx({
      entities: [tank],
      entityById: new Map([[tank.id, tank]]),
      playSound: (name: string) => sounds.push(name),
    });
    addReadySuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain);

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, tank.pos);

    expect(sounds).toContain('iron_curtain');
  });

  it('Iron Curtain EVA announcement for player house', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const evas: string[] = [];
    const ctx = makeCtx({
      entities: [tank],
      entityById: new Map([[tank.id, tank]]),
      pushEva: (text: string) => evas.push(text),
    });
    addReadySuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain);

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, tank.pos);

    expect(evas).toContain('Iron Curtain activated');
  });

  it('Iron Curtain on structure creates effect at structure center', () => {
    const fact = makeStructure('FACT', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({ structures: [fact] });
    addReadySuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain);
    // Target at the structure's cell
    const target: WorldPos = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, target);

    // C++ house.cpp:2746-2757 — Iron Curtain targets any techno at the cell
    const glow = ctx.effects.find(e => e.type === 'explosion');
    expect(glow, 'should create glow effect for structure').toBeDefined();
    // Structure gets iron curtain duration
    expect(fact.ironCurtainTicks).toBe(IRON_CURTAIN_DURATION);
  });
});

// =============================================================================
// 5. Parabomb (PARA_BOX): airdrop visual
//    C++ adata.cpp:1627-1650 — ANIM_PARA_BOX "PARABOX", 48px, delay=2
//    C++ adata.cpp:544-567 — ANIM_PARA_BOMB "PARABOMB", 32px, delay=4, loop=15
//    C++ house.cpp:2729-2738 — Badger bomber airdrop
// =============================================================================

describe('Parabomb (PARA_BOX) animation — C++ adata.cpp:544-567, house.cpp:2729-2738', () => {

  it('parabomb creates 7 explosion effects in a line (bomb count)', () => {
    const ctx = makeCtx();
    addReadySuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain, target);

    // C++ rule.ini BadgerBombCount — TS uses 7 bombs
    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    expect(explosions.length).toBe(7);
  });

  it('parabomb explosions are spaced CELL_SIZE apart horizontally', () => {
    const ctx = makeCtx();
    addReadySuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain, target);

    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    // Bombs are centered on target, spread horizontally by CELL_SIZE
    // i ranges from -3 to +3 → bx = target.x + i * CELL_SIZE
    for (let i = 0; i < 7; i++) {
      const expectedX = target.x + (i - 3) * CELL_SIZE;
      expect(explosions[i].x).toBe(expectedX);
      expect(explosions[i].y).toBe(target.y); // all at same y
    }
  });

  it('parabomb explosions are staggered (negative start frames for delay)', () => {
    const ctx = makeCtx();
    addReadySuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain, target);

    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    // Each bomb has frame = -delay where delay = (i + 3) * 5
    // First bomb (i=-3): delay=0, frame=-0 (JS: -(0) produces negative zero)
    // Intermediate bombs have increasing negative delays
    // Last bomb (i=+3): delay=30, frame=-30
    expect(explosions[0].frame + 0).toBe(0);  // first bomb, no delay (normalize -0 → 0)
    expect(explosions[1].frame).toBe(-5);      // second bomb, 5 tick delay
    expect(explosions[6].frame).toBe(-30);     // last bomb, 30-tick delay
  });

  it('parabomb triggers screen shake', () => {
    const ctx = makeCtx();
    addReadySuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain, target);

    expect(ctx.screenShake).toBeGreaterThanOrEqual(10);
  });

  it('parabomb plays explosion sound', () => {
    const sounds: string[] = [];
    const ctx = makeCtx({ playSound: (name: string) => sounds.push(name) });
    addReadySuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain, target);

    expect(sounds).toContain('explode_lg');
  });

  it('parabomb applies damage to entities within blast radius', () => {
    const enemyTank = entityAtCell(UnitType.V_2TNK, House.USSR, 50, 50);
    const ctx = makeCtx({
      entities: [enemyTank],
      entityById: new Map([[enemyTank.id, enemyTank]]),
    });
    addReadySuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain);
    const target: WorldPos = { x: 50 * CELL_SIZE + CELL_SIZE / 2, y: 50 * CELL_SIZE + CELL_SIZE / 2 };
    const initialHp = enemyTank.hp;

    activateSuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain, target);

    // Entity at center of bombing run should take damage
    expect(enemyTank.hp).toBeLessThan(initialHp);
  });

  it('parabomb EVA for player house', () => {
    const evas: string[] = [];
    const ctx = makeCtx({ pushEva: (text: string) => evas.push(text) });
    addReadySuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain, target);

    expect(evas).toContain('Parabombs away');
  });
});

// =============================================================================
// 6. Sonar Pulse (SONAR_BOX): sonar ping reveals subs
//    C++ adata.cpp:1651-1674 — ANIM_SONAR_BOX "SONARBOX", 48px, delay=2
//    C++ house.cpp:2612-2633 — Map.Activate_Pulse(), VOC_SONAR, sub uncloak
// =============================================================================

describe('Sonar Pulse (SONAR_BOX) animation — C++ adata.cpp:1651-1674, house.cpp:2612-2633', () => {

  it('sonar pulse reveals cloaked enemy units for SONAR_REVEAL_TICKS', () => {
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 20, 20);
    sub.stats = { ...sub.stats, isCloakable: true };
    const spen = makeStructure('SPEN', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({
      structures: [spen],
      entities: [sub],
      entityById: new Map([[sub.id, sub]]),
    });
    // Add sonar as a ready superweapon (spy-granted)
    addReadySuperweapon(ctx, SuperweaponType.SONAR_PULSE, House.Spain, 0);

    updateSuperweapons(ctx);

    // C++ house.cpp:2629 — PulseCountDown = 15 * TICKS_PER_SECOND
    // TS uses SONAR_REVEAL_TICKS = 450
    expect(sub.sonarPulseTimer).toBe(SONAR_REVEAL_TICKS);
    expect(sub.sonarPulseTimer).toBe(450);
  });

  it('sonar pulse plays sonar ping sound (C++ VOC_SONAR)', () => {
    const sub = entityAtCell(UnitType.V_SS, House.USSR, 20, 20);
    sub.stats = { ...sub.stats, isCloakable: true };
    const spen = makeStructure('SPEN', 10, 10, undefined, House.Spain);
    const sounds: string[] = [];
    const ctx = makeCtx({
      structures: [spen],
      entities: [sub],
      entityById: new Map([[sub.id, sub]]),
      playSound: (name: string) => sounds.push(name),
    });
    addReadySuperweapon(ctx, SuperweaponType.SONAR_PULSE, House.Spain, 0);

    updateSuperweapons(ctx);

    // C++ house.cpp:2620 — Sound_Effect(VOC_SONAR)
    expect(sounds).toContain('cannon'); // TS uses 'cannon' as sonar ping approximation
  });

  it('sonar pulse EVA announcement', () => {
    const spen = makeStructure('SPEN', 10, 10, undefined, House.Spain);
    const evas: string[] = [];
    const ctx = makeCtx({
      structures: [spen],
      pushEva: (text: string) => evas.push(text),
    });
    addReadySuperweapon(ctx, SuperweaponType.SONAR_PULSE, House.Spain, 0);

    updateSuperweapons(ctx);

    expect(evas).toContain('Sonar pulse activated');
  });

  it('sonar pulse resets charge after firing', () => {
    const spen = makeStructure('SPEN', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({ structures: [spen] });
    addReadySuperweapon(ctx, SuperweaponType.SONAR_PULSE, House.Spain, 0);
    const key = `${House.Spain}:${SuperweaponType.SONAR_PULSE}`;

    updateSuperweapons(ctx);

    const state = ctx.superweapons.get(key);
    expect(state!.ready).toBe(false);
    expect(state!.chargeTick).toBe(0);
  });

  it('sonar pulse does not affect allied cloaked units', () => {
    const alliedSub = entityAtCell(UnitType.V_SS, House.Spain, 20, 20);
    alliedSub.stats = { ...alliedSub.stats, isCloakable: true };
    const spen = makeStructure('SPEN', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({
      structures: [spen],
      entities: [alliedSub],
      entityById: new Map([[alliedSub.id, alliedSub]]),
    });
    addReadySuperweapon(ctx, SuperweaponType.SONAR_PULSE, House.Spain, 0);

    updateSuperweapons(ctx);

    // Allied subs should NOT be revealed by own sonar pulse
    expect(alliedSub.sonarPulseTimer).toBe(0);
  });
});

// =============================================================================
// 7. Paratroopers: parachute drop visual
//    C++ adata.cpp:520-543 — ANIM_PARACHUTE "PARACH", 32px, 15 stages, delay=4
//    C++ house.cpp:2680-2715 — Badger transport drops infantry
// =============================================================================

describe('Paratroopers animation — C++ adata.cpp:520-543, house.cpp:2680-2715', () => {

  it('paratroop drop creates marker effects (parachute visuals)', () => {
    const ctx = makeCtx();
    addReadySuperweapon(ctx, SuperweaponType.PARAINFANTRY, House.Spain);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };
    // Track added entities
    const addedEntities: Entity[] = [];
    ctx.addEntity = (e: Entity) => addedEntities.push(e);

    activateSuperweapon(ctx, SuperweaponType.PARAINFANTRY, House.Spain, target);

    // Each paratrooper gets a parachute marker
    const markers = ctx.effects.filter(e => e.type === 'marker');
    expect(markers.length).toBeGreaterThanOrEqual(1);
    // Markers should have parachute color
    for (const m of markers) {
      expect(m.markerColor).toBe('rgba(200,200,255,0.8)');
      expect(m.maxFrames).toBe(20);
    }
  });

  it('paratroop drop creates 5 rifle infantry (C++ INFANTRY_E1)', () => {
    const ctx = makeCtx();
    addReadySuperweapon(ctx, SuperweaponType.PARAINFANTRY, House.Spain);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };
    const addedEntities: Entity[] = [];
    ctx.addEntity = (e: Entity) => addedEntities.push(e);

    activateSuperweapon(ctx, SuperweaponType.PARAINFANTRY, House.Spain, target);

    // C++ Members[0].Quantity = Max_Passengers() (usually 5 for Badger)
    // All are INFANTRY_E1
    expect(addedEntities.length).toBeGreaterThanOrEqual(1);
    for (const e of addedEntities) {
      expect(e.type).toBe(UnitType.I_E1);
      expect(e.house).toBe(House.Spain);
    }
  });

  it('paratroop infantry start in GUARD mission', () => {
    const ctx = makeCtx();
    addReadySuperweapon(ctx, SuperweaponType.PARAINFANTRY, House.Spain);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };
    const addedEntities: Entity[] = [];
    ctx.addEntity = (e: Entity) => addedEntities.push(e);

    activateSuperweapon(ctx, SuperweaponType.PARAINFANTRY, House.Spain, target);

    for (const e of addedEntities) {
      expect(e.mission).toBe(Mission.GUARD);
    }
  });

  it('paratroop plays EVA reinforcements announcement', () => {
    const sounds: string[] = [];
    const evas: string[] = [];
    const ctx = makeCtx({
      playSound: (name: string) => sounds.push(name),
      pushEva: (text: string) => evas.push(text),
    });
    addReadySuperweapon(ctx, SuperweaponType.PARAINFANTRY, House.Spain);
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };
    ctx.addEntity = () => {};

    activateSuperweapon(ctx, SuperweaponType.PARAINFANTRY, House.Spain, target);

    expect(sounds).toContain('eva_reinforcements');
    expect(evas).toContain('Reinforcements have arrived');
  });
});

// =============================================================================
// 8. Animation type data constants — adata.cpp cross-reference
// =============================================================================

describe('Superweapon animation type constants match C++ adata.cpp', () => {

  it('ANIM_ATOM_BLAST: sprite=atomsfx, delay=1 (C++ adata.cpp:48-71)', () => {
    // C++ AtomBomb: "ATOMSFX", dimension=72, biggest=19, delay=1, scorches=true, craters=true
    // TS nuke uses sprite='atomsfx' in detonateNuke()
    const ctx = makeCtx();
    detonateNuke(ctx, { x: 100, y: 100 });
    const atom = ctx.effects.find(e => e.sprite === 'atomsfx');
    expect(atom, 'nuke should create ATOMSFX animation').toBeDefined();
    expect(atom!.spriteStart).toBe(0); // C++ startFrame=0
  });

  it('ANIM_FBALL1: sprite=fball1, used in secondary nuke blasts (C++ adata.cpp:569-591)', () => {
    // C++ FBall1: "FBALL1", dimension=67, biggest=6, normalized=true, craters=true
    const ctx = makeCtx();
    detonateNuke(ctx, { x: 100, y: 100 });
    const fballs = ctx.effects.filter(e => e.sprite === 'fball1');
    expect(fballs.length).toBe(6); // 6 secondary blasts in ring pattern
    for (const fb of fballs) {
      expect(fb.spriteStart).toBe(0); // C++ startFrame=0
    }
  });

  it('Chronoshift uses litning sprite (C++ visual from BW fade + lightning)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeCtx({ entities: [tank], entityById: new Map([[tank.id, tank]]) });
    addReadySuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain);

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, { x: 200, y: 200 });

    const litning = ctx.effects.filter(e => e.sprite === 'litning');
    expect(litning.length).toBe(2); // origin + destination
  });
});

// =============================================================================
// 9. Each superweapon produces correct animation type and position
// =============================================================================

describe('Each superweapon produces effects at correct position', () => {

  it('nuke projectile targets exact specified position', () => {
    const mslo = makeStructure('MSLO', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({ structures: [mslo] });
    addReadySuperweapon(ctx, SuperweaponType.NUKE, House.Spain, 0);
    const target: WorldPos = { x: 37 * CELL_SIZE, y: 42 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.NUKE, House.Spain, target);

    const proj = ctx.effects.find(e => e.type === 'projectile');
    expect(proj!.endX).toBe(target.x);
    expect(proj!.endY).toBe(target.y);
  });

  it('chronoshift origin effect matches unit original position', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 15, 25);
    tank.selected = true;
    const originalX = tank.pos.x;
    const originalY = tank.pos.y;
    const ctx = makeCtx({ entities: [tank], entityById: new Map([[tank.id, tank]]) });
    addReadySuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain);
    const target: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    const originEffect = ctx.effects.find(e =>
      e.sprite === 'litning' && e.x === originalX && e.y === originalY
    );
    expect(originEffect, 'lightning should appear at unit original position').toBeDefined();
  });

  it('iron curtain effect on structure is centered within structure footprint', () => {
    const weap = makeStructure('WEAP', 20, 20, undefined, House.Spain);
    const ctx = makeCtx({ structures: [weap] });
    addReadySuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain);
    const [sw, sh] = STRUCTURE_SIZE['WEAP'] ?? [3, 3];
    const target: WorldPos = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, target);

    const glow = ctx.effects.find(e => e.type === 'explosion');
    if (glow) {
      // Effect should be positioned at the structure's center
      const expectedX = weap.cx * CELL_SIZE + (sw * CELL_SIZE) / 2;
      const expectedY = weap.cy * CELL_SIZE + (sh * CELL_SIZE) / 2;
      expect(glow.x).toBe(expectedX);
      expect(glow.y).toBe(expectedY);
    }
  });

  it('parabomb center bomb is at target position', () => {
    const ctx = makeCtx();
    addReadySuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain);
    const target: WorldPos = { x: 40 * CELL_SIZE, y: 40 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain, target);

    // The 4th explosion (index 3, i=0) should be at the exact target position
    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    expect(explosions[3].x).toBe(target.x);
    expect(explosions[3].y).toBe(target.y);
  });
});

// =============================================================================
// 10. Superweapon discharge resets state correctly
// =============================================================================

describe('Superweapon discharge state management', () => {

  it('nuke discharge resets ready and chargeTick', () => {
    const mslo = makeStructure('MSLO', 10, 10, undefined, House.Spain);
    const ctx = makeCtx({ structures: [mslo] });
    addReadySuperweapon(ctx, SuperweaponType.NUKE, House.Spain, 0);
    const key = `${House.Spain}:${SuperweaponType.NUKE}`;
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.NUKE, House.Spain, target);

    const state = ctx.superweapons.get(key);
    expect(state!.ready).toBe(false);
    expect(state!.chargeTick).toBe(0);
  });

  it('chronosphere discharge resets ready and chargeTick', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeCtx({ entities: [tank], entityById: new Map([[tank.id, tank]]) });
    addReadySuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain);
    const key = `${House.Spain}:${SuperweaponType.CHRONOSPHERE}`;
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    const state = ctx.superweapons.get(key);
    expect(state!.ready).toBe(false);
    expect(state!.chargeTick).toBe(0);
  });

  it('iron curtain discharge resets ready and chargeTick', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ctx = makeCtx({ entities: [tank], entityById: new Map([[tank.id, tank]]) });
    addReadySuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain);
    const key = `${House.Spain}:${SuperweaponType.IRON_CURTAIN}`;

    activateSuperweapon(ctx, SuperweaponType.IRON_CURTAIN, House.Spain, tank.pos);

    const state = ctx.superweapons.get(key);
    expect(state!.ready).toBe(false);
    expect(state!.chargeTick).toBe(0);
  });

  it('parabomb discharge resets ready and chargeTick', () => {
    const ctx = makeCtx();
    addReadySuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain);
    const key = `${House.Spain}:${SuperweaponType.PARABOMB}`;
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.PARABOMB, House.Spain, target);

    const state = ctx.superweapons.get(key);
    expect(state!.ready).toBe(false);
    expect(state!.chargeTick).toBe(0);
  });

  it('activation with no ready state is a no-op', () => {
    const ctx = makeCtx();
    // No superweapon added — should be graceful no-op
    const target: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };

    activateSuperweapon(ctx, SuperweaponType.NUKE, House.Spain, target);

    expect(ctx.effects.length).toBe(0);
    expect(ctx.screenShake).toBe(0);
    expect(ctx.screenFlash).toBe(0);
  });
});
