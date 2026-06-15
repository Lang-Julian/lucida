/**
 * Standalone sanity test for the shape recognizer (run: npx tsx scratch/test-recognizer.ts).
 * Generates synthetic hand-drawn strokes and asserts each classifies correctly.
 * Not part of the app build — lives under scratch/.
 */
import { recognizeStroke } from "../src/lib/recognizer";
import type { Point } from "../src/lib/types";

// Deterministic small jitter so runs are reproducible.
let seed = 1;
function noise(amp: number): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return ((seed / 0x7fffffff) * 2 - 1) * amp;
}

function seg(a: Point, b: Point, steps: number, jit = 1.5): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    out.push([a[0] + (b[0] - a[0]) * t + noise(jit), a[1] + (b[1] - a[1]) * t + noise(jit)]);
  }
  return out;
}

function polygon(verts: Point[], stepsPerEdge: number, closeShort = 6): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    pts.push(...seg(a, b, stepsPerEdge));
  }
  // End a few px short of the start to mimic an imperfect closing gesture.
  const start = verts[0];
  const last = pts[pts.length - 1];
  pts[pts.length - 1] = [
    last[0] + (start[0] - last[0]) * (1 - closeShort / 100),
    last[1] + (start[1] - last[1]) * (1 - closeShort / 100),
  ];
  return pts;
}

function circle(cx: number, cy: number, r: number, n: number): Point[] {
  const pts: Point[] = [];
  // Leave a small gap (stop at ~340°) like a hand-drawn circle.
  for (let i = 0; i < n; i++) {
    const a = (i / n) * (Math.PI * 2 * 0.95);
    pts.push([cx + Math.cos(a) * r + noise(2), cy + Math.sin(a) * r + noise(2)]);
  }
  return pts;
}

const cases: Array<{ name: string; expect: string; pts: Point[] }> = [
  { name: "square", expect: "rectangle", pts: polygon([[0, 0], [200, 0], [200, 200], [0, 200]], 18) },
  { name: "wide rect", expect: "rectangle", pts: polygon([[0, 0], [320, 0], [320, 120], [0, 120]], 18) },
  { name: "circle", expect: "ellipse", pts: circle(100, 100, 100, 64) },
  { name: "ellipse", expect: "ellipse", pts: circle(150, 90, 150, 64).map((p) => [p[0], p[1] * 0.6 + 40] as Point) },
  { name: "triangle", expect: "triangle", pts: polygon([[100, 0], [200, 200], [0, 200]], 22) },
  { name: "diamond", expect: "diamond", pts: polygon([[100, 0], [200, 100], [100, 200], [0, 100]], 18) },
  { name: "line", expect: "line", pts: seg([0, 0], [300, 150], 60, 2) },
];

let failures = 0;
for (const c of cases) {
  const r = recognizeStroke(c.pts, { minConfidence: 0.5 });
  const got = r ? r.type : "null";
  const ok = got === c.expect;
  if (!ok) failures++;
  const conf = r ? r.confidence.toFixed(2) : "—";
  console.log(`${ok ? "✅" : "❌"} ${c.name.padEnd(10)} expect=${c.expect.padEnd(10)} got=${got.padEnd(10)} conf=${conf}`);
}

// Negative control: random scribble should NOT classify confidently.
const scribble: Point[] = [];
for (let i = 0; i < 80; i++) scribble.push([noise(120) + 150, noise(120) + 150]);
const sc = recognizeStroke(scribble, { minConfidence: 0.6 });
console.log(`ℹ️  scribble -> ${sc ? sc.type + " (conf " + sc.confidence.toFixed(2) + ")" : "null (good)"}`);

// Fuzz: many noisy, rotated, varied-aspect ellipses must classify as ellipse,
// NOT as a polygon. Regression guard for the 35°->55° corner threshold +
// circularity-first fix (polygon-misclassification was ~18% before the fix).
function noisyEllipse(rx: number, ry: number, rot: number, n: number, tremor: number): Point[] {
  const pts: Point[] = [];
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2; // full loop -> closed
    const ex = Math.cos(a) * rx + noise(tremor);
    const ey = Math.sin(a) * ry + noise(tremor);
    pts.push([300 + ex * cos - ey * sin, 300 + ex * sin + ey * cos]);
  }
  return pts;
}
let ellipses = 0;
let polygonMisclassified = 0;
const N = 400;
for (let k = 0; k < N; k++) {
  const rx = 45 + Math.abs(noise(70));
  const ry = rx * (0.55 + Math.abs(noise(0.45)));
  const r = recognizeStroke(
    noisyEllipse(rx, ry, noise(Math.PI), 30 + Math.floor(Math.abs(noise(70))), 1.6),
    { minConfidence: 0.5 },
  );
  if (r && r.type === "ellipse") ellipses++;
  else if (r && (r.type === "rectangle" || r.type === "diamond" || r.type === "triangle")) polygonMisclassified++;
}
const misRate = polygonMisclassified / N;
const fuzzOk = misRate <= 0.05;
if (!fuzzOk) failures++;
console.log(
  `${fuzzOk ? "✅" : "❌"} ellipse fuzz (n=${N}): ${((ellipses / N) * 100).toFixed(1)}% ellipse, ` +
    `${(misRate * 100).toFixed(1)}% misread as a polygon (want ≤5%)`,
);

console.log(failures === 0 ? "\nALL SHAPE CASES PASSED" : `\n${failures} CASE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
