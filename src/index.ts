import { timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { ApiError } from "./errors";
import { asObject } from "./types";
import { dispatch } from "./router";

function isAuthorized(header: string | null): boolean {
  const expected = Buffer.from(`Bearer ${env.sidekickSecret}`);
  const actual = Buffer.from(header ?? "");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

const server = Bun.serve({
  port: env.port,
  idleTimeout: 30,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok");
    }
    if (request.method !== "POST") {
      return Response.json(
        { error: "VALIDATION_ERROR", message: "Send POST requests with a JSON body." },
        { status: 400 },
      );
    }
    if (!isAuthorized(request.headers.get("authorization"))) {
      return Response.json(
        { error: "UNAUTHORIZED", message: "Invalid or missing secret." },
        { status: 401 },
      );
    }

    try {
      const body = asObject(await request.json().catch(() => null), "request body");
      const action = body.action;
      if (typeof action !== "string" || !action) {
        return Response.json(
          { error: "VALIDATION_ERROR", message: "Missing action." },
          { status: 400 },
        );
      }
      const input = body.input === undefined ? {} : asObject(body.input, "input");
      const result = await dispatch(action, input);
      return Response.json(result);
    } catch (error) {
      if (error instanceof ApiError) return error.toResponse();
      console.error("Unhandled error:", error);
      return Response.json(
        { error: "INTERNAL_ERROR", message: "Internal server error." },
        { status: 500 },
      );
    }
  },
});

console.log(`sidekick-airtable-proxy listening on port ${server.port}`);
