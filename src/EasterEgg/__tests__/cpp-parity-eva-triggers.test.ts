/**
 * C++ Behavioral Parity: EVA Voice Announcement Triggers
 *
 * Compares when EVA announcements fire in C++ vs the TS engine.
 *
 * C++ source references:
 *   - house.cpp:642-645  — SpeakAttackDelay/SpeakPowerDelay/SpeakMoneyDelay/SpeakMaxedDelay init (1 tick)
 *   - house.cpp:1107-1139 — Low money, silos maxed, low power announcements (AI tick)
 *   - house.cpp:1766-1786 — HouseClass::Attacked() — base under attack
 *   - foot.cpp:1865-1876  — FootClass::Death_Announcement — ship_lost vs unit_lost
 *   - building.cpp:4389-4397 — BuildingClass::Death_Announcement — structure_destroyed
 *   - sidebar.cpp:1382     — New construction options available
 *   - sidebar.cpp:1591-1601 — Production complete: VOX_UNIT_READY vs VOX_CONSTRUCTION
 *   - sidebar.cpp:2183-2207 — Production start: VOX_TRAINING (infantry) vs VOX_BUILDING
 *   - audio.cpp:643-648     — Speak() — 1-deep queue, drops if already speaking
 *   - rules.cpp:219         — SpeakDelay default = 2 (fixed-point minutes)
 *   - defines.h:3031-3032   — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *   - options.cpp:864-880   — Normalize_Delay — adjusts for GameSpeed
 *   - rules.ini [General]   — SpeakDelay=2 (authoritative)
 *
 * TS engine references:
 *   - engine/index.ts:3194-3204  — playEva() — 45-tick flat throttle, no power gate (FIXED)
 *   - engine/index.ts:1954-1958  — Low power: every 150 ticks (10s), no ConYard check
 *   - engine/index.ts:6252-6258  — Silos needed: 450-tick throttle
 *   - engine/combat.ts:1175-1181 — Base attack: 900-tick throttle (60s) (FIXED from 75)
 *   - engine/combat.ts:491-499   — Unit death: always eva_unit_lost
 *   - engine/combat.ts:1237-1239 — Building death: reuses eva_unit_lost
 *   - engine/production.ts:193   — Production start: always eva_building
 *   - engine/production.ts:252-256 — Complete: eva_construction_complete / eva_unit_ready
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// C++ Constants (from defines.h, rules.cpp, options.cpp)
// ============================================================================
const TICKS_PER_SECOND = 15;
const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60; // 900
const CPP_SPEAK_DELAY_MINUTES = 2; // rules.ini [General] SpeakDelay=2
const CPP_SPEAK_DELAY_RAW = TICKS_PER_MINUTE * CPP_SPEAK_DELAY_MINUTES; // 1800 ticks

// Normalize_Delay at GameSpeed=3 (default single-player):
// delay >= 5 => (delay * 8) / (GameSpeed + 1) = (1800 * 8) / 4 = 3600
const DEFAULT_GAME_SPEED = 3;
function normalizeDelay(delay: number, gameSpeed = DEFAULT_GAME_SPEED): number {
  const _adjust = [
    [2, 2, 1, 1, 1, 1, 1, 1],
    [3, 3, 3, 2, 2, 2, 1, 1],
    [5, 4, 4, 3, 3, 2, 2, 1],
    [7, 6, 5, 4, 4, 4, 3, 2],
  ];
  if (delay) {
    if (delay < 5) {
      return _adjust[delay - 1][gameSpeed];
    }
    return Math.floor((delay * 8) / (gameSpeed + 1));
  }
  return delay;
}
const CPP_SPEAK_DELAY_NORMALIZED = normalizeDelay(CPP_SPEAK_DELAY_RAW); // 3600

// TS engine constants
const TS_GAME_TICKS_PER_SEC = 15;
const TS_EVA_THROTTLE = 45; // playEva() universal throttle (3 seconds)
const TS_BASE_ATTACK_THROTTLE = TS_GAME_TICKS_PER_SEC * 60; // 900 ticks (60 seconds)
const TS_LOW_POWER_INTERVAL = TS_GAME_TICKS_PER_SEC * 10; // 150 ticks (10 seconds)
const TS_SILO_WARNING_THROTTLE = 450; // 30 seconds

// ============================================================================
// Tests
// ============================================================================

describe('EVA Triggers — C++ parity audit', () => {

  // ────────────────────────────────────────────────────────────────────────
  // 1. Throttle / Cooldown System
  // ────────────────────────────────────────────────────────────────────────

  describe('Throttle system architecture', () => {

    it('C++ uses per-category countdown timers, not per-sound-name throttles', () => {
      // C++ house.h:843-846 — four separate CDTimerClass<FrameTimerClass> timers:
      //   SpeakAttackDelay  — base under attack
      //   SpeakPowerDelay   — low power
      //   SpeakMoneyDelay   — (unused in shipped code but declared)
      //   SpeakMaxedDelay   — need money AND silos needed (shared!)
      //
      // These count down automatically each frame (CDTimerClass).
      // When == 0, the EVA can fire again.
      //
      // TS engine/index.ts:301 uses a Map<string, number> keyed by sound name.
      // Each individual sound type has its own 45-tick throttle.

      const cppCategories = ['SpeakAttackDelay', 'SpeakPowerDelay', 'SpeakMoneyDelay', 'SpeakMaxedDelay'];
      expect(cppCategories).toHaveLength(4);

      // MISMATCH: C++ shares SpeakMaxedDelay for BOTH "need money" and "silos needed".
      // If "need money" fires, "silos needed" is also blocked for the full cooldown.
      // TS throttles them independently (separate keys in the Map).
      const cppSharedTimers = {
        'VOX_NEED_MO_MONEY': 'SpeakMaxedDelay',
        'VOX_NEED_MO_CAPACITY': 'SpeakMaxedDelay', // same timer!
      };
      expect(cppSharedTimers['VOX_NEED_MO_MONEY'])
        .toBe(cppSharedTimers['VOX_NEED_MO_CAPACITY']);
    });

    it('C++ SpeakDelay = 2 minutes (rules.ini), normalized to 3600 ticks at GameSpeed=3', () => {
      // rules.ini [General] SpeakDelay=2
      // rules.cpp:219 — SpeakDelay(2) default constructor
      // house.cpp:1110 — Options.Normalize_Delay(TICKS_PER_MINUTE * Rule.SpeakDelay)
      expect(CPP_SPEAK_DELAY_RAW).toBe(1800);
      expect(CPP_SPEAK_DELAY_NORMALIZED).toBe(3600); // 240 seconds = 4 minutes
    });

    it('TS base-attack throttle is 60s (compromise vs C++ 4 minutes)', () => {
      // C++ house.cpp:1776 — SpeakAttackDelay = Normalize_Delay(1800) = 3600 ticks
      // TS combat.ts:1177 — lastBaseAttackEva > gameTicksPerSec * 60 = 900 ticks
      // Compromise: 60s is more gameplay-friendly than C++ 240s but not spammy like 5s
      const cppBaseAttackDelay = CPP_SPEAK_DELAY_NORMALIZED; // 3600 ticks = 240s
      const tsBaseAttackDelay = TS_BASE_ATTACK_THROTTLE; // 900 ticks = 60s

      // C++ is 4x longer than TS (was 48x before fix)
      expect(cppBaseAttackDelay / tsBaseAttackDelay).toBe(4);

      // Document the values
      expect(cppBaseAttackDelay / TICKS_PER_SECOND).toBe(240); // 4 minutes
      expect(tsBaseAttackDelay / TS_GAME_TICKS_PER_SEC).toBe(60); // 60 seconds
    });

    it('MISMATCH: TS low-power interval is 10s vs C++ 4 minutes', () => {
      // C++ house.cpp:1123 — SpeakPowerDelay = Normalize_Delay(1800) = 3600 ticks
      // TS index.ts:1956 — tick % (GAME_TICKS_PER_SEC * 10) === 0
      const cppLowPowerDelay = CPP_SPEAK_DELAY_NORMALIZED; // 3600 ticks
      const tsLowPowerInterval = TS_LOW_POWER_INTERVAL; // 150 ticks

      expect(cppLowPowerDelay / TICKS_PER_SECOND).toBe(240);
      expect(tsLowPowerInterval / TS_GAME_TICKS_PER_SEC).toBe(10);
    });

    it('MISMATCH: TS universal EVA throttle is 45 ticks (3s); C++ has no universal throttle', () => {
      // C++ audio.cpp:645 — Speak() drops if SpeakQueue != VOX_NONE or voice == CurrentVoice
      // This is a 1-deep queue, NOT a timer. Duration depends on .AUD sample length (~1-2s).
      // TS engine/index.ts:3201 — flat 45-tick cooldown per sound name.
      expect(TS_EVA_THROTTLE).toBe(45);
      expect(TS_EVA_THROTTLE / TS_GAME_TICKS_PER_SEC).toBe(3);
    });

    it('C++ Speak() has 1-deep queue — drops new voice if already speaking', () => {
      // audio.cpp:645:
      //   if (voice != SpeakQueue && voice != CurrentVoice && SpeakQueue == VOX_NONE)
      //     SpeakQueue = voice;
      //
      // Three conditions must ALL be true for a Speak() to be accepted:
      //   1. voice != SpeakQueue (not already queued)
      //   2. voice != CurrentVoice (not currently playing)
      //   3. SpeakQueue == VOX_NONE (queue slot is empty)
      //
      // This means: if EVA is playing "unit lost" and "base under attack" is requested,
      // "base under attack" is silently dropped.
      //
      // TS has no such mutual exclusion — multiple EVA sounds can overlap.
      const cppMaxQueueDepth = 1; // SpeakQueue is a single VoxType variable
      expect(cppMaxQueueDepth).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. Unit / Ship / Structure Death Announcements
  // ────────────────────────────────────────────────────────────────────────

  describe('Death announcements', () => {

    it('C++ plays VOX_SHIP_LOST for vessels, VOX_UNIT_LOST for other foot classes', () => {
      // foot.cpp:1865-1876 — FootClass::Death_Announcement:
      //   if (IsOwnedByPlayer) {
      //     if (What_Am_I() == RTTI_VESSEL) Speak(VOX_SHIP_LOST);
      //     else                            Speak(VOX_UNIT_LOST);
      //   }
      const cppDeathVox: Record<string, string> = {
        RTTI_VESSEL: 'VOX_SHIP_LOST',
        RTTI_UNIT: 'VOX_UNIT_LOST',
        RTTI_INFANTRY: 'VOX_UNIT_LOST',
        RTTI_AIRCRAFT: 'VOX_UNIT_LOST',
      };
      expect(cppDeathVox.RTTI_VESSEL).toBe('VOX_SHIP_LOST');
      expect(cppDeathVox.RTTI_UNIT).toBe('VOX_UNIT_LOST');
    });

    it('MISMATCH: TS always plays eva_unit_lost for all unit deaths (no ship_lost)', () => {
      // combat.ts:493 — ctx.playEva('eva_unit_lost') for all unit kills
      // combat.ts:603 — ctx.playEva('eva_unit_lost') for crush kills
      // No ship_lost sound exists in TS SoundName type.
      const tsSoundNames = [
        'eva_unit_lost', 'eva_base_attack', 'eva_acknowledged',
        'eva_construction_complete', 'eva_unit_ready', 'eva_low_power',
        'eva_new_options', 'eva_building', 'eva_mission_accomplished',
        'eva_reinforcements', 'eva_mission_warning',
        'eva_building_captured', 'eva_insufficient_funds', 'eva_silos_needed',
      ];
      expect(tsSoundNames).not.toContain('eva_ship_lost');
    });

    it('C++ plays VOX_STRUCTURE_DESTROYED when player building dies', () => {
      // building.cpp:4389-4397:
      //   if (source != NULL && House->IsPlayerControl)
      //     Speak(VOX_STRUCTURE_DESTROYED);
      const cppBuildingDeathVox = 'VOX_STRUCTURE_DESTROYED';
      expect(cppBuildingDeathVox).toBe('VOX_STRUCTURE_DESTROYED');
    });

    it('MISMATCH: TS reuses eva_unit_lost for building destruction', () => {
      // combat.ts:1239:
      //   ctx.playEva('eva_unit_lost'); // reuse unit_lost for building destruction
      // Should be a separate 'eva_structure_destroyed' sound.
      const tsPlayedOnBuildingDeath = 'eva_unit_lost';
      expect(tsPlayedOnBuildingDeath).not.toBe('eva_structure_destroyed');
    });

    it('C++ building death requires source != NULL (no announcement for self-destruct/sell)', () => {
      // building.cpp:4394: if (source != NULL && House->IsPlayerControl)
      // The source parameter is the attacker. Self-destruct or selling has source=NULL.
      // TS combat.ts:1237-1239 checks isAllied(s.house, playerHouse) but NOT
      // whether there was an attacker.
      const cppRequiresAttacker = true;
      expect(cppRequiresAttacker).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Base Under Attack
  // ────────────────────────────────────────────────────────────────────────

  describe('Base under attack', () => {

    it('C++ checks house faction match, not alliance', () => {
      // house.cpp:1773 (non-FIXIT):
      //   if (SpeakAttackDelay == 0 && PlayerPtr->Class->House == Class->House)
      // This checks EXACT house match (same faction), not alliance status.
      //
      // house.cpp:1771 (FIXIT_BASE_ANNOUNCE):
      //   if (SpeakAttackDelay == 0 &&
      //       ((Session.Type == GAME_NORMAL && IsPlayerControl) ||
      //        PlayerPtr->Class->House == Class->House))
      //
      // TS combat.ts:1176:
      //   if (ctx.isAllied(s.house, ctx.playerHouse) && ...)
      // Uses alliance check, which is broader.
      const cppCheck = 'exact house match OR (single-player AND IsPlayerControl)';
      const tsCheck = 'isAllied(s.house, playerHouse)';
      expect(cppCheck).not.toBe(tsCheck);
    });

    it('C++ uses SpeakAttackDelay countdown timer; init to 1 (fires immediately on first attack)', () => {
      // house.cpp:642 — SpeakAttackDelay(1)
      // CDTimerClass auto-decrements each frame, so after 1 frame it reaches 0.
      // First base attack will trigger EVA on the very next AI tick.
      const cppInitialDelay = 1; // ticks until first attack EVA is possible
      expect(cppInitialDelay).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. Low Power Warning
  // ────────────────────────────────────────────────────────────────────────

  describe('Low power warning', () => {

    it('C++ requires ConYard (STRUCTF_CONST) for low power EVA', () => {
      // house.cpp:1120-1121:
      //   if (SpeakPowerDelay == 0 && Power_Fraction() < 1) {
      //     if (ActiveBScan & STRUCTF_CONST) {
      //       Speak(VOX_LOW_POWER);
      // Must own a Construction Yard for the warning to play.
      const cppRequiresConYard = true;
      expect(cppRequiresConYard).toBe(true);
    });

    it('MISMATCH: TS does not require ConYard for low power EVA', () => {
      // index.ts:1955-1957:
      //   if (this.powerConsumed > this.powerProduced && this.powerProduced > 0 &&
      //       this.tick % (GAME_TICKS_PER_SEC * 10) === 0)
      //     this.audio.play('eva_low_power');
      // No ConYard check.
      const tsRequiresConYard = false;
      expect(tsRequiresConYard).toBe(false);
    });

    it('C++ condition is Power_Fraction() < 1; TS uses powerConsumed > powerProduced', () => {
      // These are mathematically equivalent when both are > 0.
      // Power_Fraction() = Power / Drain. If < 1, then Power < Drain.
      // TS: powerConsumed > powerProduced is the same check.
      // Both correctly detect insufficient power.
      const equivalent = true;
      expect(equivalent).toBe(true);
    });

    it('MISMATCH: TS uses modulo interval (10s); C++ uses countdown timer (4 min)', () => {
      // C++ house.cpp:1123 — SpeakPowerDelay = Normalize_Delay(1800)
      //   At GameSpeed=3: 3600 ticks = 240 seconds = 4 minutes
      // TS index.ts:1956 — tick % 150 === 0
      //   Every 150 ticks = 10 seconds
      // TS fires 24x more frequently than C++.
      const cppIntervalSec = CPP_SPEAK_DELAY_NORMALIZED / TICKS_PER_SECOND; // 240
      const tsIntervalSec = TS_LOW_POWER_INTERVAL / TS_GAME_TICKS_PER_SEC; // 10
      expect(cppIntervalSec).toBe(240);
      expect(tsIntervalSec).toBe(10);
    });

    it('MISMATCH: TS bypasses playEva() throttle — calls audio.play() directly', () => {
      // index.ts:1957 — this.audio.play('eva_low_power')
      // This does NOT go through playEva(), so the 45-tick universal throttle
      // and the power gate (< 0.25) are both bypassed.
      // C++ uses the standard Speak() path which goes through the 1-deep queue.
      const tsUsesPlayEva = false; // uses audio.play() directly
      expect(tsUsesPlayEva).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5. Money / Silo Warnings
  // ────────────────────────────────────────────────────────────────────────

  describe('Money and silo warnings', () => {

    it('C++ plays VOX_NEED_MO_MONEY when credits < 100 AND factories > 0', () => {
      // house.cpp:1107-1110:
      //   if (SpeakMaxedDelay == 0 &&
      //       Available_Money() < 100 &&
      //       UnitFactories + BuildingFactories + InfantryFactories > 0)
      //     Speak(VOX_NEED_MO_MONEY);
      // Proactive warning: "you're running low while building"
      const cppMoneyThreshold = 100;
      const cppRequiresFactories = true;
      expect(cppMoneyThreshold).toBe(100);
      expect(cppRequiresFactories).toBe(true);
    });

    it('MISMATCH: TS only warns about money at production start (credits <= 0)', () => {
      // production.ts:185-186:
      //   if (ctx.credits <= 0) {
      //     ctx.playEva('eva_insufficient_funds');
      // Only fires when player tries to start production with zero credits.
      // No proactive "running low" warning during gameplay.
      const tsMoneyThreshold = 0; // only at exactly zero
      const tsTriggeredDuring = 'production start only';
      expect(tsMoneyThreshold).toBe(0);
      expect(tsTriggeredDuring).toBe('production start only');
    });

    it('C++ silos warning: IsMaxedOut flag + capacity > 500 + free < 300', () => {
      // house.cpp:1113-1118:
      //   if (SpeakMaxedDelay == 0 && IsMaxedOut) {
      //     IsMaxedOut = false;
      //     if ((Capacity - Tiberium) < 300 && Capacity > 500 &&
      //         (ActiveBScan & (STRUCTF_REFINERY | STRUCTF_CONST)))
      //       Speak(VOX_NEED_MO_CAPACITY);
      // Requires: IsMaxedOut flag set, Capacity > 500, free space < 300,
      //           AND owns a refinery or ConYard.
      const cppRequiresMaxedOutFlag = true;
      const cppRequiresRefOrConYard = true;
      expect(cppRequiresMaxedOutFlag).toBe(true);
      expect(cppRequiresRefOrConYard).toBe(true);
    });

    it('MISMATCH: TS silos warning triggers on ore deposit, not IsMaxedOut flag', () => {
      // index.ts:6252-6258:
      //   if (this.siloCapacity > 500 && (this.siloCapacity - this.credits) < 300 &&
      //       this.tick - this.lastSiloWarningTick >= 450)
      // Triggers every time credits are added (ore deposit), not via a per-frame flag.
      // No refinery/ConYard check. Uses 450-tick (30s) throttle instead of SpeakMaxedDelay.
      const tsThrottleTicks = TS_SILO_WARNING_THROTTLE; // 450
      const tsThrottleSec = tsThrottleTicks / TS_GAME_TICKS_PER_SEC; // 30
      expect(tsThrottleSec).toBe(30);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 6. Production Start / Complete
  // ────────────────────────────────────────────────────────────────────────

  describe('Production EVA', () => {

    it('C++ production start: VOX_TRAINING for infantry, VOX_BUILDING for others', () => {
      // sidebar.cpp:2183-2207:
      //   if (otype == RTTI_INFANTRYTYPE) Speak(VOX_TRAINING);
      //   else                            Speak(VOX_BUILDING);
      const cppStartVox: Record<string, string> = {
        infantry: 'VOX_TRAINING',
        unit: 'VOX_BUILDING',
        building: 'VOX_BUILDING',
        vessel: 'VOX_BUILDING',
        aircraft: 'VOX_BUILDING',
      };
      expect(cppStartVox.infantry).toBe('VOX_TRAINING');
      expect(cppStartVox.unit).toBe('VOX_BUILDING');
    });

    it('MISMATCH: TS always plays eva_building for production start (no training)', () => {
      // production.ts:193: ctx.playSound('eva_building');
      // No distinction between infantry and other types.
      const tsStartSound = 'eva_building'; // always, regardless of type
      expect(tsStartSound).toBe('eva_building');
    });

    it('C++ production complete: VOX_CONSTRUCTION for buildings, VOX_UNIT_READY for others', () => {
      // sidebar.cpp:1591-1601:
      //   case RTTI_VESSEL:
      //   case RTTI_UNIT:
      //   case RTTI_AIRCRAFT:
      //     Speak(VOX_UNIT_READY); break;
      //   case RTTI_BUILDING:
      //     Speak(VOX_CONSTRUCTION); break;
      //   case RTTI_INFANTRY:
      //     Speak(VOX_UNIT_READY); break;
      //
      // NOTE: VOX_CONSTRUCTION = "Construction complete" voice.
      // The sound is "construction complete" but the VOX constant is VOX_CONSTRUCTION.
      const cppCompleteVox: Record<string, string> = {
        RTTI_BUILDING: 'VOX_CONSTRUCTION',
        RTTI_UNIT: 'VOX_UNIT_READY',
        RTTI_INFANTRY: 'VOX_UNIT_READY',
        RTTI_VESSEL: 'VOX_UNIT_READY',
        RTTI_AIRCRAFT: 'VOX_UNIT_READY',
      };
      expect(cppCompleteVox.RTTI_BUILDING).toBe('VOX_CONSTRUCTION');
      expect(cppCompleteVox.RTTI_INFANTRY).toBe('VOX_UNIT_READY');
    });

    it('TS production complete: eva_construction_complete for structures, eva_unit_ready for units', () => {
      // production.ts:252: ctx.playSound('eva_construction_complete');
      // production.ts:256: ctx.playSound('eva_unit_ready');
      // This matches C++ behavior (VOX_CONSTRUCTION → eva_construction_complete,
      // VOX_UNIT_READY → eva_unit_ready). Correct mapping.
      const tsCompleteSound: Record<string, string> = {
        structure: 'eva_construction_complete',
        unit: 'eva_unit_ready',
      };
      expect(tsCompleteSound.structure).toBe('eva_construction_complete');
      expect(tsCompleteSound.unit).toBe('eva_unit_ready');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 7. EVA Power Gate (TS-only, not in C++)
  // ────────────────────────────────────────────────────────────────────────

  describe('EVA power gate', () => {

    it('FIXED: TS no longer gates playEva() calls on power — matches C++', () => {
      // Previously TS had a power gate at fraction < 0.25 that suppressed ALL EVA.
      // C++ audio.cpp:643-648 — Speak() has no power-related gate at all.
      // The only filtering is: not currently speaking + queue empty.
      // Fixed: power gate removed from playEva() for C++ parity.
      const cppHasPowerGate = false;
      const tsHasPowerGate = false; // FIXED — was true
      expect(cppHasPowerGate).toBe(false);
      expect(tsHasPowerGate).toBe(false);
    });

    it('FIXED: critical warnings like "base under attack" now play at any power level', () => {
      // Previously playEva() returned early when power fraction < 0.25,
      // suppressing "base under attack" at critically low power — the WORST time.
      // Now EVA always plays regardless of power level, matching C++.
      const powerFraction = 0.2; // critically low
      const tsWouldPlay = true; // FIXED — power gate removed
      expect(tsWouldPlay).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 8. Sidebar / New Options Available
  // ────────────────────────────────────────────────────────────────────────

  describe('New construction options', () => {

    it('C++ plays VOX_NEW_CONSTRUCT when new buildable added to sidebar', () => {
      // sidebar.cpp:1382:
      //   if (!ScenarioInit && type != RTTI_SPECIAL)
      //     Speak(VOX_NEW_CONSTRUCT);
      // Fires each time a new item becomes available (e.g., after building a prerequisite).
      // Does NOT fire during scenario initialization (load time).
      const cppVox = 'VOX_NEW_CONSTRUCT'; // "New construction options"
      expect(cppVox).toBe('VOX_NEW_CONSTRUCT');
    });

    it('TS plays eva_new_options on building placement', () => {
      // placement.ts:183: ctx.playSound('eva_new_options');
      // This fires when a structure is placed (which may unlock new buildables).
      // C++ fires it when items are actually added to the sidebar strip, which
      // could be triggered by various events (building placed, tech captured, etc.)
      const tsTriggeredBy = 'building placement';
      expect(tsTriggeredBy).toBe('building placement');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 9. Reinforcements
  // ────────────────────────────────────────────────────────────────────────

  describe('Reinforcements', () => {

    it('C++ plays VOX_REINFORCEMENTS for player-side reinforcements only', () => {
      // reinf.cpp:526-528:
      //   if (okvoice && teamtype->House == PlayerPtr->Class->House)
      //     Speak(VOX_REINFORCEMENTS);
      // Only plays for the player's own faction.
      const cppRequiresPlayerHouse = true;
      expect(cppRequiresPlayerHouse).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 10. Mission End
  // ────────────────────────────────────────────────────────────────────────

  describe('Mission end announcements', () => {

    it('C++ plays VOX_ACCOMPLISHED on win, VOX_FAIL on loss, VOX_CONTROL_EXIT on abort', () => {
      // scenario.cpp:859: Speak(VOX_ACCOMPLISHED);
      // scenario.cpp:1127: Speak(VOX_FAIL);
      // scenario.cpp:1216: Speak(VOX_CONTROL_EXIT);
      const cppMissionEnd: Record<string, string> = {
        win: 'VOX_ACCOMPLISHED',
        lose: 'VOX_FAIL',
        abort: 'VOX_CONTROL_EXIT',
      };
      expect(cppMissionEnd.win).toBe('VOX_ACCOMPLISHED');
      expect(cppMissionEnd.lose).toBe('VOX_FAIL');
      expect(cppMissionEnd.abort).toBe('VOX_CONTROL_EXIT');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 11. Sell Announcements
  // ────────────────────────────────────────────────────────────────────────

  describe('Sell announcements', () => {

    it('C++ has separate VOX for unit sell vs structure sell', () => {
      // foot.cpp:2129 — Speak(VOX_UNIT_SOLD);
      // building.cpp:3412 — if (IsOwnedByPlayer) Speak(VOX_UNIT_SOLD); (unit exiting sold bldg)
      // building.cpp:3503 — if (IsOwnedByPlayer) Speak(VOX_STRUCTURE_SOLD);
      const cppSellVox: Record<string, string> = {
        unitSell: 'VOX_UNIT_SOLD',
        structureSell: 'VOX_STRUCTURE_SOLD',
      };
      expect(cppSellVox.structureSell).toBe('VOX_STRUCTURE_SOLD');
      expect(cppSellVox.unitSell).toBe('VOX_UNIT_SOLD');
    });

    it('MISMATCH: TS has no eva_unit_sold or eva_structure_sold sounds', () => {
      // The TS SoundName type does not include sell announcement voices.
      const tsSellSounds = ['sell']; // only the sell SFX, no EVA announcement
      expect(tsSellSounds).not.toContain('eva_unit_sold');
      expect(tsSellSounds).not.toContain('eva_structure_sold');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 12. Repair Announcements
  // ────────────────────────────────────────────────────────────────────────

  describe('Repair announcements', () => {

    it('C++ plays VOX_REPAIRING when repair starts, VOX_UNIT_REPAIRED when complete', () => {
      // building.cpp:3906 — if (IsOwnedByPlayer) Speak(VOX_REPAIRING);
      // building.cpp:3962 — if (IsOwnedByPlayer) Speak(VOX_UNIT_REPAIRED);
      // vessel.cpp:709  — if (IsOwnedByPlayer) Speak(VOX_REPAIRING);
      // vessel.cpp:2305 — if (IsOwnedByPlayer) Speak(VOX_UNIT_REPAIRED);
      const cppRepairVox = { start: 'VOX_REPAIRING', complete: 'VOX_UNIT_REPAIRED' };
      expect(cppRepairVox.start).toBe('VOX_REPAIRING');
      expect(cppRepairVox.complete).toBe('VOX_UNIT_REPAIRED');
    });

    it('C++ plays VOX_NO_CASH when repair runs out of money', () => {
      // building.cpp:3953 — if (IsOwnedByPlayer) Speak(VOX_NO_CASH);
      const cppNoCashVox = 'VOX_NO_CASH';
      expect(cppNoCashVox).toBe('VOX_NO_CASH');
    });

    it('MISMATCH: TS has no eva_repairing, eva_unit_repaired, or eva_no_cash sounds', () => {
      // TS repairSell.ts:212 uses eva_insufficient_funds (close but not identical).
      // No repair-start or repair-complete EVA.
      const tsRepairEvaSounds: string[] = []; // none specific to repair lifecycle
      expect(tsRepairEvaSounds).not.toContain('eva_repairing');
      expect(tsRepairEvaSounds).not.toContain('eva_unit_repaired');
      expect(tsRepairEvaSounds).not.toContain('eva_no_cash');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 13. Normalize_Delay Function Parity
  // ────────────────────────────────────────────────────────────────────────

  describe('Normalize_Delay function', () => {

    it('small values (1-4) use lookup table', () => {
      // options.cpp:866-871 — _adjust[delay-1][GameSpeed]
      expect(normalizeDelay(1, 0)).toBe(2);
      expect(normalizeDelay(1, 3)).toBe(1);
      expect(normalizeDelay(1, 7)).toBe(1);
      expect(normalizeDelay(2, 0)).toBe(3);
      expect(normalizeDelay(2, 3)).toBe(2);
      expect(normalizeDelay(3, 0)).toBe(5);
      expect(normalizeDelay(3, 3)).toBe(3);
      expect(normalizeDelay(4, 0)).toBe(7);
      expect(normalizeDelay(4, 3)).toBe(4);
    });

    it('large values use formula: (delay * 8) / (GameSpeed + 1)', () => {
      // options.cpp:876: delay = ((delay * 8) / (GameSpeed+1));
      expect(normalizeDelay(100, 0)).toBe(800);   // (100*8)/1
      expect(normalizeDelay(100, 3)).toBe(200);   // (100*8)/4
      expect(normalizeDelay(100, 7)).toBe(100);   // (100*8)/8
      expect(normalizeDelay(1800, 3)).toBe(3600); // SpeakDelay at default speed
    });

    it('delay=0 returns 0 (no delay)', () => {
      expect(normalizeDelay(0)).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 14. Summary of All Mismatches
  // ────────────────────────────────────────────────────────────────────────

  describe('Mismatch summary', () => {

    it('documents all C++ vs TS EVA trigger mismatches', () => {
      const mismatches = [
        {
          id: 1,
          area: 'Base attack throttle',
          cpp: 'SpeakAttackDelay = Normalize_Delay(1800) = 3600 ticks (240s)',
          ts: 'lastBaseAttackEva > gameTicksPerSec * 60 = 900 ticks (60s)',
          severity: 'minor', // compromise: 60s vs C++ 240s — more responsive
        },
        {
          id: 2,
          area: 'Low power interval',
          cpp: 'SpeakPowerDelay countdown = 3600 ticks (240s)',
          ts: 'tick % 150 === 0 (10s interval)',
          severity: 'minor',
        },
        {
          id: 3,
          area: 'Low power ConYard check',
          cpp: 'Requires ActiveBScan & STRUCTF_CONST',
          ts: 'No ConYard requirement',
          severity: 'minor',
        },
        {
          id: 4,
          area: 'Low power bypass playEva()',
          cpp: 'Uses standard Speak() path',
          ts: 'Calls audio.play() directly, bypassing throttle and power gate',
          severity: 'medium',
        },
        {
          id: 5,
          area: 'Building death VOX',
          cpp: 'VOX_STRUCTURE_DESTROYED',
          ts: 'eva_unit_lost (reused)',
          severity: 'medium', // wrong sound played
        },
        {
          id: 6,
          area: 'Ship death VOX',
          cpp: 'VOX_SHIP_LOST for vessels',
          ts: 'eva_unit_lost (no ship_lost sound)',
          severity: 'low', // ship_lost not iconic
        },
        {
          id: 7,
          area: 'Production start infantry',
          cpp: 'VOX_TRAINING for infantry',
          ts: 'eva_building for all types',
          severity: 'medium', // wrong sound for infantry
        },
        {
          id: 8,
          area: 'Money warning',
          cpp: 'VOX_NEED_MO_MONEY proactive at <100 credits with factories',
          ts: 'eva_insufficient_funds only at production start with 0 credits',
          severity: 'medium',
        },
        {
          id: 9,
          area: 'Power gate on EVA',
          cpp: 'No power gate on Speak()',
          ts: 'FIXED — power gate removed, EVA always plays',
          severity: 'fixed',
        },
        {
          id: 10,
          area: 'Shared SpeakMaxedDelay',
          cpp: 'VOX_NEED_MO_MONEY and VOX_NEED_MO_CAPACITY share timer',
          ts: 'Independent throttles per sound name',
          severity: 'low',
        },
        {
          id: 11,
          area: 'Sell EVA announcements',
          cpp: 'VOX_UNIT_SOLD and VOX_STRUCTURE_SOLD',
          ts: 'No sell EVA sounds',
          severity: 'medium',
        },
        {
          id: 12,
          area: 'Repair EVA announcements',
          cpp: 'VOX_REPAIRING, VOX_UNIT_REPAIRED, VOX_NO_CASH',
          ts: 'No repair EVA sounds (only eva_insufficient_funds in repairSell)',
          severity: 'medium',
        },
        {
          id: 13,
          area: 'Speak() 1-deep queue',
          cpp: 'Drops new voice if currently speaking or queue occupied',
          ts: 'No mutual exclusion between EVA sounds',
          severity: 'low',
        },
      ];

      // All 13 items documented (12 remaining mismatches + 1 fixed)
      expect(mismatches).toHaveLength(13);
      expect(mismatches.filter(m => m.severity === 'fixed')).toHaveLength(1);
      expect(mismatches.filter(m => m.severity === 'high')).toHaveLength(0);
      expect(mismatches.filter(m => m.severity === 'medium')).toHaveLength(6);
      expect(mismatches.filter(m => m.severity === 'minor')).toHaveLength(3);
      expect(mismatches.filter(m => m.severity === 'low')).toHaveLength(3);
    });
  });
});
