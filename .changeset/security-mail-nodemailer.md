---
"@rudderjs/mail": minor
---

Require `nodemailer` `^7.0.11 || ^8.0.0` (was `^6.9.0`) to clear a high-severity advisory in the 6.x line. The SMTP adapter types nodemailer structurally and lazy-loads it via `resolveOptionalPeer`, so no source changes are needed — but apps using the SMTP driver should upgrade their installed `nodemailer` to 7.0.11+ / 8.x.
