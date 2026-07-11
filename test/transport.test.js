import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../src/transport.js';
import { parseTrajectory } from '../src/trajectory.js';

const CAM0 = { position: [0, 1.4, 4], rotation_euler_deg: [0, 0, 0] };
const mkTraj = (n, fps = 30) => parseTrajectory({
    version: 1, fps,
    frames: Array.from({ length: n }, (_, i) => i === 0
        ? { lead: 'main', follower: 'uw', zoom: 1, focusD: 3, sceneCam: CAM0 }
        : { zoom: 1 + i * 0.01 }),
});

function mk(n = 10, fps = 30) {
    let t = 0;
    const events = [];
    const tp = createTransport({ now: () => t, onChange: (e) => events.push(e) });
    return { tp, events, tick: (ms) => { t += ms; return t; }, timeRef: () => t, load: () => tp.load(mkTraj(n, fps)) };
}

describe('transport: mode transitions', () => {
    test('load keeps FREE mode (rules active until Play)', () => {
        const { tp, load } = mk();
        assert.equal(tp.getMode(), 'free');
        load();
        assert.equal(tp.getMode(), 'free');
        assert.equal(tp.isEngaged(), false);
        assert.equal(tp.current(), null);
    });

    test('play → playing; pause → paused; stop → free (traj kept)', () => {
        const { tp, load } = mk();
        tp.play();                                   // no trajectory: no-op
        assert.equal(tp.getMode(), 'free');
        load();
        tp.play();
        assert.equal(tp.getMode(), 'playing');
        assert.ok(tp.current());
        tp.pause();
        assert.equal(tp.getMode(), 'paused');
        tp.stop();
        assert.equal(tp.getMode(), 'free');
        assert.ok(tp.getTrajectory(), 'trajectory stays loaded after stop');
        tp.eject();
        assert.equal(tp.getTrajectory(), null);
    });

    test('seek from free mode engages paused mode', () => {
        const { tp, load } = mk();
        load();
        tp.seek(4);
        assert.equal(tp.getMode(), 'paused');
        assert.equal(tp.getFrame(), 4);
    });
});

describe('transport: advance (playing)', () => {
    test('advances one frame per fps period, drops late frames', () => {
        const { tp, load, tick, timeRef } = mk(100, 30);   // period ≈ 33.3ms
        load(); tp.play();
        assert.equal(tp.advance(timeRef()), false, 'no period elapsed yet');
        assert.equal(tp.advance(tick(33.4)), true);
        assert.equal(tp.getFrame(), 1);
        assert.equal(tp.advance(tick(10)), false, 'mid-period tick ignored');
        assert.equal(tp.advance(tick(90)), true, '3 periods elapsed');
        assert.equal(tp.getFrame(), 4, 'late frames dropped by jumping the counter');
    });

    test('pauses on the last frame at the end', () => {
        const { tp, load, tick } = mk(3, 30);
        load(); tp.play();
        tp.advance(tick(34)); tp.advance(tick(34));
        assert.equal(tp.getFrame(), 2);
        assert.equal(tp.advance(tick(34)), true, 'end-of-traj still reports a change');
        assert.equal(tp.getFrame(), 2);
        assert.equal(tp.getMode(), 'paused');
    });

    test('advance is a no-op when not playing', () => {
        const { tp, load, tick } = mk();
        load();
        assert.equal(tp.advance(tick(100)), false);
        tp.seek(1);
        assert.equal(tp.advance(tick(100)), false);
    });
});

describe('transport: step / seek', () => {
    test('step pauses playback and moves exactly one frame', () => {
        const { tp, load } = mk();
        load(); tp.play();
        tp.step(+1);
        assert.equal(tp.getMode(), 'paused');
        assert.equal(tp.getFrame(), 1);
        tp.step(-1);
        assert.equal(tp.getFrame(), 0);
        tp.step(-1);
        assert.equal(tp.getFrame(), 0, 'clamped at 0');
    });

    test('seek clamps to trajectory range', () => {
        const { tp, load } = mk(5);
        load();
        tp.seek(99);
        assert.equal(tp.getFrame(), 4);
        tp.seek(-3);
        assert.equal(tp.getFrame(), 0);
    });
});

describe('transport: master clock', () => {
    test('free mode: wall time; engaged: exact frame time', () => {
        const { tp, load, tick, timeRef } = mk(100, 25);   // 40ms/frame
        tick(500);
        assert.equal(tp.timeMs(), timeRef(), 'free mode = wall clock');
        load();
        assert.equal(tp.timeMs(), timeRef(), 'armed but free = wall clock');
        tp.seek(10);
        assert.equal(tp.timeMs(), 400, 'frame 10 @25fps = 400ms');
        tp.step(+1);
        assert.equal(tp.timeMs(), 440);
        tp.stop();
        assert.equal(tp.timeMs(), timeRef());
    });

    test('clock is deterministic under seek (same frame → same time)', () => {
        const { tp, load } = mk(50, 30);
        load();
        tp.seek(20); const a = tp.timeMs();
        tp.seek(5); tp.seek(20);
        assert.equal(tp.timeMs(), a);
    });
});

describe('transport: onChange events', () => {
    test('emits load/play/frame/pause/stop', () => {
        const { tp, load, events, tick } = mk(3, 30);
        load(); tp.play(); tp.advance(tick(34)); tp.pause(); tp.stop();
        assert.deepEqual(events, ['load', 'play', 'frame', 'pause', 'stop']);
    });
});
