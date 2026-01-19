import { Directory, File, Path } from "@tsonic/dotnet/System.IO.js";
import { List } from "@tsonic/dotnet/System.Collections.Generic.js";
import { parseYamlRootMapping, tryGetString } from "./yaml/yaml.js";

const WEBPODS_DIR_NAME = ".webpods";
const CONTEXTS_DIR_NAME = "contexts";
const REPO_CONFIG_FILE_NAME = "config.yml";

export const tryGetRepoRoot = (startDir: string): string | undefined => {
  let current = Path.GetFullPath(startDir);

  while (true) {
    const candidate = Path.Combine(current, WEBPODS_DIR_NAME);
    if (Directory.Exists(candidate)) return current;

    const parent = Path.GetDirectoryName(current);
    if (parent === undefined || parent === "" || parent === current) return undefined;
    current = parent;
  }
};

export const listContextNames = (repoRoot: string): string[] => {
  const contextsDir = Path.Combine(repoRoot, WEBPODS_DIR_NAME, CONTEXTS_DIR_NAME);
  if (!Directory.Exists(contextsDir)) return [];

  const files = Directory.GetFiles(contextsDir, "*.yml");
  const names = new List<string>();

  for (let i = 0; i < files.Length; i++) {
    const filePath = files[i]!;
    const base = Path.GetFileNameWithoutExtension(filePath);
    if (base !== undefined && base.Trim() !== "") names.Add(base);
  }

  return names.ToArray();
};

export const tryReadDefaultContext = (repoRoot: string): string | undefined => {
  const path = Path.Combine(repoRoot, WEBPODS_DIR_NAME, REPO_CONFIG_FILE_NAME);
  if (!File.Exists(path)) return undefined;

  const text = File.ReadAllText(path);
  const parsed = parseYamlRootMapping(text);
  if (!parsed.success || parsed.root === undefined) return undefined;
  return tryGetString(parsed.root, "default_context");
};
