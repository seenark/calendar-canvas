# Calendar Canvas

A mobile-only handwriting calendar: each user browses months and draws freehand into individual days.

## Calendar

**User**:
A person signed in with Google who owns their own calendar.
_Avoid_: Account, member

**Admin**:
The single operator who signs in with a username and password to manage Users; an Admin is not a User and has no calendar.
_Avoid_: Superuser, admin user

**Day**:
One calendar date (`YYYY-MM-DD`) in one User's calendar, chosen by the cell the User opened, not by when drawing happened.
_Avoid_: Date page, entry

**Day cell**:
The small representation of a Day inside the month view.
_Avoid_: Tile, square

**Drawing page**:
The full-screen view of a single Day where the User draws.
_Avoid_: Editor, canvas page, expanded view

## Ink

**Stroke**:
One continuous mark on a Day, from finger-down to finger-up; either a Pen stroke or an Eraser stroke.
_Avoid_: Line, path, drawing

**Pen**:
The Stroke kind that adds ink (shown to Users as "ดินสอ").
_Avoid_: Pencil, brush

**Eraser**:
The Stroke kind that removes ink from earlier Strokes wherever it passes.
_Avoid_: Rubber

**Op**:
One change to a User's Strokes: add, delete, or restore.
_Avoid_: Mutation, action, event

**Pending op**:
An Op the server has not yet confirmed.
_Avoid_: Unsynced change, draft

**Overlay**:
The set of Pending ops layered on top of server-confirmed Strokes to produce what the User sees.
_Avoid_: Optimistic state, local layer

## Cleanup

**Tombstone**:
A Stroke marked deleted but still stored.
_Avoid_: Soft-deleted row, trash

**Tombstone purge**:
Permanent removal of old Tombstones; the only way a Stroke ever leaves storage.
_Avoid_: Compaction, garbage collection

**Pruning**:
Turning Strokes that no longer affect a Day's final picture into Tombstones.
_Avoid_: Compaction, optimization, cleanup
