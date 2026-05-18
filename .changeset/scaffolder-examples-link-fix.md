---
'create-rudder-app': patch
---

Fix the scaffolder's final-panel "Examples" link — `https://rudderjs.com/examples` was vaporware (404 on the live site as of 2026-05-18). Point at the actual examples gallery: `https://github.com/rudderjs/rudder/tree/main/playground`, the canonical reference app that ships every demo wired up with the framework.

Same correction in the scaffolder's README and the `What about demos?` section of the internal notes.

The original PR #519 copy referenced `rudderjs.com/examples` as part of the demos-dropped-from-scaffolder framing. The marketing site never picked up that page. Linking to GitHub is the honest fix today; if/when a curated examples page ships on rudderjs.com, swap back.
