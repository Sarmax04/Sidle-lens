// Separate texture maps next to an FBX → glTF material slots, by filename keyword.
// basecolor/albedo → baseColor, normal → normal, roughness + metallic → metallicRoughness (G/B),
// AO → occlusion (R of the same packed image). Height/displacement/bump maps are ignored.

import {readdir, readFile} from "node:fs/promises"
import {extname, join} from "node:path"
import sharp from "sharp"

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg"])

// Matched against whole filename tokens (split on anything but letters/digits), first match wins.
const SLOT_KEYWORDS = [
  ["ignore", ["height", "displacement", "disp", "bump", "heightmap"]],
  ["baseColor", ["basecolor", "albedo", "diffuse", "color", "colour", "col"]],
  ["normal", ["normal", "nrm", "normalgl", "normaldx"]],
  ["roughness", ["roughness", "rough"]],
  ["metallic", ["metallic", "metalness", "metal"]],
  ["occlusion", ["ao", "occlusion", "ambientocclusion"]],
]

/** "Sofa_4_ Basecolor-1K.png" → "baseColor"; "ignore" for height maps; null when no keyword matches. */
export function classifyTexture(filename) {
  if (!IMAGE_EXT.has(extname(filename).toLowerCase())) return null
  const tokens = filename
    .slice(0, -extname(filename).length)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  for (const [slot, words] of SLOT_KEYWORDS) if (tokens.some((t) => words.includes(t))) return slot
  return null
}

/** {baseColor?, normal?, roughness?, metallic?, occlusion?} file paths in `dir`, plus ignored/unknown names. */
export function pickTextures(filenames, dir = "") {
  const set = {}
  const ignored = []
  const unknown = []
  for (const name of [...filenames].sort()) {
    const slot = classifyTexture(name)
    if (slot === "ignore") ignored.push(name)
    else if (slot === null) {
      if (IMAGE_EXT.has(extname(name).toLowerCase())) unknown.push(name)
    } else if (!set[slot]) set[slot] = join(dir, name)
    else unknown.push(name) // second map for the same slot
  }
  return {set, ignored, unknown}
}

export async function findTextures(dir) {
  return pickTextures(await readdir(dir), dir)
}

async function grey(path, size) {
  const img = sharp(await readFile(path)).greyscale()
  const resized = size ? img.resize(size[0], size[1], {fit: "fill"}) : img
  const {data, info} = await resized.raw().toBuffer({resolveWithObject: true})
  return {data, width: info.width, height: info.height, channels: info.channels}
}

/** Packs AO (R), roughness (G) and metallic (B) into one PNG, sized like the largest input. */
export async function packOrm({occlusion, roughness, metallic}) {
  const paths = [occlusion, roughness, metallic].filter(Boolean)
  let w = 0
  let h = 0
  for (const p of paths) {
    const m = await sharp(await readFile(p)).metadata()
    if (m.width * m.height > w * h) (w = m.width), (h = m.height)
  }
  const fill = [255, 255, 0] // no AO = unoccluded, no roughness map = rough, no metallic map = dielectric
  const out = Buffer.alloc(w * h * 3)
  const srcs = [occlusion, roughness, metallic]
  for (let c = 0; c < 3; c++) {
    if (!srcs[c]) {
      for (let i = 0; i < w * h; i++) out[i * 3 + c] = fill[c]
      continue
    }
    const g = await grey(srcs[c], [w, h])
    for (let i = 0; i < w * h; i++) out[i * 3 + c] = g.data[i * g.channels]
  }
  return sharp(out, {raw: {width: w, height: h, channels: 3}}).png().toBuffer()
}

function texture(doc, name, buf, mime) {
  return doc.createTexture(name).setImage(new Uint8Array(buf)).setMimeType(mime)
}

/**
 * Puts the texture set on every material of `doc`. Returns warnings
 * (e.g. a slot that already had a texture from the FBX).
 */
export async function applyTextures(doc, set) {
  const warnings = []
  const mats = doc.getRoot().listMaterials()
  if (!mats.length) return ["model has no materials; textures not applied"]
  const mime = (p) => (/\.png$/i.test(p) ? "image/png" : "image/jpeg")
  const base = set.baseColor && texture(doc, "baseColor", await readFile(set.baseColor), mime(set.baseColor))
  const normal = set.normal && texture(doc, "normal", await readFile(set.normal), mime(set.normal))
  const hasOrm = set.occlusion || set.roughness || set.metallic
  const orm = hasOrm && texture(doc, "occlusionRoughnessMetallic", await packOrm(set), "image/png")
  for (const m of mats) {
    const replace = (slot, current) => current && warnings.push(`material "${m.getName()}": replaced its ${slot} texture`)
    if (base) {
      replace("baseColor", m.getBaseColorTexture())
      m.setBaseColorTexture(base).setBaseColorFactor([1, 1, 1, m.getBaseColorFactor()[3]])
    }
    if (normal) {
      replace("normal", m.getNormalTexture())
      m.setNormalTexture(normal)
    }
    if (orm && (set.roughness || set.metallic)) {
      replace("metallicRoughness", m.getMetallicRoughnessTexture())
      m.setMetallicRoughnessTexture(orm).setRoughnessFactor(1).setMetallicFactor(set.metallic ? 1 : 0)
    }
    if (orm && set.occlusion) {
      replace("occlusion", m.getOcclusionTexture())
      m.setOcclusionTexture(orm)
    }
  }
  return warnings
}
