/**
 * Done criterion 8 — the panel shows the piece name for every piece, and the
 * source domain plus width × depth × height in cm only for imported pieces
 * (PieceDetailLabel hidden and empty for Sofa A, Sofa B, Bed, Dining table).
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {BUILT_INS, bundledCatalog, expectedOffer, goTo, log, obj, offeredKeys, panelText, resetState, tap} from "./SidleTestHelpers"

function expectBuiltIn(c: SidleController, name: string): void {
  expect(panelText("PieceNameLabel"), "panel name").toBe(name)
  const detail = obj("PieceDetailLabel")
  const t = panelText("PieceDetailLabel")
  expect(detail.enabled && t !== "", `${name}: no source/dimensions line (enabled=${detail.enabled}, text="${t}")`).toBe(false)
  expect(c.currentPieceDomain, `${name}: no domain`).toBe("")
}

@component
export class C8PanelSourceScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C8Interactor")
    const cat = bundledCatalog()

    // Update 2: visit every piece in Next/Compare order (built-ins sit among the imported ones).
    const offer = expectedOffer(cat, true)
    const builtIns = BUILT_INS.map((b) => b.key)
    expectBuiltIn(c, "Sofa A")
    for (const key of offeredKeys(offer)) {
      await goTo(it, c, offer, key)
      const b = BUILT_INS.find((x) => x.key === key)
      if (b) {
        expectBuiltIn(c, b.name)
        builtIns.splice(builtIns.indexOf(key), 1)
        continue
      }
      const e = cat.find((x) => `Imported_${x.id}` === key)
      const t = panelText("PieceDetailLabel")
      log(`${e.id}: panel "${panelText("PieceNameLabel")}" / "${t}"`)
      expect(panelText("PieceNameLabel"), `${e.id}: name`).toBe(e.name)
      expect(obj("PieceDetailLabel").enabled, `${e.id}: detail line visible`).toBe(true)
      expect(t.includes(e.domain), `${e.id}: shows domain ${e.domain}`).toBe(true)
      const dims = `${Math.round(e.widthCm)} × ${Math.round(e.depthCm)} × ${Math.round(e.heightCm)} cm`
      expect(t.includes(dims), `${e.id}: shows "${dims}"`).toBe(true)
    }
    expect(builtIns.join(","), "every built-in piece was checked").toBe("")

    await tap(it, "NextButton")
    expectBuiltIn(c, "Sofa A")
    await resetState()
    log("C8 done")
  }
}
