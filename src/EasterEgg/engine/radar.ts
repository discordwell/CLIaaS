/**
 * C++ RadarClass visual state.
 *
 * Red Alert does not turn the tactical radar on as soon as a powered DOME is
 * present. HouseClass::AI requests Radar_Activate(), then RadarClass::AI opens
 * or closes natoradr/ussrradr over several rendered frames.
 */

export const RADAR_ACTIVATED_FRAME = 22;
export const MAX_RADAR_FRAMES = 41;

export interface RadarVisualState {
  doesRadarExist: boolean;
  isRadarActive: boolean;
  isRadarActivating: boolean;
  isRadarDeactivating: boolean;
  radarAnimFrame: number;
}

export interface RadarAvailability {
  hasRadarFacility: boolean;
  hasFullPower: boolean;
  isGpsActive: boolean;
}

export function createRadarVisualState(): RadarVisualState {
  return {
    doesRadarExist: false,
    isRadarActive: false,
    isRadarActivating: false,
    isRadarDeactivating: false,
    radarAnimFrame: 0,
  };
}

export function isRadarActive(state: RadarVisualState, isGpsActive = false): boolean {
  return state.isRadarActive || isGpsActive;
}

export function isRadarExisting(state: RadarVisualState, isGpsActive = false): boolean {
  return state.doesRadarExist || isGpsActive;
}

export function radarDisplayFrame(state: RadarVisualState): number | null {
  if (state.isRadarActivating || state.isRadarDeactivating) return state.radarAnimFrame;
  if (!state.isRadarActive) return state.doesRadarExist ? MAX_RADAR_FRAMES : 0;
  return null;
}

export function radarActivate(state: RadarVisualState, control: 0 | 1 | 3 | 4): void {
  switch (control) {
    case 0:
      if (state.isRadarActive && !state.isRadarDeactivating) {
        state.isRadarDeactivating = true;
        state.isRadarActive = false;
        if (state.isRadarActivating) {
          state.isRadarActivating = false;
        } else {
          state.radarAnimFrame = RADAR_ACTIVATED_FRAME;
        }
      }
      break;
    case 1:
      if (!state.isRadarActivating && !state.isRadarActive) {
        state.isRadarActivating = true;
        if (state.isRadarDeactivating) {
          state.isRadarDeactivating = false;
        } else {
          state.radarAnimFrame = state.doesRadarExist ? MAX_RADAR_FRAMES : 0;
        }
      }
      break;
    case 3:
      state.isRadarActive = true;
      state.isRadarActivating = false;
      state.isRadarDeactivating = false;
      break;
    case 4:
      state.isRadarActive = false;
      state.isRadarActivating = false;
      state.isRadarDeactivating = false;
      state.doesRadarExist = false;
      state.radarAnimFrame = 0;
      break;
  }
}

export function updateRadarAvailability(state: RadarVisualState, availability: RadarAvailability): void {
  const { hasRadarFacility, hasFullPower, isGpsActive } = availability;

  if (isRadarActive(state, isGpsActive)) {
    if (hasRadarFacility) {
      if (!hasFullPower && !isGpsActive) radarActivate(state, 0);
    } else if (!isGpsActive) {
      radarActivate(state, 0);
    }
    return;
  }

  if (isGpsActive || hasRadarFacility) {
    if (hasFullPower || isGpsActive) radarActivate(state, 1);
    return;
  }

  if (isRadarExisting(state, isGpsActive)) radarActivate(state, 4);
}

export function advanceRadarAnimation(state: RadarVisualState): void {
  if (state.isRadarActivating) {
    if (!state.doesRadarExist) {
      state.radarAnimFrame++;
      if (state.radarAnimFrame < RADAR_ACTIVATED_FRAME) return;
      state.doesRadarExist = true;
      radarActivate(state, 3);
      return;
    }

    state.radarAnimFrame--;
    if (state.radarAnimFrame > RADAR_ACTIVATED_FRAME) return;
    radarActivate(state, 3);
    return;
  }

  if (state.isRadarDeactivating) {
    state.radarAnimFrame++;
    if (state.radarAnimFrame === MAX_RADAR_FRAMES) {
      state.isRadarDeactivating = false;
    }
  }
}
