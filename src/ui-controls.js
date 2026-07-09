/**
 * @module ui-controls
 * @description
 * Wires all Controls-panel + Selection-panel DOM widgets for VectorScope:
 * sliders (focus D, prewarp, zoom, ghost Y, blend, object depth), buttons
 * (blend mode, warp, zoom presets, play, reset), file inputs (scene/camera)
 * and the camera-settings dialog.
 *
 * Pure wiring — no rendering logic. All runtime dependencies are injected so
 * this module has no hidden globals; the returned API exposes the pieces
 * index.html must publish on `window` (nudge, openCamDialog, closeCamDialog).
 */

import { createZoomAnimator } from './zoom-anim.js';
import { renderCamDialog, bindDialog } from './camera-dialog.js';
import { segName } from './zoom-pipeline.js';

/**
 * Bind all UI controls.
 *
 * @param {object} d - injected dependencies
 * @param {Function} d.$          - getElementById shorthand
 * @param {object}   d.S          - shared app state
 * @param {object}   d.THREE      - Three.js namespace
 * @param {object}   d.R          - live camera rig (access by property)
 * @param {Function} d.log        - status logger
 * @param {Function} d.refreshH   - sampling refresh (sampling-hud.js)
 * @param {object}   d.blendCtl   - blend controller
 * @param {object}   d.matWarp    - warp material (uBlend uniform on reset)
 * @param {object}   d.sceneAnim  - scene animator (clearAll on reset)
 * @param {Function} d.resetPositions - loader position reset
 * @param {Function} d.sel        - selection setter from initInteraction
 * @param {Function} d.doLoadScene - scene loader wrapper
 * @param {Function} d.initCams   - camera (re)init
 * @param {Function} d.layoutPanels - panel layout refresh
 * @param {object}   d.camRig     - camera rig manager (updateBevAspect)
 * @param {object}   d.P          - panel rects
 * @param {object}   d.SCENE_CAM  - mutable scene-camera extrinsics
 * @returns {{animator: object, updateZoomUI: Function, nudge: Function,
 *            openCamDialog: Function, closeCamDialog: Function}}
 */
export function initUiControls(d) {
    const { $, S, THREE, R, log, refreshH, blendCtl, matWarp, sceneAnim,
            resetPositions, sel, doLoadScene, initCams, layoutPanels,
            camRig, P, SCENE_CAM } = d;

    /** Nudge a slider by ±0.1 (scaled by dir), clamped to [min, max]. */
    function nudge(id, dir) {
        const s = $(id);
        if (s.disabled) return;
        const v = Math.min(parseFloat(s.max), Math.max(parseFloat(s.min), parseFloat(s.value) + dir * 0.1));
        s.value = v;
        s.dispatchEvent(new Event('input'));
    }

    /* ── Sliders ── */
    $('sld-d').oninput = function () { S.depthD = +this.value; $('vd').textContent = S.depthD.toFixed(1); refreshH(); };
    $('sld-pw').oninput = function () { S.prewarpScale = +this.value; $('vpw').textContent = S.prewarpScale.toFixed(2) + 'x'; refreshH(); };
    $('sld-pw2').oninput = function () { S.prewarpScale2 = +this.value; $('vpw2').textContent = S.prewarpScale2.toFixed(2) + 'x'; refreshH(); };

    function updateZoomUI() {
        $('vz').textContent = S.zoom.toFixed(2) + 'x';
        $('lbl-c').textContent = `\u25CE Combined \u2014 ${segName(S.zoom)} @ ${S.zoom.toFixed(2)}x`;
    }
    $('sld-z').oninput = function () {
        animator.stopPreset();        // manual drag overrides an in-flight preset animation
        S.zoom = 10 ** +this.value;   // slider is log10 scale
        updateZoomUI();
        refreshH();
    };

    $('sld-clip').oninput = function () {
        S.clipY = +this.value;
        $('vclip').textContent = S.clipY.toFixed(1);
    };

    $('sld-blend').oninput = function () {
        S.blendX = Math.round(+this.value);
        $('vblend').textContent = S.blendX + 'f';
    };

    /* Blend mode toggle — Single: frozen outgoing frame; Dual: live follower
       camera rendered + warped with H(follower←leading, D) each blend frame. */
    $('btn-bmode').onclick = () => {
        S.blendMode = S.blendMode === 'single' ? 'dual' : 'single';
        $('btn-bmode').textContent = S.blendMode === 'single' ? 'Single' : 'Dual';
        $('btn-bmode').classList.toggle('active', S.blendMode === 'dual');
    };

    $('btn-warp').onclick = () => {
        S.warp = !S.warp;
        $('btn-warp').classList.toggle('active', S.warp);
        $('btn-warp').textContent = S.warp ? 'Warp ON' : 'Warp';
        refreshH();
    };

    /* ── Zoom animation (src/zoom-anim.js): preset-button eased transitions
       + Play bounce loop, both in log-zoom space so perceived zoom speed is
       uniform across segments. */
    const animator = createZoomAnimator({
        getZoom: () => S.zoom,
        setLogZoom: (lv) => {
            S.zoom = 10 ** lv;
            $('sld-z').value = lv;
            updateZoomUI();
            refreshH();
        },
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
        S.blendMode = 'single'; $('btn-bmode').textContent = 'Single'; $('btn-bmode').classList.remove('active');
        sceneAnim.clearAll();
        resetPositions(); sel(null);
        // Restore load-time scales (Obj Scale slider snapshots)
        for (const o of S.objs) {
            if (o.userData._baseScale) o.scale.copy(o.userData._baseScale);
        }
        $('sld-os').value = 1; $('vos').textContent = '\u2014';
        S.depthD = 3; $('sld-d').value = 3; $('vd').textContent = '3.0';
        S.zoom = 1; $('sld-z').value = 0; $('vz').textContent = '1.00x';
        S.prewarpScale = 1; $('sld-pw').value = 1; $('vpw').textContent = '1.00x';
        S.prewarpScale2 = 1; $('sld-pw2').value = 1; $('vpw2').textContent = '1.00x';
        S.warp = false; $('btn-warp').classList.remove('active'); $('btn-warp').textContent = 'Warp';
        $('lbl-c').textContent = '\u25CE Combined \u2014 M @ 1.00x';
        refreshH(); log('Reset done');
    };

    /* ── File inputs ── */
    $('fscene').onchange = function () { if (this.files[0]) doLoadScene(URL.createObjectURL(this.files[0])); };
    $('fcam').onchange = function () {
        if (!this.files[0]) return;
        const r = new FileReader();
        r.onload = ev => {
            try { initCams(JSON.parse(ev.target.result)); refreshH(); log('Cameras loaded');
                if (camDialogEl.classList.contains('open')) renderCamDialog($('cam-params-content'), { camParams: S.camParams, sceneCam: SCENE_CAM });
            } catch (e) { log('Bad JSON'); }
        };
        r.readAsText(this.files[0]);
    };

    /* ── Camera Settings Dialog ── */
    const camDialogEl = $('cam-dialog');
    bindDialog(camDialogEl, {
        onApply: ({ camParams, sceneCam }) => {
            SCENE_CAM.position = sceneCam.position;
            SCENE_CAM.rotation_euler_deg = sceneCam.rotation_euler_deg;
            initCams(camParams); layoutPanels(); camRig.updateBevAspect(P.bev); refreshH(); log('Camera params updated');
        },
    });
    const openCamDialog = () => { renderCamDialog($('cam-params-content'), { camParams: S.camParams, sceneCam: SCENE_CAM }); camDialogEl.classList.add('open'); };
    const closeCamDialog = () => { camDialogEl.classList.remove('open'); };

    return { animator, updateZoomUI, nudge, openCamDialog, closeCamDialog };
}
