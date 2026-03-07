import { describe, it, expect } from 'vitest';
import {
  House, HOUSE_FACTION, COUNTRY_BONUSES, HOUSE_FIREPOWER_BIAS,
  PRODUCTION_ITEMS, type ProductionItem, type Faction,
} from '../engine/types';

describe('Faction Tech Trees', () => {
  // === 1. House-to-faction mapping ===
  describe('House-to-faction mapping', () => {
    it('Allied countries map to allied faction', () => {
      expect(HOUSE_FACTION.Spain).toBe('allied');
      expect(HOUSE_FACTION.Greece).toBe('allied');
      expect(HOUSE_FACTION.England).toBe('allied');
      expect(HOUSE_FACTION.France).toBe('allied');
      expect(HOUSE_FACTION.Germany).toBe('allied');
      expect(HOUSE_FACTION.Turkey).toBe('allied');
    });

    it('Soviet countries map to soviet faction', () => {
      expect(HOUSE_FACTION.USSR).toBe('soviet');
      expect(HOUSE_FACTION.Ukraine).toBe('soviet');
    });

    it('Neutral maps to both', () => {
      expect(HOUSE_FACTION.Neutral).toBe('both');
    });

    it('all House enum values have a faction mapping', () => {
      for (const house of Object.values(House)) {
        expect(HOUSE_FACTION[house]).toBeDefined();
      }
    });
  });

  // === 2. Country bonuses ===
  describe('Country bonuses', () => {
    it('England gets 10% tougher armor', () => {
      expect(COUNTRY_BONUSES.England.armorMult).toBe(1.1);
      expect(COUNTRY_BONUSES.England.costMult).toBe(1.0);
    });

    it('France gets 10% faster ROF', () => {
      expect(COUNTRY_BONUSES.France.rofMult).toBe(1.1);
    });

    it('Germany gets 10% more firepower', () => {
      expect(COUNTRY_BONUSES.Germany.firepowerMult).toBe(1.1);
      expect(COUNTRY_BONUSES.Germany.costMult).toBe(1.0);
    });

    it('USSR gets 10% cost discount', () => {
      expect(COUNTRY_BONUSES.USSR.costMult).toBe(0.9);
      expect(COUNTRY_BONUSES.USSR.firepowerMult).toBe(1.0);
    });

    it('Ukraine gets 10% faster ground speed', () => {
      expect(COUNTRY_BONUSES.Ukraine.groundspeedMult).toBe(1.1);
      expect(COUNTRY_BONUSES.Ukraine.firepowerMult).toBe(1.0);
    });

    it('Spain has no bonuses (baseline)', () => {
      const spain = COUNTRY_BONUSES.Spain;
      expect(spain.costMult).toBe(1.0);
      expect(spain.firepowerMult).toBe(1.0);
      expect(spain.armorMult).toBe(1.0);
    });

    it('cost calculations apply correctly', () => {
      // USSR: 10% cheaper → 700 cost item = 630
      const item700 = 700;
      expect(Math.round(item700 * COUNTRY_BONUSES.USSR.costMult)).toBe(630);

      // Spain: no discount → 700 stays 700
      expect(Math.round(item700 * COUNTRY_BONUSES.Spain.costMult)).toBe(700);
    });

    it('HOUSE_FIREPOWER_BIAS is derived from COUNTRY_BONUSES', () => {
      for (const [house, bonus] of Object.entries(COUNTRY_BONUSES)) {
        expect(HOUSE_FIREPOWER_BIAS[house]).toBe(bonus.firepowerMult);
      }
    });
  });

  // === Helper: filter production items by faction ===
  function filterByFaction(faction: Faction): ProductionItem[] {
    return PRODUCTION_ITEMS.filter(item =>
      item.faction === 'both' || item.faction === faction
    );
  }

  // === 3. Allied faction filtering ===
  describe('Allied faction filtering', () => {
    const alliedItems = filterByFaction('allied');
    const alliedTypes = new Set(alliedItems.map(i => i.type));

    it('Allied player sees JEEP, 1TNK, 2TNK', () => {
      expect(alliedTypes.has('JEEP')).toBe(true);
      expect(alliedTypes.has('1TNK')).toBe(true);
      expect(alliedTypes.has('2TNK')).toBe(true);
    });

    it('Allied player does NOT see 3TNK, 4TNK', () => {
      expect(alliedTypes.has('3TNK')).toBe(false);
      expect(alliedTypes.has('4TNK')).toBe(false);
    });

    it('Allied player sees MEDI but not E4 or DOG', () => {
      expect(alliedTypes.has('MEDI')).toBe(true);
      expect(alliedTypes.has('E4')).toBe(false);
      expect(alliedTypes.has('DOG')).toBe(false);
    });

    it('Allied tech chain: WEAP → ATEK → PDOX', () => {
      const atek = PRODUCTION_ITEMS.find(i => i.type === 'ATEK')!;
      const pdox = PRODUCTION_ITEMS.find(i => i.type === 'PDOX')!;
      expect(atek.faction).toBe('allied');
      expect(atek.prerequisite).toBe('WEAP');
      expect(pdox.faction).toBe('allied');
      expect(pdox.prerequisite).toBe('ATEK');
    });

    it('Allied player sees HBOX and GUN but not TSLA', () => {
      expect(alliedTypes.has('HBOX')).toBe(true);
      expect(alliedTypes.has('GUN')).toBe(true);
      expect(alliedTypes.has('TSLA')).toBe(false);
    });

    it('Allied naval: PT, DD, CA from SYRD', () => {
      expect(alliedTypes.has('PT')).toBe(true);
      expect(alliedTypes.has('DD')).toBe(true);
      expect(alliedTypes.has('CA')).toBe(true);
    });

    it('Allied does NOT see SS or MSUB', () => {
      expect(alliedTypes.has('SS')).toBe(false);
      expect(alliedTypes.has('MSUB')).toBe(false);
    });

    it('Allied sees HELI (Longbow) but not MIG/YAK/HIND', () => {
      expect(alliedTypes.has('HELI')).toBe(true);
      expect(alliedTypes.has('MIG')).toBe(false);
      expect(alliedTypes.has('YAK')).toBe(false);
      expect(alliedTypes.has('HIND')).toBe(false);
    });
  });

  // === 4. Soviet faction filtering ===
  describe('Soviet faction filtering', () => {
    const sovietItems = filterByFaction('soviet');
    const sovietTypes = new Set(sovietItems.map(i => i.type));

    it('Soviet player sees 3TNK, 4TNK', () => {
      expect(sovietTypes.has('3TNK')).toBe(true);
      expect(sovietTypes.has('4TNK')).toBe(true);
    });

    it('Soviet player does NOT see JEEP, 1TNK', () => {
      expect(sovietTypes.has('JEEP')).toBe(false);
      expect(sovietTypes.has('1TNK')).toBe(false);
    });

    it('Soviet player sees TSLA but not HBOX', () => {
      expect(sovietTypes.has('TSLA')).toBe(true);
      expect(sovietTypes.has('HBOX')).toBe(false);
    });

    it('Soviet tech chain: WEAP → STEK → IRON/MSLO', () => {
      const stek = PRODUCTION_ITEMS.find(i => i.type === 'STEK')!;
      const iron = PRODUCTION_ITEMS.find(i => i.type === 'IRON')!;
      const mslo = PRODUCTION_ITEMS.find(i => i.type === 'MSLO')!;
      expect(stek.faction).toBe('soviet');
      expect(stek.prerequisite).toBe('WEAP');
      expect(iron.faction).toBe('soviet');
      expect(iron.prerequisite).toBe('STEK');
      expect(mslo.faction).toBe('both');
      expect(mslo.prerequisite).toBe('STEK');
    });

    it('Soviet sees E4 (Flame) and DOG', () => {
      expect(sovietTypes.has('E4')).toBe(true);
      expect(sovietTypes.has('DOG')).toBe(true);
    });

    it('Soviet does NOT see MEDI', () => {
      expect(sovietTypes.has('MEDI')).toBe(false);
    });

    it('Soviet sees AFLD and MIG/YAK/HIND', () => {
      expect(sovietTypes.has('AFLD')).toBe(true);
      expect(sovietTypes.has('MIG')).toBe(true);
      expect(sovietTypes.has('YAK')).toBe(true);
      expect(sovietTypes.has('HIND')).toBe(true);
    });

    it('Soviet sees SS and MSUB from SPEN', () => {
      expect(sovietTypes.has('SS')).toBe(true);
      expect(sovietTypes.has('MSUB')).toBe(true);
    });
  });

  // === 5. AI production faction awareness ===
  describe('AI production faction awareness', () => {
    it('Soviet AI infantry pool includes soviet and both-faction units', () => {
      const INFANTRY_PREREQS = new Set(['TENT', 'BARR', 'KENN']);
      const sovietInf = PRODUCTION_ITEMS.filter(p =>
        INFANTRY_PREREQS.has(p.prerequisite) &&
        !p.isStructure &&
        (p.faction === 'both' || p.faction === 'soviet')
      );
      const types = sovietInf.map(i => i.type);
      expect(types).toContain('E1');  // both
      expect(types).toContain('E4');  // soviet
      expect(types).toContain('DOG'); // soviet (prereq KENN)
      expect(types).not.toContain('MEDI'); // allied only
    });

    it('Allied AI infantry pool includes allied and both-faction units', () => {
      const INFANTRY_PREREQS = new Set(['TENT', 'BARR', 'KENN']);
      const alliedInf = PRODUCTION_ITEMS.filter(p =>
        INFANTRY_PREREQS.has(p.prerequisite) &&
        !p.isStructure &&
        (p.faction === 'both' || p.faction === 'allied')
      );
      const types = alliedInf.map(i => i.type);
      expect(types).toContain('E1');   // both
      expect(types).toContain('MEDI'); // allied
      expect(types).not.toContain('E4');  // soviet only
      expect(types).not.toContain('DOG'); // soviet only
    });

    it('Soviet AI vehicle pool includes 3TNK and 4TNK', () => {
      const sovietVeh = PRODUCTION_ITEMS.filter(p =>
        p.prerequisite === 'WEAP' &&
        !p.isStructure &&
        (p.faction === 'both' || p.faction === 'soviet')
      );
      const types = sovietVeh.map(i => i.type);
      expect(types).toContain('3TNK');
      expect(types).toContain('4TNK');
      expect(types).toContain('HARV'); // both
      expect(types).not.toContain('JEEP'); // allied only
    });

    it('Allied AI vehicle pool includes JEEP, 1TNK, 2TNK', () => {
      const alliedVeh = PRODUCTION_ITEMS.filter(p =>
        p.prerequisite === 'WEAP' &&
        !p.isStructure &&
        (p.faction === 'both' || p.faction === 'allied')
      );
      const types = alliedVeh.map(i => i.type);
      expect(types).toContain('JEEP');
      expect(types).toContain('1TNK');
      expect(types).toContain('2TNK');
      expect(types).toContain('HARV'); // both
      expect(types).not.toContain('3TNK'); // soviet only
    });
  });

  // === 6. Tech prerequisites ===
  describe('Tech prerequisites', () => {
    it('ARTY has no techPrereq (gated by TechLevel=8)', () => {
      const arty = PRODUCTION_ITEMS.find(i => i.type === 'ARTY')!;
      expect(arty.techPrereq).toBeUndefined();
      expect(arty.techLevel).toBe(8);
    });

    it('STNK (Phase Transport) needs ATEK', () => {
      const stnk = PRODUCTION_ITEMS.find(i => i.type === 'STNK')!;
      expect(stnk.techPrereq).toBe('ATEK');
      expect(stnk.faction).toBe('both');
    });

    it('TTNK (Tesla Tank) needs TSLA', () => {
      const ttnk = PRODUCTION_ITEMS.find(i => i.type === 'TTNK')!;
      expect(ttnk.techPrereq).toBe('TSLA');
      expect(ttnk.faction).toBe('soviet');
    });

    it('CA (Cruiser) needs ATEK', () => {
      const ca = PRODUCTION_ITEMS.find(i => i.type === 'CA')!;
      expect(ca.techPrereq).toBe('ATEK');
      expect(ca.faction).toBe('allied');
    });

    it('SHOK (Shock Trooper) needs TSLA', () => {
      const shok = PRODUCTION_ITEMS.find(i => i.type === 'SHOK')!;
      expect(shok.techPrereq).toBe('TSLA');
      expect(shok.faction).toBe('soviet');
    });

    it('HELI (Longbow) needs no extra tech prereq', () => {
      const heli = PRODUCTION_ITEMS.find(i => i.type === 'HELI')!;
      expect(heli.techPrereq).toBeUndefined();
      expect(heli.faction).toBe('allied');
    });

    it('MSUB (Missile Sub) needs STEK', () => {
      const msub = PRODUCTION_ITEMS.find(i => i.type === 'MSUB')!;
      expect(msub.techPrereq).toBe('STEK');
      expect(msub.faction).toBe('soviet');
    });
  });

  // === 7. Both-faction items ===
  describe('Both-faction items', () => {
    const bothItems = PRODUCTION_ITEMS.filter(i => i.faction === 'both');
    const bothTypes = new Set(bothItems.map(i => i.type));

    it('shared structures: POWR, WEAP, PROC, SILO, DOME', () => {
      expect(bothTypes.has('POWR')).toBe(true);
      expect(bothTypes.has('WEAP')).toBe(true);
      expect(bothTypes.has('PROC')).toBe(true);
      expect(bothTypes.has('SILO')).toBe(true);
      expect(bothTypes.has('DOME')).toBe(true);
    });

    it('HARV is both-faction', () => {
      expect(bothTypes.has('HARV')).toBe(true);
    });

    it('basic infantry: E1, E6 are both-faction', () => {
      expect(bothTypes.has('E1')).toBe(true);
      expect(bothTypes.has('E6')).toBe(true);
    });

    it('E3 (Rocket) is allied-only, E2 (Grenadier) is soviet-only', () => {
      expect(bothTypes.has('E3')).toBe(false);
      expect(bothTypes.has('E2')).toBe(false);
    });

    it('BRIK wall is both-faction, SBAG is allied, FENC is soviet', () => {
      expect(bothTypes.has('BRIK')).toBe(true);
      expect(bothTypes.has('SBAG')).toBe(false);
      expect(bothTypes.has('FENC')).toBe(false);
    });

    it('LST is both-faction while TRAN is soviet-only', () => {
      expect(bothTypes.has('TRAN')).toBe(false);
      expect(bothTypes.has('LST')).toBe(true);
    });

    it('FIX (Service Depot) and HPAD (Helipad) are both-faction', () => {
      expect(bothTypes.has('FIX')).toBe(true);
      expect(bothTypes.has('HPAD')).toBe(true);
    });
  });
});
