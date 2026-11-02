/**
 * Done criterion 12 (Update 3) — dragging the grab bar (real SIK drag through a
 * LEAF interactor) moves the panel with the hand; after release it stays at the
 * new head-space offset while the head turns and moves (following with the
 * usual delay); dragging past a limit stops at it (distance 60-140 cm,
 * horizontal within 40°, vertical 10° above to 50° below); the piece, Measure
 * and the buttons are unaffected, and pinching a button still works after the
 * panel has moved.
 * The head is held by HeadHold (start pose, then moved/turned on purpose).
 * Expected pieces come from the bundled catalog.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {nextFrame, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {
  bundledCatalog,
  expectedOffer,
  fmtOffset,
  HeadHold,
  headOffsetOf,
  interactable,
  levelHeadFrame,
  log,
  obj,
  panelObj,
  resetState,
  START_HEAD,
  tap,
} from "./SidleTestHelpers"

type Offset = {distanceCm: number; horizontalDeg: number; verticalDeg: number}
const LIMITS = {minD: 60, maxD: 140, maxH: 40, minV: -50, maxV: 10}

function measured(c: SidleController): Offset {
  return headOffsetOf(panelObj(c).getTransform().getWorldPosition())
}

function expectAt(c: SidleController, want: Offset, ctx: string, tolCm = 1.5, tolDeg = 1.5): void {
  const m = measured(c)
  log(`${ctx}: stored ${fmtOffset(c.panelOffset)} | measured ${fmtOffset(m)}`)
  expect(Math.abs(m.distanceCm - want.distanceCm) <= tolCm, `${ctx}: distance ${m.distanceCm.toFixed(2)} vs ${want.distanceCm.toFixed(2)}`).toBe(true)
  expect(Math.abs(m.horizontalDeg - want.horizontalDeg) <= tolDeg, `${ctx}: horizontal ${m.horizontalDeg.toFixed(2)} vs ${want.horizontalDeg.toFixed(2)}`).toBe(true)
  expect(Math.abs(m.verticalDeg - want.verticalDeg) <= tolDeg, `${ctx}: vertical ${m.verticalDeg.toFixed(2)} vs ${want.verticalDeg.toFixed(2)}`).toBe(true)
}

function expectWithinLimits(o: Offset, ctx: string): void {
  const e = 1e-3
  expect(o.distanceCm >= LIMITS.minD - e && o.distanceCm <= LIMITS.maxD + e, `${ctx}: distance within 60-140 (${o.distanceCm})`).toBe(true)
  expect(Math.abs(o.horizontalDeg) <= LIMITS.maxH + e, `${ctx}: horizontal within 40° (${o.horizontalDeg})`).toBe(true)
  expect(o.verticalDeg >= LIMITS.minV - e && o.verticalDeg <= LIMITS.maxV + e, `${ctx}: vertical within +10/-50 (${o.verticalDeg})`).toBe(true)
}

@component
export class C14PanelDragScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const hold = new HeadHold(START_HEAD.pos, START_HEAD.yawDeg)
    const unsubs: (() => void)[] = []
    try {
      const c = await resetState()
      const it = new DefaultLeafInteractor("C14Interactor")
      const bar = interactable("PanelGrabBar")
      const offer = expectedOffer(bundledCatalog(), true)
      await sleep(500)

      // Watchers: any button event, any piece drag, while the bar is being dragged
      let buttonEvents = 0
      const ui = c.panelUI
      for (const ev of [ui.onNext, ui.onCompare, ui.onMeasure, ui.onRotateLeft, ui.onRotateRight]) unsubs.push(ev.add(() => buttonEvents++))
      let pieceDraggedDuringBar = false
      let barUpdates = 0
      let draggingSeen = false
      let held: vec3 | null = null
      unsubs.push(
        bar.onTriggerUpdate.add(() => {
          barUpdates++
          if (c.panelDragging) draggingSeen = true
          if (c.isDragging) pieceDraggedDuringBar = true
          held = (it as unknown as {endPoint: vec3}).endPoint
        }),
      )
      const before = JSON.stringify({k: c.currentPieceKey, p: c.piecePosition, r: c.rotationDeg, m: c.measureOn})

      // 1. Drag within the limits: the panel moves with the hand.
      const o0 = c.panelOffset
      const c0 = panelObj(c).getTransform().getWorldPosition()
      let held0: vec3 | null = null
      const firstHold = bar.onTriggerStart.add(() => {
        held0 = (it as unknown as {endPoint: vec3}).endPoint
      })
      await it.drag(bar, new vec3(0.7, 0.25, 0), 600) // right and a bit up, per frame (world cm)
      firstHold()
      await nextFrame()
      expect(barUpdates > 3, `drag produced trigger updates (${barUpdates})`).toBe(true)
      expect(draggingSeen, "panelDragging while the bar is held").toBe(true)
      expect(c.panelDragging, "panelDragging false after release").toBe(false)
      const o1 = c.panelOffset
      const c1 = panelObj(c).getTransform().getWorldPosition()
      log(`drag 1: ${fmtOffset(o0)} -> ${fmtOffset(o1)}`)
      expect(o1.horizontalDeg - o0.horizontalDeg > 3, "dragging right turned the panel to the right").toBe(true)
      expect(o1.verticalDeg - o0.verticalDeg > 0.5, "dragging up raised the panel").toBe(true)
      expectWithinLimits(o1, "drag 1")
      expect(held0 !== null && held !== null, "held points recorded").toBe(true)
      const dHand = held!.sub(held0!)
      const dPanel = c1.sub(c0)
      log(`drag 1: hand moved ${dHand} (${dHand.length.toFixed(1)} cm), panel moved ${dPanel} (${dPanel.length.toFixed(1)} cm)`)
      expect(dPanel.sub(dHand).length < 2.5, `panel follows the hand (diff ${dPanel.sub(dHand).length.toFixed(2)} cm)`).toBe(true)

      // 2. Released: stays at the new offset ...
      await sleep(1500)
      expectAt(c, o1, "after release")
      // ... while the head turns and moves, following with the usual delay.
      for (const pose of [
        {pos: new vec3(40, 0, -60), yawDeg: 35},
        {pos: new vec3(-50, 5, -120), yawDeg: -30},
        {pos: START_HEAD.pos, yawDeg: START_HEAD.yawDeg},
      ]) {
        hold.set(pose.pos, pose.yawDeg)
        await nextFrame()
        await nextFrame()
        const lag = measured(c)
        const lagErr = Math.abs(lag.horizontalDeg - o1.horizontalDeg) + Math.abs(lag.verticalDeg - o1.verticalDeg)
        log(`head -> ${pose.pos} yaw ${pose.yawDeg}°: 2 frames later ${fmtOffset(lag)} (angle error ${lagErr.toFixed(1)}°)`)
        expect(lagErr > 3, "follows with a delay (not glued to the head)").toBe(true)
        await sleep(3000)
        expectAt(c, o1, `head at ${pose.pos} yaw ${pose.yawDeg}`)
        expect(JSON.stringify(c.panelOffset), "stored offset unchanged by head motion").toBe(JSON.stringify(o1))
      }

      // 3. Limits: dragging past each one stops at it.
      const limitCases: {name: string; v: vec3; check: (o: Offset) => [number, number]}[] = [
        {name: "right", v: new vec3(3, 0, 0), check: (o) => [o.horizontalDeg, LIMITS.maxH]},
        {name: "left", v: new vec3(-3, 0, 0), check: (o) => [o.horizontalDeg, -LIMITS.maxH]},
        {name: "up", v: new vec3(0, 3, 0), check: (o) => [o.verticalDeg, LIMITS.maxV]},
        {name: "down", v: new vec3(0, -3, 0), check: (o) => [o.verticalDeg, LIMITS.minV]},
        {name: "away", v: new vec3(0, 0, -3), check: (o) => [o.distanceCm, LIMITS.maxD]},
      ]
      for (const lc of limitCases) {
        c.resetPanelOffset()
        await sleep(300)
        await it.drag(interactable("PanelGrabBar"), lc.v, 1200)
        await nextFrame()
        const o = c.panelOffset
        const [got, lim] = lc.check(o)
        log(`limit ${lc.name}: ${fmtOffset(o)}`)
        expect(Math.abs(got - lim) < 0.01, `limit ${lc.name}: stops at ${lim} (got ${got.toFixed(3)})`).toBe(true)
        expectWithinLimits(o, `limit ${lc.name}`)
        await sleep(1200)
        expectAt(c, o, `limit ${lc.name} placed`)
      }

      // Closer: pull the bar toward the head in short steps (a single long pull would
      // carry the hand point past the head); every step must stay within the limits.
      c.resetPanelOffset()
      await sleep(300)
      let steps = 0
      while (c.panelOffset.distanceCm > LIMITS.minD + 0.01 && steps++ < 30) {
        const barPos = obj("PanelGrabBar").getTransform().getWorldPosition()
        const toHead = levelHeadFrame().pos.sub(barPos).normalize().uniformScale(0.5)
        await it.drag(interactable("PanelGrabBar"), toHead, 300)
        await nextFrame()
        expectWithinLimits(c.panelOffset, `limit closer step ${steps}`)
      }
      log(`limit closer: ${fmtOffset(c.panelOffset)} after ${steps} pulls`)
      expect(Math.abs(c.panelOffset.distanceCm - LIMITS.minD) < 0.01, `limit closer: stops at ${LIMITS.minD} (got ${c.panelOffset.distanceCm.toFixed(3)})`).toBe(true)
      const extra = obj("PanelGrabBar").getTransform().getWorldPosition()
      await it.drag(interactable("PanelGrabBar"), levelHeadFrame().pos.sub(extra).normalize().uniformScale(0.5), 300) // one more pull past it
      await nextFrame()
      expect(Math.abs(c.panelOffset.distanceCm - LIMITS.minD) < 0.01, "limit closer: a further pull stays at the limit").toBe(true)
      await sleep(1200)
      expectAt(c, c.panelOffset, "limit closer placed")

      // 4. The piece, Measure and the buttons were not touched by any of it.
      expect(buttonEvents, "no button pressed while dragging the bar").toBe(0)
      expect(pieceDraggedDuringBar, "piece never dragged by the bar").toBe(false)
      expect(JSON.stringify({k: c.currentPieceKey, p: c.piecePosition, r: c.rotationDeg, m: c.measureOn}), "piece, rotation and Measure unchanged").toBe(before)

      // 5. With the panel moved, pinching buttons works as before.
      c.resetPanelOffset()
      await sleep(300)
      await it.drag(interactable("PanelGrabBar"), new vec3(-0.8, 0.3, 0.1), 600)
      await sleep(1500)
      const moved = c.panelOffset
      log(`panel moved for button check: ${fmtOffset(moved)}`)
      expect(Math.abs(moved.horizontalDeg) > 3, "panel is off its default for the button check").toBe(true)
      await tap(it, "NextButton")
      expect(c.currentPieceKey, "Next works with the panel moved").toBe(offer[1].variants[0].key)
      for (let i = 2; i <= offer.length; i++) await tap(it, "NextButton")
      expect(c.currentPieceKey, "Next wraps back").toBe(offer[0].variants[0].key)
      await tap(it, "MeasureButton")
      expect(c.measureOn, "Measure works with the panel moved").toBe(true)
      await tap(it, "MeasureButton")
      expect(c.measureOn, "Measure off again").toBe(false)
      expect(buttonEvents, "button events counted for the real pinches").toBe(offer.length + 2)
      expect(JSON.stringify(c.panelOffset), "button pinches do not move the panel").toBe(JSON.stringify(moved))
    } finally {
      for (const u of unsubs) u()
      await hold.stop()
    }
    await resetState()
    log("C14 done")
  }
}
