/**
 * FMV movie mapping tests — verify correct movie assignments for all campaign missions,
 * URL generation, case-insensitive lookup, and exclusion of non-FMV missions.
 */
import { describe, it, expect } from 'vitest';
import { getMissionMovies, hasFMV, getMovieUrl } from '../engine/movies';

describe('FMV Movie Mapping', () => {
  // === Allied Campaign (11 missions with FMV) ===
  const ALLIED_FMV: [string, string, string][] = [
    ['SCG01EA', 'ally1',   'landing'],
    ['SCG02EA', 'ally2',   'mcv'],
    ['SCG04EA', 'ally4',   'binoc'],
    ['SCG05EA', 'ally5',   'tanya1'],
    ['SCG06EA', 'ally6',   'mcv'],
    ['SCG08EA', 'ally8',   'aagun'],
    ['SCG09EA', 'ally9',   'spy'],
    ['SCG10EA', 'ally10',  'mcv_land'],
    ['SCG11EA', 'ally11',  'destroyr'],
    ['SCG12EA', 'ally12',  'assess'],
    ['SCG14EA', 'ally14',  'masasslt'],
  ];

  it('all 11 Allied FMV missions have brief + action entries', () => {
    for (const [id, brief, action] of ALLIED_FMV) {
      const movies = getMissionMovies(id);
      expect(movies, `${id} should have movies`).toBeDefined();
      expect(movies!.brief).toBe(brief);
      expect(movies!.action).toBe(action);
    }
  });

  // === Soviet Campaign (14 missions with FMV) ===
  const SOVIET_FMV: [string, string, string][] = [
    ['SCU01EA', 'soviet1',  'flare'],
    ['SCU02EA', 'soviet2',  'spotter'],
    ['SCU03EA', 'soviet3',  'search'],
    ['SCU04EA', 'soviet4',  'sovmcv'],
    ['SCU05EA', 'soviet5',  'double'],
    ['SCU06EA', 'soviet6',  'onthprwl'],
    ['SCU07EA', 'soviet7',  'countdwn'],
    ['SCU08EA', 'soviet8',  'slntsrvc'],
    ['SCU09EA', 'soviet9',  'movingin'],
    ['SCU10EA', 'soviet10', 'airfield'],
    ['SCU11EA', 'soviet11', 'periscop'],
    ['SCU12EA', 'soviet12', 'mcvbrdge'],
    ['SCU13EA', 'soviet13', 'mtnkfact'],
    ['SCU14EA', 'soviet14', 'beachead'],
  ];

  it('all 14 Soviet FMV missions have brief + action entries', () => {
    for (const [id, brief, action] of SOVIET_FMV) {
      const movies = getMissionMovies(id);
      expect(movies, `${id} should have movies`).toBeDefined();
      expect(movies!.brief).toBe(brief);
      expect(movies!.action).toBe(action);
    }
  });

  // === EB variants share EA movies ===
  it('EB variants match EA movies', () => {
    const EB_PAIRS: [string, string][] = [
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
      expect(ebMovies!.brief).toBe(eaMovies!.brief);
      expect(ebMovies!.action).toBe(eaMovies!.action);
    }
  });

  it('SCG10EB has no FMV (unlike SCG10EA)', () => {
    expect(hasFMV('SCG10EA')).toBe(true);
    expect(hasFMV('SCG10EB')).toBe(false);
  });

  // === Exclusions ===
  it('ant missions return undefined', () => {
    expect(getMissionMovies('SCA01EA')).toBeUndefined();
    expect(getMissionMovies('SCA02EA')).toBeUndefined();
    expect(getMissionMovies('SCA03EA')).toBeUndefined();
    expect(getMissionMovies('SCA04EA')).toBeUndefined();
    expect(hasFMV('SCA01EA')).toBe(false);
  });

  it('Counterstrike missions return undefined', () => {
    expect(getMissionMovies('SCG20EA')).toBeUndefined();
    expect(getMissionMovies('SCG28EA')).toBeUndefined();
    expect(getMissionMovies('SCU31EA')).toBeUndefined();
    expect(getMissionMovies('SCU38EA')).toBeUndefined();
    expect(hasFMV('SCG20EA')).toBe(false);
  });

  it('LANDCOM missions (SCG03, SCG07, SCG13) return undefined', () => {
    expect(getMissionMovies('SCG03EA')).toBeUndefined();
    expect(getMissionMovies('SCG03EB')).toBeUndefined();
    expect(getMissionMovies('SCG07EA')).toBeUndefined();
    expect(getMissionMovies('SCG13EA')).toBeUndefined();
    expect(hasFMV('SCG03EA')).toBe(false);
  });

  // === URL generation ===
  it('generates correct archive.org URL', () => {
    expect(getMovieUrl('ally1')).toBe(
      'https://archive.org/download/Red_Alert-Cutscenes/ally1_512kb.mp4'
    );
    expect(getMovieUrl('soviet14')).toBe(
      'https://archive.org/download/Red_Alert-Cutscenes/soviet14_512kb.mp4'
    );
  });

  // === Case-insensitive lookup ===
  it('case-insensitive lookup works', () => {
    expect(getMissionMovies('scg01ea')).toBeDefined();
    expect(getMissionMovies('Scg01ea')).toBeDefined();
    expect(getMissionMovies('SCG01EA')).toBeDefined();
    expect(hasFMV('scg01ea')).toBe(true);
    expect(hasFMV('sca01ea')).toBe(false);
  });

  // === Total count ===
  it('exactly 25 EA missions have FMV (11 Allied + 14 Soviet)', () => {
    const allEA = [
      ...ALLIED_FMV.map(([id]) => id),
      ...SOVIET_FMV.map(([id]) => id),
    ];
    expect(allEA.length).toBe(25);
    for (const id of allEA) {
      expect(hasFMV(id), `${id} should have FMV`).toBe(true);
    }
  });
});
