---
"@open-codesign/desktop": minor
---

Aggregate hub listings by workspace folder: "Your designs" shows one card per folder (grouped under the series name with the session count) and "Recent" deduplicates sibling sessions so each folder occupies a single slot fronted by its latest session; an actively generating session fronts its folder. Per-session context-menu actions (rename/delete) are removed from aggregated hub cards since they acted on an ambiguous member. Historical sessions stay reachable from a new in-sidebar session switcher next to the model picker: it lists every session on the current workspace folder (newest first, generating state aside) with per-session rename; the designs search dialog also keeps listing every session and is now reachable via a new top-bar button (the dialog previously had no opener).
