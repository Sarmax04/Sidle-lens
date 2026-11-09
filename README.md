# Sidle

**See it. Walk around it. Know it fits!**

## Demo video

▶ https://youtu.be/c9OwTs0fhrY

Recorded in the Lens Studio preview, not on real glasses.

## What it does

Sidle is an AR Lens for Snap Spectacles.

- Place **true-to-scale furniture** (sofas, chairs, tables, beds) and walk around it.
- A live floor indicator is **green** when there is at least **80 cm** of clearance around the piece, and **red** when it is too close to a wall.
- A door check tells you whether the piece fits through a standard **90 x 200 cm** doorway.
- Add several pieces, then move and rotate them to compare layouts.

## Who it is for

Anyone about to buy furniture who wants to know it fits before it arrives.

## How it works

The room is chosen by the `roomMode` input on `SidleController` (Inspector: **Room → Room mode**):

| Mode | Room | Obstacles |
|---|---|---|
| `standin` | A virtual 7 x 8 m room built by the Lens around the start position, with a doorway and a coffee table. Works with any preview source. | Walls, doorway, coffee table, other placed pieces |
| `backdrop` | The living room of Lens Studio's built-in **"Colorful Home"** preview scene. The Lens builds no room of its own. | Only the room's walls (and a structural corner pillar), so a virtual piece can be placed over the real furniture in the scene |

In both modes the same two rules apply:

- **Clearance rule:** at least 80 cm free around the piece, otherwise the facing edge turns red and a live gap number in cm appears.
- **Door rule:** the piece must fit through a 90 x 200 cm doorway.

On real glasses the same indicator would measure the user's actual room. **That is not implemented here**; this project measures against the virtual stand-in room or the Colorful Home preview room.

## Requirements and how to run

- **Lens Studio 5.24.1** (build 5.24.1.26100516, from `RoomFit.esproj`)
- Target platform: Spectacles

Steps:

1. Open `RoomFit.esproj` in Lens Studio.
2. Open the main scene `Assets/Scene.scene`.
3. Select the `SidleController` object and check **Room → Room mode** (`roomMode`) in the Inspector. The committed default is **`backdrop`** (Colorful Home living room). Switch it to `standin` for the virtual 7 x 8 m room.
4. For `backdrop`, set the Preview panel to **Interactive** with the source **Colorful Home** (device SPECS 27). With the Plane source the Lens shows no room. `standin` works with any source.
5. Start / refresh the preview. In Interactive Preview a mouse click acts as a pinch.

## Design brief and tests

- Design brief with numbered done criteria: [devpost/design-brief.md](devpost/design-brief.md)
- Every criterion has a **LEAF** test scenario in `Assets/Tests/SidleLeaf` (ids `c1` to `c31`; criteria C3 and C4 are split into several scenarios, 34 scenarios in total).
- There is a **DEMO** scenario in `Assets/Tests/SidleDemo` that drives the video walkthrough through the real UI.
- **C1-C30** run in **stand-in** mode (`roomMode = standin`). **C31** runs in **backdrop** mode (`roomMode = backdrop`, Preview: Interactive, source Colorful Home).

To run them, open the LEAF panel in Lens Studio and run the scenarios. Set `roomMode` on `SidleController` to match the scenarios you run.

## About the demo recording

The walkthrough camera path is recorded and replayed by an automated editor script, `tools/demo/play_demo.ts`, which moves the Lens Studio preview head along a recorded path (`Assets/Tests/SidleDemo/DemoPath.json`) while the `DEMO` scenario performs the pinches and drags. This makes the movement repeatable.

Replay command (from [devpost/demo-recording.md](devpost/demo-recording.md)): with the Lens Studio MCP, run ExecuteEditorCode with path `tools/demo/play_demo.ts` (no arguments).

Full recording steps are in [devpost/demo-recording.md](devpost/demo-recording.md).

## Built with

- Snap Spectacles
- Lens Studio
- Spectacles Interaction Kit (SIK) / Spectacles UI Kit
- LEAF (Lens testing framework)
- CLAD plugin
- Lens Studio MCP

## Known limitations

- Runs in the Lens Studio preview only; not tested on physical glasses.
- The walkthrough camera in the demo is scripted.
- The stand-in room is virtual; the Lens does not measure a real room.

## Credits

Furniture models (from `Assets/Models/catalog.json`):

- **Sofa 01, Sofa 02, Arm Chair 01, Gothic Bed 01** by Kirill Sannikov, Poly Haven, CC0
- **Sofa 03** by Fran Calvente, Poly Haven, CC0
- **Painted Wooden Chair 01** by Kuutti Siitonen, Poly Haven, CC0
- **Dining Table** by Aron Łyczek, Poly Haven, CC0
- **Sofa 4, Sofa 17, Sofa 22, Armchair 16, Table 3, Table 4** by Taha Arslan / ShareTextures, CC0
- **Single Bed** ("Children bed") and **Classic Bed** ("Bed1") by Scopia Visual Interfaces Systems, s.l. ([scopia.es](https://scopia.es)), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), via Sweet Home 3D free models.

Room: Lens Studio's built-in **"Colorful Home"** preview scene.

## Licence

Third-party assets keep their own licences (see Credits).
