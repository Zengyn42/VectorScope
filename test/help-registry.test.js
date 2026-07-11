import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHelpRegistry, renderHelpHTML } from '../src/help-registry.js';

describe('renderHelpHTML', () => {
    it('renders title + entries as a table', () => {
        const html = renderHelpHTML([{ title: 'Mouse', entries: [['Click', 'Select']] }]);
        assert.match(html, /<h3>Mouse<\/h3>/);
        assert.match(html, /<td>Click<\/td><td>Select<\/td>/);
    });

    it('renders optional intro text', () => {
        const html = renderHelpHTML([{ title: 'T', text: 'intro <b>x</b>' }]);
        assert.match(html, /<p[^>]*>intro <b>x<\/b><\/p>/);
    });

    it('sorts sections by order (default 100)', () => {
        const html = renderHelpHTML([
            { title: 'Last' },                 // default 100
            { title: 'First', order: 0 },
            { title: 'Mid', order: 50 },
        ]);
        const idx = (t) => html.indexOf(`<h3>${t}</h3>`);
        assert.ok(idx('First') < idx('Mid') && idx('Mid') < idx('Last'));
    });
});

describe('createHelpRegistry', () => {
    it('registers, replaces by id, ignores sections without a title', () => {
        const reg = createHelpRegistry();
        reg.register('a', { title: 'A1' });
        reg.register('a', { title: 'A2' });
        reg.register('bad', undefined);
        reg.register('bad2', {});
        assert.equal(reg.sections().length, 1);
        assert.match(reg.render(), /<h3>A2<\/h3>/);
    });
});

describe('module HELP exports', () => {
    const paths = [
        '../src/panels.js', '../src/interaction.js', '../src/zoom-pipeline.js',
        '../src/ui-controls.js', '../src/autofocus.js', '../src/object-ops.js',
        '../src/scene-io.js', '../src/scene-anim.js', '../src/bev-ghost.js',
    ];
    for (const p of paths) {
        it(`${p} exports a valid HELP section`, async () => {
            const m = await import(p);
            assert.ok(m.HELP, 'HELP missing');
            assert.equal(typeof m.HELP.title, 'string');
            assert.equal(typeof m.HELP.order, 'number');
            assert.ok(m.HELP.text || (m.HELP.entries && m.HELP.entries.length),
                'HELP needs text or entries');
        });
    }

    it('all module HELP sections render together without collisions', async () => {
        const reg = createHelpRegistry();
        for (const p of paths) reg.register(p, (await import(p)).HELP);
        const html = reg.render();
        assert.equal(reg.sections().length, paths.length);
        for (const s of reg.sections()) assert.match(html, new RegExp(`<h3>${s.title.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}</h3>`));
    });
});
