// @rstest-environment jsdom
import { useEffect } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import i18n from "@/i18n";
import { SlotProvider } from "@/components/slot";
import { FreeGrid } from "./FreeGrid";
import { setActiveSession } from "./use-free-cells";

const mounted = rs.hoisted(() => rs.fn());
rs.mock("@/hooks/use-apps", () => ({ useApps: () => ({ apps: [] }) }));
rs.mock("@/components/chat/use-session-identity", () => ({
  useSessionIdentity: () => ({ sessionName: null }),
}));
rs.mock("./ChatWidget", () => ({ ChatWidget: () => null }));
rs.mock("./AppWidget", () => ({
  AppWidget: ({ placementId }: { placementId: string }) => {
    useEffect(() => {
      mounted(placementId);
    }, [placementId]);
    return <iframe title="Seeded app" />;
  },
}));

function ReplacePrefill() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="prefill">{location.state?.draft}</output>
      <button
        type="button"
        onClick={() => {
          const state = JSON.parse(JSON.stringify(location.state));
          delete state.draft;
          navigate(location.pathname, { replace: true, state });
        }}
      >
        Consume prefill with cloned state
      </button>
      <button
        type="button"
        onClick={() =>
          navigate(location.pathname, {
            replace: true,
            state: {
              widgets: [{ type: "app", appId: "notes", route: "next" }],
            },
          })
        }
      >
        Change widget seed
      </button>
    </>
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  mounted.mockClear();
  rs.stubGlobal("fetch", rs.fn().mockResolvedValue(Response.json({ layout: [] })));
  localStorage.clear();
  setActiveSession("reset");
  setActiveSession(null);
});
afterEach(() => {
  cleanup();
  rs.unstubAllGlobals();
  localStorage.clear();
});

describe("FreeGrid navigation seeds", () => {
  it("places an app only once across a cloned prefill-state replacement", () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/chat",
            state: {
              draft: "Chat with app",
              widgets: [{ type: "app", appId: "notes" }],
            },
          },
        ]}
      >
        <SlotProvider>
          <FreeGrid />
          <ReplacePrefill />
        </SlotProvider>
      </MemoryRouter>,
    );
    const iframe = screen.getByTitle("Seeded app");
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("prefill").textContent).toBe("Chat with app");
    fireEvent.click(screen.getByRole("button", { name: "Consume prefill with cloned state" }));
    expect(screen.getByTestId("prefill").textContent).toBe("");
    expect(screen.getByTitle("Seeded app")).toBe(iframe);
    expect(mounted).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Change widget seed" }));
    expect(screen.getByTitle("Seeded app")).not.toBe(iframe);
    expect(mounted).toHaveBeenCalledTimes(2);
  });
});
