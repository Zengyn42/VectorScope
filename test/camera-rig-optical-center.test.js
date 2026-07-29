/**
 * Regression test for the optical-center (cx, cy) sign convention.
 *
 * Bug: applyPose passed setViewOffset(+(cx − W/2), +(cy − H/2)), which
 * shifts the rendered window so the optical-axis point lands at
 * (W − cx, H − cy) instead of (cx, cy) — the direction was INVERTED
 * relative to the CV intrinsics K used by computeHPair and the shader's
 * y-down sampling convention.
 *
 * This test drives the REAL camera-rig applyPose with the REAL THREE
 * projection matrix and asserts that the plane-induced homography maps
 * one camera's rendered pixel to the other's exactly (points on the
 * focus plane), including cameras with off-center principal points.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.js';
import { createCameraRig } from '../src/camera-rig.js';
import { computeHPair } from '../src/homography.js';

const W = 1440, H = 1080, D = 3.0;

const sceneStub = { add() {}, remove() {} };

function camParams(cx, cy, ext) {
    return {
        intrinsics: { fx: 1500, fy: 1500, cx, cy },
        extrinsics: ext ?? { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] },
        image_size: [W, H],
    };
}

/** World point → y-down image px, same convention the warp shader samples with. */
function projectPx(cam, p) {
    const v = p.clone().project(cam);
    return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
}

function applyH(M3, q) {
    const d = M3[6] * q[0] + M3[7] * q[1] + M3[8];
    return [(M3[0] * q[0] + M3[1] * q[1] + M3[2]) / d,
            (M3[3] * q[0] + M3[4] * q[1] + M3[5]) / d];
}

function buildRig(p) {
    const SCENE_CAM = { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] };
    const { rig, init, applyPose } = createCameraRig({ THREE, scene: sceneStub, SCENE_CAM });
    init(p);
    applyPose(p);
    rig.main.updateMatrixWorld(true);
    rig.sec1.updateMatrixWorld(true);
    return rig;
}

describe('camera-rig optical-center sign', () => {
    it('renders the optical-axis point AT (cx, cy) in y-down image coords', () => {
        const p = {
            main_camera: camParams(W / 2 + 100, H / 2 + 60),
            secondary_camera: camParams(W / 2, H / 2, { position: [0.02, 0, 0], rotation_euler_deg: [0, 0, 0] }),
        };
        const rig = buildRig(p);
        // Main sits at origin looking down -Z; its optical axis point:
        const px = projectPx(rig.main, new THREE.Vector3(0, 0, -D));
        assert.ok(Math.abs(px[0] - (W / 2 + 100)) < 1e-6, `x: ${px[0]} != ${W / 2 + 100}`);
        assert.ok(Math.abs(px[1] - (H / 2 + 60)) < 1e-6, `y: ${px[1]} != ${H / 2 + 60}`);
    });

    it('H(main←sec, D) matches the rendered projections for off-center principal points', () => {
        const p = {
            main_camera: camParams(W / 2 - 40, H / 2 + 25),
            secondary_camera: camParams(W / 2 + 100, H / 2 + 60,
                { position: [0.02, 0.01, 0], rotation_euler_deg: [0, 2, 0] }),
        };
        const rig = buildRig(p);
        const H12 = computeHPair(p.main_camera, p.secondary_camera, D);   // sec px → main px
        for (const [x, y] of [[0, 0], [0.5, 0.3], [-0.6, -0.4], [0.8, -0.2]]) {
            const P = new THREE.Vector3(x, y, -D);            // on the focus plane
            const pm = projectPx(rig.main, P);
            const ps = projectPx(rig.sec1, P);
            const pred = applyH(H12, ps);
            const err = Math.hypot(pred[0] - pm[0], pred[1] - pm[1]);
            assert.ok(err < 1e-6, `point (${x},${y}): |H·p_sec − p_main| = ${err}px`);
        }
    });

    it('centered principal point still uses no view offset', () => {
        const p = {
            main_camera: camParams(W / 2, H / 2),
            secondary_camera: camParams(W / 2, H / 2, { position: [0.02, 0, 0], rotation_euler_deg: [0, 0, 0] }),
        };
        const rig = buildRig(p);
        assert.equal(rig.main.view?.enabled ?? false, false);
        const px = projectPx(rig.main, new THREE.Vector3(0, 0, -D));
        assert.ok(Math.abs(px[0] - W / 2) < 1e-6 && Math.abs(px[1] - H / 2) < 1e-6);
    });
});
