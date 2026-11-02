// Poly Haven public API client (https://api.polyhaven.com, docs: https://api.polyhaven.com/api-docs/).
// ToS 2.4: every call carries a User-Agent naming this software. No keys, no page scraping.
// Requests are sequential with a short pause between them so we never load the API heavily (ToS 2.6).

import {createHash} from "node:crypto"
import {mkdir, writeFile, readFile} from "node:fs/promises"
import {dirname, join} from "node:path"
import {safeFetch} from "./net.mjs"

export const USER_AGENT = "Sidle-Importer/1.0 (Sidle Lens furniture importer; Node CLI)"
const API = "https://api.polyhaven.com"
const PAUSE_MS = 250

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Returns the asset id from https://polyhaven.com/a/<id>, exactly as written (ids are case-sensitive). */
export function polyHavenId(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (!/(^|\.)polyhaven\.com$/i.test(u.hostname)) return null
  const m = u.pathname.match(/^\/a\/([^/?#]+)\/?$/)
  return m ? decodeURIComponent(m[1]) : null
}

async function get(url) {
  const res = await safeFetch(url, {headers: {"User-Agent": USER_AGENT}})
  await sleep(PAUSE_MS)
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") || 5) * 1000
    console.warn(`  rate limited, waiting ${wait / 1000}s`)
    await sleep(wait)
    return get(url)
  }
  return res
}

async function getJson(url) {
  const res = await get(url)
  const body = await res.text()
  let json
  try {
    json = JSON.parse(body)
  } catch {
    throw new Error(`${url}: HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  if (!res.ok || json.error) throw new Error(`${url}: HTTP ${res.status}: ${json.error || body.slice(0, 200)}`)
  return json
}

export async function assetInfo(id) {
  const info = await getJson(`${API}/info/${encodeURIComponent(id)}`)
  if (info.type !== 2) throw new Error(`Poly Haven asset "${id}" is not a model (type ${info.type})`)
  return info
}

export async function assetFiles(id) {
  return getJson(`${API}/files/${encodeURIComponent(id)}`)
}

async function downloadVerified(entry, dest) {
  // reuse an earlier download if it still matches the published md5
  try {
    const existing = await readFile(dest)
    if (createHash("md5").update(existing).digest("hex") === entry.md5) return existing.length
  } catch {}
  const res = await get(entry.url)
  if (!res.ok) throw new Error(`${entry.url}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const md5 = createHash("md5").update(buf).digest("hex")
  if (entry.md5 && md5 !== entry.md5) throw new Error(`${entry.url}: md5 mismatch (${md5} != ${entry.md5})`)
  await mkdir(dirname(dest), {recursive: true})
  await writeFile(dest, buf)
  return buf.length
}

/**
 * Downloads the glTF at the given texture resolution into dir, laid out with the relative
 * paths the .gltf references. Returns the local path of the .gltf (or .glb).
 */
export async function downloadGltf(files, dir, resolution = "1k") {
  const res = files.gltf?.[resolution]
  if (!res) throw new Error(`no glTF at ${resolution} (available: ${Object.keys(files.gltf || {}).join(", ") || "none"})`)
  const main = res.gltf || res.glb
  const mainName = decodeURIComponent(new URL(main.url).pathname.split("/").pop())
  const mainPath = join(dir, mainName)
  await downloadVerified(main, mainPath)
  for (const [rel, entry] of Object.entries(main.include || {})) {
    if (rel.includes("..") || rel.startsWith("/")) throw new Error(`unsafe include path: ${rel}`)
    await downloadVerified(entry, join(dir, rel))
  }
  return mainPath
}

/** Poly Haven category path → Sidle category. Anything that is not a sofa, chair or table ("other") maps to bed. */
export function mapCategory(category) {
  const parts = String(category || "").toLowerCase().split("/")
  if (parts.some((p) => /\bsofas?\b/.test(p))) return "sofa"
  if (parts.some((p) => /\bchairs?\b/.test(p))) return "chair"
  if (parts.some((p) => /\btables?\b/.test(p))) return "table"
  return "bed"
}

/** API dimensions are millimetres in Blender axes [x, y, z] = [width, depth, height]. */
export function apiDimsCm(info) {
  const d = info.dimensions
  if (!Array.isArray(d) || d.length < 3) return null
  const r = (mm) => Math.round(mm / 10 * 10) / 10
  return {width: r(d[0]), depth: r(d[1]), height: r(d[2])}
}

export function authorsCredit(info) {
  const names = Object.keys(info.authors || {})
  return names.length ? names.join(" & ") : "Unknown author"
}
