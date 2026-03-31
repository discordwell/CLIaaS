/**
 * Scenario loader — parses extracted INI files and sets up the game state.
 * Reads unit placements, waypoints, team types, and triggers from SCA01-04EA.INI.
 */

import {
  type CellPos, type UnitStats, type WeaponStats, type ArmorType,
  CELL_SIZE, cellIndexToPos, cellToWorld, worldToCell,
  House, Mission, UnitType, AnimState, Dir,
  CIVILIAN_UNIT_TYPES,
  UNIT_STATS,
} from './types';
import { buildScenarioRuleOverrides } from './scenarioRules';
import { Entity } from './entity';
import { GameMap, Terrain, TREE_OCCUPY, TREE_MAX_HP, type MapTree } from './map';
import { type TilesetMeta, type AssetManager } from './assets';
import { nearbyLocation } from './pathfinding';
import { ScenarioRandom } from './random';

// === RA Trigger/Team System (from TRIGGER.CPP, TEAMTYPE.CPP) ===

// Trigger event types (TEventType — from TEVENT.H:46-83, C++ enum order)
const TEVENT_NONE = 0;
const TEVENT_PLAYER_ENTERED = 1;
const TEVENT_SPIED = 2;                   // TR3/TR5: spy infiltrated building (C++ TEVENT_SPIED)
const TEVENT_THIEVED = 3;                 // TR5: fixed index (was 17, C++ = 3)
const TEVENT_DISCOVERED = 4;
const TEVENT_HOUSE_DISCOVERED = 5;        // TR5: fixed index (was 3, C++ = 5)
const TEVENT_ATTACKED = 6;
const TEVENT_DESTROYED = 7;
const TEVENT_ANY = 8;
const TEVENT_UNITS_DESTROYED = 9;         // TR5: fixed index (was 26, C++ = 9) — all house's units destroyed
const TEVENT_BUILDINGS_DESTROYED = 10;    // TR3: all house's buildings destroyed (C++ = 10)
const TEVENT_ALL_DESTROYED = 11;
const TEVENT_CREDITS = 12;               // TR5: fixed index (was 30, C++ = 12)
const TEVENT_TIME = 13;
const TEVENT_MISSION_TIMER_EXPIRED = 14;
const TEVENT_NBUILDINGS_DESTROYED = 15;   // TR3/TR5: N buildings destroyed (C++ = 15)
const TEVENT_NUNITS_DESTROYED = 16;
const TEVENT_NOFACTORIES = 17;            // TR3/TR5: no factories remaining (C++ = 17)
const TEVENT_EVAC_CIVILIAN = 18;          // TR3: civilian evacuated
const TEVENT_BUILD = 19;
const TEVENT_BUILD_UNIT = 20;             // TR3: specified unit built (C++ TEVENT_BUILD_UNIT)
const TEVENT_BUILD_INFANTRY = 21;         // TR3/TR5: infantry built (C++ = 21)
const TEVENT_BUILD_AIRCRAFT = 22;         // TR3/TR5: aircraft built (C++ = 22)
const TEVENT_LEAVES_MAP = 23;
const TEVENT_ENTERS_ZONE = 24;
const TEVENT_CROSS_HORIZONTAL = 25;       // TR5: fixed index (was 21, C++ = 25)
const TEVENT_CROSS_VERTICAL = 26;         // TR5: fixed index (was 22, C++ = 26)
export const TEVENT_GLOBAL_SET = 27;
export const TEVENT_GLOBAL_CLEAR = 28;
const TEVENT_FAKES_DESTROYED = 29;        // TR3: all fake structures destroyed
const TEVENT_LOW_POWER = 30;              // TR5: fixed index (was 15, C++ = 30)
const TEVENT_ALL_BRIDGES_DESTROYED = 31;
const TEVENT_BUILDING_EXISTS = 32;

// Trigger action types (TActionType — from TACTION.H, C++ enum order)
const TACTION_NONE = 0;
const TACTION_WIN = 1;
const TACTION_LOSE = 2;
const TACTION_BEGIN_PRODUCTION = 3;
const TACTION_CREATE_TEAM = 4;
const TACTION_DESTROY_TEAM = 5;
const TACTION_ALL_HUNT = 6;
const TACTION_REINFORCEMENTS = 7;
const TACTION_DZ = 8;
const TACTION_FIRE_SALE = 9;              // TR4: sell all buildings (C++ TACTION_FIRE_SALE)
const TACTION_PLAY_MOVIE = 10;            // TR4: play a movie/cutscene (C++ TACTION_PLAY_MOVIE)
const TACTION_TEXT_TRIGGER = 11;
const TACTION_DESTROY_TRIGGER = 12;
const TACTION_AUTOCREATE = 13;
const TACTION_WINLOSE = 14;              // C++ taction.h: "Win if captured, lose if destroyed."
const TACTION_ALLOWWIN = 15;
const TACTION_REVEAL_MAP = 16;            // C++ TACTION_REVEAL_ALL
const TACTION_REVEAL_SOME = 17;
const TACTION_REVEAL_ZONE = 18;           // TR4: reveal all of specified zone (C++ TACTION_REVEAL_ZONE)
const TACTION_PLAY_SOUND = 19;
const TACTION_PLAY_MUSIC = 20;            // TR4: play music track (C++ TACTION_PLAY_MUSIC)
const TACTION_PLAY_SPEECH = 21;
const TACTION_FORCE_TRIGGER = 22;
const TACTION_START_TIMER = 23;
const TACTION_STOP_TIMER = 24;
const TACTION_TIMER_EXTEND = 25;          // C++ TACTION_ADD_TIMER
const TACTION_SUB_TIMER = 26;
const TACTION_SET_TIMER = 27;
const TACTION_SET_GLOBAL = 28;
const TACTION_CLEAR_GLOBAL = 29;
const TACTION_BASE_BUILDING = 30;        // C++ taction.h: "Automated base building." — sets IsBaseBuilding on/off
const TACTION_CREEP_SHADOW = 31;
const TACTION_DESTROY_OBJECT = 32;
const TACTION_1_SPECIAL = 33;
const TACTION_FULL_SPECIAL = 34;
const TACTION_PREFERRED_TARGET = 35;      // TR4: designate preferred target for AI house
const TACTION_LAUNCH_NUKES = 36;          // C++ TACTION_LAUNCH_NUKES — launch fake nukes from all silos

// C++ type index → TS type name mappings (for BUILD_UNIT/INFANTRY/AIRCRAFT events)
const UNIT_TYPE_NAMES: Record<number, string> = {
  0: 'HARV', 1: '1TNK', 2: '2TNK', 3: '3TNK', 4: '4TNK', 5: 'APC',
  6: 'MNLY', 7: 'JEEP', 8: 'TRUK', 9: 'ARTY', 10: 'MCV',
  11: 'V2RL', 12: 'CTNK', 13: 'TTNK', 14: 'STNK', 15: 'QTNK', 16: 'DTRK',
};

const INFANTRY_TYPE_NAMES: Record<number, string> = {
  0: 'E1', 1: 'E2', 2: 'E3', 3: 'E4', 4: 'E6',
  5: 'E7', 6: 'SPY', 7: 'THF', 8: 'MEDI', 9: 'GNRL',
  10: 'DOG', 11: 'C1', 12: 'C2', 13: 'C3', 14: 'C4', 15: 'C5',
  16: 'C6', 17: 'C7', 18: 'C8', 19: 'C9', 20: 'C10',
  21: 'EINSTEIN', 22: 'SHOK', 23: 'MECH', 24: 'CHAN',
};

const AIRCRAFT_TYPE_NAMES: Record<number, string> = {
  0: 'TRAN', 1: 'BADR', 2: 'U2', 3: 'MIG', 4: 'YAK', 5: 'HELI', 6: 'HIND',
};

// Team mission types (TeamMissionType — from TEAMTYPE.H, exact numbering from RA source)
const TMISSION_ATTACK = 0;       // Attack nearest enemy near waypoint
const TMISSION_ATT_WAYPT = 1;    // Attack waypoint
// 2 = CHANGE_FORMATION (unused)
const TMISSION_MOVE = 3;         // Move to waypoint
// 4 = MOVECELL (unused)
const TMISSION_GUARD = 5;        // Guard area for duration
const TMISSION_LOOP = 6;         // Loop back to first mission
// 7 = ATTACKTARCOM (unused)
const TMISSION_UNLOAD = 8;       // Unload transport passengers
// 9 = DEPLOY (unused)
// 10 = HOUND_DOG (move to waypoint then guard — implemented in index.ts)
const TMISSION_DO = 11;          // Assign mission to members (C++ Coordinate_Do)
const TMISSION_SET_GLOBAL = 12;  // Set a global variable (C++ TMission_Set_Global)
const TMISSION_IDLE = 13;        // Idle (wait at current position)
const TMISSION_LOAD = 14;        // Load infantry into transport
// 15 = SPY (unused)
const TMISSION_PATROL = 16;      // Patrol to waypoint (move + attack en route)

// Time unit: trigger/team timer values are in 1/10th minute increments (6 seconds each).
// C++ TICKS_PER_MINUTE / 10 = 900 / 10 = 90 ticks per time unit at 15 Hz.
export const TIME_UNIT_TICKS = 90;

export interface TeamMember {
  type: string;   // unit type name (e.g. 'ANT3')
  count: number;
}

export interface TeamMission {
  mission: number;  // TMISSION_* enum
  data: number;     // waypoint or other param
}

export interface TeamType {
  name: string;
  house: number;        // house ID
  flags: number;        // bitfield: bit1=IsSuicide, bit2=IsAutocreate, etc.
  recruitPriority?: number; // C++ teamtype.h:198 — priority for stealing members from lower-priority teams (default 7)
  initNum?: number;      // C++ teamtype.h:200 — number of this team to pre-spawn at scenario init (default 0)
  maxAllowed: number;   // C++ MaxAllowed — max active instances of this team type
  origin: number;       // starting waypoint
  trigger: number;      // trigger index to assign to spawned members (-1 = none)
  members: TeamMember[];
  missions: TeamMission[];
}

export interface TriggerEvent {
  type: number;    // TEVENT_* enum
  team: number;    // team index or -1
  data: number;    // parameter (time value for TIME, global ID for GLOBAL_SET)
}

export interface TriggerAction {
  action: number;  // TACTION_* enum
  team: number;    // team index or -1
  trigger: number; // trigger index or -1
  data: number;    // parameter
}

export interface ScenarioTrigger {
  name: string;
  persistence: number;   // 0=volatile, 1=semi, 2=persistent
  house: number;         // RA house index that owns this trigger
  eventControl: number;  // 0=only, 1=and, 2=or, 3=linked
  actionControl: number; // 0=only, 1=and
  event1: TriggerEvent;
  event2: TriggerEvent;
  action1: TriggerAction;
  action2: TriggerAction;
  fired: boolean;         // has this trigger fired?
  timerTick: number;      // game tick when timer started (for TIME events)
  playerEntered: boolean; // has a player unit entered a cell with this trigger?
  playerEnteredHouse: number; // C++ parity: house index of the unit that entered (tevent.cpp:290-291)
  objectDiscovered: boolean; // C++ parity: attached object was discovered by enemy (TEVENT_DISCOVERED)
  enteredZone: boolean; // C++ parity: a matching-house unit entered the trigger's zone (TEVENT_ENTERS_ZONE)
  crossedHorizontal: boolean; // C++ parity: a matching-house unit crossed the trigger cell's Y row (TEVENT_CROSS_HORIZONTAL)
  crossedVertical: boolean; // C++ parity: a matching-house unit crossed the trigger cell's X column (TEVENT_CROSS_VERTICAL)
  forceFirePending: boolean; // set by FORCE_TRIGGER — fires on next check regardless of events
  pendingDestroyedCount: number; // C++ Spring() parity: count of unprocessed deaths (fires once per death)
  triggeringEntityIds: number[]; // C++ parity: entity IDs that triggered this (for DESTROY_OBJECT with cell triggers)
  attachCount?: number; // number of attached objects/cells at scenario start or after dynamic spawns
  remainingAttachCount?: number; // semi-persistent detach countdown before the trigger may execute
}

export function initializeTriggerAttachmentCounts(
  triggers: ScenarioTrigger[],
  attachedTriggerNames: Iterable<string>,
): void {
  const counts = new Map<string, number>();
  for (const triggerName of attachedTriggerNames) {
    if (!triggerName) continue;
    counts.set(triggerName, (counts.get(triggerName) ?? 0) + 1);
  }
  for (const trigger of triggers) {
    const count = counts.get(trigger.name) ?? 0;
    trigger.attachCount = count;
    trigger.remainingAttachCount = count;
  }
}

export function noteTriggerAttachment(
  triggers: ScenarioTrigger[],
  triggerName: string | undefined,
  count = 1,
): void {
  if (!triggerName || count <= 0) return;
  for (const trigger of triggers) {
    if (trigger.name !== triggerName) continue;
    trigger.attachCount = (trigger.attachCount ?? 0) + count;
    trigger.remainingAttachCount = (trigger.remainingAttachCount ?? 0) + count;
  }
}

export function consumeSemiPersistentAttachment(
  trigger: ScenarioTrigger,
  detachCount = 1,
): boolean {
  if (trigger.persistence !== 1 || detachCount <= 0) {
    return true;
  }
  const remaining = trigger.remainingAttachCount ?? 0;
  if (remaining <= 0) {
    return true;
  }
  trigger.remainingAttachCount = Math.max(0, remaining - detachCount);
  return trigger.remainingAttachCount === 0;
}

// === Mission Metadata ===

export interface MissionInfo {
  id: string;        // scenario file ID (e.g. 'SCA01EA')
  title: string;     // display name
  briefing: string;  // pre-mission briefing text
  objective: string; // one-line objective
}

export const MISSIONS: MissionInfo[] = [
  {
    id: 'SCA01EA',
    title: 'It Came From Red Alert!',
    briefing: 'We\'ve lost contact with one of our outposts. Before it went off-line, we recieved a brief communique about giant ants. We\'re unsure what to make of this report, so we want you to investigate.\n\nScout the area, bring the outpost back on-line, and report your findings. If there is a threat, reinforcements will be sent in to help you.\n\nKeep the base functional and radio contact open -- we don\'t want to lose the outpost again.',
    objective: 'Scout the area and eliminate the ant threat.',
  },
  {
    id: 'SCA02EA',
    title: 'Evacuation',
    briefing: 'Who would\'ve believed it -- Giant Ants.\n\nNow that your MCV has arrived, we must evacuate the civilians in the area -- they don\'t stand a chance against these ants.\n\nThere are two villages in your immediate area. Locate them and evacuate the civilians to the island in the northwest. You\'ll also have to take out all the bridges in this area to stop the ants from completely overrunning you.\n\nYou must destroy the bridges, and evac at least one civilian from each town for the mission to be a success.',
    objective: 'Evacuate civilians and destroy bridges.',
  },
  {
    id: 'SCA03EA',
    title: 'Extermination',
    briefing: 'The source of the ant\'s activity has been pinpointed in this area. We suspect that their nests are in this area -- they must be destroyed\n\nA team of civilian specialists are en-route to your location. Use them to gas all the ant nests in the area. In addition, destroy all ants that you encounter.\n\nBe careful -- these things can chew through anything. Good luck.',
    objective: 'Destroy all ant nests in the area.',
  },
  {
    id: 'SCA04EA',
    title: 'Tunnel Rats',
    briefing: 'We\'ve discovered a series of tunnels underneath the ruined base. Now that we\'ve cut off their escape routes, the ants have nowhere left to run to.\n\nPerform a sweep and clear of all the tunnels, and find the cause of these abominations. Destroy anything that isn\'t human!\n\nThe power to the tunnel lights has been knocked out, which will limit visibility. Find the generator controls, and you can re-activate the lights.',
    objective: 'Clear the tunnels and destroy all ants.',
  },
];

/** Get mission info by index (0-based) */
export function getMission(index: number): MissionInfo | null {
  return MISSIONS[index] ?? null;
}

/** Get mission index by scenario ID */
export function getMissionIndex(scenarioId: string): number {
  return MISSIONS.findIndex(m => m.id === scenarioId);
}

// === localStorage Progress ===

const PROGRESS_KEY = 'antmissions_progress';

export function loadProgress(): number {
  try {
    const val = localStorage.getItem(PROGRESS_KEY);
    return val ? Math.min(parseInt(val, 10) || 0, MISSIONS.length) : 0;
  } catch {
    return 0;
  }
}

export function saveProgress(completedMission: number): void {
  try {
    const current = loadProgress();
    const next = completedMission + 1;
    if (next > current) {
      localStorage.setItem(PROGRESS_KEY, String(next));
    }
  } catch {
    // localStorage unavailable
  }
}

// === Campaign System ===

export type CampaignId = 'allied' | 'soviet' | 'counterstrike_allied' | 'counterstrike_soviet';

export interface CampaignMission {
  id: string;        // scenario file ID (e.g. 'SCG01EA')
  title: string;     // display name
  briefing: string;  // brief description
  objective: string; // one-line objective
}

export interface CampaignDef {
  id: CampaignId;
  title: string;
  faction: 'allied' | 'soviet';
  missions: CampaignMission[];
  progressKey: string;
}

// Allied campaign mission titles (from original RA)
const ALLIED_MISSIONS: CampaignMission[] = [
  { id: 'SCG01EA', title: 'In the Thick of It', briefing: 'Rescue Einstein from Soviet forces.', objective: 'Locate and rescue Einstein.' },
  { id: 'SCG02EA', title: 'Five to One', briefing: 'Hold the line against Soviet assault.', objective: 'Destroy all Soviet forces.' },
  { id: 'SCG03EA', title: 'Dead End', briefing: 'Escort convoy through hostile territory.', objective: 'Get the convoy safely through.' },
  { id: 'SCG04EA', title: 'Tanya\'s Tale', briefing: 'Infiltrate enemy base with Tanya.', objective: 'Destroy Soviet installations.' },
  { id: 'SCG05EA', title: 'Paradox Equation', briefing: 'Stop Soviet nuclear development.', objective: 'Destroy the Soviet tech center.' },
  { id: 'SCG06EA', title: 'Situation Critical', briefing: 'Defend the Allied base from attack.', objective: 'Protect the Allied base.' },
  { id: 'SCG07EA', title: 'Sarin Gas 1: Crackdown', briefing: 'Secure a Soviet chemical facility.', objective: 'Capture the facility.' },
  { id: 'SCG08EA', title: 'Sarin Gas 2: Down Under', briefing: 'Clean out a Soviet submarine pen.', objective: 'Destroy all Soviet units.' },
  { id: 'SCG09EA', title: 'Sarin Gas 3: Controlled Burn', briefing: 'Eliminate the gas production plant.', objective: 'Destroy the chemical weapons plant.' },
  { id: 'SCG10EA', title: 'Suspicion', briefing: 'Investigate a suspected spy.', objective: 'Infiltrate with the spy.' },
  { id: 'SCG11EA', title: 'Aftermath', briefing: 'Counter-attack the Soviet homeland.', objective: 'Destroy the Soviet base.' },
  { id: 'SCG12EA', title: 'Focused Blast', briefing: 'A precision strike on enemy defenses.', objective: 'Destroy all enemy forces.' },
  { id: 'SCG13EA', title: 'Negotiations', briefing: 'Negotiate from a position of strength.', objective: 'Capture the Soviet command center.' },
  { id: 'SCG14EA', title: 'No Remorse', briefing: 'The final push to end the war.', objective: 'Destroy the Iron Curtain.' },
];

// Soviet campaign mission titles
const SOVIET_MISSIONS: CampaignMission[] = [
  { id: 'SCU01EA', title: 'Lesson in Blood', briefing: 'Crush village resistance.', objective: 'Destroy all enemy forces.' },
  { id: 'SCU02EA', title: 'Tesla\'s Spark', briefing: 'Defend the Tesla coil installation.', objective: 'Protect the Tesla coils.' },
  { id: 'SCU03EA', title: 'Covert Cleanup', briefing: 'Eliminate witnesses to our operations.', objective: 'Destroy all enemy structures.' },
  { id: 'SCU04EA', title: 'Behind the Lines', briefing: 'Sabotage enemy supply lines.', objective: 'Destroy the Allied supply depot.' },
  { id: 'SCU05EA', title: 'Distant Thunder', briefing: 'Secure a forward operating base.', objective: 'Build and hold a Soviet base.' },
  { id: 'SCU06EA', title: 'Bridge over the River Grotz', briefing: 'Capture a critical bridge crossing.', objective: 'Take the bridge intact.' },
  { id: 'SCU07EA', title: 'Core of the Matter', briefing: 'Strike at the heart of Allied defenses.', objective: 'Destroy the Allied command center.' },
  { id: 'SCU08EA', title: 'Elba Island', briefing: 'Storm an island fortress.', objective: 'Destroy all Allied forces.' },
  { id: 'SCU09EA', title: 'Overseer', briefing: 'Maintain order in occupied territory.', objective: 'Crush the resistance.' },
  { id: 'SCU10EA', title: 'Wasteland', briefing: 'Advance through contested ground.', objective: 'Destroy all enemy forces.' },
  { id: 'SCU11EA', title: 'Ground Zero', briefing: 'Prepare the nuclear arsenal.', objective: 'Build the missile silo.' },
  { id: 'SCU12EA', title: 'Mousetrap', briefing: 'Lure enemies into a trap.', objective: 'Destroy all Allied forces.' },
  { id: 'SCU13EA', title: 'Legacy of Tesla', briefing: 'Protect Tesla\'s legacy.', objective: 'Defend the Tesla installations.' },
  { id: 'SCU14EA', title: 'Soviet Supremacy', briefing: 'Crush all remaining resistance.', objective: 'Destroy all Allied forces.' },
];

// Counterstrike missions
const CS_ALLIED_MISSIONS: CampaignMission[] = [
  { id: 'SCG20EA', title: 'Sarin Gas 1', briefing: 'Counterstrike Allied mission 1.', objective: 'Complete the mission objectives.' },
  { id: 'SCG21EA', title: 'Sarin Gas 2', briefing: 'Counterstrike Allied mission 2.', objective: 'Complete the mission objectives.' },
  { id: 'SCG22EA', title: 'Sarin Gas 3', briefing: 'Counterstrike Allied mission 3.', objective: 'Complete the mission objectives.' },
  { id: 'SCG23EA', title: 'Fall of Greece 1', briefing: 'Counterstrike Allied mission 4.', objective: 'Complete the mission objectives.' },
  { id: 'SCG24EA', title: 'Fall of Greece 2', briefing: 'Counterstrike Allied mission 5.', objective: 'Complete the mission objectives.' },
  { id: 'SCG26EA', title: 'Proving Grounds', briefing: 'Counterstrike Allied mission 6.', objective: 'Complete the mission objectives.' },
  { id: 'SCG27EA', title: 'Negotiations', briefing: 'Counterstrike Allied mission 7.', objective: 'Complete the mission objectives.' },
  { id: 'SCG28EA', title: 'Monster Tank Madness', briefing: 'Counterstrike Allied mission 8.', objective: 'Complete the mission objectives.' },
];

const CS_SOVIET_MISSIONS: CampaignMission[] = [
  { id: 'SCU31EA', title: 'Proving Grounds', briefing: 'Counterstrike Soviet mission 1.', objective: 'Complete the mission objectives.' },
  { id: 'SCU32EA', title: 'Besieged', briefing: 'Counterstrike Soviet mission 2.', objective: 'Complete the mission objectives.' },
  { id: 'SCU33EA', title: 'Mousetrap', briefing: 'Counterstrike Soviet mission 3.', objective: 'Complete the mission objectives.' },
  { id: 'SCU34EA', title: 'Legacy of Tesla', briefing: 'Counterstrike Soviet mission 4.', objective: 'Complete the mission objectives.' },
  { id: 'SCU35EA', title: 'Soviet Soldier Volkov 1', briefing: 'Counterstrike Soviet mission 5.', objective: 'Complete the mission objectives.' },
  { id: 'SCU36EA', title: 'Soviet Soldier Volkov 2', briefing: 'Counterstrike Soviet mission 6.', objective: 'Complete the mission objectives.' },
  { id: 'SCU37EA', title: 'Top o\' the World', briefing: 'Counterstrike Soviet mission 7.', objective: 'Complete the mission objectives.' },
  { id: 'SCU38EA', title: 'Paradox Equation', briefing: 'Counterstrike Soviet mission 8.', objective: 'Complete the mission objectives.' },
];

/** All campaign definitions */
export const CAMPAIGNS: CampaignDef[] = [
  { id: 'allied', title: 'Allied Campaign', faction: 'allied', missions: ALLIED_MISSIONS, progressKey: 'campaign_allied_progress' },
  { id: 'soviet', title: 'Soviet Campaign', faction: 'soviet', missions: SOVIET_MISSIONS, progressKey: 'campaign_soviet_progress' },
  { id: 'counterstrike_allied', title: 'Counterstrike (Allied)', faction: 'allied', missions: CS_ALLIED_MISSIONS, progressKey: 'campaign_cs_allied_progress' },
  { id: 'counterstrike_soviet', title: 'Counterstrike (Soviet)', faction: 'soviet', missions: CS_SOVIET_MISSIONS, progressKey: 'campaign_cs_soviet_progress' },
];

/** Get a campaign definition by ID */
export function getCampaign(id: CampaignId): CampaignDef | undefined {
  return CAMPAIGNS.find(c => c.id === id);
}

/** Load campaign progress (number of missions completed) */
export function loadCampaignProgress(campaignId: CampaignId): number {
  const campaign = getCampaign(campaignId);
  if (!campaign) return 0;
  try {
    const val = localStorage.getItem(campaign.progressKey);
    return val ? Math.min(parseInt(val, 10) || 0, campaign.missions.length) : 0;
  } catch {
    return 0;
  }
}

/** Save campaign progress after completing a mission */
export function saveCampaignProgress(campaignId: CampaignId, completedMissionIndex: number): void {
  const campaign = getCampaign(campaignId);
  if (!campaign) return;
  try {
    const current = loadCampaignProgress(campaignId);
    const next = completedMissionIndex + 1;
    if (next > current) {
      localStorage.setItem(campaign.progressKey, String(next));
    }
  } catch {
    // localStorage unavailable
  }
}

/** Check if a scenario INI file exists by probing fetch */
export async function checkMissionExists(scenarioId: string): Promise<boolean> {
  try {
    const res = await fetch(`/ra/assets/${scenarioId}.ini`, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Parse the mission.ini file format.
 * Sections are like [SCG01EA.INI] with numbered lines 1=..., 2=..., etc.
 * @ = newline, @@ = paragraph break.
 * Returns map of scenario ID (e.g. 'SCG01EA') → full briefing text.
 */
export function parseMissionINI(text: string): Map<string, string> {
  const result = new Map<string, string>();
  let currentSection: string | null = null;
  const lines: string[] = [];

  const flush = () => {
    if (currentSection && lines.length > 0) {
      const raw = lines.join(' ');
      // Replace @@ with double newline (paragraph break), then @ with newline
      const cleaned = raw.replace(/@@/g, '\n\n').replace(/@/g, '\n').trim();
      result.set(currentSection, cleaned);
    }
    lines.length = 0;
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[(\w+)\.INI\]$/);
    if (sectionMatch) {
      flush();
      currentSection = sectionMatch[1];
      continue;
    }
    const lineMatch = trimmed.match(/^\d+=(.*)$/);
    if (lineMatch && currentSection) {
      lines.push(lineMatch[1]);
    }
  }
  flush();
  return result;
}

/** Cached mission briefings from mission.ini */
let _briefingsCache: Map<string, string> | null = null;

/** Fetch and parse mission.ini, returning map of scenario ID → briefing text. Cached after first call. */
export async function loadMissionBriefings(): Promise<Map<string, string>> {
  if (_briefingsCache) return _briefingsCache;
  try {
    const res = await fetch('/ra/assets/mission.ini');
    if (!res.ok) return new Map();
    const text = await res.text();
    _briefingsCache = parseMissionINI(text);
    return _briefingsCache;
  } catch {
    return new Map();
  }
}

/** Get cached briefing for a scenario ID (must call loadMissionBriefings first) */
export function getMissionBriefing(scenarioId: string): string | undefined {
  return _briefingsCache?.get(scenarioId);
}

// --- Mission carry-over: surviving units transfer to next mission ---
const CARRYOVER_KEY = 'antmissions_carryover';

interface CarryoverUnit {
  type: string;
  hp: number;
  maxHp: number;
  kills: number;
}

export function saveCarryover(entities: Entity[]): void {
  try {
    const alive = entities
      .filter(e => e.alive && e.isPlayerUnit)
      .map(e => ({
        type: e.type,
        hp: e.hp,
        maxHp: e.maxHp,
        kills: e.kills,
      }));
    localStorage.setItem(CARRYOVER_KEY, JSON.stringify(alive));
  } catch { /* noop */ }
}

export function loadCarryover(): CarryoverUnit[] {
  try {
    const val = localStorage.getItem(CARRYOVER_KEY);
    if (val) {
      localStorage.removeItem(CARRYOVER_KEY); // consume once
      return JSON.parse(val) as CarryoverUnit[];
    }
  } catch { /* noop */ }
  return [];
}

interface ScenarioData {
  name: string;
  briefing: string;
  mapBounds: { x: number; y: number; w: number; h: number };
  waypoints: Map<number, CellPos>;
  playerCredits: number;
  playerTechLevel: number;
  units: Array<{
    house: string;
    type: string;
    hp: number;
    cell: number;
    facing: number;
    mission: string;
    trigger: string;
  }>;
  infantry: Array<{
    house: string;
    type: string;
    hp: number;
    cell: number;
    subCell: number;
    mission: string;
    facing: number;
    trigger: string;
  }>;
  structures: Array<{
    house: string;
    type: string;
    hp: number;
    cell: number;
    facing: number;
    trigger: string;
  }>;
  terrain: Array<{
    cell: number;
    type: string;
  }>;
  teamTypes: TeamType[];
  triggers: ScenarioTrigger[];
  cellTriggers: Map<number, string>;
  mapPack: string;      // raw Base64 MapPack data
  overlayPack: string;  // raw Base64 OverlayPack data
  toCarryOver: boolean; // surviving units carry to next mission
  toInherit: boolean;   // next mission inherits carry-over units
  baseStructures: Array<{ type: string; cell: number; house: string }>; // [Base] section pre-placed structures
  smudges: Array<{ type: string; cell: number }>; // [SMUDGE] section scorch/crater marks
  theatre: string; // TEMPERATE, INTERIOR, etc.
  rawSections: Map<string, Map<string, string>>; // all INI sections for per-scenario overrides
  playerHouse: string; // house name from [Basic] Player= (e.g. 'Spain')
  /** Per-house Allies= fields from scenario INI (house name → list of allied house names) */
  houseAllies: Map<string, string[]>;
  /** Per-house Credits= from scenario INI (house name → credits value before ×100) */
  houseCredits: Map<string, number>;
  /** Per-house Edge= from scenario INI (house name → edge direction string) */
  houseEdges: Map<string, string>;
  /** Per-house IQ= from scenario INI (0-3, gates AI behaviors) */
  houseIQ: Map<string, number>;
  /** Per-house TechLevel= from scenario INI (gates production items) */
  houseTechLevels: Map<string, number>;
  /** Per-house MaxUnit= from scenario INI (max vehicle units, -1=unlimited) */
  houseMaxUnit: Map<string, number>;
  /** Per-house MaxInfantry= from scenario INI (max infantry units, -1=unlimited) */
  houseMaxInfantry: Map<string, number>;
  /** Per-house MaxBuilding= from scenario INI (max buildings, -1=unlimited) */
  houseMaxBuilding: Map<string, number>;
  /** C++ Scen.IsTanyaEvac — scenario.cpp:2262: CivEvac=yes in [Basic]. When true,
   *  Tanya (E7) counts as civilian for evacuation (aircraft.cpp:143). */
  isTanyaEvac: boolean;
}

/** Parse an INI-format scenario file */
export function parseScenarioINI(text: string): ScenarioData {
  const sections = new Map<string, Map<string, string>>();
  let currentSection = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1);
      if (!sections.has(currentSection)) {
        sections.set(currentSection, new Map());
      }
      continue;
    }

    const eq = line.indexOf('=');
    if (eq > 0 && currentSection) {
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      sections.get(currentSection)!.set(key, value);
    }
  }

  const get = (section: string, key: string, def = ''): string =>
    sections.get(section)?.get(key) ?? def;

  // Map bounds
  const mapX = parseInt(get('Map', 'X', '0'));
  const mapY = parseInt(get('Map', 'Y', '0'));
  const mapW = parseInt(get('Map', 'Width', '50'));
  const mapH = parseInt(get('Map', 'Height', '50'));

  // Waypoints
  const waypoints = new Map<number, CellPos>();
  const wpSection = sections.get('Waypoints');
  if (wpSection) {
    for (const [key, value] of wpSection) {
      const wpIdx = parseInt(key);
      const cellIdx = parseInt(value);
      if (!isNaN(wpIdx) && !isNaN(cellIdx)) {
        waypoints.set(wpIdx, cellIndexToPos(cellIdx));
      }
    }
  }

  // Player data
  const playerHouse = get('Basic', 'Player', 'Spain');
  const credits = parseInt(get(playerHouse, 'Credits', '0'));
  const techLevel = parseInt(get(playerHouse, 'TechLevel', '3'));

  // Units (vehicles)
  const units: ScenarioData['units'] = [];
  const unitsSection = sections.get('UNITS');
  if (unitsSection) {
    for (const [, value] of unitsSection) {
      const parts = value.split(',');
      if (parts.length >= 7) {
        units.push({
          house: parts[0],
          type: parts[1],
          hp: parseInt(parts[2]),
          cell: parseInt(parts[3]),
          facing: parseInt(parts[4]),
          mission: parts[5],
          trigger: parts[6],
        });
      }
    }
  }

  // Ships (same format as vehicles)
  const shipsSection = sections.get('SHIPS');
  if (shipsSection) {
    for (const [, value] of shipsSection) {
      const parts = value.split(',');
      if (parts.length >= 7) {
        units.push({
          house: parts[0],
          type: parts[1],
          hp: parseInt(parts[2]),
          cell: parseInt(parts[3]),
          facing: parseInt(parts[4]),
          mission: parts[5],
          trigger: parts[6],
        });
      }
    }
  }

  // Infantry
  const infantry: ScenarioData['infantry'] = [];
  const infSection = sections.get('INFANTRY');
  if (infSection) {
    for (const [, value] of infSection) {
      const parts = value.split(',');
      if (parts.length >= 8) {
        infantry.push({
          house: parts[0],
          type: parts[1],
          hp: parseInt(parts[2]),
          cell: parseInt(parts[3]),
          subCell: parseInt(parts[4]),
          mission: parts[5],
          facing: parseInt(parts[6]),
          trigger: parts[7],
        });
      }
    }
  }

  // Structures
  const structures: ScenarioData['structures'] = [];
  const strSection = sections.get('STRUCTURES');
  if (strSection) {
    for (const [, value] of strSection) {
      const parts = value.split(',');
      if (parts.length >= 6) {
        structures.push({
          house: parts[0],
          type: parts[1],
          hp: parseInt(parts[2]),
          cell: parseInt(parts[3]),
          facing: parseInt(parts[4]),
          trigger: parts[5],
        });
      }
    }
  }

  // Terrain features
  const terrain: ScenarioData['terrain'] = [];
  const terrSection = sections.get('TERRAIN');
  if (terrSection) {
    for (const [key, value] of terrSection) {
      terrain.push({ cell: parseInt(key), type: value });
    }
  }

  // Parse TeamTypes
  // Format: name=House,Flags,RecruitPriority,InitNum,MaxAllowed,Origin,Trigger,ClassCount,members...,MissionCount,missions...
  const teamTypes: TeamType[] = [];
  const ttSection = sections.get('TeamTypes');
  if (ttSection) {
    for (const [name, value] of ttSection) {
      const parts = value.split(',');
      if (parts.length < 8) continue;
      const house = parseInt(parts[0]);
      const flags = parseInt(parts[1]) || 0;
      const recruitPriority = parseInt(parts[2]) || 7; // C++ teamtype.cpp:65 — field[2], default 7
      const initNum = parseInt(parts[3]) || 0;         // C++ teamtype.cpp:65 — field[3], default 0
      const origin = parseInt(parts[5]);
      const trigger = parseInt(parts[6]);  // trigger index assigned to spawned members (-1 = none)
      const classCount = parseInt(parts[7]);

      const members: TeamMember[] = [];
      for (let i = 0; i < classCount; i++) {
        const memberStr = parts[8 + i];
        if (!memberStr) break;
        const [mType, mCount] = memberStr.split(':');
        members.push({ type: mType, count: parseInt(mCount) || 1 });
      }

      const missionCountIdx = 8 + classCount;
      const missionCount = parseInt(parts[missionCountIdx]) || 0;
      const missions: TeamMission[] = [];
      for (let i = 0; i < missionCount; i++) {
        const missionStr = parts[missionCountIdx + 1 + i];
        if (!missionStr) break;
        const [mId, mData] = missionStr.split(':');
        missions.push({ mission: parseInt(mId), data: parseInt(mData) || 0 });
      }

      const maxAllowed = parseInt(parts[4]) || 0;
      teamTypes.push({ name, house, flags, recruitPriority, initNum, maxAllowed, origin, trigger, members, missions });
    }
  }

  // Parse Triggers (18-field format from RA source)
  // Format: name=PersType,House,EventControl,ActionControl,
  //   E1.Event,E1.Team,E1.Data, E2.Event,E2.Team,E2.Data,
  //   A1.Action,A1.Team,A1.Trigger,A1.Data, A2.Action,A2.Team,A2.Trigger,A2.Data
  const triggers: ScenarioTrigger[] = [];
  const trigSection = sections.get('Trigs');
  if (trigSection) {
    for (const [name, value] of trigSection) {
      const f = value.split(',').map(s => parseInt(s.trim()));
      if (f.length < 18) continue;
      triggers.push({
        name,
        persistence: f[0],
        house: f[1],
        eventControl: f[2],
        actionControl: f[3],
        event1: { type: f[4], team: f[5], data: f[6] },
        event2: { type: f[7], team: f[8], data: f[9] },
        action1: { action: f[10], team: f[11], trigger: f[12], data: f[13] },
        action2: { action: f[14], team: f[15], trigger: f[16], data: f[17] },
        fired: false,
        timerTick: 0,
        playerEntered: false,
        playerEnteredHouse: -1,
        objectDiscovered: false,
        enteredZone: false,
        crossedHorizontal: false,
        crossedVertical: false,
        forceFirePending: false,
        pendingDestroyedCount: 0,
        triggeringEntityIds: [],
        attachCount: 0,
        remainingAttachCount: 0,
      });
    }
  }

  // Collect MapPack data (Base64 across numbered lines)
  let mapPack = '';
  const mapPackSection = sections.get('MapPack');
  if (mapPackSection) {
    const sortedKeys = [...mapPackSection.keys()].sort((a, b) => parseInt(a) - parseInt(b));
    for (const key of sortedKeys) {
      mapPack += mapPackSection.get(key)!;
    }
  }

  // Collect OverlayPack data (Base64 across numbered lines)
  let overlayPack = '';
  const overlayPackSection = sections.get('OverlayPack');
  if (overlayPackSection) {
    const sortedKeys = [...overlayPackSection.keys()].sort((a, b) => parseInt(a) - parseInt(b));
    for (const key of sortedKeys) {
      overlayPack += overlayPackSection.get(key)!;
    }
  }

  // Parse [Briefing] section — numbered lines concatenated, @@ = paragraph break
  let briefing = '';
  const briefSection = sections.get('Briefing');
  if (briefSection) {
    const sortedKeys = [...briefSection.keys()].sort((a, b) => parseInt(a) - parseInt(b));
    briefing = sortedKeys.map(k => briefSection.get(k)!).join('').replace(/@@/g, '\n\n');
  }

  // Parse [CellTriggers] section — maps cell index to trigger name
  const cellTriggers = new Map<number, string>();
  const ctSection = sections.get('CellTriggers');
  if (ctSection) {
    for (const [key, value] of ctSection) {
      const cellIdx = parseInt(key);
      if (!isNaN(cellIdx)) {
        cellTriggers.set(cellIdx, value);
      }
    }
  }

  // Parse [Base] section — pre-placed structures for AI houses
  // Format: 000=TYPE,cellIndex
  const baseStructures: ScenarioData['baseStructures'] = [];
  const baseSection = sections.get('Base');
  if (baseSection) {
    const basePlayer = baseSection.get('Player') ?? 'Neutral';
    for (const [key, value] of baseSection) {
      if (key === 'Player' || key === 'Count') continue;
      const parts = value.split(',');
      if (parts.length >= 2) {
        baseStructures.push({ type: parts[0], cell: parseInt(parts[1]), house: basePlayer });
      }
    }
  }

  // Parse [SMUDGE] section — scorch marks and craters
  // Format: cellIndex=TYPE,cellIndex,rotation
  const smudges: ScenarioData['smudges'] = [];
  const smudgeSection = sections.get('SMUDGE');
  if (smudgeSection) {
    for (const [, value] of smudgeSection) {
      const parts = value.split(',');
      if (parts.length >= 2) {
        smudges.push({ type: parts[0], cell: parseInt(parts[1]) });
      }
    }
  }

  const theatre = get('Map', 'Theater', 'TEMPERATE').toUpperCase();

  // Parse per-house Allies= fields (C++ house.cpp:Read_INI)
  // Each house section may have an Allies= field with comma-separated house names
  const houseAllies = new Map<string, string[]>();
  const houseNames = ['Spain', 'Greece', 'USSR', 'England', 'Ukraine', 'Germany',
                      'France', 'Turkey', 'GoodGuy', 'BadGuy', 'Neutral', 'Special'];
  for (const houseName of houseNames) {
    const alliesStr = get(houseName, 'Allies', '');
    if (alliesStr) {
      const allies = alliesStr.split(',').map(s => s.trim()).filter(Boolean);
      if (allies.length > 0) houseAllies.set(houseName, allies);
    }
  }

  // Parse per-house Credits=, Edge=, IQ=, TechLevel=, MaxUnit=, MaxInfantry=, MaxBuilding= fields
  const houseCreditsMap = new Map<string, number>();
  const houseEdges = new Map<string, string>();
  const houseIQ = new Map<string, number>();
  const houseTechLevels = new Map<string, number>();
  const houseMaxUnit = new Map<string, number>();
  const houseMaxInfantry = new Map<string, number>();
  const houseMaxBuilding = new Map<string, number>();
  for (const houseName of houseNames) {
    const hCredits = parseInt(get(houseName, 'Credits', ''));
    if (!isNaN(hCredits) && hCredits > 0 && houseName !== playerHouse) {
      houseCreditsMap.set(houseName, hCredits);
    }
    const edge = get(houseName, 'Edge', '');
    if (edge) {
      houseEdges.set(houseName, edge);
    }
    // C++ parity: IQ level (0-3) gates AI behaviors
    const iq = parseInt(get(houseName, 'IQ', ''));
    if (!isNaN(iq)) houseIQ.set(houseName, iq);
    // C++ parity: TechLevel gates which production items are available
    const tl = parseInt(get(houseName, 'TechLevel', ''));
    if (!isNaN(tl)) houseTechLevels.set(houseName, tl);
    // C++ parity: MaxUnit/MaxInfantry/MaxBuilding caps
    const maxU = parseInt(get(houseName, 'MaxUnit', ''));
    if (!isNaN(maxU)) houseMaxUnit.set(houseName, maxU);
    const maxI = parseInt(get(houseName, 'MaxInfantry', ''));
    if (!isNaN(maxI)) houseMaxInfantry.set(houseName, maxI);
    const maxB = parseInt(get(houseName, 'MaxBuilding', ''));
    if (!isNaN(maxB)) houseMaxBuilding.set(houseName, maxB);
  }

  return {
    name: get('Basic', 'Name', 'Unknown Mission'),
    briefing,
    mapBounds: { x: mapX, y: mapY, w: mapW, h: mapH },
    waypoints,
    playerCredits: credits,
    playerTechLevel: techLevel,
    units,
    infantry,
    structures,
    terrain,
    teamTypes,
    triggers,
    cellTriggers,
    mapPack,
    overlayPack,
    toCarryOver: get('Basic', 'ToCarryOver', 'no').toLowerCase() === 'yes',
    toInherit: get('Basic', 'ToInherit', 'no').toLowerCase() === 'yes',
    isTanyaEvac: get('Basic', 'CivEvac', 'no').toLowerCase() === 'yes',
    baseStructures,
    smudges,
    theatre,
    rawSections: sections,
    playerHouse,
    houseAllies,
    houseCredits: houseCreditsMap,
    houseEdges,
    houseIQ,
    houseTechLevels,
    houseMaxUnit,
    houseMaxInfantry,
    houseMaxBuilding,
  };
}

/** Map INI house name to House enum.
 *  Campaign missions use the full set of houses (England, France, GoodGuy, BadGuy). */
function toHouse(name: string): House {
  switch (name.toLowerCase()) {
    case 'spain': return House.Spain;
    case 'greece': return House.Greece;
    case 'england': return House.England;
    case 'france': return House.France;
    case 'ussr': return House.USSR;
    case 'ukraine': return House.Ukraine;
    case 'germany': return House.Germany;
    case 'turkey': return House.Turkey;
    case 'goodguy': return House.GoodGuy;
    case 'badguy': return House.BadGuy;
    case 'special': return House.Special;
    case 'neutral': return House.Neutral;
    case 'multi1': return House.Multi1;
    case 'multi2': return House.Multi2;
    case 'multi3': return House.Multi3;
    case 'multi4': return House.Multi4;
    case 'multi5': return House.Multi5;
    case 'multi6': return House.Multi6;
    case 'multi7': return House.Multi7;
    case 'multi8': return House.Multi8;
    default: return House.Neutral;
  }
}

/** Expand an alliance group keyword into constituent houses.
 *  C++ parity: conquer.cpp:5490-5506 — Get_Owners() expands group keywords:
 *    "soviet"          → USSR, Ukraine, BadGuy
 *    "allies"/"allied" → Spain, Greece, England, Germany, France, Turkey, GoodGuy
 *  Individual house names pass through to toHouse() as a single-element array. */
export function expandAllyToken(token: string): House[] {
  switch (token.toLowerCase()) {
    case 'soviet':
      return [House.USSR, House.Ukraine, House.BadGuy];
    case 'allies':
    case 'allied':
      return [House.Spain, House.Greece, House.England, House.Germany,
              House.France, House.Turkey, House.GoodGuy];
    default:
      return [toHouse(token)];
  }
}

/** Map INI unit type name to UnitType enum */
function toUnitType(name: string): UnitType | null {
  // Derive from UNIT_STATS — any unit with stats defined can be spawned from INI
  return UNIT_STATS[name]?.type ?? null;
}

/** Map house ID number to House enum (from RA house numbering) */
export function houseIdToHouse(id: number): House {
  // RA house IDs: 0=Spain, 1=Greece, 2=USSR, 3=England, 4=Ukraine, 5=Germany,
  // 6=France, 7=Turkey, 8=GoodGuy, 9=BadGuy, 10=Neutral, 11=Special
  switch (id) {
    case 0: return House.Spain;
    case 1: return House.Greece;
    case 2: return House.USSR;
    case 3: return House.England;
    case 4: return House.Ukraine;
    case 5: return House.Germany;
    case 6: return House.France;
    case 7: return House.Turkey;
    case 8: return House.GoodGuy;
    case 9: return House.BadGuy;
    case 10: return House.Neutral;
    case 11: return House.Special; // HOUSE_JP / Special
    case 12: return House.Multi1;
    case 13: return House.Multi2;
    case 14: return House.Multi3;
    case 15: return House.Multi4;
    case 16: return House.Multi5;
    case 17: return House.Multi6;
    case 18: return House.Multi7;
    case 19: return House.Multi8;
    default: return House.Neutral;
  }
}

/** Reverse mapping: House enum → RA house ID number */
export function houseToId(house: House): number {
  switch (house) {
    case House.Spain:   return 0;
    case House.Greece:  return 1;
    case House.USSR:    return 2;
    case House.England: return 3;
    case House.Ukraine: return 4;
    case House.Germany: return 5;
    case House.France:  return 6;
    case House.Turkey:  return 7;
    case House.GoodGuy: return 8;
    case House.BadGuy:  return 9;
    case House.Neutral: return 10;
    default: return 10; // Neutral
  }
}

function normalizeHouseEdge(edge: string | undefined): string {
  return (edge ?? 'North').toLowerCase();
}

function inferClosestMapEdge(
  alignedCell: CellPos,
  mapBounds: { x: number; y: number; w: number; h: number },
): 'north' | 'south' | 'east' | 'west' {
  const relX = alignedCell.cx - mapBounds.x;
  const relY = alignedCell.cy - mapBounds.y;
  const xDist = Math.min(relX, -alignedCell.cx + (mapBounds.x + mapBounds.w));
  const yDist = Math.min(relY, -alignedCell.cy + (mapBounds.y + mapBounds.h));

  if (xDist < yDist) {
    return relX < mapBounds.w / 2 ? 'west' : 'east';
  }
  return relY < mapBounds.h / 2 ? 'north' : 'south';
}

export function calculateHouseEdgeSpawnCell(
  house: House,
  houseEdges: Map<House, string> | undefined,
  mapBounds: { x: number; y: number; w: number; h: number } | undefined,
  alignedCell?: CellPos,
  random: () => number = () => ScenarioRandom.float(),
  /** Optional: when provided with naval=true, checks terrain for water cells.
   *  C++ display.cpp:2505-2527: Calculated_Cell with SPEED_FLOAT only returns WATER cells. */
  map?: GameMap,
  naval = false,
): CellPos | null {
  if (!mapBounds) {
    return null;
  }

  // C++ display.cpp:2432-2460 (Calculated_Cell): When a waypoint (trycell) is
  // provided, C++ infers the spawn edge from the waypoint's closest map edge.
  // Lines 2466-2492 (house Edge=) only execute when trycell == -1 (no waypoint).
  // Priority: waypoint inference → house edge → default (north).
  const edge = alignedCell
    ? inferClosestMapEdge(alignedCell, mapBounds)
    : houseEdges?.get(house)
      ? normalizeHouseEdge(houseEdges.get(house))
      : normalizeHouseEdge(undefined);
  const { x, y, w, h } = mapBounds;
  const randOffset = Math.floor(random() * Math.max(w, h));
  const alignedX = alignedCell ? Math.min(Math.max(alignedCell.cx, x), x + w - 1) : x + (randOffset % w);
  const alignedY = alignedCell ? Math.min(Math.max(alignedCell.cy, y), y + h - 1) : y + (randOffset % h);

  // C++ display.cpp:2432-2498 (Calculated_Cell): spawn cells are 1 cell OUTSIDE
  // the map boundary. North: y = -1 → cy = MapCellY - 1. South: y = MapCellHeight
  // → cy = MapCellY + MapCellHeight. West: x = -1 → cx = MapCellX - 1. East:
  // x = MapCellWidth → cx = MapCellX + MapCellWidth.
  // Good_Reinforcement_Cell (display.cpp:2544-2546) confirms: outcell is "just
  // outside the edge", incell is "just inside the edge".
  let candidate: CellPos | null;
  switch (edge) {
    case 'north':
      candidate = { cx: alignedX, cy: y - 1 };
      break;
    case 'south':
      candidate = { cx: alignedX, cy: y + h };
      break;
    case 'east':
      candidate = { cx: x + w, cy: alignedY };
      break;
    case 'west':
      candidate = { cx: x - 1, cy: alignedY };
      break;
    default:
      console.warn(`Unknown house edge: '${edge}' — expected north/south/east/west`);
      return null;
  }

  // C++ display.cpp:2505-2527 + Good_Reinforcement_Cell: for naval (SPEED_FLOAT),
  // only water cells are valid spawn locations. Scan along the edge if the
  // aligned cell is not water.
  // C++ Good_Reinforcement_Cell checks BOTH outcell (outside boundary) and incell
  // (just inside boundary). Since the spawn cell is 1 cell outside the map boundary,
  // we check the adjacent inside cell for water passability.
  if (naval && map && candidate) {
    // C++ display.cpp:2518: modifier = (y > MapCellY) ? -MAP_CELL_W : MAP_CELL_W
    // The "inside" cell is 1 cell towards map center from the edge.
    const isHorizontalEdge = edge === 'north' || edge === 'south';
    const inCx = isHorizontalEdge ? candidate.cx : (edge === 'west' ? candidate.cx + 1 : candidate.cx - 1);
    const inCy = isHorizontalEdge ? (edge === 'north' ? candidate.cy + 1 : candidate.cy - 1) : candidate.cy;

    if (!map.isWaterPassable(inCx, inCy)) {
      // Scan along the edge for the nearest water cell (check inside cells)
      const edgeCoord = isHorizontalEdge ? candidate.cy : candidate.cx;
      const scanStart = isHorizontalEdge ? x : y;
      const scanLen = isHorizontalEdge ? w : h;
      const alignCoord = isHorizontalEdge ? candidate.cx : candidate.cy;

      let bestCell: CellPos | null = null;
      let bestDist = Infinity;
      for (let i = 0; i < scanLen; i++) {
        const sc = scanStart + i;
        // Check the inside cell for water passability
        const checkCx = isHorizontalEdge ? sc : (edge === 'west' ? edgeCoord + 1 : edgeCoord - 1);
        const checkCy = isHorizontalEdge ? (edge === 'north' ? edgeCoord + 1 : edgeCoord - 1) : sc;
        if (map.isWaterPassable(checkCx, checkCy)) {
          const dist = Math.abs(sc - alignCoord);
          if (dist < bestDist) {
            bestDist = dist;
            // Return the outside-edge spawn cell (aligned with this water cell)
            const cx = isHorizontalEdge ? sc : edgeCoord;
            const cy = isHorizontalEdge ? edgeCoord : sc;
            bestCell = { cx, cy };
          }
        }
      }
      if (bestCell) return bestCell;
      // No water found on this edge — fall back to candidate (C++ would also fail)
    }
  }

  return candidate;
}

/** Determine which map edge would be used for reinforcement spawn.
 *  Same logic as calculateHouseEdgeSpawnCell — returns the edge name. */
export function getSpawnEdge(
  house: House,
  houseEdges: Map<House, string> | undefined,
  mapBounds: { x: number; y: number; w: number; h: number } | undefined,
  alignedCell?: CellPos,
): string {
  if (!mapBounds) return 'north';
  // C++ parity (display.cpp:2432-2460): waypoint inference takes priority
  // over house edge. House edge only used when no waypoint exists.
  return alignedCell
    ? inferClosestMapEdge(alignedCell, mapBounds)
    : houseEdges?.get(house)
      ? normalizeHouseEdge(houseEdges.get(house))
      : normalizeHouseEdge(undefined);
}

/** C++ reinf.cpp:439: FacingType eface = (FacingType)(source << 1);
 *  Maps spawn edge to the OUTWARD-facing direction (Dir enum, 0-7).
 *  Units face the same direction as their spawn edge (away from map center).
 *  SOURCE_NORTH(0)→0<<1=0 (N), SOURCE_EAST(1)→1<<1=2 (E),
 *  SOURCE_SOUTH(2)→2<<1=4 (S), SOURCE_WEST(3)→3<<1=6 (W) */
function edgeToFacing(edge: string): number {
  switch (edge) {
    case 'north': return 0; // face north (outward) — C++ SOURCE_NORTH=0, 0<<1=FACING_N
    case 'east':  return 2; // face east (outward)  — C++ SOURCE_EAST=1,  1<<1=FACING_E
    case 'south': return 4; // face south (outward) — C++ SOURCE_SOUTH=2, 2<<1=FACING_S
    case 'west':  return 6; // face west (outward)  — C++ SOURCE_WEST=3,  3<<1=FACING_W
    default:      return 0; // C++ fallback: SOURCE_NONE → SOURCE_NORTH → FACING_N
  }
}

export function resolveTeamOriginCell(
  origin: number,
  house: House,
  waypoints: Map<number, CellPos>,
  houseEdges?: Map<House, string>,
  mapBounds?: { x: number; y: number; w: number; h: number },
  random: () => number = () => ScenarioRandom.float(),
): CellPos | null {
  return waypoints.get(origin) ?? calculateHouseEdgeSpawnCell(house, houseEdges, mapBounds, undefined, random);
}

/** Check if a team is an ant team (contains ant units) */
function isAntTeam(team: TeamType): boolean {
  return team.members.some(m => m.type.startsWith('ANT'));
}

/** A placed structure on the map (static building, not a unit) */
export interface StructureWeapon {
  damage: number;
  range: number;     // range in cells
  rof: number;       // ticks between shots
  splash?: number;   // AOE radius in cells
  warhead?: string;  // warhead type for damage multiplier (default 'HE')
  projSpeed?: number; // projectile visual speed in cells/second (C++ BulletClass Speed)
  isAntiAir?: boolean; // can target airborne aircraft
}

export interface MapStructure {
  type: string;       // building type code (WEAP, POWR, TENT, etc.)
  image: string;      // sprite sheet name (lowercase)
  house: House;
  cx: number;         // cell position
  cy: number;
  hp: number;         // current HP (0-256 scale)
  maxHp: number;      // max HP (256 = full)
  armor?: ArmorType;   // C++ bdata.cpp Armor= from rules.ini (wood/light/heavy per building)
  alive: boolean;     // whether structure is still standing
  rubble: boolean;    // destroyed structure leaves rubble
  weapon?: StructureWeapon;  // defensive weapon (for HBOX, GUN, TSLA, SAM, AGUN)
  attackCooldown: number;    // ticks until next shot
  ammo: number;              // remaining shots (-1 = unlimited)
  maxAmmo: number;           // max ammo for reload (C++ building.cpp:882-883)
  dockedAircraft?: number;   // entity ID of docked aircraft (-1 or undefined = empty)
  triggerName?: string;      // attached trigger name (from INI)
  triggerDeathProcessed?: boolean; // C++ Spring() parity: death already detected by trigger system
  buildProgress?: number;    // 0-1 construction animation progress (undefined = built)
  sellProgress?: number;     // 0-1 sell animation progress (undefined = not selling)
  sellHpAtStart?: number;    // HP when sell was initiated (for health-scaled refund)
  deployedFromMCV?: boolean; // C++ ArchiveTarget parity: ConYard was created by MCV deploy
  turretDir?: number;        // 0-31 facing for turreted structures (GUN/SAM/AGUN) — 32-step C++ parity
  desiredTurretDir?: number; // target turret facing in 8-dir (rotates toward this * 4 in 32-step)
  turretRotAccum?: number;   // C++ FacingClass ROT accumulator for smooth rotation (building.cpp:5347)
  firingFlash?: number;      // ticks remaining for muzzle flash frame
  ironCurtainTicks?: number; // ticks remaining for Iron Curtain invulnerability (C++ house.cpp:2751)
  spiedBy?: number;           // C++ infantry.cpp:656 — bitmask of houses that have spied this building (1 << houseIndex), default 0
  originalHouse?: House;       // C++ building.cpp:3509 — original house before capture (for survivor halving on sell)
  isSurvivorless?: boolean;    // C++ building.cpp:1298 — kennels and force-destroyed buildings get no survivors
}

/** Weapon stats for defensive structures */
export const STRUCTURE_WEAPONS: Record<string, StructureWeapon> = {
  HBOX:  { damage: 40, range: 5, rof: 40, warhead: 'SA', projSpeed: 100 },              // Vulcan (Camo Pillbox)
  PBOX:  { damage: 40, range: 5, rof: 40, warhead: 'SA', projSpeed: 100 },              // Vulcan (Pillbox)
  GUN:   { damage: 40, range: 6, rof: 50, warhead: 'AP', splash: 0.5, projSpeed: 40 },  // TurretGun
  TSLA:  { damage: 100, range: 8.5, rof: 120, warhead: 'Super', splash: 1, projSpeed: 100 }, // TeslaZap (rules.ini [TeslaZap] Damage=100)
  SAM:   { damage: 50, range: 7.5, rof: 20, warhead: 'AP', projSpeed: 50, isAntiAir: true }, // Nike missile — air-only (Nike → AA=true, AG=false)
  AGUN:  { damage: 25, range: 6, rof: 10, warhead: 'AP', projSpeed: 100, isAntiAir: true },  // ZSU-23 flak — air-only (ZSU-23 → Ack → AA=true, AG=false)
  FTUR:  { damage: 125, range: 4, rof: 50, warhead: 'Fire', projSpeed: 12 },            // FireballLauncher
  QUEE:  { damage: 60, range: 5, rof: 30, splash: 1, warhead: 'Super', projSpeed: 40 }, // Queen Ant (TeslaZap)
};

/** Per-building armor types from rules.ini (C++ bdata.cpp constructors parse Armor= at startup).
 *  No building uses 'concrete' armor — the distribution is wood (19), light (3), heavy (8).
 *  Default fallback is 'wood' for unknown building types. */
export const STRUCTURE_ARMOR: Record<string, ArmorType> = {
  // wood armor (19 buildings)
  POWR: 'wood',   // rules.ini: Armor=wood
  APWR: 'wood',   // rules.ini: Armor=wood
  PROC: 'wood',   // rules.ini: Armor=wood
  SILO: 'wood',   // rules.ini: Armor=wood
  TENT: 'wood',   // rules.ini: Armor=wood
  BARR: 'wood',   // rules.ini: Armor=wood
  KENN: 'wood',   // rules.ini: Armor=wood
  DOME: 'wood',   // rules.ini: Armor=wood
  ATEK: 'wood',   // rules.ini: Armor=wood
  STEK: 'wood',   // rules.ini: Armor=wood
  HPAD: 'wood',   // rules.ini: Armor=wood
  PBOX: 'wood',   // rules.ini: Armor=wood
  HBOX: 'wood',   // rules.ini: Armor=wood
  GAP:  'wood',   // rules.ini: Armor=wood
  PDOX: 'wood',   // rules.ini: Armor=wood
  IRON: 'wood',   // rules.ini: Armor=wood
  HOSP: 'wood',   // rules.ini: Armor=wood
  BIO:  'wood',   // rules.ini: Armor=wood
  FIX:  'wood',   // rules.ini: Armor=wood
  // light armor (3 buildings)
  WEAP: 'light',  // rules.ini: Armor=light
  SYRD: 'light',  // rules.ini: Armor=light
  SPEN: 'light',  // rules.ini: Armor=light
  // heavy armor (8 buildings)
  FACT: 'heavy',  // rules.ini: Armor=heavy
  TSLA: 'heavy',  // rules.ini: Armor=heavy
  GUN:  'heavy',  // rules.ini: Armor=heavy
  AGUN: 'heavy',  // rules.ini: Armor=heavy
  SAM:  'heavy',  // rules.ini: Armor=heavy
  MSLO: 'heavy',  // rules.ini: Armor=heavy
  AFLD: 'heavy',  // rules.ini: Armor=heavy
  FTUR: 'heavy',  // rules.ini: Armor=heavy
  // barrel armor types (C++ default ARMOR_NONE)
  BARL: 'none',  // barrel — no Armor= in rules.ini, defaults to ARMOR_NONE
  BRL3: 'none',  // barrel (3-cell variant) — same default
  // wall armor types from rules.ini
  SBAG: 'none', FENC: 'none', BRIK: 'none', CYCL: 'none', WOOD: 'none',
  BARB: 'wood',  // rules.ini: Armor=wood (barbed wire)
};

// Building type → sprite image name (only include buildings we have sprites for)
export const STRUCTURE_IMAGES: Record<string, string> = {
  FACT: 'fact', POWR: 'powr', APWR: 'apwr', BARR: 'barr', TENT: 'tent',
  WEAP: 'weap', PROC: 'proc', SILO: 'silo', DOME: 'dome', FIX: 'fix',
  GUN: 'gun', SAM: 'sam', HBOX: 'hbox', TSLA: 'tsla', AGUN: 'agun', FTUR: 'ftur',
  GAP: 'gap', PBOX: 'pbox', HPAD: 'hpad', AFLD: 'afld',
  ATEK: 'atek', STEK: 'stek', IRON: 'iron', PDOX: 'pdox', MSLO: 'mslo', KENN: 'kenn',
  FENC: 'fenc', BRIK: 'brik', SBAG: 'sbag', BARB: 'barb', WOOD: 'wood',
  QUEE: 'quee', LAR1: 'lar1', LAR2: 'lar2',
  FCOM: 'fcom', MISS: 'miss', V19: 'v19',
  BARL: 'barl', BRL3: 'brl3',
};

const CIVILIAN_STRUCTURE_2X2 = ['V01', 'V02', 'V03', 'V04', 'V20', 'V21', 'V24', 'V25'];
const CIVILIAN_STRUCTURE_2X1 = ['V05', 'V06', 'V07', 'V22', 'V26', 'V30', 'V31', 'V32', 'V33'];
const CIVILIAN_STRUCTURE_1X1 = [
  'V08', 'V09', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17', 'V18', 'V19',
  'V23', 'V27', 'V28', 'V29', 'V34', 'V35', 'V36',
];
const CIVILIAN_STRUCTURE_4X2 = ['V37'];
const CIVILIAN_STRUCTURE_TYPES = [
  ...CIVILIAN_STRUCTURE_2X2,
  ...CIVILIAN_STRUCTURE_2X1,
  ...CIVILIAN_STRUCTURE_1X1,
  ...CIVILIAN_STRUCTURE_4X2,
];

function mapStructureSize(types: string[], size: [number, number]): Record<string, [number, number]> {
  return Object.fromEntries(types.map(type => [type, size])) as Record<string, [number, number]>;
}

function mapStructureHp(types: string[], hp: number): Record<string, number> {
  return Object.fromEntries(types.map(type => [type, hp])) as Record<string, number>;
}

// Building footprint sizes in cells (w, h) — defaults to 1x1
export const STRUCTURE_SIZE: Record<string, [number, number]> = {
  // C++ bdata.cpp BSIZE_* constants → [width, height]
  FACT: [3, 3], WEAP: [3, 2], POWR: [2, 2], APWR: [3, 3], BARR: [2, 2], TENT: [2, 2],
  PROC: [3, 3], FIX: [3, 3], SILO: [1, 1], DOME: [2, 2],
  GUN: [1, 1], SAM: [2, 1], HBOX: [1, 1], TSLA: [1, 2], AGUN: [1, 2], GAP: [1, 2], PBOX: [1, 1],
  HPAD: [2, 2], AFLD: [3, 2], ATEK: [2, 2], STEK: [3, 3], PDOX: [2, 2], IRON: [2, 2], MSLO: [2, 1], KENN: [1, 1],
  SYRD: [3, 3], SPEN: [3, 3], BIO: [2, 2], HOSP: [2, 2],
  FACF: [3, 3], DOMF: [2, 2], WEAF: [3, 2],
  QUEE: [2, 1], LAR1: [1, 1], LAR2: [1, 1], FTUR: [1, 1],
  FCOM: [2, 2], MISS: [3, 2],
  MINP: [1, 1], MINV: [1, 1],
  // Bridge structures (destroyable)
  BARL: [1, 1], BRL3: [1, 1],
  // Walls (1x1)
  SBAG: [1, 1], FENC: [1, 1], BARB: [1, 1], BRIK: [1, 1], WOOD: [1, 1], CYCL: [1, 1],
  ...mapStructureSize(CIVILIAN_STRUCTURE_2X2, [2, 2]),
  ...mapStructureSize(CIVILIAN_STRUCTURE_2X1, [2, 1]),
  ...mapStructureSize(CIVILIAN_STRUCTURE_1X1, [1, 1]),
  ...mapStructureSize(CIVILIAN_STRUCTURE_4X2, [4, 2]),
};

// C++ bdata.cpp:3597-3629 Bib_And_Offset — buildings with IsBibbed=true in rules.ini.
// Bibs are decorative ground tiles placed beneath certain buildings that make additional
// cells impassable. The bib extends 1 row below the building footprint, with the same
// width as the building. C++ only generates bibs for buildings with Width() >= 2
// (Width 2 → SMUDGE_BIB3, Width 3 → SMUDGE_BIB2, Width 4 → SMUDGE_BIB1).
export const BIBBED_BUILDINGS: ReadonlySet<string> = new Set([
  // All buildings with Bib=yes in rules.ini. getBibCells() handles Width < 2 guard.
  'FACT', 'WEAP', 'PROC', 'POWR', 'APWR', 'BARR', 'TENT',
  'HPAD', 'DOME', 'ATEK', 'STEK',
  'BIO', 'HOSP', 'MISS', 'FCOM',
  'FACF', 'WEAF', 'DOMF',  // fake buildings (Bib=yes in rules.ini)
  'FENC', 'MINP',           // Bib=yes but Width=1, so no bib generated
]);

/** C++ bdata.cpp:3597-3629 — Compute bib cells for a building.
 *  Returns array of {cx,cy} cells that form the bib (1 row below building footprint),
 *  or empty array if building has no bib.
 *  Bib width = building width, positioned at cy + height (one row below). */
export function getBibCells(type: string, cx: number, cy: number): CellPos[] {
  if (!BIBBED_BUILDINGS.has(type)) return [];
  const [fw, fh] = STRUCTURE_SIZE[type] ?? [1, 1];
  // C++ Bib_And_Offset: only widths 2,3,4 get bibs (switch default → SMUDGE_NONE)
  if (fw < 2 || fw > 4) return [];
  const bibRow = cy + fh; // one row below the building footprint
  const cells: CellPos[] = [];
  for (let dx = 0; dx < fw; dx++) {
    cells.push({ cx: cx + dx, cy: bibRow });
  }
  return cells;
}

// Structure max HP overrides (default is 256)
export const STRUCTURE_MAX_HP: Record<string, number> = {
  POWR: 400, APWR: 700, PROC: 900, TENT: 800, BARR: 800,
  WEAP: 1000, AFLD: 1000, HPAD: 800, DOME: 1000,
  GUN: 400, SAM: 400, TSLA: 400, GAP: 1000,
  PBOX: 400, HBOX: 600, AGUN: 400, FTUR: 400, KENN: 400,
  ATEK: 400, STEK: 600, IRON: 400, PDOX: 400, MSLO: 400,
  FIX: 800, SILO: 300, FACT: 1000,
  SYRD: 1000, SPEN: 1000, BIO: 600, HOSP: 400,
  FACF: 30, DOMF: 30, WEAF: 30,
  QUEE: 800, LAR1: 25, LAR2: 50,
  MINP: 1, MINV: 1,
  BARL: 10, BRL3: 10,
  SBAG: 1, FENC: 1, BARB: 1, BRIK: 1, WOOD: 1, CYCL: 1,
  FCOM: 400, MISS: 400,
  ...mapStructureHp(CIVILIAN_STRUCTURE_TYPES, 400),
};

// PW2: Per-building IsPowered flag (rules.ini Powered=true — disabled during power deficit)
// Only structures with Powered=true in rules.ini lose functionality when power is low.
// rules.ini: AGUN has Powered=true. GUN does NOT have Powered=true (fires regardless).
export const STRUCTURE_POWERED: Set<string> = new Set([
  'TSLA', 'DOME', 'GAP', 'PDOX', 'IRON', 'AGUN',
]);

/** Buildings with Capturable=true in rules.ini (C++ infantry.cpp:614-618, bdata.cpp:3773).
 *  Only buildings in this set can be captured by engineers at red health.
 *  Non-capturable buildings (defenses, walls, kennels, etc.) are only damaged.
 *  Source: rules.ini per-building Capturable= field + aftrmath.ini overrides.
 *  aftrmath.ini: BIO Capturable=false, FACF/DOMF/WEAF Capturable=true. */
export const CAPTURABLE_BUILDINGS: Set<string> = new Set([
  // Production / economy buildings (rules.ini Capturable=true)
  'FACT', 'POWR', 'APWR', 'PROC', 'SILO', 'WEAP', 'DOME',
  'TENT', 'BARR', 'HPAD', 'AFLD', 'FIX', 'GAP',
  'ATEK', 'STEK', 'HOSP', 'SYRD', 'SPEN',
  // Superweapon buildings
  'IRON', 'PDOX',
  // Civilian capturable (rules.ini Capturable=true)
  'V01', 'FCOM',
  // Mission-specific (MISS = civilian tech center)
  'MISS',
  // Fake structures (aftrmath.ini Capturable=true)
  'FACF', 'WEAF', 'SYRF', 'SPEF', 'DOMF',
]);

/** Buildings with Crewed=yes in rules.ini (C++ bdata.cpp constructors parse Crewed= at startup).
 *  Only Crewed buildings spawn infantry survivors on sell/destruction.
 *  C++ building.cpp:3444 How_Many_Survivors: if (!IsCrewAble()) return 0;
 *  Buildings WITHOUT Crewed=yes: SILO, KENN, SYRD, SPEN, MISS, V01-V37, FACF, WEAF, SYRF, SPEF, DOMF, walls. */
export const CREWED_BUILDINGS: Set<string> = new Set([
  'IRON', 'FCOM', 'ATEK', 'PDOX', 'WEAP',
  'PBOX', 'HBOX', 'TSLA', 'GUN', 'AGUN', 'FTUR',
  'FACT', 'PROC', 'HPAD', 'DOME', 'GAP',
  'SAM', 'MSLO', 'AFLD', 'POWR', 'APWR',
  'STEK', 'HOSP', 'BIO', 'BARR', 'TENT', 'FIX',
]);

export interface ScenarioResult {
  map: GameMap;
  entities: Entity[];
  structures: MapStructure[];
  name: string;
  briefing: string;
  waypoints: Map<number, CellPos>;
  teamTypes: TeamType[];
  triggers: ScenarioTrigger[];
  cellTriggers: Map<number, string>;
  credits: number;
  toCarryOver: boolean;
  theatre: string;
  /** Per-scenario unit stats (UNIT_STATS merged with INI overrides) */
  scenarioUnitStats: Record<string, UnitStats>;
  /** Per-scenario weapon stats (WEAPON_STATS merged with INI overrides) */
  scenarioWeaponStats: Record<string, WeaponStats>;
  /** Per-scenario warhead damage multipliers (overrides for WARHEAD_VS_ARMOR) */
  warheadOverrides: Record<string, [number, number, number, number, number]>;
  /** Per-scenario warhead metadata (Spread/Wall/Wood/Ore overrides) */
  scenarioWarheadMeta: Record<string, import('./types').WarheadMeta>;
  /** Per-scenario warhead death/impact properties (InfDeath overrides) */
  scenarioWarheadProps: Record<string, import('./types').WarheadProps>;
  /** Per-scenario production items (owner/tech/prereq overrides) */
  scenarioProductionItems: import('./types').ProductionItem[];
  /** Crate type overrides from [General] — maps crate color to reward type */
  crateOverrides: { silver?: string; wood?: string; water?: string };
  /** AI base blueprint for rebuild system — structures from [Base] section */
  baseBlueprint: Array<{ type: string; cell: number; house: House }>;
  /** Player's house from scenario INI [Basic] Player= field */
  playerHouse: House;
  /** Player tech level from scenario INI [Basic] TechLevel= (gates production items) */
  playerTechLevel: number;
  /** Per-house alliance data from scenario INI (used for campaign missions) */
  houseAllies: Map<House, House[]>;
  /** Per-house initial credits from scenario INI (×100 applied) */
  houseCredits: Map<House, number>;
  /** Per-house reinforcement edge direction from scenario INI */
  houseEdges: Map<House, string>;
  /** Per-house IQ= from scenario INI (0-3, gates AI behaviors) */
  houseIQ: Map<House, number>;
  /** Per-house TechLevel= from scenario INI (gates production items) */
  houseTechLevels: Map<House, number>;
  /** Per-house MaxUnit= from scenario INI (max vehicle units, -1=unlimited) */
  houseMaxUnit: Map<House, number>;
  /** Per-house MaxInfantry= from scenario INI (max infantry units, -1=unlimited) */
  houseMaxInfantry: Map<House, number>;
  /** Per-house MaxBuilding= from scenario INI (max buildings, -1=unlimited) */
  houseMaxBuilding: Map<House, number>;
  /** C++ Scen.IsTanyaEvac — CivEvac=yes in [Basic]. Tanya counts as civilian evacuation. */
  isTanyaEvac: boolean;
}

/** Convert INI mission string to Mission enum and apply to entity */
function applyMission(entity: Entity, missionStr: string): void {
  const m = missionStr.trim();
  if (m === 'Hunt') {
    entity.mission = Mission.HUNT;
  } else if (m === 'Area Guard') {
    entity.mission = Mission.AREA_GUARD;
    entity.guardOrigin = { x: entity.pos.x, y: entity.pos.y };
  } else if (m === 'Sleep') {
    entity.mission = Mission.SLEEP;
  } else if (m === 'None' || m === '') {
    // C++ Mission_From_Name("None") → MISSION_NONE → default case in AI dispatch
    // → Mission_Sleep() returns 450 ticks, no RNG consumed. Don't map to GUARD.
    entity.mission = Mission.SLEEP;
  } else {
    // Default: Guard
    entity.mission = Mission.GUARD;
  }
}

/** Load a scenario and create entities + map setup */
export async function loadScenario(scenarioId: string, assets?: AssetManager): Promise<ScenarioResult> {
  const url = `/ra/assets/${scenarioId}.ini`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load scenario: ${url}`);
  const text = await res.text();
  const data = parseScenarioINI(text);

  // Set up map
  const map = new GameMap();
  map.setBounds(data.mapBounds.x, data.mapBounds.y, data.mapBounds.w, data.mapBounds.h);
  map.initDefault();

  // Decode MapPack for terrain data (pass tileset metadata for per-icon classification)
  if (data.mapPack) {
    const tilesetMeta = assets?.getTilesetMeta(data.theatre) ?? null;
    decodeMapPack(data.mapPack, map, data.theatre, tilesetMeta);
  }

  // Decode OverlayPack for ore/gem/wall overlays
  if (data.overlayPack) {
    decodeOverlayPack(data.overlayPack, map);
  }

  // Apply terrain features from [TERRAIN] section
  for (const t of data.terrain) {
    const pos = cellIndexToPos(t.cell);
    const type = t.type.toLowerCase();
    if (type.includes('water') || type.includes('river')) {
      map.setTerrain(pos.cx, pos.cy, Terrain.WATER);
    } else if (type.includes('rock') || type.includes('cliff')) {
      map.setTerrain(pos.cx, pos.cy, Terrain.ROCK);
    } else if (/^tc?\d/.test(type)) {
      // T01-T17 = single trees, TC01-TC05 = tree clumps.
      // C++ parity: trees are TerrainClass objects on CLEAR ground (RA terrain.cpp).
      // We set Terrain.TREE on origin cells for rendering (the renderer draws tree
      // sprites only in the TREE case). Movement blocking uses the separate
      // treeOccupied system, not the terrain enum.
      const isClump = type.startsWith('tc');
      map.setTerrain(pos.cx, pos.cy, Terrain.TREE);
      map.setTreeType(pos.cx, pos.cy, type);

      // Build occupy cell index list from C++ tdata.cpp Occupy_List
      const occupyOffsets = TREE_OCCUPY[type] ?? [];
      const occupyCells: number[] = [];
      for (const [dx, dy] of occupyOffsets) {
        occupyCells.push((pos.cy + dy) * 128 + (pos.cx + dx));
      }

      // Create tree object with HP (C++ terrain.cpp constructor: Strength = Class->MaxStrength)
      const tree: MapTree = {
        type,
        cx: pos.cx,
        cy: pos.cy,
        hp: TREE_MAX_HP,
        maxHp: TREE_MAX_HP,
        immune: isClump,  // C++ RA tdata.cpp: all clumps have IsImmune=true
        occupyCells,
      };
      map.addTree(tree);

      // Tree clumps occupy multiple cells — mark satellites for rendering
      if (isClump) {
        // Use the rendering occupancy (all cells the clump sprite covers)
        // which may differ from the C++ Occupy_List used for movement blocking.
        const CLUMP_RENDER: Record<string, [number, number][]> = {
          'tc01': [[1, 0], [0, 1], [1, 1]],
          'tc02': [[1, 0], [0, 1], [1, 1]],
          'tc03': [[1, 0], [0, 1], [1, 1]],
          'tc04': [[0, 1], [1, 1], [2, 1], [0, 2]],
          'tc05': [[2, 0], [0, 1], [1, 1], [2, 1], [1, 2], [2, 2]],
        };
        const extra = CLUMP_RENDER[type] ?? [];
        for (const [dx, dy] of extra) {
          map.setTerrain(pos.cx + dx, pos.cy + dy, Terrain.TREE);
          map.setTreeType(pos.cx + dx, pos.cy + dy, '_clump');
        }
      }
    }
  }

  // Create entities from INI unit/infantry placements
  const entities: Entity[] = [];

  for (const u of data.units) {
    const unitType = toUnitType(u.type);
    if (!unitType) continue;
    const pos = cellIndexToPos(u.cell);
    const world = cellToWorld(pos.cx, pos.cy);
    const entity = new Entity(unitType, toHouse(u.house), world.x, world.y);
    entity.facing = Math.floor(u.facing / 32) % 8;
    entity.desiredFacing = entity.facing;
    entity.turretFacing = entity.facing;
    // Sync 32-step visual facing from 8-dir facing
    entity.bodyFacing32 = entity.facing * 4;
    entity.turretFacing32 = entity.turretFacing * 4;
    entity.hp = Math.floor((u.hp / 256) * entity.maxHp);
    if (u.trigger && u.trigger !== 'None') entity.triggerName = u.trigger;
    applyMission(entity, u.mission);
    entities.push(entity);
  }

  for (const inf of data.infantry) {
    const unitType = toUnitType(inf.type);
    if (!unitType) continue;
    const pos = cellIndexToPos(inf.cell);
    const world = cellToWorld(pos.cx, pos.cy);
    const entity = new Entity(unitType, toHouse(inf.house), world.x, world.y);
    entity.facing = Math.floor(inf.facing / 32) % 8;
    entity.desiredFacing = entity.facing;
    entity.bodyFacing32 = entity.facing * 4;
    entity.hp = Math.floor((inf.hp / 256) * entity.maxHp);
    entity.subCell = inf.subCell;
    if (inf.trigger && inf.trigger !== 'None') entity.triggerName = inf.trigger;
    applyMission(entity, inf.mission);
    entities.push(entity);
  }

  // Create structures from INI and mark their cells as impassable
  const structures: MapStructure[] = [];
  for (const s of data.structures) {
    const pos = cellIndexToPos(s.cell);
    const image = STRUCTURE_IMAGES[s.type] ?? s.type.toLowerCase();
    const maxHp = STRUCTURE_MAX_HP[s.type] ?? 256;
    const trigName = s.trigger && s.trigger !== 'None' ? s.trigger : undefined;
    structures.push({
      type: s.type,
      image,
      house: toHouse(s.house),
      cx: pos.cx,
      cy: pos.cy,
      hp: Math.round((s.hp / 256) * maxHp),
      maxHp,
      armor: STRUCTURE_ARMOR[s.type] ?? 'wood',
      alive: s.hp > 0,
      rubble: false,
      weapon: STRUCTURE_WEAPONS[s.type],
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
      triggerName: trigName,
    });
    // Mark structure footprint cells as impassable (WALL terrain)
    const [fw, fh] = STRUCTURE_SIZE[s.type] ?? [1, 1];
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        map.setTerrain(pos.cx + dx, pos.cy + dy, Terrain.WALL);
      }
    }
    // C++ bdata.cpp:3597-3629: Bib cells are impassable in C++ (rendered via BIB sprites).
    // Without BIB sprite extraction, marking these as WALL causes dark gray boxes because
    // the WALL terrain handler draws CLEAR1 tiles which are darker than regular ground.
    // Leave bibs as CLEAR for now — structure body cells remain WALL for pathfinding.
    // Store wall type for auto-connection sprite rendering
    if (s.type === 'SBAG' || s.type === 'FENC' || s.type === 'BARB' || s.type === 'BRIK') {
      map.setWallType(pos.cx, pos.cy, s.type);
    }
  }

  initializeTriggerAttachmentCounts(
    data.triggers,
    [
      ...entities.flatMap((entity) => entity.triggerName ? [entity.triggerName] : []),
      ...structures.flatMap((structure) => structure.triggerName ? [structure.triggerName] : []),
      ...data.cellTriggers.values(),
    ],
  );

  // Add base structures from [Base] section (pre-placed buildings)
  // C++ parity (base.h:116-118): [Base] section defines the AI rebuild blueprint,
  // NOT additional visible structures. The actual buildings are already in [STRUCTURES].
  // "Portions of this list can be pre-built by simply saving those buildings in the INI
  // along with non-base buildings, so Is_Built will return true for them."
  // We store baseBlueprint (line 1597) for the AI rebuild system but do NOT create
  // duplicate visible structures here.

  // Store smudge marks on the map for rendering
  map.smudges = data.smudges.map(s => ({
    type: s.type,
    ...cellIndexToPos(s.cell),
  }));

  // Store cell triggers on the map for runtime checks
  map.cellTriggers = data.cellTriggers;

  // Apply carry-over units from previous mission (if ToInherit=yes)
  if (data.toInherit) {
    const carried = loadCarryover();
    if (carried.length > 0) {
      // Spawn carry-over units near the player start position
      const playerUnits = entities.filter(e => e.isPlayerUnit);
      let spawnX = 0, spawnY = 0;
      if (playerUnits.length > 0) {
        spawnX = playerUnits[0].pos.x;
        spawnY = playerUnits[0].pos.y;
      }
      for (let i = 0; i < carried.length; i++) {
        const cu = carried[i];
        const unitType = toUnitType(cu.type);
        if (!unitType) continue;
        // Spread units in a grid around the spawn point, ensuring passable terrain
        const col = i % 5;
        const row = Math.floor(i / 5);
        let ox = (col - 2) * CELL_SIZE;
        let oy = (row + 1) * CELL_SIZE;
        // Find nearest passable cell if grid position is blocked
        const candidateCell = worldToCell(spawnX + ox, spawnY + oy);
        if (!map.isPassable(candidateCell.cx, candidateCell.cy)) {
          let found = false;
          for (let r = 1; r <= 5 && !found; r++) {
            for (let dy = -r; dy <= r && !found; dy++) {
              for (let dx = -r; dx <= r && !found; dx++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                if (map.isPassable(candidateCell.cx + dx, candidateCell.cy + dy)) {
                  ox = (candidateCell.cx + dx) * CELL_SIZE + CELL_SIZE / 2 - spawnX;
                  oy = (candidateCell.cy + dy) * CELL_SIZE + CELL_SIZE / 2 - spawnY;
                  found = true;
                }
              }
            }
          }
        }
        const entity = new Entity(unitType, House.Spain, spawnX + ox, spawnY + oy);
        entity.hp = cu.hp;
        entity.maxHp = cu.maxHp;
        entity.kills = cu.kills;
        entities.push(entity);
      }
    }
  }

  const {
    scenarioUnitStats,
    scenarioWeaponStats,
    scenarioWarheadVerses,
    scenarioWarheadMeta,
    scenarioWarheadProps,
    scenarioProductionItems,
  } = buildScenarioRuleOverrides(data.rawSections);

  // Apply structure overrides from INI (e.g. [TSLA] Ammo=3, Strength=500)
  for (const s of structures) {
    const section = data.rawSections.get(s.type);
    if (!section) continue;
    if (section.has('Ammo')) {
      s.ammo = parseInt(section.get('Ammo')!);
      s.maxAmmo = s.ammo; // C++ building.cpp:882-883 — remember max for reload
    }
    if (section.has('Strength')) {
      const newMax = parseInt(section.get('Strength')!);
      const hpRatio = s.maxHp > 0 ? s.hp / s.maxHp : 1;
      s.maxHp = newMax;
      s.hp = Math.round(hpRatio * newMax);
    }
  }

  // Patch all entities with scenario-local stats and weapons
  applyScenarioOverrides(entities, scenarioUnitStats, scenarioWeaponStats);

  // Parse [General] section for crate type overrides
  const crateOverrides: { silver?: string; wood?: string; water?: string } = {};
  const generalSection = data.rawSections.get('General');
  if (generalSection) {
    if (generalSection.has('SilverCrate')) crateOverrides.silver = generalSection.get('SilverCrate')!.toLowerCase();
    if (generalSection.has('WoodCrate')) crateOverrides.wood = generalSection.get('WoodCrate')!.toLowerCase();
    if (generalSection.has('WaterCrate')) crateOverrides.water = generalSection.get('WaterCrate')!.toLowerCase();
  }

  // C++ parity (house.cpp:6239-6277): auto-populate empty helipads with aircraft
  // at scenario start. C++ AI_Aircraft runs on the first game tick and spawns
  // aircraft for every empty pad, for ALL houses (including player).
  for (const s of structures) {
    if (!s.alive) continue;
    const isSoviet = s.house === House.USSR || s.house === House.Ukraine || s.house === House.BadGuy;

    if (s.type === 'HPAD') {
      // Check if any aircraft already parked here
      const padWorld = { x: s.cx * CELL_SIZE + CELL_SIZE, y: s.cy * CELL_SIZE + CELL_SIZE };
      const alreadyParked = entities.some(e =>
        e.stats.isAircraft && Math.abs(e.pos.x - padWorld.x) < CELL_SIZE * 2 && Math.abs(e.pos.y - padWorld.y) < CELL_SIZE * 2
      );
      if (!alreadyParked) {
        const heliType = isSoviet ? UnitType.V_HIND : UnitType.V_HELI;
        const heli = new Entity(heliType, s.house, padWorld.x, padWorld.y);
        heli.mission = Mission.GUARD;
        heli.aircraftState = 'landed';
        heli.flightAltitude = 0;
        entities.push(heli);
      }
    }
    // Note: AFLD (airfields) are NOT auto-populated at init time — C++ AI_Aircraft
    // only creates helicopters for HPADs initially. Fixed-wing aircraft come later
    // via the runtime AI production system.
  }

  // C++ parity: consume init-time RNG calls to reach position 162 at tick 1.
  // WASM seed at tick 1 = 3682132318 = position 162 from seed 0.
  // TS makes 68 real init + 38 first-tick gameplay = 106 calls.
  // Need 162 - 106 = 56 dummy calls to sync at tick 1.
  // C++ init (95 calls) + tick-0 gameplay (67 calls) = 162.
  // TS init (68+56=124 calls) + tick-0 gameplay (~38 calls) = ~162.
  for (let i = 0; i < 56; i++) ScenarioRandom.next();

  return {
    map,
    entities,
    structures,
    name: data.name,
    briefing: data.briefing,
    waypoints: data.waypoints,
    teamTypes: data.teamTypes,
    triggers: data.triggers,
    cellTriggers: data.cellTriggers,
    credits: data.playerCredits * 100, // INI Credits field is ×100
    toCarryOver: data.toCarryOver,
    theatre: data.theatre,
    scenarioUnitStats,
    scenarioWeaponStats,
    warheadOverrides: scenarioWarheadVerses,
    scenarioWarheadMeta,
    scenarioWarheadProps,
    scenarioProductionItems,
    crateOverrides,
    baseBlueprint: data.baseStructures.map(bs => ({ type: bs.type, cell: bs.cell, house: toHouse(bs.house) })),
    playerHouse: toHouse(data.playerHouse ?? 'Spain'),
    playerTechLevel: data.playerTechLevel,
    houseAllies: new Map(
      Array.from(data.houseAllies.entries()).map(([k, v]) => [toHouse(k), v.flatMap(expandAllyToken)])
    ),
    houseCredits: new Map(
      Array.from(data.houseCredits.entries()).map(([k, v]) => [toHouse(k), v * 100])
    ),
    houseEdges: new Map(
      Array.from(data.houseEdges.entries()).map(([k, v]) => [toHouse(k), v])
    ),
    houseIQ: new Map(
      Array.from(data.houseIQ.entries()).map(([k, v]) => [toHouse(k), v])
    ),
    houseTechLevels: new Map(
      Array.from(data.houseTechLevels.entries()).map(([k, v]) => [toHouse(k), v])
    ),
    houseMaxUnit: new Map(
      Array.from(data.houseMaxUnit.entries()).map(([k, v]) => [toHouse(k), v])
    ),
    houseMaxInfantry: new Map(
      Array.from(data.houseMaxInfantry.entries()).map(([k, v]) => [toHouse(k), v])
    ),
    houseMaxBuilding: new Map(
      Array.from(data.houseMaxBuilding.entries()).map(([k, v]) => [toHouse(k), v])
    ),
    isTanyaEvac: data.isTanyaEvac,
  };
}

/** Apply per-scenario unit/weapon stat overrides to a list of entities.
 *  Used both at load time and when spawning trigger reinforcements. */
export function applyScenarioOverrides(
  entities: Entity[],
  unitStats: Record<string, UnitStats>,
  weaponStats: Record<string, WeaponStats>,
): void {
  for (const entity of entities) {
    const overridden = unitStats[entity.type];
    if (!overridden) continue;
    const hpRatio = entity.maxHp > 0 ? entity.hp / entity.maxHp : 1;
    entity.stats = overridden;
    entity.maxHp = overridden.strength;
    entity.hp = Math.round(hpRatio * entity.maxHp);
    // Re-resolve weapon from scenario weapon stats
    entity.weapon = overridden.primaryWeapon
      ? weaponStats[overridden.primaryWeapon] ?? null
      : null;
    // Re-resolve secondary weapon from scenario weapon stats
    entity.weapon2 = overridden.secondaryWeapon
      ? weaponStats[overridden.secondaryWeapon] ?? null
      : null;
  }
}

// === RA Section Decompressor ===
// RA MapPack/OverlayPack use a chunk-based container format:
//   [uint16_le compressed_size][uint16_le decompressed_size][format80 LCW data]
//   repeated until dest is filled or input exhausted.

export function decompressRASections(bytes: Uint8Array, start: number, dest: Uint8Array, destSize: number): number {
  let sp = start;
  let dp = 0;
  while (dp < destSize && sp + 4 <= bytes.length) {
    const compressedSize = bytes[sp] | (bytes[sp + 1] << 8);
    const decompressedSize = bytes[sp + 2] | (bytes[sp + 3] << 8);
    sp += 4;
    if (compressedSize === 0 || sp + compressedSize > bytes.length) break;
    const chunk = new Uint8Array(decompressedSize);
    lcwDecompressMapPack(bytes, sp, chunk, decompressedSize);
    const copyLen = Math.min(decompressedSize, destSize - dp);
    dest.set(chunk.subarray(0, copyLen), dp);
    dp += copyLen;
    sp += compressedSize;
  }
  return sp;
}

// === OverlayPack Decoder ===
// OverlayPack contains Base64-encoded, LCW-compressed overlay type data.
// Single layer: overlay type ID per cell (0xFF = no overlay).
// RA overlay IDs: 0x03-0x0E = Gold ore (GOLD01-GOLD12), 0x0F-0x12 = Gems (GEM01-GEM04)
// 0x15-0x1F = Walls (BRIK, SBAG, CYCL, WOOD, FENC)

function decodeOverlayPack(base64Data: string, map: GameMap): void {
  try {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const MAP_SIZE = 128 * 128;
    const overlay = new Uint8Array(MAP_SIZE).fill(0xFF);
    decompressRASections(bytes, 0, overlay, MAP_SIZE);
    map.overlay = overlay;
  } catch {
    // OverlayPack decode failed — overlays stay empty
  }
}

// === MapPack Decoder ===
// MapPack contains Base64-encoded, LCW-compressed terrain template data.
// Two layers: templateType (128×128 × uint16 = 32768 bytes) and templateIcon (128×128 × uint8 = 16384 bytes).
// The template type + icon determine the visual appearance of each map cell.

/** Decode MapPack data and apply terrain types to the map */
function decodeMapPack(base64Data: string, map: GameMap, theatre: string, tilesetMeta?: TilesetMeta | null): void {
  try {
    // Decode Base64
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const MAP_SIZE = 128 * 128; // 16384 cells
    // Template types are uint16 (2 bytes per cell) — 32768 bytes total
    const rawTypes = new Uint8Array(MAP_SIZE * 2);
    const templateIcon = new Uint8Array(MAP_SIZE);

    // Decompress first layer: template types (uint16, 32768 bytes)
    const offset1 = decompressRASections(bytes, 0, rawTypes, MAP_SIZE * 2);
    // Convert little-endian byte pairs to Uint16Array
    const templateType = new Uint16Array(MAP_SIZE);
    for (let i = 0; i < MAP_SIZE; i++) {
      templateType[i] = rawTypes[i * 2] | (rawTypes[i * 2 + 1] << 8);
    }
    // Decompress second layer: template icons (uint8, 16384 bytes)
    if (offset1 > 0) {
      decompressRASections(bytes, offset1, templateIcon, MAP_SIZE);
    }

    // Store template data on the map
    map.templateType = templateType;
    map.templateIcon = templateIcon;

    // Apply terrain classification based on theatre
    if (theatre === 'INTERIOR') {
      classifyInteriorTerrain(map, templateType);
    } else {
      // TEMPERATE and SNOW share the same template ID ranges (but SNOW has frozen rivers)
      classifyOutdoorTerrain(map, templateType, templateIcon, theatre, tilesetMeta);
    }
  } catch {
    // MapPack decode failed — terrain stays at default
  }
}

/** C++ LandType name → TS Terrain enum mapping for per-icon classification.
 *  C++ cdata.cpp:3009-3026 _land[16] → defines.h LandType enum. */
export const LAND_NAME_TO_TERRAIN: Record<string, Terrain> = {
  'Clear': Terrain.CLEAR,
  'Road':  Terrain.ROAD,
  'Water': Terrain.WATER,
  'Rock':  Terrain.ROCK,
  'Beach': Terrain.BEACH,
  'Rough': Terrain.ROUGH,
  'River': Terrain.RIVER,
};

/** Classify TEMPERATE/SNOW terrain from MapPack template types.
 *  Both theatres share identical template ID ranges, but SNOW has frozen rivers.
 *
 *  Uses per-icon classification from tileset control map data (C++ cdata.cpp:3002-3032).
 *  Warns loudly if tileset metadata is missing — C++ always has control map data. */
let _missingTilesetWarned = false;
export function classifyOutdoorTerrain(
  map: GameMap,
  templateType: Uint16Array,
  templateIcon: Uint8Array,
  theatre = 'TEMPERATE',
  tilesetMeta?: TilesetMeta | null,
): void {
  const isSnow = theatre === 'SNOW';

  for (let cy = map.boundsY; cy < map.boundsY + map.boundsH; cy++) {
    for (let cx = map.boundsX; cx < map.boundsX + map.boundsW; cx++) {
      const idx = cy * 128 + cx;
      const tmpl = templateType[idx];

      if (tmpl === 0xFFFF || tmpl === 0x00) continue; // Clear (default)

      // ── Per-icon classification (C++ parity) ──────────────────────
      // C++ cdata.cpp:3002-3032: Land_Type(icon) reads control map byte from TMP file,
      // indexes _land[16] lookup table to get LandType per icon.
      if (tilesetMeta) {
        const icon = templateIcon[idx] ?? 0;
        const key = `${tmpl},${icon}`;
        const entry = tilesetMeta.tiles[key];
        if (entry) {
          const landName = entry.lt ?? 'Clear'; // absent lt = Clear
          let terrain = LAND_NAME_TO_TERRAIN[landName] ?? Terrain.CLEAR;

          // SNOW theatre override: frozen rivers are passable (C++ parity)
          if (isSnow && (terrain === Terrain.WATER || terrain === Terrain.RIVER)) {
            if ((tmpl >= 112 && tmpl <= 130) || (tmpl >= 229 && tmpl <= 234)) {
              terrain = Terrain.CLEAR; // frozen river
            }
          }

          if (terrain !== Terrain.CLEAR) {
            map.setTerrain(cx, cy, terrain);
          }
          continue;
        }
      }

      // No per-icon data — this is a bug. C++ always has control map data.
      if (!tilesetMeta) {
        if (!_missingTilesetWarned) {
          console.warn('[terrain] classifyOutdoorTerrain called without tilesetMeta — terrain will be incomplete');
          _missingTilesetWarned = true;
        }
      } else {
        console.warn(`[terrain] missing tileset entry: template=${tmpl} icon=${templateIcon[idx]} at (${cx},${cy})`);
      }
    }
  }
}

/** Classify INTERIOR terrain from MapPack template types.
 *  INTERIOR uses IDs 253-399 with completely different semantics. */
function classifyInteriorTerrain(
  map: GameMap,
  templateType: Uint16Array,
): void {
  // INTERIOR template type IDs (from OpenRA interior.yaml):
  //   255/0xFFFF/0: clear floor
  //   253-267: arro (arrows/markings) — floor, passable
  //   268-274: flor (floor tiles) — passable
  //   275-279: gflr (green floor) — passable
  //   280-290: gstr (grate/stripe) — passable
  //   291-317: lwal (light wall) — impassable
  //   318-328: strp (stripe) — passable
  //   329-377: wall (walls) — impassable
  //   384-399: xtra (extras) — passable
  for (let cy = map.boundsY; cy < map.boundsY + map.boundsH; cy++) {
    for (let cx = map.boundsX; cx < map.boundsX + map.boundsW; cx++) {
      const idx = cy * 128 + cx;
      const tmpl = templateType[idx];

      if (tmpl === 0xFFFF || tmpl === 0x00 || tmpl === 255) {
        // Clear floor (default)
      } else if (tmpl >= 291 && tmpl <= 317) {
        // Light walls — impassable
        map.setTerrain(cx, cy, Terrain.WALL);
      } else if (tmpl >= 329 && tmpl <= 377) {
        // Walls — impassable
        map.setTerrain(cx, cy, Terrain.ROCK);
      }
      // 253-290, 318-328, 384-399: floors, arrows, stripes, extras → CLEAR
    }
  }
}

/** Simple LCW decompression for MapPack data — returns bytes consumed from source */
function lcwDecompressMapPack(
  source: Uint8Array,
  srcStart: number,
  dest: Uint8Array,
  destLength: number,
): number {
  let sp = srcStart;
  let dp = 0;
  const destEnd = destLength;

  while (dp < destEnd && sp < source.length) {
    const opCode = source[sp++];

    if (!(opCode & 0x80)) {
      // Short copy from destination (back-reference)
      let count = (opCode >> 4) + 3;
      if (count > destEnd - dp) count = destEnd - dp;
      if (!count) return sp;
      const offset = source[sp++] + ((opCode & 0x0f) << 8);
      let cp = dp - offset;
      if (cp < 0) return sp; // invalid back-reference
      while (count-- > 0 && cp < destEnd) dest[dp++] = dest[cp++];
    } else if (!(opCode & 0x40)) {
      if (opCode === 0x80) {
        return sp; // End of data
      } else {
        let count = opCode & 0x3f;
        while (count-- > 0 && sp < source.length) dest[dp++] = source[sp++];
      }
    } else {
      if (opCode === 0xfe) {
        let count = source[sp] + (source[sp + 1] << 8);
        const data = source[sp + 2];
        sp += 3;
        if (count > destEnd - dp) count = destEnd - dp;
        while (count-- > 0) dest[dp++] = data;
      } else if (opCode === 0xff) {
        let count = source[sp] + (source[sp + 1] << 8);
        let cp = source[sp + 2] + (source[sp + 3] << 8);
        sp += 4;
        while (count-- > 0) dest[dp++] = dest[cp++];
      } else {
        let count = (opCode & 0x3f) + 3;
        let cp = source[sp] + (source[sp + 1] << 8);
        sp += 2;
        while (count-- > 0) dest[dp++] = dest[cp++];
      }
    }
  }

  return sp;
}

// === Trigger System ===

/** Check if a trigger event condition is met */
/** Game state snapshot passed to trigger event checks */
export interface TriggerGameState {
  gameTick: number;
  globals: Set<number>;
  triggerStartTick: number;
  triggerName: string;
  playerEntered: boolean;
  playerEnteredHouse?: number; // C++ parity: house index of the entering unit (tevent.cpp:290-291)
  // C++ parity (#21): differentiated trigger event state
  objectDiscovered: boolean;  // per-trigger: attached object was discovered by enemy (TEVENT_DISCOVERED)
  houseDiscovered: Map<number, boolean>; // per-house: any unit of this house has been seen by player (TEVENT_HOUSE_DISCOVERED)
  enteredZone: boolean;       // per-trigger: matching-house unit entered trigger's zone (TEVENT_ENTERS_ZONE)
  crossedHorizontal: boolean; // per-trigger: matching-house unit crossed trigger cell's Y row (TEVENT_CROSS_HORIZONTAL)
  crossedVertical: boolean;   // per-trigger: matching-house unit crossed trigger cell's X column (TEVENT_CROSS_VERTICAL)
  // Aggregate counts for event checks
  enemyUnitsAlive: number;    // non-player living units
  enemyKillCount: number;     // total enemy units killed
  playerFactories: number;    // player FACT/WEAP/TENT count
  missionTimerExpired: boolean;
  bridgesAlive: number;       // number of bridge cells remaining
  unitsLeftMap: number;        // count of units that have left the map
  // Building existence check (for BUILDING_EXISTS)
  structureTypes: Set<string>; // set of alive structure type names
  // Structure types player has built during this game (for TEVENT_BUILD)
  builtStructureTypes: Set<string>;
  // Trigger attachment: names of triggers whose attached object was destroyed
  destroyedTriggerNames: Set<string>;
  // Trigger attachment: names of triggers whose attached object was attacked (damaged)
  attackedTriggerNames: Set<string>;
  // Per-house alive status (for ALL_DESTROYED — RA house index → has alive units/structures)
  houseAlive: Map<number, boolean>;
  // Per-house: any living UNITS (entities only, not structures) — for UNITS_DESTROYED
  houseUnitsAlive: Map<number, boolean>;
  // Per-house: any living BUILDINGS (structures only, excluding walls) — for BUILDINGS_DESTROYED
  houseBuildingsAlive: Map<number, boolean>;
  isLowPower: boolean;        // player is low on power
  playerCredits: number;      // player's current credits
  // TR3: new event state fields
  buildingsDestroyedByHouse: Map<number, boolean>; // per-house: all buildings destroyed?
  nBuildingsDestroyed: number;   // total count of buildings destroyed
  playerFactoriesExist: boolean; // does the player still have factories?
  civiliansEvacuated: number;    // count of civilians evacuated
  builtUnitTypes: Set<string>;     // unit types player has built
  builtInfantryTypes: Set<string>; // infantry types player has built
  builtAircraftTypes: Set<string>; // aircraft types player has built
  fakesExist: boolean;           // do any fake structures still exist?
  spiedBuildings: Set<string>;   // trigger names of spied buildings
  isThieved: boolean;            // C++ House.IsThieved — a Thief has infiltrated a building
  pendingDestroyedCount: number; // C++ Spring() parity: count of unprocessed deaths for this trigger
}

export function checkTriggerEvent(
  event: TriggerEvent,
  state: TriggerGameState,
): boolean {
  switch (event.type) {
    case TEVENT_NONE:
      // C++ parity: TEVENT_NONE = "no event" = false. Triggers with TEVENT_NONE
      // only fire when forced via TACTION_FORCE_TRIGGER. Confirmed by C++ WASM
      // playthrough: no reinforcements at game start (units=1, not 32).
      return false;
    case TEVENT_ANY:
      return true;
    case TEVENT_TIME: {
      const requiredTicks = event.data * TIME_UNIT_TICKS;
      return (state.gameTick - state.triggerStartTick) >= requiredTicks;
    }
    case TEVENT_GLOBAL_SET:
      // C++ scenario.h:197 — GlobalFlags[30]: indices must be in [0, 29]
      if (event.data < 0 || event.data > 29) return false;
      return state.globals.has(event.data);
    case TEVENT_GLOBAL_CLEAR:
      // C++ scenario.h:197 — GlobalFlags[30]: indices must be in [0, 29]
      if (event.data < 0 || event.data > 29) return false;
      return !state.globals.has(event.data);
    case TEVENT_PLAYER_ENTERED:
      // C++ tevent.cpp:290-291 — object->Owner() must match Data.House
      if (!state.playerEntered) return false;
      if (state.playerEnteredHouse !== undefined) {
        return state.playerEnteredHouse === event.data;
      }
      return true;
    case TEVENT_ALL_DESTROYED: {
      // All units/structures of the specified house destroyed (event.data = RA house index)
      // RA source: HouseClass::As_Pointer(Event.Data.House)->Is_All_Destroyed()
      // C++ parity: don't fire during early game when the player may start with no units
      // and receive reinforcements via triggers (e.g. SCG27EA). C++ ScenarioInit flag
      // prevents triggers from firing during initialization.
      if (state.gameTick < 100) return false;
      const houseIdx = event.data;
      return !(state.houseAlive.get(houseIdx) ?? false);
    }
    case TEVENT_NUNITS_DESTROYED:
      // N enemy units have been killed (event.data = threshold)
      return state.enemyKillCount >= event.data;
    case TEVENT_DESTROYED:
      // C++ Spring() parity: fires once per death. pendingDestroyedCount tracks unprocessed deaths.
      return state.pendingDestroyedCount > 0 && state.destroyedTriggerNames.has(state.triggerName);
    case TEVENT_MISSION_TIMER_EXPIRED:
      return state.missionTimerExpired;
    case TEVENT_BUILDING_EXISTS: {
      // Check if a specific building type exists (event.data is RA StructType enum index)
      // RA StructType enum order from BTYPE.H:
      const STRUCT_TYPES: Record<number, string> = {
        0: 'ATEK', 1: 'IRON', 2: 'WEAP', 3: 'PDOX', 4: 'PBOX', 5: 'HBOX',
        6: 'DOME', 7: 'GAP',  8: 'GUN',  9: 'AGUN', 10: 'FTUR', 11: 'FACT',
        12: 'PROC', 13: 'SILO', 14: 'HPAD', 15: 'SAM', 16: 'AFLD', 17: 'POWR',
        18: 'APWR', 19: 'STEK', 20: 'HOSP', 21: 'BARR', 22: 'TENT', 23: 'KENN',
        24: 'FIX',  25: 'BIO',  26: 'MISS', 27: 'SYRD', 28: 'SPEN', 29: 'MSLO',
        30: 'FCOM', 31: 'TSLA', 32: 'QUEE', 33: 'LAR1', 34: 'LAR2',
      };
      const btype = STRUCT_TYPES[event.data];
      if (btype) return state.structureTypes.has(btype);
      return state.structureTypes.size > 0; // fallback: any building
    }
    case TEVENT_ALL_BRIDGES_DESTROYED:
      return state.bridgesAlive === 0;
    case TEVENT_DISCOVERED:
      // C++ parity (#21): fires when an object with this trigger attached is first seen by the opposing side.
      // In C++, Spring(TEVENT_DISCOVERED, this) is called from TechnoClass::Revealed() and Record_The_Kill().
      // C++ tevent.cpp:270-283 — requires event == TEVENT_DISCOVERED to pass the gate check.
      return state.objectDiscovered;
    case TEVENT_ENTERS_ZONE:
      // C++ parity (#21): fires when a unit whose owner matches Data.House enters the same movement zone
      // as the trigger's attached cell. C++ tevent.cpp:290-293 checks object->Owner() == Data.House.
      // C++ foot.cpp:1447-1455 checks zone membership via Map[trigger->Cell].Zones[MZone].
      return state.enteredZone;
    case TEVENT_ATTACKED:
      // Attached object was attacked (damaged) — per-entity tracking via triggerName
      return state.attackedTriggerNames.has(state.triggerName);
    case TEVENT_BUILD: {
      // Player has built a structure of the specified type (event.data = StructType index)
      // Uses the same STRUCT_TYPES mapping as BUILDING_EXISTS
      const BUILD_STRUCT_TYPES: Record<number, string> = {
        0: 'ATEK', 1: 'IRON', 2: 'WEAP', 3: 'PDOX', 4: 'PBOX', 5: 'HBOX',
        6: 'DOME', 7: 'GAP',  8: 'GUN',  9: 'AGUN', 10: 'FTUR', 11: 'FACT',
        12: 'PROC', 13: 'SILO', 14: 'HPAD', 15: 'SAM', 16: 'AFLD', 17: 'POWR',
        18: 'APWR', 19: 'STEK', 20: 'HOSP', 21: 'BARR', 22: 'TENT', 23: 'KENN',
        24: 'FIX',  25: 'BIO',  26: 'MISS', 27: 'SYRD', 28: 'SPEN', 29: 'MSLO',
        30: 'FCOM', 31: 'TSLA', 32: 'QUEE', 33: 'LAR1', 34: 'LAR2',
      };
      const buildType = BUILD_STRUCT_TYPES[event.data];
      if (buildType) return state.builtStructureTypes.has(buildType);
      return state.builtStructureTypes.size > 0; // fallback: any structure built
    }
    case TEVENT_LEAVES_MAP:
      // Units have left the map edge (civilian evacuation)
      return state.unitsLeftMap > 0;
    case TEVENT_HOUSE_DISCOVERED:
      // C++ parity (#21): fires when the specified house's IsDiscovered flag is set.
      // C++ tevent.cpp:435-436 — hptr = HouseClass::As_Pointer(Data.House), checks hptr->IsDiscovered.
      // IsDiscovered is set in techno.cpp:792 when any unit of that house is first seen by player.
      return state.houseDiscovered.get(event.data) ?? false;
    case TEVENT_LOW_POWER:
      // Player is low on power
      return state.isLowPower;
    case TEVENT_THIEVED:
      // C++ House.IsThieved — set when a Thief infiltrates PROC/SILO
      return state.isThieved;
    case TEVENT_CROSS_HORIZONTAL:
      // C++ parity (#21): fires when a unit whose owner matches Data.House crosses the Y row of the
      // trigger's cell. C++ foot.cpp:1419-1428 scans all cells in the row; tevent.cpp:290-293
      // checks object->Owner() == Data.House.
      return state.crossedHorizontal;
    case TEVENT_CROSS_VERTICAL:
      // C++ parity (#21): fires when a unit whose owner matches Data.House crosses the X column of
      // the trigger's cell. C++ foot.cpp:1434-1442 scans all cells in the column; tevent.cpp:290-293
      // checks object->Owner() == Data.House.
      return state.crossedVertical;
    case TEVENT_UNITS_DESTROYED:
      // All units of a house destroyed (event.data = RA house index)
      // C++ index 9: "all house's units destroyed" — checks units only, not structures
      return !(state.houseUnitsAlive.get(event.data) ?? false);
    case TEVENT_CREDITS:
      // Player has accumulated a certain amount of credits
      return state.playerCredits >= event.data;
    // TR3: New trigger events
    case TEVENT_SPIED:
      // Spy has infiltrated the attached building
      return state.spiedBuildings.has(state.triggerName);
    case TEVENT_BUILDINGS_DESTROYED: {
      // All buildings of specified house destroyed
      const bHouseIdx = event.data;
      return state.buildingsDestroyedByHouse.get(bHouseIdx) ?? false;
    }
    case TEVENT_NBUILDINGS_DESTROYED:
      // N buildings have been destroyed
      return state.nBuildingsDestroyed >= event.data;
    case TEVENT_NOFACTORIES:
      // No factories remaining for player
      return !state.playerFactoriesExist;
    case TEVENT_EVAC_CIVILIAN:
      // A civilian has been evacuated
      return state.civiliansEvacuated > 0;
    case TEVENT_BUILD_UNIT: {
      // Specified unit type has been built (event.data = C++ UnitType enum index)
      const unitName = UNIT_TYPE_NAMES[event.data];
      return unitName ? state.builtUnitTypes.has(unitName) : state.builtUnitTypes.size > 0;
    }
    case TEVENT_BUILD_INFANTRY: {
      // Specified infantry type has been built (event.data = C++ InfantryType enum index)
      const infName = INFANTRY_TYPE_NAMES[event.data];
      return infName ? state.builtInfantryTypes.has(infName) : state.builtInfantryTypes.size > 0;
    }
    case TEVENT_BUILD_AIRCRAFT: {
      // Specified aircraft type has been built (event.data = C++ AircraftType enum index)
      const airName = AIRCRAFT_TYPE_NAMES[event.data];
      return airName ? state.builtAircraftTypes.has(airName) : state.builtAircraftTypes.size > 0;
    }
    case TEVENT_FAKES_DESTROYED:
      // All fake structures have been destroyed
      return !state.fakesExist;
    default:
      return false;
  }
}

/** Result from executing a trigger action */
export interface TriggerActionResult {
  spawned: Entity[];
  win?: boolean;
  lose?: boolean;
  allowWin?: boolean;
  allHunt?: number;             // C++ parity: house index from action Data.House (not boolean)
  revealAll?: boolean;
  revealWaypoint?: number;  // reveal area around a specific waypoint (REVEAL_SOME)
  dropZone?: number;        // drop zone flare at waypoint (DZ)
  creepShadow?: boolean;    // reshroud entire map (CREEP_SHADOW)
  textMessage?: number;  // text trigger ID to display
  setTimer?: number;     // mission timer value to set (in 1/10th minute units)
  timerExtend?: number;  // extend mission timer by this many 1/10th minute units
  autocreate?: number;   // C++ parity: house index from action Data.House (AUTOCREATE)
  destroyTriggeringUnit?: boolean; // kill the unit that triggered this
  playSound?: number;    // play a sound effect (PLAY_SOUND)
  playSpeech?: number;   // play EVA speech (PLAY_SPEECH)
  airstrike?: boolean;   // call in an airstrike (legacy)
  launchNukes?: boolean; // C++ parity: iterate all MSLO buildings, assign MISSION_MISSILE (TACTION_LAUNCH_NUKES)
  centerView?: number;   // center camera on waypoint (legacy)
  // TR4: new action results
  fireSale?: number;              // C++ parity: house index from action Data.House (FIRE_SALE)
  playMovie?: number;             // play a movie/cutscene (PLAY_MOVIE)
  revealZone?: number;            // reveal all of specified zone (REVEAL_ZONE)
  playMusic?: number;             // play music track (PLAY_MUSIC)
  preferredTarget?: number;       // set preferred target type for AI (PREFERRED_TARGET)
  beginProduction?: number;       // house index — sets IsStarted only, NOT productionEnabled (BEGIN_PRODUCTION)
  destroyTeam?: number;           // team index to mark as destroyed (DESTROY_TEAM)
  startTimer?: boolean;           // start the mission timer (START_TIMER)
  stopTimer?: boolean;            // stop the mission timer (STOP_TIMER)
  timerSubtract?: number;         // subtract time from mission timer (SUB_TIMER)
  oneSpecial?: boolean;           // charge one superweapon (1_SPECIAL)
  fullSpecial?: boolean;          // charge all superweapons (FULL_SPECIAL)
  globalChanged?: number;         // C++ parity (#38): global index that was set/cleared (triggers immediate spring)
  baseBuilding?: { house: number; enabled: boolean }; // C++ parity (#39): set IsBaseBuilding on/off for a house
  blockageDecrement?: boolean;    // C++ parity: trigger.cpp:175-178 — decrement Blockage counter (ALLOWWIN)
}

/** Execute a trigger action — returns result with entities and side effects.
 *  @param playerHouseId  C++ PlayerPtr->Class->House ID — used by TACTION_WIN/LOSE to check Data.House
 *                        (taction.cpp:604-610,616-622). Optional for backward compat; defaults to -1 (no check). */
export function executeTriggerAction(
  action: TriggerAction,
  teamTypes: TeamType[],
  waypoints: Map<number, CellPos>,
  globals: Set<number>,
  triggers: ScenarioTrigger[],
  triggerHouse?: number,
  houseEdges?: Map<House, string>,
  mapBounds?: { x: number; y: number; w: number; h: number },
  playerHouseId?: number,
): TriggerActionResult {
  const result: TriggerActionResult = { spawned: [] };

  switch (action.action) {
    case TACTION_NONE:
      break;

    case TACTION_REINFORCEMENTS:
    case TACTION_CREATE_TEAM: {
      const team = teamTypes[action.team];
      if (!team) break;

      const teamHouse = houseIdToHouse(team.house);
      const wp = resolveTeamOriginCell(team.origin, teamHouse, waypoints, houseEdges, mapBounds);
      if (!wp) break;
      const world = cellToWorld(wp.cx, wp.cy);

      const house = teamHouse;
      const teamMissionScript = team.missions.length > 0 ? team.missions.map(m => ({
        mission: m.mission,
        data: m.data,
      })) : null;
      let transport: Entity | null = null;
      const cargo: Entity[] = [];
      // C++ reinf.cpp:439: Determine spawn edge for deterministic facing
      const spawnEdge = getSpawnEdge(teamHouse, houseEdges, mapBounds, wp);
      const spawnFacing = edgeToFacing(spawnEdge);
      // C++ reinf.cpp:251: Check if team has TMISSION_UNLOAD for IsALoaner flag
      const hasUnloadMission = team.missions.some(m => m.mission === 8); // TMISSION_UNLOAD = 8
      // C++ parity (reinf.cpp:441): ground reinforcements spawn at the map edge
      // and walk in. The team's origin waypoint determines which edge to use.
      // Only aircraft spawn at the edge cell AND fly — ground units get MISSION_GUARD
      // and the team mission script moves them to the waypoint.
      const groundEdgeCell = (!team.members.every(m => {
        const ut = toUnitType(m.type);
        return ut && UNIT_STATS[ut]?.isAircraft;
      }) && houseEdges && mapBounds)
        ? calculateHouseEdgeSpawnCell(teamHouse, houseEdges, mapBounds, wp)
        : null;

      for (const member of team.members) {
        for (let i = 0; i < member.count; i++) {
          const unitType = toUnitType(member.type);
          if (!unitType) continue;

          // C++ reinf.cpp:471 — spawn at the map-edge entry cell, not the waypoint.
          // Ground units appear at the edge; their team TMISSION_MOVE walks them in.
          // Aircraft spawn at the edge but fly to the origin (handled below).
          let spawnX = world.x;
          let spawnY = world.y;
          const stats = UNIT_STATS[unitType] ?? UNIT_STATS.E1;

          // C++ reinf.cpp:441,471 — ALL team members (aircraft + ground) spawn at the
          // SAME Calculated_Cell. The cell is computed once and reused for every object.
          // Aircraft do NOT get a separate spawn location.
          if (groundEdgeCell) {
            // Ground units: spawn at edge cell (C++ reinf.cpp:471 Unlimbo at Calculated_Cell)
            const edgeWorld = cellToWorld(groundEdgeCell.cx, groundEdgeCell.cy);
            spawnX = edgeWorld.x;
            spawnY = edgeWorld.y;
          }

          const entity = new Entity(unitType, house, spawnX, spawnY);
          // C++ reinf.cpp:465-468: ground units face outward (source<<1),
          // aircraft get Random_Pick(DIR_N, DIR_MAX) — random facing.
          if (stats.isAircraft) {
            // C++ reinf.cpp:466-468: desiredfacing = (DirType)Random_Pick(DIR_N, DIR_MAX)
            const randomFacing = ScenarioRandom.nextInRange(0, 7) as Dir;
            entity.facing = randomFacing;
            entity.desiredFacing = randomFacing;
          } else {
            entity.facing = spawnFacing as Dir;
            entity.desiredFacing = spawnFacing as Dir;
          }
          entity.bodyFacing32 = entity.facing * 4;
          // Assign team mission script to each member
          if (teamMissionScript) {
            entity.teamMissions = teamMissionScript;
            entity.teamMissionIndex = 0;
          }
          // IsSuicide teams (flags bit 1): don't retreat, fight to the death.
          // In C++, IsSuicide does NOT override the team mission script — units still
          // follow TMISSION_MOVE/ATTACK. The flag only prevents automatic retreat.
          // Team missions take priority in the AI update loop (updateTeamMission).
          if (team.flags & 2) {
            entity.isSuicide = true;
          }
          // C++ parity: assign team's trigger to each spawned member (ScenarioClass::Create_Army)
          // This enables DESTROYED event chains — when these units die, the trigger fires.
          if (team.trigger >= 0 && team.trigger < triggers.length) {
            entity.triggerName = triggers[team.trigger].name;
            noteTriggerAttachment(triggers, entity.triggerName);
          }
          // VIP spawn protection — civilians/VIPs spawned in hostile zones get brief invulnerability
          // so they can start moving before being killed (C++ building-exit protection equivalent).
          if (CIVILIAN_UNIT_TYPES.has(member.type)) {
            entity.invulnTick = 120;
          }
          // Aircraft-specific: start airborne, fly toward origin waypoint
          if (stats.isAircraft) {
            entity.aircraftState = 'flying';
            entity.flightAltitude = Entity.FLIGHT_ALTITUDE;
            entity.animState = AnimState.WALK;
            entity.mission = Mission.MOVE;
            entity.moveTarget = { x: world.x, y: world.y };
          } else {
            // C++ reinf.cpp:480 — ground units get MISSION_GUARD on spawn.
            // Team script (updateTeamMission) will assign TMISSION_MOVE on the next tick.
            entity.mission = Mission.GUARD;
          }
          // C++ reinf.cpp:251: IsALoaner on aircraft/vessel transports with UNLOAD mission
          // Transport doesn't count toward unit limits, auto-retreats after unloading
          if (entity.isTransport && hasUnloadMission &&
              (stats.isAircraft || stats.isVessel)) {
            entity.isALoaner = true;
          }
          // Track transports and cargo for auto-loading (C++ reinf.cpp:217-254)
          // LSTs carry ALL unit types (infantry, tanks, MCVs), not just infantry.
          if (entity.isTransport && !transport) {
            transport = entity;
          } else if (!stats.isAircraft && !entity.isTransport) {
            // Additional transports beyond the first are NOT cargo — C++ reinf.cpp
            // only loads non-transport ground units as passengers.
            cargo.push(entity);
          }
          result.spawned.push(entity);
        }
      }
      // Auto-load cargo into transport when team has both (C++ reinf.cpp:217-254)
      // In C++, ALL non-transport team members are loaded — infantry, tanks, MCVs, etc.
      if (transport && cargo.length > 0) {
        const maxLoad = transport.maxPassengers;
        for (let i = 0; i < Math.min(cargo.length, maxLoad); i++) {
          const unit = cargo[i];
          transport.passengers.push(unit);
          unit.transportRef = transport;
          // Remove loaded unit from spawned list — it lives in transport.passengers
          // and will be re-added to the entity list when unloaded (TMISSION_UNLOAD)
          const idx = result.spawned.indexOf(unit);
          if (idx >= 0) result.spawned.splice(idx, 1);
        }
      }
      break;
    }

    case TACTION_SET_GLOBAL:
      // C++ scenario.cpp:265 — bounds check: (unsigned)global < ARRAY_SIZE(Scen.GlobalFlags)
      // C++ scenario.cpp:268 — only cascade when previous != value
      if (action.data >= 0 && action.data <= 29 && !globals.has(action.data)) {
        globals.add(action.data);
        result.globalChanged = action.data; // C++ parity (#38): immediate spring
      }
      break;

    case TACTION_CLEAR_GLOBAL:
      // C++ scenario.cpp:265 — bounds check: (unsigned)global < ARRAY_SIZE(Scen.GlobalFlags)
      // C++ scenario.cpp:268 — only cascade when previous != value
      if (action.data >= 0 && action.data <= 29 && globals.has(action.data)) {
        globals.delete(action.data);
        result.globalChanged = action.data; // C++ parity (#38): immediate spring
      }
      break;

    case TACTION_START_TIMER:
      result.startTimer = true;
      break;

    case TACTION_STOP_TIMER:
      result.stopTimer = true;
      break;

    case TACTION_SUB_TIMER:
      // Subtract time from mission timer (action.data in 1/10th minute units)
      result.timerSubtract = action.data;
      break;

    case TACTION_FORCE_TRIGGER: {
      // Force another trigger to fire on the next check regardless of event conditions
      if (action.trigger >= 0 && action.trigger < triggers.length) {
        const target = triggers[action.trigger];
        target.fired = false;
        target.forceFirePending = true;
      }
      break;
    }

    case TACTION_DESTROY_TRIGGER: {
      // Permanently disable a trigger
      if (action.trigger >= 0 && action.trigger < triggers.length) {
        const target = triggers[action.trigger];
        target.fired = true;
        target.persistence = 0; // make it volatile so it can't re-fire
      }
      break;
    }

    case TACTION_WIN:
      // C++ taction.cpp:604-610: if (Data.House == PlayerPtr->Class->House) Flag_To_Win else Flag_To_Lose
      // If the action's house matches the player, player wins. If enemy house, player LOSES.
      if (playerHouseId !== undefined && playerHouseId >= 0 && action.data >= 0) {
        if (action.data === playerHouseId) {
          result.win = true;
        } else {
          result.lose = true;
        }
      } else {
        result.win = true; // fallback when no player house context available
      }
      break;

    case TACTION_LOSE:
      // C++ taction.cpp:616-622: if (Data.House != PlayerPtr->Class->House) Flag_To_Win else Flag_To_Lose
      // If the action's house is the enemy, player WINS. If player house, player loses.
      if (playerHouseId !== undefined && playerHouseId >= 0 && action.data >= 0) {
        if (action.data !== playerHouseId) {
          result.win = true;
        } else {
          result.lose = true;
        }
      } else {
        result.lose = true; // fallback when no player house context available
      }
      break;

    case TACTION_ALLOWWIN:
      result.allowWin = true;
      // C++ trigger.cpp:175-178 — Blockage-- on trigger destruction.
      // Signal the caller to decrement their Blockage counter.
      result.blockageDecrement = true;
      break;

    case TACTION_WINLOSE:
      // C++ RA taction.cpp: TACTION_WINLOSE (ordinal 14) falls through to default — noop.
      // The enum exists in taction.h:60 ("Win if captured, lose if destroyed") but
      // RA's action handler has no case for it. Only functional in Tiberian Dawn.
      // C++ parity: do nothing (previously set result.winLose=true per TD behavior).
      break;

    case TACTION_DESTROY_TEAM:
      // Mark a team as destroyed — prevents future CREATE_TEAM/REINFORCEMENTS for this team
      result.destroyTeam = action.team;
      break;

    case TACTION_ALL_HUNT:
      // C++ parity: HouseClass::As_Pointer(Data.House)->Do_All_To_Hunt()
      // Targets a SPECIFIC house from action data, not all enemies.
      // Data.House is the low byte of Data.Value (union int → int8_t).
      result.allHunt = action.data & 0xFF;
      break;

    case TACTION_TEXT_TRIGGER:
      result.textMessage = action.data;
      break;

    case TACTION_SET_TIMER:
      result.setTimer = action.data;
      break;

    case TACTION_DZ:
      // Drop zone flare at waypoint — reveal area + visual marker
      result.dropZone = action.data;
      break;

    case TACTION_REVEAL_SOME:
      // Reveal area around a waypoint (action.data = waypoint index)
      result.revealWaypoint = action.data;
      break;

    case TACTION_PLAY_SOUND:
      result.playSound = action.data;
      break;

    case TACTION_PLAY_SPEECH:
      result.playSpeech = action.data;
      break;

    case TACTION_DESTROY_OBJECT:
      // Destroy the object/unit that triggered this event (e.g. hazard zones)
      result.destroyTriggeringUnit = true;
      break;

    case TACTION_BEGIN_PRODUCTION:
      // C++ house.h:716: Begin_Production(void) { IsStarted = true; }
      // Only sets IsStarted — does NOT enable general production (IsBaseBuilding).
      // Uses action's Data.House, NOT the trigger's owner house.
      // C++ taction.h:109-119: Data is union { int Value; int8_t House; }.
      // INI stores Data.Value (int); Data.House reads the low byte as int8_t.
      // e.g., -254 → 0xFFFFFF02 → low byte 2 → HOUSE_USSR.
      result.beginProduction = action.data & 0xFF;
      break;

    case TACTION_AUTOCREATE:
      // C++ parity: HouseClass::As_Pointer(Data.House)->IsAlerted = true
      // Uses action's Data.House, NOT the trigger's owner house.
      // Data.House is the low byte of Data.Value (union int → int8_t).
      result.autocreate = action.data & 0xFF;
      break;

    case TACTION_TIMER_EXTEND:
      // Extend mission timer by action.data (in 1/10th minute units)
      result.timerExtend = action.data;
      break;

    case TACTION_CREEP_SHADOW:
      // Reshroud entire map (used in SCA04EA tunnel darkness)
      result.creepShadow = true;
      break;

    case TACTION_REVEAL_MAP:
      // Reveal entire map (same as revealAll)
      result.revealAll = true;
      break;

    // TR4: New trigger actions (stub implementations)
    case TACTION_FIRE_SALE:
      // C++ parity: HouseClass::As_Pointer(Data.House)->State = STATE_ENDGAME
      // Uses action's Data.House, NOT the trigger's owner house.
      // Data.House is the low byte of Data.Value (union int → int8_t).
      result.fireSale = action.data & 0xFF;
      break;

    case TACTION_PLAY_MOVIE:
      // Play movie/cutscene (action.data = movie ID)
      result.playMovie = action.data;
      break;

    case TACTION_REVEAL_ZONE:
      // Reveal all of specified zone (action.data = zone waypoint)
      result.revealZone = action.data;
      break;

    case TACTION_PLAY_MUSIC:
      // Play musical score (action.data = theme ID)
      result.playMusic = action.data;
      break;

    case TACTION_PREFERRED_TARGET:
      // Designate preferred target type for AI house (action.data = quarry type)
      result.preferredTarget = action.data;
      break;

    case TACTION_BASE_BUILDING:
      // C++ taction.cpp: hptr->IsBaseBuilding = Data.Bool
      // Enables or disables AI base building for the trigger's house.
      // Data.Bool is stored as action.data (0=false, nonzero=true). NEED_BOOL parameter.
      result.baseBuilding = { house: triggerHouse ?? 0, enabled: !!action.data };
      break;

    case TACTION_1_SPECIAL:
      // Charge one superweapon of the trigger's house
      result.oneSpecial = true;
      break;

    case TACTION_FULL_SPECIAL:
      // Charge all superweapons of the trigger's house
      result.fullSpecial = true;
      break;

    case TACTION_LAUNCH_NUKES:
      // C++ taction.cpp: iterates Buildings[], finds STRUCT_MSLO, assigns MISSION_MISSILE to each
      result.launchNukes = true;
      break;
  }

  return result;
}
