/**
 * Done criterion 17 (Update 5) — the "+" and "-" buttons on the grab bar row
 * step the panel through 75%, 100%, 125% and 150%; "-" is greyed out at 75% and
 * "+" at 150% (a real pinch on them does nothing); at every size the panel keeps
 * its offset from the head (measured, head held at the start pose), is scaled
 * as a whole around its centre, its main buttons are at least 4.5 cm wide, and
 * they still work (Next, Compare, Measure, Rotate, Gallery). Size presses never
 * press another button, move the piece or change Measure.
 * Expected pieces come from the bundled catalog.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {SidleController} from "../../Scripts/SidleController"
import {
  angularBox,
  bundledCatalog,
  expectedOffer,
  expectGreyedButton,
  fmtBox,
  fmtOffset,
  HeadHold,
  headOffsetOf,
  log,
  meshBounds,
  obj,
  panelObj,
  resetState,
  START_HEAD,
  tap,
  visualCorners,
} from "./SidleTestHelpers"

const SIZES = [0.75, 1.0, 1.25, 1.5]
// Update 6 adds Add and Remove to the main buttons; their width is checked like the others.
const MAIN = ["NextButton", "CompareButton", "MeasureButton", "RotateLeftButton", "RotateRightButton", "GalleryButton", "AddButton", "RemoveButton"]

/** World width (cm) of a button's own visual. */
function buttonWidthCm(name: string): number {
  const so = obj(name)
  const b = meshBounds(so, so)!
  return (b.max.x - b.min.x) * so.getTransform().getWorldScale().x
}

@component
export class C20PanelSizeScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const hold = new HeadHold(START_HEAD.pos, START_HEAD.yawDeg)
    const unsubs: (() => void)[] = []
    try {
      const c = await resetState()
      const it = new DefaultLeafInteractor("C20Interactor")
      const offer = expectedOffer(bundledCatalog(), true)
      const panel = panelObj(c)
      await sleep(1200)
      const o0 = c.panelOffset
      const centre0 = panel.getTransform().getWorldPosition()

      let otherEvents = 0
      const ui = c.panelUI
      for (const ev of [ui.onNext, ui.onCompare, ui.onMeasure, ui.onRotateLeft, ui.onRotateRight, ui.onGallery]) unsubs.push(ev.add(() => otherEvents++))

      const checkSize = async (want: number) => {
        const ctx = `${Math.round(want * 100)}%`
        expect(c.panelScale, `${ctx}: panelScale`).toBe(want)
        const ws = panel.getTransform().getWorldScale()
        expect(Math.abs(ws.x - want) < 1e-4 && Math.abs(ws.y - want) < 1e-4 && Math.abs(ws.z - want) < 1e-4, `${ctx}: whole panel scaled uniformly (${ws})`).toBe(true)
        await sleep(400)
        const m = headOffsetOf(panel.getTransform().getWorldPosition())
        log(`${ctx}: offset stored ${fmtOffset(c.panelOffset)} | measured ${fmtOffset(m)} | angular ${fmtBox(angularBox(visualCorners(panel)))}`)
        expect(JSON.stringify(c.panelOffset), `${ctx}: stored offset unchanged`).toBe(JSON.stringify(o0))
        expect(Math.abs(m.distanceCm - o0.distanceCm) <= 1 && Math.abs(m.horizontalDeg - o0.horizontalDeg) <= 1 && Math.abs(m.verticalDeg - o0.verticalDeg) <= 1, `${ctx}: measured offset unchanged`).toBe(true)
        expect(panel.getTransform().getWorldPosition().distance(centre0) < 1, `${ctx}: scaled around its centre`).toBe(true)
        const gb = obj("PanelGrabBar")
        expect(Math.abs(gb.getTransform().getWorldScale().x - want) < 1e-4, `${ctx}: grab bar scales with the panel`).toBe(true)
        const widths = MAIN.map((n) => buttonWidthCm(n))
        log(`${ctx}: main button widths ${widths.map((w) => w.toFixed(2)).join(", ")} cm`)
        for (let i = 0; i < MAIN.length; i++) expect(widths[i] >= 4.5, `${ctx}: ${MAIN[i]} ${widths[i].toFixed(2)} cm wide (>= 4.5)`).toBe(true)
        const smaller = obj("PanelSmallerButton").getComponent(Button.getTypeName()) as Button
        const bigger = obj("PanelBiggerButton").getComponent(Button.getTypeName()) as Button
        expect(smaller.inactive, `${ctx}: "-" greyed?`).toBe(want === SIZES[0])
        expect(bigger.inactive, `${ctx}: "+" greyed?`).toBe(want === SIZES[SIZES.length - 1])
      }

      // Buttons still work at this size (real pinches), then put the state back.
      const checkButtons = async (ctx: string) => {
        const before = otherEvents
        await tap(it, "NextButton")
        expect(c.currentPieceKey, `${ctx}: Next`).toBe(offer[1].variants[0].key)
        for (let i = 2; i <= offer.length; i++) await tap(it, "NextButton")
        expect(c.currentPieceKey, `${ctx}: Next wraps back`).toBe(offer[0].variants[0].key)
        await tap(it, "CompareButton")
        expect(c.currentPieceKey, `${ctx}: Compare`).toBe(offer[0].variants[1].key)
        for (let i = 2; i <= offer[0].variants.length; i++) await tap(it, "CompareButton")
        expect(c.currentPieceKey, `${ctx}: Compare wraps back`).toBe(offer[0].variants[0].key)
        await tap(it, "MeasureButton")
        expect(c.measureOn, `${ctx}: Measure on`).toBe(true)
        await tap(it, "MeasureButton")
        expect(c.measureOn, `${ctx}: Measure off`).toBe(false)
        await tap(it, "RotateLeftButton")
        expect(c.rotationDeg, `${ctx}: Rotate left`).toBeCloseTo(15, 1)
        await tap(it, "RotateRightButton")
        expect(c.rotationDeg % 360, `${ctx}: Rotate right`).toBeCloseTo(0, 1)
        await tap(it, "GalleryButton")
        expect(c.galleryOpen, `${ctx}: Gallery opens`).toBe(true)
        await tap(it, "GalleryCloseButton")
        expect(c.galleryOpen, `${ctx}: Gallery closes`).toBe(false)
        const pinches = offer.length + offer[0].variants.length + 2 + 2 + 1
        expect(otherEvents - before, `${ctx}: one event per main-button pinch`).toBe(pinches)
      }

      const sizeTap = async (name: string, ctx: string) => {
        const before = JSON.stringify({ev: otherEvents, k: c.currentPieceKey, p: c.piecePosition, r: c.rotationDeg, m: c.measureOn})
        await tap(it, name)
        expect(JSON.stringify({ev: otherEvents, k: c.currentPieceKey, p: c.piecePosition, r: c.rotationDeg, m: c.measureOn}), `${ctx}: no other button, piece or Measure change`).toBe(before)
      }

      // Start at 100%
      await checkSize(1.0)
      await checkButtons("100%")
      // Down to 75%: "-" greyed, a pinch on it does nothing
      await sizeTap("PanelSmallerButton", "- to 75%")
      await checkSize(0.75)
      await expectGreyedButton("PanelSmallerButton", "75%")
      c.panelScaleDown()
      expect(c.panelScale, "75%: API step down is a no-op").toBe(0.75)
      await checkButtons("75%")
      log(`REPORT main button width at 75% and 110 cm: ${buttonWidthCm("NextButton").toFixed(2)} cm`)
      // Up through 100%, 125%, 150%: "+" greyed at the top
      for (const want of [1.0, 1.25, 1.5]) {
        await sizeTap("PanelBiggerButton", `+ to ${want * 100}%`)
        await checkSize(want)
        if (want !== 1.0) await checkButtons(`${want * 100}%`)
      }
      await expectGreyedButton("PanelBiggerButton", "150%")
      c.panelScaleUp()
      expect(c.panelScale, "150%: API step up is a no-op").toBe(1.5)
      // And back down one step at a time
      for (const want of [1.25, 1.0]) {
        await sizeTap("PanelSmallerButton", `- to ${want * 100}%`)
        await checkSize(want)
      }
    } finally {
      for (const u of unsubs) u()
      await hold.stop()
    }
    await resetState()
    log("C20 done")
  }
}
