/**
 * Shared INI parser and helpers for rules.ini / scenario INI processing.
 *
 * Extracted from scenarioRules.ts so that both the rules.ini pipeline
 * and the scenario-override path can share a single implementation
 * without circular dependencies.
 */

import type { Faction, ProductionItem } from './types';

// ─── INI Section Parser ──────────────────────────────────────────────

export type IniSections = Map<string, Map<string, string>>;

/**
 * Parse INI text into a two-level Map<sectionName, Map<key, value>>.
 * Ignores blank lines and `;` comments.
 */
export function parseIniSections(text: string): IniSections {
  const sections: IniSections = new Map();
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

  return sections;
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
    if (section.has('Cost')) patched.cost = Number.parseInt(section.get('Cost')!, 10);
    if (section.has('TechLevel')) patched.techLevel = Number.parseInt(section.get('TechLevel')!, 10);
    if (section.has('Owner')) {
      const faction = normalizeOwnerToFaction(section.get('Owner'));
      if (faction !== undefined) patched.faction = faction;
    }
    if (section.has('Prerequisite')) {
      const interp = interpretProductionPrerequisites(patched, section.get('Prerequisite'));
      patched.prerequisite = interp.prerequisite;
      patched.techPrereq = interp.techPrereq;
    }
    return patched;
  });
}
