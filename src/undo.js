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
     * Undo the last action.
     *
     * Captures the **current live state** (the result of the action being
     * undone) and pushes it to the redo stack, then restores the previous
     * checkpoint. This way redo replays the actual outcome, not the
     * pre-action snapshot.
     */
    function undo() {
        if (undoStack.length <= 1) return;
        // Save the current live state for redo (this is the "after" state)
        redoStack.push({ label: 'undo', state: getState() });
        undoStack.pop();   // discard the pre-action checkpoint
        restoreState(undoStack[undoStack.length - 1].state);
        notify();
    }

    /**
     * Redo the most recently undone action.
     *
     * Saves the current state to the undo stack (so a subsequent undo
     * returns here), then restores the redo snapshot (the live state
     * captured at undo time).
     */
    function redo() {
        if (!redoStack.length) return;
        // Save current state so undo can come back here
        undoStack.push({ label: 'redo', state: getState() });
        const next = redoStack.pop();
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
