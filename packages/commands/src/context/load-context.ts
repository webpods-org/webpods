import { File, Path } from "@tsonic/dotnet/System.IO.js";
import { Int32 } from "@tsonic/dotnet/System.js";
import { List } from "@tsonic/dotnet/System.Collections.Generic.js";
import type { int } from "@tsonic/core/types.js";
import { ContextConfig, ContextHost, ContextHostLabel, ContextLoadResult } from "./models.js";
import {
  asYamlMapping,
  asYamlScalar,
  parseYamlRootMapping,
  tryGetChildMapping,
  tryGetChildSequence,
  tryGetMappingValue,
  tryGetString,
  tryGetStringArray,
} from "../yaml/yaml.js";

const isSafeContextName = (name: string): boolean => {
  const trimmed = name.trim();
  if (trimmed === "") return false;
  if (trimmed.indexOf("/") >= 0) return false;
  if (trimmed.indexOf("\\") >= 0) return false;
  if (trimmed.indexOf("..") >= 0) return false;
  return true;
};

const parseInt = (value: string): int | undefined => {
  let parsed: int = 0;
  const ok = Int32.tryParse(value, parsed);
  return ok ? parsed : undefined;
};

export const loadContextConfig = (repoRoot: string, contextName: string): ContextLoadResult => {
  if (!isSafeContextName(contextName)) {
    return ContextLoadResult.fail(`Invalid context name: '${contextName}'.`);
  }

  const contextPath = Path.combine(repoRoot, ".webpods", "contexts", `${contextName}.yml`);
  if (!File.exists(contextPath)) return ContextLoadResult.fail(`Context not found: ${contextPath}`);

  const text = File.readAllText(contextPath);
  const parsedRoot = parseYamlRootMapping(text);
  if (!parsedRoot.success || parsedRoot.root === undefined) return ContextLoadResult.fail(parsedRoot.error ?? "Invalid YAML.");

  const root = parsedRoot.root;

  const declaredName = tryGetString(root, "name");
  if (declaredName === undefined) return ContextLoadResult.fail(`Missing required field: name (in ${contextPath})`);
  if (declaredName !== contextName) {
    return ContextLoadResult.fail(`Context name mismatch: file '${contextName}.yml' declares name '${declaredName}'.`);
  }

  const ctx = new ContextConfig(declaredName);

  ctx.provider = tryGetString(root, "provider");

  const sshMap = tryGetChildMapping(root, "ssh");
  if (sshMap !== undefined) {
    ctx.ssh.user = tryGetString(sshMap, "user");
    const portText = tryGetString(sshMap, "port");
    if (portText !== undefined) {
      const p = parseInt(portText);
      if (p === undefined) return ContextLoadResult.fail(`Invalid ssh.port: ${portText}`);
      ctx.ssh.port = p;
    }
    ctx.ssh.key = tryGetString(sshMap, "key");
    ctx.ssh.bastion = tryGetString(sshMap, "bastion");

    const timeoutText = tryGetString(sshMap, "connect_timeout_seconds");
    if (timeoutText !== undefined) {
      const t = parseInt(timeoutText);
      if (t === undefined) return ContextLoadResult.fail(`Invalid ssh.connect_timeout_seconds: ${timeoutText}`);
      ctx.ssh.connectTimeoutSeconds = t;
    }
  }

  const hostsSeq = tryGetChildSequence(root, "hosts");
  if (hostsSeq === undefined) return ContextLoadResult.fail("Missing required field: hosts");

  const hosts = new List<ContextHost>();
  const hostIt = hostsSeq.children.getEnumerator();
  while (hostIt.moveNext()) {
    const node = hostIt.current;
    const hostMap = asYamlMapping(node);
    if (hostMap === undefined) continue;

    const hostName = tryGetString(hostMap, "name");
    const hostAddr = tryGetString(hostMap, "addr");
    if (hostName === undefined || hostAddr === undefined) {
      return ContextLoadResult.fail("Each host must define name and addr.");
    }
    const host = new ContextHost(hostName, hostAddr);
    host.meshIP = tryGetString(hostMap, "mesh_ip");

    const labelsNode = tryGetMappingValue(hostMap, "labels");
    if (labelsNode !== undefined) {
      const labelsMap = asYamlMapping(labelsNode);
      if (labelsMap !== undefined) {
        const labels = new List<ContextHostLabel>();
        const labelsIt = labelsMap.children.getEnumerator();
        while (labelsIt.moveNext()) {
          const pair = labelsIt.current;
          const k = asYamlScalar(pair.key);
          const v = asYamlScalar(pair.value);
          if (k === undefined || v === undefined) continue;
          const rawKey = k.value ?? "";
          const key = rawKey.trim();
          const rawValue = v.value ?? "";
          const value = rawValue.trim();
          if (key !== "") labels.add(new ContextHostLabel(key, value));
        }
        host.labels = labels.toArray();
      }
    }

    hosts.add(host);
  }

  ctx.hosts = hosts.toArray();

  if (ctx.hosts.length === 0) return ContextLoadResult.fail("Context hosts list is empty.");

  const defaultsMap = tryGetChildMapping(root, "defaults");
  if (defaultsMap !== undefined) {
    const composeFiles = tryGetStringArray(defaultsMap, "compose_files");
    if (composeFiles !== undefined) ctx.defaults.composeFiles = composeFiles;
    ctx.defaults.envFile = tryGetString(defaultsMap, "env_file");
    ctx.defaults.projectName = tryGetString(defaultsMap, "project_name");
  }

  const proxyMap = tryGetChildMapping(root, "proxy");
  if (proxyMap !== undefined) {
    ctx.proxy.driver = tryGetString(proxyMap, "driver");
    const domains = tryGetStringArray(proxyMap, "domains");
    if (domains !== undefined) ctx.proxy.domains = domains;
  }

  const artifactsMap = tryGetChildMapping(root, "artifacts");
  if (artifactsMap !== undefined) {
    ctx.artifacts.mode = tryGetString(artifactsMap, "mode");
    ctx.artifacts.remoteCacheDir = tryGetString(artifactsMap, "remote_cache_dir");

    const concurrencyText = tryGetString(artifactsMap, "concurrency");
    if (concurrencyText !== undefined) {
      const n = parseInt(concurrencyText);
      if (n === undefined) return ContextLoadResult.fail(`Invalid artifacts.concurrency: ${concurrencyText}`);
      ctx.artifacts.concurrency = n;
    }

    const retainText = tryGetString(artifactsMap, "retain_releases");
    if (retainText !== undefined) {
      const n = parseInt(retainText);
      if (n === undefined) return ContextLoadResult.fail(`Invalid artifacts.retain_releases: ${retainText}`);
      ctx.artifacts.retainReleases = n;
    }
  }

  const safetyMap = tryGetChildMapping(root, "safety");
  if (safetyMap !== undefined) {
    const level = tryGetString(safetyMap, "level");
    if (level !== undefined) ctx.safety.level = level;

    const allowFrom = tryGetStringArray(safetyMap, "allow_from");
    if (allowFrom !== undefined && allowFrom.length > 0) ctx.safety.allowFrom = allowFrom;

    const confirmMap = tryGetChildMapping(safetyMap, "confirm");
    if (confirmMap !== undefined) {
      const requiredFor = tryGetStringArray(confirmMap, "required_for");
      if (requiredFor !== undefined) ctx.safety.confirm.requiredFor = requiredFor;
      ctx.safety.confirm.token = tryGetString(confirmMap, "token");
    }
  }

  // Safety defaults
  if (ctx.safety.allowFrom.length === 0) ctx.safety.allowFrom = ["local", "ci"];

  const levelLower = ctx.safety.level.toLowerInvariant();
  if (levelLower !== "safe" && levelLower !== "guarded") {
    return ContextLoadResult.fail(`Invalid safety.level: ${ctx.safety.level} (expected safe|guarded)`);
  }
  ctx.safety.level = levelLower;

  if (ctx.safety.level === "guarded") {
    if (ctx.safety.confirm.requiredFor.length === 0) {
      ctx.safety.confirm.requiredFor = ["down", "rm", "prune", "cleanup"];
    }
    if (ctx.safety.confirm.token === undefined) ctx.safety.confirm.token = ctx.name;
  }

  return ContextLoadResult.ok(ctx);
};
