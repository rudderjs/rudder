# Security Policy

## Supported Versions

RudderJS is in early development. Security fixes are applied to the latest `main` and the most recent published minor release. Older versions are not backported.

## Reporting a Vulnerability

**Please do not open public issues for security vulnerabilities.**

Report security issues privately via either channel:

- **Email** — suleiman@averotech.com
- **GitHub** — [Private vulnerability report](https://github.com/rudderjs/rudder/security/advisories/new)

Include:

- A description of the issue and its impact
- Steps to reproduce (proof-of-concept code, affected package versions)
- Any known mitigations

**Response timeline:**

- **72 hours** — initial acknowledgement
- **7 days** — preliminary assessment (severity, affected packages, planned fix window)
- **30 days** — target resolution for high-severity issues; lower-severity issues may take longer

Critical vulnerabilities trigger an immediate patch release and a security advisory on the affected package(s). We follow responsible disclosure and will credit reporters unless anonymity is requested.

## Scope

In scope:
- `@rudderjs/*` packages published to npm
- The `create-rudder` scaffolder
- The `rudderjs/rudder` GitHub repository

Out of scope:
- Third-party dependencies (report upstream)
- Misconfigurations in user applications (e.g., leaked `.env`, exposed debug endpoints) — these are application-level issues, not framework bugs
- Social engineering / phishing attacks against maintainers
