import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrajectory, CAM_TO_SRC, TRAJECTORY_VERSION } from '../src/trajectory.js';

const CAM0 = { position: [0, 1.4, 4], rotation_euler_deg: [0, 0, 0] };
const frame0 = (over = {}) => ({
    lead: 'main', follower: 'uw', zoom: 1.0, focusD: 3.0, sceneCam: CAM0, ...over,
});
const base = (frames) => ({ version: TRAJECTORY_VERSION, fps: 30, frames });

describe('parseTrajectory: schema validation', () => {
    test('rejects non-object / bad version / bad fps / empty frames', () => {
        assert.throws(() => parseTrajectory(null), /not an object/);
        assert.throws(() => parseTrajectory({ version: 99, fps: 30, frames: [frame0()] }), /version/);
        assert.throws(() => parseTrajectory({ version: 1, fps: 0, frames: [frame0()] }), /fps/);
        assert.throws(() => parseTrajectory({ version: 1, fps: 30, frames: [] }), /non-empty/);
    });

    test('frame 0 must be complete', () => {
        for (const k of ['lead', 'follower', 'zoom', 'focusD', 'sceneCam']) {
            const f = frame0(); delete f[k];
            assert.throws(() => parseTrajectory(base([f])), new RegExp(`'${k}'`));
        }
    });

    test('rejects bad cam names, lead === follower, bad zoom/focusD', () => {
        assert.throws(() => parseTrajectory(base([frame0({ lead: 'wide' })])), /bad lead/);
        assert.throws(() => parseTrajectory(base([frame0({ follower: 'x' })])), /bad follower/);
        assert.throws(() => parseTrajectory(base([frame0({ follower: 'main' })])), /lead and follower/);
        assert.throws(() => parseTrajectory(base([frame0({ zoom: -1 })])), /frame 0: bad zoom/);
        assert.throws(() => parseTrajectory(base([frame0(), { focusD: 0 }])), /frame 1: bad focusD/);
        assert.throws(() => parseTrajectory(base([frame0({ sceneCam: { position: [0, 0] } })])), /sceneCam/);
    });
});

describe('parseTrajectory: delta expansion', () => {
    test('omitted fields carry over from the previous frame', () => {
        const t = parseTrajectory(base([
            frame0(),
            { zoom: 1.5 },
            { lead: 'tele', follower: 'main', zoom: 5.2 },
            {},
        ]));
        assert.equal(t.length, 4);
        assert.equal(t.frameAt(1).zoom, 1.5);
        assert.equal(t.frameAt(1).lead, 'main');       // carried
        assert.equal(t.frameAt(1).focusD, 3.0);        // carried
        assert.equal(t.frameAt(2).lead, 'tele');
        assert.deepEqual(t.frameAt(3), t.frameAt(2));  // fully carried
        assert.deepEqual(t.frameAt(0).sceneCam, CAM0);
    });

    test('frameAt clamps out-of-range indices', () => {
        const t = parseTrajectory(base([frame0(), { zoom: 2 }]));
        assert.equal(t.frameAt(-5).zoom, 1.0);
        assert.equal(t.frameAt(99).zoom, 2);
    });

    test('camParams defaults to null and carries once set', () => {
        const cp = { main_camera: { intrinsics: { fx: 1000, fy: 1000 }, image_size: [1080, 1920] } };
        const t = parseTrajectory(base([frame0(), { camParams: cp }, {}]));
        assert.equal(t.frameAt(0).camParams, null);
        assert.deepEqual(t.frameAt(2).camParams, cp);
    });
});

describe('parseTrajectory: blend runs', () => {
    test('consecutive blend frames get linear blendT reaching 1', () => {
        const t = parseTrajectory(base([
            frame0(),                              // 0: false
            { blend: true },                       // 1: run of 4 → 0.25
            {}, {},                                // 2,3 (carry blend=true) → 0.5, 0.75
            { blend: true },                       // 4 → 1.0
            { blend: false },                      // 5
            { blend: true },                       // 6: run of 1 → 1.0
            { blend: false },                      // 7
        ]));
        assert.equal(t.frameAt(0).blendT, null);
        assert.deepEqual([1, 2, 3, 4].map(i => t.frameAt(i).blendT), [0.25, 0.5, 0.75, 1]);
        assert.equal(t.frameAt(5).blendT, null);
        assert.equal(t.frameAt(6).blendT, 1);
    });

    test('blend run extending to the last frame is closed', () => {
        const t = parseTrajectory(base([frame0(), { blend: true }, {}]));
        assert.equal(t.frameAt(1).blendT, 0.5);
        assert.equal(t.frameAt(2).blendT, 1);
    });
});

describe('constants', () => {
    test('CAM_TO_SRC matches the shader source indices', () => {
        assert.deepEqual(CAM_TO_SRC, { uw: 0, main: 1, tele: 2 });
    });
});
