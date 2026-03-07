import * as fs from 'node:fs';
import * as path from 'node:path';

export type IniSections = Map<string, Map<string, string>>;

export interface LoadedSourceFile {
  kind: 'rules' | 'aftermath' | 'scenario';
  relativePath: string;
  absolutePath: string;
}

export interface LoadedSourceSections {
  files: LoadedSourceFile[];
  sections: IniSections;
}

const DEFAULT_SOURCE_FILES: LoadedSourceFile[] = [
  { kind: 'rules', relativePath: 'public/ra/assets/rules.ini', absolutePath: '' },
  { kind: 'aftermath', relativePath: 'public/ra/assets/aftrmath.ini', absolutePath: '' },
  { kind: 'scenario', relativePath: 'public/ra/assets/SCA01EA.ini', absolutePath: '' },
];

export const BUILDING_DATA_RELATIVE_PATH = 'src/EasterEgg/CnC_and_Red_Alert/RA/bdata.cpp';

const ALLIED_OWNERS = new Set([
  'allies',
  'england',
  'france',
  'germany',
  'greece',
  'spain',
  'turkey',
  'goodguy',
]);

const SOVIET_OWNERS = new Set([
  'soviet',
  'ussr',
  'ukraine',
  'badguy',
]);

export function parseIni(text: string): IniSections {
  const sections: IniSections = new Map();
  let current: Map<string, string> | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    const sectionMatch = /^\[(.+)]$/.exec(line);
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      current = sections.get(sectionName) ?? new Map<string, string>();
      sections.set(sectionName, current);
      continue;
    }

    if (!current) continue;

    const idx = line.indexOf('=');
    if (idx < 0) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    current.set(key, value);
  }

  return sections;
}

export function mergeSections(...inputs: IniSections[]): IniSections {
  const merged: IniSections = new Map();

  for (const input of inputs) {
    for (const [sectionName, section] of input.entries()) {
      const target = merged.get(sectionName) ?? new Map<string, string>();
      for (const [key, value] of section.entries()) {
        target.set(key, value);
      }
      merged.set(sectionName, target);
    }
  }

  return merged;
}

export function loadRedAlertSourceSections(
  root = process.cwd(),
  kinds?: LoadedSourceFile['kind'][],
): LoadedSourceSections {
  const parsedSections: IniSections[] = [];
  const files: LoadedSourceFile[] = [];
  const allowedKinds = kinds ? new Set(kinds) : null;

  for (const file of DEFAULT_SOURCE_FILES) {
    if (allowedKinds && !allowedKinds.has(file.kind)) continue;
    const absolutePath = path.join(root, file.relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const text = fs.readFileSync(absolutePath, 'utf8');
    parsedSections.push(parseIni(text));
    files.push({ ...file, absolutePath });
  }

  return {
    files,
    sections: mergeSections(...parsedSections),
  };
}

export function getSection(sections: IniSections, name: string): Map<string, string> | undefined {
  return sections.get(name);
}

export function readString(section: Map<string, string> | undefined, key: string): string | undefined {
  return section?.get(key);
}

export function readNumber(section: Map<string, string> | undefined, key: string): number | undefined {
  const raw = readString(section, key);
  if (raw === undefined) return undefined;
  const normalized = raw.endsWith('%') ? raw.slice(0, -1) : raw;
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : undefined;
}

export function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

export function normalizeValue(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || raw.toLowerCase() === 'none') return null;
  return raw;
}

export function normalizeOwner(raw: string | undefined): 'allied' | 'soviet' | 'both' | undefined {
  const owners = parseCsv(raw).map(owner => owner.toLowerCase());
  if (owners.length === 0) return undefined;

  let hasAllied = false;
  let hasSoviet = false;

  for (const owner of owners) {
    if (ALLIED_OWNERS.has(owner)) hasAllied = true;
    if (SOVIET_OWNERS.has(owner)) hasSoviet = true;
  }

  if (hasAllied && hasSoviet) return 'both';
  if (hasAllied) return 'allied';
  if (hasSoviet) return 'soviet';
  return undefined;
}

export function normalizePrerequisites(raw: string | undefined): { prerequisite?: string; techPrereq?: string; all: string[] } {
  const all = parseCsv(raw).map(value => value.toUpperCase());
  return {
    prerequisite: all[0],
    techPrereq: all[1],
    all,
  };
}

export function parseVerses(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  const values = raw.split(',').map(part => Number.parseFloat(part.replace(/%/g, '').trim()) / 100);
  return values.every(value => Number.isFinite(value)) ? values : undefined;
}

function parsePlacedStructureType(sectionName: string, rawValue: string): string | undefined {
  const parts = rawValue.split(',').map(part => part.trim()).filter(Boolean);
  if (sectionName === 'STRUCTURES') {
    return parts[1]?.toUpperCase();
  }
  if (sectionName === 'Base') {
    return parts[0]?.toUpperCase();
  }
  return undefined;
}

export function collectPlacedStructureTypes(root = process.cwd()): string[] {
  const assetsDir = path.join(root, 'public', 'ra', 'assets');
  if (!fs.existsSync(assetsDir)) return [];

  const structureTypes = new Set<string>();
  for (const filename of fs.readdirSync(assetsDir)) {
    if (!filename.toLowerCase().endsWith('.ini')) continue;
    const absolutePath = path.join(assetsDir, filename);
    const sections = parseIni(fs.readFileSync(absolutePath, 'utf8'));

    for (const sectionName of ['STRUCTURES', 'Base'] as const) {
      const section = sections.get(sectionName);
      if (!section) continue;

      for (const [key, value] of section.entries()) {
        if (sectionName === 'Base' && (key === 'Count' || key === 'Player')) continue;
        const type = parsePlacedStructureType(sectionName, value);
        if (type) structureTypes.add(type);
      }
    }
  }

  return [...structureTypes].sort();
}

export function loadBuildingSizeTruth(root = process.cwd()): Record<string, [number, number]> {
  const absolutePath = path.join(root, BUILDING_DATA_RELATIVE_PATH);
  if (!fs.existsSync(absolutePath)) return {};

  const source = fs.readFileSync(absolutePath, 'utf8');
  const sizes: Record<string, [number, number]> = {};

  for (const block of source.split('static BuildingTypeClass const ').slice(1)) {
    const typeMatch = /\n\s*"([A-Z0-9]+)",\s*\/\/\s*NAME:/.exec(block);
    const sizeMatch = /BSIZE_(\d)(\d)/.exec(block);
    if (!typeMatch || !sizeMatch) continue;

    sizes[typeMatch[1]] = [
      Number.parseInt(sizeMatch[1], 10),
      Number.parseInt(sizeMatch[2], 10),
    ];
  }

  return sizes;
}

export function collectSectionNumberTruth(root = process.cwd(), key: string): Record<string, number> {
  const assetsDir = path.join(root, 'public', 'ra', 'assets');
  if (!fs.existsSync(assetsDir)) return {};

  const truth: Record<string, number> = {};
  for (const filename of fs.readdirSync(assetsDir).sort()) {
    if (!filename.toLowerCase().endsWith('.ini')) continue;
    const absolutePath = path.join(assetsDir, filename);
    const sections = parseIni(fs.readFileSync(absolutePath, 'utf8'));

    for (const [sectionName, section] of sections.entries()) {
      if (truth[sectionName] !== undefined) continue;
      const value = readNumber(section, key);
      if (value !== undefined) {
        truth[sectionName] = value;
      }
    }
  }

  return truth;
}
