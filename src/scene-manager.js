/**
 * @module scene-manager
 * @description
 * Scene load orchestration for VectorScope: wraps the loader (src/loader.js)
 * and the fallback placeholder scene (src/fallback-scene.js) so app state
 * (S.objs / S.origPos) stays in sync with the loader registry, and scene
 * animations are cleared before objects are replaced.
 *
 * Fallback policy: if the default glb hasn't loaded within the arm delay
 * (slow network), a placeholder scene is shown; it is fully removed once the
 * real scene arrives — otherwise both scenes coexist (fallback race bug).
 */

/**
 * @param {object} opts
 * @param {object}   opts.S              - shared app state (objs/origPos synced)
 * @param {object}   opts.sceneAnim      - scene animator (clearAll before load)
 * @param {Function} opts.loadScene      - loader.js loadScene
 * @param {Function} opts.getLoaderState - loader.js registry accessor
 * @param {object}   opts.fallback       - createFallbackScene instance
 * @param {Function} opts.log            - status logger
 * @returns {{doLoadScene: Function, addFallback: Function,
 *            removeFallback: Function, armFallbackTimer: Function,
 *            syncObjs: Function}}
 */
export function createSceneManager({ S, sceneAnim, loadScene, getLoaderState, fallback, log }) {
    /** Sync S.objs / S.origPos from the loader registry. */
    function syncObjs() {
        const ls = getLoaderState();
        S.objs = ls.objs;
        S.origPos = ls.origPos;
    }

    function addFallback() { fallback.add(); syncObjs(); }
    function removeFallback() { fallback.remove(); syncObjs(); }

    /**
     * Load a scene glb. Clears all object animations first (objects are about
     * to be replaced), removes the fallback on success, and — for the default
     * scene only — shows the fallback on error.
     */
    function doLoadScene(url, isDefault = false) {
        log('Loading scene\u2026');
        sceneAnim.clearAll();
        loadScene(url, {
            isDefault,
            onProgress: (loaded, total) => log(`Loading ${(loaded / total * 100) | 0}%\u2026`),
            onComplete: (count) => { removeFallback(); syncObjs(); log(`Loaded: ${count} objects`); },
            onError: () => { if (isDefault && !getLoaderState().loaded) { addFallback(); log('Fallback scene'); } },
        });
    }

    /** Show the fallback after `ms` if nothing has loaded yet. */
    function armFallbackTimer(ms = 5000) {
        setTimeout(() => { if (!getLoaderState().loaded) { addFallback(); log('Fallback scene'); } }, ms);
    }

    return { doLoadScene, addFallback, removeFallback, armFallbackTimer, syncObjs };
}
