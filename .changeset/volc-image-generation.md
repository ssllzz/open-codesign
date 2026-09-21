---
"@open-codesign/desktop": minor
"@open-codesign/shared": minor
"@open-codesign/providers": minor
---

Add Volcengine Ark (火山方舟) as an image generation provider — Settings → Image generation now offers 火山方舟 alongside OpenAI and OpenRouter, defaulting to `doubao-seedream-5-0-pro-260628`. Selecting it switches credentials to a dedicated API key (Ark has no chat provider to inherit from) and hides the quality control (Ark has no quality parameter). Requests always ask for inline `b64_json` bytes with the watermark disabled; sizes map directly since Ark accepts explicit `WxH` pixel dimensions.

Image provider wiring in `@open-codesign/providers` is refactored from if/else branches into a per-provider strategy table (default model, base URL, request builder, response parser), so adding a future provider touches one object instead of six scattered sites; the renderer's duplicated default-model/base-URL helpers were removed in favor of the shared ones.
