import {test} from "node:test"
import assert from "node:assert/strict"

import {
  parseNumber,
  normalizeUnit,
  toCm,
  quantitativeToCm,
  parseDimensionsText,
  dimsFromJsonLd,
  dimsFromMicrodata,
  extractDimensions,
  parseDimsFlag,
} from "../lib/dims.mjs"

const dims = (d) => d && {width: d.width, depth: d.depth, height: d.height}

test("unit conversion: mm, m, inches to cm", () => {
  assert.equal(toCm(2200, "mm"), 220)
  assert.equal(toCm(855, "mm"), 85.5)
  assert.equal(toCm(1.6, "m"), 160)
  assert.equal(toCm(36, "in"), 91.4)
  assert.equal(toCm(10, '"'), 25.4)
})

test("unit codes and words", () => {
  assert.equal(normalizeUnit("CMT"), "cm")
  assert.equal(normalizeUnit("MMT"), "mm")
  assert.equal(normalizeUnit("MTR"), "m")
  assert.equal(normalizeUnit("INH"), "in")
  assert.equal(normalizeUnit("Zentimeter"), "cm")
  assert.equal(normalizeUnit("inches"), "in")
  assert.equal(normalizeUnit("Zoll"), "in")
  assert.equal(normalizeUnit("kg"), null)
})

test("numbers: German decimal comma, thousands separators, fractions", () => {
  assert.equal(parseNumber("2,2"), 2.2)
  assert.equal(parseNumber("85.5"), 85.5)
  assert.equal(parseNumber("1,200"), 1200)
  assert.equal(parseNumber("1.200,5"), 1200.5)
  assert.equal(parseNumber("35 1/2"), 35.5)
})

test("text: English W x D x H in cm", () => {
  assert.deepEqual(dims(parseDimensionsText("Dimensions: 220 x 90 x 85 cm (W x D x H)")), {width: 220, depth: 90, height: 85})
})

test("text: mm to cm", () => {
  assert.deepEqual(dims(parseDimensionsText("Overall size W 2200 x D 900 x H 850 mm")), {width: 220, depth: 90, height: 85})
  assert.deepEqual(dims(parseDimensionsText("Dimensions (WxDxH): 1805x815x710mm")), {width: 180.5, depth: 81.5, height: 71})
})

test("text: German Maße B x T x H", () => {
  assert.deepEqual(dims(parseDimensionsText("Maße (B x T x H): 220 x 90 x 85 cm")), {width: 220, depth: 90, height: 85})
})

test("text: German Abmessungen with header order H x B x T", () => {
  assert.deepEqual(dims(parseDimensionsText("Abmessungen (H x B x T): 85 x 220 x 90 cm")), {width: 220, depth: 90, height: 85})
})

test("text: German labelled Breite/Tiefe/Höhe with decimal comma and metres", () => {
  const text = "Produktdetails\nBreite: 2,2 m\nTiefe: 90 cm\nHöhe: 85,5 cm\nGewicht: 40 kg"
  assert.deepEqual(dims(parseDimensionsText(text)), {width: 220, depth: 90, height: 85.5})
})

test("text: German per-value letters B/T/H", () => {
  assert.deepEqual(dims(parseDimensionsText("Sofa, B 220 cm x T 90 cm x H 85 cm, Stoff grau")), {width: 220, depth: 90, height: 85})
})

test("text: inches with quote marks and trailing axis letters", () => {
  assert.deepEqual(dims(parseDimensionsText('Overall: 86.6" W x 35.4" D x 33.5" H')), {width: 220, depth: 89.9, height: 85.1})
})

test("text: inches spelled out", () => {
  assert.deepEqual(dims(parseDimensionsText("Width 84 inches, Depth 36 inches, Height 34 inches")), {width: 213.4, depth: 91.4, height: 86.4})
})

test("text: unitless triples are rejected", () => {
  assert.equal(parseDimensionsText("Pack of 3 x 4 x 5"), null)
})

test("text: prefers the triple next to a dimensions keyword", () => {
  const text = "Box 40 x 30 x 20 cm shipping carton. Product dimensions: 200 x 95 x 80 cm"
  assert.deepEqual(dims(parseDimensionsText(text)), {width: 200, depth: 95, height: 80})
})

test("JSON-LD QuantitativeValue with unit codes (MMT → cm)", () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Test Sofa",
    width: {"@type": "QuantitativeValue", value: 2200, unitCode: "MMT"},
    depth: {"@type": "QuantitativeValue", value: 0.9, unitCode: "MTR"},
    height: {"@type": "QuantitativeValue", value: "85", unitText: "cm"},
  })}</script></head><body></body></html>`
  assert.deepEqual(dims(dimsFromJsonLd(html)), {width: 220, depth: 90, height: 85})
  assert.equal(extractDimensions(html).source, "json-ld")
})

test("JSON-LD in @graph with inches (INH)", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@graph": [
      {"@type": "WebPage"},
      {
        "@type": ["Product"],
        width: {value: 36, unitCode: "INH"},
        depth: {value: 30, unitCode: "INH"},
        height: {value: 40, unitCode: "INH"},
      },
    ],
  })}</script>`
  assert.deepEqual(dims(dimsFromJsonLd(html)), {width: 91.4, depth: 76.2, height: 101.6})
})

test("QuantitativeValue edge cases", () => {
  assert.equal(quantitativeToCm("80 cm"), 80)
  assert.equal(quantitativeToCm(80), null) // no unit → ambiguous
  assert.equal(quantitativeToCm({value: "800", unitCode: "MMT"}), 80)
})

test("microdata QuantitativeValue and plain itemprops", () => {
  const html = `<div itemscope itemtype="https://schema.org/Product">
    <div itemprop="width" itemscope itemtype="https://schema.org/QuantitativeValue">
      <meta itemprop="value" content="1800"><meta itemprop="unitCode" content="MMT"></div>
    <span itemprop="depth">85 cm</span>
    <span itemprop="height" content="0.8 m">80 Zentimeter</span>
  </div>`
  assert.deepEqual(dims(dimsFromMicrodata(html)), {width: 180, depth: 85, height: 80})
})

test("cascade falls back to page text when there is no structured data", () => {
  const html = `<html><body><h1>Sessel</h1><table><tr><td>Abmessungen</td><td>B 80 x T 85 x H 95 cm</td></tr></table></body></html>`
  const d = extractDimensions(html)
  assert.deepEqual(dims(d), {width: 80, depth: 85, height: 95})
  assert.equal(d.source, "text")
})

test("cascade returns null when nothing is found", () => {
  assert.equal(extractDimensions("<html><body><p>Beautiful sofa, call us for details.</p></body></html>"), null)
})

test("--dims flag", () => {
  assert.deepEqual(dims(parseDimsFlag("220x90x85")), {width: 220, depth: 90, height: 85})
  assert.deepEqual(dims(parseDimsFlag("2200x900x850mm")), {width: 220, depth: 90, height: 85})
  assert.deepEqual(dims(parseDimsFlag("86x35x33in")), {width: 218.4, depth: 88.9, height: 83.8})
  assert.equal(parseDimsFlag("220x90"), null)
})
