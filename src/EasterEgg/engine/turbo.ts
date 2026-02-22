/**
 * Turbo speed presets for the E2E test player.
 * Controls how many game ticks run per animation frame.
 */

export interface TurboConfig {
  name: string;
  ticksPerFrame: number;
}

export const TURBO_PRESETS: Record<string, TurboConfig> = {
  normal: { name: 'normal', ticksPerFrame: 1 },
  fast:   { name: 'fast',   ticksPerFrame: 10 },
  turbo:  { name: 'turbo',  ticksPerFrame: 60 },
};

/** Resolve a ?anttest= value to a TurboConfig */
export function resolvePreset(value: string): TurboConfig {
  if (value === 'fast') return TURBO_PRESETS.fast;
  if (value === 'normal') return TURBO_PRESETS.normal;
  // Default: turbo (including ?anttest=1)
  return TURBO_PRESETS.turbo;
}
