/**
 * SidleLazyFollow — keeps the control panel at a head-space offset (distance,
 * horizontal angle, vertical angle; see SidlePanelOffset), following with a
 * slight delay and settling when the user stops. Faces the user (yaw + tilt).
 *
 * The offset is pushed in by SidleController (which owns it); until then the
 * Inspector defaults are used. While the panel is being dragged the controller
 * pushes with snap = true, so the panel tracks the hand without delay.
 *
 * Owns: this SceneObject's world transform only.
 * Must not: touch UI content or experience state.
 */
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {PanelOffset, clampOffset, facingRotation, headFrame, offsetToWorld} from "./SidlePanelOffset"

@component
export class SidleLazyFollow extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SidleLazyFollow – lazy head-follow</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Default distance from the head, cm (brief: 110; limits 60-140)")
  @widget(new SliderWidget(60, 140, 1))
  panelDistanceCm: number = 110

  @input
  @hint("Default angle below the head's forward direction, degrees (brief: 30; limits 10 above to 50 below)")
  @widget(new SliderWidget(-10, 50, 1))
  panelDropDeg: number = 30

  @input
  @hint("Follow responsiveness (higher = snappier, lower = lazier)")
  @widget(new SliderWidget(0.5, 10, 0.1))
  followSpeed: number = 2.5

  @input
  @hint("Panel does not move until its target drifts farther than this, cm")
  @widget(new SliderWidget(0, 40, 1))
  deadZoneCm: number = 8
  @ui.group_end

  private camT: Transform | null = null
  private snapped = false
  private moving = false
  private offset: PanelOffset | null = null
  private snapPending = false

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this.camT = WorldCameraFinderProvider.getInstance().getTransform()
    })
    this.createEvent("UpdateEvent").bind(() => this.tick())
  }

  /** The Inspector default offset: panelDistanceCm away, centred, panelDropDeg below forward (clamped to the limits). */
  get defaultOffset(): PanelOffset {
    return clampOffset({distanceCm: this.panelDistanceCm, horizontalDeg: 0, verticalDeg: -this.panelDropDeg})
  }

  /** Follow this offset from now on; snap = true places the panel there on the next frame without delay. */
  setOffset(o: PanelOffset, snap: boolean): void {
    this.offset = {distanceCm: o.distanceCm, horizontalDeg: o.horizontalDeg, verticalDeg: o.verticalDeg}
    if (snap) this.snapPending = true
  }

  private target(): {pos: vec3; rot: quat} | null {
    if (!this.camT) return null
    const frame = headFrame(this.camT)
    const pos = offsetToWorld(frame, this.offset ?? this.defaultOffset)
    return {pos, rot: facingRotation(pos, frame.pos)}
  }

  private tick(): void {
    const tg = this.target()
    if (!tg) return
    const t = this.getTransform()
    if (!this.snapped || this.snapPending) {
      t.setWorldPosition(tg.pos)
      t.setWorldRotation(tg.rot)
      this.snapped = true
      this.snapPending = false
      this.moving = false
      return
    }
    const cur = t.getWorldPosition()
    const distToTarget = cur.distance(tg.pos)
    if (!this.moving && distToTarget > this.deadZoneCm) this.moving = true
    if (this.moving) {
      const k = 1 - Math.exp(-getDeltaTime() * this.followSpeed)
      t.setWorldPosition(vec3.lerp(cur, tg.pos, k))
      if (distToTarget < 0.5) this.moving = false
    }
    // Keep facing the user from wherever the panel is right now.
    const face = facingRotation(t.getWorldPosition(), this.camT!.getWorldPosition())
    const k2 = 1 - Math.exp(-getDeltaTime() * this.followSpeed * 1.5)
    t.setWorldRotation(quat.slerp(t.getWorldRotation(), face, k2))
  }
}
