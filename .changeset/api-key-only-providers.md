---
"@open-codesign/desktop": minor
"@open-codesign/shared": minor
"@open-codesign/core": patch
"@open-codesign/providers": patch
"@open-codesign/i18n": patch
---

Simplify model onboarding to a single API-key flow. Settings → Models now offers one "Add provider" form (wire + base URL + API key + manually entered model IDs, comma or newline separated); model switching lists only the models you entered.

- Remove all OAuth / subscription sign-in paths: ChatGPT Codex login, external config imports (Codex / Claude Code / Gemini CLI / OpenCode), CLIProxyAPI detection, and the built-in provider presets (Anthropic / OpenAI / OpenRouter / Ollama quick forms). Existing configs migrate to schema v4: preset and codex entries are dropped with their orphaned secrets, `defaultModel` folds into a manual `models` list, and the active provider falls back to the first surviving entry so upgraded installs keep booting.
- Replace the "Test connection" `/models` probe with a single tiny real generation using your first listed model — key, base URL, and model are verified in one round-trip, which works for gateways without a `/models` listing (e.g. Volcengine Ark Agent Plan). Reasoning models that hit the token cap on the probe still count as connected.
