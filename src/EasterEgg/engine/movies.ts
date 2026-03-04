/**
 * FMV movie mapping for Red Alert campaign missions.
 * Videos are lazy-loaded from Internet Archive (original RA cutscenes).
 *
 * Playback order matches original SCENARIO.CPP:
 *   Pre-mission:  Intro → Brief → [objectives screen] → Action → gameplay
 *   Post-mission: Win (victory) OR Lose (defeat)
 *   Campaign end: Win + ALLYEND/SOVFINAL (when EndOfGame=yes)
 */

export const MOVIE_BASE_URL = 'https://archive.org/download/Red_Alert-Cutscenes/';

export interface MissionMovies {
  intro?: string;   // intro FMV before briefing (e.g. BRDGTILT)
  brief?: string;   // pre-mission briefing FMV
  action?: string;  // action clip before gameplay
  win?: string;     // victory FMV
  lose?: string;    // defeat FMV
}

/**
 * Complete mapping for all 56 campaign scenarios (Allied, Soviet, Ant, Counterstrike).
 * Keys are uppercase scenario IDs. EB variants share movies with EA.
 * Derived from original INI files and SCENARIO.CPP source.
 */
const MISSION_MOVIES: Record<string, MissionMovies> = {
  // === Allied Campaign ===
  'SCG01EA': { brief: 'ally1',   action: 'landing',  win: 'snowbomb', lose: 'bmap' },
  'SCG02EA': { brief: 'ally2',   action: 'mcv',      win: 'montpass', lose: 'frozen' },
  'SCG03EA': { intro: 'brdgtilt',                     win: 'toofar',   lose: 'sovtstar' },
  'SCG03EB': { intro: 'brdgtilt',                     win: 'toofar',   lose: 'sovtstar' },
  'SCG04EA': { brief: 'ally4',   action: 'binoc',    win: 'oildrum',  lose: 'bmap' },
  'SCG05EA': { brief: 'ally5',   action: 'tanya1',   win: 'tanya2',   lose: 'grvestne' },
  'SCG05EB': { brief: 'ally5',   action: 'tanya1',   win: 'tanya2',   lose: 'grvestne' },
  'SCG06EA': { brief: 'ally6',   action: 'mcv',      win: 'allymorf', lose: 'overrun' },
  'SCG06EB': { brief: 'ally6',   action: 'mcv',      win: 'allymorf', lose: 'overrun' },
  'SCG07EA': { intro: 'shorbom1',                     win: 'shorbom2', lose: 'shipsink' },
  'SCG08EA': { brief: 'ally8',   action: 'aagun',    win: 'crontest', lose: 'cronfail' },
  'SCG08EB': { brief: 'ally8',   action: 'aagun',    win: 'crontest', lose: 'cronfail' },
  'SCG09EA': { brief: 'ally9',   action: 'spy',      win: 'apcescpe', lose: 'sovtstar' },
  'SCG09EB': { brief: 'ally9',   action: 'spy',      win: 'apcescpe', lose: 'sovtstar' },
  'SCG10EA': { brief: 'ally10',  action: 'mcv_land',                   lose: 'trinity' },
  'SCG10EB': { intro: 'elevator',                     win: 'dud',      lose: 'trinity' },
  'SCG11EA': { brief: 'ally11',  action: 'destroyr', win: 'shorbomb', lose: 'shipsink' },
  'SCG11EB': { brief: 'ally11',  action: 'destroyr', win: 'shorbomb', lose: 'shipsink' },
  'SCG12EA': { brief: 'ally12',  action: 'assess',   win: 'aftrmath', lose: 'frozen' },
  'SCG13EA': { intro: 'spy',                          win: 'apcescpe', lose: 'bmap' },
  'SCG14EA': { brief: 'ally14',  action: 'masasslt',                   lose: 'battle' },
  // SCG14EA win is handled by campaign ending (ALLYEND)

  // === Soviet Campaign ===
  'SCU01EA': { brief: 'soviet1',  action: 'flare',     win: 'snstrafe', lose: 'sfrozen' },
  'SCU02EA': { brief: 'soviet2',  action: 'spotter',   win: 'sovtstar', lose: 'sovcemet' },
  'SCU02EB': { brief: 'soviet2',  action: 'spotter',   win: 'sovtstar', lose: 'sovcemet' },
  'SCU03EA': { brief: 'soviet3',  action: 'search',    win: 'execute',  lose: 'take_off' },
  'SCU04EA': { brief: 'soviet4',  action: 'sovmcv',    win: 'radrraid', lose: 'allymorf' },
  'SCU04EB': { brief: 'soviet4',  action: 'sovmcv',    win: 'radrraid', lose: 'allymorf' },
  'SCU05EA': { brief: 'soviet5',  action: 'double',    win: 'strafe',   lose: 'sovbatl' },
  'SCU06EA': { brief: 'soviet6',  action: 'onthprwl',  win: 'sitduck',  lose: 'dpthchrg' },
  'SCU06EB': { brief: 'soviet6',  action: 'onthprwl',  win: 'sitduck',  lose: 'dpthchrg' },
  'SCU07EA': { brief: 'soviet7',  action: 'countdwn',  win: 'averted',  lose: 'nukestok' },
  'SCU08EA': { brief: 'soviet8',  action: 'slntsrvc',  win: 'bombrun',  lose: 'allymorf' },
  'SCU08EB': { brief: 'soviet8',  action: 'slntsrvc',  win: 'bombrun',  lose: 'allymorf' },
  'SCU09EA': { brief: 'soviet9',  action: 'movingin',  win: 'v2rocket', lose: 'sfrozen' },
  'SCU10EA': { brief: 'soviet10', action: 'airfield',  win: 'mig',      lose: 'aagun' },
  'SCU11EA': { brief: 'soviet11', action: 'periscop',  win: 'sitduck',  lose: 'dpthchrg' },
  'SCU11EB': { brief: 'soviet11', action: 'periscop',  win: 'sitduck',  lose: 'dpthchrg' },
  'SCU12EA': { brief: 'soviet12', action: 'mcvbrdge',  win: 'tesla',    lose: 'sovbatl' },
  'SCU13EA': { brief: 'soviet13', action: 'mtnkfact',  win: 'sovtstar', lose: 'allymorf' },
  'SCU13EB': { brief: 'soviet13', action: 'mtnkfact',  win: 'sovtstar', lose: 'allymorf' },
  'SCU14EA': { intro: 'cronfail', brief: 'soviet14', action: 'beachead',                  lose: 'sovcemet' },
  // SCU14EA win is handled by campaign ending (SOVFINAL)

  // === Ant Missions ===
  'SCA01EA': { intro: 'antintro' },
  'SCA02EA': {},
  'SCA03EA': {},
  'SCA04EA': { win: 'antend' },

  // === Counterstrike (win/lose only, no pre-mission FMV) ===
  'SCG20EA': { win: 'allymorf', lose: 'v2rocket' },
  'SCG21EA': { win: 'spy',      lose: 'execute' },
  'SCG22EA': { win: 'apcescpe', lose: 'tesla' },
  'SCG23EA': { win: 'toofar',   lose: 'bmap' },
  'SCG24EA': { win: 'allymorf', lose: 'snstrafe' },
  'SCG26EA': { win: 'sovbatl',  lose: 'overrun' },
  'SCG27EA': { win: 'aftrmath', lose: 'trinity' },
  'SCG28EA': { win: 'masasslt', lose: 'frozen' },
  'SCU31EA': { win: 'sovtstar', lose: 'allymorf' },
  'SCU32EA': { win: 'bmap',     lose: 'spy' },
  'SCU33EA': { win: 'execute',  lose: 'apcescpe' },
  'SCU34EA': { win: 'sovtstar', lose: 'allymorf' },
  'SCU35EA': { win: 'grvestne', lose: 'sovcemet' },
  'SCU36EA': { win: 'sovtstar', lose: 'sovbatl' },
  'SCU37EA': { win: 'bmap',     lose: 'cronfail' },
  'SCU38EA': { win: 'sovtstar', lose: 'sovcemet' },
};

/** Campaign ending movies — played after final mission win */
export const CAMPAIGN_END_MOVIES: Record<string, string> = {
  allied: 'allyend',
  soviet: 'sovfinal',
};

/** Get the full archive.org URL for a movie name */
export function getMovieUrl(movieName: string): string {
  return `${MOVIE_BASE_URL}${movieName}_512kb.mp4`;
}

/** Look up FMV movie data for a scenario ID (case-insensitive) */
export function getMissionMovies(scenarioId: string): MissionMovies | undefined {
  return MISSION_MOVIES[scenarioId.toUpperCase()];
}

/** Check if a scenario has any FMV videos (intro, brief, action, win, or lose) */
export function hasFMV(scenarioId: string): boolean {
  const movies = MISSION_MOVIES[scenarioId.toUpperCase()];
  if (!movies) return false;
  return !!(movies.intro || movies.brief || movies.action || movies.win || movies.lose);
}
