/**
 * @module transport
 * @description
 * Playback transport for camera trajectories: the single state machine that
 * owns Play / Pause / Stop / Seek / Step, the frame counter and the
 * **master clock** the rest of the app reads.
 *
 * **Modes:**
 * - `free`    — no trajectory engaged. The built-in zoom rules drive the
 *               Combined view; the master clock is wall time.
 * - `playing` — a trajectory drives everything. Frames advance at the
 *               trajectory's own fps on a CPU clock (the 30/60 FPS render
 *               setting does not apply — one trajectory frame per render).
 * - `paused`  — frozen on the current frame (seek/step still work).
 *
 * **Master clock** (`timeMs()`): in free mode it is wall time; while a
 * trajectory is engaged it is `frame / fps * 1000`. Object animations use
 * this clock, so pause/step/seek reposition animated objects **exactly** —
 * `animPose(t)` is a pure function of time.
 *
 * The transport itself is render-loop agnostic: the loop calls
 * `advance(nowMs)` once per rendered frame and the transport decides
 * whether the frame counter moves (returns true when the visible frame
 * changed, so the caller can re-apply the trajectory frame).
 *
 * Pure module — no DOM, no Three.js; fully unit-testable.
 */

/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Trajectory Transport',
    order: 51,
    entries: [
        ['Select dropdown', 'Choose a trajectory from the library (default = free mode)'],
        ['Play / Pause', 'Start or pause trajectory playback at the recorded FPS'],
        ['Stop', 'Exit playback, return to free mode (unlocks all controls)'],
        ['Step back / forward', 'Advance one frame at a time (frame-accurate scrubbing)'],
        ['Progress slider', 'Drag to seek to any frame in the trajectory'],
        ['Controls locked', 'During playback, zoom/warp/blend controls are disabled — the trajectory drives everything'],
    ],
};

/**
 * @param {object} [deps]
 * @param {() => number} [deps.now] - wall clock in ms (injectable for tests)
 * @param {(ev: string) => void} [deps.onChange] - fired on any state change
 *        ('load' | 'play' | 'pause' | 'stop' | 'frame') — UI sync hook.
 */
export function createTransport({ now = () => performance.now(), onChange = () => {} } = {}) {
    let traj = null;          // parsed trajectory (from trajectory.js)
    let mode = 'free';        // 'free' | 'playing' | 'paused'
    let frame = 0;            // current trajectory frame index
    let lastAdvance = -1e9;   // wall time of the last frame advance (playing)

    const engaged = () => mode !== 'free' && traj !== null;

    /** Load (arm) a trajectory. Stays in FREE mode — the built-in zoom
     *  rules keep working until Play is pressed (boss rule #3). */
    function load(t) {
        traj = t;
        frame = 0;
        mode = 'free';
        onChange('load');
    }

    /** Leave play/paused mode, back to free (trajectory stays loaded). */
    function stop() {
        if (mode === 'free') return;
        mode = 'free';
        onChange('stop');
    }

    /** Drop the trajectory entirely and return to free mode. */
    function eject() {
        traj = null;
        mode = 'free';
        frame = 0;
        onChange('stop');
    }

    function play() {
        if (!traj) return;
        if (mode === 'playing') return;
        mode = 'playing';
        lastAdvance = now();   // first advance waits one frame period
        onChange('play');
    }

    function pause() {
        if (!engaged() || mode === 'paused') return;
        mode = 'paused';
        onChange('pause');
    }

    function togglePlay() { (mode === 'playing' ? pause : play)(); }

    /** Jump to a frame (clamped). From free mode this engages paused mode
     *  (inspecting a frame means the trajectory drives the rig). */
    function seek(n) {
        if (!traj) return;
        const c = Math.max(0, Math.min(traj.length - 1, n | 0));
        if (mode === 'free') { mode = 'paused'; onChange('pause'); }
        else if (c === frame) return;
        frame = c;
        if (mode === 'playing') lastAdvance = now();   // restart the frame period
        onChange('frame');
    }

    /** Step ±1 frame; implies pause (frame-accurate inspection). */
    function step(d) {
        if (!traj) return;
        if (mode === 'playing') pause();
        seek(frame + (d >= 0 ? 1 : -1));
    }

    /**
     * Advance the frame counter while playing — call once per rendered frame.
     * Late frames are dropped, never queued: if more than one frame period
     * elapsed, the counter jumps by the elapsed count (same policy as the
     * fixed-fps render pacing).
     * @param {number} [t] - wall time ms (defaults to now())
     * @returns {boolean} true when the visible frame changed (or playback
     *          just ended — the caller should re-apply the current frame)
     */
    function advance(t = now()) {
        if (mode !== 'playing') return false;
        const period = 1000 / traj.fps;
        const elapsed = t - lastAdvance;
        if (elapsed < period - 1) return false;        // 1ms rAF-jitter tolerance
        const steps = Math.max(1, Math.floor(elapsed / period));
        lastAdvance = t;
        const next = frame + steps;
        if (next >= traj.length) {                     // end of trajectory
            frame = traj.length - 1;
            mode = 'paused';
            onChange('pause');
            return true;
        }
        frame = next;
        onChange('frame');
        return true;
    }

    /**
     * Master clock for object animations (ms).
     * Free mode: wall time. Engaged: exact frame time — deterministic
     * under pause/step/seek.
     */
    function timeMs() {
        return engaged() ? frame / traj.fps * 1000 : now();
    }

    return {
        load, stop, eject, play, pause, togglePlay, seek, step, advance, timeMs,
        getMode: () => mode,
        getFrame: () => frame,
        getTrajectory: () => traj,
        /** Current dense frame record, or null in free mode. */
        current: () => (engaged() ? traj.frameAt(frame) : null),
        isEngaged: engaged,
        isPlaying: () => mode === 'playing',
    };
}
