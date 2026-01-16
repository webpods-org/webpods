# Agent Notes (Webpods)

## Scope

These instructions apply to the entire repository.

## Standards

- Follow `CODING-STANDARDS.md`.
- Files/directories are kebab-case (exceptions: `README.md`, `CLAUDE.md`, `CODING-STANDARDS.md`, `AGENTS.md`).
- ESM imports only; local imports include explicit `.js` extensions.
- 3-letter acronyms are ALL CAPS in identifiers (`SSH`, `CLI`, `OCI`).

## Tsonic Constraints

- Compiled code must not use Node.js runtime APIs.
- Prefer the .NET BCL via `@tsonic/dotnet/*` for filesystem, processes, networking, crypto, etc.
