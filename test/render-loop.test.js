import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sourcesToRender, blendFeed, frameGate, bevDue } from '../src/render-loop.js';
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

    it('passes t through and yields no prev layer when the controller is idle', () => {
        assert.deepEqual(
            blendFeed({ t: 1, prevSrc: null, prevM: null, dual: false, followerSrc: SRC.SEC1, followerM: mB }),
            { uBlend: 1, prev: null });
    });

    it('single mode feeds the frozen outgoing state from the controller', () => {
        const feed = blendFeed({ t: 0.4, prevSrc: SRC.SEC1, prevM: mA, dual: false, followerSrc: SRC.MAIN, followerM: mB });
        assert.equal(feed.uBlend, 0.4);
        assert.deepEqual(feed.prev, { src: SRC.SEC1, m: mA });
    });

    it('dual mode feeds the live follower state instead', () => {
        const feed = blendFeed({ t: 0.4, prevSrc: SRC.SEC1, prevM: mA, dual: true, followerSrc: SRC.MAIN, followerM: mB });
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
