// Fit to catalog size, triangle budget (meshopt simplification) and texture downscaling.

import {ImageUtils} from "@gltf-transform/core"
import {prune, simplify, textureCompress, weld} from "@gltf-transform/functions"
import {MeshoptSimplifier} from "meshoptimizer"
import sharp from "sharp"
import {countTriangles, sceneBox} from "./gltf.mjs"

export const HARD_TRIANGLE_CAP = 60000
export const DEFAULT_MAX_TRIANGLES = 15000
export const MAX_TEXTURE_PX = 1024

/**
 * Scales and moves the default scene so its bounding box is `target` (metres, model axes
 * {x, y, z}) with the pivot at the bottom centre. Done with one wrapper node, so the model's
 * own node transforms are kept.
 */
export function fitToSize(doc, target) {
  const root = doc.getRoot()
  const scene = root.getDefaultScene() || root.listScenes()[0]
  const box = sceneBox(doc)
  if (!(box.x > 0 && box.y > 0 && box.z > 0)) throw new Error("model has no visible geometry")
  const s = [target.x / box.x, target.y / box.y, target.z / box.z]
  const fit = doc.createNode("SidleFit").setScale(s).setTranslation([
    -((box.min[0] + box.max[0]) / 2) * s[0],
    -box.min[1] * s[1],
    -((box.min[2] + box.max[2]) / 2) * s[2],
  ])
  for (const child of scene.listChildren()) {
    scene.removeChild(child)
    fit.addChild(child)
  }
  scene.addChild(fit)
}

/** MeshoptSimplifier with extra meshopt flags added to every simplify() call. */
function withFlags(extra) {
  const M = MeshoptSimplifier
  return {
    ready: M.ready,
    simplify: (indices, positions, stride, target, error, flags = []) => M.simplify(indices, positions, stride, target, error, [...flags, ...extra]),
    simplifyPoints: (...a) => M.simplifyPoints(...a),
    compactMesh: (...a) => M.compactMesh(...a),
  }
}

/**
 * meshopt simplification of the whole document towards `target` triangles, within `error`
 * (fraction of the mesh extent). First keeps UV/normal seams; when seams stop it above the
 * target (typical for FBX/OBJ exports), a second pass may collapse across them ("Permissive").
 */
export async function meshoptSimplify(doc, target, error) {
  await MeshoptSimplifier.ready
  for (const flags of [[], ["Permissive"]]) {
    const n = countTriangles(doc)
    if (n <= target) return
    await doc.transform(weld(), simplify({simplifier: withFlags(flags), ratio: Math.min(1, (target / n) * 0.98), error}), prune())
  }
}

/**
 * Triangle budget: simplify to `limit`; if still above, retry once at double the limit with a
 * looser error. Never above HARD_TRIANGLE_CAP. Returns {ok, before, after, warning?, reason?};
 * ok=false means the piece must not be written.
 * `simplifyFn(doc, target, error)` is injectable for tests.
 */
export async function reduceTriangles(doc, limit = DEFAULT_MAX_TRIANGLES, simplifyFn = meshoptSimplify, count = countTriangles) {
  const cap = Math.min(limit, HARD_TRIANGLE_CAP)
  const before = count(doc)
  if (before <= cap) return {ok: true, before, after: before}
  await simplifyFn(doc, cap, 0.01)
  let after = count(doc)
  if (after <= cap) return {ok: true, before, after}
  const retry = Math.min(cap * 2, HARD_TRIANGLE_CAP)
  await simplifyFn(doc, retry, 0.05)
  after = count(doc)
  if (after <= cap) return {ok: true, before, after}
  if (after <= retry) {
    return {ok: true, before, after, warning: `${after} triangles is above --max-triangles ${cap}; kept after the retry at ${retry}`}
  }
  return {
    ok: false,
    before,
    after,
    reason: `still ${after} triangles after simplifying to ${cap} and retrying at ${retry} (never written above ${HARD_TRIANGLE_CAP})`,
  }
}

/** Downscales every texture to at most `max` px on its longer side, keeping its format. */
export async function shrinkTextures(doc, max = MAX_TEXTURE_PX) {
  if (!doc.getRoot().listTextures().length) return
  await doc.transform(textureCompress({encoder: sharp, resize: [max, max]}))
}

/** Largest texture as "W×H" (by pixel count), or "none". */
export function largestTexture(doc) {
  let best = null
  for (const t of doc.getRoot().listTextures()) {
    const img = t.getImage()
    const size = img && ImageUtils.getSize(img, t.getMimeType())
    if (size && (!best || size[0] * size[1] > best[0] * best[1])) best = size
  }
  return best ? `${best[0]}×${best[1]}` : "none"
}
