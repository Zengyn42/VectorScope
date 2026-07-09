/**
 * @module asset-parse
 * @description
 * Parse in-memory asset files (from `<input type=file>` picks or a saved
 * scene directory) into a Three.js object root, without ever needing a URL.
 *
 * Supported formats:
 * - **glb/gltf** — `GLTFLoader.parse(ArrayBuffer)` (Draco supported)
 * - **obj (+ mtl + textures)** — `MTLLoader.parse(text)` with a
 *   `LoadingManager.setURLModifier` that maps texture file names referenced
 *   inside the .mtl to blob URLs of the picked image files. This is the only
 *   way to satisfy MTL texture references when everything lives in memory.
 *
 * Input file shape: `{name: string, data: ArrayBuffer|string}` — text files
 * (.obj/.mtl) may be either; binary files must be ArrayBuffer.
 *
 * Blob URLs created for textures are revoked after load completes (textures
 * are decoded into GPU memory by then).
 */

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|tga|ktx2?)$/i;

/** File-name extension, lowercased, no dot. */
export function fileExt(name) {
    const m = /\.([^.]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
}

/** Classify a picked file set: {format:'glb'|'obj'|null, main, mtl, textures} */
export function classifyFiles(files) {
    let main = null, mtl = null, format = null;
    const textures = [];
    for (const f of files) {
        const ext = fileExt(f.name);
        if (ext === 'glb' || ext === 'gltf') { main = f; format = 'glb'; }
        else if (ext === 'obj') { main = f; format = 'obj'; }
        else if (ext === 'mtl') mtl = f;
        else if (IMG_EXT.test(f.name)) textures.push(f);
    }
    return { format, main, mtl, textures };
}

function asText(data) {
    return typeof data === 'string' ? data : new TextDecoder().decode(data);
}

/**
 * Create the asset parser.
 * @param {object} d
 * @param {object} d.THREE - Three.js namespace (LoadingManager)
 * @param {Function} d.GLTFLoader
 * @param {Function} d.DRACOLoader
 * @param {string}   d.dracoPath
 * @param {Function} d.OBJLoader
 * @param {Function} d.MTLLoader
 */
export function createAssetParser({ THREE, GLTFLoader, DRACOLoader, dracoPath, OBJLoader, MTLLoader }) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(dracoPath);

    function parseGlb(buffer) {
        return new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            loader.setDRACOLoader(draco);
            loader.parse(buffer, '', (gltf) => resolve(gltf.scene), reject);
        });
    }

    async function parseObj({ main, mtl, textures }) {
        // Map texture basenames → blob URLs so MTL references resolve.
        const blobs = new Map();
        for (const t of textures) {
            blobs.set(t.name.toLowerCase(), URL.createObjectURL(new Blob([t.data])));
        }
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => {
            const base = url.split('/').pop().split('?')[0].toLowerCase();
            return blobs.get(base) || url;
        });

        const objLoader = new OBJLoader(manager);
        if (mtl) {
            const mtlLoader = new MTLLoader(manager);
            const materials = mtlLoader.parse(asText(mtl.data), '');
            materials.preload();
            objLoader.setMaterials(materials);
        }
        const root = objLoader.parse(asText(main.data));

        // Textures load async via blob URLs; give the manager a tick, then
        // revoke on completion (or immediately when nothing was queued).
        if (blobs.size) {
            await new Promise((resolve) => {
                let settled = false;
                const done = () => { if (!settled) { settled = true; resolve(); } };
                manager.onLoad = done;
                manager.onError = done;
                setTimeout(done, 3000);   // safety: never hang the Add flow
            });
            for (const u of blobs.values()) URL.revokeObjectURL(u);
        }
        return root;
    }

    /**
     * Parse a set of in-memory files into an object root.
     * @param {{name: string, data: ArrayBuffer|string}[]} files
     * @returns {Promise<{root: THREE.Object3D, format: 'glb'|'obj', mainName: string}>}
     * @throws {Error} when no .glb/.gltf/.obj file is present
     */
    async function parseFiles(files) {
        const cls = classifyFiles(files);
        if (!cls.main) throw new Error('No .glb/.gltf/.obj file in selection');
        const root = cls.format === 'glb'
            ? await parseGlb(cls.main.data)
            : await parseObj(cls);
        return { root, format: cls.format, mainName: cls.main.name };
    }

    return { parseFiles };
}
