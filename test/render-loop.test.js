import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sourcesToRender, blendFeed } from '../src/render-loop.js';
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
