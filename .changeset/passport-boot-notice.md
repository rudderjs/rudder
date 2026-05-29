---
"@rudderjs/passport": patch
---

fix: route the missing-keypair warning through the grouped boot-notice channel

`PassportProvider.boot()` warned about a missing RSA keypair with an inline
`console.warn`, so it printed mid-boot — between the banner and the provider
tree — instead of in the grouped `⚠ N notices` block that every other provider
notice (ai, auth) flushes after the tree. Switched it to `bootNotice('passport', …)`
so the dev startup stays clean: banner → tree → notices → ready. No change to
when the warning fires or what it says; it's just collected with the rest.
