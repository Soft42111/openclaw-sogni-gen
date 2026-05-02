<p align="center">
  <img src="https://raw.githubusercontent.com/Sogni-AI/sogni-creative-agent-skill/main/docs/screenshot.jpg" alt="Telegram image render workflow" width="320" />
</p>

# Sogni Creative Agent Skill: Image & Video Generation for Agents

**Sogni Creative Agent Skill** gives AI agent runtimes such as Claude Code,
[OpenClaw](https://github.com/OpenClaw/OpenClaw),
[Hermes Agent](https://hermes-agent.nousresearch.com/),
[Manus AI](https://manus.im), and more — image generation, video generation, and
creative-media tools powered by [Sogni AI](https://sogni.ai)'s decentralized GPU
network.

Drop it into the setup you already have:
- as a standalone Node.js CLI
- as a skill source for **Hermes Agent**, **Manus AI**, and other agent frameworks
- as an [OpenClaw](https://github.com/OpenClaw/OpenClaw) plugin

For install requests, use the CLI plus skill setup by default.

With Sogni Creative Agent Skill, an agent can:
- generate images from prompts
- edit and restyle existing images
- create videos from text, images, audio, or reference video
- save personas, preferences, and last-render state across sessions
- check balances, list models, and refine previous results

## Quick Start

1. Create Sogni credentials once. See [Setup](#setup).
2. Install the command-line tool:

```bash
npm install -g @sogni-ai/sogni-creative-agent-skill
sogni-agent --version
```

3. Point your agent/runtime at this repository's [`SKILL.md`](./SKILL.md).

Then ask your agent to do something simple, for example:
- "Generate an image of a sunset over mountains"
- "Edit this image to add a rainbow"
- "Make a video of a cat playing piano"
- "Turn my selfie into James Bond using photobooth"
- "Refine the last image at higher quality"

## Installation

Default install behavior: when someone asks to install Sogni Creative Agent Skill, install the command-line tool and skill source.

```bash
npm install -g @sogni-ai/sogni-creative-agent-skill
sogni-agent --version
```

Then point the agent/runtime at this repository's [`SKILL.md`](./SKILL.md).

### OpenClaw Plugin

For the published plugin:

```bash
openclaw plugins install sogni-creative-agent-skill
```

The installed plugin loads its behavior from [`SKILL.md`](./SKILL.md) via [`openclaw.plugin.json`](./openclaw.plugin.json).

For a local checkout that you want to update continuously, link the minimal OpenClaw surface instead of the repository root:

```bash
cd /path/to/sogni-creative-agent-skill
npm install
npm link
npm run openclaw:sync
openclaw plugins install -l "$PWD/.openclaw-link"
openclaw gateway restart
```

To update that linked install later:

```bash
cd /path/to/sogni-creative-agent-skill
git pull --ff-only
npm install
npm link
npm run openclaw:sync
openclaw gateway restart
```

Do not run `openclaw plugins install -l "$PWD"` from the repository root. The root contains development tests that use `child_process`, and OpenClaw correctly blocks those during plugin safety scanning. The generated `.openclaw-link/` directory is only for OpenClaw; Hermes, Manus, and other skill-based agents should continue using the root [`SKILL.md`](./SKILL.md).

### Hermes Agent / Manus / Other Frameworks

Point the agent to this repository's [`SKILL.md`](./SKILL.md) for behavior guidance and [`llm.txt`](https://raw.githubusercontent.com/Sogni-AI/sogni-creative-agent-skill/main/llm.txt) for install/setup help. By default, the agent should invoke the globally installed `sogni-agent` CLI.

### Manual Installation

```bash
git clone git@github.com:Sogni-AI/sogni-creative-agent-skill.git
cd sogni-creative-agent-skill
npm install
```

### Maintainer Runtime Sync

This public skill keeps CLI/runtime glue here, but Sogni model routing, video workflow defaults, quality tiers, and prompt guardrails are generated from the private `sogni-creative-agent` repo. With both repos checked out as siblings, refresh the generated runtime before publishing:

```bash
npm run sync:creative-agent-runtime
```

`npm test` runs `npm run check:creative-agent-runtime` first, which regenerates this file and fails if it differs from the committed copy.

The generated file is committed at [`generated/creative-agent-runtime.mjs`](./generated/creative-agent-runtime.mjs) so public installs do not need access to the private repo.

### Advanced OpenClaw Config

When loaded through OpenClaw, Sogni Creative Agent Skill reads plugin defaults from OpenClaw config. CLI flags always override those defaults.

The supported config shape is defined in [`openclaw.plugin.json`](./openclaw.plugin.json). Common overrides include default models, video workflow models, token type, seed strategy, timeouts, and media paths. If your OpenClaw config lives elsewhere, set `OPENCLAW_CONFIG_PATH`.

## Setup

1. Create a Sogni account at https://app.sogni.ai/
2. Create credentials file:

```bash
mkdir -p ~/.config/sogni
cat > ~/.config/sogni/credentials << 'EOF'
SOGNI_API_KEY=your_api_key
# or:
# SOGNI_USERNAME=your_username
# SOGNI_PASSWORD=your_password
EOF
chmod 600 ~/.config/sogni/credentials
```

You can also skip the file and set `SOGNI_API_KEY`, or `SOGNI_USERNAME` + `SOGNI_PASSWORD`, in your environment.

### Filesystem Paths and Overrides

Defaults live under `~/.config/sogni/` for credentials, last-render metadata, personas, memories, and personality. Advanced path overrides are available through `SOGNI_CREDENTIALS_PATH`, `SOGNI_LAST_RENDER_PATH`, `SOGNI_MEDIA_INBOUND_DIR`, and `OPENCLAW_CONFIG_PATH`.

## Usage

```bash
# Image generation
sogni-agent -Q hq -o dragon.png "a dragon eating tacos"

# Edit an image
sogni-agent -c subject.jpg "add a neon cyberpunk glow"

# Photobooth face transfer
sogni-agent --photobooth --ref face.jpg "80s fashion portrait"

# Text-to-video (t2v)
sogni-agent --video "A narrator says \"welcome to the story\" as ocean waves crash"

# Short-side targeting preserves the current shape without forcing landscape
sogni-agent --video --target-resolution 768 \
  "A calm cinematic shot of lanterns drifting across a night lake"

# Seedance 2.0 explicit aliases (4-15s vendor video path)
sogni-agent --video -m seedance2 --duration 8 \
  "A polished product reveal with native ambient sound"

# Image-to-video (i2v)
sogni-agent --video --ref cat.jpg "gentle camera pan"

# Image+audio-to-video (auto-routes to LTX 2.3 ia2v)
sogni-agent --video --ref cover.jpg --ref-audio song.mp3 \
  "music video with synchronized motion"

# Persona or voice identity with LTX native audio
sogni-agent --video --reference-audio-identity voice.webm \
  "NARRATOR: \"This is my voice.\""

# Segment a source video, then stitch clips locally with an external soundtrack
sogni-agent --video --workflow v2v --ref-video dance.mp4 \
  --video-start 10 --duration 8 --controlnet-name pose -o /tmp/clip-2.mp4 \
  "robot dancing"
sogni-agent --concat-videos /tmp/final.mp4 /tmp/clip-1.mp4 /tmp/clip-2.mp4 \
  --concat-audio song.mp3 --concat-audio-start 0

# Balances and help
sogni-agent --balance
sogni-agent --help
```

For local multi-clip workflows, prefer the built-in FFmpeg wrappers over raw shell commands. `--video-start`, `--audio-start`, and `--audio-duration` let you generate focused segments, while `--concat-videos` can stitch them and optionally mux a single soundtrack with `--concat-audio`.

V2V defaults mirror the Sogni Chat workflow tuning: `canny`, `pose`, and `depth` use ControlNet strength `0.85` with detailer assist, while `detailer` uses strength `1.0`. Use `-m seedance2-v2v` for Seedance V2V without ControlNet.

## LTX-2.3 Prompting Guide

When you use `ltx23-22b-fp8_t2v_distilled`, do not feed it short tag prompts like `"cinematic drone shot over tropical cliffs"`. LTX-2.3 renders more reliably from a dense natural-language scene description.

- Write one unbroken paragraph with no line breaks, bullets, headers, or tag blocks.
- Use 4-8 flowing present-tense sentences describing one continuous shot, not a montage.
- Start with shot scale and scene identity, then cover environment, time of day, textures, and named light sources.
- Keep characters and objects concrete and stable. Describe one main action thread from start to finish.
- If the user wants dialogue, include the exact spoken words in double quotes with the speaker and delivery identified inline.
- Express mood through visible behavior, motion, and sound cues instead of vague adjectives.
- Use positive phrasing. Avoid script formatting, negative prompts, on-screen text/logo requests, and generic filler words like "beautiful" or "nice".
- Match scene density to clip length. For the default short clips, describe one main beat rather than several unrelated actions.

Example rewrite:

```text
User ask: "make a 4k video of a woman in a neon alley"

LTX-2.3 prompt: "A medium cinematic shot frames a woman in her 30s standing in a rain-soaked neon alley at night, violet and amber signs reflecting across the wet pavement while warm steam drifts from street vents. She wears a dark trench coat with damp strands of black hair clinging near her cheek as light glances across the fabric texture and the brick walls behind her. She turns toward the camera and steps forward with measured focus, one hand tightening around the strap of her bag while rain taps softly on the metal fire escape and a distant train hum rolls through the block. The camera performs a slow push-in as her jaw sets and her breathing steadies, maintaining smooth stabilized motion and a tense urban-thriller mood."
```

## Photobooth (Face Transfer)

Generate stylized portraits from a face photo using InstantID ControlNet:

```bash
sogni-agent --photobooth --ref face.jpg "80s fashion portrait"
sogni-agent --photobooth --ref face.jpg -n 4 "LinkedIn professional headshot"
```

Uses SDXL Turbo (`coreml-sogniXLturbo_alpha1_ad`) at 1024x1024 by default. The face image is passed via `--ref` and styled according to the prompt. Cannot be combined with `--video` or `-c/--context`.

Multi-angle mode auto-builds the `<sks>` prompt and applies the `multiple_angles` LoRA.
`--angles-360-video` generates i2v clips between consecutive angles (including last→first) and concatenates them with ffmpeg for a seamless loop.
`--balance` / `--balances` does not require a prompt and exits after printing current `SPARK` and `SOGNI` balances.

## Video Sizing Rules (Aspect Ratios)

- WAN models use dimensions divisible by 16, min 480px, max 1536px.
- LTX family models (`ltx2-*`, `ltx23-*`) use dimensions divisible by 64. LTX 2.3 supports 640px to 3840px.
- The script auto-normalizes video sizes to satisfy those constraints.
- Use `--target-resolution <px>` for bare resolution requests such as "720p" when the user did not specify exact pixels. It targets the short side and preserves the inherited aspect ratio.
- For i2v (and any workflow using `--ref` / `--ref-end`), the client wrapper resizes the reference image with a strict aspect-fit (`fit: inside`) and then uses the *resized reference dimensions* as the final video size. Because that resize uses rounding, a “valid” requested size can still produce an invalid final size (example: `1024x1536` requested, but ref becomes `1024x1535`).
- `sogni-agent` detects this for local refs and will auto-adjust the requested size to a nearby safe size so the resized reference matches the model divisor.
- If you want the script to fail instead of auto-adjusting, pass `--strict-size` and it will print a suggested size.

## Error Reporting

Failures use a non-zero exit code and human-readable stderr. Add `--json` when an agent needs structured success/error output.

## Options

Run `sogni-agent --help` for the complete CLI. These are the options most agents should reach for first:

| Option | Use |
|--------|-----|
| `-Q fast|hq|pro` | Pick image quality without memorizing model IDs |
| `-o <path>` | Save output locally |
| `-c <path>` | Provide image context for edits |
| `--video` | Generate video instead of image |
| `--ref`, `--ref-audio`, `--ref-video` | Provide image/audio/video references |
| `--target-resolution <px>` | Target the short side while preserving aspect ratio |
| `--workflow <type>` | Force `t2v`, `i2v`, `s2v`, `ia2v`, `a2v`, `v2v`, or animate workflows |
| `--persona <name>` | Use a saved persona reference |
| `--concat-videos <out> <clips...>` | Stitch clips locally with FFmpeg |
| `--json` | Return structured output for agents |

### Quality Presets

Instead of remembering model IDs, use `--quality` / `-Q` to auto-select the right model, steps, and dimensions:

| Preset | Model | Steps | Size | Speed |
|--------|-------|-------|------|-------|
| `fast` | z_image_turbo_bf16 | 8 | 512x512 | ~5-10s |
| `hq` | z_image_turbo_bf16 | default | 768x768 | ~10-15s |
| `pro` | flux2_dev_fp8 | 40 | 1024x1024 | ~2min |

Explicit `--model` overrides the quality preset's model. Explicit `-w`/`-h` overrides dimensions.

### Dynamic Prompt Variations

Generate diverse images in a single call using `{option1|option2|option3}` syntax:

```bash
# Generates 3 images: "a red car", "a blue car", "a green car"
sogni-agent -n 3 "a {red|blue|green} car"

# Multiple variation groups cycle independently
sogni-agent -n 4 "a {cat|dog} in a {garden|kitchen}"
# → "a cat in a garden", "a dog in a kitchen", "a cat in a garden", "a dog in a kitchen"
```

Options cycle sequentially per image. Without `{...}` syntax, `-n` generates multiple images with the same prompt as before.

### Token Auto-Fallback

Use `--token-type auto` to automatically retry with SOGNI tokens if SPARK balance is insufficient:

```bash
sogni-agent --token-type auto "a dragon eating tacos"
```

This tries SPARK first (free daily tokens), then falls back to SOGNI if the balance is too low.

### Personas

Named people with saved reference photos and optional voice clips for identity-preserving generation:

```bash
# Add a persona
sogni-agent --persona-add "Mark" --ref face.jpg --relationship self --description "30s male, brown hair"

# Add with voice clip for video voice cloning
sogni-agent --persona-add "Sarah" --ref sarah.jpg --relationship partner --voice-clip voice.webm

# Generate an image using a persona (auto-injects photo as context)
sogni-agent --persona "Mark" -o hero.png "superhero in dramatic lighting"

# Generate video using a persona photo plus saved voice identity
sogni-agent --video --persona "Sarah" "SARAH: \"This is my voice.\""

# List / remove
sogni-agent --persona-list
sogni-agent --persona-remove "Mark"
```

Personas are stored at `~/.config/sogni/personas/`. Pronouns like "me"/"myself" auto-resolve to the `self` persona. "my wife" resolves to `partner`, etc.

### Memory (Persistent Preferences)

Save preferences that agents respect across sessions:

```bash
sogni-agent --memory-set preferred_style "watercolor and soft lighting"
sogni-agent --memory-set aspect_ratio "16:9"
sogni-agent --memory-list
sogni-agent --memory-remove preferred_style
```

Stored at `~/.config/sogni/memories.json`.

### Personality (Custom Agent Instructions)

Set how the agent should behave:

```bash
sogni-agent --personality-set "Be concise, always use cinematic lighting"
sogni-agent --personality-get
sogni-agent --personality-clear
```

Stored at `~/.config/sogni/personality.txt`.

## Models

Prefer `-Q fast|hq|pro` for images and automatic workflow routing for video. Only pass `-m` when you need a specific model family.

| Need | Recommended model or alias |
|------|----------------------------|
| Default images | `z_image_turbo_bf16` |
| Highest quality images | `flux2_dev_fp8` or `-Q pro` |
| Image editing | `qwen_image_edit_2511_fp8_lightning` |
| Photobooth face transfer | `coreml-sogniXLturbo_alpha1_ad` |
| Text-to-video with native dialogue/audio | `ltx23-22b-fp8_t2v_distilled` |
| Image+audio-to-video | `ltx23-22b-fp8_ia2v_distilled` |
| Audio-to-video | `ltx23-22b-fp8_a2v_distilled` |
| Video-to-video with ControlNet | `ltx23-22b-fp8_v2v_distilled` |
| Seedance text-to-video | `seedance2` or `seedance2-fast` |
| Seedance video-to-video without ControlNet | `seedance2-v2v` |
| Face lip-sync with uploaded audio | `wan_v2.2-14b-fp8_s2v_lightx2v` |

## License

MIT
