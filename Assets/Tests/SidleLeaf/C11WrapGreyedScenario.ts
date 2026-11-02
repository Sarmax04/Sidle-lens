/**
 * Update 2 wrap-around and greyed-out rules, with real button pinches:
 * - Next wraps from the last available type to the first.
 * - Compare wraps from the last variant of a type to its first.
 * - Compare is greyed out (and a pinch does nothing) exactly when the current
 *   type has one variant.
 * - An unknown catalog category becomes its own type after bed.
 * Expected types/variants are derived from the bundled catalog, with
 * placeholders on and off. The bundled catalog may have no one-variant type,
 * so the greyed-out rule is also run on a reduced catalog (the first piece of
 * each category), where it is sure to apply.
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

    const oneVariant = (o: ExpectedType[]) => o.filter((t) => t.variants.length === 1).map((t) => t.type)

    // Bundled catalog, placeholders on.
    const on = expectedOffer(cat, true)
    log(`on: types ${on.map((t) => `${t.type}(${t.variants.length})`).join(" ")}, one-variant [${oneVariant(on).join(",")}]`)
    await checkRules(it, c, on, "on")

    // Bundled catalog, placeholders off.
    c.setShowPlaceholderPieces(false)
    await sleep(150)
    const off = expectedOffer(cat, false)
    log(`off: types ${off.map((t) => `${t.type}(${t.variants.length})`).join(" ")}, one-variant [${oneVariant(off).join(",")}]`)
    await checkRules(it, c, off, "off")

    // Reduced catalog (first piece of each category): every type has one variant
    // with placeholders off; with them on, the types without a built-in do.
    const firsts: any[] = []
    for (const e of cat) {
      const t = String(e.category).trim().toLowerCase()
      if (!firsts.some((f) => String(f.category).trim().toLowerCase() === t)) firsts.push(e)
    }
    c.loadCatalogText(JSON.stringify(firsts))
    await sleep(150)
    const firstsOff = expectedOffer(firsts, false)
    expect(oneVariant(firstsOff).length, "reduced, off: every type has one variant").toBe(firstsOff.length)
    await checkRules(it, c, firstsOff, "reduced off")
    c.setShowPlaceholderPieces(true)
    await sleep(150)
    const firstsOn = expectedOffer(firsts, true)
    log(`reduced on: one-variant [${oneVariant(firstsOn).join(",")}]`)
    expect(oneVariant(firstsOn).length > 0, "reduced, on: at least one one-variant type to grey out").toBe(true)
    await checkRules(it, c, firstsOn, "reduced on")

    // Unknown category -> its own type after bed (placeholders on).
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
