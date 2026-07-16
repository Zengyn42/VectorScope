/**
 * @module fallback-scene
 * @description
 * Placeholder scene (floor + colored primitives) shown when the default
 * glTF hasn't loaded in time, so the page is never blank.
 *
 * Placeholders are tracked internally so they can be **fully removed**
 * once the real scene arrives. Without this, a slow glb load races the
 * fallback timeout and both scenes end up coexisting (the "red cube in
 * the bedroom" bug).
 *
 * Registry integrity: placeholders are registered in the loader state
 * (`objs` / `origPos`) so they're selectable/resettable like real objects,
 * and deregistered symmetrically on removal.
 *
 * @param {object} opts
 * @param {object} opts.THREE - Three.js namespace
 * @param {object} opts.scene - target scene
 * @param {Function} opts.getLoaderState - loader registry accessor
 * @param {Function} [opts.onRemove] - called with each removed object
 *   (lets the caller clear selection if it pointed at a placeholder)
 * @returns {{ add: Function, remove: Function, active: Function }}
 */
export function createFallbackScene({ THREE, scene, getLoaderState, onRemove }) {
    let objs = [];

    /** Add the placeholder floor + primitives and register them with the loader. */
    function add() {
        const ls = getLoaderState();
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(12, 12),
            new THREE.MeshStandardMaterial({ color: 0x3a3a5c }));
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);
        objs.push(floor);
        [[0xe94560, [-1.2, .4, 2], 'Red Cube', new THREE.BoxGeometry(.8, .8, .8)],
         [0x533483, [1, .5, 3.5], 'Purple Sphere', new THREE.SphereGeometry(.5, 32, 32)],
         [0x0f3460, [0, .55, 1], 'Blue Torus', new THREE.TorusGeometry(.35, .12, 16, 48)],
         [0x16c79a, [2, .5, 4], 'Green Cone', new THREE.ConeGeometry(.35, 1, 32)],
         [0xf5a623, [-2, .5, 3.5], 'Orange Cyl', new THREE.CylinderGeometry(.25, .25, 1, 32)],
        ].forEach(([c, p, n, g]) => {
            const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: c, roughness: .3 }));
            m.position.set(...p); m.name = n;
            scene.add(m);
            objs.push(m);
            ls.objs.push(m);
            ls.origPos.set(m.uuid, m.position.clone());
            m.userData._baseRot = m.rotation.clone();
        });
        ls.loaded = true;
    }

    /** Remove all placeholders and deregister them from the loader. */
    function remove() {
        if (!objs.length) return;
        const ls = getLoaderState();
        for (const o of objs) {
            scene.remove(o);
            const i = ls.objs.indexOf(o);
            if (i >= 0) ls.objs.splice(i, 1);
            ls.origPos.delete(o.uuid);
            if (onRemove) onRemove(o);
        }
        objs = [];
    }

    /** Whether placeholders are currently in the scene. */
    function active() {
        return objs.length > 0;
    }

    return { add, remove, active };
}
