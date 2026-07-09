/**
 * Unit tests for src/bev-ghost.js — BEV Ghost Mode material swapping.
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
    let clipY = 2.0;
    const ghost = createBevGhost({ THREE, scene, getClipY: () => clipY });
    return { scene, ghost, setClipY: (v) => { clipY = v; } };
}

test('mesh entirely above clipY gets translucent ghost material', () => {
    const { scene, ghost } = makeScene();
    const hi = box(5);            // box [4.5, 5.5] > clipY 2
    scene.add(hi);
    scene.updateMatrixWorld(true);
    const real = hi.material;
    ghost.apply();
    assert.notEqual(hi.material, real);
    assert.equal(hi.material.transparent, true);
    assert.ok(Math.abs(hi.material.opacity - 0.15) < 1e-9);
    assert.equal(hi.material.depthWrite, false);
    ghost.restore();
    assert.equal(hi.material, real, 'restore must reinstate the original material');
});

test('mesh below or straddling clipY keeps its material', () => {
    const { scene, ghost } = makeScene();
    const lo = box(0.5);          // [0, 1] below clipY
    const mid = box(2);           // [1.5, 2.5] straddles clipY → min.y < clipY
    scene.add(lo, mid);
    scene.updateMatrixWorld(true);
    const mLo = lo.material, mMid = mid.material;
    ghost.apply();
    assert.equal(lo.material, mLo);
    assert.equal(mid.material, mMid);
    ghost.restore();
});

test('layer-1 meshes (camera markers) are skipped', () => {
    const { scene, ghost } = makeScene();
    const marker = box(5);
    marker.layers.set(1);
    scene.add(marker);
    scene.updateMatrixWorld(true);
    const real = marker.material;
    ghost.apply();
    assert.equal(marker.material, real, 'layer-1 mesh must not be ghosted');
    ghost.restore();
});

test('ghost material is cached — repeated toggling allocates nothing new', () => {
    const { scene, ghost } = makeScene();
    const hi = box(5);
    scene.add(hi);
    scene.updateMatrixWorld(true);
    ghost.apply();
    const g1 = hi.material;
    ghost.restore();
    ghost.apply();
    assert.equal(hi.material, g1, 'cached clone must be reused');
    ghost.restore();
});

test('clipY change re-evaluates which meshes are ghosted', () => {
    const { scene, ghost, setClipY } = makeScene();
    const m = box(3);             // [2.5, 3.5]
    scene.add(m);
    scene.updateMatrixWorld(true);
    const real = m.material;
    ghost.apply();                 // clipY=2 → ghosted
    assert.notEqual(m.material, real);
    ghost.restore();
    setClipY(4);                   // now above the box
    ghost.apply();
    assert.equal(m.material, real);
    ghost.restore();
});

test('multi-material meshes get per-slot ghost clones', () => {
    const { scene, ghost } = makeScene();
    const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]);
    m.position.y = 5;
    scene.add(m);
    scene.updateMatrixWorld(true);
    ghost.apply();
    assert.ok(Array.isArray(m.material));
    assert.equal(m.material.length, 2);
    assert.equal(m.material[0].opacity, 0.15);
    ghost.restore();
});
