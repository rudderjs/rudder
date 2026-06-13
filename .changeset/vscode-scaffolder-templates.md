---
"create-rudder": minor
---

Scaffold a committed `.vscode/` directory so a fresh project is F5-debuggable out of the box. `launch.json` ships three Node debug configurations (Debug dev server, Debug rudder command, Debug current test file), `extensions.json` recommends the relevant extensions for the chosen stack (Vite always, plus Tailwind / Prisma / Vue only when selected), and `settings.json` pins the workspace TypeScript and leaves formatting to the user. Cursor reads the same files, so it benefits too. Delete the directory if your editor does not use it.
