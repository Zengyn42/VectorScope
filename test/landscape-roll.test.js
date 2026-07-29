/**
 * Five-layer coordinate chain orientation tests.
 *
 * Sensor long edge is always x: image_size = [1920, 1080].
 * Rig pose:
 *   landscape (winW ≥ winH) → identity (qRig = null)
 *   portrait  (winW < winH) → Rz(+90°) CCW from viewer's front
 *
 * Semantics:
 *   Extrinsic +x (sensor width baseline) in landscape → horizontal parallax
 *   Extrinsic +x (sensor width baseline) in portrait  → vertical parallax
 *   (opposite of the old landscape-roll patch)
 *
 * Render (camera-rig quaternions) and homography (computeHPairWin matrix)
 * must implement the SAME physical transformation — verified by projecting
 * focus-plane points through the real THREE cameras and comparing against H.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.js';
import { createCameraRig } from '../src/camera-rig.js';
import { computeHPair, computeHPairWin } from '../src/homography.js';

const LW = 1920, LH = 1080;   // landscape window
const PW = 1080, PH = 1920;   // portrait window
const D = 3.0;
const sceneStub = { add() {}, remove() {} };
const SCENE_CAM = { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] };

function cam(w, h, ext) {
    return {
        intrinsics: { fx: 1500, fy: 1500, cx: w / 2, cy: h / 2 },
        extrinsics: ext ?? { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] },
        image_size: [w, h],
    };
}

function buildRig(p, winW, winH) {
    const r = createCameraRig({ THREE, scene: sceneStub, SCENE_CAM, getWinSize: () => [winW, winH] });
    r.init(p); r.applyPose(p);
    r.rig.main.updateMatrixWorld(true);
    r.rig.sec1.updateMatrixWorld(true);
    return r.rig;
}

const applyH = (M3, q) => {
    const d = M3[6] * q[0] + M3[7] * q[1] + M3[8];
    return [(M3[0] * q[0] + M3[1] * q[1] + M3[2]) / d,
            (M3[3] * q[0] + M3[4] * q[1] + M3[5]) / d];
};

describe('five-layer orientation (sensor always [1920,1080])', () => {
    it('landscape: extrinsic +x places sec camera to the RIGHT of main (horizontal baseline)', () => {
        const p = {
            main_camera: cam(LW, LH),
            secondary_camera: cam(LW, LH, { position: [0.5, 0, 0], rotation_euler_deg: [0, 0, 0] }),
        };
        const rig = buildRig(p, LW, LH);
        assert.ok(Math.abs(rig.sec1.position.x - (rig.main.position.x + 0.5)) < 1e-12,
            `sec1 must be 0.5 to the RIGHT of main, dx=${rig.sec1.position.x - rig.main.position.x}`);
        assert.ok(Math.abs(rig.sec1.position.y - rig.main.position.y) < 1e-12, 'no vertical offset');
    });

    it('portrait: extrinsic +x places sec camera ABOVE main (vertical baseline from Rz+90°)', () => {
        const p = {
            main_camera: cam(LW, LH),
            secondary_camera: cam(LW, LH, { position: [0.5, 0, 0], rotation_euler_deg: [0, 0, 0] }),
        };
        const rig = buildRig(p, PW, PH);
        assert.ok(Math.abs(rig.sec1.position.x - rig.main.position.x) < 1e-12, 'no horizontal offset');
        assert.ok(Math.abs(rig.sec1.position.y - (rig.main.position.y + 0.5)) < 1e-12,
            `sec1 must sit 0.5 ABOVE main (CCW roll), dy=${rig.sec1.position.y - rig.main.position.y}`);
    });

    it('landscape H: +x baseline produces horizontal-only parallax at frame center', () => {
        const mc = cam(LW, LH);
        const sc = cam(LW, LH, { position: [0.5, 0, 0], rotation_euler_deg: [0, 0, 0] });
        const H = computeHPairWin(mc, sc, D, LW, LH);
        const [u, v] = applyH(H, [LW / 2, LH / 2]);
        assert.ok(Math.abs(v - LH / 2) < 1e-9, `vertical parallax must vanish, dv=${v - LH / 2}`);
        assert.ok(Math.abs(u - LW / 2) > 50, `horizontal parallax expected, du=${u - LW / 2}`);
    });

    it('portrait H: +x baseline produces VERTICAL parallax in the portrait window', () => {
        /* Portrait = phone rotated CCW: the rig (cameras + baseline) rolls
           Rz(+90°) and the DISPLAY rotates the sensor image back +90° CCW so
           world content stays upright. The sensor-x baseline parallax
           therefore appears VERTICAL (上下) on screen — confirmed semantics. */
        const mc = cam(LW, LH);
        const sc = cam(LW, LH, { position: [0.5, 0, 0], rotation_euler_deg: [0, 0, 0] });
        const H = computeHPairWin(mc, sc, D, PW, PH);
        const [u, v] = applyH(H, [PW / 2, PH / 2]);
        assert.ok(Math.abs(u - PW / 2) < 1e-9, `horizontal parallax must vanish, du=${u - PW / 2}`);
        assert.ok(Math.abs(v - PH / 2) > 50, `vertical parallax expected, dv=${v - PH / 2}`);
    });

    it('landscape H is exactly computeHPair (no W rotation)', () => {
        const mc = cam(LW, LH);
        const sc = cam(LW, LH, { position: [0.3, 0.1, 0], rotation_euler_deg: [1, 2, 0.5] });
        const a = computeHPairWin(mc, sc, D, LW, LH);
        const b = computeHPair(mc, sc, D);
        for (let i = 0; i < 9; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-12, `elem ${i}`);
    });

    it('landscape render vs H consistency (offset + rotation extrinsics)', () => {
        const p = {
            main_camera: cam(LW, LH),
            secondary_camera: cam(LW, LH, { position: [0.04, 0.015, 0.01], rotation_euler_deg: [1.5, 2.5, 0.8] }),
        };
        const rig = buildRig(p, LW, LH);
        const projectPx = (c, pt) => {
            const v = pt.clone().project(c);
            return [(v.x + 1) / 2 * LW, (1 - v.y) / 2 * LH];
        };
        const H = computeHPairWin(p.main_camera, p.secondary_camera, D, LW, LH);
        for (const [x, y] of [[0, 0], [0.5, 0.3], [-0.6, -0.2], [0.8, -0.4]]) {
            const P = new THREE.Vector3(x, y, -D);
            const pm = projectPx(rig.main, P);
            const ps = projectPx(rig.sec1, P);
            const pred = applyH(H, ps);
            const err = Math.hypot(pred[0] - pm[0], pred[1] - pm[1]);
            assert.ok(err < 1e-6, `landscape point (${x},${y}): |H·p_sec − p_main| = ${err}px`);
        }
    });

    it('portrait render vs H consistency (offset + rotation extrinsics)', () => {
        const p = {
            main_camera: cam(LW, LH),
            secondary_camera: cam(LW, LH, { position: [0.04, 0.015, 0.01], rotation_euler_deg: [1.5, 2.5, 0.8] }),
        };
        const rig = buildRig(p, PW, PH);
        const projectPx = (c, pt) => {
            const v = pt.clone().project(c);
            return [(v.x + 1) / 2 * PW, (1 - v.y) / 2 * PH];
        };
        const H = computeHPairWin(p.main_camera, p.secondary_camera, D, PW, PH);
        for (const [x, y] of [[0, 0], [0.5, 0.3], [-0.6, -0.2], [0.8, -0.4]]) {
            const P = new THREE.Vector3(x, y, -D);
            const pm = projectPx(rig.main, P);
            const ps = projectPx(rig.sec1, P);
            const pred = applyH(H, ps);
            const err = Math.hypot(pred[0] - pm[0], pred[1] - pm[1]);
            assert.ok(err < 1e-6, `portrait point (${x},${y}): |H·p_sec − p_main| = ${err}px`);
        }
    });

    it('landscape render vs H: sensor ≠ window + off-center optical axis', () => {
        const p = {
            main_camera: {
                intrinsics: { fx: 1500, fy: 1500, cx: 2 * LW / 2 - 30, cy: 2 * LH / 2 + 20 },
                extrinsics: { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] },
                image_size: [2 * LW, 2 * LH],
            },
            secondary_camera: cam(LW, LH, { position: [0.05, 0, 0], rotation_euler_deg: [0, 1.5, 0] }),
        };
        const rig = buildRig(p, LW, LH);
        const projectPx = (c, pt) => {
            const v = pt.clone().project(c);
            return [(v.x + 1) / 2 * LW, (1 - v.y) / 2 * LH];
        };
        const H = computeHPairWin(p.main_camera, p.secondary_camera, D, LW, LH);
        for (const [x, y] of [[0, 0], [0.5, 0.3], [-0.4, -0.3]]) {
            const P = new THREE.Vector3(x, y, -D);
            const pm = projectPx(rig.main, P);
            const ps = projectPx(rig.sec1, P);
            const pred = applyH(H, ps);
            const err = Math.hypot(pred[0] - pm[0], pred[1] - pm[1]);
            assert.ok(err < 1e-6, `landscape off-center (${x},${y}): err=${err}px`);
        }
    });

    it('portrait render vs H: sensor ≠ window + off-center optical axis', () => {
        const p = {
            main_camera: {
                intrinsics: { fx: 1500, fy: 1500, cx: 2 * LW / 2 - 30, cy: 2 * LH / 2 + 20 },
                extrinsics: { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] },
                image_size: [2 * LW, 2 * LH],
            },
            secondary_camera: cam(LW, LH, { position: [0.05, 0, 0], rotation_euler_deg: [0, 1.5, 0] }),
        };
        const rig = buildRig(p, PW, PH);
        const projectPx = (c, pt) => {
            const v = pt.clone().project(c);
            return [(v.x + 1) / 2 * PW, (1 - v.y) / 2 * PH];
        };
        const H = computeHPairWin(p.main_camera, p.secondary_camera, D, PW, PH);
        for (const [x, y] of [[0, 0], [0.3, 0.5], [-0.2, -0.4]]) {
            const P = new THREE.Vector3(x, y, -D);
            const pm = projectPx(rig.main, P);
            const ps = projectPx(rig.sec1, P);
            const pred = applyH(H, ps);
            const err = Math.hypot(pred[0] - pm[0], pred[1] - pm[1]);
            assert.ok(err < 1e-6, `portrait off-center (${x},${y}): err=${err}px`);
        }
    });

    it('portrait: world content stays upright (identity-ext camera is unrolled)', () => {
        /* The rig body roll is cancelled by the display rotation for the
           camera ORIENTATION — a camera with identity extrinsics must render
           with the same orientation as SCENE_CAM (no roll on screen). */
        const p = { main_camera: cam(LW, LH), secondary_camera: cam(LW, LH) };
        const rig = buildRig(p, PW, PH);
        const q = rig.main.quaternion;
        assert.ok(Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) < 1e-12 && Math.abs(q.w - 1) < 1e-12,
            `main camera must be unrolled in portrait, q=(${q.x},${q.y},${q.z},${q.w})`);
    });

    it('main extrinsics edit does not affect UW/Tele world positions (rig-frame independence)', () => {
        // UW and Tele are positioned relative to the rig frame, not main.
        // Moving main's extrinsics offset should NOT move UW/Tele.
        const p = {
            main_camera: cam(LW, LH, { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] }),
            secondary_camera: cam(LW, LH, { position: [0.5, 0, 0], rotation_euler_deg: [0, 0, 0] }),
        };
        const rig = buildRig(p, LW, LH);
        const sec1Before = rig.sec1.position.x;

        // Move main's extrinsics offset
        const p2 = {
            main_camera: cam(LW, LH, { position: [0.1, 0, 0], rotation_euler_deg: [0, 0, 0] }),
            secondary_camera: cam(LW, LH, { position: [0.5, 0, 0], rotation_euler_deg: [0, 0, 0] }),
        };
        const rig2 = buildRig(p2, LW, LH);
        // UW stays at 0.5 from rig origin regardless of where main is
        assert.ok(Math.abs(rig2.sec1.position.x - sec1Before) < 1e-12,
            `UW x should remain ${sec1Before}, got ${rig2.sec1.position.x}`);
    });
});
