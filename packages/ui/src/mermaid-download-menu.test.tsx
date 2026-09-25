// @rstest-environment jsdom

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MermaidDownloadMenuLayer } from "./mermaid-download-menu.js";

function Fixture({ onDownload }: { onDownload: (format: string) => void }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div ref={setRoot} data-testid="root">
      <div data-streamdown="mermaid-block-actions">
        <div>
          <button type="button" onClick={() => setOpen((value) => !value)}>
            Download diagram
          </button>
          {open ? (
            <div data-testid="source-menu">
              {[
                ["svg", "SVG"],
                ["png", "PNG"],
                ["mmd", "MMD"],
              ].map(([format, label]) => (
                <button
                  aria-label={`Download diagram as ${label}`}
                  key={format}
                  onClick={() => {
                    onDownload(format);
                    setOpen(false);
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button">Copy</button>
      </div>
      <MermaidDownloadMenuLayer root={root} />
    </div>
  );
}

afterEach(cleanup);

describe("Mermaid download menu layer", () => {
  it("moves every format into a portal and delegates the selected download", async () => {
    const downloads: string[] = [];
    render(<Fixture onDownload={(format) => downloads.push(format)} />);

    fireEvent.click(screen.getByRole("button", { name: "Download diagram" }));
    const item = await screen.findByRole("menuitem", { name: "Download diagram as MMD" });
    const root = screen.getByTestId("root");

    expect(root.contains(item)).toBe(false);
    expect(screen.getByTestId("source-menu").style.display).toBe("none");
    fireEvent.mouseDown(item);
    fireEvent.click(item);

    expect(downloads).toEqual(["mmd"]);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("restores focus to the download trigger when Escape closes the menu", async () => {
    render(<Fixture onDownload={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Download diagram" });
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu");

    fireEvent.keyDown(menu, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
