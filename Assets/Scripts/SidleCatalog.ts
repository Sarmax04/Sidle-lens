/**
 * SidleCatalog — imported pieces from the bundled catalog (Assets/Models).
 *
 * Owns: parsing catalog.json (skipping enabled:false entries), and building one
 * imported piece visual: the bundled GLB prefab normalized so its bounding box
 * matches the catalog width/depth/height, pivot at bottom centre, front facing
 * +Z after yawDeg — or a plain catalog-size box if the model is missing/broken.
 *
 * Normalized hierarchy under the piece root:
 *   Model_Fit (scale + offset)  >  Model_Yaw (yawDeg about +Y)  >  prefab instance
 *
 * Must not: download anything, read web pages or hold experience state.
 */
import {makeBox} from "./SidleBoxFactory"

export interface CatalogEntry {
  id: string
  name: string
  category: string
  sourceUrl: string
  domain: string
  widthCm: number
  depthCm: number
  heightCm: number
  glb: string
  yawDeg: number
  credit: string
}

export function warn(msg: string): void {
  print(`[Sidle] WARNING: ${msg}`)
}

/** Parse catalog text. Never throws; problems come back as warnings. */
export function parseCatalog(text: string | null): {entries: CatalogEntry[]; warnings: string[]} {
  const warnings: string[] = []
  const entries: CatalogEntry[] = []
  if (text === null || text === undefined) {
    warnings.push("catalog.json is missing; only built-in pieces are available")
    return {entries, warnings}
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    warnings.push(`catalog.json could not be parsed (${e}); only built-in pieces are available`)
    return {entries, warnings}
  }
  if (!Array.isArray(raw)) {
    warnings.push("catalog.json is not a list; only built-in pieces are available")
    return {entries, warnings}
  }
  const seen: {[id: string]: boolean} = {}
  raw.forEach((r: any, i: number) => {
    if (!r || typeof r !== "object") {
      warnings.push(`catalog entry ${i} is not an object; skipped`)
      return
    }
    if (r.enabled === false) return
    const w = Number(r.widthCm)
    const d = Number(r.depthCm)
    const h = Number(r.heightCm)
    const id = typeof r.id === "string" ? r.id : ""
    if (!id || !(w > 0) || !(d > 0) || !(h > 0)) {
      warnings.push(`catalog entry ${i} (${id || "no id"}) has no id or invalid dimensions; skipped`)
      return
    }
    if (seen[id]) {
      warnings.push(`catalog entry ${i} repeats id "${id}"; skipped`)
      return
    }
    seen[id] = true
    entries.push({
      id,
      name: typeof r.name === "string" && r.name ? r.name : id,
      category: String(r.category ?? ""),
      sourceUrl: String(r.sourceUrl ?? ""),
      domain: String(r.domain ?? ""),
      widthCm: w,
      depthCm: d,
      heightCm: h,
      glb: String(r.glb ?? ""),
      yawDeg: Number(r.yawDeg) || 0,
      credit: String(r.credit ?? ""),
    })
  })
  return {entries, warnings}
}

/** "Models/sofa_02.glb" -> "sofa_02" (bundled prefab asset name). */
export function glbBaseName(glb: string): string {
  const file = glb.split("/").pop() ?? glb
  return file.replace(/\.glb$/i, "")
}

/** AABB of every mesh visual under `root`, in `frame`'s local space; null if there are none. */
export function boundsIn(root: SceneObject, frame: SceneObject): {min: vec3; max: vec3} | null {
  const inv = frame.getTransform().getInvertedWorldTransform()
  let min = new vec3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE)
  let max = new vec3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE)
  let found = false
  const stack: SceneObject[] = [root]
  while (stack.length) {
    const so = stack.pop()!
    const visuals = so.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
    for (const v of visuals) {
      if (!v.mesh) continue
      const lo = v.localAabbMin()
      const hi = v.localAabbMax()
      const m = inv.mult(so.getTransform().getWorldTransform())
      for (let c = 0; c < 8; c++) {
        const p = m.multiplyPoint(new vec3(c & 1 ? hi.x : lo.x, c & 2 ? hi.y : lo.y, c & 4 ? hi.z : lo.z))
        min = new vec3(Math.min(min.x, p.x), Math.min(min.y, p.y), Math.min(min.z, p.z))
        max = new vec3(Math.max(max.x, p.x), Math.max(max.y, p.y), Math.max(max.z, p.z))
        found = true
      }
    }
    for (let i = 0; i < so.getChildrenCount(); i++) stack.push(so.getChild(i))
  }
  return found ? {min, max} : null
}

/**
 * Build the visual for one imported piece under `root` (piece-local: floor at
 * y = 0, front = +Z). Returns whether the real model was used.
 */
export function buildImportedVisual(
  root: SceneObject,
  entry: CatalogEntry,
  prefab: ObjectPrefab | null,
  fallbackMaterial: Material,
): {model: boolean; warning: string | null} {
  const W = entry.widthCm
  const D = entry.depthCm
  const H = entry.heightCm
  let warning: string | null = null
  if (prefab) {
    const fit = global.scene.createSceneObject("Model_Fit")
    fit.setParent(root)
    const yaw = global.scene.createSceneObject("Model_Yaw")
    yaw.setParent(fit)
    yaw.getTransform().setLocalRotation(quat.angleAxis((entry.yawDeg * Math.PI) / 180, vec3.up()))
    try {
      prefab.instantiate(yaw)
      // Measure in Model_Fit's frame while it is still identity (yaw already applied).
      const b = boundsIn(yaw, fit)
      const size = b ? b.max.sub(b.min) : null
      if (!b || !size || size.x < 1e-3 || size.y < 1e-3 || size.z < 1e-3) {
        throw new Error("model has no visible geometry")
      }
      const s = new vec3(W / size.x, H / size.y, D / size.z)
      const ft = fit.getTransform()
      ft.setLocalScale(s)
      ft.setLocalPosition(
        new vec3(-((b.min.x + b.max.x) / 2) * s.x, -b.min.y * s.y, -((b.min.z + b.max.z) / 2) * s.z),
      )
      return {model: true, warning: null}
    } catch (e) {
      warning = `model ${entry.glb} for "${entry.id}" failed to load (${e}); showing a plain box`
      fit.destroy()
    }
  } else {
    warning = `model ${entry.glb || "(none)"} for "${entry.id}" is missing; showing a plain box`
  }
  makeBox(root, "FallbackBox", new vec3(0, H / 2, 0), new vec3(W, H, D), fallbackMaterial)
  return {model: false, warning}
}
