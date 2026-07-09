/**
 * Unit tests for src/fallback-scene.js — placeholder scene lifecycle and
 * loader-registry integrity (the "red cube in the bedroom" race fix).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.js';
import { createFallbackScene } from '../src/fallback-scene.js';

function makeHarness() {
    const scene = new THREE.Scene();
    const ls = { objs: [], origPos: new Map(), loaded: false };
    const removed = [];
    const fb = createFallbackScene({
        THREE, scene,
        getLoaderState: () => ls,
        onRemove: (o) => removed.push(o),
    });
    return { scene, ls, removed, fb };
}

test('add() populates the scene and registers primitives with the loader', () => {
    const { scene, ls, fb } = makeHarness();
    assert.equal(fb.active(), false);
    fb.add();
    assert.equal(fb.active(), true);
    assert.equal(scene.children.length, 6, 'floor + 5 primitives');
    assert.equal(ls.objs.length, 5, 'only primitives are selectable (not the floor)');
    assert.equal(ls.origPos.size, 5);
    assert.equal(ls.loaded, true);
    const names = ls.objs.map(o => o.name).sort();
    assert.deepEqual(names,
        ['Blue Torus', 'Green Cone', 'Orange Cyl', 'Purple Sphere', 'Red Cube']);
});

test('remove() fully clears scene + registry and fires onRemove per object', () => {
    const { scene, ls, removed, fb } = makeHarness();
    fb.add();
    fb.remove();
    assert.equal(fb.active(), false);
    assert.equal(scene.children.length, 0, 'no placeholder may survive (race bug)');
    assert.equal(ls.objs.length, 0);
    assert.equal(ls.origPos.size, 0);
    assert.equal(removed.length, 6, 'onRemove called for floor + 5 primitives');
});

test('remove() leaves real scene objects untouched', () => {
    const { scene, ls, fb } = makeHarness();
    fb.add();
    // Simulate the real glb arriving: loader registers its own objects
    const real = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    real.name = 'Bed';
    scene.add(real);
    ls.objs.push(real);
    ls.origPos.set(real.uuid, real.position.clone());
    fb.remove();
    assert.equal(scene.children.length, 1);
    assert.deepEqual(ls.objs, [real]);
    assert.ok(ls.origPos.has(real.uuid));
});

test('remove() before add() is a safe no-op; add/remove is re-entrant', () => {
    const { scene, ls, removed, fb } = makeHarness();
    fb.remove();
    assert.equal(removed.length, 0);
    fb.add();
    fb.remove();
    fb.add();
    assert.equal(scene.children.length, 6);
    assert.equal(ls.objs.length, 5);
    fb.remove();
    assert.equal(scene.children.length, 0);
});

test('origPos snapshots are clones — moving an object does not mutate them', () => {
    const { ls, fb } = makeHarness();
    fb.add();
    const cube = ls.objs.find(o => o.name === 'Red Cube');
    const saved = ls.origPos.get(cube.uuid);
    const savedX = saved.x;
    cube.position.x += 10;
    assert.equal(ls.origPos.get(cube.uuid).x, savedX, 'origPos must be a clone');
});
