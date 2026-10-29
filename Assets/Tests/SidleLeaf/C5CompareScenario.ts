/**
 * Done criterion 5 — CompareButton flips Sofa A <-> Sofa B in the same spot/facing,
 * outline, labels and clearance update; with the bed or the table the button is
 * greyed out (UIKit Button.inactive) and a pinch does nothing.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep, withTimeout} from "Leaf.lspkg/Utils/common/Utils"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {SidleController} from "../../Scripts/SidleController"
import {angDiffDeg, expectEdges, interactable, log, obj, resetState, tap, textOf, yawOf} from "./SidleTestHelpers"

function baseColor(key: string): vec4 {
  const base = obj(`Piece_${key}`).getChild(0)
  return (base.getComponent("Component.RenderMeshVisual") as RenderMeshVisual).mainMaterial.mainPass.baseColor
}

function checkSofa(c: SidleController, key: "SofaA" | "SofaB", pos: {x: number; z: number}, rot: number, gap: number): void {
  const dims = key === "SofaA" ? {w: 220, d: 90, h: 85} : {w: 180, d: 85, h: 85}
  expect(c.currentPieceKey, "piece").toBe(key)
  expect(JSON.stringify(c.currentDims), `${key} dims`).toBe(JSON.stringify(dims))
  expect(obj("Piece_SofaA").enabled, "Piece_SofaA visible?").toBe(key === "SofaA")
  expect(obj("Piece_SofaB").enabled, "Piece_SofaB visible?").toBe(key === "SofaB")
  expect(c.piecePosition.x, `${key} same spot x`).toBeCloseTo(pos.x, 1)
  expect(c.piecePosition.z, `${key} same spot z`).toBeCloseTo(pos.z, 1)
  expect(angDiffDeg(c.rotationDeg, rot) < 0.01, `${key} same facing`).toBe(true)
  expect(angDiffDeg((yawOf(obj("FloorOutline").getTransform()) * 180) / Math.PI, rot) < 0.5, `${key} outline facing`).toBe(true)
  expect(obj("Edge_Front").getTransform().getLocalScale().x, `${key} outline width`).toBeCloseTo(dims.w + 4, 1)
  expect(obj("Edge_Right").getTransform().getLocalScale().z, `${key} outline depth`).toBeCloseTo(dims.d + 4, 1)
  const w = textOf("WidthLabel")
  const d = textOf("DepthLabel")
  expect(w.includes(`${dims.w}`), `${key} width label "${w}"`).toBe(true)
  expect(d.includes(`${dims.d}`), `${key} depth label "${d}"`).toBe(true)
  expect(c.nearestObstacle, `${key} nearest obstacle`).toBe("RightWall")
  expect(c.nearestGapCm, `${key} clearance to right wall`).toBeCloseTo(gap, 1)
  expect(c.gapLabelText, `${key} gap text`).toBe(`${Math.floor(gap)} cm`)
  expectEdges(c, ["green", "red", "green", "green"], `${key} near right wall`)
  const col = baseColor(key)
  log(`${key} base color ${col}`)
  if (key === "SofaA") {
    expect(Math.max(col.x, col.y, col.z) - Math.min(col.x, col.y, col.z) < 0.06 && col.x > 0.7, `Sofa A light gray (${col})`).toBe(true)
  } else {
    expect(col.x > 0.75 && col.x > col.y && col.y > col.z && col.x - col.z > 0.15, `Sofa B warm beige (${col})`).toBe(true)
  }
}

@component
export class C5CompareScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C5Interactor")

    // Setup: Measure on (real button) so labels are inspectable; move (API) so Sofa A
    // is 30 cm from the right wall at 0° for exact clearance numbers.
    await tap(it, "MeasureButton")
    expect(c.measureOn, "Measure on").toBe(true)
    c.setPiecePosition(60, -220) // Sofa A right edge 170 -> 30 cm; Sofa B right edge 150 -> 50 cm
    await sleep(50)
    const pos = c.piecePosition
    const rot = c.rotationDeg
    expect(c.compareEnabled, "compare enabled with a sofa").toBe(true)
    const cmpBtn = obj("CompareButton").getComponent(Button.getTypeName()) as Button
    expect(cmpBtn.inactive, "CompareButton active with sofa").toBe(false)
    checkSofa(c, "SofaA", pos, rot, 30)

    await tap(it, "CompareButton")
    checkSofa(c, "SofaB", pos, rot, 50)
    await tap(it, "CompareButton")
    checkSofa(c, "SofaA", pos, rot, 30)

    // Bed + dining table: greyed out and a pinch does nothing
    for (const key of ["Bed", "DiningTable"]) {
      await tap(it, "NextButton")
      expect(c.currentPieceKey, "piece after Next").toBe(key)
      expect(c.compareEnabled, `${key}: compareEnabled`).toBe(false)
      expect(cmpBtn.inactive, `${key}: CompareButton.inactive (greyed out)`).toBe(true)
      const inter = interactable("CompareButton")
      expect(inter.enabled, `${key}: Compare interactable disabled`).toBe(false)
      const before = JSON.stringify([c.currentPieceKey, c.piecePosition, c.rotationDeg])
      // Attempt a real pinch with a separate interactor: it can't even hover a disabled target.
      const probe = new DefaultLeafInteractor(`C5Probe_${key}`)
      let pinchLanded = true
      try {
        await withTimeout(probe.trigger(inter), 1500, "no hover")
      } catch (e) {
        pinchLanded = false
        // Drop the probe's pending target so it can't fire later when Compare re-activates.
        ;(probe as unknown as {overrideInteractable?: unknown}).overrideInteractable = undefined
      }
      await sleep(200)
      log(`${key}: pinch on greyed Compare landed=${pinchLanded}`)
      expect(pinchLanded, `${key}: pinch on greyed-out Compare does not register`).toBe(false)
      expect(JSON.stringify([c.currentPieceKey, c.piecePosition, c.rotationDeg]), `${key}: unchanged after pinch`).toBe(before)
      c.compare() // API path must also be a no-op
      expect(c.currentPieceKey, `${key}: compare() API no-op`).toBe(key)
    }

    await tap(it, "NextButton") // back to Sofa A
    expect(c.currentPieceKey, "back to Sofa A").toBe("SofaA")
    expect(cmpBtn.inactive, "Compare active again with Sofa A").toBe(false)
    await tap(it, "MeasureButton")
    await resetState()
    log("C5 done")
  }
}
