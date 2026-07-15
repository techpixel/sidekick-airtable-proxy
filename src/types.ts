import { badRequest } from "./errors";

// ---- Sidekick protocol types ----

export type ShipStatus = "pending" | "pending_hq" | "approved" | "rejected";

export interface Ship {
  id: string;
  hoursSubmitted: number;
  submittedAt: string;
  status: ShipStatus;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  codeUrl: string;
  demoUrl?: string;
  screenshotUrl?: string;
  authorId: string;
  hackatimeId?: string;
  hackatimeProjectKeys: string[];
  ships: Ship[];
  metadata?: Record<string, unknown>;
}

export interface ShipTimelineEvent {
  type: "ship";
  shipId: string;
  actorId: string;
  hoursSubmitted: number;
  timestamp: string;
}

export interface ApprovalTimelineEvent {
  type: "approval";
  shipId: string;
  actorId: string;
  hoursAssigned: number;
  feedbackMessage: string;
  justification: string;
  fields?: Record<string, unknown>;
  timestamp: string;
}

export interface RejectionTimelineEvent {
  type: "rejection";
  shipId: string;
  actorId: string;
  feedbackMessage: string;
  internalMessage?: string;
  fields?: Record<string, unknown>;
  timestamp: string;
}

export interface CommentTimelineEvent {
  type: "comment";
  actorId: string;
  message: string;
  isInternal: boolean;
  timestamp: string;
}

export type TimelineEvent =
  | ShipTimelineEvent
  | ApprovalTimelineEvent
  | RejectionTimelineEvent
  | CommentTimelineEvent;

// ---- Internal Airtable types ----

/** Raw record from the submissions table. Field values indexed by exact field name. */
export interface SubmissionRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

/** One submission record presented as a project. `members` is always `[primary]`. */
export interface ProjectGroup {
  key: string;
  primary: SubmissionRecord;
  members: SubmissionRecord[];
}

export interface RecordComment {
  id: string;
  text: string;
  createdTime: string;
}

// ---- Input validators ----

export function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function reqString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest(`Missing or invalid required field: ${key}`);
  }
  return value;
}

export function optString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest(`Field ${key} must be a string`);
  return value;
}

export function reqNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`Missing or invalid required field: ${key}`);
  }
  return value;
}

export function optNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`Field ${key} must be a number`);
  }
  return value;
}

// ---- Field value accessors (submissions table) ----

export function fieldString(record: SubmissionRecord, name: string): string {
  const value = record.fields[name];
  return typeof value === "string" ? value : "";
}

export function fieldNumber(record: SubmissionRecord, name: string): number | null {
  const value = record.fields[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function fieldBool(record: SubmissionRecord, name: string): boolean {
  return record.fields[name] === true;
}

export function fieldAttachmentUrl(record: SubmissionRecord, name: string): string | undefined {
  const value = record.fields[name];
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as { url?: unknown };
    if (typeof first?.url === "string") return first.url;
  }
  return undefined;
}

// Exact Airtable field names used by the proxy.
export const F = {
  codeUrl: "Code URL",
  playableUrl: "Playable URL",
  email: "Email",
  screenshot: "Screenshot",
  description: "Description",
  projectName: "Project Name",
  originalHours: "Original Hours",
  hackatimeProjectName: "Hackatime Project Name",
  overrideHours: "Optional - Override Hours Spent",
  overrideJustification: "Optional - Override Hours Spent Justification",
  submitToUnified: "Automation - Submit to Unified YSWS",
  firstSubmittedAt: "Automation - First Submitted At",
  rejected: "Rejected",
} as const;
