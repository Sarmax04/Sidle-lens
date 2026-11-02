/**
 * SidlePanelOffset — head-space offset math for the control panel (Update 3).
 *
 * An offset is { distanceCm, horizontalDeg, verticalDeg } from the head:
 * horizontalDeg > 0 is to the right of forward, verticalDeg > 0 above it.
 * "Head space" is the head position plus the head's yaw only (gravity
 * aligned): looking down at the panel does not push it further down.
 *
 * Owns: pure math only (no state, no scene objects).
 */

export interface PanelOffset {
  distanceCm: number
  horizontalDeg: number
  verticalDeg: number
}

/** Limits from the brief: 60-140 cm, within 40° of forward, 10° above to 50° below. */
export const PANEL_LIMITS = {
  minDistanceCm: 60,
  maxDistanceCm: 140,
  maxHorizontalDeg: 40,
  minVerticalDeg: -50,
  maxVerticalDeg: 10,
}

const DEG = Math.PI / 180

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

export function clampOffset(o: PanelOffset): PanelOffset {
  const L = PANEL_LIMITS
  return {
    distanceCm: clamp(o.distanceCm, L.minDistanceCm, L.maxDistanceCm),
    horizontalDeg: clamp(o.horizontalDeg, -L.maxHorizontalDeg, L.maxHorizontalDeg),
    verticalDeg: clamp(o.verticalDeg, L.minVerticalDeg, L.maxVerticalDeg),
  }
}

/** Gravity-aligned head frame: position, horizontal forward and right (world space). */
export function headFrame(head: Transform): {pos: vec3; fwd: vec3; right: vec3} {
  // The camera looks along its local -Z, i.e. transform.back.
  const view = head.back
  let fwd = new vec3(view.x, 0, view.z)
  if (fwd.length < 1e-4) {
    // Looking straight up/down: fall back to the head's up vector for the heading.
    const up = head.up
    fwd = new vec3(view.y > 0 ? up.x : -up.x, 0, view.y > 0 ? up.z : -up.z)
    if (fwd.length < 1e-4) fwd = new vec3(0, 0, -1)
  }
  fwd = fwd.normalize()
  const right = fwd.cross(vec3.up()).normalize()
  return {pos: head.getWorldPosition(), fwd, right}
}

export function offsetToWorld(frame: {pos: vec3; fwd: vec3; right: vec3}, o: PanelOffset): vec3 {
  const h = o.horizontalDeg * DEG
  const v = o.verticalDeg * DEG
  const dir = frame.fwd
    .uniformScale(Math.cos(v) * Math.cos(h))
    .add(frame.right.uniformScale(Math.cos(v) * Math.sin(h)))
    .add(vec3.up().uniformScale(Math.sin(v)))
  return frame.pos.add(dir.uniformScale(o.distanceCm))
}

export function worldToOffset(frame: {pos: vec3; fwd: vec3; right: vec3}, p: vec3): PanelOffset {
  const rel = p.sub(frame.pos)
  const d = Math.max(rel.length, 1e-6)
  const y = rel.dot(vec3.up())
  const v = Math.asin(clamp(y / d, -1, 1))
  const h = Math.atan2(rel.dot(frame.right), rel.dot(frame.fwd))
  return {distanceCm: d, horizontalDeg: h / DEG, verticalDeg: v / DEG}
}

/** Rotation that makes a panel at `pos` face `eye` (local +Z toward the eye, tilted, no roll). */
export function facingRotation(pos: vec3, eye: vec3): quat {
  const toEye = eye.sub(pos)
  const yaw = Math.atan2(toEye.x, toEye.z)
  const flat = Math.sqrt(toEye.x * toEye.x + toEye.z * toEye.z)
  const tilt = Math.atan2(toEye.y, flat)
  return quat.angleAxis(yaw, vec3.up()).multiply(quat.angleAxis(-tilt, vec3.right()))
}
