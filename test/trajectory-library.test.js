import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { trajToJson, createTrajectoryLibrary } from '../src/trajectory-library.js';

// Minimal mock parsed trajectory
function mockTraj(name, frames) {
    return {
        name,
        fps: 30,
        length: frames.length,
        frameAt(i) { return frames[i]; },
    };
}

describe('trajToJson', () => {
    it('first frame is stored in full', () => {
        const traj = mockTraj('test', [{ zoom: 1.0, focusD: 3.0, lead: 'main' }]);
        const json = trajToJson(traj);
        assert.equal(json.version, 1);
        assert.equal(json.name, 'test');
        assert.equal(json.fps, 30);
        assert.deepEqual(json.frames[0], { zoom: 1.0, focusD: 3.0, lead: 'main' });
    });

    it('delta-encodes subsequent frames (only changed fields)', () => {
        const traj = mockTraj('t', [
            { zoom: 1.0, focusD: 3.0 },
            { zoom: 1.5, focusD: 3.0 },  // only zoom changed
            { zoom: 1.5, focusD: 4.0 },  // only focusD changed
        ]);
        const json = trajToJson(traj);
        assert.deepEqual(json.frames[1], { zoom: 1.5 });
        assert.deepEqual(json.frames[2], { focusD: 4.0 });
    });

    it('emits minimal delta when nothing changed', () => {
        const traj = mockTraj('t', [
            { zoom: 1.0, focusD: 3.0 },
            { zoom: 1.0, focusD: 3.0 },  // identical
        ]);
        const json = trajToJson(traj);
        assert.deepEqual(json.frames[1], { zoom: 1.0 });
    });

    it('strips blendT from deltas', () => {
        const traj = mockTraj('t', [
            { zoom: 1.0, blendT: 0.5 },
            { zoom: 1.0, blendT: 0.8 },  // blendT changed but should be stripped
        ]);
        const json = trajToJson(traj);
        assert.ok(!('blendT' in json.frames[1]));
    });
});

describe('createTrajectoryLibrary', () => {
    const parse = (json) => mockTraj(json.name, json.frames || []);

    it('add / get / has / names', () => {
        const lib = createTrajectoryLibrary({ parseTrajectory: parse });
        const t = mockTraj('alpha', [{ zoom: 1 }]);
        lib.add(t);
        assert.ok(lib.has('alpha'));
        assert.equal(lib.get('alpha'), t);
        assert.deepEqual(lib.names(), ['alpha']);
    });

    it('remove deletes by name', () => {
        const lib = createTrajectoryLibrary({ parseTrajectory: parse });
        lib.add(mockTraj('a', []));
        lib.add(mockTraj('b', []));
        lib.remove('a');
        assert.ok(!lib.has('a'));
        assert.ok(lib.has('b'));
    });

    it('size reflects count', () => {
        const lib = createTrajectoryLibrary({ parseTrajectory: parse });
        assert.equal(lib.size, 0);
        lib.add(mockTraj('x', []));
        assert.equal(lib.size, 1);
    });

    it('clear empties the library', () => {
        const lib = createTrajectoryLibrary({ parseTrajectory: parse });
        lib.add(mockTraj('x', []));
        lib.clear();
        assert.equal(lib.size, 0);
    });

    it('serialize round-trips via restore', () => {
        const lib = createTrajectoryLibrary({ parseTrajectory: parse });
        lib.add(mockTraj('t1', [{ zoom: 1 }]));
        lib.add(mockTraj('t2', [{ zoom: 2 }]));
        const data = lib.serialize();
        assert.equal(data.length, 2);

        const lib2 = createTrajectoryLibrary({ parseTrajectory: parse });
        lib2.restore(data.map(d => d.json));
        assert.equal(lib2.size, 2);
        assert.ok(lib2.has('t1'));
        assert.ok(lib2.has('t2'));
    });

    it('restore skips invalid entries', () => {
        const badParse = (json) => { if (!json.name) throw new Error('bad'); return parse(json); };
        const lib = createTrajectoryLibrary({ parseTrajectory: badParse });
        lib.restore([{ name: 'ok', frames: [] }, {}]);  // second is invalid
        assert.equal(lib.size, 1);
    });
});
