/**
 * SidleGalleryUI — the piece gallery (Update 4; passive view).
 *
 * Owns (runtime children of GalleryRoot, stable names for tests):
 *   GalleryTab_1..8           one UIKit Button per offered type (unused slots hidden),
 *                             with an Underline marking the active tab
 *   GalleryTile_1..6          3 × 2 grid of UIKit Buttons; each has Thumb (Image, the
 *                             piece's thumbnail), Swatch (plain colour tile) and Name
 *   GalleryPrevButton, GalleryNextButton (greyed out at the first / last page)
 *   GalleryPageLabel ("1 / 2"), GalleryCloseButton
 *
 * Main -> UI: render(view), setVisible(on).
 * UI -> Main: onTab(type), onTile(key), onPrevPage, onNextPage, onClose.
 * Positioning/follow is done by a SidleLazyFollow on the same SceneObject.
 *
 * Must not: hold domain state or make decisions (SidleController owns state).
 */
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {applyInactive} from "./SidlePanelUI"

const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material
const ICON_PREV = requireAsset("../Icons/chevron_left.png") as Texture
const ICON_NEXT = requireAsset("../Icons/chevron_right.png") as Texture
const ICON_CLOSE = requireAsset("../Icons/close.png") as Texture

export const GALLERY_TILES_PER_PAGE = 6
const MAX_TABS = 8
const FACE_Z = 0.08

export interface GalleryTileView {
  key: string
  name: string
  /** null: plain tile with the name and swatch colour. */
  thumbnail: Texture | null
  swatch: vec4
  current: boolean
}

export interface GalleryView {
  types: {type: string; label: string}[]
  activeType: string
  page: number
  pageCount: number
  tiles: GalleryTileView[]
}

interface TileSlot {
  so: SceneObject
  button: Button
  thumb: SceneObject
  thumbMat: Material
  swatch: SceneObject
  swatchShape: RoundedRectangle
  name: Text
  key: string
}

interface TabSlot {
  so: SceneObject
  button: Button
  label: Text
  underline: SceneObject
  type: string
}

@component
export class SidleGalleryUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SidleGalleryUI – piece gallery view</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Tile width in cm (brief: at least 6 at 1 m)")
  @widget(new SliderWidget(6, 12, 0.1))
  tileWidth: number = 8

  @input
  @hint("Tile height in cm")
  @widget(new SliderWidget(6, 12, 0.1))
  tileHeight: number = 8.6

  @input
  @hint("Gap between tiles in cm")
  @widget(new SliderWidget(0.5, 4, 0.1))
  tileGap: number = 1.5

  @input
  @hint("Thumbnail / swatch size inside a tile, cm")
  @widget(new SliderWidget(3, 10, 0.1))
  thumbSize: number = 6

  @input
  @hint("Panel padding in cm")
  @widget(new SliderWidget(0.5, 4, 0.1))
  padding: number = 1.6

  @input("vec4", "{1.0, 0.82, 0.45, 1.0}")
  @hint("Name colour of the tile of the piece that is showing, and of the active tab marker")
  @widget(new ColorWidget())
  accentColor: vec4 = new vec4(1.0, 0.82, 0.45, 1.0)
  @ui.group_end

  private _onTab = new Event<string>()
  private _onTile = new Event<string>()
  private _onPrevPage = new Event<void>()
  private _onNextPage = new Event<void>()
  private _onClose = new Event<void>()
  get onTab(): PublicApi<string> {
    return this._onTab.publicApi()
  }
  get onTile(): PublicApi<string> {
    return this._onTile.publicApi()
  }
  get onPrevPage(): PublicApi<void> {
    return this._onPrevPage.publicApi()
  }
  get onNextPage(): PublicApi<void> {
    return this._onNextPage.publicApi()
  }
  get onClose(): PublicApi<void> {
    return this._onClose.publicApi()
  }

  private root: SceneObject | null = null
  private tiles: TileSlot[] = []
  private tabs: TabSlot[] = []
  private prevButton: Button | null = null
  private nextButton: Button | null = null
  private pageLabel: Text | null = null
  private prevInactive = true
  private nextInactive = true
  private contentW = 0
  private tabRowY = 0
  private tabH = 3.6

  onAwake() {
    this.build()
    // Keep the page buttons greyed out after the gallery is hidden and shown again.
    this.createEvent("UpdateEvent").bind(() => {
      if (!this.root || !this.root.enabled) return
      if (this.prevButton) applyInactive(this.prevButton, this.prevInactive)
      if (this.nextButton) applyInactive(this.nextButton, this.nextInactive)
    })
  }

  // ── Public view API ────────────────────────────────────────────────────────
  setVisible(on: boolean): void {
    if (this.root) this.root.enabled = on
  }

  render(view: GalleryView): void {
    if (!this.root) return
    // Tabs: equal widths across the content, at most 7 cm each
    const n = Math.min(view.types.length, MAX_TABS)
    const gap = 0.8
    const tabW = Math.min(7, (this.contentW - (n - 1) * gap) / Math.max(1, n))
    const rowW = n * tabW + (n - 1) * gap
    for (let i = 0; i < MAX_TABS; i++) {
      const slot = this.tabs[i]
      const t = view.types[i]
      slot.so.enabled = i < n
      if (i >= n) continue
      slot.type = t.type
      slot.button.size = new vec3(tabW, this.tabH, 1)
      slot.so.getTransform().setLocalPosition(new vec3(-rowW / 2 + tabW / 2 + i * (tabW + gap), this.tabRowY, 0.6))
      slot.label.text = t.label
      const w = tabW - 0.4
      slot.label.layoutRect = Rect.create(-w / 2, w / 2, -0.9, 0.9)
      const active = t.type === view.activeType
      slot.underline.enabled = active
      slot.label.textFill.color = active ? this.accentColor : new vec4(1, 1, 1, 0.85)
      const ul = slot.underline.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
      if (ul) ul.size = new vec2(Math.max(1, tabW - 1.6), 0.35)
    }
    // Tiles
    for (let i = 0; i < GALLERY_TILES_PER_PAGE; i++) {
      const slot = this.tiles[i]
      const tile = view.tiles[i]
      slot.so.enabled = !!tile
      if (!tile) {
        slot.key = ""
        continue
      }
      slot.key = tile.key
      slot.name.text = tile.name
      slot.name.textFill.color = tile.current ? this.accentColor : new vec4(1, 1, 1, 0.9)
      if (tile.thumbnail) {
        slot.thumbMat.mainPass.baseTex = tile.thumbnail
        slot.thumb.enabled = true
        slot.swatch.enabled = false
      } else {
        slot.thumb.enabled = false
        slot.swatch.enabled = true
        slot.swatchShape.backgroundColor = tile.swatch
      }
    }
    // Paging (no wrap)
    this.prevInactive = view.page <= 0
    this.nextInactive = view.page >= view.pageCount - 1
    if (this.prevButton) applyInactive(this.prevButton, this.prevInactive)
    if (this.nextButton) applyInactive(this.nextButton, this.nextInactive)
    if (this.pageLabel) this.pageLabel.text = `${view.page + 1} / ${Math.max(1, view.pageCount)}`
  }

  // ── Build ──────────────────────────────────────────────────────────────────
  private build(): void {
    const tw = this.tileWidth
    const th = this.tileHeight
    const g = this.tileGap
    const gridW = 3 * tw + 2 * g
    const gridH = 2 * th + g
    const footerH = 4.4
    const rowGap = 1.2
    this.contentW = gridW
    const W = gridW + 2 * this.padding
    const H = 2 * this.padding + this.tabH + rowGap + gridH + rowGap + footerH

    const root = this.obj(this.sceneObject, "GalleryRoot")
    this.root = root
    root.createComponent("Component.Canvas")
    const plate = root.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.size = new vec2(W, H)

    const top = H / 2 - this.padding
    this.tabRowY = top - this.tabH / 2
    const gridTop = top - this.tabH - rowGap
    const footerY = gridTop - gridH - rowGap - footerH / 2

    for (let i = 0; i < MAX_TABS; i++) this.tabs.push(this.buildTab(root, i))
    for (let i = 0; i < GALLERY_TILES_PER_PAGE; i++) {
      const col = i % 3
      const row = Math.floor(i / 3)
      const x = -gridW / 2 + tw / 2 + col * (tw + g)
      const y = gridTop - th / 2 - row * (th + g)
      this.tiles.push(this.buildTile(root, i, new vec3(x, y, 0.6)))
    }

    // Footer: Prev  "1 / 2"  Next ............ Close
    const bw = 6
    this.prevButton = this.iconButton(root, "GalleryPrevButton", ICON_PREV, "Previous", new vec3(-gridW / 2 + bw / 2, footerY, 0.6), bw, footerH, () =>
      this._onPrevPage.invoke(),
    )
    const labelSO = this.obj(root, "GalleryPageLabel", new vec3(-gridW / 2 + bw + 3.2, footerY, 0.7))
    const pl = labelSO.createComponent("Component.Text") as Text
    this.textStyle(pl, 34, 600, 5, 1.6)
    pl.text = "1 / 1"
    this.pageLabel = pl
    this.nextButton = this.iconButton(root, "GalleryNextButton", ICON_NEXT, "Next", new vec3(-gridW / 2 + bw * 1.5 + 6.4, footerY, 0.6), bw, footerH, () =>
      this._onNextPage.invoke(),
    )
    this.iconButton(root, "GalleryCloseButton", ICON_CLOSE, "Close", new vec3(gridW / 2 - bw / 2, footerY, 0.6), bw, footerH, () => this._onClose.invoke())

    root.enabled = false
  }

  private buildTab(parent: SceneObject, i: number): TabSlot {
    const so = this.obj(parent, `GalleryTab_${i + 1}`, new vec3(0, this.tabRowY, 0.6))
    const button = so.createComponent(Button.getTypeName()) as Button
    button.size = new vec3(5, this.tabH, 1)
    const labelSO = this.obj(so, "Label", new vec3(0, 0.2, FACE_Z))
    const label = labelSO.createComponent("Component.Text") as Text
    this.textStyle(label, 36, 600, 4.6, 1.8)
    const underline = this.obj(so, "Underline", new vec3(0, -this.tabH / 2 + 0.6, FACE_Z))
    const ul = underline.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    ul.size = new vec2(3, 0.35)
    ul.cornerRadius = 0.17
    ul.backgroundColor = this.accentColor
    underline.enabled = false
    const slot: TabSlot = {so, button, label, underline, type: ""}
    button.onTriggerUp.add(() => {
      if (!button.inactive && slot.type) this._onTab.invoke(slot.type)
    })
    so.enabled = false
    return slot
  }

  private buildTile(parent: SceneObject, i: number, pos: vec3): TileSlot {
    const so = this.obj(parent, `GalleryTile_${i + 1}`, pos)
    const button = so.createComponent(Button.getTypeName()) as Button
    button.size = new vec3(this.tileWidth, this.tileHeight, 1)
    const face = this.obj(so, "Face", new vec3(0, 0, FACE_Z))
    const imgY = this.tileHeight / 2 - 0.5 - this.thumbSize / 2

    const thumb = this.obj(face, "Thumb", new vec3(0, imgY, 0))
    const img = thumb.createComponent("Component.Image") as Image
    const thumbMat = imageMaterial.clone()
    thumbMat.mainPass.depthTest = true
    thumbMat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(thumbMat)
    thumb.getTransform().setLocalScale(new vec3(this.thumbSize, this.thumbSize, 1))

    const swatch = this.obj(face, "Swatch", new vec3(0, imgY, 0))
    const swatchShape = swatch.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    swatchShape.size = new vec2(this.thumbSize, this.thumbSize)
    swatchShape.cornerRadius = 0.6
    swatchShape.backgroundColor = new vec4(0.78, 0.78, 0.8, 1)
    swatch.enabled = false

    const nameSO = this.obj(face, "Name", new vec3(0, -this.tileHeight / 2 + 1.1, 0))
    const name = nameSO.createComponent("Component.Text") as Text
    this.textStyle(name, 30, 600, this.tileWidth - 0.6, 1.6)

    const slot: TileSlot = {so, button, thumb, thumbMat, swatch, swatchShape, name, key: ""}
    button.onTriggerUp.add(() => {
      if (!button.inactive && slot.key) this._onTile.invoke(slot.key)
    })
    so.enabled = false
    return slot
  }

  private iconButton(parent: SceneObject, name: string, icon: Texture, caption: string, pos: vec3, w: number, h: number, onClick: () => void): Button {
    const so = this.obj(parent, name, pos)
    const button = so.createComponent(Button.getTypeName()) as Button
    button.size = new vec3(w, h, 1)
    const face = this.obj(so, "Face", new vec3(0, 0, FACE_Z))
    const iconSO = this.obj(face, "Icon", new vec3(0, h * 0.14, 0))
    const img = iconSO.createComponent("Component.Image") as Image
    const mat = imageMaterial.clone()
    mat.mainPass.baseTex = icon
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
    iconSO.getTransform().setLocalScale(new vec3(2.0, 2.0, 1))
    const capSO = this.obj(face, "Caption", new vec3(0, -h * 0.3, 0))
    const t = capSO.createComponent("Component.Text") as Text
    this.textStyle(t, 28, 500, w - 0.4, 1.2)
    t.text = caption
    button.onTriggerUp.add(() => {
      if (!button.inactive) onClick()
    })
    return button
  }

  private textStyle(t: Text, size: number, weight: number, w: number, h: number): void {
    t.size = size
    ;(t as Text & {weight?: number}).weight = weight
    t.depthTest = true
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Shrink
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-w / 2, w / 2, -h / 2, h / 2)
    t.textFill.color = new vec4(1, 1, 1, 0.9)
  }

  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (position) so.getTransform().setLocalPosition(position)
    return so
  }
}
