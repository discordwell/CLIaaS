import { beforeEach, describe, expect, it } from 'vitest';

import { Entity, resetEntityIds } from '../engine/entity';
import {
  clearAllTeams,
  getActiveTeams,
  registerTeam,
  resetTeamIds,
  shouldDelayCreateTeamFirstAi,
  Team,
  updateAllTeams,
} from '../engine/team';
import { CELL_SIZE, House, UnitType } from '../engine/types';

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

beforeEach(() => {
  clearAllTeams();
  resetTeamIds();
  resetEntityIds();
});

describe('CREATE_TEAM first Team::AI delay parity', () => {
  it('surface-vessel CREATE_TEAM does not skip first AI call (SCG12EA engcru CA:1)', () => {
    const ca = entityAtCell(UnitType.V_CA, House.England, 96, 87);
    const team = new Team({
      typeName: 'engcru',
      house: House.England,
      desiredMembers: [{ type: 'CA', count: 1 }],
      missionList: [{ mission: 3, data: 28 }],
      skipFirstAiCall: shouldDelayCreateTeamFirstAi([{ type: 'CA', count: 1 }]),
    });
    registerTeam(team);

    updateAllTeams(new Map(), { entities: [ca] });
    expect(team.members).toHaveLength(1);
    expect(team.isFullStrength).toBe(false);
    expect(team.isMoving).toBe(false);

    updateAllTeams(new Map(), { entities: [ca] });
    expect(team.isFullStrength).toBe(true);
    expect(team.isMoving).toBe(true);
  });

  it('submarine CREATE_TEAM skips the first AI call (SCG07EA subz SS:3)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.BadGuy, 101, 50);
    const team = new Team({
      typeName: 'subz',
      house: House.BadGuy,
      desiredMembers: [{ type: 'SS', count: 3 }],
      missionList: [{ mission: 3, data: 14 }],
      skipFirstAiCall: shouldDelayCreateTeamFirstAi([{ type: 'SS', count: 3 }]),
    });
    registerTeam(team);

    updateAllTeams(new Map(), { entities: [ss] });
    expect(team.members).toHaveLength(0);

    updateAllTeams(new Map(), { entities: [ss] });
    expect(team.members).toHaveLength(1);
  });

  it('delay predicate is submarine-specific, not a blanket vessel rule', () => {
    expect(shouldDelayCreateTeamFirstAi([{ type: 'SS', count: 1 }])).toBe(true);
    expect(shouldDelayCreateTeamFirstAi([{ type: 'MSUB', count: 1 }])).toBe(true);
    expect(shouldDelayCreateTeamFirstAi([{ type: 'CA', count: 1 }])).toBe(false);
    expect(shouldDelayCreateTeamFirstAi([{ type: 'DD', count: 1 }])).toBe(false);
    expect(shouldDelayCreateTeamFirstAi([{ type: 'PT', count: 1 }])).toBe(false);
    expect(shouldDelayCreateTeamFirstAi([{ type: 'LST', count: 1 }])).toBe(false);
  });

  it('registry is isolated between examples', () => {
    expect(getActiveTeams()).toHaveLength(0);
  });
});
