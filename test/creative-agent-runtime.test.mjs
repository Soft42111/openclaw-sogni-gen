import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getVideoPromptGuardrailPlan,
  resolveVideoModelAlias,
  sanitizeBatchPrompt,
  selectDefaultVideoModel
} from '../generated/creative-agent-runtime.mjs';

test('runtime resolves public video model aliases by workflow', () => {
  assert.equal(resolveVideoModelAlias('seedance2', 'v2v'), 'seedance-2-0');
  assert.equal(resolveVideoModelAlias('ltx23', 'ia2v'), 'ltx23-22b-fp8_ia2v_distilled');
});

test('runtime batch prompt sanitizer preserves dynamic groups and aspect ratios', () => {
  const result = sanitizeBatchPrompt(
    'a {red|blue} robot, 4 different versions in a grid, 16:9 aspect ratio'
  );
  assert.match(result, /\{red\|blue\}/);
  assert.match(result, /16:9/);
  assert.doesNotMatch(result, /\bgrid\b/i);
  assert.doesNotMatch(result, /\bversions?\b/i);
});

test('runtime guardrail plan extends implicit duration for quoted dialogue', () => {
  const dialogue = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
  const plan = getVideoPromptGuardrailPlan({
    prompt: `a host says "${dialogue}" to camera`,
    duration: 4,
    fps: 24
  });

  assert.equal(plan.duration, 10);
  assert.deepEqual(plan.warnings.map((warning) => warning.type), ['duration-extended-for-dialogue']);
});

test('runtime default model selection keeps native audio prompts on LTX', () => {
  assert.equal(
    selectDefaultVideoModel('i2v', { prompt: 'a host says "hello there"', quality: null }, {}),
    'ltx23-22b-fp8_i2v_distilled'
  );
});
