// src/utils/history.ts

export class HistoryManager<T> {
  private past: T[] = [];
  private future: T[] = [];

  private clone(state: T): T {
    return JSON.parse(JSON.stringify(state));
  }

  pushState(state: T) {
    this.past.push(this.clone(state));
    this.future = []; // clear redo stack
  }

  undo(current: T): T | null {
    if (this.past.length === 0) return null;
    const prev = this.past.pop()!;
    this.future.push(this.clone(current));
    return prev;
  }

  redo(current: T): T | null {
    if (this.future.length === 0) return null;
    const next = this.future.pop()!;
    this.past.push(this.clone(current));
    return next;
  }
}
