/**
 * Done criterion 18 (Update 5) — the Lens starts at 100% (checked before any
 * reset, so it is meaningful when this runs first after a Lens start); the
 * gallery opens at the panel's current size (every size) and at the panel's
 * offset; changing the size never moves the piece, changes its facing or
 * changes Measure (with Measure on and the piece moved and rotated).
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {
  controller,
  fmtOffset,
  galleryObj,
  HeadHold,
  headOffsetOf,
  log,
  obj,
  panelObj,
  resetState,
  START_HEAD,
  tap,
} from "./SidleTestHelpers"

@component
export class C21PanelSizeGalleryScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    // Start state, before resetState() touches anything
    const c0 = controller()
    const startScale = panelObj(c0).getTransform().getWorldScale()
    log(`start: panelScale ${c0.panelScale}, panel world scale ${startScale}`)
    expect(c0.panelScale, "Lens starts at 100%").toBe(1)
    expect(Math.abs(startScale.x - 1) < 1e-4, "panel drawn at 100% at the start").toBe(true)
    expect((obj("PanelSmallerButton").getComponent(Button.getTypeName()) as Button).inactive, '"-" active at 100%').toBe(false)
    expect((obj("PanelBiggerButton").getComponent(Button.getTypeName()) as Button).inactive, '"+" active at 100%').toBe(false)

    const hold = new HeadHold(START_HEAD.pos, START_HEAD.yawDeg)
    try {
      const c = await resetState()
      const it = new DefaultLeafInteractor("C21Interactor")

      // Gallery opens at the panel's size, at every size
      await tap(it, "PanelSmallerButton") // 75%
      for (const want of [0.75, 1.0, 1.25, 1.5]) {
        expect(c.panelScale, `size ${want}`).toBe(want)
        await tap(it, "GalleryButton")
        await sleep(300)
        const g = galleryObj(c)
        const gs = g.getTransform().getWorldScale()
        const go = headOffsetOf(g.getTransform().getWorldPosition())
        log(`${want * 100}%: gallery scale ${gs.x.toFixed(3)}, offset ${fmtOffset(go)} (panel ${fmtOffset(c.panelOffset)})`)
        expect(Math.abs(gs.x - want) < 1e-4 && Math.abs(gs.y - want) < 1e-4 && Math.abs(gs.z - want) < 1e-4, `${want * 100}%: gallery at the panel's size`).toBe(true)
        expect(Math.abs(go.distanceCm - c.panelOffset.distanceCm) <= 1.5 && Math.abs(go.verticalDeg - c.panelOffset.verticalDeg) <= 1.5, `${want * 100}%: gallery at the panel's offset`).toBe(true)
        await tap(it, "GalleryCloseButton")
        if (want < 1.5) await tap(it, "PanelBiggerButton")
      }

      // Size changes leave the piece, its facing and Measure alone
      await resetState()
      c.setPiecePosition(-60, -260) // API setup: somewhere else on the floor
      await tap(it, "RotateLeftButton")
      await tap(it, "RotateLeftButton")
      await tap(it, "MeasureButton")
      await sleep(200)
      const before = JSON.stringify({k: c.currentPieceKey, p: c.piecePosition, r: c.rotationDeg, m: c.measureOn, d: c.isDragging})
      log(`before resizing: ${before}`)
      for (const name of ["PanelBiggerButton", "PanelBiggerButton", "PanelSmallerButton", "PanelSmallerButton", "PanelSmallerButton", "PanelBiggerButton"]) {
        await tap(it, name)
        expect(JSON.stringify({k: c.currentPieceKey, p: c.piecePosition, r: c.rotationDeg, m: c.measureOn, d: c.isDragging}), `${name} -> ${c.panelScale}: piece and Measure unchanged`).toBe(before)
      }
      expect(c.panelScale, "back at 100%").toBe(1)
      await tap(it, "MeasureButton")
    } finally {
      await hold.stop()
    }
    await resetState()
    log("C21 done")
  }
}
