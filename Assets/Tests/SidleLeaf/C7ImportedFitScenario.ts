/**
 * Done criterion 7 — every imported piece shows its real model, stands on the
 * floor (bottom at y = 0, centred on the pivot) with its bounding box within
 * 1 cm of the catalog width/depth/height, and the footprint outline, labels and
 * dims match the catalog. Checked at 0° and again after one 15° rotation.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {angDiffDeg, bundledCatalog, log, meshBounds, obj, resetState, tap, textOf, yawOf} from "./SidleTestHelpers"

function checkFit(c: SidleController, e: any, rotDeg: number): void {
  const key = `Imported_${e.id}`
  const root = obj(`Piece_${key}`)
  expect(c.currentPieceKey, "piece").toBe(key)
  expect(root.enabled, `${key} visible`).toBe(true)
  expect(c.modelLoadedFor(key), `${key} uses its model (not the fallback box)`).toBe(true)
  const b = meshBounds(root, obj("Piece"))
  expect(b !== null, `${key} has mesh geometry`).toBe(true)
  const size = b!.max.sub(b!.min)
  log(`${key}: model bbox ${size.x.toFixed(2)} x ${size.z.toFixed(2)} x ${size.y.toFixed(2)} (catalog ${e.widthCm} x ${e.depthCm} x ${e.heightCm}), min y ${b!.min.y.toFixed(3)}`)
  expect(Math.abs(size.x - e.widthCm) <= 1, `${key} width ${size.x} vs ${e.widthCm}`).toBe(true)
  expect(Math.abs(size.z - e.depthCm) <= 1, `${key} depth ${size.z} vs ${e.depthCm}`).toBe(true)
  expect(Math.abs(size.y - e.heightCm) <= 1, `${key} height ${size.y} vs ${e.heightCm}`).toBe(true)
  expect(Math.abs(b!.min.y) <= 0.5, `${key} stands on the floor (min y ${b!.min.y})`).toBe(true)
  expect(Math.abs((b!.min.x + b!.max.x) / 2) <= 0.5, `${key} centred on pivot in x`).toBe(true)
  expect(Math.abs((b!.min.z + b!.max.z) / 2) <= 0.5, `${key} centred on pivot in z`).toBe(true)
  expect(obj("Piece").getTransform().getLocalPosition().y, `${key} piece root on floor`).toBeCloseTo(0, 2)
  expect(angDiffDeg((yawOf(obj("Piece").getTransform()) * 180) / Math.PI, rotDeg) < 0.5, `${key} piece yaw`).toBe(true)

  // Outline, clearance and labels use the catalog dimensions
  expect(JSON.stringify(c.currentDims), `${key} dims`).toBe(JSON.stringify({w: e.widthCm, d: e.depthCm, h: e.heightCm}))
  expect(obj("Edge_Front").getTransform().getLocalScale().x, `${key} outline width`).toBeCloseTo(e.widthCm + 4, 1)
  expect(obj("Edge_Right").getTransform().getLocalScale().z, `${key} outline depth`).toBeCloseTo(e.depthCm + 4, 1)
  expect(obj("Edge_Front").getTransform().getLocalPosition().z, `${key} front edge`).toBeCloseTo(e.depthCm / 2 + 1.25, 1)
  expect(obj("Edge_Right").getTransform().getLocalPosition().x, `${key} right edge`).toBeCloseTo(e.widthCm / 2 + 1.25, 1)
  const fo = obj("FloorOutline").getTransform()
  expect(fo.getLocalPosition().x, `${key} outline x`).toBeCloseTo(c.piecePosition.x, 1)
  expect(fo.getLocalPosition().z, `${key} outline z`).toBeCloseTo(c.piecePosition.z, 1)
  expect(angDiffDeg((yawOf(fo) * 180) / Math.PI, rotDeg) < 0.5, `${key} outline yaw`).toBe(true)
  expect(textOf("WidthLabel"), `${key} width label`).toBe(`W ${Math.round(e.widthCm)} cm`)
  expect(textOf("DepthLabel"), `${key} depth label`).toBe(`D ${Math.round(e.depthCm)} cm`)
  expect(textOf("HeightLabel"), `${key} height label`).toBe(`H ${Math.round(e.heightCm)} cm`)
}

@component
export class C7ImportedFitScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C7Interactor")
    const cat = bundledCatalog()
    await tap(it, "MeasureButton") // labels on so their text can be checked
    await tap(it, "NextButton")
    await tap(it, "NextButton")
    for (const e of cat) {
      await tap(it, "NextButton")
      checkFit(c, e, 0)
      await tap(it, "RotateLeftButton")
      checkFit(c, e, 15)
      await tap(it, "RotateRightButton")
    }
    await tap(it, "MeasureButton")
    await resetState()
    log("C7 done")
  }
}
