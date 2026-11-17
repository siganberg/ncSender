import { test } from 'node:test';
import assert from 'node:assert/strict';
import GCodeVisualizer from '../src/features/toolpath/visualizer/gcode-visualizer.js';

// QuickCut peck-drill pattern (inch), trimmed to two holes. The job starts with
// another tool loaded and M6 T19 swaps in a longer drill mid-job.
const DRILL_PATTERN = `G20 ; Imperial units
G17 ; XY plane selection
G90 ; Absolute positioning
G94 ; Feed rate per minute

G53 G0 Z-0.197 ; Move to safe Z
M6 T19 ; Tool change
G20 G90 ; Units and absolute again after it
G53 G0 Z-0.197 ; Move to safe Z

M3 S18000 ; Start spindle
(Hole 1/12 at X6.000 Y0.000)
G0 X6.00000 Y0.00000
G0 Z0.197
G0 Z0.079
G1 Z-0.197 F16
G0 Z-0.177 ; Break chip
G1 Z-0.394 F16
G0 Z0.197
(Hole 2/12 at X5.196 Y3.000)
G0 X5.19615 Y3.00000
G0 Z0.197
G0 Z0.079
G1 Z-0.197 F16
G0 Z-0.177 ; Break chip
G1 Z-0.394 F16
G0 Z0.197

G53 G0 Z-0.197 ; Return to safe Z
M5 ; Stop spindle
M30 ; Program end
`;

const G54_Z = -45.908;
const T4_TLO = -58.58;
const T19_TLO = -37.351;
const GRID = { minX: 0, maxX: 800, minY: 0, maxY: 800, minZ: -150, maxZ: 0 };

const wco = (tlo) => ({ x: 400, y: 400, z: G54_Z + tlo });

async function renderThenChangeTool(gcode, fromTlo, toTlo) {
    const viz = new GCodeVisualizer();
    viz.setSafeZHeight(-5);
    viz.setWCO(wco(fromTlo));
    viz.setGridBounds(GRID);
    viz.render(gcode);
    assert.equal(viz.hasOutOfBoundsMovement(), false, 'in bounds at load');
    viz.updateWCO(wco(toTlo));
    await new Promise((resolve) => setTimeout(resolve, 80));
    return viz;
}

test('mid-job tool change does not lift the M6 safe-Z rapid above machine zero', async () => {
    const viz = await renderThenChangeTool(DRILL_PATTERN, T4_TLO, T19_TLO);
    assert.equal(viz.hasOutOfBoundsMovement(), false);
    assert.deepEqual(viz.getOutOfBoundsDirections(), []);
});

test('program Z moves still follow the new tool length offset', async () => {
    const viz = await renderThenChangeTool(DRILL_PATTERN, T4_TLO, T4_TLO + 110);
    assert.equal(viz.hasOutOfBoundsMovement(), true);
    assert.deepEqual(viz.getOutOfBoundsDirections(), ['Z+']);
});

test('XY move after a program Z word is not treated as machine safe Z', async () => {
    const gcode = 'G21 G90\nM6 T1\nG0 Z10\nG0 X50 Y50\n';
    const viz = await renderThenChangeTool(gcode, T4_TLO, T4_TLO + 100);
    assert.deepEqual(viz.getOutOfBoundsDirections(), ['Z+']);
});
