import assert from "node:assert/strict";
import {
  archiveWave,
  extraction,
  selectionWave,
  settlingWave,
  damp,
  idleWave,
} from "../src/motion.ts";

let idleRange = 0;
for (let lane = 0; lane < 5; lane++) {
  for (let row = 0; row < 32; row++) {
    for (let frame = 0; frame < 60 * 13; frame++) {
      const a = idleWave(row, lane, frame / 60);
      const b = idleWave(row, lane, (frame + 1) / 60);
      idleRange = Math.max(idleRange, Math.abs(a));
      assert.ok(Math.abs(a) < 3.7 * 0.03, "Idle lift stays below 3% of card height");
      assert.ok(Math.abs(b - a) * (1080 / 7.33) < 0.21, "Idle motion remains subpixel per frame");
    }
  }
}
assert.ok(idleRange > 0.075, "Idle field remains perceptible without input");

const peak = (t) =>
  Array.from({ length: 32 }, (_, row) => archiveWave(row, 2, t)).reduce(
    (best, y, row, values) => (y > values[best] ? row : best),
    0,
  );
assert.ok(peak(23.3) > peak(22.7) + 6, "First crest must travel across rows");
assert.ok(peak(24.8) < peak(24.2) - 8, "Second crest must return across rows");
let maxFrameDelta = 0;
for (let frame = 550; frame < 800; frame++) {
  for (let row = 0; row < 32; row++)
    for (let lane = 0; lane < 5; lane++) {
      const a = archiveWave(row, lane, frame / 25);
      const b = archiveWave(row, lane, (frame + 1) / 25);
      assert.ok(Number.isFinite(a));
      maxFrameDelta = Math.max(maxFrameDelta, Math.abs(b - a));
    }
}
assert.ok(maxFrameDelta < 0.7, "25 fps samples must not teleport");
assert.ok(
  Math.abs(extraction(26.6) - extraction(27.2)) < 0.01,
  "Pause between extraction phases",
);
assert.ok(extraction(29) > 3 && extraction(25.1) === 0);
assert.ok(
  Math.abs(settlingWave(2, 26.1) - settlingWave(2, 26.5)) > 0.01,
  "Neighbors keep moving during the first extraction hold",
);
assert.ok(
  Math.abs(selectionWave(8, 1)) > 0.1,
  "Click ripple reaches neighboring rows",
);
const coarse = { value: 5, velocity: -2 },
  fine = { ...coarse };
for (let i = 0; i < 30; i++) damp(coarse, -3, 4, 1 / 30);
for (let i = 0; i < 120; i++) damp(fine, -3, 4, 1 / 120);
assert.ok(
  Math.abs(coarse.value - fine.value) < 1e-9,
  "Spring must be frame-rate independent",
);
const before = coarse.value;
damp(coarse, 6, 4, 1 / 120);
assert.ok(
  Math.abs(coarse.value - before) < 0.05,
  "Retargeting must preserve position continuity",
);
console.log(
  JSON.stringify(
    {
      forwardPeaks: [peak(22.7), peak(23.3)],
      returnPeaks: [peak(24.2), peak(24.8)],
      maxFrameDelta,
      checks: "passed",
    },
    null,
    2,
  ),
);
