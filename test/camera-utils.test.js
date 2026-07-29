import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SRC, paramKeyOf, camOf, focalPrewarps } from '../src/camera-utils.js';
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

    it('focalPrewarps: prewarp1 = f_Main/f_UW, prewarp2 = f_Tele/f_Main', () => {
        const r = focalPrewarps({
            main_camera: { intrinsics: { fx: 1500 } },
            secondary_camera: { intrinsics: { fx: 750 } },
            secondary_camera_2: { intrinsics: { fx: 7500 } },
        });
        assert.equal(r.prewarp1, 2);
        assert.equal(r.prewarp2, 5);
    });

    it('focalPrewarps: non-integer ratios pass through unrounded', () => {
        const r = focalPrewarps({
            main_camera: { intrinsics: { fx: 1200 } },
            secondary_camera: { intrinsics: { fx: 900 } },
            secondary_camera_2: { intrinsics: { fx: 4200 } },
        });
        assert.ok(Math.abs(r.prewarp1 - 1200 / 900) < 1e-12);
        assert.ok(Math.abs(r.prewarp2 - 4200 / 1200) < 1e-12);
    });

    it('focalPrewarps: missing Tele / bad focals → null (leave slider untouched)', () => {
        const noTele = focalPrewarps({
            main_camera: { intrinsics: { fx: 1500 } },
            secondary_camera: { intrinsics: { fx: 750 } },
        });
        assert.equal(noTele.prewarp1, 2);
        assert.equal(noTele.prewarp2, null);

        const zero = focalPrewarps({
            main_camera: { intrinsics: { fx: 0 } },
            secondary_camera: { intrinsics: { fx: 750 } },
            secondary_camera_2: { intrinsics: { fx: 7500 } },
        });
        assert.equal(zero.prewarp1, null);
        assert.equal(zero.prewarp2, null);

        assert.deepEqual(focalPrewarps(null), { prewarp1: null, prewarp2: null });
    });
});
