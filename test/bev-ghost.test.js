/**
 * Unit tests for src/bev-ghost.js — BEV Section Cut (clipping plane).
 * Uses the real Three.js module; no rendering, only scene traversal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.js';
import { createBevGhost } from '../src/bev-ghost.js';

function box(y, size = 1) {
    const m = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    m.position.y = y;
    m.updateMatrixWorld(true);
    return m;
}

function makeScene() {
    const scene = new THREE.Scene();
    let clipVal = 2.0;
    let axis = 'y';
    const renderer = { localClippingEnabled: false };
    const ghost = createBevGhost({
        THREE, scene, renderer,
        getClipY: () => clipVal,
        getClipAxis: () => axis,
    });
    return {
        scene, ghost, renderer,
        setClip: (v) => { clipVal = v; },
        setAxis: (a) => { axis = a; },
    };
}

test('apply installs a clipping plane on every layer-0 mesh material', () => {
    const { scene, ghost } = makeScene();
    const lo = box(0.5);   // below the cut — still gets the plane (GPU clips per fragment)
    const hi = box(5);
    scene.add(lo, hi);
    scene.updateMatrixWorld(true);
    ghost.apply();
    assert.ok(Array.isArray(lo.material.clippingPlanes));
    assert.ok(Array.isArray(hi.material.clippingPlanes));
    assert.equal(lo.material.clippingPlanes[0], hi.material.clippingPlanes[0],
        'one shared THREE.Plane instance');
    ghost.restore();
    assert.equal(lo.material.clippingPlanes, null);
    assert.equal(hi.material.clippingPlanes, null);
});

test('plane semantics: keep p[axis] <= clip, cut above (y axis)', () => {
    const { scene, ghost } = makeScene();
    const m = box(0);
    scene.add(m);
    scene.updateMatrixWorld(true);
    ghost.apply();
    const plane = m.material.clippingPlanes[0];
    // normal = (0,-1,0), constant = 2 → distance = 2 − y
    assert.deepEqual(plane.normal.toArray(), [0, -1, 0]);
    assert.equal(plane.constant, 2);
    assert.ok(plane.distanceToPoint(new THREE.Vector3(0, 1, 0)) > 0, 'below cut → kept');
    assert.ok(plane.distanceToPoint(new THREE.Vector3(0, 3, 0)) < 0, 'above cut → clipped');
    ghost.restore();
});

test('clip axis follows getClipAxis: z (xy plane) and x (zy plane)', () => {
    const { scene, ghost, setAxis } = makeScene();
    const m = box(0);
    scene.add(m);
    scene.updateMatrixWorld(true);

    setAxis('z');
    ghost.apply();
    assert.deepEqual(m.material.clippingPlanes[0].normal.toArray(), [0, 0, -1]);
    ghost.restore();

    setAxis('x');
    ghost.apply();
    assert.deepEqual(m.material.clippingPlanes[0].normal.toArray(), [-1, 0, 0]);
    ghost.restore();
});

test('clip value change updates the plane constant', () => {
    const { scene, ghost, setClip } = makeScene();
    const m = box(0);
    scene.add(m);
    scene.updateMatrixWorld(true);
    ghost.apply();
    assert.equal(m.material.clippingPlanes[0].constant, 2);
    ghost.restore();
    setClip(4.5);
    ghost.apply();
    assert.equal(m.material.clippingPlanes[0].constant, 4.5);
    ghost.restore();
});

test('layer-1 meshes (camera markers) are never clipped', () => {
    const { scene, ghost } = makeScene();
    const marker = box(5);
    marker.layers.set(1);
    scene.add(marker);
    scene.updateMatrixWorld(true);
    ghost.apply();
    assert.equal(marker.material.clippingPlanes ?? null, null,
        'layer-1 mesh material must not get the clipping plane');
    ghost.restore();
});

test('apply enables renderer.localClippingEnabled', () => {
    const { scene, ghost, renderer } = makeScene();
    scene.add(box(0));
    scene.updateMatrixWorld(true);
    assert.equal(renderer.localClippingEnabled, false);
    ghost.apply();
    assert.equal(renderer.localClippingEnabled, true);
    ghost.restore();
});

test('shared material across meshes is assigned and cleared exactly once', () => {
    const { scene, ghost } = makeScene();
    const shared = new THREE.MeshStandardMaterial();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    scene.add(a, b);
    scene.updateMatrixWorld(true);
    ghost.apply();
    assert.ok(Array.isArray(shared.clippingPlanes));
    ghost.restore();
    assert.equal(shared.clippingPlanes, null);
});

test('multi-material meshes get the plane on every slot', () => {
    const { scene, ghost } = makeScene();
    const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]);
    scene.add(m);
    scene.updateMatrixWorld(true);
    ghost.apply();
    assert.ok(Array.isArray(m.material[0].clippingPlanes));
    assert.ok(Array.isArray(m.material[1].clippingPlanes));
    ghost.restore();
    assert.equal(m.material[0].clippingPlanes, null);
    assert.equal(m.material[1].clippingPlanes, null);
});

test('no renderer provided (legacy/unit-test path) does not throw', () => {
    const scene = new THREE.Scene();
    const ghost = createBevGhost({ THREE, scene, getClipY: () => 2 });
    scene.add(box(0));
    scene.updateMatrixWorld(true);
    ghost.apply();
    ghost.restore();
});
