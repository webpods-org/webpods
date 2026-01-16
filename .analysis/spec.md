# Webpods Specification

*A Compose-first, Docker-like, SSH-driven deployment tool with registry-less image distribution, safe multi-environment operations, and multi-project isolation on shared servers.*

---

## 1. Purpose and Goals

### 1.1 What Webpods Is

Webpods is a deployment tool that lets developers use their existing **Docker Compose files on disk** to run applications across **multiple servers**—over **SSH**, without requiring:

* a long-running daemon/agent (“no daemon”),
* a container orchestration control plane (no Swarm/K8s),
* or a container image registry (**registry-less is first-class**; registry support is optional/future).

Webpods should feel *as close to Docker/Docker Compose as possible* in:

* command names and flags,
* file conventions,
* and mental model.

### 1.2 Primary Use Case

A developer has a repo with:

* `compose.yml` (and optionally `compose.staging.yml`, `compose.prod.yml`)
* `.env.dev`, `.env.staging`, `.env.production` (or similar)
* Webpods contexts that map to SSH hosts

They want to run:

* staging on GCP VMs
* production on AWS VMs
  …but **everything is just SSH** at the tool layer. “GCP/AWS” is metadata and defaults, not required to function.

### 1.3 Non-goals

Webpods is **not**:

* a full container orchestrator (no full overlay networking or service VIPs),
* a general scheduler with complex placement semantics,
* a proxy implementation (Webpods integrates with an existing proxy),
* a registry daemon (but it uses registry-like **content-addressed** blob dedupe on disk).

---

## 2. Guiding Principles

1. **Compose is the definition mechanism.**
   The developer’s `compose.yml` remains the canonical app definition.

2. **Stay Docker-like.**
   Prefer `up/down/ps/logs/exec/build/images/push` over novel verbs.

3. **No “context use” footgun.**
   Webpods must not provide a sticky global “use context” command.

4. **Repo-local default context is allowed and safe.**
   If `-c` is omitted, Webpods uses a repo-defined default context from config (default is `dev`).

5. **Safety is context-driven and configurable.**
   Environment identifiers like `prod` are just strings. Whether an environment is “guarded” is defined in config.

6. **Registry-less shipping must avoid needless transfers.**
   When only some images change, Webpods transfers only missing blobs by digest.

7. **Routing model is Option 1.**
   The load balancer/proxy routes to `host_ip:published_port` (host ports), not container IPs.

8. **Multi-project isolation is mandatory.**
   Multiple apps must safely share the same hosts. `down` and destructive operations must be project-scoped.

---

## 3. Core Concepts and Terminology

### 3.1 Project

A “project” is a Compose application boundary:

* derived from Compose `name:` field, or
* `--project-name` / `-p`, or
* fallback: directory name

The project is a hard namespace boundary for `up/down/rm/logs/exec/cleanup/prune`.

### 3.2 Context (Environment)

A “context” is a target environment configuration containing:

* SSH host inventory
* defaults (compose files, env file)
* proxy driver and domain settings
* artifact shipping and caching settings
* safety policy (safe/guarded)
* allowlist of execution origins (allow_from)

Webpods supports multiple contexts per repo (e.g. `dev`, `staging`, `production`).

### 3.3 Node / Host

A node/host is a server reachable via SSH with Docker Engine running. Webpods performs:

* image import,
* container lifecycle actions,
* proxy configuration actions,
* state persistence,
  on each host.

### 3.4 Release

A release is a recorded deployment version consisting of:

* per-service image digests,
* placement results (which hosts run which replicas),
* port allocations (published ports per replica),
* proxy routing config snapshot,
* timestamps and metadata.

Releases exist per **(context, project)**.

### 3.5 Service and Replica

A service is a Compose service. Replicas are multiple instances distributed across eligible hosts.

Replica count is primarily defined by:

* `services.<svc>.deploy.replicas` (preferred)
* optionally `--scale svc=N` (CLI override)

### 3.6 Registry-less Artifact Store

Webpods uses a **content-addressed blob store**:

* local build/export produces blobs by sha256 digest
* hosts maintain a blob cache directory
* shipping transfers only missing blobs
* import into Docker on host uses those blobs, no registry pull required

---

## 4. Repository Layout and Files

### 4.1 Typical Files

At repo root:

* `compose.yml` (or `docker-compose.yml` if supported)
* optional overlays: `compose.dev.yml`, `compose.staging.yml`, `compose.production.yml`
* `.env.dev` / `.env.staging` / `.env.production` (recommended)

Webpods-specific:

* `.webpods/config.yml` (repo configuration; includes default context)
* `.webpods/contexts/<context>.yml` (context definitions)

### 4.2 `.webpods/config.yml`

This file is **the only way** to define a default context. Webpods never auto-writes it.

Example:

```yaml
default_context: dev
```

Rules:

* If `-c` is omitted, Webpods uses `default_context`.
* If the resolved context is not `dev`, Webpods prints a one-liner:

  * `Using default context: <name> (from .webpods/config.yml)`
* If resolved context is `dev`, that one-liner is not required.
* There is no `context use` command.

### 4.3 Compose File Strategy

Encourage:

* `compose.yml` = shared baseline
* overlay files per context for replicas/resources/ingress differences

Webpods merges compose files in the same way Docker Compose does.

---

## 5. Context Configuration Schema

### 5.1 Context File Location

Recommended:

* `.webpods/contexts/dev.yml`
* `.webpods/contexts/staging.yml`
* `.webpods/contexts/production.yml`

### 5.2 Minimal Context Schema (v1)

```yaml
name: staging                 # identifier used via -c/--context
provider: gcp                 # optional metadata: gcp|aws|other

ssh:
  user: ubuntu
  port: 22
  key: ~/.ssh/id_ed25519
  bastion: ubuntu@bastion.example.com   # optional
  connect_timeout_seconds: 10

hosts:
  - name: stg-1
    addr: 34.80.10.11          # ssh address (ip/dns)
    mesh_ip: 10.10.1.11        # optional: preferred reachable IP for proxy upstreams
    labels: { zone: a }        # optional host labels
  - name: stg-2
    addr: 34.80.10.12
    mesh_ip: 10.10.1.12
    labels: { zone: a }

defaults:
  compose_files:
    - compose.yml
    - compose.staging.yml
  env_file: .env.staging
  project_name: acme-shop        # optional default, can be overridden by -p

proxy:
  driver: caddy                  # caddy|traefik|kamal-proxy|none
  domains:
    - api-staging.example.com

artifacts:
  mode: oci-cache                # oci-cache (v1)
  remote_cache_dir: /var/lib/webpods/cache
  concurrency: 6
  retain_releases: 5

safety:
  level: guarded                 # safe|guarded
  confirm:
    required_for:                # optional override list
      - down
      - rm
      - prune
      - cleanup
    token: "staging"             # optional; default: context name
  allow_from:
    - local                       # local CLI invocation
    - ci                          # CI runner invocation
```

### 5.3 Safety Defaults

If `safety` is omitted:

* `level: safe`
* `allow_from: [local, ci]`

If `level: safe`:

* confirmations not required by default

If `level: guarded` and `confirm.required_for` omitted:

* default guarded required_for:

  * `down`, `rm`, `prune`, `cleanup`
* `confirm.token` default = context name

### 5.4 allow_from Semantics

`allow_from` restricts where commands can run:

* `local`
* `ci`

Origin detection (v1 deterministic rule):

* If `--from` is provided, use it.
* Else if `CI=true` (or similar well-known CI env vars exist), origin = `ci`.
* Else origin = `local`.

If origin not allowed:

* fail with:

  * `Refusing: context '<ctx>' disallows execution from '<origin>'. Allowed: <list>.`

---

## 6. CLI Design (Docker-like)

### 6.1 Context Selection and Defaults

* `-c, --context <name>` selects a context explicitly.
* If omitted:

  * use `.webpods/config.yml` → `default_context`
  * if default_context missing: error unless a context named `dev` exists AND you define a fallback rule (recommended: require config; optional fallback: `dev` if present).
* No `webpods context use` command.
* One-liner message when default context is used and it is not `dev`.

### 6.2 Command List (Target Set)

#### Compose-like Lifecycle

* `webpods up`
* `webpods down`
* `webpods ps`
* `webpods logs [SERVICE]`
* `webpods exec SERVICE -- <cmd...>`
* `webpods restart [SERVICE]`
* `webpods stop [SERVICE]`
* `webpods start [SERVICE]`
* `webpods rm [SERVICE]` (remove containers for service/project)

#### Build & Artifacts (registry-less)

* `webpods build [SERVICE...]`
* `webpods images`
* `webpods push [SERVICE...]` (registry-less ship to hosts)
* `webpods pull [SERVICE...]` (optional)
* `webpods diff`

#### Deploy & Releases

* `webpods deploy` (alias to `up` with rollout semantics; in v1 it can just alias)
* `webpods status`
* `webpods rollback [--to <release_id>]`
* `webpods release ls`
* `webpods release inspect <release_id>`
* `webpods release prune`

#### Context & Nodes

* `webpods context ls`
* `webpods context inspect <name>`
* `webpods context rm <name>`
* `webpods context create <name> --from-file <path>` (optional)

Node commands (Docker-familiar naming):

* `webpods node ls`
* `webpods node inspect <node>`
* `webpods node add <ssh_target>` (optional)
* `webpods node rm <node>`
* `webpods node check`
* `webpods node bootstrap`
* `webpods node label <node> key=value` (optional)

#### Proxy Integration

* `webpods proxy status`
* `webpods proxy config`
* `webpods proxy reload`
* `webpods proxy deploy` (optional)

#### Maintenance

* `webpods cleanup`
* `webpods prune`
* `webpods doctor`
* `webpods lock` / `webpods unlock` (optional)

### 6.3 Common Flags (Docker-like)

* `-c, --context <name>`
* `-f, --file <compose.yml>` (repeatable)
* `-p, --project-name <name>`
* `--env-file <path>`
* `-d, --detach`
* `--no-build` / `--build`
* `--scale svc=n` (repeatable)
* `--hosts h1,h2` (target subset)
* `--confirm <token>` (guarded confirmation)
* `--from local|ci` (origin override)

### 6.4 Required Target Banner

Every remote-mutating command prints:

* context
* safety level
* provider (if set)
* project
* hosts
  Example:

```
TARGET: production [GUARDED]  PROVIDER: aws  PROJECT: payments-api  HOSTS: prod-1,prod-2,prod-3
```

---

## 7. Multi-Project Isolation on Shared Hosts (Mandatory)

### 7.1 Requirement

A single set of servers must safely host **multiple apps** developed by multiple teams. Every operation must be scoped to the correct **(context, project)**.

### 7.2 Project ID Resolution

Project ID resolution order:

1. `--project-name/-p`
2. Compose `name:`
3. directory name

This project ID is used for namespacing containers, ports, state, and proxy config.

### 7.3 Container Labels (Authoritative)

Every container created/managed by Webpods MUST include:

* `webpods.context=<context>`
* `webpods.project=<project>`
* `webpods.service=<service>`
* `webpods.release=<release_id>`
* `webpods.replica=<replica_id>` (for multi-replica services)

**Rule:** `down/rm/cleanup/prune` must only affect containers/images/blobs matching **both** `webpods.context` and `webpods.project`.

Names are for readability only; **labels are authoritative**.

### 7.4 Remote State Namespacing

State directories are per (context, project):

* `/var/lib/webpods/state/<context>/<project>/state.json`

Remote cache may be partitioned similarly:

* `/var/lib/webpods/cache/<context>/<project>/...` (or a shared blob dir with ref tracking; either is fine as long as pruning is project-scoped by default)

Proxy config snippets are per (context, project):

* e.g. `/etc/caddy/apps/<context>/<project>.caddy`
* e.g. `/etc/traefik/dynamic/<context>/<project>.yml`

### 7.5 Port Allocation Must Be Project-Aware

Host port allocation must incorporate:

* context + project + service
  to prevent collisions between apps.

### 7.6 Ingress Domain Collision Detection

If two projects in the same context attempt to claim the same `Host(...)` domain, Webpods must:

* detect during `diff`/`up`
* refuse by default with a clear error

### 7.7 Scope of Destructive Commands

* `down`: only the target project’s containers and project proxy routes
* `cleanup`: only the target project’s old releases/containers
* `prune`: by default only blobs/images not referenced by this project’s retained releases

A global prune (all projects) must be a separate, explicit command and should require confirmation regardless of safety level (optional v2; recommended).

---

## 8. Compose Interpretation Rules

### 8.1 Supported Compose Features (v1)

* `services`
* `image` and `build`
* `environment`, `env_file`
* `ports`, `expose`
* `volumes`, `networks`
* `depends_on` (ordering hint only)
* `healthcheck`
* `deploy.replicas` (read)
* `deploy.update_config` (optional)
* `deploy.restart_policy` (optional)
* extension fields `x-*` (Webpods reads some)

### 8.2 Replicas Semantics

Primary:

* `services.<svc>.deploy.replicas`

Overrides:

* CLI `--scale svc=n` overrides compose for that invocation

If service replicas undefined:

* default replicas = 1 (unless service is constrained by `x-placement` with implied behavior; still 1)

### 8.3 Placement / Host Eligibility (v1 Canonical)

Use extension field:

* `services.<svc>.x-placement`

Schema:

```yaml
x-placement:
  hosts: [s1, s2]         # optional list of host names
  strategy: spread        # spread|pack (spread default)
  max_per_host: 3         # optional cap
  min_hosts: 2            # optional requirement
```

Eligibility:

* if `hosts` provided: eligible = that list ∩ context hosts
* else: eligible = all context hosts

Errors:

* eligible empty → fail deploy
* if `min_hosts` set and available eligible < min_hosts → fail deploy

### 8.4 Replica Distribution Across Hosts

Default strategy: `spread`.

Spread algorithm:

* `H = eligible hosts count`
* `R = replicas`
* base = `floor(R/H)` each
* distribute remainder `R%H` to hosts in stable deterministic order

Host order must be stable:

* recommended: inventory order; if not, sorted by host name.

Respect `max_per_host`:

* if placement cannot satisfy `R`, fail with clear message.

### 8.5 Stateful Service Warnings

If a service uses named volumes and `replicas > 1`, emit warning by default:

* “Service X uses persistent volume(s) and replicas>1 may be unsafe unless designed for it.”

Warnings do not block v1 unless a strict mode exists.

---

## 9. Networking Model (Option 1)

### 9.1 Routing Contract

Webpods uses host-level published ports so proxies route to:

* `host_ip:published_port`

No assumptions about container IP reachability across hosts.

### 9.2 Published Port Binding

For proxied services, publish per replica:

* `127.0.0.1:<host_port>:<container_port>`

This ensures only the node-local proxy can access it on localhost.

Other nodes reach it by targeting:

* `<host.mesh_ip>:<host_port>` if `mesh_ip` exists
* else `<host.addr>:<host_port>`

### 9.3 Upstream Source of Truth

Upstreams are generated from Webpods state:

* placement decisions + allocated ports
  No runtime discovery of container IPs is required.

---

## 10. Port Allocation Spec

### 10.1 Requirements

* deterministic enough to avoid collisions
* stable across redeploys when possible
* supports multiple replicas per host
* avoids collisions across **(context, project, service)**

### 10.2 Recommended Scheme (v1)

Each `(context, project, service)` gets a port “block” on each host:

* block size: 100 ports
* block base computed deterministically:

  * base_range_start + (hash(context, project, service) % N) rounded to nearest 100
* replica ports within the block allocated sequentially and persisted in state for stability

### 10.3 Collision Handling

If chosen port is already in use:

* try next available port in the block
* if exhausted, fail

---

## 11. Proxy Integration

### 11.1 Proxy Driver Interface

Drivers must support:

* render config for routes + upstreams
* apply config (reload or API)

Optional:

* health checks directives
* graceful draining

### 11.2 Supported Drivers (Target)

* Caddy (file + reload)
* Traefik (dynamic file provider)
* kamal-proxy (if manageable)
* none

### 11.3 Ingress Definition in Compose

Use `x-ingress` extension:

```yaml
services:
  gateway:
    x-ingress:
      host: "api.example.com"
      port: 8080
      health_path: "/healthz"
```

Rules:

* no `x-ingress` → no proxy exposure
* domain collisions across projects must be detected and refused by default

### 11.4 Generated Config Examples

Caddy:

```caddyfile
api.example.com {
  reverse_proxy {
    to 10.10.0.12:18080 10.10.0.13:18080
    health_uri /healthz
    health_interval 5s
    health_timeout 2s
    lb_policy round_robin
  }
}
```

Traefik dynamic file:

```yaml
http:
  routers:
    app-gateway:
      rule: Host(`api.example.com`)
      entryPoints: [websecure]
      service: app-gateway-svc
      tls: {}
  services:
    app-gateway-svc:
      loadBalancer:
        servers:
          - url: "http://10.10.0.12:18080"
          - url: "http://10.10.0.13:18080"
        healthCheck:
          path: "/healthz"
          interval: "5s"
          timeout: "2s"
```

### 11.5 Reload Semantics

v1 acceptable:

* write config atomically + reload
* health checks prevent routing to bad upstreams

---

## 12. Registry-less Image Distribution

### 12.1 Problem

Not all images change every deploy. Webpods must not resend unchanged images.

### 12.2 Solution: Content-Addressed Blob Store (OCI-like)

* build/export produces blobs addressed by sha256
* hosts cache blobs
* shipping uses digest comparison and transfers only missing blobs
* import into Docker uses local cached blobs

### 12.3 Artifact Pipeline (v1)

For each service image:

1. build locally if `build:` present and build requested
2. compute/record image digest (manifest digest)
3. export image to local artifact store (OCI layout or equivalent)
4. for each host that needs it:

   * transfer missing blobs to `<remote_cache_dir>`
5. import image into Docker on host (no pull):

   * via helper method (e.g., skopeo) to `docker-daemon:...`
6. tag image for release use (by digest or deterministic release tag)

### 12.4 Remote Cache Layout

On host:

* `<remote_cache_dir>/blobs/sha256/<hash>`
* `<remote_cache_dir>/refs/...` mapping to manifests
* per-project retained release references to support pruning

### 12.5 Skip Rules

If desired digest == currently deployed digest AND config unchanged:

* do not ship
* do not import
* do not restart

If config changed but digest same:

* restart/update containers as required

### 12.6 Integrity and Retries

* verify sha256 for transferred blobs
* retry failed transfers
* bounded concurrency

### 12.7 Failure Semantics

v1 recommended:

* if required ship/import fails to a host needed for placement, fail deploy
* keep existing release running

---

## 13. Deployment / Rollout Behavior

### 13.1 What `webpods up` Does (Remote)

1. resolve context (explicit or default)
2. parse compose + overlays + env
3. compute desired replicas, placement, ingress
4. build/package as needed
5. push blobs to hosts as needed
6. import images to Docker on hosts as needed
7. create/update containers for new release
8. health gate
9. update proxy config + reload
10. mark release active
11. cleanup older releases per retention policy

`deploy` may alias `up`.

### 13.2 Container Identification

Containers must have labels:

* `webpods.context`
* `webpods.project`
* `webpods.service`
* `webpods.release`
* `webpods.replica`

### 13.3 Health Checks

Sources:

* Compose `healthcheck`
* `x-ingress.health_path` (optional)
  If healthchecks exist:
* new instances must become healthy within timeout or deploy fails.

### 13.4 Rolling Updates

Default: rolling, start-first where possible for ingress services.
If port conflicts prevent start-first, fall back to stop-first with warning.

---

## 14. `diff` and Output Requirements

### 14.1 `webpods diff` Must Show

Per service:

* current vs desired digest
* whether build will run
* whether ship will run (and target hosts)
* restart/update actions
* replicas/placement changes
* proxy route changes

### 14.2 Banner and One-liner

* Always print banner for remote-mutating commands.
* If `-c` omitted and resolved context != `dev`, print:

  * `Using default context: <ctx> (from .webpods/config.yml)`

---

## 15. Rollback

### 15.1 Rollback Definition

Rollback restores a previous release for the same (context, project):

* containers revert to old digests/config
* proxy routes revert
* mark old release active

### 15.2 Command

* `webpods rollback`
* `webpods rollback --to <release_id>`

Guarded confirmations apply if rollback is listed in `confirm.required_for` (not in default guarded set unless specified).

---

## 16. Safety System

### 16.1 Safe vs Guarded

* safe: no confirmations by default
* guarded: confirmations required for destructive commands

### 16.2 Default Guarded Confirm Set

If not specified:

* `down`, `rm`, `prune`, `cleanup`

### 16.3 Confirmation Contract

When required:

* refuse unless `--confirm <token>` supplied
* token default = context name unless configured

### 16.4 allow_from

* enforce allowed origins (`local` vs `ci`)
* origin detection described earlier

---

## 17. Node Management & Bootstrap

### 17.1 Host Requirements

* Docker Engine installed and running
* SSH access
* disk space for images + cache

### 17.2 `node check`

* SSH connectivity
* docker available
* disk space
* required dirs/perms
* helper capability presence

### 17.3 `node bootstrap`

Idempotent:

* create `/var/lib/webpods` dirs
* prepare cache dirs
* ensure docker permissions
* optionally set up proxy prerequisites if managed

---

## 18. Day-2 Operations

### 18.1 `ps`

Lists project containers across hosts; supports filtering by service/host/release.

### 18.2 `logs`

Supports:

* follow
* since
* host
* replica

### 18.3 `exec`

If multiple replicas:

* require `--host` or `--replica`, or pick deterministically and print which was chosen.

---

## 19. Cleanup and Pruning

### 19.1 `cleanup` (Project-scoped)

Removes old containers/releases for this project only, respecting retention.

### 19.2 `prune` (Project-scoped by default)

Prunes only blobs/images unreferenced by this project’s retained releases.

Global prune is a separate explicit command (recommended future), always confirmed.

Guarded confirmations apply to cleanup/prune per context safety.

---

## 20. State Storage

### 20.1 Remote State

Authoritative per (context, project):

* `/var/lib/webpods/state/<context>/<project>/state.json`

Contains:

* releases
* active release
* per-service digests
* placement and port allocations
* proxy config references

### 20.2 Consistency Across Hosts

v1 acceptable:

* designate a primary state host (first in inventory)
* write state there, replicate to others
* if mismatch detected, warn; reconcile can be v2

### 20.3 Local Cache

Local artifacts and optional snapshots:

* blob cache
* last-known digests
* last known remote state snapshot

---

## 21. Error Handling and Determinism

### 21.1 Fail-Fast

* required host shipping/import failure → fail deploy
* proxy apply failure → fail deploy
* health gate failure → fail deploy, keep old release running

### 21.2 Deterministic Behavior

* placement deterministic given same inputs
* port allocation stable when possible (persist mapping in state)

---

## 22. End-to-End Example

### 22.1 Compose snippet

```yaml
services:
  users:
    image: ghcr.io/acme/users:latest
    deploy: { replicas: 3 }
    x-placement:
      hosts: [s1, s2]

  gateway:
    image: ghcr.io/acme/gateway:latest
    deploy: { replicas: 2 }
    x-ingress:
      host: api.example.com
      port: 8080
      health_path: /healthz
```

### 22.2 Behavior

* users eligible hosts s1,s2; replicas 3 → s1:2 s2:1
* gateway eligible all; replicas 2 → distributed
* proxy upstreams are host.mesh_ip:allocated_port

---

## 23. Implementation Checklist (v1 Milestones)

1. Context/config loading (`.webpods/config.yml` + contexts)
2. Safety: safe/guarded defaults + allow_from + confirm
3. Compose parse + overlay merge + env resolution
4. Multi-project isolation: labels + scoping for all commands
5. Placement + deterministic port allocation (context+project+service aware)
6. Registry-less artifact export + remote blob cache + import
7. Container create/update logic + health gating
8. Proxy driver (start with Caddy or Traefik)
9. Releases/state persistence + rollback
10. Day-2 ops (ps/logs/exec)
11. Cleanup/prune project-scoped

---

## 24. Final User Contract (No Ambiguity)

* Developers deploy using their Compose files; Webpods adds only minimal `x-*` fields.
* Webpods feels like Docker: `up/down/ps/logs/exec/build/images/push`.
* Context selection is explicit via `-c`, with a repo-local default in `.webpods/config.yml`.
* There is no `context use`. Changing default context requires editing the file.
* If default context is used and it’s not `dev`, Webpods prints a one-liner stating so.
* Guarded contexts require `--confirm <token>` for destructive commands (defaults apply if not specified).
* Registry-less shipping does not resend unchanged images/layers; only missing blobs are transferred.
* Load balancing uses `host:published_port` and is driven by generated proxy configs.
* Multiple apps can share the same servers; all destructive operations are scoped to the app’s (context, project) namespace using labels and namespaced state/config directories.

---

