// @rstest-environment jsdom
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  clearNewChatDraft,
  loadNewChatDraft,
  saveNewChatDraft,
  type NewChatDraft,
} from "./new-chat-draft-storage";

const empty: NewChatDraft = {
  version: 1,
  text: "",
  projectPath: "default",
  agentMention: null,
  skill: null,
  personaId: "",
};
afterEach(() => {
  rs.restoreAllMocks();
  sessionStorage.clear();
});

describe("new-chat draft storage", () => {
  it("round-trips raw text and context", () => {
    const draft: NewChatDraft = {
      ...empty,
      text: "  中文🙂\n  ",
      projectPath: "project",
      personaId: "person",
      agentMention: { appId: "app", agentName: "agent", appLabel: "App" },
      skill: { name: "skill", iconUrl: null },
    };
    saveNewChatDraft(draft);
    expect(loadNewChatDraft()).toEqual(draft);
    expect(Object.keys(JSON.parse(sessionStorage.getItem("rome:new-chat-draft")!))).toEqual(
      Object.keys(draft),
    );
  });
  it.each([
    "oops",
    "null",
    '{"version":2}',
    '{"version":1,"text":42}',
  ])("ignores invalid records: %s", (bad) => {
    sessionStorage.setItem("rome:new-chat-draft", bad);
    expect(loadNewChatDraft()).toBeNull();
  });
  it("removes an empty/default draft and leaves unrelated keys alone", () => {
    sessionStorage.setItem("unrelated", "keep");
    saveNewChatDraft({ ...empty, text: "draft" });
    saveNewChatDraft(empty);
    expect(sessionStorage.getItem("rome:new-chat-draft")).toBeNull();
    expect(sessionStorage.getItem("unrelated")).toBe("keep");
  });
  it("keeps context-only drafts", () => {
    saveNewChatDraft({ ...empty, skill: { name: "skill" } });
    expect(loadNewChatDraft()?.skill).toEqual({ name: "skill" });
  });
  it("tolerates disabled or full storage", () => {
    for (const method of ["getItem", "setItem", "removeItem"] as const)
      rs.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(loadNewChatDraft()).toBeNull();
    expect(() => saveNewChatDraft({ ...empty, text: "local" })).not.toThrow();
    expect(() => saveNewChatDraft(empty)).not.toThrow();
    expect(() => clearNewChatDraft()).not.toThrow();
  });
});
