/**
 * @module scene-anim
 * @description
 * Procedural object animation for the VectorScope scene.
 *
 * Purpose: the Combined view implements a *plane-induced* homography at
 * focus depth D — with a static scene the warp mismatch for off-plane
 * geometry is only visible by dragging objects around. These presets put
 * objects in continuous motion so warp drift, camera-transition blending
 * and autofocus behaviour can be observed live:
 *
 * | Mode     | Motion                                              | Shows |
 * |----------|-----------------------------------------------------|-------|
 * | `depth`  | Sinusoid along the main camera's optical axis       | Plane-induced homography breaking off-plane |
 * | `orbit`  | Horizontal circle (XZ) through the start position   | Lateral parallax vs. stereo baseline |
 * | `bounce` | Vertical |sin| hops                                 | General dynamic content |
 * | `spin`   | Rotation around world Y (no translation)            | Silhouette change without parallax |
 *
 * Design:
 * - `animPose(mode, t, opts)` is a **pure function** (unit-testable):
 *   time → {offset, spinY} relative to the object's base pose.
 * - `createSceneAnimator({now})` owns per-object state (base pose, mode,
 *   speed, start time) and applies poses each frame via `update(skip)`.
 * - While an object is skipped (e.g. user is dragging it), its phase is
 *   frozen (t0 shifts with wall time) and its base follows the drag via
 *   the frozen offset — on release the animation resumes from the same
 *   phase around the drop point instead of snapping back.
 * - No Three.js dependency — works on any {position, rotation} object.
 */

/** Available animation modes (order = UI button order). */
export const ANIM_MODES = ['none', 'depth', 'orbit', 'bounce', 'spin'];

/** Default motion parameters per mode. */
export const ANIM_DEFAULTS = {
    depth:  { amp: 1.2 },   // half-travel along the optical axis (world units)
    orbit:  { amp: 0.8 },   // circle radius
    bounce: { amp: 0.6 },   // hop height
    spin:   { rate: 1.5 },  // rad/s at speed = 1
};

/**
 * Pure pose function: offset (and Y-spin) at time t for a given mode.
 * @param {string} mode - one of ANIM_MODES (excluding 'none')
 * @param {number} t - seconds since the animation started
 * @param {object} [opts]
 * @param {number}   [opts.speed=1] - angular speed multiplier (rad/s)
 * @param {number[]} [opts.dir=[0,0,-1]] - unit direction for `depth` mode
 *                   (main camera forward, snapshotted when assigned)
 * @param {number}   [opts.amp] - amplitude override (units / radius / height)
 * @returns {{offset: number[], spinY: number}} offset from base position
 *          and rotation to add around world Y (radians)
 */
/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Object Animation',
    order: 60,
    text: 'Assign motion to the selected object (Selection panel) to observe warp drift, '
        + 'handover blending and autofocus on moving content.',
    entries: [
        ['depth', 'Sinusoid along the main camera axis — shows the homography breaking off the focus plane'],
        ['orbit', 'Horizontal circle — shows lateral parallax vs the stereo baseline'],
        ['bounce', 'Vertical hops'],
        ['spin', 'Rotation in place (silhouette change without parallax)'],
        ['speed buttons', '0.25x – 8x animation speed for the selected object'],
    ],
};

export function animPose(mode, t, { speed = 1, dir = [0, 0, -1], amp } = {}) {
    const w = speed;                 // rad/s
    switch (mode) {
        case 'depth': {
            const a = (amp ?? ANIM_DEFAULTS.depth.amp) * Math.sin(w * t);
            return { offset: [dir[0] * a, dir[1] * a, dir[2] * a], spinY: 0 };
        }
        case 'orbit': {
            const r = amp ?? ANIM_DEFAULTS.orbit.amp;
            // Passes through the base position at t = 0 (no jump on start):
            // circle of radius r centered at base + [0, 0, -r].
            return { offset: [r * Math.sin(w * t), 0, r * (Math.cos(w * t) - 1)], spinY: 0 };
        }
        case 'bounce': {
            const a = amp ?? ANIM_DEFAULTS.bounce.amp;
            return { offset: [0, a * Math.abs(Math.sin(w * t)), 0], spinY: 0 };
        }
        case 'spin':
            return { offset: [0, 0, 0], spinY: ANIM_DEFAULTS.spin.rate * w * t };
        default:
            return { offset: [0, 0, 0], spinY: 0 };
    }
}

/**
 * Create the scene animator.
 * @param {object} [deps]
 * @param {() => number} [deps.now]   - clock in ms (injectable for tests)
 * @param {object}       [deps.THREE] - Three.js namespace; enables bbox-center
 *        pivoting for spin mode when provided. Optional — pass null in tests.
 */
export function createSceneAnimator({ now = () => performance.now(), THREE = null } = {}) {
    /** @type {Map<object, {mode, speed, dir, t0, base: number[], baseRotY: number,
     *          last: {offset: number[], spinY: number}, pivotOffset: number[]|null}>} */
    const anims = new Map();

    /**
     * Apply a computed pose to an object.
     * For spin mode with a non-null `pivotOffset`, the object orbits around
     * its bounding-box center rather than its local origin, so the silhouette
     * appears to rotate in place (centre stays fixed in world space).
     *
     * Maths: pivot P = base + pivotOffset. Object origin relative to P is
     * (-px, 0, -pz). Rotating that offset by spinY around world-Y (Three.js
     * matrix: x'=x·cos+z·sin, z'=−x·sin+z·cos) and adding back to P gives:
     *   new_x = base_x + px·(1−cos) − pz·sin
     *   new_z = base_z + pz·(1−cos) + px·sin
     */
    function applyPose(obj, e, pose) {
        let ox = pose.offset[0], oy = pose.offset[1], oz = pose.offset[2];
        if (e.pivotOffset && pose.spinY !== 0) {
            const px = e.pivotOffset[0], pz = e.pivotOffset[2];
            const cos = Math.cos(pose.spinY), sin = Math.sin(pose.spinY);
            ox += px * (1 - cos) - pz * sin;
            oz += pz * (1 - cos) + px * sin;
        }
        obj.position.set(e.base[0] + ox, e.base[1] + oy, e.base[2] + oz);
        obj.rotation.y = e.baseRotY + pose.spinY;
        e.last = pose;
    }

    /** Restore an object's base pose and stop animating it. */
    function clear(obj) {
        const e = anims.get(obj);
        if (!e) return;
        obj.position.set(e.base[0], e.base[1], e.base[2]);
        obj.rotation.y = e.baseRotY;
        anims.delete(obj);
    }

    /**
     * Assign (or replace) an animation on an object.
     * The object's *current* pose becomes the animation's base pose; if it
     * was already animating, it is first restored so switching modes does
     * not accumulate drift.
     *
     * For `spin` mode, when THREE is available the bounding-box centre is
     * computed and stored as `pivotOffset` so the object orbits its own
     * centre of mass instead of its local origin.
     */
    function setAnim(obj, mode, { speed = 1, dir = [0, 0, -1] } = {}) {
        clear(obj);                            // restore base if re-assigning
        if (mode === 'none' || !ANIM_MODES.includes(mode)) return;

        // Compute bbox-centre pivot offset for spin mode
        let pivotOffset = null;
        if (mode === 'spin' && THREE) {
            try {
                const bbox   = new THREE.Box3().setFromObject(obj);
                const center = bbox.getCenter(new THREE.Vector3());
                pivotOffset  = [
                    center.x - obj.position.x,
                    0,
                    center.z - obj.position.z,
                ];
            } catch (_) { /* ignore if obj lacks geometry */ }
        }

        anims.set(obj, {
            mode, speed, dir: dir.slice(), t0: now(),
            base: [obj.position.x, obj.position.y, obj.position.z],
            baseRotY: obj.rotation.y,
            last: { offset: [0, 0, 0], spinY: 0 },
            pivotOffset,
        });
    }

    /** Current animation of an object: {mode, speed} ('none' if not animated). */
    function get(obj) {
        const e = anims.get(obj);
        return e ? { mode: e.mode, speed: e.speed } : { mode: 'none', speed: 1 };
    }

    /**
     * Full serializable animation state for scene save (null if not animated).
     * Includes the *base* pose — the animation oscillates around it, so save
     * files must persist the base rather than the instantaneous pose.
     * @returns {{mode: string, speed: number, dir: number[],
     *            base: number[], baseRotY: number}|null}
     */
    function getState(obj) {
        const e = anims.get(obj);
        return e
            ? { mode: e.mode, speed: e.speed, dir: e.dir.slice(), base: e.base.slice(), baseRotY: e.baseRotY }
            : null;
    }

    /**
     * Advance all animations. Call once per frame.
     * @param {(obj) => boolean} [skip] - objects for which the pose must
     *        NOT be applied this frame (e.g. being dragged). Their base is
     *        rebased from the current position so motion resumes smoothly.
     */
    function update(skip) {
        const tNow = now();
        for (const [obj, e] of anims) {
            const dt = tNow - (e.tPrev ?? tNow);
            e.tPrev = tNow;
            if (skip && skip(obj)) {
                // Dragged: freeze the phase (shift t0 by dt) and follow the
                // user with the frozen offset, so on release the animation
                // resumes from the same phase around the drop point.
                e.t0 += dt;
                e.base = [obj.position.x - e.last.offset[0],
                          obj.position.y - e.last.offset[1],
                          obj.position.z - e.last.offset[2]];
                continue;
            }
            const t = (tNow - e.t0) / 1000;
            e.tCur = t;                       // phase snapshot for resyncClock
            applyPose(obj, e, animPose(e.mode, t, { speed: e.speed, dir: e.dir }));
        }
    }

    /**
     * Re-anchor every animation to the injected clock's *current* value while
     * preserving its phase. Call when the clock source jumps discontinuously —
     * e.g. the transport switching between wall time (free mode) and frame
     * time (trajectory Play mode). Without this, t = now - t0 would explode
     * across the switch.
     */
    function resyncClock() {
        const tNow = now();
        for (const e of anims.values()) {
            e.t0 = tNow - (e.tCur ?? 0) * 1000;
            e.tPrev = tNow;
        }
    }

    /** Stop everything and restore all base poses. */
    function clearAll() {
        for (const obj of [...anims.keys()]) clear(obj);
    }

    /**
     * Serialize all active animations for undo/save snapshots.
     * Returns an array of `{ uuid, mode, speed, dir, base, baseRotY }`.
     * The `uuid` field lets `restoreAll` locate the matching scene object.
     * @returns {Array<object>}
     */
    function serializeAll() {
        const out = [];
        for (const [obj, e] of anims) {
            out.push({
                uuid:     obj.uuid,
                mode:     e.mode,
                speed:    e.speed,
                dir:      e.dir.slice(),
                base:     e.base.slice(),
                baseRotY: e.baseRotY,
            });
        }
        return out;
    }

    /**
     * Restore animations from a `serializeAll()` snapshot.
     * Clears all current animations first, then re-applies each entry by
     * matching `uuid` against the supplied objects array.
     *
     * @param {Array<object>} states  - output of serializeAll()
     * @param {Array<object>} objs    - scene object list (each must have .uuid)
     */
    function restoreAll(states, objs) {
        clearAll();
        if (!states || !Array.isArray(states) || !objs) return;
        for (const s of states) {
            const obj = objs.find(o => o.uuid === s.uuid);
            if (!obj) continue;
            // Restore the base pose so the animator oscillates around it
            obj.position.set(s.base[0], s.base[1], s.base[2]);
            obj.rotation.y = s.baseRotY;
            anims.set(obj, {
                mode:        s.mode,
                speed:       s.speed,
                dir:         s.dir.slice(),
                t0:          now(),
                base:        s.base.slice(),
                baseRotY:    s.baseRotY,
                last:        { offset: [0, 0, 0], spinY: 0 },
                pivotOffset: null,   // recomputed on next setAnim if needed
            });
        }
    }

    return { setAnim, get, getState, update, resyncClock, clear, clearAll,
             serializeAll, restoreAll, count: () => anims.size };
}
