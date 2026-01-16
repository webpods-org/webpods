import { Directory, File, Path } from "@tsonic/dotnet/System.IO.js";
import { List } from "@tsonic/dotnet/System.Collections.Generic.js";
import { parseYamlRootMapping, tryGetString } from "./yaml/yaml.js";

const WEBPODS_DIR_NAME = ".webpods";
const CONTEXTS_DIR_NAME = "contexts";
const REPO_CONFIG_FILE_NAME = "config.yml";

export const tryGetRepoRoot = (startDir: string): string | undefined => {
  let current = Path.getFullPath(startDir);

  while (true) {
    const candidate = Path.combine(current, WEBPODS_DIR_NAME);
    if (Directory.exists(candidate)) return current;

    const parent = Path.getDirectoryName(current);
    if (parent === undefined || parent === "" || parent === current) return undefined;
    current = parent;
  }
};

export const listContextNames = (repoRoot: string): string[] => {
  const contextsDir = Path.combine(repoRoot, WEBPODS_DIR_NAME, CONTEXTS_DIR_NAME);
  if (!Directory.exists(contextsDir)) return [];

  const files = Directory.getFiles(contextsDir, "*.yml");
  const names = new List<string>();

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]!;
    const base = Path.getFileNameWithoutExtension(filePath);
    if (base !== undefined && base.trim() !== "") names.add(base);
  }

  return names.toArray();
};

export const tryReadDefaultContext = (repoRoot: string): string | undefined => {
  const path = Path.combine(repoRoot, WEBPODS_DIR_NAME, REPO_CONFIG_FILE_NAME);
  if (!File.exists(path)) return undefined;

  const text = File.readAllText(path);
  const parsed = parseYamlRootMapping(text);
  if (!parsed.success || parsed.root === undefined) return undefined;
  return tryGetString(parsed.root, "default_context");
};
