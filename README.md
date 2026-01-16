# Webpods

Webpods is a Compose-first, Docker-like, SSH-driven deployment tool that ships images registry-less (content-addressed blobs) and safely operates across multiple environments and multiple projects on shared servers.

The v1 specification lives at `.analysis/spec.md`.

## Prerequisites

- Node.js 22+
- .NET 10 SDK
- A local `ssh` client
- Remote hosts reachable via SSH with Docker Engine installed

## Build (from source)

This repo is intended to be built with Tsonic (TypeScript → C# → .NET).

```bash
npm install
npm run build
./packages/cli/out/webpods --help
```

