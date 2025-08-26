/**
 * Custom error types with codes
 */

export interface CodedError extends Error {
  code: string;
}

export function createError(code: string, message: string): CodedError {
  const error = new Error(message) as CodedError;
  error.code = code;
  return error;
}
