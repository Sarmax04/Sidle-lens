/**
 * SidleController — the single owner of Sidle state (testable via LEAF).
 *
 * Owns: current piece, its floor position + rotation, Measure toggle, drag
 * state, clearance result, gap-label fade, the "piece behind you" arrow, and
 * the control panel's head-space offset + panel drag (Update 3; the panel's
 * SidleLazyFollow only follows the offset pushed from here).
 * Pieces are grouped into types (sofa, chair, table, bed, then any unknown
 * catalog category); Next piece moves between types, Compare between the
 * variants of the current type (built-ins first, then catalog order).
 * Builds the virtual stand-in room (walls, doorway, coffee table), the four
 * box-shaped pieces and the imported catalog pieces (SidleCatalog) under the
 * authored roots it is given, and pushes view state into SidlePanelUI /
 * SidleLabelsUI. Every piece is built once and enabled/disabled on switch.
 *
 * Room look (Update 7): flat light-wood floor with plank lines, warm white
 * walls with a sage accent far wall, baseboards, a window in the left wall, a
 * light door frame (RoomDoorFrame) and a rug — all under RoomDecor except the
 * door frame, decoration only (no colliders, not obstacles, not measured).
 *
 * Fabric colours (Update 9): the current piece's swatch index (setColor,
 * currentColorIndex) and each placed piece's (PlacedPiece.colorIndex); the tint
 * is applied by SidleTint per visual. The colour strip (SidleColorStripUI) is
 * created as a child of the panel. Add keeps the colour on the placed piece and
 * starts the new current piece at "original"; Remove and grabbing a placed
 * piece bring its colour back to the current piece.
 *
 * Door fit (Update 8): currentFitsThroughDoor / doorFitText for the current
 * piece (SidleGeometry.fitsThroughDoor with the doorway's DOOR_WIDTH_CM x
 * DOOR_HEIGHT_CM), shown as a line under the name on the panel.
 *
 * Expects @inputs: VirtualRoom, Doorway, CoffeeTable, Piece, FloorOutline
 * SceneObjects; the two UI components; a lit + an unlit template material;
 * the bundled catalog.json + the GLB prefabs from Assets/Models.
 * All math is VirtualRoom-local (floor at y = 0, doorway wall at +Z).
 *
 * Panel size (Update 5): panelScaleUp, panelScaleDown, resetPanelScale and the
 * panelScale getter; four sizes (PANEL_SCALES), 100% at every start.
 *
 * Gallery (Update 4): openGallery, closeGallery, selectFromGallery(key),
 * galleryShowType(type), galleryNextPage, galleryPrevPage; while it is open the
 * control panel is hidden and SidleGalleryUI is shown at the panel's offset.
 *
 * Several pieces (Update 6): one current piece (everything above acts on it)
 * plus zero to five placed pieces, each a separate instance (its own visual
 * copy, a faint neutral outline, a collider + Interactable; no labels). Placed
 * pieces are oriented-rectangle obstacles for the current piece. addPiece and
 * removePiece (Add / Remove buttons), placedPieces, pieceCount, canAdd,
 * canRemove, currentPieceId. Pinching a placed piece swaps it with the current
 * piece (which becomes placed where it stands) and the same pinch drags it on.
 *
 * Public API (for tests): nextPiece, compare, toggleMeasure, rotateLeft,
 * rotateRight, setPiecePosition(x, z), beginDrag, endDrag, refresh,
 * loadCatalogText(text), setShowPlaceholderPieces(on) and resetPanelOffset()
 * (test hooks), plus the read-only getters below (panelOffset, panelDragging).
 *
 * Must not: create text/UIKit directly (labels live in the UI modules).
 */
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {InteractorEvent} from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {SidlePanelUI} from "./SidlePanelUI"
import {SidleLazyFollow} from "./SidleLazyFollow"
import {GALLERY_TILES_PER_PAGE, GalleryView, SidleGalleryUI} from "./SidleGalleryUI"
import {PanelOffset, clampOffset, headFrame, worldToOffset} from "./SidlePanelOffset"
import {SidleLabelsUI} from "./SidleLabelsUI"
import {SidleColorStripUI} from "./SidleColorStripUI"
import {COLOR_SWATCHES, PieceTint, TintMethod} from "./SidleTint"
import {MaterialCache, makeBox} from "./SidleBoxFactory"
import {CatalogEntry, buildImportedVisual, fileBaseName, glbBaseName, parseCatalog, warn} from "./SidleCatalog"
import {
  ClearanceHit,
  DOOR_HEIGHT_CM,
  DOOR_WIDTH_CM,
  EDGE_NAMES,
  fitsThroughDoor,
  EdgeName,
  Obstacle,
  ROOM_DEPTH_CM,
  ROOM_WIDTH_CM,
  RoomSpec,
  isValidPlacement,
  measureClearances,
  resolveDrag,
  resolvePlacement,
  rotateLocal,
} from "./SidleGeometry"

export type PieceKey = "SofaA" | "SofaB" | "Bed" | "DiningTable"

interface PieceDef {
  key: string // a PieceKey, or "Imported_<catalog id>"
  name: string
  type: string // "sofa" | "chair" | "table" | "bed" | an unknown catalog category
  w: number
  d: number
  h: number
  entry?: CatalogEntry // imported pieces only
}

const IMPORTED_PREFIX = "Imported_"

/** Known types in Next-piece order; unknown catalog categories follow in catalog order. */
const TYPE_ORDER = ["sofa", "chair", "table", "bed"]

/** Sizes from the design brief (W × D × H, cm). */
const BUILT_IN: PieceDef[] = [
  {key: "SofaA", name: "Sofa A", type: "sofa", w: 220, d: 90, h: 85},
  {key: "SofaB", name: "Sofa B", type: "sofa", w: 180, d: 85, h: 85},
  {key: "Bed", name: "Bed", type: "bed", w: 160, d: 200, h: 55},
  {key: "DiningTable", name: "Dining table", type: "table", w: 160, d: 90, h: 75},
]
/** Panel sizes (Update 5), smallest to biggest; index 1 (100%) at every start. */
export const PANEL_SCALES = [0.75, 1.0, 1.25, 1.5]
const PANEL_SCALE_DEFAULT_INDEX = 1

/** Gallery swatch colours: the built-ins' main colour; imported pieces without a thumbnail use the fallback-box grey. */
const SWATCH: {[key: string]: number[]} = {
  SofaA: [0.82, 0.82, 0.84],
  SofaB: [0.86, 0.75, 0.6],
  Bed: [0.62, 0.72, 0.84],
  DiningTable: [0.86, 0.74, 0.58],
}
const SWATCH_IMPORTED = [0.78, 0.78, 0.8]
const COFFEE_TABLE = {w: 100, d: 50, h: 45}
/** Update 6: at most this many pieces (current + placed) in the room. */
export const MAX_PIECES = 6

/** A placed piece (Update 6): variant key, floor position (VirtualRoom-local cm) and yaw. */
export interface PlacedPiece {
  id: number
  key: string
  x: number
  z: number
  yawDeg: number
  /** Fabric colour swatch index (Update 9); 0 = original. */
  colorIndex: number
}

/** Scene objects that show one placed piece; reused for another piece on a swap so a drag on it continues. */
interface PlacedSlot {
  id: number
  root: SceneObject
  visual: SceneObject | null
  edges: SceneObject[]
  grab: SceneObject
  collider: ColliderComponent
  tint: PieceTint | null
}

@component
export class SidleController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SidleController – state, clearance, room</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("Root of the virtual stand-in room; its origin is the floor under the start position")
  room!: SceneObject

  @input
  @hint("Doorway root (authored at the near wall line)")
  doorway!: SceneObject

  @input
  @hint("Coffee table root — placed in the far right corner at start")
  coffeeTable!: SceneObject

  @input
  @hint("Piece root — moved/rotated on the floor; its authored X/Z is the start spot")
  pieceRoot!: SceneObject

  @input
  @hint("Floor outline root (follows the piece)")
  outlineRoot!: SceneObject

  @input
  @hint("Control panel view")
  panelUI!: SidlePanelUI

  @input
  @hint("Dimension + gap label view")
  labelsUI!: SidleLabelsUI

  @input
  @hint("Gallery view (Update 4); has its own SidleLazyFollow")
  @allowUndefined
  galleryUI: SidleGalleryUI

  @input
  @hint("Lit template material for room + furniture boxes (cloned per color)")
  litMaterial!: Material

  @input
  @hint("Unlit template material for the floor outline (cloned per color)")
  unlitMaterial!: Material
  @ui.group_end

  @ui.separator
  @ui.group_start("Imported pieces")
  @input
  @hint("Bundled Assets/Models/catalog.json")
  @allowUndefined
  catalog: JsonAsset

  @input
  @hint("GLB prefabs from Assets/Models; matched to catalog entries by file name")
  @allowUndefined
  modelPrefabs: ObjectPrefab[] = []

  @input
  @hint("Gallery thumbnails from Assets/Models/thumbs; matched to the catalog thumbnail field by file name")
  @allowUndefined
  thumbnailTextures: Texture[] = []

  @input
  @hint("Offer the built-in box pieces (Sofa A/B, bed, dining table). Off: imported pieces only; falls back to the built-ins if there are none")
  showPlaceholderPieces: boolean = true
  @ui.group_end

  @ui.separator
  @ui.group_start("Room")
  // Width/depth are ROOM_WIDTH_CM / ROOM_DEPTH_CM in SidleGeometry (shared with the tests).
  @input
  @hint("Wall height, cm")
  @widget(new SliderWidget(200, 350, 5))
  wallHeight: number = 250

  @input
  @hint("How far the doorway wall line is behind the start position, cm")
  @widget(new SliderWidget(10, 100, 1))
  startInsetCm: number = 100

  // Doorway opening: DOOR_WIDTH_CM x DOOR_HEIGHT_CM in SidleGeometry (shared with the door-fit rule, Update 8).
  private readonly doorWidth = DOOR_WIDTH_CM
  private readonly doorHeight = DOOR_HEIGHT_CM

  @input("vec4", "{0.95, 0.93, 0.88, 1.0}")
  @hint("Wall color: warm white (left, right and doorway walls)")
  @widget(new ColorWidget())
  wallColor: vec4 = new vec4(0.95, 0.93, 0.88, 1.0)

  @input("vec4", "{0.95, 0.88, 0.76, 1.0}")
  @hint("Floor color: flat light wood tone (unlit). Kept light so the green/red outline and the gap number read on it")
  @widget(new ColorWidget())
  floorColor: vec4 = new vec4(0.95, 0.88, 0.76, 1.0)
  @ui.group_end

  @ui.separator
  @ui.group_start("Room look (Update 7, decoration only)")
  @input("vec4", "{0.74, 0.8, 0.7, 1.0}")
  @hint("Accent wall color (the far wall): soft sage")
  @widget(new ColorWidget())
  accentWallColor: vec4 = new vec4(0.74, 0.8, 0.7, 1.0)

  @input("vec4", "{0.86, 0.77, 0.63, 1.0}")
  @hint("Thin plank lines on the floor (slightly darker than the floor)")
  @widget(new ColorWidget())
  plankLineColor: vec4 = new vec4(0.86, 0.77, 0.63, 1.0)

  @input
  @hint("Plank width, cm (distance between plank lines)")
  @widget(new SliderWidget(10, 40, 1))
  plankWidthCm: number = 20

  @input("vec4", "{0.99, 0.98, 0.96, 1.0}")
  @hint("Baseboard color (lighter than the walls)")
  @widget(new ColorWidget())
  baseboardColor: vec4 = new vec4(0.99, 0.98, 0.96, 1.0)

  @input("vec4", "{0.97, 0.96, 0.93, 1.0}")
  @hint("Window frame and door frame color (light)")
  @widget(new ColorWidget())
  frameColor: vec4 = new vec4(0.97, 0.96, 0.93, 1.0)

  @input("vec4", "{0.88, 0.95, 1.0, 1.0}")
  @hint("Window pane color (pale, bright; unlit)")
  @widget(new ColorWidget())
  windowPaneColor: vec4 = new vec4(0.88, 0.95, 1.0, 1.0)

  @input
  @hint("Show the flat rug in the middle of the room")
  showRug: boolean = true

  @input("vec4", "{0.8, 0.85, 0.92, 1.0}")
  @hint("Rug color: soft dusty blue (unlit)")
  @widget(new ColorWidget())
  rugColor: vec4 = new vec4(0.8, 0.85, 0.92, 1.0)
  @ui.group_end

  @ui.separator
  @ui.group_start("Clearance")
  @input
  @hint("Minimum free space to walls, doorway wall and coffee table, cm")
  @widget(new SliderWidget(30, 150, 1))
  clearanceCm: number = 80

  @input
  @hint("Rotate button step, degrees")
  @widget(new SliderWidget(5, 90, 1))
  rotateStepDeg: number = 15

  @input
  @hint("Gap number fade-out time after going green, seconds")
  @widget(new SliderWidget(0.2, 3, 0.1))
  gapFadeSeconds: number = 1.0

  @input("vec4", "{0.35, 0.85, 0.45, 1.0}")
  @hint("Outline color when clear")
  @widget(new ColorWidget())
  clearColor: vec4 = new vec4(0.35, 0.85, 0.45, 1.0)

  @input("vec4", "{0.8, 0.8, 0.8, 1.0}")
  @hint("Outline color of placed pieces (faint, neutral: not green or red)")
  @widget(new ColorWidget())
  placedOutlineColor: vec4 = new vec4(0.8, 0.8, 0.8, 1.0)

  @input("vec4", "{1.0, 0.3, 0.25, 1.0}")
  @hint("Outline edge color when too close")
  @widget(new ColorWidget())
  tooCloseColor: vec4 = new vec4(1.0, 0.3, 0.25, 1.0)

  @input
  @hint("Outline line width, cm (thin + faint)")
  @widget(new SliderWidget(0.5, 5, 0.1))
  outlineWidthCm: number = 1.5
  @ui.group_end

  @ui.separator
  @ui.group_start("Debug")
  @input
  @hint("Wireframe the piece's grab collider")
  debugColliders: boolean = false
  @ui.group_end

  // ── State (single source of truth) ─────────────────────────────────────────
  private pieces: PieceDef[] = BUILT_IN.slice()
  private pieceIndex = 0
  /** Offered types in Next order, each with its variant keys in Compare order. */
  private types: {type: string; keys: string[]}[] = []
  private _placeholderFallback = false
  private yawDeg = 0
  private posX = 0
  private posZ = -220
  private _measureOn = false
  private _dragging = false
  private hits: ClearanceHit[] = []
  private edgeRed: boolean[] = [false, false, false, false]
  private gapAlpha = 0
  private gapFading = false
  private lastGapText = ""
  private lastGapPos = new vec3(0, 0, 0)
  private _behind = false
  private _behindAngle = 0
  /** Control panel offset from the head (Update 3); starts at the Inspector defaults every session. */
  private _panelOffset: PanelOffset = {distanceCm: 110, horizontalDeg: 0, verticalDeg: -30}
  private _panelDragging = false
  private panelGrab: {rayDist: number; startOffset: PanelOffset; startPoint: PanelOffset} | null = null
  private panelFollow: SidleLazyFollow | null = null
  private galleryFollow: SidleLazyFollow | null = null
  private panelScaleIndex = PANEL_SCALE_DEFAULT_INDEX
  private _galleryOpen = false
  private _galleryType = ""
  private _galleryPage = 0
  /** Update 6: id of the current piece instance, the placed pieces in placement order, and their scene slots. */
  private _currentId = 1
  private nextId = 2
  private placed: PlacedPiece[] = []
  private slots: PlacedSlot[] = []
  /** The placed slot whose pinch is dragging the current piece (after the swap), or null. */
  private slotDrag: PlacedSlot | null = null
  /** Update 9: fabric colour of the current piece (swatch index, 0 = original) and the tint of each variant's visual. */
  private _colorIndex = 0
  private _tintMethod: TintMethod = "blend"
  private tints: {[key: string]: PieceTint} = {}
  private colorStrip: SidleColorStripUI | null = null

  // ── Scene handles ──────────────────────────────────────────────────────────
  private litCache!: MaterialCache
  private unlitCache!: MaterialCache
  private pieceVisuals: {[k: string]: SceneObject} = {}
  private modelLoaded: {[k: string]: boolean} = {}
  private prefabs: {[name: string]: ObjectPrefab} = {}
  private _warnings: string[] = []
  private hitObj!: SceneObject
  private collider!: ColliderComponent
  private edges: SceneObject[] = []
  private edgeVisuals: RenderMeshVisual[] = []
  private camT: Transform | null = null
  private dragOffset: vec3 | null = null
  private ready = false
  private colliderKey = ""

  onAwake() {
    if (!this.room || !this.pieceRoot || !this.outlineRoot || !this.panelUI || !this.labelsUI) {
      print("SidleController: required @input not wired (room/pieceRoot/outlineRoot/panelUI/labelsUI).")
      return
    }
    if (!this.litMaterial || !this.unlitMaterial) {
      print("SidleController: litMaterial/unlitMaterial not wired.")
      return
    }
    this.litCache = new MaterialCache(this.litMaterial)
    this.unlitCache = new MaterialCache(this.unlitMaterial)

    // Start piece in the middle of the room (derived from the room constants, not the authored transform).
    const start = this.startSpot()
    this.posX = start.x
    this.posZ = start.z

    this.buildRoom()
    this.buildPieces()
    this.buildImportedPieces(this.bundledCatalogText())
    this.rebuildOffer()
    this.select(this.firstKey())
    this.buildOutline()
    this.buildGrab()
    // UI components may not be initialized yet during onAwake (hierarchy order),
    // so the first view sync happens in OnStartEvent.

    this.createEvent("OnStartEvent").bind(() => {
      this.camT = WorldCameraFinderProvider.getInstance().getTransform()
      this.anchorRoomToHead()
      // SidleLazyFollow sits lower in the hierarchy: only initialized from OnStart on.
      this.panelFollow = this.panelUI.getSceneObject().getComponent(SidleLazyFollow.getTypeName()) as SidleLazyFollow | null
      if (!this.panelFollow) warn("SidleLazyFollow not found on the panel; the panel cannot be placed or moved")
      if (this.galleryUI) {
        this.galleryFollow = this.galleryUI.getSceneObject().getComponent(SidleLazyFollow.getTypeName()) as SidleLazyFollow | null
        if (!this.galleryFollow) warn("SidleLazyFollow not found on the gallery; it will not follow the user")
        this.galleryUI.onTab.add((t: string) => this.galleryShowType(t))
        this.galleryUI.onTile.add((k: string) => this.selectFromGallery(k))
        this.galleryUI.onPrevPage.add(() => this.galleryPrevPage())
        this.galleryUI.onNextPage.add(() => this.galleryNextPage())
        this.galleryUI.onClose.add(() => this.closeGallery())
        this.galleryUI.setVisible(false)
      } else {
        warn("galleryUI not wired; the Gallery button does nothing")
      }
      this.resetPanelOffset()
      this.resetPanelScale()
      this.panelUI.onSmaller.add(() => this.panelScaleDown())
      this.panelUI.onBigger.add(() => this.panelScaleUp())
      this.panelUI.onGallery.add(() => this.openGallery())
      this.panelUI.onNext.add(() => this.nextPiece())
      this.panelUI.onCompare.add(() => this.compare())
      this.panelUI.onMeasure.add(() => this.toggleMeasure())
      this.panelUI.onRotateLeft.add(() => this.rotateLeft())
      this.panelUI.onRotateRight.add(() => this.rotateRight())
      this.panelUI.onAdd.add(() => this.addPiece())
      this.panelUI.onRemove.add(() => this.removePiece())
      this.buildColorStrip()
      this.panelUI.onGrabBarStart.add((e: InteractorEvent) => this.onPanelGrabStart(e))
      this.panelUI.onGrabBarUpdate.add((e: InteractorEvent) => this.onPanelGrabUpdate(e))
      this.panelUI.onGrabBarEnd.add(() => this.onPanelGrabEnd())

      const inter = this.hitObj.getComponent(Interactable.getTypeName()) as Interactable
      inter.onTriggerStart.add((e: InteractorEvent) => this.onGrabStart(e))
      inter.onTriggerUpdate.add((e: InteractorEvent) => this.onGrabUpdate(e))
      inter.onTriggerEnd.add(() => this.endDrag())
      inter.onTriggerEndOutside.add(() => this.endDrag())
      inter.onTriggerCanceled.add(() => this.endDrag())

      this.ready = true
      this.applyAll()
    })
    this.createEvent("UpdateEvent").bind(() => this.tick())
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════════════════

  /** First variant of the next offered type, wrapping around. */
  nextPiece(): void {
    const ti = this.currentTypeIndex()
    this.showPiece(this.types[(ti + 1) % this.types.length].keys[0])
  }

  /** Next variant of the current type, wrapping around; does nothing for a one-variant type. */
  compare(): void {
    const g = this.types[this.currentTypeIndex()]
    if (!g || g.keys.length < 2) return
    this.showPiece(g.keys[(g.keys.indexOf(this.currentPieceKey) + 1) % g.keys.length])
  }

  toggleMeasure(): void {
    this._measureOn = !this._measureOn
    this.applyAll()
  }

  rotateLeft(): void {
    this.rotateBy(this.rotateStepDeg)
  }

  rotateRight(): void {
    this.rotateBy(-this.rotateStepDeg)
  }

  /** Move the piece on the floor (VirtualRoom-local cm). Clamped: no overlap with walls/coffee table. */
  setPiecePosition(x: number, z: number): void {
    const p = this.resolve(x, z, this.yawRad())
    this.posX = p.x
    this.posZ = p.z
    this.applyAll()
  }

  beginDrag(): void {
    this._dragging = true
    this.applyAll()
  }

  endDrag(): void {
    this._dragging = false
    this.dragOffset = null
    this.applyAll()
  }

  /**
   * Put the control panel back at the Inspector default offset (SidleLazyFollow
   * panelDistanceCm / panelDropDeg), placed there at once. Runs at every start;
   * also a test hook.
   */
  resetPanelOffset(): void {
    this._panelDragging = false
    this.panelGrab = null
    if (this.panelFollow) this._panelOffset = this.panelFollow.defaultOffset
    this.pushPanelOffset(true)
  }

  // -- Panel size (Update 5) ---------------------------------------------------

  /** One size step bigger ("+"); does nothing at the biggest size. */
  panelScaleUp(): void {
    if (this.panelScaleIndex >= PANEL_SCALES.length - 1) return
    this.panelScaleIndex++
    this.pushPanelScale()
  }

  /** One size step smaller ("-"); does nothing at the smallest size. */
  panelScaleDown(): void {
    if (this.panelScaleIndex <= 0) return
    this.panelScaleIndex--
    this.pushPanelScale()
  }

  /** Back to 100% (runs at every start; also a test hook). */
  resetPanelScale(): void {
    this.panelScaleIndex = PANEL_SCALE_DEFAULT_INDEX
    this.pushPanelScale()
  }

  private pushPanelScale(): void {
    const i = this.panelScaleIndex
    this.panelUI.setPanelScale(PANEL_SCALES[i], i > 0, i < PANEL_SCALES.length - 1)
    if (this.galleryUI) this.galleryUI.setScale(PANEL_SCALES[i])
  }

  // -- Gallery (Update 4) ------------------------------------------------------

  /** Open the gallery on the current piece's type and the page that holds it; the panel is hidden meanwhile. */
  openGallery(): void {
    if (!this.galleryUI) return
    const type = this.currentPieceType
    const keys = this.variantKeys(type)
    this._galleryType = type
    this._galleryPage = Math.max(0, Math.floor(keys.indexOf(this.currentPieceKey) / GALLERY_TILES_PER_PAGE))
    this._galleryOpen = true
    this.galleryUI.setScale(this.panelScale) // opens at the panel's size
    this.panelUI.getSceneObject().enabled = false
    if (this.galleryFollow) this.galleryFollow.setOffset(this._panelOffset, true)
    this.galleryUI.setVisible(true)
    this.renderGallery()
  }

  /** Close without choosing; the panel comes back at its offset. */
  closeGallery(): void {
    if (!this._galleryOpen) return
    this._galleryOpen = false
    if (this.galleryUI) this.galleryUI.setVisible(false)
    this.panelUI.getSceneObject().enabled = true
    this.pushPanelOffset(true)
  }

  /**
   * Show `key` in the same spot and facing (nudged to the nearest valid spot if
   * it would overlap) and close the gallery. Returns false (and changes nothing)
   * if the gallery is closed or the piece is not offered.
   */
  selectFromGallery(key: string): boolean {
    if (!this._galleryOpen || !this.isOffered(key)) return false
    this.showPiece(key)
    this.closeGallery()
    return true
  }

  /** Gallery tab: show `type` from its first page. */
  galleryShowType(type: string): void {
    if (!this._galleryOpen || this.variantKeys(type).length === 0) return
    this._galleryType = type
    this._galleryPage = 0
    this.renderGallery()
  }

  /** Next gallery page; does nothing on the last page (no wrap). */
  galleryNextPage(): void {
    if (!this._galleryOpen || this._galleryPage >= this.galleryPageCount - 1) return
    this._galleryPage++
    this.renderGallery()
  }

  /** Previous gallery page; does nothing on the first page (no wrap). */
  galleryPrevPage(): void {
    if (!this._galleryOpen || this._galleryPage <= 0) return
    this._galleryPage--
    this.renderGallery()
  }

  // -- Fabric colours (Update 9) -----------------------------------------------

  /** Tint the current piece with swatch `index` (0 = original). Returns false for an unknown index. */
  setColor(index: number): boolean {
    if (!(index >= 0 && index < COLOR_SWATCHES.length) || Math.floor(index) !== index) return false
    this._colorIndex = index
    this.applyAll()
    return true
  }

  /**
   * Measurement hook: "blend" (default, used by the Lens) or "multiply" (plain
   * baseColorFactor *= swatch, kept only to compare brightness).
   */
  setTintMethod(method: TintMethod): void {
    this._tintMethod = method
    for (const s of this.slots) if (s.tint) s.tint.apply(this.placedColorOf(s.id), method)
    this.applyAll()
  }

  // -- Several pieces (Update 6) -----------------------------------------------

  /**
   * Add: the current piece stays exactly where it is and becomes placed; a new
   * current piece of the next type (as Next piece would choose) appears at the
   * nearest spot to it where it overlaps nothing, facing the same way.
   * Returns false (and changes nothing) when the room already holds MAX_PIECES.
   */
  addPiece(): boolean {
    if (!this.canAdd) return false
    if (this._dragging) this.endDrag()
    const prev: PlacedPiece = {id: this._currentId, key: this.currentPieceKey, x: this.posX, z: this.posZ, yawDeg: this.yawDeg, colorIndex: this._colorIndex}
    this.placed.push(prev)
    this.createSlot(prev)
    this._currentId = this.nextId++
    this._colorIndex = 0 // the new current piece starts at "original"
    const ti = this.currentTypeIndex()
    const key = this.types[(ti + 1) % this.types.length].keys[0]
    this.pieceIndex = this.pieces.findIndex((p) => p.key === key)
    const def = this.pieces[this.pieceIndex]
    const p = this.resolve(this.posX, this.posZ, this.yawRad())
    if (!isValidPlacement(p.x, p.z, def.w, def.d, this.yawRad(), this.room3(), this.obstacles())) {
      warn(`no free spot for ${def.name}; it overlaps until it is moved`)
    }
    this.posX = p.x
    this.posZ = p.z
    this.applyAll()
    return true
  }

  /**
   * Remove: delete the current piece; the most recently placed piece becomes
   * current where it stands. Returns false (and changes nothing) when the
   * current piece is the only piece.
   */
  removePiece(): boolean {
    if (!this.canRemove) return false
    if (this._dragging) this.endDrag()
    const last = this.placed.pop()!
    this.destroySlot(last.id)
    this.takeOver(last)
    this.applyAll()
    return true
  }

  /** Re-run clearance + view sync (also runs every frame). */
  refresh(): void {
    this.applyAll()
  }

  /**
   * Replace the imported pieces with ones built from `text` (catalog.json
   * format); null reloads the bundled catalog. Test hook for missing/broken
   * models. Keeps the current piece if it is still offered, otherwise shows
   * the first variant of the first type.
   */
  loadCatalogText(text: string | null): void {
    const key = this.currentPieceKey
    for (const p of this.pieces) {
      if (!p.entry) continue
      this.pieceVisuals[p.key].destroy()
      delete this.pieceVisuals[p.key]
      delete this.tints[p.key]
      delete this.modelLoaded[p.key]
    }
    this.pieces = BUILT_IN.slice()
    this._warnings = []
    this.buildImportedPieces(text === null ? this.bundledCatalogText() : text)
    // Placed pieces keep their own visual copies; drop those whose variant no longer exists.
    for (const pp of this.placed.slice()) {
      if (this.defOf(pp.key)) continue
      this.placed.splice(this.placed.indexOf(pp), 1)
      this.destroySlot(pp.id)
    }
    this.rebuildOffer()
    this.select(this.isOffered(key) ? key : this.firstKey())
    this.renderGallery()
    this.applyAll()
  }

  /**
   * Test hook for the showPlaceholderPieces Inspector checkbox: sets it and
   * shows the first variant of the first available type, as at Lens start
   * (same spot and facing).
   */
  setShowPlaceholderPieces(on: boolean): void {
    this.showPlaceholderPieces = on
    this.rebuildOffer()
    this.select(this.firstKey())
    this.renderGallery()
    this.applyAll()
  }

  // ── Read-only state ────────────────────────────────────────────────────────
  /** Placed pieces (not the current one), in placement order; yawDeg normalized to [0, 360). */
  get placedPieces(): PlacedPiece[] {
    return this.placed.map((p) => ({id: p.id, key: p.key, x: p.x, z: p.z, yawDeg: ((p.yawDeg % 360) + 360) % 360, colorIndex: p.colorIndex}))
  }
  /** Fabric colour of the current piece: swatch index, 0 = original (Update 9). */
  get currentColorIndex(): number {
    return this._colorIndex
  }
  /** Swatch names in strip order ("original" first). */
  get colorSwatchNames(): string[] {
    return COLOR_SWATCHES.map((s) => s.name)
  }
  get tintMethod(): TintMethod {
    return this._tintMethod
  }
  /** Id of the current piece instance (kept when it becomes placed, and back). */
  get currentPieceId(): number {
    return this._currentId
  }
  /** Pieces in the room: the current one plus the placed ones. */
  get pieceCount(): number {
    return this.placed.length + 1
  }
  get canAdd(): boolean {
    return this.pieceCount < MAX_PIECES
  }
  get canRemove(): boolean {
    return this.placed.length > 0
  }
  get currentPieceKey(): string {
    return this.pieces[this.pieceIndex].key
  }
  get currentPieceName(): string {
    return this.pieces[this.pieceIndex].name
  }
  get currentDims(): {w: number; d: number; h: number} {
    const p = this.pieces[this.pieceIndex]
    return {w: p.w, d: p.d, h: p.h}
  }
  get currentPieceIsImported(): boolean {
    return !!this.pieces[this.pieceIndex].entry
  }
  /** Source domain of an imported piece; "" for built-in pieces. */
  get currentPieceDomain(): string {
    const e = this.pieces[this.pieceIndex].entry
    return e ? e.domain : ""
  }
  /** Panel detail line: source domain + W × D × H for imported pieces; "" for built-ins. */
  get currentPieceDetail(): string {
    const p = this.pieces[this.pieceIndex]
    if (!p.entry) return ""
    return `${p.entry.domain} · ${Math.round(p.w)} × ${Math.round(p.d)} × ${Math.round(p.h)} cm`
  }
  /** Update 8: the current piece can be carried through the doorway (catalog / built-in dimensions). */
  get currentFitsThroughDoor(): boolean {
    const p = this.pieces[this.pieceIndex]
    return fitsThroughDoor(p.w, p.d, p.h, this.doorWidth, this.doorHeight)
  }
  /** The panel's door-fit line for the current piece. */
  get doorFitText(): string {
    return this.currentFitsThroughDoor ? `Fits through the ${this.doorWidth} cm door` : `Too big for the ${this.doorWidth} cm door`
  }
  /** Keys of the enabled imported pieces, in catalog order. */
  get importedPieceKeys(): string[] {
    return this.pieces.filter((p) => !!p.entry).map((p) => p.key)
  }
  get currentPieceType(): string {
    return this.pieces[this.pieceIndex].type
  }
  /** Offered types in Next-piece order. */
  get availableTypes(): string[] {
    return this.types.map((g) => g.type)
  }
  /** Offered variant keys of `type`, in Compare order ([] if the type is not offered). */
  variantKeys(type: string): string[] {
    const g = this.types.find((t) => t.type === type)
    return g ? g.keys.slice() : []
  }
  /** True when showPlaceholderPieces is off but there is no imported piece, so the built-ins are offered anyway. */
  get placeholderFallbackActive(): boolean {
    return this._placeholderFallback
  }
  /** False when an imported piece shows the plain fallback box instead of its model. */
  modelLoadedFor(key: string): boolean {
    return !!this.modelLoaded[key]
  }
  /** Warnings logged while loading the catalog and models. */
  get loadWarnings(): string[] {
    return this._warnings.slice()
  }
  /** Control panel offset from the head: distance (cm), horizontal and vertical angle (deg; + = right / above). */
  get panelOffset(): PanelOffset {
    return {distanceCm: this._panelOffset.distanceCm, horizontalDeg: this._panelOffset.horizontalDeg, verticalDeg: this._panelOffset.verticalDeg}
  }
  /** True while the panel's grab bar is held. */
  get panelDragging(): boolean {
    return this._panelDragging
  }
  /** Panel size as a fraction of the default: 0.75, 1, 1.25 or 1.5. */
  get panelScale(): number {
    return PANEL_SCALES[this.panelScaleIndex]
  }
  get canScaleUp(): boolean {
    return this.panelScaleIndex < PANEL_SCALES.length - 1
  }
  get canScaleDown(): boolean {
    return this.panelScaleIndex > 0
  }
  get galleryOpen(): boolean {
    return this._galleryOpen
  }
  /** Type of the gallery tab that is showing ("" before the gallery was first opened). */
  get galleryType(): string {
    return this._galleryType
  }
  /** Gallery page index, 0-based. */
  get galleryPage(): number {
    return this._galleryPage
  }
  get galleryPageCount(): number {
    return Math.max(1, Math.ceil(this.variantKeys(this._galleryType).length / GALLERY_TILES_PER_PAGE))
  }
  /** Gallery tabs: the offered types in Next-piece order. */
  get galleryTypes(): string[] {
    return this.availableTypes
  }
  /** Keys of the tiles on the gallery page that is showing, in tile order. */
  get galleryPageKeys(): string[] {
    const start = this._galleryPage * GALLERY_TILES_PER_PAGE
    return this.variantKeys(this._galleryType).slice(start, start + GALLERY_TILES_PER_PAGE)
  }
  /** Name of the thumbnail texture a piece's tile uses; "" for a plain tile. */
  galleryThumbnailFor(key: string): string {
    const t = this.thumbnailFor(key)
    return t ? t.name : ""
  }
  get measureOn(): boolean {
    return this._measureOn
  }
  get isDragging(): boolean {
    return this._dragging
  }
  /** Dimension labels show while dragging or when Measure is on. */
  get labelsVisible(): boolean {
    return this._measureOn || this._dragging
  }
  /** Compare is enabled when the current type has more than one variant. */
  get compareEnabled(): boolean {
    const g = this.types[this.currentTypeIndex()]
    return !!g && g.keys.length > 1
  }
  /** Rotation in degrees, normalized to [0, 360). Positive = rotated left (counter-clockwise from above). */
  get rotationDeg(): number {
    return ((this.yawDeg % 360) + 360) % 360
  }
  get piecePosition(): {x: number; z: number} {
    return {x: this.posX, z: this.posZ}
  }
  /** Per-edge outline colors, order [front, right, back, left]; front faces the doorway at 0°. */
  get outlineEdgeColors(): string[] {
    return this.edgeRed.map((r) => (r ? "red" : "green"))
  }
  get outlineEdgeColorMap(): {[edge: string]: string} {
    const m: {[edge: string]: string} = {}
    EDGE_NAMES.forEach((n, i) => (m[n] = this.edgeRed[i] ? "red" : "green"))
    return m
  }
  /** True when every gap is >= clearanceCm. */
  get isClear(): boolean {
    return this.hits.length === 0 || this.hits[0].gap >= this.clearanceCm
  }
  /** Gap to the nearest obstacle (any), cm. */
  get nearestGapCm(): number {
    return this.hits.length ? this.hits[0].gap : Number.MAX_VALUE
  }
  get nearestObstacle(): string {
    return this.hits.length ? this.hits[0].obstacle : ""
  }
  /** All gaps, nearest first: [{obstacle, gap, edge}]. */
  get clearances(): {obstacle: string; gap: number; edge: EdgeName}[] {
    return this.hits.map((h) => ({obstacle: h.obstacle, gap: h.gap, edge: h.edge}))
  }
  get gapLabelVisible(): boolean {
    return this.gapAlpha > 0
  }
  get gapLabelText(): string {
    return this.lastGapText
  }
  get gapLabelAlpha(): number {
    return this.gapAlpha
  }
  get behindArrowVisible(): boolean {
    return this._behind
  }
  get behindArrowAngleDeg(): number {
    return this._behindAngle
  }
  get clearanceThresholdCm(): number {
    return this.clearanceCm
  }
  get roomSpec(): RoomSpec {
    return this.room3()
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Internals
  // ════════════════════════════════════════════════════════════════════════════

  private yawRad(): number {
    return (this.yawDeg * Math.PI) / 180
  }

  private room3(): RoomSpec {
    const maxZ = this.startInsetCm
    return {minX: -ROOM_WIDTH_CM / 2, maxX: ROOM_WIDTH_CM / 2, minZ: maxZ - ROOM_DEPTH_CM, maxZ}
  }

  /** Start spot of the piece: the room centre (room-local floor cm). */
  private startSpot(): {x: number; z: number} {
    const R = this.room3()
    return {x: (R.minX + R.maxX) / 2, z: (R.minZ + R.maxZ) / 2}
  }

  /**
   * Places the room around the user's start pose, once: the head stands at
   * room-local (0, 0) and the room's -Z runs along the head's horizontal gaze.
   * Only world X, Z and yaw change; the room's height (floor below the eye) is
   * kept. With the head at the world origin facing -Z this sets exactly the
   * authored transform (position (0, y, 0), yaw 0), so it is a no-op.
   */
  private anchorRoomToHead(): void {
    if (!this.camT) return
    const rt = this.room.getTransform()
    const head = this.camT.getWorldPosition()
    const gaze = this.camT.back // view direction (the camera looks along its -Z)
    rt.setWorldPosition(new vec3(head.x, rt.getWorldPosition().y, head.z))
    // Looking (almost) straight up or down gives no heading: keep the authored yaw.
    if (Math.sqrt(gaze.x * gaze.x + gaze.z * gaze.z) > 1e-3) {
      rt.setWorldRotation(quat.angleAxis(Math.atan2(-gaze.x, -gaze.z), vec3.up()))
    }
  }

  /** Coffee table footprint center: against the far wall, in the far right corner. */
  private coffeeTableCenter(): vec3 {
    const R = this.room3()
    return new vec3(R.maxX - COFFEE_TABLE.w / 2, 0, R.minZ + COFFEE_TABLE.d / 2)
  }

  /** Coffee table, then every placed piece as an oriented rectangle named "Placed_<id>". */
  private obstacles(): Obstacle[] {
    const p = this.coffeeTableCenter()
    const out: Obstacle[] = [{name: "CoffeeTable", cx: p.x, cz: p.z, w: COFFEE_TABLE.w, d: COFFEE_TABLE.d}]
    for (const pp of this.placed) {
      const def = this.defOf(pp.key)
      if (!def) continue
      out.push({name: `Placed_${pp.id}`, cx: pp.x, cz: pp.z, w: def.w, d: def.d, yaw: (pp.yawDeg * Math.PI) / 180})
    }
    return out
  }

  private defOf(key: string): PieceDef | null {
    return this.pieces.find((q) => q.key === key) ?? null
  }

  /** Make a placed piece's state the current piece (no nudge: it already stands on a valid spot). */
  private takeOver(pp: PlacedPiece): void {
    this._currentId = pp.id
    this.pieceIndex = this.pieces.findIndex((q) => q.key === pp.key)
    this.posX = pp.x
    this.posZ = pp.z
    this.yawDeg = pp.yawDeg
    this._colorIndex = pp.colorIndex
  }

  private placedColorOf(id: number): number {
    const p = this.placed.find((q) => q.id === id)
    return p ? p.colorIndex : 0
  }

  /** Tint of a variant's (current-piece) visual, made on first use. */
  private tintOf(key: string): PieceTint | null {
    if (!this.tints[key]) {
      const v = this.pieceVisuals[key]
      if (!v) return null
      this.tints[key] = new PieceTint(v)
    }
    return this.tints[key]
  }

  /** The colour strip: a child of the panel, so it follows its offset, size and visibility. */
  private buildColorStrip(): void {
    const so = global.scene.createSceneObject("ColorStrip")
    so.setParent(this.panelUI.getSceneObject())
    this.colorStrip = so.createComponent(SidleColorStripUI.getTypeName()) as SidleColorStripUI
    this.colorStrip.build(COLOR_SWATCHES, -this.panelUI.panelHeight / 2)
    this.colorStrip.onSwatch.add((i: number) => this.setColor(i))
  }

  // ── Placed pieces: scene slots (Update 6) ──────────────────────────────────
  private createSlot(pp: PlacedPiece): void {
    const root = this.group(this.room, "PlacedPiece")
    const outline = this.group(root, "PlacedOutline")
    const grey = this.unlitCache.get(this.placedOutlineColor)
    const edges: SceneObject[] = []
    for (const n of ["PlacedEdge_Front", "PlacedEdge_Right", "PlacedEdge_Back", "PlacedEdge_Left"]) {
      edges.push(makeBox(outline, n, new vec3(0, 0.3, 0), new vec3(1, 0.4, 1), grey))
    }
    const grab = this.group(root, "PlacedGrab")
    const collider = grab.createComponent("Physics.ColliderComponent") as ColliderComponent
    collider.debugDrawEnabled = this.debugColliders
    const slot: PlacedSlot = {id: pp.id, root, visual: null, edges, grab, collider, tint: null}
    const inter = grab.createComponent(Interactable.getTypeName()) as Interactable
    inter.onTriggerStart.add((e: InteractorEvent) => this.onPlacedGrabStart(slot, e))
    inter.onTriggerUpdate.add((e: InteractorEvent) => {
      if (this.slotDrag === slot) this.onGrabUpdate(e)
    })
    const end = () => {
      if (this.slotDrag !== slot) return
      this.slotDrag = null
      this.endDrag()
    }
    inter.onTriggerEnd.add(end)
    inter.onTriggerEndOutside.add(end)
    inter.onTriggerCanceled.add(end)
    this.slots.push(slot)
    this.fillSlot(slot, pp)
  }

  private destroySlot(id: number): void {
    const slot = this.slots.find((s) => s.id === id)
    if (!slot) return
    this.slots.splice(this.slots.indexOf(slot), 1)
    if (this.slotDrag === slot) {
      this.slotDrag = null
      this.endDrag()
    }
    slot.root.destroy()
  }

  /** Show `pp` in `slot`: its own visual copy, outline, collider, transform and names. */
  private fillSlot(slot: PlacedSlot, pp: PlacedPiece): void {
    const def = this.defOf(pp.key)!
    slot.id = pp.id
    slot.root.name = `PlacedPiece_${pp.id}`
    slot.grab.name = `PlacedGrab_${pp.id}`
    const t = slot.root.getTransform()
    t.setLocalPosition(new vec3(pp.x, 0, pp.z))
    t.setLocalRotation(quat.angleAxis((pp.yawDeg * Math.PI) / 180, vec3.up()))
    if (slot.visual) slot.visual.destroy()
    slot.visual = this.group(slot.root, `PlacedVisual_${def.key}`)
    this.buildVisual(slot.visual, def)
    // The placed piece keeps its own colour (its own visual copy, its own material clones).
    slot.tint = new PieceTint(slot.visual)
    slot.tint.apply(pp.colorIndex, this._tintMethod)
    const specs = outlineSpecs(def.w, def.d, this.outlineWidthCm)
    for (let i = 0; i < 4; i++) {
      const et = slot.edges[i].getTransform()
      et.setLocalPosition(specs[i].pos)
      et.setLocalScale(specs[i].size)
    }
    const shape = Shape.createBoxShape()
    shape.size = new vec3(def.w, def.h, def.d)
    slot.collider.shape = shape
    slot.grab.getTransform().setLocalPosition(new vec3(0, def.h / 2, 0))
  }

  /**
   * A pinch on a placed piece makes it current; the current piece becomes
   * placed where it stands (shown by this same slot, so the pinch keeps
   * dragging the new current piece without a break).
   */
  private onPlacedGrabStart(slot: PlacedSlot, e: InteractorEvent): void {
    if (this._dragging) return
    const idx = this.placed.findIndex((p) => p.id === slot.id)
    if (idx < 0) return
    const target = this.placed[idx]
    const prev: PlacedPiece = {id: this._currentId, key: this.currentPieceKey, x: this.posX, z: this.posZ, yawDeg: this.yawDeg, colorIndex: this._colorIndex}
    this.placed.splice(idx, 1)
    this.placed.push(prev)
    this.takeOver(target)
    this.fillSlot(slot, prev)
    this.slotDrag = slot
    this.onGrabStart(e)
  }

  private resolve(x: number, z: number, yaw: number): {x: number; z: number} {
    const p = this.pieces[this.pieceIndex]
    return resolvePlacement(x, z, p.w, p.d, yaw, this.room3(), this.obstacles())
  }

  /**
   * Group the offered pieces into types. Built-ins are offered when
   * showPlaceholderPieces is on, or (with a warning) when there is no imported piece.
   */
  /** Thumbnail texture for a piece, matched by file name; null for built-ins and missing thumbnails. */
  private thumbnailFor(key: string): Texture | null {
    const p = this.pieces.find((q) => q.key === key)
    if (!p || !p.entry || !p.entry.thumbnail) return null
    const want = fileBaseName(p.entry.thumbnail)
    for (const t of this.thumbnailTextures ?? []) {
      if (t && (t.name === want || fileBaseName(t.name) === want)) return t
    }
    return null
  }

  private renderGallery(): void {
    if (!this._galleryOpen || !this.galleryUI) return
    const view: GalleryView = {
      types: this.types.map((g) => ({type: g.type, label: g.type.charAt(0).toUpperCase() + g.type.slice(1)})),
      activeType: this._galleryType,
      page: this._galleryPage,
      pageCount: this.galleryPageCount,
      tiles: this.galleryPageKeys.map((key) => {
        const p = this.pieces.find((q) => q.key === key)!
        const c = SWATCH[key] ?? SWATCH_IMPORTED
        return {key, name: p.name, thumbnail: this.thumbnailFor(key), swatch: new vec4(c[0], c[1], c[2], 1), current: key === this.currentPieceKey}
      }),
    }
    this.galleryUI.render(view)
  }

  private rebuildOffer(): void {
    let placeholders = this.showPlaceholderPieces
    this._placeholderFallback = false
    if (!placeholders && !this.pieces.some((p) => !!p.entry)) {
      this.addWarning("showPlaceholderPieces is off but no imported piece is available; falling back to the built-in pieces")
      placeholders = true
      this._placeholderFallback = true
    }
    // this.pieces is built-ins first, then catalog order, so filtering keeps the variant order.
    const offered = this.pieces.filter((p) => placeholders || !!p.entry)
    const order = TYPE_ORDER.slice()
    for (const p of offered) if (order.indexOf(p.type) < 0) order.push(p.type)
    this.types = order
      .map((type) => ({type, keys: offered.filter((p) => p.type === type).map((p) => p.key)}))
      .filter((g) => g.keys.length > 0)
    if (this._galleryOpen) {
      // Offer changed while the gallery is open: keep it on a valid type and page.
      if (this.variantKeys(this._galleryType).length === 0) this._galleryType = this.types[0].type
      this._galleryPage = Math.min(this._galleryPage, this.galleryPageCount - 1)
    }
  }

  private firstKey(): string {
    return this.types[0].keys[0]
  }

  private isOffered(key: string): boolean {
    return this.types.some((g) => g.keys.indexOf(key) >= 0)
  }

  /** Index of the current piece's type in `types`; -1 if it is not offered. */
  private currentTypeIndex(): number {
    const key = this.currentPieceKey
    return this.types.findIndex((g) => g.keys.indexOf(key) >= 0)
  }

  /** Make `key` current in the same spot + facing, nudged to the nearest valid spot if it would overlap. */
  private select(key: string): void {
    this.pieceIndex = this.pieces.findIndex((p) => p.key === key)
    const p = this.resolve(this.posX, this.posZ, this.yawRad())
    this.posX = p.x
    this.posZ = p.z
  }

  private showPiece(key: string): void {
    const idx = this.pieces.findIndex((p) => p.key === key)
    if (idx < 0 || idx === this.pieceIndex) return
    this.select(key)
    this.applyAll()
  }

  private rotateBy(deg: number): void {
    this.yawDeg = this.yawDeg + deg
    const p = this.resolve(this.posX, this.posZ, this.yawRad())
    this.posX = p.x
    this.posZ = p.z
    this.applyAll()
  }

  private camLocal(): vec3 | null {
    if (!this.camT) return null
    return this.room.getTransform().getInvertedWorldTransform().multiplyPoint(this.camT.getWorldPosition())
  }

  // ── Dragging (SIK Interactable; ray projected onto the floor plane) ────────
  private floorHit(e: InteractorEvent): vec3 | null {
    const it = e.interactor
    if (!it) return null
    const inv = this.room.getTransform().getInvertedWorldTransform()
    const start = it.startPoint
    const dir = it.direction
    if (start && dir) {
      const o = inv.multiplyPoint(start)
      const d = inv.multiplyDirection(dir)
      if (d.y < -0.02) {
        const t = -o.y / d.y
        if (t > 0 && t < 3000) return o.add(d.uniformScale(t))
      }
    }
    const pc = it.planecastPoint ?? it.endPoint ?? start
    if (pc) {
      const l = inv.multiplyPoint(pc)
      return new vec3(l.x, 0, l.z)
    }
    return null
  }

  private onGrabStart(e: InteractorEvent): void {
    const hit = this.floorHit(e)
    this.dragOffset = hit ? new vec3(this.posX - hit.x, 0, this.posZ - hit.z) : new vec3(0, 0, 0)
    this.beginDrag()
  }

  private onGrabUpdate(e: InteractorEvent): void {
    if (!this._dragging || !this.dragOffset) return
    const hit = this.floorHit(e)
    if (!hit) return
    // Continuous move: never jumps through a placed piece (same as setPiecePosition when nothing is placed).
    const def = this.pieces[this.pieceIndex]
    const p = resolveDrag(this.posX, this.posZ, hit.x + this.dragOffset.x, hit.z + this.dragOffset.z, def.w, def.d, this.yawRad(), this.room3(), this.obstacles())
    this.posX = p.x
    this.posZ = p.z
    this.applyAll()
  }

  // ── Panel drag (grab bar) ──────────────────────────────────────────────────
  /** World point the interactor holds: the grab point carried along the current ray. */
  private panelRayPoint(e: InteractorEvent, rayDist: number): vec3 | null {
    const it = e.interactor
    if (!it || !it.startPoint || !it.direction) return null
    return it.startPoint.add(it.direction.normalize().uniformScale(rayDist))
  }

  private onPanelGrabStart(e: InteractorEvent): void {
    const it = e.interactor
    if (!it || !it.startPoint || !this.camT) return
    const hit = it.targetHitInfo?.hit?.position ?? this.panelUI.getSceneObject().getTransform().getWorldPosition()
    const rayDist = Math.max(1, hit.distance(it.startPoint))
    const p = this.panelRayPoint(e, rayDist)
    if (!p) return
    this.panelGrab = {rayDist, startOffset: this.panelOffset, startPoint: worldToOffset(headFrame(this.camT), p)}
    this._panelDragging = true
    this.panelUI.setGrabBarActive(true)
  }

  private onPanelGrabUpdate(e: InteractorEvent): void {
    if (!this._panelDragging || !this.panelGrab || !this.camT) return
    const p = this.panelRayPoint(e, this.panelGrab.rayDist)
    if (!p) return
    const now = worldToOffset(headFrame(this.camT), p)
    const g = this.panelGrab
    let dh = now.horizontalDeg - g.startPoint.horizontalDeg
    if (dh > 180) dh -= 360
    if (dh < -180) dh += 360
    this._panelOffset = clampOffset({
      distanceCm: g.startOffset.distanceCm + (now.distanceCm - g.startPoint.distanceCm),
      horizontalDeg: g.startOffset.horizontalDeg + dh,
      verticalDeg: g.startOffset.verticalDeg + (now.verticalDeg - g.startPoint.verticalDeg),
    })
    this.pushPanelOffset(true)
  }

  /** Release: keep the new offset; the panel follows at it with the usual delay. */
  private onPanelGrabEnd(): void {
    if (!this._panelDragging) return
    this._panelDragging = false
    this.panelGrab = null
    this.panelUI.setGrabBarActive(false)
    this.pushPanelOffset(false)
  }

  /** The gallery follows at the same offset as the panel. */
  private pushPanelOffset(snap: boolean): void {
    if (this.panelFollow) this.panelFollow.setOffset(this._panelOffset, snap)
    if (this.galleryFollow) this.galleryFollow.setOffset(this._panelOffset, snap)
  }

  // ── Per-frame view sync ────────────────────────────────────────────────────
  private tick(): void {
    if (!this.ready) return
    if (this.gapFading) {
      this.gapAlpha = Math.max(0, this.gapAlpha - getDeltaTime() / Math.max(0.05, this.gapFadeSeconds))
      if (this.gapAlpha <= 0) this.gapFading = false
    }
    this.applyAll()
  }

  private applyAll(): void {
    if (!this.ready) return
    const def = this.pieces[this.pieceIndex]
    const yaw = this.yawRad()

    // Piece transform + visibility
    const pt = this.pieceRoot.getTransform()
    pt.setLocalPosition(new vec3(this.posX, 0, this.posZ))
    pt.setLocalRotation(quat.angleAxis(yaw, vec3.up()))
    for (const p of this.pieces) this.pieceVisuals[p.key].enabled = p.key === def.key
    // Fabric colour follows the current piece across variants (no-op when unchanged).
    const tint = this.tintOf(def.key)
    if (tint) tint.apply(this._colorIndex, this._tintMethod)
    if (this.colorStrip) this.colorStrip.setSelected(this._colorIndex)
    if (this.colliderKey !== def.key) {
      const shape = Shape.createBoxShape()
      shape.size = new vec3(def.w, def.h, def.d)
      this.collider.shape = shape
      this.hitObj.getTransform().setLocalPosition(new vec3(0, def.h / 2, 0))
      this.colliderKey = def.key
    }

    // Clearance
    this.hits = measureClearances(this.posX, this.posZ, def.w, def.d, yaw, this.room3(), this.obstacles())
    const nearest = this.hits[0]
    const tooClose = nearest && nearest.gap < this.clearanceCm
    this.edgeRed = [false, false, false, false]
    if (tooClose) this.edgeRed[EDGE_NAMES.indexOf(nearest.edge)] = true

    // Outline (follows piece; per-edge color)
    const ot = this.outlineRoot.getTransform()
    ot.setLocalPosition(new vec3(this.posX, 0, this.posZ))
    ot.setLocalRotation(quat.angleAxis(yaw, vec3.up()))
    this.layoutOutline(def.w, def.d)

    const cam = this.camLocal()

    // Gap number
    if (tooClose) {
      this.gapAlpha = 1
      this.gapFading = false
      this.lastGapText = `${Math.floor(nearest.gap)} cm`
      let mx = (nearest.piecePoint.x + nearest.obstaclePoint.x) / 2
      let mz = (nearest.piecePoint.z + nearest.obstaclePoint.z) / 2
      let my = 0.6
      if (nearest.gap < 20) {
        // too narrow to fit the number on the floor between them: lift it just above the
        // facing edge (and above the coffee table), pulled back into the room so no wall hides it
        const n = this.edgeNormal(nearest.edge, yaw)
        mx -= n.x * 10
        mz -= n.z * 10
        my = Math.max(def.h, 45) + 2
      }
      this.lastGapPos = new vec3(mx, my, mz)
    } else if (this.gapAlpha > 0 && !this.gapFading) {
      this.gapFading = true
    }
    if (this.gapAlpha > 0) {
      const gyaw = cam ? Math.atan2(cam.x - this.lastGapPos.x, cam.z - this.lastGapPos.z) : 0
      this.labelsUI.setGap(this.lastGapText, this.lastGapPos, gyaw, this.gapAlpha)
      this.labelsUI.setGapVisible(true)
    } else {
      this.labelsUI.setGapVisible(false)
    }

    // Dimension labels
    this.labelsUI.setDimensions(def.w, def.d, def.h)
    this.labelsUI.setDimensionsVisible(this.labelsVisible)
    if (this.labelsVisible) this.placeDimensionLabels(def, yaw, cam)

    // Panel
    this.panelUI.setPieceName(def.name)
    this.panelUI.setPieceDetail(this.currentPieceDetail)
    this.panelUI.setDoorFit(this.doorFitText, this.currentFitsThroughDoor)
    this.panelUI.setCompareEnabled(this.compareEnabled)
    this.panelUI.setAddEnabled(this.canAdd)
    this.panelUI.setRemoveEnabled(this.canRemove)
    // Size view in step every frame (keeps "-"/"+" greyed out after the panel was hidden by the gallery)
    this.panelUI.setPanelScale(this.panelScale, this.canScaleDown, this.canScaleUp)
    this.panelUI.setMeasureOn(this._measureOn)
    this.updateBehindArrow()
  }

  private edgeNormal(edge: EdgeName, yaw: number): {x: number; z: number} {
    const l = edge === "front" ? [0, 1] : edge === "back" ? [0, -1] : edge === "right" ? [1, 0] : [-1, 0]
    return rotateLocal(l[0], l[1], yaw)
  }

  private placeDimensionLabels(def: PieceDef, yaw: number, cam: vec3 | null): void {
    // Choose the long/short edges nearest the viewer so labels sit on the visible side.
    const c = cam ?? new vec3(0, 160, 0)
    const toCam = toLocal2(c.x - this.posX, c.z - this.posZ, yaw)
    const sz = toCam.z >= 0 ? 1 : -1 // front or back edge carries width
    const sx = toCam.x >= 0 ? 1 : -1 // right or left edge carries depth
    const out = 28
    const y = 14
    const wLocal = rotateLocal(0, sz * (def.d / 2 + out), yaw)
    const dLocal = rotateLocal(sx * (def.w / 2 + out), 0, yaw)
    const hLocal = rotateLocal(-sx * (def.w / 2 + out * 0.7), sz * (def.d / 2 + out * 0.7), yaw)
    const pos = [
      new vec3(this.posX + wLocal.x, y, this.posZ + wLocal.z),
      new vec3(this.posX + dLocal.x, y, this.posZ + dLocal.z),
      new vec3(this.posX + hLocal.x, y + 4, this.posZ + hLocal.z),
    ]
    // keep labels inside the room so they never poke through a wall
    const R = this.room3()
    const m = 32
    for (const p of pos) {
      p.x = Math.max(R.minX + m, Math.min(R.maxX - m, p.x))
      p.z = Math.max(R.minZ + m, Math.min(R.maxZ - m, p.z))
    }
    for (let i = 0; i < 3; i++) {
      const lyaw = Math.atan2(c.x - pos[i].x, c.z - pos[i].z)
      this.labelsUI.placeDimensionLabel(i, pos[i], lyaw)
    }
  }

  private updateBehindArrow(): void {
    if (!this.camT) {
      this._behind = false
      this.panelUI.setBehindArrow(false, 0)
      return
    }
    const camPos = this.camT.getWorldPosition()
    const piecePos = this.pieceRoot.getTransform().getWorldPosition()
    const view = this.camT.back
    const fwd = new vec3(view.x, 0, view.z)
    const toPiece = new vec3(piecePos.x - camPos.x, 0, piecePos.z - camPos.z)
    if (fwd.length < 1e-4 || toPiece.length < 1e-4) {
      this._behind = false
      this.panelUI.setBehindArrow(false, 0)
      return
    }
    const f = fwd.normalize()
    const r = new vec3(-f.z, 0, f.x) // right of view direction (looking down -Z, right = +X)
    const d = toPiece.normalize()
    const fwdComp = d.dot(f)
    const rightComp = d.dot(r)
    this._behind = fwdComp < 0
    this._behindAngle = (Math.atan2(-rightComp, fwdComp) * 180) / Math.PI
    this.panelUI.setBehindArrow(this._behind, this._behindAngle)
  }

  // ── Builders ───────────────────────────────────────────────────────────────
  private lit(r: number, g: number, b: number): Material {
    return this.litCache.get(new vec4(r, g, b, 1))
  }

  private group(parent: SceneObject, name: string): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    return so
  }

  private buildRoom(): void {
    const R = this.room3()
    const W = ROOM_WIDTH_CM
    const D = ROOM_DEPTH_CM
    const H = this.wallHeight
    const T = 10 // wall thickness (outside the wall lines)
    const cz = (R.minZ + R.maxZ) / 2
    const wall = this.litCache.get(this.wallColor)
    const accent = this.litCache.get(this.accentWallColor)
    // Flat (unlit) floor: its colour on screen is exactly floorColor, so outline/gap-number contrast is predictable.
    const floorMat = this.unlitCache.get(this.floorColor)

    makeBox(this.room, "Floor", new vec3(0, -1, cz), new vec3(W + 2 * T, 2, D + 2 * T), floorMat)

    const walls = this.group(this.room, "Walls")
    makeBox(walls, "Wall_Left", new vec3(R.minX - T / 2, H / 2, cz), new vec3(T, H, D + 2 * T), wall)
    makeBox(walls, "Wall_Right", new vec3(R.maxX + T / 2, H / 2, cz), new vec3(T, H, D + 2 * T), wall)
    makeBox(walls, "Wall_Far", new vec3(0, H / 2, R.minZ - T / 2), new vec3(W + 2 * T, H, T), accent)
    // Near (doorway) wall: two segments + lintel around a centered opening
    const half = this.doorWidth / 2
    const segW = W / 2 + T - half
    const nz = R.maxZ + T / 2
    makeBox(walls, "Wall_Near_Left", new vec3(-(half + segW / 2), H / 2, nz), new vec3(segW, H, T), wall)
    makeBox(walls, "Wall_Near_Right", new vec3(half + segW / 2, H / 2, nz), new vec3(segW, H, T), wall)
    makeBox(
      walls,
      "Wall_Near_Lintel",
      new vec3(0, (this.doorHeight + H) / 2, nz),
      new vec3(this.doorWidth, H - this.doorHeight, T),
      wall,
    )

    // Door frame around the opening (light tone). Same boxes as the old trim, grouped as RoomDoorFrame at identity,
    // so the opening stays doorWidth x doorHeight.
    if (this.doorway) {
      this.doorway.getTransform().setLocalPosition(new vec3(0, 0, R.maxZ))
      const frameObj = this.group(this.doorway, "RoomDoorFrame")
      const trim = this.litCache.get(this.frameColor)
      makeBox(frameObj, "Jamb_Left", new vec3(-half - 2.5, this.doorHeight / 2, T / 2), new vec3(5, this.doorHeight, T + 4), trim)
      makeBox(frameObj, "Jamb_Right", new vec3(half + 2.5, this.doorHeight / 2, T / 2), new vec3(5, this.doorHeight, T + 4), trim)
      makeBox(frameObj, "Head", new vec3(0, this.doorHeight + 2.5, T / 2), new vec3(this.doorWidth + 10, 5, T + 4), trim)
      makeBox(frameObj, "Threshold", new vec3(0, 0.3, T / 2), new vec3(this.doorWidth, 0.6, T + 4), trim)
    }

    this.buildRoomDecor(R, half)

    // Coffee table (fixed obstacle) — top + legs. Same size and place; light wood colours (Update 7: nothing dark).
    if (this.coffeeTable) {
      const ct = this.coffeeTable
      ct.getTransform().setLocalPosition(this.coffeeTableCenter())
      const top = this.lit(0.84, 0.76, 0.66)
      const leg = this.lit(0.78, 0.7, 0.6)
      const {w, d, h} = COFFEE_TABLE
      makeBox(ct, "Top", new vec3(0, h - 2, 0), new vec3(w, 4, d), top)
      const lx = w / 2 - 4
      const lz = d / 2 - 4
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        makeBox(ct, "Leg", new vec3(sx * lx, (h - 4) / 2, sz * lz), new vec3(5, h - 4, 5), leg)
      }
    }
  }

  /**
   * Update 7 decoration under RoomDecor: plank lines, baseboards, a window in the
   * left long wall and a rug. Plain visuals only: no colliders, not obstacles,
   * not measured. Everything sits on or against the room's existing surfaces
   * and stays at or below 0.2 cm above the floor (the outline is 0.1-0.5 cm,
   * the gap number 0.6 cm).
   */
  private buildRoomDecor(R: RoomSpec, doorHalf: number): void {
    const W = R.maxX - R.minX
    const D = R.maxZ - R.minZ
    const cz = (R.minZ + R.maxZ) / 2
    const decor = this.group(this.room, "RoomDecor")

    // Thin plank lines running front to back (flat, unlit like the floor).
    const plankMat = this.unlitCache.get(this.plankLineColor)
    const step = Math.max(5, this.plankWidthCm)
    const n = Math.floor(W / step)
    for (let i = 1; i < n; i++) {
      makeBox(decor, `RoomFloorPlank_${i}`, new vec3(R.minX + i * step, 0.05, cz), new vec3(0.8, 0.1, D), plankMat)
    }

    // Baseboards: 8 cm tall, 1.5 cm deep, along the bottom of every wall (the doorway wall in two parts).
    const bbMat = this.litCache.get(this.baseboardColor)
    const bh = 8
    const bd = 1.5
    makeBox(decor, "RoomBaseboard_Left", new vec3(R.minX + bd / 2, bh / 2, cz), new vec3(bd, bh, D), bbMat)
    makeBox(decor, "RoomBaseboard_Right", new vec3(R.maxX - bd / 2, bh / 2, cz), new vec3(bd, bh, D), bbMat)
    makeBox(decor, "RoomBaseboard_Far", new vec3(0, bh / 2, R.minZ + bd / 2), new vec3(W, bh, bd), bbMat)
    const jambOuter = doorHalf + 5 // the door frame jambs are 5 cm wide outside the opening
    const segW = R.maxX - jambOuter
    makeBox(decor, "RoomBaseboard_NearLeft", new vec3(-(jambOuter + segW / 2), bh / 2, R.maxZ - bd / 2), new vec3(segW, bh, bd), bbMat)
    makeBox(decor, "RoomBaseboard_NearRight", new vec3(jambOuter + segW / 2, bh / 2, R.maxZ - bd / 2), new vec3(segW, bh, bd), bbMat)

    // Window in the left long wall: light frame, cross mullion and sill around a pale, bright pane.
    const win = this.group(decor, "RoomWindow")
    win.getTransform().setLocalPosition(new vec3(R.minX, 150, cz))
    const ww = (D * 4) / 15 // along the wall (Z): scales with the room depth (160 cm in a 600 cm room)
    const wh = 120
    const fb = 6 // frame bar width
    const fd = 3 // frame depth into the room
    const frame = this.litCache.get(this.frameColor)
    makeBox(win, "RoomWindowPane", new vec3(0.5, 0, 0), new vec3(1, wh, ww), this.unlitCache.get(this.windowPaneColor))
    makeBox(win, "RoomWindowFrame_Top", new vec3(fd / 2, wh / 2 + fb / 2, 0), new vec3(fd, fb, ww + 2 * fb), frame)
    makeBox(win, "RoomWindowFrame_Bottom", new vec3(fd / 2, -wh / 2 - fb / 2, 0), new vec3(fd, fb, ww + 2 * fb), frame)
    makeBox(win, "RoomWindowFrame_Front", new vec3(fd / 2, 0, ww / 2 + fb / 2), new vec3(fd, wh, fb), frame)
    makeBox(win, "RoomWindowFrame_Back", new vec3(fd / 2, 0, -ww / 2 - fb / 2), new vec3(fd, wh, fb), frame)
    makeBox(win, "RoomWindowMullion_V", new vec3(fd / 2, 0, 0), new vec3(fd, wh, 3), frame)
    makeBox(win, "RoomWindowMullion_H", new vec3(fd / 2, 0, 0), new vec3(fd, 3, ww), frame)
    makeBox(win, "RoomWindowSill", new vec3(4, -wh / 2 - fb - 1.5, 0), new vec3(8, 3, ww + 2 * fb + 8), frame)

    // Flat rug in the middle (optional): just above the plank lines, below the outline.
    // Scales with the room: 0.6 W x D/3, D/30 toward the doorway (300 x 200, +20 in a 500 x 600 room).
    if (this.showRug) {
      makeBox(decor, "RoomRug", new vec3(0, 0.15, cz + D / 30), new vec3(W * 0.6, 0.1, D / 3), this.unlitCache.get(this.rugColor))
    }
  }

  private bundledCatalogText(): string | null {
    return this.catalog ? this.catalog.getString() : null
  }

  /** One hidden SceneObject per enabled catalog entry, built once, appended after the built-ins. */
  private buildImportedPieces(text: string | null): void {
    const {entries, warnings} = parseCatalog(text)
    for (const w of warnings) this.addWarning(w)
    this.prefabs = {}
    for (const p of this.modelPrefabs ?? []) if (p) this.prefabs[p.name] = p
    const fallback = this.lit(0.78, 0.78, 0.8)
    for (const e of entries) {
      const key = IMPORTED_PREFIX + e.id
      const root = this.group(this.pieceRoot, `Piece_${key}`)
      root.enabled = false
      const r = buildImportedVisual(root, e, this.prefabs[glbBaseName(e.glb)] ?? null, fallback)
      if (r.warning) this.addWarning(r.warning)
      this.pieceVisuals[key] = root
      this.modelLoaded[key] = r.model
      const type = e.category.trim().toLowerCase() || "other"
      this.pieces.push({key, name: e.name, type, w: e.widthCm, d: e.depthCm, h: e.heightCm, entry: e})
    }
  }

  private addWarning(msg: string): void {
    this._warnings.push(msg)
    warn(msg)
  }

  private buildPieces(): void {
    for (const def of BUILT_IN) {
      const root = this.group(this.pieceRoot, `Piece_${def.key}`)
      this.pieceVisuals[def.key] = root
      this.buildVisual(root, def)
    }
  }

  /** Build a piece's visual under `root` (piece-local: floor at y = 0, front = +Z); used for placed copies too. */
  private buildVisual(root: SceneObject, def: PieceDef): void {
    if (def.entry) {
      buildImportedVisual(root, def.entry, this.prefabs[glbBaseName(def.entry.glb)] ?? null, this.lit(0.78, 0.78, 0.8))
    } else if (def.key === "SofaA") this.buildSofa(root, def, [0.82, 0.82, 0.84], [0.9, 0.9, 0.92])
    else if (def.key === "SofaB") this.buildSofa(root, def, [0.86, 0.75, 0.6], [0.93, 0.84, 0.7])
    else if (def.key === "Bed") this.buildBed(root, def)
    else this.buildTable(root, def)
  }

  private buildSofa(root: SceneObject, def: PieceDef, body: number[], cushion: number[]): void {
    const {w, d, h} = def
    const bodyM = this.lit(body[0], body[1], body[2])
    const cushM = this.lit(cushion[0], cushion[1], cushion[2])
    const armW = 18
    const baseH = 40
    const backD = 20
    makeBox(root, "Base", new vec3(0, baseH / 2, 0), new vec3(w, baseH, d), bodyM)
    makeBox(root, "Back", new vec3(0, h / 2, -d / 2 + backD / 2), new vec3(w, h, backD), bodyM)
    makeBox(root, "Arm_L", new vec3(-w / 2 + armW / 2, 31, 0), new vec3(armW, 62, d), bodyM)
    makeBox(root, "Arm_R", new vec3(w / 2 - armW / 2, 31, 0), new vec3(armW, 62, d), bodyM)
    const seatW = w - 2 * armW
    const seats = def.key === "SofaA" ? 3 : 2
    const cw = seatW / seats
    for (let i = 0; i < seats; i++) {
      const x = -seatW / 2 + cw * (i + 0.5)
      makeBox(root, `Seat_${i}`, new vec3(x, baseH + 6, backD / 2), new vec3(cw - 1.5, 12, d - backD - 2), cushM)
    }
  }

  private buildBed(root: SceneObject, def: PieceDef): void {
    const {w, d, h} = def
    const frame = this.lit(0.68, 0.57, 0.45)
    const mattress = this.lit(0.93, 0.93, 0.9)
    const duvet = this.lit(0.62, 0.72, 0.84)
    const pillow = this.lit(0.97, 0.97, 0.95)
    makeBox(root, "Frame", new vec3(0, 15, 0), new vec3(w, 30, d), frame)
    makeBox(root, "Mattress", new vec3(0, 30 + (h - 32) / 2, 0), new vec3(w - 4, h - 32, d - 4), mattress)
    makeBox(root, "Duvet", new vec3(0, h - 1, d * 0.12), new vec3(w - 2, 2, d * 0.7), duvet)
    makeBox(root, "Pillow_L", new vec3(-w / 4, h - 1, -d / 2 + 22), new vec3(w / 2 - 12, 2, 32), pillow)
    makeBox(root, "Pillow_R", new vec3(w / 4, h - 1, -d / 2 + 22), new vec3(w / 2 - 12, 2, 32), pillow)
  }

  private buildTable(root: SceneObject, def: PieceDef): void {
    const {w, d, h} = def
    const top = this.lit(0.86, 0.74, 0.58)
    const leg = this.lit(0.66, 0.55, 0.43)
    makeBox(root, "Top", new vec3(0, h - 2, 0), new vec3(w, 4, d), top)
    const lx = w / 2 - 6
    const lz = d / 2 - 6
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      makeBox(root, "Leg", new vec3(sx * lx, (h - 4) / 2, sz * lz), new vec3(6, h - 4, 6), leg)
    }
  }

  private buildOutline(): void {
    const names = ["Edge_Front", "Edge_Right", "Edge_Back", "Edge_Left"]
    const green = this.unlitCache.get(this.clearColor)
    for (const n of names) {
      const e = makeBox(this.outlineRoot, n, new vec3(0, 0.3, 0), new vec3(1, 0.4, 1), green)
      this.edges.push(e)
      this.edgeVisuals.push(e.getComponent("Component.RenderMeshVisual") as RenderMeshVisual)
    }
  }

  private layoutOutline(w: number, d: number): void {
    const green = this.unlitCache.get(this.clearColor)
    const red = this.unlitCache.get(this.tooCloseColor)
    const specs = outlineSpecs(w, d, this.outlineWidthCm)
    for (let i = 0; i < 4; i++) {
      const tr = this.edges[i].getTransform()
      tr.setLocalPosition(specs[i].pos)
      tr.setLocalScale(specs[i].size)
      this.edgeVisuals[i].mainMaterial = this.edgeRed[i] ? red : green
    }
  }

  private buildGrab(): void {
    this.hitObj = this.group(this.pieceRoot, "PieceGrab")
    this.collider = this.hitObj.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(220, 85, 90)
    this.collider.shape = shape
    this.collider.debugDrawEnabled = this.debugColliders
    this.hitObj.createComponent(Interactable.getTypeName())
  }
}

/** Outline edge boxes [front, right, back, left] around a w × d footprint, line width t. */
function outlineSpecs(w: number, d: number, t: number): {pos: vec3; size: vec3}[] {
  const off = t / 2 + 0.5 // sit just outside the footprint so the line stays visible
  return [
    {pos: new vec3(0, 0.3, d / 2 + off), size: new vec3(w + 2 * (off + t / 2), 0.4, t)},
    {pos: new vec3(w / 2 + off, 0.3, 0), size: new vec3(t, 0.4, d + 2 * (off + t / 2))},
    {pos: new vec3(0, 0.3, -d / 2 - off), size: new vec3(w + 2 * (off + t / 2), 0.4, t)},
    {pos: new vec3(-w / 2 - off, 0.3, 0), size: new vec3(t, 0.4, d + 2 * (off + t / 2))},
  ]
}

function toLocal2(dx: number, dz: number, yaw: number): {x: number; z: number} {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return {x: dx * c - dz * s, z: dx * s + dz * c}
}
