# CLAUDE.md

This file provides guidance to Claude Code when working with the Webpods codebase.

## Critical Guidelines

### Finish the discussion before writing code

When we are deciding behavior, contracts, or architecture, do not start implementing until the
decision is confirmed.

### Ask before changing contracts

Ask for permission before:

- Changing CLI contracts, flags, or output formats from `.analysis/spec.md`
- Changing `state.json` formats or retention behavior
- Adding new dependencies (npm or NuGet), especially anything affecting NativeAOT

### Webpods is a Tsonic project (NOT a Node.js app)

Webpods compiles TypeScript to a native binary via Tsonic (TS → C# → .NET).

Implications:

- Do not use Node runtime APIs in compiled code (`fs`, `child_process`, etc.).
- Use the .NET BCL via `@tsonic/dotnet/*` for I/O, processes, networking, crypto, etc.
- Keep ESM import hygiene: all imports include `.js` extensions.
- No dynamic imports.
- No `any` and no Promise chaining. See `CODING-STANDARDS.md`.

### Security: Never Use npx

Do not use `npx`. Use repo scripts and local `node_modules` binaries.

### Naming

- Files/directories are kebab-case.
- 3-letter acronyms are ALL CAPS (`SSH`, `CLI`, `OCI`). Longer acronyms use PascalCase (`Http`, `Json`, `Yaml`).

## Project Layout

```
webpods/
  .analysis/spec.md            # v1 spec (source of truth)
  packages/
    ssh/                       # SSH + file transfer (Tsonic library)
    compose/                   # docker compose resolution (Tsonic library)
    docker/                    # remote Docker ops over SSH (Tsonic library)
    artifacts/                 # OCI cache + shipping + import (Tsonic library)
    commands/                  # spec workflows + planning/state/safety (Tsonic library)
    cli/                       # webpods native CLI binary (Tsonic executable)
```

## Essential Commands

```bash
npm install
npm run build
./packages/cli/out/webpods --help
```
