/**
 * WasmAdapter: connects to Red Alert's WASM build via Playwright.
 * Modeled on Emperor's RemakeAdapter — uses headless browser to load
 * the Emscripten-compiled C++ game, then controls it via exported
 * C functions (agent_get_state, agent_step, inject_mouse_click, etc.).
 *
 * No focus stealing — runs headless. No mouse hooks needed — game runs
 * in-process and exports direct input injection functions.
 */

import { chromium, type Browser, type Page } from '@playwright/test';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** State returned by agent_get_state() from the C++ harness */
export interface RAGameState {
  tick: number;
  credits: number;
  power: { produced: number; consumed: number };
  units: RAEntity[];
  enemies: RAEntity[];
  structures: RAStructure[];
  production: RAProduction[];
  error?: string;
}

export interface RAEntity {
  id: number;
  t: string;   // type name (e.g. "MTNK", "E1")
  cx: number;  // cell X
  cy: number;  // cell Y
  hp: number;
  mhp: number; // max HP
  m: number;   // mission enum
  ally: boolean;
}

export interface RAStructure extends RAEntity {
  repairing: boolean;
}

export interface RAProduction {
  t: string;    // type being produced
  prog: number; // completion (0-100?)
}

export interface AgentStepResult {
  results: Array<{ cmd: string; ok: boolean }>;
  state: RAGameState;
}

export interface WasmAdapterConfig {
  /** URL to serve the WASM build from. Default: auto-detect or http://localhost:3000/ra/original.html */
  url?: string;
  /** Scenario to load (e.g. "SCG01EA"). Default: none (show main menu) */
  scenario?: string;
  /** Enable autoplay mode (auto-dismiss dialogs). Default: true */
  autoplay?: boolean;
  /** Enable ant missions. Default: false */
  ants?: boolean;
  /** Run browser headless. Default: true */
  headless?: boolean;
}

const DEFAULTS: Required<WasmAdapterConfig> = {
  url: '',
  scenario: 'SCG01EA',
  autoplay: true,
  ants: false,
  headless: true,
};

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

export class WasmAdapter {
  readonly name = 'ra-wasm';
  private static readonly MAX_AGENT_STEP_TICKS = 15;
  private config: Required<WasmAdapterConfig>;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private serverUrl = '';
  private httpServer: http.Server | null = null;

  constructor(config?: WasmAdapterConfig) {
    this.config = { ...DEFAULTS, ...config };
  }

  async connect(): Promise<void> {
    // Determine URL
    if (this.config.url) {
      this.serverUrl = this.config.url;
    } else {
      // Auto-serve from public/ra/ using a simple HTTP server
      this.serverUrl = await this.startStaticServer();
    }

    console.log(`[WasmAdapter] Launching browser (headless=${this.config.headless})`);
    this.browser = await chromium.launch({ headless: this.config.headless });
    const context = await this.browser.newContext({
      viewport: { width: 640, height: 400 },
    });
    this.page = await context.newPage();

    // Build URL with query params
    const url = new URL(this.serverUrl);
    if (this.config.autoplay) {
      url.searchParams.set('autoplay', this.config.ants ? 'ants' : '1');
    }
    url.searchParams.set('agentharness', '1');
    if (this.config.scenario) {
      // Ensure .INI extension — the compiled WASM's URL parser may not append it
      let scenario = this.config.scenario;
      if (!/\.\w+$/.test(scenario)) scenario += '.INI';
      url.searchParams.set('scenario', scenario);
    }

    console.log(`[WasmAdapter] Navigating to ${url.toString()}`);
    await this.page.goto(url.toString(), { timeout: 120_000 });

    // Wait for WASM to load and start rendering
    console.log('[WasmAdapter] Waiting for WASM to initialize...');
    await this.page.waitForFunction(
      () => (window as any).__wasmReady === true,
      { timeout: 120_000, polling: 1000 },
    );
    console.log('[WasmAdapter] WASM initialized, waiting for game to reach gameplay...');

    // Wait for agent_get_state to return valid data (game loop running).
    // The game needs to auto-navigate past title → side selection → briefing.
    // The HTML-side autoplay_tick interval drives Main_Loop(), but the side
    // selection screen may need a manual click fallback.
    // IMPORTANT: Do NOT call _autoplay_tick() from inside waitForFunction —
    // it triggers Asyncify unwind which corrupts WASM state when caught.
    console.log('[WasmAdapter] Waiting for game to reach gameplay (agent_get_state)...');
    await this.waitForGameplay();
  }

  async disconnect(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
      console.log('[WasmAdapter] Static server stopped');
    }
  }

  /** Get current game state via agent_get_state() */
  async observe(): Promise<RAGameState> {
    this.ensurePage();
    return await this.page!.evaluate(() => {
      const Module = (window as any).Module;
      const json = Module.ccall('agent_get_state', 'string', [], []);
      return JSON.parse(json);
    });
  }

  /** Step N ticks with optional commands via agent_step() */
  async step(n = 15, commands?: string): Promise<AgentStepResult> {
    const totalTicks = Math.max(1, n);
    let remainingTicks = totalTicks;
    let firstChunk = true;
    let commandResults: AgentStepResult['results'] = [];
    let finalResult: AgentStepResult | null = null;

    while (remainingTicks > 0) {
      const chunkTicks = Math.min(remainingTicks, WasmAdapter.MAX_AGENT_STEP_TICKS);
      finalResult = await this.rawStep(chunkTicks, firstChunk ? commands : undefined);
      if (firstChunk) {
        commandResults = finalResult.results;
      }
      remainingTicks -= chunkTicks;
      firstChunk = false;
    }

    return {
      results: commandResults,
      state: finalResult!.state,
    };
  }

  /** Send semantic commands via agent_command() */
  async command(commands: Array<Record<string, unknown>>): Promise<Array<{ cmd: string; ok: boolean }>> {
    this.ensurePage();
    const cmdJson = JSON.stringify(commands);
    return await this.page!.evaluate((json) => {
      const Module = (window as any).Module;
      const result = Module.ccall('agent_command', 'string', ['string'], [json]);
      return JSON.parse(result);
    }, cmdJson);
  }

  // ─── Mouse Click Injection ──────────────────────────────────────────

  /**
   * Inject a mouse click at game coordinates (0-319 X, 0-199 Y).
   * Uses the C++ inject_mouse_click() export.
   * @returns 1 on success, 0 on failure
   */
  async mouseClick(gameX: number, gameY: number, button: 1 | 2 = 1): Promise<number> {
    this.ensurePage();
    return await this.page!.evaluate(({ x, y, btn }) => {
      const Module = (window as any).Module;
      return Module.ccall(
        'inject_mouse_click', 'number',
        ['number', 'number', 'number'],
        [x, y, btn],
      );
    }, { x: gameX, y: gameY, btn: button });
  }

  /** Inject mouse press (no release) */
  async mousePress(gameX: number, gameY: number, button: 1 | 2 = 1): Promise<number> {
    this.ensurePage();
    return await this.page!.evaluate(({ x, y, btn }) => {
      const Module = (window as any).Module;
      return Module.ccall(
        'inject_mouse_press', 'number',
        ['number', 'number', 'number'],
        [x, y, btn],
      );
    }, { x: gameX, y: gameY, btn: button });
  }

  /** Inject mouse release */
  async mouseRelease(gameX: number, gameY: number, button: 1 | 2 = 1): Promise<number> {
    this.ensurePage();
    return await this.page!.evaluate(({ x, y, btn }) => {
      const Module = (window as any).Module;
      return Module.ccall(
        'inject_mouse_release', 'number',
        ['number', 'number', 'number'],
        [x, y, btn],
      );
    }, { x: gameX, y: gameY, btn: button });
  }

  /** Inject mouse move (no click) */
  async mouseMove(gameX: number, gameY: number): Promise<number> {
    this.ensurePage();
    return await this.page!.evaluate(({ x, y }) => {
      const Module = (window as any).Module;
      return Module.ccall(
        'inject_mouse_move', 'number',
        ['number', 'number'],
        [x, y],
      );
    }, { x: gameX, y: gameY });
  }

  /** Inject a keyboard press+release */
  async keyPress(vkCode: number): Promise<number> {
    this.ensurePage();
    return await this.page!.evaluate((vk) => {
      const Module = (window as any).Module;
      return Module.ccall('inject_key', 'number', ['number'], [vk]);
    }, vkCode);
  }

  // ─── Diagnostics ────────────────────────────────────────────────────

  /** Check if the keyboard input buffer has data */
  async inputDiag(): Promise<number> {
    this.ensurePage();
    return await this.page!.evaluate(() => {
      const Module = (window as any).Module;
      return Module.ccall('input_diag', 'number', [], []);
    });
  }

  /** Capture a screenshot as PNG buffer */
  async screenshot(): Promise<Buffer> {
    this.ensurePage();
    return await this.page!.screenshot({ type: 'png' }) as Buffer;
  }

  /** Capture game canvas screenshot (320x200 game pixels) */
  async gameScreenshot(): Promise<string> {
    this.ensurePage();
    return await this.page!.evaluate(() => {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement;
      return canvas?.toDataURL('image/png') ?? '';
    });
  }

  /** Get WASM logs */
  async getLogs(): Promise<string[]> {
    this.ensurePage();
    return await this.page!.evaluate(() => (window as any).__wasmLogs || []);
  }

  /** Get WASM errors */
  async getErrors(): Promise<string[]> {
    this.ensurePage();
    return await this.page!.evaluate(() => (window as any).__wasmErrors || []);
  }

  /** Get render diagnostics */
  async getDiag(): Promise<Record<string, unknown>> {
    this.ensurePage();
    return await this.page!.evaluate(() => (window as any).__wasmDiag || {});
  }

  // ─── Pause / Resume ─────────────────────────────────────────────────

  async pause(): Promise<void> {
    this.ensurePage();
    await this.page!.evaluate(() => {
      (window as any).__wasmSetPaused(true);
    });
  }

  async resume(): Promise<void> {
    this.ensurePage();
    await this.page!.evaluate(() => {
      (window as any).__wasmSetPaused(false);
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private ensurePage(): void {
    if (!this.page) throw new Error('Not connected — call connect() first');
  }

  private async rawStep(n: number, commands?: string): Promise<AgentStepResult> {
    this.ensurePage();
    // agent_step calls Main_Loop() which uses emscripten_sleep → Asyncify.
    // ccall with {async:true} returns a Promise that resolves after rewind.
    return await this.page!.evaluate(async ({ ticks, cmds }) => {
      const Module = (window as any).Module;
      const json = await Module.ccall(
        'agent_step', 'string',
        ['number', 'string'],
        [ticks, cmds || ''],
        { async: true },
      );
      return JSON.parse(json);
    }, { ticks: n, cmds: commands ?? '' });
  }

  /**
   * Wait for the game to reach the gameplay loop, then verify agent_get_state works.
   *
   * Phase 1: Wait for C++ to set window.__autoplayReady = true (pure JS check,
   *   no WASM calls — safe even during Asyncify operations). This flag is set
   *   just before the game loop starts in conquer.cpp.
   *
   * Phase 2: Once in the game loop, poll agent_get_state (safe because the loop
   *   yields via emscripten_sleep(1) every frame, giving evaluate a window).
   *
   * IMPORTANT: Do NOT call _autoplay_tick() or any game-loop WASM function from
   * page.evaluate() — Asyncify unwind causes the evaluate to hang permanently.
   */
  private async waitForGameplay(): Promise<void> {
    // Phase 1: Wait for __autoplayReady (set by C++ when entering game loop)
    // Falls back to document.title checkpoints set by EM_ASM in init.cpp
    console.log('[WasmAdapter] Phase 1: Waiting for game loop entry (__autoplayReady)...');
    try {
      await this.page!.waitForFunction(() => {
        const w = window as any;
        // Primary: C++ sets this just before the for(;;) { Main_Loop() } loop
        if (w.__autoplayReady === true) return true;
        // Fallback: check title checkpoints from C++ EM_ASM calls
        const t = document.title;
        if (t.includes('ENTERING_GAME_LOOP') || t.includes('SELECT_GAME_DONE')) return true;
        return false;
      }, { timeout: 120_000, polling: 1000 });
    } catch {
      // If __autoplayReady never fires, the game might be stuck
      // Try to get diagnostics from the page title
      const title = await this.page!.title();
      console.log(`[WasmAdapter] Phase 1 timed out. Page title: "${title}"`);
      console.log('[WasmAdapter] Game may be stuck in menus. Attempting Phase 2 anyway...');
    }

    // Phase 2: Use waitForFunction (page-local polling) to check agent_get_state.
    // CRITICAL: page.evaluate() hangs with Asyncify because CDP round-trips
    // can't reliably interleave with the 1ms emscripten_sleep gaps.
    // waitForFunction runs its callback in-page, avoiding the CDP timing issue.
    console.log('[WasmAdapter] Phase 2: Waiting for agent_get_state via waitForFunction...');
    await this.page!.waitForFunction(() => {
      try {
        const Asyncify = (window as any).Asyncify;
        if (Asyncify && Asyncify.state !== 0) return false;
        const Module = (window as any).Module;
        if (!Module || typeof Module.ccall !== 'function') return false;
        const json = Module.ccall('agent_get_state', 'string', [], []);
        const state = JSON.parse(json);
        const hasScenarioState =
          Array.isArray(state.units) && state.units.length > 0 ||
          Array.isArray(state.structures) && state.structures.length > 0;
        (window as any).__agentStatus = `tick=${state.tick} loaded=${hasScenarioState ? 'yes' : 'no'} error=${state.error || 'none'}`;
        return hasScenarioState && !state.error;
      } catch {
        return false;
      }
    }, { timeout: 60_000, polling: 1000 });

    console.log('[WasmAdapter] Game is running — adapter ready');
  }

  /**
   * Start a static HTTP server for the WASM build.
   * Serves public/ra/ with proper MIME types and COOP/COEP headers.
   * Uses port 0 for auto-assignment. Streams large files (gamedata.data is 43MB).
   * Returns the URL to the original.html file.
   */
  private async startStaticServer(): Promise<string> {
    // Find the public/ra directory relative to the project root
    const projectRoot = path.resolve(__dirname, '..', '..', '..');
    const raDir = path.join(projectRoot, 'public', 'ra');

    if (!fs.existsSync(raDir)) {
      throw new Error(`[WasmAdapter] public/ra/ not found at ${raDir}`);
    }

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
        // Serve from raDir — strip leading /ra/ prefix if present (for compatibility)
        let filePath: string;
        if (urlPath.startsWith('/ra/')) {
          filePath = path.join(raDir, urlPath.slice(4));
        } else if (urlPath === '/' || urlPath === '/ra') {
          filePath = path.join(raDir, 'original.html');
        } else {
          filePath = path.join(raDir, urlPath);
        }

        // Security: prevent directory traversal
        if (!filePath.startsWith(raDir)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        fs.stat(filePath, (err, stats) => {
          if (err || !stats.isFile()) {
            res.writeHead(404);
            res.end('Not Found');
            return;
          }

          const ext = path.extname(filePath).toLowerCase();
          const mime = MIME_TYPES[ext] || 'application/octet-stream';

          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': stats.size,
            // COOP/COEP headers required for SharedArrayBuffer (Emscripten threading)
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cache-Control': 'no-cache',
          });

          // Stream the file (important for 43MB gamedata.data)
          fs.createReadStream(filePath).pipe(res);
        });
      });

      server.on('error', reject);

      // Port 0 = OS picks an available port
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to get server address'));
          return;
        }
        this.httpServer = server;
        const base = `http://127.0.0.1:${addr.port}/ra/original.html`;
        console.log(`[WasmAdapter] Static server listening on port ${addr.port}`);
        resolve(base);
      });
    });
  }
}
