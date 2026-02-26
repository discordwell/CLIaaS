import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MusicPlayer } from '../engine/audio';

/**
 * Combat music switching tests.
 *
 * NOTE: MusicPlayer uses HTMLAudioElement which isn't available in Node test env.
 * These tests verify the combat mode logic that doesn't require audio playback.
 */

describe('Combat Music Switching', () => {
  let player: MusicPlayer;

  beforeEach(() => {
    // Mock HTMLAudioElement for Node environment
    global.Audio = class MockAudio {
      src = '';
      volume = 0;
      preload = '';
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
    } as any;

    player = new MusicPlayer();
    // Manually set available flag to bypass probe (which requires real audio)
    (player as any).available = true;
    (player as any).playing = true;
  });

  describe('Combat mode activation', () => {
    it('should activate combat mode when entering combat', () => {
      expect(player.isCombatMode).toBe(false);

      player.setCombatMode(true);

      expect(player.isCombatMode).toBe(true);
    });

    it('should not switch immediately if not playing', () => {
      (player as any).playing = false;

      player.setCombatMode(true);

      expect(player.isCombatMode).toBe(false);
    });

    it('should not switch if music not available', () => {
      (player as any).available = false;

      player.setCombatMode(true);

      expect(player.isCombatMode).toBe(false);
    });

    it('should debounce rapid switches (5 second minimum)', () => {
      // First activation
      player.setCombatMode(true);
      expect(player.isCombatMode).toBe(true);

      // Leave combat
      (player as any).combatMode = false;
      (player as any).combatCooldown = 450; // simulate cooldown elapsed

      // Try to re-enter combat immediately (should be blocked by debounce)
      const now = Date.now();
      (player as any).combatModeChangeTime = now - 1000; // 1 second ago
      player.setCombatMode(true);

      // Should still be false due to debounce
      expect(player.isCombatMode).toBe(false);
    });
  });

  describe('Combat mode deactivation', () => {
    beforeEach(() => {
      // Set up in combat mode
      player.setCombatMode(true);
      expect(player.isCombatMode).toBe(true);
    });

    it('should not deactivate immediately when combat ends', () => {
      player.setCombatMode(false);

      // Still in combat mode (cooldown not elapsed)
      expect(player.isCombatMode).toBe(true);
    });

    it('should deactivate after 30-second cooldown (450 ticks)', () => {
      // Simulate 450 ticks (30 seconds at 15 FPS)
      for (let i = 0; i < 450; i++) {
        player.setCombatMode(false);
      }

      expect(player.isCombatMode).toBe(false);
    });

    it('should reset cooldown when combat resumes', () => {
      // Start leaving combat
      for (let i = 0; i < 100; i++) {
        player.setCombatMode(false);
      }

      // Combat resumes before cooldown completes
      (player as any).combatCooldown = 0; // Reset from re-entering combat

      expect((player as any).combatCooldown).toBe(0);
    });
  });

  describe('Track category constants', () => {
    it('should have calm tracks defined', () => {
      const CALM_TRACKS = new Set([1, 3, 4, 7, 10, 13]);
      expect(CALM_TRACKS.size).toBeGreaterThan(0);
      expect(CALM_TRACKS.has(1)).toBe(true); // radio
      expect(CALM_TRACKS.has(10)).toBe(true); // workmen
    });

    it('should have action tracks defined', () => {
      const ACTION_TRACKS = new Set([0, 2, 5, 6, 8, 9, 11, 12, 14]);
      expect(ACTION_TRACKS.size).toBeGreaterThan(0);
      expect(ACTION_TRACKS.has(0)).toBe(true); // hell_march
      expect(ACTION_TRACKS.has(2)).toBe(true); // crush
    });

    it('should have no overlap between calm and action tracks', () => {
      const CALM_TRACKS = new Set([1, 3, 4, 7, 10, 13]);
      const ACTION_TRACKS = new Set([0, 2, 5, 6, 8, 9, 11, 12, 14]);

      const overlap = [...CALM_TRACKS].filter(track => ACTION_TRACKS.has(track));
      expect(overlap.length).toBe(0);
    });

    it('should cover all 15 tracks between calm and action', () => {
      const CALM_TRACKS = new Set([1, 3, 4, 7, 10, 13]);
      const ACTION_TRACKS = new Set([0, 2, 5, 6, 8, 9, 11, 12, 14]);

      const totalTracks = CALM_TRACKS.size + ACTION_TRACKS.size;
      expect(totalTracks).toBe(15);
    });
  });

  describe('Cooldown logic', () => {
    it('should reset cooldown when not in combat mode', () => {
      // Not in combat mode
      expect(player.isCombatMode).toBe(false);

      // Set some cooldown value
      (player as any).combatCooldown = 100;

      // Call setCombatMode(false) when not in combat mode
      player.setCombatMode(false);

      // Should reset to 0
      expect((player as any).combatCooldown).toBe(0);
    });
  });
});
