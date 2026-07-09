/**
 * Unit tests for src/camera-rig.js — camera construction, pose math,
 * BEV camera and markers. Uses the real Three.js module (no WebGL needed
 * for cameras/groups/math).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.js';
import { createCameraRig } from '../src/camera-rig.js';

const PARAMS = {
    main_camera: {
        intrinsics: { fx: 1500, fy: 1500, cx: 540, cy: 960 },
        image_size: [1080, 1920],
        extrinsics: { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] },
    },
    secondary_camera: {
        intrinsics: { fx: 750, fy: 750, cx: 540, cy: 960 },
        image_size: [1080, 1920],
        extrinsics: { position: [0.5, 0, 0], rotation_euler_deg: [0, 0, 0] },
    },
    secondary_camera_2: {
        intrinsics: { fx: 7500, fy: 7500, cx: 540, cy: 960 },
        image_size: [1080, 1920],
        extrinsics: { position: [-0.5, 0, 0], rotation_euler_deg: [0, 0, 0] },
    },
};

function makeRig(sceneCam = { position: [0, 1.5, 4], rotation_euler_deg: [0, 0, 0] }) {
    const scene = new THREE.Scene();
    const SCENE_CAM = sceneCam;
    const rig = createCameraRig({ THREE, scene, SCENE_CAM, bevSize: 6 });
    return { scene, SCENE_CAM, ...rig };
}

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('init builds main/sec1/sec2 cameras with intrinsics-derived FOV', () => {
    const { rig, init } = makeRig();
    init(PARAMS);
    assert.ok(rig.main && rig.sec1 && rig.sec2);
    // fov = 2*atan(h / (2*fy)) — main: 2*atan(1920/3000)
    near(rig.main.fov, 2 * Math.atan(1920 / 3000) * 180 / Math.PI, 1e-6);
    near(rig.sec1.fov, 2 * Math.atan(1920 / 1500) * 180 / Math.PI, 1e-6);
    near(rig.sec2.fov, 2 * Math.atan(1920 / 15000) * 180 / Math.PI, 1e-6);
});

test('main camera pose = SCENE_CAM base (identity extrinsics)', () => {
    const { rig, init } = makeRig();
    init(PARAMS);
    near(rig.main.position.x, 0); near(rig.main.position.y, 1.5); near(rig.main.position.z, 4);
});

test('secondary cameras offset relative to main (identity base rotation)', () => {
    const { rig, init } = makeRig();
    init(PARAMS);
    near(rig.sec1.position.x, 0.5); near(rig.sec1.position.y, 1.5); near(rig.sec1.position.z, 4);
    near(rig.sec2.position.x, -0.5);
});

test('base rotation rotates secondary offsets (yaw 90° maps +X → -Z)', () => {
    const { rig, init } = makeRig({ position: [0, 1.5, 4], rotation_euler_deg: [0, 90, 0] });
    init(PARAMS);
    // sec1 offset [0.5,0,0] in main frame; yaw +90° about Y: (x,z) -> (z·?, ...)
    // quaternion(0,90°,0) applied to (0.5,0,0) = (0,0,-0.5)
    near(rig.sec1.position.x, 0, 1e-9);
    near(rig.sec1.position.z, 4 - 0.5, 1e-9);
});

test('sec2 omitted when params lack secondary_camera_2', () => {
    const { rig, init } = makeRig();
    const p = { ...PARAMS, secondary_camera_2: undefined };
    init(p);
    assert.equal(rig.sec2, null);
    assert.equal(rig.markers.length, 2);
    assert.equal(rig.markerMap.size, 2);
});

test('markers: 3 with sec2, labels registered in markerMap', () => {
    const { rig, init } = makeRig();
    init(PARAMS);
    assert.equal(rig.markers.length, 3);
    assert.deepEqual([...rig.markerMap.values()].sort(),
        ['Main Camera', 'Tele Camera', 'UW Camera']);
    // markers live on layer 1 only (BEV pass)
    let allLayer1 = true;
    rig.markers[0].traverse(c => { if (c !== rig.markers[0] && c.layers.mask !== 2) allLayer1 = false; });
    assert.ok(allLayer1, 'marker children must be on layer 1');
});

test('re-init does not leak cameras or markers into the scene', () => {
    const { scene, init } = makeRig();
    init(PARAMS);
    const count1 = scene.children.length;
    init(PARAMS);
    init(PARAMS);
    assert.equal(scene.children.length, count1, 're-init must not accumulate objects');
});

test('BEV camera looks straight down, centered ahead of main on XZ', () => {
    const { rig, init } = makeRig();
    init(PARAMS);
    near(rig.bev.position.y, 20);
    // identity rotation → forward (0,0,-1); center = main + fwd * 6*0.4
    near(rig.bev.position.x, 0);
    near(rig.bev.position.z, 4 - 2.4);
    // looking down: -Z axis of camera points to -Y world
    const down = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.bev.quaternion);
    near(down.y, -1, 1e-6);
});

test('updateBevAspect widens the ortho frustum to the panel aspect', () => {
    const { rig, init, updateBevAspect } = makeRig();
    init(PARAMS);
    updateBevAspect({ w: 200, h: 100 });
    near(rig.bev.left, -12); near(rig.bev.right, 12);
    updateBevAspect(null);          // must not throw on missing panel
    updateBevAspect({ w: 0, h: 100 });
});

test('syncMarkers copies camera poses onto markers', () => {
    const { rig, init, syncMarkers } = makeRig();
    init(PARAMS);
    rig.main.position.set(7, 8, 9);
    syncMarkers();
    near(rig.markers[0].position.x, 7);
    near(rig.markers[0].position.y, 8);
    near(rig.markers[0].position.z, 9);
    near(rig.markers[1].position.x, rig.sec1.position.x);
});
