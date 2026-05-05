import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEEDANCE_STORYBOARD_REFERENCE_PROMPT,
  getVideoPromptGuardrailPlan,
  inferExplicitPixelDimensionsFromText,
  inferNamedVideoResolutionShortSideFromText,
  planCliVideoBrain,
  planSeedanceStoryboardFallback,
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

test('runtime infers natural-language video dimensions and durations', () => {
  assert.deepEqual(inferExplicitPixelDimensionsFromText('make this 720p portrait'), {
    width: 720,
    height: 1280
  });
  assert.equal(inferNamedVideoResolutionShortSideFromText('make a 720p video'), 720);

  const plan = planCliVideoBrain({
    video: true,
    prompt: 'Make a 12 second 720p portrait video of ocean waves',
    width: 1920,
    height: 1088,
    duration: 5,
    cliSet: {}
  });
  assert.equal(plan.duration, 12);
  assert.equal(plan.width, 720);
  assert.equal(plan.height, 1280);
  assert.equal(plan.dimensionSource, 'exact');

  const aspectPlan = planCliVideoBrain({
    video: true,
    prompt: 'Make a 720p 9:16 video of ocean waves',
    width: 1920,
    height: 1088,
    cliSet: {}
  });
  assert.equal(aspectPlan.targetResolution, 720);
  assert.equal(aspectPlan.aspectRatio, '9:16');
});

test('runtime extracts literal video prompts', () => {
  assert.deepEqual(
    planCliVideoBrain({
      video: true,
      prompt: 'Use this prompt exactly: A cat says hello',
      cliSet: {}
    }),
    {
      prompt: 'A cat says hello',
      literalPrompt: true,
      warnings: []
    }
  );
});

test('runtime plans Seedance storyboard fallback for a single uploaded image', () => {
  assert.deepEqual(planSeedanceStoryboardFallback({
    userIntentText: 'I am uploading a storyboard. Turn it into a 9 second video.',
    uploadedImageCount: 1,
    defaultDurationSeconds: 5
  }), {
    prompt: SEEDANCE_STORYBOARD_REFERENCE_PROMPT,
    duration: 9,
    referenceImageIndices: [-1],
    skipPromptProcessing: true,
    expandPrompt: false,
    reason: 'text_mentions_storyboard'
  });

  const plan = planCliVideoBrain({
    video: true,
    prompt: 'I am uploading a storyboard. Turn it into a 9 second video.',
    refImage: 'storyboard.png',
    width: 1920,
    height: 1088,
    duration: 5,
    cliSet: {}
  });
  assert.equal(plan.model, 'seedance-2-0');
  assert.equal(plan.workflow, 't2v');
  assert.equal(plan.prompt, SEEDANCE_STORYBOARD_REFERENCE_PROMPT);
  assert.equal(plan.duration, 9);
  assert.equal(plan.storyboard.reason, 'text_mentions_storyboard');
});

test('runtime does not collapse storyboard image-stage or overlong video requests into fallback', () => {
  assert.equal(planSeedanceStoryboardFallback({
    userIntentText: 'Develop a 15s Seedance video storyboard sequence first, production ready with timing labels.',
    uploadedImageCount: 1,
    storyboardDetected: true
  }), null);

  assert.equal(planSeedanceStoryboardFallback({
    userIntentText: 'Generate a 45s Seedance video using this storyboard',
    uploadedImageCount: 1,
    storyboardDurationSeconds: 12,
    maxDurationSeconds: 15
  }), null);
});
