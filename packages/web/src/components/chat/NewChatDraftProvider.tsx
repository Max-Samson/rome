import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import { hasSession, useAuthStateSnapshot } from "@/lib/auth-state";
import { useDashboardIdentity } from "@/hooks/use-dashboard-identity";
import { DEFAULT_PROJECT_NAME } from "@/lib/chat-constants";
import { randomUUID } from "@/lib/random-uuid";
import type { AgentMention, PendingUpload } from "@/lib/chat-types";
import type { SkillSelection } from "./composer/SkillCommandChip";
import type { ChatComposerSendControls, ChatComposerSnapshot } from "./ChatComposer";

export interface NewChatDraftValue {
  text: string;
  uploads: PendingUpload[];
  projectPath: string;
  agentMention: AgentMention | null;
  skill: SkillSelection | null;
  personaId: string;
}

function emptyValue(): NewChatDraftValue {
  return {
    text: "",
    uploads: [],
    projectPath: DEFAULT_PROJECT_NAME,
    agentMention: null,
    skill: null,
    personaId: "",
  };
}

interface Submission {
  snapshot: ChatComposerSnapshot;
  raw: NewChatDraftValue;
  version: number;
  controller: AbortController;
}

interface DraftSlot {
  value: NewChatDraftValue;
  version: number;
  pending?: Submission;
  retry?: Submission;
}

interface Prefill {
  text?: string;
  projectPath?: string;
  agentMention?: AgentMention | null;
  skill?: SkillSelection | null;
}

interface DraftState {
  epoch: number;
  draft: DraftSlot;
  sessions: Record<string, DraftSlot>;
  intents: ReadonlySet<string>;
}

function initialState(epoch = 0): DraftState {
  return { epoch, draft: { value: emptyValue(), version: 0 }, sessions: {}, intents: new Set() };
}

const NEW_CHAT = "new-chat";

export interface NewChatDraftBinding {
  owner: string;
  epoch: number;
  current: () => DraftSlot;
  change: <K extends keyof NewChatDraftValue>(
    key: K,
    value: SetStateAction<NewChatDraftValue[K]>,
  ) => void;
  send: (
    snapshot: ChatComposerSnapshot,
    onSend: (
      snapshot: ChatComposerSnapshot,
      controls: ChatComposerSendControls,
    ) => void | Promise<void>,
    onUploadProgress: ChatComposerSendControls["onUploadProgress"],
    independent?: boolean,
  ) => Promise<void>;
  inputId: (snapshot: ChatComposerSnapshot) => string;
  cancel: () => void;
  retain: () => void;
  release: () => void;
}

interface DraftController {
  bind: (sessionId?: string | null) => NewChatDraftBinding | undefined;
  prefill: (intent: string, value: Prefill) => void;
  isSubmitting: () => boolean;
  reset: () => void;
}

const ControllerContext = createContext<DraftController | null>(null);
const StateContext = createContext<DraftState | null>(null);

export function useNewChatDraftController() {
  return useContext(ControllerContext);
}

/** Only the composer subscribes to text updates, not its transcript or the route tree. */
export function useNewChatDraftBinding(sessionId?: string | null) {
  const controller = useNewChatDraftController();
  const state = useContext(StateContext);
  const [binding] = useState(() => controller?.bind(sessionId));
  useLayoutEffect(() => {
    binding?.retain();
    return () => binding?.release();
  }, [binding]);
  if (!binding || !state) return undefined;
  const slot = binding.current();
  return {
    binding,
    value: slot.value,
    pending: slot.pending,
    accepted: binding.owner !== NEW_CHAT && !slot.pending && !slot.retry,
  };
}

function sameSnapshot(a: ChatComposerSnapshot, b: ChatComposerSnapshot) {
  return (
    a.text === b.text &&
    a.uploads === b.uploads &&
    a.projectPath === b.projectPath &&
    a.personaId === b.personaId &&
    a.skillName === b.skillName &&
    a.agentMention?.agentName === b.agentMention?.agentName &&
    (b.largeModelSelection === undefined || a.largeModelSelection === b.largeModelSelection) &&
    a.reasoningEffort === b.reasoningEffort
  );
}

function hasDraft(value: NewChatDraftValue) {
  return (
    value.text !== "" ||
    value.uploads.length > 0 ||
    value.skill !== null ||
    value.agentMention !== null ||
    value.personaId !== "" ||
    value.projectPath !== DEFAULT_PROJECT_NAME
  );
}

/** Memory belongs to this dashboard mount. No value is serialized or stored outside React. */
export function NewChatDraftProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  // Commands can race within one event before React commits. This ref always
  // points at the exact state queued for rendering, closing that submit gap.
  const stateRef = useRef(state);
  const activeBindings = useRef(new Set<NewChatDraftBinding>());
  const update = useCallback((fn: (current: DraftState) => DraftState) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);
  const controller = useMemo<DraftController>(() => {
    const getSlot = (owner: string): DraftSlot =>
      owner === NEW_CHAT
        ? stateRef.current.draft
        : (stateRef.current.sessions[owner] ?? { value: emptyValue(), version: 0 });
    const putSlot = (current: DraftState, owner: string, slot: DraftSlot): DraftState =>
      owner === NEW_CHAT
        ? { ...current, draft: slot }
        : { ...current, sessions: { ...current.sessions, [owner]: slot } };
    const prune = (owner: string) => {
      if (
        owner === NEW_CHAT ||
        [...activeBindings.current].some((binding) => binding.owner === owner)
      )
        return;
      update((current) => {
        const slot = current.sessions[owner];
        if (!slot || slot.pending || slot.retry) return current;
        const sessions = { ...current.sessions };
        delete sessions[owner];
        return { ...current, sessions };
      });
    };
    return {
      bind(sessionId) {
        const recovery = sessionId ? stateRef.current.sessions[sessionId] : undefined;
        if (sessionId && !recovery?.pending && !recovery?.retry) return undefined;
        const binding: NewChatDraftBinding = {
          owner: sessionId || NEW_CHAT,
          epoch: stateRef.current.epoch,
          current: () =>
            binding.epoch === stateRef.current.epoch
              ? getSlot(binding.owner)
              : { value: emptyValue(), version: 0 },
          change(key, action) {
            if (binding.epoch !== stateRef.current.epoch || !activeBindings.current.has(binding))
              return;
            update((current) => {
              const slot = getSlot(binding.owner);
              const value =
                typeof action === "function"
                  ? (
                      action as (
                        value: NewChatDraftValue[typeof key],
                      ) => NewChatDraftValue[typeof key]
                    )(slot.value[key])
                  : action;
              if (value === slot.value[key]) return current;
              return putSlot(current, binding.owner, {
                ...slot,
                value: { ...slot.value, [key]: value },
                version: slot.version + 1,
              });
            });
          },
          async send(snapshot, onSend, onUploadProgress, independent = false) {
            if (
              binding.epoch !== stateRef.current.epoch ||
              !activeBindings.current.has(binding) ||
              getSlot(binding.owner).pending
            )
              return;
            const slot = getSlot(binding.owner);
            const submission: Submission = {
              snapshot: { ...snapshot, inputId: binding.inputId(snapshot) },
              raw: slot.value,
              version: slot.version,
              controller: new AbortController(),
            };
            update((current) =>
              putSlot(current, binding.owner, {
                ...slot,
                pending: submission,
                retry: undefined,
                value:
                  !independent && snapshot.uploads.length === 0
                    ? { ...slot.value, text: "", skill: null, uploads: [] }
                    : slot.value,
              }),
            );
            try {
              await onSend(submission.snapshot, {
                signal: submission.controller.signal,
                onUploadProgress,
                onSessionCreated(id) {
                  if (binding.epoch !== stateRef.current.epoch)
                    throw new DOMException("Cancelled draft", "AbortError");
                  const oldOwner = binding.owner;
                  const currentSlot = getSlot(oldOwner);
                  const followsSurface = activeBindings.current.has(binding);
                  const unchanged = currentSlot.version === submission.version;
                  // A remounted New chat owns any edits made after the send.
                  // Transfer only the submitted generation when its surface left.
                  const transferred =
                    followsSurface && !independent
                      ? currentSlot
                      : {
                          value: {
                            ...submission.raw,
                            text:
                              snapshot.uploads.length && !independent ? submission.raw.text : "",
                            uploads: independent ? [] : snapshot.uploads,
                            skill:
                              snapshot.uploads.length && !independent ? submission.raw.skill : null,
                          },
                          version: submission.version,
                          pending: submission,
                        };
                  if (followsSurface) {
                    for (const other of activeBindings.current) {
                      if (other.owner === oldOwner && other.epoch === binding.epoch)
                        other.owner = id;
                    }
                  }
                  binding.owner = id;
                  update((current) => ({
                    ...current,
                    draft:
                      oldOwner === NEW_CHAT
                        ? !independent && (followsSurface || unchanged)
                          ? { value: emptyValue(), version: current.draft.version + 1 }
                          : { ...current.draft, pending: undefined, retry: undefined }
                        : current.draft,
                    sessions: { ...current.sessions, [id]: transferred },
                  }));
                },
              });
              if (binding.epoch !== stateRef.current.epoch) return;
              update((current) => {
                const latest = getSlot(binding.owner);
                if (latest.pending !== submission) return current;
                return putSlot(current, binding.owner, {
                  ...latest,
                  pending: undefined,
                  retry: undefined,
                  value: !independent
                    ? {
                        ...latest.value,
                        text: latest.version === submission.version ? "" : latest.value.text,
                        uploads: latest.value.uploads.filter(
                          (upload) =>
                            !submission.snapshot.uploads.some((sent) => sent.id === upload.id),
                        ),
                        skill:
                          latest.value.skill === submission.raw.skill ? null : latest.value.skill,
                      }
                    : latest.value,
                });
              });
            } catch (error) {
              if (binding.epoch === stateRef.current.epoch) {
                update((current) => {
                  const latest = getSlot(binding.owner);
                  if (latest.pending !== submission) return current;
                  return putSlot(current, binding.owner, {
                    ...latest,
                    pending: undefined,
                    retry: submission,
                    value:
                      latest.version === submission.version &&
                      (!independent || binding.owner !== NEW_CHAT)
                        ? independent
                          ? {
                              ...submission.raw,
                              text: snapshot.text,
                              uploads: snapshot.uploads,
                              skill: snapshot.skillName ? { name: snapshot.skillName } : null,
                            }
                          : submission.raw
                        : latest.value,
                  });
                });
              }
              throw error;
            } finally {
              prune(binding.owner);
            }
          },
          inputId(snapshot) {
            const retry = getSlot(binding.owner).retry;
            return retry && sameSnapshot(retry.snapshot, snapshot) && retry.snapshot.inputId
              ? retry.snapshot.inputId
              : snapshot.inputId || randomUUID();
          },
          cancel: () => {
            if (binding.epoch === stateRef.current.epoch)
              getSlot(binding.owner).pending?.controller.abort();
          },
          retain: () => {
            activeBindings.current.add(binding);
          },
          release() {
            activeBindings.current.delete(binding);
            // StrictMode immediately retains the same binding after its probe cleanup.
            queueMicrotask(() => {
              if (binding.epoch === stateRef.current.epoch) prune(binding.owner);
            });
          },
        };
        return binding;
      },
      prefill(intent, value) {
        update((current) => {
          if (current.intents.has(intent)) return current;
          const intents = new Set(current.intents).add(intent);
          if (hasDraft(current.draft.value) || current.draft.pending)
            return { ...current, intents };
          return {
            ...current,
            intents,
            draft: {
              value: { ...current.draft.value, ...value },
              version: current.draft.version + 1,
            },
          };
        });
      },
      isSubmitting: () => Boolean(stateRef.current.draft.pending),
      reset() {
        for (const slot of [stateRef.current.draft, ...Object.values(stateRef.current.sessions)])
          slot.pending?.controller.abort();
        update((current) => ({ ...initialState(current.epoch + 1), intents: current.intents }));
      },
    };
  }, [update]);
  return (
    <ControllerContext.Provider value={controller}>
      <StateContext.Provider value={state}>
        <DraftAuthBoundary reset={controller.reset} />
        <Fragment key={state.epoch}>{children}</Fragment>
      </StateContext.Provider>
    </ControllerContext.Provider>
  );
}

function DraftAuthBoundary({ reset }: { reset: () => void }) {
  const auth = useAuthStateSnapshot();
  // Observe the existing public identity cache without making another auth probe.
  const { data: identity } = useDashboardIdentity({ enabled: false });
  const previousIdentity = useRef<string | undefined>(undefined);
  const previousSignedIn = useRef<boolean | undefined>(undefined);
  useLayoutEffect(() => {
    const id =
      identity?.kind === "guardian"
        ? `guardian:${identity.userId}`
        : identity?.kind === "visitor"
          ? `visitor:${identity.accountId}`
          : identity?.kind;
    const knownAuth = auth.ready && auth.backendReachable && auth.bootstrap !== null;
    const signedIn = hasSession(auth.bootstrap);
    if (
      (knownAuth && previousSignedIn.current === true && !signedIn) ||
      (id !== undefined &&
        previousIdentity.current !== undefined &&
        id !== previousIdentity.current)
    )
      reset();
    if (knownAuth) previousSignedIn.current = signedIn;
    if (id !== undefined) previousIdentity.current = id;
  }, [auth, identity, reset]);
  return null;
}
