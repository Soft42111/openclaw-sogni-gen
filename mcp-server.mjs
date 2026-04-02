#!/usr/bin/env node
/**
 * sogni-gen MCP Server
 *
 * Exposes Sogni AI image/video generation as MCP tools for Claude Code
 * and Claude Desktop.  Wraps the sogni-gen CLI using its --json mode.
 *
 * Install (Claude Code):
 *   claude mcp add sogni -- npx -y -p sogni-gen sogni-gen-mcp
 *
 * Install (Claude Desktop – add to claude_desktop_config.json):
 *   { "mcpServers": { "sogni": { "command": "npx", "args": ["-y", "-p", "sogni-gen", "sogni-gen-mcp"] } } }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execaNode } from 'execa';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { getEnv, hasEnv } from './env.mjs';
import { PACKAGE_VERSION } from './version.mjs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOGNI_GEN = join(__dirname, 'sogni-gen.mjs');
const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.config', 'sogni', 'credentials');
const DEFAULT_DOWNLOADS_DIR = join(homedir(), 'Downloads', 'sogni');
const CREDENTIALS_PATH = getEnv('SOGNI_CREDENTIALS_PATH', { trim: true }) || DEFAULT_CREDENTIALS_PATH;
const DOWNLOADS_DIR = getEnv('SOGNI_DOWNLOADS_DIR', { trim: true }) || DEFAULT_DOWNLOADS_DIR;
const MCP_SAVE_DOWNLOADS = getEnv('SOGNI_MCP_SAVE_DOWNLOADS') !== '0';
const SERVER_VERSION = PACKAGE_VERSION;
const DEFAULT_ALLOWED_DOWNLOAD_HOST_SUFFIXES = ['sogni.ai'];
const ALLOWED_DOWNLOAD_HOST_SUFFIXES = (
  getEnv('SOGNI_ALLOWED_DOWNLOAD_HOSTS', { trim: true }) || ''
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

function isTrustedDownloadUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    const allowed = ALLOWED_DOWNLOAD_HOST_SUFFIXES.length > 0
      ? ALLOWED_DOWNLOAD_HOST_SUFFIXES
      : DEFAULT_ALLOWED_DOWNLOAD_HOST_SUFFIXES;
    return allowed.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Input sanitization — validate MCP tool inputs before passing to CLI
// ---------------------------------------------------------------------------

/**
 * Reject null bytes and control characters in a string value.
 * Throws on invalid input; returns the string unchanged when valid.
 */
function sanitizeString(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`${label || 'Value'} must be a string.`);
  }
  if (value.includes('\0')) {
    throw new Error(`${label || 'Value'} contains a null byte.`);
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new Error(`${label || 'Value'} contains invalid control characters.`);
  }
  return value;
}

/**
 * Validate a string is one of the allowed values (case-sensitive).
 */
function validateEnum(value, allowed, label) {
  sanitizeString(value, label);
  if (!allowed.includes(value)) {
    throw new Error(`${label || 'Value'} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// CLI spawning helper
// ---------------------------------------------------------------------------

/**
 * Spawn `node sogni-gen.mjs --json ...args`, collect stdout, parse JSON.
 * Returns the parsed object on success or throws on failure.
 */
function runSogniGen(args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    execaNode(SOGNI_GEN, ['--json', '--quiet', ...args], {
      timeout: timeoutMs,
      reject: false,
    }).then(({ stdout, stderr, exitCode, timedOut }) => {
      const trimmedStdout = (stdout || '').trim();
      const trimmedStderr = (stderr || '').trim();

      if (!trimmedStdout) {
        if (timedOut) {
          reject(new Error(`sogni-gen timed out after ${timeoutMs}ms`));
          return;
        }
        reject(new Error(trimmedStderr || `sogni-gen exited with code ${exitCode} and no output`));
        return;
      }

      try {
        const result = JSON.parse(trimmedStdout);
        resolve(result);
      } catch {
        reject(new Error(`Failed to parse sogni-gen output: ${trimmedStdout.slice(0, 500)}`));
      }
    }).catch((err) => {
      reject(new Error(`Failed to execute sogni-gen: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Credential check helper
// ---------------------------------------------------------------------------

function checkCredentials() {
  if (existsSync(CREDENTIALS_PATH)) {
    try {
      const raw = readFileSync(CREDENTIALS_PATH, 'utf8');
      if (raw.includes('SOGNI_API_KEY=')) return null;
      if (raw.includes('SOGNI_USERNAME=') && raw.includes('SOGNI_PASSWORD=')) return null;
    } catch {
      // Fall through to env-based checks and error message.
    }
  }
  if (hasEnv('SOGNI_API_KEY')) return null;
  if (hasEnv('SOGNI_USERNAME') && hasEnv('SOGNI_PASSWORD')) return null;
  return {
    content: [
      {
        type: 'text',
        text: [
          'Sogni credentials not found. Please set up credentials:',
          '',
          '1. Create a Sogni account at https://app.sogni.ai/',
          '2. Create the credentials file:',
          '',
          '   mkdir -p ~/.config/sogni',
          '   cat > ~/.config/sogni/credentials << \'EOF\'',
          '   SOGNI_API_KEY=your_api_key',
          '   # or use username/password instead:',
          '   # SOGNI_USERNAME=your_username',
          '   # SOGNI_PASSWORD=your_password',
          '   EOF',
          '   chmod 600 ~/.config/sogni/credentials',
          '',
          'Or set SOGNI_API_KEY, or SOGNI_USERNAME and SOGNI_PASSWORD, as environment variables.',
          'Optional: set SOGNI_CREDENTIALS_PATH to use a different credentials file path.',
        ].join('\n'),
      },
    ],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

async function formatSuccess(result) {
  const parts = [];

  if (result.type === 'balance') {
    parts.push(`SPARK: ${result.spark ?? 'N/A'}`);
    parts.push(`SOGNI: ${result.sogni ?? 'N/A'}`);
    return { content: [{ type: 'text', text: parts.join('\n') }] };
  }

  // Image / video result
  if (result.prompt) parts.push(`Prompt: ${result.prompt}`);
  parts.push(`Model: ${result.model}`);
  parts.push(`Size: ${result.width}x${result.height}`);
  if (result.seed != null) parts.push(`Seed: ${result.seed}`);

  if (result.type === 'video') {
    if (result.workflow) parts.push(`Workflow: ${result.workflow}`);
    if (result.duration) parts.push(`Duration: ${result.duration}s`);
    if (result.fps) parts.push(`FPS: ${result.fps}`);
  }

  if (result.localPath) parts.push(`Saved to: ${result.localPath}`);

  // URLs
  const urls = result.urls || [];
  if (urls.length > 0) {
    parts.push('');
    urls.forEach((url, i) => {
      parts.push(urls.length === 1 ? `URL: ${url}` : `URL #${i + 1}: ${url}`);
    });
  }

  const content = [{ type: 'text', text: parts.join('\n') }];

  // Download images/videos and save locally + embed as base64 for MCP clients
  // that support inline image rendering (e.g. Claude Desktop).
  // For Claude Code (terminal), the saved file path is the primary way to view results.
  const savedPaths = [];
  for (const url of urls) {
    const isImage = /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(url);
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url);

    if (!isImage && !isVideo) continue;
    if (!isTrustedDownloadUrl(url)) {
      parts.push(`Skipped local download for untrusted host: ${url}`);
      continue;
    }

    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());

      // Determine extension and build a temp file path
      const ext = isImage
        ? (url.match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1]?.toLowerCase() || 'png')
        : (url.match(/\.(mp4|webm|mov)/i)?.[1]?.toLowerCase() || 'mp4');

      // Save to local disk (default: ~/Downloads/sogni) so terminal users can open files.
      if (MCP_SAVE_DOWNLOADS) {
        const { mkdirSync, writeFileSync } = await import('fs');
        mkdirSync(DOWNLOADS_DIR, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `sogni-${timestamp}-${savedPaths.length}.${ext}`;
        const filePath = join(DOWNLOADS_DIR, filename);
        writeFileSync(filePath, buf);
        savedPaths.push(filePath);
      }

      // For images, also embed as base64 (Claude Desktop can render these)
      if (isImage) {
        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp'
          : ext === 'gif' ? 'image/gif'
          : 'image/png';
        content.push({ type: 'image', data: buf.toString('base64'), mimeType });
      }
    } catch {
      // If download fails, skip — the URL is still in the text above
    }
  }

  // Append saved file paths to the text output so Claude Code users can see/open them
  if (savedPaths.length > 0) {
    const textBlock = content[0];
    textBlock.text += '\n\n' + savedPaths.map((p, i) =>
      savedPaths.length === 1 ? `📁 Saved: ${p}` : `📁 Saved #${i + 1}: ${p}`
    ).join('\n');
    textBlock.text += '\n\nTip: In Claude Code, ask Claude to run `open <path>` to view the file.';
  }

  return { content };
}

function formatError(result) {
  const parts = [`Error: ${result.error}`];
  if (result.errorCode) parts.push(`Code: ${result.errorCode}`);
  if (result.hint) parts.push(`Hint: ${result.hint}`);
  return { content: [{ type: 'text', text: parts.join('\n') }], isError: true };
}

async function formatResult(result) {
  if (result.success === false) return formatError(result);
  return formatSuccess(result);
}

async function runAndFormat(args, { timeoutMs = 30_000, requireCredentials = true } = {}) {
  if (requireCredentials) {
    const credErr = checkCredentials();
    if (credErr) return credErr;
  }
  const result = await runSogniGen(args, { timeoutMs });
  return formatResult(result);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const IMAGE_MODEL_TABLE = `Image Models:
  z_image_turbo_bf16         — Fast (~5-10s), general purpose (default)
  flux1-schnell-fp8          — Very fast (~3-5s), quick iterations
  flux2_dev_fp8              — Slow (~2min), high quality
  chroma-v.46-flash_fp8      — Medium (~30s), balanced
  qwen_image_edit_2511_fp8   — Medium (~30s), image editing with context
  qwen_image_edit_2511_fp8_lightning — Fast (~8s), quick image editing`;

const VIDEO_MODEL_TABLE = `WAN 2.2 Video Models (auto-selected per workflow):
  wan_v2.2-14b-fp8_t2v_lightx2v             — Text-to-video (~5min)
  wan_v2.2-14b-fp8_i2v_lightx2v             — Image-to-video (~3-5min)
  wan_v2.2-14b-fp8_s2v_lightx2v             — Sound-to-video (~5min)
  wan_v2.2-14b-fp8_animate-move_lightx2v    — Animate-move (~5min)
  wan_v2.2-14b-fp8_animate-replace_lightx2v — Animate-replace (~5min)

LTX-2 / LTX-2.3 Video Models:
  ltx2-19b-fp8_t2v_distilled              — Text-to-video, fast 8-step (~2-3min)
  ltx2-19b-fp8_t2v                        — Text-to-video, quality 20-step (~5min)
  ltx2-19b-fp8_i2v_distilled              — Image-to-video, fast 8-step (~2-3min)
  ltx2-19b-fp8_i2v                        — Image-to-video, quality 20-step (~5min)
  ltx2-19b-fp8_ia2v_distilled             — Image+audio-to-video, fast 8-step (~2-3min)
  ltx2-19b-fp8_a2v_distilled              — Audio-to-video, fast 8-step (~2-3min)
  ltx2-19b-fp8_v2v_distilled              — Video-to-video with ControlNet (~3min)
  ltx2-19b-fp8_v2v                        — Video-to-video with ControlNet, quality (~5min)
  ltx23-22b-fp8_t2v_distilled             — Text-to-video, LTX-2.3 fast distilled (~2-3min)`;

const TOOLS = [
  {
    name: 'generate_image',
    description: `Generate an image using Sogni AI's decentralized GPU network.

Quality presets (recommended — auto-selects model, steps, and dimensions):
  fast — z_image_turbo_bf16, 8 steps, 512x512 (default, ~5-10s)
  hq   — z_image_turbo_bf16, default steps, 768x768 (~10-15s)
  pro  — flux2_dev_fp8, 40 steps, 1024x1024 (~2min, highest quality)

${IMAGE_MODEL_TABLE}

Prompt variations: Use {option1|option2|option3} syntax with count > 1 to generate diverse images in one call.
  Example: prompt="a {red|blue|green} car", count=3 → generates one of each color.

Cost: Uses Spark tokens. 512x512 is most cost-efficient. Claim 50 free daily Spark at https://app.sogni.ai/`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Image description / generation prompt. Supports {a|b|c} variation syntax with count > 1.',
        },
        quality: {
          type: 'string',
          enum: ['fast', 'hq', 'pro'],
          description: 'Quality preset (auto-selects model/steps/size). Overridden by explicit model param.',
        },
        model: {
          type: 'string',
          description: 'Model ID (default: z_image_turbo_bf16). Overrides quality preset.',
        },
        width: {
          type: 'number',
          description: 'Image width in pixels (default: 512)',
        },
        height: {
          type: 'number',
          description: 'Image height in pixels (default: 512)',
        },
        count: {
          type: 'number',
          description: 'Number of images to generate (default: 1)',
        },
        seed: {
          type: 'number',
          description: 'Specific seed for reproducibility',
        },
        output: {
          type: 'string',
          description: 'Save image to this file path',
        },
        output_format: {
          type: 'string',
          enum: ['png', 'jpg'],
          description: 'Output format (default: png)',
        },
        loras: {
          type: 'array',
          items: { type: 'string' },
          description: 'LoRA model IDs',
        },
        lora_strengths: {
          type: 'array',
          items: { type: 'number' },
          description: 'LoRA strengths (parallel to loras array)',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description: `Generate a video using Sogni AI's decentralized GPU network.

Workflows:
  t2v             — Text-to-video (default). Just provide a prompt.
  i2v             — Image-to-video. Provide ref (reference image). Supports looping.
  s2v             — Sound-to-video. Provide ref (face image) + ref_audio.
  ia2v            — Image+audio-to-video (LTX). Provide ref + ref_audio.
  a2v             — Audio-to-video (LTX). Provide ref_audio only.
  v2v             — Video-to-video (LTX). Provide ref_video + controlnet_name.
  animate-move    — Transfer motion from ref_video to ref image.
  animate-replace — Replace subject in ref_video with ref image.

${VIDEO_MODEL_TABLE}

WAN video dimensions: divisible by 16, min 480px, max 1536px. LTX family: divisible by 64, 768-1920px.
Generation takes 3-5 minutes. Cost: Uses Spark tokens. Claim 50 free daily Spark at https://app.sogni.ai/`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Video description / generation prompt',
        },
        workflow: {
          type: 'string',
          enum: ['t2v', 'i2v', 's2v', 'ia2v', 'a2v', 'v2v', 'animate-move', 'animate-replace'],
          description: 'Video workflow (default: t2v, auto-inferred from provided refs)',
        },
        model: {
          type: 'string',
          description: 'Model ID (auto-selected per workflow by default)',
        },
        width: {
          type: 'number',
          description: 'Video width in pixels (default: 512, must be divisible by 16)',
        },
        height: {
          type: 'number',
          description: 'Video height in pixels (default: 512, must be divisible by 16)',
        },
        fps: {
          type: 'number',
          description: 'Frames per second (default: 16)',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds (default: 5)',
        },
        frames: {
          type: 'number',
          description: 'Override total frame count (alternative to duration)',
        },
        ref: {
          type: 'string',
          description: 'Reference image path or URL (for i2v, s2v, animate workflows)',
        },
        ref_end: {
          type: 'string',
          description: 'End frame image path or URL (for i2v interpolation)',
        },
        ref_audio: {
          type: 'string',
          description: 'Reference audio file path (for s2v workflow)',
        },
        ref_video: {
          type: 'string',
          description: 'Reference video file path (for animate and v2v workflows)',
        },
        controlnet_name: {
          type: 'string',
          enum: ['canny', 'pose', 'depth', 'detailer'],
          description: 'ControlNet type for v2v workflow',
        },
        controlnet_strength: {
          type: 'number',
          description: 'ControlNet strength for v2v (0.0-1.0, default: 0.8)',
        },
        sam2_coordinates: {
          type: 'string',
          description: 'SAM2 click coordinates for animate-replace (x,y or x1,y1;x2,y2)',
        },
        trim_end_frame: {
          type: 'boolean',
          description: 'Trim last frame for seamless video stitching',
        },
        first_frame_strength: {
          type: 'number',
          description: 'Keyframe strength for start frame (0.0-1.0)',
        },
        last_frame_strength: {
          type: 'number',
          description: 'Keyframe strength for end frame (0.0-1.0)',
        },
        seed: {
          type: 'number',
          description: 'Specific seed for reproducibility',
        },
        output: {
          type: 'string',
          description: 'Save video to this file path',
        },
        looping: {
          type: 'boolean',
          description: 'Generate seamless loop (i2v only)',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'edit_image',
    description: `Edit or transform an existing image using Sogni AI (Qwen image editing models).

Provide 1-3 context images and a prompt describing the desired edit. Examples:
  - "make the background a beach"
  - "apply pop art style"
  - "remove the person on the left"
  - "add a rainbow in the sky"

Models:
  qwen_image_edit_2511_fp8_lightning — Fast (~8s), default
  qwen_image_edit_2511_fp8          — Medium (~30s), higher quality`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Editing instruction describing the desired change',
        },
        context_images: {
          type: 'array',
          items: { type: 'string' },
          description: 'Image file paths or URLs to edit (1-3 images)',
          minItems: 1,
          maxItems: 3,
        },
        model: {
          type: 'string',
          description: 'Model ID (default: qwen_image_edit_2511_fp8_lightning)',
        },
        width: {
          type: 'number',
          description: 'Output width in pixels',
        },
        height: {
          type: 'number',
          description: 'Output height in pixels',
        },
        output: {
          type: 'string',
          description: 'Save edited image to this file path',
        },
      },
      required: ['prompt', 'context_images'],
    },
  },
  {
    name: 'photobooth',
    description: `Generate stylized portraits from a face photo using InstantID face transfer.

Provide a face reference image and a style prompt. Examples:
  - "80s fashion portrait"
  - "LinkedIn professional headshot"
  - "oil painting Renaissance style"
  - "anime character"

Uses SDXL Turbo (coreml-sogniXLturbo_alpha1_ad) at 1024x1024 by default.
The face likeness is preserved while applying the style from the prompt.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Style/scene description for the portrait',
        },
        reference_face: {
          type: 'string',
          description: 'Face image file path or URL',
        },
        model: {
          type: 'string',
          description: 'Model ID (default: coreml-sogniXLturbo_alpha1_ad)',
        },
        cn_strength: {
          type: 'number',
          description: 'ControlNet strength — higher = more face likeness (default: 0.8)',
        },
        cn_guidance_end: {
          type: 'number',
          description: 'ControlNet guidance end point (default: 0.3)',
        },
        width: {
          type: 'number',
          description: 'Output width in pixels (default: 1024)',
        },
        height: {
          type: 'number',
          description: 'Output height in pixels (default: 1024)',
        },
        count: {
          type: 'number',
          description: 'Number of images to generate (default: 1)',
        },
        output: {
          type: 'string',
          description: 'Save image to this file path',
        },
      },
      required: ['prompt', 'reference_face'],
    },
  },
  {
    name: 'check_balance',
    description:
      'Check your current Sogni token balances (SPARK and SOGNI). Free daily Spark tokens can be claimed at https://app.sogni.ai/',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_models',
    description:
      'List all available Sogni AI models for image generation, image editing, photobooth, and video generation with speed estimates.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_version',
    description: 'Show the running sogni-gen version for this MCP server instance.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'extract_last_frame',
    description: 'Extract the last frame from a video file as an image. Safe ffmpeg wrapper with input sanitization.',
    inputSchema: {
      type: 'object',
      properties: {
        video_path: {
          type: 'string',
          description: 'Path to the source video file',
        },
        output_path: {
          type: 'string',
          description: 'Path to save the extracted frame image (e.g. /tmp/lastframe.png)',
        },
      },
      required: ['video_path', 'output_path'],
    },
  },
  {
    name: 'concat_videos',
    description: 'Concatenate multiple video clips into a single video file. Safe ffmpeg wrapper with input sanitization. Requires at least 2 clips.',
    inputSchema: {
      type: 'object',
      properties: {
        output_path: {
          type: 'string',
          description: 'Path for the concatenated output video',
        },
        clips: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of video clip file paths to concatenate (minimum 2)',
          minItems: 2,
        },
      },
      required: ['output_path', 'clips'],
    },
  },
  {
    name: 'list_media',
    description: 'List recent inbound media files (images, audio, or all) from the user media directory (~/.clawdbot/media/inbound/). Returns the 5 most recent files sorted by modification time.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['images', 'audio', 'all'],
          description: 'Type of media to list (default: images)',
        },
      },
    },
  },
  {
    name: 'refine_result',
    description: `Re-run the last generation with tweaked parameters. Reads the last render metadata and lets you override specific settings while keeping everything else the same.

Use this to:
  - Bump quality: refine_result with quality="pro" to re-render at higher quality
  - Try a different model: refine_result with model="flux2_dev_fp8"
  - Lock a seed: refine_result with seed=12345
  - Tweak the prompt: refine_result with prompt="..."
  - Change dimensions: refine_result with width=1024, height=1024

Requires a previous generation in this session (reads ~/.config/sogni/last-render.json).`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Override the prompt (default: reuse last prompt)',
        },
        quality: {
          type: 'string',
          enum: ['fast', 'hq', 'pro'],
          description: 'Quality preset override',
        },
        model: {
          type: 'string',
          description: 'Model override',
        },
        width: {
          type: 'number',
          description: 'Width override',
        },
        height: {
          type: 'number',
          description: 'Height override',
        },
        seed: {
          type: 'number',
          description: 'Seed override (use to lock the composition)',
        },
        count: {
          type: 'number',
          description: 'Number of images override',
        },
      },
    },
  },
  {
    name: 'estimate_cost',
    description: `Estimate the cost of a generation before running it. Returns estimated cost in SPARK and SOGNI tokens.

For video: requires model, width, height, fps, steps, and duration/frames.
For images: returns a rough cost based on model and dimensions.

Use this before expensive generations (pro quality, large videos) to check if the user has enough tokens.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['image', 'video'],
          description: 'Generation type (default: image)',
        },
        model: {
          type: 'string',
          description: 'Model ID',
        },
        width: {
          type: 'number',
          description: 'Width in pixels',
        },
        height: {
          type: 'number',
          description: 'Height in pixels',
        },
        steps: {
          type: 'number',
          description: 'Number of steps (required for video cost estimation)',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds (video only)',
        },
        fps: {
          type: 'number',
          description: 'Frames per second (video only, default: 16)',
        },
        count: {
          type: 'number',
          description: 'Number of outputs (default: 1)',
        },
      },
    },
  },
  {
    name: 'manage_memory',
    description: `Manage persistent user preferences that are respected across sessions. Memories are stored locally on the user's machine at ~/.config/sogni/memories.json.

Use this to remember and recall user preferences like preferred style, aspect ratio, favorite artists, or any other context that should persist.

Actions:
  read   — List all saved memories (or get one by key)
  write  — Save or update a memory (upsert by key)
  delete — Remove a memory by key

Always check memories before generating to respect saved preferences.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'write', 'delete'],
          description: 'CRUD action',
        },
        key: {
          type: 'string',
          description: 'Memory key (required for write/delete, optional for read to get one specific memory)',
        },
        value: {
          type: 'string',
          description: 'Memory value (required for write)',
        },
        category: {
          type: 'string',
          enum: ['preference', 'fact', 'context'],
          description: 'Memory category (default: preference)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_personality',
    description: `Manage custom personality instructions that shape how the agent behaves. Stored at ~/.config/sogni/personality.txt.

Actions:
  get   — Read current personality instructions
  set   — Save new personality instructions
  clear — Reset to default personality

Example personalities: "Be concise, skip small talk", "Always suggest cinematic lighting", "Use a warm and encouraging tone"`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set', 'clear'],
          description: 'Action to perform',
        },
        text: {
          type: 'string',
          description: 'Personality instructions (required for set)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_personas',
    description: `Manage named personas — people with saved reference photos and optional voice clips for identity-preserving generation. Stored at ~/.config/sogni/personas/.

Actions:
  list    — List all saved personas
  add     — Add a new persona with a reference photo
  remove  — Remove a persona and its files
  resolve — Look up a persona by name, tag, or relationship pronoun ("me", "my wife", etc.)

Personas enable identity-preserving generation: "generate me as a superhero" works because the agent knows who "me" is and has their reference photo.

For video with voice cloning, provide a voice_clip_path when adding the persona.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'add', 'remove', 'resolve'],
          description: 'CRUD action',
        },
        name: {
          type: 'string',
          description: 'Persona name (required for add/remove/resolve)',
        },
        photo_path: {
          type: 'string',
          description: 'Path to reference photo (required for add)',
        },
        relationship: {
          type: 'string',
          enum: ['self', 'partner', 'child', 'friend', 'pet'],
          description: 'Relationship to user (default: friend). "self" enables "me"/"myself" pronoun matching.',
        },
        description: {
          type: 'string',
          description: 'Appearance description for prompt engineering',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nicknames or aliases for matching',
        },
        voice: {
          type: 'string',
          description: 'Voice description (accent, tone, pitch) for prompt engineering',
        },
        voice_clip_path: {
          type: 'string',
          description: 'Path to voice clip audio file for LTX-2.3 voice cloning',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'apply_style',
    description: `Apply an artistic style to an image. Wraps image editing with style-specific prompt engineering.

Reference artists and styles BY NAME for best results:
  - "Andy Warhol pop art"
  - "Studio Ghibli watercolor"
  - "Banksy street art"
  - "oil painting in the style of Vermeer"
  - "cyberpunk neon aesthetic"

For photos with people, the prompt should include "Preserve all facial features, expressions, and identity."`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Style description (reference artists BY NAME for best results)',
        },
        source_image: {
          type: 'string',
          description: 'Path to image to stylize',
        },
        model: {
          type: 'string',
          description: 'Model override (default: qwen_image_edit_2511_fp8_lightning)',
        },
        width: {
          type: 'number',
          description: 'Output width',
        },
        height: {
          type: 'number',
          description: 'Output height',
        },
      },
      required: ['prompt', 'source_image'],
    },
  },
  {
    name: 'change_angle',
    description: `Generate a photo from a different camera angle using Qwen + Multiple Angles LoRA.

Azimuth options: front, front-right, right, back-right, back, back-left, left, front-left
Elevation options: low-angle, eye-level, elevated, high-angle
Distance options: close-up, medium, wide

Maps common user terms:
  "from the left" → left
  "looking up at" → low-angle
  "3/4 view" → front-right
  "portrait" → front-right eye-level medium`,
    inputSchema: {
      type: 'object',
      properties: {
        source_image: {
          type: 'string',
          description: 'Path to source image',
        },
        azimuth: {
          type: 'string',
          enum: ['front', 'front-right', 'right', 'back-right', 'back', 'back-left', 'left', 'front-left'],
          description: 'Horizontal camera angle (default: front-right)',
        },
        elevation: {
          type: 'string',
          enum: ['low-angle', 'eye-level', 'elevated', 'high-angle'],
          description: 'Vertical camera angle (default: eye-level)',
        },
        distance: {
          type: 'string',
          enum: ['close-up', 'medium', 'wide'],
          description: 'Camera distance (default: medium)',
        },
        prompt: {
          type: 'string',
          description: 'Subject description (optional, helps preserve identity)',
        },
        lora_strength: {
          type: 'number',
          description: 'LoRA strength 0.1-1.0 (default: 0.9, lower preserves more original appearance)',
        },
      },
      required: ['source_image'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleGenerateImage(params) {
  sanitizeString(params.prompt, 'prompt');
  const args = [];
  if (params.quality) args.push('--quality', validateEnum(params.quality, ['fast', 'hq', 'pro'], 'quality'));
  if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
  if (params.width) args.push('-w', String(params.width));
  if (params.height) args.push('-h', String(params.height));
  if (params.count) args.push('-n', String(params.count));
  if (params.seed != null) args.push('-s', String(params.seed));
  if (params.output) args.push('-o', sanitizeString(params.output, 'output'));
  if (params.output_format) args.push('--output-format', validateEnum(params.output_format, ['png', 'jpg'], 'output_format'));
  if (params.loras?.length) {
    params.loras.forEach((l, i) => sanitizeString(l, `loras[${i}]`));
    args.push('--loras', params.loras.join(','));
  }
  if (params.lora_strengths?.length) args.push('--lora-strengths', params.lora_strengths.join(','));
  args.push('--', params.prompt);

  return runAndFormat(args, { timeoutMs: 60_000 });
}

async function handleGenerateVideo(params) {
  sanitizeString(params.prompt, 'prompt');
  const args = ['--video'];
  if (params.workflow) args.push('--workflow', validateEnum(params.workflow, ['t2v', 'i2v', 's2v', 'ia2v', 'a2v', 'v2v', 'animate-move', 'animate-replace'], 'workflow'));
  if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
  if (params.width) args.push('-w', String(params.width));
  if (params.height) args.push('-h', String(params.height));
  if (params.fps) args.push('--fps', String(params.fps));
  if (params.duration) args.push('--duration', String(params.duration));
  if (params.frames) args.push('--frames', String(params.frames));
  if (params.ref) args.push('--ref', sanitizeString(params.ref, 'ref'));
  if (params.ref_end) args.push('--ref-end', sanitizeString(params.ref_end, 'ref_end'));
  if (params.ref_audio) args.push('--ref-audio', sanitizeString(params.ref_audio, 'ref_audio'));
  if (params.ref_video) args.push('--ref-video', sanitizeString(params.ref_video, 'ref_video'));
  if (params.controlnet_name) args.push('--controlnet-name', validateEnum(params.controlnet_name, ['canny', 'pose', 'depth', 'detailer'], 'controlnet_name'));
  if (params.controlnet_strength != null) args.push('--controlnet-strength', String(params.controlnet_strength));
  if (params.sam2_coordinates) args.push('--sam2-coordinates', sanitizeString(params.sam2_coordinates, 'sam2_coordinates'));
  if (params.trim_end_frame) args.push('--trim-end-frame');
  if (params.first_frame_strength != null) args.push('--first-frame-strength', String(params.first_frame_strength));
  if (params.last_frame_strength != null) args.push('--last-frame-strength', String(params.last_frame_strength));
  if (params.seed != null) args.push('-s', String(params.seed));
  if (params.output) args.push('-o', sanitizeString(params.output, 'output'));
  if (params.looping) args.push('--looping');
  args.push('--', params.prompt);

  return runAndFormat(args, { timeoutMs: 600_000 });
}

async function handleEditImage(params) {
  sanitizeString(params.prompt, 'prompt');
  const args = [];
  for (const img of params.context_images) {
    args.push('-c', sanitizeString(img, 'context_images'));
  }
  if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
  if (params.width) args.push('-w', String(params.width));
  if (params.height) args.push('-h', String(params.height));
  if (params.output) args.push('-o', sanitizeString(params.output, 'output'));
  args.push('--', params.prompt);

  return runAndFormat(args, { timeoutMs: 60_000 });
}

async function handlePhotobooth(params) {
  sanitizeString(params.prompt, 'prompt');
  sanitizeString(params.reference_face, 'reference_face');
  const args = ['--photobooth', '--ref', params.reference_face];
  if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
  if (params.cn_strength != null) args.push('--cn-strength', String(params.cn_strength));
  if (params.cn_guidance_end != null) args.push('--cn-guidance-end', String(params.cn_guidance_end));
  if (params.width) args.push('-w', String(params.width));
  if (params.height) args.push('-h', String(params.height));
  if (params.count) args.push('-n', String(params.count));
  if (params.output) args.push('-o', sanitizeString(params.output, 'output'));
  args.push('--', params.prompt);

  return runAndFormat(args, { timeoutMs: 60_000 });
}

async function handleCheckBalance() {
  return runAndFormat(['--balance'], { timeoutMs: 30_000 });
}

async function handleGetVersion() {
  const result = await runSogniGen(['--version'], { timeoutMs: 5_000 });
  if (result.success === false) return formatError(result);
  return {
    content: [{
      type: 'text',
      text: `mcp-server version: ${SERVER_VERSION}\nsogni-gen version: ${result.version || 'unknown'}`,
    }],
  };
}

function handleListModels() {
  const text = `${IMAGE_MODEL_TABLE}

Photobooth Model:
  coreml-sogniXLturbo_alpha1_ad — Fast, face transfer (SDXL Turbo, default for --photobooth)

${VIDEO_MODEL_TABLE}

Defaults:
  Image generation: z_image_turbo_bf16
  Image editing:    qwen_image_edit_2511_fp8_lightning
  Photobooth:       coreml-sogniXLturbo_alpha1_ad
  Video:            auto-selected per workflow (t2v/i2v/s2v/ia2v/a2v/v2v/animate-move/animate-replace)`;

  return { content: [{ type: 'text', text }] };
}

async function handleExtractLastFrame(params) {
  const videoPath = sanitizeString(params.video_path, 'video_path');
  const outputPath = sanitizeString(params.output_path, 'output_path');
  const result = await runSogniGen(['--extract-last-frame', videoPath, outputPath], { timeoutMs: 30_000 });
  if (result.success === false) return formatError(result);
  return { content: [{ type: 'text', text: `Extracted last frame to: ${result.outputPath || outputPath}` }] };
}

async function handleConcatVideos(params) {
  const outputPath = sanitizeString(params.output_path, 'output_path');
  if (!params.clips || params.clips.length < 2) {
    return { content: [{ type: 'text', text: 'Error: At least 2 clips are required.' }], isError: true };
  }
  const clips = params.clips.map((c, i) => sanitizeString(c, `clips[${i}]`));
  const result = await runSogniGen(['--concat-videos', outputPath, ...clips], { timeoutMs: 60_000 });
  if (result.success === false) return formatError(result);
  return { content: [{ type: 'text', text: `Concatenated ${result.clipCount || clips.length} clips to: ${result.outputPath || outputPath}` }] };
}

async function handleListMedia(params) {
  const args = ['--list-media'];
  if (params.type) {
    args.push(validateEnum(params.type, ['images', 'audio', 'all'], 'type'));
  }
  const result = await runSogniGen(args, { timeoutMs: 10_000 });
  if (result.success === false) return formatError(result);
  const files = result.files || [];
  if (files.length === 0) {
    return { content: [{ type: 'text', text: `No ${result.mediaType || 'media'} files found.` }] };
  }
  const lines = files.map(f => `${f.name}  (${f.size} bytes, ${f.modified})\n  ${f.path}`);
  return { content: [{ type: 'text', text: `Recent ${result.mediaType || 'media'} (${files.length}):\n${lines.join('\n')}` }] };
}

async function handleRefineResult(params) {
  const lastRenderPath = join(homedir(), '.config', 'sogni', 'last-render.json');
  if (!existsSync(lastRenderPath)) {
    return {
      content: [{ type: 'text', text: 'Error: No previous render found. Generate something first, then use refine_result to tweak it.' }],
      isError: true,
    };
  }

  let lastRender;
  try {
    lastRender = JSON.parse(readFileSync(lastRenderPath, 'utf8'));
  } catch {
    return {
      content: [{ type: 'text', text: 'Error: Could not read last render metadata.' }],
      isError: true,
    };
  }

  const isVideo = lastRender.type === 'video';

  if (isVideo) {
    // Re-run as video
    const prompt = params.prompt ? sanitizeString(params.prompt, 'prompt') : lastRender.prompt;
    const args = ['--video'];
    if (lastRender.workflow) args.push('--workflow', lastRender.workflow);
    if (params.quality) args.push('--quality', validateEnum(params.quality, ['fast', 'hq', 'pro'], 'quality'));
    if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
    else if (lastRender.model) args.push('-m', lastRender.model);
    if (params.width) args.push('-w', String(params.width));
    else if (lastRender.width) args.push('-w', String(lastRender.width));
    if (params.height) args.push('-h', String(params.height));
    else if (lastRender.height) args.push('-h', String(lastRender.height));
    if (params.seed != null) args.push('-s', String(params.seed));
    else if (lastRender.seed != null) args.push('-s', String(lastRender.seed));
    if (lastRender.fps) args.push('--fps', String(lastRender.fps));
    if (lastRender.duration) args.push('--duration', String(lastRender.duration));
    if (lastRender.refImage) args.push('--ref', lastRender.refImage);
    if (lastRender.refAudio) args.push('--ref-audio', lastRender.refAudio);
    if (lastRender.refVideo) args.push('--ref-video', lastRender.refVideo);
    args.push('--', prompt);
    return runAndFormat(args, { timeoutMs: 600_000 });
  } else {
    // Re-run as image
    const prompt = params.prompt ? sanitizeString(params.prompt, 'prompt') : lastRender.prompt;
    const args = [];
    if (params.quality) args.push('--quality', validateEnum(params.quality, ['fast', 'hq', 'pro'], 'quality'));
    if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
    else if (lastRender.model) args.push('-m', lastRender.model);
    if (params.width) args.push('-w', String(params.width));
    else if (lastRender.width) args.push('-w', String(lastRender.width));
    if (params.height) args.push('-h', String(params.height));
    else if (lastRender.height) args.push('-h', String(lastRender.height));
    if (params.count) args.push('-n', String(params.count));
    else if (lastRender.count) args.push('-n', String(lastRender.count));
    if (params.seed != null) args.push('-s', String(params.seed));
    else if (lastRender.seed != null) args.push('-s', String(lastRender.seed));
    if (lastRender.contextImages?.length > 0) {
      for (const img of lastRender.contextImages) {
        args.push('-c', img);
      }
    }
    if (lastRender.photobooth && lastRender.refImage) {
      args.push('--photobooth', '--ref', lastRender.refImage);
    }
    args.push('--', prompt);
    return runAndFormat(args, { timeoutMs: 60_000 });
  }
}

async function handleEstimateCost(params) {
  const isVideo = params.type === 'video';

  if (isVideo) {
    if (!params.steps) {
      return {
        content: [{ type: 'text', text: 'Error: Video cost estimation requires the "steps" parameter.' }],
        isError: true,
      };
    }
    const args = ['--video', '--estimate-video-cost'];
    if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
    if (params.width) args.push('-w', String(params.width));
    if (params.height) args.push('-h', String(params.height));
    if (params.fps) args.push('--fps', String(params.fps));
    if (params.duration) args.push('--duration', String(params.duration));
    if (params.count) args.push('-n', String(params.count));
    args.push('--steps', String(params.steps));
    // Need a dummy prompt for the CLI
    args.push('--', 'cost-estimate');
    return runAndFormat(args, { timeoutMs: 30_000 });
  } else {
    // Image cost: check balance and provide guidance
    const balanceResult = await runSogniGen(['--balance'], { timeoutMs: 30_000 });
    if (balanceResult.success === false) return formatError(balanceResult);

    const model = params.model || 'z_image_turbo_bf16';
    const w = params.width || 512;
    const h = params.height || 512;
    const count = params.count || 1;

    // Rough cost heuristic based on model and pixel count
    const pixels = w * h;
    const basePixels = 512 * 512;
    const pixelMultiplier = pixels / basePixels;
    let baseCost;
    if (model.includes('flux2')) baseCost = 5.0;
    else if (model.includes('flux1')) baseCost = 0.5;
    else if (model.includes('chroma')) baseCost = 2.0;
    else if (model.includes('qwen')) baseCost = 1.5;
    else baseCost = 0.8; // z_image_turbo default

    const estimatedCost = baseCost * pixelMultiplier * count;

    const text = [
      `Estimated image cost:`,
      `  Model: ${model}`,
      `  Size: ${w}x${h} (${count} image${count > 1 ? 's' : ''})`,
      `  Estimated SPARK: ~${estimatedCost.toFixed(2)}`,
      ``,
      `Current balance:`,
      `  SPARK: ${balanceResult.spark ?? 'N/A'}`,
      `  SOGNI: ${balanceResult.sogni ?? 'N/A'}`,
      ``,
      `Note: Image cost estimates are approximate. Video estimates are precise (use type="video" with steps).`
    ].join('\n');

    return { content: [{ type: 'text', text }] };
  }
}

async function handleManageMemory(params) {
  const action = validateEnum(params.action, ['read', 'write', 'delete'], 'action');
  if (action === 'read') {
    const args = ['--json'];
    if (params.key) {
      args.push('--memory-get', sanitizeString(params.key, 'key'));
    } else {
      args.push('--memory-list');
    }
    return runAndFormat(args, { timeoutMs: 5_000, requireCredentials: false });
  } else if (action === 'write') {
    if (!params.key || !params.value) {
      return { content: [{ type: 'text', text: 'Error: "key" and "value" are required for write.' }], isError: true };
    }
    const args = ['--json', '--memory-set', sanitizeString(params.key, 'key'), sanitizeString(params.value, 'value')];
    if (params.category) args.push('--memory-category', validateEnum(params.category, ['preference', 'fact', 'context'], 'category'));
    return runAndFormat(args, { timeoutMs: 5_000, requireCredentials: false });
  } else {
    if (!params.key) {
      return { content: [{ type: 'text', text: 'Error: "key" is required for delete.' }], isError: true };
    }
    const args = ['--json', '--memory-remove', sanitizeString(params.key, 'key')];
    return runAndFormat(args, { timeoutMs: 5_000, requireCredentials: false });
  }
}

async function handleManagePersonality(params) {
  const action = validateEnum(params.action, ['get', 'set', 'clear'], 'action');
  if (action === 'get') {
    return runAndFormat(['--json', '--personality-get'], { timeoutMs: 5_000, requireCredentials: false });
  } else if (action === 'set') {
    if (!params.text) {
      return { content: [{ type: 'text', text: 'Error: "text" is required for set.' }], isError: true };
    }
    return runAndFormat(['--json', '--personality-set', sanitizeString(params.text, 'text')], { timeoutMs: 5_000, requireCredentials: false });
  } else {
    return runAndFormat(['--json', '--personality-clear'], { timeoutMs: 5_000, requireCredentials: false });
  }
}

async function handleManagePersonas(params) {
  const action = validateEnum(params.action, ['list', 'add', 'remove', 'resolve'], 'action');
  if (action === 'list') {
    return runAndFormat(['--json', '--persona-list'], { timeoutMs: 5_000, requireCredentials: false });
  } else if (action === 'add') {
    if (!params.name || !params.photo_path) {
      return { content: [{ type: 'text', text: 'Error: "name" and "photo_path" are required for add.' }], isError: true };
    }
    const args = ['--json', '--persona-add', sanitizeString(params.name, 'name'), '--ref', sanitizeString(params.photo_path, 'photo_path')];
    if (params.relationship) args.push('--relationship', validateEnum(params.relationship, ['self', 'partner', 'child', 'friend', 'pet'], 'relationship'));
    if (params.description) args.push('--description', sanitizeString(params.description, 'description'));
    if (params.tags?.length) args.push('--tags', params.tags.map((t, i) => sanitizeString(t, `tags[${i}]`)).join(','));
    if (params.voice) args.push('--voice', sanitizeString(params.voice, 'voice'));
    if (params.voice_clip_path) args.push('--voice-clip', sanitizeString(params.voice_clip_path, 'voice_clip_path'));
    return runAndFormat(args, { timeoutMs: 10_000, requireCredentials: false });
  } else if (action === 'remove') {
    if (!params.name) {
      return { content: [{ type: 'text', text: 'Error: "name" is required for remove.' }], isError: true };
    }
    return runAndFormat(['--json', '--persona-remove', sanitizeString(params.name, 'name')], { timeoutMs: 5_000, requireCredentials: false });
  } else {
    if (!params.name) {
      return { content: [{ type: 'text', text: 'Error: "name" is required for resolve.' }], isError: true };
    }
    return runAndFormat(['--json', '--persona-resolve', sanitizeString(params.name, 'name')], { timeoutMs: 5_000, requireCredentials: false });
  }
}

async function handleApplyStyle(params) {
  sanitizeString(params.prompt, 'prompt');
  sanitizeString(params.source_image, 'source_image');
  const args = ['-c', params.source_image];
  if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
  else args.push('-m', 'qwen_image_edit_2511_fp8_lightning');
  if (params.width) args.push('-w', String(params.width));
  if (params.height) args.push('-h', String(params.height));
  args.push('--', `Apply style: ${params.prompt}`);
  return runAndFormat(args, { timeoutMs: 60_000 });
}

async function handleChangeAngle(params) {
  sanitizeString(params.source_image, 'source_image');
  const args = ['--multi-angle', '-c', params.source_image];
  if (params.azimuth) args.push('--azimuth', sanitizeString(params.azimuth, 'azimuth'));
  if (params.elevation) args.push('--elevation', sanitizeString(params.elevation, 'elevation'));
  if (params.distance) args.push('--distance', sanitizeString(params.distance, 'distance'));
  if (params.lora_strength != null) args.push('--angle-strength', String(params.lora_strength));
  if (params.prompt) args.push('--angle-description', sanitizeString(params.prompt, 'prompt'));
  args.push('--', params.prompt || 'same subject from a different angle');
  return runAndFormat(args, { timeoutMs: 60_000 });
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'sogni', version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: params } = request.params;
  try {
    switch (name) {
      case 'generate_image':
        return await handleGenerateImage(params);
      case 'generate_video':
        return await handleGenerateVideo(params);
      case 'edit_image':
        return await handleEditImage(params);
      case 'photobooth':
        return await handlePhotobooth(params);
      case 'check_balance':
        return await handleCheckBalance();
      case 'list_models':
        return handleListModels();
      case 'get_version':
        return await handleGetVersion();
      case 'extract_last_frame':
        return await handleExtractLastFrame(params);
      case 'concat_videos':
        return await handleConcatVideos(params);
      case 'list_media':
        return await handleListMedia(params);
      case 'refine_result':
        return await handleRefineResult(params);
      case 'estimate_cost':
        return await handleEstimateCost(params);
      case 'manage_memory':
        return await handleManageMemory(params);
      case 'manage_personality':
        return await handleManagePersonality(params);
      case 'manage_personas':
        return await handleManagePersonas(params);
      case 'apply_style':
        return await handleApplyStyle(params);
      case 'change_angle':
        return await handleChangeAngle(params);
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
