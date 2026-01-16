# Coding Standards

This document defines the mandatory coding standards for the Webpods codebase.

Webpods is compiled with **Tsonic** (TypeScript → C# → .NET). It is **not** a Node.js runtime app.

## Core Principles

### 1) Functional Programming First

- Prefer functions and modules.
- Avoid “service classes” for stateless logic.
- Classes are allowed only when they materially improve interop/ergonomics:
  - public facade classes for tsbindgen-friendly APIs (like tsumo’s `Tsumo` class),
  - simple data carriers that cross package boundaries cleanly in .NET.

### 2) Explicit Error Handling (Result Types)

Use `Result<T>` for operations that can fail. Do not throw for expected errors (missing files,
invalid config, unreachable hosts, non-zero exit codes).

Recommended shape:

```ts
export type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E };
```

### 3) ESM Modules + Import Hygiene

- All imports must include the `.js` extension.
- Use named exports only (no default exports).
- No dynamic imports.

```ts
import { readTextFile } from "./read-text-file.js";
import type { Result } from "./result.js";
```

### 4) Tsonic Constraints (Do Not Fight the Compiler)

- No `any` and no `as any`.
- No Promise chaining (`.then()/.catch()/.finally()`); use `async`/`await`.
- Avoid Node built-ins in compiled code (`fs`, `child_process`, etc.). Use the .NET BCL via
  `@tsonic/dotnet/*`.

### 5) Shelling Out Safely (SSH / Docker / Skopeo)

Webpods invokes external tools (`ssh`, `scp`, `rsync`, `docker`, `skopeo`, etc.).

- Never build a single shell command string from user input.
- Use `System.Diagnostics.Process` with an argument list (no shell).
- Validate and normalize paths before using them as arguments.
- Capture stdout/stderr and include them in error results.

## Naming Conventions

### General

- Functions: `camelCase`
- Types: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Files/directories: `kebab-case` (repo-wide; exceptions: `README.md`, `CLAUDE.md`, `CODING-STANDARDS.md`, `AGENTS.md`)

### Acronyms

- 3-letter acronyms are **ALL CAPS**: `SSH`, `CLI`, `OCI`.
- Acronyms longer than 3 letters use **PascalCase**: `Http`, `Json`, `Yaml`, `Uuid`.

Examples:

- ✅ `SSHClient`, `OCIStore`, `Webpods.CLI`
- ✅ `HttpClient`, `JsonSerializer`, `YamlDotNet`
