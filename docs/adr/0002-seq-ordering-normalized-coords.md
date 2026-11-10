# Strokes are ordered by server `seq` and stored in normalized Day coordinates

A Day's picture is its Strokes drawn in ascending server-assigned `seq`, followed by Pending ops in local creation order. An Eraser affects only Strokes drawn before it. Client clocks are never used for ordering: two devices can disagree about time, but `seq` is assigned by one writer and never reused. That guarantee is what lets Pruning reason about which Eraser can affect which Pen stroke.

Points, sizes, and bounding boxes are stored as fractions of the Day's width and height. Every Day has the same fixed height/width ratio, `DAY_ASPECT`, so a Stroke renders identically in a Day cell, on the Drawing page, and on any screen size.

## Consequences

- `DAY_ASPECT` cannot change once real data exists; every stored Stroke would be distorted.
- Changing the points encoding requires a new version byte, and old versions must stay readable.
- `created_at` is display-only. Time-based rules, such as Pruning's 24-hour stability window, use the server's `received_at`.
