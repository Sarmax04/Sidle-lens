/**
 * Done criterion 6 (Update 2) — imported pieces appear as variants of their
 * type (catalog category) after the built-ins, in catalog order. Every piece is
 * reached with real NextButton/CompareButton pinches; each keeps the spot and
 * facing, only the current piece is enabled and the panel shows its name.
 * Also: an entry with enabled:false is skipped.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {SidleController} from "../../Scripts/SidleController"
import {bundledCatalog, expectedOffer, ExpectedType, log, obj, offeredKeys, panelText, resetState, tap} from "./SidleTestHelpers"

/** Imported keys of `type`, straight from the catalog in its order. */
function importedOfType(cat: any[], type: string): string[] {
  return cat.filter((e) => String(e.category).trim().toLowerCase() === type).map((e) => `Imported_${e.id}`)
}

function checkOffer(c: SidleController, cat: any[], offer: ExpectedType[]): void {
  expect(c.availableTypes.join(","), "controller types").toBe(offer.map((t) => t.type).join(","))
  for (const t of offer) {
    const keys = c.variantKeys(t.type)
    expect(keys.join(","), `${t.type}: variant order`).toBe(t.variants.map((v) => v.key).join(","))
    const imported = keys.filter((k) => k.indexOf("Imported_") === 0)
    expect(imported.join(","), `${t.type}: imported variants in catalog order`).toBe(importedOfType(cat, t.type).join(","))
    expect(keys.slice(0, keys.length - imported.length).every((k) => k.indexOf("Imported_") < 0), `${t.type}: built-ins first`).toBe(true)
  }
  expect(c.importedPieceKeys.join(","), "imported pieces").toBe(cat.map((e) => `Imported_${e.id}`).join(","))
}

/** Visit every offered piece via buttons, starting at Sofa A, and end back on Sofa A. */
async function walk(it: DefaultLeafInteractor, c: SidleController, offer: ExpectedType[]): Promise<void> {
  const pos = c.piecePosition
  const rot = c.rotationDeg
  const allKeys = offeredKeys(offer)
  expect(c.currentPieceKey, "walk starts at Sofa A").toBe("SofaA")
  for (let ti = 0; ti < offer.length; ti++) {
    for (let vi = 0; vi < offer[ti].variants.length; vi++) {
      if (vi > 0) await tap(it, "CompareButton")
      else if (ti > 0) await tap(it, "NextButton")
      const v = offer[ti].variants[vi]
      expect(c.currentPieceKey, `${offer[ti].type} variant #${vi + 1}`).toBe(v.key)
      expect(c.currentPieceType, `${v.key}: type`).toBe(offer[ti].type)
      for (const k of allKeys) expect(obj(`Piece_${k}`).enabled, `Piece_${k} enabled at ${v.key}`).toBe(k === v.key)
      expect(c.piecePosition.x, `${v.key}: same spot x`).toBeCloseTo(pos.x, 1)
      expect(c.piecePosition.z, `${v.key}: same spot z`).toBeCloseTo(pos.z, 1)
      expect(c.rotationDeg, `${v.key}: same facing`).toBeCloseTo(rot, 1)
      expect(panelText("PieceNameLabel"), `${v.key}: panel name`).toBe(v.name)
    }
  }
  await tap(it, "NextButton")
  expect(c.currentPieceKey, "wraps to Sofa A").toBe("SofaA")
}

@component
export class C6ImportedCycleScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C6Interactor")

    const cat = bundledCatalog()
    expect(cat.length > 0, "bundled catalog has enabled entries").toBe(true)
    const offer = expectedOffer(cat, true)
    log(`expected ${offer.map((t) => `${t.type}[${t.variants.map((v) => v.key).join(",")}]`).join(" ")}`)
    checkOffer(c, cat, offer)

    await tap(it, "RotateLeftButton") // 15° so "same facing" is meaningful
    await walk(it, c, offer)

    // enabled:false entries are skipped (catalog swapped through the test hook)
    const raw = JSON.parse(JSON.stringify(cat))
    raw[1].enabled = false
    c.loadCatalogText(JSON.stringify(raw))
    await sleep(100)
    const kept = cat.filter((_, i) => i !== 1)
    const offer2 = expectedOffer(kept, true)
    expect(offeredKeys(offer2).indexOf(`Imported_${raw[1].id}`), "disabled entry not expected").toBe(-1)
    checkOffer(c, kept, offer2)
    await walk(it, c, offer2)

    c.loadCatalogText(null) // back to the bundled catalog
    checkOffer(c, cat, offer)
    await resetState()
    log("C6 done")
  }
}
