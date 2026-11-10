export const UNDO_LIMIT = 100;

/** One Day's undo and redo stacks of Stroke ids. Session memory only. */
export class UndoHistory {
  private done: string[] = [];
  private undone: string[] = [];

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** Every id on either stack. */
  ids(): string[] {
    return [...this.done, ...this.undone];
  }

  /** A new Stroke ends any redo chain and drops the oldest step past the cap. */
  record(id: string): void {
    this.done.push(id);
    if (this.done.length > UNDO_LIMIT) this.done.shift();
    this.undone = [];
  }

  /** The id whose Stroke should now be deleted. */
  undo(): string | undefined {
    const id = this.done.pop();
    if (id !== undefined) this.undone.push(id);
    return id;
  }

  /** The id whose Stroke should now be restored. */
  redo(): string | undefined {
    const id = this.undone.pop();
    if (id !== undefined) this.done.push(id);
    return id;
  }
}
