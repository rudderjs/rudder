---
"@rudderjs/storage": patch
---

Harden the local signed-URL serve path (`serveTemporaryUrls` + `LocalAdapter`).

- **Serve untrusted content safely.** The handler streamed files with no `Content-Type`, `Content-Disposition`, or `X-Content-Type-Options`. A user-uploaded HTML/SVG served via a signed URL would MIME-sniff and render inline in the app's own origin — a stored-XSS vector (the signature proves the URL wasn't tampered, not that the bytes are safe). Responses now set `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment`, and a best-effort `Content-Type` from the file extension.
- **Fix `temporaryUrl` encoding.** It used `encodeURI`, which leaves `#`/`?`/`&` unescaped: a filename containing `#` produced a permanently-403 URL (the fragment is stripped on verify) and one containing `?` served the wrong file. It now encodes per path segment with `encodeURIComponent` (matching the S3 adapter), and the serve handler decodes symmetrically.
- **`..` check is now segment-aware.** The serve handler rejected any filename merely containing `..` as a substring (e.g. `archive..v2.zip`); it now rejects only a real `..` path segment. `contain()` remains the actual traversal defense.
- **Block symlink escape and fix a TOCTOU.** A new `openForServe` resolves the real path (`fs.realpath`) so a symlink planted under the root can't stream an out-of-root file, and confirms the file exists eagerly so a missing/deleted file is a clean 404 instead of a 200 whose body errors mid-stream.
