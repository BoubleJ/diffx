---
"diffx-cli": patch
---

Harden local server exposure by binding DiffX to loopback only and reduce command execution risk by replacing shell-based Git invocation with `execFileSync`.
