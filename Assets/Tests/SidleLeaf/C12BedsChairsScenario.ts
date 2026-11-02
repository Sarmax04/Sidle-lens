/**
 * Beds and chairs (Update 2 types and variants, with the imported models wired):
 * - Type sequence: Next from the start reaches chair right after sofa and bed
 *   right after table (TYPE_ORDER sofa, chair, table, bed), each on its first variant.
 * - Chair variants: imported chairs only (there is no built-in chair), in catalog order.
 * - Bed variants: the built-in Bed first (placeholders on), then imported beds in
 *   catalog order; imported beds only with placeholders off.
 * - Every chair and bed variant, reached with real Compare pinches, shows its real
 *   model (not the fallback box), fits the catalog W × D × H within 1 cm, stands on
 *   the floor, and the panel name and dims match. single_bed (yawDeg 90) is
 *   checked like the rest, so a wrong yaw shows up as swapped width/depth.
 * - Compare wraps within chair and bed; Next from bed goes to the type after it.
 * Expected values come from the bundled catalog, not hardcoded piece names.
 * Run with placeholders on, then off; switched back on at the end.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {SidleController} from "../../Scripts/SidleController"
import {
  bundledCatalog,
  expectedOffer,
  ExpectedType,
  ExpectedVariant,
  expectGreyedCompare,
  log,
  meshBounds,
  obj,
  offeredKeys,
  panelText,
  placementValid,
  resetState,
  tap,
} from "./SidleTestHelpers"

const TYPES = ["chair", "bed"]

function checkVariant(c: SidleController, v: ExpectedVariant, type: string, allKeys: string[]): void {
  const key = v.key
  expect(c.currentPieceKey, `${type}: piece`).toBe(key)
  expect(c.currentPieceType, `${key} type`).toBe(type)
  expect(c.currentPieceIsImported, `${key} imported?`).toBe(v.imported)
  for (const k of allKeys) expect(obj(`Piece_${k}`).enabled, `Piece_${k} visible?`).toBe(k === key)
  expect(JSON.stringify(c.currentDims), `${key} dims`).toBe(JSON.stringify({w: v.w, d: v.d, h: v.h}))
  expect(panelText("PieceNameLabel"), `${key} panel name`).toBe(v.name)
  const p = c.piecePosition
  expect(placementValid(p.x, p.z, v.w, v.d, c.rotationDeg), `${key} placement valid`).toBe(true)
  if (!v.imported) return
  expect(c.modelLoadedFor(key), `${key} shows its model (not the fallback box)`).toBe(true)
  const b = meshBounds(obj(`Piece_${key}`), obj("Piece"))
  expect(b !== null, `${key} has mesh geometry`).toBe(true)
  const size = b!.max.sub(b!.min)
  log(`${key}: model ${size.x.toFixed(1)} x ${size.z.toFixed(1)} x ${size.y.toFixed(1)} vs catalog ${v.w} x ${v.d} x ${v.h}`)
  expect(Math.abs(size.x - v.w) <= 1, `${key} model width ${size.x} vs ${v.w}`).toBe(true)
  expect(Math.abs(size.z - v.d) <= 1, `${key} model depth ${size.z} vs ${v.d}`).toBe(true)
  expect(Math.abs(size.y - v.h) <= 1, `${key} model height ${size.y} vs ${v.h}`).toBe(true)
  expect(Math.abs(b!.min.y) <= 0.5, `${key} stands on the floor (min y ${b!.min.y})`).toBe(true)
}

async function checkTypes(it: DefaultLeafInteractor, c: SidleController, cat: any[], offer: ExpectedType[], placeholders: boolean, ctx: string): Promise<void> {
  const cmpBtn = obj("CompareButton").getComponent(Button.getTypeName()) as Button
  const allKeys = offeredKeys(offer)
  const types = offer.map((t) => t.type)
  expect(c.availableTypes.join(","), `${ctx}: types`).toBe(types.join(","))
  expect(c.currentPieceKey, `${ctx}: starts on the first variant of the first type`).toBe(offer[0].variants[0].key)

  // Independent expectations for the variant lists, straight from the catalog.
  const imported = (type: string) => cat.filter((e) => String(e.category).trim().toLowerCase() === type).map((e) => `Imported_${e.id}`)
  for (const type of TYPES) {
    const builtIn = placeholders && type === "bed" ? ["Bed"] : []
    const want = builtIn.concat(imported(type))
    expect(c.variantKeys(type).join(","), `${ctx}: ${type} variants`).toBe(want.join(","))
    if (want.length) expect(types.indexOf(type) >= 0, `${ctx}: ${type} offered`).toBe(true)
  }
  if (types.indexOf("chair") >= 0 && types.indexOf("sofa") >= 0) expect(types.indexOf("chair"), `${ctx}: chair right after sofa`).toBe(types.indexOf("sofa") + 1)
  if (types.indexOf("bed") >= 0 && types.indexOf("table") >= 0) expect(types.indexOf("bed"), `${ctx}: bed right after table`).toBe(types.indexOf("table") + 1)

  for (let ti = 0; ti < offer.length; ti++) {
    const t = offer[ti]
    if (ti > 0) await tap(it, "NextButton")
    expect(c.currentPieceKey, `${ctx}: Next -> ${t.type} first variant`).toBe(t.variants[0].key)
    if (TYPES.indexOf(t.type) < 0) continue
    if (t.variants.length === 1) {
      checkVariant(c, t.variants[0], t.type, allKeys)
      await expectGreyedCompare(c, `${ctx} ${t.type}`)
    } else {
      expect(c.compareEnabled, `${ctx} ${t.type}: compare enabled`).toBe(true)
      expect(cmpBtn.inactive, `${ctx} ${t.type}: CompareButton active`).toBe(false)
      for (let vi = 0; vi <= t.variants.length; vi++) {
        if (vi > 0) await tap(it, "CompareButton")
        checkVariant(c, t.variants[vi % t.variants.length], t.type, allKeys)
      }
      expect(c.currentPieceKey, `${ctx} ${t.type}: Compare wraps to the first variant`).toBe(t.variants[0].key)
    }
    // Next from this type lands on the next type's first variant (wrapping), even after Compare.
    const next = offer[(ti + 1) % offer.length]
    if (t.variants.length > 1) {
      await tap(it, "CompareButton") // from a later variant
      await tap(it, "NextButton")
      expect(c.currentPieceKey, `${ctx}: Next from ${t.type} (2nd variant) -> ${next.type} first variant`).toBe(next.variants[0].key)
      // step back round to this type for the loop to continue
      for (let k = 1; k < offer.length; k++) await tap(it, "NextButton")
      expect(c.currentPieceKey, `${ctx}: back on ${t.type}`).toBe(t.variants[0].key)
    }
  }
  await tap(it, "NextButton")
  expect(c.currentPieceKey, `${ctx}: Next wraps to the first type`).toBe(offer[0].variants[0].key)
}

@component
export class C12BedsChairsScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C12Interactor")
    const cat = bundledCatalog()
    for (const type of TYPES) {
      const n = cat.filter((e) => String(e.category).trim().toLowerCase() === type).length
      log(`bundled catalog: ${n} imported ${type}(s)`)
      expect(n > 0, `bundled catalog has an imported ${type}`).toBe(true)
    }

    await checkTypes(it, c, cat, expectedOffer(cat, true), true, "on")

    c.setShowPlaceholderPieces(false)
    await sleep(150)
    await checkTypes(it, c, cat, expectedOffer(cat, false), false, "off")

    c.setShowPlaceholderPieces(true)
    await sleep(150)
    await resetState()
    log("C12 done")
  }
}
