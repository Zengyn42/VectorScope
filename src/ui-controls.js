/**
 * @module ui-controls
 * @description
 * Wires all Controls-panel + Selection-panel DOM widgets for VectorScope
 * through the central config store (src/config-store.js) with unidirectional
 * data flow:
 *
 * ```
 * user action → store.set('controls', patch) → apply hook → S + DOM + refreshH
 * ```
 *
 * DOM event handlers are thin: they only translate widget events into store
 * patches. The registered `apply` hook is the single place that pushes store
 * state into the legacy `S` fields, every widget's displayed value, and the
 * sampling refresh. This makes whole-scene save/load a pure store operation.
 *
 * Camera edits route through the `cameras` section (registered by index.html,
 * where the apply hook has access to camRig/layoutPanels).
 */

import { createZoomAnimator } from './zoom-anim.js';
import { renderCamDialog, bindDialog } from './camera-dialog.js';
import { segName } from './zoom-pipeline.js';

/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Controls',
    order: 40,
    entries: [
        ['Zoom / Go / Play', 'Continuous 0.5–10x zoom; cameras hand over at 1x and 5x. Play bounces automatically'],
        ['Focus D', 'Depth of the homography focus plane — objects at this depth align perfectly across cameras'],
        ['Warp', 'Toggle homography correction; off shows the naive prewarp/crop behavior'],
        ['Prewarp1/2', 'Manual prewarp scales used when Warp is off (segments 0.5–1x / 2–5x)'],
        ['Blend / Single-Dual', 'Cross-fade length (frames) at camera handover; Dual blends two live cameras'],
        ['Set Camera', 'Inspect/edit intrinsics + extrinsics of all three cameras, or load a camera JSON'],
        ['Reset All', 'Restore object positions, un-hide deleted objects, reset selection'],
    ],
};

/** Default values of the persistable `controls` section. */
export const CONTROL_DEFAULTS = {
    zoom: 1.0,
    warp: false,
    depthD: 3.0,
    prewarp1: 1.0,
    prewarp2: 1.0,
    clipY: 2.0,
    blendX: 20,
    blendMode: 'single',   // 'single' = frozen last frame | 'dual' = live follower RT
};

/**
 * Bind all UI controls and register the `controls` config section.
 *
 * @param {object} d - injected dependencies
 * @param {Function} d.$          - getElementById shorthand
 * @param {object}   d.store     - config store (createConfigStore instance)
 * @param {object}   d.S          - shared app state (written by the apply hook)
 * @param {object}   d.THREE      - Three.js namespace
 * @param {object}   d.R          - live camera rig (access by property)
 * @param {Function} d.log        - status logger
 * @param {Function} d.refreshH   - sampling refresh (sampling-hud.js)
 * @param {object}   d.blendCtl   - blend controller
 * @param {object}   d.matWarp    - warp material (uBlend uniform on reset)
 * @param {object}   d.sceneAnim  - scene animator (clearAll on reset)
 * @param {Function} d.resetPositions - loader position reset
 * @param {Function} d.sel        - selection setter from initInteraction
 * @param {Function} [d.restoreHidden] - un-hide deleted objects (Reset)
 * @param {object}   d.SCENE_CAM  - mutable scene-camera extrinsics
 * @returns {{animator: object, nudge: Function,
 *            openCamDialog: Function, closeCamDialog: Function}}
 */
export function initUiControls(d) {
    const { $, store, S, THREE, R, log, refreshH, blendCtl, matWarp, sceneAnim,
            resetPositions, sel, SCENE_CAM,
            restoreHidden = () => {} } = d;

    /* ── controls section: store → S + DOM + sampling refresh ── */
    function renderControls(c) {
        S.zoom = c.zoom; S.warp = c.warp; S.depthD = c.depthD;
        S.prewarpScale = c.prewarp1; S.prewarpScale2 = c.prewarp2;
        S.clipY = c.clipY; S.blendX = c.blendX; S.blendMode = c.blendMode;

        $('sld-d').value = c.depthD; $('vd').textContent = c.depthD.toFixed(1);
        $('sld-pw').value = c.prewarp1; $('vpw').textContent = c.prewarp1.toFixed(2) + 'x';
        $('sld-pw2').value = c.prewarp2; $('vpw2').textContent = c.prewarp2.toFixed(2) + 'x';
        $('sld-z').value = Math.log10(c.zoom);
        $('vz').textContent = c.zoom.toFixed(2) + 'x';
        $('lbl-c').textContent = `\u25CE Combined \u2014 ${segName(c.zoom)} @ ${c.zoom.toFixed(2)}x`;
        $('sld-clip').value = c.clipY; $('vclip').textContent = c.clipY.toFixed(1);
        $('sld-blend').value = c.blendX; $('vblend').textContent = c.blendX + 'f';
        $('btn-bmode').textContent = c.blendMode === 'single' ? 'Single' : 'Dual';
        $('btn-bmode').classList.toggle('active', c.blendMode === 'dual');
        $('btn-warp').classList.toggle('active', c.warp);
        $('btn-warp').textContent = c.warp ? 'Warp ON' : 'Warp';

        refreshH();
    }
    store.register('controls', { defaults: CONTROL_DEFAULTS, apply: renderControls });

    /** Nudge a slider by ±0.1 (scaled by dir), clamped to [min, max]. */
    function nudge(id, dir) {
        const s = $(id);
        if (s.disabled) return;
        const v = Math.min(parseFloat(s.max), Math.max(parseFloat(s.min), parseFloat(s.value) + dir * 0.1));
        s.value = v;
        s.dispatchEvent(new Event('input'));
    }

    /* ── Thin handlers: widget event → store patch ── */
    $('sld-d').oninput = function () { store.set('controls', { depthD: +this.value }); };
    $('sld-pw').oninput = function () { store.set('controls', { prewarp1: +this.value }); };
    $('sld-pw2').oninput = function () { store.set('controls', { prewarp2: +this.value }); };
    $('sld-z').oninput = function () {
        animator.stopPreset();        // manual drag overrides an in-flight preset animation
        store.set('controls', { zoom: 10 ** +this.value });   // slider is log10 scale
    };
    $('sld-clip').oninput = function () { store.set('controls', { clipY: +this.value }); };
    $('sld-blend').oninput = function () { store.set('controls', { blendX: Math.round(+this.value) }); };

    /* Blend mode toggle — Single: frozen outgoing frame; Dual: live follower
       camera rendered + warped with H(follower←leading, D) each blend frame. */
    $('btn-bmode').onclick = () => {
        store.set('controls', { blendMode: store.get('controls').blendMode === 'single' ? 'dual' : 'single' });
    };
    $('btn-warp').onclick = () => {
        store.set('controls', { warp: !store.get('controls').warp });
    };

    /* ── Zoom animation (src/zoom-anim.js): preset-button eased transitions
       + Play bounce loop, both in log-zoom space so perceived zoom speed is
       uniform across segments. */
    const animator = createZoomAnimator({
        getZoom: () => S.zoom,
        setLogZoom: (lv) => { store.set('controls', { zoom: 10 ** lv }); },
        onPlayState: (playing) => {
            $('btn-play').classList.toggle('active', playing);
            $('btn-play').textContent = playing ? '\u25A0 Stop' : '\u25B6 Play';
        },
    });
    document.querySelectorAll('.zp-btn:not(.aspd-btn)').forEach(b => {
        if (b.dataset.z !== undefined) b.onclick = () => animator.animateTo(parseFloat(b.dataset.z));
    });
    $('btn-play').onclick = () => animator.togglePlay();

    $('sld-od').oninput = function () {
        if (!S.sel) return;
        const target = +this.value; $('vod').textContent = target.toFixed(1);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(R.main.quaternion);
        const c = new THREE.Vector3(); new THREE.Box3().setFromObject(S.sel).getCenter(c);
        S.sel.position.addScaledVector(dir, target - c.sub(R.main.position).dot(dir));
    };

    /* Obj Scale — multiplier relative to the object's load-time base scale
       (snapshotted into userData._baseScale on first selection). */
    $('sld-os').oninput = function () {
        if (!S.sel) return;
        if (!S.sel.userData._baseScale) S.sel.userData._baseScale = S.sel.scale.clone();
        const k = +this.value, b = S.sel.userData._baseScale;
        S.sel.scale.set(b.x * k, b.y * k, b.z * k);
        $('vos').textContent = k.toFixed(2) + 'x';
    };

    /* ── Reset ── */
    $('btn-reset').onclick = () => {
        animator.stopAll();
        blendCtl.reset(); matWarp.uniforms.uBlend.value = 1;
        sceneAnim.clearAll();
        restoreHidden();              // deleted (hidden) objects come back
        resetPositions(); sel(null);
        // Restore load-time scales (Obj Scale slider snapshots)
        for (const o of S.objs) {
            if (o.userData._baseScale) o.scale.copy(o.userData._baseScale);
        }
        $('sld-os').value = 1; $('vos').textContent = '\u2014';
        store.set('controls', CONTROL_DEFAULTS);
        log('Reset done');
    };

    /* ── File inputs ── */
    $('fcam').onchange = function () {
        if (!this.files[0]) return;
        const r = new FileReader();
        r.onload = ev => {
            try {
                store.set('cameras', { camParams: JSON.parse(ev.target.result) });
                log('Cameras loaded');
                if (camDialogEl.classList.contains('open')) renderCamDialog($('cam-params-content'), { camParams: S.camParams, sceneCam: SCENE_CAM });
            } catch (e) { log('Bad JSON'); }
        };
        r.readAsText(this.files[0]);
    };

    /* ── Camera Settings Dialog ── */
    const camDialogEl = $('cam-dialog');
    bindDialog(camDialogEl, {
        onApply: ({ camParams, sceneCam }) => {
            store.set('cameras', { camParams, sceneCam });
            log('Camera params updated');
        },
    });
    const openCamDialog = () => { renderCamDialog($('cam-params-content'), { camParams: S.camParams, sceneCam: SCENE_CAM }); camDialogEl.classList.add('open'); };
    const closeCamDialog = () => { camDialogEl.classList.remove('open'); };

    /* Initial render: push defaults (or pre-seeded store state) into S + DOM */
    store.set('controls', {});

    return { animator, nudge, openCamDialog, closeCamDialog };
}
