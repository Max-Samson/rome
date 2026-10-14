import { expect, test, type Page } from "@playwright/test";

const INPUT = "[data-chat-composer-box] textarea";
const SYNTHETIC_SESSION = "synthetic-draft-session";

async function expectEndCaret(page: Page, raw: string) {
  await expect
    .poll(() =>
      page
        .locator(INPUT)
        .evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]),
    )
    .toEqual([raw.length, raw.length]);
}

async function navigate(page: Page, path: string, state?: Record<string, string>) {
  await page.evaluate(
    ({ path, state }) => {
      window.dispatchEvent(new CustomEvent("rome:host-navigate", { detail: { path, state } }));
    },
    { path, state },
  );
}

/** Synthetic acceptance gates only. This fixture never posts to a real backend. */
async function syntheticRequests(page: Page, holdCreate = false) {
  await page.addInitScript(
    ({ holdCreate, sessionId }) => {
      const harness = {
        creates: 0,
        posts: [] as string[],
        releaseCreate: undefined as (() => void) | undefined,
        releasePost: undefined as ((accepted: boolean) => void) | undefined,
      };
      Object.assign(window, { draftHarness: harness });
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const path = new URL(
          typeof input === "string" ? input : input instanceof URL ? input : input.url,
          location.origin,
        ).pathname;
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (path === "/api/chat/sessions" && method === "POST") {
          harness.creates++;
          if (holdCreate)
            await new Promise<void>((resolve) => {
              harness.releaseCreate = resolve;
            });
          return Response.json({ id: sessionId });
        }
        if (path === "/api/chat/sessions")
          return Response.json([
            {
              id: sessionId,
              name: "Synthetic draft session",
              projectPath: "default",
              createdAt: "2026-10-14T00:00:00.000Z",
              updatedAt: "2026-10-14T00:00:00.000Z",
            },
          ]);
        if (path === `/api/chat/sessions/${sessionId}`)
          return Response.json({
            id: sessionId,
            name: "Synthetic draft session",
            projectPath: "default",
            agentName: null,
            archivedAt: null,
            pinnedAt: null,
          });
        if (path === `/api/chat/sessions/${sessionId}/messages`) return Response.json([]);
        if (path === `/api/chat/sessions/${sessionId}/turns`) {
          if (method !== "POST") return Response.json([]);
          const inputId = String((init?.body as FormData).get("inputId"));
          harness.posts.push(inputId);
          return new Promise<Response>((resolve) => {
            harness.releasePost = (accepted) =>
              resolve(
                accepted
                  ? Response.json({ inputId, turnId: "synthetic-turn", inputState: "queued" })
                  : Response.json({ error: "Synthetic input rejection" }, { status: 500 }),
              );
          });
        }
        if (path.startsWith("/api/chat/turns/synthetic-turn/"))
          return new Response(null, { status: 404 });
        return original(input, init);
      };
    },
    { holdCreate, sessionId: SYNTHETIC_SESSION },
  );
}

async function finishPost(page: Page, accepted: boolean) {
  await page.evaluate((accepted) => {
    (
      window as unknown as { draftHarness: { releasePost: (accepted: boolean) => void } }
    ).draftHarness.releasePost(accepted);
  }, accepted);
}

test("silent draft retention across sessions, settings and the actual New chat shortcut", async ({
  page,
}) => {
  await syntheticRequests(page);
  await page.goto("/chat");
  await expect(page.locator(INPUT)).toBeVisible({ timeout: 30_000 });
  await navigate(page, "/chat", {
    projectPath: "/synthetic/project",
    skill: "synthetic_skill",
    draft: "初始草稿",
  });
  await expect(page.locator(INPUT)).toHaveValue("初始草稿");
  await expectEndCaret(page, "初始草稿");
  let raw = "  中文🙂输入\n第二行\n  ";
  await page.locator(INPUT).fill(raw);
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("synthetic fixture"),
  });
  await expect(page.getByText("synthetic.txt", { exact: true })).toBeVisible();
  await navigate(page, `/chat/${SYNTHETIC_SESSION}`);
  await expect(page).toHaveURL(new RegExp(SYNTHETIC_SESSION));
  await navigate(page, "/chat");
  await expect(page.locator(INPUT)).toHaveValue(raw);
  await expectEndCaret(page, raw);
  await page.keyboard.insertText("追加🙂");
  raw += "追加🙂";
  await expect(page.locator(INPUT)).toHaveValue(raw);
  await expect(page.getByText("synthetic.txt", { exact: true })).toBeVisible();
  await navigate(page, "/settings");
  await expect(page).toHaveURL(/\/settings/);
  const modifier = await page.evaluate(() =>
    navigator.platform.toUpperCase().includes("MAC") ? "Meta" : "Control",
  );
  await page.keyboard.press(`${modifier}+Shift+O`);
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator(INPUT)).toHaveValue(raw);
  await expectEndCaret(page, raw);
  await page.keyboard.press(`${modifier}+Shift+O`);
  await expect(page.locator(INPUT)).toHaveValue(raw);
  await expectEndCaret(page, raw);
  await navigate(page, "/chat", { draft: "conflicting seed" });
  await expect(page.locator(INPUT)).toHaveValue(raw);
  await expectEndCaret(page, raw);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("first send keeps focus and an optimistic row before acceptance; failed POST recovers only on its owning session", async ({
  page,
}) => {
  await syntheticRequests(page);
  await page.goto("/chat");
  await expect(page.locator(INPUT)).toBeVisible({ timeout: 30_000 });
  const raw = "  synthetic first send\n中文  ";
  await page.locator(INPUT).fill(raw);
  await page.locator(INPUT).focus();
  await page.evaluate(
    (selector) =>
      Object.assign(window, { originalDraftTextarea: document.querySelector(selector) }),
    INPUT,
  );
  await page.locator(INPUT).press("Enter");
  await expect(page).toHaveURL(new RegExp(SYNTHETIC_SESSION));
  await expect
    .poll(() =>
      page.evaluate((selector) => {
        const node = (window as unknown as { originalDraftTextarea: Element })
          .originalDraftTextarea;
        return document.querySelector(selector) === node && document.activeElement === node;
      }, INPUT),
    )
    .toBe(true);
  await expect(page.getByText(/synthetic first send/).first()).toBeVisible();
  await expect(page.locator(INPUT)).toHaveValue("");
  await navigate(page, "/settings");
  await navigate(page, "/chat");
  await expect(page.locator(INPUT)).toHaveValue("");
  await page.locator(INPUT).fill("new unrelated draft");
  await finishPost(page, false);
  await expect(page.locator(INPUT)).toHaveValue("new unrelated draft");
  await navigate(page, `/chat/${SYNTHETIC_SESSION}`);
  await expect(page.locator(INPUT)).toHaveValue(raw);
  await page.locator(INPUT).press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { draftHarness: { posts: string[] } }).draftHarness.posts.length,
      ),
    )
    .toBe(2);
  const identities = await page.evaluate(
    () =>
      (window as unknown as { draftHarness: { posts: string[]; creates: number } }).draftHarness,
  );
  expect(identities.posts[0]).toBe(identities.posts[1]);
  expect(identities.creates).toBe(1);
  await finishPost(page, true);
  await expect(page.locator(INPUT)).toHaveValue("");
  await navigate(page, "/chat");
  await expect(page.locator(INPUT)).toHaveValue("new unrelated draft");
});

test("late session creation cannot redirect a remounted draft or erase newer input", async ({
  page,
}) => {
  await syntheticRequests(page, true);
  await page.goto("/chat");
  await expect(page.locator(INPUT)).toBeVisible({ timeout: 30_000 });
  await page.locator(INPUT).fill("old first input");
  await page.locator(INPUT).press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as unknown as { draftHarness: { releaseCreate?: () => void } }).draftHarness
            .releaseCreate,
        ),
      ),
    )
    .toBe(true);
  await navigate(page, "/settings");
  await navigate(page, "/chat");
  await page.locator(INPUT).fill("new draft typed after remount");
  await page.locator(INPUT).press("Enter");
  await page.evaluate(() =>
    (
      window as unknown as { draftHarness: { releaseCreate: () => void } }
    ).draftHarness.releaseCreate(),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as unknown as { draftHarness: { releasePost?: () => void } }).draftHarness
            .releasePost,
        ),
      ),
    )
    .toBe(true);
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator(INPUT)).toHaveValue("new draft typed after remount");
  await finishPost(page, true);
  await expect(page.locator(INPUT)).toHaveValue("new draft typed after remount");
  expect(
    await page.evaluate(
      () => (window as unknown as { draftHarness: { creates: number } }).draftHarness.creates,
    ),
  ).toBe(1);
});

test("a rejected create keeps raw input and manual deletion stays empty", async ({ page }) => {
  // Mock mode refuses creation with 503. No real model/backend request is made.
  await page.goto("/chat");
  await expect(page.locator(INPUT)).toBeVisible({ timeout: 30_000 });
  const raw = "  浏览器失败重试\n保留空白  ";
  await page.locator(INPUT).fill(raw);
  await page.locator(INPUT).press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(INPUT)).toHaveValue(raw);
  await navigate(page, "/settings");
  await navigate(page, "/chat");
  await expect(page.locator(INPUT)).toHaveValue(raw);
  await page.locator(INPUT).fill("");
  await navigate(page, "/settings");
  await navigate(page, "/chat");
  await expect(page.locator(INPUT)).toHaveValue("");
});
