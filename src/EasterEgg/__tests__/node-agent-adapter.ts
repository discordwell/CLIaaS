/**
 * NodeAgentAdapter — runs the TS game engine directly in Node.js (via jsdom)
 * without needing Playwright or a dev server.
 *
 * This replaces TsAgentAdapter for tests that only need the TS engine
 * (not C++ WASM parity). Tests using this adapter run in seconds instead
 * of minutes, and don't require `pnpm dev` to be running.
 *
 * @vitest-environment jsdom
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { vi } from 'vitest';
import { Game } from '../engine/index';
import {
  serializeState,
  processCommands,
  type AgentCommand,
  type AgentState,
  type StepResult,
} from '../engine/agentHarness';
import { resetEntityIds } from '../engine/entity';

// ── DOM stubs for Node.js ────────────────────────────────────────────────

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

/** Stub HTMLImageElement.prototype.decode (used by AssetManager). */
function stubImageDecode(): void {
  if (typeof HTMLImageElement !== 'undefined') {
    HTMLImageElement.prototype.decode = function () {
      return Promise.resolve();
    };
  }
}

/** Install all DOM stubs needed to construct a Game in jsdom. */
function installDomStubs(): void {
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

  // Mock getContext on canvas to return a minimal context
  if (typeof HTMLCanvasElement !== 'undefined') {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      imageSmoothingEnabled: false,
      fillRect() {},
      clearRect() {},
      drawImage() {},
      fillText() {},
      measureText() { return { width: 0 }; },
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fill() {},
      arc() {},
      rect() {},
      save() {},
      restore() {},
      translate() {},
      scale() {},
      setTransform() {},
      getImageData() { return { data: new Uint8ClampedArray(4) }; },
      putImageData() {},
      createImageData() { return { data: new Uint8ClampedArray(4) }; },
      createLinearGradient() { return { addColorStop() {} }; },
      createPattern() { return {}; },
      clip() {},
      closePath() {},
      strokeRect() {},
      strokeText() {},
      canvas: { width: 640, height: 400 },
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      shadowBlur: 0,
      shadowColor: '',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      lineCap: 'butt',
      lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D));
  }

  stubImageDecode();
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 400;
  return canvas;
}

// ── Fetch mock for loading scenario INI from disk ────────────────────────

/** Intercept fetch() calls for /ra/assets/*.ini and serve from disk. */
function mockFetchForScenarios(): void {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');

  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
    // Match /ra/assets/<scenario>.ini
    const match = urlStr.match(/\/ra\/assets\/(\w+\.ini)$/);
    if (match) {
      const filePath = path.join(projectRoot, 'public', 'ra', 'assets', match[1]);
      try {
        const text = fs.readFileSync(filePath, 'utf-8');
        return {
          ok: true,
          status: 200,
          text: async () => text,
          json: async () => JSON.parse(text),
        };
      } catch {
        return { ok: false, status: 404, text: async () => 'Not found' };
      }
    }
    // For any other fetch (e.g., asset loading), return a stub
    return { ok: false, status: 404, text: async () => 'Not found' };
  }));
}

// ── NodeAgentAdapter ─────────────────────────────────────────────────────

export class NodeAgentAdapter {
  private game: Game | null = null;

  constructor() {
    installDomStubs();
    mockFetchForScenarios();
  }

  /** Load a scenario into the engine. Returns initial state. */
  async loadScenario(scenarioId: string, difficulty: 'easy' | 'normal' | 'hard' = 'normal'): Promise<AgentState> {
    resetEntityIds();
    const canvas = createCanvas();
    this.game = new Game(canvas);

    // Stub asset loading — we don't need sprites for headless engine tests
    this.game.assets.loadAll = async () => {};

    // Stub audio methods that touch web APIs
    this.game.audio.init = () => {};
    this.game.audio.resume = () => {};
    this.game.audio.loadSamples = () => {};
    (this.game.audio as unknown as { startAmbient: () => void }).startAmbient = () => {};
    (this.game.audio.music as unknown as { play: () => void }).play = () => {};

    // No-op render and gameLoop — we don't need visual output in headless tests.
    // Must be set BEFORE start() since start() calls gameLoop() at the end.
    (this.game as unknown as { render: () => void }).render = () => {};
    (this.game as unknown as { gameLoop: () => void }).gameLoop = () => {};

    // Call game.start() which internally calls loadScenario(scenarioId)
    // This loads the INI (via our mocked fetch), sets up map, entities, etc.
    await this.game.start(scenarioId, difficulty);

    // Set state to paused for step() to work properly
    this.game.state = 'paused' as Game['state'];

    return serializeState(this.game);
  }

  /**
   * Step the game engine by N ticks and optionally execute commands.
   * Mirrors the __agentStep behavior from agentHarness.ts including tick scaling.
   */
  step(ticks = 15, commands?: AgentCommand[]): StepResult {
    if (!this.game) throw new Error('No game loaded — call loadScenario() first');

    // Scale ticks: same as __agentStep (n * 20/15 for GameSpeed 3 parity)
    const scaled = Math.round(ticks * 20 / 15);
    const clamped = Math.max(0, Math.min(scaled, 1200));

    // Process commands first
    const results = commands && Array.isArray(commands) ? processCommands(this.game, commands) : [];

    // Step the engine
    this.game.step(clamped);

    return { results, state: serializeState(this.game) };
  }

  /** Get current state without stepping. */
  observe(): AgentState {
    if (!this.game) throw new Error('No game loaded');
    return serializeState(this.game);
  }

  /** Clean up. */
  disconnect(): void {
    if (this.game) {
      (this.game as unknown as { stopped: boolean }).stopped = true;
    }
    this.game = null;
  }
}
