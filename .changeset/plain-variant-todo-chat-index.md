---
"create-rudder-app": patch
---

Close plain-variant styling gap for todo, ai-chat, multi-framework index, and demo pages.

The `--no-tailwind` scaffolder previously left todo lists, AI chat UIs, multi-framework index pages, and per-framework demo pages with raw HTML markup because they used shadcn-flavored Tailwind utilities (`text-muted-foreground`, `bg-primary`, `bg-muted`, etc.) that don't exist in the plain-CSS variant. They now use the same semantic class vocabulary as the welcome / auth / error pages, so `--no-tailwind` apps see styled output everywhere out of the box.

New semantic classes shipped in both CSS variants: `form-inline`, `todo-list`, `todo-item` (+`is-done` modifier), `link-danger`, `empty-state`, `chat-wrap`, `chat-column`, `chat-header`, `chat-log`, `chat-row` (+`is-user`/`is-assistant`), `chat-bubble` (+`is-user`/`is-assistant`), `chat-input`.
