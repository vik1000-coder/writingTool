import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, shouldTrigger, validateMode } from '../src/core/modes';
test('presets separate lens from intervention; GUIDE is intent, never file mutation', () => {
  assert.equal(MODES.guide.lens, 'argument');
  assert.equal(MODES.guide.intervention, 2);
  assert.equal(MODES.write.intervention, 3);
  assert.throws(() => validateMode('bogus'));
});
test('OFF, explicit-only visual/structure, opt-in automatic and punctuation policies', () => {
  assert.equal(shouldTrigger('off', 'explicit', 'Done.'), false);
  assert.equal(shouldTrigger('guide', 'automatic', 'Done.', false), false);
  assert.equal(shouldTrigger('guide', 'automatic', 'Done.', true), true);
  assert.equal(shouldTrigger('guide', 'automatic', 'In progress', true), false);
  assert.equal(shouldTrigger('evidence', 'automatic', 'Done.\n\n', true), true);
  assert.equal(shouldTrigger('visual', 'automatic', 'Done.', true), false);
  assert.equal(shouldTrigger('structure', 'explicit', ''), true);
});
