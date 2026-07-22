import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { captureState, restoreState } from '../src/undo-state.js';

/** Minimal Vector3-like stub. */
function vec(x = 0, y = 0, z = 0) {
    return {
        x, y, z,
        set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; },
    };
}

function fakeObj(uuid, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    return {
        uuid, visible: true,
        position: vec(...pos), rotation: vec(...rot), scale: vec(...scale),
        userData: {},
    };
}

function fakeStore(initial = {}) {
    const data = {};
    for (const [k, v] of Object.entries(initial)) data[k] = JSON.parse(JSON.stringify(v));
    return {
        get(section) { return JSON.parse(JSON.stringify(data[section] || {})); },
        set(section, val) { data[section] = JSON.parse(JSON.stringify(val)); },
        _data: data,
    };
}

function fakeSceneAnim() {
    let states = [];
    return {
        serializeAll() { return JSON.parse(JSON.stringify(states)); },
        restoreAll(s) { states = JSON.parse(JSON.stringify(s)); },
        _set(s) { states = s; },
        _get() { return states; },
    };
}

describe('captureState', () => {
    it('captures controls, cameras, objects, and anim states', () => {
        const store = fakeStore({ controls: { zoom: 1.5 }, cameras: { fov: 60 } });
        const obj = fakeObj('a', [1, 2, 3], [0.1, 0.2, 0.3], [2, 2, 2]);
        const S = { objs: [obj] };
        const sceneAnim = fakeSceneAnim();
        sceneAnim._set([{ uuid: 'a', mode: 'spin' }]);

        const snap = captureState({ store, S, sceneAnim });

        assert.deepEqual(snap.controls, { zoom: 1.5 });
        assert.deepEqual(snap.cameras, { fov: 60 });
        assert.equal(snap.objects.length, 1);
        assert.deepEqual(snap.objects[0].position, [1, 2, 3]);
        assert.deepEqual(snap.objects[0].rotation, [0.1, 0.2, 0.3]);
        assert.deepEqual(snap.objects[0].scale, [2, 2, 2]);
        assert.equal(snap.objects[0].uuid, 'a');
        assert.equal(snap.objects[0].visible, true);
        assert.equal(snap.objects[0].hidden, false);
        assert.deepEqual(snap.animStates, [{ uuid: 'a', mode: 'spin' }]);
    });

    it('returns a deep copy — mutating the original does not affect the snapshot', () => {
        const store = fakeStore({ controls: { zoom: 1 } });
        const obj = fakeObj('b', [0, 0, 0]);
        const S = { objs: [obj] };
        const sceneAnim = fakeSceneAnim();

        const snap = captureState({ store, S, sceneAnim });
        obj.position.set(99, 99, 99);
        store.set('controls', { zoom: 5 });

        assert.deepEqual(snap.objects[0].position, [0, 0, 0]);
        assert.deepEqual(snap.controls, { zoom: 1 });
    });

    it('captures hidden objects correctly', () => {
        const obj = fakeObj('h');
        obj.userData._hidden = true;
        obj.visible = false;
        const snap = captureState({
            store: fakeStore(), S: { objs: [obj] }, sceneAnim: fakeSceneAnim(),
        });
        assert.equal(snap.objects[0].hidden, true);
        assert.equal(snap.objects[0].visible, false);
    });
});

describe('restoreState', () => {
    it('restores object transforms from snapshot', () => {
        const obj = fakeObj('a', [0, 0, 0], [0, 0, 0], [1, 1, 1]);
        const store = fakeStore({ controls: {} });
        const S = { objs: [obj] };
        const sceneAnim = fakeSceneAnim();

        const snap = {
            controls: { zoom: 2 },
            cameras: { fov: 90 },
            objects: [{ uuid: 'a', position: [5, 6, 7], rotation: [0.5, 0.6, 0.7], scale: [3, 3, 3], hidden: false }],
            animStates: [],
        };

        restoreState(snap, { store, S, sceneAnim });

        assert.deepEqual([obj.position.x, obj.position.y, obj.position.z], [5, 6, 7]);
        assert.deepEqual([obj.rotation.x, obj.rotation.y, obj.rotation.z], [0.5, 0.6, 0.7]);
        assert.deepEqual([obj.scale.x, obj.scale.y, obj.scale.z], [3, 3, 3]);
        assert.deepEqual(store.get('controls'), { zoom: 2 });
        assert.deepEqual(store.get('cameras'), { fov: 90 });
    });

    it('restores hidden/visible state', () => {
        const obj = fakeObj('a');
        const deps = { store: fakeStore(), S: { objs: [obj] }, sceneAnim: fakeSceneAnim() };

        // Hide
        restoreState({
            controls: {}, objects: [{ uuid: 'a', position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], hidden: true }],
            animStates: [],
        }, deps);
        assert.equal(obj.userData._hidden, true);
        assert.equal(obj.visible, false);

        // Un-hide
        restoreState({
            controls: {}, objects: [{ uuid: 'a', position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], hidden: false }],
            animStates: [],
        }, deps);
        assert.equal(obj.userData._hidden, undefined);
        assert.equal(obj.visible, true);
    });

    it('calls onDone callback after restore', () => {
        let called = false;
        restoreState(
            { controls: {}, objects: [], animStates: [] },
            { store: fakeStore(), S: { objs: [] }, sceneAnim: fakeSceneAnim(), onDone: () => { called = true; } },
        );
        assert.equal(called, true);
    });

    it('skips objects not found in S.objs (deleted between snapshots)', () => {
        const deps = { store: fakeStore(), S: { objs: [] }, sceneAnim: fakeSceneAnim() };
        // Should not throw
        restoreState({
            controls: {}, objects: [{ uuid: 'gone', position: [1,2,3], rotation: [0,0,0], scale: [1,1,1], hidden: false }],
            animStates: [],
        }, deps);
    });

    it('restores animation states via sceneAnim', () => {
        const sceneAnim = fakeSceneAnim();
        const deps = { store: fakeStore(), S: { objs: [] }, sceneAnim };

        restoreState({
            controls: {}, objects: [],
            animStates: [{ uuid: 'x', mode: 'bounce', speed: 2 }],
        }, deps);
        assert.deepEqual(sceneAnim._get(), [{ uuid: 'x', mode: 'bounce', speed: 2 }]);
    });
});
