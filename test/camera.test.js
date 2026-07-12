import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_CAM, DEF_CAM } from '../src/camera.js';

describe('camera exports', () => {
    describe('SCENE_CAM', () => {
        it('has position and rotation_euler_deg arrays', () => {
            assert.ok(Array.isArray(SCENE_CAM.position));
            assert.equal(SCENE_CAM.position.length, 3);
            assert.ok(Array.isArray(SCENE_CAM.rotation_euler_deg));
            assert.equal(SCENE_CAM.rotation_euler_deg.length, 3);
        });

        it('is mutable', () => {
            const orig = SCENE_CAM.position.slice();
            SCENE_CAM.position = [0, 0, 0];
            assert.deepEqual(SCENE_CAM.position, [0, 0, 0]);
            SCENE_CAM.position = orig;  // restore
        });
    });

    describe('DEF_CAM', () => {
        it('has main_camera with intrinsics, extrinsics, image_size', () => {
            const m = DEF_CAM.main_camera;
            assert.ok(m.intrinsics);
            assert.ok(m.extrinsics);
            assert.ok(m.image_size);
            assert.equal(m.intrinsics.fx, 1500);
            assert.equal(m.intrinsics.fy, 1500);
            assert.deepEqual(m.extrinsics.position, [0, 0, 0]);
        });

        it('has secondary_camera (UW) with wider FOV than main', () => {
            const uw = DEF_CAM.secondary_camera;
            assert.ok(uw.intrinsics.fx < DEF_CAM.main_camera.intrinsics.fx,
                'UW focal length should be less than main (wider FOV)');
        });

        it('has secondary_camera_2 (Tele) with narrower FOV than main', () => {
            const tele = DEF_CAM.secondary_camera_2;
            assert.ok(tele.intrinsics.fx > DEF_CAM.main_camera.intrinsics.fx,
                'Tele focal length should be greater than main (narrower FOV)');
        });

        it('focal length ratios match expected prewarp nominals', () => {
            const fMain = DEF_CAM.main_camera.intrinsics.fx;
            const fUW = DEF_CAM.secondary_camera.intrinsics.fx;
            const fTele = DEF_CAM.secondary_camera_2.intrinsics.fx;
            // prewarp1 ≈ fMain / fUW = 2.0, prewarp2 ≈ fTele / fMain = 5.0
            assert.equal(fMain / fUW, 2.0);
            assert.equal(fTele / fMain, 5.0);
        });

        it('all cameras share the same image_size', () => {
            const sz = DEF_CAM.main_camera.image_size;
            assert.deepEqual(DEF_CAM.secondary_camera.image_size, sz);
            assert.deepEqual(DEF_CAM.secondary_camera_2.image_size, sz);
        });

        it('main camera has identity extrinsics (reference frame)', () => {
            const ext = DEF_CAM.main_camera.extrinsics;
            assert.deepEqual(ext.position, [0, 0, 0]);
            assert.deepEqual(ext.rotation_euler_deg, [0, 0, 0]);
        });
    });
});
