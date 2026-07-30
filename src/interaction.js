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
/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Mouse',
    order: 20,
    entries: [
        ['Click object', 'Select (works in any camera panel or Bird\'s Eye)'],
        ['Double-click + drag', 'Move selected object: Camera panels move on the camera-facing plane; Bird\'s Eye moves on the ground (XZ)'],
        ['Click camera marker', '(Bird\'s Eye) select a camera to inspect its parameters'],
        ['Drag empty space (BEV)', 'Pan the Bird\'s Eye view'],
        ['Scroll wheel (BEV)', 'Zoom the Bird\'s Eye view in/out'],
        ['Click empty space', 'Deselect'],
        ['A / D', 'Move camera left / right (0.1 m per press)'],
        ['W / S', 'Move camera forward / backward (0.1 m per press)'],
        ['Q / E', 'Move camera down / up (0.1 m per press)'],
        ['Shift+A / D', 'Yaw camera left / right (2° per press)'],
        ['Shift+W / S', 'Pitch camera up / down (2° per press)'],
        ['Shift+Q / E', 'Roll camera CCW / CW (2° per press)'],
    ],
};

import { getBevPlaneDef } from './bev-planes.js';

export function initInteraction({ THREE, canvas, scene, S, P, getMainCam, getSecCam, getSecCam2, getBevCam, getCamMarkers, onSelChange, getPanel, toNDC, $,
    /** Optional callback fired just before drag starts (object = dragged obj).
     *  Use for undo checkpoints: `onDragStart: (obj) => undoManager.checkpoint('drag')` */
    onDragStart = null,
    /** Optional BEV pan callback: panBev(dx, dy, dz) shifts the BEV camera. */
    onBevPan = null,
    /** Optional BEV zoom callback: bevZoom(factor) scales the BEV view. */
    onBevZoom = null }) {
    const rc = new THREE.Raycaster();
    const hitPt = new THREE.Vector3();
    const selBox = new THREE.Box3();

    /* Double-click detection for drag initiation.
       Single click = select; double-click on object = start drag. */
    const DBLCLICK_MS = 400;  // max interval between clicks
    let lastClickTime = 0;
    let lastClickObj = null;

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

    /* BEV click threshold: pointer must move > this many px to become a pan.
       Below this, pointerup completes a selection (deferred select). */
    const BEV_PAN_THRESHOLD = 4;

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

        /* ── Non-BEV panels: immediate select + drag ── */
        if (panel !== 'bev') {
            let best = null, bestD = Infinity;
            for (const obj of S.objs) {
                if (obj.userData._hidden) continue;
                const hits = rc.intersectObject(obj, true);
                if (hits.length && hits[0].distance < bestD) {
                    bestD = hits[0].distance; best = obj;
                }
            }
            if (best) {
                const now = performance.now();
                const isDoubleClick = (best === lastClickObj && now - lastClickTime < DBLCLICK_MS);
                lastClickTime = now; lastClickObj = best;
                sel(best);
                if (isDoubleClick) {
                    if (onDragStart) onDragStart(best);
                    S._selCam = cam; S._selPanel = panelRect; S._selIsBev = false;
                    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
                    const c = new THREE.Vector3();
                    new THREE.Box3().setFromObject(best).getCenter(c);
                    S.dragPlane.setFromNormalAndCoplanarPoint(dir, c);
                    rc.ray.intersectPlane(S.dragPlane, hitPt);
                    S.dragOff.copy(best.position).sub(hitPt);
                    S.dragging = true;
                    canvas.style.cursor = 'grabbing';
                }
            } else {
                sel(null);
            }
            return;
        }

        /* ── BEV panel ── */
        const planeDef = getBevPlaneDef(S.bevPlane || 'xz');

        /* Check camera markers via screen-space distance. */
        let pendingCamName = null;
        if (getCamMarkers) {
            const markers = getCamMarkers();
            let bestDist = Infinity;
            const clickNDC = new THREE.Vector2(ndc.x, ndc.y);
            const projected = new THREE.Vector3();
            for (const [marker, camName] of markers.entries()) {
                projected.copy(marker.position).project(cam);
                const mdx = projected.x - clickNDC.x;
                const mdy = projected.y - clickNDC.y;
                const dist = Math.sqrt(mdx * mdx + mdy * mdy);
                if (dist < bestDist) { bestDist = dist; pendingCamName = camName; }
            }
            if (bestDist >= 0.1) pendingCamName = null;   // too far
        }

        /* Check scene objects — skip ones entirely beyond the section cut
           (fully clipped away in the BEV pass → invisible → not selectable). */
        const clipAxis = planeDef.ghostAxis;
        let bevBest = null, bevBestD = Infinity;
        for (const obj of S.objs) {
            if (obj.userData._hidden) continue;
            selBox.setFromObject(obj);
            if (selBox.min[clipAxis] > S.clipY) continue;  // fully cut → not selectable
            const hits = rc.intersectObject(obj, true);
            if (hits.length && hits[0].distance < bevBestD) {
                bevBestD = hits[0].distance; bevBest = obj;
            }
        }

        /* Camera markers take priority over scene objects for selection. */
        const hitSomething = pendingCamName || bevBest;

        /* Double-click on a scene object → immediately start move-drag. */
        if (bevBest) {
            const now = performance.now();
            const isDoubleClick = (bevBest === lastClickObj && now - lastClickTime < DBLCLICK_MS);
            // Update double-click state even before we know if this becomes a drag
            lastClickTime = now; lastClickObj = bevBest;

            if (isDoubleClick) {
                sel(bevBest);
                if (onDragStart) onDragStart(bevBest);
                S._selCam = cam; S._selPanel = panelRect; S._selIsBev = true;
                const dn = planeDef.dragNormal;
                const c = new THREE.Vector3();
                new THREE.Box3().setFromObject(bevBest).getCenter(c);
                S.dragPlane.setFromNormalAndCoplanarPoint(
                    new THREE.Vector3(dn.x, dn.y, dn.z), c);
                rc.ray.intersectPlane(S.dragPlane, hitPt);
                S.dragOff.copy(bevBest.position).sub(hitPt);
                S.dragging = true;
                canvas.style.cursor = 'grabbing';
                return;
            }
        }

        /* Single click (object, camera marker, or empty space):
           enter pending state — a move > BEV_PAN_THRESHOLD px becomes a pan,
           no move completes a selection on pointerup. */
        S._bevPending = true;
        S._bevPendingObj = bevBest;
        S._bevPendingCam = pendingCamName;
        S._bevPanStartX = e.clientX;
        S._bevPanStartY = e.clientY;
        S._bevPanLastX = e.clientX;
        S._bevPanLastY = e.clientY;
        S._bevPanRect = panelRect;
        canvas.style.cursor = hitSomething ? 'pointer' : 'grab';
    });

    canvas.addEventListener('pointermove', e => {
        /* ── BEV pending: check if we've crossed the pan threshold ── */
        if (S._bevPending) {
            const ddx = e.clientX - S._bevPanStartX;
            const ddy = e.clientY - S._bevPanStartY;
            if (Math.sqrt(ddx * ddx + ddy * ddy) > BEV_PAN_THRESHOLD) {
                /* Threshold exceeded → switch from pending to active pan. */
                S._bevPending = false;
                S._bevPendingObj = null;
                S._bevPendingCam = null;
                S._bevPanning = true;
                S._bevPanLastX = e.clientX;
                S._bevPanLastY = e.clientY;
                canvas.style.cursor = 'grabbing';
                /* Fall through to pan handling immediately. */
            } else {
                return;
            }
        }

        /* ── BEV active pan ── */
        if (S._bevPanning && onBevPan) {
            const bevCam = getBevCam();
            if (!bevCam) return;
            const pr = S._bevPanRect;
            /* Ortho camera: world units per pixel = (right - left) / panelWidth.
               Since the ortho frustum is set up to match the panel aspect,
               both axes have the same world-per-pixel ratio. */
            const worldPerPx = (bevCam.right - bevCam.left) / pr.w;
            const dpx = e.clientX - S._bevPanLastX;
            const dpy = e.clientY - S._bevPanLastY;
            /* "Grab and drag" feel via the plane-specific worldPan function. */
            const planeDef = getBevPlaneDef(S.bevPlane || 'xz');
            const delta = planeDef.worldPan(dpx, dpy, worldPerPx);
            onBevPan(delta.x, delta.y, delta.z);
            S._bevPanLastX = e.clientX;
            S._bevPanLastY = e.clientY;
            return;
        }

        /* ── Object drag ── */
        if (!S.dragging || !S.sel) return;
        const cam = S._selCam || getMainCam();
        const panel = S._selPanel || P.m;
        const ndc = toNDC(e.clientX, e.clientY, panel);
        rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
        if (rc.ray.intersectPlane(S.dragPlane, hitPt)) {
            if (S._selIsBev) {
                /* BEV: move along the 2 non-normal axes of the current plane. */
                const planeDef = getBevPlaneDef(S.bevPlane || 'xz');
                const dn = planeDef.dragNormal;
                const nx = Math.abs(dn.x), ny = Math.abs(dn.y), nz = Math.abs(dn.z);
                if (nx < 0.5) S.sel.position.x = hitPt.x + S.dragOff.x;
                if (ny < 0.5) S.sel.position.y = hitPt.y + S.dragOff.y;
                if (nz < 0.5) S.sel.position.z = hitPt.z + S.dragOff.z;
            } else {
                /* Perspective panel: move on camera-facing plane */
                S.sel.position.copy(hitPt).add(S.dragOff);
            }
            syncDepthSlider();
            if (onSelChange) onSelChange('object', S.sel.name || '(unnamed)');
        }
    });

    canvas.addEventListener('pointerup', () => {
        /* BEV pending: pointer released without crossing the pan threshold
           → complete the deferred selection. */
        if (S._bevPending) {
            if (S._bevPendingCam) {
                sel(null);
                S.selCam = S._bevPendingCam;
                if (onSelChange) onSelChange('camera', S._bevPendingCam);
            } else if (S._bevPendingObj) {
                sel(S._bevPendingObj);
            } else {
                sel(null);
            }
            S._bevPending = false;
            S._bevPendingObj = null;
            S._bevPendingCam = null;
        }
        S.dragging = false;
        S._bevPanning = false;
        canvas.style.cursor = '';
    });

    /* ── BEV mouse-wheel zoom ── */
    canvas.addEventListener('wheel', e => {
        if (!onBevZoom) return;
        const panel = getPanel(e.clientX, e.clientY);
        if (panel !== 'bev') return;
        e.preventDefault();
        // Scroll up (negative deltaY) = zoom in (smaller extent)
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        onBevZoom(factor);
    }, { passive: false });

    return { sel, syncDepthSlider, syncScaleSlider };
}
