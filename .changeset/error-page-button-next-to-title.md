---
'@rudderjs/server-hono': patch
---

ui(server-hono): move Copy-as-Markdown button next to the H1 title

Tweak of the button position landed in #441. Previously the button lived on its own row above the badges, which felt visually disconnected from the error itself. Now it sits inline with the H1 title via a flex `title-row` container — same convention as Laravel Ignition's "Share" / "Copy as text" controls.

No behavior change. The button still copies the same Markdown payload; tests unchanged.
