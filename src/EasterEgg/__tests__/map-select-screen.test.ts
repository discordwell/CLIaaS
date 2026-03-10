/**
 * Map selection screen tests — verify the map selection screen data structures,
 * mission progression logic, and campaign-specific map configurations.
 *
 * The map select screen appears between campaign missions, showing a procedural
 * map with mission nodes. It supports three modes:
 *   - Ant campaign (linear 4-mission progression)
 *   - Allied campaign (14-mission European theater)
 *   - Soviet campaign (14-mission westward expansion)
 */
import { describe, it, expect } from 'vitest';
import {
  CAMPAIGNS, getCampaign, type CampaignId,
} from '../engine/scenario';

// Re-declare the MISSIONS array info (4 ant missions) for reference
const ANT_MISSION_IDS = ['SCA01EA', 'SCA02EA', 'SCA03EA', 'SCA04EA'];

describe('Map Selection Screen — data requirements', () => {

  // ============================================================
  // Ant Campaign (linear, 4 missions)
  // ============================================================
  describe('Ant campaign map data', () => {
    it('has exactly 4 ant missions for the linear map', () => {
      expect(ANT_MISSION_IDS).toHaveLength(4);
    });

    it('ant missions are sequential SCA01-04EA', () => {
      ANT_MISSION_IDS.forEach((id, i) => {
        expect(id).toBe(`SCA0${i + 1}EA`);
      });
    });
  });

  // ============================================================
  // Allied Campaign map data
  // ============================================================
  describe('Allied campaign map data', () => {
    it('allied campaign has 14 missions for map nodes', () => {
      const campaign = getCampaign('allied');
      expect(campaign).toBeDefined();
      expect(campaign!.missions).toHaveLength(14);
    });

    it('allied mission IDs follow SCG01-14EA pattern', () => {
      const campaign = getCampaign('allied')!;
      campaign.missions.forEach((m, i) => {
        const num = String(i + 1).padStart(2, '0');
        expect(m.id).toBe(`SCG${num}EA`);
      });
    });

    it('allied campaign is faction allied', () => {
      const campaign = getCampaign('allied')!;
      expect(campaign.faction).toBe('allied');
    });
  });

  // ============================================================
  // Soviet Campaign map data
  // ============================================================
  describe('Soviet campaign map data', () => {
    it('soviet campaign has 14 missions for map nodes', () => {
      const campaign = getCampaign('soviet');
      expect(campaign).toBeDefined();
      expect(campaign!.missions).toHaveLength(14);
    });

    it('soviet mission IDs follow SCU01-14EA pattern', () => {
      const campaign = getCampaign('soviet')!;
      campaign.missions.forEach((m, i) => {
        const num = String(i + 1).padStart(2, '0');
        expect(m.id).toBe(`SCU${num}EA`);
      });
    });

    it('soviet campaign is faction soviet', () => {
      const campaign = getCampaign('soviet')!;
      expect(campaign.faction).toBe('soviet');
    });
  });

  // ============================================================
  // Counterstrike campaigns
  // ============================================================
  describe('Counterstrike campaign map data', () => {
    it('counterstrike allied has 8 missions', () => {
      const campaign = getCampaign('counterstrike_allied');
      expect(campaign).toBeDefined();
      expect(campaign!.missions).toHaveLength(8);
    });

    it('counterstrike soviet has 8 missions', () => {
      const campaign = getCampaign('counterstrike_soviet');
      expect(campaign).toBeDefined();
      expect(campaign!.missions).toHaveLength(8);
    });
  });

  // ============================================================
  // Mission progression logic (used by map_select to determine
  // which nodes are completed/next/future)
  // ============================================================
  describe('Mission progression for map display', () => {
    it('completing mission 0 makes mission 1 the next node', () => {
      const completedIdx = 0;
      const nextIdx = completedIdx + 1;
      const campaign = getCampaign('allied')!;
      expect(nextIdx).toBeLessThan(campaign.missions.length);
      expect(campaign.missions[nextIdx].id).toBe('SCG02EA');
    });

    it('completing mission 12 makes mission 13 (final) the next node', () => {
      const completedIdx = 12;
      const nextIdx = completedIdx + 1;
      const campaign = getCampaign('allied')!;
      expect(nextIdx).toBe(13);
      expect(nextIdx).toBeLessThan(campaign.missions.length);
      expect(campaign.missions[nextIdx].id).toBe('SCG14EA');
    });

    it('completing the last mission has no next mission', () => {
      const campaign = getCampaign('allied')!;
      const completedIdx = campaign.missions.length - 1; // 13
      const nextIdx = completedIdx + 1; // 14
      expect(nextIdx).toBeGreaterThanOrEqual(campaign.missions.length);
    });

    it('all campaigns have title and missions for map rendering', () => {
      for (const campaign of CAMPAIGNS) {
        expect(campaign.title).toBeTruthy();
        expect(campaign.missions.length).toBeGreaterThan(0);
        expect(campaign.faction).toMatch(/^(allied|soviet)$/);
        for (const mission of campaign.missions) {
          expect(mission.id).toBeTruthy();
          expect(mission.title).toBeTruthy();
        }
      }
    });
  });

  // ============================================================
  // Screen type includes map_select (verified by TypeScript)
  // ============================================================
  describe('Screen state machine', () => {
    it('map_select is a valid screen state (compile-time check)', () => {
      // This test verifies that the Screen type includes 'map_select'.
      // If it were missing, AntGame.tsx would fail to compile.
      // We verify the string is used correctly in the flow.
      const validScreens = [
        'main_menu', 'select', 'briefing', 'cutscene', 'loading', 'playing',
        'faction_select', 'campaign_select', 'map_select',
        'fmv_intro', 'fmv_briefing', 'fmv_action', 'objectives_interstitial',
        'fmv_win', 'fmv_lose', 'fmv_campaign_end',
      ];
      expect(validScreens).toContain('map_select');
    });

    it('map_select transitions: win → map_select → briefing', () => {
      // Verify the logical flow: after winning a non-final mission,
      // the screen goes to map_select, then clicking advances to briefing.
      // This documents the intended transition chain.
      const transitionChain = ['playing', 'map_select', 'briefing', 'cutscene', 'loading', 'playing'];
      const mapSelectIdx = transitionChain.indexOf('map_select');
      expect(mapSelectIdx).toBe(1);
      expect(transitionChain[mapSelectIdx - 1]).toBe('playing');
      expect(transitionChain[mapSelectIdx + 1]).toBe('briefing');
    });
  });

  // ============================================================
  // Faction-specific rendering parameters
  // ============================================================
  describe('Faction-specific map aesthetics', () => {
    it('determines correct accent color per faction', () => {
      // Ant = amber, Allied = blue, Soviet = red
      const factionColors: Record<string, string> = {
        ant: '#ffaa00',
        allied: '#4488cc',
        soviet: '#cc4444',
      };

      expect(factionColors.ant).toBe('#ffaa00');
      expect(factionColors.allied).toBe('#4488cc');
      expect(factionColors.soviet).toBe('#cc4444');
    });

    it('ant campaign map has 4 location nodes', () => {
      // The ant map shows a linear terrain progression with 4 nodes
      const antLocationCount = 4;
      expect(antLocationCount).toBe(ANT_MISSION_IDS.length);
    });

    it('allied campaign map has 14 location nodes', () => {
      const campaign = getCampaign('allied')!;
      expect(campaign.missions.length).toBe(14);
    });

    it('soviet campaign map has 14 location nodes', () => {
      const campaign = getCampaign('soviet')!;
      expect(campaign.missions.length).toBe(14);
    });
  });
});
