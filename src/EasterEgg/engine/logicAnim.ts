import { CELL_SIZE, LEPTON_SIZE, EXPLOSION_FRAMES } from './types';
import { type Effect } from './renderer';
import { ScenarioRandom } from './random';
import type { GameMap } from './map';

export type LogicAnimType =
  | 'napalm1'
  | 'napalm2'
  | 'napalm3'
  | 'elect_die'
  | 'fire_small'
  | 'fire_med'
  | 'fire_med2'
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
}

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
}

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
  fire_small: { sprite: 'fire3', biggest: 0, stages: 15, loops: 2, rate: 1, scorcher: false },
  fire_med: { sprite: 'fire2', biggest: 0, stages: 15, loops: 3, rate: 1, scorcher: true },
  fire_med2: { sprite: 'fire1', biggest: 0, stages: 15, loops: 3, rate: 1, scorcher: true },
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
    case 'fball1': return 'fball1';
    case 'frag1': return 'frag1';
    case 'veh-hit1': return 'veh-hit1';
    case 'veh-hit2': return 'veh-hit2';
    case 'art-exp1': return 'art-exp1';
    case 'atomsfx': return 'atomsfx';
    default: return null;
  }
}

export function spawnLogicAnimForSprite(
  logicAnims: LogicAnim[],
  effects: Effect[],
  sprite: string | undefined,
  x: number,
  y: number,
  render = false,
  brandNewAlreadyProcessed = false,
): void {
  const type = logicAnimTypeForSprite(sprite);
  if (!type) return;
  spawnLogicAnim(logicAnims, effects, type, x, y, 1, render, brandNewAlreadyProcessed);
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
): void {
  const def = LOGIC_ANIM_DEFS[type];
  const anim: LogicAnim = {
    type,
    x,
    y,
    stage: 0,
    timer: def.rate,
    loops: Math.max(1, loop) * def.loops,
    delay: 0,
    isBrandNew: !brandNewAlreadyProcessed,
  };
  logicAnims.push(anim);
  if (render) {
    effects.push({
      type: 'explosion',
      x,
      y,
      frame: 0,
      maxFrames: EXPLOSION_FRAMES[def.sprite] ?? def.stages,
      size: type === 'fire_med' || type === 'fire_med2' ? 12 : 8,
      sprite: def.sprite,
      spriteStart: 0,
    } as Effect);
  }
  logicAnimStart(anim, logicAnims, effects);
}

export function processLogicAnim(anim: LogicAnim, logicAnims: LogicAnim[], effects: Effect[], map?: GameMap): boolean {
  if (anim.isBrandNew) {
    // C++ anim.cpp:677-680 — brand-new anims skip their first Logic pass.
    anim.isBrandNew = false;
    return true;
  }

  if (anim.delay > 0) {
    anim.delay--;
    if (anim.delay === 0) logicAnimStart(anim, logicAnims, effects);
    return true;
  }

  const def = LOGIC_ANIM_DEFS[anim.type];
  if (anim.timer > 0) anim.timer--;
  if (anim.timer > 0) return true;

  // C++ StageClass::Graphic_Logic: when the stage timer expires, advance one frame
  // and reset it to the animation Rate.
  anim.stage++;
  anim.timer = def.rate;

  if (def.biggest > 0 && anim.stage === def.biggest) {
    logicAnimMiddle(anim, logicAnims, effects, map);
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
      logicAnimStart(anim, logicAnims, effects, map);
      return true;
    }
    return false;
  }

  return true;
}

function logicAnimStart(anim: LogicAnim, logicAnims: LogicAnim[], effects: Effect[], map?: GameMap): void {
  const def = LOGIC_ANIM_DEFS[anim.type];
  // C++ anim.cpp:914-916 — animations whose Biggest stage is frame 0 run Middle
  // immediately from Start(), including FIRE_MED spawning FIRE_SMALL.
  if (def.biggest === 0) {
    logicAnimMiddle(anim, logicAnims, effects, map);
  }
}

function logicAnimMiddle(anim: LogicAnim, logicAnims: LogicAnim[], effects: Effect[], map?: GameMap): void {
  const def = LOGIC_ANIM_DEFS[anim.type];

  // C++ anim.cpp:954-956 — scorcher animations create a random scorch smudge.
  if (def.scorcher) {
    ScenarioRandom.nextInRange(1, 6);
  }

  if (def.crater && map) {
    const cx = Math.floor(anim.x / CELL_SIZE);
    const cy = Math.floor(anim.y / CELL_SIZE);
    map.reduceOreLevels(cx, cy, 6);
    map.addDecal(cx, cy, 10, 0.4);
  }

  switch (anim.type) {
    case 'napalm1':
    case 'napalm2':
    case 'napalm3': {
      // C++ anim.cpp:984-994. The old C++ build evaluates constructor args in
      // coordinate-then-loop order here; SCG07EA t182 verifies the RNG ordering.
      const p1 = coordScatter(anim.x, anim.y, 0x0040);
      spawnLogicAnim(logicAnims, effects, 'fire_small', p1.x, p1.y, ScenarioRandom.nextInRange(1, 2), true);
      if (ScenarioRandom.percentChance(50)) {
        const p2 = coordScatter(anim.x, anim.y, 0x00A0);
        spawnLogicAnim(logicAnims, effects, 'fire_small', p2.x, p2.y, ScenarioRandom.nextInRange(1, 2), true);
      }
      if (ScenarioRandom.percentChance(50)) {
        const p3 = coordScatter(anim.x, anim.y, 0x0070);
        spawnLogicAnim(logicAnims, effects, 'fire_med', p3.x, p3.y, ScenarioRandom.nextInRange(1, 2), true);
      }
      break;
    }

    case 'fire_med':
    case 'fire_med2':
      // C++ anim.cpp:998-1003 — medium fire chains into a small fire animation.
      spawnLogicAnim(logicAnims, effects, 'fire_small', anim.x, anim.y, ScenarioRandom.nextInRange(1, 2), true);
      break;

    default:
      break;
  }
}

function coordScatter(x: number, y: number, radiusLeptons: number): { x: number; y: number } {
  const savedTag = ScenarioRandom._sourceTag;
  if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = 50002;
  const dir = ScenarioRandom.nextInRange(0, 255);
  if (ScenarioRandom._tagLogging) ScenarioRandom._sourceTag = savedTag;

  const radiusPx = radiusLeptons * CELL_SIZE / LEPTON_SIZE;
  const angle = dir * 2 * Math.PI / 256;
  return {
    x: x + Math.cos(angle) * radiusPx,
    y: y + Math.sin(angle) * radiusPx,
  };
}
