/**
 * @module segment-dialog
 * @description
 * Modal dialog for editing zoom-segment → lead/follower camera assignments.
 *
 * Each row in the dialog represents one segment:
 *   [from] – [to] x | Lead: [dropdown] | Follower: [dropdown]
 *
 * Users can:
 * - Change lead/follower camera for any segment
 * - Edit boundary zoom values (from/to)
 * - Add or remove segments
 * - Reset to defaults
 *
 * Changes are applied immediately on Close (live preview could be added later).
 */

import { SRC } from './zoom-pipeline.js';
import { CAM_NAMES, DEFAULT_SEGMENTS } from './segment-config.js';

/**
 * Render the segment config dialog content.
 * @param {HTMLElement} container - DOM element to fill with HTML
 * @param {Array} segments - current segment array from segmentConfig.getSegments()
 */
export function renderSegmentDialog(container, segments) {
    let html = '<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">';
    html += '<tr style="color:#888;font-size:11px;text-transform:uppercase;">'
          + '<td>From</td><td>To</td><td>Lead</td><td>Follower</td><td></td></tr>';

    segments.forEach((seg, i) => {
        html += `<tr class="seg-row" data-idx="${i}" style="border-top:1px solid #0f3460;">`;
        html += `<td><input type="number" class="seg-from" value="${seg.from}" step="0.5" min="0.1" max="20" style="width:55px;"></td>`;
        html += `<td><input type="number" class="seg-to" value="${seg.to}" step="0.5" min="0.1" max="20" style="width:55px;"></td>`;
        html += `<td>${makeSelect('seg-lead', seg.lead)}</td>`;
        html += `<td>${makeSelect('seg-follower', seg.follower)}</td>`;
        html += `<td><button class="seg-del" data-idx="${i}" style="color:#e94560;background:none;border:none;cursor:pointer;font-size:14px;" title="Remove segment">&times;</button></td>`;
        html += '</tr>';
    });
    html += '</table>';
    container.innerHTML = html;
}

function makeSelect(cls, selected) {
    let html = `<select class="${cls}" style="background:#0a0f1e;color:#e0e0e0;border:1px solid #333;padding:2px 4px;">`;
    CAM_NAMES.forEach((name, i) => {
        html += `<option value="${i}"${i === selected ? ' selected' : ''}>${name}</option>`;
    });
    html += '</select>';
    return html;
}

/**
 * Read current segment values from the dialog DOM.
 * @param {HTMLElement} container
 * @returns {Array} segment array
 */
export function readSegmentInputs(container) {
    const rows = container.querySelectorAll('.seg-row');
    const segs = [];
    rows.forEach(row => {
        segs.push({
            from: parseFloat(row.querySelector('.seg-from').value) || 0.5,
            to: parseFloat(row.querySelector('.seg-to').value) || 10,
            lead: parseInt(row.querySelector('.seg-lead').value, 10),
            follower: parseInt(row.querySelector('.seg-follower').value, 10),
        });
    });
    return segs;
}

/**
 * Bind the segment dialog events: add/delete rows, reset, close.
 * @param {HTMLElement} overlay - the modal overlay element
 * @param {object} opts
 * @param {object} opts.segmentConfig - createSegmentConfig instance
 * @param {Function} opts.onApply - called with new segments array after close
 */
export function bindSegmentDialog(overlay, { segmentConfig, onApply }) {
    const content = overlay.querySelector('#seg-params-content');
    const btnAdd = overlay.querySelector('#seg-add');
    const btnReset = overlay.querySelector('#seg-reset');
    const btnClose = overlay.querySelector('#seg-close');

    function refresh() {
        renderSegmentDialog(content, segmentConfig.getSegments());
        bindDeletes();
    }

    function bindDeletes() {
        content.querySelectorAll('.seg-del').forEach(btn => {
            btn.onclick = () => {
                const segs = readSegmentInputs(content);
                const idx = parseInt(btn.dataset.idx, 10);
                segs.splice(idx, 1);
                if (segs.length > 0) {
                    segmentConfig.setSegments(segs);
                    refresh();
                }
            };
        });
    }

    btnAdd.onclick = () => {
        const segs = readSegmentInputs(content);
        const last = segs[segs.length - 1] || { to: 10, lead: SRC.MAIN, follower: SRC.SEC1 };
        segs.push({ from: last.to, to: last.to + 2, lead: SRC.MAIN, follower: SRC.SEC1 });
        segmentConfig.setSegments(segs);
        refresh();
    };

    btnReset.onclick = () => {
        segmentConfig.setSegments(DEFAULT_SEGMENTS);
        refresh();
    };

    btnClose.onclick = () => {
        const segs = readSegmentInputs(content);
        segmentConfig.setSegments(segs);
        overlay.classList.remove('open');
        if (onApply) onApply(segs);
    };

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            btnClose.click();
        }
    });

    // Open hook: refresh content
    return {
        open() {
            refresh();
            overlay.classList.add('open');
        },
    };
}
