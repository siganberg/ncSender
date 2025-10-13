import test from 'node:test';
import assert from 'node:assert/strict';

import { generateProbeCode, validateProbeOptions } from '../probing-utils.js';

const baseOptions = {
  probeType: '3d-probe',
  probingAxis: 'XY',
  selectedCorner: 'TopLeft',
  toolDiameter: 6
};

test('validateProbeOptions normalises numeric fields and corners', () => {
  const { options, errors } = validateProbeOptions({
    ...baseOptions,
    toolDiameter: '6.5'
  });

  assert.equal(errors.length, 0);
  assert.equal(options.toolDiameter, 6.5);
  assert.equal(options.selectedCorner, 'TopLeft');
});

test('validateProbeOptions rejects invalid axis', () => {
  const { errors } = validateProbeOptions({
    probeType: '3d-probe',
    probingAxis: 'INVALID'
  });

  assert.ok(errors.length > 0);
});

test('validateProbeOptions enforces side selection for X axis', () => {
  const { errors } = validateProbeOptions({
    probeType: 'standard-block',
    probingAxis: 'X'
  });

  assert.ok(errors.some((message) => message.includes('selectedSide')));
});

test('generateProbeCode produces commands for valid input', () => {
  const { options, errors } = validateProbeOptions(baseOptions);
  assert.equal(errors.length, 0);

  const commands = generateProbeCode(options);
  assert.ok(Array.isArray(commands));
  assert.ok(commands.length > 0);
});

test('validateProbeOptions blocks invalid bit diameter', () => {
  const { errors } = validateProbeOptions({
    probeType: 'autozero-touch',
    probingAxis: 'Z',
    selectedBitDiameter: 'NaN'
  });

  assert.ok(errors.some((message) => message.includes('Bit diameter')));
});
