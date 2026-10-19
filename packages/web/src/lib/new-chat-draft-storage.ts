import { z } from "zod";

const KEY = "rome:new-chat-draft";
const schema = z.object({
  version: z.literal(1),
  text: z.string(),
  projectPath: z.string(),
  agentMention: z
    .object({
      appId: z.string(),
      agentName: z.string(),
      appLabel: z.string(),
      iconUrl: z.string().nullable().optional(),
    })
    .nullable(),
  skill: z
    .object({
      name: z.string(),
      localName: z.string().optional(),
      description: z.string().optional(),
      iconUrl: z.string().nullable().optional(),
    })
    .nullable(),
  personaId: z.string(),
});
export type NewChatDraft = z.infer<typeof schema>;

export function loadNewChatDraft(): NewChatDraft | null {
  try {
    const result = schema.safeParse(JSON.parse(sessionStorage.getItem(KEY) ?? "null"));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function saveNewChatDraft(draft: NewChatDraft) {
  if (
    !draft.text &&
    draft.projectPath === "default" &&
    !draft.agentMention &&
    !draft.skill &&
    !draft.personaId
  ) {
    clearNewChatDraft();
    return;
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Disabled storage must not break editing.
  }
}

export function clearNewChatDraft() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Disabled storage must not break editing or logout.
  }
}
