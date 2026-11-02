/**
 * Gap-label readability from the start position (report scenario).
 *
 * For each obstacle (left, right, far and doorway wall, coffee table) the
 * current piece is moved so the gap is 40 cm (and 10 cm for the right and
 * doorway wall, where the number is lifted above the edge). From the start
 * head pose (held level by HeadHold) it measures the gap number:
 * - angle below horizontal and whether it is in the display's field of view
 *   (Camera.fov / aspect) with the head level, and when looking at the piece
 *   (the brief: "where the user is looking: at the piece"); "BELOW" means it
 *   is under the bottom edge of the view while looking at the piece;
 * - whether it is behind the user, or behind the control panel (head level);
 * - how much a flat label is foreshortened (cos of the viewing angle), its
 *   angular glyph height, and whether the text reads upright for the user.
 * Asserts only that the number shows and that the intended obstacle is the
 * nearest one; everything else is logged as "GAPVIEW" rows for the report.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {
  angularBox,
  COFFEE,
  HeadHold,
  headOffsetOf,
  levelHeadFrame,
  log,
  obj,
  panelObj,
  resetState,
  ROOM,
  START,
  START_HEAD,
  visualCorners,
} from "./SidleTestHelpers"

const DEG = 180 / Math.PI

@component
export class C15GapLabelViewScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const hold = new HeadHold(START_HEAD.pos, START_HEAD.yawDeg)
    let below = 0
    try {
      const c = await resetState()
      const {w, d, h} = c.currentDims
      const camC = WorldCameraFinderProvider.getInstance().getComponent()
      const vHalf = (camC.fov * DEG) / 2
      const hHalf = Math.atan(Math.tan(camC.fov / 2) * camC.aspect) * DEG
      log(`GAPVIEW camera fov ${(2 * vHalf).toFixed(1)}° x ${(2 * hHalf).toFixed(1)}° (v x h), aspect ${camC.aspect.toFixed(3)}; piece ${c.currentPieceKey} ${w} x ${d} x ${h}`)
      await sleep(1200)
      const panelBox = angularBox(visualCorners(panelObj(c)))

      const cases = [
        {obstacle: "LeftWall", gap: 40, x: ROOM.minX + w / 2 + 40, z: START.z},
        {obstacle: "RightWall", gap: 40, x: ROOM.maxX - w / 2 - 40, z: START.z},
        {obstacle: "FarWall", gap: 40, x: 0, z: ROOM.minZ + d / 2 + 40},
        {obstacle: "DoorwayWall", gap: 40, x: 0, z: ROOM.maxZ - d / 2 - 40},
        {obstacle: "CoffeeTable", gap: 40, x: COFFEE.minX + 20 - w / 2, z: COFFEE.maxZ + 40 + d / 2},
        {obstacle: "RightWall", gap: 10, x: ROOM.maxX - w / 2 - 10, z: START.z},
        {obstacle: "DoorwayWall", gap: 10, x: 0, z: ROOM.maxZ - d / 2 - 10},
      ]
      log("GAPVIEW obstacle | gap | label below horizontal | in view, head level | rel. to gaze at piece (v, h) | in view looking at piece | behind user | behind panel | foreshortening | glyph height | text")
      for (const k of cases) {
        c.setPiecePosition(k.x, k.z)
        await sleep(400)
        const ctx = `${k.obstacle} ${k.gap} cm`
        expect(c.nearestObstacle, `${ctx}: nearest obstacle`).toBe(k.obstacle)
        expect(Math.abs(c.nearestGapCm - k.gap) < 0.5, `${ctx}: gap ${c.nearestGapCm}`).toBe(true)
        const label = obj("GapLabel")
        expect(label.enabled, `${ctx}: gap number shows`).toBe(true)

        const eye = levelHeadFrame().pos
        const lt = label.getTransform()
        const p = lt.getWorldPosition()
        const toLabel = p.sub(eye)
        const dist = toLabel.length
        const l = toLabel.normalize()

        // Head level
        const lv = headOffsetOf(p)
        const inLevel = Math.abs(lv.verticalDeg) <= vHalf && Math.abs(lv.horizontalDeg) <= hHalf
        const behindUser = l.dot(levelHeadFrame().fwd) < 0
        const behindPanel = lv.horizontalDeg >= panelBox.hMin && lv.horizontalDeg <= panelBox.hMax && lv.verticalDeg >= panelBox.vMin && lv.verticalDeg <= panelBox.vMax

        // Looking at the piece (gaze at its centre)
        const target = obj("Piece").getTransform().getWorldPosition().add(new vec3(0, h / 2, 0))
        const g = target.sub(eye).normalize()
        const gr = g.cross(vec3.up()).normalize()
        const gu = gr.cross(g)
        const dv = Math.asin(Math.max(-1, Math.min(1, l.dot(gu)))) * DEG
        const dh = Math.atan2(l.dot(gr), l.dot(g)) * DEG
        const inGaze = Math.abs(dv) <= vHalf && Math.abs(dh) <= hHalf
        const isBelow = !inGaze && dv < -vHalf
        if (isBelow || behindUser) below++

        // Readability of the flat label
        const n = lt.getWorldRotation().multiplyVec3(new vec3(0, 0, 1))
        const cosView = Math.abs(n.dot(l.uniformScale(-1)))
        const inv = lt.getInvertedWorldTransform()
        const local = visualCorners(label).map((q) => inv.multiplyPoint(q))
        const textH = local.length ? Math.max(...local.map((q) => q.y)) - Math.min(...local.map((q) => q.y)) : 0
        const glyphDeg = Math.atan((textH * cosView) / dist) * DEG
        const up = lt.getWorldRotation().multiplyVec3(new vec3(0, 1, 0))
        const flat = new vec3(l.x, 0, l.z).normalize()
        const upDot = new vec3(up.x, 0, up.z).normalize().dot(flat)
        const reads = upDot > 0.7 ? "upright" : upDot < -0.7 ? "upside down" : `sideways (${(Math.acos(Math.max(-1, Math.min(1, upDot))) * DEG).toFixed(0)}°)`

        log(
          `GAPVIEW ${k.obstacle} | ${k.gap} | ${(-lv.verticalDeg).toFixed(1)}° at ${dist.toFixed(0)} cm (y ${(p.y - eye.y).toFixed(0)}) | ${inLevel ? "yes" : "no"} | v ${dv.toFixed(1)}°, h ${dh.toFixed(1)}° | ${inGaze ? "yes" : isBelow ? "BELOW" : "no (side/above)"} | ${behindUser ? "YES" : "no"} | ${behindPanel ? "YES" : "no"} | ${cosView.toFixed(2)} | ${glyphDeg.toFixed(2)}° (${textH.toFixed(1)} cm) | ${reads}`,
        )
      }
      log(`GAPVIEW summary: ${below} of ${cases.length} gap numbers are below the view or behind the user while looking at the piece`)
    } finally {
      await hold.stop()
    }
    await resetState()
    log("C15 done")
  }
}
