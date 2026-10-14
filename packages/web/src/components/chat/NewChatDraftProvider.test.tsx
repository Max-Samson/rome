// @rstest-environment jsdom
import { createRef, StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import i18n from "@/i18n";
import { AUTH_QUERY_KEY } from "@/lib/auth-state";
import { DASHBOARD_IDENTITY_QUERY_KEY } from "@/hooks/use-dashboard-identity";
import { DEFAULT_PROJECT_NAME } from "@/lib/chat-constants";
import type {
  ChatComposerHandle,
  ChatComposerProps,
  ChatComposerSendControls,
  ChatComposerSnapshot,
} from "./ChatComposer";
import { DraftChatComposer } from "./DraftChatComposer";
import {
  NewChatDraftProvider,
  useNewChatDraftBinding,
  useNewChatDraftController,
  type NewChatDraftBinding,
} from "./NewChatDraftProvider";

rs.mock("@/components/logo", () => ({ RomeLogo: () => <span /> }));
rs.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({ data: { enableImpersonation: true, guardianName: "Synthetic guardian" } }),
  useInvalidateSettings: () => rs.fn(),
}));
rs.mock("@/hooks/use-people", () => ({ usePeople: () => ({ data: [] }) }));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
  rs.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(onSend: ChatComposerProps["onSend"] = rs.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(AUTH_QUERY_KEY, {
    ready: true,
    backendReachable: true,
    bootstrap: { phase: "ready" },
  });
  client.setQueryData(DASHBOARD_IDENTITY_QUERY_KEY, { kind: "guardian", userId: "guardian-a" });
  const composerRef = createRef<ChatComposerHandle>();
  let binding!: NewChatDraftBinding;
  let controller!: NonNullable<ReturnType<typeof useNewChatDraftController>>;
  let navigate!: ReturnType<typeof useNavigate>;
  let unrelatedRenders = 0;
  function Unrelated() {
    unrelatedRenders++;
    return <aside>Dashboard</aside>;
  }
  function Navigation() {
    navigate = useNavigate();
    return <button onClick={() => navigate("/chat")}>New chat</button>;
  }
  function ComposerRoute() {
    const { sessionId } = useParams();
    const control = useNewChatDraftBinding(sessionId);
    controller = useNewChatDraftController()!;
    if (control) binding = control.binding;
    return (
      <DraftChatComposer
        sessionId={sessionId}
        ref={composerRef}
        onSend={onSend}
        showProjectSelector={!sessionId}
        lockAgentMention={Boolean(sessionId)}
      />
    );
  }
  rs.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/chat/projects")
      return Response.json({
        rootPath: "/synthetic",
        defaultPath: "/synthetic/default",
        projects: [],
      });
    if (url === "/api/apps/updates") return Response.json({ upgradable: [] });
    if (url === "/api/apps") return Response.json([]);
    if (url === "/api/skills")
      return Response.json({
        skills: [
          {
            name: "synthetic_skill",
            localName: "synthetic_skill",
            description: "Synthetic skill",
            tools: [],
            ownerType: "app",
            ownerId: "synthetic",
            ownerLabel: "Synthetic App",
            ownerDescription: "Synthetic fixture",
            iconUrl: null,
          },
        ],
      });
    if (url === "/api/chat/agents")
      return Response.json([
        {
          ownerId: "synthetic",
          ownerType: "app",
          label: "Synthetic App",
          description: "",
          iconUrl: null,
          agents: [{ name: "synthetic_agent", description: "Synthetic agent" }],
        },
      ]);
    return Response.json({}, { status: 404 });
  });
  render(
    <QueryClientProvider client={client}>
      <StrictMode>
        <MemoryRouter initialEntries={["/chat"]}>
          <NewChatDraftProvider>
            <Unrelated />
            <Navigation />
            <Routes>
              <Route path="/chat" element={<ComposerRoute key="new" />} />
              <Route path="/session/:sessionId" element={<ComposerRoute key="session" />} />
              <Route path="/other" element={<p>Other route</p>} />
            </Routes>
          </NewChatDraftProvider>
        </MemoryRouter>
      </StrictMode>
    </QueryClientProvider>,
  );
  return {
    client,
    composerRef,
    binding: () => binding,
    controller: () => controller,
    go: async (path: string) => {
      await act(async () => {
        navigate(path);
      });
    },
    renders: () => unrelatedRenders,
    text: () => (screen.getByRole("textbox") as HTMLTextAreaElement).value,
  };
}

describe("dashboard new-chat draft", () => {
  it("does not replay a consumed navigation seed after an identity reset", async () => {
    const app = setup();
    act(() => app.controller().prefill("history-entry", { text: "private navigation seed" }));
    expect(app.text()).toBe("private navigation seed");

    await act(async () => {
      app.client.setQueryData(DASHBOARD_IDENTITY_QUERY_KEY, {
        kind: "guardian",
        userId: "guardian-b",
      });
    });
    await waitFor(() => expect(app.text()).toBe(""));

    act(() => app.controller().prefill("history-entry", { text: "private navigation seed" }));
    expect(app.text()).toBe("");
  });

  it.each([
    "focus",
    "selection",
  ])("discards pending seed caret positioning after intervening %s without editing the draft", (interaction) => {
    const app = setup();
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    const selection = rs.spyOn(textarea, "setSelectionRange");
    const raw = "  中文🙂\n第二行\n  ";
    let version!: number;
    act(() => {
      app.controller().prefill("pending-caret", { text: raw });
      version = app.binding().current().version;
      app.composerRef.current!.focus({ caret: "end" });
      if (interaction === "focus") screen.getByRole("button", { name: "New chat" }).focus();
      else fireEvent.select(textarea);
    });
    expect(app.text()).toBe(raw);
    expect(selection).not.toHaveBeenCalled();
    expect(app.binding().current().version).toBe(version);
  });

  it("restores raw Chinese/multiline text, selections and the same File after route remounts and repeated New chat", async () => {
    const app = setup();
    const raw = "  中文草稿\n第二行\n  ";
    const file = new File(["synthetic"], "note.txt", { type: "text/plain" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: raw } });
    act(() => {
      const binding = app.binding();
      binding.change("projectPath", "/synthetic/project");
      binding.change("agentMention", {
        appId: "synthetic",
        agentName: "synthetic/agent",
        appLabel: "Synthetic",
        iconUrl: null,
      });
      binding.change("skill", { name: "synthetic_skill" });
      binding.change("personaId", "synthetic-person");
      app.composerRef.current!.addFiles([file]);
    });
    const expected = app.binding().current().value;
    const renders = app.renders();
    await app.go("/other");
    await app.go("/chat");
    expect(app.text()).toBe(raw);
    expect(app.binding().current().value).toEqual(expected);
    expect(app.binding().current().value.uploads[0].file).toBe(file);
    await app.go("/session/existing");
    await app.go("/chat");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(app.text()).toBe(raw);
    expect(app.binding().current().value).toEqual(expected);
    expect(app.renders()).toBe(renders);
  });

  it("keeps explicit deletion empty and insertText/skill conversion on the same source", async () => {
    const app = setup();
    act(() => app.composerRef.current!.insertText("  task\n中文  ", { focus: false }));
    expect(app.binding().current().value.text).toBe("  task\n中文  ");
    act(() => app.composerRef.current!.setSkillSelection({ name: "synthetic" }));
    expect(app.binding().current().value.skill?.name).toBe("synthetic");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    await app.go("/other");
    await app.go("/chat");
    expect(app.text()).toBe("");
  });

  it("keeps slash/@ conversions, pasted files and insertText in the controlled draft across remounts", async () => {
    const app = setup();
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "@synthetic_agent" } });
    fireEvent.mouseDown(await screen.findByText("synthetic_agent"));
    expect(app.text()).toBe("");
    expect(app.binding().current().value.agentMention?.agentName).toBe("synthetic_agent");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox")));
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "/synthetic_skill" } });
    const skillOption = await screen.findByRole("option", { name: "/synthetic_skill" });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.mouseDown(skillOption);
    expect(app.text()).toBe("");
    expect(app.binding().current().value.skill?.name).toBe("synthetic_skill");
    const file = new File(["synthetic paste"], "pasted.txt", { type: "text/plain" });
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { files: [file], items: [] } });
    act(() => app.composerRef.current!.insertText("  中文\n插入文本  ", { focus: false }));
    await app.go("/other");
    await app.go("/chat");
    expect(app.text()).toBe("  中文\n插入文本  ");
    expect(app.binding().current().value.agentMention?.agentName).toBe("synthetic_agent");
    expect(app.binding().current().value.skill?.name).toBe("synthetic_skill");
    expect(app.binding().current().value.uploads[0].file).toBe(file);
  });

  it("does not submit an Enter used to finish Chinese composition", () => {
    const send = rs.fn();
    const app = setup(send);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "中文" } });
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    expect(send).not.toHaveBeenCalled();
    expect(app.text()).toBe("中文");
  });

  it.each([
    "success",
    "failure",
  ] as const)("does not overwrite newer edits on pending %s", async (outcome) => {
    const gate = deferred<void>();
    const send = rs.fn(() => gate.promise);
    const app = setup(send);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  old\n中文  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(app.text()).toBe("");
    expect(app.binding().current().pending?.raw.text).toBe("  old\n中文  ");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "new edit" } });
    await app.go("/other");
    await app.go("/chat");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => {
      outcome === "success" ? gate.resolve() : gate.reject(new Error("synthetic failure"));
    });
    expect(app.text()).toBe("new edit");
  });

  it("restores exact untrimmed input after create/send failure and reuses its inputId on retry", async () => {
    const send = rs
      .fn()
      .mockRejectedValueOnce(new Error("synthetic rejection"))
      .mockResolvedValueOnce(undefined);
    const app = setup(send);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  retry\n中文  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(app.text()).toBe("  retry\n中文  "));
    const inputId = send.mock.calls[0][0].inputId;
    await app.go("/other");
    await app.go("/chat");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0].inputId).toBe(inputId);
    await waitFor(() => expect(app.text()).toBe(""));
  });

  it("keeps a cancelled upload retryable across unmount and retains its File", async () => {
    const send = rs.fn(
      (_snapshot: ChatComposerSnapshot, controls: ChatComposerSendControls) =>
        new Promise<void>((_resolve, reject) => {
          controls.signal.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          );
        }),
    );
    const app = setup(send);
    const file = new File(["safe fixture"], "cancel.txt", { type: "text/plain" });
    act(() => app.composerRef.current!.addFiles([file]));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  upload\n " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await app.go("/other");
    expect(send.mock.calls[0][1].signal.aborted).toBe(false);
    await app.go("/chat");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(app.binding().current().pending).toBeUndefined());
    expect(app.text()).toBe("  upload\n ");
    expect(app.binding().current().value.uploads[0].file).toBe(file);
  });

  it("hands a pending first input to its session, blocks duplicate submits there, and retries the same identity", async () => {
    const gate = deferred<void>();
    const send = rs.fn((_snapshot: ChatComposerSnapshot, controls: ChatComposerSendControls) => {
      controls.onSessionCreated?.("created");
      return gate.promise;
    });
    const app = setup(send);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "first message" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const inputId = send.mock.calls[0][0].inputId;
    await app.go("/other");
    await app.go("/chat");
    expect(app.text()).toBe("");
    expect(app.binding().current().pending).toBeUndefined();
    await app.go("/session/created");
    act(() => app.composerRef.current!.submit("duplicate"));
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => gate.reject(new Error("failed POST")));
    expect(app.text()).toBe("first message");
    send.mockImplementation(() => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0].inputId).toBe(inputId);
  });

  it("never resurrects accepted input when later work fails", async () => {
    const app = setup(async (_snapshot, controls) => {
      controls.onSessionCreated?.("accepted");
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "accepted input" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(app.text()).toBe(""));
    await app.go("/other");
    await app.go("/chat");
    expect(app.text()).toBe("");
    expect(app.binding().current().retry).toBeUndefined();
  });

  it("silently consumes conflicting prefills once; deletion cannot replay an old intent", async () => {
    const app = setup();
    act(() => app.controller().prefill("intent-1", { text: "seed" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "edited seed" } });
    await app.go("/other");
    await app.go("/chat");
    act(() => app.controller().prefill("intent-1", { text: "seed" }));
    expect(app.text()).toBe("edited seed");
    act(() => app.controller().prefill("intent-2", { text: "conflict" }));
    expect(app.text()).toBe("edited seed");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Replace draft" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    act(() => {
      app.controller().prefill("intent-1", { text: "seed" });
      app.controller().prefill("intent-2", { text: "conflict" });
    });
    expect(app.text()).toBe("");
    act(() =>
      app.controller().prefill("intent-3", { text: "new seed", projectPath: "/synthetic/new" }),
    );
    expect(app.text()).toBe("new seed");
    expect(app.binding().current().value.projectPath).toBe("/synthetic/new");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("silently ignores seeds when context/files or an in-flight submission owns the draft", async () => {
    const gate = deferred<void>();
    const app = setup(() => gate.promise);
    act(() => {
      app.binding().change("skill", { name: "chosen_skill" });
      app.controller().prefill("context-conflict", { text: "incoming" });
    });
    expect(app.text()).toBe("");
    expect(app.binding().current().value.skill?.name).toBe("chosen_skill");
    act(() => app.binding().change("skill", null));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sending" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    act(() => app.controller().prefill("pending-conflict", { text: "incoming" }));
    expect(app.text()).toBe("");
    await act(async () => gate.resolve());
    act(() => {
      app.controller().prefill("context-conflict", { text: "incoming" });
      app.controller().prefill("pending-conflict", { text: "incoming" });
    });
    expect(app.text()).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => app.controller().prefill("fresh-intent", { text: "fresh" }));
    expect(app.text()).toBe("fresh");
  });

  it("a released binding cannot mutate a remounted draft through a stale async field setter", async () => {
    const app = setup();
    const old = app.binding();
    await app.go("/other");
    await app.go("/chat");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "current draft" } });
    act(() => old.change("text", "late old insertion"));
    expect(app.text()).toBe("current draft");
  });

  it("independent quick-entry send keeps unrelated text/context/files", async () => {
    const send = rs.fn(
      async (_snapshot: ChatComposerSnapshot, controls: ChatComposerSendControls) => {
        controls.onSessionCreated?.("quick-entry");
      },
    );
    const app = setup(send);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "unrelated draft" } });
    const file = new File(["safe"], "unrelated.txt");
    act(() => {
      app.composerRef.current!.addFiles([file]);
      app.composerRef.current!.setSkillSelection({ name: "unrelated_skill" });
      app.composerRef.current!.submit("independent prompt", { skillName: "quick_skill" });
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0].uploads).toEqual([]);
    expect(send.mock.calls[0][0].skillName).toBe("quick_skill");
    await app.go("/other");
    await app.go("/chat");
    expect(app.text()).toBe("unrelated draft");
    expect(app.binding().current().value.skill?.name).toBe("unrelated_skill");
    expect(app.binding().current().value.uploads[0].file).toBe(file);
  });

  it.each([
    "logout",
    "switch",
    "switch-success",
  ] as const)("clears on %s and ignores stale completion/creation callbacks", async (change) => {
    const gate = deferred<void>();
    let controls!: ChatComposerSendControls;
    const app = setup((_snapshot, next) => {
      controls = next;
      return gate.promise;
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "guardian-a private draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {
      if (change === "logout")
        app.client.setQueryData(AUTH_QUERY_KEY, {
          ready: true,
          backendReachable: true,
          bootstrap: { phase: "needs-signin", method: "local" },
        });
      else
        app.client.setQueryData(DASHBOARD_IDENTITY_QUERY_KEY, {
          kind: "guardian",
          userId: "guardian-b",
        });
    });
    await waitFor(() => expect(controls.signal.aborted).toBe(true));
    expect(() => controls.onSessionCreated?.("stale-session")).toThrow();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "new guardian draft" } });
    await act(async () =>
      change === "switch-success" ? gate.resolve() : gate.reject(new Error("late failure")),
    );
    await app.go("/other");
    await app.go("/chat");
    expect(app.text()).toBe("new guardian draft");
    expect(app.binding().current().value.projectPath).toBe(DEFAULT_PROJECT_NAME);
  });
});
