/**
 * SidleColorStripUI — the fabric colour strip under the control panel (passive view, Update 9).
 *
 * Owns (runtime children, stable names for tests): a UIKit BackPlate strip
 * with six round UIKit buttons ColorSwatch_0 .. ColorSwatch_5 (0 = "original",
 * with an icon), each with a coloured round face (SwatchFace) and a ring
 * (SwatchRing) that shows only on the selected swatch.
 *
 * Main -> UI: build(swatches, placeBelowY) once, setSelected(index).
 * UI -> Main: onSwatch(index).
 *
 * It is created by SidleController as a child of the panel, so it follows the
 * panel's offset, scale and visibility (hidden with the panel while the
 * gallery is open). Must not: hold state or make decisions.
 */
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {RoundButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {Swatch} from "./SidleTint"

const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material
const ICON_ORIGINAL = requireAsset("../Icons/format_color_reset.png") as Texture

const FACE_Z = 0.12

@component
export class SidleColorStripUI extends BaseScriptComponent {
  /** Swatch diameter, cm (brief: at least 3). */
  swatchSize = 3.4
  /** Gap between swatches, cm (brief: at least 1.5). */
  swatchGap = 1.5
  padding = 1.0
  /** Gap between the panel's bottom edge and the strip, cm. */
  gapBelowPanel = 1.0

  private _onSwatch = new Event<number>()
  get onSwatch(): PublicApi<number> {
    return this._onSwatch.publicApi()
  }

  private rings: SceneObject[] = []
  private selected = 0

  /** Build the strip with its top edge `gapBelowPanel` under `panelBottomY` (the panel's local frame). */
  build(swatches: Swatch[], panelBottomY: number): void {
    if (this.rings.length) return
    const n = swatches.length
    const s = this.swatchSize
    const w = n * s + (n - 1) * this.swatchGap + 2 * this.padding
    const h = s + 2 * this.padding
    this.sceneObject.getTransform().setLocalPosition(new vec3(0, panelBottomY - this.gapBelowPanel - h / 2, 0))

    const plateObj = this.obj(this.sceneObject, "ColorStripPlate", new vec3(0, 0, 0))
    plateObj.createComponent("Component.Canvas")
    const plate = plateObj.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.size = new vec2(w, h)

    for (let i = 0; i < n; i++) {
      const x = -w / 2 + this.padding + s / 2 + i * (s + this.swatchGap)
      const so = this.obj(this.sceneObject, `ColorSwatch_${i}`, new vec3(x, 0, 0.6))
      const btn = so.createComponent(RoundButton.getTypeName()) as RoundButton
      btn.width = s
      btn.size = new vec3(s, s, 1)

      // Selection ring just outside the face
      const ring = this.obj(so, "SwatchRing", new vec3(0, 0, FACE_Z - 0.02))
      const rr = ring.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
      rr.size = new vec2(s * 0.92, s * 0.92)
      rr.cornerRadius = s * 0.46
      rr.backgroundColor = new vec4(0, 0, 0, 0)
      rr.border = true
      rr.borderSize = 0.28
      rr.borderColor = new vec4(1, 1, 1, 1)
      ring.enabled = i === this.selected
      this.rings.push(ring)

      // Coloured face
      const face = this.obj(so, "SwatchFace", new vec3(0, 0, FACE_Z))
      const fr = face.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
      const d = s * 0.66
      fr.size = new vec2(d, d)
      fr.cornerRadius = d / 2
      const c = swatches[i].face
      fr.backgroundColor = new vec4(c[0], c[1], c[2], 1)

      if (!swatches[i].color) {
        const icon = this.obj(face, "OriginalIcon", new vec3(0, 0, 0.02))
        const img = icon.createComponent("Component.Image") as Image
        const mat = imageMaterial.clone()
        mat.mainPass.baseTex = ICON_ORIGINAL
        mat.mainPass.depthTest = true
        mat.mainPass.depthWrite = false
        img.clearMaterials()
        img.addMaterial(mat)
        icon.getTransform().setLocalScale(new vec3(d * 0.7, d * 0.7, 1))
      }

      btn.onTriggerUp.add(() => this._onSwatch.invoke(i))
    }
  }

  /** Ring on the selected swatch only. */
  setSelected(index: number): void {
    this.selected = index
    for (let i = 0; i < this.rings.length; i++) {
      if (this.rings[i].enabled !== (i === index)) this.rings[i].enabled = i === index
    }
  }

  private obj(parent: SceneObject, name: string, position: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.getTransform().setLocalPosition(position)
    return so
  }
}
