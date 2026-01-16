import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));

const tsonicConfigPath = join(projectRoot, "tsonic.json");
const config = readJson(tsonicConfigPath);

const packageRefs = config.dotnet?.packageReferences ?? [];
if (!Array.isArray(packageRefs) || packageRefs.length === 0) process.exit(0);

const outputName = config.outputName ?? config.output?.name ?? "app";
const targetFramework = config.output?.targetFrameworks?.[0] ?? config.dotnetVersion ?? "net10.0";
const distDir = join(projectRoot, "dist", targetFramework);
mkdirSync(distDir, { recursive: true });

const assetsPath = join(projectRoot, "generated", "obj", "project.assets.json");
if (!existsSync(assetsPath)) process.exit(0);

const assets = readJson(assetsPath);
const packageFolders = assets.packageFolders ? Object.keys(assets.packageFolders) : [];
const packageRoot = packageFolders.length > 0 ? packageFolders[0] : undefined;
const targets = assets.targets ?? {};
const targetKey = Object.keys(targets).find((k) => k.startsWith(targetFramework)) ?? Object.keys(targets)[0];
const libraries = assets.libraries ?? {};

if (!packageRoot || !targetKey) process.exit(0);

const findLibKey = (id, version) => {
  const wanted = `${id}/${version}`.toLowerCase();
  for (const k of Object.keys(libraries)) {
    if (k.toLowerCase() === wanted) return k;
  }
  return undefined;
};

for (const ref of packageRefs) {
  const id = ref?.id;
  const version = ref?.version;
  if (typeof id !== "string" || typeof version !== "string") continue;

  const libKey = findLibKey(id, version);
  if (!libKey) continue;

  const libMeta = libraries[libKey];
  if (!libMeta?.path) continue;

  const targetLib = targets[targetKey]?.[libKey];
  const compile = targetLib?.compile ?? {};

  for (const relPath of Object.keys(compile)) {
    if (!relPath.toLowerCase().endsWith(".dll")) continue;
    const full = join(packageRoot, libMeta.path, relPath);
    const dest = join(distDir, basename(full));
    if (!existsSync(full)) continue;
    copyFileSync(full, dest);
  }
}

// Keep reference to outputName to make intent explicit in this script.
void outputName;
