/**
 * HTTP client for WebPods API
 */

import fetch from "node-fetch";
import { Result, success, failure, ErrorResponse } from "../types.js";
import { loadConfig } from "../config/index.js";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: any;
  token?: string;
  server?: string;
}

/**
 * Make an authenticated request to the WebPods API
 */
export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<Result<T>> {
  try {
    const config = await loadConfig();
    const server = options.server || config.server;
    const token = options.token || config.token;

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
  } catch (error: any) {
    return failure({
      code: "NETWORK_ERROR",
      message: error.message || "Network request failed",
    });
  }
}

/**
 * Make a request to a pod subdomain
 */
export async function podRequest<T>(
  podName: string,
  path: string,
  options: RequestOptions = {},
): Promise<Result<T>> {
  const config = await loadConfig();
  const server = options.server || config.server;

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
): Promise<Result<any>> {
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
