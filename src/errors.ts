export type ErrorCode =
  | "INVALID_ACTION"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "UPSTREAM_UNAVAILABLE";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }

  toResponse(): Response {
    return Response.json({ error: this.code, message: this.message }, { status: this.status });
  }
}

export const badRequest = (message: string) => new ApiError(400, "VALIDATION_ERROR", message);
export const notFound = (message: string) => new ApiError(404, "NOT_FOUND", message);
export const invalidAction = (action: string) =>
  new ApiError(400, "INVALID_ACTION", `Unknown or unsupported action: ${action}`);
export const upstreamUnavailable = (message: string) =>
  new ApiError(503, "UPSTREAM_UNAVAILABLE", message);
