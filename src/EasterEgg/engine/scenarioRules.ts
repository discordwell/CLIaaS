import {
  type ArmorType,
  type ProductionItem,
  PRODUCTION_ITEMS,
  SpeedClass,
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
import {
  normalizeOwnerToFaction,
  interpretProductionPrerequisites,
  patchProductionItems,
} from './parseIni';

// Re-export for any existing consumers
export { normalizeOwnerToFaction, interpretProductionPrerequisites, parsePrerequisiteList } from './parseIni';

export interface ScenarioRuleOverrides {
  scenarioUnitStats: Record<string, UnitStats>;
  scenarioWeaponStats: Record<string, WeaponStats>;
  scenarioWarheadVerses: Record<string, [number, number, number, number, number]>;
  scenarioWarheadMeta: Record<string, WarheadMeta>;
  scenarioWarheadProps: Record<string, WarheadProps>;
  scenarioProductionItems: ProductionItem[];
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

function parseIniBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'yes' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'no' || normalized === 'false' || normalized === '0') return false;
  return undefined;
}

function iniSpeedToMph(rawSpeed: number): number {
  return Math.max(0, Math.min(255, Math.trunc((rawSpeed * 256) / 100)));
}

function inheritedScenarioSpeed(rawSpeed: number): number {
  // C++ WeaponTypeClass::Read_INI always calls Get_MPHType when the weapon
  // section exists. If Speed is omitted, Get_MPHType converts the inherited
  // MPH default back to a 0-100 integer and then rescales it, so Speed=100
  // round-trips as 255 -> 99 -> 253 rather than staying light-speed.
  const inheritedMph = iniSpeedToMph(rawSpeed);
  return Math.trunc((inheritedMph * 100) / 256);
}

function clearProjectileDerivedWeaponFields(base: WeaponStats): void {
  delete base.projectileSpeed;
  delete base.projectileROT;
  delete base.projectileArm;
  delete base.isArcing;
  delete base.isHigh;
  delete base.isDropping;
  delete base.isParachuted;
  delete base.isInaccurate;
  delete base.isInvisible;
  delete base.isFueled;
  delete base.isAntiAir;
  delete base.isAntiGround;
  delete base.isSubSurface;
  delete base.isAntiSub;
  delete base.isFlameEquipped;
  delete base.isGigundo;
  delete base.isDegenerate;
}

function rawSectionCaseInsensitive(
  rawSections: Map<string, Map<string, string>>,
  sectionName: string,
): Map<string, string> | undefined {
  const direct = rawSections.get(sectionName);
  if (direct) return direct;
  const normalized = sectionName.toLowerCase();
  for (const [name, section] of rawSections) {
    if (name.toLowerCase() === normalized) return section;
  }
  return undefined;
}

function applyProjectileSectionOverrides(
  base: WeaponStats,
  section: Map<string, string> | undefined,
): void {
  if (!section) return;
  if (section.has('Arm')) base.projectileArm = Number.parseInt(section.get('Arm')!, 10);
  if (section.has('ROT')) base.projectileROT = Number.parseInt(section.get('ROT')!, 10);

  const boolFields: Array<[string, keyof WeaponStats]> = [
    ['High', 'isHigh'],
    ['Dropping', 'isDropping'],
    ['Parachuted', 'isParachuted'],
    ['Inaccurate', 'isInaccurate'],
    ['Inviso', 'isInvisible'],
    ['Ranged', 'isFueled'],
    ['AA', 'isAntiAir'],
    ['AG', 'isAntiGround'],
    ['UnderWater', 'isSubSurface'],
    ['ASW', 'isAntiSub'],
    ['Gigundo', 'isGigundo'],
    ['Degenerates', 'isDegenerate'],
  ];

  for (const [iniKey, statsKey] of boolFields) {
    if (!section.has(iniKey)) continue;
    const parsed = parseIniBool(section.get(iniKey));
    if (parsed !== undefined) {
      (base as unknown as Record<string, unknown>)[statsKey] = parsed;
    }
  }
}

function applyProjectileOverride(
  base: WeaponStats,
  projectileRaw: string | undefined,
  rawSections: Map<string, Map<string, string>>,
): void {
  if (!projectileRaw) return;
  const projectile = projectileRaw.trim().toLowerCase();

  clearProjectileDerivedWeaponFields(base);

  switch (projectile) {
    case 'invisible':
    case 'inivisble':
      base.isInvisible = true;
      break;
    case 'heatseeker':
      base.projectileArm = 2;
      base.projectileROT = 5;
      base.isAntiAir = true;
      base.isHigh = true;
      base.isFueled = true;
      base.isInaccurate = true;
      break;
    case 'aamissile':
      base.projectileArm = 3;
      base.projectileROT = 20;
      base.isAntiAir = true;
      base.isAntiGround = false;
      base.isHigh = true;
      base.isFueled = true;
      break;
    case 'laserguided':
      base.projectileArm = 3;
      base.projectileROT = 20;
      base.isAntiAir = true;
      base.isHigh = true;
      base.isFueled = true;
      break;
    case 'frog':
      base.projectileArm = 10;
      base.projectileROT = 5;
      base.isHigh = true;
      base.isFueled = true;
      base.isInaccurate = true;
      break;
    case 'lobbed':
    case 'ballistic':
      base.isArcing = true;
      base.isHigh = true;
      base.isInaccurate = true;
      break;
    case 'catapult':
      base.isArcing = true;
      base.isHigh = true;
      base.isInaccurate = true;
      base.isAntiSub = true;
      base.isAntiGround = false;
      break;
    case 'bomblet':
      base.projectileArm = 24;
      base.isDropping = true;
      base.isHigh = true;
      break;
    case 'parachute':
      base.projectileArm = 24;
      base.isDropping = true;
      base.isParachuted = projectile === 'parachute';
      base.isHigh = true;
      break;
    case 'fireball':
      base.isFlameEquipped = true;
      break;
    case 'torpedo':
      base.projectileSpeed = 1.0;
      base.isSubSurface = true;
      base.isAntiSub = true;
      break;
    case 'leapdog':
      base.projectileROT = 20;
      break;
    case 'cannon':
    default:
      break;
  }

  applyProjectileSectionOverrides(
    base,
    rawSectionCaseInsensitive(rawSections, projectileRaw.trim()),
  );
}

export function buildScenarioRuleOverrides(
  rawSections: Map<string, Map<string, string>>,
): ScenarioRuleOverrides {
  const scenarioUnitStats: Record<string, UnitStats> = { ...UNIT_STATS };
  const scenarioWeaponStats: Record<string, WeaponStats> = { ...WEAPON_STATS };
  const scenarioWarheadVerses: Record<string, [number, number, number, number, number]> = {};
  const scenarioWarheadMeta: Record<string, WarheadMeta> = { ...WARHEAD_META };
  const scenarioWarheadProps: Record<string, WarheadProps> = { ...WARHEAD_PROPS };

  // Patch base items with any scenario-specific overrides
  const scenarioProductionItems = patchProductionItems(
    PRODUCTION_ITEMS,
    rawSections,
  );

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
    if (section.has('Tracked') && !base.isInfantry && !base.isAircraft && !base.isVessel) {
      const tracked = parseIniBool(section.get('Tracked'));
      if (tracked !== undefined) {
        base.speedClass = tracked ? SpeedClass.TRACK : SpeedClass.WHEEL;
      }
    }
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
    if (section.has('Speed')) {
      base.projSpeed = Number.parseInt(section.get('Speed')!, 10);
    } else if (base.projSpeed !== undefined) {
      base.projSpeed = inheritedScenarioSpeed(base.projSpeed);
    }
    if (section.has('Projectile')) applyProjectileOverride(base, section.get('Projectile'), rawSections);
    if (section.has('Warhead')) base.warhead = section.get('Warhead')! as WarheadType;
    if (section.has('Burst')) base.burst = Number.parseInt(section.get('Burst')!, 10);
    if (section.has('Supress')) {
      const isSupressed = parseIniBool(section.get('Supress'));
      if (isSupressed !== undefined) base.isSupressed = isSupressed;
    }
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

    const props: WarheadProps = { ...(scenarioWarheadProps[warheadName] ?? { infantryDeath: 0, explosionSet: 0 }) };
    if (section.has('InfDeath')) props.infantryDeath = Number.parseInt(section.get('InfDeath')!, 10);
    scenarioWarheadProps[warheadName] = props;
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
