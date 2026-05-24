import { CELL_SIZE, LEPTON_SIZE, COS_TABLE_256, SIN_TABLE_256, SUBCELL_LEPTON_OFFSETS, leptonDist } from './types';
import { type Effect } from './renderer';
import { ScenarioRandom } from './random';
import { TREE_CENTER_OFFSET, type GameMap, type MapTree } from './map';

export type LogicAnimType =
  | 'napalm1'
  | 'napalm2'
  | 'napalm3'
  | 'elect_die'
  | 'fire_small'
  | 'fire_med'
  | 'fire_med2'
  | 'burn_small'
  | 'burn_med'
  | 'burn_big'
  | 'on_fire_small'
  | 'on_fire_med'
  | 'on_fire_big'
  | 'oilfield_burn'
  | 'smoke_m'
  | 'smokey'
  | 'fball_fade'
  | 'piff'
  | 'piffpiff'
  | 'flak'
  | 'fball1'
  | 'frag1'
  | 'veh-hit1'
  | 'veh-hit2'
  | 'art-exp1'
  | 'atomsfx';

export interface LogicAnim {
  type: LogicAnimType;
  x: number;
  y: number;
  stage: number;
  timer: number;
  loops: number;
  delay: number;
  isBrandNew: boolean;
  logicIndexHint?: number;
  attachedEntityId?: number;
  attachedStructureIndex?: number;
  attachedTreeKey?: number;
  damageAccumRaw?: number;
  createdLogicTick?: number;
  deleteOnNextProcess?: boolean;
  processedLogicTick?: number;
}

type AllocateLogicIndex = () => number | undefined;
type ReserveAnimSlot = () => boolean;
type ReleaseTerrainLogicSlot = (terrain: MapTree) => void;
type DamageAttachedStructure = (attachedStructureIndex: number, damage: number) => boolean;

interface LogicAnimDef {
  sprite: string;
  biggest: number;
  stages: number;
  loops: number;
  rate: number;
  scorcher: boolean;
  crater?: boolean;
  loopStart?: number;
  loopEnd?: number;
  chainTo?: LogicAnimType;
  damageRawPerTick?: number;
}

const GROUND_LAYER_LOGIC_ANIMS = new Set<LogicAnimType>([
  'elect_die',
  'fire_small',
  'fire_med',
  'fire_med2',
  'burn_small',
  'burn_med',
  'burn_big',
  'on_fire_small',
  'on_fire_med',
  'on_fire_big',
  'oilfield_burn',
  'smoke_m',
]);

const LOGIC_ANIM_DEFS: Record<LogicAnimType, LogicAnimDef> = {
  // C++ adata.cpp ANIM_NAPALM1/2/3: Biggest=5, Delay=1, Loops=1, IsScorcher=true.
  napalm1: { sprite: 'napalm1', biggest: 5, stages: 14, loops: 1, rate: 1, scorcher: true },
  napalm2: { sprite: 'napalm2', biggest: 5, stages: 14, loops: 1, rate: 1, scorcher: true },
  napalm3: { sprite: 'napalm3', biggest: 5, stages: 14, loops: 1, rate: 1, scorcher: true },
  // C++ adata.cpp ANIM_ELECT_DIE: Biggest=0, LoopEnd=3, Stages=-1
  // (runtime SHP frame count is 14), Loops=5, IsScorcher=true,
  // ChainTo=ANIM_FIRE_MED.
  elect_die: { sprite: 'electro', biggest: 0, stages: 14, loops: 5, rate: 1, scorcher: true, loopStart: 0, loopEnd: 3, chainTo: 'fire_med' },
  // C++ adata.cpp: ANIM_FIRE_SMALL is FIRE3 and does not scorch; FIRE_MED/FIRE_MED2 do.
  fire_small: { sprite: 'fire3', biggest: 0, stages: 15, loops: 2, rate: 1, scorcher: false, damageRawPerTick: 8 },
  fire_med: { sprite: 'fire2', biggest: 0, stages: 15, loops: 3, rate: 1, scorcher: true, damageRawPerTick: 16 },
  fire_med2: { sprite: 'fire1', biggest: 0, stages: 15, loops: 3, rate: 1, scorcher: true, damageRawPerTick: 16 },
  // C++ adata.cpp: ANIM_BURN_* are generic burn anims used by TerrainClass::Catch_Fire.
  // They use the same SHP files as ON_FIRE_* but do not chain down into smaller fires/smoke.
  burn_small: { sprite: 'burn-s', biggest: 13, stages: 65, loops: 4, rate: 2, scorcher: false, loopStart: 30, loopEnd: 62, damageRawPerTick: 8 },
  burn_med: { sprite: 'burn-m', biggest: 13, stages: 67, loops: 4, rate: 2, scorcher: false, loopStart: 30, loopEnd: 62, damageRawPerTick: 16 },
  burn_big: { sprite: 'burn-l', biggest: 13, stages: 67, loops: 4, rate: 2, scorcher: true, loopStart: 30, loopEnd: 62, damageRawPerTick: 25 },
  // C++ adata.cpp: ANIM_ON_FIRE_* are attached building/vehicle burn anims.
  // They are distinct from FIRE1/2/3: delayed frame rate, Biggest=13, long
  // loop band, and chain down into smoke/smaller burn classes.
  on_fire_small: { sprite: 'burn-s', biggest: 13, stages: 65, loops: 4, rate: 2, scorcher: false, loopStart: 30, loopEnd: 62, chainTo: 'smoke_m', damageRawPerTick: 8 },
  on_fire_med: { sprite: 'burn-m', biggest: 13, stages: 67, loops: 4, rate: 2, scorcher: false, loopStart: 30, loopEnd: 62, chainTo: 'on_fire_small', damageRawPerTick: 16 },
  on_fire_big: { sprite: 'burn-l', biggest: 13, stages: 67, loops: 4, rate: 2, scorcher: true, loopStart: 30, loopEnd: 62, chainTo: 'on_fire_med', damageRawPerTick: 25 },
  // C++ adata.cpp: ANIM_OILFIELD_BURN (FLMSPT) uses an unsigned-char loop
  // counter, so Class->Loops=65535 is observed as 255 in the heap dump.
  oilfield_burn: { sprite: 'flmspt', biggest: 58, stages: 66, loops: 255, rate: 1, scorcher: false, loopStart: 33, loopEnd: 99 },
  smoke_m: { sprite: 'smoke_m', biggest: 30, stages: 91, loops: 6, rate: 1, scorcher: false, loopStart: 67, loopEnd: 91 },
  // C++ bullet.cpp:381-385 projectile trail AnimClass objects. They are real
  // Logic/Anim heap entries even though they have no gameplay Middle side
  // effects; their lifetime affects later AnimClass allocation failure.
  smokey: { sprite: 'smokey', biggest: 2, stages: 7, loops: 1, rate: 1, scorcher: false },
  fball_fade: { sprite: 'napalm1', biggest: 1, stages: 4, loops: 1, rate: 1, scorcher: false },
  // C++ combat impact animations for small-arms and anti-air bursts. They are
  // real AnimClass/Logic entries even though they have no crater/scorch side effects.
  piff: { sprite: 'piff', biggest: 1, stages: 4, loops: 1, rate: 1, scorcher: false },
  piffpiff: { sprite: 'piffpiff', biggest: 2, stages: 8, loops: 1, rate: 1, scorcher: false },
  flak: { sprite: 'flak', biggest: 7, stages: 8, loops: 1, rate: 1, scorcher: false },
  // C++ adata.cpp crater-forming combat animations. AnimClass::Middle calls
  // CellClass::Reduce_Tiberium(6) and places SMUDGE_CRATER1.
  fball1: { sprite: 'fball1', biggest: 6, stages: 18, loops: 1, rate: 1, scorcher: false, crater: true },
  frag1: { sprite: 'frag1', biggest: 3, stages: 14, loops: 1, rate: 1, scorcher: false, crater: true },
  'veh-hit1': { sprite: 'veh-hit1', biggest: 4, stages: 17, loops: 1, rate: 1, scorcher: false, crater: true },
  'veh-hit2': { sprite: 'veh-hit2', biggest: 1, stages: 22, loops: 1, rate: 1, scorcher: false, crater: true },
  'art-exp1': { sprite: 'art-exp1', biggest: 1, stages: 22, loops: 1, rate: 1, scorcher: false, crater: true },
  atomsfx: { sprite: 'atomsfx', biggest: 19, stages: 27, loops: 0, rate: 1, scorcher: true, crater: true },
};

export function logicAnimTypeForSprite(sprite: string | undefined): LogicAnimType | null {
  switch (sprite) {
    case 'napalm1': return 'napalm1';
    case 'napalm2': return 'napalm2';
    case 'napalm3': return 'napalm3';
    case 'fire1': return 'fire_med2';
    case 'fire2': return 'fire_med';
    case 'fire3': return 'fire_small';
    case 'burn-s': return 'on_fire_small';
    case 'burn-m': return 'on_fire_med';
    case 'burn-l': return 'on_fire_big';
    case 'flmspt': return 'oilfield_burn';
    case 'smoke_m': return 'smoke_m';
    case 'smokey': return 'smokey';
    case 'fball1': return 'fball1';
    case 'piff': return 'piff';
    case 'piffpiff': return 'piffpiff';
    case 'flak': return 'flak';
    case 'frag1': return 'frag1';
    case 'veh-hit1': return 'veh-hit1';
    case 'veh-hit2': return 'veh-hit2';
    case 'art-exp1': return 'art-exp1';
    case 'atomsfx': return 'atomsfx';
    default: return null;
  }
}

export function logicAnimRenderSpec(type: LogicAnimType): { sprite: string; groundLayer: boolean } {
  return {
    sprite: LOGIC_ANIM_DEFS[type].sprite,
    groundLayer: GROUND_LAYER_LOGIC_ANIMS.has(type),
  };
}

export function spawnLogicAnimForSprite(
  logicAnims: LogicAnim[],
  effects: Effect[],
  sprite: string | undefined,
  x: number,
  y: number,
  render = false,
  brandNewAlreadyProcessed = false,
  logicIndexHint?: number,
  allocateLogicIndex?: AllocateLogicIndex,
  reserveAnimSlot?: ReserveAnimSlot,
): boolean {
  const type = logicAnimTypeForSprite(sprite);
  if (!type) return false;
  return spawnLogicAnim(
    logicAnims, effects, type, x, y, 1, render,
    brandNewAlreadyProcessed, logicIndexHint, allocateLogicIndex, reserveAnimSlot,
  );
}

export function spawnLogicAnim(
  logicAnims: LogicAnim[],
  effects: Effect[],
  type: LogicAnimType,
  x: number,
  y: number,
  loop = 1,
  render = true,
  brandNewAlreadyProcessed = false,
  logicIndexHint?: number,
  allocateLogicIndex?: AllocateLogicIndex,
  reserveAnimSlot?: ReserveAnimSlot,
  animSlotReserved = false,
  attachedStructureIndex?: number,
  delay = 0,
  attachedTreeKey?: number,
  createdLogicTick?: number,
): boolean {
  if (!animSlotReserved && reserveAnimSlot && !reserveAnimSlot()) return false;

  const def = LOGIC_ANIM_DEFS[type];
  const anim: LogicAnim = {
    type,
    x,
    y,
    stage: 0,
    timer: def.rate,
    loops: Math.max(1, loop) * def.loops,
    delay,
    isBrandNew: !brandNewAlreadyProcessed,
    logicIndexHint,
    attachedStructureIndex,
    attachedTreeKey,
    createdLogicTick,
  };
  logicAnims.push(anim);
  void render;
  if (delay === 0) logicAnimStart(anim, logicAnims, effects, undefined, allocateLogicIndex, reserveAnimSlot, createdLogicTick);
  return true;
}

export function processLogicAnim(
  anim: LogicAnim,
  logicAnims: LogicAnim[],
  effects: Effect[],
  map?: GameMap,
  allocateLogicIndex?: AllocateLogicIndex,
  reserveAnimSlot?: ReserveAnimSlot,
  releaseTerrainLogicSlot?: ReleaseTerrainLogicSlot,
  damageAttachedStructure?: DamageAttachedStructure,
  currentTick?: number,
): boolean {
  if (anim.deleteOnNextProcess) {
    removeLinkedRenderEffects(anim, effects);
    fireOutAttachedTree(anim, logicAnims, effects, map, allocateLogicIndex, reserveAnimSlot, releaseTerrainLogicSlot);
    return false;
  }

  if (anim.isBrandNew) {
    // C++ anim.cpp:677-680 — brand-new anims skip their first Logic pass.
    anim.isBrandNew = false;
    return true;
  }

  if (anim.delay > 0) {
    anim.delay--;
    if (anim.delay === 0) logicAnimStart(anim, logicAnims, effects, map, allocateLogicIndex, reserveAnimSlot, currentTick);
    return true;
  }

  const def = LOGIC_ANIM_DEFS[anim.type];
  if (anim.timer > 0) anim.timer--;
  if (anim.timer > 0) return true;

  // C++ StageClass::Graphic_Logic: when the stage timer expires, advance one frame
  // and reset it to the animation Rate.
  anim.stage++;
  anim.timer = def.rate;

  if (anim.attachedStructureIndex !== undefined && def.damageRawPerTick !== undefined) {
    anim.damageAccumRaw = (anim.damageAccumRaw ?? 0) + def.damageRawPerTick;
    const damage = Math.trunc(anim.damageAccumRaw / 256);
    if (damage > 0) {
      anim.damageAccumRaw -= damage * 256;
      if (damageAttachedStructure?.(anim.attachedStructureIndex, damage)) {
        removeLinkedRenderEffects(anim, effects);
        return false;
      }
    }
  }

  if (def.biggest > 0 && anim.stage === def.biggest) {
    logicAnimMiddle(anim, logicAnims, effects, map, allocateLogicIndex, reserveAnimSlot, currentTick);
  }

  // C++ anim.cpp:758 — while Loops > 1, loop at LoopEnd-Start; on the
  // final loop (Loops <= 1), play through the full runtime frame count.
  const terminalStage = anim.loops > 1 && def.loopEnd !== undefined
    ? def.loopEnd
    : def.stages;
  if (anim.stage >= terminalStage) {
    if (anim.loops > 0) anim.loops--;
    if (anim.loops > 0) {
      anim.stage = def.loopStart ?? 0;
      anim.timer = def.rate;
      return true;
    }
    if (def.chainTo) {
      const chainDef = LOGIC_ANIM_DEFS[def.chainTo];
      anim.type = def.chainTo;
      anim.stage = 0;
      anim.timer = chainDef.rate;
      anim.loops = chainDef.loops;
      anim.delay = 0;
      anim.damageAccumRaw = 0;
      logicAnimStart(anim, logicAnims, effects, map, allocateLogicIndex, reserveAnimSlot, currentTick);
      return true;
    }
    removeLinkedRenderEffects(anim, effects);
    fireOutAttachedTree(anim, logicAnims, effects, map, allocateLogicIndex, reserveAnimSlot, releaseTerrainLogicSlot);
    return false;
  }

  return true;
}

function removeLinkedRenderEffects(anim: LogicAnim, effects: Effect[]): void {
  if (anim.logicIndexHint === undefined) return;
  for (let i = effects.length - 1; i >= 0; i--) {
    if (effects[i].logicIndexHint === anim.logicIndexHint) {
      effects.splice(i, 1);
    }
  }
}

function fireOutAttachedTree(
  anim: LogicAnim,
  logicAnims: LogicAnim[],
  effects: Effect[],
  map?: GameMap,
  allocateLogicIndex?: AllocateLogicIndex,
  reserveAnimSlot?: ReserveAnimSlot,
  releaseTerrainLogicSlot?: ReleaseTerrainLogicSlot,
): void {
  if (anim.attachedTreeKey === undefined || !map) return;
  const hasOtherAttachedAnim = logicAnims.some(other =>
    other !== anim &&
    other.attachedTreeKey === anim.attachedTreeKey &&
    !other.deleteOnNextProcess);
  if (hasOtherAttachedAnim) return;

  const tree = map.trees.get(anim.attachedTreeKey);
  if (!tree?.isOnFire) return;
  tree.isOnFire = false;

  if (!tree.isCrumbling && tree.hp <= 0) {
    tree.isCrumbling = true;
    const centerOff = TREE_CENTER_OFFSET[tree.type] ?? [CELL_SIZE / 2, CELL_SIZE / 2];
    const x = tree.cx * CELL_SIZE + centerOff[0];
    const y = tree.cy * CELL_SIZE + centerOff[1];
    map.destroyTree(tree);
    releaseTerrainLogicSlot?.(tree);
    spawnLogicAnim(
      logicAnims,
      effects,
      'smoke_m',
      x,
      y,
      1,
      true,
      false,
      allocateLogicIndex?.(),
      allocateLogicIndex,
      reserveAnimSlot,
    );
  }
}

function logicAnimStart(
  anim: LogicAnim,
  logicAnims: LogicAnim[],
  effects: Effect[],
  map?: GameMap,
  allocateLogicIndex?: AllocateLogicIndex,
  reserveAnimSlot?: ReserveAnimSlot,
  currentTick?: number,
): void {
  const def = LOGIC_ANIM_DEFS[anim.type];
  // C++ anim.cpp:914-916 — animations whose Biggest stage is frame 0 run Middle
  // immediately from Start(), including FIRE_MED spawning FIRE_SMALL.
  if (def.biggest === 0) {
    logicAnimMiddle(anim, logicAnims, effects, map, allocateLogicIndex, reserveAnimSlot, currentTick);
  }
}

function logicAnimMiddle(
  anim: LogicAnim,
  logicAnims: LogicAnim[],
  effects: Effect[],
  map?: GameMap,
  allocateLogicIndex?: AllocateLogicIndex,
  reserveAnimSlot?: ReserveAnimSlot,
  currentTick?: number,
): void {
  const def = LOGIC_ANIM_DEFS[anim.type];

  // C++ anim.cpp:954-956 — scorcher animations create a random scorch smudge.
  if (def.scorcher) {
    const scorch = ScenarioRandom.nextInRange(1, 6);
    if (map) {
      map.addSmudge(`sc${scorch}`, Math.floor(anim.x / CELL_SIZE), Math.floor(anim.y / CELL_SIZE));
    }
  }

  if (def.crater && map) {
    const cx = Math.floor(anim.x / CELL_SIZE);
    const cy = Math.floor(anim.y / CELL_SIZE);
    map.reduceOreLevels(cx, cy, 6);
    map.addSmudge(craterSmudgeTypeForCoord(anim.x, anim.y), cx, cy);
  }

  switch (anim.type) {
    case 'napalm1':
    case 'napalm2':
    case 'napalm3': {
      // C++ anim.cpp:986-993. AnimClass::operator new runs before constructor
      // args; when allocation succeeds, the old compiler evaluates coordinate
      // then loop RNG. SCG07EA t182 verifies the successful allocation ordering.
      spawnScatteredLogicAnim(
        logicAnims, effects, 'fire_small', anim.x, anim.y, 0x0040,
        true, false, allocateLogicIndex, reserveAnimSlot, currentTick,
      );
      if (ScenarioRandom.percentChance(50)) {
        spawnScatteredLogicAnim(
          logicAnims, effects, 'fire_small', anim.x, anim.y, 0x00A0,
          true, false, allocateLogicIndex, reserveAnimSlot, currentTick,
        );
      }
      if (ScenarioRandom.percentChance(50)) {
        spawnScatteredLogicAnim(
          logicAnims, effects, 'fire_med', anim.x, anim.y, 0x0070,
          true, false, allocateLogicIndex, reserveAnimSlot, currentTick,
        );
      }
      break;
    }

    case 'fire_med':
    case 'fire_med2':
      // C++ anim.cpp:998-1003 — medium fire chains into a small fire animation.
      spawnLogicAnimWithDeferredLoop(
        logicAnims,
        effects,
        'fire_small',
        anim.x,
        anim.y,
        () => ScenarioRandom.nextInRange(1, 2),
        true,
        false,
        allocateLogicIndex?.(),
        allocateLogicIndex,
        reserveAnimSlot,
        anim.attachedStructureIndex,
        currentTick,
      );
      break;

    default:
      break;
  }
}

function spawnScatteredLogicAnim(
  logicAnims: LogicAnim[],
  effects: Effect[],
  type: LogicAnimType,
  x: number,
  y: number,
  radiusLeptons: number,
  render = true,
  brandNewAlreadyProcessed = false,
  allocateLogicIndex?: AllocateLogicIndex,
  reserveAnimSlot?: ReserveAnimSlot,
  createdLogicTick?: number,
): boolean {
  // C++ source in this repo passes Coord_Scatter(...) and Random_Pick(1,2)
  // inline to new AnimClass(...). Allocation failure therefore skips both RNG
  // arguments while the surrounding Percent_Chance gates still run.
  if (reserveAnimSlot && !reserveAnimSlot()) return false;
  const point = closestFreeSpotAny(coordScatter(x, y, radiusLeptons));
  const loop = ScenarioRandom.nextInRange(1, 2);
  return spawnLogicAnim(
    logicAnims,
    effects,
    type,
    point.x,
    point.y,
    loop,
    render,
    brandNewAlreadyProcessed,
    allocateLogicIndex?.(),
    allocateLogicIndex,
    reserveAnimSlot,
    true,
    undefined,
    0,
    undefined,
    createdLogicTick,
  );
}

function spawnLogicAnimWithDeferredLoop(
  logicAnims: LogicAnim[],
  effects: Effect[],
  type: LogicAnimType,
  x: number,
  y: number,
  loopFactory: () => number,
  render = true,
  brandNewAlreadyProcessed = false,
  logicIndexHint?: number,
  allocateLogicIndex?: AllocateLogicIndex,
  reserveAnimSlot?: ReserveAnimSlot,
  attachedStructureIndex?: number,
  createdLogicTick?: number,
): boolean {
  // C++ new-expression allocation calls AnimClass::operator new before
  // evaluating constructor arguments. FIRE_MED passes Random_Pick(1,2) inline,
  // so a full AnimClass heap must skip that RNG call.
  if (reserveAnimSlot && !reserveAnimSlot()) return false;
  return spawnLogicAnim(
    logicAnims,
    effects,
    type,
    x,
    y,
    loopFactory(),
    render,
    brandNewAlreadyProcessed,
    logicIndexHint,
    allocateLogicIndex,
    reserveAnimSlot,
    true,
    attachedStructureIndex,
    0,
    undefined,
    createdLogicTick,
  );
}

function coordScatter(x: number, y: number, radiusLeptons: number): { x: number; y: number } {
  const savedTag = ScenarioRandom._sourceTag;
  if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 50002;
  const dir = ScenarioRandom.nextInRange(0, 255);
  if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = savedTag;

  const startLX = Math.trunc(x * LEPTON_SIZE / CELL_SIZE);
  const startLY = Math.trunc(y * LEPTON_SIZE / CELL_SIZE);
  const lx = startLX + ((COS_TABLE_256[dir] * radiusLeptons) >> 7);
  const ly = startLY - ((SIN_TABLE_256[dir] * radiusLeptons) >> 7);
  if (lx < 0 || ly < 0 || lx >= 0x8000 || ly >= 0x8000) {
    return { x, y };
  }
  return {
    x: lx * CELL_SIZE / LEPTON_SIZE,
    y: ly * CELL_SIZE / LEPTON_SIZE,
  };
}

function closestFreeSpotAny(point: { x: number; y: number }): { x: number; y: number } {
  // C++ DisplayClass::Closest_Free_Spot(COORDINATE, true) ignores occupancy
  // but still converts the coordinate to the nearest legal infantry stopping
  // sub-cell via CellClass::Spot_Index and StoppingCoordAbs.
  const lx = Math.trunc(point.x * LEPTON_SIZE / CELL_SIZE);
  const ly = Math.trunc(point.y * LEPTON_SIZE / CELL_SIZE);
  if (lx < 0 || ly < 0 || lx >= 0x8000 || ly >= 0x8000) {
    return {
      x: (LEPTON_SIZE / 2) * CELL_SIZE / LEPTON_SIZE,
      y: (LEPTON_SIZE / 2) * CELL_SIZE / LEPTON_SIZE,
    };
  }

  const fracX = ((lx % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
  const fracY = ((ly % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
  let spotIndex = 0;
  if (leptonDist(fracX, fracY, 0x80, 0x80) >= 60) {
    if (fracX > 0x80) spotIndex |= 0x01;
    if (fracY > 0x80) spotIndex |= 0x02;
    spotIndex += 1;
  }

  const cellX = Math.floor(lx / LEPTON_SIZE);
  const cellY = Math.floor(ly / LEPTON_SIZE);
  const spot = SUBCELL_LEPTON_OFFSETS[spotIndex];
  return {
    x: (cellX * LEPTON_SIZE + spot.lx) * CELL_SIZE / LEPTON_SIZE,
    y: (cellY * LEPTON_SIZE + spot.ly) * CELL_SIZE / LEPTON_SIZE,
  };
}

function craterSmudgeTypeForCoord(x: number, y: number): string {
  const lx = Math.trunc(x * LEPTON_SIZE / CELL_SIZE);
  const ly = Math.trunc(y * LEPTON_SIZE / CELL_SIZE);
  const fracX = ((lx % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
  const fracY = ((ly % LEPTON_SIZE) + LEPTON_SIZE) % LEPTON_SIZE;
  let spotIndex = 0;
  if (leptonDist(fracX, fracY, 0x80, 0x80) >= 60) {
    if (fracX > 0x80) spotIndex |= 0x01;
    if (fracY > 0x80) spotIndex |= 0x02;
    spotIndex += 1;
  }
  return `cr${spotIndex + 1}`;
}
