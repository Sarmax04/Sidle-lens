/**
 * SidleLazyFollow — keeps the control panel ~1 m in front of the user and a
 * bit below eye level, following with a slight delay and settling when the
 * user stops. Faces the user (yaw) with a small upward tilt.
 *
 * Owns: this SceneObject's world transform only.
 * Must not: touch UI content or experience state.
 */
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"

@component
export class SidleLazyFollow extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SidleLazyFollow – lazy head-follow</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Distance in front of the user, cm")
  @widget(new SliderWidget(40, 200, 1))
  distanceCm: number = 100

  @input
  @hint("How far below eye level, cm")
  @widget(new SliderWidget(0, 60, 1))
  dropCm: number = 20

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

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this.camT = WorldCameraFinderProvider.getInstance().getTransform()
    })
    this.createEvent("UpdateEvent").bind(() => this.tick())
  }

  private target(): {pos: vec3; rot: quat} | null {
    if (!this.camT) return null
    const camPos = this.camT.getWorldPosition()
    // Camera looks along its local -Z, i.e. transform.back (= -transform.forward).
    const view = this.camT.back
    let fwd = new vec3(view.x, 0, view.z)
    if (fwd.length < 1e-4) fwd = new vec3(0, 0, -1)
    fwd = fwd.normalize()
    const pos = camPos.add(fwd.uniformScale(this.distanceCm)).add(new vec3(0, -this.dropCm, 0))
    const toCam = camPos.sub(pos)
    const yaw = Math.atan2(toCam.x, toCam.z)
    const tilt = Math.atan2(this.dropCm, this.distanceCm)
    const rot = quat.angleAxis(yaw, vec3.up()).multiply(quat.angleAxis(-tilt, vec3.right()))
    return {pos, rot}
  }

  private tick(): void {
    const tg = this.target()
    if (!tg) return
    const t = this.getTransform()
    if (!this.snapped) {
      t.setWorldPosition(tg.pos)
      t.setWorldRotation(tg.rot)
      this.snapped = true
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
    const k2 = 1 - Math.exp(-getDeltaTime() * this.followSpeed * 1.5)
    t.setWorldRotation(quat.slerp(t.getWorldRotation(), tg.rot, k2))
  }
}
