/**
 * Scenario loader — parses extracted INI files and sets up the game state.
 * Reads unit placements, waypoints, team types, and triggers from SCA01-04EA.INI.
 */

import {
  type CellPos, type UnitStats, type WeaponStats, type WarheadType, type ArmorType,
  CELL_SIZE, cellIndexToPos, cellToWorld, worldToCell,
  House, Mission, UnitType, GAME_TICKS_PER_SEC,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR,
} from './types';
import { Entity } from './entity';
import { GameMap, Terrain } from './map';

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
const TEVENT_GLOBAL_SET = 27;
const TEVENT_GLOBAL_CLEAR = 28;
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
// 5 = DESTROY_TEAM (unused)
const TACTION_ALL_HUNT = 6;
const TACTION_REINFORCEMENTS = 7;
const TACTION_DZ = 8;
const TACTION_FIRE_SALE = 9;              // TR4: sell all buildings (C++ TACTION_FIRE_SALE)
const TACTION_PLAY_MOVIE = 10;            // TR4: play a movie/cutscene (C++ TACTION_PLAY_MOVIE)
const TACTION_TEXT_TRIGGER = 11;
const TACTION_DESTROY_TRIGGER = 12;
const TACTION_AUTOCREATE = 13;
// 14 = WINLOSE (unused)
const TACTION_ALLOWWIN = 15;
const TACTION_REVEAL_MAP = 16;            // C++ TACTION_REVEAL_ALL
const TACTION_REVEAL_SOME = 17;
const TACTION_REVEAL_ZONE = 18;           // TR4: reveal all of specified zone (C++ TACTION_REVEAL_ZONE)
const TACTION_PLAY_SOUND = 19;
const TACTION_PLAY_MUSIC = 20;            // TR4: play music track (C++ TACTION_PLAY_MUSIC)
const TACTION_PLAY_SPEECH = 21;
const TACTION_FORCE_TRIGGER = 22;
// 23 = START_TIMER (unused)
// 24 = STOP_TIMER (unused)
const TACTION_TIMER_EXTEND = 25;          // C++ TACTION_ADD_TIMER
// 26 = SUB_TIMER (unused)
const TACTION_SET_TIMER = 27;
const TACTION_SET_GLOBAL = 28;
const TACTION_CLEAR_GLOBAL = 29;
// 30 = BASE_BUILDING (unused)
const TACTION_CREEP_SHADOW = 31;
const TACTION_DESTROY_OBJECT = 32;
// 33 = 1_SPECIAL (unused)
// 34 = FULL_SPECIAL (unused)
const TACTION_PREFERRED_TARGET = 35;      // TR4: designate preferred target for AI house
const TACTION_LAUNCH_NUKES = 36;          // C++ TACTION_LAUNCH_NUKES — launch fake nukes from all silos

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
// 10 = HOUND_DOG (unused)
const TMISSION_DO = 11;          // Assign mission to members (C++ Coordinate_Do)
const TMISSION_SET_GLOBAL = 12;  // Set a global variable (C++ TMission_Set_Global)
const TMISSION_IDLE = 13;        // Idle (wait at current position)
const TMISSION_LOAD = 14;        // Load infantry into transport
// 15 = SPY (unused)
const TMISSION_PATROL = 16;      // Patrol to waypoint (move + attack en route)

// Time unit: Data.Value is in 1/10th minute increments (6 seconds each)
// Convert to game ticks: value * 6 * GAME_TICKS_PER_SEC
export const TIME_UNIT_TICKS = 6 * GAME_TICKS_PER_SEC; // 90 ticks per time unit

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
  origin: number;       // starting waypoint
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
  eventControl: number;  // 0=only, 1=and, 2=or
  actionControl: number; // 0=only, 1=and
  event1: TriggerEvent;
  event2: TriggerEvent;
  action1: TriggerAction;
  action2: TriggerAction;
  fired: boolean;         // has this trigger fired?
  timerTick: number;      // game tick when timer started (for TIME events)
  playerEntered: boolean; // has a player unit entered a cell with this trigger?
  forceFirePending: boolean; // set by FORCE_TRIGGER — fires on next check regardless of events
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
    briefing: 'The source of the ant\'s activity has been pinpointed in this area. We suspect that their nests are in this area -- they must be destroyed.\n\nA team of civilian specialists are en-route to your location. Use them to gas all the ant nests in the area. In addition, destroy all ants that you encounter.\n\nBe careful -- these things can chew through anything. Good luck.',
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
      const origin = parseInt(parts[5]);
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

      teamTypes.push({ name, house, flags, origin, members, missions });
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
        forceFirePending: false,
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
    baseStructures,
    smudges,
    theatre,
    rawSections: sections,
    playerHouse,
    houseAllies,
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
    case 'special': return House.Neutral;
    case 'neutral': return House.Neutral;
    default: return House.Neutral;
  }
}

/** Map INI unit type name to UnitType enum */
function toUnitType(name: string): UnitType | null {
  // Derive from UNIT_STATS — any unit with stats defined can be spawned from INI
  return UNIT_STATS[name]?.type ?? null;
}

/** Map house ID number to House enum (from RA house numbering) */
function houseIdToHouse(id: number): House {
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
    case 11: return House.Neutral; // Special
    default: return House.Neutral;
  }
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
  alive: boolean;     // whether structure is still standing
  rubble: boolean;    // destroyed structure leaves rubble
  weapon?: StructureWeapon;  // defensive weapon (for HBOX, GUN, TSLA, SAM, AGUN)
  attackCooldown: number;    // ticks until next shot
  ammo: number;              // remaining shots (-1 = unlimited)
  maxAmmo: number;           // max ammo for reload (C++ building.cpp:882-883)
  dockedAircraft?: number;   // entity ID of docked aircraft (-1 or undefined = empty)
  triggerName?: string;      // attached trigger name (from INI)
  buildProgress?: number;    // 0-1 construction animation progress (undefined = built)
  sellProgress?: number;     // 0-1 sell animation progress (undefined = not selling)
  sellHpAtStart?: number;    // HP when sell was initiated (for health-scaled refund)
  turretDir?: number;        // 0-7 facing for turreted structures (GUN/SAM)
  desiredTurretDir?: number; // target turret facing (rotates toward this)
  firingFlash?: number;      // ticks remaining for muzzle flash frame
}

/** Weapon stats for defensive structures */
export const STRUCTURE_WEAPONS: Record<string, StructureWeapon> = {
  HBOX:  { damage: 40, range: 5, rof: 40, warhead: 'SA', projSpeed: 100 },              // Vulcan (Camo Pillbox)
  PBOX:  { damage: 40, range: 5, rof: 40, warhead: 'SA', projSpeed: 100 },              // Vulcan (Pillbox)
  GUN:   { damage: 40, range: 6, rof: 50, warhead: 'AP', splash: 0.5, projSpeed: 40 },  // TurretGun
  TSLA:  { damage: 100, range: 8.5, rof: 120, warhead: 'Super', splash: 1, projSpeed: 100 }, // TeslaZap
  SAM:   { damage: 50, range: 7.5, rof: 20, warhead: 'AP', projSpeed: 50, isAntiAir: true }, // Nike
  AGUN:  { damage: 25, range: 6, rof: 10, warhead: 'AP', projSpeed: 100, isAntiAir: true },  // ZSU-23
  FTUR:  { damage: 125, range: 4, rof: 50, warhead: 'Fire', projSpeed: 12 },            // FireballLauncher
  QUEE:  { damage: 60, range: 5, rof: 30, splash: 1, warhead: 'Super', projSpeed: 40 }, // Queen Ant (TeslaZap)
};

// Building type → sprite image name (only include buildings we have sprites for)
const STRUCTURE_IMAGES: Record<string, string> = {
  FACT: 'fact', POWR: 'powr', APWR: 'apwr', BARR: 'barr', TENT: 'tent',
  WEAP: 'weap', PROC: 'proc', SILO: 'silo', DOME: 'dome', FIX: 'fix',
  GUN: 'gun', SAM: 'sam', HBOX: 'hbox', TSLA: 'tsla', AGUN: 'agun',
  GAP: 'gap', PBOX: 'pbox', HPAD: 'hpad', AFLD: 'afld',
  ATEK: 'atek', STEK: 'stek', IRON: 'iron', PDOX: 'pdox', MSLO: 'mslo', KENN: 'kenn',
  FENC: 'fenc', BRIK: 'brik', SBAG: 'sbag', BARB: 'barb', WOOD: 'wood',
  QUEE: 'quee', LAR1: 'lar1', LAR2: 'lar2',
};

// Building footprint sizes in cells (w, h) — defaults to 1x1
export const STRUCTURE_SIZE: Record<string, [number, number]> = {
  FACT: [3, 3], WEAP: [3, 2], POWR: [2, 2], BARR: [2, 2], TENT: [2, 2],
  PROC: [3, 2], FIX: [3, 2], SILO: [1, 1], DOME: [2, 2],
  GUN: [1, 1], SAM: [2, 1], HBOX: [1, 1], HPAD: [2, 2], AFLD: [2, 2],
  ATEK: [2, 2], STEK: [2, 2], PDOX: [2, 2], IRON: [2, 2], MSLO: [2, 2],
  QUEE: [2, 2], LAR1: [1, 1], LAR2: [1, 1],
  // Bridge structures (destroyable)
  BARL: [1, 1], BRL3: [1, 1],
  // Walls (1x1)
  SBAG: [1, 1], FENC: [1, 1], BARB: [1, 1], BRIK: [1, 1],
};

// Structure max HP overrides (default is 256)
export const STRUCTURE_MAX_HP: Record<string, number> = {
  POWR: 400, APWR: 700, PROC: 900, TENT: 800, BARR: 800,
  WEAP: 1000, AFLD: 1000, HPAD: 800, DOME: 1000,
  GUN: 400, SAM: 400, TSLA: 400, GAP: 1000,
  PBOX: 400, HBOX: 600, AGUN: 400, FTUR: 400, KENN: 400,
  ATEK: 400, STEK: 600, IRON: 400, PDOX: 400, MSLO: 400,
  FIX: 800, SILO: 300, FACT: 1000,
  SYRD: 1000, SPEN: 1000,
  QUEE: 800, LAR1: 25, LAR2: 50,
  BARL: 150, BRL3: 150,
};

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
  /** Crate type overrides from [General] — maps crate color to reward type */
  crateOverrides: { silver?: string; wood?: string; water?: string };
  /** AI base blueprint for rebuild system — structures from [Base] section */
  baseBlueprint: Array<{ type: string; cell: number; house: House }>;
  /** Player's house from scenario INI [Basic] Player= field */
  playerHouse: House;
  /** Per-house alliance data from scenario INI (used for campaign missions) */
  houseAllies: Map<House, House[]>;
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
  } else {
    // Default: Guard
    entity.mission = Mission.GUARD;
  }
}

/** Load a scenario and create entities + map setup */
export async function loadScenario(scenarioId: string): Promise<ScenarioResult> {
  const url = `/ra/assets/${scenarioId}.ini`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load scenario: ${url}`);
  const text = await res.text();
  const data = parseScenarioINI(text);

  // Set up map
  const map = new GameMap();
  map.setBounds(data.mapBounds.x, data.mapBounds.y, data.mapBounds.w, data.mapBounds.h);
  map.initDefault();

  // Decode MapPack for terrain data
  if (data.mapPack) {
    decodeMapPack(data.mapPack, map, data.theatre);
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
      // T01-T17 = single trees, TC01-TC05 = tree clumps
      map.setTerrain(pos.cx, pos.cy, Terrain.TREE);
      map.setTreeType(pos.cx, pos.cy, type);
      // Tree clumps occupy multiple cells (from C++ tdata.cpp occupancy data)
      if (type.startsWith('tc')) {
        const CLUMP_OCCUPANCY: Record<string, [number, number][]> = {
          'tc01': [[1, 0], [0, 1], [1, 1]],
          'tc02': [[1, 0], [0, 1], [1, 1]],
          'tc03': [[1, 0], [0, 1], [1, 1]],
          'tc04': [[0, 1], [1, 1]],
          'tc05': [[0, 1], [1, 0], [1, 1]],
        };
        const extra = CLUMP_OCCUPANCY[type];
        if (extra) {
          for (const [dx, dy] of extra) {
            map.setTerrain(pos.cx + dx, pos.cy + dy, Terrain.TREE);
            map.setTreeType(pos.cx + dx, pos.cy + dy, '_clump');
          }
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
    applyMission(entity, inf.mission);
    entities.push(entity);
  }

  // Create structures from INI and mark their cells as impassable
  const structures: MapStructure[] = [];
  for (const s of data.structures) {
    // Skip V-series Neutral village buildings (V01-V19) — no sprite assets
    if (s.type.startsWith('V') && s.house === 'Neutral') continue;
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
      hp: Math.floor((s.hp / 256) * maxHp),
      maxHp,
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
    // Store wall type for auto-connection sprite rendering
    if (s.type === 'SBAG' || s.type === 'FENC' || s.type === 'BARB' || s.type === 'BRIK') {
      map.setWallType(pos.cx, pos.cy, s.type);
    }
  }

  // Add base structures from [Base] section (pre-placed buildings)
  for (const bs of data.baseStructures) {
    const baseHouse = toHouse(bs.house);
    const pos = cellIndexToPos(bs.cell);
    const image = STRUCTURE_IMAGES[bs.type] ?? bs.type.toLowerCase();
    const maxHp = STRUCTURE_MAX_HP[bs.type] ?? 256;
    structures.push({
      type: bs.type,
      image,
      house: baseHouse,
      cx: pos.cx,
      cy: pos.cy,
      hp: maxHp,
      maxHp,
      alive: true,
      rubble: false,
      weapon: STRUCTURE_WEAPONS[bs.type],
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
    });
    const [fw, fh] = STRUCTURE_SIZE[bs.type] ?? [1, 1];
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        map.setTerrain(pos.cx + dx, pos.cy + dy, Terrain.WALL);
      }
    }
    // Store wall type for auto-connection sprite rendering
    if (bs.type === 'SBAG' || bs.type === 'FENC' || bs.type === 'BARB' || bs.type === 'BRIK') {
      map.setWallType(pos.cx, pos.cy, bs.type);
    }
  }

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

  // === Per-scenario stat overrides from INI [TypeName] sections ===
  // RA scenarios override unit/weapon/structure stats via INI sections matching the type name.
  // Build scenario-local copies of UNIT_STATS and WEAPON_STATS with overrides applied.

  const scenarioUnitStats: Record<string, UnitStats> = { ...UNIT_STATS };
  const scenarioWeaponStats: Record<string, WeaponStats> = { ...WEAPON_STATS };
  const warheadOverrides: Record<string, [number, number, number, number, number]> = {};

  // Apply unit stat overrides from INI sections
  for (const typeName of Object.keys(UNIT_STATS)) {
    const section = data.rawSections.get(typeName);
    if (!section) continue;
    const base: UnitStats = { ...UNIT_STATS[typeName] };
    if (section.has('Strength')) base.strength = parseInt(section.get('Strength')!);
    if (section.has('Speed')) base.speed = parseInt(section.get('Speed')!);
    if (section.has('Sight')) base.sight = parseInt(section.get('Sight')!);
    if (section.has('ROT')) base.rot = parseInt(section.get('ROT')!);
    if (section.has('Primary')) base.primaryWeapon = section.get('Primary')!;
    if (section.has('Secondary')) base.secondaryWeapon = section.get('Secondary')!;
    if (section.has('NoMovingFire')) base.noMovingFire = section.get('NoMovingFire')!.toLowerCase() === 'yes';
    if (section.has('Passengers')) base.passengers = parseInt(section.get('Passengers')!);
    if (section.has('GuardRange')) base.guardRange = parseInt(section.get('GuardRange')!);
    if (section.has('Armor')) {
      const a = section.get('Armor')!.toLowerCase();
      if (a === 'none' || a === 'wood' || a === 'light' || a === 'heavy' || a === 'concrete') base.armor = a as ArmorType;
    }
    scenarioUnitStats[typeName] = base;
  }

  // Apply weapon stat overrides from INI sections (and detect new weapons)
  const weaponNames = new Set(Object.keys(WEAPON_STATS));
  // Also check for weapons referenced by unit overrides that might be new (e.g. Napalm)
  for (const stats of Object.values(scenarioUnitStats)) {
    if (stats.primaryWeapon) weaponNames.add(stats.primaryWeapon);
  }
  for (const weaponName of weaponNames) {
    const section = data.rawSections.get(weaponName);
    if (!section) continue;
    const base: WeaponStats = { ...(WEAPON_STATS[weaponName] ?? { name: weaponName, damage: 0, rof: 20, range: 1, warhead: 'HE' as const }) };
    if (section.has('Damage')) base.damage = parseInt(section.get('Damage')!);
    if (section.has('ROF')) base.rof = parseInt(section.get('ROF')!);
    if (section.has('Range')) base.range = parseFloat(section.get('Range')!);
    if (section.has('Warhead')) base.warhead = section.get('Warhead')! as WarheadType;
    scenarioWeaponStats[weaponName] = base;
  }

  // Apply warhead Verses overrides (e.g. [Fire] Verses=90%,100%,150%,150%,50%)
  // RA 5 armor classes: none(0), wood(1), light(2), heavy(3), concrete(4)
  for (const whName of Object.keys(WARHEAD_VS_ARMOR)) {
    const section = data.rawSections.get(whName);
    if (!section?.has('Verses')) continue;
    const parts = section.get('Verses')!.split(',').map(s => parseInt(s) / 100);
    if (parts.length >= 5) {
      warheadOverrides[whName] = [parts[0], parts[1], parts[2], parts[3], parts[4]];
    } else if (parts.length >= 4) {
      // Legacy 4-element: none, wood, light, heavy → expand to 5
      warheadOverrides[whName] = [parts[0], parts[1], parts[2], parts[3], parts[3]];
    }
  }

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
    warheadOverrides,
    crateOverrides,
    baseBlueprint: data.baseStructures.map(bs => ({ type: bs.type, cell: bs.cell, house: toHouse(bs.house) })),
    playerHouse: toHouse(data.playerHouse ?? 'Spain'),
    houseAllies: new Map(
      Array.from(data.houseAllies.entries()).map(([k, v]) => [toHouse(k), v.map(toHouse)])
    ),
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

function decompressRASections(bytes: Uint8Array, start: number, dest: Uint8Array, destSize: number): number {
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
function decodeMapPack(base64Data: string, map: GameMap, theatre: string): void {
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
      // TEMPERATE and SNOW share the same template ID ranges
      classifyOutdoorTerrain(map, templateType, templateIcon);
    }
  } catch {
    // MapPack decode failed — terrain stays at default
  }
}

/** Classify TEMPERATE/SNOW terrain from MapPack template types.
 *  Both theatres share identical template ID ranges. */
function classifyOutdoorTerrain(
  map: GameMap,
  templateType: Uint16Array,
  templateIcon: Uint8Array,
): void {
  // TEMPERATE/SNOW template type IDs (from RA TEMPERAT.INI / OpenRA temperat.yaml):
  //   0, 0xFFFF: Clear/grass (default)
  //   1-2: Pure water body tiles
  //   3-56: Shore/beach transitions (mixed water+land — use icon to distinguish)
  //   57-58, 97-110: Rock debris/formations
  //   59-96: Water cliff edges
  //   112-130: River segments and bridges
  //   131-172: Land cliffs and rock formations
  //   173-228: Road network tiles (passable)
  //   229-234: River crossings
  //   235-252: Bridge structures (passable)
  //   --- Extended templates (>255, only reachable with uint16 decoding) ---
  //   378-383: Bridge variants (passable)
  //   400: Hill (impassable)
  //   401-404: Land cliff edges (impassable)
  //   405-408: Water cliff edges (water)
  //   500-508: Shore debris (impassable)
  //   519-534: Small bridges (passable)
  //   550-557: Sea cliff corners (impassable/water)
  //   580-588: Decay debris (passable)
  //   590-591: Fjord crossings (passable)
  for (let cy = map.boundsY; cy < map.boundsY + map.boundsH; cy++) {
    for (let cx = map.boundsX; cx < map.boundsX + map.boundsW; cx++) {
      const idx = cy * 128 + cx;
      const tmpl = templateType[idx];

      if (tmpl === 0xFFFF || tmpl === 0x00) {
        // Clear (default)
      } else if (tmpl >= 1 && tmpl <= 2) {
        map.setTerrain(cx, cy, Terrain.WATER);
      } else if (tmpl >= 3 && tmpl <= 56) {
        // Shore/beach transitions — icon 0-3 are typically water portions
        const icon = templateIcon[idx];
        if (icon < 4) {
          map.setTerrain(cx, cy, Terrain.WATER);
        }
      } else if ((tmpl >= 59 && tmpl <= 96) || (tmpl >= 112 && tmpl <= 130) ||
                 (tmpl >= 229 && tmpl <= 234)) {
        map.setTerrain(cx, cy, Terrain.WATER);
      } else if ((tmpl >= 57 && tmpl <= 58) || (tmpl >= 97 && tmpl <= 110) ||
                 (tmpl >= 131 && tmpl <= 172)) {
        map.setTerrain(cx, cy, Terrain.ROCK);
      } else if (tmpl === 400 || (tmpl >= 401 && tmpl <= 404) ||
                 (tmpl >= 500 && tmpl <= 508)) {
        map.setTerrain(cx, cy, Terrain.ROCK);
      } else if ((tmpl >= 405 && tmpl <= 408) ||
                 (tmpl >= 550 && tmpl <= 557)) {
        map.setTerrain(cx, cy, Terrain.WATER);
      }
      // 173-228: roads, 235-252: bridges → stay as CLEAR (passable)
      // 378-383: bridge variants, 519-534: small bridges → CLEAR
      // 580-588: decay debris, 590-591: fjord crossings → CLEAR
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
  // Per-house alive status (for ALL_DESTROYED — RA house index → has alive units/structures)
  houseAlive: Map<number, boolean>;
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
}

export function checkTriggerEvent(
  event: TriggerEvent,
  state: TriggerGameState,
): boolean {
  switch (event.type) {
    case TEVENT_NONE:
      return false; // no event — only fires when forced by FORCE_TRIGGER
    case TEVENT_ANY:
      return true;
    case TEVENT_TIME: {
      const requiredTicks = event.data * TIME_UNIT_TICKS;
      return (state.gameTick - state.triggerStartTick) >= requiredTicks;
    }
    case TEVENT_GLOBAL_SET:
      return state.globals.has(event.data);
    case TEVENT_GLOBAL_CLEAR:
      return !state.globals.has(event.data);
    case TEVENT_PLAYER_ENTERED:
      return state.playerEntered;
    case TEVENT_ALL_DESTROYED: {
      // All units/structures of the specified house destroyed (event.data = RA house index)
      // RA source: HouseClass::As_Pointer(Event.Data.House)->Is_All_Destroyed()
      const houseIdx = event.data;
      return !(state.houseAlive.get(houseIdx) ?? false);
    }
    case TEVENT_NUNITS_DESTROYED:
      // N enemy units have been killed (event.data = threshold)
      return state.enemyKillCount >= event.data;
    case TEVENT_DESTROYED:
      // Specific object destroyed — fires when the attached structure/unit is destroyed
      return state.destroyedTriggerNames.has(state.triggerName);
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
    case TEVENT_ENTERS_ZONE:
      // Area discovered / zone entered — use playerEntered flag (set via cell triggers)
      return state.playerEntered;
    case TEVENT_ATTACKED:
      // Something was attacked — simplified: always true after first combat
      return state.enemyKillCount > 0;
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
      // Same as DISCOVERED — player has entered an area
      return state.playerEntered;
    case TEVENT_LOW_POWER:
      // Player is low on power
      return state.isLowPower;
    case TEVENT_THIEVED:
      // Spy has infiltrated a building — not implemented for ant missions
      return false;
    case TEVENT_CROSS_HORIZONTAL:
      // Player crossed a horizontal line — use playerEntered flag
      return state.playerEntered;
    case TEVENT_CROSS_VERTICAL:
      // Player crossed a vertical line — use playerEntered flag
      return state.playerEntered;
    case TEVENT_UNITS_DESTROYED:
      // All units of a house destroyed (event.data = RA house index)
      // C++ index 9: "all house's units destroyed" — uses houseAlive check
      return !(state.houseAlive.get(event.data) ?? false);
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
    case TEVENT_BUILD_UNIT:
      // Specified unit type has been built (event.data = UnitType index)
      return state.builtUnitTypes.size > 0;
    case TEVENT_BUILD_INFANTRY:
      // Specified infantry type has been built
      return state.builtInfantryTypes.size > 0;
    case TEVENT_BUILD_AIRCRAFT:
      // Specified aircraft type has been built
      return state.builtAircraftTypes.size > 0;
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
  allHunt?: boolean;
  revealAll?: boolean;
  revealWaypoint?: number;  // reveal area around a specific waypoint (REVEAL_SOME)
  dropZone?: number;        // drop zone flare at waypoint (DZ)
  creepShadow?: boolean;    // reshroud entire map (CREEP_SHADOW)
  textMessage?: number;  // text trigger ID to display
  setTimer?: number;     // mission timer value to set (in 1/10th minute units)
  timerExtend?: number;  // extend mission timer by this many 1/10th minute units
  autocreate?: boolean;  // enable autocreation of teams (AI base production)
  destroyTriggeringUnit?: boolean; // kill the unit that triggered this
  playSound?: number;    // play a sound effect (PLAY_SOUND)
  playSpeech?: number;   // play EVA speech (PLAY_SPEECH)
  airstrike?: boolean;   // call in an airstrike (legacy)
  nuke?: boolean;        // launch a nuclear missile (LAUNCH_NUKES)
  centerView?: number;   // center camera on waypoint (legacy)
  // TR4: new action results
  fireSale?: boolean;             // sell all buildings (FIRE_SALE)
  playMovie?: number;             // play a movie/cutscene (PLAY_MOVIE)
  revealZone?: number;            // reveal all of specified zone (REVEAL_ZONE)
  playMusic?: number;             // play music track (PLAY_MUSIC)
  preferredTarget?: number;       // set preferred target type for AI (PREFERRED_TARGET)
}

/** Execute a trigger action — returns result with entities and side effects */
export function executeTriggerAction(
  action: TriggerAction,
  teamTypes: TeamType[],
  waypoints: Map<number, CellPos>,
  globals: Set<number>,
  triggers: ScenarioTrigger[],
): TriggerActionResult {
  const result: TriggerActionResult = { spawned: [] };

  switch (action.action) {
    case TACTION_NONE:
      break;

    case TACTION_REINFORCEMENTS:
    case TACTION_CREATE_TEAM: {
      const team = teamTypes[action.team];
      if (!team) break;

      // Find spawn waypoint from team origin
      const wp = waypoints.get(team.origin);
      if (!wp) break;
      const world = cellToWorld(wp.cx, wp.cy);

      // Spawn team members using the actual house from TeamType data
      const house = houseIdToHouse(team.house);
      let transport: Entity | null = null;
      const infantry: Entity[] = [];
      for (const member of team.members) {
        for (let i = 0; i < member.count; i++) {
          const unitType = toUnitType(member.type);
          if (!unitType) continue;
          // Spread units slightly around waypoint
          const offsetX = (Math.random() - 0.5) * 48;
          const offsetY = (Math.random() - 0.5) * 48;
          const entity = new Entity(unitType, house, world.x + offsetX, world.y + offsetY);
          entity.facing = Math.floor(Math.random() * 8);
          entity.bodyFacing32 = entity.facing * 4;
          // Assign team mission script to each member
          if (team.missions.length > 0) {
            entity.teamMissions = team.missions.map(m => ({
              mission: m.mission,
              data: m.data,
            }));
            entity.teamMissionIndex = 0;
          }
          // IsSuicide teams (flags bit 1) fight to the death — use HUNT mission
          if (team.flags & 2) {
            entity.mission = Mission.HUNT;
          }
          // Track transports and infantry for auto-loading
          if (entity.isTransport && !transport) {
            transport = entity;
          } else if (entity.stats.isInfantry) {
            infantry.push(entity);
          }
          result.spawned.push(entity);
        }
      }
      // Auto-load infantry into transport when team has both
      if (transport && infantry.length > 0) {
        const maxLoad = transport.maxPassengers;
        for (let i = 0; i < Math.min(infantry.length, maxLoad); i++) {
          const inf = infantry[i];
          transport.passengers.push(inf);
          inf.transportRef = transport;
          // Remove loaded infantry from spawned list — they live in transport.passengers
          // and will be re-added to the entity list when unloaded (TMISSION_UNLOAD)
          const idx = result.spawned.indexOf(inf);
          if (idx >= 0) result.spawned.splice(idx, 1);
        }
      }
      break;
    }

    case TACTION_SET_GLOBAL:
      globals.add(action.data);
      break;

    case TACTION_CLEAR_GLOBAL:
      globals.delete(action.data);
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
      result.win = true;
      break;

    case TACTION_LOSE:
      result.lose = true;
      break;

    case TACTION_ALLOWWIN:
      result.allowWin = true;
      break;

    case TACTION_ALL_HUNT:
      result.allHunt = true;
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
      // AI production start — not needed for ant missions
      break;

    case TACTION_AUTOCREATE:
      // Enable autocreation of teams from AI base (queen spawning in ant missions)
      result.autocreate = true;
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
      // Sell all buildings and go on rampage
      result.fireSale = true;
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

    case TACTION_LAUNCH_NUKES:
      // Launch nuclear missiles from all silos
      result.nuke = true;
      break;
  }

  return result;
}
