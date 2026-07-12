/**
 * @module scene-io
 * @description
 * Scene save/load via the File System Access API (`showDirectoryPicker`).
 *
 * **Save layout** (a user-chosen directory):
 * ```
 * <dir>/
 *   scene.json          — {version, <every store section>, objects, assets}
 *                          (controls, cameras, view, render, …)
 *   assets/
 *     bedroom.glb       — raw asset bytes (originals, NOT base64)
 *     chair.obj  chair.mtl  chair_diffuse.png  …
 * ```
 * `scene.json.assets` lists each asset's file *names*; the bytes live in
 * `assets/`. URL-sourced assets (the built-in default scene) are fetched at
 * save time so a save directory is always self-contained.
 *
 * **Load** is a full scene replacement: `clearModels()` → parse every asset
 * from the directory → `registerModel` (scene assets register children,
 * object assets register the root) → `adoptObjects` → `applyObjects`
 * (transforms + permanent drop of unlisted objects) → `store.applyAll`
 * (every config section present in the save).
 *
 * Browser support: Chrome/Edge. `isSupported()` gates the UI buttons.
 */

export const SCENE_JSON = 'scene.json';
export const ASSETS_DIR = 'assets';
export const SAVE_VERSION = 1;

/**
 * @param {object} d
 * @param {object}   d.store        - config store (serialize/applyAll)
 * @param {object}   d.assetRegistry- asset registry (list/get/clear/add/setSceneAsset)
 * @param {object}   d.objectOps    - object ops (serializeObjects/applyObjects/adoptObjects)
 * @param {object}   d.assetParser  - asset parser (parseFiles)
 * @param {object}   d.loader       - {clearModels, registerModel}
 * @param {object}   d.scene        - THREE.Scene
 * @param {Function} [d.onBeforeReplace] - called right before the old scene
 *        is cleared (stop animations, drop selection)
 * @param {Function} [d.onAfterLoad] - called after everything is applied
 *        (re-sync S.objs, UI refresh)
 * @param {Function} [d.log]        - status logger
 */
/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Scene Save / Load',
    order: 51,
    entries: [
        ['Save Scene', 'Pick a directory — writes scene.json (all sliders, buttons, zoom, cameras, view mode, FPS, objects) + assets/ with the raw model files'],
        ['Load Scene', 'Pick a saved directory — fully replaces the current scene and restores every panel state'],
    ],
};

export const TRAJ_DIR = 'trajectories';

export function createSceneIO({ store, assetRegistry, objectOps, assetParser, loader, scene,
                                onBeforeReplace = () => {}, onAfterLoad = () => {}, log = () => {},
                                getTrajectories = () => [], onTrajectoriesLoaded = () => {} }) {

    function isSupported() {
        return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
    }

    /** Resolve an asset's files to raw bytes: registry data or fetch(url). */
    async function assetBytes(asset) {
        if (asset.files.length && asset.files.every(f => f.data != null)) {
            return asset.files;
        }
        if (asset.url) {
            const res = await fetch(asset.url);
            if (!res.ok) throw new Error(`fetch ${asset.url}: ${res.status}`);
            return [{ name: asset.name, data: await res.arrayBuffer() }];
        }
        throw new Error(`Asset ${asset.id} (${asset.name}) has no data and no url`);
    }

    async function writeFile(dirHandle, name, data) {
        const fh = await dirHandle.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(data);
        await w.close();
    }

    /**
     * Save the current scene into a user-picked directory.
     * @returns {Promise<boolean>} false when the user cancelled
     */
    async function saveScene() {
        let dir;
        try {
            dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (e) {
            if (e.name === 'AbortError') return false;
            throw e;
        }

        const objects = objectOps.serializeObjects();
        const usedAssets = new Set(objects.map(o => o.assetId));
        const assets = assetRegistry.list().filter(a => usedAssets.has(a.id));

        const assetsDir = await dir.getDirectoryHandle(ASSETS_DIR, { create: true });
        const assetMeta = [];
        for (const a of assets) {
            const files = await assetBytes(a);
            for (const f of files) await writeFile(assetsDir, f.name, f.data);
            assetMeta.push({
                id: a.id, name: a.name, format: a.format, mode: a.mode,
                files: files.map(f => f.name),
            });
        }

        /* Every registered config section is saved (controls, cameras, view,
           render, …) — a module that registers a store section gets scene
           save/load for free. */
        const json = {
            version: SAVE_VERSION,
            ...store.serialize(),
            objects,
            assets: assetMeta,
        };
        await writeFile(dir, SCENE_JSON, JSON.stringify(json, null, 2));

        /* Save all trajectories in the library as individual .json files
           inside a trajectories/ subdirectory. */
        const trajs = getTrajectories();
        if (trajs.length > 0) {
            const trajDir = await dir.getDirectoryHandle(TRAJ_DIR, { create: true });
            for (const t of trajs) {
                await writeFile(trajDir, `${t.name}.json`, JSON.stringify(t.json, null, 2));
            }
        }
        const trajCount = trajs.length;
        log(`Scene saved: ${objects.length} object(s), ${assetMeta.length} asset(s)` +
            (trajCount ? `, ${trajCount} trajectory(s)` : ''));
        return true;
    }

    async function readDirFile(dirHandle, name, asText = false) {
        const fh = await dirHandle.getFileHandle(name);
        const file = await fh.getFile();
        return asText ? file.text() : file.arrayBuffer();
    }

    /**
     * Load a saved scene from a user-picked directory (full replacement).
     * @returns {Promise<boolean>} false when the user cancelled
     */
    async function loadScene() {
        let dir;
        try {
            dir = await window.showDirectoryPicker({ mode: 'read' });
        } catch (e) {
            if (e.name === 'AbortError') return false;
            throw e;
        }

        const json = JSON.parse(await readDirFile(dir, SCENE_JSON, true));
        if (json.version !== SAVE_VERSION) {
            log(`Warning: save version ${json.version} (expected ${SAVE_VERSION}) — loading anyway`);
        }
        const assetsDir = await dir.getDirectoryHandle(ASSETS_DIR);

        // From here on we mutate the scene — parse errors leave a cleared scene,
        // which is honest (partial load is worse than an empty one).
        onBeforeReplace();
        loader.clearModels();
        assetRegistry.clear();

        for (const meta of json.assets || []) {
            const files = [];
            for (const name of meta.files) {
                files.push({ name, data: await readDirFile(assetsDir, name) });
            }
            const { root } = await assetParser.parseFiles(files);

            // Re-register in the registry so a later re-save works.
            const entry = { name: meta.name, format: meta.format, mode: meta.mode, files };
            let id;
            if (meta.id === 'scene') id = assetRegistry.setSceneAsset(entry);
            else {
                id = assetRegistry.add(entry);
                if (id !== meta.id) {
                    // Registry ids are sequential; remap objects to the new id.
                    for (const o of json.objects) if (o.assetId === meta.id) o.assetId = id;
                }
            }
            const objs = loader.registerModel(root, { children: meta.mode === 'scene' });
            objectOps.adoptObjects(objs, { assetId: id });
        }

        const res = objectOps.applyObjects(json.objects || [], scene);
        /* Restore every known config section present in the save; unknown
           keys (version/objects/assets, future sections) are ignored. */
        store.applyAll(json);

        /* Load trajectories from trajectories/ subdirectory if present. */
        let trajCount = 0;
        try {
            const trajDir = await dir.getDirectoryHandle(TRAJ_DIR);
            const trajJsons = [];
            for await (const entry of trajDir.values()) {
                if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
                try {
                    const file = await entry.getFile();
                    trajJsons.push(JSON.parse(await file.text()));
                } catch (e) { console.warn(`Skipped trajectory ${entry.name}:`, e.message); }
            }
            if (trajJsons.length > 0) {
                onTrajectoriesLoaded(trajJsons);
                trajCount = trajJsons.length;
            }
        } catch (_) { /* no trajectories/ dir — that's fine */ }

        onAfterLoad();
        log(`Scene loaded: ${res.applied} object(s)` +
            (res.removed ? `, ${res.removed} dropped` : '') +
            (res.missing.length ? `, ${res.missing.length} missing` : '') +
            (trajCount ? `, ${trajCount} trajectory(s)` : ''));
        return true;
    }

    return { isSupported, saveScene, loadScene };
}
