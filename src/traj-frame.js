/**
 * @module traj-frame
 * @description
 * Pure state mapping for trajectory frame application.
 *
 * Extracts the "trajectory record → app state S" mapping into a testable
 * pure function. The caller handles DOM sync and rig updates separately.
 *
 * Pure module — no DOM, no Three.js. Fully unit-testable.
 */

/**
 * Map a trajectory frame record onto the app state object S.
 *
 * Writes only the fields present in `rec` (partial update).
 * Returns a description of which fields were updated for the caller
 * to sync DOM/rig as needed.
 *
 * @param {object} S - mutable app state
 * @param {object} rec - trajectory frame record
 * @returns {object} updated - which fields were set
 *   { zoom, focusD, prewarp1, prewarp2, warp, blendX, blendMode, blendShape, camParams }
 */
export function applyTrajFrameToState(S, rec) {
    const updated = {};

    S.zoom = rec.zoom;
    updated.zoom = rec.zoom;

    S.depthD = rec.focusD;
    updated.focusD = rec.focusD;

    if (rec.prewarp1 != null) {
        S.prewarpScale = rec.prewarp1;
        updated.prewarp1 = rec.prewarp1;
    }
    if (rec.prewarp2 != null) {
        S.prewarpScale2 = rec.prewarp2;
        updated.prewarp2 = rec.prewarp2;
    }
    if (rec.warp != null) {
        S.warp = rec.warp;
        updated.warp = rec.warp;
    }
    if (rec.blendX != null) {
        S.blendX = rec.blendX;
        updated.blendX = rec.blendX;
    }
    if (rec.blendMode != null) {
        S.blendMode = rec.blendMode;
        updated.blendMode = rec.blendMode;
    }
    if (rec.blendShape != null) {
        S.blendShape = rec.blendShape;
        updated.blendShape = rec.blendShape;
    }
    if (rec.camParams) {
        S.camParams = rec.camParams;
        updated.camParams = true;
    }

    return updated;
}

/**
 * Compute which control IDs should be locked/disabled.
 *
 * @param {boolean} engaged - trajectory is engaged (playing/paused)
 * @param {boolean} recording - recorder is active
 * @returns {boolean} whether controls should be locked
 */
export function shouldLockControls(engaged, recording) {
    return engaged || recording;
}

/**
 * IDs of controls to lock during trajectory engagement or recording.
 */
export const TRAJ_LOCK_IDS = [
    'sld-d', 'sld-pw', 'sld-pw2', 'sld-z', 'sld-blend', 'sld-clip',
    'btn-af', 'btn-warp', 'btn-play', 'btn-bmode', 'btn-bshape', 'btn-reset', 'btn-setcam',
    'btn-save-scene', 'btn-load-scene', 'btn-fps', 'btn-combined',
];
