import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createUndoManager } from '../src/undo.js';

describe('createUndoManager', () => {
    let state, um;

    beforeEach(() => {
        state = { value: 0 };
        um = createUndoManager({
            getState: () => ({ ...state }),
            restoreState: (snap) => { state = { ...snap }; },
            maxDepth: 5,
        });
    });

    it('canUndo is false with no checkpoints', () => {
        assert.equal(um.canUndo(), false);
        assert.equal(um.canRedo(), false);
    });

    it('canUndo requires at least 2 checkpoints (current + previous)', () => {
        um.checkpoint('init');
        assert.equal(um.canUndo(), false);
        state.value = 1;
        um.checkpoint('edit');
        assert.equal(um.canUndo(), true);
    });

    it('undo restores the previous snapshot', () => {
        um.checkpoint('init');     // value=0
        state.value = 42;
        um.checkpoint('edit');     // value=42
        um.undo();
        assert.equal(state.value, 0);
    });

    it('redo restores the undone snapshot', () => {
        um.checkpoint('init');     // value=0
        state.value = 42;
        um.checkpoint('edit');     // value=42
        um.undo();                 // → value=0
        assert.equal(state.value, 0);
        um.redo();                 // → value=42
        assert.equal(state.value, 42);
    });

    it('multiple undo/redo cycles', () => {
        um.checkpoint('a');  state.value = 1;
        um.checkpoint('b');  state.value = 2;
        um.checkpoint('c');  state.value = 3;
        um.checkpoint('d');

        um.undo(); assert.equal(state.value, 2);
        um.undo(); assert.equal(state.value, 1);
        um.redo(); assert.equal(state.value, 2);
        um.undo(); assert.equal(state.value, 1);
        um.undo(); assert.equal(state.value, 0);
        assert.equal(um.canUndo(), false);
    });

    it('new checkpoint clears the redo stack (fork history)', () => {
        um.checkpoint('a');  state.value = 1;
        um.checkpoint('b');
        um.undo();
        assert.equal(um.canRedo(), true);
        state.value = 99;
        um.checkpoint('c');
        assert.equal(um.canRedo(), false);
    });

    it('respects maxDepth — old snapshots are shifted off', () => {
        for (let i = 0; i < 10; i++) {
            state.value = i;
            um.checkpoint(`step-${i}`);
        }
        // maxDepth=5, so only the last 5 are kept
        let undos = 0;
        while (um.canUndo()) { um.undo(); undos++; }
        assert.equal(undos, 4);   // 5 snapshots → 4 undos
    });

    it('undo with 0-1 checkpoints is a no-op', () => {
        state.value = 99;
        um.undo();
        assert.equal(state.value, 99);  // unchanged
        um.checkpoint('only-one');
        um.undo();
        assert.equal(state.value, 99);  // still unchanged
    });

    it('redo with empty redo stack is a no-op', () => {
        um.checkpoint('a');
        state.value = 99;
        um.redo();
        assert.equal(state.value, 99);
    });

    it('redo captures the live state, not the pre-action checkpoint (drag scenario)', () => {
        // Simulates: checkpoint before drag → drag changes state → undo → redo
        um.checkpoint('init');         // value=0
        um.checkpoint('drag-start');   // value=0 (checkpoint BEFORE drag)
        state.value = 50;              // drag happens (no checkpoint after)
        um.undo();                     // should go back to value=0
        assert.equal(state.value, 0);
        um.redo();                     // should restore to value=50 (the live state at undo time)
        assert.equal(state.value, 50);
    });

    it('onChange listeners are called on checkpoint/undo/redo', () => {
        let calls = 0;
        um.onChange(() => calls++);
        um.checkpoint('a');         assert.equal(calls, 1);
        state.value = 1;
        um.checkpoint('b');         assert.equal(calls, 2);
        um.undo();                  assert.equal(calls, 3);
        um.redo();                  assert.equal(calls, 4);
    });
});
