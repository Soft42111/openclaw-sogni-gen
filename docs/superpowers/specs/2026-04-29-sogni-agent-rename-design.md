# Rename `sogni-gen` → `sogni-agent`

## Why

Reposition the project as a platform-agnostic media-generation toolkit available
to *any* agent runtime — OpenClaw, Hermes Agent, Manus AI, Claude Code/Desktop,
etc. — rather than reading as a single-purpose CLI. The product capabilities
(image, video, persona, memory, etc.) are unchanged; only the framing changes.

## Decisions

| | |
|---|---|
| npm package | `sogni-gen` → `sogni-agent` (full cutover, no dual-publish) |
| Old package | A final `sogni-gen@1.6.2` will be published with a deprecation notice pointing to `sogni-agent` (separate, post-cutover task — not part of this PR) |
| New version | `2.0.0` (signals the rename is breaking for installers) |
| CLI bin | `sogni-gen` → `sogni-agent` |
| MCP bin | `sogni-gen-mcp` → `sogni-agent-mcp` |
| GitHub repo | `Sogni-AI/openclaw-sogni-gen` → `Sogni-AI/sogni-agent` (drops `openclaw-` prefix; renamed by repo owner) |
| OpenClaw plugin id | `sogni-gen` → `sogni-agent` |
| Main entry | `sogni-gen.mjs` → `sogni-agent.mjs` (and the `desktop-extension/server/` copy) |
| `.mcpb` bundle | `sogni-gen.mcpb` → `sogni-agent.mcpb` (file rename only; bundle will need to be rebuilt from the renamed source by the publisher) |
| Test files | `test/sogni-gen.*` → `test/sogni-agent.*` |
| Internal source refs | constants like `SOGNI_GEN`, doc comments, log strings updated to match |
| Positioning copy | "Sogni Agent — Sogni AI image & video generation for any agent runtime (OpenClaw, Hermes, Manus, Claude, …)" |

## Approach

Single feature branch `rename/sogni-agent`, single PR. Mechanical rename split
into focused commits if useful, but every piece is interlocked, so all of it
ships together.

Out of scope for this branch:
- Publishing the new package to npm (manual release step).
- Publishing the deprecated `sogni-gen@1.6.2` (manual release step from the old
  tag).
- Renaming the GitHub repo (done by the repo owner in GitHub's UI; URLs in this
  PR already use the new path).
- Rebuilding `sogni-agent.mcpb` (must be regenerated from the renamed source by
  whoever cuts the release).
