#!/usr/bin/env node
// Sidle model importer — a dev tool, not part of the Lens.
//
//   node tools/importer/import.mjs <url-or-local-html> [--glb <file.glb|.gltf>] [--dims WxDxH] [--name "..."] [--yaw degrees]
//
// Poly Haven links (https://polyhaven.com/a/<id>) use the public API: glTF at 1K textures,
// packed to .glb, dimensions from the model's bounding box (cross-checked against the API).
// Any other page or local .html: dimensions from JSON-LD / microdata / text, model from --glb.
// Results: Assets/Models/<slug>.glb, Assets/Models/catalog.json, CREDITS.md.

import {parseArgs} from "node:util"
import {copyFile, mkdir, readFile, stat, writeFile} from "node:fs/promises"
import {basename, dirname, extname, join, resolve} from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"
import * as cheerio from "cheerio"

import {extractDimensions, parseDimsFlag} from "./lib/dims.mjs"
import {packToGlb, readDocument, measureCm, countTriangles} from "./lib/gltf.mjs"
import * as ph from "./lib/polyhaven.mjs"
import {slugify, upsertCatalog, appendCredit} from "./lib/catalog.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..")
const OUT = join(HERE, "out")
const MODELS = join(REPO, "Assets", "Models")
const CATALOG = join(MODELS, "catalog.json")
const CREDITS = join(REPO, "CREDITS.md")
const TOLERANCE_PCT = 2

const USAGE = `Usage: node tools/importer/import.mjs <url-or-local-html> [--glb <file.glb|.gltf>] [--dims WxDxH] [--name "..."] [--yaw degrees]
  --dims   width x depth x height, cm by default; a unit suffix is allowed (e.g. 2200x900x850mm, 86x35x33in)`

class UsageError extends Error {}

function fmtDims(d) {
  return `${d.width} × ${d.depth} × ${d.height} cm (W × D × H)`
}

/** Warns for each axis that differs from the reference by more than TOLERANCE_PCT. Returns the warnings. */
function crossCheck(measured, reference, label) {
  const warnings = []
  for (const axis of ["width", "depth", "height"]) {
    const a = measured[axis]
    const b = reference[axis]
    if (!b) continue
    const pct = (Math.abs(a - b) / b) * 100
    if (pct > TOLERANCE_PCT) warnings.push(`${axis}: model ${a} cm vs ${label} ${b} cm (${pct.toFixed(1)}% off)`)
  }
  for (const w of warnings) console.warn(`  WARNING ${w}`)
  if (!warnings.length) console.log(`  model bounding box matches ${label} within ${TOLERANCE_PCT}%`)
  return warnings
}

async function modelToGlb(src, dir, slug) {
  await mkdir(dir, {recursive: true})
  const glb = join(dir, `${slug}.glb`)
  if (extname(src).toLowerCase() === ".gltf") {
    console.log(`  packing ${basename(src)} → ${slug}.glb`)
    await packToGlb(src, glb)
  } else if (extname(src).toLowerCase() === ".glb") {
    if (resolve(src) !== resolve(glb)) await copyFile(src, glb)
  } else {
    throw new UsageError(`model must be .glb or .gltf: ${src}`)
  }
  return glb
}

// --- Poly Haven --------------------------------------------------------------

async function importPolyHaven(id, opts) {
  console.log(`Poly Haven asset "${id}"`)
  const info = await ph.assetInfo(id)
  const files = await ph.assetFiles(id)
  const slug = slugify(id)
  const dir = join(OUT, slug)
  const downloaded = await ph.downloadGltf(files, join(dir, "src"), "1k")
  console.log(`  downloaded glTF (1K textures) → ${dir}`)
  const glb = await modelToGlb(downloaded, dir, slug)

  const doc = await readDocument(glb)
  const measured = measureCm(doc)
  console.log(`  bounding box: ${fmtDims(measured)}`)
  const api = ph.apiDimsCm(info)
  const warnings = api ? crossCheck(measured, api, "Poly Haven API") : (console.warn("  WARNING API has no dimensions"), [])

  const author = ph.authorsCredit(info)
  return {
    slug,
    glb,
    doc,
    warnings,
    entry: {
      id: slug,
      name: opts.name || info.name,
      category: ph.mapCategory(info.category),
      sourceUrl: `https://polyhaven.com/a/${id}`,
      domain: "polyhaven.com",
      dims: opts.dims || measured,
      credit: `${author}, CC0`,
    },
    creditLine: (e) => `- \`${e.id}\` — "${e.name}" by ${author}, CC0, via Poly Haven: ${e.sourceUrl}`,
  }
}

// --- other pages ---------------------------------------------------------------

async function loadPage(src) {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, {headers: {"User-Agent": ph.USER_AGENT, "Accept-Language": "en,de;q=0.8"}})
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`)
    return {html: await res.text(), base: res.url || src, sourceUrl: src, domain: new URL(src).hostname.replace(/^www\./, "")}
  }
  const path = resolve(src)
  return {html: await readFile(path, "utf8"), base: pathToFileURL(path).href, sourceUrl: pathToFileURL(path).href, domain: "local"}
}

function productInfo(html) {
  const $ = cheerio.load(html)
  let product = null
  $('script[type="application/ld+json"]').each((_, el) => {
    if (product) return
    try {
      const stack = [JSON.parse($(el).contents().text())]
      while (stack.length && !product) {
        const n = stack.pop()
        if (Array.isArray(n)) stack.push(...n)
        else if (n && typeof n === "object") {
          const t = [].concat(n["@type"] || [])
          if (t.some((x) => /Product$/.test(String(x)))) product = n
          else stack.push(...Object.values(n).filter((v) => v && typeof v === "object"))
        }
      }
    } catch {}
  })
  const ldImage = product && [].concat(product.image || [])[0]
  const image =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    (typeof ldImage === "string" ? ldImage : ldImage?.url) ||
    $('link[rel="image_src"]').attr("href") ||
    $('[itemprop="image"]').attr("content") ||
    $('[itemprop="image"]').attr("src") ||
    $("main img[src], img[src]").first().attr("src")
  const name =
    product?.name || $('meta[property="og:title"]').attr("content") || $("h1").first().text().trim() || $("title").text().trim()
  const brand = typeof product?.brand === "string" ? product.brand : product?.brand?.name
  return {name, image, brand, category: product?.category}
}

function guessCategory(...texts) {
  const t = texts.filter(Boolean).join(" ").toLowerCase()
  if (/\b(sofa|couch|settee|ecksofa|schlafsofa|wohnlandschaft)/.test(t)) return "sofa"
  if (/(chair|stuhl|sessel|armchair|stool|hocker)/.test(t)) return "chair"
  if (/(table|tisch|desk|schreibtisch)/.test(t)) return "table"
  return "other"
}

async function saveMainImage(imageUrl, base, dest) {
  if (!imageUrl) return console.warn("  WARNING no main image found on the page")
  const url = new URL(imageUrl, base)
  let buf
  let type = ""
  if (url.protocol === "file:") buf = await readFile(fileURLToPath(url))
  else if (url.protocol === "data:" || /^https?:$/.test(url.protocol)) {
    const res = await fetch(url, {headers: {"User-Agent": ph.USER_AGENT}})
    if (!res.ok) return console.warn(`  WARNING main image ${url}: HTTP ${res.status}`)
    type = res.headers.get("content-type") || ""
    buf = Buffer.from(await res.arrayBuffer())
  } else return console.warn(`  WARNING unsupported image URL ${url}`)
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8
  await mkdir(dirname(dest), {recursive: true})
  await writeFile(dest, buf)
  console.log(`  main image → ${dest}`)
  if (!isJpeg) console.warn(`  WARNING main image is not a JPEG (${type || "unknown type"}); saved its original bytes as source.jpg`)
}

async function importPage(src, opts) {
  console.log(`Page ${src}`)
  const page = await loadPage(src)
  const dims = opts.dims || extractDimensions(page.html)
  if (!dims) {
    throw new UsageError(
      `Could not find width, depth and height on ${src}.\nPlease re-run with --dims WxDxH (cm, or add a unit such as mm, m or in).`
    )
  }
  console.log(`  dimensions (${dims.source}): ${fmtDims(dims)}`)
  if (!opts.glb) throw new UsageError(`--glb <file.glb|.gltf> is required for pages other than Poly Haven.`)

  const meta = productInfo(page.html)
  const name = opts.name || meta.name || basename(src, extname(src))
  const slug = slugify(name)
  const dir = join(OUT, slug)
  const glb = await modelToGlb(resolve(opts.glb), dir, slug)
  await saveMainImage(meta.image, page.base, join(dir, "source.jpg"))

  const doc = await readDocument(glb)
  const measured = measureCm(doc)
  console.log(`  model bounding box: ${fmtDims(measured)}`)
  const warnings = crossCheck(measured, dims, "page")

  const who = meta.brand || page.domain
  return {
    slug,
    glb,
    doc,
    warnings,
    entry: {
      id: slug,
      name,
      category: guessCategory(meta.category, name),
      sourceUrl: page.sourceUrl,
      domain: page.domain,
      dims: {width: dims.width, depth: dims.depth, height: dims.height},
      credit: `Dimensions: ${who}; model: ${basename(opts.glb)}`,
    },
    creditLine: (e) => `- \`${e.id}\` — "${e.name}": dimensions from ${e.sourceUrl}; model ${basename(opts.glb)} (check its license)`,
  }
}

// --- main ----------------------------------------------------------------------

async function main(argv) {
  const {values, positionals} = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {glb: {type: "string"}, dims: {type: "string"}, name: {type: "string"}, yaw: {type: "string"}, help: {type: "boolean", short: "h"}},
  })
  if (values.help || positionals.length !== 1) throw new UsageError(USAGE)
  const src = positionals[0]

  const opts = {glb: values.glb, name: values.name}
  if (values.dims) {
    opts.dims = parseDimsFlag(values.dims)
    if (!opts.dims) throw new UsageError(`--dims must look like 220x90x85 (cm) or 2200x900x850mm, got "${values.dims}"`)
  }
  const yawDeg = values.yaw == null ? 0 : Number(values.yaw)
  if (!Number.isFinite(yawDeg)) throw new UsageError(`--yaw must be a number of degrees, got "${values.yaw}"`)

  const phId = ph.polyHavenId(src)
  if (/polyhaven\.com/i.test(src) && !phId) throw new UsageError(`Expected a Poly Haven asset link like https://polyhaven.com/a/<id>, got ${src}`)
  if (phId && opts.glb) console.warn("  --glb is ignored for Poly Haven links (the model comes from the API)")
  const result = phId ? await importPolyHaven(phId, opts) : await importPage(src, opts)

  await mkdir(MODELS, {recursive: true})
  const dest = join(MODELS, `${result.slug}.glb`)
  await copyFile(result.glb, dest) // unchanged copy of the final .glb

  const e = result.entry
  const entry = {
    id: e.id,
    name: e.name,
    category: e.category,
    sourceUrl: e.sourceUrl,
    domain: e.domain,
    widthCm: e.dims.width,
    depthCm: e.dims.depth,
    heightCm: e.dims.height,
    glb: `Models/${result.slug}.glb`,
    yawDeg,
    credit: e.credit,
  }
  const {updated} = await upsertCatalog(CATALOG, entry)
  await appendCredit(CREDITS, entry.id, result.creditLine(entry))

  const size = (await stat(dest)).size
  console.log(`  ${updated ? "updated" : "added"} "${entry.id}" (${entry.category}) → Assets/${entry.glb}`)
  console.log(`  ${(size / 1024).toFixed(0)} KB, ${countTriangles(result.doc).toLocaleString("en")} triangles`)
}

main(process.argv.slice(2)).catch((err) => {
  if (err instanceof UsageError) {
    console.error(err.message)
    process.exit(2)
  }
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
