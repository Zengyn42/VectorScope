/**
 * @module zoom-anim
 * @description
 * Zoom animation controller for the Combined view: preset-button eased
 * transitions and the Play bounce loop. All motion happens in **log-zoom
 * space** so perceived zoom speed is uniform across segments.
 *
 * The controller owns no UI — it drives the caller through `setLogZoom(lv)`
 * (which should update state, slider, labels and the homography) and reads
 * the current zoom via `getZoom()`. Timing primitives are injectable for
 * unit testing.
 *
 * Mutual exclusion: starting a preset animation stops Play and vice versa;
 * a manual slider drag should call `stopPreset()` (Play keeps running only
 * if the caller chooses not to stop it).
 *
 * @param {object} opts
 * @param {Function} opts.getZoom     - returns current zoom factor
 * @param {Function} opts.setLogZoom  - receives log10(zoom); applies it everywhere
 * @param {Function} [opts.onPlayState] - called with `true|false` when Play starts/stops
 * @param {number}   [opts.presetDur=600]  - preset transition duration (ms)
 * @param {number}   [opts.playStep=0.004] - Play bounce step in log units per frame
 * @param {number}   [opts.playLo=log10(0.5)] - Play bounce lower bound (log10)
 * @param {number}   [opts.playHi=1]         - Play bounce upper bound (log10)
 * @param {Function} [opts.raf] - requestAnimationFrame substitute (testing)
 * @param {Function} [opts.caf] - cancelAnimationFrame substitute (testing)
 * @param {Function} [opts.now] - clock in ms (testing)
 * @returns {{ animateTo, togglePlay, stopPreset, stopPlay, stopAll, isPlaying, isAnimating }}
 */
import { easeInOutQuad } from './zoom-pipeline.js';
import { evalCurve, DEFAULT_CURVE } from './bezier-curve.js';

export function createZoomAnimator({
    getZoom, setLogZoom, onPlayState,
    presetDur = 600, playStep = 0.004,
    playLo = Math.log10(0.5), playHi = 1,
    raf = (fn) => requestAnimationFrame(fn),
    caf = (id) => cancelAnimationFrame(id),
    now = () => performance.now(),
    getCurve = () => null,
    getDuration = () => presetDur,
} = {}) {
    let presetAnim = null;
    let playAnim = null;

    function stopPreset() {
        if (presetAnim !== null) { caf(presetAnim); presetAnim = null; }
    }

    function stopPlay() {
        if (playAnim !== null) {
            caf(playAnim); playAnim = null;
            if (onPlayState) onPlayState(false);
        }
    }

    function stopAll() { stopPreset(); stopPlay(); }

    /** Eased transition from the current zoom to `target` (factor, not log). */
    function animateTo(target) {
        stopAll();
        const from = Math.log10(getZoom()), to = Math.log10(target);
        if (Math.abs(to - from) < 1e-6) return;
        const t0 = now();
        const dur = getDuration();
        const curve = getCurve();
        function step() {
            const t = Math.min((now() - t0) / dur, 1);
            const eased = curve ? evalCurve(t, curve) : easeInOutQuad(t);
            setLogZoom(from + (to - from) * eased);
            presetAnim = t < 1 ? raf(step) : null;
        }
        presetAnim = raf(step);
    }

    /** Toggle the Play bounce loop (returns new playing state). */
    function togglePlay() {
        if (playAnim !== null) { stopPlay(); return false; }
        stopPreset();
        if (onPlayState) onPlayState(true);
        let dir = 1;
        function tick() {
            let lv = Math.log10(getZoom()) + playStep * dir;
            if (lv >= playHi) { lv = playHi; dir = -1; }
            if (lv <= playLo) { lv = playLo; dir = 1; }
            setLogZoom(lv);
            playAnim = raf(tick);
        }
        playAnim = raf(tick);
        return true;
    }

    return {
        animateTo, togglePlay, stopPreset, stopPlay, stopAll,
        isPlaying: () => playAnim !== null,
        isAnimating: () => presetAnim !== null,
    };
}
