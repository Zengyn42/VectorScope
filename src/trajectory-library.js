/**
 * @module trajectory-library
 * @description
 * In-memory trajectory storage with delta-encoding serialization.
 *
 * Manages a name → parsed-trajectory map and provides:
 * - add / remove / get / list operations
 * - Delta-encode a parsed trajectory back to compact JSON (trajToJson)
 * - serialize / restore for scene save/load integration
 *
 * Pure module — no DOM. The caller is responsible for UI sync.
 */

/**
 * Delta-encode a parsed trajectory back to compact JSON for storage.
 *
 * Each frame stores only the fields that changed from the previous frame.
 * The first frame is stored in full. If nothing changed, a minimal
 * `{ zoom }` delta is emitted to keep the frame count correct.
 *
 * @param {object} traj - parsed trajectory (with .frameAt(i), .length, .name, .fps)
 * @returns {object} compact JSON: { version, name, fps, frames }
 */
export function trajToJson(traj) {
    const dense = [];
    for (let i = 0; i < traj.length; i++) dense.push(traj.frameAt(i));
    const frames = [];
    for (let i = 0; i < dense.length; i++) {
        if (i === 0) { frames.push(dense[i]); continue; }
        const delta = {};
        for (const [k, v] of Object.entries(dense[i])) {
            if (k === 'blendT') continue;
            if (JSON.stringify(v) !== JSON.stringify(dense[i - 1][k])) delta[k] = v;
        }
        frames.push(Object.keys(delta).length > 0 ? delta : { zoom: dense[i].zoom });
    }
    return { version: 1, name: traj.name, fps: traj.fps, frames };
}

/**
 * Create a trajectory library instance.
 *
 * @param {object} opts
 * @param {Function} opts.parseTrajectory - parser function (json → parsed traj)
 * @returns {object} library API
 */
export function createTrajectoryLibrary({ parseTrajectory }) {
    /** @type {Map<string, object>} */
    const map = new Map();

    return {
        /** Add a parsed trajectory to the library. */
        add(traj) { map.set(traj.name, traj); },

        /** Remove a trajectory by name. */
        remove(name) { map.delete(name); },

        /** Get a trajectory by name. */
        get(name) { return map.get(name); },

        /** Check if a trajectory exists. */
        has(name) { return map.has(name); },

        /** Get all trajectory names (insertion order). */
        names() { return [...map.keys()]; },

        /** Number of stored trajectories. */
        get size() { return map.size; },

        /** Clear all trajectories. */
        clear() { map.clear(); },

        /**
         * Serialize all trajectories for scene save.
         * @returns {Array<{name: string, json: object}>}
         */
        serialize() {
            const out = [];
            for (const [name, traj] of map) {
                out.push({ name, json: trajToJson(traj) });
            }
            return out;
        },

        /**
         * Restore trajectories from serialized data.
         * @param {Array<object>} jsons - array of trajectory JSON objects
         */
        restore(jsons) {
            map.clear();
            for (const j of jsons) {
                try {
                    const parsed = parseTrajectory(j);
                    map.set(parsed.name, parsed);
                } catch (e) {
                    console.warn('Skipped trajectory:', e.message);
                }
            }
        },
    };
}
