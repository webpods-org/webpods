/**
 * HTTP client for WebPods API
 */

import fetch from "node-fetch";
import { Result, success, failure, ErrorResponse } from "../types.js";
import { loadConfig } from "../config/index.js";
import { getCurrentProfile, getProfile } from "../config/profiles.js";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  token?: string;
  server?: string;
}

/**
 * Make an authenticated request to the WebPods API
 */
export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions & { profile?: string } = {},
): Promise<Result<T>> {
  try {
    // Get the profile to use
    let profile;
    if (options.profile) {
      profile = await getProfile(options.profile);
      if (!profile) {
        return failure({
          code: "PROFILE_NOT_FOUND",
          message: `Profile '${options.profile}' not found`,
        });
      }
    } else {
      profile = await getCurrentProfile();
      if (!profile) {
        // Fallback to legacy config if no profiles
        const config = await loadConfig();
        if (config.server) {
          profile = {
            name: "default",
            server: config.server,
            token: config.token,
          };
        } else {
          profile = {
            name: "default",
            server: "http://localhost:3000",
          };
        }
      }
    }

    const server = options.server || profile.server;
    const token = options.token || profile.token;

    const url = endpoint.startsWith("http")
      ? endpoint
      : `${server}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const body = options.body
      ? typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body)
      : undefined;

    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body,
    });

    const contentType = response.headers.get("content-type") || "";

    if (response.ok) {
      if (contentType.includes("application/json")) {
        const data = (await response.json()) as T;
        return success(data);
      } else {
        const data = (await response.text()) as unknown as T;
        return success(data);
      }
    } else {
      let errorData: ErrorResponse;

      if (contentType.includes("application/json")) {
        errorData = (await response.json()) as ErrorResponse;
      } else {
        const text = await response.text();
        errorData = {
          error: {
            code: "HTTP_ERROR",
            message: text || `HTTP ${response.status}: ${response.statusText}`,
          },
        };
      }

      return failure(errorData.error);
    }
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Network request failed";
    return failure({
      code: "NETWORK_ERROR",
      message: errorMessage,
    });
  }
}

/**
 * Make a request to a pod subdomain
 */
export async function podRequest<T>(
  podName: string,
  path: string,
  options: RequestOptions & { profile?: string } = {},
): Promise<Result<T>> {
  // Get the profile to use
  let profile;
  if (options.profile) {
    profile = await getProfile(options.profile);
  } else {
    profile = await getCurrentProfile();
  }

  if (!profile) {
    // Fallback to legacy config
    const config = await loadConfig();
    profile = {
      name: "default",
      server: config.server || "http://localhost:3000",
      token: config.token,
    };
  }

  const server = options.server || profile.server;

  // Extract the base domain from the server URL
  const serverUrl = new URL(server);

  // For localhost testing, use a header instead of subdomain
  if (
    serverUrl.hostname === "localhost" ||
    serverUrl.hostname === "127.0.0.1"
  ) {
    const endpoint = `${server}${path.startsWith("/") ? "" : "/"}${path}`;
    return apiRequest<T>(endpoint, {
      ...options,
      headers: {
        ...options.headers,
        "X-Pod-Name": podName,
      },
    });
  }

  // For production, use subdomain
  const podUrl = `${serverUrl.protocol}//${podName}.${serverUrl.host}`;
  const endpoint = `${podUrl}${path.startsWith("/") ? "" : "/"}${path}`;

  return apiRequest<T>(endpoint, options);
}

/**
 * Upload a file to a pod stream
 */
export async function uploadFile(
  podName: string,
  streamPath: string,
  recordName: string,
  content: string | Buffer,
  contentType: string,
  options: RequestOptions = {},
): Promise<Result<unknown>> {
  return podRequest(podName, `${streamPath}/${recordName}`, {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": contentType,
      ...options.headers,
    },
    body: content,
  });
}

/**
 * Download content from a pod stream record
 */
export async function downloadContent(
  podName: string,
  streamPath: string,
  recordName: string,
  options: RequestOptions = {},
): Promise<Result<string>> {
  return podRequest<string>(podName, `${streamPath}/${recordName}`, options);
}
