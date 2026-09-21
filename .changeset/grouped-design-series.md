---
"@open-codesign/desktop": minor
"@open-codesign/shared": patch
---

Group the designs lists (Hub "Your designs" tab and the all-designs dialog) into workspace series — designs sharing one workspace folder, such as session continuations, now cluster under a header named after the earliest design, with a count badge. Adds a shared sort control with three keys: created time, modified time, and session time (derived from the session JSONL mtime, newly exposed as `lastSessionAt` on listed designs). Searching the all-designs dialog temporarily flattens the grouping for quick lookup.
