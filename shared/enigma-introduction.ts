export const ENIGMA_CLOSING_LINE = "I'll be your enigma,We could be anything you want.";

export function enigmaIntroduction(name: string, chinese: boolean): string {
  return chinese
    ? `你是 ${name || 'Enigma'}。用户问你是谁或要求自我介绍时，依据下文已有的身份、性格、职责和能力正常介绍自己，并在介绍中加入这句寄语：${ENIGMA_CLOSING_LINE} 寄语是补充，不替代原有介绍或其他设定；不要只回复这一句话。不主动附加运行平台或开发者介绍。`
    : `You are ${name || 'Enigma'}. When asked who you are or to introduce yourself, give a normal introduction grounded in the identity, personality, responsibilities and capabilities below, and include this closing line: ${ENIGMA_CLOSING_LINE} The line supplements the introduction and existing settings; it does not replace them. Do not reply with the line alone. Do not add an unsolicited platform or developer introduction.`;
}

function repairPrefix(prompt: string): string {
  // Only the exact obsolete host line at the start of a snapshot is eligible.
  // Quoted text, user persona files and all following prompt bytes stay intact.
  const chinese = /^你是 ([^\r\n]{1,120}?)。用户问你是谁或要求自我介绍时，使用这句原文：/.exec(prompt);
  const english = /^You are ([^\r\n]{1,120}?)\. When asked who you are or to introduce yourself, use this exact sentence: /.exec(prompt);
  const name = chinese?.[1] || english?.[1];
  if (!name) return prompt;
  const legacy = chinese
    ? `你是 ${name}。用户问你是谁或要求自我介绍时，使用这句原文：${ENIGMA_CLOSING_LINE} 不主动附加运行平台或开发者介绍。`
    : `You are ${name}. When asked who you are or to introduce yourself, use this exact sentence: ${ENIGMA_CLOSING_LINE} Do not add an unsolicited platform or developer introduction.`;
  if (!prompt.startsWith(legacy) || prompt.length > legacy.length && !/^[\r\n]/.test(prompt.slice(legacy.length))) return prompt;
  return enigmaIntroduction(name, !!chinese) + prompt.slice(legacy.length);
}

export function repairEnigmaIntroductionSnapshot<T extends {systemPrompt: string; finalSystemPrompt?: string}>(snapshot: T | null, enabled: boolean): T | null {
  if (!snapshot || !enabled) return snapshot;
  const systemPrompt = repairPrefix(snapshot.systemPrompt);
  const finalSystemPrompt = snapshot.finalSystemPrompt === undefined ? undefined : repairPrefix(snapshot.finalSystemPrompt);
  if (systemPrompt === snapshot.systemPrompt && finalSystemPrompt === snapshot.finalSystemPrompt) return snapshot;
  return {...snapshot, systemPrompt, ...(finalSystemPrompt === undefined ? {} : {finalSystemPrompt})};
}
