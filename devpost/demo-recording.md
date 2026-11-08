Run the demo: open the LEAF panel in Lens Studio (Preview, not device) and run scenario `DEMO`; the scenario sets up its own start state.
One scene only: set parameter `scene` to 1..9 (default `all`); every duration is in the `CONFIG` block at the top of `Assets/Tests/SidleDemo/DemoScenario.ts`.
Timings: grep the Lens Studio log for `[SidleDemo]`; the run ends with a SUMMARY table (scene, start, end, duration, target, fps) and a per-scene table (camera-wall distance, piece in view, panel cover, pinch-ring range).

Room modes: the DEMO follows the controller's Room mode (`roomMode` on `SidleController`).
- Backdrop (the saved default): the Colorful Home living room. Set the Preview panel to Interactive with the source Colorful Home before recording; with the Plane source the Lens shows no room. The backdrop camera route and framing are in the `BD` block next to `CONFIG` (the S3 clearance hold uses the living room's corner pillar where the stand-in uses the coffee table).
- Stand-in: the virtual 7 m x 8 m room, any preview source; uses `CONFIG` alone.
Scene order and durations are the same in both modes (S1 14, S2 26, S3 30, S4 15, S5 20, S6 25, S7 15, S9 8 seconds).
