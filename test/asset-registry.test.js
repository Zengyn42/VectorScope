import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssetRegistry } from '../src/asset-registry.js';

test('add assigns sequential ids and stores entry', () => {
    const reg = createAssetRegistry();
    const id1 = reg.add({ name: 'chair.glb', format: 'glb', files: [{ name: 'chair.glb', data: new ArrayBuffer(4) }] });
    const id2 = reg.add({ name: 'lamp.obj', format: 'obj', mode: 'object' });
    assert.equal(id1, 'a1');
    assert.equal(id2, 'a2');
    assert.equal(reg.get('a1').name, 'chair.glb');
    assert.equal(reg.get('a1').mode, 'object');       // default mode
    assert.equal(reg.get('a2').files.length, 0);       // default files
    assert.equal(reg.get('a2').url, null);
});

test('setSceneAsset uses fixed id and scene mode', () => {
    const reg = createAssetRegistry();
    const id = reg.setSceneAsset({ name: 'bedroom.glb', url: 'assets/bedroom.glb' });
    assert.equal(id, 'scene');
    const e = reg.get('scene');
    assert.equal(e.mode, 'scene');
    assert.equal(e.format, 'glb');                     // default format
    assert.equal(e.url, 'assets/bedroom.glb');
    // replace
    reg.setSceneAsset({ name: 'office.glb', format: 'glb', files: [{ name: 'office.glb', data: new ArrayBuffer(1) }] });
    assert.equal(reg.get('scene').name, 'office.glb');
    assert.equal(reg.list().filter(a => a.id === 'scene').length, 1);
});

test('list returns all, clear keeps scene optionally', () => {
    const reg = createAssetRegistry();
    reg.setSceneAsset({ name: 's.glb' });
    reg.add({ name: 'x.glb', format: 'glb' });
    reg.add({ name: 'y.obj', format: 'obj' });
    assert.equal(reg.list().length, 3);

    reg.clear(true);                                   // keep scene
    assert.equal(reg.list().length, 1);
    assert.equal(reg.list()[0].id, 'scene');

    reg.add({ name: 'z.glb', format: 'glb' });
    reg.clear();                                       // drop everything
    assert.equal(reg.list().length, 0);
});

test('remove deletes one asset', () => {
    const reg = createAssetRegistry();
    const id = reg.add({ name: 'x.glb', format: 'glb' });
    assert.equal(reg.remove(id), true);
    assert.equal(reg.remove(id), false);
    assert.equal(reg.get(id), undefined);
});
