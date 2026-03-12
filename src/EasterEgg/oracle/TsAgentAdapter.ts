import { chromium, type Browser, type Page } from '@playwright/test';

import type {
  AgentCommand,
  AgentState,
  CommandResult,
  StepResult,
} from '../engine/agentHarness.js';

export interface TsAgentAdapterConfig {
  url: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
}

declare global {
  interface Window {
    __agentReady?: boolean;
    __agentState?: () => AgentState;
    __agentCommand?: (commands: AgentCommand[]) => CommandResult[];
    __agentStep?: (ticks: number, commands?: AgentCommand[]) => StepResult;
  }
}

const DEFAULT_VIEWPORT = { width: 640, height: 400 };

export class TsAgentAdapter {
  readonly name = 'ts-agent';
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly config: Required<TsAgentAdapterConfig>;
  private readonly consoleLogs: string[] = [];
  private readonly pageErrors: string[] = [];

  constructor(config: TsAgentAdapterConfig) {
    this.config = {
      headless: true,
      viewport: DEFAULT_VIEWPORT,
      ...config,
    };
  }

  async connect(): Promise<void> {
    this.browser = await chromium.launch({ headless: this.config.headless });
    const context = await this.browser.newContext({ viewport: this.config.viewport });
    this.page = await context.newPage();
    this.page.on('console', (msg) => this.consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    this.page.on('pageerror', (err) => this.pageErrors.push(err.message));
  }

  async disconnect(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async loadScenario(scenario: string, difficulty = 'normal'): Promise<AgentState> {
    this.ensurePage();
    const url = new URL(this.config.url);
    url.searchParams.set('anttest', 'agent');
    url.searchParams.set('scenario', scenario);
    url.searchParams.set('difficulty', difficulty);

    await this.page!.goto(url.toString(), { waitUntil: 'load', timeout: 120_000 });
    await this.page!.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await this.page!.waitForFunction(
      () => window.__agentReady === true
        && typeof window.__agentState === 'function'
        && typeof window.__agentStep === 'function',
      { timeout: 120_000 },
    );

    return this.observe();
  }

  async observe(): Promise<AgentState> {
    this.ensurePage();
    return this.page!.evaluate(() => window.__agentState!());
  }

  async command(commands: AgentCommand[]): Promise<CommandResult[]> {
    this.ensurePage();
    return this.page!.evaluate((cmds) => window.__agentCommand!(cmds), commands);
  }

  async step(ticks = 15, commands?: AgentCommand[]): Promise<StepResult> {
    this.ensurePage();
    return this.page!.evaluate(
      ({ n, cmds }) => window.__agentStep!(n, cmds),
      { n: ticks, cmds: commands },
    );
  }

  async screenshot(): Promise<Buffer> {
    this.ensurePage();
    return this.page!.screenshot({ type: 'png' }) as Promise<Buffer>;
  }

  async gameScreenshot(): Promise<string> {
    this.ensurePage();
    return this.page!.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
      return canvas?.toDataURL('image/png') ?? '';
    });
  }

  getLogs(): string[] {
    return [...this.consoleLogs];
  }

  getErrors(): string[] {
    return [...this.pageErrors];
  }

  private ensurePage(): void {
    if (!this.page) {
      throw new Error('TS agent adapter not connected');
    }
  }
}
