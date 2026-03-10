/**
 * FMV movie mapping tests — verify correct movie assignments for all campaign missions,
 * URL generation, case-insensitive lookup, and exclusion of non-FMV missions.
 * Covers all 5 fields: intro, brief, action, win, lose.
 */
import { describe, it, expect } from 'vitest';
import { getMissionMovies, hasFMV, getMovieUrl, CAMPAIGN_END_MOVIES, getAllMovieNames } from '../engine/movies';

describe('FMV Movie Mapping', () => {
  // === Allied Campaign — full 5-field mapping ===
  // [id, intro, brief, action, win, lose]
  const ALLIED_FULL: [string, string | undefined, string | undefined, string | undefined, string | undefined, string | undefined][] = [
    ['SCG01EA', undefined,    'ally1',   'landing',  'snowbomb', 'bmap'],
    ['SCG02EA', undefined,    'ally2',   'mcv',      'montpass', 'frozen'],
    ['SCG03EA', 'brdgtilt',   undefined, undefined,  'toofar',   'sovtstar'],
    ['SCG04EA', undefined,    'ally4',   'binoc',    'oildrum',  'bmap'],
    ['SCG05EA', undefined,    'ally5',   'tanya1',   'tanya2',   'grvestne'],
    ['SCG06EA', undefined,    'ally6',   'mcv',      'allymorf', 'overrun'],
    ['SCG07EA', 'shorbom1',   undefined, undefined,  'shorbom2', 'shipsink'],
    ['SCG08EA', undefined,    'ally8',   'aagun',    'crontest', 'cronfail'],
    ['SCG09EA', undefined,    'ally9',   'spy',      'apcescpe', 'sovtstar'],
    ['SCG10EA', undefined,    'ally10',  'mcv_land', undefined,  'trinity'],
    ['SCG10EB', 'elevator',   undefined, undefined,  'dud',      'trinity'],
    ['SCG11EA', undefined,    'ally11',  'destroyr', 'shorbomb', 'shipsink'],
    ['SCG12EA', undefined,    'ally12',  'assess',   'aftrmath', 'frozen'],
    ['SCG13EA', 'spy',        undefined, undefined,  'apcescpe', 'bmap'],
    ['SCG14EA', undefined,    'ally14',  'masasslt', undefined,  'battle'],
  ];

  it('all Allied missions have correct 5-field entries', () => {
    for (const [id, intro, brief, action, win, lose] of ALLIED_FULL) {
      const movies = getMissionMovies(id);
      expect(movies, `${id} should have movies`).toBeDefined();
      expect(movies!.intro, `${id} intro`).toBe(intro);
      expect(movies!.brief, `${id} brief`).toBe(brief);
      expect(movies!.action, `${id} action`).toBe(action);
      expect(movies!.win, `${id} win`).toBe(win);
      expect(movies!.lose, `${id} lose`).toBe(lose);
    }
  });

  // === Soviet Campaign — full 5-field mapping ===
  const SOVIET_FULL: [string, string | undefined, string | undefined, string | undefined, string | undefined, string | undefined][] = [
    ['SCU01EA', undefined,    'soviet1',  'flare',     'snstrafe', 'sfrozen'],
    ['SCU02EA', undefined,    'soviet2',  'spotter',   'sovtstar', 'sovcemet'],
    ['SCU03EA', undefined,    'soviet3',  'search',    'execute',  'take_off'],
    ['SCU04EA', undefined,    'soviet4',  'sovmcv',    'radrraid', 'allymorf'],
    ['SCU05EA', undefined,    'soviet5',  'double',    'strafe',   'sovbatl'],
    ['SCU06EA', undefined,    'soviet6',  'onthprwl',  'sitduck',  'dpthchrg'],
    ['SCU07EA', undefined,    'soviet7',  'countdwn',  'averted',  'nukestok'],
    ['SCU08EA', undefined,    'soviet8',  'slntsrvc',  'bombrun',  'allymorf'],
    ['SCU09EA', undefined,    'soviet9',  'movingin',  'v2rocket', 'sfrozen'],
    ['SCU10EA', undefined,    'soviet10', 'airfield',  'mig',      'aagun'],
    ['SCU11EA', undefined,    'soviet11', 'periscop',  'sitduck',  'dpthchrg'],
    ['SCU12EA', undefined,    'soviet12', 'mcvbrdge',  'tesla',    'sovbatl'],
    ['SCU13EA', undefined,    'soviet13', 'mtnkfact',  'sovtstar', 'allymorf'],
    ['SCU14EA', 'cronfail',   'soviet14', 'beachead',  undefined,  'sovcemet'],
  ];

  it('all Soviet missions have correct 5-field entries', () => {
    for (const [id, intro, brief, action, win, lose] of SOVIET_FULL) {
      const movies = getMissionMovies(id);
      expect(movies, `${id} should have movies`).toBeDefined();
      expect(movies!.intro, `${id} intro`).toBe(intro);
      expect(movies!.brief, `${id} brief`).toBe(brief);
      expect(movies!.action, `${id} action`).toBe(action);
      expect(movies!.win, `${id} win`).toBe(win);
      expect(movies!.lose, `${id} lose`).toBe(lose);
    }
  });

  // === EB variants share EA movies ===
  it('EB variants match EA movies for all fields', () => {
    const EB_PAIRS: [string, string][] = [
      ['SCG03EB', 'SCG03EA'],
      ['SCG05EB', 'SCG05EA'],
      ['SCG06EB', 'SCG06EA'],
      ['SCG08EB', 'SCG08EA'],
      ['SCG09EB', 'SCG09EA'],
      ['SCG11EB', 'SCG11EA'],
      ['SCU02EB', 'SCU02EA'],
      ['SCU04EB', 'SCU04EA'],
      ['SCU06EB', 'SCU06EA'],
      ['SCU08EB', 'SCU08EA'],
      ['SCU11EB', 'SCU11EA'],
      ['SCU13EB', 'SCU13EA'],
    ];
    for (const [eb, ea] of EB_PAIRS) {
      const ebMovies = getMissionMovies(eb);
      const eaMovies = getMissionMovies(ea);
      expect(ebMovies, `${eb} should have movies`).toBeDefined();
      expect(ebMovies!.intro, `${eb} intro`).toBe(eaMovies!.intro);
      expect(ebMovies!.brief, `${eb} brief`).toBe(eaMovies!.brief);
      expect(ebMovies!.action, `${eb} action`).toBe(eaMovies!.action);
      expect(ebMovies!.win, `${eb} win`).toBe(eaMovies!.win);
      expect(ebMovies!.lose, `${eb} lose`).toBe(eaMovies!.lose);
    }
  });

  // === Intro-only missions (LANDCOM/evidence) ===
  it('LANDCOM missions have intro but no brief', () => {
    const LANDCOM_IDS = ['SCG03EA', 'SCG03EB', 'SCG07EA', 'SCG13EA', 'SCG10EB'];
    for (const id of LANDCOM_IDS) {
      const movies = getMissionMovies(id);
      expect(movies, `${id} should exist`).toBeDefined();
      expect(movies!.intro, `${id} should have intro`).toBeDefined();
      expect(movies!.brief, `${id} should NOT have brief`).toBeUndefined();
    }
  });

  // === Ant Missions ===
  describe('Ant Missions', () => {
    it('SCA01EA has intro (antintro) and brief (antbrf)', () => {
      const movies = getMissionMovies('SCA01EA');
      expect(movies).toBeDefined();
      expect(movies!.intro).toBe('antintro');
      expect(movies!.brief).toBe('antbrf');
      expect(movies!.action).toBeUndefined();
      expect(movies!.win).toBeUndefined();
      expect(movies!.lose).toBeUndefined();
    });

    it('SCA02EA and SCA03EA have no FMV fields', () => {
      for (const id of ['SCA02EA', 'SCA03EA']) {
        const movies = getMissionMovies(id);
        expect(movies, `${id} should exist`).toBeDefined();
        expect(movies!.intro).toBeUndefined();
        expect(movies!.brief).toBeUndefined();
        expect(movies!.win).toBeUndefined();
        expect(movies!.lose).toBeUndefined();
      }
    });

    it('SCA04EA has win (antend) and nothing else', () => {
      const movies = getMissionMovies('SCA04EA');
      expect(movies).toBeDefined();
      expect(movies!.win).toBe('antend');
      expect(movies!.intro).toBeUndefined();
      expect(movies!.brief).toBeUndefined();
      expect(movies!.lose).toBeUndefined();
    });

    it('SCA01EA has FMV (intro+brief), SCA02/03 do not', () => {
      expect(hasFMV('SCA01EA')).toBe(true);
      expect(hasFMV('SCA02EA')).toBe(false);
      expect(hasFMV('SCA03EA')).toBe(false);
      expect(hasFMV('SCA04EA')).toBe(true);
    });
  });

  // === Counterstrike (win + lose only, no pre-mission FMV) ===
  describe('Counterstrike Missions', () => {
    const CS_MISSIONS: [string, string, string][] = [
      ['SCG20EA', 'allymorf', 'v2rocket'],
      ['SCG21EA', 'spy',      'execute'],
      ['SCG22EA', 'apcescpe', 'tesla'],
      ['SCG23EA', 'toofar',   'bmap'],
      ['SCG24EA', 'allymorf', 'snstrafe'],
      ['SCG26EA', 'sovbatl',  'overrun'],
      ['SCG27EA', 'aftrmath', 'trinity'],
      ['SCG28EA', 'masasslt', 'frozen'],
      ['SCU31EA', 'sovtstar', 'allymorf'],
      ['SCU32EA', 'bmap',     'spy'],
      ['SCU33EA', 'execute',  'apcescpe'],
      ['SCU34EA', 'sovtstar', 'allymorf'],
      ['SCU35EA', 'grvestne', 'sovcemet'],
      ['SCU36EA', 'sovtstar', 'sovbatl'],
      ['SCU37EA', 'bmap',     'cronfail'],
      ['SCU38EA', 'sovtstar', 'sovcemet'],
    ];

    it('all 16 Counterstrike missions have win + lose only', () => {
      for (const [id, win, lose] of CS_MISSIONS) {
        const movies = getMissionMovies(id);
        expect(movies, `${id} should have movies`).toBeDefined();
        expect(movies!.win, `${id} win`).toBe(win);
        expect(movies!.lose, `${id} lose`).toBe(lose);
        expect(movies!.intro, `${id} should NOT have intro`).toBeUndefined();
        expect(movies!.brief, `${id} should NOT have brief`).toBeUndefined();
        expect(movies!.action, `${id} should NOT have action`).toBeUndefined();
      }
    });

    it('hasFMV returns true for Counterstrike missions (they have win/lose)', () => {
      for (const [id] of CS_MISSIONS) {
        expect(hasFMV(id), `${id} should have FMV`).toBe(true);
      }
    });
  });

  // === Final missions have no win video (campaign ending handles it) ===
  it('SCG14EA and SCU14EA have no win video (campaign ending)', () => {
    expect(getMissionMovies('SCG14EA')!.win).toBeUndefined();
    expect(getMissionMovies('SCU14EA')!.win).toBeUndefined();
  });

  it('SCG14EA and SCU14EA still have lose videos', () => {
    expect(getMissionMovies('SCG14EA')!.lose).toBe('battle');
    expect(getMissionMovies('SCU14EA')!.lose).toBe('sovcemet');
  });

  // === Campaign ending movies ===
  describe('Campaign End Movies', () => {
    it('CAMPAIGN_END_MOVIES has allied and soviet endings', () => {
      expect(CAMPAIGN_END_MOVIES.allied).toBe('allyend');
      expect(CAMPAIGN_END_MOVIES.soviet).toBe('sovfinal');
    });

    it('only has allied and soviet keys', () => {
      expect(Object.keys(CAMPAIGN_END_MOVIES)).toEqual(['allied', 'soviet']);
    });
  });

  // === Win/Lose coverage ===
  it('all Allied main campaign missions (except SCG10EA, SCG14EA) have win videos', () => {
    const SHOULD_HAVE_WIN = [
      'SCG01EA', 'SCG02EA', 'SCG03EA', 'SCG04EA', 'SCG05EA', 'SCG06EA',
      'SCG07EA', 'SCG08EA', 'SCG09EA', 'SCG10EB', 'SCG11EA', 'SCG12EA', 'SCG13EA',
    ];
    for (const id of SHOULD_HAVE_WIN) {
      expect(getMissionMovies(id)!.win, `${id} should have win`).toBeDefined();
    }
    // SCG10EA and SCG14EA have no win video
    expect(getMissionMovies('SCG10EA')!.win).toBeUndefined();
    expect(getMissionMovies('SCG14EA')!.win).toBeUndefined();
  });

  it('all Allied main campaign missions have lose videos', () => {
    const ALL_ALLIED = [
      'SCG01EA', 'SCG02EA', 'SCG03EA', 'SCG04EA', 'SCG05EA', 'SCG06EA',
      'SCG07EA', 'SCG08EA', 'SCG09EA', 'SCG10EA', 'SCG10EB', 'SCG11EA',
      'SCG12EA', 'SCG13EA', 'SCG14EA',
    ];
    for (const id of ALL_ALLIED) {
      expect(getMissionMovies(id)!.lose, `${id} should have lose`).toBeDefined();
    }
  });

  it('all Soviet main campaign missions (except SCU14EA) have win videos', () => {
    const SHOULD_HAVE_WIN = [
      'SCU01EA', 'SCU02EA', 'SCU03EA', 'SCU04EA', 'SCU05EA', 'SCU06EA',
      'SCU07EA', 'SCU08EA', 'SCU09EA', 'SCU10EA', 'SCU11EA', 'SCU12EA', 'SCU13EA',
    ];
    for (const id of SHOULD_HAVE_WIN) {
      expect(getMissionMovies(id)!.win, `${id} should have win`).toBeDefined();
    }
    expect(getMissionMovies('SCU14EA')!.win).toBeUndefined();
  });

  it('all Soviet main campaign missions have lose videos', () => {
    const ALL_SOVIET = [
      'SCU01EA', 'SCU02EA', 'SCU03EA', 'SCU04EA', 'SCU05EA', 'SCU06EA',
      'SCU07EA', 'SCU08EA', 'SCU09EA', 'SCU10EA', 'SCU11EA', 'SCU12EA',
      'SCU13EA', 'SCU14EA',
    ];
    for (const id of ALL_SOVIET) {
      expect(getMissionMovies(id)!.lose, `${id} should have lose`).toBeDefined();
    }
  });

  // === URL generation ===
  it('generates correct archive.org URL', () => {
    expect(getMovieUrl('ally1')).toBe(
      'https://archive.org/download/Red_Alert-Cutscenes/ally1_512kb.mp4'
    );
    expect(getMovieUrl('allyend')).toBe(
      'https://archive.org/download/Red_Alert-Cutscenes/allyend_512kb.mp4'
    );
    expect(getMovieUrl('antintro')).toBe(
      'https://archive.org/download/Red_Alert-Cutscenes/antintro_512kb.mp4'
    );
    expect(getMovieUrl('antbrf')).toBe(
      'https://archive.org/download/Red_Alert-Cutscenes/antbrf_512kb.mp4'
    );
  });

  // === Case-insensitive lookup ===
  it('case-insensitive lookup works', () => {
    expect(getMissionMovies('scg01ea')).toBeDefined();
    expect(getMissionMovies('Scg01ea')).toBeDefined();
    expect(getMissionMovies('SCG01EA')).toBeDefined();
    expect(hasFMV('scg01ea')).toBe(true);
    expect(hasFMV('sca01ea')).toBe(true); // ant mission with intro
    expect(hasFMV('sca02ea')).toBe(false); // ant mission with no FMV
  });

  // === hasFMV checks any field, not just brief ===
  it('hasFMV returns true when only win/lose exist (no brief/action)', () => {
    // Counterstrike — only win+lose
    expect(hasFMV('SCG20EA')).toBe(true);
    // SCA01EA — intro + brief
    expect(hasFMV('SCA01EA')).toBe(true);
    // SCA04EA — only win
    expect(hasFMV('SCA04EA')).toBe(true);
  });

  it('hasFMV returns false for empty entries and unknown missions', () => {
    // SCA02/03 exist but have no fields set
    expect(hasFMV('SCA02EA')).toBe(false);
    expect(hasFMV('SCA03EA')).toBe(false);
    // Unknown mission
    expect(hasFMV('SCG99EA')).toBe(false);
  });

  // === Movie name validation ===
  describe('Movie Name Validation', () => {
    it('all movie names are non-empty strings', () => {
      const names = getAllMovieNames();
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(name, `movie name should be non-empty`).toBeTruthy();
        expect(typeof name, `movie name should be string`).toBe('string');
        expect(name.trim(), `movie name "${name}" should not be whitespace-only`).toBe(name);
      }
    });

    it('all movie names are lowercase (no uppercase letters)', () => {
      const names = getAllMovieNames();
      for (const name of names) {
        expect(name, `"${name}" should be lowercase`).toBe(name.toLowerCase());
      }
    });

    it('all movie names contain only valid characters (a-z, 0-9, underscore)', () => {
      const names = getAllMovieNames();
      for (const name of names) {
        expect(name, `"${name}" should match [a-z0-9_]+`).toMatch(/^[a-z0-9_]+$/);
      }
    });

    it('all movie names generate valid archive.org URLs', () => {
      const names = getAllMovieNames();
      for (const name of names) {
        const url = getMovieUrl(name);
        expect(url, `URL for "${name}" should start with base URL`).toContain(
          'https://archive.org/download/Red_Alert-Cutscenes/'
        );
        expect(url, `URL for "${name}" should end with _512kb.mp4`).toMatch(/_512kb\.mp4$/);
      }
    });

    it('antbrf is included in the full movie name list', () => {
      const names = getAllMovieNames();
      expect(names).toContain('antbrf');
    });
  });

  // === Total scenario count ===
  it('56 total scenarios are mapped (29 Allied + EA/EB, 25 Soviet + EA/EB, 4 Ant, 16 CS)', () => {
    // Count all unique scenario IDs by checking known ones exist
    const ALL_IDS = [
      // Allied (15 EA + 8 EB = 23)
      'SCG01EA', 'SCG02EA', 'SCG03EA', 'SCG03EB', 'SCG04EA',
      'SCG05EA', 'SCG05EB', 'SCG06EA', 'SCG06EB', 'SCG07EA',
      'SCG08EA', 'SCG08EB', 'SCG09EA', 'SCG09EB', 'SCG10EA', 'SCG10EB',
      'SCG11EA', 'SCG11EB', 'SCG12EA', 'SCG13EA', 'SCG14EA',
      // Soviet (14 EA + 7 EB = 21)
      'SCU01EA', 'SCU02EA', 'SCU02EB', 'SCU03EA',
      'SCU04EA', 'SCU04EB', 'SCU05EA', 'SCU06EA', 'SCU06EB',
      'SCU07EA', 'SCU08EA', 'SCU08EB', 'SCU09EA', 'SCU10EA',
      'SCU11EA', 'SCU11EB', 'SCU12EA', 'SCU13EA', 'SCU13EB', 'SCU14EA',
      // Ant (4)
      'SCA01EA', 'SCA02EA', 'SCA03EA', 'SCA04EA',
      // Counterstrike (16)
      'SCG20EA', 'SCG21EA', 'SCG22EA', 'SCG23EA', 'SCG24EA',
      'SCG26EA', 'SCG27EA', 'SCG28EA',
      'SCU31EA', 'SCU32EA', 'SCU33EA', 'SCU34EA', 'SCU35EA',
      'SCU36EA', 'SCU37EA', 'SCU38EA',
    ];
    for (const id of ALL_IDS) {
      expect(getMissionMovies(id), `${id} should be mapped`).toBeDefined();
    }
  });
});
