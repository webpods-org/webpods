import { Exception } from "@tsonic/dotnet/System.js";
import { StringReader } from "@tsonic/dotnet/System.IO.js";
import { List } from "@tsonic/dotnet/System.Collections.Generic.js";
import {
  YamlDocument,
  YamlMappingNode,
  YamlNode,
  YamlNodeType,
  YamlScalarNode,
  YamlSequenceNode,
  YamlStream,
} from "yaml-dot-net-types/YamlDotNet.RepresentationModel.js";

const normalizeYamlKey = (key: string): string => {
  const lower = key.Trim().ToLowerInvariant();
  return lower.Replace("-", "_");
};

export class YamlRootMappingResult {
  readonly success: boolean;
  readonly root: YamlMappingNode | undefined;
  readonly error: string | undefined;

  constructor(success: boolean, root: YamlMappingNode | undefined, error: string | undefined) {
    this.success = success;
    this.root = root;
    this.error = error;
  }

  static ok(root: YamlMappingNode): YamlRootMappingResult {
    return new YamlRootMappingResult(true, root, undefined);
  }

  static fail(message: string): YamlRootMappingResult {
    return new YamlRootMappingResult(false, undefined, message);
  }
}

export const parseYamlRootMapping = (text: string): YamlRootMappingResult => {
  try {
    const reader = new StringReader(text);
    const stream = new YamlStream();
    stream.Load(reader);

    const docs = stream.Documents;
    if (docs.Count < 1) return YamlRootMappingResult.fail("YAML document is empty.");

    const firstDocIt = stream.GetEnumerator();
    const hasDoc = firstDocIt.MoveNext();
    if (!hasDoc) return YamlRootMappingResult.fail("YAML document is empty.");

    const doc: YamlDocument = firstDocIt.Current;
    const root: YamlNode = doc.RootNode;
    if (root.NodeType !== YamlNodeType.Mapping) {
      return YamlRootMappingResult.fail("Expected YAML root to be a mapping/object.");
    }
    return YamlRootMappingResult.ok(root as unknown as YamlMappingNode);
  } catch (e) {
    const msg = e instanceof Exception ? e.Message : "Unknown error";
    return YamlRootMappingResult.fail(`Invalid YAML: ${msg}`);
  }
};

export const asYamlMapping = (node: YamlNode): YamlMappingNode | undefined => {
  if (node.NodeType !== YamlNodeType.Mapping) return undefined;
  return node as unknown as YamlMappingNode;
};

export const asYamlSequence = (node: YamlNode): YamlSequenceNode | undefined => {
  if (node.NodeType !== YamlNodeType.Sequence) return undefined;
  return node as unknown as YamlSequenceNode;
};

export const asYamlScalar = (node: YamlNode): YamlScalarNode | undefined => {
  if (node.NodeType !== YamlNodeType.Scalar) return undefined;
  return node as unknown as YamlScalarNode;
};

export const tryGetMappingValue = (mapping: YamlMappingNode, key: string): YamlNode | undefined => {
  const wanted = normalizeYamlKey(key);
  const it = mapping.GetEnumerator();
  while (it.MoveNext()) {
    const pair = it.Current;
    const kNode: YamlNode = pair.Key;
    const kScalar = asYamlScalar(kNode);
    if (kScalar === undefined) continue;

    const candidate = normalizeYamlKey(kScalar.Value ?? "");
    if (candidate === wanted) return pair.Value;
  }
  return undefined;
};

export const tryGetString = (mapping: YamlMappingNode, key: string): string | undefined => {
  const node = tryGetMappingValue(mapping, key);
  if (node === undefined) return undefined;
  const scalar = asYamlScalar(node);
  if (scalar === undefined) return undefined;
  const value = scalar.Value ?? "";
  const trimmed = value.Trim();
  return trimmed === "" ? undefined : trimmed;
};

export const tryGetStringArray = (mapping: YamlMappingNode, key: string): string[] | undefined => {
  const node = tryGetMappingValue(mapping, key);
  if (node === undefined) return undefined;
  const seq = asYamlSequence(node);
  if (seq === undefined) return undefined;

  const out = new List<string>();
  const it = seq.GetEnumerator();
  while (it.MoveNext()) {
    const child = it.Current;
    const scalar = asYamlScalar(child);
    if (scalar === undefined) continue;
    const raw = scalar.Value ?? "";
    const value = raw.Trim();
    if (value !== "") out.Add(value);
  }
  return out.ToArray();
};

export const tryGetChildMapping = (mapping: YamlMappingNode, key: string): YamlMappingNode | undefined => {
  const node = tryGetMappingValue(mapping, key);
  if (node === undefined) return undefined;
  return asYamlMapping(node);
};

export const tryGetChildSequence = (mapping: YamlMappingNode, key: string): YamlSequenceNode | undefined => {
  const node = tryGetMappingValue(mapping, key);
  if (node === undefined) return undefined;
  return asYamlSequence(node);
};
