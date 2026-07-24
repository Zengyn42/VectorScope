/**
 * @module h-damping
 * @description
 * Focus-D damping for the applied homography (H_applied).
 *
 * Rules (per spec):
 * - H_desired is always computed from the live segment rules + camera params
 *   + focus D. H_applied uses a *damped* D instead of the live D:
 * - When zoom is unchanged frame-to-frame, the damped D is frozen — AF /
 *   Focus-D changes have NO effect on H_applied (H_applied(n)=H_applied(n-1)
 *   as far as D is concerned; camera-parameter changes still pass through).
 * - When zoom changes, damped D converges toward the live D with
 *   `alpha = clamp(|Δzoom| * dampingFactor, 0, 1)`.
 * - On lead-source switch (segment boundary), damped D snaps to the live D
 *   (H_applied resets to H_desired; blend cross-fade covers the transition).
 * - Trajectory playback / macro mode bypass damping entirely (and resync on
 *   return to free mode).
 */

/**
 * Create a damping controller for the applied focus D.
 *
 * @returns {{update: Function, reset: Function}}
 */
export function createDamping() {
    let dampD;      // last applied (damped) D — undefined = unseeded
    let lastZoom;   // zoom at previous update
    let lastLead;   // lead source at previous update

    return {
        /**
         * Advance the damping state one step and return the D to use for
         * H_applied.
         *
         * @param {object} o
         * @param {number} o.depthD - live (desired) focus D
         * @param {number} o.zoom   - current zoom level
         * @param {*}      o.lead   - current lead source id (reset on change)
         * @param {number} o.factor - damping factor (>=0); alpha = |Δzoom|*factor
         * @param {boolean} [o.bypass] - true during trajectory/macro overrides:
         *        returns live D and unseeds the state so free mode resyncs
         * @returns {number} damped D to feed the homography pipeline
         */
        update({ depthD, zoom, lead, factor, bypass = false }) {
            if (bypass) {
                dampD = undefined;
                lastZoom = zoom;
                lastLead = lead;
                return depthD;
            }
            if (dampD === undefined || lead !== lastLead) {
                dampD = depthD;                     // seed / source-switch snap
            } else if (zoom !== lastZoom) {
                const a = Math.abs(zoom - lastZoom) * factor;
                if (a >= 1) dampD = depthD;         // clamp → exact snap
                else dampD += (depthD - dampD) * a; // converge toward desired
            }
            // zoom unchanged → dampD frozen (AF / D-slider changes ignored)
            lastZoom = zoom;
            lastLead = lead;
            return dampD;
        },

        /** Unseed the state (next update snaps to the live D). */
        reset() { dampD = undefined; },
    };
}
