/**
 * @module bev-ghost
 * @description
 * BEV "Section Cut" — geometry beyond the clip threshold is cut away in the
 * Bird's Eye pass with a THREE.js clipping plane, like an architectural
 * section view: the part of every mesh below the threshold stays solid,
 * the part above simply disappears. Walls that span floor-to-ceiling are
 * cut at the threshold instead of blocking the view.
 *
 * The clip axis follows the active BEV plane (y for top-down xz, z for
 * front xy, x for side zy). Only layer-0 scene meshes are clipped; camera
 * markers (layer 1) always render whole.
 *
 * Usage per frame:
 * ```js
 * ghost.apply();          // before rendering the BEV pass
 * renderer.render(scene, bevCam);
 * ghost.restore();        // immediately after
 * ```
 *
 * Implementation: per-material `clippingPlanes` (NOT the renderer's global
 * `clippingPlanes`) so camera markers are unaffected. The renderer's
 * `localClippingEnabled` is switched on lazily in apply(). One shared
 * THREE.Plane instance is reused; materials are tracked in a Set so shared
 * materials are assigned/cleared exactly once.
 *
 * @param {object} opts
 * @param {object} opts.THREE - Three.js namespace
 * @param {object} opts.scene - scene to traverse
 * @param {object} [opts.renderer] - WebGLRenderer (enables localClipping)
 * @param {Function} opts.getClipY - returns current clip threshold (world units)
 * @param {Function} [opts.getClipAxis] - returns 'x'|'y'|'z' (default 'y')
 * @returns {{ apply: Function, restore: Function }}
 */
/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'BEV Section Cut',
    order: 70,
    entries: [
        ['Ghost slider', 'Section-cut height for Bird\'s Eye: geometry above this threshold (along the view plane\'s clip axis) is cut away, so ceilings and surrounding walls don\'t block the view. Objects entirely beyond the cut are not clickable there'],
    ],
};

export function createBevGhost({ THREE, scene, renderer = null, getClipY, getClipAxis = null }) {
    /* Keep fragments with p[axis] <= clip:
       plane normal = −e_axis, constant = clip
       → signed distance = clip − p[axis], negative (clipped) above the cut. */
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const planeArr = [plane];
    const touched = new Set();   // materials assigned this frame (dedupes shared mats)

    /** Install the section-cut plane on all layer-0 scene mesh materials. */
    function apply() {
        const clipVal = getClipY();
        const axis = getClipAxis ? getClipAxis() : 'y';
        plane.normal.set(
            axis === 'x' ? -1 : 0,
            axis === 'y' ? -1 : 0,
            axis === 'z' ? -1 : 0,
        );
        plane.constant = clipVal;
        if (renderer) renderer.localClippingEnabled = true;
        scene.traverse(o => {
            if (!o.isMesh || o.layers.mask !== 1) return;  // layer-0 scene meshes only
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
                if (touched.has(m)) continue;
                m.clippingPlanes = planeArr;
                touched.add(m);
            }
        });
    }

    /** Remove the section-cut plane after the BEV pass. */
    function restore() {
        for (const m of touched) m.clippingPlanes = null;
        touched.clear();
    }

    return { apply, restore };
}
