/**
 * @module interaction
 * @description
 * Object selection and drag interaction system for VectorScope.
 *
 * Provides click-to-select and drag-to-move functionality within the Main
 * and Secondary camera panels. The Combined panel does not support interaction
 * (it's a shader-warped composite view).
 *
 * **Selection mechanics:**
 * - Pointer down on Main/Secondary panel → raycast against all loaded objects
 * - Closest hit object is selected and highlighted (emissive color boost)
 * - Previously selected object is de-highlighted
 * - Bottom bar shows selected object name and depth slider becomes active
 *
 * **Drag mechanics:**
 * - After selection, continued pointer movement drags the object
 * - Drag is constrained to a plane perpendicular to the camera's view direction,
 *   passing through the object's center (depth-plane drag)
 * - Only X/Y movement is applied; depth remains constant during drag
 * - The drag uses the camera that was active during selection (Main or Secondary)
 *
 * **Highlight system:**
 * - Uses `material.emissive` (MeshStandardMaterial) for highlight
 * - Original emissive values are saved in `userData._oe` and restored on deselect
 * - Traverses all child meshes for multi-mesh objects (e.g., glTF models)
 *
 * @requires three
 * @requires ./panels.js (for panel rects and coordinate conversion)
 *
 * @example
 * import { initInteraction } from './interaction.js';
 *
 * const { sel, syncDepthSlider } = initInteraction({
 *     THREE, canvas, scene, S, P,
 *     getMainCam: () => mainCam,
 *     getSecCam: () => secCam,
 *     getPanel, toNDC, $,
 * });
 *
 * // Programmatically deselect
 * sel(null);
 *
 * @param {object} opts
 * @param {object}   opts.THREE      - Three.js namespace (for Raycaster, Vector2, etc.)
 * @param {Element}  opts.canvas     - The WebGL canvas element
 * @param {object}   opts.scene      - Three.js Scene containing selectable objects
 * @param {object}   opts.S          - Shared app state: `{ sel, dragging, objs, dragPlane, dragOff }`
 * @param {object}   opts.P          - Panel rects from `createPanelManager`: `{ m, s, c }`
 * @param {Function} opts.getMainCam - Returns the current main PerspectiveCamera
 * @param {Function} opts.getSecCam  - Returns the current secondary PerspectiveCamera
 * @param {Function} opts.getPanel   - `(clientX, clientY) => 'm'|'s'|'c'`
 * @param {Function} opts.toNDC      - `(clientX, clientY, panelRect) => { x, y }` in NDC [-1,1]
 * @param {Function} opts.$          - `getElementById` shorthand
 * @returns {{ sel: Function, syncDepthSlider: Function }}
 */
export function initInteraction({ THREE, canvas, scene, S, P, getMainCam, getSecCam, getPanel, toNDC, $ }) {
    const rc = new THREE.Raycaster();
    const hitPt = new THREE.Vector3();

    function sel(obj) {
        if (S.sel) {
            try {
                S.sel.traverse(ch => {
                    if (ch.isMesh && ch.userData._oe !== undefined) {
                        const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                        mats.forEach(m => { if (m && m.emissive) m.emissive.setHex(ch.userData._oe); });
                        delete ch.userData._oe;
                    }
                });
            } catch (e) { console.warn('deselect error:', e); }
        }
        S.sel = obj;
        if (obj) {
            try {
                obj.traverse(ch => {
                    if (ch.isMesh) {
                        const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                        mats.forEach(m => {
                            if (m && m.emissive) {
                                ch.userData._oe = m.emissive.getHex();
                                m.emissive.setHex(0x555555);
                            }
                        });
                    }
                });
            } catch (e) { console.warn('select error:', e); }
            $('selinfo').textContent = `Selected: ${obj.name}`;
            $('sld-od').disabled = false;
            syncDepthSlider();
        } else {
            $('selinfo').textContent = 'Click object in Main panel';
            $('sld-od').disabled = true;
            $('vod').textContent = '—';
        }
    }

    function syncDepthSlider() {
        if (!S.sel) return;
        const mainCam = getMainCam();
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(mainCam.quaternion);
        const c = new THREE.Vector3();
        new THREE.Box3().setFromObject(S.sel).getCenter(c);
        const d = c.sub(mainCam.position).dot(dir);
        $('sld-od').value = d;
        $('vod').textContent = d.toFixed(1);
    }

    canvas.addEventListener('pointerdown', e => {
        const panel = getPanel(e.clientX, e.clientY);
        let cam, panelRect;
        if (panel === 'm') { cam = getMainCam(); panelRect = P.m; }
        else if (panel === 's') { cam = getSecCam(); panelRect = P.s; }
        else return;

        const ndc = toNDC(e.clientX, e.clientY, panelRect);
        rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);

        let best = null, bestD = Infinity;
        for (const obj of S.objs) {
            const hits = rc.intersectObject(obj, true);
            if (hits.length && hits[0].distance < bestD) {
                bestD = hits[0].distance;
                best = obj;
            }
        }

        if (best) {
            sel(best);
            S._selCam = cam;
            S._selPanel = panelRect;
            const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
            const c = new THREE.Vector3();
            new THREE.Box3().setFromObject(best).getCenter(c);
            S.dragPlane.setFromNormalAndCoplanarPoint(dir, c);
            rc.ray.intersectPlane(S.dragPlane, hitPt);
            S.dragOff.copy(best.position).sub(hitPt);
            S.dragging = true;
            canvas.style.cursor = 'grabbing';
        } else {
            sel(null);
        }
    });

    canvas.addEventListener('pointermove', e => {
        if (!S.dragging || !S.sel) return;
        const cam = S._selCam || getMainCam();
        const panel = S._selPanel || P.m;
        const ndc = toNDC(e.clientX, e.clientY, panel);
        rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
        if (rc.ray.intersectPlane(S.dragPlane, hitPt)) {
            S.sel.position.x = hitPt.x + S.dragOff.x;
            S.sel.position.y = hitPt.y + S.dragOff.y;
        }
    });

    canvas.addEventListener('pointerup', () => {
        S.dragging = false;
        canvas.style.cursor = '';
    });

    return { sel, syncDepthSlider };
}
