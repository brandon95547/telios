## This piece is an object: drawn whole

An object (a flower, an animal, a thing, a sign, an ornament, a letter) is drawn whole, and an app
places it on a page at any size, so:

- `layout: { form: 'whole', size: [W, H] }`, no `slice`, `keep` or `repeat`: it is not fitted, only
  scaled. Do not draw a frame, a border, a ground or a shadow round it; if the original has one, it is
  not part of the object and is left out.
- **Canvas.** The object's own shape (you are told the original's aspect ratio), about 1200–1800 units
  on the long side, with about 3% spare all round: nothing touches or crosses the canvas edge, and the
  object sits in the middle of it (the app trims the spare away).
- **One piece.** A group (a bouquet, a pair) is one piece: draw it as it stands, whole, with every part
  of it inside the canvas. Do not draw more than the original shows (no added limbs, stems or bases).
