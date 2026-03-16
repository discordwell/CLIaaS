/**
 * Rules.ini import pipeline — single source of truth for faction ownership.
 *
 * Reads public/ra/assets/rules.ini and patches the PRODUCTION_ITEMS
 * skeleton from types.ts with authoritative Owner=, Prerequisite=,
 * Cost=, and TechLevel= values.
 *
 * All server-side consumers should import PRODUCTION_ITEMS from here
 * instead of from types.ts to ensure faction data is always derived
 * from rules.ini.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PRODUCTION_ITEMS as BASE_PRODUCTION_ITEMS, type ProductionItem } from './types';
import { parseIniSections, patchProductionItems, type IniSections } from './parseIni';

// ─── Locate and read rules.ini ───────────────────────────────────────

function findRulesIni(): string {
  const candidates = [
    resolve(process.cwd(), 'public/ra/assets/rules.ini'),
    resolve(__dirname, '../../../public/ra/assets/rules.ini'),
    resolve(__dirname, '../../../../public/ra/assets/rules.ini'),
  ];

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf-8');
    } catch {
      // try next
    }
  }

  throw new Error(
    `rules.ini not found. Tried:\n${candidates.join('\n')}\n` +
    'Ensure public/ra/assets/rules.ini exists in the project root.',
  );
}

// ─── Build canonical production items (lazy, cached) ─────────────────

let _cachedSections: IniSections | null = null;
let _cachedItems: ProductionItem[] | null = null;

function loadSections(): IniSections {
  if (!_cachedSections) {
    _cachedSections = parseIniSections(findRulesIni());
  }
  return _cachedSections;
}

/**
 * Canonical PRODUCTION_ITEMS with faction/prerequisite/cost/techLevel
 * derived from rules.ini.  Lazy-loaded on first access, then cached.
 */
export function getCanonicalProductionItems(): ProductionItem[] {
  if (!_cachedItems) {
    _cachedItems = patchProductionItems(BASE_PRODUCTION_ITEMS, loadSections());
  }
  return _cachedItems;
}

/**
 * The parsed rules.ini sections (lazy-loaded, cached).
 */
export function getRulesIniSections(): IniSections {
  return loadSections();
}
