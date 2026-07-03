/**
 * @module loader
 * @description
 * Scene and object loader for VectorScope.
 *
 * Manages loading GLB/glTF 3D assets into the Three.js scene using the
 * `GLTFLoader` with optional Draco mesh compression support.
 *
 * **Object registry:**
 * Maintains a list of selectable objects (`objs`) and their original positions
 * (`origPos`) for reset functionality. When a scene is loaded, top-level children
 * of the glTF scene graph are registered as selectable objects.
 *
 * **Light handling:**
 * If the loaded scene contains its own lights (e.g., baked into the glTF),
 * the default ambient/directional lights are dimmed to avoid over-illumination.
 * Lights with intensity > 10 (common in Blender exports) are clamped to 3.
 *
 * **API:**
 * - `initLoader()` — one-time setup with Three.js dependencies
 * - `loadScene()` — replace entire scene content with a new glTF
 * - `loadObject()` — add a single object to the existing scene
 * - `removeObject()` — remove an object by reference or UUID
 * - `listObjects()` — enumerate loaded objects with positions
 * - `resetPositions()` — restore all objects to their load-time positions
 * - `getLoaderState()` — access the internal registry (for fallback scene setup)
 *
 * Dependencies: `GLTFLoader`, `DRACOLoader` (Three.js addons) — passed via `initLoader()`.
 *
 * @example
 * import { initLoader, loadScene, getLoaderState } from './loader.js';
 *
 * initLoader({ scene, GLTFLoader, DRACOLoader, dracoPath: './lib/draco/' });
 * loadScene('assets/bedroom.glb', {
 *     onComplete: (count) => console.log(`Loaded ${count} objects`),
 *     onError: () => console.log('Load failed'),
 * });
 */

/**
 * @typedef {Object} LoaderState
 * @property {THREE.Object3D[]} objs       - Selectable objects
 * @property {Map<string, THREE.Vector3>} origPos - Original positions (uuid → Vector3)
 * @property {boolean} loaded              - Whether any scene has loaded
 */

let gltfLoader = null;
let scene = null;
let lights = { ambient: null, directional: null };

/** @type {LoaderState} */
const state = {
    objs: [],
    origPos: new Map(),
    loaded: false,
};

/**
 * Initialize the loader with Three.js dependencies.
 * @param {object} opts
 * @param {THREE.Scene} opts.scene - The Three.js scene to load into
 * @param {GLTFLoader} opts.GLTFLoader - GLTFLoader class
 * @param {DRACOLoader} opts.DRACOLoader - DRACOLoader class
 * @param {string} opts.dracoPath - Path to Draco decoder files
 * @param {THREE.Light} [opts.ambientLight] - Ambient light to dim when scene has lights
 * @param {THREE.Light} [opts.directionalLight] - Directional light to dim when scene has lights
 */
export function initLoader(opts) {
    scene = opts.scene;
    lights.ambient = opts.ambientLight || null;
    lights.directional = opts.directionalLight || null;

    const draco = new opts.DRACOLoader();
    draco.setDecoderPath(opts.dracoPath);
    gltfLoader = new opts.GLTFLoader();
    gltfLoader.setDRACOLoader(draco);
}

/**
 * Get current loader state (objects list, original positions, loaded flag).
 * @returns {LoaderState}
 */
export function getLoaderState() {
    return state;
}

/**
 * Load a full scene (replaces current scene content).
 * @param {string} url - URL to GLB/glTF file
 * @param {object} [opts]
 * @param {boolean} [opts.isDefault=false] - If true, failure triggers fallback
 * @param {function} [opts.onProgress] - Progress callback (loaded, total)
 * @param {function} [opts.onComplete] - Called with object count after load
 * @param {function} [opts.onError] - Called on load error
 */
export function loadScene(url, opts = {}) {
    const { isDefault = false, onProgress, onComplete, onError } = opts;

    if (!gltfLoader || !scene) {
        console.error('[Loader] Not initialized. Call initLoader() first.');
        return;
    }

    // Remove previous models
    state.objs = [];
    state.origPos.clear();
    scene.children.filter(c => c.userData._mdl).forEach(c => scene.remove(c));

    gltfLoader.load(
        url,
        (gltf) => {
            const mdl = gltf.scene;
            mdl.userData._mdl = true;
            scene.add(mdl);

            // Handle scene lights: dim defaults if scene has its own
            mdl.traverse(ch => {
                if (ch.isLight) {
                    if (ch.intensity > 10) ch.intensity = 3;
                    if (lights.ambient) lights.ambient.intensity = 0.1;
                    if (lights.directional) lights.directional.intensity = 0;
                }
            });

            // Register selectable objects
            for (const child of mdl.children) {
                if (child.type === 'Object3D' && !child.isMesh && child.children.length === 0) continue;
                state.objs.push(child);
                state.origPos.set(child.uuid, child.position.clone());
            }

            state.loaded = true;
            if (onComplete) onComplete(state.objs.length);
        },
        (progress) => {
            if (onProgress && progress.total) {
                onProgress(progress.loaded, progress.total);
            }
        },
        (err) => {
            console.warn('[Loader] glTF error:', err);
            if (onError) onError(err);
        },
    );
}

/**
 * Load a single object and add it to the current scene.
 * @param {string} url - URL to GLB/glTF file
 * @param {object} [opts]
 * @param {number[]} [opts.position] - [x, y, z] world position
 * @param {string} [opts.name] - Override object name
 * @param {function} [opts.onComplete] - Called with the loaded object
 * @param {function} [opts.onError] - Called on load error
 */
export function loadObject(url, opts = {}) {
    const { position, name, onComplete, onError } = opts;

    if (!gltfLoader || !scene) {
        console.error('[Loader] Not initialized. Call initLoader() first.');
        return;
    }

    gltfLoader.load(
        url,
        (gltf) => {
            const obj = gltf.scene;
            obj.userData._mdl = true;
            if (name) obj.name = name;
            if (position) obj.position.set(...position);
            scene.add(obj);

            // Register all meshes as selectable
            obj.traverse(ch => {
                if (ch.isMesh || ch.children.length > 0) {
                    state.objs.push(ch === obj ? obj : ch);
                }
            });
            // If traverse didn't add the root, add it
            if (!state.objs.includes(obj)) state.objs.push(obj);
            state.origPos.set(obj.uuid, obj.position.clone());

            if (onComplete) onComplete(obj);
        },
        null,
        (err) => {
            console.warn('[Loader] Object load error:', err);
            if (onError) onError(err);
        },
    );
}

/**
 * Remove an object from the scene by reference or uuid.
 * @param {THREE.Object3D|string} objOrId - Object reference or uuid string
 * @returns {boolean} Whether the object was found and removed
 */
export function removeObject(objOrId) {
    const uuid = typeof objOrId === 'string' ? objOrId : objOrId.uuid;
    const idx = state.objs.findIndex(o => o.uuid === uuid);
    if (idx === -1) return false;

    const obj = state.objs[idx];
    scene.remove(obj);
    state.objs.splice(idx, 1);
    state.origPos.delete(uuid);
    return true;
}

/**
 * List all currently loaded objects.
 * @returns {{ name: string, uuid: string, position: number[] }[]}
 */
export function listObjects() {
    return state.objs.map(o => ({
        name: o.name || '(unnamed)',
        uuid: o.uuid,
        position: [o.position.x, o.position.y, o.position.z],
    }));
}

/**
 * Reset all objects to their original positions.
 */
export function resetPositions() {
    for (const obj of state.objs) {
        const orig = state.origPos.get(obj.uuid);
        if (orig) obj.position.copy(orig);
    }
}
