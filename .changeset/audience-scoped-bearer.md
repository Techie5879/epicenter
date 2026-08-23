---
'@epicenter/auth': patch
---

`auth.fetch` is now audience-scoped: it attaches the Epicenter `Authorization: Bearer` header only to the origin the client signed into, and sends no Epicenter credential to any other origin. This makes it safe to hand `auth.fetch` to a custom inference backend (a localhost Ollama or a third-party gateway) without leaking the access token, since the WHATWG cross-origin redirect strip is absent in Tauri's fetch and was version-gated in Chromium.
