/**
 * @vitest-environment jsdom
 *
 * Harness Focus Fire Battle — diagnostic test for agent harness combat effectiveness.
 *
 * Pits player medium tanks (2TNK) against value-comparable enemy mammoth tanks (4TNK)
 * to verify that harness-directed focus fire gives the player an edge.
 *
 * Economics:
 *   - 2TNK (Medium Tank): cost=800, HP=400, 90mm (30 dmg, 50 ROF, AP)
 *   - 4TNK (Mammoth Tank): cost=1700, HP=600, 120mm (40 dmg, 80 ROF, burst 2, AP)
 *                           + MammothTusk (75 dmg, 80 ROF, burst 2, HE, splash 1.5 cells)
 *
 * Value-comparable: 4 mammoths (6800 credits) vs 8 mediums (6400 credits).
 * With focus fire (all mediums on one mammoth at a time), mediums should win.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Game } from '../engine/index';
import { Entity, resetEntityIds, setPlayerHouses } from '../engine/entity';
import { House, Mission, UnitType, CELL_SIZE, UNIT_STATS, WEAPON_STATS, buildDefaultAlliances } from '../engine/types';
import {
  serializeState,
  processCommands,
  type AgentCommand,
  type AgentState,
} from '../engine/agentHarness';

// ── DOM stubs ──────────────────────────────────────────────────────────

class FakeAudio {
  src = '';
  preload = '';
  volume = 1;
  currentTime = 0;
  muted = false;
  loop = false;
  addEventListener(): void {}
  removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); }
  pause(): void {}
  cloneNode(): FakeAudio { return new FakeAudio(); }
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('AudioContext', class {
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    createBufferSource() { return { connect() {}, start() {}, stop() {}, buffer: null, loop: false, addEventListener() {} }; }
    createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: '' }; }
    decodeAudioData() { return Promise.resolve({}); }
    resume() { return Promise.resolve(); }
    get destination() { return {}; }
    get currentTime() { return 0; }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    imageSmoothingEnabled: false,
    fillRect() {}, clearRect() {}, drawImage() {}, fillText() {},
    measureText() { return { width: 0 }; },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    arc() {}, rect() {}, save() {}, restore() {}, translate() {}, scale() {},
    setTransform() {},
    getImageData() { return { data: new Uint8ClampedArray(4) }; },
    putImageData() {}, createImageData() { return { data: new Uint8ClampedArray(4) }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createPattern() { return {}; }, clip() {}, closePath() {},
    strokeRect() {}, strokeText() {},
    canvas: { width: 640, height: 400 },
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    textAlign: 'start', textBaseline: 'alphabetic',
    shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
    lineCap: 'butt', lineJoin: 'miter',
  } as unknown as CanvasRenderingContext2D));
});

beforeEach(() => {
  resetEntityIds();
});

// ── Helpers ──────────────────────────────────────────────────────────

function createArenaGame(): Game {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 400;
  const game = new Game(canvas);

  // Large flat map — no obstacles
  game.map.setBounds(0, 0, 80, 80);

  // Set player house and alliances
  game.playerHouse = House.Spain;
  setPlayerHouses(new Set([House.Spain]));

  // Disable fog
  game.fogDisabled = true;

  // Set state to paused so step() will work (step transitions paused → playing → paused)
  game.state = 'paused' as typeof game.state;

  // No-op render, gameLoop, and victory check — headless arena battle
  (game as unknown as { render: () => void }).render = () => {};
  (game as unknown as { gameLoop: () => void }).gameLoop = () => {};
  (game as unknown as { checkVictoryConditions: () => void }).checkVictoryConditions = () => {};

  return game;
}

function spawnUnit(game: Game, type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  game.entities.push(e);
  game.entityById.set(e.id, e);
  return e;
}

function aliveUnits(game: Game, house: House): Entity[] {
  return game.entities.filter(e => e.alive && e.house === house);
}

function totalHp(units: Entity[]): number {
  return units.reduce((sum, e) => sum + e.hp, 0);
}

interface BattleLog {
  tick: number;
  playerAlive: number;
  playerTotalHp: number;
  enemyAlive: number;
  enemyTotalHp: number;
  event?: string;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Harness focus fire battle: 8x 2TNK vs 4x 4TNK', () => {

  it('focus-fired mediums should defeat value-comparable mammoths', () => {
    const game = createArenaGame();

    // Spawn 8 medium tanks in a line (player, Spain)
    //   Positioned at y=30, x=20..27 — left side
    const mediums: Entity[] = [];
    for (let i = 0; i < 8; i++) {
      mediums.push(spawnUnit(game, UnitType.V_2TNK, House.Spain, 20 + i, 30));
    }

    // Spawn 4 mammoth tanks in a line (enemy, USSR)
    //   Positioned at y=30, x=35..38 — right side, ~10 cells apart
    const mammoths: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      mammoths.push(spawnUnit(game, UnitType.V_4TNK, House.USSR, 35 + i, 30));
    }

    // Log initial state
    const log: BattleLog[] = [];
    log.push({
      tick: 0,
      playerAlive: mediums.filter(e => e.alive).length,
      playerTotalHp: totalHp(mediums.filter(e => e.alive)),
      enemyAlive: mammoths.filter(e => e.alive).length,
      enemyTotalHp: totalHp(mammoths.filter(e => e.alive)),
      event: 'BATTLE START',
    });

    // Battle loop: focus fire on the lowest-HP mammoth, re-target when it dies
    const MAX_TICKS = 3000;
    let lastMammothCount = 4;

    for (let tick = 0; tick < MAX_TICKS; tick += 15) {
      // Find lowest-HP alive mammoth to focus
      const aliveMammoths = mammoths.filter(m => m.alive);
      const aliveMediums = mediums.filter(m => m.alive);

      if (aliveMammoths.length === 0 || aliveMediums.length === 0) break;

      // Pick focus target — lowest HP mammoth (finish wounded ones first)
      const focusTarget = aliveMammoths.reduce((best, m) => m.hp < best.hp ? m : best);

      // Issue focus fire command for all alive mediums
      const cmds: AgentCommand[] = [{
        cmd: 'attack',
        unitIds: aliveMediums.map(m => m.id),
        targetId: focusTarget.id,
      }];

      processCommands(game as Parameters<typeof processCommands>[0], cmds);

      // Step the game engine
      game.step(15);

      // Log when a mammoth dies
      const currentMammothCount = mammoths.filter(m => m.alive).length;
      if (currentMammothCount < lastMammothCount) {
        log.push({
          tick: tick + 15,
          playerAlive: mediums.filter(e => e.alive).length,
          playerTotalHp: totalHp(mediums.filter(e => e.alive)),
          enemyAlive: currentMammothCount,
          enemyTotalHp: totalHp(mammoths.filter(e => e.alive)),
          event: `MAMMOTH KILLED (${lastMammothCount} → ${currentMammothCount})`,
        });
        lastMammothCount = currentMammothCount;
      }
    }

    // Final state
    const survivingMediums = mediums.filter(e => e.alive);
    const survivingMammoths = mammoths.filter(e => e.alive);

    log.push({
      tick: game.tick,
      playerAlive: survivingMediums.length,
      playerTotalHp: totalHp(survivingMediums),
      enemyAlive: survivingMammoths.length,
      enemyTotalHp: totalHp(survivingMammoths),
      event: 'BATTLE END',
    });

    // Print battle log
    console.log('\n═══ FOCUS FIRE BATTLE LOG ═══');
    console.log(`Setup: 8x 2TNK (${8 * 800} credits) vs 4x 4TNK (${4 * 1700} credits)`);
    console.log(`Distance: ~10 cells apart, flat terrain, no obstacles`);
    console.log('');
    for (const entry of log) {
      console.log(
        `  [tick ${String(entry.tick).padStart(4)}] ` +
        `Player: ${entry.playerAlive} alive (${entry.playerTotalHp} HP)  |  ` +
        `Enemy: ${entry.enemyAlive} alive (${entry.enemyTotalHp} HP)` +
        (entry.event ? `  ← ${entry.event}` : ''),
      );
    }
    console.log('');

    // Assert: player should win (mammoths all dead, some mediums survive)
    expect(survivingMammoths.length).toBe(0);
    expect(survivingMediums.length).toBeGreaterThan(0);

    console.log(`RESULT: Player wins with ${survivingMediums.length}/8 mediums surviving (${totalHp(survivingMediums)} HP remaining)`);
  });

  it('WITHOUT focus fire (guard mode), mediums fare worse', () => {
    const game = createArenaGame();

    // Same setup: 8 mediums vs 4 mammoths
    const mediums: Entity[] = [];
    for (let i = 0; i < 8; i++) {
      mediums.push(spawnUnit(game, UnitType.V_2TNK, House.Spain, 20 + i, 30));
    }
    const mammoths: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      mammoths.push(spawnUnit(game, UnitType.V_4TNK, House.USSR, 35 + i, 30));
    }

    // No focus fire commands — let guard mode auto-engage
    // Attack-move all mediums toward the enemy line so they engage
    const cmds: AgentCommand[] = [{
      cmd: 'attack_move',
      unitIds: mediums.map(m => m.id),
      cx: 37, cy: 30,
    }];
    processCommands(game as Parameters<typeof processCommands>[0], cmds);

    // Run the full battle
    for (let tick = 0; tick < 3000; tick += 15) {
      const aliveMediums = mediums.filter(m => m.alive);
      const aliveMammoths = mammoths.filter(m => m.alive);
      if (aliveMammoths.length === 0 || aliveMediums.length === 0) break;
      game.step(15);
    }

    const survivingMediums = mediums.filter(e => e.alive);
    const survivingMammoths = mammoths.filter(e => e.alive);

    console.log('\n═══ NO FOCUS FIRE (GUARD/HUNT) BATTLE LOG ═══');
    console.log(`RESULT: Player ${survivingMammoths.length === 0 ? 'wins' : 'loses'} — ` +
      `${survivingMediums.length}/8 mediums, ${survivingMammoths.length}/4 mammoths survive`);
    console.log(`  Player HP remaining: ${totalHp(survivingMediums)}`);
    console.log(`  Enemy HP remaining: ${totalHp(survivingMammoths)}`);

    // We expect worse results without focus fire, but the test is diagnostic —
    // just record what happens
  });

  it('detailed damage diagnostics — track per-tick damage output', () => {
    const game = createArenaGame();

    // Smaller engagement: 4 mediums vs 2 mammoths, closer range
    const mediums: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      mediums.push(spawnUnit(game, UnitType.V_2TNK, House.Spain, 30 + i, 30));
    }
    const mammoths: Entity[] = [];
    for (let i = 0; i < 2; i++) {
      mammoths.push(spawnUnit(game, UnitType.V_4TNK, House.USSR, 36 + i, 30));
    }

    // Print unit stats for reference
    const medStats = UNIT_STATS['2TNK'];
    const mamStats = UNIT_STATS['4TNK'];
    const wpn90 = WEAPON_STATS[medStats.primaryWeapon!];
    const wpn120 = WEAPON_STATS[mamStats.primaryWeapon!];
    const wpnTusk = WEAPON_STATS[mamStats.secondaryWeapon!];

    console.log('\n═══ DAMAGE DIAGNOSTICS ═══');
    console.log(`2TNK stats: HP=${medStats.strength}, armor=${medStats.armor}, speed=${medStats.speed}`);
    console.log(`  90mm: dmg=${wpn90.damage}, ROF=${wpn90.rof}, range=${wpn90.range}, warhead=${wpn90.warhead}`);
    console.log(`4TNK stats: HP=${mamStats.strength}, armor=${mamStats.armor}, speed=${mamStats.speed}`);
    console.log(`  120mm: dmg=${wpn120.damage}, ROF=${wpn120.rof}, range=${wpn120.range}, burst=${wpn120.burst}, warhead=${wpn120.warhead}`);
    console.log(`  MammothTusk: dmg=${wpnTusk.damage}, ROF=${wpnTusk.rof}, range=${wpnTusk.range}, burst=${wpnTusk.burst}, warhead=${wpnTusk.warhead}, splash=${wpnTusk.splash}`);
    console.log('');

    // Focus fire all 4 mediums on mammoth[0]
    const focusTarget = mammoths[0];

    // Track HP each step
    console.log('Per-step HP tracking (focus fire 4x 2TNK → mammoth[0]):');
    let lastMamHp = focusTarget.hp;

    for (let tick = 0; tick < 600; tick += 5) {
      // Refresh focus fire command every 5 ticks
      if (tick % 15 === 0) {
        const aliveMediums = mediums.filter(m => m.alive);
        if (aliveMediums.length === 0 || !focusTarget.alive) break;

        processCommands(game as Parameters<typeof processCommands>[0], [{
          cmd: 'attack',
          unitIds: aliveMediums.map(m => m.id),
          targetId: focusTarget.id,
        }]);
      }

      game.step(5);

      if (focusTarget.hp !== lastMamHp || !focusTarget.alive) {
        const dmgDealt = lastMamHp - (focusTarget.alive ? focusTarget.hp : 0);
        console.log(
          `  [tick ${String(game.tick).padStart(4)}] ` +
          `mammoth[0] HP: ${focusTarget.alive ? focusTarget.hp : 'DEAD'}/${focusTarget.maxHp} ` +
          `(${dmgDealt > 0 ? '-' + dmgDealt : ''}), ` +
          `mediums alive: ${mediums.filter(m => m.alive).length}, ` +
          `medium HPs: [${mediums.map(m => m.alive ? m.hp : 'X').join(', ')}]`,
        );
        lastMamHp = focusTarget.alive ? focusTarget.hp : 0;
      }

      if (!focusTarget.alive) {
        console.log(`  → mammoth[0] killed at tick ${game.tick}`);
        break;
      }
    }

    if (focusTarget.alive) {
      console.log(`  → mammoth[0] SURVIVED with ${focusTarget.hp}/${focusTarget.maxHp} HP after 600 ticks`);
      console.log(`  → This indicates damage is not being dealt — check targeting, range, cooldowns`);

      // Diagnostic dump of unit states
      console.log('\n  Unit state dump:');
      for (const m of mediums) {
        console.log(`    2TNK#${m.id}: alive=${m.alive}, mission=${m.mission}, ` +
          `target=${m.target?.id ?? 'null'}, pos=(${m.cell.cx},${m.cell.cy}), ` +
          `cooldown=${m.attackCooldown}, animState=${m.animState}`);
      }
      for (const m of mammoths) {
        console.log(`    4TNK#${m.id}: alive=${m.alive}, mission=${m.mission}, ` +
          `target=${m.target?.id ?? 'null'}, pos=(${m.cell.cx},${m.cell.cy}), ` +
          `cooldown=${m.attackCooldown}, cooldown2=${m.attackCooldown2}`);
      }
    }

    // The focus target should be dead within a reasonable time
    // 4 mediums × 30 dmg / 50 ROF = 2.4 DPS each = 9.6 DPS total
    // 600 HP mammoth / 9.6 DPS ≈ 62.5 seconds = 1250 ticks @ 20 tps
    // But engagement range approach + burst delay should be faster than that
    expect(focusTarget.alive).toBe(false);
  });
});
