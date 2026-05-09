# Sogni Skills (per-skill markdown index)

The legacy `SKILL.md` at the repo root is the public entry point ingested by skill-loading hosts (Claude Code, OpenClaw, Hermes Agent, Manus AI, etc.) that load a skill as one artifact. This `skills/` directory is the **per-skill** view used by hosts that want to load a focused subset of capability rather than the whole monolith.

Each file is the canonical SKILL.md for one skill, kept in sync with the matching manifest in [`@sogni/creative-agent`](../../sogni-creative-agent/src/skills/). Frontmatter declares `name`, `description`, `always_loaded`, and `tool_names`; the body documents the LLM-callable tools and any constraints the host should respect.

## Always-loaded skills

Loaded automatically by every Sogni-hosted runtime. Hosts that mirror this layout should load these first, before any user-facing capability.

| Skill | Tools |
|---|---|
| [`quality_audit`](./quality_audit.md) | _(none — preflight rule set)_ |
| [`skill_management`](./skill_management.md) | `load_skill`, `unload_skill`, `list_active_skills` |
| [`session_control`](./session_control.md) | `ask_clarifying_question`, `finalize_response` |
| [`asset_reference_management`](./asset_reference_management.md) | `create_asset_manifest`, `inspect_asset`, `label_asset`, `map_assets_for_model`, `validate_asset_references` |

## Creative skills (load on demand)

Loadable per session via `load_skill` once the dynamic loader is enabled (`WORKFLOW_DYNAMIC_SKILLS=1` in the chat runtime). All loaded by default today.

| Skill | Tools |
|---|---|
| [`image_generation`](./image_generation.md) | `generate_image` |
| [`image_editing`](./image_editing.md) | `edit_image`, `restore_photo`, `apply_style`, `change_angle`, `refine_result` |
| [`video_generation`](./video_generation.md) | `generate_video` |
| [`video_editing`](./video_editing.md) | `animate_photo`, `sound_to_video`, `video_to_video`, `stitch_video`, `orbit_video`, `dance_montage` |
| [`music_generation`](./music_generation.md) | `generate_music` |
| [`media_analysis`](./media_analysis.md) | `analyze_image`, `analyze_video`, `extract_metadata` |
| [`persona_management`](./persona_management.md) | `resolve_personas`, `manage_memory` |
| [`app_settings`](./app_settings.md) | `set_content_filter` |

## How to consume

- **Whole-skill hosts** (Claude Code, OpenClaw): load the top-level [`SKILL.md`](../SKILL.md) as today.
- **Per-skill hosts** (future Sogni-hosted chat consumers, agents that want minimal token footprint): load [`skills/README.md`](./README.md) for the menu, then individual `skills/<id>.md` files for the capabilities the session needs.

## Sync source

These files are mirrored from `@sogni/creative-agent/src/skills/<id>/SKILL.md`. When the upstream manifest or constraints change, regenerate the matching file here. Future tooling will sync them via `npm run sync:skill-runtime`.
