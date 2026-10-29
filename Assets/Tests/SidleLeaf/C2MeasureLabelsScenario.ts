/**
 * Done criterion 2 — Measure toggle (pinch MeasureButton), labels while dragging
 * (pinch-drag PieceGrab), outline + labels follow the piece.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {dragPiece, interactable, local, log, obj, resetState, tap, textOf} from "./SidleTestHelpers"

@component
export class C2MeasureLabelsScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C2Interactor")

    // --- Measure toggle through the real button ---
    expect(c.measureOn, "Measure off before first pinch").toBe(false)
    expect(obj("DimensionLabels").enabled, "labels hidden before Measure").toBe(false)
    await tap(it, "MeasureButton")
    expect(c.measureOn, "Measure on after pinch").toBe(true)
    expect(obj("DimensionLabels").enabled, "DimensionLabels shown after Measure pinch").toBe(true)
    const w = textOf("WidthLabel")
    const d = textOf("DepthLabel")
    const h = textOf("HeightLabel")
    log(`labels: "${w}" "${d}" "${h}"`)
    expect(w.includes("220") && w.includes("cm"), `width label "${w}"`).toBe(true)
    expect(d.includes("90") && d.includes("cm"), `depth label "${d}"`).toBe(true)
    expect(h.includes("85") && h.includes("cm"), `height label "${h}"`).toBe(true)
    for (const n of ["WidthLabel", "DepthLabel", "HeightLabel"]) {
      const p = local(n)
      const dist = Math.sqrt((p.x - c.piecePosition.x) ** 2 + (p.z - c.piecePosition.z) ** 2)
      expect(dist < 160, `${n} next to the piece (dist ${dist.toFixed(1)})`).toBe(true)
      expect(p.y < 30, `${n} near the floor outline (y ${p.y})`).toBe(true)
    }

    // --- Outline + labels move with the piece while dragged (Measure on) ---
    const p0 = c.piecePosition
    const w0 = local("WidthLabel")
    const d0 = local("DepthLabel")
    await dragPiece(it, new vec3(-0.6, 0, 0), 500)
    const p1 = c.piecePosition
    const dx = p1.x - p0.x
    const dz = p1.z - p0.z
    log(`drag moved piece by (${dx.toFixed(1)}, ${dz.toFixed(1)})`)
    expect(dx < -3, `drag moved the piece left (dx ${dx})`).toBe(true)
    expect(Math.abs(dz) < 2, `drag kept z (dz ${dz})`).toBe(true)
    expect(local("Piece").y, "piece stays on floor").toBeCloseTo(0, 2)
    const fo = local("FloorOutline")
    expect(fo.x, "outline follows x").toBeCloseTo(p1.x, 1)
    expect(fo.z, "outline follows z").toBeCloseTo(p1.z, 1)
    const w1 = local("WidthLabel")
    const d1 = local("DepthLabel")
    expect(w1.x - w0.x, "WidthLabel moved with piece (x)").toBeCloseTo(dx, 0)
    expect(d1.x - d0.x, "DepthLabel moved with piece (x)").toBeCloseTo(dx, 0)
    expect(c.measureOn && obj("DimensionLabels").enabled, "labels stay on after release while Measure on").toBe(true)

    // --- Pinch Measure again -> hidden ---
    await tap(it, "MeasureButton")
    expect(c.measureOn, "Measure off after second pinch").toBe(false)
    expect(obj("DimensionLabels").enabled, "DimensionLabels hidden after second pinch").toBe(false)

    // --- Measure off: labels show while dragging, hide on release ---
    const dragP = it.drag(interactable("PieceGrab"), new vec3(0.4, 0, 0), 900)
    await sleep(450)
    const midDragging = c.isDragging
    const midLabels = obj("DimensionLabels").enabled
    log(`mid-drag: isDragging=${midDragging} labels=${midLabels}`)
    await dragP
    await sleep(150)
    expect(midDragging, "isDragging during pinch-drag").toBe(true)
    expect(midLabels, "DimensionLabels visible while dragging with Measure off").toBe(true)
    expect(c.isDragging, "isDragging false after release").toBe(false)
    expect(obj("DimensionLabels").enabled, "DimensionLabels hidden after release (Measure off)").toBe(false)
    log("C2 done")
  }
}
