/**
 * @module undo-state
 * @description
 * App-specific state capture and restore logic for the UndoManager.
 *
 * Extracted from index.html so that:
 * 1. The snapshot shape is defined in one place (not buried in inline script).
 * 2. The capture/restore logic can be unit-tested without a full DOM.
 *
 * Both functions are pure data transformations given their dependencies —
 * no DOM access except the optional `syncUI` callback in restore.
 */

/**
 * Capture the full mutable app state as a plain JSON-serializable object.
 *
 * @param {object} deps
 * @param {object}   deps.store     - config store (get returns deep copy)
 * @param {object}   deps.S         - shared app state (objs array)
 * @param {object}   deps.sceneAnim - scene animator (serializeAll)
 * @returns {object} snapshot
 */
export function captureState({ store, S, sceneAnim }) {
    return {
        controls: store.get('controls'),
        cameras:  store.get('cameras'),
        objects: S.objs.map(o => ({
            uuid:     o.uuid,
            position: [o.position.x, o.position.y, o.position.z],
            rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
            scale:    [o.scale.x,    o.scale.y,    o.scale.z],
            visible:  o.visible,
            hidden:   !!o.userData._hidden,
        })),
        animStates: sceneAnim.serializeAll(),
    };
}

/**
 * Restore the app to a previously captured snapshot.
 *
 * @param {object} snap - snapshot from captureState()
 * @param {object} deps
 * @param {object}   deps.store     - config store (set triggers apply hooks)
 * @param {object}   deps.S         - shared app state (objs array)
 * @param {object}   deps.sceneAnim - scene animator (restoreAll)
 * @param {Function} [deps.onDone]  - optional callback after restore
 *        (use for UI sync like resetting sliders, markDirty, etc.)
 */
export function restoreState(snap, { store, S, sceneAnim, onDone }) {
    store.set('controls', snap.controls);
    if (snap.cameras) store.set('cameras', snap.cameras);

    for (const os of snap.objects) {
        const obj = S.objs.find(o => o.uuid === os.uuid);
        if (!obj) continue;
        obj.position.set(...os.position);
        obj.rotation.set(...os.rotation);
        obj.scale.set(...os.scale);
        if (os.hidden) { obj.userData._hidden = true; obj.visible = false; }
        else           { delete obj.userData._hidden; obj.visible = true; }
    }

    sceneAnim.restoreAll(snap.animStates, S.objs);
    if (onDone) onDone();
}
