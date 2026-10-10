import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "@rstest/core";
import { LoaderGrid, LoadingState, useElapsedTimer } from "./loading-state.js";
import { mountShadowApp } from "./test/shadow-app.js";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("LoadingState", () => {
  it("renders as role='status' with default label 'Churning' and a live elapsed timer", () => {
    render(<LoadingState />);

    const status = screen.getByRole("status");
    expect(status).toBeDefined();
    expect(status.getAttribute("data-variant")).toBe("Drive");
    expect(screen.getByText("Churning")).toBeDefined();
    expect(screen.getByText("0.0s")).toBeDefined();
  });

  it("renders 9 pixel grid cells inside an aria-hidden grid", () => {
    const { container } = render(<LoadingState />);

    const grid = container.querySelector('[data-slot="loader-grid"]');
    expect(grid).not.toBeNull();
    expect(grid?.getAttribute("aria-hidden")).toBe("true");

    const cells = container.querySelectorAll('[data-slot="loader-grid-cell"]');
    expect(cells.length).toBe(9);
  });

  it("renders square cells with system theme color (bg-primary) by default", () => {
    const { container } = render(<LoadingState variant="Drive" />);

    const cells = container.querySelectorAll('[data-slot="loader-grid-cell"]');
    expect(cells[0]?.className).not.toContain("rounded-full");
    expect(cells[0]?.className).toContain("bg-primary");
    expect(cells[0]?.className).toContain("size-1");

    const label = container.querySelector('[data-slot="loading-state-label"]') as HTMLElement;
    expect(label.style.backgroundImage).toContain("var(--primary)");
  });

  it("applies rounded-full cells for Dots variant", () => {
    const { container } = render(<LoadingState variant="Dots" />);

    const cells = container.querySelectorAll('[data-slot="loader-grid-cell"]');
    for (const cell of cells) {
      expect(cell.className).toContain("rounded-full");
    }
  });

  it("dims the center cell in the Orbit variant", () => {
    const { container } = render(<LoadingState variant="Orbit" />);

    const cells = container.querySelectorAll('[data-slot="loader-grid-cell"]');
    expect(cells.length).toBe(9);

    // Center cell (index 4) should have opacity 0.07 and animation: none
    const centerCell = cells[4] as HTMLElement;
    expect(centerCell.style.opacity).toBe("0.07");
    expect(centerCell.style.animation).toBe("none");

    // Perimeter cells should have pixel-on animation
    const cornerCell = cells[0] as HTMLElement;
    expect(cornerCell.style.opacity).toBe("0.15");
    expect(cornerCell.style.animation).toContain("pixel-on 950ms");
  });

  it("takes a caller-provided label", () => {
    render(<LoadingState label="Indexing vector store" />);

    expect(screen.getByText("Indexing vector store")).toBeDefined();
    expect(screen.queryByText("Churning")).toBeNull();
  });

  it("takes a custom aria-label when provided", () => {
    render(<LoadingState ariaLabel="Long-running indexing operation" />);

    const status = screen.getByRole("status", {
      name: "Long-running indexing operation",
    });
    expect(status).toBeDefined();
  });

  it("omits the elapsed timer entirely when elapsed={false}", () => {
    const { container } = render(<LoadingState elapsed={false} />);

    expect(container.querySelector('[data-slot="loading-state-elapsed"]')).toBeNull();
  });
  it("forwards className and ref to the root element", () => {
    const ref = createRef<HTMLDivElement>();
    render(<LoadingState ref={ref} className="custom-loader-class" />);

    expect(ref.current).not.toBeNull();
    expect(ref.current?.classList.contains("custom-loader-class")).toBe(true);
  });

  it("includes motion-reduce:animate-none on animated elements for reduced motion", () => {
    const { container } = render(<LoadingState />);

    const label = container.querySelector('[data-slot="loading-state-label"]');
    expect(label?.className).toContain("motion-reduce:animate-none");

    const cell = container.querySelector('[data-slot="loader-grid-cell"]');
    expect(cell?.className).toContain("motion-reduce:animate-none");
  });

  it("renders inside a shadow root under theme scope", () => {
    const { appBody, mountRoot } = mountShadowApp();
    appBody.classList.add("dark");

    render(<LoadingState />, { container: mountRoot });

    const status = mountRoot.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(appBody.contains(status)).toBe(true);
    expect(document.body.querySelector('[role="status"]')).toBeNull();
  });
});

describe("LoaderGrid standalone", () => {
  it("renders standalone with default Drive pattern", () => {
    const { container } = render(<LoaderGrid />);

    const grid = container.querySelector('[data-slot="loader-grid"]');
    expect(grid).not.toBeNull();
    expect(grid?.getAttribute("aria-hidden")).toBe("true");

    const cells = container.querySelectorAll('[data-slot="loader-grid-cell"]');
    expect(cells.length).toBe(9);
  });

  it("renders with custom variant='Dots'", () => {
    const { container } = render(<LoaderGrid variant="Dots" />);

    const cells = container.querySelectorAll('[data-slot="loader-grid-cell"]');
    expect(cells[0]?.className).toContain("rounded-full");
  });

  it("forwards ref and DOM attributes", () => {
    const ref = createRef<HTMLSpanElement>();
    render(<LoaderGrid ref={ref} className="my-grid" id="test-grid" />);

    expect(ref.current).not.toBeNull();
    expect(ref.current?.id).toBe("test-grid");
    expect(ref.current?.classList.contains("my-grid")).toBe(true);
  });
});

describe("useElapsedTimer", () => {
  function TimerTestComponent({ enabled }: { enabled?: boolean }) {
    const elapsed = useElapsedTimer(enabled);
    return <span data-testid="elapsed">{elapsed}</span>;
  }

  it("renders initial 0.0s count", () => {
    render(<TimerTestComponent />);
    expect(screen.getByTestId("elapsed").textContent).toBe("0.0s");
  });

  it("does not start interval when enabled is false", () => {
    render(<TimerTestComponent enabled={false} />);
    expect(screen.getByTestId("elapsed").textContent).toBe("0.0s");
  });
});
