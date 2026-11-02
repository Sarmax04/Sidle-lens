// Plausible furniture sizes, catalog orientation (yawDeg) and OBJ unit guessing.
// Catalog dimensions are what the Lens shows after yawDeg: W = X, D = Z, H = Y (cm).

/** Plausible catalog sizes in cm, [min, max] per axis. `longSide: "depth"`: the long side runs front to back. */
export const RANGES = {
  sofa: {width: [140, 300], depth: [70, 120], height: [60, 110]},
  chair: {width: [50, 110], depth: [50, 110], height: [60, 120]},
  table: {width: [40, 240], depth: [40, 150], height: [30, 110]},
  bed: {width: [90, 220], depth: [180, 230], height: [20, 200], longSide: "depth"},
}

/** Units an OBJ can be in, with their size in cm. OBJ files carry no unit. */
export const OBJ_UNITS = {mm: 0.1, cm: 1, m: 100}

const r1 = (v) => Math.round(v * 10) / 10

/** Problems with `dims` for `category` (empty = plausible); null when the category has no range. */
export function checkPlausible(category, dims, ranges = RANGES) {
  const range = ranges[category]
  if (!range) return null
  const problems = []
  for (const axis of ["width", "depth", "height"]) {
    const [lo, hi] = range[axis]
    const v = dims[axis]
    if (!(v >= lo && v <= hi)) problems.push(`${axis} ${v} cm is outside ${lo}-${hi} cm`)
  }
  return problems
}

/**
 * Catalog yaw and dimensions for a model whose bounding box is `box` (cm, model axes x/y/z).
 * `yawFlag` (degrees) wins when given. Otherwise a category whose long side is its depth (bed)
 * gets yawDeg 90 when the model's long side is on X, so it is turned instead of refused.
 */
export function orient(category, box, yawFlag = null, ranges = RANGES) {
  let yawDeg = 0
  if (yawFlag != null) yawDeg = yawFlag
  else if (ranges[category]?.longSide === "depth" && box.x > box.z) yawDeg = 90
  const quarter = ((Math.round(yawDeg) % 180) + 180) % 180 === 90
  return {yawDeg, dims: {width: r1(quarter ? box.z : box.x), depth: r1(quarter ? box.x : box.z), height: r1(box.y)}}
}

/**
 * Units under which an OBJ's raw bounding box (`raw`, file units) gives a plausible piece.
 * Returns [{unit, yawDeg, dims}] — exactly one entry means the guess is safe.
 */
export function guessObjUnits(category, raw, yawFlag = null, ranges = RANGES) {
  const fits = []
  for (const [unit, cm] of Object.entries(OBJ_UNITS)) {
    const o = orient(category, {x: raw.x * cm, y: raw.y * cm, z: raw.z * cm}, yawFlag, ranges)
    const problems = checkPlausible(category, o.dims, ranges)
    if (problems && problems.length === 0) fits.push({unit, ...o})
  }
  return fits
}

/** "220 × 90 × 85 cm" */
export function fmtWDH(d) {
  return `${d.width} × ${d.depth} × ${d.height} cm`
}
