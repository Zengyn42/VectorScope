/**
 * @module config-store
 * @description
 * Central configuration store for VectorScope — the single source of truth
 * for all persistable state, with unidirectional data flow:
 *
 * ```
 * user action → store.set(section, patch) → subscribers notified → UI renders
 * ```
 *
 * Every module registers its config section here (`register`). Save/load of
 * a whole scene then reduces to `serialize()` / `applyAll(json)` — no module
 * needs bespoke persistence code.
 *
 * **Contract per section:**
 * - `defaults` — plain JSON-serializable object; the section's full shape.
 * - `apply(cfg)` — optional side-effect hook invoked AFTER the section's
 *   values change via `set`/`applyAll` (e.g. push into shader uniforms,
 *   re-init cameras). It receives the merged section value.
 *
 * Values must stay JSON-serializable (no THREE objects, no functions).
 * Pure module — no DOM, no THREE; fully unit-testable.
 */

/**
 * Create an isolated config store.
 * @returns {object} store API
 */
export function createConfigStore() {
    /** @type {Map<string, {value: object, apply: Function|null}>} */
    const sections = new Map();
    /** @type {Map<string, Set<Function>>} */
    const subs = new Map();

    const deepClone = (v) => JSON.parse(JSON.stringify(v));

    function notify(name) {
        const s = sections.get(name);
        for (const cb of subs.get(name) || []) cb(deepClone(s.value));
    }

    return {
        /**
         * Register a config section. Idempotent by name (re-register replaces
         * the apply hook but keeps the current value unless defaults change shape).
         * @param {string} name - section name (e.g. 'controls', 'cameras')
         * @param {object} opts
         * @param {object} opts.defaults - full JSON-serializable default shape
         * @param {Function} [opts.apply] - side-effect hook (merged value) => void
         */
        register(name, { defaults, apply = null }) {
            const existing = sections.get(name);
            const value = existing
                ? { ...deepClone(defaults), ...existing.value }
                : deepClone(defaults);
            sections.set(name, { value, apply, defaults: deepClone(defaults) });
        },

        /** @returns {boolean} whether a section is registered */
        has(name) { return sections.has(name); },

        /** @returns {string[]} registered section names */
        names() { return [...sections.keys()]; },

        /**
         * Read a section's current value (deep copy — mutations don't leak).
         * @param {string} name
         * @returns {object}
         */
        get(name) {
            const s = sections.get(name);
            if (!s) throw new Error(`config-store: unknown section '${name}'`);
            return deepClone(s.value);
        },

        /**
         * Patch a section. Shallow-merges `patch` into the section value,
         * runs the section's apply hook, then notifies subscribers.
         * @param {string} name
         * @param {object} patch - partial section value
         */
        set(name, patch) {
            const s = sections.get(name);
            if (!s) throw new Error(`config-store: unknown section '${name}'`);
            Object.assign(s.value, deepClone(patch));
            if (s.apply) s.apply(deepClone(s.value));
            notify(name);
        },

        /**
         * Subscribe to a section's changes.
         * @param {string} name
         * @param {Function} cb - (sectionValue) => void
         * @returns {Function} unsubscribe
         */
        subscribe(name, cb) {
            if (!subs.has(name)) subs.set(name, new Set());
            subs.get(name).add(cb);
            return () => subs.get(name).delete(cb);
        },

        /**
         * Serialize every registered section.
         * @returns {object} { <section>: value, ... }
         */
        serialize() {
            const out = {};
            for (const [name, s] of sections) out[name] = deepClone(s.value);
            return out;
        },

        /**
         * Apply a serialized bundle: for each known section present in `json`,
         * reset to defaults, merge the saved value, run apply, notify.
         * Unknown sections in `json` are ignored (forward compatibility);
         * registered sections missing from `json` are left untouched.
         * @param {object} json - output of serialize()
         */
        applyAll(json) {
            for (const [name, s] of sections) {
                if (!(name in json)) continue;
                s.value = { ...deepClone(s.defaults), ...deepClone(json[name]) };
                if (s.apply) s.apply(deepClone(s.value));
                notify(name);
            }
        },
    };
}
