/**
 * Update 2 wrap-around and greyed-out rules, with real button pinches:
 * - Next wraps from the last available type to the first (bed -> sofa with
 *   placeholders on; table -> sofa with them off, skipping the empty bed type).
 * - Compare wraps from the last variant of a type to its first.
 * - Compare is greyed out (and a pinch does nothing) exactly when the current
 *   type has one variant: the table with placeholders off, the bed with them on.
 * - An unknown catalog category becomes its own type after bed.
 * showPlaceholderPieces is switched through SidleController.setShowPlaceholderPieces
 * and switched back on at the end.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {SidleController} from "../../Scripts/SidleController"
import {bundledCatalog, expectedOffer, ExpectedType, expectGreyedCompare, log, obj, resetState, tap} from "./SidleTestHelpers"

/** Pinch through every type and variant; check wraps and the greyed-out rule on the way. */
async function checkRules(it: DefaultLeafInteractor, c: SidleController, offer: ExpectedType[], ctx: string): Promise<void> {
  const cmpBtn = obj("CompareButton").getComponent(Button.getTypeName()) as Button
  const pos = c.piecePosition
  expect(c.availableTypes.join(","), `${ctx}: types`).toBe(offer.map((t) => t.type).join(","))
  expect(c.currentPieceKey, `${ctx}: starts on the first variant of the first type`).toBe(offer[0].variants[0].key)
  for (let ti = 0; ti < offer.length; ti++) {
    const t = offer[ti]
    if (ti > 0) await tap(it, "NextButton")
    expect(c.currentPieceKey, `${ctx}: Next -> ${t.type} first variant`).toBe(t.variants[0].key)
    if (t.variants.length === 1) {
      await expectGreyedCompare(c, `${ctx} ${t.type}`)
      continue
    }
    expect(c.compareEnabled, `${ctx} ${t.type}: compare enabled`).toBe(true)
    expect(cmpBtn.inactive, `${ctx} ${t.type}: CompareButton active`).toBe(false)
    for (let vi = 1; vi < t.variants.length; vi++) {
      await tap(it, "CompareButton")
      expect(c.currentPieceKey, `${ctx} ${t.type}: Compare #${vi}`).toBe(t.variants[vi].key)
    }
    await tap(it, "CompareButton")
    expect(c.currentPieceKey, `${ctx} ${t.type}: Compare wraps to the first variant`).toBe(t.variants[0].key)
    expect(c.piecePosition.x, `${ctx} ${t.type}: same spot x`).toBeCloseTo(pos.x, 1)
    expect(c.piecePosition.z, `${ctx} ${t.type}: same spot z`).toBeCloseTo(pos.z, 1)
  }
  await tap(it, "NextButton")
  expect(c.currentPieceKey, `${ctx}: Next wraps from ${offer[offer.length - 1].type} to ${offer[0].type}`).toBe(offer[0].variants[0].key)
}

@component
export class C11WrapGreyedScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C11Interactor")
    const cat = bundledCatalog()

    // Placeholders on: bed is the only one-variant type, Next wraps bed -> sofa.
    const on = expectedOffer(cat, true)
    expect(on.filter((t) => t.variants.length === 1).map((t) => t.type).join(","), "on: one-variant types").toBe("bed")
    await checkRules(it, c, on, "on")

    // Placeholders off: bed skipped, table has one variant, Next wraps table -> sofa.
    c.setShowPlaceholderPieces(false)
    await sleep(150)
    const off = expectedOffer(cat, false)
    expect(off.map((t) => t.type).join(","), "off: types").toBe("sofa,chair,table")
    expect(off.filter((t) => t.variants.length === 1).map((t) => t.type).join(","), "off: one-variant types").toBe("table")
    await checkRules(it, c, off, "off")

    // Unknown category -> its own type after bed (placeholders on again).
    c.setShowPlaceholderPieces(true)
    const lamp = {id: "test_lamp", name: "Test Lamp", category: "Lamp", sourceUrl: "https://example.org/a/lamp", domain: "example.org",
      widthCm: 40, depthCm: 40, heightCm: 150, glb: "Models/armchair_01.glb", yawDeg: 0, credit: "test"}
    const withLamp = cat.concat([lamp])
    c.loadCatalogText(JSON.stringify(withLamp))
    await sleep(150)
    const lampOffer = expectedOffer(withLamp, true)
    expect(lampOffer.map((t) => t.type).join(","), "unknown type listed after bed").toBe("sofa,chair,table,bed,lamp")
    await checkRules(it, c, lampOffer, "lamp")

    c.loadCatalogText(null)
    await sleep(100)
    expect(c.availableTypes.join(","), "bundled catalog restored").toBe(on.map((t) => t.type).join(","))
    await resetState()
    log("C11 done")
  }
}
