The walkthrough in the video is driven by an automated script, not by hand: an editor-side replay (`tools/demo/play_demo.ts`) walks the Lens Studio Preview head along a recorded camera path (`Assets/Tests/SidleDemo/DemoPath.json`) while the LEAF scenario `DEMO` performs the pinches and drags through the real UI. Because the Preview head moves (as with WASD), the Colorful Home room shows true parallax around the furniture.

Recording the video (backdrop room, about 2.5 minutes):
1. Preview panel: Interactive, source Colorful Home, device SPECS 27 (with the Plane source the Lens shows no room). The saved scene already uses room mode backdrop.
2. Refresh the Preview once (Preview panel refresh button, or PreviewPanelTool action refresh) and start your screen recorder on the Preview panel.
3. Run the one command that starts both the replay and the DEMO: in Claude Code with the Lens Studio MCP, run ExecuteEditorCode with path `tools/demo/play_demo.ts` (no arguments).
4. It runs 153 s plus about 4 s of setup (S1 14, S2 26, S3 30, S4 15, S5 20, S6 25, S7 15, S9 8 s; S8 is the VS Code footage). Don't touch the Preview while it runs; the Lens log shows `[SidleReplay] stopped (path finished)` and `[DEMO] PASSED` at the end.
5. If it fails or looks out of step: run the same command again (it stops the previous replay first). If the Preview stopped responding, refresh it and repeat. Without the editor command you can still run `DEMO` from the LEAF panel with head = preview after running the script with args `{"start": false}`; with head = walker (the default) the Lens moves its own camera and the backdrop does not move.

Details:
- One scene only: set parameter `scene` to 1..9 on `DEMO` in the LEAF panel; every duration is in the `CONFIG` block at the top of `Assets/Tests/SidleDemo/DemoScenario.ts`, the backdrop route in the `BD` block next to it.
- Timings and checks: grep the Lens Studio log for `[SidleDemo]`; the run ends with a SUMMARY table (scene, start, end, duration, target, fps), a per-scene table (camera-wall distance, piece in view, panel cover, pinch-ring range) and, in backdrop mode, a camera-motion table (travel, yaw change, longest still period, peak speed and turn rate).
- New camera path: change the route in the `BD.walk` block, run `DEMO` with head = walker and record = 1, then `python tools/demo/make_path.py "<Lens Studio log file>"` rewrites `DemoPath.json`.
- Stand-in room (the virtual 7 m x 8 m room, any preview source): set Room mode on `SidleController` to Stand-in and run `DEMO` from the LEAF panel; it moves the Lens camera itself and uses `CONFIG` alone. Scene order and durations are the same in both modes.
