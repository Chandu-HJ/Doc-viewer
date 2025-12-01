export class HistoryManager<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];

  pushState(state: T) {
    this.undoStack.push(JSON.parse(JSON.stringify(state)));
    this.redoStack = []; // clear redo on new action
  }

  undo(current: T): T | null {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push(JSON.parse(JSON.stringify(current)));
    return JSON.parse(JSON.stringify(this.undoStack.pop()));
  }

  redo(current: T): T | null {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push(JSON.parse(JSON.stringify(current)));
    return JSON.parse(JSON.stringify(this.redoStack.pop()));
  }
}
