/**
 * Done criterion 9 — a catalog entry whose model is missing (not bundled) or not
 * a model shows a plain box of the catalog size, logs a warning and the Lens
 * keeps working (Next, rotate, drag clearance). An unreadable catalog leaves
 * only the built-in pieces. The catalog is swapped through the test hook
 * SidleController.loadCatalogText and restored at the end.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {bundledCatalog, expectedOffer, goTo, log, meshBounds, obj, panelText, resetState, tap} from "./SidleTestHelpers"

const BROKEN = [
  {id: "missing_box", name: "Missing Model", category: "sofa", sourceUrl: "https://example.org/a/missing", domain: "example.org",
    widthCm: 120, depthCm: 60, heightCm: 90, glb: "Models/not_bundled.glb", yawDeg: 0, credit: "test"},
  {id: "not_a_model", name: "Not A Model", category: "table", sourceUrl: "https://example.org/a/json", domain: "example.org",
    widthCm: 70.4, depthCm: 140.6, heightCm: 40.2, glb: "Models/catalog.json", yawDeg: 90, credit: "test"},
]

function checkBox(c: SidleController, e: any): void {
  const key = `Imported_${e.id}`
  expect(c.currentPieceKey, "piece").toBe(key)
  expect(c.modelLoadedFor(key), `${key} falls back to a box`).toBe(false)
  const root = obj(`Piece_${key}`)
  expect(root.enabled, `${key} visible`).toBe(true)
  const b = meshBounds(root, obj("Piece"))
  expect(b !== null, `${key} shows geometry`).toBe(true)
  const s = b!.max.sub(b!.min)
  log(`${key}: box ${s.x.toFixed(2)} x ${s.z.toFixed(2)} x ${s.y.toFixed(2)}, min y ${b!.min.y.toFixed(3)}`)
  expect(Math.abs(s.x - e.widthCm) <= 1 && Math.abs(s.z - e.depthCm) <= 1 && Math.abs(s.y - e.heightCm) <= 1, `${key} box is catalog size`).toBe(true)
  expect(Math.abs(b!.min.y) <= 0.5, `${key} box on floor`).toBe(true)
  expect(obj("Edge_Front").getTransform().getLocalScale().x, `${key} outline width`).toBeCloseTo(e.widthCm + 4, 1)
  expect(obj("Edge_Right").getTransform().getLocalScale().z, `${key} outline depth`).toBeCloseTo(e.depthCm + 4, 1)
  expect(panelText("PieceDetailLabel").includes(e.domain), `${key} panel domain`).toBe(true)
}

@component
export class C9MissingModelScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C9Interactor")
    const bundled = bundledCatalog().length

    // Missing / non-model files -> plain boxes + warnings
    c.loadCatalogText(JSON.stringify(BROKEN))
    await sleep(100)
    log(`warnings: ${JSON.stringify(c.loadWarnings)}`)
    expect(c.importedPieceKeys.join(","), "both entries still listed").toBe("Imported_missing_box,Imported_not_a_model")
    for (const e of BROKEN) {
      expect(c.loadWarnings.some((w) => w.includes(e.id)), `warning logged for ${e.id}`).toBe(true)
    }
    // Update 2: missing_box is a sofa variant, not_a_model a table variant
    const offer = expectedOffer(BROKEN, true)
    for (const e of BROKEN) {
      await goTo(it, c, offer, `Imported_${e.id}`)
      checkBox(c, e)
    }
    // Keeps working: rotate, move with clearance, then wrap to Sofa A
    await tap(it, "RotateLeftButton")
    expect(c.rotationDeg, "rotate still works").toBeCloseTo(15, 1)
    c.setPiecePosition(230, -220)
    await sleep(100)
    expect(c.isClear, "clearance still evaluated (too close to the right wall)").toBe(false)
    expect(c.nearestObstacle, "nearest obstacle").toBe("RightWall")
    await tap(it, "RotateRightButton")
    const ti = offer.findIndex((t) => t.type === c.currentPieceType)
    for (let i = ti; i < offer.length; i++) await tap(it, "NextButton") // remaining types, then wrap
    expect(c.currentPieceKey, "wraps back to Sofa A").toBe("SofaA")

    // Unreadable catalog -> only built-ins, no crash
    c.loadCatalogText("{ this is not json")
    await sleep(100)
    expect(c.importedPieceKeys.length, "no imported pieces from a broken catalog").toBe(0)
    expect(c.loadWarnings.length > 0, "warning logged for broken catalog").toBe(true)
    await tap(it, "NextButton")
    await tap(it, "NextButton")
    await tap(it, "NextButton")
    expect(c.currentPieceKey, "built-in cycle still works").toBe("SofaA")

    // Restore the bundled catalog
    c.loadCatalogText(null)
    await sleep(100)
    expect(c.importedPieceKeys.length, "bundled catalog restored").toBe(bundled)
    expect(c.importedPieceKeys.every((k) => c.modelLoadedFor(k)), "bundled models all load").toBe(true)
    await resetState()
    log("C9 done")
  }
}
