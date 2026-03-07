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
import { STRUCTURE_MAX_HP, STRUCTURE_SIZE } from '../src/EasterEgg/engine/scenario';
import {
  buildScenarioRuleOverrides,
  interpretProductionPrerequisites,
  normalizeOwnerToFaction,
} from '../src/EasterEgg/engine/scenarioRules';
import {
  BUILDING_DATA_RELATIVE_PATH,
  collectPlacedStructureTypes,
  collectSectionNumberTruth,
  getSection,
  loadBuildingSizeTruth,
  loadRedAlertSourceSections,
  normalizeValue,
  parseVerses,
  readNumber,
  readString,
} from './ra-parity/sourceTruth';

interface Mismatch {
  category: 'unit' | 'weapon' | 'warhead' | 'production' | 'structure';
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
const BASE_WEAPON_SECTION_NAME: Record<string, string | undefined> = {
  TeslaCannon: 'TeslaZap',
  TeslaZap: undefined,
};

function sameValue(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function sourceLabel(sectionName: string, files: string[], suffix?: string): string {
  const fileList = files.map(file => path.basename(file)).join(', ');
  return suffix ? `${sectionName} (${fileList}; ${suffix})` : `${sectionName} (${fileList})`;
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
    mismatches.push({ category, id, field, actual, expected, source });
  }
}

function compareUnitTable(
  mismatches: Mismatch[],
  units: Record<string, typeof UNIT_STATS[string]>,
  sections: Map<string, Map<string, string>>,
  loadedFiles: string[],
  explicitOnly = false,
): void {
  for (const [unitName, unit] of Object.entries(units)) {
    const section = getSection(sections, unitName);
    if (!section) continue;

    const source = sourceLabel(unitName, loadedFiles, explicitOnly ? 'scenario override' : undefined);
    const actualPrimary = unit.primaryWeapon === null ? null : normalizeValue(unit.primaryWeapon ?? undefined);
    const sourcePrimary = normalizeValue(readString(section, 'Primary'));
    const actualSecondary = unit.secondaryWeapon === null ? null : normalizeValue(unit.secondaryWeapon ?? undefined);
    const sourceSecondary = normalizeValue(readString(section, 'Secondary'));

    if (!explicitOnly || section.has('Strength')) {
      compareField(mismatches, 'unit', unitName, 'strength', unit.strength, readNumber(section, 'Strength'), source);
    }
    if (!explicitOnly || section.has('Armor')) {
      compareField(mismatches, 'unit', unitName, 'armor', unit.armor, readString(section, 'Armor')?.toLowerCase(), source);
    }
    if (!explicitOnly || section.has('Speed')) {
      compareField(mismatches, 'unit', unitName, 'speed', unit.speed, readNumber(section, 'Speed'), source);
    }
    if (!explicitOnly || section.has('Sight')) {
      compareField(mismatches, 'unit', unitName, 'sight', unit.sight, readNumber(section, 'Sight'), source);
    }
    if ((!explicitOnly || section.has('ROT')) && section.has('ROT')) {
      compareField(mismatches, 'unit', unitName, 'rot', unit.rot, readNumber(section, 'ROT'), source);
    }
    const shouldComparePrimary = explicitOnly
      ? section.has('Primary')
      : (sourcePrimary !== undefined || unit.primaryWeapon !== null);
    if (shouldComparePrimary) {
      compareField(mismatches, 'unit', unitName, 'primaryWeapon', actualPrimary, sourcePrimary, source);
    }
    const shouldCompareSecondary = explicitOnly
      ? section.has('Secondary')
      : (
        sourceSecondary !== undefined
          ? !(sourceSecondary === null && unit.secondaryWeapon === undefined)
          : (unit.secondaryWeapon !== undefined && unit.secondaryWeapon !== null)
      );
    if (shouldCompareSecondary) {
      compareField(mismatches, 'unit', unitName, 'secondaryWeapon', actualSecondary, sourceSecondary, source);
    }
    if ((explicitOnly && section.has('Owner')) || (!explicitOnly && unit.owner !== undefined)) {
      compareField(mismatches, 'unit', unitName, 'owner', unit.owner, normalizeOwnerToFaction(readString(section, 'Owner')), source);
    }
    if ((explicitOnly && section.has('Cost')) || (!explicitOnly && unit.cost !== undefined)) {
      compareField(mismatches, 'unit', unitName, 'cost', unit.cost, readNumber(section, 'Cost'), source);
    }
    if ((explicitOnly && section.has('Passengers')) || (!explicitOnly && unit.passengers !== undefined)) {
      compareField(mismatches, 'unit', unitName, 'passengers', unit.passengers, readNumber(section, 'Passengers'), source);
    }
    if ((explicitOnly && section.has('Ammo')) || (!explicitOnly && unit.maxAmmo !== undefined)) {
      compareField(mismatches, 'unit', unitName, 'maxAmmo', unit.maxAmmo, readNumber(section, 'Ammo'), source);
    }
  }
}

function compareWeaponTable(
  mismatches: Mismatch[],
  weapons: Record<string, typeof WEAPON_STATS[string]>,
  sections: Map<string, Map<string, string>>,
  loadedFiles: string[],
  explicitOnly = false,
): void {
  for (const [weaponName, weapon] of Object.entries(weapons)) {
    const mappedSectionName = BASE_WEAPON_SECTION_NAME[weaponName];
    const sourceSectionName = explicitOnly
      ? weaponName
      : (Object.prototype.hasOwnProperty.call(BASE_WEAPON_SECTION_NAME, weaponName) ? mappedSectionName : weaponName);
    if (!sourceSectionName) continue;
    const section = getSection(sections, sourceSectionName);
    if (!section) continue;

    const source = sourceLabel(sourceSectionName, loadedFiles, explicitOnly ? 'scenario override' : undefined);
    if (!explicitOnly || section.has('Damage')) {
      compareField(mismatches, 'weapon', weaponName, 'damage', weapon.damage, readNumber(section, 'Damage'), source);
    }
    if (!explicitOnly || section.has('ROF')) {
      compareField(mismatches, 'weapon', weaponName, 'rof', weapon.rof, readNumber(section, 'ROF'), source);
    }
    if (!explicitOnly || section.has('Range')) {
      compareField(mismatches, 'weapon', weaponName, 'range', weapon.range, readNumber(section, 'Range'), source);
    }
    if (!explicitOnly || section.has('Warhead')) {
      compareField(mismatches, 'weapon', weaponName, 'warhead', weapon.warhead, readString(section, 'Warhead'), source);
    }
    if (!explicitOnly || section.has('Burst')) {
      compareField(mismatches, 'weapon', weaponName, 'burst', weapon.burst ?? 1, readNumber(section, 'Burst') ?? 1, source);
    }
  }
}

function compareWarheadTables(
  mismatches: Mismatch[],
  versesTable: Record<string, [number, number, number, number, number]>,
  metaTable: Record<string, typeof WARHEAD_META[string]>,
  propsTable: Record<string, typeof WARHEAD_PROPS[string]>,
  sections: Map<string, Map<string, string>>,
  loadedFiles: string[],
  explicitOnly = false,
): void {
  for (const [warheadName, verses] of Object.entries(versesTable)) {
    const section = getSection(sections, warheadName);
    if (!section) continue;

    const source = sourceLabel(warheadName, loadedFiles, explicitOnly ? 'scenario override' : undefined);
    if (!explicitOnly || section.has('Verses')) {
      compareField(mismatches, 'warhead', warheadName, 'verses', verses, parseVerses(readString(section, 'Verses')), source);
    }
    if (!explicitOnly || section.has('Spread')) {
      compareField(mismatches, 'warhead', warheadName, 'spreadFactor', metaTable[warheadName].spreadFactor, readNumber(section, 'Spread'), source);
    }
    if (!explicitOnly || section.has('Wall')) {
      compareField(
        mismatches,
        'warhead',
        warheadName,
        'destroysWalls',
        Boolean(metaTable[warheadName].destroysWalls),
        readString(section, 'Wall')?.toLowerCase() === 'yes',
        source,
      );
    }
    if (!explicitOnly || section.has('Wood')) {
      compareField(
        mismatches,
        'warhead',
        warheadName,
        'destroysWood',
        Boolean(metaTable[warheadName].destroysWood),
        readString(section, 'Wood')?.toLowerCase() === 'yes',
        source,
      );
    }
    if (!explicitOnly || section.has('Ore')) {
      compareField(
        mismatches,
        'warhead',
        warheadName,
        'destroysOre',
        Boolean(metaTable[warheadName].destroysOre),
        readString(section, 'Ore')?.toLowerCase() === 'yes',
        source,
      );
    }
    if (!explicitOnly || section.has('InfDeath')) {
      compareField(
        mismatches,
        'warhead',
        warheadName,
        'infantryDeath',
        propsTable[warheadName].infantryDeath,
        readNumber(section, 'InfDeath'),
        source,
      );
    }
  }
}

function compareProductionTable(
  mismatches: Mismatch[],
  items: Array<typeof PRODUCTION_ITEMS[number]>,
  sections: Map<string, Map<string, string>>,
  loadedFiles: string[],
  explicitOnly = false,
): void {
  for (const item of items) {
    const section = getSection(sections, item.type);
    if (!section) continue;

    const source = sourceLabel(item.type, loadedFiles, explicitOnly ? 'scenario override' : undefined);
    if (!explicitOnly || section.has('Cost')) {
      compareField(mismatches, 'production', item.type, 'cost', item.cost, readNumber(section, 'Cost'), source);
    }
    if (!explicitOnly || section.has('TechLevel')) {
      compareField(mismatches, 'production', item.type, 'techLevel', item.techLevel ?? null, readNumber(section, 'TechLevel'), source);
    }
    if (!explicitOnly || section.has('Owner')) {
      compareField(mismatches, 'production', item.type, 'faction', item.faction, normalizeOwnerToFaction(readString(section, 'Owner')), source);
    }
    if (!explicitOnly || section.has('Prerequisite')) {
      const expected = interpretProductionPrerequisites(item, readString(section, 'Prerequisite'));
      compareField(mismatches, 'production', item.type, 'prerequisite', item.prerequisite, expected.prerequisite, source);
      compareField(mismatches, 'production', item.type, 'techPrereq', item.techPrereq ?? null, expected.techPrereq ?? null, source);
    }
  }
}

function compareStructureTables(
  mismatches: Mismatch[],
  structureHp: Record<string, number>,
  structureSize: Record<string, [number, number]>,
  sections: Map<string, Map<string, string>>,
  ruleFiles: string[],
  placedTypes: string[],
  strengthTruth: Record<string, number>,
  sizeTruth: Record<string, [number, number]>,
  buildingDataPath?: string,
): void {
  const allTypes = new Set<string>([
    ...placedTypes,
    ...Object.keys(structureHp),
    ...Object.keys(structureSize),
  ]);
  const placedTypeSet = new Set(placedTypes);

  for (const type of [...allTypes].sort()) {
    const section = getSection(sections, type);
    const expectedHp = readNumber(section, 'Strength') ?? strengthTruth[type];
    if (expectedHp !== undefined || structureHp[type] !== undefined) {
      compareField(
        mismatches,
        'structure',
        type,
        'maxHp',
        structureHp[type] ?? null,
        expectedHp ?? null,
        sourceLabel(type, ruleFiles),
      );
    }

    const expectedSize = sizeTruth[type];
    if (expectedSize !== undefined || structureSize[type] !== undefined) {
      const sizeSource = buildingDataPath
        ? sourceLabel(type, [buildingDataPath], 'C++ building footprint')
        : sourceLabel(type, ruleFiles, 'scenario footprint');
      compareField(
        mismatches,
        'structure',
        type,
        'footprint',
        structureSize[type] ?? null,
        expectedSize ?? null,
        sizeSource,
      );
    } else if (placedTypeSet.has(type)) {
      mismatches.push({
        category: 'structure',
        id: type,
        field: 'footprint',
        actual: structureSize[type] ?? null,
        expected: null,
        source: 'Placed in extracted scenario INIs, but no C++ footprint truth was found',
      });
    }
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const base = loadRedAlertSourceSections(process.cwd(), ['rules', 'aftermath']);
  const scenario = loadRedAlertSourceSections(process.cwd(), ['scenario']);
  const buildingDataPath = path.join(process.cwd(), BUILDING_DATA_RELATIVE_PATH);
  const loadedFiles = [...base.files, ...scenario.files].map(file => file.absolutePath);
  if (fs.existsSync(buildingDataPath)) {
    loadedFiles.push(buildingDataPath);
  }
  const mismatches: Mismatch[] = [];
  const placedStructureTypes = collectPlacedStructureTypes(process.cwd());
  const structureStrengthTruth = collectSectionNumberTruth(process.cwd(), 'Strength');
  const buildingSizeTruth = loadBuildingSizeTruth(process.cwd());

  compareUnitTable(mismatches, UNIT_STATS, base.sections, base.files.map(file => file.absolutePath));
  compareWeaponTable(mismatches, WEAPON_STATS, base.sections, base.files.map(file => file.absolutePath));
  compareWarheadTables(
    mismatches,
    WARHEAD_VS_ARMOR,
    WARHEAD_META,
    WARHEAD_PROPS,
    base.sections,
    base.files.map(file => file.absolutePath),
  );
  compareProductionTable(mismatches, PRODUCTION_ITEMS, base.sections, base.files.map(file => file.absolutePath));
  compareStructureTables(
    mismatches,
    STRUCTURE_MAX_HP,
    STRUCTURE_SIZE,
    base.sections,
    base.files.map(file => file.absolutePath),
    placedStructureTypes,
    structureStrengthTruth,
    buildingSizeTruth,
    fs.existsSync(buildingDataPath) ? buildingDataPath : undefined,
  );

  const scenarioOverrides = buildScenarioRuleOverrides(scenario.sections);
  compareUnitTable(
    mismatches,
    scenarioOverrides.scenarioUnitStats,
    scenario.sections,
    scenario.files.map(file => file.absolutePath),
    true,
  );
  compareWeaponTable(
    mismatches,
    scenarioOverrides.scenarioWeaponStats,
    scenario.sections,
    scenario.files.map(file => file.absolutePath),
    true,
  );
  compareWarheadTables(
    mismatches,
    scenarioOverrides.scenarioWarheadVerses,
    scenarioOverrides.scenarioWarheadMeta,
    scenarioOverrides.scenarioWarheadProps,
    scenario.sections,
    scenario.files.map(file => file.absolutePath),
    true,
  );
  compareProductionTable(
    mismatches,
    scenarioOverrides.scenarioProductionItems,
    scenario.sections,
    scenario.files.map(file => file.absolutePath),
    true,
  );

  const byCategory: Record<Mismatch['category'], number> = {
    unit: 0,
    weapon: 0,
    warhead: 0,
    production: 0,
    structure: 0,
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
    `- Structures: ${byCategory.structure}`,
    '',
    'Top mismatches:',
    ...topMismatches.map(mismatch => `- [${mismatch.category}] ${mismatch.id}.${mismatch.field}: TS=${JSON.stringify(mismatch.actual)} source=${JSON.stringify(mismatch.expected)}`),
    '',
    `Full JSON: ${JSON_OUTPUT}`,
  ].join('\n');
  fs.writeFileSync(MD_OUTPUT, markdown);

  console.log(`Source parity report written to ${JSON_OUTPUT}`);
  console.log(`Mismatch summary: ${report.summary.mismatchCount} total`);
  console.log(`  unit=${byCategory.unit} weapon=${byCategory.weapon} warhead=${byCategory.warhead} production=${byCategory.production} structure=${byCategory.structure}`);
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
