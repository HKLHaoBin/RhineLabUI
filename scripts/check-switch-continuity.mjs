import assert from "node:assert/strict";
import {
  archiveBed,
  selectionRipple,
  PULSE_RESTORE_EPSILON,
} from "../src/archive-field.ts";
import { baselineSelectionWave, damp } from "../src/motion.ts";

const dt = 1 / 60;
const lane = 2;
const oldRow = 12;
const newRow = 13;
const pulse = { row: newRow, lane, time: 0 };
const bedCtx = (shoulder, time) => ({
  originRow: 0,
  originLane: 0,
  scanTime: 29.1,
  scanBlend: 0,
  idleGain: 0,
  time,
  shoulder,
  laneFocus: lane,
});

function trace(includeOutgoingPulse, includeSourcePulse) {
  const shoulder = { value: oldRow, velocity: 0 };
  const outgoingLift = { value: 0.4, velocity: 0 };
  const selectedLift = { value: 0, velocity: 0 };
  const outgoing = [];
  const selected = [];
  for (let frame = 0; frame <= 180; frame++) {
    const time = frame * dt;
    damp(shoulder, newRow, 5, dt);
    damp(outgoingLift, 0, 4.5, dt);
    damp(selectedLift, 0.4, 4.2, dt);
    const ctx = bedCtx(shoulder.value, time);
    const outgoingRipple = includeOutgoingPulse
      ? selectionRipple(oldRow, lane, [pulse], time, baselineSelectionWave)
      : selectionRipple(oldRow, lane, [pulse], time, baselineSelectionWave, {
          ignoreAfter: 0,
        });
    const selectedRipple = includeSourcePulse
      ? selectionRipple(newRow, lane, [pulse], time, baselineSelectionWave)
      : selectionRipple(newRow, lane, [pulse], time, baselineSelectionWave, {
          ignoreCell: { row: newRow, lane },
        });
    outgoing.push(
      -4.6 +
        archiveBed(oldRow, lane, ctx) +
        outgoingRipple +
        outgoingLift.value,
    );
    selected.push(
      -4.6 +
        archiveBed(newRow, lane, ctx) +
        selectedRipple +
        selectedLift.value,
    );
  }
  return { outgoing, selected };
}

const legacy = trace(true, true);
const fixed = trace(false, false);
const outgoingRise = Math.max(...legacy.outgoing) - legacy.outgoing[0];
const selectedPeak = Math.max(...legacy.selected);
const selectedBedPlusLift = [];
{
  const shoulder = { value: oldRow, velocity: 0 };
  const selectedLift = { value: 0, velocity: 0 };
  for (let frame = 0; frame <= 180; frame++) {
    const time = frame * dt;
    damp(shoulder, newRow, 5, dt);
    damp(selectedLift, 0.4, 4.2, dt);
    selectedBedPlusLift.push(
      -4.6 +
        archiveBed(newRow, lane, bedCtx(shoulder.value, time)) +
        selectedLift.value,
    );
  }
}
const selectedOvershoot =
  selectedPeak - Math.max(...selectedBedPlusLift.slice(0, 90));

assert.ok(
  outgoingRise > 0.2,
  "The baseline pulse must be strong enough to lift a neighboring returning card",
);
assert.ok(
  selectedOvershoot > 0.05,
  "The source pulse must be strong enough to bounce the newly extracted card",
);

const fixedOutgoingRise = Math.max(...fixed.outgoing) - fixed.outgoing[0];
assert.ok(
  fixedOutgoingRise < PULSE_RESTORE_EPSILON,
  "Returning cards cannot jump up when they ignore the new pulse",
);
for (let i = 1; i < fixed.outgoing.length; i++) {
  assert.ok(
    fixed.outgoing[i] - fixed.outgoing[i - 1] < 0.002,
    "Returning height must keep descending after a row switch",
  );
}

const fixedSelectedOvershoot =
  Math.max(...fixed.selected) - Math.max(...selectedBedPlusLift);
assert.ok(
  fixedSelectedOvershoot < PULSE_RESTORE_EPSILON,
  "The extracted file cannot ride its own ripple above the 0.4 lift",
);

const leftover = selectionRipple(
  oldRow,
  lane,
  [pulse],
  1.2,
  baselineSelectionWave,
);
assert.ok(
  Math.abs(leftover) < PULSE_RESTORE_EPSILON,
  "Array instances can resume once the neighboring crest has passed",
);

console.log(
  JSON.stringify(
    {
      legacyOutgoingRise: Math.round(outgoingRise * 1000) / 1000,
      legacySelectedOvershoot: Math.round(selectedOvershoot * 1000) / 1000,
      fixedOutgoingRise: Math.round(fixedOutgoingRise * 10000) / 10000,
      fixedSelectedOvershoot:
        Math.round(fixedSelectedOvershoot * 10000) / 10000,
      checks: "passed",
    },
    null,
    2,
  ),
);
