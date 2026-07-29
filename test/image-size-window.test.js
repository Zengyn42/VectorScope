/**
 * Regression tests for the image-size (sensor vs window) semantics.
 *
 * image_size is the SENSOR extent. The displayed output is a 1:1,
 * center-anchored winW×winH window of the sensor — sensor px ↔ window px
 * conversion is a pure center-aligned TRANSLATION
 * (u_win = u_img − (imgW/2 − winW/2)), never a scale.
 *
 * Consequences under test:
 *  - computeHPairWin == computeHPair when sensor == window (default rig);
 *  - enlarging the sensor with a centered optical axis changes NOTHING
 *    (homography, sampling matrices, rendered projections);
 *  - the homography depends on the optical center only through its offset
 *    from the SENSOR center (cx − imgW/2);
 *  - the real THREE render (camera-rig applyPose with getWinSize) stays
 *    consistent with computeHPairWin for sensor ≠ window cameras.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.js';
import { createCameraRig } from '../src/camera-rig.js';
import { computeHPair, computeHPairWin } from '../src/homography.js';
import { computeSampleMatrix, computeFollowerMatrix } from '../src/zoom-pipeline.js';

const W = 1080, H = 1920, D = 3.0;   // window (= RT) size
const sceneStub = { add() {}, remove() {} };

function cam(imgW, imgH, dcx, dcy, ext) {
    return {
        intrinsics: { fx: 1500, fy: 1500, cx: imgW / 2 + (dcx || 0), cy: imgH / 2 + (dcy || 0) },
        extrinsics: ext ?? { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] },
        image_size: [imgW, imgH],
    };
}

const SEC_EXT = { position: [0.02, 0.01, 0], rotation_euler_deg: [0, 2, 0] };

function assertMatClose(A, B, tol, msg) {
    const a = A.map(v => v / A[8]), b = B.map(v => v / B[8]);
    for (let i = 0; i < 9; i++) {
        assert.ok(Math.abs(a[i] - b[i]) < tol, `${msg}: [${i}] ${a[i]} != ${b[i]}`);
    }
}

describe('image-size window semantics (center-aligned translation)', () => {
    it('computeHPairWin equals computeHPair when sensor == window', () => {
        const mc = cam(W, H, 0, 0), sc = cam(W, H, 0, 0, SEC_EXT);
        assertMatClose(computeHPairWin(mc, sc, D, W, H), computeHPair(mc, sc, D),
            1e-12, 'sensor==window');
    });

    it('enlarging the sensor (centered cx) does not change the window homography', () => {
        const base = computeHPairWin(cam(W, H, 0, 0), cam(W, H, 0, 0, SEC_EXT), D, W, H);
        const big = computeHPairWin(cam(2 * W, 2 * H, 0, 0), cam(W + 400, H + 300, 0, 0, SEC_EXT), D, W, H);
        assertMatClose(big, base, 1e-9, 'sensor enlarged');
    });

    it('H depends only on the optical-center offset from the SENSOR center', () => {
        const a = computeHPairWin(cam(W, H, 30, -20), cam(W, H, -15, 10, SEC_EXT), D, W, H);
        const b = computeHPairWin(cam(2 * W, 2 * H, 30, -20), cam(W + 600, H + 200, -15, 10, SEC_EXT), D, W, H);
        assertMatClose(b, a, 1e-9, 'same cx offset, different sensors');
    });

    it('sampling matrices are invariant under sensor enlargement (warp ON, all segments)', () => {
        const mk = (s) => ({
            main_camera: cam(W * s, H * s, 0, 0),
            secondary_camera: cam(W * s, H * s, 0, 0, { position: [0.02, 0, 0], rotation_euler_deg: [0, 1, 0] }),
            secondary_camera_2: cam(W * s, H * s, 0, 0, { position: [-0.01, 0.005, 0], rotation_euler_deg: [1, -1, 0] }),
        });
        for (const z of [0.6, 0.9, 1.5, 3.0, 7.0]) {
            const opts = { z, warp: true, D, prewarp1: 2, prewarp2: 5, w: W, h: H };
            const base = computeSampleMatrix({ ...opts, params: mk(1) });
            const big = computeSampleMatrix({ ...opts, params: mk(2) });
            assert.equal(big.src, base.src, `z=${z} src`);
            assertMatClose(big.m, base.m, 1e-6, `z=${z} lead matrix`);
            const fb = computeFollowerMatrix({ ...opts, params: mk(1) });
            const fB = computeFollowerMatrix({ ...opts, params: mk(2) });
            assert.equal(fB.src, fb.src, `z=${z} follower src`);
            assertMatClose(fB.m, fb.m, 1e-6, `z=${z} follower matrix`);
        }
    });

    it('real THREE render matches computeHPairWin for sensor ≠ window cameras', () => {
        const p = {
            main_camera: cam(2 * W, 2 * H, -40, 25),          // big sensor, off-center axis
            secondary_camera: cam(W + 400, H + 300, 100, 60, SEC_EXT),
        };
        const SCENE_CAM = { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] };
        const { rig, init, applyPose } = createCameraRig({
            THREE, scene: sceneStub, SCENE_CAM, getWinSize: () => [W, H],
        });
        init(p); applyPose(p);
        rig.main.updateMatrixWorld(true);
        rig.sec1.updateMatrixWorld(true);

        // Rendered output is the winW×winH window → NDC maps to window px.
        const projectPx = (c, pt) => {
            const v = pt.clone().project(c);
            return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
        };
        const applyH = (M3, q) => {
            const d = M3[6] * q[0] + M3[7] * q[1] + M3[8];
            return [(M3[0] * q[0] + M3[1] * q[1] + M3[2]) / d,
                    (M3[3] * q[0] + M3[4] * q[1] + M3[5]) / d];
        };

        // Axis point of main renders at the TRANSLATED window position
        const px0 = projectPx(rig.main, new THREE.Vector3(0, 0, -D));
        assert.ok(Math.abs(px0[0] - (W / 2 - 40)) < 1e-6, `axis x: ${px0[0]}`);
        assert.ok(Math.abs(px0[1] - (H / 2 + 25)) < 1e-6, `axis y: ${px0[1]}`);

        const H12 = computeHPairWin(p.main_camera, p.secondary_camera, D, W, H);
        for (const [x, y] of [[0, 0], [0.4, 0.3], [-0.5, -0.2], [0.6, -0.4]]) {
            const P = new THREE.Vector3(x, y, -D);            // on the focus plane
            const pm = projectPx(rig.main, P);
            const ps = projectPx(rig.sec1, P);
            const pred = applyH(H12, ps);
            const err = Math.hypot(pred[0] - pm[0], pred[1] - pm[1]);
            assert.ok(err < 1e-6, `point (${x},${y}): |H·p_sec − p_main| = ${err}px`);
        }
    });

    it('render is invariant under sensor enlargement (centered axis)', () => {
        const SCENE_CAM = { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] };
        const build = (s) => {
            const p = {
                main_camera: cam(W * s, H * s, 0, 0),
                secondary_camera: cam(W * s, H * s, 0, 0, SEC_EXT),
            };
            const r = createCameraRig({ THREE, scene: sceneStub, SCENE_CAM, getWinSize: () => [W, H] });
            r.init(p); r.applyPose(p);
            r.rig.main.updateMatrixWorld(true);
            return r.rig.main;
        };
        const c1 = build(1), c2 = build(2);
        for (const [x, y] of [[0.5, 0.3], [-0.6, -0.4]]) {
            const P = new THREE.Vector3(x, y, -D);
            const a = P.clone().project(c1), b = P.clone().project(c2);
            assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9,
                `projection moved: (${a.x},${a.y}) vs (${b.x},${b.y})`);
        }
    });
});
