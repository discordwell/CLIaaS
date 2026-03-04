/**
 * FMV movie mapping for Red Alert campaign missions.
 * Videos are lazy-loaded from Internet Archive (original RA cutscenes).
 */

export const MOVIE_BASE_URL = 'https://archive.org/download/Red_Alert-Cutscenes/';

export interface MissionMovies {
  brief?: string;   // pre-mission briefing FMV
  action?: string;  // action clip before gameplay
  win?: string;     // victory FMV (stretch goal)
  lose?: string;    // defeat FMV (stretch goal)
}

/**
 * Complete mapping for the 25 main campaign missions with FMV briefings.
 * Keys are uppercase scenario IDs. EB variants share movies with EA.
 * Derived from original INI Brief= and Action= fields.
 */
const MISSION_MOVIES: Record<string, MissionMovies> = {
  // === Allied Campaign ===
  'SCG01EA': { brief: 'ally1',   action: 'landing' },
  'SCG02EA': { brief: 'ally2',   action: 'mcv' },
  'SCG04EA': { brief: 'ally4',   action: 'binoc' },
  'SCG05EA': { brief: 'ally5',   action: 'tanya1' },
  'SCG05EB': { brief: 'ally5',   action: 'tanya1' },
  'SCG06EA': { brief: 'ally6',   action: 'mcv' },
  'SCG06EB': { brief: 'ally6',   action: 'mcv' },
  'SCG08EA': { brief: 'ally8',   action: 'aagun' },
  'SCG08EB': { brief: 'ally8',   action: 'aagun' },
  'SCG09EA': { brief: 'ally9',   action: 'spy' },
  'SCG09EB': { brief: 'ally9',   action: 'spy' },
  'SCG10EA': { brief: 'ally10',  action: 'mcv_land' },
  // SCG10EB has no Brief — no FMV
  'SCG11EA': { brief: 'ally11',  action: 'destroyr' },
  'SCG11EB': { brief: 'ally11',  action: 'destroyr' },
  'SCG12EA': { brief: 'ally12',  action: 'assess' },
  'SCG14EA': { brief: 'ally14',  action: 'masasslt' },

  // === Soviet Campaign ===
  'SCU01EA': { brief: 'soviet1',  action: 'flare' },
  'SCU02EA': { brief: 'soviet2',  action: 'spotter' },
  'SCU02EB': { brief: 'soviet2',  action: 'spotter' },
  'SCU03EA': { brief: 'soviet3',  action: 'search' },
  'SCU04EA': { brief: 'soviet4',  action: 'sovmcv' },
  'SCU04EB': { brief: 'soviet4',  action: 'sovmcv' },
  'SCU05EA': { brief: 'soviet5',  action: 'double' },
  'SCU06EA': { brief: 'soviet6',  action: 'onthprwl' },
  'SCU06EB': { brief: 'soviet6',  action: 'onthprwl' },
  'SCU07EA': { brief: 'soviet7',  action: 'countdwn' },
  'SCU08EA': { brief: 'soviet8',  action: 'slntsrvc' },
  'SCU08EB': { brief: 'soviet8',  action: 'slntsrvc' },
  'SCU09EA': { brief: 'soviet9',  action: 'movingin' },
  'SCU10EA': { brief: 'soviet10', action: 'airfield' },
  'SCU11EA': { brief: 'soviet11', action: 'periscop' },
  'SCU11EB': { brief: 'soviet11', action: 'periscop' },
  'SCU12EA': { brief: 'soviet12', action: 'mcvbrdge' },
  'SCU13EA': { brief: 'soviet13', action: 'mtnkfact' },
  'SCU13EB': { brief: 'soviet13', action: 'mtnkfact' },
  'SCU14EA': { brief: 'soviet14', action: 'beachead' },
};

/** Get the full archive.org URL for a movie name */
export function getMovieUrl(movieName: string): string {
  return `${MOVIE_BASE_URL}${movieName}_512kb.mp4`;
}

/** Look up FMV movie data for a scenario ID (case-insensitive) */
export function getMissionMovies(scenarioId: string): MissionMovies | undefined {
  return MISSION_MOVIES[scenarioId.toUpperCase()];
}

/** Check if a scenario has FMV briefing videos */
export function hasFMV(scenarioId: string): boolean {
  return scenarioId.toUpperCase() in MISSION_MOVIES;
}
