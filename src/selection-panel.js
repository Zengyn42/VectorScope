/**
 * @module selection-panel
 * @description
 * Selection info panel controller for VectorScope.
 *
 * Manages the top-row "Selection" DOM panel that shows details about the
 * currently selected object or camera, and provides inline editing for
 * camera poses:
 *
 * - **Object selected**: shows world position + depth along the main
 *   camera's look-at axis, plus the "Obj Depth" slider.
 * - **Main Camera selected**: shows the *absolute pose* (world position +
 *   orientation) — edits write back to `SCENE_CAM`.
 * - **Secondary camera selected**: shows the *relative pose w.r.t. the
 *   main camera* (extrinsics) — edits write back to
 *   `camParams.secondary_camera[_2].extrinsics`.
 *
 * All pose edits are applied live: each input change triggers `onCamEdit`,
 * which the host uses to rebuild cameras and refresh the homography.
 *
 * **Camera name convention** (must match camMarkerMap values):
 * `'Main Camera'`, `'Secondary 1'`, `'Secondary 2'`.
 *
 * @param {object} opts
 * @param {object}   opts.THREE       - Three.js namespace
 * @param {object}   opts.S           - Shared app state (reads S.sel, S.selCam, S.camParams)
 * @param {object}   opts.SCENE_CAM   - Mutable scene camera pose { position, rotation_euler_deg }
 * @param {Function} opts.getMainCam  - () => main PerspectiveCamera
 * @param {Function} opts.getSecCam   - () => secondary 1 PerspectiveCamera
 * @param {Function} opts.getSecCam2  - () => secondary 2 PerspectiveCamera
 * @param {Function} opts.onCamEdit   - Called after pose values are written back; host should re-init cameras
 * @param {Function} opts.$           - getElementById shorthand
 * @returns {{ onSelChange: Function }}
 *
 * @example
 * const { onSelChange } = initSelectionPanel({
 *     THREE, S, SCENE_CAM,
 *     getMainCam: () => mainCam, getSecCam: () => secCam, getSecCam2: () => sec2Cam,
 *     onCamEdit: () => { initCams(S.camParams); refreshH(); },
 *     $,
 * });
 * // Pass onSelChange to initInteraction()
 */
export function initSelectionPanel({ THREE, S, SCENE_CAM, getMainCam, getSecCam, getSecCam2, onCamEdit, getAnim, onAnimSet, $ }) {

    /** Compute depth of a 3D point along the main camera's look-at direction. */
    function depthToMainCam(worldPos) {
        const mainCam = getMainCam();
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(mainCam.quaternion);
        return new THREE.Vector3().copy(worldPos).sub(mainCam.position).dot(dir);
    }

    /** Generate an inline editable number input. */
    function camInp(id, val, step) {
        return `<input type="number" class="cam-inp" id="${id}" value="${val}" step="${step || 0.1}">`;
    }

    /** Resolve camera object + params key from a camera display name. */
    function resolveCam(name) {
        if (name === 'Main Camera')  return { cam: getMainCam(), key: 'main_camera',        isMain: true };
        if (name === 'Secondary 1')  return { cam: getSecCam(),  key: 'secondary_camera',   isMain: false };
        if (name === 'Secondary 2')  return { cam: getSecCam2(), key: 'secondary_camera_2', isMain: false };
        return { cam: null, key: null, isMain: false };
    }

    /** Apply camera pose + intrinsics edits from the info panel inputs back into state. */
    function applyCamEdit() {
        const v = id => { const el = $(id); return el ? parseFloat(el.value) || 0 : 0; };
        const selName = S.selCam;
        if (!selName || !S.camParams) return;
        const { key } = resolveCam(selName);

        if (selName === 'Main Camera') {
            // Main camera: absolute pose → SCENE_CAM
            SCENE_CAM.position = [v('ci-px'), v('ci-py'), v('ci-pz')];
            SCENE_CAM.rotation_euler_deg = [v('ci-rx'), v('ci-ry'), v('ci-rz')];
        } else {
            // Secondary cameras: relative pose → extrinsics
            const ext = S.camParams[key]?.extrinsics;
            if (ext) {
                ext.position = [v('ci-px'), v('ci-py'), v('ci-pz')];
                ext.rotation_euler_deg = [v('ci-rx'), v('ci-ry'), v('ci-rz')];
            }
        }
        // Intrinsics (all cameras)
        const intr = S.camParams[key]?.intrinsics;
        if (intr && $('ci-fx')) {
            intr.fx = v('ci-fx'); intr.fy = v('ci-fy');
            intr.cx = v('ci-cx'); intr.cy = v('ci-cy');
        }
        if (onCamEdit) onCamEdit();
        refreshInfoLine(selName);  // cameras were rebuilt — refresh FOV/dist display
    }

    /** Refresh the FOV/dist info line without re-rendering the inputs
     *  (a full re-render would steal focus from the field being edited). */
    function refreshInfoLine(name) {
        const el = $('ci-info');
        if (!el) return;
        const { cam, isMain } = resolveCam(name);
        if (!cam) return;
        let txt = `FOV ${cam.fov.toFixed(1)}\u00B0`;
        if (!isMain) txt += ` \u00B7 dist=${cam.position.distanceTo(getMainCam().position).toFixed(3)}`;
        el.textContent = txt;
    }

    /** Apply object rotation edits (degrees) back to the selected object. */
    function applyObjRot() {
        const obj = S.sel;
        if (!obj) return;
        const v = id => { const el = $(id); return el ? (parseFloat(el.value) || 0) * Math.PI / 180 : 0; };
        obj.rotation.set(v('oi-rx'), v('oi-ry'), v('oi-rz'));
    }

    /** Render object info (position + depth + rotation controls) into the panel. */
    function showObject(name) {
        const obj = S.sel;
        if (!obj) return;
        const c = new THREE.Vector3();
        new THREE.Box3().setFromObject(obj).getCenter(c);
        const depth = depthToMainCam(c);
        const p = obj.position;
        const rad2deg = r => (r * 180 / Math.PI);
        $('selinfo').textContent = `Object: ${name}`;

        let html =
            `<span style="color:#e94560">Position</span>: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})<br>` +
            `<span style="color:#e94560">Depth</span> to Main Cam: <b>${depth.toFixed(2)}</b><br>`;
        // Rotation controls (degrees)
        html += `<div style="color:#e94560;font-size:10px;text-transform:uppercase;margin:4px 0 2px">Rotation (deg)</div>`;
        html += `<div>`;
        html += `<span class="cam-lbl">rx</span>${camInp('oi-rx', rad2deg(obj.rotation.x).toFixed(1), 1)} `;
        html += `<span class="cam-lbl">ry</span>${camInp('oi-ry', rad2deg(obj.rotation.y).toFixed(1), 1)} `;
        html += `<span class="cam-lbl">rz</span>${camInp('oi-rz', rad2deg(obj.rotation.z).toFixed(1), 1)}`;
        html += `</div>`;

        // Animation controls (procedural presets from src/scene-anim.js)
        if (getAnim && onAnimSet) {
            const cur = getAnim(obj);
            const MODES = [['none', 'None'], ['depth', 'Depth'], ['orbit', 'Orbit'],
                           ['bounce', 'Bounce'], ['spin', 'Spin']];
            html += `<div style="color:#e94560;font-size:10px;text-transform:uppercase;margin:6px 0 2px">Animation</div>`;
            html += `<div>` + MODES.map(([m, label]) =>
                `<button class="zp-btn anim-btn${cur.mode === m ? ' active' : ''}" data-amode="${m}">${label}</button>`
            ).join(' ') + `</div>`;
            html += `<div style="margin-top:4px">` +
                `<span class="cam-lbl">speed</span>` +
                `<input type="range" id="oi-aspd" min="0.2" max="3" step="0.1" value="${cur.speed}" style="width:110px;vertical-align:middle"> ` +
                `<span class="cam-lbl" id="oi-aspd-v">${(+cur.speed).toFixed(1)}</span></div>`;
        }
        $('cam-detail').innerHTML = html;

        ['oi-rx', 'oi-ry', 'oi-rz'].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener('input', applyObjRot);
        });

        if (getAnim && onAnimSet) {
            const btns = $('cam-detail').querySelectorAll('.anim-btn');
            const activeMode = () =>
                [...btns].find(b => b.classList.contains('active'))?.dataset.amode || 'none';
            btns.forEach(b => b.addEventListener('click', () => {
                onAnimSet(obj, b.dataset.amode, parseFloat($('oi-aspd').value));
                btns.forEach(x => x.classList.toggle('active', x === b));
            }));
            $('oi-aspd').addEventListener('input', function () {
                $('oi-aspd-v').textContent = (+this.value).toFixed(1);
                const m = activeMode();
                if (m !== 'none') onAnimSet(obj, m, +this.value);  // re-assign with new speed
            });
        }
    }

    /** Render camera pose editor (position + orientation inputs) into the panel. */
    function showCamera(name) {
        const { cam, key, isMain } = resolveCam(name);
        let posLabel, pos, rot;

        if (isMain) {
            posLabel = 'Absolute Pose';
            pos = SCENE_CAM.position;
            rot = SCENE_CAM.rotation_euler_deg;
        } else {
            posLabel = 'Relative Pose (to Main)';
            const ext = S.camParams?.[key]?.extrinsics;
            pos = ext?.position || [0, 0, 0];
            rot = ext?.rotation_euler_deg || [0, 0, 0];
        }

        $('selinfo').innerHTML = `Camera: <b style="color:#4fc3f7">${name}</b>`;

        let html = `<div style="color:#4fc3f7;font-size:10px;text-transform:uppercase;margin-bottom:4px">${posLabel}</div>`;
        html += `<div style="margin-bottom:3px">`;
        html += `<span class="cam-lbl">x</span>${camInp('ci-px', (+pos[0]).toFixed(2))} `;
        html += `<span class="cam-lbl">y</span>${camInp('ci-py', (+pos[1]).toFixed(2))} `;
        html += `<span class="cam-lbl">z</span>${camInp('ci-pz', (+pos[2]).toFixed(2))}`;
        html += `</div>`;
        html += `<div style="margin-bottom:5px">`;
        html += `<span class="cam-lbl">rx</span>${camInp('ci-rx', (+rot[0]).toFixed(1), 0.5)} `;
        html += `<span class="cam-lbl">ry</span>${camInp('ci-ry', (+rot[1]).toFixed(1), 0.5)} `;
        html += `<span class="cam-lbl">rz</span>${camInp('ci-rz', (+rot[2]).toFixed(1), 0.5)}`;
        html += `</div>`;

        // Intrinsics editor
        const i = S.camParams?.[key]?.intrinsics;
        if (i) {
            html += `<div style="color:#4fc3f7;font-size:10px;text-transform:uppercase;margin-bottom:2px">Intrinsics</div>`;
            html += `<div style="margin-bottom:3px">`;
            html += `<span class="cam-lbl">fx</span>${camInp('ci-fx', i.fx, 10)} `;
            html += `<span class="cam-lbl">fy</span>${camInp('ci-fy', i.fy, 10)}`;
            html += `</div>`;
            html += `<div style="margin-bottom:5px">`;
            html += `<span class="cam-lbl">cx</span>${camInp('ci-cx', i.cx, 1)} `;
            html += `<span class="cam-lbl">cy</span>${camInp('ci-cy', i.cy, 1)}`;
            html += `</div>`;
        }

        if (cam) {
            html += `<span id="ci-info" style="color:#888;font-size:10px">FOV ${cam.fov.toFixed(1)}°`;
            if (!isMain) html += ` · dist=${cam.position.distanceTo(getMainCam().position).toFixed(3)}`;
            html += `</span>`;
        }

        $('cam-detail').innerHTML = html;

        // Bind live edit handlers
        ['ci-px', 'ci-py', 'ci-pz', 'ci-rx', 'ci-ry', 'ci-rz',
         'ci-fx', 'ci-fy', 'ci-cx', 'ci-cy'].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener('input', applyCamEdit);
        });
    }

    /**
     * Selection change entry point — called by the interaction module.
     * @param {'object'|'camera'|null} type - Selection type
     * @param {string|null} name - Object name or camera display name
     */
    function onSelChange(type, name) {
        const depthRow = $('obj-depth-row');
        const camDetail = $('cam-detail');
        if (type === 'object') {
            depthRow.style.display = 'flex';
            camDetail.style.display = 'block';
            showObject(name);
        } else if (type === 'camera') {
            depthRow.style.display = 'none';
            camDetail.style.display = 'block';
            showCamera(name);
        } else {
            $('selinfo').textContent = 'Click object or camera in any panel';
            depthRow.style.display = 'none';
            camDetail.style.display = 'none';
        }
    }

    return { onSelChange };
}
