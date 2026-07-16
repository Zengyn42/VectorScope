import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sourcesToRender, blendFeed, frameGate, bevDue, paceDue } from '../src/render-loop.js';
import { SRC } from '../src/zoom-pipeline.js';

describe('sourcesToRender', () => {
    it('single mode renders only the leading source (frozen-outgoing trick)', () => {
        assert.deepEqual(
            sourcesToRender({ zsrc: SRC.MAIN, dual: false, blending: true, followerSrc: SRC.SEC1, hasS2: true }),
            [SRC.MAIN]);
    });

    it('dual mode without an active blend renders only the leading source', () => {
        assert.deepEqual(
            sourcesToRender({ zsrc: SRC.MAIN, dual: true, blending: false, followerSrc: SRC.SEC1, hasS2: true }),
            [SRC.MAIN]);
    });

    it('dual mode during a blend also renders the live follower RT', () => {
        assert.deepEqual(
            sourcesToRender({ zsrc: SRC.MAIN, dual: true, blending: true, followerSrc: SRC.SEC1, hasS2: true }),
            [SRC.MAIN, SRC.SEC1]);
        assert.deepEqual(
            sourcesToRender({ zsrc: SRC.SEC2, dual: true, blending: true, followerSrc: SRC.MAIN, hasS2: true }),
            [SRC.SEC2, SRC.MAIN]);
    });

    it('never renders the follower twice when it equals the leading source', () => {
        assert.deepEqual(
            sourcesToRender({ zsrc: SRC.MAIN, dual: true, blending: true, followerSrc: SRC.MAIN, hasS2: true }),
            [SRC.MAIN]);
    });

    it('skips a null follower (refreshH not yet run)', () => {
        assert.deepEqual(
            sourcesToRender({ zsrc: SRC.MAIN, dual: true, blending: true, followerSrc: null, hasS2: true }),
            [SRC.MAIN]);
    });

    it('skips a Tele follower when the rig has no Tele camera', () => {
        assert.deepEqual(
            sourcesToRender({ zsrc: SRC.MAIN, dual: true, blending: true, followerSrc: SRC.SEC2, hasS2: false }),
            [SRC.MAIN]);
    });
});

describe('blendFeed', () => {
    const mA = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const mB = [2, 0, 0, 0, 2, 0, 0, 0, 1];
    const mLive = [3, 0, 0, 0, 3, 0, 0, 0, 1];

    it('passes t through and yields no prev layer when the controller is idle', () => {
        assert.deepEqual(
            blendFeed({ t: 1, prevSrc: null, prevM: null, dual: false, followerSrc: SRC.SEC1, followerM: mB }),
            { uBlend: 1, prev: null });
    });

    it('single mode samples the frozen pixels through the LIVE matrix for that source', () => {
        const feed = blendFeed({
            t: 0.4, prevSrc: SRC.SEC1, prevM: mA, dual: false,
            followerSrc: SRC.MAIN, followerM: mB,
            liveM: { [SRC.SEC1]: mLive },
        });
        assert.equal(feed.uBlend, 0.4);
        assert.deepEqual(feed.prev, { src: SRC.SEC1, m: mLive });
    });

    it('single mode tracks liveM updates mid-blend (zoom motion during cross-fade)', () => {
        const liveM = { [SRC.SEC1]: mLive };
        const args = { t: 0.2, prevSrc: SRC.SEC1, prevM: mA, dual: false, followerSrc: SRC.MAIN, followerM: mB, liveM };
        assert.deepEqual(blendFeed(args).prev.m, mLive);
        const mLive2 = [4, 0, 0, 0, 4, 0, 0, 0, 1];
        liveM[SRC.SEC1] = mLive2;   // refreshH ran again at a new zoom
        assert.deepEqual(blendFeed({ ...args, t: 0.6 }).prev.m, mLive2);
    });

    it('single mode falls back to the frozen matrix when liveM is missing', () => {
        const noMap = blendFeed({ t: 0.4, prevSrc: SRC.SEC1, prevM: mA, dual: false, followerSrc: SRC.MAIN, followerM: mB });
        assert.deepEqual(noMap.prev, { src: SRC.SEC1, m: mA });
        const noEntry = blendFeed({
            t: 0.4, prevSrc: SRC.SEC1, prevM: mA, dual: false,
            followerSrc: SRC.MAIN, followerM: mB, liveM: { [SRC.MAIN]: mLive },
        });
        assert.deepEqual(noEntry.prev, { src: SRC.SEC1, m: mA });
    });

    it('dual mode feeds the live follower state and ignores liveM', () => {
        const feed = blendFeed({
            t: 0.4, prevSrc: SRC.SEC1, prevM: mA, dual: true,
            followerSrc: SRC.MAIN, followerM: mB, liveM: { [SRC.SEC1]: mLive },
        });
        assert.equal(feed.uBlend, 0.4);
        assert.deepEqual(feed.prev, { src: SRC.MAIN, m: mB });
    });
});

describe('frameGate (idle skipping)', () => {
    const KA = 30;

    it('renders while continuous activity (anims/blend/drag), never final', () => {
        assert.deepEqual(
            frameGate({ continuous: true, dirtyFrames: 0, skipped: 0, keepAlive: KA }),
            { render: true, finalFrame: false });
    });

    it('renders dirty frames; the last one is final (forces BEV)', () => {
        assert.deepEqual(
            frameGate({ continuous: false, dirtyFrames: 3, skipped: 0, keepAlive: KA }),
            { render: true, finalFrame: false });
        assert.deepEqual(
            frameGate({ continuous: false, dirtyFrames: 1, skipped: 0, keepAlive: KA }),
            { render: true, finalFrame: true });
    });

    it('skips when idle', () => {
        assert.deepEqual(
            frameGate({ continuous: false, dirtyFrames: 0, skipped: 5, keepAlive: KA }),
            { render: false, finalFrame: false });
    });

    it('keep-alive heartbeat fires as a final frame', () => {
        assert.deepEqual(
            frameGate({ continuous: false, dirtyFrames: 0, skipped: KA, keepAlive: KA }),
            { render: true, finalFrame: true });
    });

    it('continuous + dirty renders but is not final', () => {
        assert.deepEqual(
            frameGate({ continuous: true, dirtyFrames: 1, skipped: 0, keepAlive: KA }),
            { render: true, finalFrame: false });
    });
});

describe('bevDue (BEV rate reduction)', () => {
    it('final frames always render BEV', () => {
        assert.equal(bevDue({ finalFrame: true, tick: 1, interval: 4 }), true);
    });

    it('otherwise BEV renders every interval-th frame only', () => {
        const due = [1, 2, 3, 4, 5, 6, 7, 8]
            .map(tick => bevDue({ finalFrame: false, tick, interval: 4 }));
        assert.deepEqual(due, [false, false, false, true, false, false, false, true]);
    });
});

describe('paceDue (fixed-rate loop pacing)', () => {
    it('fps <= 0 disables pacing (render every tick)', () => {
        assert.equal(paceDue({ now: 10, last: 9, fps: 0 }), true);
        assert.equal(paceDue({ now: 10, last: 9, fps: -1 }), true);
    });

    it('renders only after ~1000/fps ms', () => {
        assert.equal(paceDue({ now: 16.7, last: 0, fps: 30 }), false);
        assert.equal(paceDue({ now: 33.4, last: 0, fps: 30 }), true);
    });

    it('60Hz rAF at 30fps: every other tick renders', () => {
        let last = 0;
        const pattern = [];
        for (let i = 1; i <= 6; i++) {
            const now = i * 16.67;
            const due = paceDue({ now, last, fps: 30 });
            if (due) last = now;
            pattern.push(due);
        }
        assert.deepEqual(pattern, [false, true, false, true, false, true]);
    });

    it('120Hz rAF at 30fps: every 4th tick renders', () => {
        let last = 0, renders = 0;
        for (let i = 1; i <= 12; i++) {
            const now = i * (1000 / 120);
            if (paceDue({ now, last, fps: 30 })) { last = now; renders++; }
        }
        assert.equal(renders, 3);
    });

    it('jitter tolerance: 33.0ms elapsed still counts at 30fps', () => {
        assert.equal(paceDue({ now: 33.0, last: 0, fps: 30 }), true);
    });
});
