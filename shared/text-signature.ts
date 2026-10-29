export type AssistantTextPhase = "commentary" | "final_answer";

export interface AssistantTextSignature {
  v?: number;
  id?: string;
  phase?: AssistantTextPhase;
}

export function parseAssistantTextSignature(value: unknown): AssistantTextSignature | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const phase = (parsed as Record<string, unknown>).phase;
    if (phase !== "commentary" && phase !== "final_answer") return null;
    return {
      ...(typeof (parsed as Record<string, unknown>).v === "number" ? { v: (parsed as Record<string, unknown>).v as number } : {}),
      ...(typeof (parsed as Record<string, unknown>).id === "string" ? { id: (parsed as Record<string, unknown>).id as string } : {}),
      phase,
    };
  } catch {
    return null;
  }
}

export function getAssistantTextPhase(block: unknown): AssistantTextPhase | null {
  if (!block || typeof block !== "object") return null;
  const signature = parseAssistantTextSignature((block as Record<string, unknown>).textSignature);
  return signature?.phase || null;
}

export function isAssistantCommentaryTextBlock(block: unknown): boolean {
  return getAssistantTextPhase(block) === "commentary";
}

/** Compatible Responses providers can mark the sole public answer as
 * commentary. Their text was already streamed to the user and must survive
 * history/search reloads. Codex's distinct commentary lane keeps its policy. */
export function includesCompatibleResponseText(message: any): boolean {
  return message?.provider !== 'openai-codex'
    && ['openai-responses','azure-openai-responses'].includes(message?.api);
}
