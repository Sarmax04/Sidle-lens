/**
 * Done criterion 11 (Update 3) — at the start the control panel is 110 cm from
 * the head, centred, 30° below forward, faces the user, at most 28° wide as
 * seen from the head, and no part of it (grab bar included) is within 10°
 * below forward. The grab bar runs along the
 * top edge and is at least 12 × 2.5 cm.
 * The head is held level at the start pose for the whole scenario (HeadHold),
 * so preview navigation cannot change the result. Measured independently of
 * SidlePanelOffset (own head-space math in SidleTestHelpers).
 * Also logs (no assertion) how much of the piece the panel covers from the
 * start, for the brief's "never covers the piece" claim.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleLazyFollow} from "../../Scripts/SidleLazyFollow"
import {
  angularBox,
  fmtBox,
  fmtOffset,
  HeadHold,
  headOffsetOf,
  levelHeadFrame,
  log,
  meshBounds,
  obj,
  panelObj,
  resetState,
  skippedVisuals,
  START_HEAD,
  visualCorners,
} from "./SidleTestHelpers"

const BRIEF = {distanceCm: 110, dropDeg: 30, maxWidthDeg: 28, clearBelowForwardDeg: 10, barMinW: 12, barMinH: 2.5}

@component
export class C13PanelDefaultScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const hold = new HeadHold(START_HEAD.pos, START_HEAD.yawDeg)
    try {
      const c = await resetState()
      const panel = panelObj(c)
      const follow = panel.getComponent(SidleLazyFollow.getTypeName()) as SidleLazyFollow
      expect(!!follow, "SidleLazyFollow on the panel").toBe(true)

      // Inspector defaults and the controller's offset
      expect(follow.panelDistanceCm, "Inspector default panelDistanceCm").toBe(BRIEF.distanceCm)
      expect(follow.panelDropDeg, "Inspector default panelDropDeg").toBe(BRIEF.dropDeg)
      const o = c.panelOffset
      log(`controller panelOffset ${fmtOffset(o)}`)
      expect(o.distanceCm, "offset distance").toBeCloseTo(BRIEF.distanceCm, 3)
      expect(o.horizontalDeg, "offset horizontal").toBeCloseTo(0, 3)
      expect(o.verticalDeg, "offset vertical").toBeCloseTo(-BRIEF.dropDeg, 3)
      expect(c.panelDragging, "not dragging").toBe(false)

      await sleep(1500) // let the lazy follow settle on the held head
      const head = levelHeadFrame()
      log(`head ${head.pos} pitch ${head.pitchDeg.toFixed(2)}°`)
      expect(Math.abs(head.pitchDeg) < 0.5, "premise: head level").toBe(true)

      // Measured panel centre
      const pt = panel.getTransform()
      const m = headOffsetOf(pt.getWorldPosition())
      log(`measured panel centre ${fmtOffset(m)}`)
      expect(Math.abs(m.distanceCm - BRIEF.distanceCm) <= 1, `panel ${m.distanceCm.toFixed(2)} cm from the head`).toBe(true)
      expect(Math.abs(m.horizontalDeg) <= 1, `panel centred (h ${m.horizontalDeg.toFixed(2)}°)`).toBe(true)
      expect(Math.abs(m.verticalDeg + BRIEF.dropDeg) <= 1, `panel ${(-m.verticalDeg).toFixed(2)}° below forward`).toBe(true)

      // Faces the user: panel front (+Z) points at the eye
      const front = pt.getWorldRotation().multiplyVec3(new vec3(0, 0, 1))
      const toEye = head.pos.sub(pt.getWorldPosition()).normalize()
      const facing = front.dot(toEye)
      log(`facing dot ${facing.toFixed(4)}`)
      expect(facing > 0.995, `panel faces the user (dot ${facing.toFixed(4)})`).toBe(true)
      const sideUp = pt.getWorldRotation().multiplyVec3(new vec3(1, 0, 0))
      expect(Math.abs(sideUp.y) < 0.02, "panel not rolled").toBe(true)

      // No part of it within 10° below forward (every visual, grab bar included)
      const corners = visualCorners(panel)
      log(`panel visual corners: ${corners.length}; skipped (not finite): [${skippedVisuals.join(", ")}]`)
      const box = angularBox(corners)
      log(`panel angular box ${fmtBox(box)} (width ${(box.hMax - box.hMin).toFixed(1)}°, height ${(box.vMax - box.vMin).toFixed(1)}°)`)
      expect(box.hMax - box.hMin <= BRIEF.maxWidthDeg, `panel ${(box.hMax - box.hMin).toFixed(1)}° wide as seen from the head (max 28)`).toBe(true)
      expect(box.vMax <= -BRIEF.clearBelowForwardDeg, `highest point of the panel ${(-box.vMax).toFixed(1)}° below forward (needs >= 10)`).toBe(true)

      // Grab bar: along the top edge, at least 12 × 2.5 cm
      const bar = obj("PanelGrabBar")
      expect(bar.getParent() === panel, "grab bar is part of the panel").toBe(true)
      const bb = meshBounds(bar, bar)
      expect(bb !== null, "grab bar has a visual").toBe(true)
      const bw = bb!.max.x - bb!.min.x
      const bh = bb!.max.y - bb!.min.y
      log(`grab bar ${bw.toFixed(2)} x ${bh.toFixed(2)} cm`)
      expect(bw >= BRIEF.barMinW - 0.01, `grab bar width ${bw}`).toBe(true)
      expect(bh >= BRIEF.barMinH - 0.01, `grab bar height ${bh}`).toBe(true)
      const plate = meshBounds(panel, panel) // whole panel in its own frame
      const barInPanel = meshBounds(bar, panel)!
      const barCentre = (barInPanel.min.x + barInPanel.max.x) / 2
      expect(Math.abs(barCentre) < 0.5, "grab bar centred on the top edge").toBe(true)
      // Update 5 puts the "-" / "+" size buttons on the grab bar's row; apart from them nothing is above the bar.
      const toPanel = panel.getTransform().getInvertedWorldTransform()
      let topOthers = -Infinity
      for (let i = 0; i < panel.getChildrenCount(); i++) {
        const ch = panel.getChild(i)
        if (ch === bar || ch.name === "PanelSmallerButton" || ch.name === "PanelBiggerButton") continue
        for (const p of visualCorners(ch)) topOthers = Math.max(topOthers, toPanel.multiplyPoint(p).y)
      }
      expect(barInPanel.max.y >= topOthers - 0.01, `grab bar is on the top row (bar top ${barInPanel.max.y.toFixed(2)}, rest ${topOthers.toFixed(2)})`).toBe(true)
      const others = visualCorners(panel).map((p) => panel.getTransform().getInvertedWorldTransform().multiplyPoint(p))
      const barCorners = visualCorners(bar).map((p) => panel.getTransform().getInvertedWorldTransform().multiplyPoint(p))
      const belowBar = others.filter((p) => p.y < barInPanel.min.y - 0.01)
      const contentTop = Math.max(...belowBar.map((p) => p.y))
      log(`panel content top ${contentTop.toFixed(2)} cm, grab bar ${barInPanel.min.y.toFixed(2)}..${barInPanel.max.y.toFixed(2)} cm (panel frame), ${barCorners.length} bar corners`)
      expect(barInPanel.min.y > contentTop - 0.01, "grab bar sits above the panel's top edge").toBe(true)

      // Report: does the panel cover the piece from the start? (brief: "never covered")
      const piece = angularBox(visualCorners(obj(`Piece_${c.currentPieceKey}`), true))
      log(`piece ${c.currentPieceKey} angular box ${fmtBox(piece)}`)
      const ovH = Math.min(piece.hMax, box.hMax) - Math.max(piece.hMin, box.hMin)
      const ovV = Math.min(piece.vMax, box.vMax) - Math.max(piece.vMin, box.vMin)
      const area = (b: {hMin: number; hMax: number; vMin: number; vMax: number}) => (b.hMax - b.hMin) * (b.vMax - b.vMin)
      const overlap = ovH > 0 && ovV > 0 ? (ovH * ovV) / area(piece) : 0
      log(`REPORT panel covers ${(overlap * 100).toFixed(0)}% of the piece's angular box from the start (head level)`)
    } finally {
      await hold.stop()
    }
    log("C13 done")
  }
}
