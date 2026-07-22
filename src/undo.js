/**
 * @module undo
 * @description
 * Memento-based UndoManager for VectorScope.
 *
 * Captures full app-state snapshots via `getState()` and restores them via
 * `restoreState()`. The caller owns the snapshot shape — this module only
 * manages the stack and dispatches.
 *
 * Usage:
 *   const um = createUndoManager({ getState, restoreState, maxDepth: 50 });
 *   // Before a user action:
 *   um.checkpoint('drag');
 *   // Keyboard shortcuts or buttons:
 *   um.undo();   // Ctrl+Z
 *   um.redo();   // Ctrl+Y
 *   // Update button enabled states:
 *   um.onChange(() => { undoBtn.disabled = !um.canUndo(); });
 */

/**
 * Create an UndoManager.
 *
 * @param {object} opts
 * @param {Function} opts.getState      - () => snapshot (any JSON-serializable value)
 * @param {Function} opts.restoreState  - (snapshot) => void
 * @param {number}  [opts.maxDepth=50]  - maximum number of undo snapshots
 * @returns {{ checkpoint, undo, redo, canUndo, canRedo, onChange }}
 */
export function createUndoManager({ getState, restoreState, maxDepth = 50 }) {
    /** @type {Array<{label: string, state: *}>} */
    const undoStack = [];
    /** @type {Array<{label: string, state: *}>} */
    const redoStack = [];
    const listeners = [];

    /**
     * Capture the current state as a checkpoint.
     * Clears the redo stack (new action forks history).
     * @param {string} [label=''] - human-readable label (for debugging)
     */
    function checkpoint(label = '') {
        const snap = { label, state: getState() };
        undoStack.push(snap);
        redoStack.length = 0;
        if (undoStack.length > maxDepth) undoStack.shift();
        notify();
    }

    /**
     * Undo the last action (requires at least 2 snapshots on the undo stack —
     * the current state snapshot + the previous one to restore).
     */
    function undo() {
        if (undoStack.length <= 1) return;
        redoStack.push(undoStack.pop());
        restoreState(undoStack[undoStack.length - 1].state);
        notify();
    }

    /** Redo the most recently undone action. */
    function redo() {
        if (!redoStack.length) return;
        const next = redoStack.pop();
        undoStack.push(next);
        restoreState(next.state);
        notify();
    }

    /** @returns {boolean} true when undo is available */
    function canUndo() { return undoStack.length > 1; }

    /** @returns {boolean} true when redo is available */
    function canRedo() { return redoStack.length > 0; }

    function notify() { for (const fn of listeners) fn(); }

    /**
     * Register a listener called whenever the stack changes
     * (checkpoint, undo, redo). Use to update button states.
     * @param {Function} fn
     */
    function onChange(fn) { listeners.push(fn); }

    return { checkpoint, undo, redo, canUndo, canRedo, onChange };
}
