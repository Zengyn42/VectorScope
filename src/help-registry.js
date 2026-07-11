/**
 * @module help-registry
 * @description
 * Distributed help system: each module owns the documentation for the
 * features it implements, exported as a plain-data `HELP` constant:
 *
 * ```js
 * export const HELP = {
 *     title: 'Zoom Pipeline',
 *     order: 30,                       // section sort key (asc)
 *     text: 'optional intro paragraph (may contain inline HTML)',
 *     entries: [['Term', 'Description'], ...],   // optional 2-col table
 * };
 * ```
 *
 * The Help dialog collects these at open time via dynamic `import()` —
 * no help text is hardcoded in index.html, and a module's docs live next
 * to the code they describe.
 *
 * Pure module — no DOM; `renderHelpHTML` is a pure string builder.
 */

/**
 * Create a help registry.
 * @returns {{register: Function, render: Function, sections: Function}}
 */
export function createHelpRegistry() {
    /** @type {Map<string, object>} */
    const sections = new Map();
    return {
        /**
         * Register (or replace) a help section.
         * @param {string} id - unique section id (e.g. module path)
         * @param {object} section - {title, order?, text?, entries?}
         */
        register(id, section) {
            if (!section || !section.title) return;   // tolerate modules without HELP
            sections.set(id, section);
        },
        /** @returns {object[]} registered sections (insertion order) */
        sections() { return [...sections.values()]; },
        /** @returns {string} full help HTML, sections sorted by `order` */
        render() { return renderHelpHTML([...sections.values()]); },
    };
}

/**
 * Render help sections to HTML (sorted by `order`, default 100).
 * Content is trusted module-local data — no escaping is applied, so
 * entries may use inline markup like <b>.
 *
 * @param {object[]} sections - array of {title, order?, text?, entries?}
 * @returns {string} HTML string
 */
export function renderHelpHTML(sections) {
    const sorted = [...sections].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    return sorted.map((s) => {
        let body = '';
        if (s.text) body += `<p style="line-height:1.6;margin-bottom:8px">${s.text}</p>`;
        if (s.entries && s.entries.length) {
            body += '<table>'
                + s.entries.map(([t, d]) => `<tr><td>${t}</td><td>${d}</td></tr>`).join('')
                + '</table>';
        }
        return `<h3>${s.title}</h3>${body}`;
    }).join('');
}
