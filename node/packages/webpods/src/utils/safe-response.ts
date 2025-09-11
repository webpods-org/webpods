/**
 * Safe response utilities to prevent ERR_HTTP_HEADERS_SENT
 */

import { Response } from "express";

/**
 * Safely send a JSON response only if headers haven't been sent
 */
export function safeJson(res: Response, status: number, data: any): void {
  if (!res.headersSent) {
    res.status(status).json(data);
  }
}

/**
 * Safely send an error response
 */
export function safeError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  if (!res.headersSent) {
    res.status(status).json({
      error: {
        code,
        message,
      },
    });
  }
}

/**
 * Safely send a success response
 */
export function safeSuccess(
  res: Response,
  data: any = { success: true },
): void {
  if (!res.headersSent) {
    res.json(data);
  }
}

/**
 * Safely set a header
 */
export function safeSetHeader(
  res: Response,
  name: string,
  value: string,
): void {
  if (!res.headersSent) {
    try {
      res.setHeader(name, value);
    } catch {
      // Ignore errors - can happen if response is being sent concurrently
    }
  }
}

/**
 * Safely send raw content
 */
export function safeSend(res: Response, content: any): void {
  if (!res.headersSent) {
    res.send(content);
  }
}

/**
 * Safely set content type
 */
export function safeType(res: Response, type: string): void {
  if (!res.headersSent) {
    res.type(type);
  }
}
