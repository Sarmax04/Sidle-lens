"""Build Assets/Tests/SidleDemo/DemoPath.json from a recorded DEMO run.

Usage: python tools/demo/make_path.py <lens studio log file> [out.json]

The log must contain one DEMO run with parameters head = "walker" and record = "1": every frame it
prints "[SidlePath] t x y z yawDeg pitchDeg scene tau" (seconds since the DEMO start, the camera's
Lens world position in cm, yaw left-positive and pitch up-positive in degrees, the scene number, and
the walking camera's motion clock tau, which stands still while the camera is stopped for a pinch).
It also prints "[SidlePinch] k t" when the camera has stopped for pinch k. The last such run in the
log is used. Samples are thinned to RATE per second; the replay (tools/demo/play_demo.ts) interpolates
between them by DEMO time and lines its time up with the DEMO at every scene start and pinch.
"""
import json
import re
import sys

RATE = 25.0


def main() -> None:
    log = open(sys.argv[1], encoding="utf-8", errors="replace").read()
    out = sys.argv[2] if len(sys.argv) > 2 else "Assets/Tests/SidleDemo/DemoPath.json"
    start = log.rfind("[SidleDemo] DEMO start")
    if start < 0:
        sys.exit("no DEMO run in the log")
    pat = r"\[SidlePath\] ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) (\d+) ([-\d.]+)"
    rows = [[float(v) for v in m.groups()] for m in re.finditer(pat, log[start:])]
    if not rows:
        sys.exit("no [SidlePath] lines with tau after the last DEMO start (run DEMO with head = walker, record = 1)")
    scenes = {}
    for r in rows:
        scenes.setdefault(str(int(r[6])), r[0])
    samples = []
    next_t = 0.0
    for i, r in enumerate(rows):
        if r[0] + 1e-9 >= next_t or i == len(rows) - 1:
            samples.append([round(r[0], 3), round(r[1], 2), round(r[2], 2), round(r[3], 2), round(r[4], 3), round(r[5], 3)])
            next_t = r[0] + 1.0 / RATE
    pinches = [float(m.group(2)) for m in re.finditer(r"\[SidlePinch\] (\d+) ([-\d.]+)", log[start:])]
    data = {
        "about": "Sidle backdrop DEMO camera path for the preview head, recorded from the walker-driven DEMO. "
        "samples: [t s since DEMO start, x, y, z cm in the Lens world, yaw deg (left +), pitch deg (up +)]; "
        "scenes: DEMO time (s) at which each scene starts; pinches: DEMO time (s) at which the camera had stopped for each pinch.",
        "duration": rows[-1][0],
        "scenes": scenes,
        "pinches": pinches,
        "samples": samples,
    }
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"{out}: {len(samples)} samples, {rows[-1][0]:.2f} s, {len(pinches)} pinches, scenes {scenes}")


if __name__ == "__main__":
    main()
