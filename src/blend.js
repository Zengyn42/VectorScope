/**
 * @module blend
 * @description
 * Camera-transition blending controller for the Combined view.
 *
 * When the zoom crosses a segment boundary the active camera source
 * switches (sec1 → main at 1.0x, main → sec2 at 5.0x, and back). To hide
 * the hard cut, the first X displayed frames after a switch blend the
 * *frozen last frame of the outgoing camera* with the *live frames of the
 * incoming camera*:
 *
 *     displayed(n) = prev_frame * (1 - n/X) + cur_frame * (n/X),  n = 1..X
 *
 * so frame 1 is almost entirely the old view and frame X completes the
 * hand-off. X is a configurable integer; X = 0 disables blending.
 *
 * The render loop only renders the RT of the *active* source each frame,
 * so the outgoing camera's render target naturally freezes at its last
 * frame — no pixel copy is needed. This controller freezes the outgoing
 * source index and its final sampling matrix (`prevM`). NOTE: since the
 * live-matrix change, `prevM` is only a *fallback* — the render loop
 * samples the frozen pixels through the LIVE matrix for that source
 * (S.liveM, recomputed every zoom change), so the frozen frame keeps
 * scaling/warping with the zoom during the cross-fade (blendFeed in
 * src/render-loop.js).
 *
 * Pure state machine — no Three.js, no DOM. Call `update(src, m)` exactly
 * once per displayed frame.
 */

/**
 * Create a blending controller.
 * @param {object} deps
 * @param {() => number} deps.getX - returns the blend length X in frames
 *        (integer; 0 or negative disables blending)
 * @returns {{ update: (src: number, m: number[]) => {t: number, prevSrc: number|null, prevM: number[]|null}, reset: () => void, isBlending: () => boolean }}
 *
 * `update(src, m)`:
 * @param src - active source index this frame (SRC.SEC1/MAIN/SEC2)
 * @param m   - 9-element row-major sampling matrix used this frame
 * @returns `{t, prevSrc, prevM}` where `t` is the weight of the *current*
 *          frame (n/X, clamped to 1). When not blending: t=1, prevSrc=null.
 */
export function createBlendController({ getX }) {
    let lastSrc = null;          // source displayed on the previous frame
    let lastM = null;            // its sampling matrix (frozen copy)
    let n = 0;                   // frames since transition (0 = not blending)
    let prevSrc = null;          // outgoing source during a blend
    let prevM = null;            // its final sampling matrix

    function reset() { lastSrc = null; lastM = null; n = 0; prevSrc = null; prevM = null; }

    function update(src, m) {
        const X = Math.floor(getX() || 0);

        // Detect a source switch (only meaningful once we have history).
        if (lastSrc !== null && src !== lastSrc) {
            if (X > 0) {
                // Freeze the outgoing camera's last displayed sampling state.
                // If a second switch lands mid-blend, the previous blend is
                // dropped and the new outgoing camera takes over.
                prevSrc = lastSrc;
                prevM = lastM.slice();
                n = 0;
            } else {
                n = 0; prevSrc = null; prevM = null;
            }
        }

        lastSrc = src;
        lastM = m.slice();

        if (prevSrc === null) return { t: 1, prevSrc: null, prevM: null };

        n++;                                   // first blended frame: n = 1
        const t = Math.min(n / X, 1);          // weight of the current frame
        if (n >= X) {                          // hand-off complete
            const out = { t: 1, prevSrc, prevM };
            prevSrc = null; prevM = null; n = 0;
            return out;
        }
        return { t, prevSrc, prevM };
    }

    return { update, reset, isBlending: () => prevSrc !== null };
}
