/**
 * @module segment-dialog
 * @description
 * Modal dialog for editing zoom-segment configuration via breakpoints.
 *
 * Users add/remove breakpoints that divide the [0.5, 10.0] range into
 * segments. Each segment's lead/follower camera is configurable via dropdowns.
 *
 * Breakpoints use the convention: segment below is z < breakpoint,
 * segment at/above is z >= breakpoint.
 *
 * Adjusting a breakpoint's value auto-re-sorts the segment list.
 */

import { SRC } from './zoom-pipeline.js';
import { CAM_NAMES, RANGE_MIN, RANGE_MAX } from './segment-config.js';

/**
 * Render the segment config dialog content from breakpoints + assignments.
 * @param {HTMLElement} container - DOM element to fill
 * @param {object} segmentConfig - createSegmentConfig instance
 */
export function renderSegmentDialog(container, segmentConfig) {
    const bps = segmentConfig.getBreakpoints();
    const assigns = segmentConfig.getAssignments();

    let html = '<table style="width:100%;border-collapse:collapse;">';
    html += '<tr style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">'
          + '<td style="padding:2px 4px;">Range</td>'
          + '<td style="padding:2px 4px;">Lead</td>'
          + '<td style="padding:2px 4px;">Follower</td>'
          + '<td></td></tr>';

    // For N breakpoints, there are N+1 segments
    const segCount = bps.length + 1;
    for (let i = 0; i < segCount; i++) {
        const from = i === 0 ? RANGE_MIN : bps[i - 1];
        const to = i === segCount - 1 ? RANGE_MAX : bps[i];
        const a = assigns[i] || { lead: SRC.MAIN, follower: SRC.SEC1 };

        // Range label with convention markers
        const fromLabel = i === 0 ? `${from.toFixed(1)}x` : `\u2265${from.toFixed(1)}x`;
        const toLabel = i === segCount - 1 ? `${to.toFixed(1)}x` : `<${to.toFixed(1)}x`;
        const rangeLabel = `${fromLabel} \u2013 ${toLabel}`;

        html += `<tr class="seg-row" data-seg="${i}" style="border-top:1px solid #0f3460;height:32px;">`;
        html += `<td style="padding:2px 4px;font-family:monospace;font-size:12px;color:#aaa;white-space:nowrap;">${rangeLabel}</td>`;
        html += `<td style="padding:2px 4px;">${makeSelect('seg-lead', a.lead, i)}</td>`;
        html += `<td style="padding:2px 4px;">${makeSelect('seg-follower', a.follower, i)}</td>`;
        html += '<td></td>';
        html += '</tr>';

        // Breakpoint row (editable divider between segments)
        if (i < segCount - 1) {
            html += `<tr class="bp-row" data-bp="${i}" style="background:rgba(233,69,96,0.08);">`;
            html += `<td colspan="3" style="padding:3px 4px;font-size:11px;">`;
            html += `<span style="color:#e94560;">\u2504</span> Breakpoint: `;
            html += `<input type="number" class="bp-val" data-bp="${i}" value="${bps[i]}" `
                  + `step="0.5" min="${RANGE_MIN + 0.01}" max="${RANGE_MAX - 0.01}" `
                  + `style="width:60px;background:#0a0f1e;color:#e0e0e0;border:1px solid #333;padding:2px 4px;font-size:12px;">x`;
            html += `</td>`;
            html += `<td style="padding:3px 4px;"><button class="bp-del" data-bp="${i}" `
                  + `style="color:#e94560;background:none;border:none;cursor:pointer;font-size:14px;" `
                  + `title="Remove breakpoint">&times;</button></td>`;
            html += '</tr>';
        }
    }
    html += '</table>';
    container.innerHTML = html;
}

function makeSelect(cls, selected, segIdx) {
    let html = `<select class="${cls}" data-seg="${segIdx}" style="background:#0a0f1e;color:#e0e0e0;border:1px solid #333;padding:2px 4px;font-size:12px;">`;
    CAM_NAMES.forEach((name, i) => {
        html += `<option value="${i}"${i === selected ? ' selected' : ''}>${name}</option>`;
    });
    html += '</select>';
    return html;
}

/**
 * Bind the segment dialog events.
 * @param {HTMLElement} overlay - the modal overlay element
 * @param {object} opts
 * @param {object} opts.segmentConfig - createSegmentConfig instance
 * @param {Function} opts.onApply - called after any change
 */
export function bindSegmentDialog(overlay, { segmentConfig, onApply }) {
    const content = overlay.querySelector('#seg-params-content');
    const btnAdd = overlay.querySelector('#seg-add');
    const btnReset = overlay.querySelector('#seg-reset');
    const btnClose = overlay.querySelector('#seg-close');

    function refresh() {
        renderSegmentDialog(content, segmentConfig);
        bindInteractions();
    }

    function bindInteractions() {
        // Breakpoint value changes
        content.querySelectorAll('.bp-val').forEach(input => {
            input.onchange = () => {
                const idx = parseInt(input.dataset.bp, 10);
                const val = parseFloat(input.value);
                if (!isNaN(val)) {
                    segmentConfig.setBreakpoint(idx, val);
                    refresh();
                    if (onApply) onApply();
                }
            };
        });

        // Delete breakpoint
        content.querySelectorAll('.bp-del').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.bp, 10);
                segmentConfig.removeBreakpoint(idx);
                refresh();
                if (onApply) onApply();
            };
        });

        // Lead/follower dropdowns
        content.querySelectorAll('.seg-lead').forEach(sel => {
            sel.onchange = () => {
                const segIdx = parseInt(sel.dataset.seg, 10);
                const assigns = segmentConfig.getAssignments();
                segmentConfig.setAssignment(segIdx, parseInt(sel.value, 10), assigns[segIdx].follower);
                if (onApply) onApply();
            };
        });
        content.querySelectorAll('.seg-follower').forEach(sel => {
            sel.onchange = () => {
                const segIdx = parseInt(sel.dataset.seg, 10);
                const assigns = segmentConfig.getAssignments();
                segmentConfig.setAssignment(segIdx, assigns[segIdx].lead, parseInt(sel.value, 10));
                if (onApply) onApply();
            };
        });
    }

    btnAdd.onclick = () => {
        // Find a sensible default value for new breakpoint
        const bps = segmentConfig.getBreakpoints();
        let newVal;
        if (bps.length === 0) {
            newVal = 2.0;
        } else {
            // Place between last breakpoint and RANGE_MAX
            const last = bps[bps.length - 1];
            newVal = Math.round((last + RANGE_MAX) / 2 * 2) / 2; // round to 0.5
            // If that would collide, try between first pair gap
            if (bps.some(b => Math.abs(b - newVal) < 0.1)) {
                newVal = last + 1.0;
            }
        }
        if (newVal > RANGE_MIN && newVal < RANGE_MAX) {
            segmentConfig.addBreakpoint(newVal);
            refresh();
            if (onApply) onApply();
        }
    };

    btnReset.onclick = () => {
        segmentConfig.reset();
        refresh();
        if (onApply) onApply();
    };

    btnClose.onclick = () => {
        overlay.classList.remove('open');
    };

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
    });

    return {
        open() {
            refresh();
            overlay.classList.add('open');
        },
    };
}
