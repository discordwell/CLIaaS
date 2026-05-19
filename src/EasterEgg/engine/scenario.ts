/**
 * Scenario loader — parses extracted INI files and sets up the game state.
 * Reads unit placements, waypoints, team types, and triggers from SCA01-04EA.INI.
 */

import {
  type CellPos, type UnitStats, type WeaponStats, type ArmorType,
  CELL_SIZE, MAP_CELLS, cellIndexToPos, cellToWorld, worldToCell, cellToLepton, leptonDist,
  House, Mission, UnitType, AnimState, Dir, DIR_DX, DIR_DY,
  UNIT_STATS,
  SUBCELL_LEPTON_OFFSETS,
} from './types';
import { buildScenarioRuleOverrides } from './scenarioRules';
import { Entity, dir256ToFacing8, dir256ToFacing32 } from './entity';
import { GameMap, Terrain, TREE_OCCUPY, TREE_MAX_HP, TERRAIN_OBJECT_OCCUPY, type MapTree } from './map';
import { type TilesetMeta, type AssetManager } from './assets';
import { nearbyLocation } from './pathfinding';
import { ScenarioRandom } from './random';

// === RA Trigger/Team System (from TRIGGER.CPP, TEAMTYPE.CPP) ===

// Trigger event types (TEventType — from TEVENT.H:46-83, C++ enum order)
export const TEVENT_NONE = 0;
export const TEVENT_PLAYER_ENTERED = 1;
export const TEVENT_SPIED = 2;            // TR3/TR5: spy infiltrated building (C++ TEVENT_SPIED)
const TEVENT_THIEVED = 3;                 // TR5: fixed index (was 17, C++ = 3)
export const TEVENT_DISCOVERED = 4;
const TEVENT_HOUSE_DISCOVERED = 5;        // TR5: fixed index (was 3, C++ = 5)
export const TEVENT_ATTACKED = 6;
export const TEVENT_DESTROYED = 7;
export const TEVENT_ANY = 8;
export const TEVENT_UNITS_DESTROYED = 9;  // TR5: fixed index (was 26, C++ = 9) — all house's units destroyed
const TEVENT_BUILDINGS_DESTROYED = 10;    // TR3: all house's buildings destroyed (C++ = 10)
export const TEVENT_ALL_DESTROYED = 11;
const TEVENT_CREDITS = 12;               // TR5: fixed index (was 30, C++ = 12)
export const TEVENT_TIME = 13;
export const TEVENT_MISSION_TIMER_EXPIRED = 14;
const TEVENT_NBUILDINGS_DESTROYED = 15;   // TR3/TR5: N buildings destroyed (C++ = 15)
const TEVENT_NUNITS_DESTROYED = 16;
const TEVENT_NOFACTORIES = 17;            // TR3/TR5: no factories remaining (C++ = 17)
const TEVENT_EVAC_CIVILIAN = 18;          // TR3: civilian evacuated
const TEVENT_BUILD = 19;
const TEVENT_BUILD_UNIT = 20;             // TR3: specified unit built (C++ TEVENT_BUILD_UNIT)
const TEVENT_BUILD_INFANTRY = 21;         // TR3/TR5: infantry built (C++ = 21)
const TEVENT_BUILD_AIRCRAFT = 22;         // TR3/TR5: aircraft built (C++ = 22)
export const TEVENT_LEAVES_MAP = 23;
export const TEVENT_ENTERS_ZONE = 24;
export const TEVENT_CROSS_HORIZONTAL = 25; // TR5: fixed index (was 21, C++ = 25)
export const TEVENT_CROSS_VERTICAL = 26;   // TR5: fixed index (was 22, C++ = 26)
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
  /** C++ TeamTypeClass::Fill_In old-format bitfield:
   *  0x0001=IsRoundAbout, 0x0002=IsSuicide, 0x0004=IsAutocreate,
   *  0x0008=IsPrebuilt, 0x0010=IsReinforcable. */
  flags: number;
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
  cell?: number; // C++ TriggerClass::Cell — last [CellTriggers] cell attached to this trigger
  springCell?: number; // transient Spring(cell) argument used by TACTION_DESTROY_OBJECT bridge destruction
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

export type CampaignId = 'allied' | 'soviet' | 'counterstrike_allied' | 'counterstrike_soviet' | 'aftermath_allied' | 'aftermath_soviet';

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
  { id: 'aftermath_allied', title: 'Aftermath (Allied)', faction: 'allied', missions: [], progressKey: 'campaign_am_allied_progress' },
  { id: 'aftermath_soviet', title: 'Aftermath (Soviet)', faction: 'soviet', missions: [], progressKey: 'campaign_am_soviet_progress' },
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
    /** C++ INI 7th field: 1 = player-sellable. Stored on building as IsAllowedToSell. */
    sellable?: boolean;
    /** C++ INI 8th field: 1 = AI auto-rebuilds this building when destroyed.
     *  Combined with STRUCT_CONST to set IsToRepair (building.cpp:5140). */
    rebuild?: boolean;
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
  /** Per-house PlayerControl= flag from scenario INI. */
  housePlayerControl: Map<string, boolean>;
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
  /** C++ RulesClass::IsAllyReveal, overridden by scenario [General] AllyReveal=. */
  allyReveal: boolean;
  /** C++ Scen.IsTanyaEvac — scenario.cpp:2262: CivEvac=yes in [Basic]. When true,
   *  Tanya (E7) counts as civilian for evacuation (aircraft.cpp:143). */
  isTanyaEvac: boolean;
}

/** Resolve mission name — RA scenarios often use Name=<none> in the INI.
 *  The actual mission names come from the game's string table. */
const MISSION_NAMES: Record<string, string> = {
  SCG01EA: 'In the Thick of It', SCG02EA: 'Evacuation', SCG03EA: 'Spy Hunter',
  SCG04EA: 'Behind the Lines', SCG05EA: 'South Guard', SCG06EA: 'Mousetrap',
  SCG07EA: 'Sunken Treasure', SCG08EA: 'Paradox Equation',
  SCG09EA: 'No Remorse', SCG10EA: 'Wasteland',
  SCG11EA: 'Takedown', SCG12EA: 'Takedown', SCG13EA: 'Negotiations',
  SCG14EA: 'Monster Tank Madness',
  SCA01EA: 'Ant Mission 1', SCA02EA: 'Ant Mission 2',
  SCA03EA: 'Ant Mission 3', SCA04EA: 'Ant Mission 4',
};

const CXX_HOUSE_COUNT = 20;
const CXX_TICKS_PER_MINUTE = 900;

function parseIniBool(raw: string, fallback: boolean): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'no' || normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function consumeCxxHouseInitRNG(): void {
  for (let i = 0; i < CXX_HOUSE_COUNT; i++) {
    // C++ HouseClass constructor:
    // Attack = Rule.AttackDelay * Random_Pick(TICKS_PER_MINUTE/2, TICKS_PER_MINUTE*2)
    ScenarioRandom.nextInRange(CXX_TICKS_PER_MINUTE / 2, CXX_TICKS_PER_MINUTE * 2);
  }
}

function resolveMissionName(iniName: string, scenarioId: string): string {
  if (iniName && iniName.toLowerCase() !== '<none>' && iniName.toLowerCase() !== 'none') {
    return iniName;
  }
  return MISSION_NAMES[scenarioId.toUpperCase()] ?? 'Unknown Mission';
}

/** Parse an INI-format scenario file */
export function parseScenarioINI(text: string, scenarioId = ''): ScenarioData {
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
          // C++ scenario parse (building.cpp:5115-5125): 7th = sellable, 8th = rebuild.
          // IsToRepair = rebuild || *b == STRUCT_CONST (building.cpp:5140).
          sellable: parts.length > 6 ? parseInt(parts[6]) !== 0 : false,
          rebuild: parts.length > 7 ? parseInt(parts[7]) !== 0 : false,
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
        const trigger = triggers.find(t => t.name === value);
        if (trigger) trigger.cell = cellIdx;
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

  // Parse per-house PlayerControl=, Credits=, Edge=, IQ=, TechLevel=, MaxUnit=, MaxInfantry=, MaxBuilding= fields
  const housePlayerControl = new Map<string, boolean>();
  const houseCreditsMap = new Map<string, number>();
  const houseEdges = new Map<string, string>();
  const houseIQ = new Map<string, number>();
  const houseTechLevels = new Map<string, number>();
  const houseMaxUnit = new Map<string, number>();
  const houseMaxInfantry = new Map<string, number>();
  const houseMaxBuilding = new Map<string, number>();
  for (const houseName of houseNames) {
    const playerControlRaw = get(houseName, 'PlayerControl', '');
    if (playerControlRaw) {
      housePlayerControl.set(houseName, parseIniBool(playerControlRaw, false));
    }
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
    name: resolveMissionName(get('Basic', 'Name', ''), scenarioId),
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
    housePlayerControl,
    houseCredits: houseCreditsMap,
    houseEdges,
    houseIQ,
    houseTechLevels,
    houseMaxUnit,
    houseMaxInfantry,
    houseMaxBuilding,
    allyReveal: parseIniBool(get('General', 'AllyReveal', 'yes'), true),
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

function reinforcementNormalZoneCells(
  map: GameMap,
  start: CellPos,
  mapBounds: { x: number; y: number; w: number; h: number },
  structures?: readonly MapStructure[],
): Uint8Array {
  const structureCells = new Set<number>();
  for (const s of structures ?? []) {
    if (!s.alive) continue;
    for (const cell of getStructureOccupyCells(s.type, s.cx, s.cy)) {
      structureCells.add(cell.cy * MAP_CELLS + cell.cx);
    }
  }

  const inMapBounds = (cx: number, cy: number): boolean =>
    cx >= mapBounds.x && cx < mapBounds.x + mapBounds.w &&
    cy >= mapBounds.y && cy < mapBounds.y + mapBounds.h;
  const zonePassable = (cx: number, cy: number): boolean => {
    if (!inMapBounds(cx, cy)) return false;
    // C++ Zone_Span calls Is_Clear_To_Move(SPEED_TRACK, true, true), so
    // vehicle/building occupation is ignored for zone construction. TS encodes
    // building Occupy_List cells as wall terrain; let zones pass through those
    // cells while Good_Reinforcement_Cell's real movement check still rejects
    // them as spawn slots below.
    if (structureCells.has(cy * MAP_CELLS + cx)) return true;
    return map.isTerrainPassable(cx, cy);
  };

  const seen = new Uint8Array(MAP_CELLS * MAP_CELLS);
  if (!zonePassable(start.cx, start.cy)) return seen;

  const qx: number[] = [start.cx];
  const qy: number[] = [start.cy];
  seen[start.cy * MAP_CELLS + start.cx] = 1;

  for (let head = 0; head < qx.length; head++) {
    const cx = qx[head];
    const cy = qy[head];
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= MAP_CELLS || ny < 0 || ny >= MAP_CELLS) continue;
      const idx = ny * MAP_CELLS + nx;
      if (seen[idx]) continue;
      if (!zonePassable(nx, ny)) continue;
      seen[idx] = 1;
      qx.push(nx);
      qy.push(ny);
    }
  }

  return seen;
}

export function calculateHouseEdgeSpawnCell(
  house: House,
  houseEdges: Map<House, string> | undefined,
  mapBounds: { x: number; y: number; w: number; h: number } | undefined,
  alignedCell?: CellPos,
  random?: () => number,
  /** Optional: when provided with naval=true, checks terrain for water cells.
   *  C++ display.cpp:2505-2527: Calculated_Cell with SPEED_FLOAT only returns WATER cells. */
  map?: GameMap,
  naval = false,
  /** C++ Good_Reinforcement_Cell rejects occupied outcell or incell. */
  isOccupied?: (cx: number, cy: number) => boolean,
  structures?: readonly MapStructure[],
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
  // C++ Calculated_Cell: Random_Pick only called when trycell == -1 (no waypoint).
  // When alignedCell is provided, the spawn position is deterministic — don't consume RNG.
  const randomOffset = (length: number): number => {
    if (length <= 1) return 0;
    if (random) return Math.floor(random() * length);
    return ScenarioRandom.nextInRange(0, length - 1);
  };
  const alignedX = alignedCell
    ? Math.min(Math.max(alignedCell.cx, x), x + w - 1)
    : x + ((edge === 'north' || edge === 'south') ? randomOffset(w) : 0);
  const alignedY = alignedCell
    ? Math.min(Math.max(alignedCell.cy, y), y + h - 1)
    : y + ((edge === 'east' || edge === 'west') ? randomOffset(h) : 0);

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

  // C++ display.cpp:2505-2527 scans the chosen edge for the first
  // Good_Reinforcement_Cell, not just naval water cells. Ground teams need this
  // too: SCU10EA's Turkey convoy starts at east-edge y=58 because y=60's inside
  // cell is occupied when the trigger fires.
  if (map && candidate) {
    const isHorizontalEdge = edge === 'north' || edge === 'south';
    const insideCell = (outCx: number, outCy: number): CellPos => ({
      cx: isHorizontalEdge ? outCx : (edge === 'west' ? outCx + 1 : outCx - 1),
      cy: isHorizontalEdge ? (edge === 'north' ? outCy + 1 : outCy - 1) : outCy,
    });
    const inBounds128 = (cx: number, cy: number): boolean =>
      cx >= 0 && cx < MAP_CELLS && cy >= 0 && cy < MAP_CELLS;
    const passable = (outCx: number, outCy: number, inCx: number, inCy: number): boolean => {
      if (!inBounds128(outCx, outCy) || !inBounds128(inCx, inCy)) return false;
      if (naval) {
        return map.isWaterPassableRelaxed(outCx, outCy) && map.isWaterPassable(inCx, inCy);
      }
      return map.isTerrainPassable(outCx, outCy) && map.isTerrainPassable(inCx, inCy);
    };
    // C++ display.cpp:2429-2434 records Map[trycell].Zones[MZONE_NORMAL],
    // then Good_Reinforcement_Cell requires incell to match that zone. This is
    // what makes SCU10EA skip the disconnected clear east-edge pocket at y=74.
    const normalZone = (!naval && alignedCell)
      ? reinforcementNormalZoneCells(map, alignedCell, mapBounds, structures)
      : null;
    const goodCell = (outCx: number, outCy: number): boolean => {
      const incell = insideCell(outCx, outCy);
      if (!passable(outCx, outCy, incell.cx, incell.cy)) return false;
      if (normalZone && !normalZone[incell.cy * MAP_CELLS + incell.cx]) return false;
      // Off-radar ground vehicles are not always marked into the outcell in C++,
      // but an occupied inside cell must reject the edge candidate.
      if (isOccupied?.(incell.cx, incell.cy)) return false;
      if (naval && isOccupied?.(outCx, outCy)) return false;
      return true;
    };

    if (!goodCell(candidate.cx, candidate.cy)) {
      // Scan along the edge in C++ order, starting at the aligned waypoint
      // coordinate and wrapping forward. Do not choose nearest-by-distance:
      // display.cpp:2507-2520 uses `((y + index) % MapCellHeight)` /
      // `((x + index) % MapCellWidth)`.
      const edgeCoord = isHorizontalEdge ? candidate.cy : candidate.cx;
      const scanStart = isHorizontalEdge ? x : y;
      const scanLen = isHorizontalEdge ? w : h;
      const alignCoord = isHorizontalEdge ? candidate.cx : candidate.cy;
      const alignOffset = ((alignCoord - scanStart) % scanLen + scanLen) % scanLen;

      for (let i = 0; i < scanLen; i++) {
        const sc = scanStart + ((alignOffset + i) % scanLen);
        const outCx = isHorizontalEdge ? sc : edgeCoord;
        const outCy = isHorizontalEdge ? edgeCoord : sc;
        if (goodCell(outCx, outCy)) return { cx: outCx, cy: outCy };
      }
      // No legal cell found — fall back to the calculated punt cell.
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
  random?: () => number,
): CellPos | null {
  return waypoints.get(origin) ?? calculateHouseEdgeSpawnCell(house, houseEdges, mapBounds, undefined, random);
}

/** Check if a team is an ant team (contains ant units) */
function isAntTeam(team: TeamType): boolean {
  return team.members.some(m => m.type.startsWith('ANT'));
}

function cellInsideMapBounds(cell: CellPos, mapBounds?: { x: number; y: number; w: number; h: number }): boolean {
  if (!mapBounds) return false;
  return cell.cx >= mapBounds.x && cell.cx < mapBounds.x + mapBounds.w &&
    cell.cy >= mapBounds.y && cell.cy < mapBounds.y + mapBounds.h;
}

function isGroundReinforcementCellBlocked(
  cell: CellPos,
  existingEntities: Entity[] | undefined,
): boolean {
  const blocks = (entity: Entity): boolean =>
    entity.alive &&
    !entity.inLimbo &&
    !entity.isAirUnit &&
    !entity.stats.isInfantry &&
    !entity.stats.isVessel &&
    entity.cell.cx === cell.cx &&
    entity.cell.cy === cell.cy;
  return !!existingEntities?.some(blocks);
}

function findGroundReinforcementUnlimboCell(
  startCell: CellPos,
  existingEntities: Entity[] | undefined,
  mapBounds?: { x: number; y: number; w: number; h: number },
): CellPos | null {
  let cell = startCell;

  while (isGroundReinforcementCellBlocked(cell, existingEntities)) {
    let foundAdjacent = false;
    for (let facing = 0; facing < DIR_DX.length; facing++) {
      const trycell = {
        cx: cell.cx + DIR_DX[facing],
        cy: cell.cy + DIR_DY[facing],
      };
      if (cellInsideMapBounds(trycell, mapBounds)) continue;
      if (isGroundReinforcementCellBlocked(trycell, existingEntities)) continue;
      cell = trycell;
      foundAdjacent = true;
      break;
    }
    if (!foundAdjacent) return null;
  }

  return cell;
}

/** A placed structure on the map (static building, not a unit) */
export interface StructureWeapon {
  weaponName?: string; // C++ rules.ini weapon section name
  secondaryWeaponName?: string; // C++ rules.ini Secondary= weapon section name
  damage: number;
  range: number;     // range in cells
  rof: number;       // ticks between shots
  splash?: number;   // AOE radius in cells
  warhead?: string;  // warhead type for damage multiplier (default 'HE')
  projSpeed?: number; // projectile visual speed in cells/second (C++ BulletClass Speed)
  isInvisible?: boolean; // Projectile=Invisible/Ack Inviso=yes
  isAntiAir?: boolean; // can target airborne aircraft
}

export interface MapStructure {
  type: string;       // building type code (WEAP, POWR, TENT, etc.)
  image: string;      // sprite sheet name (lowercase)
  house: House;
  cx: number;         // cell position
  cy: number;
  /** C++ Logic vector index for runtime-created buildings.
   *  Scenario INI buildings are kept in structures[] order and leave this unset. */
  logicIndexHint?: number;
  hp: number;         // current HP (0-256 scale)
  maxHp: number;      // max HP (256 = full)
  armor?: ArmorType;   // C++ bdata.cpp Armor= from rules.ini (wood/light/heavy per building)
  /** C++ BuildingTypeClass::Power after scenario INI overrides.
   *  Positive values produce power; negative values become Class->Drain. */
  power?: number;
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
  turretDir?: number;        // displayed 8-way facing for turreted structures (GUN/SAM/AGUN)
  desiredTurretDir?: number; // displayed target turret facing in 8-dir
  turretFacing256?: number;  // C++ PrimaryFacing.Current() DirType (0=N, 64=E)
  desiredTurretFacing256?: number; // C++ PrimaryFacing.Desired() DirType
  turretRotAccum?: number;   // legacy/debug: remaining 256-step facing delta
  firingFlash?: number;      // ticks remaining for muzzle flash frame
  flashCount?: number;        // C++ flasher.cpp:83 — Blushing damage-flash countdown (ticks). Odd values = white tint visible.
  ironCurtainTicks?: number; // ticks remaining for Iron Curtain invulnerability (C++ house.cpp:2751)
  spiedBy?: number;           // C++ infantry.cpp:656 — bitmask of houses that have spied this building (1 << houseIndex), default 0
  originalHouse?: House;       // C++ building.cpp:3509 — original house before capture (for survivor halving on sell)
  isSurvivorless?: boolean;    // C++ building.cpp:1298 — kennels and force-destroyed buildings get no survivors
  /** C++ BuildingClass::CountDown after RESULT_DESTROYED.
   *  Drop_Debris runs from BuildingClass::AI only after this frame timer reaches 0. */
  debrisCountdown?: number;
  /** Absolute TS game tick mirroring C++ CDTimerClass expiry for CountDown. */
  debrisDropTick?: number;
  debrisDropped?: boolean;
  /** C++ BuildingClass::WhomToRepay — set only by Tanya C4 sabotage. */
  whomToRepayEntityId?: number;
  /** C++ MissionClass::Timer — building mission timer for guard scan / RNG parity (building.cpp:3228-3306) */
  missionTimer: number;
  /** C++ BuildingClass::Factory — computer-controlled building-local factory.
   *  Player production still lives in the sidebar queue; AI production is owned
   *  by the producing building and advanced by FactoryClass::AI. */
  aiFactory?: {
    kind: 'infantry' | 'unit' | 'vessel' | 'aircraft' | 'building';
    productType: string;
    stage: number;
    rate: number;
    timer: number;
    balance: number;
    cost: number;
    startedTick: number;
    suspended: boolean;
  };
  /** C++ BuildingClass::PlacementDelay — retry delay when completed product cannot exit. */
  aiFactoryPlacementDelay?: number;
  /** C++ BuildingClass radio contact with the factory product during WEAP Mission_Unload. */
  aiFactoryContactEntityId?: number;
  /** C++ BuildingClass radio contact with a harvester during refinery docking. */
  refineryContactEntityId?: number;
  /** C++ BuildingClass::Status for WEAP Mission_Unload. */
  weapUnloadStatus?: number;
  /** C++ DoorClass::State for WEAP Mission_Unload.
   *  0=closed, 1=opening, 2=open, 3=closing. */
  weapDoorState?: number;
  /** C++ DoorClass StageClass fetch stage for WEAP Mission_Unload. */
  weapDoorStage?: number;
  /** C++ DoorClass StageClass rate countdown for WEAP Mission_Unload. */
  weapDoorTimer?: number;
  /** C++ MissionClass::Mission for buildings. Weapon buildings use GUARD to scan, then ATTACK to fire. */
  mission?: Mission;
  /** C++ MissionClass::MissionQueue for buildings. Assign_Mission queues here;
   *  BuildingClass::AI promotes it through Commence() when IsReadyToCommence. */
  missionQueue?: Mission | null;
  /** C++ BuildingClass::IsReadyToCommence gate for queued building missions. */
  isReadyToCommence?: boolean;
  /** TS representation of the next pad animation readiness edge. The C++
   *  flag is raised by BuildingClass::Animation_AI before Commence(). */
  readyToCommenceTick?: number;
  /** C++ BuildingClass::Status for helipad/airstrip Mission_Repair.
   *  0=INITIAL, 1=DURING. The docked aircraft remains in dockedAircraft. */
  repairMissionStatus?: number;
  /** C++ TechnoClass::TarCom for weapon buildings. Mission_Guard assigns
   *  this target; Mission_Attack/Charging_AI use the assigned target rather
   *  than doing a fresh threat scan each tick. */
  targetEntityId?: number;
  /** C++ TechnoClass::IsSecondShot for two-shooter buildings. */
  isSecondShot?: boolean;
  /** C++ Mission_Attack runs once on the frame after Fire_At, sees FIRE_REARM,
   *  refreshes PrimaryFacing.Desired from TarCom, then sleeps on Arm. */
  rearmFacingUpdatePending?: boolean;
  /** C++ BuildingClass::IsCharging for electric weapons (TeslaZap Charges=yes). */
  isCharging?: boolean;
  /** C++ BuildingClass::IsCharged gate checked by BuildingClass::Can_Fire. */
  isCharged?: boolean;
  /** C++ StageClass Fetch_Stage for Tesla charge animation. */
  chargeStage?: number;
  /** Local counter for C++ Set_Rate(3) charge animation timing. */
  chargeRateCounter?: number;
  /** C++ building.cpp:5140 `IsToRepair = rebuild || *b == STRUCT_CONST` — set at scenario load
   *  for all Construction Yards (FACT/CONS) so Repair_AI auto-repairs them when damaged.
   *  Used at building.cpp:5495 inner repair condition. */
  isToRepair?: boolean;
  /** C++ BuildingClass::IsAllowedToSell — scenario INI structure field 7. */
  isAllowedToSell?: boolean;
  /** C++ TechnoClass::IsTickedOff — set when an enemy source damages the building. */
  isTickedOff?: boolean;
  /** C++ building.cpp:5497 BuildingClass::IsRepairing — true once Repair(1) was called
   *  (non-human house; players use UI). Reset when Strength hits MaxStrength or Available_Money
   *  drops below Repair_Cost. */
  isRepairing?: boolean;
  /** Terrain hidden by the structure footprint. C++ Limbo() removes occupancy
   *  without changing CellClass::Land_Type; TS uses terrain as occupancy, so
   *  teardown must restore the land/wall state captured before placement. */
  footprintTerrain?: StructureFootprintTerrain[];
  /** C++ building.cpp:990-993 — Gap Generator Arm timer (CDTimerClass).
   *  When Arm==0, consumes Random_Pick(1, TICKS_PER_SECOND) and resets to
   *  TICKS_PER_MINUTE * GapRegenInterval + jitter. Only used for GAP buildings. */
  gapArmTimer?: number;
  /** C++ building.cpp:2438-2455 — entity ID of the auto-spawned helicopter parked on this HPAD.
   *  Used by tickStructuresInterleaved() to process the helicopter interleaved with buildings
   *  (matching C++ Logic array order) instead of in the aircraft pass. */
  hpadHelicopterId?: number;
  /** C++ building.cpp Door_Stage() — war factory door animation frame (0=closed, 7=fully open).
   *  Animates 0→7 during production, stays open while unit exits, then closes 7→0. */
  doorFrame?: number;
}

/** Weapon stats for defensive structures */
export const STRUCTURE_WEAPONS: Record<string, StructureWeapon> = {
  HBOX:  { weaponName: 'Vulcan', damage: 40, range: 5, rof: 40, warhead: 'SA', projSpeed: 100, isInvisible: true }, // Vulcan → Invisible
  PBOX:  { weaponName: 'Vulcan', damage: 40, range: 5, rof: 40, warhead: 'SA', projSpeed: 100, isInvisible: true }, // Vulcan → Invisible
  GUN:   { weaponName: 'TurretGun', damage: 40, range: 6, rof: 50, warhead: 'AP', splash: 0.5, projSpeed: 40 },
  TSLA:  { weaponName: 'TeslaZap', damage: 100, range: 8.5, rof: 120, warhead: 'Super', splash: 1, projSpeed: 100, isInvisible: true },
  SAM:   { weaponName: 'Nike', damage: 50, range: 7.5, rof: 20, warhead: 'AP', projSpeed: 50, isAntiAir: true },
  AGUN:  { weaponName: 'ZSU-23', secondaryWeaponName: 'ZSU-23', damage: 25, range: 6, rof: 10, warhead: 'AP', projSpeed: 100, isInvisible: true, isAntiAir: true },
  FTUR:  { weaponName: 'FireballLauncher', damage: 125, range: 4, rof: 50, warhead: 'Fire', projSpeed: 12 },
  QUEE:  { weaponName: 'TeslaZap', damage: 60, range: 5, rof: 30, splash: 1, warhead: 'Super', projSpeed: 40 }, // Queen Ant
};

/** Per-building MaxAmmo from rules.ini. C++ BuildingClass initializes Ammo to Class->MaxAmmo. */
export const STRUCTURE_AMMO: Record<string, number> = {
  TSLA: 3, // rules.ini [TSLA] Ammo=3 — rapid electric burst before recharging
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
  MINP: 'none',  // mine — no Armor= in rules.ini, defaults to ARMOR_NONE
  MINV: 'none',  // mine — no Armor= in rules.ini, defaults to ARMOR_NONE
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
  FCOM: 'fcom', MISS: 'miss',
  BARL: 'barl', BRL3: 'brl3',
  // Soviet/Allied structures missing from original mapping
  SPEN: 'spen', BIO: 'bio', HOSP: 'hosp', SYRD: 'syrd',
  MINP: 'minp', MINV: 'minv',
  // Civilian structures
  V01: 'v01', V02: 'v02', V03: 'v03', V04: 'v04', V05: 'v05', V06: 'v06',
  V07: 'v07', V08: 'v08', V09: 'v09', V10: 'v10', V11: 'v11', V12: 'v12',
  V13: 'v13', V14: 'v14', V15: 'v15', V16: 'v16', V17: 'v17', V18: 'v18',
  V19: 'v19', V20: 'v20', V21: 'v21', V22: 'v22', V23: 'v23', V24: 'v24',
  V25: 'v25', V26: 'v26', V27: 'v27', V28: 'v28', V29: 'v29', V30: 'v30',
  V31: 'v31', V32: 'v32', V33: 'v33', V34: 'v34', V35: 'v35', V36: 'v36',
  V37: 'v37',
  // Fake buildings (use real building sprites as fallback)
  FACF: 'fact', DOMF: 'dome', WEAF: 'weap',
};

// C++ BuildingTypeClass::IsLegalTarget. Most structures are legal targets;
// mines are BuildingClass technos but bdata.cpp marks them false, so
// TechnoClass::Evaluate_Object must reject them for auto-acquisition.
export const NON_LEGAL_TARGET_STRUCTURES = new Set(['MINP', 'MINV']);
export const MINE_STRUCTURE_TYPES = new Set(['MINP', 'MINV']);
export const INSIGNIFICANT_STRUCTURE_TYPES = new Set([
  'BARL', 'BRL3',
  'MINV', 'MINP',
  'V01', 'V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08', 'V09',
  'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17', 'V18',
  'SBAG', 'CYCL', 'BRIK', 'BARB', 'WOOD', 'FENC',
  'LAR1', 'LAR2',
]);

export function isLegalStructureTarget(type: string): boolean {
  return !NON_LEGAL_TARGET_STRUCTURES.has(type);
}

export function isMineStructureType(type: string): boolean {
  return MINE_STRUCTURE_TYPES.has(type);
}

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

const STRUCTURE_CENTER_OFFSET_LEPTONS_BY_SIZE: Record<string, { lx: number; ly: number }> = {
  // C++ building.cpp:122 BuildingClass::CenterOffset[BSIZE_*].
  '1x1': { lx: 0x0080, ly: 0x0080 },
  '2x1': { lx: 0x00ff, ly: 0x0080 },
  '1x2': { lx: 0x0080, ly: 0x00ff },
  '2x2': { lx: 0x00ff, ly: 0x00ff },
  '2x3': { lx: 0x00ff, ly: 0x0180 },
  '3x2': { lx: 0x0180, ly: 0x00ff },
  '3x3': { lx: 0x0180, ly: 0x0180 },
  '4x2': { lx: 0x0200, ly: 0x00ff },
  '5x5': { lx: 0x0280, ly: 0x0280 },
};

const SOUTH_FOUNDATION_FACE_STRUCTURES = new Set([
  'IRON', 'FCOM', 'TSLA', 'AGUN', 'GAP', 'AFLD', 'POWR', 'APWR', 'STEK',
  'V01', 'V02', 'V03', 'V04', 'V20', 'V24', 'V25',
]);

export function structureCenterOffsetLeptons(type: string): { lx: number; ly: number } {
  const [w, h] = STRUCTURE_SIZE[type] ?? [1, 1];
  return STRUCTURE_CENTER_OFFSET_LEPTONS_BY_SIZE[`${w}x${h}`] ?? {
    lx: Math.trunc((w * 256) / 2),
    ly: Math.trunc((h * 256) / 2),
  };
}

export function structureCenterLeptons(s: Pick<MapStructure, 'cx' | 'cy'> & { type?: string }): { lx: number; ly: number } {
  const off = structureCenterOffsetLeptons(s.type ?? '');
  return {
    lx: s.cx * 256 + off.lx,
    ly: s.cy * 256 + off.ly,
  };
}

function snapLeptonsToCellCenter(lx: number, ly: number): { lx: number; ly: number } {
  return {
    lx: Math.floor(lx / 256) * 256 + 128,
    ly: Math.floor(ly / 256) * 256 + 128,
  };
}

export function structureTargetLeptons(s: Pick<MapStructure, 'cx' | 'cy'> & { type?: string }): { lx: number; ly: number } {
  const center = structureCenterLeptons(s);
  if (s.type && SOUTH_FOUNDATION_FACE_STRUCTURES.has(s.type)) {
    // C++ BuildingClass::Target_Coord: Adjacent_Cell(Center_Coord(), FACING_S).
    return snapLeptonsToCellCenter(center.lx, center.ly + 256);
  }
  return center;
}

/** C++ Get_Build_Frame_Count(*MAKE.SHP) values for building buildup animations.
 *  Construction and sell timing come from the actual make-sheet frame count,
 *  not a shared constant. These values mirror the extracted RA asset manifest.
 */
export const STRUCTURE_MAKE_FRAME_COUNT: Record<string, number> = {
  FACT: 32,
  WEAP: 15,
  POWR: 13,
  APWR: 13,
  BARR: 13,
  TENT: 13,
  PROC: 10,
  FIX: 14,
  SILO: 14,
  DOME: 17,
  GUN: 20,
  SAM: 18,
  HBOX: 13,
  TSLA: 13,
  AGUN: 10,
  GAP: 13,
  PBOX: 13,
  HPAD: 20,
  AFLD: 11,
  ATEK: 17,
  STEK: 20,
  PDOX: 18,
  IRON: 14,
  MSLO: 15,
  KENN: 20,
  SYRD: 18,
  SPEN: 14,
  BIO: 16,
  HOSP: 20,
};

// C++ fixed(".06") * TICKS_PER_MINUTE = ((15 * 900) + 128) / 256 = 53.
const CPP_BUILDUP_TICKS = 53;

export function structureMakeFrameCount(type: string): number {
  return STRUCTURE_MAKE_FRAME_COUNT[type] ?? 20;
}

export function structureBuildAnimationRate(type: string): number {
  return Math.max(1, Math.floor(CPP_BUILDUP_TICKS / structureMakeFrameCount(type)));
}

/** Number of TS progress ticks needed to match C++ construction completion.
 *  TS updates buildProgress on the placement tick after C++ has already passed
 *  the new building's Logic slot, so the denominator includes the initial frame.
 */
export function structureConstructionProgressTicks(type: string): number {
  const count = structureMakeFrameCount(type);
  if (count <= 1) return 1;
  return ((count - 1) * structureBuildAnimationRate(type)) + 1;
}

export function isStructureUnderConstruction<T extends Pick<MapStructure, 'buildProgress'>>(
  s: T,
): s is T & { buildProgress: number } {
  return s.buildProgress !== undefined && s.buildProgress < 1;
}

type StructureOffset = readonly [number, number];

const RECT_1X1: readonly StructureOffset[] = [[0, 0]];
const RECT_2X1: readonly StructureOffset[] = [[0, 0], [1, 0]];
const RECT_1X2: readonly StructureOffset[] = [[0, 0], [0, 1]];
const RECT_2X2: readonly StructureOffset[] = [[0, 0], [1, 0], [0, 1], [1, 1]];
const RECT_2X2_BOTTOM_ROW: readonly StructureOffset[] = [[0, 1], [1, 1]];
const RECT_2X2_EXCEPT_NW: readonly StructureOffset[] = [[1, 0], [0, 1], [1, 1]];
const RECT_2X2_EXCEPT_SW: readonly StructureOffset[] = [[0, 0], [1, 0], [1, 1]];
const RECT_3X2: readonly StructureOffset[] = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]];
const RECT_3X3: readonly StructureOffset[] = [
  [0, 0], [1, 0], [2, 0],
  [0, 1], [1, 1], [2, 1],
  [0, 2], [1, 2], [2, 2],
];

/** C++ bdata.cpp Occupy_List cells. These are the movement-blocking foundation
 * cells, not necessarily the full rendered sprite footprint. Overlap_List cells
 * visually overlap the map but do not put a BuildingClass in Cell_Occupier().
 */
export const STRUCTURE_OCCUPY_OFFSETS: Record<string, readonly StructureOffset[]> = {
  FACT: RECT_3X3, FACF: RECT_3X3,
  WEAP: RECT_3X2, WEAF: RECT_3X2,
  POWR: RECT_2X2, BARR: RECT_2X2, TENT: RECT_2X2, DOME: RECT_2X2,
  KENN: RECT_1X1,
  AFLD: RECT_3X2,
  APWR: [[0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
  STEK: [[0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
  ATEK: [[0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
  PROC: [[1, 0], [0, 1], [1, 1], [2, 1], [0, 2]],
  HPAD: RECT_2X2,
  GAP: [[0, 1]],
  SAM: RECT_2X1,
  TSLA: [[0, 1]],
  AGUN: [[0, 1]],
  FIX: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  IRON: [[0, 1], [1, 1]],
  FCOM: [[0, 1], [1, 1]],
  PDOX: RECT_2X2,
  MSLO: RECT_2X1,
  SYRD: RECT_3X3, SPEN: RECT_3X3,
  BIO: RECT_2X2, HOSP: RECT_2X2,
  MISS: RECT_3X2,
  PBOX: RECT_1X1, HBOX: RECT_1X1, GUN: RECT_1X1, FTUR: RECT_1X1,
  SILO: RECT_1X1, MINP: RECT_1X1, MINV: RECT_1X1,
  BARL: RECT_1X1, BRL3: RECT_1X1,
  SBAG: RECT_1X1, FENC: RECT_1X1, BARB: RECT_1X1, BRIK: RECT_1X1, WOOD: RECT_1X1, CYCL: RECT_1X1,
  V01: RECT_2X2_BOTTOM_ROW,
  V02: RECT_2X2_BOTTOM_ROW,
  V03: RECT_2X2_EXCEPT_NW,
  V04: RECT_2X2_BOTTOM_ROW,
  V20: RECT_2X2_BOTTOM_ROW,
  V21: RECT_2X2_EXCEPT_SW,
  V24: RECT_2X2_BOTTOM_ROW,
  V25: RECT_2X2_EXCEPT_NW,
  ...Object.fromEntries(CIVILIAN_STRUCTURE_2X1.map(type => [type, RECT_2X1] as const)),
  ...Object.fromEntries(CIVILIAN_STRUCTURE_1X1.map(type => [type, RECT_1X1] as const)),
  ...Object.fromEntries(CIVILIAN_STRUCTURE_4X2.map(type => [type, [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]]] as const)),
};

export function getStructureOccupyCells(type: string, cx: number, cy: number): CellPos[] {
  const offsets = STRUCTURE_OCCUPY_OFFSETS[type] ?? (() => {
    const [fw, fh] = STRUCTURE_SIZE[type] ?? [1, 1];
    const rect: StructureOffset[] = [];
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) rect.push([dx, dy]);
    }
    return rect;
  })();
  return offsets.map(([dx, dy]) => ({ cx: cx + dx, cy: cy + dy }));
}

// C++ bdata.cpp:3597-3629 Bib_And_Offset — buildings with IsBibbed=true in rules.ini.
// Bibs are decorative smudges placed beneath certain buildings. They block later
// building placement via CellClass::Is_Clear_To_Build, but they do not block
// CellClass::Is_Clear_To_Move. The bib extends 1 row below the building footprint, with the same
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

export interface StructureFootprintTerrain {
  cx: number;
  cy: number;
  terrain: Terrain;
  wallType: string;
  wallOwner: House | null;
}

/** Capture the land state hidden by a building footprint before TS marks those
 *  cells as blocked. C++ stores building occupancy separately from Land_Type. */
export function captureStructureFootprintTerrain(
  map: GameMap,
  type: string,
  cx: number,
  cy: number,
  includeBib = false,
): StructureFootprintTerrain[] {
  const cells = includeBib
    ? [...getStructureOccupyCells(type, cx, cy), ...getBibCells(type, cx, cy)]
    : getStructureOccupyCells(type, cx, cy);
  const seen = new Set<number>();
  const captured: StructureFootprintTerrain[] = [];
  for (const cell of cells) {
    const key = cell.cy * 128 + cell.cx;
    if (seen.has(key)) continue;
    seen.add(key);
    captured.push({
      cx: cell.cx,
      cy: cell.cy,
      terrain: map.getTerrain(cell.cx, cell.cy),
      wallType: map.getWallType(cell.cx, cell.cy),
      wallOwner: map.getWallOwner(cell.cx, cell.cy),
    });
  }
  return captured;
}

const WALL_STRUCTURE_TYPES = new Set(['SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD', 'CYCL']);

function assignOverlayWallOwners(map: GameMap, structures: MapStructure[]): void {
  const ownerStructures = structures.filter(s =>
    s.alive && !WALL_STRUCTURE_TYPES.has(s.type));

  for (let cy = 0; cy < MAP_CELLS; cy++) {
    for (let cx = 0; cx < MAP_CELLS; cx++) {
      const wallType = map.getWallType(cx, cy);
      if (!wallType || map.getWallOwner(cx, cy) !== null) continue;

      let owner: House | null = null;
      let bestDist = Number.MAX_SAFE_INTEGER;
      const wallCoord = cellToLepton(cx, cy);
      for (const structure of ownerStructures) {
        const center = structureCenterLeptons(structure);
        const dist = leptonDist(center.lx, center.ly, wallCoord.lx, wallCoord.ly);
        if (dist < bestDist) {
          bestDist = dist;
          owner = structure.house;
        }
      }
      map.setWallOwner(cx, cy, owner);
    }
  }
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
  /** Count of [TERRAIN] objects from scenario INI that occupy C++ Logic slots.
   *  TerrainClass objects are submitted before units/buildings, even when their
   *  AI is inert for the current tick. */
  terrainLogicCount: number;
  /** Count of TERRAIN_MINE entities (ore mines / gem blossoms) from scenario INI.
   *  Each fires 2 RNGs every GrowthRate*TICKS_PER_MINUTE via C++ TerrainClass::AI
   *  → CellClass::Spread_Tiberium (terrain.cpp:497, cell.cpp:2963-2978). */
  terrainMineCount: number;
  /** TERRAIN_MINE spread source cells and C++ Logic indices.
   *  TerrainClass::Target_Coord uses CenterBase XYP_COORD(12,24), so the
   *  forced spread source is one cell south of the INI origin. */
  terrainMineSpreadCells: Array<{ cx: number; cy: number; logicIndex: number }>;
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
  /** Per-house PlayerControl= flag from scenario INI. */
  housePlayerControl: Map<House, boolean>;
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
  /** C++ RulesClass::IsAllyReveal after scenario [General] overrides. */
  allyReveal: boolean;
  /** C++ Scen.IsTanyaEvac — CivEvac=yes in [Basic]. Tanya counts as civilian evacuation. */
  isTanyaEvac: boolean;
}

/** Convert INI mission string to Mission enum and apply to entity */
/**
 * C++ unit.cpp:4705 — `unit->Strength = MaxStrength * fixed(strength, 256);`
 * C++ fixed(N,D) * int = (int * N + D/2) / D (rounds to nearest, not floor).
 * Then line 4706 snaps to MaxStrength if within 3 of it (handles strength=256).
 */
function scenarioStrengthToHP(strength: number, maxHp: number): number {
  // C++ fixed-point: (MaxStrength * strength + 128) / 256 — round to nearest
  let hp = Math.floor((maxHp * strength + 128) / 256);
  // C++ unit.cpp:4706 — snap to full HP when within 3 of max
  if (hp > maxHp - 3) hp = maxHp;
  return hp;
}

const CPP_MISSION_NAME_MAP: Record<string, Mission> = {
  'sleep': Mission.SLEEP,
  'attack': Mission.ATTACK,
  'move': Mission.MOVE,
  'qmove': Mission.QMOVE,
  'retreat': Mission.RETREAT,
  'guard': Mission.GUARD,
  'sticky': Mission.STICKY,
  'enter': Mission.ENTER,
  'capture': Mission.CAPTURE,
  'harvest': Mission.HARVEST,
  'area guard': Mission.AREA_GUARD,
  'return': Mission.RETURN,
  'stop': Mission.STOP,
  'ambush': Mission.AMBUSH,
  'hunt': Mission.HUNT,
  'unload': Mission.UNLOAD,
  'sabotage': Mission.SABOTAGE,
  'construction': Mission.CONSTRUCTION,
  'selling': Mission.DECONSTRUCTION,
  'repair': Mission.REPAIR,
  'rescue': Mission.RESCUE,
  'missile': Mission.MISSILE,
  'harmless': Mission.HARMLESS,
};

export function missionFromIniName(missionStr: string): Mission | null {
  const key = missionStr.trim().toLowerCase();
  if (key === '' || key === 'none') return null;
  return CPP_MISSION_NAME_MAP[key] ?? null;
}

function applyMission(entity: Entity, missionStr: string): void {
  const mission = missionFromIniName(missionStr);
  if (mission === null) {
    // TechnoClass::Unlimbo enters the class idle mission before Read_INI
    // Assign_Mission(). A MISSION_NONE/unknown token leaves that idle GUARD in
    // place for active scenario objects.
    entity.mission = Mission.GUARD;
    return;
  }
  entity.mission = mission;
  if (mission === Mission.AREA_GUARD) {
    entity.guardOrigin = { x: entity.pos.x, y: entity.pos.y };
  }
}

/** Load a scenario and create entities + map setup */
export async function loadScenario(scenarioId: string, assets?: AssetManager): Promise<ScenarioResult> {
  const url = `/ra/assets/${scenarioId}.ini`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load scenario: ${url}`);
  const text = await res.text();
  const data = parseScenarioINI(text, scenarioId);
  consumeCxxHouseInitRNG();

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
  for (const [logicIndex, t] of data.terrain.entries()) {
    const pos = cellIndexToPos(t.cell);
    const type = t.type.toLowerCase();
    if (type.includes('water') || type.includes('river')) {
      map.setTerrain(pos.cx, pos.cy, Terrain.WATER);
    } else if (type.includes('rock') || type.includes('cliff')) {
      map.setTerrain(pos.cx, pos.cy, Terrain.ROCK);
    } else if (/^tc?\d/.test(type)) {
      // T01-T17 = single trees, TC01-TC05 = tree clumps.
      // C++ parity: trees are TerrainClass objects layered on top of the MapPack
      // land type (RA terrain.cpp TerrainClass::Mark -> Map.Place_Down). Do not
      // replace the decoded terrain with Terrain.TREE here: the underlying land
      // still controls UnitClass::Can_Enter_Cell. SCG06EA has a T13 origin on
      // LAND_WALL at (86,98); C++ blocks the HARV there even though the tree's
      // Occupy_List only marks the cell south of the origin.
      const isClump = type.startsWith('tc');
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
        logicIndexHint: logicIndex,
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
          map.setTreeType(pos.cx + dx, pos.cy + dy, '_clump');
        }
      }
    } else if (TERRAIN_OBJECT_OCCUPY[type]) {
      // C++ TerrainClass objects that are not trees still occupy cells.
      // Example: SCG13EA BOXES02 at cell 8737 (82,75) blocks C++ infantry
      // pathing via TerrainTypeClass::Occupy_List (_List10), so TS must
      // register the same blocker instead of treating it as decoration.
      map.addTerrainObject(type, pos.cx, pos.cy, TERRAIN_OBJECT_OCCUPY[type], logicIndex);
    }
  }

  // Create entities from INI unit/infantry placements.
  // C++ Logic layer processes entities in INI index order — confirmed by
  // per-entity tracking: Logic[22-25]=UNITS 0-3, Logic[26-47]=INFANTRY 0-21.
  // No house sorting — entities appear in the exact order from the INI file.
  const entities: Entity[] = [];

  for (const u of data.units) {
    const unitType = toUnitType(u.type);
    if (!unitType) continue;
    const pos = cellIndexToPos(u.cell);
    const world = cellToWorld(pos.cx, pos.cy);
    const entity = new Entity(unitType, toHouse(u.house), world.x, world.y);
    entity.bodyFacing256 = u.facing & 0xff;
    entity.facing = dir256ToFacing8(entity.bodyFacing256);
    entity.desiredFacing = entity.facing;
    entity.bodyFacing32 = dir256ToFacing32(entity.bodyFacing256);

    // C++ VesselClass constructor initializes SecondaryFacing from the default
    // PrimaryFacing, then VesselClass::Read_INI applies the INI facing to
    // PrimaryFacing only. Turreted vessels therefore start with body facing from
    // the scenario and turret facing still north. This matters for SCG07EA PT
    // boats: Can_Fire returns FIRE_ROTATING until SecondaryFacing catches up.
    if (entity.isNavalUnit && entity.hasTurret) {
      entity.turretFacing = Dir.N;
      entity.turretFacing256 = 0;
    } else {
      entity.turretFacing = entity.facing;
      entity.turretFacing256 = entity.bodyFacing256;
    }
    entity.desiredTurretFacing256 = entity.turretFacing256;
    entity.desiredTurretFacing = entity.turretFacing;
    entity.turretFacing32 = dir256ToFacing32(entity.turretFacing256);
    entity.prevTurretFacing32 = entity.turretFacing32;
    entity.hp = scenarioStrengthToHP(u.hp, entity.maxHp);
    if (u.trigger && u.trigger !== 'None') entity.triggerName = u.trigger;
    applyMission(entity, u.mission);
    entities.push(entity);
  }

  for (const inf of data.infantry) {
    const unitType = toUnitType(inf.type);
    if (!unitType) continue;
    const pos = cellIndexToPos(inf.cell);
    // C++ infantry spawn at exact sub-cell lepton position (const.cpp StoppingCoordAbs).
    // Compute lepton coordinates directly: cell origin + sub-cell lepton offset.
    const sc = SUBCELL_LEPTON_OFFSETS[inf.subCell] ?? SUBCELL_LEPTON_OFFSETS[0];
    const spawnLX = (pos.cx << 8) + sc.lx;
    const spawnLY = (pos.cy << 8) + sc.ly;
    // Entity constructor takes pixels; pass cell center then override with exact leptons.
    const world = cellToWorld(pos.cx, pos.cy);
    const entity = new Entity(unitType, toHouse(inf.house), world.x, world.y);
    // Override with exact sub-cell lepton position (avoids pixel->lepton truncation errors)
    entity.leptonX = spawnLX;
    entity.leptonY = spawnLY;
    entity.syncPosFromLeptons();
    entity.prevPos = { x: entity.pos.x, y: entity.pos.y };
    entity.bodyFacing256 = inf.facing & 0xff;
    entity.facing = dir256ToFacing8(entity.bodyFacing256);
    entity.desiredFacing = entity.facing;
    entity.bodyFacing32 = dir256ToFacing32(entity.bodyFacing256);
    entity.hp = scenarioStrengthToHP(inf.hp, entity.maxHp);
    entity.subCell = inf.subCell;
    entity.claimedCellIdx = pos.cy * 128 + pos.cx;
    entity.claimedSubCell = inf.subCell;
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
    const maxAmmo = STRUCTURE_AMMO[s.type] ?? -1;
    const trigName = s.trigger && s.trigger !== 'None' ? s.trigger : undefined;
    structures.push({
      type: s.type,
      image,
      house: toHouse(s.house),
      cx: pos.cx,
      cy: pos.cy,
      // C++ building.cpp uses the same MaxStrength * fixed(strength, 256) math
      // with a snap-to-full when within 3 of max (techno.cpp:4848).
      hp: scenarioStrengthToHP(s.hp, maxHp),
      maxHp,
      armor: STRUCTURE_ARMOR[s.type] ?? 'wood',
      alive: s.hp > 0,
      rubble: false,
      weapon: STRUCTURE_WEAPONS[s.type],
      attackCooldown: 0,
      ammo: maxAmmo,
      maxAmmo,
      isAllowedToSell: !!s.sellable,
      footprintTerrain: captureStructureFootprintTerrain(map, s.type, pos.cx, pos.cy),
      // C++ BuildingClass::Read_INI passes the 5th structure field to
      // Unlimbo(), which stores it in TechnoClass::PrimaryFacing. Turreted
      // buildings therefore start from scenario facing, not bdata StartFace.
      ...(['GUN', 'SAM', 'AGUN'].includes(s.type) ? {
        turretFacing256: s.facing & 0xff,
        desiredTurretFacing256: s.facing & 0xff,
        turretDir: ((s.facing + 16) >> 5) & 7,
        desiredTurretDir: ((s.facing + 16) >> 5) & 7,
      } : {}),
	      triggerName: trigName,
	      mission: Mission.GUARD,
	      missionTimer: 0, // C++ MissionClass::Timer — initialized to 0, fires on first tick
      ...(s.type === 'TSLA' ? { isCharging: false, isCharged: false, chargeStage: 0, chargeRateCounter: 0 } : {}),
      ...(s.type === 'GAP' ? { gapArmTimer: 0 } : {}), // C++ TechnoClass::Arm initialized to 0
      // C++ building.cpp:5140 `IsToRepair = rebuild || *b == STRUCT_CONST` — ConYards auto-repair,
      // plus any building with the 8th INI field set to 1 (AI-repairable in this scenario).
      ...(s.type === 'FACT' || s.type === 'CONS' || s.rebuild ? { isToRepair: true } : {}),
    });
    // Mark C++ Occupy_List cells as impassable. The rendered footprint can be
    // larger than the active foundation; overlap cells remain passable.
    // AP/AV mines are BuildingClass objects with an Occupy_List, but
    // UnitClass/InfantryClass::Can_Enter_Cell has mine-specific passability
    // rules. Encoding mines as wall terrain makes pathfinding route around
    // them before those rules can run.
    if (!isMineStructureType(s.type)) {
      for (const cell of getStructureOccupyCells(s.type, pos.cx, pos.cy)) {
        map.setTerrain(cell.cx, cell.cy, Terrain.WALL);
      }
    }
    // C++ building.cpp:785-790 creates a BIB smudge. Bibs reject building
    // placement (cell.cpp:489) but do not participate in Is_Clear_To_Move.
    for (const cell of getBibCells(s.type, pos.cx, pos.cy)) {
      map.setBibSmudge(cell.cx, cell.cy, true);
    }
    // Store wall type for auto-connection sprite rendering
    if (s.type === 'SBAG' || s.type === 'FENC' || s.type === 'BARB' || s.type === 'BRIK') {
      map.setWallType(pos.cx, pos.cy, s.type, toHouse(s.house));
    }
  }

  // C++ OverlayClass::Read_INI assigns OverlayPack wall cell ownership to the
  // nearest already-unlimboed building. This owner is used by
  // TechnoClass::Evaluate_Just_Cell to decide whether AI may auto-target walls.
  assignOverlayWallOwners(map, structures);

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
    if (section.has('Power')) {
      s.power = parseInt(section.get('Power')!, 10);
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
  for (let si = 0; si < structures.length; si++) {
    const s = structures[si];
    if (!s.alive) continue;
    const isSoviet = s.house === House.USSR || s.house === House.Ukraine || s.house === House.BadGuy;

    if (s.type === 'HPAD') {
      // Check if any aircraft already parked here
      // C++ parity: HPAD is 2x2, aircraft spawns at (cx+1, cy) — the top-right cell center.
      // C++ helipad Unlimbo docks aircraft at this position.
      const padWorld = cellToWorld(s.cx + 1, s.cy);
      const alreadyParked = entities.some(e =>
        e.stats.isAircraft && Math.abs(e.pos.x - padWorld.x) < CELL_SIZE * 2 && Math.abs(e.pos.y - padWorld.y) < CELL_SIZE * 2
      );
      if (!alreadyParked) {
        const heliType = isSoviet ? UnitType.V_HIND : UnitType.V_HELI;
        const heli = new Entity(heliType, s.house, padWorld.x, padWorld.y);
        heli.mission = Mission.GUARD;
        heli.aircraftState = 'landed';
        heli.flightAltitude = 0;
        heli.aircraftHeightLeptons = 0;
        heli.landedAtStructure = si; // dock helicopter at this HPAD index
        // C++ building.cpp:2485 Assign_Mission(MISSION_GUARD) leaves MissionTimer=0 so
        // Mission_Guard fires on the first AI tick — Find_Juicy_Target may transition
        // to MISSION_ATTACK (aircraft.cpp:3821-3824). Without this, the HIND sits in
        // GUARD for 42+ ticks before scanning.
        heli.missionTimer = 0;
        entities.push(heli);
        // C++ building.cpp:2438-2455 — record helicopter ID on HPAD for interleaved processing.
        // In C++, this helicopter enters the Logic array right after the HPAD building,
        // so its guard timer RNG calls happen between buildings, not in the aircraft pass.
        s.hpadHelicopterId = heli.id;
        s.dockedAircraft = heli.id;
      }
    }
    // Note: AFLD (airfields) are NOT auto-populated at init time — C++ AI_Aircraft
    // only creates helicopters for HPADs initially. Fixed-wing aircraft come later
    // via the runtime AI production system.
  }

  // C++ scenario.cpp: Map.Overpass -> CellClass::Tiberium_Adjust(true).
  // This randomizes ore/gem visual variants after all scenario INI content is
  // loaded, consuming one Random_Pick per ore/gem cell in playable map order.
  map.applyScenarioOreOverpass();

  // Count TERRAIN_MINE entities for Spread_Tiberium RNG parity (C++ terrain.cpp:497).
  // C++ creates a TerrainClass object per MINE; each is an ObjectClass in the Logic
  // array with AI that calls Spread_Tiberium — 2 RNGs per mine at Frame=0 and every
  // GrowthRate*TICKS_PER_MINUTE. Three RA mine types: MINE (ore), GMINE (gem),
  // TC05 (also a mine variant in some themes). Match C++ TerrainTypeClass IsSpawnsTiberium.
  const terrainMineSpreadCells: Array<{ cx: number; cy: number; logicIndex: number }> = [];
  for (const [logicIndex, t] of data.terrain.entries()) {
    const up = t.type.toUpperCase();
    if (up === 'MINE') {
      const pos = cellIndexToPos(t.cell);
      terrainMineSpreadCells.push({ cx: pos.cx, cy: pos.cy + 1, logicIndex });
    }
  }

  return {
    map,
    entities,
    structures,
    terrainLogicCount: data.terrain.length,
    terrainMineCount: terrainMineSpreadCells.length,
    terrainMineSpreadCells,
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
    housePlayerControl: new Map(
      Array.from(data.housePlayerControl.entries()).map(([k, v]) => [toHouse(k), v])
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
    allyReveal: data.allyReveal,
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
// RA overlay IDs: 0..4 = walls, 5..8 = Gold ore visual variants,
// 9..12 = Gems visual variants, 13..19 = V12..V18 rock overlays,
// 20 = flag spot, 21/22 = land crates, 23 = FENC wall, 24 = water crate.
// Harvestable amount lives in CellClass::OverlayData, mirrored by map.oreDensity.

function overlayTerrain(overlayId: number): Terrain | null {
  // C++ cell.cpp Recalc_Attributes: OverlayTypeClass::Land overrides template
  // Land_Type when it is not LAND_CLEAR.
  if (overlayId >= 0 && overlayId <= 4) return Terrain.WALL;
  if (overlayId >= 5 && overlayId <= 12) return Terrain.ORE;
  if (overlayId >= 13 && overlayId <= 19) return Terrain.ROCK;
  if (overlayId === 23) return Terrain.WALL;  // OVERLAY_FENCE/FENC
  if (overlayId === 24) return Terrain.WATER; // OVERLAY_WATER_CRATE
  return null;
}

function overlayWallType(overlayId: number): string {
  switch (overlayId) {
    case 0: return 'SBAG';
    case 1: return 'CYCL';
    case 2: return 'BRIK';
    case 3: return 'BARB';
    case 4: return 'WOOD';
    case 23: return 'FENC';
    default: return '';
  }
}

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
    for (let idx = 0; idx < MAP_SIZE; idx++) {
      const terrain = overlayTerrain(overlay[idx]);
      if (terrain !== null) {
        map.setTerrain(idx % 128, Math.floor(idx / 128), terrain);
      }
      const wallType = overlayWallType(overlay[idx]);
      if (wallType) {
        map.setWallType(idx % 128, Math.floor(idx / 128), wallType);
      }
    }
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
      classifyInteriorTerrain(map, templateType, templateIcon, tilesetMeta);
    } else {
      // TEMPERATE and SNOW share template ID ranges; each theatre's TMP control
      // map provides the actual per-icon Land_Type.
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
  // C++ parity: MapPack is a full 128x128 CellClass terrain layer. The [Map]
  // rectangle controls scenario viewport/radar bounds, not the only cells that
  // UnitClass::Can_Enter_Cell and Basic_Path may inspect. Reinforcement teams
  // can path multiple cells outside the visible rectangle (SCG10EA west edge).
  const startY = 0;
  const endY = 128;
  const startX = 0;
  const endX = 128;

  for (let cy = startY; cy < endY; cy++) {
    for (let cx = startX; cx < endX; cx++) {
      const idx = cy * 128 + cx;
      const tmpl = templateType[idx];

      if (tmpl === 0xFFFF || tmpl === 0x00 || tmpl === 0xFF) {
        map.setTerrain(cx, cy, Terrain.CLEAR);
        continue;
      }

      // ── Per-icon classification (C++ parity) ──────────────────────
      // C++ cdata.cpp:3002-3032: Land_Type(icon) reads control map byte from TMP file,
      // indexes _land[16] lookup table to get LandType per icon.
      if (tilesetMeta) {
        const icon = templateIcon[idx] ?? 0;
        const key = `${tmpl},${icon}`;
        const entry = tilesetMeta.tiles[key];
        if (entry) {
          const landName = entry.lt ?? 'Clear'; // absent lt = Clear
          const terrain = LAND_NAME_TO_TERRAIN[landName] ?? Terrain.CLEAR;

          map.setTerrain(cx, cy, terrain);
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
export function classifyInteriorTerrain(
  map: GameMap,
  templateType: Uint16Array,
  templateIcon: Uint8Array,
  tilesetMeta?: TilesetMeta | null,
): void {
  // C++ parity: INTERIOR terrain also comes from the TMP control map, not
  // from broad template ranges. `template,icon` is needed because the same
  // interior template can mix Clear and Rock cells (e.g. 397,1 is Rock).
  // Fall back to the old range table only when metadata is unavailable.
  for (let cy = map.boundsY; cy < map.boundsY + map.boundsH; cy++) {
    for (let cx = map.boundsX; cx < map.boundsX + map.boundsW; cx++) {
      const idx = cy * 128 + cx;
      const tmpl = templateType[idx];

      if (tmpl === 0xFFFF || tmpl === 0x00) {
        // C++ CellClass::Recalc_Attributes: in INTERIOR theatre, no template
        // and CLEAR1 are treated as impassable rock.
        map.setTerrain(cx, cy, Terrain.ROCK);
        continue;
      }
      if (tmpl === 255) {
        // Historical sentinel: C++ skips template lookup and falls through to
        // LAND_CLEAR. This is distinct from TEMPLATE_NONE (0xFFFF).
        continue;
      }

      if (tilesetMeta) {
        const icon = templateIcon[idx] ?? 0;
        const entry = tilesetMeta.tiles[`${tmpl},${icon}`];
        if (entry) {
          const terrain = LAND_NAME_TO_TERRAIN[entry.lt ?? 'Clear'] ?? Terrain.CLEAR;
          if (terrain !== Terrain.CLEAR) {
            map.setTerrain(cx, cy, terrain);
          }
          continue;
        }
      }

      if (tmpl >= 291 && tmpl <= 317) {
        // Light walls — impassable
        map.setTerrain(cx, cy, Terrain.WALL);
      } else if (tmpl >= 329 && tmpl <= 377) {
        // Walls — impassable
        map.setTerrain(cx, cy, Terrain.ROCK);
      }
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
  /** C++ raw Scen memory view for out-of-bounds GlobalFlags reads.
   *  TEVENT_GLOBAL_SET/CLEAR reads Scen.GlobalFlags[Data.Value] without the
   *  bounds check used by TACTION_SET/CLEAR_GLOBAL. Index 30 aliases the first
   *  byte of Scen.Views[0] because GlobalFlags has exactly 30 bool entries. */
  cppGlobalFlagMemory?: Uint8Array;
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
  leftMapTeamTypes?: Set<number>; // C++ TEVENT_LEAVES_MAP: TeamType indices that emptied off-map
  // Building existence check (for BUILDING_EXISTS)
  structureTypes: Set<string>; // set of alive structure type names
  // Per-house raw BScan structure types alive.
  structureTypesByHouse: Map<number, Set<string>>; // houseIdx -> set of alive structure types
  // Per-house ActiveBScan structure types alive. BUILDING_EXISTS uses this;
  // NOFACTORIES intentionally uses the raw BScan above.
  activeStructureTypesByHouse?: Map<number, Set<string>>;
  // House index of the trigger being evaluated (C++ trigger.cpp: Class->House)
  triggerHouse: number;
  // Structure types player has built during this game (for TEVENT_BUILD)
  builtStructureTypes: Set<string>;
  // Per-house built structure types (C++ tevent.cpp: TEVENT_BUILD uses
  // HouseClass::JustBuiltStructure scoped to the trigger's own house, not global)
  builtStructureTypesByHouse: Map<number, Set<string>>;
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
  // C++ HouseClass::UnitsLost/BuildingsLost, keyed by RA house index.
  // TEVENT_N* checks the trigger owner's house, while event.data is the threshold.
  unitsLostByHouse: Map<number, number>;
  buildingsLostByHouse: Map<number, number>;
  isLowPower: boolean;        // player is low on power
  playerCredits: number;      // player's current credits
  // TR3: new event state fields
  buildingsDestroyedByHouse: Map<number, boolean>; // per-house: all buildings destroyed?
  nBuildingsDestroyed: number;   // total count of buildings destroyed
  playerFactoriesExist: boolean; // legacy snapshot field; TEVENT_NOFACTORIES uses triggerHouse BScan
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
  const readCppGlobalFlag = (index: number): boolean => {
    if (index < 0) return false;
    if (index < 30) return state.globals.has(index);
    return (state.cppGlobalFlagMemory?.[index] ?? 0) !== 0;
  };

  switch (event.type) {
    case TEVENT_NONE:
      // C++ parity: TEVENT_NONE = "no event" = false. Triggers with TEVENT_NONE
      // only fire when forced via TACTION_FORCE_TRIGGER. Confirmed by C++ WASM
      // playthrough: no reinforcements at game start (units=1, not 32).
      return false;
    case TEVENT_ANY:
      return true;
    case TEVENT_TIME: {
      // C++ tevent.cpp:251-253: CDTimerClass fires when Value()==0.
      // TEventClass::Reset assigns Data * (TICKS_PER_MINUTE/10), which starts
      // a countdown from the current FrameTimer. CDTimerClass reaches zero as
      // soon as elapsed >= delay; SCU32EA bom1/bom2 fires exactly at 90 ticks.
      const requiredTicks = event.data * TIME_UNIT_TICKS;
      return (state.gameTick - state.triggerStartTick) >= requiredTicks;
    }
    case TEVENT_GLOBAL_SET:
      // C++ tevent.cpp:238-244 intentionally has no bounds check here. That
      // means index 30 aliases Scen.Views[0]'s low byte; SCU34EA's civ4 trigger
      // relies on this and creates the opening help/hel1 teams at tick 0.
      return readCppGlobalFlag(event.data);
    case TEVENT_GLOBAL_CLEAR:
      return !readCppGlobalFlag(event.data);
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
      const houseIdx = event.data;
      return !(state.houseAlive.get(houseIdx) ?? false);
    }
    case TEVENT_NUNITS_DESTROYED:
      // C++ tevent.cpp:408-410 checks HouseClass::UnitsLost for the trigger's
      // own House field. Data.Value is the threshold, not a house selector.
      return (state.unitsLostByHouse.get(state.triggerHouse) ?? 0) >= event.data;
    case TEVENT_DESTROYED:
      // C++ Spring() parity: fires once per death. pendingDestroyedCount tracks unprocessed deaths.
      return state.pendingDestroyedCount > 0 && state.destroyedTriggerNames.has(state.triggerName);
    case TEVENT_MISSION_TIMER_EXPIRED:
      return state.missionTimerExpired;
    case TEVENT_BUILDING_EXISTS: {
      // Check if a specific building type exists for the trigger's house
      // (C++ tevent.cpp: HouseClass::As_Pointer(house)->BQuantity[Data.Structure] > 0)
      // The house is the trigger's own House field — NOT global structure count.
      // event.data is RA StructType enum index (from BTYPE.H).
      const STRUCT_TYPES: Record<number, string> = {
        0: 'ATEK', 1: 'IRON', 2: 'WEAP', 3: 'PDOX', 4: 'PBOX', 5: 'HBOX',
        6: 'DOME', 7: 'GAP',  8: 'GUN',  9: 'AGUN', 10: 'FTUR', 11: 'FACT',
        12: 'PROC', 13: 'SILO', 14: 'HPAD', 15: 'SAM', 16: 'AFLD', 17: 'POWR',
        18: 'APWR', 19: 'STEK', 20: 'HOSP', 21: 'BARR', 22: 'TENT', 23: 'KENN',
        24: 'FIX',  25: 'BIO',  26: 'MISS', 27: 'SYRD', 28: 'SPEN', 29: 'MSLO',
        30: 'FCOM', 31: 'TSLA', 32: 'QUEE', 33: 'LAR1', 34: 'LAR2',
      };
      const houseStructs = (state.activeStructureTypesByHouse ?? state.structureTypesByHouse)
        .get(state.triggerHouse);
      const btype = STRUCT_TYPES[event.data];
      if (btype) return houseStructs?.has(btype) ?? false;
      return (houseStructs?.size ?? 0) > 0; // fallback: any building
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
      if (!state.enteredZone) return false;
      return state.playerEnteredHouse === undefined || state.playerEnteredHouse === event.data;
    case TEVENT_ATTACKED:
      // Attached object was attacked (damaged) — per-entity tracking via triggerName
      return state.attackedTriggerNames.has(state.triggerName);
    case TEVENT_BUILD: {
      // Player has built a structure of the specified type (event.data = StructType index).
      // C++ tevent.cpp TEVENT_BUILD uses HouseClass::JustBuiltStructure, scoped to the
      // trigger's own House — NOT a global "any house built this" check. Mirrors the
      // BUILDING_EXISTS fix (commit 80f6ab5).
      // Uses the same STRUCT_TYPES mapping as BUILDING_EXISTS.
      const BUILD_STRUCT_TYPES: Record<number, string> = {
        0: 'ATEK', 1: 'IRON', 2: 'WEAP', 3: 'PDOX', 4: 'PBOX', 5: 'HBOX',
        6: 'DOME', 7: 'GAP',  8: 'GUN',  9: 'AGUN', 10: 'FTUR', 11: 'FACT',
        12: 'PROC', 13: 'SILO', 14: 'HPAD', 15: 'SAM', 16: 'AFLD', 17: 'POWR',
        18: 'APWR', 19: 'STEK', 20: 'HOSP', 21: 'BARR', 22: 'TENT', 23: 'KENN',
        24: 'FIX',  25: 'BIO',  26: 'MISS', 27: 'SYRD', 28: 'SPEN', 29: 'MSLO',
        30: 'FCOM', 31: 'TSLA', 32: 'QUEE', 33: 'LAR1', 34: 'LAR2',
      };
      const houseBuilt = state.builtStructureTypesByHouse.get(state.triggerHouse);
      const buildType = BUILD_STRUCT_TYPES[event.data];
      if (buildType) return houseBuilt?.has(buildType) ?? false;
      return (houseBuilt?.size ?? 0) > 0; // fallback: any structure built by this house
    }
    case TEVENT_LEAVES_MAP:
      // C++ tevent.cpp:318-327 checks for an empty TeamClass whose Class
      // matches this event's TeamType and whose IsLeaveMap flag is set. It is
      // not a global "any unit left the map" counter.
      return event.team >= 0 && (state.leftMapTeamTypes?.has(event.team) ?? false);
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
      if (!state.crossedHorizontal) return false;
      return state.playerEnteredHouse === undefined || state.playerEnteredHouse === event.data;
    case TEVENT_CROSS_VERTICAL:
      // C++ parity (#21): fires when a unit whose owner matches Data.House crosses the X column of
      // the trigger's cell. C++ foot.cpp:1434-1442 scans all cells in the column; tevent.cpp:290-293
      // checks object->Owner() == Data.House.
      if (!state.crossedVertical) return false;
      return state.playerEnteredHouse === undefined || state.playerEnteredHouse === event.data;
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
      // C++ tevent.cpp:401-403 mirrors the units case with BuildingsLost for
      // the trigger's own house.
      return (state.buildingsLostByHouse.get(state.triggerHouse) ?? 0) >= event.data;
    case TEVENT_NOFACTORIES:
      // C++ tevent.cpp:340-341 checks the trigger house's BScan for
      // CONST/TENT/BARRACKS/WEAP/AIRSTRIP. It does not check PlayerPtr.
      {
        const FACTORY_TYPES = new Set(['FACT', 'TENT', 'BARR', 'WEAP', 'AFLD']);
        const houseStructs = state.structureTypesByHouse.get(state.triggerHouse);
        if (!houseStructs) return true;
        for (const type of FACTORY_TYPES) {
          if (houseStructs.has(type)) return false;
        }
        return true;
      }
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
  /** C++ reinf.cpp:_Create_Group Team::Add order before transport Attach()
   * removes cargo from the visible spawned list. */
  teamCreationOrder?: Entity[];
  spawnedTeamIdx?: number;  // team type index for spawned entities (for Team creation)
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
  globalChanged?: number;         // C++ parity: global index changed; Set_Global_To reset side effects apply
  baseBuilding?: { house: number; enabled: boolean }; // C++ parity (#39): set IsBaseBuilding on/off for a house
  blockageDecrement?: boolean;    // C++ parity: trigger.cpp:175-178 — decrement Blockage counter (ALLOWWIN)
  createTeam?: {                  // C++ Create_Army — recruit existing idle units into team
    teamIdx: number;
    house: House;
    recruitPriority: number;
    members: { type: string; count: number }[];
    missions: { mission: number; data: number }[];
  };
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
  map?: GameMap,
  existingEntities?: Entity[],
  existingStructures?: readonly MapStructure[],
): TriggerActionResult {
  const result: TriggerActionResult = { spawned: [] };

  switch (action.action) {
    case TACTION_NONE:
      break;

    case TACTION_CREATE_TEAM: {
      // C++ taction.cpp:658 — Create_Army() RECRUITS existing idle units into the team.
      // Unlike TACTION_REINFORCEMENTS which always spawns new units, CREATE_TEAM
      // searches for idle units of the matching house and type already on the map.
      // Return createTeam info so the caller (Game) can recruit from its entity list.
      const createTeam = teamTypes[action.team];
      if (!createTeam) break;
      result.createTeam = {
        teamIdx: action.team,
        house: houseIdToHouse(createTeam.house),
        recruitPriority: createTeam.recruitPriority ?? 7,
        members: createTeam.members.map(m => ({ type: m.type, count: m.count })),
        missions: createTeam.missions.map(m => ({ mission: m.mission, data: m.data })),
      };
      break;
    }
    case TACTION_REINFORCEMENTS: {
      const team = teamTypes[action.team];
      if (!team) break;
      result.spawnedTeamIdx = action.team; // pass team type index for Team creation

      const teamHouse = houseIdToHouse(team.house);
      const wp = resolveTeamOriginCell(team.origin, teamHouse, waypoints, houseEdges, mapBounds);
      if (!wp) break;
      const world = cellToWorld(wp.cx, wp.cy);

      const house = teamHouse;
      // C++ Do_Reinforcements creates transport teams with an implicit leading
      // TMISSION_MOVE to the origin waypoint before their scripted UNLOAD. This
      // is visible in WASM for SCG01EA's `tanya` team: the INI lists only
      // `8:0`, while TeamTypeClass at runtime has `[3:Origin, 8:0]`.
      const hasUnloadMission = team.missions.some(m => m.mission === 8); // TMISSION_UNLOAD = 8
      const hasAnyTransportMember = team.members.some(m => {
        const type = toUnitType(m.type);
        if (!type) return false;
        return !!UNIT_STATS[type]?.passengers;
      });
      const hasTransportMember = team.members.some(m => {
        const type = toUnitType(m.type);
        if (!type) return false;
        const stats = UNIT_STATS[type];
        return !!stats?.passengers && (stats.isAircraft || stats.isVessel);
      });
      const missionList = (hasUnloadMission &&
          hasTransportMember &&
          team.origin >= 0 &&
          team.missions.length === 1 &&
          team.missions[0].mission === 8)
        ? [{ mission: 3, data: team.origin }, ...team.missions] // TMISSION_MOVE = 3
        : team.missions;
      const teamMissionScript = missionList.length > 0 ? missionList.map(m => ({
        mission: m.mission,
        data: m.data,
      })) : null;
      const teamCreationOrder: Entity[] = [];
      let transport: Entity | null = null;
      const cargo: Entity[] = [];
      const aircraftNeedingUnlimboFacing: Entity[] = [];
      // C++ reinf.cpp:428-439: facing derives from the RAW house source edge
      // (NOT the waypoint-inferred edge that Calculated_Cell uses for cell positioning).
      //   SourceType source = HouseClass::As_Pointer(teamtype->House)->Control.Edge;
      //   if (source == SOURCE_NONE) source = SOURCE_NORTH;
      //   FacingType eface = (FacingType)(source << 1);   // facing from raw source
      //   CELL cell = Map.Calculated_Cell(source, teamtype->Origin, -1, ...); // cell may use waypoint
      // SCG11EA: Greece house has no Edge= (defaults to NORTH) and origin waypoint is
      // near the south map edge. Calculated_Cell infers 'south' for the cell, but the
      // MCV's facing is NORTH (house default), so it can immediately drive toward its
      // TMISSION_MOVE target without rotating 180°. Prior TS code used the waypoint-
      // inferred edge for facing too, making the MCV face SOUTH — it spent ~25 ticks
      // rotating before the first movement, diverging from WASM within a few ticks.
      const spawnFacingEdge = normalizeHouseEdge(houseEdges?.get(teamHouse));
      const spawnFacing = edgeToFacing(spawnFacingEdge);
      // C++ reinf.cpp:251: Check if team has TMISSION_UNLOAD for IsALoaner flag
      // C++ parity (reinf.cpp:441): ground reinforcements spawn at the map edge
      // and walk in. The team's origin waypoint determines which edge to use.
      // Only aircraft spawn at the edge cell AND fly — ground units get MISSION_GUARD
      // and the team mission script moves them to the waypoint.
      // C++ reinf.cpp:441 — Calculated_Cell uses the first member's speed class.
      // Naval teams (first member is vessel) use MZONE_WATER for water-cell scanning.
      const firstMemberType = toUnitType(team.members[0]?.type ?? '');
      const firstMemberStats = firstMemberType ? UNIT_STATS[firstMemberType] : null;
      const isNavalTeam = firstMemberStats?.isVessel ?? false;
      // C++ reinf.cpp:441 — Calculated_Cell is computed for ALL team members
      // (aircraft + ground). Every object in the team spawns at the same edge cell.
      const groundEdgeCell = (houseEdges && mapBounds)
        ? calculateHouseEdgeSpawnCell(
            teamHouse, houseEdges, mapBounds, wp,
            undefined,
            map,
            isNavalTeam,
            (cx, cy) => !!existingEntities?.some(e =>
              e.alive && !e.inLimbo && e.cell.cx === cx && e.cell.cy === cy),
            existingStructures,
          )
        : null;
      let reinforcementNewCell = groundEdgeCell;

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

          // C++ reinf.cpp:441,471 — every object starts with the same
          // Calculated_Cell. If Unlimbo cannot mark that cell because an
          // already-existing ground vehicle occupies it, reinf.cpp:490-498
          // retries adjacent cells that are still outside the radar/map bounds.
          // Previous members of this same reinforcement team are not treated as
          // blockers here: off-radar Unlimbo leaves IsLocked=false and the
          // live SCG10EA C++ trace stacks all four opening 2TNKs at (23,98).
          if (groundEdgeCell) {
            // Ground units: spawn at edge cell (C++ reinf.cpp:471 Unlimbo at Calculated_Cell)
            const unlimbosIntoWorld =
              !stats.isAircraft &&
              !stats.isInfantry &&
              !stats.isVessel &&
              (!!stats.passengers || !hasAnyTransportMember);
            if (unlimbosIntoWorld && reinforcementNewCell) {
              const unlimboCell = findGroundReinforcementUnlimboCell(
                reinforcementNewCell,
                existingEntities,
                mapBounds,
              );
              if (!unlimboCell) continue;
              reinforcementNewCell = unlimboCell;
            }
            const edgeCell = reinforcementNewCell ?? groundEdgeCell;
            const edgeWorld = cellToWorld(edgeCell.cx, edgeCell.cy);
            spawnX = edgeWorld.x;
            spawnY = edgeWorld.y;
          }
          const entity = new Entity(unitType, house, spawnX, spawnY);
          // C++ reinf.cpp:465-468: ground units face outward (source<<1),
          // aircraft get Random_Pick(DIR_N, DIR_MAX) — random facing.
          if (stats.isAircraft) {
            // C++ consumes the random aircraft facing in Unlimbo(), after the
            // non-transport reinforcement linked list has been reversed.
            aircraftNeedingUnlimboFacing.push(entity);
          } else {
            entity.facing = spawnFacing as Dir;
            entity.desiredFacing = spawnFacing as Dir;
            entity.bodyFacing256 = (spawnFacing * 32) & 0xff;
            entity.bodyFacing32 = dir256ToFacing32(entity.bodyFacing256);
          }
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
          // Aircraft-specific: start airborne.
          if (stats.isAircraft) {
            entity.flightAltitude = Entity.FLIGHT_ALTITUDE;
            entity.aircraftHeightLeptons = Entity.FLIGHT_LEVEL_LEPTONS;
            entity.animState = AnimState.WALK;
            // C++ reinf.cpp:479-481 assigns MISSION_GUARD only to non-aircraft.
            // Aircraft keep MissionClass constructor state (MISSION_NONE) after
            // AircraftClass::Unlimbo; TeamClass coordinates any later MOVE/ATTACK.
            entity.aircraftState = 'flying';
            entity.mission = Mission.NONE;
            entity.moveTarget = null;
          } else {
            // C++ reinf.cpp:480 — ground units get MISSION_GUARD on spawn.
            // Team script (updateTeamMission) will assign TMISSION_MOVE on the next tick.
            entity.mission = Mission.GUARD;
            if (stats.isInfantry) {
              // C++ reinf.cpp:470-481 wraps Unlimbo in ScenarioInit++, so
              // InfantryClass::Unlimbo ignores occupancy while snapping the
              // Calculated_Cell coord to its nearest infantry subcell.
              entity.scenarioInitUnlimbo = true;
            }
          }
          // C++ reinf.cpp:251: IsALoaner on aircraft/vessel transports with UNLOAD mission
          // Transport doesn't count toward unit limits, auto-retreats after unloading
          if (entity.isTransport && hasUnloadMission &&
              (stats.isAircraft || stats.isVessel)) {
            entity.isALoaner = true;
          }
          // C++ aircraft.cpp:293: BADR (and other fixed-wing transports) are
          // ALWAYS IsALoaner — they fly off the map after delivering their cargo,
          // even on team missions like ATT_WAYPT (which doesn't have hasUnloadMission).
          // Without this, SCG04EA's para1/para2 BADRs stay in the team after dropping
          // and the team coordinator forces them back to ATTACK mode → killing the
          // player MCV with 180 HE damage per ParaBomb shot.
          if (stats.isAircraft && stats.isFixedWing && entity.isTransport) {
            entity.isALoaner = true;
          }
          // Track transports and cargo for auto-loading (C++ reinf.cpp:217-254)
          // LSTs carry ALL unit types (infantry, tanks, MCVs), not just infantry.
          if (entity.isTransport && !transport) {
            transport = entity;
          } else if (!stats.isAircraft && !entity.isTransport) {
            // Additional transports beyond the first are NOT cargo — C++ reinf.cpp
            // only loads non-transport ground units as passengers.
            //
            // _Create_Group prepends each normal object into a linked list
            // (`temp->Next = object; object = temp`), and CargoClass::Attach
            // stores that list head-first. Detach_Object/Paradrop_Cargo detach
            // CargoHold, so TS passenger index 0 is the next C++ cargo object.
            cargo.unshift(entity);
          }
          teamCreationOrder.push(entity);
          result.spawned.push(entity);
        }
      }
      result.teamCreationOrder = teamCreationOrder;
      // C++ reinf.cpp:_Create_Group builds the non-transport object list by
      // prepending each newly-created member (`temp->Next = object; object = temp`).
      // Do_Reinforcements then Unlimbo()s that linked list head-first, so runtime
      // Logic insertion order for a non-transport team is the reverse of the INI
      // creation order. Team creation order remains INI order because Team::Add()
      // was called before the linked list reversal and itself prepends members.
      if (!transport) {
        result.spawned.reverse();
      }
      const assignAircraftUnlimboFacing = (entity: Entity): void => {
        // C++ reinf.cpp:466-468: desiredfacing = (DirType)Random_Pick(DIR_N, DIR_MAX)
        // DIR_N=0, DIR_MAX=255 — full 256-step DirType range for precise curved flight paths.
        const randomFacing256 = ScenarioRandom.nextInRange(0, 255);
        entity.facing256 = randomFacing256;
        entity.desiredFacing256 = randomFacing256;
        entity.bodyFacing256 = randomFacing256;
        // Derive 8-dir facing for rendering/game-logic compatibility.
        entity.facing = dir256ToFacing8(randomFacing256);
        entity.desiredFacing = entity.facing;
        // C++ AircraftClass::Unlimbo sets SecondaryFacing to the unlimbo
        // direction; fixed-wing Rotation_AI keeps it copied from PrimaryFacing.
        entity.turretFacing256 = randomFacing256;
        entity.desiredTurretFacing256 = randomFacing256;
        entity.turretFacing = entity.facing;
        entity.desiredTurretFacing = entity.facing;
        entity.bodyFacing32 = dir256ToFacing32(randomFacing256);
        entity.turretFacing32 = dir256ToFacing32(randomFacing256);
        entity.prevTurretFacing32 = entity.turretFacing32;
      };
      const aircraftUnlimboOrder = transport
        ? aircraftNeedingUnlimboFacing
        : result.spawned.filter(e => e.stats.isAircraft);
      for (const entity of aircraftUnlimboOrder) {
        assignAircraftUnlimboFacing(entity);
      }
      // C++ team.cpp:627-652: Team activation gesture RNG (Percent_Chance(50)) is now
      // consumed by the Team instance in team.ts when it activates (forcedActive=true).
      // No manual RNG call needed here.

      // Auto-load cargo into transport when team has both (C++ reinf.cpp:217-254)
      // In C++, ALL non-transport team members are loaded — infantry, tanks, MCVs, etc.
      if (transport && cargo.length > 0) {
        const maxLoad = transport.maxPassengers;
        for (let i = 0; i < Math.min(cargo.length, maxLoad); i++) {
          const unit = cargo[i];
          // C++ CargoClass::Attach(object-list) preserves the linked-list head
          // as CargoHold. The passenger array stores that head at index 0.
          transport.passengers.push(unit);
          unit.transportRef = transport;
          if (transport.stats.isAircraft) {
            transport.aircraftPassengerCarrier = true;
            if (transport.stats.isFixedWing) {
              // C++ AircraftClass::Unlimbo: if cargo is attached, Ammo=0 and
              // Passenger=true. BADR uses the Passenger Can_Fire path for
              // paradrop/REGROUP instead of ordinary bombing ammo.
              transport.ammo = 0;
            }
          }
          // Remove loaded unit from spawned list — it lives in transport.passengers
          // and will be re-added to the entity list when unloaded (TMISSION_UNLOAD)
          const idx = result.spawned.indexOf(unit);
          if (idx >= 0) result.spawned.splice(idx, 1);
        }
        // Phase 3a finding: WASM instrumentation at vessel.cpp:592/659 for
        // SCG07EA Frame 0-7 shows ALL vessels (including loaded cargo LSTs)
        // have Is_Door_Closed()==true from Frame 0 with DoorShutCountDown=0.
        // The prior 25-tick delay here was speculative / from a misread of
        // reinf.cpp. Cargo LSTs in C++ spawn with door CLOSED; door only
        // opens during MISSION_UNLOAD at the delivery point.
        //
        // See docs/parity/dossiers/vessel-double-commence.md for the trace.
      }
      break;
    }

    case TACTION_SET_GLOBAL:
      // C++ scenario.cpp:265 — bounds check: (unsigned)global < ARRAY_SIZE(Scen.GlobalFlags)
      // C++ scenario.cpp:268 — only cascade when previous != value
      if (action.data >= 0 && action.data <= 29 && !globals.has(action.data)) {
        globals.add(action.data);
        result.globalChanged = action.data;
      }
      break;

    case TACTION_CLEAR_GLOBAL:
      // C++ scenario.cpp:265 — bounds check: (unsigned)global < ARRAY_SIZE(Scen.GlobalFlags)
      // C++ scenario.cpp:268 — only cascade when previous != value
      if (action.data >= 0 && action.data <= 29 && globals.has(action.data)) {
        globals.delete(action.data);
        result.globalChanged = action.data;
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
