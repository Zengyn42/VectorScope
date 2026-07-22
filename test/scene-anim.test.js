/**
 * Unit tests for src/scene-anim.js — pure pose functions + animator
 * lifecycle with an injected clock. No Three.js needed for most tests:
 * the animator only touches {position.set/x/y/z, rotation.y}.
 * Tests that verify bbox-pivot spin import real Three.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.js';
import { animPose, createSceneAnimator, ANIM_MODES, ANIM_DEFAULTS } from '../src/scene-anim.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

function fakeObj(x = 0, y = 0, z = 0) {
    return {
        position: { x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } },
        rotation: { x: 0, y: 0, z: 0 },
    };
}

function makeAnim() {
    let t = 0;
    const anim = createSceneAnimator({ now: () => t });
    return { anim, tick: (ms) => { t += ms; anim.update(); }, tickSkip: (ms, skip) => { t += ms; anim.update(skip); } };
}

/* ── animPose (pure) ── */

test('all modes start exactly at the base pose (no jump at t=0)', () => {
    for (const m of ANIM_MODES) {
        const { offset, spinY } = animPose(m, 0, { speed: 1.7, dir: [0.3, 0.1, -0.9] });
        for (const c of offset) near(c, 0);   // component-wise (avoids -0 vs 0)
        near(spinY, 0);
    }
});

test('depth: sinusoid along the given direction', () => {
    const dir = [0, 0, -1];
    const t = Math.PI / 2;                    // sin(1*t) = 1 → full amplitude
    const { offset } = animPose('depth', t, { speed: 1, dir });
    near(offset[2], -ANIM_DEFAULTS.depth.amp);
    near(offset[0], 0); near(offset[1], 0);
    // speed scales phase: at speed 2, t=π/4 also reaches the peak
    const { offset: o2 } = animPose('depth', Math.PI / 4, { speed: 2, dir });
    near(o2[2], -ANIM_DEFAULTS.depth.amp);
});

test('orbit: constant radius circle through the base position, y fixed', () => {
    const r = ANIM_DEFAULTS.orbit.amp;
    for (const t of [0.3, 1.1, 2.9, 4.2]) {
        const { offset } = animPose('orbit', t, { speed: 1 });
        near(offset[1], 0);
        // distance from circle center [0, 0, -r] must equal r
        const dx = offset[0], dz = offset[2] + r;
        near(Math.hypot(dx, dz), r, 1e-9);
    }
});

test('bounce: vertical only, never below the base', () => {
    for (const t of [0.1, 1, 2.5, 3.7]) {
        const { offset } = animPose('bounce', t, { speed: 1.3 });
        assert.equal(offset[0], 0); assert.equal(offset[2], 0);
        assert.ok(offset[1] >= 0 && offset[1] <= ANIM_DEFAULTS.bounce.amp + 1e-12);
    }
});

test('spin: rotation only, linear in time and speed', () => {
    const a = animPose('spin', 2, { speed: 1 });
    assert.deepEqual(a.offset, [0, 0, 0]);
    near(a.spinY, ANIM_DEFAULTS.spin.rate * 2);
    near(animPose('spin', 2, { speed: 2 }).spinY, 2 * a.spinY);
});

/* ── animator lifecycle ── */

test('setAnim + update applies pose; clear restores the base pose', () => {
    const { anim, tick } = makeAnim();
    const o = fakeObj(1, 2, 3);
    anim.setAnim(o, 'bounce', { speed: Math.PI });   // sin(π·t): t=0.5 → peak
    tick(500);
    near(o.position.y, 2 + ANIM_DEFAULTS.bounce.amp);
    anim.clear(o);
    near(o.position.x, 1); near(o.position.y, 2); near(o.position.z, 3);
    assert.equal(anim.count(), 0);
});

test('get() reports mode/speed; none for unmanaged objects', () => {
    const { anim } = makeAnim();
    const o = fakeObj();
    assert.deepEqual(anim.get(o), { mode: 'none', speed: 1 });
    anim.setAnim(o, 'orbit', { speed: 2.5 });
    assert.deepEqual(anim.get(o), { mode: 'orbit', speed: 2.5 });
});

test('switching modes restores base first — no drift accumulation', () => {
    const { anim, tick } = makeAnim();
    const o = fakeObj(1, 0, 0);
    anim.setAnim(o, 'orbit', { speed: 1 });
    tick(1234);                                     // move off-base
    anim.setAnim(o, 'bounce', { speed: 1 });        // re-assign
    // New base must be the ORIGINAL position, not the mid-orbit one
    tick(0);
    near(o.position.x, 1); near(o.position.z, 0);
});

test("setAnim(obj, 'none') stops and restores", () => {
    const { anim, tick } = makeAnim();
    const o = fakeObj(0, 5, 0);
    anim.setAnim(o, 'depth', { speed: 1, dir: [0, 0, -1] });
    tick(700);
    anim.setAnim(o, 'none');
    near(o.position.y, 5); near(o.position.z, 0);
    assert.equal(anim.count(), 0);
});

test('skip predicate: drag freezes the phase and rebases to the drop point', () => {
    const { anim, tick, tickSkip } = makeAnim();
    const o = fakeObj(0, 0, 0);
    anim.setAnim(o, 'bounce', { speed: Math.PI });
    tick(250);                                      // phase 0.25s, mid-hop
    const yMid = o.position.y;
    // User drags the object to x=10 while animation is skipped (phase paused)
    o.position.x = 10;
    tickSkip(100, () => true);
    near(o.position.y, yMid, 1e-9, 'y frozen during drag');
    // Release: phase resumes at 0.25s; +0.25s reaches the sin(π t) peak
    tick(250);
    near(o.position.x, 10);
    near(o.position.y, ANIM_DEFAULTS.bounce.amp, 1e-6);
    // …and the hop still returns to the base plane (y=0) at phase 1.0s
    tick(500);
    near(o.position.y, 0, 1e-6);
});

test('clearAll restores every object', () => {
    const { anim, tick } = makeAnim();
    const a = fakeObj(1, 1, 1), b = fakeObj(2, 2, 2);
    anim.setAnim(a, 'orbit', {}); anim.setAnim(b, 'spin', {});
    tick(2000);
    anim.clearAll();
    near(a.position.x, 1); near(a.position.z, 1);
    near(b.rotation.y, 0);
    assert.equal(anim.count(), 0);
});

test('spin preserves a pre-existing rotation as its base', () => {
    const { anim, tick } = makeAnim();
    const o = fakeObj();
    o.rotation.y = 0.7;
    anim.setAnim(o, 'spin', { speed: 1 });
    tick(1000);
    near(o.rotation.y, 0.7 + ANIM_DEFAULTS.spin.rate);
    anim.clear(o);
    near(o.rotation.y, 0.7);
});

/* ── serializeAll / restoreAll ── */

test('serializeAll returns empty array when no anims running', () => {
    const { anim } = makeAnim();
    assert.deepEqual(anim.serializeAll(), []);
});

test('serializeAll captures mode/speed/dir/base/baseRotY for each animated object', () => {
    const { anim } = makeAnim();
    const o = fakeObj(1, 2, 3);
    o.uuid = 'obj-1';
    o.rotation.y = 0.5;
    anim.setAnim(o, 'orbit', { speed: 2, dir: [1, 0, 0] });
    const states = anim.serializeAll();
    assert.equal(states.length, 1);
    assert.equal(states[0].uuid,     'obj-1');
    assert.equal(states[0].mode,     'orbit');
    assert.equal(states[0].speed,    2);
    assert.deepEqual(states[0].dir,  [1, 0, 0]);
    assert.deepEqual(states[0].base, [1, 2, 3]);
    near(states[0].baseRotY, 0.5);
});

test('restoreAll re-applies animations from a serializeAll snapshot', () => {
    const { anim, tick } = makeAnim();
    const o = fakeObj(4, 0, 0);
    o.uuid = 'obj-x';
    anim.setAnim(o, 'bounce', { speed: 1 });
    const snap = anim.serializeAll();
    // Clear, then restore
    anim.clearAll();
    assert.equal(anim.count(), 0);
    anim.restoreAll(snap, [o]);
    assert.equal(anim.count(), 1);
    assert.deepEqual(anim.get(o), { mode: 'bounce', speed: 1 });
});

test('restoreAll restores the base pose on each object', () => {
    const { anim, tick } = makeAnim();
    const o = fakeObj(5, 6, 7);
    o.uuid = 'obj-b';
    anim.setAnim(o, 'depth', { speed: 1, dir: [0, 0, -1] });
    tick(500);   // drift from base
    const snap = anim.serializeAll();
    // Move the object away, then restore should reset to base
    o.position.set(99, 99, 99);
    anim.restoreAll(snap, [o]);
    near(o.position.x, 5);
    near(o.position.y, 6);
    near(o.position.z, 7);
});

test('restoreAll ignores states whose uuid is not found in objs', () => {
    const { anim } = makeAnim();
    const o = fakeObj();
    o.uuid = 'real';
    // Fake states with a missing uuid
    anim.restoreAll([
        { uuid: 'missing', mode: 'spin', speed: 1, dir: [0,0,-1], base: [0,0,0], baseRotY: 0 },
    ], [o]);
    assert.equal(anim.count(), 0);   // nothing restored
});

/* ── spin pivotOffset — bbox-centre orbit (requires Three.js geometry) ── */

test('spin with bbox-offset geometry orbits around the bounding-box centre', () => {
    // Build a real Three.js Mesh whose geometry is translated +3 on X so
    // bbox centre is at (3, 0, 0) in local/world space while mesh sits at origin.
    const geom = new THREE.BoxGeometry(2, 2, 2);
    geom.translate(3, 0, 0);   // vertices from (2,-1,-1) to (4,1,1)
    const mesh = new THREE.Mesh(geom);
    mesh.position.set(0, 0, 0);
    mesh.rotation.y = 0;
    // uuid must exist for other APIs; THREE.Mesh has it automatically
    assert.ok(typeof mesh.uuid === 'string');

    let t = 0;
    const anim = createSceneAnimator({ THREE, now: () => t });
    anim.setAnim(mesh, 'spin', {});

    // Advance by the time needed for a quarter turn (spinY = π/2).
    // spinY = ANIM_DEFAULTS.spin.rate * speed * t_sec = 1.5 * 1 * t_sec
    // → t_sec = (π/2) / 1.5
    const t_quarterTurn_ms = (Math.PI / 2 / ANIM_DEFAULTS.spin.rate) * 1000;
    t = t_quarterTurn_ms;
    anim.update();

    // After π/2 rotation, the world position of the geometry centre must
    // remain at (3, 0, 0).  The mesh origin moves to compensate.
    // Expected new mesh position: (3*(1-cos), 0, 3*sin) = (3, 0, 3) at π/2.
    near(mesh.position.x, 3,  1e-6);
    near(mesh.position.y, 0,  1e-6);
    near(mesh.position.z, 3,  1e-6);
    near(mesh.rotation.y, Math.PI / 2, 1e-6);
});

test('spin without THREE (no pivotOffset) rotates around the local origin', () => {
    // Without THREE injected, pivotOffset stays null and the object spins in place
    let t = 0;
    const anim = createSceneAnimator({ now: () => t });   // no THREE
    const o = fakeObj(2, 0, 0);
    anim.setAnim(o, 'spin', {});
    t = (Math.PI / 2 / ANIM_DEFAULTS.spin.rate) * 1000;
    anim.update();
    // No pivotOffset → position unchanged (spin-in-place)
    near(o.position.x, 2);
    near(o.position.z, 0);
    near(o.rotation.y, Math.PI / 2, 1e-6);
});
