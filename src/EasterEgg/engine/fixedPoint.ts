/** C++ Red Alert 8.8 fixed-point helpers. */

export const CPP_FIXED_ONE_RAW = 256;

export function cppFixedRaw(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.trunc((numerator * CPP_FIXED_ONE_RAW) / denominator);
}

export function cppFixedRawFromNumber(value: number): number {
  return Math.trunc(value * CPP_FIXED_ONE_RAW);
}

export function cppFixedMulInt(raw: number, value: number): number {
  return Math.trunc((raw * value + CPP_FIXED_ONE_RAW / 2) / CPP_FIXED_ONE_RAW);
}

export function cppIntDivFixed(value: number, raw: number): number {
  if (raw === 0 || raw === CPP_FIXED_ONE_RAW) return value;
  return Math.trunc((value * CPP_FIXED_ONE_RAW + CPP_FIXED_ONE_RAW / 2) / raw);
}

export function cppFixedDivRaw(leftRaw: number, rightRaw: number): number {
  if (rightRaw !== 0 && rightRaw !== CPP_FIXED_ONE_RAW) {
    return Math.trunc((leftRaw * CPP_FIXED_ONE_RAW) / rightRaw);
  }
  return leftRaw;
}

export function cppFixedInverseRaw(raw: number): number {
  return cppFixedDivRaw(CPP_FIXED_ONE_RAW, raw);
}

export const CPP_RULE_BUILD_SPEED_RAW = cppFixedRawFromNumber(0.8);
export const CPP_TICKS_PER_MINUTE_RAW = cppFixedRaw(900, 1000);

/** C++ TechnoTypeClass::Time_To_Build: Cost * Rule.BuildSpeedBias * fixed(TPM,1000). */
export function cppTechnoTypeBuildTime(cost: number): number {
  const buildSpeedAdjusted = cppFixedMulInt(CPP_RULE_BUILD_SPEED_RAW, cost);
  return cppFixedMulInt(CPP_TICKS_PER_MINUTE_RAW, buildSpeedAdjusted);
}
