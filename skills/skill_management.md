---
name: skill_management
description: Introspect and mutate the active skill set mid-session.
always_loaded: true
tool_names:
  - load_skill
  - unload_skill
  - list_active_skills
---

# Skill management

The skill loader's own self-management tools. Always loaded so the model can request additional capabilities as the session evolves.

## Tools

- `load_skill {skillId}` — load a registered skill so its tools become callable in this session.
- `unload_skill {skillId}` — unload a previously loaded skill. Returns `PERMISSION_REQUIRED` for `alwaysLoaded` skills.
- `list_active_skills` — return the registered skill menu plus loaded state per skill.

## Constraints

- Call `list_active_skills` first when the user steers toward a domain that may not have its skill loaded.
- Do not load every available skill speculatively — load only the ones whose tools you intend to call.
