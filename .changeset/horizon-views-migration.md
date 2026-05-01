---
"@rudderjs/horizon": minor
---

Migrate UI to the canonical package-UI shape (`views/vanilla/` + `registerHorizonRoutes()`). One file per page (`Dashboard`, `RecentJobs`, `FailedJobs`, `Queues`, `Workers`), with the shared layout in `Layout.ts` and the auto-escape `html\`\`` helper available in `_html.ts`. Route registration moves from `src/api/routes.ts` to a new `src/routes.ts`; API handler implementations stay where they were as pure functions. Internal restructure only — public API (`HorizonProvider`, `Horizon` facade, configuration) is unchanged.
