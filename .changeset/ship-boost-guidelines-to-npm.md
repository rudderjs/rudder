---
'@rudderjs/router': patch
'@rudderjs/queue': patch
'@rudderjs/storage': patch
'@rudderjs/view': patch
---

Ship `boost/guidelines.md` in the published npm tarball. Adds `"boost"` to the `files` field so downstream `boost:install` in consumer projects finds the per-package AI coding guidelines.
