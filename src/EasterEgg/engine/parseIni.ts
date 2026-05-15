/**
 * Shared INI parser and helpers for rules.ini / scenario INI processing.
 *
 * Extracted from scenarioRules.ts so that both the rules.ini pipeline
 * and the scenario-override path can share a single implementation
 * without circular dependencies.
 */

import { cppTechnoTypeBuildTime } from './fixedPoint';
import type { Faction, ProductionItem } from './types';

// ─── INI Section Parser ──────────────────────────────────────────────

export type IniSections = Map<string, Map<string, string>>;

/**
 * Parse INI text into a two-level Map<sectionName, Map<key, value>>.
 * Matches C++ INIClass::Load() behavior from ini.cpp:200-298:
 *   - Strip_Comments removes everything from first ';' onward (ini.cpp:1278-1287)
 *   - Section names are trimmed (ini.cpp:228-231, strtrim)
 *   - Trailing text after ']' is ignored (ini.cpp:220, strchr for ']')
 *   - Entries with empty values after trim are skipped (ini.cpp:273)
 *   - Empty sections (no entries) are discarded (ini.cpp:290-295)
 */
export function parseIniSections(text: string): IniSections {
  const sections: IniSections = new Map();
  let currentSection = '';

  for (const rawLine of text.split('\n')) {
    // C++ Strip_Comments (ini.cpp:1278-1287): truncate at first ';'
    const commentIdx = rawLine.indexOf(';');
    const stripped = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
    const line = stripped.trim();
    if (!line) continue;

    // C++ section detection (ini.cpp:220): buffer[0]=='[' && strchr(buffer,']')!=NULL
    // C++ section name extraction (ini.cpp:228-231): replace '[' with ' ', zero ']', strtrim
    if (line.startsWith('[')) {
      const closeBracket = line.indexOf(']');
      if (closeBracket >= 0) {
        currentSection = line.slice(1, closeBracket).trim();
        if (!sections.has(currentSection)) {
          sections.set(currentSection, new Map());
        }
        continue;
      }
    }

    const eq = line.indexOf('=');
    if (eq > 0 && currentSection) {
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      // C++ ini.cpp:273: skip entries with empty value after trim
      if (!value) continue;
      sections.get(currentSection)!.set(key, value);
    }
  }

  // C++ ini.cpp:290-295: discard sections with no valid entries
  for (const [name, entries] of sections) {
    if (entries.size === 0) {
      sections.delete(name);
    }
  }

  return sections;
}

// ─── Integer parsing helper ──────────────────────────────────────────

/**
 * Parse an integer from an INI value string, matching C++ Get_Int (ini.cpp:813-834).
 * Handles three formats:
 *   "$FF"  → 255   (leading '$' hex, ini.cpp:823-824)
 *   "FFh"  → 255   (trailing 'h' hex, ini.cpp:826-827)
 *   "42"   → 42    (plain decimal via atoi, ini.cpp:829)
 *
 * Returns defValue when the entry is missing or unparseable.
 */
export function parseIniInt(value: string | undefined, defValue = 0): number {
  if (value == null || value === '') return defValue;

  // $XX hex format (ini.cpp:823-824)
  if (value.startsWith('$')) {
    const parsed = parseInt(value.slice(1), 16);
    return isNaN(parsed) ? defValue : parsed;
  }

  // XXh trailing-h hex format (ini.cpp:826-827)
  if (value.length > 1 && value[value.length - 1].toLowerCase() === 'h') {
    const parsed = parseInt(value.slice(0, -1), 16);
    return isNaN(parsed) ? defValue : parsed;
  }

  // Plain decimal (ini.cpp:829 — atoi)
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defValue : parsed;
}

// ─── Owner / Faction helpers ─────────────────────────────────────────

const ALLIED_OWNERS = new Set([
  'allies', 'england', 'france', 'germany',
  'greece', 'spain', 'turkey', 'goodguy',
]);

const SOVIET_OWNERS = new Set([
  'soviet', 'ussr', 'ukraine', 'badguy',
]);

export function normalizeOwnerToFaction(raw: string | undefined): Faction | undefined {
  if (!raw) return undefined;
  const owners = raw
    .split(',')
    .map(owner => owner.trim().toLowerCase())
    .filter(Boolean);

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

// ─── Prerequisite helpers ────────────────────────────────────────────

export function parsePrerequisiteList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);
}

export function interpretProductionPrerequisites(
  item: ProductionItem,
  raw: string | undefined,
): Pick<ProductionItem, 'prerequisite' | 'techPrereq'> {
  const prereqs = parsePrerequisiteList(raw);
  if (prereqs.length === 0) {
    return {
      prerequisite: item.prerequisite,
      techPrereq: undefined,
    };
  }

  if (item.isStructure) {
    return {
      prerequisite: prereqs[0] ?? item.prerequisite,
      techPrereq: prereqs[1],
    };
  }

  const defaultFactory = item.prerequisite;
  if (prereqs[0] === defaultFactory) {
    return {
      prerequisite: defaultFactory,
      techPrereq: prereqs[1],
    };
  }

  return {
    prerequisite: defaultFactory,
    techPrereq: prereqs[0],
  };
}

// ─── Generic item patching ───────────────────────────────────────────

/**
 * Patch an array of ProductionItems with Owner=, Prerequisite=, Cost=,
 * and TechLevel= values from parsed INI sections.  Returns a new array
 * (does not mutate the input).
 */
export function patchProductionItems(
  base: readonly ProductionItem[],
  sections: IniSections,
): ProductionItem[] {
  return base.map(item => {
    const section = sections.get(item.type);
    if (!section) return { ...item };

    const patched = { ...item };
    if (section.has('Cost')) patched.cost = parseIniInt(section.get('Cost')!);
    if (section.has('TechLevel')) patched.techLevel = parseIniInt(section.get('TechLevel')!);
    if (section.has('Owner')) {
      const faction = normalizeOwnerToFaction(section.get('Owner'));
      if (faction !== undefined) patched.faction = faction;
    }
    if (section.has('Prerequisite')) {
      const interp = interpretProductionPrerequisites(patched, section.get('Prerequisite'));
      patched.prerequisite = interp.prerequisite;
      patched.techPrereq = interp.techPrereq;
    }
    if (section.has('Cost')) {
      patched.buildTime = cppTechnoTypeBuildTime(patched.cost);
    }
    return patched;
  });
}
