/**
 * @module asset-registry
 * @description
 * In-memory registry of 3D asset source files for VectorScope scene save.
 *
 * Scene save writes the *original* asset files (glb/obj/mtl/textures) into
 * the save directory, so the registry must keep either the raw bytes (for
 * files the user picked locally — their blob URLs die with the session) or
 * a fetchable URL (for the built-in default scene).
 *
 * Asset entry shape:
 * ```
 * {
 *   id:     'scene' | 'a1', 'a2', …   — 'scene' is the base scene asset
 *   name:   'bedroom.glb'             — primary file name
 *   format: 'glb' | 'obj'
 *   mode:   'scene' | 'object'        — register children vs. root
 *   files:  [{name, data}]            — data: ArrayBuffer | string | null
 *   url:    string | null             — fetch source when data is null
 * }
 * ```
 * Pure module — no DOM, no THREE; fully unit-testable.
 */

/** Create an isolated asset registry. */
export function createAssetRegistry() {
    /** @type {Map<string, object>} */
    const assets = new Map();
    let seq = 0;

    return {
        /**
         * Register an added-object asset. Returns the generated id.
         * @param {object} a - {name, format, files, url?, mode?}
         * @returns {string} asset id ('a1', 'a2', …)
         */
        add(a) {
            const id = `a${++seq}`;
            assets.set(id, {
                id, name: a.name, format: a.format,
                mode: a.mode || 'object',
                files: a.files || [], url: a.url || null,
            });
            return id;
        },

        /**
         * Set/replace the base scene asset (fixed id 'scene').
         * @param {object} a - {name, format, files?, url?}
         * @returns {string} 'scene'
         */
        setSceneAsset(a) {
            assets.set('scene', {
                id: 'scene', name: a.name, format: a.format || 'glb',
                mode: 'scene',
                files: a.files || [], url: a.url || null,
            });
            return 'scene';
        },

        /** @returns {object|undefined} */
        get(id) { return assets.get(id); },

        /** @returns {object[]} all registered assets */
        list() { return [...assets.values()]; },

        /**
         * Drop every added-object asset, keeping (or not) the scene asset.
         * Used when a full scene replacement happens.
         * @param {boolean} [keepScene=false]
         */
        clear(keepScene = false) {
            const scene = keepScene ? assets.get('scene') : null;
            assets.clear();
            if (scene) assets.set('scene', scene);
        },

        /** Remove one asset. @returns {boolean} */
        remove(id) { return assets.delete(id); },
    };
}
