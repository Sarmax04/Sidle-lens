/**
 * Done criterion 10 — with showPlaceholderPieces off, no built-in piece is
 * offered by Next piece or Compare, types with no variants are skipped and the
 * Lens starts on the first imported sofa. If that leaves nothing to show, it
 * falls back to the built-ins and logs a warning.
 * The Inspector checkbox is switched through the test hook
 * SidleController.setShowPlaceholderPieces (which re-applies the start rule)
 * and switched back on at the end. Expected types come from the bundled
 * catalog; since it may have every type, "skip an empty type" is also checked
 * with the bundled catalog minus its beds.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {
  BUILT_IN_KEYS,
  bundledCatalog,
  expectedOffer,
  ExpectedVariant,
  log,
  meshBounds,
  obj,
  offeredKeys,
  panelText,
  resetState,
  START,
  tap,
} from "./SidleTestHelpers"

function expectNoBuiltIn(c: SidleController, ctx: string): void {
  expect(BUILT_IN_KEYS.indexOf(c.currentPieceKey), `${ctx}: current piece ${c.currentPieceKey} is not built-in`).toBe(-1)
  for (const k of BUILT_IN_KEYS) expect(obj(`Piece_${k}`).enabled, `${ctx}: Piece_${k} hidden`).toBe(false)
  for (const t of c.availableTypes) {
    const keys = c.variantKeys(t)
    expect(keys.some((k) => BUILT_IN_KEYS.indexOf(k) >= 0), `${ctx}: ${t} offers no built-in (${keys.join(",")})`).toBe(false)
  }
}

function checkShown(c: SidleController, v: ExpectedVariant, domain: string): void {
  expect(c.currentPieceKey, "piece").toBe(v.key)
  expect(c.currentPieceIsImported, `${v.key} imported`).toBe(true)
  expect(obj(`Piece_${v.key}`).enabled, `${v.key} visible`).toBe(true)
  expect(c.modelLoadedFor(v.key), `${v.key} shows its model`).toBe(true)
  expect(JSON.stringify(c.currentDims), `${v.key} dims`).toBe(JSON.stringify({w: v.w, d: v.d, h: v.h}))
  expect(obj("Piece").getTransform().getLocalPosition().y, `${v.key} on floor`).toBeCloseTo(0, 2)
  const b = meshBounds(obj(`Piece_${v.key}`), obj("Piece"))
  expect(b !== null && Math.abs(b.min.y) <= 0.5, `${v.key} model stands on the floor`).toBe(true)
  expect(obj("Edge_Front").getTransform().getLocalScale().x, `${v.key} outline width`).toBeCloseTo(v.w + 4, 1)
  expect(obj("Edge_Right").getTransform().getLocalScale().z, `${v.key} outline depth`).toBeCloseTo(v.d + 4, 1)
  expect(panelText("PieceNameLabel"), `${v.key} panel name`).toBe(v.name)
  expect(panelText("PieceDetailLabel").includes(domain), `${v.key} panel domain`).toBe(true)
}

@component
export class C10NoPlaceholdersScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C10Interactor")
    const cat = bundledCatalog()
    const domainOf = (key: string) => cat.find((e) => `Imported_${e.id}` === key).domain

    expect(c.showPlaceholderPieces, "Inspector default: showPlaceholderPieces on").toBe(true)
    const firstSofa = cat.find((e) => String(e.category).toLowerCase() === "sofa")
    expect(!!firstSofa, "bundled catalog has an imported sofa").toBe(true)

    // Off: starts on the first imported sofa; types with no imported piece are skipped.
    c.setShowPlaceholderPieces(false)
    await sleep(150)
    const offer = expectedOffer(cat, false)
    log(`offer without placeholders ${offer.map((t) => `${t.type}[${t.variants.map((v) => v.key).join(",")}]`).join(" ")}`)
    expect(c.showPlaceholderPieces, "flag off").toBe(false)
    expect(c.placeholderFallbackActive, "no fallback needed").toBe(false)
    expect(c.currentPieceKey, "starts on the first imported sofa").toBe(`Imported_${firstSofa.id}`)
    expect(c.currentPieceType, "start type").toBe("sofa")
    expect(c.piecePosition.x, "start spot x").toBeCloseTo(START.x, 1)
    expect(c.piecePosition.z, "start spot z").toBeCloseTo(START.z, 1)
    expect(c.isClear, "start is clear").toBe(true)
    checkShown(c, offer[0].variants[0], domainOf(c.currentPieceKey))
    expect(c.availableTypes.join(","), "types with variants only").toBe(offer.map((t) => t.type).join(","))
    const builtInOnly = expectedOffer(cat, true).map((t) => t.type).filter((t) => !offer.some((o) => o.type === t))
    log(`types with built-ins only (skipped when off): [${builtInOnly.join(",")}]`)
    for (const t of builtInOnly) expect(c.availableTypes.indexOf(t), `${t} type skipped (no imported ${t})`).toBe(-1)
    for (const t of offer) expect(c.variantKeys(t.type).join(","), `${t.type} variants`).toBe(t.variants.map((v) => v.key).join(","))
    expectNoBuiltIn(c, "start")

    // Every Next / Compare pinch only ever shows imported pieces, and reaches all of them.
    const seen: {[k: string]: boolean} = {}
    for (let ti = 0; ti <= offer.length; ti++) {
      const t = offer[ti % offer.length]
      if (ti > 0) await tap(it, "NextButton")
      for (let vi = 0; vi < t.variants.length; vi++) {
        if (vi > 0) await tap(it, "CompareButton")
        checkShown(c, t.variants[vi], domainOf(t.variants[vi].key))
        expectNoBuiltIn(c, `${t.type} #${vi + 1}`)
        seen[c.currentPieceKey] = true
      }
      if (t.variants.length > 1) {
        await tap(it, "CompareButton") // wrap within the type
        expect(c.currentPieceKey, `${t.type}: Compare wraps`).toBe(t.variants[0].key)
      }
    }
    expect(Object.keys(seen).sort().join(","), "every imported piece reached").toBe(offeredKeys(offer).slice().sort().join(","))

    // A type with no imported piece is skipped: the bundled catalog without its beds.
    const noBeds = cat.filter((e) => String(e.category).trim().toLowerCase() !== "bed")
    c.loadCatalogText(JSON.stringify(noBeds))
    await sleep(150)
    const noBedOffer = expectedOffer(noBeds, false)
    expect(c.availableTypes.join(","), "no beds: types").toBe(noBedOffer.map((t) => t.type).join(","))
    expect(c.availableTypes.indexOf("bed"), "no beds: bed type skipped").toBe(-1)
    expect(c.placeholderFallbackActive, "no beds: no fallback").toBe(false)
    expectNoBuiltIn(c, "no beds")
    await tap(it, "NextButton")
    for (let i = 1; i < noBedOffer.length; i++) await tap(it, "NextButton")
    expect(c.currentPieceKey, "no beds: Next wraps past the empty bed type").toBe(noBedOffer[0].variants[0].key)

    // Nothing left to show -> falls back to the built-ins with a warning.
    c.loadCatalogText("[]")
    await sleep(150)
    log(`warnings: ${JSON.stringify(c.loadWarnings)}`)
    expect(c.placeholderFallbackActive, "fallback active").toBe(true)
    expect(c.loadWarnings.some((w) => w.indexOf("showPlaceholderPieces") >= 0), "fallback warning logged").toBe(true)
    expect(c.availableTypes.join(","), "built-in types offered").toBe("sofa,table,bed")
    expect(c.currentPieceKey, "fallback starts on Sofa A").toBe("SofaA")
    expect(obj("Piece_SofaA").enabled, "Sofa A visible").toBe(true)
    await tap(it, "NextButton")
    expect(c.currentPieceKey, "fallback Next works").toBe("DiningTable")

    // Bundled catalog back (flag still off): imported only again, first imported sofa.
    c.loadCatalogText(null)
    await sleep(150)
    expect(c.placeholderFallbackActive, "fallback off with imported pieces").toBe(false)
    expect(c.currentPieceKey, "first imported sofa again").toBe(`Imported_${firstSofa.id}`)
    expectNoBuiltIn(c, "catalog restored")

    // Back on: Sofa A first, built-ins offered again.
    c.setShowPlaceholderPieces(true)
    await sleep(150)
    expect(c.currentPieceKey, "on again: starts on Sofa A").toBe("SofaA")
    expect(c.variantKeys("sofa")[0], "built-ins first again").toBe("SofaA")
    expect(c.availableTypes.join(","), "all types back").toBe(expectedOffer(cat, true).map((t) => t.type).join(","))
    await resetState()
    log("C10 done")
  }
}
