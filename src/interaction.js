/**
 * @module interaction
 * @description
 * Object and camera selection + drag interaction system for VectorScope.
 *
 * Supports interaction in all camera panels (Main, Sec1, Sec2) AND the
 * Bird's Eye view. In BEV, camera markers can be selected in addition
 * to scene objects. Dragging in BEV moves objects on the XZ plane
 * (natural top-down control).
 *
 * @param {object} opts
 * @param {object}   opts.THREE         - Three.js namespace
 * @param {Element}  opts.canvas        - The WebGL canvas element
 * @param {object}   opts.scene         - Three.js Scene
 * @param {object}   opts.S             - Shared app state
 * @param {object}   opts.P             - Panel rects: { bev, m, s1, s2, c }
 * @param {Function} opts.getMainCam    - () => main PerspectiveCamera
 * @param {Function} opts.getSecCam     - () => secondary 1 PerspectiveCamera
 * @param {Function} opts.getSecCam2    - () => secondary 2 PerspectiveCamera
 * @param {Function} opts.getBevCam     - () => bird's eye OrthographicCamera
 * @param {Function} opts.getCamMarkers - () => Map<Object3D, string> (marker → cam name)
 * @param {Function} opts.onSelChange   - (type, name) => void; type='object'|'camera'|null
 * @param {Function} opts.getPanel      - (cx, cy) => panel key or null
 * @param {Function} opts.toNDC         - (cx, cy, panelRect) => { x, y }
 * @param {Function} opts.$             - getElementById shorthand
 * @returns {{ sel: Function, syncDepthSlider: Function }}
 */
export function initInteraction({ THREE, canvas, scene, S, P, getMainCam, getSecCam, getSecCam2, getBevCam, getCamMarkers, onSelChange, getPanel, toNDC, $ }) {
    const rc = new THREE.Raycaster();
    const hitPt = new THREE.Vector3();
    const selBox = new THREE.Box3();

    function sel(obj) {
        // De-highlight previous selection
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
            // Highlight new selection
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
            S.selCam = null;
            $('sld-od').disabled = false;
            syncDepthSlider();
            const os = $('sld-os');
            if (os) { os.disabled = false; syncScaleSlider(); }
            if (onSelChange) onSelChange('object', obj.name || '(unnamed)');
        } else {
            $('sld-od').disabled = true;
            $('vod').textContent = '\u2014';
            const os = $('sld-os');
            if (os) { os.disabled = true; $('vos').textContent = '\u2014'; }
            if (!S.selCam && onSelChange) onSelChange(null, null);
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

    /** Sync the Obj Scale slider to the selected object's scale multiplier.
        The base scale is lazily snapshotted on first selection so the slider
        always expresses a factor relative to the object's load-time scale. */
    function syncScaleSlider() {
        if (!S.sel) return;
        const os = $('sld-os');
        if (!os) return;
        if (!S.sel.userData._baseScale) S.sel.userData._baseScale = S.sel.scale.clone();
        const b = S.sel.userData._baseScale;
        const k = b.x !== 0 ? S.sel.scale.x / b.x : 1;
        os.value = k;
        $('vos').textContent = k.toFixed(2) + 'x';
    }

    canvas.addEventListener('pointerdown', e => {
        const panel = getPanel(e.clientX, e.clientY);
        let cam, panelRect;
        if (panel === 'm')       { cam = getMainCam();  panelRect = P.m; }
        else if (panel === 's1') { cam = getSecCam();   panelRect = P.s1; }
        else if (panel === 's2') { cam = getSecCam2();  panelRect = P.s2; }
        else if (panel === 'bev'){ cam = getBevCam();   panelRect = P.bev; }
        else return;

        const ndc = toNDC(e.clientX, e.clientY, panelRect);
        rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);

        /* In BEV: check camera markers first via screen-space distance.
           Raycasting on layer-1 objects is unreliable, so we project each
           marker's world position to NDC and compare to click NDC. */
        if (panel === 'bev' && getCamMarkers) {
            const markers = getCamMarkers();
            let bestCamName = null, bestDist = Infinity;
            const clickNDC = new THREE.Vector2(ndc.x, ndc.y);
            const projected = new THREE.Vector3();
            for (const [marker, camName] of markers.entries()) {
                projected.copy(marker.position).project(cam);
                const dx = projected.x - clickNDC.x;
                const dy = projected.y - clickNDC.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestCamName = camName;
                }
            }
            /* Accept if within ~5% of NDC space (generous click target).
               Cameras are selectable but NOT movable. */
            if (bestCamName && bestDist < 0.1) {
                sel(null);
                S.selCam = bestCamName;
                if (onSelChange) onSelChange('camera', bestCamName);
                return;
            }
        }

        /* Check scene objects.
           In BEV, ghosted objects (entirely above S.clipY) are not selectable —
           they're rendered semi-transparent and act as pass-through. */
        let best = null, bestD = Infinity;
        for (const obj of S.objs) {
            if (obj.userData._hidden) continue;       // deleted (hidden) → skip
            if (panel === 'bev') {
                selBox.setFromObject(obj);
                if (selBox.min.y > S.clipY) continue;  // ghosted → skip
            }
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
            S._selIsBev = (panel === 'bev');

            if (panel === 'bev') {
                /* BEV drag: XZ plane at the object's Y height */
                const c = new THREE.Vector3();
                new THREE.Box3().setFromObject(best).getCenter(c);
                S.dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), c);
            } else {
                /* Perspective panel drag: plane perpendicular to camera look-at */
                const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
                const c = new THREE.Vector3();
                new THREE.Box3().setFromObject(best).getCenter(c);
                S.dragPlane.setFromNormalAndCoplanarPoint(dir, c);
            }
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
            if (S._selIsBev) {
                /* BEV: move on XZ plane, keep Y unchanged */
                S.sel.position.x = hitPt.x + S.dragOff.x;
                S.sel.position.z = hitPt.z + S.dragOff.z;
            } else {
                /* Perspective panel: move on camera-facing plane */
                S.sel.position.copy(hitPt).add(S.dragOff);
            }
            syncDepthSlider();
            if (onSelChange) onSelChange('object', S.sel.name || '(unnamed)');
        }
    });

    canvas.addEventListener('pointerup', () => {
        S.dragging = false;
        canvas.style.cursor = '';
    });

    return { sel, syncDepthSlider, syncScaleSlider };
}
