/**
 * Colour maths for the palette lock.
 *
 * Everything here works in OkLab rather than RGB, and that is the one decision
 * in this file worth defending. Euclidean distance in RGB is not distance to
 * the eye: it treats the gap between two near-blacks as large and the gap
 * between two mid-greens as small, when the eye reads it the other way round.
 * Snapping art to a palette with RGB distance therefore destroys shadow detail
 * — which on a character sprite is the shading — while leaving flat bright
 * areas untouched. OkLab is near enough to uniform that nearest-colour means
 * what it says.
 *
 * Pure: no file reading, no writing, no process exit. The scripts that use it
 * do the I/O, and this file can be tested with arithmetic alone.
 */

/** sRGB is gamma-encoded; every transform below needs light, not bytes. */
function linearise(byte) {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function delinearise(value) {
  const v = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** Björn Ottosson's OkLab, the published matrices. */
export function srgbToOklab(r, g, b) {
  const lr = linearise(r);
  const lg = linearise(g);
  const lb = linearise(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToSrgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    delinearise(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    delinearise(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    delinearise(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Squared distance would do for ranking, but callers also print this. */
export function distance(p, q) {
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/**
 * Splits a packed 24-bit `0xRRGGBB` integer into its three channel bytes.
 *
 * This exact triple of shifts and masks used to be typed out separately in
 * five places across `derive-palette.mjs`, its test, and `palette-lock.test.mjs`
 * (apply-palette.mjs had its own copy too) — every one of them existing only
 * to feed `srgbToOklab`. A file whose entire job is colour maths is the right
 * place for the one copy; a caller with a packed int (a pixel key from a
 * histogram, say) uses this directly, and `hexToRgb`/`hexToOklab` below build
 * on it for the far more common case of a `"#rrggbb"` string.
 */
export function unpackRgb(n) {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `"#rrggbb"` -> `[r, g, b]`. */
export function hexToRgb(hex) {
  return unpackRgb(Number.parseInt(hex.slice(1), 16));
}

/** `"#rrggbb"` -> OkLab, the shape almost every caller actually wants a hex in. */
export function hexToOklab(hex) {
  return srgbToOklab(...hexToRgb(hex));
}

/** OkLab -> `"#rrggbb"`, the exact inverse of `hexToOklab`. */
export function oklabToHex(lab) {
  return `#${oklabToSrgb(lab).map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Index of the closest palette entry. Linear: 48 entries is nothing. */
export function nearestIndex(lab, palette) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const d = distance(lab, palette[i]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/**
 * A seeded generator, so a palette is a function of the art and nothing else.
 *
 * Without this, k-means++ seeds from Math.random and two runs over identical
 * input produce two different palettes — which would mean the committed
 * `art/palette.json` could never be regenerated and checked against itself.
 */
function prng(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weighted k-means with k-means++ seeding.
 *
 * Weighted because the input is a colour histogram, not a pixel dump: a colour
 * covering ten thousand pixels of grass and a colour used once on a button
 * must not get equal say. Unweighted k-means over distinct colours spends
 * palette entries on rare colours, which is the opposite of what a palette is
 * for.
 */
export function kmeans(points, k, seed) {
  // Fewer distinct colours than the ramp has steps: return what there is,
  // sorted, because callers name entries by position and an unsorted short
  // ramp would come out light-to-dark in the middle of a palette that is
  // dark-to-light everywhere else.
  if (points.length <= k) {
    return points
      .map(({ L, a, b }) => ({ L, a, b }))
      .sort((p, q) => p.L - q.L || p.a - q.a || p.b - q.b);
  }

  const random = prng(seed);

  // k-means++: first centre at random, each next one biased toward points far
  // from every centre chosen so far. Plain random seeding regularly puts two
  // centres inside the same cluster and leaves a whole hue unrepresented.
  const centroids = [];
  const first = points[Math.floor(random() * points.length)];
  centroids.push({ L: first.L, a: first.a, b: first.b });

  while (centroids.length < k) {
    const weights = points.map((p) => {
      const d = distance(p, centroids[nearestIndex(p, centroids)]);
      return d * d * p.weight;
    });
    const total = weights.reduce((sum, w) => sum + w, 0);
    let target = random() * total;
    let chosen = points.length - 1;
    for (let i = 0; i < weights.length; i += 1) {
      target -= weights[i];
      if (target <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push({ L: points[chosen].L, a: points[chosen].a, b: points[chosen].b });
  }

  // Lloyd iterations. Fifty is well past convergence for this input size, and
  // a fixed count keeps the function deterministic rather than tolerance-bound.
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const sums = centroids.map(() => ({ L: 0, a: 0, b: 0, weight: 0 }));
    for (const p of points) {
      const bucket = sums[nearestIndex(p, centroids)];
      bucket.L += p.L * p.weight;
      bucket.a += p.a * p.weight;
      bucket.b += p.b * p.weight;
      bucket.weight += p.weight;
    }
    for (let i = 0; i < centroids.length; i += 1) {
      // An emptied centroid keeps its position rather than vanishing: k must
      // stay k, because the ramp sizes downstream are fixed.
      if (sums[i].weight === 0) continue;
      centroids[i] = {
        L: sums[i].L / sums[i].weight,
        a: sums[i].a / sums[i].weight,
        b: sums[i].b / sums[i].weight,
      };
    }
  }

  // Sorted so the output is stable regardless of seeding order.
  return centroids.sort((p, q) => p.L - q.L || p.a - q.a || p.b - q.b);
}
