Run the demo: open the LEAF panel in Lens Studio (Preview, not device) and run scenario `DEMO`; the scenario sets up its own start state.
One scene only: set parameter `scene` to 1..9 (default `all`); every duration is in the `CONFIG` block at the top of `Assets/Tests/SidleDemo/DemoScenario.ts`.
Timings: grep the Lens Studio log for `[SidleDemo]`; the run ends with a SUMMARY table (scene, start, end, duration, target, fps).
