# Screenshot provenance

The release-preparation pass initially checked only the task output folder. A wider search of the user's saved Windows screenshots found more captures:

- `history/home-inference-2026-10-31.png` is the supplied 892×361 Home/inference screenshot. It has a Windows activation watermark and is retained only as reference/history.
- `history/live-acceptance-session-2026-10-31.png` is a full saved project-development acceptance screen. It shows the selected 65,536 context and 8,192 output values and a live worksheet. It predates the current updater and transcript-follow refinements; it is historical workflow evidence, not a screenshot of the release candidate.
- `history/home-inference-before.png` is an explicitly labeled reconstruction from an earlier commit, not a screenshot captured from a running app. Keep it out of user-facing release galleries.
- A separate worksheet screenshot was reviewed and excluded because the resource cards visibly overlapped the activity output. A mostly empty trace skeleton was excluded as well.

The Home hero captures show the older static orbit treatment, not the current adaptive installed-model slots. Do not present them as proof of adaptive model counts or clickable model details.

Add current screenshots only from the rebuilt, running release candidate. Capture Home with model slots, the chat with compact activity, and the Live Work Sheet with its trace and resource stats. Keep fixture paths, prompts, private workspace names, credentials, and unrelated desktop content out of the captures. Record the exact package version and acceptance session in the accompanying notes.
