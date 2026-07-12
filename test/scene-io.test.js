import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_JSON, ASSETS_DIR, TRAJ_DIR, SAVE_VERSION, createSceneIO } from '../src/scene-io.js';

describe('scene-io constants', () => {
    it('exports expected file/dir names', () => {
        assert.equal(SCENE_JSON, 'scene.json');
        assert.equal(ASSETS_DIR, 'assets');
        assert.equal(TRAJ_DIR, 'trajectories');
    });

    it('SAVE_VERSION is a positive integer', () => {
        assert.ok(Number.isInteger(SAVE_VERSION) && SAVE_VERSION > 0);
    });
});

describe('createSceneIO', () => {
    it('returns {isSupported, saveScene, loadScene}', () => {
        const io = createSceneIO({
            store: { serialize: () => ({}), applyAll: () => {} },
            assetRegistry: { list: () => [], clear: () => {} },
            objectOps: { serializeObjects: () => [], applyObjects: () => ({applied:0,removed:0,missing:[]}) },
            assetParser: { parseFiles: async () => ({}) },
            loader: { clearModels: () => {}, registerModel: () => [] },
            scene: {},
            trajLibrary: { serialize: () => [], restore: () => {} },
        });
        assert.equal(typeof io.isSupported, 'function');
        assert.equal(typeof io.saveScene, 'function');
        assert.equal(typeof io.loadScene, 'function');
    });

    it('isSupported returns false in Node (no window.showDirectoryPicker)', () => {
        const io = createSceneIO({
            store: { serialize: () => ({}), applyAll: () => {} },
            assetRegistry: { list: () => [], clear: () => {} },
            objectOps: { serializeObjects: () => [], applyObjects: () => ({applied:0,removed:0,missing:[]}) },
            assetParser: { parseFiles: async () => ({}) },
            loader: { clearModels: () => {}, registerModel: () => [] },
            scene: {},
            trajLibrary: { serialize: () => [], restore: () => {} },
        });
        assert.equal(io.isSupported(), false);
    });
});
