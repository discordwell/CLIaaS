/**
 * Pause menu tests — verify the interactive options menu that appears
 * when the game is paused (Escape/P). Covers menu open/close, keyboard
 * navigation, slider interaction, speed cycling, and settings persistence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal stubs matching the game's pause menu logic
function createMockGame() {
  const musicVolume = { value: 0.4 };
  const sfxVolume = { value: 0.35 };
  const muted = { value: false };

  const audio = {
    music: { pause: vi.fn(), resume: vi.fn() },
    getMusicVolume: () => musicVolume.value,
    setMusicVolume: (v: number) => { musicVolume.value = Math.max(0, Math.min(1, v)); },
    getSfxVolume: () => sfxVolume.value,
    setSfxVolume: (v: number) => { sfxVolume.value = Math.max(0, Math.min(1, v)); },
    isMuted: () => muted.value,
    toggleMute: () => { muted.value = !muted.value; return muted.value; },
  };

  const renderer = {
    showHelp: false,
    pauseMenuOpen: false,
    pauseMenuHighlight: 0,
    pauseMenuMusicVolume: 0.4,
    pauseMenuSfxVolume: 0.35,
    pauseMenuGameSpeed: 2,
    gameSpeed: 2,
    getPauseMenuHitAreas: () => [
      { x: 200, y: 140, w: 240, h: 24, type: 'button' as const, index: 0 },
      { x: 260, y: 164, w: 100, h: 24, type: 'slider' as const, index: 1 },
      { x: 260, y: 188, w: 100, h: 24, type: 'slider' as const, index: 2 },
      { x: 200, y: 212, w: 240, h: 24, type: 'button' as const, index: 3 },
      { x: 200, y: 236, w: 240, h: 24, type: 'button' as const, index: 4 },
      { x: 200, y: 260, w: 240, h: 24, type: 'button' as const, index: 5 },
    ],
    sliderValueFromClick: (x: number, area: { x: number; w: number }) =>
      Math.max(0, Math.min(1, (x - area.x) / area.w)),
  };

  return {
    state: 'playing' as string,
    pauseMenuOpen: false,
    pauseMenuHighlight: 0,
    gameSpeed: 2,
    turboMultiplier: 2,
    audio,
    renderer,
    onStateChange: null as ((s: string) => void) | null,
    onMenuAction: null as ((action: 'restart' | 'abort') => void) | null,

    togglePause() {
      if (this.state === 'playing') {
        this.state = 'paused';
        this.pauseMenuOpen = true;
        this.pauseMenuHighlight = 0;
        this.renderer.showHelp = false;
        this.audio.music.pause();
        this.onStateChange?.('paused');
      } else if (this.state === 'paused') {
        this.state = 'playing';
        this.pauseMenuOpen = false;
        this.audio.music.resume();
        this.onStateChange?.('playing');
      }
    },

    activatePauseMenuItem(index: number) {
      switch (index) {
        case 0: this.togglePause(); break;
        case 3:
          this.gameSpeed = this.gameSpeed === 1 ? 2 : this.gameSpeed === 2 ? 4 : 1;
          if (this.turboMultiplier <= 4) this.turboMultiplier = this.gameSpeed;
          this.saveSettings();
          break;
        case 4:
          this.pauseMenuOpen = false;
          this.onMenuAction?.('restart');
          break;
        case 5:
          this.pauseMenuOpen = false;
          this.onMenuAction?.('abort');
          break;
      }
    },

    processPauseMenuInput(keys: Set<string>, leftClick: { x: number; y: number } | null) {
      const itemCount = 6;

      if (keys.has('p') || keys.has('Escape')) {
        keys.delete('p');
        keys.delete('Escape');
        this.togglePause();
        return;
      }

      if (keys.has('ArrowUp')) {
        this.pauseMenuHighlight = (this.pauseMenuHighlight - 1 + itemCount) % itemCount;
        keys.delete('ArrowUp');
      }
      if (keys.has('ArrowDown')) {
        this.pauseMenuHighlight = (this.pauseMenuHighlight + 1) % itemCount;
        keys.delete('ArrowDown');
      }

      if (keys.has('ArrowLeft')) {
        if (this.pauseMenuHighlight === 1) {
          this.audio.setMusicVolume(this.audio.getMusicVolume() - 0.05);
          this.saveSettings();
        } else if (this.pauseMenuHighlight === 2) {
          this.audio.setSfxVolume(this.audio.getSfxVolume() - 0.05);
          this.saveSettings();
        }
        keys.delete('ArrowLeft');
      }
      if (keys.has('ArrowRight')) {
        if (this.pauseMenuHighlight === 1) {
          this.audio.setMusicVolume(this.audio.getMusicVolume() + 0.05);
          this.saveSettings();
        } else if (this.pauseMenuHighlight === 2) {
          this.audio.setSfxVolume(this.audio.getSfxVolume() + 0.05);
          this.saveSettings();
        }
        keys.delete('ArrowRight');
      }

      if (keys.has('Enter')) {
        keys.delete('Enter');
        this.activatePauseMenuItem(this.pauseMenuHighlight);
        return;
      }

      if (leftClick) {
        const hitAreas = this.renderer.getPauseMenuHitAreas();
        for (const area of hitAreas) {
          if (leftClick.x >= area.x && leftClick.x <= area.x + area.w &&
              leftClick.y >= area.y && leftClick.y <= area.y + area.h) {
            if (area.type === 'slider') {
              const val = this.renderer.sliderValueFromClick(leftClick.x, area);
              if (area.index === 1) this.audio.setMusicVolume(val);
              else if (area.index === 2) this.audio.setSfxVolume(val);
              this.pauseMenuHighlight = area.index;
              this.saveSettings();
            } else {
              this.pauseMenuHighlight = area.index;
              this.activatePauseMenuItem(area.index);
            }
            break;
          }
        }
      }
    },

    saveSettings() {
      const settings = {
        musicVolume: this.audio.getMusicVolume(),
        sfxVolume: this.audio.getSfxVolume(),
        muted: this.audio.isMuted(),
        gameSpeed: this.gameSpeed,
      };
      localStorage.setItem('antmissions_settings', JSON.stringify(settings));
    },
  };
}

describe('Pause menu', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v; },
      removeItem: (k: string) => { delete storage[k]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('menu opens on pause and closes on resume', () => {
    const game = createMockGame();
    expect(game.pauseMenuOpen).toBe(false);

    game.togglePause();
    expect(game.state).toBe('paused');
    expect(game.pauseMenuOpen).toBe(true);
    expect(game.pauseMenuHighlight).toBe(0);

    game.togglePause();
    expect(game.state).toBe('playing');
    expect(game.pauseMenuOpen).toBe(false);
  });

  it('help overlay closes when pause menu opens', () => {
    const game = createMockGame();
    game.renderer.showHelp = true;

    game.togglePause();
    expect(game.renderer.showHelp).toBe(false);
    expect(game.pauseMenuOpen).toBe(true);
  });

  it('resume via Escape key', () => {
    const game = createMockGame();
    game.togglePause();

    const keys = new Set(['Escape']);
    game.processPauseMenuInput(keys, null);

    expect(game.state).toBe('playing');
    expect(game.pauseMenuOpen).toBe(false);
  });

  it('resume via P key', () => {
    const game = createMockGame();
    game.togglePause();

    const keys = new Set(['p']);
    game.processPauseMenuInput(keys, null);

    expect(game.state).toBe('playing');
    expect(game.pauseMenuOpen).toBe(false);
  });

  it('music slider click sets correct volume', () => {
    const game = createMockGame();
    game.togglePause();

    // Click at 70% of slider track (x=260, w=100, so 260+70=330)
    game.processPauseMenuInput(new Set(), { x: 330, y: 175 });

    expect(game.audio.getMusicVolume()).toBeCloseTo(0.7, 1);
    expect(game.pauseMenuHighlight).toBe(1);
  });

  it('SFX slider click sets correct volume', () => {
    const game = createMockGame();
    game.togglePause();

    // Click at 50% of SFX slider (x=260, w=100, so 260+50=310)
    game.processPauseMenuInput(new Set(), { x: 310, y: 200 });

    expect(game.audio.getSfxVolume()).toBeCloseTo(0.5, 1);
    expect(game.pauseMenuHighlight).toBe(2);
  });

  it('game speed cycles 1→2→4→1', () => {
    const game = createMockGame();
    game.gameSpeed = 1;
    game.togglePause();

    // Activate speed item (index 3)
    game.pauseMenuHighlight = 3;
    game.activatePauseMenuItem(3);
    expect(game.gameSpeed).toBe(2);

    game.activatePauseMenuItem(3);
    expect(game.gameSpeed).toBe(4);

    game.activatePauseMenuItem(3);
    expect(game.gameSpeed).toBe(1);
  });

  it('restart fires onMenuAction callback', () => {
    const game = createMockGame();
    const actions: string[] = [];
    game.onMenuAction = (a) => actions.push(a);
    game.togglePause();

    game.activatePauseMenuItem(4); // RESTART
    expect(actions).toEqual(['restart']);
    expect(game.pauseMenuOpen).toBe(false);
  });

  it('abort fires onMenuAction callback', () => {
    const game = createMockGame();
    const actions: string[] = [];
    game.onMenuAction = (a) => actions.push(a);
    game.togglePause();

    game.activatePauseMenuItem(5); // ABORT
    expect(actions).toEqual(['abort']);
    expect(game.pauseMenuOpen).toBe(false);
  });

  it('keyboard nav: arrows change highlight, Enter activates', () => {
    const game = createMockGame();
    game.togglePause();

    // Navigate down twice
    game.processPauseMenuInput(new Set(['ArrowDown']), null);
    expect(game.pauseMenuHighlight).toBe(1);
    game.processPauseMenuInput(new Set(['ArrowDown']), null);
    expect(game.pauseMenuHighlight).toBe(2);

    // Navigate up wraps around
    game.pauseMenuHighlight = 0;
    game.processPauseMenuInput(new Set(['ArrowUp']), null);
    expect(game.pauseMenuHighlight).toBe(5);

    // Enter on Resume (index 0) resumes game
    game.pauseMenuHighlight = 0;
    game.processPauseMenuInput(new Set(['Enter']), null);
    expect(game.state).toBe('playing');
  });

  it('keyboard left/right adjusts slider volumes', () => {
    const game = createMockGame();
    game.togglePause();

    // Music slider (index 1)
    game.pauseMenuHighlight = 1;
    const initialMusic = game.audio.getMusicVolume();
    game.processPauseMenuInput(new Set(['ArrowRight']), null);
    expect(game.audio.getMusicVolume()).toBeCloseTo(initialMusic + 0.05, 2);

    game.processPauseMenuInput(new Set(['ArrowLeft']), null);
    expect(game.audio.getMusicVolume()).toBeCloseTo(initialMusic, 2);

    // SFX slider (index 2)
    game.pauseMenuHighlight = 2;
    const initialSfx = game.audio.getSfxVolume();
    game.processPauseMenuInput(new Set(['ArrowRight']), null);
    expect(game.audio.getSfxVolume()).toBeCloseTo(initialSfx + 0.05, 2);
  });

  it('settings persistence round-trip', () => {
    const game = createMockGame();
    game.audio.setMusicVolume(0.7);
    game.audio.setSfxVolume(0.3);
    game.gameSpeed = 4;
    game.saveSettings();

    const saved = JSON.parse(storage['antmissions_settings']);
    expect(saved.musicVolume).toBeCloseTo(0.7, 1);
    expect(saved.sfxVolume).toBeCloseTo(0.3, 1);
    expect(saved.gameSpeed).toBe(4);
    expect(saved.muted).toBe(false);
  });

  it('backward compat: old {volume} format applies to both music and sfx', () => {
    // Simulate old settings format
    storage['antmissions_settings'] = JSON.stringify({ volume: 0.6, muted: false });

    const saved = JSON.parse(storage['antmissions_settings']);
    // Verify old format shape
    expect(saved.volume).toBe(0.6);
    expect(saved.musicVolume).toBeUndefined();
    expect(saved.sfxVolume).toBeUndefined();

    // Simulate the backward-compat loading logic from AntGame.tsx
    const game = createMockGame();
    if (typeof saved.musicVolume === 'number') {
      game.audio.setMusicVolume(saved.musicVolume);
    } else if (typeof saved.volume === 'number') {
      game.audio.setMusicVolume(saved.volume);
    }
    if (typeof saved.sfxVolume === 'number') {
      game.audio.setSfxVolume(saved.sfxVolume);
    } else if (typeof saved.volume === 'number') {
      game.audio.setSfxVolume(saved.volume);
    }

    expect(game.audio.getMusicVolume()).toBeCloseTo(0.6, 1);
    expect(game.audio.getSfxVolume()).toBeCloseTo(0.6, 1);
  });

  it('hit area geometry: all 6 items with correct types', () => {
    const game = createMockGame();
    const areas = game.renderer.getPauseMenuHitAreas();

    expect(areas).toHaveLength(6);
    expect(areas[0].type).toBe('button'); // RESUME
    expect(areas[1].type).toBe('slider'); // MUSIC
    expect(areas[2].type).toBe('slider'); // SOUND
    expect(areas[3].type).toBe('button'); // SPEED
    expect(areas[4].type).toBe('button'); // RESTART
    expect(areas[5].type).toBe('button'); // ABORT

    // All hit areas have positive dimensions
    for (const area of areas) {
      expect(area.w).toBeGreaterThan(0);
      expect(area.h).toBeGreaterThan(0);
    }
  });

  it('resume button click resumes game', () => {
    const game = createMockGame();
    game.togglePause();

    // Click on Resume button (index 0)
    game.processPauseMenuInput(new Set(), { x: 320, y: 150 });

    expect(game.state).toBe('playing');
    expect(game.pauseMenuOpen).toBe(false);
  });
});
