/**
 * SidlePanelUI — the Sidle control panel (passive view).
 *
 * Owns: a UIKit BackPlate panel with a header row (current piece name +
 * "piece is behind you" arrow), a detail line (PieceDetailLabel: source domain
 * + dimensions, imported pieces only) and eight UIKit Buttons (Update 6) in
 * two rows of four (one row only when it would fit in 45 cm):
 *   NextButton, CompareButton, MeasureButton, GalleryButton,
 *   RotateLeftButton, RotateRightButton, AddButton, RemoveButton
 * plus a grab bar along the top edge (PanelGrabBar: a light pill with its own
 * collider + SIK Interactable, so pinching it never reaches a button) and, on
 * the grab bar row, PanelSmallerButton ("-") and PanelBiggerButton ("+")
 * (Update 5)
 * (those are the runtime SceneObject names, stable for tests).
 *
 * Main -> UI: setPieceName, setPieceDetail, setCompareEnabled, setAddEnabled,
 *             setRemoveEnabled, setMeasureOn, setBehindArrow,
 *             setGrabBarActive, setPanelScale(scale, canSmaller, canBigger) (uniform
 *             scale of this SceneObject around its centre; SidleLazyFollow only sets
 *             position and rotation).
 * UI -> Main: onNext, onCompare, onMeasure, onRotateLeft, onRotateRight, onGallery,
 *             onAdd, onRemove,
 *             onSmaller, onBigger,
 *             onGrabBarStart(e), onGrabBarUpdate(e), onGrabBarEnd.
 *
 * Must not: hold domain state or make decisions (SidleController owns state).
 * Positioning/follow is done by SidleLazyFollow on the same SceneObject.
 */
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorEvent} from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
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
const ICON_GALLERY = requireAsset("../Icons/grid_view.png") as Texture
const ICON_ADD = requireAsset("../Icons/add.png") as Texture
const ICON_REMOVE = requireAsset("../Icons/delete.png") as Texture

/** Brief (Update 4): if the buttons do not fit in one row this wide (cm, at 1 m), use two rows. */
const MAX_ONE_ROW_WIDTH_CM = 45
/** Brief (Update 6): with eight buttons, two rows of four. */
const MAX_PER_ROW = 4

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

/**
 * Set a UIKit Button's greyed-out state and keep its Interactable in step:
 * when its SceneObject is re-enabled UIKit turns the Interactable back on even
 * if the button is inactive, and setting the same value again does nothing.
 */
export function applyInactive(btn: Button, inactive: boolean): void {
  const inter = btn.getSceneObject().getComponent(Interactable.getTypeName()) as Interactable | null
  if (btn.inactive !== inactive || (inter && inter.enabled === inactive)) {
    btn.inactive = !inactive
    btn.inactive = inactive
  }
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
  @hint("Minimum width of the panel content (name, detail line, buttons) in cm")
  @widget(new SliderWidget(20, 45, 0.5))
  minContentWidth: number = 30

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

  @input
  @hint("Grab bar width in cm (brief: at least 12)")
  @widget(new SliderWidget(12, 24, 0.5))
  grabBarWidth: number = 14

  @input
  @hint("Grab bar height in cm (brief: at least 2.5)")
  @widget(new SliderWidget(2.5, 5, 0.1))
  grabBarHeight: number = 2.5

  @input
  @hint("Size of the '-' / '+' panel size buttons in cm (brief: at least 3)")
  @widget(new SliderWidget(3, 5, 0.1))
  sizeButtonSize: number = 3.2
  @ui.group_end

  private _onNext = new Event<void>()
  private _onCompare = new Event<void>()
  private _onMeasure = new Event<void>()
  private _onRotateLeft = new Event<void>()
  private _onRotateRight = new Event<void>()
  private _onGallery = new Event<void>()
  get onGallery(): PublicApi<void> {
    return this._onGallery.publicApi()
  }
  private _onAdd = new Event<void>()
  private _onRemove = new Event<void>()
  get onAdd(): PublicApi<void> {
    return this._onAdd.publicApi()
  }
  get onRemove(): PublicApi<void> {
    return this._onRemove.publicApi()
  }
  private _onSmaller = new Event<void>()
  private _onBigger = new Event<void>()
  get onSmaller(): PublicApi<void> {
    return this._onSmaller.publicApi()
  }
  get onBigger(): PublicApi<void> {
    return this._onBigger.publicApi()
  }
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
  private _onGrabBarStart = new Event<InteractorEvent>()
  private _onGrabBarUpdate = new Event<InteractorEvent>()
  private _onGrabBarEnd = new Event<void>()
  get onGrabBarStart(): PublicApi<InteractorEvent> {
    return this._onGrabBarStart.publicApi()
  }
  get onGrabBarUpdate(): PublicApi<InteractorEvent> {
    return this._onGrabBarUpdate.publicApi()
  }
  get onGrabBarEnd(): PublicApi<void> {
    return this._onGrabBarEnd.publicApi()
  }

  private nameText: Text | null = null
  private detailText: Text | null = null
  private pendingDetail = ""
  private arrowObj: SceneObject | null = null
  private compareButton: Button | null = null
  private measureButton: Button | null = null
  private pendingCompareEnabled = true
  private addButton_: Button | null = null
  private removeButton: Button | null = null
  private pendingAddEnabled = true
  private pendingRemoveEnabled = false
  private pendingMeasureOn = false
  private grabBarShape: RoundedRectangle | null = null
  private smallerButton: Button | null = null
  private biggerButton: Button | null = null
  private canSmaller = true
  private canBigger = true
  private grabBarHovered = false
  private grabBarActive = false

  onAwake() {
    this.build()
  }

  // ── Public view API ────────────────────────────────────────────────────────
  setPieceName(name: string): void {
    if (this.nameText) this.nameText.text = name
  }

  /** Source domain + dimensions line; "" hides it (built-in pieces). */
  setPieceDetail(detail: string): void {
    this.pendingDetail = detail
    if (!this.detailText) return
    if (this.detailText.text !== detail) this.detailText.text = detail
    this.detailText.getSceneObject().enabled = detail !== ""
  }

  setCompareEnabled(enabled: boolean): void {
    this.pendingCompareEnabled = enabled
    if (this.compareButton) applyInactive(this.compareButton, !enabled)
  }

  /** Add is greyed out when the room holds the maximum number of pieces (Update 6). */
  setAddEnabled(enabled: boolean): void {
    this.pendingAddEnabled = enabled
    if (this.addButton_) applyInactive(this.addButton_, !enabled)
  }

  /** Remove is greyed out when the current piece is the only piece (Update 6). */
  setRemoveEnabled(enabled: boolean): void {
    this.pendingRemoveEnabled = enabled
    if (this.removeButton) applyInactive(this.removeButton, !enabled)
  }

  setMeasureOn(on: boolean): void {
    this.pendingMeasureOn = on
    if (this.measureButton && this.measureButton.isOn !== on) this.measureButton.isOn = on
  }

  /**
   * Panel size (Update 5): uniform scale of the whole panel around its centre
   * (this SceneObject's origin); "-" / "+" greyed out at the ends.
   */
  setPanelScale(scale: number, canSmaller: boolean, canBigger: boolean): void {
    const t = this.sceneObject.getTransform()
    const cur = t.getLocalScale()
    if (Math.abs(cur.x - scale) > 1e-6 || Math.abs(cur.y - scale) > 1e-6 || Math.abs(cur.z - scale) > 1e-6) {
      t.setLocalScale(new vec3(scale, scale, scale))
    }
    this.canSmaller = canSmaller
    this.canBigger = canBigger
    if (this.smallerButton) applyInactive(this.smallerButton, !canSmaller)
    if (this.biggerButton) applyInactive(this.biggerButton, !canBigger)
  }

  /** Grab bar shown as held (brighter) while the panel is being dragged. */
  setGrabBarActive(active: boolean): void {
    this.grabBarActive = active
    this.updateGrabBarColor()
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
    const buttons: [string, string, Texture, () => void][] = [
      ["NextButton", "Next piece", ICON_NEXT, () => this._onNext.invoke()],
      ["CompareButton", "Compare", ICON_COMPARE, () => this._onCompare.invoke()],
      ["MeasureButton", "Measure", ICON_MEASURE, () => this._onMeasure.invoke()],
      ["GalleryButton", "Gallery", ICON_GALLERY, () => this._onGallery.invoke()],
      ["RotateLeftButton", "Rotate left", ICON_ROT_L, () => this._onRotateLeft.invoke()],
      ["RotateRightButton", "Rotate right", ICON_ROT_R, () => this._onRotateRight.invoke()],
      ["AddButton", "Add", ICON_ADD, () => this._onAdd.invoke()],
      ["RemoveButton", "Remove", ICON_REMOVE, () => this._onRemove.invoke()],
    ]
    const n = buttons.length
    const oneRowPanelW = n * this.buttonWidth + (n - 1) * this.buttonGap + this.padding * 2
    const rows = oneRowPanelW > MAX_ONE_ROW_WIDTH_CM ? Math.max(2, Math.ceil(n / MAX_PER_ROW)) : 1
    const perRow = Math.ceil(n / rows)
    const buttonRowW = perRow * this.buttonWidth + (perRow - 1) * this.buttonGap
    const buttonsH = rows * this.buttonHeight + (rows - 1) * this.buttonGap
    const rowW = Math.max(buttonRowW, this.minContentWidth)
    const headerH = 3.2
    const detailH = 2.2
    const panelW = rowW + this.padding * 2
    const panelH = headerH + detailH + buttonsH + this.padding * 2 + 2.0

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
        t.horizontalOverflow = HorizontalOverflow.Shrink // long names shrink instead of running off the panel
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

    // Detail line: source domain + W × D × H (imported pieces only)
    this.flexChild(content, {w: rowW, h: detailH}, (detailCell) => {
      const so = this.obj(detailCell, "PieceDetailLabel")
      const t = so.createComponent("Component.Text") as Text
      t.text = this.pendingDetail
      t.depthTest = true
      applyTextRole(t, "Caption", 100)
      t.horizontalAlignment = HorizontalAlignment.Left
      t.verticalAlignment = VerticalAlignment.Center
      t.horizontalOverflow = HorizontalOverflow.Shrink
      t.verticalOverflow = VerticalOverflow.Overflow
      t.layoutRect = Rect.create(-rowW / 2, rowW / 2, -detailH / 2, detailH / 2)
      t.textFill.color = new vec4(1, 1, 1, 0.75)
      so.enabled = this.pendingDetail !== ""
      this.detailText = t
    })

    // Button rows (ButtonRow1, ButtonRow2 when two rows are needed)
    this.flexChild(content, {w: rowW, h: buttonsH}, (block) => {
      block.name = "Buttons"
      const colLayout = block.createComponent(FlexLayout.getTypeName()) as FlexLayout
      colLayout.width = rowW
      colLayout.height = buttonsH
      colLayout.direction = FlexDirection.Column
      colLayout.alignItems = FlexAlign.Center
      colLayout.justifyContent = FlexJustify.Center
      colLayout.rowGap = this.buttonGap
      for (let r = 0; r < rows; r++) {
        this.flexChild(block, {w: buttonRowW, h: this.buttonHeight}, (rowObj) => {
          rowObj.name = `ButtonRow${r + 1}`
          const row = rowObj.createComponent(FlexLayout.getTypeName()) as FlexLayout
          row.width = buttonRowW
          row.height = this.buttonHeight
          row.direction = FlexDirection.Row
          row.alignItems = FlexAlign.Center
          row.justifyContent = FlexJustify.Center
          row.columnGap = this.buttonGap
          for (const [name, label, icon, cb] of buttons.slice(r * perRow, (r + 1) * perRow)) {
            const b = this.addButton(rowObj, name, label, icon, cb)
            if (name === "CompareButton") this.compareButton = b
            if (name === "AddButton") this.addButton_ = b
            if (name === "RemoveButton") this.removeButton = b
            if (name === "MeasureButton") {
              this.measureButton = b
              b.setIsToggleable(true)
            }
          }
        })
      }
    })

    this.compareButton!.inactive = !this.pendingCompareEnabled
    this.addButton_!.inactive = !this.pendingAddEnabled
    this.removeButton!.inactive = !this.pendingRemoveEnabled
    this.measureButton!.isOn = this.pendingMeasureOn

    this.buildGrabBar(panelH)
  }

  /** Light pill just above the top edge; its own collider + Interactable (no overlap with the buttons). */
  private buildGrabBar(panelH: number): void {
    const w = this.grabBarWidth
    const h = this.grabBarHeight
    const bar = this.obj(this.sceneObject, "PanelGrabBar", new vec3(0, panelH / 2 + 1.0 + h / 2, 0.6))
    const shape = bar.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    shape.size = new vec2(w, h)
    shape.cornerRadius = h / 2
    this.grabBarShape = shape
    this.updateGrabBarColor()

    const collider = bar.createComponent("Physics.ColliderComponent") as ColliderComponent
    const box = Shape.createBoxShape()
    box.size = new vec3(w + 1.0, h + 1.0, 1.5) // a little larger than the pill: easier to pinch
    collider.shape = box
    collider.fitVisual = false

    const inter = bar.createComponent(Interactable.getTypeName()) as Interactable
    inter.onHoverEnter.add(() => {
      this.grabBarHovered = true
      this.updateGrabBarColor()
    })
    inter.onHoverExit.add(() => {
      this.grabBarHovered = false
      this.updateGrabBarColor()
    })
    inter.onTriggerStart.add((e: InteractorEvent) => this._onGrabBarStart.invoke(e))
    inter.onTriggerUpdate.add((e: InteractorEvent) => this._onGrabBarUpdate.invoke(e))
    inter.onTriggerEnd.add(() => this._onGrabBarEnd.invoke())
    inter.onTriggerEndOutside.add(() => this._onGrabBarEnd.invoke())
    inter.onTriggerCanceled.add(() => this._onGrabBarEnd.invoke())

    // "-" and "+" at the ends of the grab bar row, 1.5 cm from the bar (outside its collider)
    const s = this.sizeButtonSize
    const x = w / 2 + 1.5 + s / 2
    const y = panelH / 2 + 1.0 + h / 2
    this.smallerButton = this.sizeButton("PanelSmallerButton", "-", new vec3(-x, y, 0.6), () => this._onSmaller.invoke())
    this.biggerButton = this.sizeButton("PanelBiggerButton", "+", new vec3(x, y, 0.6), () => this._onBigger.invoke())
    this.smallerButton.inactive = !this.canSmaller
    this.biggerButton.inactive = !this.canBigger
  }

  private sizeButton(name: string, label: string, pos: vec3, onClick: () => void): Button {
    const s = this.sizeButtonSize
    const so = this.obj(this.sceneObject, name, pos)
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(s, s, 1)
    const capSO = this.obj(so, "Label", new vec3(0, 0.15, BUTTON_FACE_Z))
    const t = capSO.createComponent("Component.Text") as Text
    t.text = label
    t.depthTest = true
    t.size = 70
    ;(t as Text & {weight?: number}).weight = 700
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-s / 2, s / 2, -s / 2, s / 2)
    t.textFill.color = new vec4(1, 1, 1, 0.95)
    btn.onTriggerUp.add(() => {
      if (btn.inactive) return
      onClick()
    })
    return btn
  }

  private updateGrabBarColor(): void {
    if (!this.grabBarShape) return
    const a = this.grabBarActive ? 1.0 : this.grabBarHovered ? 0.95 : 0.7
    const c = this.grabBarActive || this.grabBarHovered ? 0.95 : 0.82
    this.grabBarShape.backgroundColor = new vec4(c, c, c, a)
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
