import { Environment } from "@tsonic/dotnet/System.js";
import { List } from "@tsonic/dotnet/System.Collections.Generic.js";
import { console } from "@tsonic/js/index.js";
import { Webpods } from "@webpods/commands/Webpods.Commands.js";
import {
  ContextArtifacts,
  ContextConfig,
  ContextDefaults,
  ContextHost,
  ContextHostLabel,
  ContextLoadResult,
  ContextProxy,
  ContextSafety,
  ContextSafetyConfirm,
  ContextSSHConfig,
} from "@webpods/commands/Webpods.Commands.Context.js";
import { NodeCheckResult } from "@webpods/commands/Webpods.Commands.Node.js";

const logLine = (message: string): void => {
  console.log(message);
};

const logErrorLine = (message: string): void => {
  console.error(message);
};

const usage = (): void => {
  logLine("webpods - Compose-first SSH deployments (Tsonic)");
  logLine("");
  logLine("USAGE:");
  logLine("  webpods [--help] [--version]");
  logLine("  webpods context ls");
  logLine("  webpods context inspect <name>");
  logLine("  webpods <command> -c <context> [options]");
  logLine("");
  logLine("GLOBAL OPTIONS:");
  logLine("  -c, --context <name>     Context name (from .webpods/contexts/<name>.yml)");
  logLine("  --from <origin>          Origin override (local|ci)");
  logLine("");
  logLine("COMMANDS (v1 scaffold):");
  logLine("  context ls               List available contexts");
  logLine("  context inspect <name>   Show context details");
  logLine("  node check               Check SSH + Docker on hosts");
  logLine("");
  logLine("SPEC:");
  logLine("  See .analysis/spec.md");
};

const toArgs = (argv: string[]): string[] => {
  const argsList = new List<string>();
  for (let i = 1; i < argv.length; i++) argsList.add(argv[i]!);
  return argsList.toArray();
};

const tryGetFlagValue = (args: string[], longName: string, shortName: string): string | undefined => {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if ((a === longName || a === shortName) && i + 1 < args.length) return args[i + 1]!;
  }
  return undefined;
};

const joinComma = (values: string[]): string => {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    if (i > 0) out += ",";
    out += values[i]!;
  }
  return out;
};

const isHelpFlag = (arg: string): boolean => arg === "-h" || arg === "--help" || arg === "help";
const isVersionFlag = (arg: string): boolean => arg === "-v" || arg === "--version" || arg === "version";

const requireRepoRoot = (): string | undefined => {
  const cwd = Environment.currentDirectory;
  const repoRoot = Webpods.tryGetRepoRoot(cwd);
  if (repoRoot !== undefined) return repoRoot;
  logErrorLine("No .webpods directory found (walked up from current directory).");
  logErrorLine("Create .webpods/config.yml and .webpods/contexts/<name>.yml per the spec.");
  return undefined;
};

export function main(): void {
  const argv = Environment.getCommandLineArgs();
  const args = toArgs(argv);

  const first = args.length > 0 ? args[0]! : "";
  if (first === "" || first.indexOf("-") === 0) {
    let wantsHelp = false;
    for (let i = 0; i < args.length; i++) {
      if (isHelpFlag(args[i]!)) {
        wantsHelp = true;
        break;
      }
    }
    if (wantsHelp) {
      usage();
      return;
    }

    let wantsVersion = false;
    for (let i = 0; i < args.length; i++) {
      if (isVersionFlag(args[i]!)) {
        wantsVersion = true;
        break;
      }
    }
    if (wantsVersion) {
      logLine(Webpods.version());
      return;
    }
  }

  if (isHelpFlag(first)) {
    usage();
    return;
  }

  if (isVersionFlag(first)) {
    logLine(Webpods.version());
    return;
  }

  if (first === "context") {
    const sub = args.length > 1 ? args[1]! : "";
    if (sub === "ls") {
      const repoRootForContextLs = requireRepoRoot();
      if (repoRootForContextLs === undefined) {
        Environment.exitCode = 2;
        return;
      }
      const contexts = Webpods.listContextNames(repoRootForContextLs);
      if (contexts.length === 0) {
        logLine("(no contexts found)");
        return;
      }
      for (let i = 0; i < contexts.length; i++) logLine(contexts[i]!);
      return;
    }

    if (sub === "inspect") {
      if (args.length < 3) {
        logErrorLine("Missing <name> for `webpods context inspect`");
        Environment.exitCode = 2;
        return;
      }
      const name = args[2]!;
      const repoRootForInspect = requireRepoRoot();
      if (repoRootForInspect === undefined) {
        Environment.exitCode = 2;
        return;
      }

      const loaded = Webpods.loadContext(repoRootForInspect, name);
      if (!loaded.success || loaded.context === undefined) {
        logErrorLine(loaded.error ?? "Failed to load context.");
        Environment.exitCode = 2;
        return;
      }

      const contextConfig = loaded.context;
      logLine(`name: ${contextConfig.name}`);
      if (contextConfig.provider !== undefined) logLine(`provider: ${contextConfig.provider}`);
      logLine(`safety: ${contextConfig.safety.level}`);
      logLine(`allow_from: ${joinComma(contextConfig.safety.allowFrom)}`);
      if (contextConfig.safety.level === "guarded") {
        logLine(`confirm.token: ${contextConfig.safety.confirm.token ?? contextConfig.name}`);
        if (contextConfig.safety.confirm.requiredFor.length > 0) {
          logLine(`confirm.required_for: ${joinComma(contextConfig.safety.confirm.requiredFor)}`);
        }
      }

      const sshUser = contextConfig.ssh.user;
      const sshPort = contextConfig.ssh.port;
      const sshKey = contextConfig.ssh.key;
      const sshBastion = contextConfig.ssh.bastion;
      const sshTimeout = contextConfig.ssh.connectTimeoutSeconds;

      if (sshUser !== undefined || sshPort !== undefined || sshKey !== undefined || sshBastion !== undefined || sshTimeout !== undefined) {
        logLine("ssh:");
        if (sshUser !== undefined) logLine(`  user: ${sshUser}`);
        if (sshPort !== undefined) logLine(`  port: ${sshPort}`);
        if (sshKey !== undefined) logLine(`  key: ${sshKey}`);
        if (sshBastion !== undefined) logLine(`  bastion: ${sshBastion}`);
        if (sshTimeout !== undefined) logLine(`  connect_timeout_seconds: ${sshTimeout}`);
      }

      logLine("hosts:");
      for (let i = 0; i < contextConfig.hosts.length; i++) {
        const h = contextConfig.hosts[i]!;
        let line = `  - ${h.name} (${h.addr})`;
        const mesh = h.meshIP;
        if (mesh !== undefined) line += ` mesh_ip=${mesh}`;
        if (h.labels.length > 0) {
          line += " labels=";
          for (let j = 0; j < h.labels.length; j++) {
            if (j > 0) line += ",";
            const l = h.labels[j]!;
            line += `${l.key}=${l.value}`;
          }
        }
        logLine(line);
      }

      if (
        contextConfig.defaults.composeFiles.length > 0 ||
        contextConfig.defaults.envFile !== undefined ||
        contextConfig.defaults.projectName !== undefined
      ) {
        logLine("defaults:");
        if (contextConfig.defaults.projectName !== undefined) logLine(`  project_name: ${contextConfig.defaults.projectName}`);
        if (contextConfig.defaults.envFile !== undefined) logLine(`  env_file: ${contextConfig.defaults.envFile}`);
        if (contextConfig.defaults.composeFiles.length > 0) {
          logLine(`  compose_files: ${joinComma(contextConfig.defaults.composeFiles)}`);
        }
      }

      if (contextConfig.proxy.driver !== undefined || contextConfig.proxy.domains.length > 0) {
        logLine("proxy:");
        if (contextConfig.proxy.driver !== undefined) logLine(`  driver: ${contextConfig.proxy.driver}`);
        if (contextConfig.proxy.domains.length > 0) logLine(`  domains: ${joinComma(contextConfig.proxy.domains)}`);
      }

      if (
        contextConfig.artifacts.mode !== undefined ||
        contextConfig.artifacts.remoteCacheDir !== undefined ||
        contextConfig.artifacts.concurrency !== undefined ||
        contextConfig.artifacts.retainReleases !== undefined
      ) {
        logLine("artifacts:");
        if (contextConfig.artifacts.mode !== undefined) logLine(`  mode: ${contextConfig.artifacts.mode}`);
        if (contextConfig.artifacts.remoteCacheDir !== undefined) {
          logLine(`  remote_cache_dir: ${contextConfig.artifacts.remoteCacheDir}`);
        }
        if (contextConfig.artifacts.concurrency !== undefined) logLine(`  concurrency: ${contextConfig.artifacts.concurrency}`);
        if (contextConfig.artifacts.retainReleases !== undefined) {
          logLine(`  retain_releases: ${contextConfig.artifacts.retainReleases}`);
        }
      }

      return;
    }

    logErrorLine("Unknown context subcommand.");
    usage();
    Environment.exitCode = 2;
    return;
  }

  if (first === "node") {
    const sub = args.length > 1 ? args[1]! : "";
    if (sub === "check") {
      const repoRootForNodeCheck = requireRepoRoot();
      if (repoRootForNodeCheck === undefined) {
        Environment.exitCode = 2;
        return;
      }

      const explicitContextForNodeCheck = tryGetFlagValue(args, "--context", "-c");
      const defaultContextForNodeCheck = Webpods.tryReadDefaultContext(repoRootForNodeCheck);
      const ctxName = (explicitContextForNodeCheck ?? defaultContextForNodeCheck) ?? "";
      if (ctxName.trim() === "") {
        logErrorLine("Missing context: pass -c/--context, or set default_context in .webpods/config.yml.");
        Environment.exitCode = 2;
        return;
      }

      if (explicitContextForNodeCheck === undefined && defaultContextForNodeCheck !== undefined && defaultContextForNodeCheck !== "dev") {
        logLine(`Using default context: ${defaultContextForNodeCheck} (from .webpods/config.yml)`);
      }

      const fromOverride = tryGetFlagValue(args, "--from", "--from") ?? "";
      const result = Webpods.nodeCheck(repoRootForNodeCheck, ctxName, fromOverride);
      if (result.output.trim() !== "") logLine(result.output.trim());
      if (!result.success) {
        logErrorLine(result.error ?? "Node check failed.");
        Environment.exitCode = 2;
      }
      return;
    }

    logErrorLine("Unknown node subcommand.");
    usage();
    Environment.exitCode = 2;
    return;
  }

  const repoRoot = requireRepoRoot();
  if (repoRoot === undefined) {
    Environment.exitCode = 2;
    return;
  }

  const explicitContextForMain = tryGetFlagValue(args, "--context", "-c");
  const defaultContextForMain = Webpods.tryReadDefaultContext(repoRoot);
  const ctx = explicitContextForMain ?? defaultContextForMain;

  if (ctx === undefined || ctx.trim() === "") {
    logErrorLine("Missing context: pass -c/--context, or set default_context in .webpods/config.yml.");
    Environment.exitCode = 2;
    return;
  }

  if (explicitContextForMain === undefined && defaultContextForMain !== undefined && defaultContextForMain !== "dev") {
    logLine(`Using default context: ${defaultContextForMain} (from .webpods/config.yml)`);
  }

  logErrorLine(`Command not implemented yet (ctx=${ctx}).`);
  logErrorLine("Start with: webpods context ls");
  Environment.exitCode = 2;
}
