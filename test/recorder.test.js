import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder } from '../src/recorder.js';

const mockState = (overrides = {}) => ({
    zoom: 1.0, depthD: 3.0, prewarpScale: 1.0, prewarpScale2: 1.0,
    warp: false, blendX: 20, blendMode: 'single',
    sampleSrc: 1, sampleM: [1,0,0, 0,1,0, 0,0,1],
    followerSrc: 0, followerM: [1,0,0, 0,1,0, 0,0,1],
    camParams: { main_camera: { intrinsics: { fx: 1500, fy: 1500, cx: 540, cy: 960 } } },
    isBlending: false,
    ...overrides,
});

const mockSceneCam = () => ({ position: [1.7, 0.8, 4.5], rotation_euler_deg: [0, 0, 0] });

describe('createRecorder', () => {
    it('starts not recording', () => {
        const r = createRecorder({ getState: mockState, getSceneCam: mockSceneCam, getFps: () => 30 });
        assert.equal(r.isRecording(), false);
        assert.equal(r.frameCount(), 0);
    });

    it('capture is a no-op when not recording', () => {
        const r = createRecorder({ getState: mockState, getSceneCam: mockSceneCam, getFps: () => 30 });
        r.capture();
        assert.equal(r.frameCount(), 0);
    });

    it('captures frames while recording', () => {
        const r = createRecorder({ getState: mockState, getSceneCam: mockSceneCam, getFps: () => 30 });
        r.start();
        assert.equal(r.isRecording(), true);
        r.capture(); r.capture(); r.capture();
        assert.equal(r.frameCount(), 3);
    });

    it('stop produces a valid trajectory JSON', () => {
        let zoom = 1.0;
        const r = createRecorder({
            getState: () => mockState({ zoom }),
            getSceneCam: mockSceneCam,
            getFps: () => 60,
        });
        r.start();
        for (let i = 0; i < 10; i++) { zoom = 1.0 + i * 0.1; r.capture(); }
        const traj = r.stop();
        assert.equal(r.isRecording(), false);
        assert.equal(traj.version, 1);
        assert.equal(traj.fps, 60);
        assert.equal(traj.frames.length, 10);
        assert.ok(traj.name.startsWith('rec-'));
        // Frame 0 must be complete
        assert.ok('lead' in traj.frames[0]);
        assert.ok('follower' in traj.frames[0]);
        assert.ok('zoom' in traj.frames[0]);
        assert.ok('focusD' in traj.frames[0]);
        assert.ok('sceneCam' in traj.frames[0]);
    });

    it('delta encodes subsequent frames', () => {
        const r = createRecorder({ getState: mockState, getSceneCam: mockSceneCam, getFps: () => 30 });
        r.start();
        r.capture(); r.capture(); r.capture();
        const traj = r.stop();
        // Frames 1+ should be sparse (only changed fields or a zoom echo)
        const f1keys = Object.keys(traj.frames[1]);
        assert.ok(f1keys.length < Object.keys(traj.frames[0]).length,
            `delta frame has ${f1keys.length} keys vs full frame ${Object.keys(traj.frames[0]).length}`);
    });

    it('fixes lead === follower edge case', () => {
        // When sampleSrc and followerSrc are the same (edge case at boundaries)
        const r = createRecorder({
            getState: () => mockState({ sampleSrc: 1, followerSrc: 1 }),
            getSceneCam: mockSceneCam,
            getFps: () => 30,
        });
        r.start();
        r.capture();
        const traj = r.stop();
        assert.notEqual(traj.frames[0].lead, traj.frames[0].follower);
    });

    it('stop with no frames returns null', () => {
        const r = createRecorder({ getState: mockState, getSceneCam: mockSceneCam, getFps: () => 30 });
        r.start();
        const traj = r.stop();
        assert.equal(traj, null);
    });
});
