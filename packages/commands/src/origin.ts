import { Environment } from "@tsonic/dotnet/System.js";

const isTruthy = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  const t = value.trim();
  if (t === "") return false;
  const lower = t.toLowerInvariant();
  if (lower === "0" || lower === "false" || lower === "no") return false;
  return true;
};

export const detectOrigin = (fromOverride: string | undefined): string => {
  const from = fromOverride?.trim();
  if (from !== undefined && from !== "") return from;

  const ci = Environment.getEnvironmentVariable("CI");
  if (isTruthy(ci)) return "ci";

  return "local";
};

