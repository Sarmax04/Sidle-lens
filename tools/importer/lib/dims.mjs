// Real-world dimension extraction from product pages.
// Order of precedence: JSON-LD Product → microdata → English/German text patterns.
// Everything is returned in centimetres, rounded to 0.1 cm.

import * as cheerio from "cheerio"

const AXES = ["width", "depth", "height"]

// --- units -------------------------------------------------------------------

const UNIT_TO_CM = {cm: 1, mm: 0.1, m: 100, in: 2.54}

// schema.org / UN/CEFACT unit codes
const UNIT_CODES = {CMT: "cm", MMT: "mm", MTR: "m", INH: "in"}

/** Normalises a unit token ("Zentimeter", "inches", "″", "MMT", ...) to cm|mm|m|in, or null. */
export function normalizeUnit(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (UNIT_CODES[s.toUpperCase()]) return UNIT_CODES[s.toUpperCase()]
  const t = s.toLowerCase().replace(/\.$/, "")
  if (["cm", "cms", "centimeter", "centimeters", "centimetre", "centimetres", "zentimeter"].includes(t)) return "cm"
  if (["mm", "millimeter", "millimeters", "millimetre", "millimetres"].includes(t)) return "mm"
  if (["m", "meter", "meters", "metre", "metres"].includes(t)) return "m"
  if (["in", "inch", "inches", "zoll", '"', "″", "''", "”"].includes(t)) return "in"
  return null
}

/** Parses "220", "2,2", "1.5", "1,200" (thousands) and "35 1/2" into a number. */
export function parseNumber(raw) {
  let s = String(raw).trim().replace(/\s+/g, " ")
  const frac = s.match(/^(\d+) (\d+)\/(\d+)$/)
  if (frac) return Number(frac[1]) + Number(frac[2]) / Number(frac[3])
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "") // 1,200 / 1,200.5
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".") // 1.200,5
  else s = s.replace(",", ".") // German decimal comma
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

export function toCm(value, unit) {
  const u = normalizeUnit(unit)
  if (!u || !Number.isFinite(value)) return null
  return Math.round(value * UNIT_TO_CM[u] * 10) / 10
}

/** Parses "80 cm", "800mm", "31.5\"" etc. Returns cm or null. */
export function parseValueWithUnit(raw, fallbackUnit = null) {
  if (typeof raw === "number") return fallbackUnit ? toCm(raw, fallbackUnit) : null
  const m = String(raw).trim().match(new RegExp(`^(${NUM})\\s*(${UNIT})?$`, "i"))
  if (!m) return null
  return toCm(parseNumber(m[1]), m[2] || fallbackUnit)
}

// --- text patterns -------------------------------------------------------------

const NUM = String.raw`\d+(?:[.,]\d+)*(?: \d+\/\d+)?`
const UNIT = String.raw`mm|cm|m(?![a-zäöü])|inches|inch|in(?![a-zäöü])|zoll|"|″|”|''`
const SEP = String.raw`\s*[x×*]\s*`
// axis letters: English W/D/H (L = width, as in "L x D x H"), German B/T/H
const AXIS_LETTER = { w: "width", l: "width", b: "width", d: "depth", t: "depth", h: "height" }
const AXIS_WORD = [
  [/^(width|wide|breite|br\.?)$/i, "width"],
  [/^(depth|deep|tiefe|length|länge|laenge)$/i, "depth"],
  [/^(height|high|tall|höhe|hoehe)$/i, "height"],
]

function axisFromWord(word) {
  const w = word.toLowerCase().replace(/[.:]/g, "")
  if (w.length === 1) return AXIS_LETTER[w] || null
  for (const [re, axis] of AXIS_WORD) if (re.test(w)) return axis
  return null
}

function complete(d) {
  return d && AXES.every((a) => typeof d[a] === "number" && d[a] > 0)
}

/** Finds "W x D x H" style triples with optional per-value units and axis letters. */
function findTriples(text) {
  const L = String.raw`(?:\(?\s*([WLBDTH])\s*\)?\s*[:.]?\s*)?` // optional leading axis letter
  const R = String.raw`(?:\s*\(?\s*([WLBDTH])\b\s*\)?)?` // optional trailing axis letter
  const V = String.raw`${L}(${NUM})\s*(${UNIT})?${R}`
  // the first value may not take a letter that ends a header such as "(H x B x T): 85 x ..."
  const V1 = String.raw`(?<![x×*\/]\s*)${V}`
  const re = new RegExp(`${V1}${SEP}${V}${SEP}${V}`, "gi")
  const out = []
  for (const m of text.matchAll(re)) {
    // groups per value: lead, num, unit, trail
    const vals = [0, 1, 2].map((i) => ({lead: m[1 + i * 4], num: m[2 + i * 4], unit: m[3 + i * 4], trail: m[4 + i * 4]}))
    const lastUnit = vals[2].unit || vals.find((v) => v.unit)?.unit
    if (!lastUnit) continue // bare "3 x 4 x 5" without any unit is too ambiguous
    // Axis order: explicit letters on the values, else a header like "(B x T x H)" just before, else W x D x H.
    let order = vals.map((v) => (v.lead || v.trail ? AXIS_LETTER[(v.lead || v.trail).toLowerCase()] : null))
    if (order.some((a) => !a)) {
      const before = text.slice(Math.max(0, m.index - 60), m.index)
      const header = before.match(/([WLBDTH])\s*[x×*\/]\s*([WLBDTH])\s*[x×*\/]\s*([WLBDTH])[^0-9]*$/i)
      order = header ? header.slice(1, 4).map((c) => AXIS_LETTER[c.toLowerCase()]) : ["width", "depth", "height"]
    }
    if (new Set(order).size !== 3) continue
    const d = {}
    vals.forEach((v, i) => (d[order[i]] = toCm(parseNumber(v.num), v.unit || lastUnit)))
    if (complete(d)) out.push({...d, index: m.index, raw: m[0].trim()})
  }
  return out
}

/** Finds individually labelled values: "Breite: 220 cm", "Height 85cm", "H: 33.5\"". */
function findLabelled(text) {
  const re = new RegExp(
    String.raw`\b(width|wide|breite|depth|deep|tiefe|height|high|tall|höhe|hoehe|[WBTDH])\b\.?\s*(?:\((?:cm|mm|m|in|inches)\))?\s*[:=]?\s*(?:ca\.?|approx\.?|circa)?\s*(${NUM})\s*(${UNIT})`,
    "gi"
  )
  const d = {}
  for (const m of text.matchAll(re)) {
    const axis = axisFromWord(m[1])
    if (!axis || d[axis] != null) continue
    // single letters only count when followed by a separator, to avoid matching stray "H 2 m" in prose
    if (m[1].length === 1 && !/^[A-Za-z]\s*[:=]?\s*\d/.test(m[0])) continue
    d[axis] = toCm(parseNumber(m[2]), m[3])
  }
  return d
}

const DIM_KEYWORDS = /(dimensions?|measurements?|size|maße|masse|abmessungen|abmessung|produktmaße|gesamtmaße)/i

/**
 * Extracts {width, depth, height} in cm from free text (English or German).
 * Prefers triples near a "Dimensions"/"Maße"/"Abmessungen" keyword, then labelled values.
 */
export function parseDimensionsText(text) {
  if (!text) return null
  const t = String(text).replace(/ /g, " ").replace(/[ \t]+/g, " ")
  const triples = findTriples(t)
  if (triples.length) {
    const near = triples.find((tr) => DIM_KEYWORDS.test(t.slice(Math.max(0, tr.index - 80), tr.index + tr.raw.length)))
    const best = near || triples[0]
    return {width: best.width, depth: best.depth, height: best.height, source: "text", raw: best.raw}
  }
  const lab = findLabelled(t)
  if (complete(lab)) return {...lab, source: "text"}
  return Object.keys(lab).length ? {...lab, source: "text", partial: true} : null
}

// --- JSON-LD -------------------------------------------------------------------

function* walkJson(node) {
  if (Array.isArray(node)) for (const n of node) yield* walkJson(n)
  else if (node && typeof node === "object") {
    yield node
    for (const v of Object.values(node)) if (v && typeof v === "object") yield* walkJson(v)
  }
}

function isProduct(obj) {
  const t = obj["@type"]
  const types = Array.isArray(t) ? t : [t]
  return types.some((x) => typeof x === "string" && /(^|[/#:])(Product|ProductModel|IndividualProduct)$/.test(x))
}

/** Converts a schema.org dimension value (QuantitativeValue, string or number) to cm. */
export function quantitativeToCm(v) {
  if (v == null) return null
  if (Array.isArray(v)) return quantitativeToCm(v[0])
  if (typeof v === "string") return parseValueWithUnit(v)
  if (typeof v === "number") return null // unitless numbers are ambiguous
  const value = typeof v.value === "string" ? parseNumber(v.value) : v.value
  const unit = normalizeUnit(v.unitCode) || normalizeUnit(v.unitText)
  if (unit) return toCm(value, unit)
  if (typeof v.value === "string") return parseValueWithUnit(v.value)
  return null
}

export function dimsFromJsonLd(html) {
  const $ = cheerio.load(html)
  const products = []
  $('script[type="application/ld+json"]').each((_, el) => {
    let data
    try {
      data = JSON.parse($(el).contents().text())
    } catch {
      return
    }
    for (const obj of walkJson(data)) if (isProduct(obj)) products.push(obj)
  })
  let partial = null
  for (const p of products) {
    const d = {width: quantitativeToCm(p.width), depth: quantitativeToCm(p.depth ?? p.length), height: quantitativeToCm(p.height)}
    if (complete(d)) return {...d, source: "json-ld"}
    // some shops put dimensions in additionalProperty / description text
    const fromDesc = p.description ? parseDimensionsText(p.description) : null
    if (fromDesc && !fromDesc.partial) return {...fromDesc, source: "json-ld"}
    if (!partial && AXES.some((a) => d[a] != null)) partial = {...d, source: "json-ld", partial: true}
  }
  return partial
}

// --- microdata -----------------------------------------------------------------

export function dimsFromMicrodata(html) {
  const $ = cheerio.load(html)
  const d = {}
  for (const axis of AXES) {
    const el = $(`[itemprop="${axis}"]${axis === "depth" ? ', [itemprop="length"]' : ""}`).first()
    if (!el.length) continue
    if (el.is("[itemscope]")) {
      const valEl = el.find('[itemprop="value"]').first()
      const raw = valEl.attr("content") ?? valEl.text()
      const unitEl = el.find('[itemprop="unitCode"], [itemprop="unitText"]').first()
      const unit = unitEl.attr("content") ?? unitEl.text()
      d[axis] = toCm(parseNumber(raw), unit) ?? parseValueWithUnit(raw)
    } else {
      d[axis] = parseValueWithUnit(el.attr("content") ?? el.text())
    }
  }
  if (complete(d)) return {...d, source: "microdata"}
  return Object.values(d).some((v) => v != null) ? {...d, source: "microdata", partial: true} : null
}

// --- page text ------------------------------------------------------------------

export function pageText(html) {
  const $ = cheerio.load(html)
  $("script, style, noscript, svg, template").remove()
  $("br, p, div, li, tr, td, th, dt, dd, h1, h2, h3, h4, h5, h6, section, table").each((_, el) => {
    $(el).append("\n")
  })
  return $("body").text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n")
}

/** Full cascade. Returns {width, depth, height, source} in cm, or null when not all three were found. */
export function extractDimensions(html) {
  const sources = [dimsFromJsonLd(html), dimsFromMicrodata(html), parseDimensionsText(pageText(html))]
  const full = sources.find((s) => s && !s.partial)
  if (full) return full
  // merge partial results in priority order
  const merged = {}
  const used = []
  for (const s of sources) {
    if (!s) continue
    for (const a of AXES) if (merged[a] == null && s[a] != null) (merged[a] = s[a]), used.includes(s.source) || used.push(s.source)
  }
  return complete(merged) ? {...merged, source: used.join("+")} : null
}

/** Parses the --dims flag: "220x90x85" (cm), or with a unit, e.g. "2200x900x850mm", "86x35x33in". */
export function parseDimsFlag(s) {
  const m = String(s).trim().match(new RegExp(`^(${NUM})${SEP}(${NUM})${SEP}(${NUM})\\s*(${UNIT})?$`, "i"))
  if (!m) return null
  const unit = m[4] || "cm"
  const [width, depth, height] = [m[1], m[2], m[3]].map((n) => toCm(parseNumber(n), unit))
  return complete({width, depth, height}) ? {width, depth, height, source: "--dims"} : null
}
