---
status: approved
---

# Design brief: Sidle

<!-- Filled in by plan-lens from the learner's interview. Use the learner's words. Mark any value they didn't choose as (default). -->

## The one spatial moment
I'm standing in the middle of my living room and a sofa stands there at real size. I walk around it and see its size from every side. A faint outline on the floor shows exactly how much floor it covers, and a clearance indicator shows whether I'd still have room to walk past it. Then I pinch a button to swap in a second sofa in the same spot and compare them.

## Why it belongs on glasses
- Uses: draws in the world (a real-scale 3D piece standing in the space) and leaves your body free (you walk all the way around it and look from every side).
- Why it's better than the phone or laptop version: it's not a picture of a sofa pasted onto a photo of a room. You judge how much space it takes by standing next to it and walking past it, at real size.

## Product or overlay
- Type: overlay. The furniture responds to the real room it's placed in.
- What the real version would sense: the fixed things in the room — the walls, the doorway, and other furniture — to measure clearance against.
- Stand-in for the preview: the Lens provides a simple virtual living room, 4 m wide by 5 m deep, with four walls, one doorway (90 cm wide, 200 cm tall) in one of the short walls, and a coffee table (100 × 50 × 45 cm) as a fixed obstacle against the far wall in a corner. These are plain, obviously fake shapes, so it's clear they stand in for the real room. On real glasses the same indicator would measure against the actual room instead.

## Where things live
- Where the user is looking during the main task: at the piece on the floor, walking around it, glancing down at the outline and numbers.
- Start position: just inside the doorway, facing into the room.
- Virtual room: 4 × 5 m, walls about 250 cm tall (default), light plain colors (default). Doorway centered in the near short wall (default). The doorway is an opening in the near short wall; clearance to the doorway is measured to the wall line across the opening, the same as for the other walls.
- Furniture piece: Sofa A is shown at the start, on the floor in the middle of the room, about 2 m in front of the start, back toward the far wall. Fixed in the room, not following the user. At the start there's at least 80 cm clear on every side.
- Pieces (plain, generic shapes in light and mid tones so they stay visible on the glasses):
  - Sofa A: 220 × 90 × 85 cm three-seater, light gray.
  - Sofa B: 180 × 85 × 85 cm (height default) two-seater, warm beige.
  - Bed: 160 × 200 × 55 cm.
  - Dining table: 160 × 90 × 75 cm.
- Coffee table: 100 × 50 × 45 cm, fixed against the far wall in a corner, far enough that every piece starts green.
- Floor outline: a faint, thin line on the floor under whichever piece is showing, matching its footprint.
- Dimension labels (width, depth, height in cm): next to the piece, near the outline, light text about 8 cm tall with a simple mid-tone backing plate behind it.
- Gap number: on the floor between the piece and the too-close obstacle.
- Control panel: about 1 m in front of the user, a bit below eye level (about 20 cm below, default), so no raised arm. It follows the user with a slight delay and settles when they stop, so it's always in reach and in view.

## Hands and input
- Move a piece: grab it and drag it along the floor. It stays flat on the floor and can't go through walls or the coffee table.
- Rotate: Rotate left / Rotate right buttons on the panel turn the piece in 15° steps; the outline turns with it. (Buttons instead of a two-hand twist, which can't be shown in the preview.)
- If a swap (Next piece or Compare) or a rotation would make a piece overlap a wall or the coffee table, it moves to the nearest spot where it doesn't overlap.
- Next piece (button): goes Sofa A, bed, dining table, then back to Sofa A. Each new piece appears in the same spot and facing the same way as the previous one, on the floor; the outline, labels and clearance update for it. If Sofa B is showing, Next piece goes to the bed, the same as from Sofa A, and coming back from the dining table always shows Sofa A.
- Compare (button): with a sofa showing, flips between Sofa A and Sofa B in the same spot and facing the same way; the outline, labels and clearance update. With the bed or the dining table showing, it's greyed out and does nothing.
- Measure (button): starts off. Pinching it toggles the width, depth and height labels on and off.
- Panel buttons: Next piece, Compare, Measure, Rotate left, Rotate right. Big targets about 6 cm wide with about 2 cm between them (default).
- Targets are big and highlight when aimed at.
- Voice: none.

## When things show
- Floor outline: always on under the current piece; moves with it when dragged.
- Clearance indicator (built into the outline): green when the piece has at least 80 cm free to the walls, the doorway opening and the coffee table. When the gap drops below 80 cm, the outline edge facing the nearest too-close obstacle turns red.
- Gap number: shows only while the indicator is red, e.g. "62 cm", updating live while dragging. If two obstacles are closer than 80 cm, the gap number shows for the nearest one. No timer — it stays as long as the gap is under 80 cm. When the piece is back at 80 cm or more, the outline goes green and the number fades out after about one second.
- Dimension labels: show while dragging (even with Measure off) and hide on release; stay on whenever Measure is on.
- If something needs attention out of view: if the piece is behind the user, a small arrow on the panel points toward it.

## Done criteria
Each one can be checked in Lens Studio's preview.
1. At the start I'm just inside the doorway of the 4 × 5 m virtual room. Sofa A (220 × 90 × 85 cm, light gray) stands on the floor in the middle of the room, about 2 m in front of me. I can walk all the way around it and see all four sides, and next to the 200 cm doorway it looks the right size. The faint floor outline is green, and no labels or gap numbers are showing.
2. Measure is off at the start. Pinching Measure shows width, depth and height in centimeters (220, 90 and 85 for Sofa A), and pinching it again hides them. While I drag a piece the labels show even with Measure off, and they hide again when I let go. The outline and labels move with the piece.
3. Pinching "Next piece" steps through Sofa A, the bed (160 × 200 × 55 cm), the dining table (160 × 90 × 75 cm), and back to Sofa A. Each one appears in the same spot and facing the same way as the previous piece, on the floor, with the outline matching its size.
4. The outline is green when the piece has at least 80 cm of free space to the walls, the doorway opening and the coffee table (100 × 50 × 45 cm, fixed in the far corner). When I drag a piece closer than 80 cm to one of them, the outline edge facing it turns red and a live gap number in centimeters shows on the floor between them, for example "62 cm". When I drag it back to 80 cm or more, the outline goes green and the number fades out after about one second. The piece stays on the floor and can't go through walls or the coffee table. The rotate left and right buttons turn it in 15° steps and the outline turns with it.
5. With a sofa showing, pinching "Compare" flips between Sofa A (220 × 90 cm, light gray) and Sofa B (180 × 85 cm, warm beige) in the same spot and facing the same way, and the outline, labels and clearance update. With the bed or the table showing, Compare is greyed out and does nothing.

## Out of scope
- Sensing the real room (walls, doorways, real furniture); the virtual room stands in for it.
- A "Variant" button (dropped; Compare covers switching between options).
- More than four pieces, or detailed/branded furniture models.
- Two-hand twist to rotate.
- Remembering placements between sessions.
- Voice.
- Real products, prices and shopping.
- Recognizing real furniture.

## Risks and open questions
- Floor-level text (gap number, outline near the feet) can fall just below the narrow view (about 37° tall) when looking straight at the piece, so the user has to glance down to read it. Feel unproven.
- Measuring against a real room on real glasses depends on the glasses understanding the room's walls and furniture; only real glasses can answer how well that works. The preview demo uses the virtual room.
- Large real-scale pieces (a 220 cm sofa, a 200 cm bed) won't fit in the glasses' view at once up close; you see them by stepping back or walking around. Feel unproven.
- Dark colors render transparent on the glasses, so the pieces use light and mid tones. Color accuracy on real glasses is unproven.
- The room is a virtual stand-in, not my real apartment.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources
