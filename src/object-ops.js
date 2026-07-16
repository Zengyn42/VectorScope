/**
 * @module object-ops
 * @description
 * Object-level operations for VectorScope: stable object identity,
 * Add (place in front of the main camera at Focus D), Delete (= hide,
 * restored by Reset; permanently dropped only when a save excludes it),
 * and the objects section of scene save/load.
 *
 * **Stable identity (`userData._vsid`):** save files reference objects by
 * name, but glTF node names may repeat. `assignStableIds` walks the loader
 * registry in registration order and dedupes (`chair`, `chair_2`, …) —
 * the same asset loaded again yields the same ids, so saved state can be
 * re-matched deterministically.
 *
 * **Delete = hide:** `deleteSelected` only sets `visible=false` +
 * `_hidden` flag. Reset restores visibility; `serializeObjects` skips
 * hidden objects, which is what makes a subsequent save "forget" them.
 */

/**
 * @param {object} d
 * @param {object}   d.THREE      - Three.js namespace
 * @param {object}   d.S          - shared app state (sel)
 * @param {Function} d.getLoaderState - loader registry accessor
 * @param {Function} d.getMainCam - () => main camera
 * @param {Function} d.getFocusD  - () => current Focus D (store-backed)
 * @param {object}   d.sceneAnim  - scene animator (getState/setAnim/clear)
 * @param {Function} d.sel        - selection setter (from initInteraction)
 * @param {Function} [d.log]      - status logger
 */
/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Objects',
    order: 50,
    entries: [
        ['Add', 'Load a .glb/.gltf or .obj (+.mtl + textures) and place it at Focus D in front of the Main camera'],
        ['Delete', 'Hide the selected object (Reset un-hides it; a Save excludes hidden objects permanently)'],
        ['Obj Depth / Scale', '(Selection panel) move the selected object along the main camera axis; scale it'],
    ],
};

export function createObjectOps({ THREE, S, getLoaderState, getMainCam, getFocusD, sceneAnim, sel, log = () => {} }) {

    /** Assign unique `userData._vsid` to registered objects (idempotent). */
    function assignStableIds() {
        const state = getLoaderState();
        const used = new Set(state.objs.map(o => o.userData._vsid).filter(Boolean));
        for (const o of state.objs) {
            if (o.userData._vsid) continue;
            const base = o.name || 'object';
            let id = base, n = 1;
            while (used.has(id)) id = `${base}_${++n}`;
            used.add(id);
            o.userData._vsid = id;
        }
    }

    /**
     * Place an object so its bounding-box center sits on the main camera's
     * optical axis at Focus D depth, then snapshot reset state (origPos +
     * _baseRot + _baseScale) so Reset returns it to this add-moment pose.
     */
    function placeAtFocus(obj) {
        const cam = getMainCam();
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const target = cam.position.clone().addScaledVector(dir, getFocusD());
        const c = new THREE.Vector3();
        new THREE.Box3().setFromObject(obj).getCenter(c);
        obj.position.add(target.sub(c));
        obj.updateMatrixWorld(true);
    }

    /**
     * Auto-fit wildly out-of-scale imports (e.g. cm/inch-unit OBJ exports
     * thousands of units wide — placing those unscaled at Focus D swallows
     * the camera and nothing appears to happen). When the largest bbox
     * dimension is grossly too big or too small to see at Focus D, scale
     * the object so it spans ~0.6 × Focus D.
     * @returns {number} the applied scale factor (1 = untouched)
     */
    function fitToFocus(obj) {
        const size = new THREE.Vector3();
        new THREE.Box3().setFromObject(obj).getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (!isFinite(maxDim) || maxDim <= 0) return 1;
        const focusD = getFocusD();
        if (maxDim <= focusD * 2 && maxDim >= focusD * 0.02) return 1;  // sane size
        const k = (focusD * 0.6) / maxDim;
        obj.scale.multiplyScalar(k);
        obj.updateMatrixWorld(true);
        return k;
    }

    /**
     * Finalize newly registered objects (from loader.registerModel):
     * link to their asset, place added roots at Focus D, snapshot reset state.
     * @param {THREE.Object3D[]} objs - registered objects
     * @param {object} opts
     * @param {string}  opts.assetId - owning asset id
     * @param {boolean} [opts.place=false] - place at Focus D (Add flow)
     */
    function adoptObjects(objs, { assetId, place = false }) {
        const state = getLoaderState();
        for (const o of objs) {
            o.userData._assetId = assetId;
            if (place) {
                const k = fitToFocus(o);
                if (k !== 1) log(`Auto-scaled "${o.name || 'object'}" x${k.toPrecision(3)} to fit the view`);
                placeAtFocus(o);
            }
            state.origPos.set(o.uuid, o.position.clone());   // reset → add-moment pose
            o.userData._baseRot = o.rotation.clone();
            o.userData._baseScale = o.scale.clone();         // after auto-fit: Reset keeps it
        }
        assignStableIds();
    }

    /** Hide the selected object (Delete button). @returns {boolean} */
    function deleteSelected() {
        const obj = S.sel;
        if (!obj) return false;
        sceneAnim.clear(obj);       // restore base pose, stop animating
        sel(null);
        obj.visible = false;
        obj.userData._hidden = true;
        log(`Deleted (hidden): ${obj.userData._vsid || obj.name || 'object'}`);
        return true;
    }

    /** Un-hide every hidden object (part of Reset). */
    function restoreHidden() {
        for (const o of getLoaderState().objs) {
            if (o.userData._hidden) {
                o.visible = true;
                delete o.userData._hidden;
            }
        }
    }

    /**
     * Serialize all non-hidden objects for scene save. For animated objects
     * the *base* pose is saved (the animation oscillates around it).
     * @returns {object[]} [{id, name, assetId, position, rotation, scale, anim}]
     */
    function serializeObjects() {
        assignStableIds();
        const out = [];
        for (const o of getLoaderState().objs) {
            if (o.userData._hidden) continue;
            const st = sceneAnim.getState(o);
            const pos = st ? st.base : [o.position.x, o.position.y, o.position.z];
            const rot = [o.rotation.x, st ? st.baseRotY : o.rotation.y, o.rotation.z];
            out.push({
                id: o.userData._vsid,
                name: o.name || '',
                assetId: o.userData._assetId || 'scene',
                position: pos,
                rotation: rot,
                scale: [o.scale.x, o.scale.y, o.scale.z],
                anim: st ? { mode: st.mode, speed: st.speed, dir: st.dir } : null,
            });
        }
        return out;
    }

    /**
     * Apply a saved objects list to the freshly loaded scene:
     * - objects matched by `_vsid` get their saved transform + animation
     * - registered objects NOT in the list are removed permanently
     *   (they were deleted/hidden when the scene was saved)
     * Reset state (origPos/_baseRot/_baseScale) is re-snapshotted to the loaded pose.
     * @param {object[]} list - serializeObjects() output
     * @param {object} scene - THREE.Scene (for removing dropped objects)
     * @returns {{applied: number, removed: number, missing: string[]}}
     */
    function applyObjects(list, scene) {
        assignStableIds();
        const state = getLoaderState();
        const byId = new Map(list.map(e => [e.id, e]));
        const keep = [], missing = [];
        let removed = 0;

        for (const o of state.objs) {
            const e = byId.get(o.userData._vsid);
            if (!e) {
                (o.parent || scene).remove(o);
                state.origPos.delete(o.uuid);
                removed++;
                continue;
            }
            byId.delete(o.userData._vsid);
            o.position.set(...e.position);
            o.rotation.set(...e.rotation);
            o.scale.set(...e.scale);
            o.visible = true;
            delete o.userData._hidden;
            o.updateMatrixWorld(true);
            state.origPos.set(o.uuid, o.position.clone());
            o.userData._baseRot = o.rotation.clone();
            o.userData._baseScale = o.scale.clone();
            if (e.anim && e.anim.mode !== 'none') {
                sceneAnim.setAnim(o, e.anim.mode, { speed: e.anim.speed, dir: e.anim.dir });
            }
            keep.push(o);
        }

        state.objs = keep;
        for (const id of byId.keys()) missing.push(id);
        if (missing.length) log(`Scene load: ${missing.length} saved object(s) not found: ${missing.join(', ')}`);
        return { applied: keep.length, removed, missing };
    }

    return { assignStableIds, placeAtFocus, fitToFocus, adoptObjects, deleteSelected, restoreHidden, serializeObjects, applyObjects };
}
