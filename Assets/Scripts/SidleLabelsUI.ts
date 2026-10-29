/**
 * SidleLabelsUI — world-space labels next to the piece (passive view).
 *
 * Owns (runtime children, stable names for tests):
 *   DimensionLabels/ WidthLabel, DepthLabel, HeightLabel — upright light text
 *     (~8 cm glyphs) on a mid-tone UIKit BackPlate, e.g. "W 220 cm".
 *   GapLabel — flat on the floor, e.g. "62 cm", with an alpha for fade-out.
 *
 * Main -> UI: setDimensions, setDimensionsVisible, placeDimensionLabel,
 *             setGap, setGapVisible.
 * Positions passed in are local to this SceneObject (which sits at the
 * VirtualRoom floor origin).
 *
 * Must not: compute clearance or decide visibility (SidleController does).
 */
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"

const LABEL_TEXT_SIZE = 100 // em-square ≈ 2.28 cm before labelScale

@component
export class SidleLabelsUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SidleLabelsUI – dimension + gap labels</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Uniform scale for the dimension labels (4.5 ≈ 8 cm tall digits)")
  @widget(new SliderWidget(1, 8, 0.1))
  labelScale: number = 4.5

  @input
  @hint("Uniform scale for the floor gap number")
  @widget(new SliderWidget(1, 10, 0.1))
  gapScale: number = 5.5

  @input("vec4", "{0.96, 0.96, 0.96, 1.0}")
  @hint("Dimension label text color (keep light — dark renders transparent on Specs)")
  @widget(new ColorWidget())
  labelColor: vec4 = new vec4(0.96, 0.96, 0.96, 1.0)

  @input("vec4", "{0.42, 0.44, 0.48, 1.0}")
  @hint("Mid-tone backing plate color behind the dimension text")
  @widget(new ColorWidget())
  backingColor: vec4 = new vec4(0.42, 0.44, 0.48, 1.0)

  @input("vec4", "{1.0, 0.55, 0.5, 1.0}")
  @hint("Gap number color")
  @widget(new ColorWidget())
  gapColor: vec4 = new vec4(1.0, 0.55, 0.5, 1.0)
  @ui.group_end

  private dimRoot: SceneObject | null = null
  private dimObjs: SceneObject[] = []
  private dimTexts: Text[] = []
  private gapObj: SceneObject | null = null
  private gapText: Text | null = null

  onAwake() {
    this.build()
  }

  // ── Public view API ────────────────────────────────────────────────────────
  setDimensions(w: number, d: number, h: number): void {
    const vals = [`W ${Math.round(w)} cm`, `D ${Math.round(d)} cm`, `H ${Math.round(h)} cm`]
    for (let i = 0; i < this.dimTexts.length; i++) this.dimTexts[i].text = vals[i]
  }

  setDimensionsVisible(visible: boolean): void {
    if (this.dimRoot) this.dimRoot.enabled = visible
  }

  /** index 0 = width, 1 = depth, 2 = height. yawRad faces the label toward the viewer. */
  placeDimensionLabel(index: number, localPos: vec3, yawRad: number): void {
    const so = this.dimObjs[index]
    if (!so) return
    const t = so.getTransform()
    t.setLocalPosition(localPos)
    t.setLocalRotation(quat.angleAxis(yawRad, vec3.up()))
  }

  /** Floor gap number. yawRad orients the text so it reads from the viewer. */
  setGap(text: string, localPos: vec3, yawRad: number, alpha: number): void {
    if (!this.gapObj || !this.gapText) return
    this.gapText.text = text
    const c = this.gapColor
    this.gapText.textFill.color = new vec4(c.x, c.y, c.z, c.w * Math.max(0, Math.min(1, alpha)))
    const t = this.gapObj.getTransform()
    t.setLocalPosition(localPos)
    t.setLocalRotation(quat.angleAxis(yawRad, vec3.up()).multiply(quat.angleAxis(-Math.PI / 2, vec3.right())))
  }

  setGapVisible(visible: boolean): void {
    if (this.gapObj) this.gapObj.enabled = visible
  }

  // ── Build ──────────────────────────────────────────────────────────────────
  private build(): void {
    this.dimRoot = global.scene.createSceneObject("DimensionLabels")
    this.dimRoot.setParent(this.sceneObject)
    const names = ["WidthLabel", "DepthLabel", "HeightLabel"]
    const initial = ["W 220 cm", "D 90 cm", "H 85 cm"]
    for (let i = 0; i < 3; i++) {
      const so = global.scene.createSceneObject(names[i])
      so.setParent(this.dimRoot)
      so.getTransform().setLocalScale(new vec3(this.labelScale, this.labelScale, this.labelScale))

      // Each label is a tiny panel: Canvas → BackPlate (first) → Content (after, +Z)
      const panel = global.scene.createSceneObject("Panel")
      panel.setParent(so)
      panel.createComponent("Component.Canvas")
      const plate = panel.createComponent(BackPlate.getTypeName()) as BackPlate
      plate.size = new vec2(12.5, 3.6)
      plate.onInitialized.add(() => {
        // "simple" = solid fill; tint it to a mid tone (UIKit's own presets are near-black,
        // which disappears on the additive Specs display).
        plate.style = "simple"
        const rr = panel.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle | null
        if (rr) rr.backgroundColor = this.backingColor
      })

      const content = global.scene.createSceneObject("Content")
      content.setParent(panel)
      content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))
      const t = content.createComponent("Component.Text") as Text
      t.text = initial[i]
      t.depthTest = true
      t.size = LABEL_TEXT_SIZE
      ;(t as Text & {weight?: number}).weight = 700
      t.horizontalAlignment = HorizontalAlignment.Center
      t.verticalAlignment = VerticalAlignment.Center
      t.horizontalOverflow = HorizontalOverflow.Overflow
      t.verticalOverflow = VerticalOverflow.Overflow
      t.layoutRect = Rect.create(-6, 6, -1.6, 1.6)
      t.textFill.color = this.labelColor
      this.dimObjs.push(so)
      this.dimTexts.push(t)
    }
    this.dimRoot.enabled = false

    this.gapObj = global.scene.createSceneObject("GapLabel")
    this.gapObj.setParent(this.sceneObject)
    const gapInner = global.scene.createSceneObject("Text")
    gapInner.setParent(this.gapObj)
    gapInner.getTransform().setLocalScale(new vec3(this.gapScale, this.gapScale, this.gapScale))
    const g = gapInner.createComponent("Component.Text") as Text
    g.text = "80 cm"
    g.depthTest = true
    g.size = LABEL_TEXT_SIZE
    ;(g as Text & {weight?: number}).weight = 700
    g.horizontalAlignment = HorizontalAlignment.Center
    g.verticalAlignment = VerticalAlignment.Center
    g.horizontalOverflow = HorizontalOverflow.Overflow
    g.verticalOverflow = VerticalOverflow.Overflow
    g.layoutRect = Rect.create(-5, 5, -1.6, 1.6)
    g.textFill.color = this.gapColor
    this.gapText = g
    this.gapObj.enabled = false
  }
}
