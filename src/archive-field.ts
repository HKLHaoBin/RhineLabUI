import {
  archiveWave,
  idleWave,
  settlingWave,
  columnStrength,
  rippleEnvelope,
} from "./motion.ts";

export type Pulse = { row: number; lane: number; time: number };
export type WaveFn = (distance: number, age: number) => number;

export const PULSE_RESTORE_EPSILON = 0.02;

export function pulseDistance(row: number, lane: number, pulse: Pulse) {
  return Math.hypot(row - pulse.row, (lane - pulse.lane) * 2.2);
}

export function selectionRipple(
  row: number,
  lane: number,
  pulses: Pulse[],
  time: number,
  wave: WaveFn,
  options: {
    envelope?: boolean;
    ignoreAfter?: number;
    ignoreCell?: { row: number; lane: number };
    pulseGain?: number;
  } = {},
) {
  let ripple = 0;
  for (const pulse of pulses) {
    if (
      options.ignoreAfter !== undefined &&
      pulse.time >= options.ignoreAfter - 1e-9
    )
      continue;
    if (
      options.ignoreCell &&
      pulse.row === options.ignoreCell.row &&
      pulse.lane === options.ignoreCell.lane
    )
      continue;
    const distance = pulseDistance(row, lane, pulse);
    const age = time - pulse.time;
    ripple +=
      wave(distance, age) *
      (options.envelope ? rippleEnvelope(distance, age) : 1);
  }
  return Math.min(0.6, Math.max(-0.6, ripple)) * (options.pulseGain ?? 1);
}

export function archiveBed(
  row: number,
  lane: number,
  ctx: {
    originRow: number;
    originLane: number;
    scanTime: number;
    scanBlend: number;
    idleGain: number;
    time: number;
    shoulder: number;
    laneFocus: number;
  },
) {
  return (
    archiveWave(row + ctx.originRow, lane + ctx.originLane, ctx.scanTime) *
      ctx.scanBlend +
    idleWave(row + ctx.originRow, lane + ctx.originLane, ctx.time) *
      ctx.idleGain +
    settlingWave(row - ctx.shoulder, 26.56) *
      columnStrength(lane, ctx.laneFocus)
  );
}
