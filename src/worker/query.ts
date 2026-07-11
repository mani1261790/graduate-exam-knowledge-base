export function boundedIntegerParam(
  value: string | undefined,
  options: { defaultValue: number; min: number; max: number },
): number {
  const parsed = value === undefined ? NaN : Number(value);
  if (!Number.isInteger(parsed)) return options.defaultValue;
  return Math.min(Math.max(parsed, options.min), options.max);
}
