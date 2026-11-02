/**
 * Done criterion 14 (Update 4) — the gallery has one tab per offered type in
 * Update 2 order; pinching a tab shows that type's pieces from page 1, at most
 * six per page in Compare order; Next/Previous page step through the pages
 * and do not wrap (greyed out at the ends, a pinch there does nothing).
 * Checked with placeholders on and off, and with an unknown catalog category
 * (its own tab after bed). Expectations come from the bundled catalog.
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
  expectGreyedButton,
  log,
  obj,
  resetState,
  tabViews,
  tap,
  tileView,
  TILES_PER_PAGE,
  typeLabel,
} from "./SidleTestHelpers"

function expectPage(c: SidleController, t: ExpectedType, page: number, ctx: string): void {
  const want = t.variants.slice(page * TILES_PER_PAGE, (page + 1) * TILES_PER_PAGE)
  expect(c.galleryType, `${ctx}: type`).toBe(t.type)
  expect(c.galleryPage, `${ctx}: page`).toBe(page)
  expect(c.galleryPageCount, `${ctx}: page count`).toBe(Math.ceil(t.variants.length / TILES_PER_PAGE))
  expect(c.galleryPageKeys.join(","), `${ctx}: keys`).toBe(want.map((w) => w.key).join(","))
  for (let s = 0; s < TILES_PER_PAGE; s++) {
    const tv = tileView(s)
    expect(tv.visible, `${ctx}: tile ${s + 1} visible`).toBe(s < want.length)
    if (s < want.length) expect(tv.name, `${ctx}: tile ${s + 1} name`).toBe(want[s].name)
  }
  const label = (obj("GalleryPageLabel").getComponent("Component.Text") as Text).text
  expect(label, `${ctx}: page label`).toBe(`${page + 1} / ${Math.ceil(t.variants.length / TILES_PER_PAGE)}`)
}

async function checkAllTabs(it: DefaultLeafInteractor, c: SidleController, offer: ExpectedType[], ctx: string): Promise<void> {
  await tap(it, "GalleryButton")
  expect(c.galleryOpen, `${ctx}: open`).toBe(true)
  expect(c.galleryTypes.join(","), `${ctx}: controller tabs`).toBe(offer.map((t) => t.type).join(","))
  expect(tabViews().map((x) => x.label).join(","), `${ctx}: tab labels`).toBe(offer.map((t) => typeLabel(t.type)).join(","))
  const prev = obj("GalleryPrevButton").getComponent(Button.getTypeName()) as Button
  const next = obj("GalleryNextButton").getComponent(Button.getTypeName()) as Button
  for (let ti = 0; ti < offer.length; ti++) {
    const t = offer[ti]
    await tap(it, `GalleryTab_${ti + 1}`)
    const pages = Math.ceil(t.variants.length / TILES_PER_PAGE)
    log(`${ctx}: ${t.type} ${t.variants.length} pieces, ${pages} page(s)`)
    expectPage(c, t, 0, `${ctx} ${t.type} p1`)
    expect(tabViews().filter((x) => x.active).map((x) => x.label).join(","), `${ctx} ${t.type}: active tab`).toBe(typeLabel(t.type))
    await expectGreyedButton("GalleryPrevButton", `${ctx} ${t.type} p1`)
    for (let p = 1; p < pages; p++) {
      expect(next.inactive, `${ctx} ${t.type} p${p}: Next page active`).toBe(false)
      await tap(it, "GalleryNextButton")
      expectPage(c, t, p, `${ctx} ${t.type} p${p + 1}`)
      expect(prev.inactive, `${ctx} ${t.type} p${p + 1}: Previous page active`).toBe(false)
    }
    // Last page: Next does not wrap
    await expectGreyedButton("GalleryNextButton", `${ctx} ${t.type} last page`)
    c.galleryNextPage() // API path is a no-op too
    expectPage(c, t, pages - 1, `${ctx} ${t.type} after Next on the last page`)
    // Back to the first page, then Previous does not wrap
    for (let p = pages - 1; p > 0; p--) await tap(it, "GalleryPrevButton")
    expectPage(c, t, 0, `${ctx} ${t.type} back on p1`)
    c.galleryPrevPage()
    expectPage(c, t, 0, `${ctx} ${t.type} after Previous on p1`)
  }
  await tap(it, "GalleryCloseButton")
}

@component
export class C17GalleryTabsScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C17Interactor")
    const cat = bundledCatalog()
    const before = JSON.stringify({k: c.currentPieceKey, p: c.piecePosition, r: c.rotationDeg, m: c.measureOn})
    const on = expectedOffer(cat, true)
    expect(on.some((t) => t.variants.length > TILES_PER_PAGE), "bundled offer has a type with more than one page").toBe(true)
    await checkAllTabs(it, c, on, "on")
    expect(JSON.stringify({k: c.currentPieceKey, p: c.piecePosition, r: c.rotationDeg, m: c.measureOn}), "tabs/paging leave the piece and Measure alone").toBe(before)

    c.setShowPlaceholderPieces(false)
    await sleep(150)
    await checkAllTabs(it, c, expectedOffer(cat, false), "off")

    c.setShowPlaceholderPieces(true)
    const lamp = {id: "test_lamp", name: "Test Lamp", category: "Lamp", sourceUrl: "https://example.org/a/lamp", domain: "example.org",
      widthCm: 40, depthCm: 40, heightCm: 150, glb: "Models/armchair_01.glb", yawDeg: 0, credit: "test"}
    const withLamp = cat.concat([lamp])
    c.loadCatalogText(JSON.stringify(withLamp))
    await sleep(150)
    const lampOffer = expectedOffer(withLamp, true)
    expect(lampOffer[lampOffer.length - 1].type, "unknown type is the last tab").toBe("lamp")
    await checkAllTabs(it, c, lampOffer, "lamp")
    c.loadCatalogText(null)
    await resetState()
    log("C17 done")
  }
}
