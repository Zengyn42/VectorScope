/**
 * @module bev-ghost
 * @description
 * BEV "Ghost Mode" — objects entirely above a clip height are rendered
 * semi-transparent in the Bird's Eye pass (instead of hard-clipped), so
 * ceilings/roofs don't block the top-down view but remain visible as
 * translucent outlines.
 *
 * Usage per frame:
 * ```js
 * ghost.apply();          // before rendering the BEV pass
 * renderer.render(scene, bevCam);
 * ghost.restore();        // immediately after
 * ```
 *
 * Ghost materials are cloned lazily per mesh and cached in
 * `mesh.userData._ghostMat`, so repeated toggling allocates nothing.
 *
 * @param {object} opts
 * @param {object} opts.THREE - Three.js namespace
 * @param {object} opts.scene - scene to traverse
 * @param {Function} opts.getClipY - returns current ghost height (world Y)
 * @returns {{ apply: Function, restore: Function }}
 */
export function createBevGhost({ THREE, scene, getClipY }) {
    const box = new THREE.Box3();
    const ghosted = [];

    /** Swap meshes above the ghost height to translucent clone materials. */
    function apply() {
        const clipY = getClipY();
        scene.traverse(o => {
            if (!o.isMesh || o.layers.mask !== 1) return;  // layer-0 scene meshes only
            const g = o.geometry;
            if (!g.boundingBox) g.computeBoundingBox();
            box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
            if (box.min.y > clipY) {
                if (!o.userData._ghostMat) {
                    const mk = m => {
                        const c = m.clone();
                        c.transparent = true; c.opacity = 0.15; c.depthWrite = false;
                        return c;
                    };
                    o.userData._ghostMat = Array.isArray(o.material) ? o.material.map(mk) : mk(o.material);
                }
                o.userData._realMat = o.material;
                o.material = o.userData._ghostMat;
                ghosted.push(o);
            }
        });
    }

    /** Restore original materials after the BEV pass. */
    function restore() {
        for (const o of ghosted) o.material = o.userData._realMat;
        ghosted.length = 0;
    }

    return { apply, restore };
}
