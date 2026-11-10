# Strokes leave storage only through Tombstone purge

Deleting a Stroke (undo, or Pruning) only marks it as a Tombstone. The only way a Stroke is ever hard-deleted is the server's daily Tombstone purge, which removes Tombstones older than 30 days. That window is deliberately longer than the 7-day lifetime of the client's persisted Pending-op queue. A replayed `add` can only come from that queue, for example when the response to the first `add` was lost while the device was offline, and the 30-day window means the replay always hits an existing row. `ON CONFLICT(id) DO NOTHING` then keeps the Stroke deleted instead of bringing it back.

For the same reason, a `delete` or `restore` Op that names an id the server no longer has is skipped and reported as `missing`. It does not reject the batch. Rejecting would turn a normal race, such as another device's purge, into a 4xx error that is never retried, and every other Op in that batch would be dropped with it. The server still rejects a batch when the id exists and belongs to a different User.

## Consequences

- `POST /api/days/:date/prune` sets `deleted_at`; it never deletes rows.
- Raising the persister `maxAge` requires raising the purge age with it.
