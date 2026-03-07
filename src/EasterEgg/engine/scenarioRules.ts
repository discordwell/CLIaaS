import {
  type ArmorType,
  type Faction,
  PRODUCTION_ITEMS,
  type ProductionItem,
  type UnitStats,
  UNIT_STATS,
  type WarheadMeta,
  WARHEAD_META,
  type WarheadProps,
  WARHEAD_PROPS,
  WARHEAD_VS_ARMOR,
  type WarheadType,
  type WeaponStats,
  WEAPON_STATS,
} from './types';

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

export interface ScenarioRuleOverrides {
  scenarioUnitStats: Record<string, UnitStats>;
  scenarioWeaponStats: Record<string, WeaponStats>;
  scenarioWarheadVerses: Record<string, [number, number, number, number, number]>;
  scenarioWarheadMeta: Record<string, WarheadMeta>;
  scenarioWarheadProps: Record<string, WarheadProps>;
  scenarioProductionItems: ProductionItem[];
}

export function parsePrerequisiteList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);
}

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

function parseArmor(raw: string | undefined): ArmorType | undefined {
  const armor = raw?.toLowerCase();
  if (
    armor === 'none' ||
    armor === 'wood' ||
    armor === 'light' ||
    armor === 'heavy' ||
    armor === 'concrete'
  ) {
    return armor;
  }
  return undefined;
}

function parseVerses(raw: string | undefined): [number, number, number, number, number] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(',')
    .map(value => Number.parseInt(value.trim().replace(/%/g, ''), 10) / 100)
    .filter(value => Number.isFinite(value));

  if (parts.length >= 5) {
    return [parts[0], parts[1], parts[2], parts[3], parts[4]];
  }
  if (parts.length >= 4) {
    return [parts[0], parts[1], parts[2], parts[3], parts[3]];
  }
  return undefined;
}

export function buildScenarioRuleOverrides(
  rawSections: Map<string, Map<string, string>>,
): ScenarioRuleOverrides {
  const scenarioUnitStats: Record<string, UnitStats> = { ...UNIT_STATS };
  const scenarioWeaponStats: Record<string, WeaponStats> = { ...WEAPON_STATS };
  const scenarioWarheadVerses: Record<string, [number, number, number, number, number]> = {};
  const scenarioWarheadMeta: Record<string, WarheadMeta> = { ...WARHEAD_META };
  const scenarioWarheadProps: Record<string, WarheadProps> = { ...WARHEAD_PROPS };
  const scenarioProductionItems = PRODUCTION_ITEMS.map(item => ({ ...item }));

  for (const typeName of Object.keys(UNIT_STATS)) {
    const section = rawSections.get(typeName);
    if (!section) continue;

    const base: UnitStats = { ...UNIT_STATS[typeName] };
    if (section.has('Strength')) base.strength = Number.parseInt(section.get('Strength')!, 10);
    if (section.has('Speed')) base.speed = Number.parseInt(section.get('Speed')!, 10);
    if (section.has('Sight')) base.sight = Number.parseInt(section.get('Sight')!, 10);
    if (section.has('ROT')) base.rot = Number.parseInt(section.get('ROT')!, 10);
    if (section.has('Primary')) base.primaryWeapon = section.get('Primary')!;
    if (section.has('Secondary')) base.secondaryWeapon = section.get('Secondary')!;
    if (section.has('NoMovingFire')) base.noMovingFire = section.get('NoMovingFire')!.toLowerCase() === 'yes';
    if (section.has('Passengers')) base.passengers = Number.parseInt(section.get('Passengers')!, 10);
    if (section.has('GuardRange')) base.guardRange = Number.parseInt(section.get('GuardRange')!, 10);
    if (section.has('Ammo')) base.maxAmmo = Number.parseInt(section.get('Ammo')!, 10);
    if (section.has('Cost')) base.cost = Number.parseInt(section.get('Cost')!, 10);
    if (section.has('Owner')) {
      const owner = normalizeOwnerToFaction(section.get('Owner'));
      if (owner !== undefined) base.owner = owner;
    }
    const armor = parseArmor(section.get('Armor'));
    if (armor) base.armor = armor;
    scenarioUnitStats[typeName] = base;
  }

  const weaponNames = new Set(Object.keys(WEAPON_STATS));
  for (const stats of Object.values(scenarioUnitStats)) {
    if (stats.primaryWeapon) weaponNames.add(stats.primaryWeapon);
    if (stats.secondaryWeapon) weaponNames.add(stats.secondaryWeapon);
  }

  for (const weaponName of weaponNames) {
    const section = rawSections.get(weaponName);
    if (!section) continue;

    const base: WeaponStats = {
      ...(WEAPON_STATS[weaponName] ?? {
        name: weaponName,
        damage: 0,
        rof: 20,
        range: 1,
        warhead: 'HE' as const,
      }),
    };
    if (section.has('Damage')) base.damage = Number.parseInt(section.get('Damage')!, 10);
    if (section.has('ROF')) base.rof = Number.parseInt(section.get('ROF')!, 10);
    if (section.has('Range')) base.range = Number.parseFloat(section.get('Range')!);
    if (section.has('Warhead')) base.warhead = section.get('Warhead')! as WarheadType;
    if (section.has('Burst')) base.burst = Number.parseInt(section.get('Burst')!, 10);
    scenarioWeaponStats[weaponName] = base;
  }

  for (const warheadName of Object.keys(WARHEAD_VS_ARMOR)) {
    const section = rawSections.get(warheadName);
    if (!section) continue;

    const verses = parseVerses(section.get('Verses'));
    if (verses) {
      scenarioWarheadVerses[warheadName] = verses;
    }

    const meta: WarheadMeta = { ...(scenarioWarheadMeta[warheadName] ?? { spreadFactor: 1 }) };
    if (section.has('Spread')) meta.spreadFactor = Number.parseInt(section.get('Spread')!, 10);
    if (section.has('Wall')) meta.destroysWalls = section.get('Wall')!.toLowerCase() === 'yes';
    if (section.has('Wood')) meta.destroysWood = section.get('Wood')!.toLowerCase() === 'yes';
    if (section.has('Ore')) meta.destroysOre = section.get('Ore')!.toLowerCase() === 'yes';
    scenarioWarheadMeta[warheadName] = meta;

    const props: WarheadProps = { ...(scenarioWarheadProps[warheadName] ?? { infantryDeath: 0, explosionSet: 'piff' }) };
    if (section.has('InfDeath')) props.infantryDeath = Number.parseInt(section.get('InfDeath')!, 10);
    scenarioWarheadProps[warheadName] = props;
  }

  for (const item of scenarioProductionItems) {
    const section = rawSections.get(item.type);
    if (!section) continue;

    if (section.has('Cost')) item.cost = Number.parseInt(section.get('Cost')!, 10);
    if (section.has('TechLevel')) item.techLevel = Number.parseInt(section.get('TechLevel')!, 10);
    if (section.has('Owner')) {
      const owner = normalizeOwnerToFaction(section.get('Owner'));
      if (owner !== undefined) item.faction = owner;
    }
    if (section.has('Prerequisite')) {
      const interpreted = interpretProductionPrerequisites(item, section.get('Prerequisite'));
      item.prerequisite = interpreted.prerequisite;
      item.techPrereq = interpreted.techPrereq;
    }
  }

  return {
    scenarioUnitStats,
    scenarioWeaponStats,
    scenarioWarheadVerses,
    scenarioWarheadMeta,
    scenarioWarheadProps,
    scenarioProductionItems,
  };
}
