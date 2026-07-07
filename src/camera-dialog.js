/**
 * @module camera-dialog
 * @description
 * Camera settings dialog UI for VectorScope.
 *
 * Renders an interactive modal dialog where users can view and edit all
 * camera parameters: intrinsics (fx, fy, cx, cy), extrinsics (position,
 * rotation), and image size — for both main and secondary cameras, plus
 * the scene camera world position.
 *
 * **Live editing:** Changes to any input field are applied immediately
 * via the `onApply` callback (no "Save" button needed). The dialog also
 * supports loading camera parameters from a JSON file.
 *
 * **Architecture:**
 * - `renderCamDialog()` — generates HTML input fields from current camera params
 * - `readCamInputs()` — reads values back from DOM inputs for a given camera key
 * - `readSceneInputs()` — reads scene camera position/rotation from DOM inputs
 * - `bindDialog()` — wires up close-on-overlay-click and live input change events
 *
 * Depends on DOM only — no THREE.js dependency.
 *
 * @example
 * import { renderCamDialog, bindDialog } from './camera-dialog.js';
 *
 * const overlay = document.getElementById('cam-dialog');
 * bindDialog(overlay, {
 *     onApply: ({ camParams, sceneCam }) => {
 *         initCams(camParams);
 *         refreshHomography();
 *     },
 * });
 *
 * // Open the dialog
 * renderCamDialog(container, { camParams: currentParams, sceneCam: SCENE_CAM });
 * overlay.classList.add('open');
 */

/**
 * Generate HTML for a single camera section with editable inputs.
 * @param {string} key - Camera key prefix (e.g., 'main_camera')
 * @param {string} label - Display label
 * @param {object} cam - Camera params { intrinsics, extrinsics, image_size }
 * @param {string} [note] - Subtitle note
 * @returns {string} HTML string
 */
function camSectionHTML(key, label, cam, note) {
    const i = cam.intrinsics, e = cam.extrinsics, s = cam.image_size;
    const fxId = `cam-${key}-fx`, fyId = `cam-${key}-fy`;
    const cxId = `cam-${key}-cx`, cyId = `cam-${key}-cy`;
    const pxId = `cam-${key}-px`, pyId = `cam-${key}-py`, pzId = `cam-${key}-pz`;
    const rxId = `cam-${key}-rx`, ryId = `cam-${key}-ry`, rzId = `cam-${key}-rz`;
    const wxId = `cam-${key}-wx`, wyId = `cam-${key}-wy`;

    return `<h3>${label} <span style="font-weight:normal;color:#888;font-size:11px">${note || ''}</span></h3><table>
<tr><td>Image Size</td><td>
  <span class="cam-field"><label>w</label><input type="number" id="${wxId}" value="${s[0]}" step="1"></span>
  <span class="cam-field"><label>h</label><input type="number" id="${wyId}" value="${s[1]}" step="1"></span>
</td></tr>
<tr><td>Intrinsics</td><td>
  <span class="cam-field"><label>fx</label><input type="number" id="${fxId}" value="${i.fx}" step="1"></span>
  <span class="cam-field"><label>fy</label><input type="number" id="${fyId}" value="${i.fy}" step="1"></span>
  <span class="cam-field"><label>cx</label><input type="number" id="${cxId}" value="${i.cx}" step="1"></span>
  <span class="cam-field"><label>cy</label><input type="number" id="${cyId}" value="${i.cy}" step="1"></span>
</td></tr>
<tr><td>Position</td><td>
  <span class="cam-field"><label>x</label><input type="number" id="${pxId}" value="${e.position[0]}" step="0.1"></span>
  <span class="cam-field"><label>y</label><input type="number" id="${pyId}" value="${e.position[1]}" step="0.1"></span>
  <span class="cam-field"><label>z</label><input type="number" id="${pzId}" value="${e.position[2]}" step="0.1"></span>
</td></tr>
<tr><td>Rotation (deg)</td><td>
  <span class="cam-field"><label>rx</label><input type="number" id="${rxId}" value="${e.rotation_euler_deg[0]}" step="0.5"></span>
  <span class="cam-field"><label>ry</label><input type="number" id="${ryId}" value="${e.rotation_euler_deg[1]}" step="0.5"></span>
  <span class="cam-field"><label>rz</label><input type="number" id="${rzId}" value="${e.rotation_euler_deg[2]}" step="0.5"></span>
</td></tr>
</table>`;
}

/**
 * Generate HTML for the scene camera section.
 * @param {object} sceneCam - { position: [x,y,z], rotation_euler_deg: [rx,ry,rz] }
 * @returns {string} HTML string
 */
function sceneSectionHTML(sceneCam) {
    return `<h3>Scene Camera <span style="font-weight:normal;color:#888;font-size:11px">world position</span></h3><table>
<tr><td>Position</td><td>
  <span class="cam-field"><label>x</label><input type="number" id="scene-px" value="${sceneCam.position[0]}" step="0.1"></span>
  <span class="cam-field"><label>y</label><input type="number" id="scene-py" value="${sceneCam.position[1]}" step="0.1"></span>
  <span class="cam-field"><label>z</label><input type="number" id="scene-pz" value="${sceneCam.position[2]}" step="0.1"></span>
</td></tr>
<tr><td>Rotation (deg)</td><td>
  <span class="cam-field"><label>rx</label><input type="number" id="scene-rx" value="${sceneCam.rotation_euler_deg[0]}" step="0.5"></span>
  <span class="cam-field"><label>ry</label><input type="number" id="scene-ry" value="${sceneCam.rotation_euler_deg[1]}" step="0.5"></span>
  <span class="cam-field"><label>rz</label><input type="number" id="scene-rz" value="${sceneCam.rotation_euler_deg[2]}" step="0.5"></span>
</td></tr>
</table>`;
}

/**
 * Render all camera parameter inputs into a container element.
 * @param {HTMLElement} container - Target element (e.g., #cam-params-content)
 * @param {object} opts
 * @param {object} opts.camParams - { main_camera, secondary_camera }
 * @param {object} opts.sceneCam - Scene camera { position, rotation_euler_deg }
 */
export function renderCamDialog(container, { camParams, sceneCam }) {
    if (!camParams) {
        container.innerHTML = '<p style="color:#888">No camera loaded</p>';
        return;
    }
    container.innerHTML =
        sceneSectionHTML(sceneCam) +
        camSectionHTML('main_camera', 'Main Camera', camParams.main_camera, 'identity = coincides with scene camera') +
        camSectionHTML('secondary_camera', 'Secondary Camera 1', camParams.secondary_camera, 'relative to main') +
        (camParams.secondary_camera_2
            ? camSectionHTML('secondary_camera_2', 'Secondary Camera 2', camParams.secondary_camera_2, 'relative to main')
            : '');
}

/**
 * Read camera params from the input fields.
 * @param {string} key - Camera key (e.g., 'main_camera')
 * @returns {object} Camera params { intrinsics, extrinsics, image_size }
 */
export function readCamInputs(key) {
    const v = id => parseFloat(document.getElementById(id)?.value) || 0;
    return {
        intrinsics: {
            fx: v(`cam-${key}-fx`), fy: v(`cam-${key}-fy`),
            cx: v(`cam-${key}-cx`), cy: v(`cam-${key}-cy`),
        },
        extrinsics: {
            position: [v(`cam-${key}-px`), v(`cam-${key}-py`), v(`cam-${key}-pz`)],
            rotation_euler_deg: [v(`cam-${key}-rx`), v(`cam-${key}-ry`), v(`cam-${key}-rz`)],
        },
        image_size: [v(`cam-${key}-wx`) || 1080, v(`cam-${key}-wy`) || 1920],
    };
}

/**
 * Read scene camera values from the input fields.
 * @returns {{ position: number[], rotation_euler_deg: number[] }}
 */
export function readSceneInputs() {
    const v = id => parseFloat(document.getElementById(id)?.value) || 0;
    return {
        position: [v('scene-px'), v('scene-py'), v('scene-pz')],
        rotation_euler_deg: [v('scene-rx'), v('scene-ry'), v('scene-rz')],
    };
}

/**
 * Bind dialog open/close/input events.
 * @param {HTMLElement} overlayEl - The modal overlay element
 * @param {object} opts
 * @param {function} opts.onApply - Called when any input changes: onApply({ camParams, sceneCam })
 */
export function bindDialog(overlayEl, { onApply }) {
    // Close on overlay click
    overlayEl.addEventListener('click', e => {
        if (e.target === overlayEl) overlayEl.classList.remove('open');
    });

    // Live input changes
    overlayEl.addEventListener('input', e => {
        if (e.target.tagName === 'INPUT' && onApply) {
            const camParams = {
                main_camera: readCamInputs('main_camera'),
                secondary_camera: readCamInputs('secondary_camera'),
                secondary_camera_2: readCamInputs('secondary_camera_2'),
            };
            const sceneCam = readSceneInputs();
            onApply({ camParams, sceneCam });
        }
    });
}
