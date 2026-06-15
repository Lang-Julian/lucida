/**
 * Shape recognizer — turns ONE raw freehand stroke into a clean primitive.
 *
 * Approach: geometry only, no ML, fully deterministic. We clean the stroke,
 * measure its bounding box, decide open-vs-closed by the first/last gap, then
 * simplify the polyline (Ramer-Douglas-Peucker) and count corners from turning
 * angles. Open strokes become a LINE when straight enough. Closed strokes are
 * classified from circularity (4πA/L²) and corner count into ellipse, triangle,
 * rectangle or diamond, with a confidence score derived from the relevant fit
 * error. Everything below `minConfidence` returns null so the caller leaves the
 * raw stroke untouched. All coordinates are ABSOLUTE scene coords throughout.
 */
import type { Point, PrimitiveType, RecognizedShape, RecognizerOptions } from "./types";

/* ───────────────────────────  small helpers  ─────────────────────────── */

/** Euclidean distance between two points. */
function dist(a: Point, b: Point): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.hypot(dx, dy);
}

/** Clamp a number into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Axis-aligned bounding box of a point set as [minX, minY, maxX, maxY]. */
function bbox(points: Point[]): [number, number, number, number] {
  let minX = points[0][0];
  let minY = points[0][1];
  let maxX = points[0][0];
  let maxY = points[0][1];
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return [minX, minY, maxX, maxY];
}

/** Total length of an open polyline. */
function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
  return len;
}

/** Signed polygon area via the shoelace formula (absolute value returned). */
function shoelaceArea(points: Point[]): number {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Perpendicular distance from point p to the line through a→b. */
function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const segLen = Math.hypot(dx, dy);
  if (segLen === 0) return dist(p, a);
  // Twice the triangle area / base length.
  const cross = Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0]));
  return cross / segLen;
}

/** Turn angle (radians) at b for the path a→b→c; 0 = straight. */
function turnAngle(a: Point, b: Point, c: Point): number {
  const v1x = b[0] - a[0];
  const v1y = b[1] - a[1];
  const v2x = c[0] - b[0];
  const v2y = c[1] - b[1];
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return 0;
  const cos = clamp((v1x * v2x + v1y * v2y) / (m1 * m2), -1, 1);
  return Math.acos(cos);
}

/**
 * Ramer-Douglas-Peucker simplification: keep points that deviate more than
 * `eps` from the chord between the kept endpoints. Returns the kept subset in
 * order, always including first and last.
 */
function rdp(points: Point[], eps: number): Point[] {
  if (points.length < 3) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  let maxDev = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const dev = perpDistance(points[i], first, last);
    if (dev > maxDev) {
      maxDev = dev;
      idx = i;
    }
  }
  if (maxDev > eps) {
    // Recurse on both halves, sharing the pivot point.
    const left = rdp(points.slice(0, idx + 1), eps);
    const right = rdp(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

/* ───────────────────────────  recognition  ─────────────────────────── */

const TURN_CORNER = (35 * Math.PI) / 180; // a vertex turns more than ~35°

/**
 * Decide whether a freehand stroke was MEANT as a clean primitive.
 * Returns the recognized shape (in absolute scene coords) or null.
 */
export function recognizeStroke(points: Point[], opts?: RecognizerOptions): RecognizedShape | null {
  const minConfidence = opts?.minConfidence ?? 0.55;
  const closeTolerance = opts?.closeTolerance ?? 0.2;

  // 1. Clean: drop consecutive points closer than 1px to remove jitter.
  const clean: Point[] = [];
  for (const p of points) {
    if (clean.length === 0 || dist(clean[clean.length - 1], p) >= 1) clean.push(p);
  }
  if (clean.length < 3) return null;

  // 2. Bounding box, diagonal d, total path length L.
  const [minX, minY, maxX, maxY] = bbox(clean);
  const width = maxX - minX;
  const height = maxY - minY;
  const d = Math.hypot(width, height);
  if (d <= 12) return null; // too small to be an intentional shape
  const L = pathLength(clean);

  const first = clean[0];
  const last = clean[clean.length - 1];

  // 3. Closed test: small first/last gap relative to the diagonal.
  const gap = dist(first, last);
  const closed = gap <= closeTolerance * d;

  // 4. Simplify and count corners from turning angles.
  const eps = 0.045 * d;
  const simplified = rdp(clean, eps);
  // For a closed path the stroke ends back near where it started, so the last
  // simplified vertex duplicates the first conceptual corner. Drop it so corner
  // counting wraps correctly — independent of how large the (still-closed) gap
  // is. (A gap in (eps, closeTolerance·d] would otherwise leave both endpoints
  // as distinct vertices and double-count the closing corner.)
  const verts =
    closed && simplified.length > 2 ? simplified.slice(0, -1) : simplified;

  // Count corners: open paths use interior vertices; closed paths wrap around.
  let corners = 0;
  if (closed) {
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const a = verts[(i - 1 + n) % n];
      const b = verts[i];
      const c = verts[(i + 1) % n];
      if (turnAngle(a, b, c) > TURN_CORNER) corners++;
    }
  } else {
    for (let i = 1; i < verts.length - 1; i++) {
      if (turnAngle(verts[i - 1], verts[i], verts[i + 1]) > TURN_CORNER) corners++;
    }
  }

  const make = (type: PrimitiveType, confidence: number, pts?: Point[]): RecognizedShape => ({
    type,
    confidence: clamp(confidence, 0, 1),
    x: minX,
    y: minY,
    width,
    height,
    ...(pts ? { points: pts } : {}),
  });

  // 5. OPEN → LINE candidate: how flat is the stroke against its chord?
  if (!closed) {
    const chordLength = dist(first, last);
    let maxPerp = 0;
    for (const p of clean) {
      const dev = perpDistance(p, first, last);
      if (dev > maxPerp) maxPerp = dev;
    }
    if (corners <= 1 && maxPerp <= 0.14 * chordLength) {
      const confidence = 1 - clamp(maxPerp / Math.max(0.5 * chordLength, 1), 0, 1);
      const shape = make("line", confidence, [first, last]);
      return shape.confidence >= minConfidence ? shape : null;
    }
    return null; // open, but not straight enough to be a line
  }

  // 6. CLOSED → classify by area / circularity / corner count.
  const A = shoelaceArea(clean);
  if (A <= 0) return null;
  // Circularity: 1.0 for a perfect circle, lower for spiky/elongated shapes.
  const C = (4 * Math.PI * A) / (L * L);

  // Corner-based shapes take priority over raw circularity: a clean square has
  // circularity π/4 ≈ 0.79 and a diamond the same, so an early ellipse gate
  // would swallow both. Classify by corners first; ellipse is the round fallback.

  // TRIANGLE: roughly three corners. Confidence from how clean the 3-gon is.
  if (corners === 3 && verts.length >= 3) {
    const tri = pickCorners(verts, 3);
    // Triangle area / bbox area peaks near 0.5 for a well-formed triangle.
    const fit = clamp(shoelaceArea(tri) / (width * height || 1) / 0.5, 0, 1);
    // Floor below minConfidence so a thin/degenerate 3-gon is actually rejected.
    const confidence = clamp(0.35 + 0.6 * fit, 0, 1);
    return confidence >= minConfidence ? make("triangle", confidence, tri) : null;
  }

  // 4 corners → RECTANGLE vs DIAMOND.
  if (corners === 4 && verts.length >= 4) {
    const quad = pickCorners(verts, 4);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // (a) bbox corners; (b) bbox edge-midpoints.
    const rectCorners: Point[] = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];
    const diamondCorners: Point[] = [
      [cx, minY],
      [maxX, cy],
      [cx, maxY],
      [minX, cy],
    ];

    const rectErr = matchError(quad, rectCorners);
    const diamondErr = matchError(quad, diamondCorners);

    if (rectErr <= diamondErr) {
      // Rectangle also expects edges roughly parallel to the axes.
      const axisErr = axisAlignment(quad);
      const err = (rectErr + axisErr) / 2;
      const confidence = clamp(1 - err / (0.5 * d), 0, 1);
      return confidence >= minConfidence ? make("rectangle", confidence, undefined) : null;
    }
    const confidence = clamp(1 - diamondErr / (0.5 * d), 0, 1);
    return confidence >= minConfidence ? make("diamond", confidence, undefined) : null;
  }

  // ELLIPSE: smooth outline with no dominant 3/4-corner structure.
  if (C >= 0.72) {
    const confidence = clamp(C, 0, 1);
    return confidence >= minConfidence ? make("ellipse", confidence, undefined) : null;
  }

  // Fallback: fairly round but not a clean ellipse → low-confidence ellipse.
  if (C >= 0.6) {
    const confidence = clamp(C - 0.1, 0, 1);
    return confidence >= minConfidence ? make("ellipse", confidence, undefined) : null;
  }

  return null;
}

/* ───────────────────────────  classification helpers  ─────────────────────────── */

/**
 * Pick the `count` sharpest vertices from a closed simplified polyline, kept in
 * traversal order. Used to recover triangle/quad corners when RDP left extras.
 */
function pickCorners(verts: Point[], count: number): Point[] {
  const n = verts.length;
  if (n <= count) return verts.slice();
  // Score each vertex by its turn angle; keep the `count` sharpest, in order.
  const scored = verts.map((b, i) => {
    const a = verts[(i - 1 + n) % n];
    const c = verts[(i + 1) % n];
    return { i, angle: turnAngle(a, b, c) };
  });
  const keep = scored
    .slice()
    .sort((p, q) => q.angle - p.angle)
    .slice(0, count)
    .map((s) => s.i)
    .sort((p, q) => p - q);
  return keep.map((i) => verts[i]);
}

/**
 * Mean paired distance between a candidate quad and a reference set under the
 * best 1:1 correspondence. The quad is in traversal order and each reference
 * set is in a fixed order, so we try every rotation and both orientations and
 * keep the lowest mean. The bijection prevents a collapsed quad from cheating
 * by mapping several of its corners onto a single reference point. Lower = better.
 */
function matchError(quad: Point[], reference: Point[]): number {
  const n = reference.length;
  if (quad.length !== n) return Infinity;
  const orientations = [quad, quad.slice().reverse()];
  let best = Infinity;
  for (const q of orientations) {
    for (let off = 0; off < n; off++) {
      let total = 0;
      for (let i = 0; i < n; i++) total += dist(q[(i + off) % n], reference[i]);
      best = Math.min(best, total / n);
    }
  }
  return best;
}

/**
 * For a quad, mean deviation of each edge from the nearest axis (horizontal or
 * vertical). 0 = perfectly axis-aligned. Measured in scene units.
 */
function axisAlignment(quad: Point[]): number {
  const n = quad.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % n];
    const dx = Math.abs(b[0] - a[0]);
    const dy = Math.abs(b[1] - a[1]);
    // The smaller of the two components is the off-axis "lean" of the edge.
    total += Math.min(dx, dy);
  }
  return total / n;
}
