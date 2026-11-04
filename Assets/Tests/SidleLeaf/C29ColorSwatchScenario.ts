/**
 * Done criterion 28 (Update 9) — pinching a swatch tints the current piece,
 * "original" restores it exactly, the selected swatch shows a ring, and the
 * tint is not darker than the original.
 *
 * Strip: six round swatches (>= 3 cm, >= 1.5 cm gaps at 100%), "original" first
 * (with an icon), every face at least mid-tone (WCAG luminance >= 0.35).
 * Tint: for every sofa variant (built-in boxes and every imported sofa in the
 * catalog), real pinches on each swatch; the test reads the actual material
 * colours under the piece's visual and checks them independently
 * (SidleTestHelpers.tintProblem): flat colours keep at least their luminance
 * and take the swatch's hue; glTF materials are not darker for a white or a
 * black texel (so for no neutral texel) and add the swatch's hue. Swatch
 * pinches never move the piece or change Measure.
 */
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {RoundButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton"
import {SidleController} from "../../Scripts/SidleController"
import {
  bundledCatalog,
  expectedOffer,
  findChild,
  log,
  meshBounds,
  obj,
  panelObj,
  readMaterials,
  resetState,
  sameMaterials,
  srgbLum,
  SWATCH_NAMES,
  swatchFaceColor,
  tap,
  tintProblem,
} from "./SidleTestHelpers"

function ringsShown(): number[] {
  const out: number[] = []
  for (let i = 0; i < SWATCH_NAMES.length; i++) if (findChild(obj(`ColorSwatch_${i}`), "SwatchRing").enabled) out.push(i)
  return out
}

function state(c: SidleController): string {
  return JSON.stringify({p: c.piecePosition, r: c.rotationDeg, m: c.measureOn, k: c.currentPieceKey})
}

@component
export class C29ColorSwatchScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1000)
    const c = await resetState()
    const it = new DefaultLeafInteractor("C29Interactor")
    const offer = expectedOffer(bundledCatalog(), true)

    // ── The strip ──────────────────────────────────────────────────────────────
    const strip = obj("ColorStrip")
    expect(strip.getParent() === panelObj(c), "strip is part of the panel (follows it)").toBe(true)
    expect(JSON.stringify(c.colorSwatchNames), "swatch order").toBe(JSON.stringify(SWATCH_NAMES))
    const centres: number[] = []
    const widths: number[] = []
    for (let i = 0; i < SWATCH_NAMES.length; i++) {
      const so = obj(`ColorSwatch_${i}`)
      expect(so.getParent() === strip, `ColorSwatch_${i} on the strip`).toBe(true)
      expect(!!so.getComponent(RoundButton.getTypeName()), `ColorSwatch_${i} is a round UIKit button`).toBe(true)
      const b = meshBounds(so, so)!
      const w = (b.max.x - b.min.x) * so.getTransform().getWorldScale().x
      widths.push(w)
      centres.push(so.getTransform().getWorldPosition().sub(strip.getTransform().getWorldPosition()).dot(strip.getTransform().right))
      const face = swatchFaceColor(i)
      log(`swatch ${i} ${SWATCH_NAMES[i]}: ${w.toFixed(2)} cm, face ${face} L ${srgbLum(face).toFixed(3)}`)
      expect(w >= 3 - 0.01, `${SWATCH_NAMES[i]} swatch ${w.toFixed(2)} cm wide (>= 3)`).toBe(true)
      expect(srgbLum(face) >= 0.35, `${SWATCH_NAMES[i]} face at least mid-tone (L ${srgbLum(face).toFixed(3)})`).toBe(true)
    }
    for (let i = 1; i < centres.length; i++) {
      const gap = centres[i] - centres[i - 1] - (widths[i] + widths[i - 1]) / 2
      expect(gap >= 1.5 - 0.01, `gap ${i - 1}-${i}: ${gap.toFixed(2)} cm (>= 1.5)`).toBe(true)
    }
    expect(!!findChild(obj("ColorSwatch_0"), "OriginalIcon"), "the original swatch has its icon").toBe(true)
    expect(JSON.stringify(ringsShown()), "ring on original at the start").toBe("[0]")
    expect(c.currentColorIndex, "starts at original").toBe(0)

    // ── Every sofa variant: each swatch, then original ─────────────────────────
    const sofas = offer.find((t) => t.type === "sofa")!.variants
    for (const v of sofas) {
      if (c.currentPieceKey !== v.key) {
        c.openGallery()
        c.selectFromGallery(v.key)
      }
      await sleep(50)
      const visual = obj(`Piece_${v.key}`)
      const orig = readMaterials(visual)
      expect(orig.length > 0, `${v.key}: has materials`).toBe(true)
      const before = state(c)
      const summary: string[] = []
      for (let i = 1; i < SWATCH_NAMES.length; i++) {
        await tap(it, `ColorSwatch_${i}`)
        expect(c.currentColorIndex, `${v.key}: ${SWATCH_NAMES[i]} selected`).toBe(i)
        expect(JSON.stringify(ringsShown()), `${v.key}: ring on ${SWATCH_NAMES[i]} only`).toBe(`[${i}]`)
        const now = readMaterials(visual)
        expect(sameMaterials(now, orig), `${v.key}: ${SWATCH_NAMES[i]} changed the materials`).toBe(false)
        const face = swatchFaceColor(i)
        for (let m = 0; m < now.length; m++) {
          const problem = tintProblem(orig[m], now[m], face)
          expect(problem, `${v.key} material ${m} (${now[m].kind}) with ${SWATCH_NAMES[i]}`).toBe("")
        }
        summary.push(`${SWATCH_NAMES[i]} ok`)
      }
      await tap(it, "ColorSwatch_0")
      expect(c.currentColorIndex, `${v.key}: original selected`).toBe(0)
      expect(JSON.stringify(ringsShown()), `${v.key}: ring on original`).toBe("[0]")
      expect(sameMaterials(readMaterials(visual), orig), `${v.key}: original restores the materials exactly`).toBe(true)
      expect(state(c), `${v.key}: swatches never move the piece or change Measure`).toBe(before)
      log(`${v.key} (${orig.length} materials, ${orig[0].kind}): ${summary.join(", ")}, original restored`)
    }

    // API: unknown index is refused.
    expect(c.setColor(6), "setColor(6) refused").toBe(false)
    expect(c.setColor(-1), "setColor(-1) refused").toBe(false)
    expect(c.currentColorIndex, "still original").toBe(0)

    await resetState()
    log("C29 done")
  }
}
