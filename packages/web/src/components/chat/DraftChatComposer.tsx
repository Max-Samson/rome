import { forwardRef } from "react";
import { ChatComposer, type ChatComposerHandle, type ChatComposerProps } from "./ChatComposer";
import { useNewChatDraftBinding } from "./NewChatDraftProvider";

export const DraftChatComposer = forwardRef<
  ChatComposerHandle,
  ChatComposerProps & { sessionId?: string | null }
>(function DraftChatComposer({ sessionId, ...props }, ref) {
  const controlledDraft = useNewChatDraftBinding(sessionId);
  return <ChatComposer {...props} controlledDraft={controlledDraft} ref={ref} />;
});
