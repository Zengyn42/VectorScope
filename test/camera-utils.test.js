import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SRC, paramKeyOf, camOf } from '../src/camera-utils.js';
import { SRC as SRC_ZP } from '../src/zoom-pipeline.js';

describe('camera-utils', () => {
    it('SRC re-export from zoom-pipeline is the same object', () => {
        assert.equal(SRC_ZP, SRC);
        assert.deepEqual(SRC, { SEC1: 0, MAIN: 1, SEC2: 2 });
    });

    it('paramKeyOf maps every source index', () => {
        assert.equal(paramKeyOf(SRC.SEC1), 'secondary_camera');
        assert.equal(paramKeyOf(SRC.SEC2), 'secondary_camera_2');
        assert.equal(paramKeyOf(SRC.MAIN), 'main_camera');
    });

    it('camOf returns the matching params block', () => {
        const params = {
            main_camera: { id: 'm' },
            secondary_camera: { id: 'uw' },
            secondary_camera_2: { id: 'tele' },
        };
        assert.equal(camOf(params, SRC.MAIN).id, 'm');
        assert.equal(camOf(params, SRC.SEC1).id, 'uw');
        assert.equal(camOf(params, SRC.SEC2).id, 'tele');
    });

    it('camOf is safe on missing cameras / params', () => {
        assert.equal(camOf({ main_camera: {} }, SRC.SEC2), undefined);
        assert.equal(camOf(null, SRC.MAIN), undefined);
        assert.equal(camOf(undefined, SRC.SEC1), undefined);
    });
});
