/**
 * @module macro-mode
 * @description
 * Macro Mode for VectorScope — forces the Combined view to switch to
 * the UW camera when Focus D drops below a configurable threshold.
 *
 * **Behaviour:**
 * - When `focusD < threshold` AND the current leading camera is not UW,
 *   the module initiates a sequential camera transition TO UW:
 *     - If leading = Main → single blend Main → UW
 *     - If leading = Tele → blend Tele → Main (wait for completion),
 *       then blend Main → UW
 * - When `focusD >= threshold` AND macro mode forced the switch,
 *   the module initiates a transition BACK to the zoom-determined camera:
 *     - Determine target from current zoom (Main or Tele)
 *     - If target = Main → single blend UW → Main
 *     - If target = Tele → blend UW → Main (wait), then Main → Tele
 *
 * **API:**
 * - `enable(threshold)` — activate macro mode with the given distance
 * - `disable()` — deactivate, restore normal zoom-determined camera
 * - `tick(focusD, zoomSrc)` — call once per frame; returns
 *   `{ overrideSrc: SRC | null }` indicating what the pipeline should
 *   use as the leading source (null = no override, use normal zoom rules)
 * - `isActive()` — whether macro mode is enabled
 * - `isOverriding()` — whether macro mode is currently forcing UW
 *
 * **State machine:**
 * ```
 *   IDLE ──(focusD < T)──▸ SWITCHING_TO_UW
 *     ╰──────────────────── (no override)
 *
 *   SWITCHING_TO_UW ──(blend complete)──▸ HOLDING_UW
 *     ╰── override = intermediate or UW
 *
 *   HOLDING_UW ──(focusD ≥ T)──▸ SWITCHING_BACK
 *     ╰── override = UW
 *
 *   SWITCHING_BACK ──(blend complete)──▸ IDLE
 *     ╰── override = intermediate or target
 * ```
 *
 * The module does NOT directly call the blend controller — it only
 * reports what source the pipeline should use. The existing blend
 * controller in the render loop handles transitions automatically
 * when the active source changes.
 *
 * **Sequential transitions** are handled by stepping through intermediate
 * cameras: first override to the adjacent camera, wait for `isBlending()`
 * to go false, then override to the final target.
 *
 * @param {object} deps
 * @param {object} deps.SRC - Source enum { SEC1, MAIN, SEC2 }
 * @param {Function} deps.zoomSource - (zoom, hasS2) => current zoom-determined source
 * @param {Function} deps.isBlending - () => boolean from the blend controller
 */

/** @typedef {'idle'|'to_mid'|'to_uw'|'holding'|'back_mid'|'back_target'} MacroState */

export function createMacroMode({ SRC, zoomSource, isBlending }) {
    let enabled = false;
    let threshold = 0.5;
    /** @type {MacroState} */
    let state = 'idle';
    /** The camera we want the pipeline to use right now */
    let overrideSrc = null;
    /** The zoom-determined source at the moment macro engaged */
    let originalSrc = null;

    /**
     * Enable macro mode.
     * @param {number} t - focus distance threshold (metres)
     */
    function enable(t) {
        threshold = t;
        enabled = true;
        state = 'idle';
        overrideSrc = null;
    }

    function disable() {
        enabled = false;
        state = 'idle';
        overrideSrc = null;
        originalSrc = null;
    }

    function isActive() { return enabled; }
    function isOverriding() { return overrideSrc !== null; }
    function getThreshold() { return threshold; }
    function setThreshold(t) { threshold = t; }

    /**
     * Per-frame update. Call after refreshH / zoom pipeline.
     * @param {number} focusD - current Focus D value
     * @param {number} zoom   - current zoom level
     * @param {boolean} hasS2 - whether Tele camera exists
     * @returns {{ overrideSrc: number|null }} - null = no override
     */
    function tick(focusD, zoom, hasS2) {
        if (!enabled) return { overrideSrc: null };

        const normalSrc = zoomSource(zoom, hasS2);
        const blending = isBlending();

        switch (state) {
            case 'idle':
                if (focusD < threshold && normalSrc !== SRC.SEC1) {
                    originalSrc = normalSrc;
                    if (normalSrc === SRC.SEC2) {
                        // Tele → Main first, then Main → UW
                        state = 'to_mid';
                        overrideSrc = SRC.MAIN;
                    } else {
                        // Main → UW directly
                        state = 'to_uw';
                        overrideSrc = SRC.SEC1;
                    }
                }
                break;

            case 'to_mid':
                // Waiting for Tele → Main blend to complete
                overrideSrc = SRC.MAIN;
                if (!blending) {
                    state = 'to_uw';
                    overrideSrc = SRC.SEC1;
                }
                break;

            case 'to_uw':
                // Waiting for → UW blend to complete
                overrideSrc = SRC.SEC1;
                if (!blending) {
                    state = 'holding';
                }
                break;

            case 'holding':
                // Holding on UW; check if we should switch back
                overrideSrc = SRC.SEC1;
                if (focusD >= threshold) {
                    const targetSrc = zoomSource(zoom, hasS2);
                    if (targetSrc === SRC.SEC1) {
                        // Already on UW, just exit
                        state = 'idle';
                        overrideSrc = null;
                        originalSrc = null;
                    } else if (targetSrc === SRC.SEC2) {
                        // UW → Main first, then Main → Tele
                        state = 'back_mid';
                        overrideSrc = SRC.MAIN;
                    } else {
                        // UW → Main directly
                        state = 'back_target';
                        overrideSrc = SRC.MAIN;
                    }
                }
                break;

            case 'back_mid':
                // Waiting for UW → Main blend to complete
                overrideSrc = SRC.MAIN;
                if (!blending) {
                    state = 'back_target';
                    overrideSrc = SRC.SEC2;
                }
                break;

            case 'back_target':
                // Waiting for → target blend to complete
                if (!blending) {
                    state = 'idle';
                    overrideSrc = null;
                    originalSrc = null;
                }
                break;
        }

        return { overrideSrc };
    }

    /**
     * Compute the homography warp-strength override for the leading camera.
     *
     * @param {number} blendT - current blend progress (0→1 from blendCtl)
     * @param {number} zoom   - current zoom level
     * @returns {number|null} - override warp t (null = use normal zoom rules)
     *
     * - Entry blend (to_uw): t ramps 0→1 with blendT
     * - Holding: t = 1 (full warp) unless zoom is in the natural UW segment
     *   [0.5, 1.0) where normal log-space t applies → return null
     * - Exit blend (back_mid/back_target from UW): t ramps 1→0 with blendT
     * - Intermediate hops (to_mid, back_mid with non-UW): t = 1 (the
     *   intermediate camera needs full warp during the hop)
     */
    function getWarpT(blendT, zoom) {
        if (!enabled) return null;
        switch (state) {
            case 'to_mid':
                return 1;                          // intermediate hop: full warp
            case 'to_uw':
                return blendT;                     // ramp 0→1
            case 'holding':
                // In the natural UW segment, let normal t rules apply
                if (zoom < 1.0 - 1e-9) return null;
                return 1;                          // outside natural segment: full warp
            case 'back_mid':
                // UW→Main hop: UW (outgoing) warp ramps down
                return 1 - blendT;
            case 'back_target':
                // Final hop: normal rules for the new leading camera
                return null;
            default:
                return null;
        }
    }

    /** Whether the combined label should show "Macro Mode". */
    function isInMacro() {
        return enabled && (state === 'to_uw' || state === 'holding' ||
               state === 'to_mid' || state === 'back_mid');
    }

    /**
     * Serialize state for undo snapshots.
     */
    function serialize() {
        return { enabled, threshold, state, overrideSrc, originalSrc };
    }

    /**
     * Restore from a serialized snapshot.
     */
    function restore(snap) {
        if (!snap) return;
        enabled = snap.enabled;
        threshold = snap.threshold;
        state = snap.state;
        overrideSrc = snap.overrideSrc;
        originalSrc = snap.originalSrc;
    }

    return {
        enable, disable, isActive, isOverriding, isInMacro,
        getThreshold, setThreshold, getWarpT,
        tick, serialize, restore,
    };
}
