---
"@rudderjs/sync": minor
---

Add `composeRoomId` / `parseRoomId` helpers for collision-safe composite room ids.

The server derives the Y.Doc room name as the last non-empty path segment of the connection URL, so a slash-joined composite id like `panel/posts/42` silently collapses to `42`, and two resources sharing a record id (`posts/42` and `comments/42`) would land in the same room. The `SyncConfig.path` JSDoc told you to flatten ids by hand but shipped no helper, so every consumer reinvented a separator scheme.

`composeRoomId(segments, separator?)` joins parts with a non-slash separator (default `':'`) and throws if any segment contains a slash or the separator, so a collision can never slip through silently. `parseRoomId` is the inverse. `DEFAULT_ROOM_SEPARATOR` is exported too.

```ts
import { composeRoomId, parseRoomId } from '@rudderjs/sync'

const room = composeRoomId(['default', 'posts', '42'])   // 'default:posts:42'
parseRoomId(room)                                        // ['default', 'posts', '42']
```
