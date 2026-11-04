/**
 * SidleTint — fabric colours (Update 9): the swatches and the tint of one piece visual.
 *
 * Owns: COLOR_SWATCHES (index 0 = "original") and PieceTint, which tints every
 * material under one piece visual root. The first time a visual is tinted its
 * materials are cloned (prefab and box materials are shared between pieces),
 * and their original values are kept so "original" restores them exactly.
 *
 * Two material kinds:
 *  - glTF (imported models): baseColorFactor multiplies the texture,
 *    emissiveFactor is added unlit. "blend" (default) keeps (1 - TINT_BLEND)
 *    of the textured, shaded colour, recoloured to the swatch hue, and adds
 *    TINT_BLEND of the swatch as emissive. For a neutral texel g (0..1) lit at
 *    1, the result is (1 - a) * g + a >= g: never darker, detail and shading
 *    kept at (1 - a) contrast. On light textures the swatch hue is
 *    desaturated just enough not to clip (the texture's average brightness is
 *    read once per material), because a saturated hue on a near-white surface
 *    cannot keep its brightness. "multiply" is the plain baseColorFactor *= swatch
 *    (kept for comparison; it darkens textured models).
 *  - flat (built-in boxes, fallback boxes): baseColor becomes the swatch hue at
 *    the part's original luminance, so each part keeps its lightness (the parts
 *    stay distinguishable) and nothing gets darker.
 * Colour maths in linear RGB; glTF factors are linear, flat colours are treated
 * as sRGB-encoded (the same convention the room's luminance check uses).
 *
 * Must not: hold experience state (SidleController owns the colour indices).
 */

export interface Swatch {
  name: string
  /** sRGB colour, or null for "original". */
  color: number[] | null
  /** Colour of the swatch button face. */
  face: number[]
}

/** Update 9 swatches; every face is at least mid-tone (WCAG relative luminance >= 0.35). */
export const COLOR_SWATCHES: Swatch[] = [
  {name: "original", color: null, face: [0.66, 0.66, 0.68]},
  {name: "light grey", color: [0.85, 0.85, 0.85], face: [0.85, 0.85, 0.85]},
  {name: "warm beige", color: [0.9, 0.8, 0.66], face: [0.9, 0.8, 0.66]},
  {name: "sage green", color: [0.7, 0.8, 0.66], face: [0.7, 0.8, 0.66]},
  {name: "dusty blue", color: [0.66, 0.76, 0.88], face: [0.66, 0.76, 0.88]},
  {name: "terracotta", color: [0.9, 0.6, 0.48], face: [0.9, 0.6, 0.48]},
]

export type TintMethod = "blend" | "multiply"

/** Share of the swatch added as emissive in "blend" (the rest is the textured colour). */
export const TINT_BLEND = 0.35

export function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
export function toSrgb(c: number): number {
  const v = Math.max(0, Math.min(1, c))
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}
/** Luminance of a linear RGB triple. */
export function lumLinear(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Assumed lighting gain on a lit surface facing the light (rendered / albedo), for the clipping limit. */
const LIGHT_GAIN = 1.15
/**
 * Dark textures: the textured (lit) part is amplified toward this average
 * albedo, at most MAX_DARK_GAIN times, so its shading and detail stay visible
 * next to the emissive swatch part. Light textures (above it) are not changed.
 */
const DARK_TARGET = 0.3
const MAX_DARK_GAIN = 20

interface TintEntry {
  mat: Material
  kind: "gltf" | "flat"
  base: vec4 // original baseColorFactor (glTF) or baseColor (flat)
  emissive: vec3 | null // original emissiveFactor (glTF)
  /** Average linear albedo luminance (texture average x factor), glTF only; measured once. */
  albedoLum: number
}

/**
 * Average linear luminance of a texture, sampled on up to 32 rows (every 4th
 * pixel), via a readable procedural copy. Null if the texture cannot be read.
 */
export function textureLuminance(tex: Texture | null | undefined): number | null {
  if (!tex) return null
  try {
    const copy = ProceduralTextureProvider.createFromTexture(tex)
    const prov = copy.control as ProceduralTextureProvider
    const w = copy.getWidth()
    const h = copy.getHeight()
    if (!(w > 0 && h > 0)) return null
    const rows = Math.min(32, h)
    const buf = new Uint8Array(w * 4)
    let sum = 0
    let n = 0
    for (let r = 0; r < rows; r++) {
      prov.getPixels(0, Math.floor(((r + 0.5) * h) / rows), w, 1, buf)
      for (let x = 0; x < w; x += 4) {
        const i = x * 4
        sum += lumLinear(toLinear(buf[i] / 255), toLinear(buf[i + 1] / 255), toLinear(buf[i + 2] / 255))
        n++
      }
    }
    return n ? sum / n : null
  } catch (e) {
    return null
  }
}

function readProp(pass: Pass, name: string): any {
  try {
    return (pass as any)[name]
  } catch (e) {
    return undefined
  }
}

export class PieceTint {
  private entries: TintEntry[] | null = null
  private applied = 0
  private appliedMethod: TintMethod = "blend"

  constructor(private readonly root: SceneObject) {}

  /** Swatch index currently applied to this visual. */
  get index(): number {
    return this.applied
  }

  apply(index: number, method: TintMethod): void {
    if (index === this.applied && method === this.appliedMethod) return
    if (index === 0 && !this.entries) {
      this.applied = 0
      this.appliedMethod = method
      return // never tinted: still on the original (shared) materials
    }
    this.ensureClones()
    const sw = COLOR_SWATCHES[index] ?? COLOR_SWATCHES[0]
    for (const e of this.entries!) {
      if (!sw.color) this.restore(e)
      else if (e.kind === "gltf") this.tintGltf(e, sw.color, method)
      else this.tintFlat(e, sw.color)
    }
    this.applied = index
    this.appliedMethod = method
  }

  private ensureClones(): void {
    if (this.entries) return
    this.entries = []
    const stack = [this.root]
    while (stack.length) {
      const so = stack.pop()!
      for (const v of so.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]) {
        const mats = v.materials
        if (!mats || mats.length === 0) continue
        const clones = mats.map((m) => m.clone())
        v.materials = clones
        for (const m of clones) {
          const p = m.mainPass
          const f = readProp(p, "baseColorFactor")
          if (f !== undefined && f !== null) {
            const em = readProp(p, "emissiveFactor")
            const texL = textureLuminance(readProp(p, "baseColorTexture"))
            // Unreadable texture: assume a light one (the safe side for brightness).
            const albedoLum = (texL ?? 0.8) * lumLinear(f.x, f.y, f.z)
            this.entries.push({mat: m, kind: "gltf", base: f, emissive: em ?? new vec3(0, 0, 0), albedoLum})
            continue
          }
          const c = readProp(p, "baseColor")
          if (c !== undefined && c !== null) this.entries.push({mat: m, kind: "flat", base: c, emissive: null, albedoLum: 0})
        }
      }
      for (let i = 0; i < so.getChildrenCount(); i++) stack.push(so.getChild(i))
    }
  }

  private restore(e: TintEntry): void {
    if (e.kind === "gltf") {
      e.mat.mainPass.baseColorFactor = e.base
      e.mat.mainPass.emissiveFactor = e.emissive
    } else {
      e.mat.mainPass.baseColor = e.base
    }
  }

  private tintGltf(e: TintEntry, swatch: number[], method: TintMethod): void {
    const f0 = e.base
    const e0 = e.emissive!
    const s = swatch.map(toLinear)
    if (method === "multiply") {
      e.mat.mainPass.baseColorFactor = new vec4(f0.x * s[0], f0.y * s[1], f0.z * s[2], f0.w)
      e.mat.mainPass.emissiveFactor = e0
      return
    }
    // Swatch hue at unit luminance, desaturated (mixed toward white, which keeps unit luminance) just
    // enough that a pixel of the material's average brightness does not clip: on light textures a
    // saturated hue would need channels above 1 and would end up darker.
    const ls = lumLinear(s[0], s[1], s[2])
    const hs = s.map((v) => v / ls)
    const peak = Math.max(hs[0], hs[1], hs[2])
    const y = e.albedoLum * LIGHT_GAIN
    const sat = peak <= 1 ? 1 : Math.max(0, Math.min(1, (1 / Math.max(y, 1e-3) - 1) / (peak - 1)))
    const h = hs.map((v) => 1 + (v - 1) * sat)
    // Albedo part: the original factor recoloured to the swatch hue at the original factor's luminance, scaled by (1 - a).
    const lf = lumLinear(f0.x, f0.y, f0.z)
    const fh = [f0.x * h[0], f0.y * h[1], f0.z * h[2]]
    const k = lf / Math.max(1e-6, lumLinear(fh[0], fh[1], fh[2]))
    const a = TINT_BLEND
    const gain = Math.max(1, Math.min(MAX_DARK_GAIN, DARK_TARGET / Math.max(e.albedoLum, 1e-4)))
    const g = k * (1 - a) * gain
    e.mat.mainPass.baseColorFactor = new vec4(fh[0] * g, fh[1] * g, fh[2] * g, f0.w)
    // Emissive part: a of the swatch hue at the original factor's luminance, added to the original emissive.
    e.mat.mainPass.emissiveFactor = new vec3(e0.x + a * lf * h[0], e0.y + a * lf * h[1], e0.z + a * lf * h[2])
  }

  private tintFlat(e: TintEntry, swatch: number[]): void {
    const o = [e.base.x, e.base.y, e.base.z].map(toLinear)
    const target = lumLinear(o[0], o[1], o[2])
    const s = swatch.map(toLinear)
    const ls = lumLinear(s[0], s[1], s[2])
    let c = s.map((v) => (v * target) / ls)
    if (Math.max(c[0], c[1], c[2]) > 1) {
      // Too bright for the hue: clip, then mix toward white until the luminance is back.
      c = c.map((v) => Math.min(1, v))
      const lc = lumLinear(c[0], c[1], c[2])
      const t = (target - lc) / Math.max(1e-6, 1 - lc)
      c = c.map((v) => v + (1 - v) * Math.max(0, t))
    }
    e.mat.mainPass.baseColor = new vec4(toSrgb(c[0]), toSrgb(c[1]), toSrgb(c[2]), e.base.w)
  }
}
