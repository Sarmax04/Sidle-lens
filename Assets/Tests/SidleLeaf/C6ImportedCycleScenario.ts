/**
 * Done criterion 6 — pinch NextButton: Sofa A, Bed, Dining table, then every
 * enabled catalog piece in catalog order, then back to Sofa A. Each piece keeps
 * the spot and facing; only the current piece is enabled; Compare is greyed out
 * for imported pieces. Also: an entry with enabled:false is skipped.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {SidleController} from "../../Scripts/SidleController"
import {bundledCatalog, log, obj, panelText, resetState, tap} from "./SidleTestHelpers"

async function cycleOnce(it: DefaultLeafInteractor, c: SidleController, expected: string[], names: string[]): Promise<void> {
  const pos = c.piecePosition
  const rot = c.rotationDeg
  const cmp = obj("CompareButton").getComponent(Button.getTypeName()) as Button
  expect(c.currentPieceKey, "cycle starts at Sofa A").toBe("SofaA")
  for (let i = 1; i <= expected.length; i++) {
    await tap(it, "NextButton")
    const key = expected[i % expected.length]
    expect(c.currentPieceKey, `Next #${i}`).toBe(key)
    for (const k of expected) expect(obj(`Piece_${k}`).enabled, `Piece_${k} enabled after Next #${i}`).toBe(k === key)
    expect(c.piecePosition.x, `${key}: same spot x`).toBeCloseTo(pos.x, 1)
    expect(c.piecePosition.z, `${key}: same spot z`).toBeCloseTo(pos.z, 1)
    expect(c.rotationDeg, `${key}: same facing`).toBeCloseTo(rot, 1)
    expect(panelText("PieceNameLabel"), `${key}: panel name`).toBe(names[i % expected.length])
    if (key.indexOf("Imported_") === 0) {
      expect(c.compareEnabled, `${key}: compare disabled`).toBe(false)
      expect(cmp.inactive, `${key}: CompareButton greyed out`).toBe(true)
      c.compare()
      expect(c.currentPieceKey, `${key}: compare() is a no-op`).toBe(key)
    }
  }
}

@component
export class C6ImportedCycleScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C6Interactor")

    const cat = bundledCatalog()
    expect(cat.length > 0, "bundled catalog has enabled entries").toBe(true)
    const expected = ["SofaA", "Bed", "DiningTable"].concat(cat.map((e) => `Imported_${e.id}`))
    const names = ["Sofa A", "Bed", "Dining table"].concat(cat.map((e) => e.name))
    log(`expected cycle ${expected.join(" -> ")}`)
    expect(c.pieceCycle.join(","), "controller cycle").toBe(expected.join(","))

    await tap(it, "RotateLeftButton") // 15° so "same facing" is meaningful
    await cycleOnce(it, c, expected, names)

    // enabled:false entries are skipped (catalog swapped through the test hook)
    const raw = JSON.parse(JSON.stringify(cat))
    raw[1].enabled = false
    c.loadCatalogText(JSON.stringify(raw))
    await sleep(100)
    const skipped = expected.filter((k) => k !== `Imported_${raw[1].id}`)
    expect(c.pieceCycle.join(","), "cycle without the disabled entry").toBe(skipped.join(","))
    await cycleOnce(
      it,
      c,
      skipped,
      names.filter((_, i) => i !== 4),
    )

    c.loadCatalogText(null) // back to the bundled catalog
    expect(c.pieceCycle.join(","), "bundled catalog restored").toBe(expected.join(","))
    await resetState()
    log("C6 done")
  }
}
