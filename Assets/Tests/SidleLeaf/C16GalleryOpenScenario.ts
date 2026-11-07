/**
 * Done criterion 13 (Update 4) — pinching the Gallery button opens the gallery
 * on the current piece's type and on the page that holds it (checked for the
 * first and last variant of every type, so later pages are covered); the
 * control panel is hidden meanwhile and comes back on Close. The gallery shows
 * at the panel's offset (also after the panel was dragged) and follows the head.
 * Opening, closing and paging never move the piece or change Measure. After the
 * panel was hidden and shown again, a greyed-out Compare is still greyed out.
 * Expected types, variants and pages come from the bundled catalog.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {nextFrame, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {
  bundledCatalog,
  expectedOffer,
  expectGreyedCompare,
  fmtOffset,
  galleryObj,
  galleryShown,
  goTo,
  headDir,
  HeadHold,
  headOffsetOf,
  interactable,
  log,
  resetState,
  START_HEAD,
  tabViews,
  tap,
  tileView,
  TILES_PER_PAGE,
  typeLabel,
} from "./SidleTestHelpers"

function expectGalleryAt(c: SidleController, ctx: string): void {
  const m = headOffsetOf(galleryObj(c).getTransform().getWorldPosition())
  const o = c.panelOffset
  log(`${ctx}: gallery ${fmtOffset(m)} | panel offset ${fmtOffset(o)}`)
  expect(Math.abs(m.distanceCm - o.distanceCm) <= 1.5, `${ctx}: gallery distance`).toBe(true)
  expect(Math.abs(m.horizontalDeg - o.horizontalDeg) <= 1.5, `${ctx}: gallery horizontal angle`).toBe(true)
  expect(Math.abs(m.verticalDeg - o.verticalDeg) <= 1.5, `${ctx}: gallery vertical angle`).toBe(true)
}

@component
export class C16GalleryOpenScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const hold = new HeadHold(START_HEAD.pos, START_HEAD.yawDeg)
    try {
      const c = await resetState()
      const it = new DefaultLeafInteractor("C16Interactor")
      const offer = expectedOffer(bundledCatalog(), true)
      expect(c.galleryOpen, "gallery closed at the start").toBe(false)
      expect(galleryShown(c), "gallery hidden at the start").toBe(false)

      for (const t of offer) {
        const picks = [0, t.variants.length - 1].filter((v, i, a) => a.indexOf(v) === i)
        for (const vi of picks) {
          const v = t.variants[vi]
          await goTo(it, c, offer, v.key)
          const before = JSON.stringify({k: c.currentPieceKey, p: c.piecePosition, r: c.rotationDeg, m: c.measureOn})
          await tap(it, "GalleryButton")
          const page = Math.floor(vi / TILES_PER_PAGE)
          const ctx = `${v.key} (${t.type} #${vi + 1})`
          expect(c.galleryOpen, `${ctx}: open`).toBe(true)
          expect(galleryShown(c), `${ctx}: gallery shown, panel hidden`).toBe(true)
          expect(c.galleryType, `${ctx}: starts on its type`).toBe(t.type)
          expect(c.galleryPage, `${ctx}: starts on its page`).toBe(page)
          const want = t.variants.slice(page * TILES_PER_PAGE, (page + 1) * TILES_PER_PAGE)
          expect(c.galleryPageKeys.join(","), `${ctx}: page keys`).toBe(want.map((w) => w.key).join(","))
          for (let s = 0; s < TILES_PER_PAGE; s++) {
            const tv = tileView(s)
            expect(tv.visible, `${ctx}: tile ${s + 1} visible`).toBe(s < want.length)
            if (s < want.length) expect(tv.name, `${ctx}: tile ${s + 1} name`).toBe(want[s].name)
          }
          const tabs = tabViews()
          expect(tabs.map((x) => x.label).join(","), `${ctx}: tabs`).toBe(offer.map((o) => typeLabel(o.type)).join(","))
          expect(tabs.filter((x) => x.active).map((x) => x.label).join(","), `${ctx}: active tab`).toBe(typeLabel(t.type))
          await tap(it, "GalleryCloseButton")
          expect(c.galleryOpen, `${ctx}: closed`).toBe(false)
          expect(galleryShown(c), `${ctx}: panel back`).toBe(false)
          expect(JSON.stringify({k: c.currentPieceKey, p: c.piecePosition, r: c.rotationDeg, m: c.measureOn}), `${ctx}: piece, facing and Measure unchanged`).toBe(before)
          log(`${ctx}: opened on ${c.galleryType} page ${page + 1}`)
        }
      }

      // Measure on, then open/close: Measure stays on.
      await resetState()
      await tap(it, "MeasureButton")
      await tap(it, "GalleryButton")
      expect(c.measureOn, "Measure still on with the gallery open").toBe(true)
      await tap(it, "GalleryCloseButton")
      expect(c.measureOn, "Measure still on after closing").toBe(true)
      await tap(it, "MeasureButton")

      // The gallery shows at the panel's offset, also after the panel was dragged, and follows the head.
      await tap(it, "GalleryButton")
      await sleep(300)
      expectGalleryAt(c, "default offset")
      await tap(it, "GalleryCloseButton")
      await it.drag(interactable("PanelGrabBar"), headDir(new vec3(0.8, 0.3, 0)), 600)
      await nextFrame()
      log(`panel dragged to ${fmtOffset(c.panelOffset)}`)
      expect(Math.abs(c.panelOffset.horizontalDeg) > 3, "panel moved off its default").toBe(true)
      await sleep(1200)
      await tap(it, "GalleryButton")
      await sleep(300)
      expectGalleryAt(c, "moved offset")
      hold.set(new vec3(30, 0, -50), 30)
      await sleep(3000)
      expectGalleryAt(c, "head moved and turned")
      hold.set(START_HEAD.pos, START_HEAD.yawDeg)
      await sleep(3000)
      await tap(it, "GalleryCloseButton")
      expect(c.galleryOpen, "closed").toBe(false)

      // One-variant type (first piece of each category, placeholders off): Compare greyed,
      // and still greyed after the panel was hidden by the gallery and shown again.
      await resetState()
      const cat = bundledCatalog()
      const firsts: any[] = []
      for (const e of cat) if (!firsts.some((f) => String(f.category).toLowerCase() === String(e.category).toLowerCase())) firsts.push(e)
      c.loadCatalogText(JSON.stringify(firsts))
      c.setShowPlaceholderPieces(false)
      await sleep(300)
      await expectGreyedCompare(c, "one variant, before the gallery")
      await tap(it, "GalleryButton")
      await tap(it, "GalleryCloseButton")
      await sleep(300)
      await expectGreyedCompare(c, "one variant, after the gallery")
      c.setShowPlaceholderPieces(true)
      c.loadCatalogText(null)
    } finally {
      await hold.stop()
    }
    await resetState()
    log("C16 done")
  }
}
