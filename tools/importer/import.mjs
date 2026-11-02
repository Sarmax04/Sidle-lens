#!/usr/bin/env node
// Sidle model importer — a dev tool, not part of the Lens.
//
//   node tools/importer/import.mjs <url-or-local-html> [options]       Poly Haven link or product page
//   node tools/importer/import.mjs --model <file-or-folder> [options]  local .glb/.gltf/.fbx/.obj
//   node tools/importer/import.mjs --add-thumbnails                    thumbnails for catalog pieces without one
//
// Poly Haven links (https://polyhaven.com/a/<id>) use the public API: glTF at 1K textures.
// Any other page or local .html: dimensions from JSON-LD / microdata / text, model from --glb or --model.
// Every model is scaled to its catalog W × D × H (pivot at the bottom centre), checked against
// plausible furniture sizes, simplified to --max-triangles, textures capped at 1024 px, and gets
// a 256 px thumbnail. Results: Assets/Models/<slug>.glb, Assets/Models/thumbs/<slug>.png,
// Assets/Models/catalog.json, CREDITS.md. All network access goes through lib/net.mjs, which
// refuses the blocked sites (models from them are imported from local files only).

import {parseArgs} from "node:util"
import {spawnSync} from "node:child_process"
import v8 from "node:v8"
import {mkdir, readFile, stat, writeFile} from "node:fs/promises"
import {basename, dirname, extname, join, resolve} from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"
import * as cheerio from "cheerio"

import {extractDimensions, parseDimsFlag} from "./lib/dims.mjs"
import {readDocument, writeDocument, measureCm, countTriangles, sceneBox, singleBuffer} from "./lib/gltf.mjs"
import * as ph from "./lib/polyhaven.mjs"
import {slugify, upsertCatalog, appendCredit} from "./lib/catalog.mjs"
import {safeFetch} from "./lib/net.mjs"
import {resolveModel, loadModel} from "./lib/convert.mjs"
import {findTextures, applyTextures} from "./lib/textures.mjs"
import {RANGES, OBJ_UNITS, checkPlausible, orient, guessObjUnits, fmtWDH} from "./lib/ranges.mjs"
import {DEFAULT_MAX_TRIANGLES, fitToSize, reduceTriangles, shrinkTextures, largestTexture} from "./lib/optimize.mjs"
import {tryThumbnail} from "./lib/thumbs.mjs"
import {formatReport} from "./lib/report.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..")
const OUT = join(HERE, "out")
const TOLERANCE_PCT = 2
const HEAP_MB = 8192 // 400k-triangle models need more than Node's default heap while simplifying

const USAGE = `Usage:
  node tools/importer/import.mjs <url-or-local-html> [--glb <file> | --model <file-or-folder>] [options]
  node tools/importer/import.mjs --model <file.glb|.gltf|.fbx|.obj or folder> [options]
  node tools/importer/import.mjs --add-thumbnails

Options (same for URL and local imports):
  --name "..."          piece name (default: page/asset name, or the model's file name)
  --category <c>        sofa | chair | table | bed (default: from the source, or guessed from the name)
  --credit "..."        author / credit line
  --license "..."       license, e.g. CC0 or "CC BY 3.0"
  --source <url>        where a local model comes from (recorded only, never downloaded)
  --dims W,D,H          catalog width, depth, height; cm by default, a unit suffix is allowed
                        (also WxDxH, e.g. 2200x900x850mm). Default: the model's bounding box.
  --units cm|m|mm       unit of an .obj file (default: guessed from its size and category)
  --yaw <degrees>       catalog yawDeg (default: 0, or 90 for a bed whose long side is on X)
  --max-triangles <n>   triangle budget (default ${DEFAULT_MAX_TRIANGLES}; never above 60000)
  --models-dir <dir>    write models, thumbnails, catalog.json and CREDITS.md there instead of Assets/Models`

class UsageError extends Error {}
/** The piece is refused or skipped; the run still prints its report. */
class RefuseError extends Error {}

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

function joinCredit(credit, license) {
  return [credit, license].filter(Boolean).join(", ")
}

function domainOf(url) {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "") : "local"
  } catch {
    return "local"
  }
}

// --- Poly Haven --------------------------------------------------------------

async function importPolyHaven(id, opts) {
  console.log(`Poly Haven asset "${id}"`)
  const info = await ph.assetInfo(id)
  const files = await ph.assetFiles(id)
  const slug = slugify(opts.name || id)
  const downloaded = await ph.downloadGltf(files, join(OUT, slugify(id), "src"), "1k")
  console.log(`  downloaded glTF (1K textures) → ${dirname(downloaded)}`)

  const doc = await readDocument(downloaded)
  const measured = measureCm(doc)
  console.log(`  bounding box: ${fmtDims(measured)}`)
  const api = ph.apiDimsCm(info)
  const warnings = api ? crossCheck(measured, api, "Poly Haven API") : (console.warn("  WARNING API has no dimensions"), ["API has no dimensions"])

  const author = opts.credit || ph.authorsCredit(info)
  const license = opts.license || "CC0"
  if (opts.source) warnings.push("--source is ignored for Poly Haven links")
  return {
    slug,
    doc,
    warnings,
    entry: {
      id: slug,
      name: opts.name || info.name,
      category: opts.category || ph.mapCategory(info.category),
      sourceUrl: `https://polyhaven.com/a/${id}`,
      domain: "polyhaven.com",
      credit: joinCredit(author, license),
    },
    creditLine: (e) => `- \`${e.id}\` — "${e.name}" by ${author}, ${license}, via Poly Haven: ${e.sourceUrl}`,
  }
}

// --- other pages ---------------------------------------------------------------

async function loadPage(src) {
  if (/^https?:\/\//i.test(src)) {
    const res = await safeFetch(src, {headers: {"User-Agent": ph.USER_AGENT, "Accept-Language": "en,de;q=0.8"}})
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

/** Sofa / chair / table / bed from names and categories, or "other". */
export function guessCategory(...texts) {
  const t = texts.filter(Boolean).join(" ").toLowerCase().replace(/[_-]+/g, " ")
  if (/\b(sofa|couch|settee|ecksofa|schlafsofa|wohnlandschaft)/.test(t)) return "sofa"
  if (/(chair|stuhl|sessel|armchair|stool|hocker)/.test(t)) return "chair"
  if (/(table|tisch|desk|schreibtisch)/.test(t)) return "table"
  if (/\b(bed|bett)/.test(t)) return "bed"
  return "other"
}

async function saveMainImage(imageUrl, base, dest) {
  if (!imageUrl) return console.warn("  WARNING no main image found on the page")
  const url = new URL(imageUrl, base)
  let buf
  let type = ""
  if (url.protocol === "file:") buf = await readFile(fileURLToPath(url))
  else if (url.protocol === "data:" || /^https?:$/.test(url.protocol)) {
    const res = await safeFetch(url, {headers: {"User-Agent": ph.USER_AGENT}})
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
      `Could not find width, depth and height on ${src}.\nPlease re-run with --dims W,D,H (cm, or add a unit such as mm, m or in).`
    )
  }
  console.log(`  dimensions (${dims.source}): ${fmtDims(dims)}`)
  const modelPath = opts.glb || opts.model
  if (!modelPath) throw new UsageError(`--glb <file> or --model <file-or-folder> is required for pages other than Poly Haven.`)

  const meta = productInfo(page.html)
  const name = opts.name || meta.name || basename(src, extname(src))
  const slug = slugify(name)
  await saveMainImage(meta.image, page.base, join(OUT, slug, "source.jpg"))
  const local = await loadLocal(modelPath)
  const who = opts.credit || meta.brand || page.domain
  return {
    slug,
    doc: local.doc,
    rawUnits: local.rawUnits,
    warnings: local.warnings,
    pageDims: {width: dims.width, depth: dims.depth, height: dims.height},
    entry: {
      id: slug,
      name,
      category: opts.category || guessCategory(meta.category, name),
      sourceUrl: page.sourceUrl,
      domain: page.domain,
      credit: joinCredit(`Dimensions: ${who}; model: ${basename(local.file)}`, opts.license),
    },
    creditLine: (e) =>
      `- \`${e.id}\` — "${e.name}": dimensions from ${e.sourceUrl}; model ${basename(local.file)}${opts.license ? `, ${opts.license}` : " (check its license)"}`,
  }
}

// --- local models ----------------------------------------------------------------

/** Loads a local model; for FBX, maps the separate texture PNGs in its folder. */
async function loadLocal(path) {
  const model = await resolveModel(path)
  console.log(`  model ${model.file} (${model.kind.toUpperCase()})`)
  const {doc, rawUnits, warnings} = await loadModel(model)
  if (model.kind === "fbx") {
    const {set, ignored, unknown} = await findTextures(model.dir)
    const slots = Object.entries(set).map(([slot, p]) => `${slot}=${basename(p)}`)
    console.log(`  textures: ${slots.join(", ") || "none found"}${ignored.length ? `; ignored ${ignored.join(", ")}` : ""}`)
    if (unknown.length) warnings.push(`unmatched images: ${unknown.join(", ")}`)
    if (!set.baseColor) warnings.push("no basecolor/albedo texture found next to the FBX")
    warnings.push(...(await applyTextures(doc, set)))
  }
  return {...model, doc, rawUnits, warnings}
}

async function importLocal(opts) {
  console.log(`Local model ${opts.model}`)
  const local = await loadLocal(opts.model)
  const name = opts.name || basename(local.file, extname(local.file))
  const slug = slugify(name)
  const category = opts.category || guessCategory(name, basename(local.file), basename(local.dir))
  if (category === "other") throw new RefuseError(`cannot tell the category of "${name}"; pass --category sofa|chair|table|bed`)
  if (opts.source) assertRecordOnly(opts.source)
  const credit = joinCredit(opts.credit, opts.license)
  if (!opts.credit) local.warnings.push("no --credit given")
  if (!opts.license) local.warnings.push("no --license given")
  return {
    slug,
    doc: local.doc,
    rawUnits: local.rawUnits,
    warnings: local.warnings,
    entry: {
      id: slug,
      name,
      category,
      sourceUrl: opts.source || "",
      domain: opts.source ? domainOf(opts.source) : "local",
      credit: credit || "unknown",
    },
    creditLine: (e) =>
      `- \`${e.id}\` — "${e.name}"${opts.credit ? ` by ${opts.credit}` : ""}${opts.license ? `, ${opts.license}` : " (check its license)"}` +
      `${opts.source ? `: ${opts.source}` : ""} (local file ${basename(local.file)})`,
  }
}

/** --source is only written into the catalog; it must at least be a URL. */
function assertRecordOnly(source) {
  try {
    new URL(source)
  } catch {
    throw new UsageError(`--source must be a URL, got "${source}"`)
  }
}

// --- shared pipeline ---------------------------------------------------------------

/** Bounding box in cm (model axes) and catalog orientation; OBJ units are guessed unless --units/--dims. */
function sizeModel(result, opts) {
  const {category} = result.entry
  const raw = sceneBox(result.doc)
  if (!result.rawUnits) return {box: {x: raw.x * 100, y: raw.y * 100, z: raw.z * 100}}
  let unit = opts.units
  if (!unit && !opts.dims) {
    if (!RANGES[category]) throw new RefuseError(`OBJ files have no units and "${category}" has no plausible size range; pass --units cm|m|mm or --dims`)
    const fits = guessObjUnits(category, raw, opts.yaw)
    const options = Object.keys(OBJ_UNITS)
      .map((u) => `    --units ${u.padEnd(2)}  → ${fmtWDH(orient(category, {x: raw.x * OBJ_UNITS[u], y: raw.y * OBJ_UNITS[u], z: raw.z * OBJ_UNITS[u]}, opts.yaw).dims)}`)
      .join("\n")
    if (fits.length > 1) {
      throw new RefuseError(
        `OBJ units are ambiguous: ${fits.map((f) => f.unit).join(", ")} all give a plausible ${category}. Not guessing; re-run with one of:\n${options}`
      )
    }
    if (fits.length === 0) throw new RefuseError(`no OBJ unit gives a plausible ${category}:\n${options}\n  re-run with --units or --dims`)
    unit = fits[0].unit
    console.log(`  OBJ units: ${unit} (the only unit that gives a plausible ${category})`)
    result.warnings.push(`OBJ units guessed as ${unit}`)
  }
  const cm = OBJ_UNITS[unit || "cm"]
  return {box: {x: raw.x * cm, y: raw.y * cm, z: raw.z * cm}}
}

async function finishPiece(result, opts, paths, piece) {
  const e = result.entry
  piece.name = e.name
  piece.category = e.category
  piece.warnings = result.warnings

  const {box} = sizeModel(result, opts)
  const o = orient(e.category, box, opts.yaw)
  if (opts.yaw == null && o.yawDeg === 90) {
    console.log(`  long side is on X but a ${e.category} is longer than wide: yawDeg 90`)
    result.warnings.push("long side on X: yawDeg 90")
  }
  const dims = opts.dims ? {width: opts.dims.width, depth: opts.dims.depth, height: opts.dims.height} : result.pageDims || o.dims
  piece.dims = dims
  console.log(`  catalog size: ${fmtDims(dims)}${opts.dims ? " (--dims)" : result.pageDims ? " (page)" : " (model bounding box)"}`)

  const problems = checkPlausible(e.category, dims)
  if (problems === null) result.warnings.push(`no plausible size range for category "${e.category}"; not checked`)
  else if (problems.length) {
    const r = RANGES[e.category]
    throw new RefuseError(
      `${fmtWDH(dims)} is not a plausible ${e.category}: ${problems.join("; ")} ` +
        `(${e.category}: W ${r.width.join("-")}, D ${r.depth.join("-")}, H ${r.height.join("-")} cm). ` +
        `Check --category, --dims${result.rawUnits ? " or --units" : ""}.`
    )
  }

  const tri = await reduceTriangles(result.doc, opts.maxTriangles)
  piece.before = tri.before
  piece.after = tri.after
  console.log(`  triangles: ${tri.before.toLocaleString("en")} → ${tri.after.toLocaleString("en")}`)
  if (tri.warning) result.warnings.push(tri.warning)
  if (!tri.ok) throw new RefuseError(tri.reason)

  // after simplifying, so the written box is exactly the catalog size; a quarter turn swaps width and depth
  const quarter = ((Math.round(o.yawDeg) % 180) + 180) % 180 === 90
  fitToSize(result.doc, {x: (quarter ? dims.depth : dims.width) / 100, y: dims.height / 100, z: (quarter ? dims.width : dims.depth) / 100})

  await shrinkTextures(result.doc)
  piece.texture = largestTexture(result.doc)

  await mkdir(paths.models, {recursive: true})
  const dest = join(paths.models, `${result.slug}.glb`)
  singleBuffer(result.doc)
  await writeDocument(dest, result.doc)

  const thumb = await tryThumbnail(dest, join(paths.models, "thumbs", `${result.slug}.png`), `Models/thumbs/${result.slug}.png`)
  if (thumb.warning) result.warnings.push(thumb.warning)
  piece.thumbnail = thumb.thumbnail

  const entry = {
    id: e.id,
    name: e.name,
    category: e.category,
    sourceUrl: e.sourceUrl,
    domain: e.domain,
    widthCm: dims.width,
    depthCm: dims.depth,
    heightCm: dims.height,
    glb: `Models/${result.slug}.glb`,
    yawDeg: o.yawDeg,
    credit: e.credit,
    thumbnail: thumb.thumbnail,
  }
  const {updated} = await upsertCatalog(paths.catalog, entry)
  await appendCredit(paths.credits, entry.id, result.creditLine(entry))
  const size = (await stat(dest)).size
  console.log(`  ${updated ? "updated" : "added"} "${entry.id}" (${entry.category}) → ${dest} (${(size / 1024).toFixed(0)} KB)`)
}

/** Thumbnails for catalog pieces whose thumbnail is missing. */
async function addThumbnails(paths, pieces) {
  const items = JSON.parse(await readFile(paths.catalog, "utf8"))
  for (const it of items) {
    const piece = {name: it.name, category: it.category, dims: {width: it.widthCm, depth: it.depthCm, height: it.heightCm}, warnings: []}
    pieces.push(piece)
    const glb = join(dirname(paths.models), it.glb)
    const rel = `Models/thumbs/${it.id}.png`
    const png = join(paths.models, "thumbs", `${it.id}.png`)
    try {
      const doc = await readDocument(glb)
      piece.before = piece.after = countTriangles(doc)
      piece.texture = largestTexture(doc)
    } catch (e) {
      piece.warnings.push(`cannot read ${it.glb}: ${e.message}`)
    }
    if (it.thumbnail && (await stat(join(dirname(paths.models), it.thumbnail)).catch(() => null))) {
      piece.thumbnail = it.thumbnail
      piece.warnings.push("already had a thumbnail")
      continue
    }
    console.log(`Thumbnail for "${it.id}"`)
    const thumb = await tryThumbnail(glb, png, rel)
    if (thumb.warning) piece.warnings.push(thumb.warning)
    it.thumbnail = thumb.thumbnail
    piece.thumbnail = thumb.thumbnail
  }
  await writeFile(paths.catalog, JSON.stringify(items, null, 2) + "\n")
}

// --- main ----------------------------------------------------------------------

function parseOptions(argv) {
  const {values, positionals} = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      glb: {type: "string"},
      model: {type: "string"},
      dims: {type: "string"},
      name: {type: "string"},
      category: {type: "string"},
      credit: {type: "string"},
      license: {type: "string"},
      source: {type: "string"},
      units: {type: "string"},
      yaw: {type: "string"},
      "max-triangles": {type: "string"},
      "add-thumbnails": {type: "boolean"},
      "models-dir": {type: "string"},
      help: {type: "boolean", short: "h"},
    },
  })
  if (values.help) throw new UsageError(USAGE)
  const opts = {
    glb: values.glb,
    model: values.model,
    name: values.name,
    category: values.category?.trim().toLowerCase(),
    credit: values.credit,
    license: values.license,
    source: values.source,
    units: values.units?.toLowerCase(),
    addThumbnails: !!values["add-thumbnails"],
  }
  if (opts.addThumbnails ? positionals.length || opts.model : opts.model ? positionals.length : positionals.length !== 1) throw new UsageError(USAGE)
  if (values.dims) {
    opts.dims = parseDimsFlag(values.dims)
    if (!opts.dims) throw new UsageError(`--dims must look like 220,90,85 (cm), 220x90x85 or 2200x900x850mm, got "${values.dims}"`)
  }
  if (opts.units && !OBJ_UNITS[opts.units]) throw new UsageError(`--units must be ${Object.keys(OBJ_UNITS).join(", ")}, got "${values.units}"`)
  opts.yaw = values.yaw == null ? null : Number(values.yaw)
  if (opts.yaw != null && !Number.isFinite(opts.yaw)) throw new UsageError(`--yaw must be a number of degrees, got "${values.yaw}"`)
  opts.maxTriangles = values["max-triangles"] == null ? DEFAULT_MAX_TRIANGLES : Number(values["max-triangles"])
  if (!(Number.isInteger(opts.maxTriangles) && opts.maxTriangles > 0)) {
    throw new UsageError(`--max-triangles must be a positive whole number, got "${values["max-triangles"]}"`)
  }
  const models = values["models-dir"] ? resolve(values["models-dir"]) : join(REPO, "Assets", "Models")
  const paths = {
    models,
    catalog: join(models, "catalog.json"),
    credits: values["models-dir"] ? join(models, "CREDITS.md") : join(REPO, "CREDITS.md"),
  }
  return {opts, positionals, paths}
}

async function main(argv) {
  const {opts, positionals, paths} = parseOptions(argv)
  const pieces = []
  let failed = false
  try {
    if (opts.addThumbnails) await addThumbnails(paths, pieces)
    else {
      const piece = {warnings: []}
      pieces.push(piece)
      try {
        let result
        if (opts.model && !positionals.length) result = await importLocal(opts)
        else {
          const src = positionals[0]
          const phId = ph.polyHavenId(src)
          if (/polyhaven\.com/i.test(src) && !phId) throw new UsageError(`Expected a Poly Haven asset link like https://polyhaven.com/a/<id>, got ${src}`)
          if (phId && (opts.glb || opts.model)) console.warn("  --glb/--model are ignored for Poly Haven links (the model comes from the API)")
          result = phId ? await importPolyHaven(phId, opts) : await importPage(src, opts)
        }
        piece.name = result.entry.name
        piece.category = result.entry.category
        await finishPiece(result, opts, paths, piece)
      } catch (e) {
        if (!(e instanceof RefuseError)) throw e
        console.error(`  REFUSED: ${e.message}`)
        piece.skipped = e.message.split("\n")[0]
        failed = true
      }
    }
  } finally {
    if (pieces.length) console.log(`\n${formatReport(pieces)}`)
  }
  if (failed) process.exitCode = 1
}

/** Re-runs this script with a larger heap unless it already has one. */
function needsBiggerHeap() {
  return !process.env.SIDLE_IMPORTER_CHILD && v8.getHeapStatistics().heap_size_limit < (HEAP_MB - 512) * 1024 * 1024
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (needsBiggerHeap()) {
    const r = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: "inherit",
      env: {...process.env, SIDLE_IMPORTER_CHILD: "1"},
    })
    process.exit(r.status ?? 1)
  }
  main(process.argv.slice(2)).catch((err) => {
    if (err instanceof UsageError) {
      console.error(err.message)
      process.exit(2)
    }
    console.error(`Error: ${err.message}`)
    process.exit(1)
  })
}
