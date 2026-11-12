# Calendar Canvas

A mobile-only handwriting calendar: each user browses months and draws freehand into individual days.

## Calendar

**User**:
A person who has signed in with Google and owns their own calendar, usable only while Approved.
_Avoid_: Account, member

**Approval status**:
Where a User stands with the Admin: Pending, Approved, or Blocked. Only the Admin changes it: any User can be approved or blocked, but no User is made Pending again.
_Avoid_: Access level, user state

**Pending**:
A User who has signed in but whom the Admin has not yet approved or blocked; a Pending User cannot draw.
_Avoid_: Waitlisted, unverified, applicant

**Approved**:
A User the Admin has allowed to use their calendar.
_Avoid_: Active, verified, allowed

**Blocked**:
A User the Admin has rejected or suspended; signing in again does not make them Pending, and their Strokes stay stored. Deleting a User is different: it removes the User and their Strokes, and signing in again makes them Pending.
_Avoid_: Banned, rejected, disabled

**Admin**:
The single operator who signs in with a username and password to approve, block, and delete Users; an Admin is not a User and has no calendar.
_Avoid_: Superuser, admin user

**Day**:
One calendar date (`YYYY-MM-DD`) in one User's calendar, chosen by the cell the User opened, not by when drawing happened.
_Avoid_: Date page, entry

**Month view**:
A vertical list of consecutive months of one calendar, each showing its Day cells; the User's own calendar is their home screen, and a calendar Shared with them opens the same way.
_Avoid_: Calendar view, month list, month page

**Day cell**:
The small representation of a Day inside the month view.
_Avoid_: Tile, square

**Drawing page**:
The full-screen view of a single Day where the User draws.
_Avoid_: Editor, canvas page, expanded view

**Paper**:
The sheet on the Drawing page that a Day's Strokes are drawn on; a Stroke can only start on the Paper.
_Avoid_: Canvas, drawing area, surface

## Sharing

**Owner**:
The User whose calendar it is.
_Avoid_: Sharer, host

**Viewer**:
A User who sees another User's calendar through an accepted Share; a Viewer never draws in it.
_Avoid_: Guest, follower, subscriber

**Share**:
An Owner's permission for one Viewer to see the Owner's whole calendar, read-only and in one direction only.
_Avoid_: Access, permission, subscription

**Invitation**:
A Share the Viewer has not yet accepted or declined; until they accept, the Viewer sees nothing of the calendar.
_Avoid_: Request, invite, invite link

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
