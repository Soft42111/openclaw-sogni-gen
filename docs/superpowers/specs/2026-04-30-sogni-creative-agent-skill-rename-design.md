# Rename `sogni-agent` package/repo to `sogni-creative-agent-skill`

## Decisions

| | |
|---|---|
| npm package | `@sogni-ai/sogni-agent` -> `@sogni-ai/sogni-creative-agent-skill` |
| GitHub repo | `Sogni-AI/sogni-agent` -> `Sogni-AI/sogni-creative-agent-skill` |
| Skill name | `sogni-agent` -> `sogni-creative-agent-skill` |
| OpenClaw plugin id | `sogni-agent` -> `sogni-creative-agent-skill` |
| CLI bin | Keep `sogni-agent` for user ergonomics and compatibility |
| Main entry | Keep `sogni-agent.mjs` because it is the CLI runtime behind the skill |

## npm Migration

npm does not support true package redirects. After
`@sogni-ai/sogni-creative-agent-skill` is published, update deprecation notices
so npm users see the new install target:

```bash
npm deprecate sogni-gen@"*" "sogni-gen has moved to @sogni-ai/sogni-creative-agent-skill. Install: npm i -g @sogni-ai/sogni-creative-agent-skill. Repo: https://github.com/Sogni-AI/sogni-creative-agent-skill"
npm deprecate @sogni-ai/sogni-agent@"*" "@sogni-ai/sogni-agent has moved to @sogni-ai/sogni-creative-agent-skill. Install: npm i -g @sogni-ai/sogni-creative-agent-skill. Repo: https://github.com/Sogni-AI/sogni-creative-agent-skill"
```
