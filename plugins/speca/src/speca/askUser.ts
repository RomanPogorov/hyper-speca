import { ask, chatFor, stopSignal } from "../../web/approvals.ts";
import { agentOf } from "../../web/design/tools.ts";

/**
 * Ask the person one or more short questions with options (a card in the chat) and wait for the answers. Use only when
 * you cannot go on sensibly without their choice. Returns each question with its answer, or that they skipped.
 * @param opts.questions Up to 5 questions: {question, options?: up to 8, recommended?: one of the options, multiple?}.
 * @param opts.timeoutSec How long to wait for the answers, in seconds. @default 1800
 */
export default async function (ctx: Context, session: Session | null, opts: {
  /** Up to 5 questions: {question, options?: up to 8, recommended?: one of the options, multiple?}. */
  questions: Array<{ question: string; options?: string[]; recommended?: string; multiple?: boolean }>;
  /** How long to wait for the answers, in seconds. @default 1800 */
  timeoutSec?: number;
}): Promise<string> {
  const qs = (Array.isArray(opts.questions) ? opts.questions : []).slice(0, 5)
    .map((q) => ({ question: String(q?.question ?? "").trim(), options: (q?.options ?? []).map(String).slice(0, 8), ...(q?.recommended ? { recommended: String(q.recommended) } : {}), ...(q?.multiple ? { multiple: true } : {}) }))
    .filter((q) => q.question);
  if (!qs.length) throw new Error("speca.askUser: pass questions: [{question, options?}]");
  const agentId = await agentOf(ctx, session);
  if (!agentId) throw new Error("speca.askUser: only an agent can ask");
  const chat = await chatFor(ctx as any, agentId);
  const waitMs = Math.min(3600, Math.max(30, Number(opts.timeoutSec ?? 1800))) * 1000;
  const r = await ask(ctx as any, chat, {
    agentId, kind: "question", summary: qs.map((q) => q.question).join(" · "), preview: { questions: qs }, waitMs,
    event: { type: "question", questions: qs }, signal: stopSignal(ctx, agentId),
  });
  if (r.status === "approved") return qs.map((q, i) => `${q.question}\n→ ${(r.answer ?? {})[i] ?? "(no answer)"}`).join("\n\n");
  if (r.note === "skipped") return "The person skipped the questions. Go on with your best judgement and state your assumptions.";
  if (r.note === "wrote_instead") return "Instead of answering on the card, the person wrote to you (their message follows) — read the answers there.";
  return "No answer in time. Go on with your best judgement and state your assumptions.";
}
