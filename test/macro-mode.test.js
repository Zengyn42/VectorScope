import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMacroMode } from '../src/macro-mode.js';
import { SRC } from '../src/zoom-pipeline.js';

describe('createMacroMode', () => {
    let mm, blending;

    function zoomSource(z, hasS2) {
        if (z < 1.0) return SRC.SEC1;
        if (z < 5.0 || !hasS2) return SRC.MAIN;
        return SRC.SEC2;
    }

    beforeEach(() => {
        blending = false;
        mm = createMacroMode({
            SRC, zoomSource,
            isBlending: () => blending,
        });
    });

    it('does nothing when disabled', () => {
        const r = mm.tick(0.1, 2.0, true);
        assert.equal(r.overrideSrc, null);
    });

    it('idle → no override when focusD >= threshold', () => {
        mm.enable(0.5);
        const r = mm.tick(1.0, 2.0, true);
        assert.equal(r.overrideSrc, null);
    });

    it('Main → UW: single transition when focusD < threshold', () => {
        mm.enable(0.5);
        // zoom=2 → normalSrc=MAIN; focusD=0.3 < 0.5
        const r1 = mm.tick(0.3, 2.0, true);
        assert.equal(r1.overrideSrc, SRC.SEC1); // override to UW
        assert.equal(mm.isOverriding(), true);
    });

    it('Main → UW: enters holding after blend completes', () => {
        mm.enable(0.5);
        blending = true;
        mm.tick(0.3, 2.0, true); // triggers to_uw
        blending = false;
        const r = mm.tick(0.3, 2.0, true); // blend done → holding
        assert.equal(r.overrideSrc, SRC.SEC1); // stays on UW
    });

    it('Tele → Main → UW: sequential transitions', () => {
        mm.enable(0.5);
        // zoom=6 → normalSrc=SEC2(Tele); focusD=0.2 < 0.5
        blending = true;
        const r1 = mm.tick(0.2, 6.0, true); // triggers to_mid
        assert.equal(r1.overrideSrc, SRC.MAIN); // first hop: Tele→Main

        blending = false;
        const r2 = mm.tick(0.2, 6.0, true); // mid blend done → to_uw
        assert.equal(r2.overrideSrc, SRC.SEC1); // second hop: Main→UW

        blending = true;
        mm.tick(0.2, 6.0, true);
        blending = false;
        const r3 = mm.tick(0.2, 6.0, true); // blend done → holding
        assert.equal(r3.overrideSrc, SRC.SEC1);
    });

    it('holding → switches back when focusD >= threshold (to Main)', () => {
        mm.enable(0.5);
        mm.tick(0.3, 2.0, true); // to_uw
        blending = false;
        mm.tick(0.3, 2.0, true); // holding

        // focusD rises above threshold, zoom=2 → target=MAIN
        blending = true;
        const r1 = mm.tick(0.8, 2.0, true); // back_target
        assert.equal(r1.overrideSrc, SRC.MAIN);

        blending = false;
        const r2 = mm.tick(0.8, 2.0, true); // idle
        assert.equal(r2.overrideSrc, null);
        assert.equal(mm.isOverriding(), false);
    });

    it('holding → switches back to Tele via Main (sequential)', () => {
        mm.enable(0.5);
        // Force to UW from Main first
        mm.tick(0.3, 2.0, true);
        blending = false;
        mm.tick(0.3, 2.0, true); // holding on UW

        // Now focusD rises, zoom=6 → target=Tele
        blending = true;
        const r1 = mm.tick(0.8, 6.0, true); // back_mid
        assert.equal(r1.overrideSrc, SRC.MAIN); // UW→Main first

        blending = false;
        const r2 = mm.tick(0.8, 6.0, true); // back_target
        assert.equal(r2.overrideSrc, SRC.SEC2); // Main→Tele

        blending = false;
        const r3 = mm.tick(0.8, 6.0, true); // idle
        assert.equal(r3.overrideSrc, null);
    });

    it('holding → no switch back if zoom target is already UW', () => {
        mm.enable(0.5);
        mm.tick(0.3, 2.0, true);
        blending = false;
        mm.tick(0.3, 2.0, true); // holding

        // focusD rises, but zoom=0.5 → target=UW already
        const r = mm.tick(0.8, 0.5, true);
        assert.equal(r.overrideSrc, null); // immediately idle
    });

    it('disable clears override', () => {
        mm.enable(0.5);
        mm.tick(0.3, 2.0, true); // to_uw
        assert.equal(mm.isOverriding(), true);
        mm.disable();
        assert.equal(mm.isOverriding(), false);
        assert.equal(mm.isActive(), false);
    });

    it('serialize / restore round-trips', () => {
        mm.enable(0.5);
        mm.tick(0.3, 2.0, true); // to_uw
        const snap = mm.serialize();
        const mm2 = createMacroMode({ SRC, zoomSource, isBlending: () => false });
        mm2.restore(snap);
        assert.equal(mm2.isActive(), true);
        assert.equal(mm2.isOverriding(), true);
        assert.equal(mm2.getThreshold(), 0.5);
    });
});
