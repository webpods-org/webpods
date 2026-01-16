import { SSH, SSHConfig, SSHExecRequest } from "@webpods/ssh/Webpods.SSH.js";
import type { int } from "@tsonic/core/types.js";
import { loadContextConfig } from "../context/load-context.js";
import { detectOrigin } from "../origin.js";

export class NodeCheckResult {
  readonly success: boolean;
  readonly output: string;
  readonly error: string | undefined;

  constructor(success: boolean, output: string, error: string | undefined) {
    this.success = success;
    this.output = output;
    this.error = error;
  }

  static ok(output: string): NodeCheckResult {
    return new NodeCheckResult(true, output, undefined);
  }

  static fail(message: string, output?: string): NodeCheckResult {
    return new NodeCheckResult(false, output ?? "", message);
  }
}

export const checkNodes = (repoRoot: string, contextName: string, fromOverride: string | undefined): NodeCheckResult => {
  const loaded = loadContextConfig(repoRoot, contextName);
  if (!loaded.success || loaded.context === undefined) return NodeCheckResult.fail(loaded.error ?? "Failed to load context.");
  const ctx = loaded.context;

  const origin = detectOrigin(fromOverride);
  if (origin !== "local" && origin !== "ci") {
    return NodeCheckResult.fail(`Invalid --from: ${origin} (expected local|ci)`);
  }

  let allowed = false;
  for (let i = 0; i < ctx.safety.allowFrom.length; i++) {
    if (ctx.safety.allowFrom[i] === origin) {
      allowed = true;
      break;
    }
  }

  if (!allowed) {
    let allowedList = "";
    for (let i = 0; i < ctx.safety.allowFrom.length; i++) {
      if (i > 0) allowedList += ",";
      allowedList += ctx.safety.allowFrom[i]!;
    }
    return NodeCheckResult.fail(
      `Refusing: context '${ctx.name}' disallows execution from '${origin}'. Allowed: ${allowedList}.`
    );
  }

  const sshCfg = new SSHConfig();
  sshCfg.user = ctx.ssh.user;
  sshCfg.key = ctx.ssh.key;
  sshCfg.bastion = ctx.ssh.bastion;
  if (ctx.ssh.port !== undefined) sshCfg.setPort(ctx.ssh.port);
  if (ctx.ssh.connectTimeoutSeconds !== undefined) sshCfg.setConnectTimeoutSeconds(ctx.ssh.connectTimeoutSeconds);

  let allOk = true;
  let out = "";

  for (let i = 0; i < ctx.hosts.length; i++) {
    const host = ctx.hosts[i]!;
    const req = new SSHExecRequest(host.addr, ["docker", "version"]);
    req.config = sshCfg;
    const res = SSH.exec(req);

    let line = `${host.name} (${host.addr}): `;
    if (res.exitCode === 0) {
      line += "ok";
    } else {
      allOk = false;
      const code: int = res.exitCode;
      let reason = res.stderr.trim();
      if (reason === "") reason = res.stdout.trim();
      if (reason !== "") {
        line += `FAIL (exit=${code}) ${reason}`;
      } else {
        line += `FAIL (exit=${code})`;
      }
    }
    out += line + "\n";
  }

  if (!allOk) return NodeCheckResult.fail("One or more hosts failed checks.", out);
  return NodeCheckResult.ok(out);
};
