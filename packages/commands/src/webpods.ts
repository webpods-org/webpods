import { listContextNames, tryGetRepoRoot, tryReadDefaultContext } from "./repo.js";
import { loadContextConfig } from "./context/load-context.js";
import { ContextLoadResult } from "./context/models.js";
import { checkNodes, NodeCheckResult } from "./node/node-check.js";
import { VERSION } from "./version.js";

export class Webpods {
  static version(): string {
    return VERSION;
  }

  static tryGetRepoRoot(startDir: string): string | undefined {
    return tryGetRepoRoot(startDir);
  }

  static listContextNames(repoRoot: string): string[] {
    return listContextNames(repoRoot);
  }

  static tryReadDefaultContext(repoRoot: string): string | undefined {
    return tryReadDefaultContext(repoRoot);
  }

  static loadContext(repoRoot: string, contextName: string): ContextLoadResult {
    return loadContextConfig(repoRoot, contextName);
  }

  static nodeCheck(repoRoot: string, contextName: string, fromOverride: string | undefined): NodeCheckResult {
    return checkNodes(repoRoot, contextName, fromOverride);
  }
}
