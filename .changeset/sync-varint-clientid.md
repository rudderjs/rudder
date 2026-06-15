---
"@rudderjs/sync": patch
---

Fix ghost users lingering in presence after a peer disconnects.

The internal varint reader decoded values with 32-bit signed bitwise math (`result |= (byte & 0x7f) << shift`). Yjs client ids are random uint32, so any id with bit 28 or higher set overflowed and decoded to the wrong number. Live awareness still appeared correctly because the server relays raw awareness bytes, but the disconnect-removal frame is re-encoded from the decoded client id, so it targeted a non-existent id and never dropped the real client. The result: closing one window left a ghost user in every other window's presence list.

`readVarUint` now decodes with overflow-safe arithmetic (correct to 2^53), and `writeVarUint` is hardened symmetrically. Awareness removal on disconnect now carries the correct client id, so peers leave presence immediately.
