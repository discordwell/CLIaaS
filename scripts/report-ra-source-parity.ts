#!/usr/bin/env tsx

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  PRODUCTION_ITEMS,
  UNIT_STATS,
  WARHEAD_META,
  WARHEAD_PROPS,
  WARHEAD_VS_ARMOR,
  WEAPON_STATS,
} from '../src/EasterEgg/engine/types';
import {
  getSection,
  loadRedAlertSourceSections,
  normalizeOwner,
  normalizePrerequisites,
  normalizeValue,
  parseVerses,
  readNumber,
  readString,
} from './ra-parity/sourceTruth';

interface Mismatch {
  category: 'unit' | 'weapon' | 'warhead' | 'production';
  id: string;
  field: string;
  actual: unknown;
  expected: unknown;
  source: string;
}

interface AuditReport {
  timestamp: string;
  loadedFiles: string[];
  summary: {
    mismatchCount: number;
    byCategory: Record<Mismatch['category'], number>;
  };
  mismatches: Mismatch[];
}

const REPORT_DIR = path.join(process.cwd(), 'test-results', 'parity');
const JSON_OUTPUT = path.join(REPORT_DIR, 'source-parity.json');
const MD_OUTPUT = path.join(REPORT_DIR, 'source-parity.md');
const strict = process.argv.includes('--strict');

function sameValue(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function addMismatch(mismatches: Mismatch[], mismatch: Mismatch): void {
  mismatches.push(mismatch);
}

function sourceLabel(sectionName: string, loadedFiles: string[]): string {
  return `${sectionName} (${loadedFiles.map(file => path.basename(file)).join(', ')})`;
}

function compareField(
  mismatches: Mismatch[],
  category: Mismatch['category'],
  id: string,
  field: string,
  actual: unknown,
  expected: unknown,
  source: string,
): void {
  if (!sameValue(actual, expected)) {
    addMismatch(mismatches, { category, id, field, actual, expected, source });
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const { files, sections } = loadRedAlertSourceSections();
  const loadedFiles = files.map(file => file.absolutePath);
  const mismatches: Mismatch[] = [];

  for (const [unitName, unit] of Object.entries(UNIT_STATS)) {
    const section = getSection(sections, unitName);
    if (!section) continue;

    const source = sourceLabel(unitName, loadedFiles);
    const actualPrimary = unit.primaryWeapon === null ? null : normalizeValue(unit.primaryWeapon ?? undefined);
    const sourcePrimary = normalizeValue(readString(section, 'Primary'));
    const actualSecondary = unit.secondaryWeapon === null ? null : normalizeValue(unit.secondaryWeapon ?? undefined);
    const sourceSecondary = normalizeValue(readString(section, 'Secondary'));

    compareField(mismatches, 'unit', unitName, 'strength', unit.strength, readNumber(section, 'Strength'), source);
    compareField(mismatches, 'unit', unitName, 'armor', unit.armor, readString(section, 'Armor')?.toLowerCase(), source);
    compareField(mismatches, 'unit', unitName, 'speed', unit.speed, readNumber(section, 'Speed'), source);
    compareField(mismatches, 'unit', unitName, 'sight', unit.sight, readNumber(section, 'Sight'), source);
    const sourceRot = readNumber(section, 'ROT');
    if (sourceRot !== undefined) {
      compareField(mismatches, 'unit', unitName, 'rot', unit.rot, sourceRot, source);
    }
    if (sourcePrimary !== undefined || unit.primaryWeapon !== null) {
      compareField(
        mismatches,
        'unit',
        unitName,
        'primaryWeapon',
        actualPrimary,
        sourcePrimary,
        source,
      );
    }
    const shouldCompareSecondary =
      sourceSecondary !== undefined
        ? !(sourceSecondary === null && unit.secondaryWeapon === undefined)
        : (unit.secondaryWeapon !== undefined && unit.secondaryWeapon !== null);
    if (shouldCompareSecondary) {
      compareField(
        mismatches,
        'unit',
        unitName,
        'secondaryWeapon',
        actualSecondary,
        sourceSecondary,
        source,
      );
    }

    if (unit.owner !== undefined) {
      const sourceOwner = normalizeOwner(readString(section, 'Owner'));
      compareField(mismatches, 'unit', unitName, 'owner', unit.owner, sourceOwner, source);
    }

    if (unit.cost !== undefined) {
      const sourceCost = readNumber(section, 'Cost');
      compareField(mismatches, 'unit', unitName, 'cost', unit.cost, sourceCost, source);
    }

    if (unit.passengers !== undefined) {
      const sourcePassengers = readNumber(section, 'Passengers');
      compareField(mismatches, 'unit', unitName, 'passengers', unit.passengers, sourcePassengers, source);
    }

    if (unit.maxAmmo !== undefined) {
      const sourceAmmo = readNumber(section, 'Ammo');
      compareField(mismatches, 'unit', unitName, 'maxAmmo', unit.maxAmmo, sourceAmmo, source);
    }
  }

  for (const [weaponName, weapon] of Object.entries(WEAPON_STATS)) {
    const section = getSection(sections, weaponName);
    if (!section) continue;

    const source = sourceLabel(weaponName, loadedFiles);
    compareField(mismatches, 'weapon', weaponName, 'damage', weapon.damage, readNumber(section, 'Damage'), source);
    compareField(mismatches, 'weapon', weaponName, 'rof', weapon.rof, readNumber(section, 'ROF'), source);
    compareField(mismatches, 'weapon', weaponName, 'range', weapon.range, readNumber(section, 'Range'), source);
    compareField(mismatches, 'weapon', weaponName, 'warhead', weapon.warhead, readString(section, 'Warhead'), source);

    const sourceBurst = readNumber(section, 'Burst') ?? 1;
    const actualBurst = weapon.burst ?? 1;
    compareField(mismatches, 'weapon', weaponName, 'burst', actualBurst, sourceBurst, source);
  }

  for (const [warheadName, verses] of Object.entries(WARHEAD_VS_ARMOR)) {
    const section = getSection(sections, warheadName);
    if (!section) continue;

    const source = sourceLabel(warheadName, loadedFiles);
    compareField(mismatches, 'warhead', warheadName, 'verses', verses, parseVerses(readString(section, 'Verses')), source);
    compareField(mismatches, 'warhead', warheadName, 'spreadFactor', WARHEAD_META[warheadName].spreadFactor, readNumber(section, 'Spread'), source);
    compareField(
      mismatches,
      'warhead',
      warheadName,
      'destroysWalls',
      Boolean(WARHEAD_META[warheadName].destroysWalls),
      readString(section, 'Wall')?.toLowerCase() === 'yes',
      source,
    );
    compareField(
      mismatches,
      'warhead',
      warheadName,
      'destroysWood',
      Boolean(WARHEAD_META[warheadName].destroysWood),
      readString(section, 'Wood')?.toLowerCase() === 'yes',
      source,
    );
    compareField(
      mismatches,
      'warhead',
      warheadName,
      'destroysOre',
      Boolean(WARHEAD_META[warheadName].destroysOre),
      readString(section, 'Ore')?.toLowerCase() === 'yes',
      source,
    );
    compareField(
      mismatches,
      'warhead',
      warheadName,
      'infantryDeath',
      WARHEAD_PROPS[warheadName].infantryDeath,
      readNumber(section, 'InfDeath'),
      source,
    );
  }

  for (const item of PRODUCTION_ITEMS) {
    const section = getSection(sections, item.type);
    if (!section) continue;

    const source = sourceLabel(item.type, loadedFiles);
    const sourceCost = readNumber(section, 'Cost');
    if (sourceCost !== undefined) {
      compareField(mismatches, 'production', item.type, 'cost', item.cost, sourceCost, source);
    }

    const sourceTechLevel = readNumber(section, 'TechLevel');
    if (sourceTechLevel !== undefined) {
      compareField(mismatches, 'production', item.type, 'techLevel', item.techLevel ?? null, sourceTechLevel, source);
    }

    const sourceOwner = normalizeOwner(readString(section, 'Owner'));
    if (sourceOwner !== undefined) {
      compareField(mismatches, 'production', item.type, 'faction', item.faction, sourceOwner, source);
    }

    const prereqs = normalizePrerequisites(readString(section, 'Prerequisite'));
    if (prereqs.prerequisite !== undefined) {
      compareField(mismatches, 'production', item.type, 'prerequisite', item.prerequisite, prereqs.prerequisite, source);
    }
    if (prereqs.techPrereq !== undefined) {
      compareField(mismatches, 'production', item.type, 'techPrereq', item.techPrereq ?? null, prereqs.techPrereq, source);
    }
  }

  const byCategory: Record<Mismatch['category'], number> = {
    unit: 0,
    weapon: 0,
    warhead: 0,
    production: 0,
  };
  for (const mismatch of mismatches) {
    byCategory[mismatch.category]++;
  }

  const report: AuditReport = {
    timestamp: new Date().toISOString(),
    loadedFiles,
    summary: {
      mismatchCount: mismatches.length,
      byCategory,
    },
    mismatches,
  };

  fs.writeFileSync(JSON_OUTPUT, JSON.stringify(report, null, 2));

  const topMismatches = mismatches.slice(0, 40);
  const markdown = [
    '# Red Alert Source Parity Audit',
    '',
    `Generated: ${report.timestamp}`,
    '',
    'Loaded files:',
    ...loadedFiles.map(file => `- ${file}`),
    '',
    `Total mismatches: ${report.summary.mismatchCount}`,
    `- Units: ${byCategory.unit}`,
    `- Weapons: ${byCategory.weapon}`,
    `- Warheads: ${byCategory.warhead}`,
    `- Production: ${byCategory.production}`,
    '',
    'Top mismatches:',
    ...topMismatches.map(mismatch => `- [${mismatch.category}] ${mismatch.id}.${mismatch.field}: TS=${JSON.stringify(mismatch.actual)} source=${JSON.stringify(mismatch.expected)}`),
    '',
    `Full JSON: ${JSON_OUTPUT}`,
  ].join('\n');
  fs.writeFileSync(MD_OUTPUT, markdown);

  console.log(`Source parity report written to ${JSON_OUTPUT}`);
  console.log(`Mismatch summary: ${report.summary.mismatchCount} total`);
  console.log(`  unit=${byCategory.unit} weapon=${byCategory.weapon} warhead=${byCategory.warhead} production=${byCategory.production}`);
  for (const mismatch of topMismatches.slice(0, 15)) {
    console.log(`  [${mismatch.category}] ${mismatch.id}.${mismatch.field}: TS=${JSON.stringify(mismatch.actual)} source=${JSON.stringify(mismatch.expected)}`);
  }

  if (strict && mismatches.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
