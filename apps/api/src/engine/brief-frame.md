## This piece is a frame: made app-ready

A frame goes into a book app that fits it to every page, from 4.25 × 6.87 in to 11 × 8.5 in, portrait,
square and landscape. The app keeps the four corners as drawn, fills each edge with whole copies of one
repeating unit, and keeps any middle ornament whole. Draw it so that works.

- **A square master.** The canvas is a square about 1800 × 1800 design units, whatever the original's
  shape is: a square fits every page. The original guides the bands, the motifs and the proportions of
  the parts, not the canvas, so recompose a tall or wide original into the square: a deep head or foot
  becomes an ornament kept in the middle of that edge (it may reach deeper into the frame than the
  sides do), and the side bands keep their width. Do not draw a portrait or landscape canvas.
- **A whole frame.** Where the original is only part of a frame (an L, one corner, one side), complete
  it: draw a corner and its runs and mirror them so all four sides and corners are there. The
  window is empty and transparent: any picture, text or title in the original is left out.
- **Draw it with `frameKit`** (in the library, with Example 3). It lays out the corners, the repeating
  units and the kept middles, cuts every part at its box, and returns the layout, so the drawing and
  what the app fits are the same thing and the layout cannot be wrong. Draw each part in its own box:
  `corner`; `edgeX.draw(len)` (one unit of the head, the foot is its mirror unless `edgeX.bottom`);
  `edgeY.draw(len)` (one unit of the left side, the right is its mirror); and `keepX` / `keepY` for an
  ornament in the middle of an edge. Everything of the frame belongs to a part: what is drawn outside
  them is not part of the frame. (Without `frameKit` you must compose the layout yourself, as
  Examples 1 and 2 do.)
- **Easing.** The app stretches or squeezes each unit to fill an edge by at most about 0.78–1.3, or a
  flower turns into an oval. Keep units short, so that each half edge holds at least four of them
  (a unit of about 1/12 of the canvas); one long unit per half edge eases by up to 1.4.
- **Units join without a seam.** A unit is a function of its own box only: its pattern starts and ends
  at the same point (lay motifs on a grid whose step divides the unit), and nothing may cross its end:
  a leaf that crosses is cut there, and the check reports it as a seam.
- **Slice** (each corner's box) covers the whole depth of the band and every corner ornament, and
  the head and foot rows are that deep too: a kept ornament that is deeper than the band needs a
  deeper slice. A frame whose head differs from its foot gives `edgeX.bottom` and `keepX.bottom`.
- **Symmetry.** Draw the frame symmetric left to right (and top to bottom unless the foot is
  deliberately different): the right half of each edge is the left half mirrored.
