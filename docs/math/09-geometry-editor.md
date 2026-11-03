# 9. The geometry editor

Code: [`src/editor/`](../../src/editor/) (pure logic, all unit tested),
[`src/ui/editor/`](../../src/ui/editor/) (canvas and panel),
[`src/render/editor-draw.ts`](../../src/render/editor-draw.ts)

The editor is mostly computational geometry plus a data model that keeps
supports and loads attached to the right edges while the part is edited.

## Orientation and area

Every geometric test reduces to one primitive, the **orientation** of three points:

    orient(a, b, c) = (b − a) × (c − a) = (bₓ − aₓ)(c_y − a_y) − (b_y − a_y)(cₓ − aₓ)

It is positive if c lies left of a→b (counter-clockwise), negative if right, and
zero if the three points are collinear. It is also twice the area of the
triangle abc, and it is the same formula as the CST's 2A (note 2).

Summing it over a polygon's edges, measured from the origin, gives the
**shoelace formula** for twice the signed area:

    2A = Σᵢ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)

The sign tells you the orientation. The editor uses it to draw support and load
glyphs on the correct side (material on the left of each edge: outline
counter-clockwise, holes clockwise), whichever way the user drew the outline.

## Is the outline a valid polygon?

`polygonProblem` rejects three things:

- **Zero-length edges:** two corners at the same point.
- **Crossing edges.** Two segments p₁p₂ and q₁q₂ properly cross when each
  straddles the other's line: orient(q₁, q₂, p₁) and orient(q₁, q₂, p₂) have
  opposite signs, *and* orient(p₁, p₂, q₁) and orient(p₁, p₂, q₂) have opposite
  signs. Touching and collinear overlap (an orientation of exactly zero, with the
  point inside the other segment's bounding box) count as intersections too.
- **Fold-backs:** neighbouring edges share a corner, so they always "touch". They
  are only invalid if they are collinear and point back over each other (a
  negative dot product of the two edge directions).

Checking every pair of edges is O(n²), which is fine for hand-drawn parts. A
sweep-line algorithm (Shamos–Hoey) does it in O(n log n) if that ever matters.

## Inside or outside?

The signed distance function (note 8) needs a sign. A point is inside a polygon
if a ray from it crosses the boundary an odd number of times (the **even–odd
rule**). That test does not care which way the polygon is oriented. Holes reuse
the same test, combined as d = max(d_outer, −d_hole).

Further validation, with messages a user can act on:
- polygon holes must lie strictly inside the outline (all corners inside, and no
  edge crossing the outline);
- holes must not overlap each other;
- a circle may cut the outline, as in a notch or the quarter-symmetry plate, but
  it must overlap the part and must not cover all of it;
- at least one support and one load.

Whether the supports actually prevent rigid-body motion is left to the solver's
rank test (note 3), which names the missing direction.

## Keeping supports and loads on the right edge

Supports and loads are keyed by **stable edge IDs**, not by edge position:

- **Insert a corner:** the edge splits, the first half keeps the ID, the second
  half gets a new ID, and *both* halves get the condition. A pinned edge stays
  pinned along its whole length.
- **Delete a corner:** its two edges merge into the incoming one, which keeps its
  ID and condition.
- **Replace the outline:** the old outline's conditions are dropped, while hole
  conditions stay.

**Getting from editor IDs to the solver:**
1. The editor lists edge IDs in the same order as the mesher's geometry curves:
   outline edges, then each hole's edges.
2. A curve's index is the tag DistMesh puts on the boundary mesh edges that lie
   on it.
3. So each edge ID maps to a mesh tag, and supports and loads arrive at the
   solver as tagged boundary edges.

An edge that a hole cuts away completely has no mesh edges. If it carries a
condition, the user gets an error explaining that.

## Mesh sizing for an arbitrary part

The density slider means "elements across the narrowest feature". The narrowest
feature is estimated as the shortest outline edge, but never less than a tenth of
the bounding box, so one tiny chamfer cannot force a huge mesh. On top of that:

- Holes get at least 16 elements around a full circle, h_hole = πr/8, and the
  size grows away from them at 0.3 mm per mm.
- A node budget caps the mesh. DistMesh places about one node per 0.43·h², so
  h ≥ √(area / (0.43 × 15 000)).

The L-bracket template has a sharp re-entrant corner where the arm meets the leg.
Its peak stress is a **singularity** and grows with refinement (note 7). Read
stress a short distance away, or add a chamfer corner to approximate a fillet.

## Undo

Every editing operation is a pure function from one geometry to the next, so
undo is just a stack of previous values. A drag must undo as a single step: the
drag *begins* by checkpointing the current value, and the moves in between
replace the present without adding history entries.

## A bug worth knowing about

The circle tool first stored the dragged radius in React state and read it on
pointer-up. A fast drag (or an automated one) can end before React renders the
last move, so the handler saw stale state and silently created nothing. The fix
was to take the final radius from the pointer-up event itself. The general rule:
during pointer gestures, derive the result from the event and a ref, not from
state captured when the handler was last rendered.

## Interview questions

- *How do you test if two segments intersect?* Use orientation signs, plus the
  collinear special cases.
- *How do you know if a polygon is clockwise?* The sign of the shoelace area.
- *Point in polygon?* A ray-casting parity test (even–odd rule).
- *How do boundary conditions survive editing and re-meshing?* They are attached
  to stable geometry edge IDs, which map to curve indices and then to mesh
  boundary tags. Split and merge rules decide what happens when corners are
  added or removed.
- *Why is your bracket's peak stress at the inside corner not a design value?*
  A sharp re-entrant corner is a singularity, so the peak keeps rising as you
  refine. Model the real fillet.
