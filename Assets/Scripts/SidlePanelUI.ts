/**
 * SidlePanelUI — the Sidle control panel (passive view).
 *
 * Owns: a UIKit BackPlate panel with a header row (current piece name +
 * "piece is behind you" arrow) and a row of five UIKit Buttons:
 *   NextButton, CompareButton, MeasureButton, RotateLeftButton, RotateRightButton
 * (those are the runtime SceneObject names, stable for tests).
 *
 * Main -> UI: setPieceName, setCompareEnabled, setMeasureOn, setBehindArrow.
 * UI -> Main: onNext, onCompare, onMeasure, onRotateLeft, onRotateRight.
 *
 * Must not: hold domain state or make decisions (SidleController owns state).
 * Positioning/follow is done by SidleLazyFollow on the same SceneObject.
 */
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexAlign, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"

const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material
const ICON_NEXT = requireAsset("../Icons/skip_next.png") as Texture
const ICON_COMPARE = requireAsset("../Icons/compare_arrows.png") as Texture
const ICON_MEASURE = requireAsset("../Icons/straighten.png") as Texture
const ICON_ROT_L = requireAsset("../Icons/rotate_left.png") as Texture
const ICON_ROT_R = requireAsset("../Icons/rotate_right.png") as Texture
const ICON_ARROW = requireAsset("../Icons/arrow_upward.png") as Texture

// ── Typography (type scale; panel sits ~100 cm away) ─────────────────────────
const FONT_SIZE_SCALE = 1.0
type TextRole = "Headline2" | "Subheadline" | "Button" | "Body" | "Caption"
const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Headline2: {size: 48, weight: 700},
  Subheadline: {size: 41, weight: 700},
  Button: {size: 39, weight: 500},
  Body: {size: 39, weight: 500},
  Caption: {size: 38, weight: 500},
}
function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}
function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

const LAYOUT_Z_LIFT = 0.02
const BUTTON_FACE_Z = 0.08

@component
export class SidlePanelUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SidlePanelUI – control panel view</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Button width in cm (brief: about 6 cm)")
  @widget(new SliderWidget(4, 10, 0.1))
  buttonWidth: number = 6.4

  @input
  @hint("Button height in cm")
  @widget(new SliderWidget(4, 10, 0.1))
  buttonHeight: number = 6.0

  @input
  @hint("Gap between buttons in cm (brief: about 2 cm)")
  @widget(new SliderWidget(0.5, 4, 0.1))
  buttonGap: number = 2.0

  @input
  @hint("Panel padding in cm")
  @widget(new SliderWidget(0.5, 4, 0.1))
  padding: number = 1.6

  @input
  @hint("Icon size inside each button, in cm")
  @widget(new SliderWidget(1, 4, 0.1))
  iconSize: number = 2.4

  @input("vec4", "{1.0, 0.82, 0.45, 1.0}")
  @hint("Color of the 'piece is behind you' arrow")
  @widget(new ColorWidget())
  arrowColor: vec4 = new vec4(1.0, 0.82, 0.45, 1.0)
  @ui.group_end

  private _onNext = new Event<void>()
  private _onCompare = new Event<void>()
  private _onMeasure = new Event<void>()
  private _onRotateLeft = new Event<void>()
  private _onRotateRight = new Event<void>()
  get onNext(): PublicApi<void> {
    return this._onNext.publicApi()
  }
  get onCompare(): PublicApi<void> {
    return this._onCompare.publicApi()
  }
  get onMeasure(): PublicApi<void> {
    return this._onMeasure.publicApi()
  }
  get onRotateLeft(): PublicApi<void> {
    return this._onRotateLeft.publicApi()
  }
  get onRotateRight(): PublicApi<void> {
    return this._onRotateRight.publicApi()
  }

  private nameText: Text | null = null
  private arrowObj: SceneObject | null = null
  private compareButton: Button | null = null
  private measureButton: Button | null = null
  private pendingCompareEnabled = true
  private pendingMeasureOn = false

  onAwake() {
    this.build()
  }

  // ── Public view API ────────────────────────────────────────────────────────
  setPieceName(name: string): void {
    if (this.nameText) this.nameText.text = name
  }

  setCompareEnabled(enabled: boolean): void {
    this.pendingCompareEnabled = enabled
    if (this.compareButton) this.compareButton.inactive = !enabled
  }

  setMeasureOn(on: boolean): void {
    this.pendingMeasureOn = on
    if (this.measureButton && this.measureButton.isOn !== on) this.measureButton.isOn = on
  }

  /** angleDeg: in-plane rotation of an up-pointing arrow (0 = up/ahead, +CCW). */
  setBehindArrow(visible: boolean, angleDeg: number): void {
    if (!this.arrowObj) return
    this.arrowObj.enabled = visible
    if (visible) {
      this.arrowObj.getTransform().setLocalRotation(quat.angleAxis((angleDeg * Math.PI) / 180, vec3.forward()))
    }
  }

  // ── Build ──────────────────────────────────────────────────────────────────
  private build(): void {
    const n = 5
    const rowW = n * this.buttonWidth + (n - 1) * this.buttonGap
    const headerH = 3.2
    const panelW = rowW + this.padding * 2
    const panelH = headerH + this.buttonHeight + this.padding * 2 + 1.0

    this.sceneObject.createComponent("Component.Canvas")
    const plate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.size = new vec2(panelW, panelH)

    const content = this.obj(this.sceneObject, "Content", new vec3(0, 0, 0.6))
    const col = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    col.width = panelW
    col.height = panelH
    col.direction = FlexDirection.Column
    col.alignItems = FlexAlign.Center
    col.justifyContent = FlexJustify.Center
    col.rowGap = 1.0
    col.paddingTop = this.padding
    col.paddingBottom = this.padding
    col.paddingLeft = this.padding
    col.paddingRight = this.padding

    // Header row: piece name + behind-you arrow
    this.flexChild(content, {w: rowW, h: headerH}, (header) => {
      const row = header.createComponent(FlexLayout.getTypeName()) as FlexLayout
      row.width = rowW
      row.height = headerH
      row.direction = FlexDirection.Row
      row.alignItems = FlexAlign.Center
      row.justifyContent = FlexJustify.Center
      row.columnGap = 1.0

      this.flexChild(header, {w: rowW - headerH - 1.0, h: headerH}, (nameCell) => {
        const t = nameCell.createComponent("Component.Text") as Text
        t.text = "Sofa A"
        t.depthTest = true
        applyTextRole(t, "Subheadline", 100)
        t.horizontalAlignment = HorizontalAlignment.Left
        t.verticalAlignment = VerticalAlignment.Center
        t.horizontalOverflow = HorizontalOverflow.Overflow
        t.verticalOverflow = VerticalOverflow.Overflow
        const w = rowW - headerH - 1.0
        t.layoutRect = Rect.create(-w / 2, w / 2, -headerH / 2, headerH / 2)
        t.textFill.color = new vec4(1, 1, 1, 0.9)
        nameCell.name = "PieceNameLabel"
        this.nameText = t
      })
      this.flexChild(header, {w: headerH, h: headerH}, (arrowCell) => {
        arrowCell.name = "BehindArrowCell"
        const arrow = this.obj(arrowCell, "BehindArrow")
        const img = arrow.createComponent("Component.Image") as Image
        const mat = imageMaterial.clone()
        mat.mainPass.baseTex = ICON_ARROW
        mat.mainPass.baseColor = this.arrowColor
        mat.mainPass.depthTest = true
        mat.mainPass.depthWrite = false
        img.clearMaterials()
        img.addMaterial(mat)
        arrow.getTransform().setLocalScale(new vec3(headerH * 0.9, headerH * 0.9, 1))
        arrow.enabled = false
        this.arrowObj = arrow
      })
    })

    // Button row
    this.flexChild(content, {w: rowW, h: this.buttonHeight}, (rowObj) => {
      const row = rowObj.createComponent(FlexLayout.getTypeName()) as FlexLayout
      row.width = rowW
      row.height = this.buttonHeight
      row.direction = FlexDirection.Row
      row.alignItems = FlexAlign.Center
      row.justifyContent = FlexJustify.Center
      row.columnGap = this.buttonGap

      this.addButton(rowObj, "NextButton", "Next piece", ICON_NEXT, () => this._onNext.invoke())
      this.compareButton = this.addButton(rowObj, "CompareButton", "Compare", ICON_COMPARE, () =>
        this._onCompare.invoke(),
      )
      this.measureButton = this.addButton(rowObj, "MeasureButton", "Measure", ICON_MEASURE, () =>
        this._onMeasure.invoke(),
      )
      this.measureButton.setIsToggleable(true)
      this.addButton(rowObj, "RotateLeftButton", "Rotate left", ICON_ROT_L, () => this._onRotateLeft.invoke())
      this.addButton(rowObj, "RotateRightButton", "Rotate right", ICON_ROT_R, () => this._onRotateRight.invoke())
    })

    this.compareButton!.inactive = !this.pendingCompareEnabled
    this.measureButton!.isOn = this.pendingMeasureOn
  }

  private addButton(parent: SceneObject, name: string, label: string, icon: Texture, onClick: () => void): Button {
    const so = this.obj(parent, name)
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(this.buttonWidth, this.buttonHeight, 1)

    // Face content: icon above caption, in front of the button face
    const face = this.obj(so, "Face", new vec3(0, 0, BUTTON_FACE_Z))
    const iconSO = this.obj(face, "Icon", new vec3(0, this.buttonHeight * 0.16, 0))
    const img = iconSO.createComponent("Component.Image") as Image
    const mat = imageMaterial.clone()
    mat.mainPass.baseTex = icon
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
    iconSO.getTransform().setLocalScale(new vec3(this.iconSize, this.iconSize, 1))

    const capSO = this.obj(face, "Caption", new vec3(0, -this.buttonHeight * 0.3, 0))
    const t = capSO.createComponent("Component.Text") as Text
    t.text = label
    t.depthTest = true
    applyTextRole(t, "Caption", 85)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    const w = this.buttonWidth - 0.4
    t.layoutRect = Rect.create(-w / 2, w / 2, -0.8, 0.8)

    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    item.overrideWidth = this.buttonWidth
    item.overrideHeight = this.buttonHeight
    item.flexShrink = 0
    this.register(parent, item)

    btn.onTriggerUp.add(() => {
      if (btn.inactive) return
      onClick()
    })
    return btn
  }

  // ── Layout helpers ─────────────────────────────────────────────────────────
  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (position) so.getTransform().setLocalPosition(position)
    return so
  }

  private flexChild(
    parent: SceneObject,
    size: {w?: number; h?: number; grow?: number},
    builder: (child: SceneObject) => void,
  ): SceneObject {
    const child = this.obj(parent, "Item", new vec3(0, 0, LAYOUT_Z_LIFT))
    const item = child.createComponent(FlexItem.getTypeName()) as FlexItem
    if (size.w !== undefined && size.w > 0) item.overrideWidth = size.w
    if (size.h !== undefined && size.h > 0) item.overrideHeight = size.h
    item.flexGrow = size.grow ?? 0
    item.flexShrink = 0
    builder(child)
    this.register(parent, item)
    return child
  }

  /** Register a FlexItem with its parent layout. Before the layout initializes,
   *  autoDiscoverItemsOnStart picks children up on start (addItems would throw). */
  private register(parent: SceneObject, item: FlexItem): void {
    const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (!parentFlex) return
    if (parentFlex.autoDiscoverItemsOnStart && !(parentFlex as unknown as {_initialized: boolean})._initialized) return
    parentFlex.addItems([item])
  }
}
