import {
  House,
  SuperweaponType,
  SUPERWEAPON_DEFS,
  type ProductionItem,
  type SidebarItem,
  type SidebarSpecialItem,
  type SuperweaponState,
  getFactoryType,
  isSidebarSpecialItem,
} from './types';

// C++ defines.h StructType enum order, mapped to TS INI codes.
// BuildingClass::Update_Buildables iterates this order and StripClass::Add appends.
const CPP_STRUCT_ORDER = [
  'ATEK', 'IRON', 'WEAP', 'PDOX', 'PBOX', 'HBOX', 'DOME', 'GAP',
  'GUN', 'AGUN', 'FTUR', 'FACT', 'PROC', 'SILO', 'HPAD', 'SAM',
  'AFLD', 'POWR', 'APWR', 'STEK', 'HOSP', 'BARR', 'TENT', 'KENN',
  'FIX', 'BIO', 'MISS', 'SYRD', 'SPEN', 'MSLO', 'FCOM', 'TSLA',
  'WEAF', 'FACF', 'SYRF', 'SPEF', 'DOMF', 'SBAG', 'CYCL', 'BRIK',
  'BARB', 'WOOD', 'FENC', 'MINV', 'MINP',
] as const;

// C++ defines.h UnitType enum order.
const CPP_UNIT_ORDER = [
  '4TNK', '3TNK', '2TNK', '1TNK', 'APC', 'MNLY', 'JEEP', 'HARV',
  'ARTY', 'MRJ', 'MGG', 'MCV', 'V2RL', 'TRUK', 'CTNK', 'TTNK',
  'QTNK', 'DTRK', 'STNK',
] as const;

// C++ defines.h InfantryType enum order.
const CPP_INFANTRY_ORDER = [
  'E1', 'E2', 'E3', 'E4', 'E6', 'E7', 'SPY', 'THF', 'MEDI',
  'GNRL', 'DOG', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7',
  'C8', 'C9', 'C10', 'EINSTEIN', 'DELPHI', 'CHAN', 'SHOK', 'MECH',
] as const;

// C++ defines.h VesselType and AircraftType enum order.
const CPP_VESSEL_ORDER = ['SS', 'DD', 'CA', 'LST', 'PT', 'MSUB', 'CARR'] as const;
const CPP_AIRCRAFT_ORDER = ['TRAN', 'BADR', 'U2', 'MIG', 'YAK', 'HELI', 'HIND'] as const;

export const SPECIAL_WEAPON_ICON: Record<SuperweaponType, string> = {
  // const.cpp SpecialWeaponFile[] + "ICON"
  [SuperweaponType.SONAR_PULSE]: 'sonricon',
  [SuperweaponType.NUKE]: 'atomicon',
  [SuperweaponType.CHRONOSPHERE]: 'warpicon',
  [SuperweaponType.PARABOMB]: 'pbmbicon',
  [SuperweaponType.PARAINFANTRY]: 'pinficon',
  [SuperweaponType.SPY_PLANE]: 'camicon',
  [SuperweaponType.IRON_CURTAIN]: 'infxicon',
  [SuperweaponType.GPS_SATELLITE]: 'gpssicon',
};

const SPECIAL_ORDER = [
  SuperweaponType.SONAR_PULSE,
  SuperweaponType.NUKE,
  SuperweaponType.CHRONOSPHERE,
  SuperweaponType.PARABOMB,
  SuperweaponType.PARAINFANTRY,
  SuperweaponType.SPY_PLANE,
  SuperweaponType.IRON_CURTAIN,
  SuperweaponType.GPS_SATELLITE,
] as const;

function orderMap(values: readonly string[]): Map<string, number> {
  return new Map(values.map((value, index) => [value, index]));
}

const STRUCT_ORDER = orderMap(CPP_STRUCT_ORDER);
const UNIT_ORDER = orderMap(CPP_UNIT_ORDER);
const INFANTRY_ORDER = orderMap(CPP_INFANTRY_ORDER);
const VESSEL_ORDER = orderMap(CPP_VESSEL_ORDER);
const AIRCRAFT_ORDER = orderMap(CPP_AIRCRAFT_ORDER);
const SPECIAL_ORDER_INDEX = new Map<SuperweaponType, number>(
  SPECIAL_ORDER.map((value, index) => [value, index]),
);

function productionOrderKey(item: ProductionItem): number {
  if (item.isStructure) return 10_000 + (STRUCT_ORDER.get(item.type) ?? 9_999);

  const factory = getFactoryType(item);
  switch (factory) {
    case 'vessel':
      return 20_000 + (VESSEL_ORDER.get(item.type) ?? 9_999);
    case 'unit':
      return 30_000 + (UNIT_ORDER.get(item.type) ?? 9_999);
    case 'infantry':
      return 40_000 + (INFANTRY_ORDER.get(item.type) ?? 9_999);
    case 'aircraft':
      return 50_000 + (AIRCRAFT_ORDER.get(item.type) ?? 9_999);
    default:
      return 90_000;
  }
}

function itemKey(item: SidebarItem): string {
  return isSidebarSpecialItem(item)
    ? `special:${item.specialHouse}:${item.specialType}`
    : `production:${item.type}`;
}

function sidebarOrderKey(item: SidebarItem): number {
  if (isSidebarSpecialItem(item)) {
    return SPECIAL_ORDER_INDEX.get(item.specialType) ?? 9_999;
  }
  return productionOrderKey(item);
}

export function sortProductionItemsForCppSidebar(items: readonly ProductionItem[]): ProductionItem[] {
  return [...items].sort((a, b) => {
    const orderDelta = productionOrderKey(a) - productionOrderKey(b);
    return orderDelta !== 0 ? orderDelta : a.type.localeCompare(b.type);
  });
}

export function makeSidebarSpecialItem(state: SuperweaponState): SidebarSpecialItem {
  const def = SUPERWEAPON_DEFS[state.type];
  return {
    type: `SPECIAL:${state.type}`,
    name: def?.name ?? state.type,
    specialType: state.type,
    specialHouse: state.house,
    iconName: SPECIAL_WEAPON_ICON[state.type],
  };
}

export function getPlayerSidebarSpecialItems(
  superweapons: ReadonlyMap<string, SuperweaponState>,
  playerHouse: House,
  isAllied: (a: House, b: House) => boolean,
): SidebarSpecialItem[] {
  const result: SidebarSpecialItem[] = [];
  for (const [, state] of superweapons) {
    if (!isAllied(state.house, playerHouse)) continue;
    if (state.type === SuperweaponType.GPS_SATELLITE && state.fired) continue;
    result.push(makeSidebarSpecialItem(state));
  }
  return result.sort((a, b) => sidebarOrderKey(a) - sidebarOrderKey(b));
}

export function buildCppSidebarCandidates(
  availableItems: readonly ProductionItem[],
  specialItems: readonly SidebarSpecialItem[],
): SidebarItem[] {
  return [
    ...[...specialItems].sort((a, b) => sidebarOrderKey(a) - sidebarOrderKey(b)),
    ...sortProductionItemsForCppSidebar(availableItems),
  ];
}

export function reconcileCppSidebarItems(
  previous: readonly SidebarItem[],
  availableItems: readonly ProductionItem[],
  specialItems: readonly SidebarSpecialItem[],
): SidebarItem[] {
  const candidates = buildCppSidebarCandidates(availableItems, specialItems);
  const candidateByKey = new Map(candidates.map(item => [itemKey(item), item]));
  const kept: SidebarItem[] = [];
  const keptKeys = new Set<string>();

  for (const oldItem of previous) {
    const key = itemKey(oldItem);
    const current = candidateByKey.get(key);
    if (!current) continue;
    kept.push(current);
    keptKeys.add(key);
  }

  const additions = candidates.filter(item => !keptKeys.has(itemKey(item)));
  return [...kept, ...additions];
}
