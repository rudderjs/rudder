---
"@rudderjs/cli": patch
---

`rudder --version` and the `rudder` banner printed a hardcoded `0.0.2` regardless of the installed version. They now read the CLI's real version from its `package.json` at runtime (works in both the published `dist` and `tsx` source forms). Also fixes a stale "Display RudderJS version" → "Display Rudder version" string the rebrand missed.
