import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VIEWPORTS } from './index.js';

test('DEFAULT_VIEWPORTS covers 360px through 1440px', () => {
  const widths = DEFAULT_VIEWPORTS.map((v) => v.width);
  assert.deepEqual(widths, [360, 375, 390, 412, 1440]);
});
