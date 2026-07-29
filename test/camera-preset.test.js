import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    eulerToQuat, quatToEuler, quatMul, quatConj, quatRotate,
    isIdentityExt, relativeExt, planPresetLoad, applyPreset, buildPresetJson,
} from '../src/camera-preset.js';

const close = (a, b, msg, eps = 1e-9) => {
    assert.equal(a.length, b.length, msg);
    for (let i = 0; i < a.length; i++) {
        assert.ok(Math.abs(a[i] - b[i]) < eps, `${msg}[${i}]: ${a[i]} vs ${b[i]}`);
    }
};

const cam = (fx, pos, rot = [0, 0, 0]) => ({
    intrinsics: { fx, fy: fx, cx: 540, cy: 960 },
    extrinsics: { position: pos, rotation_euler_deg: rot },
    image_size: [1080, 1920],
});

describe('quaternion helpers', () => {
    it('euler → quat → euler round-trips', () => {
        for (const e of [[0, 0, 0], [30, 0, 0], [0, 45, 0], [0, 0, 60], [10, -20, 35]]) {
            close(quatToEuler(eulerToQuat(e)), e, `roundtrip ${e}`, 1e-9);
        }
    });
    it('quatRotate: 90° about Y maps +X to −Z', () => {
        close(quatRotate(eulerToQuat([0, 90, 0]), [1, 0, 0]), [0, 0, -1], 'Ry90', 1e-9);
    });
    it('conj inverts: q ⊗ q* = identity', () => {
        const q = eulerToQuat([10, 20, 30]);
        close(quatMul(q, quatConj(q)), [0, 0, 0, 1], 'q q*');
    });
});

describe('relativeExt', () => {
    it('identity base → returns sec unchanged', () => {
        const rel = relativeExt(
            { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] },
            { position: [0.5, 0, 0], rotation_euler_deg: [0, 5, 0] });
        close(rel.position, [0.5, 0, 0], 'pos');
        close(rel.rotation_euler_deg, [0, 5, 0], 'rot');
    });
    it('translated base → rel = sec − base', () => {
        const rel = relativeExt(
            { position: [1, 2, 3], rotation_euler_deg: [0, 0, 0] },
            { position: [1.5, 2, 3], rotation_euler_deg: [0, 0, 0] });
        close(rel.position, [0.5, 0, 0], 'pos');
    });
    it('rotated base → rel position expressed in base frame', () => {
        // base yawed 90°: world +X offset appears as −Z in base frame
        const rel = relativeExt(
            { position: [0, 0, 0], rotation_euler_deg: [0, 90, 0] },
            { position: [1, 0, 0], rotation_euler_deg: [0, 90, 0] });
        close(rel.position, [0, 0, 1], 'pos', 1e-9);   // inv(Ry90)·(+X) = +Z? verify sign
        close(rel.rotation_euler_deg, [0, 0, 0], 'rot');
    });
    it('composition round-trips: base ∘ rel = abs', () => {
        const base = { position: [1, 2, 3], rotation_euler_deg: [10, 20, 30] };
        const abs = { position: [1.4, 2.1, 2.8], rotation_euler_deg: [15, 18, 33] };
        const rel = relativeExt(base, abs);
        // recompose: p = p_base + q_base·rel_pos, q = q_base ⊗ q_rel
        const bq = eulerToQuat(base.rotation_euler_deg);
        const p = quatRotate(bq, rel.position).map((v, i) => v + base.position[i]);
        const q = quatMul(bq, eulerToQuat(rel.rotation_euler_deg));
        close(p, abs.position, 'recomposed pos', 1e-9);
        close(quatToEuler(q), abs.rotation_euler_deg, 'recomposed rot', 1e-9);
    });
});

describe('planPresetLoad / applyPreset', () => {
    const CUR = {
        sceneCam: { position: [1.7, 0.8, 4.5], rotation_euler_deg: [0, 10, 0] },
        mainExt: { position: [0.1, 0, 0], rotation_euler_deg: [0, 0, 0] },
    };
    const canonical = {
        main_camera: cam(1500, [0, 0, 0]),
        secondary_camera: cam(750, [0.5, 0, 0]),
        secondary_camera_2: cam(7500, [-0.5, 0, 0]),
    };
    const shifted = {
        main_camera: cam(1600, [2, 0, -1], [0, 90, 0]),
        secondary_camera: cam(800, [3, 0, -1], [0, 90, 0]),   // +1 world X from main
    };

    it('identity main → mainIsIdentity true', () => {
        assert.equal(planPresetLoad(canonical).mainIsIdentity, true);
        assert.equal(planPresetLoad(shifted).mainIsIdentity, false);
    });

    it('identity main: current pose kept, rel extrinsics from file', () => {
        const { camParams, sceneCam } = applyPreset(canonical, 'relative', CUR);
        close(sceneCam.position, CUR.sceneCam.position, 'sceneCam kept');
        close(camParams.main_camera.extrinsics.position, CUR.mainExt.position, 'main ext kept');
        close(camParams.secondary_camera.extrinsics.position, [0.5, 0, 0], 'sec1 rel');
        assert.equal(camParams.main_camera.intrinsics.fx, 1500, 'intrinsics from file');
    });

    it('non-identity + absolute: SCENE_CAM ← file main pose, main ext ← identity, sec used as-is', () => {
        const { camParams, sceneCam } = applyPreset(shifted, 'absolute', CUR);
        close(sceneCam.position, [2, 0, -1], 'sceneCam = file main');
        close(sceneCam.rotation_euler_deg, [0, 90, 0], 'sceneCam rot');
        close(camParams.main_camera.extrinsics.position, [0, 0, 0], 'main ext identity');
        // sec extrinsics are rig-relative in the file — used as-is, no rebase through main
        close(camParams.secondary_camera.extrinsics.position,
            shifted.secondary_camera.extrinsics.position, 'sec1 as-is from file');
    });

    it('non-identity + relative: current pose kept, sec extrinsics used as-is', () => {
        const { camParams, sceneCam } = applyPreset(shifted, 'relative', CUR);
        close(sceneCam.position, CUR.sceneCam.position, 'sceneCam kept');
        close(camParams.main_camera.extrinsics.position, CUR.mainExt.position, 'main ext kept');
        // sec extrinsics are rig-relative in the file — used as-is, no rebase through main
        close(camParams.secondary_camera.extrinsics.position,
            shifted.secondary_camera.extrinsics.position, 'sec1 as-is from file');
    });

    it('buildPresetJson: main ext forced to identity, sec exts kept', () => {
        const live = JSON.parse(JSON.stringify(canonical));
        live.main_camera.extrinsics.position = [0.3, 0.1, 0];
        const out = buildPresetJson(live);
        close(out.main_camera.extrinsics.position, [0, 0, 0], 'main identity');
        close(out.secondary_camera.extrinsics.position, [0.5, 0, 0], 'sec kept');
    });
});
