import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.js';
import { createObjectOps } from '../src/object-ops.js';
import { createSceneAnimator } from '../src/scene-anim.js';

/** Build an ops instance with an isolated mock loader state. */
function makeOps({ focusD = 3 } = {}) {
    const state = { objs: [], origPos: new Map(), loaded: true };
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 1, 5);
    cam.updateMatrixWorld(true);
    const sceneAnim = createSceneAnimator({ now: () => 0 });
    const S = { sel: null };
    const selCalls = [];
    const ops = createObjectOps({
        THREE, S,
        getLoaderState: () => state,
        getMainCam: () => cam,
        getFocusD: () => focusD,
        sceneAnim,
        sel: (o) => { selCalls.push(o); S.sel = o; },
    });
    return { ops, state, cam, sceneAnim, S, selCalls };
}

function mkObj(name) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    o.name = name;
    return o;
}

test('assignStableIds dedupes repeated names deterministically', () => {
    const { ops, state } = makeOps();
    state.objs = [mkObj('chair'), mkObj('chair'), mkObj(''), mkObj('chair')];
    ops.assignStableIds();
    assert.deepEqual(state.objs.map(o => o.userData._vsid),
        ['chair', 'chair_2', 'object', 'chair_3']);
    // idempotent
    ops.assignStableIds();
    assert.deepEqual(state.objs.map(o => o.userData._vsid),
        ['chair', 'chair_2', 'object', 'chair_3']);
});

test('placeAtFocus puts bbox center at focus depth on the optical axis', () => {
    const { ops, cam } = makeOps({ focusD: 3 });
    const o = mkObj('box');
    o.position.set(10, 10, 10);          // arbitrary start
    ops.placeAtFocus(o);
    const c = new THREE.Vector3();
    new THREE.Box3().setFromObject(o).getCenter(c);
    // cam at (0,1,5) looking -Z → target (0,1,2)
    assert.ok(c.distanceTo(new THREE.Vector3(0, 1, 2)) < 1e-6);
    assert.ok(Math.abs(c.distanceTo(cam.position) - 3) < 1e-6);
});

test('adoptObjects snapshots reset state and assigns ids', () => {
    const { ops, state } = makeOps({ focusD: 2 });
    const o = mkObj('lamp');
    state.objs.push(o);
    ops.adoptObjects([o], { assetId: 'a1', place: true });
    assert.equal(o.userData._assetId, 'a1');
    assert.equal(o.userData._vsid, 'lamp');
    assert.ok(state.origPos.get(o.uuid).equals(o.position));   // add-moment pose
    assert.ok(o.userData._baseScale.equals(o.scale));
});

test('deleteSelected hides, clears anim + selection; restoreHidden undoes', () => {
    const { ops, state, sceneAnim, S, selCalls } = makeOps();
    const o = mkObj('chair');
    state.objs.push(o);
    sceneAnim.setAnim(o, 'spin');
    S.sel = o;

    assert.equal(ops.deleteSelected(), true);
    assert.equal(o.visible, false);
    assert.equal(o.userData._hidden, true);
    assert.equal(sceneAnim.count(), 0);
    assert.deepEqual(selCalls, [null]);

    assert.equal(ops.deleteSelected(), false);   // nothing selected now

    ops.restoreHidden();
    assert.equal(o.visible, true);
    assert.equal('_hidden' in o.userData, false);
});

test('serializeObjects skips hidden and saves anim base pose', () => {
    const { ops, state, sceneAnim } = makeOps();
    const a = mkObj('a'), b = mkObj('b'), h = mkObj('h');
    a.position.set(1, 2, 3);
    a.scale.set(2, 2, 2);
    h.userData._hidden = true;
    state.objs = [a, b, h];
    a.userData._assetId = 'a1';

    // b animates: base captured at (0,0,0), then oscillated away
    let t = 0;
    const anim = createSceneAnimator({ now: () => t });
    const ops2 = createObjectOps({
        THREE, S: { sel: null },
        getLoaderState: () => state, getMainCam: () => null, getFocusD: () => 3,
        sceneAnim: anim, sel: () => {},
    });
    anim.setAnim(b, 'bounce', { speed: 2 });
    t = 700;                              // quarter period-ish, off base
    anim.update();
    assert.notEqual(b.position.y, 0);

    const out = ops2.serializeObjects();
    assert.deepEqual(out.map(e => e.id), ['a', 'b']);   // h skipped
    const ea = out.find(e => e.id === 'a');
    assert.deepEqual(ea.position, [1, 2, 3]);
    assert.deepEqual(ea.scale, [2, 2, 2]);
    assert.equal(ea.assetId, 'a1');
    assert.equal(ea.anim, null);
    const eb = out.find(e => e.id === 'b');
    assert.deepEqual(eb.position, [0, 0, 0]);           // base, not instantaneous
    assert.equal(eb.anim.mode, 'bounce');
    assert.equal(eb.anim.speed, 2);
});

test('applyObjects matches by id, removes unmatched, reports missing', () => {
    const { ops, state, sceneAnim } = makeOps();
    const scene = new THREE.Scene();
    const keep = mkObj('keep'), drop = mkObj('drop');
    scene.add(keep); scene.add(drop);
    state.objs = [keep, drop];
    state.origPos.set(keep.uuid, new THREE.Vector3());
    state.origPos.set(drop.uuid, new THREE.Vector3());
    keep.userData._hidden = true; keep.visible = false;

    const list = [
        { id: 'keep', position: [1, 1, 1], rotation: [0, 0.5, 0], scale: [2, 2, 2], anim: { mode: 'spin', speed: 1.5, dir: [0, 0, -1] } },
        { id: 'ghost', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], anim: null },
    ];
    const res = ops.applyObjects(list, scene);
    assert.equal(res.applied, 1);
    assert.equal(res.removed, 1);
    assert.deepEqual(res.missing, ['ghost']);

    assert.equal(drop.parent, null);
    assert.equal(state.origPos.has(drop.uuid), false);
    assert.deepEqual(state.objs, [keep]);

    assert.equal(keep.visible, true);
    assert.equal('_hidden' in keep.userData, false);
    assert.deepEqual([keep.scale.x, keep.scale.y, keep.scale.z], [2, 2, 2]);
    assert.ok(state.origPos.get(keep.uuid).equals(keep.position));
    assert.ok(keep.userData._baseScale.equals(keep.scale));
    assert.equal(sceneAnim.get(keep).mode, 'spin');
    // anim base = the loaded pose
    assert.deepEqual(sceneAnim.getState(keep).base, [1, 1, 1]);
});
