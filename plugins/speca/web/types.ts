// The shapes Speca's views expect (core/runtime/sessions.ts, authority/users.ts, llm/models.ts…), here filled from
// Hyper's own tables by ./hyper.ts. Views import types from this one file instead of Speca's runtime.
import type { T } from "./i18n/i18n.ts";

export type { T };

export type PlanItem = { content: string; status: "pending" | "in_progress" | "completed" };
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export type SessionRow = {
  id: string; owner_id: string; project_id: string | null; title: string;
  kind: "chat" | "task" | "dev" | "coordinator" | "subagent";
  parent_id: string | null; fork_idx: number | null;
  status: "idle" | "running" | "waiting" | "error" | "parked";
  autonomy: "read_only" | "ask" | "drafts" | "full"; mode: "work" | "plan";
  model: string; toolset: string | null; label: string | null; policy_override: unknown;
  plan: PlanItem[] | null;
  engine_state: Record<string, any>;
  error: string | null; run_token: string | null; run_heartbeat_at: Date | null; run_attempts: number;
  next_run_at: Date | null; parked_until: Date | null;
  pinned: boolean; seen_idx: number; archived_at: Date | null; created_at: Date; updated_at: Date;
  shared_write: boolean; activity: Record<string, any> | null; activity_at: Date | null; effort: Effort | null;
  /** Hyper: the agent's working folder. */
  workspace_dir?: string | null;
};

export type EventRow = { session_id: string; idx: number; type: string; family: string | null; data: Record<string, any>; ts: Date };

export type InboxRow = { id: string; session_id: string; kind: string; delivery: string; payload: Record<string, any>; created_at: Date };

export type UserSettings = {
  theme?: "light" | "dark" | "system"; view?: string; chatSide?: "left" | "right"; sideOpen?: boolean; sbRail?: boolean;
  msgRail?: boolean; models?: unknown[]; defaultEffort?: Effort | null; [k: string]: unknown;
};

export type UserRow = {
  id: string; email: string; name: string; title: string | null; avatar_url: string | null; locale: "en" | "ru" | null; tz: string | null;
  status: "active" | "disabled"; settings: UserSettings; onboarded_at: Date | null; created_at: Date;
};

export type Engine = "native" | "claude-code" | "codex";
export type ModelOption = {
  ref: string; sourceId: string; type: string; engine: Engine; alias: string; model: string; label: string; personal: boolean;
};

export const PERSONAL_KINDS = [
  { type: "claude-code", id: "my-claude", models: { opus: "opus", sonnet: "sonnet", haiku: "haiku" } as Record<string, string> },
  { type: "codex", id: "my-chatgpt", models: { codex: "default" } as Record<string, string> },
  { type: "anthropic", id: "my-anthropic", models: {} as Record<string, string> },
  { type: "openai", id: "my-openai", models: {} as Record<string, string> },
] as const;

export function prettyModel(m: string): string {
  const id = m.includes(":") ? m.slice(m.lastIndexOf(":") + 1) : m;
  const known: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", "mock-1": "mock", default: "Codex" };
  if (known[id]) return known[id]!;
  // claude-opus-5 → Opus 5, claude-sonnet-5-5 → Sonnet 5.5
  const c = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (c) return `${c[1]![0]!.toUpperCase()}${c[1]!.slice(1)} ${c[2]}${c[3] && c[3].length < 3 ? `.${c[3]}` : ""}`;
  if (/^gpt-/.test(id)) return id.split("-").map((x, i) => (i === 0 ? "GPT" : x.charAt(0).toUpperCase() + x.slice(1))).join("-");
  return id;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

// Speca parts that have no Hyper counterpart yet: the views only read these shapes.
export type SubView = {
  id: string; name: string; task: string; modelLabel: string; status: string; mode: "read" | "all";
  steps: number; tokensIn: number; tokensOut: number; cost: number; ms: number; approvals: number;
  result: { status: "done" | "error" | "stopped"; text?: string } | null;
};
export type UsageRow = { key: string; name?: string | null; pct: number; resetsAt: string | null; spent?: { used: number; limit: number | null; currency: string } | null };
export type TriggerRow = { id: string; kind: string; prompt: string | null; next_fire_at: Date | string | null; spec: Record<string, any> };
export type Script = { name: string; command: string };
export type RunRow = { id: string; name: string; command: string; started_at: Date };
export type GitState = { branch: string | null; detached: boolean; upstream: string | null; ahead: number; behind: number; changes: Array<{ path: string; status?: "A" | "M" | "D" | "R"; from?: string; untracked?: boolean }>; branches: string[]; remote: boolean; github: boolean };

/** What Speca's views read from `app`: tools and plugins for naming tool calls, the product's branding, effects. */
export type App = {
  registry: {
    tools: Map<string, { pluginId: string; def: { title?: string | Record<string, string>; category?: string } }>;
    plugins: Map<string, { manifest: { name: string | Record<string, string> } }>;
    fences: Map<string, unknown>;
    canvases: Map<string, { def: { title: string | Record<string, string>; icon?: string } }>;
  };
  config: {
    branding: { productName: string; logo: string | null; wordmark?: string | null; theme: { light: Record<string, string>; dark: Record<string, string> } };
    effects: { fullAccess: boolean };
    org: { timezone: string };
  };
};
