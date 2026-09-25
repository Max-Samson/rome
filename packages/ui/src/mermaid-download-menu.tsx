import { useEffect, useMemo, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "./popover.js";

const ACTIONS_SELECTOR = '[data-streamdown="mermaid-block-actions"]';

interface DownloadItem {
  button: HTMLButtonElement;
  label: string;
  text: string;
  title: string;
}

interface DownloadMenu {
  items: DownloadItem[];
  menu: HTMLElement;
  trigger: HTMLButtonElement;
}

function readDownloadMenus(root: ParentNode): DownloadMenu[] {
  const menus: DownloadMenu[] = [];
  for (const actions of root.querySelectorAll(ACTIONS_SELECTOR)) {
    // Streamdown exposes a hook for the action bar but not its download menu.
    // The download control is the direct wrapper that owns both a button and a
    // menu, while the other actions are direct buttons.
    for (const child of actions.children) {
      const trigger = Array.from(child.children).find((element) => element.tagName === "BUTTON") as
        | HTMLButtonElement
        | undefined;
      const menu = Array.from(child.children).find((element) => element.tagName === "DIV") as
        | HTMLElement
        | undefined;
      if (!trigger || !menu) continue;

      const items = Array.from(menu.children)
        .filter((element): element is HTMLButtonElement => element.tagName === "BUTTON")
        .map((button) => ({
          button,
          label: button.getAttribute("aria-label") ?? button.textContent ?? "",
          text: button.textContent ?? "",
          title: button.title,
        }));
      if (items.length > 0) {
        menus.push({ items, menu, trigger });
      }
    }
  }
  return menus;
}

function sameMenus(left: DownloadMenu[], right: DownloadMenu[]): boolean {
  return (
    left.length === right.length && left.every((menu, index) => menu.menu === right[index]?.menu)
  );
}

function PortaledDownloadMenu({ menu }: { menu: DownloadMenu }) {
  const virtualRef = useMemo(() => ({ current: menu.trigger }), [menu.trigger]);

  return (
    <Popover open>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        align="end"
        aria-label={menu.trigger.getAttribute("aria-label") ?? undefined}
        className="max-h-[var(--radix-popover-content-available-height)] w-auto min-w-[120px] gap-0 overflow-y-auto rounded-md border border-border bg-background p-0 shadow-lg ring-0"
        collisionPadding={8}
        data-rome-mermaid-download-menu=""
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          menu.trigger.click();
          menu.trigger.focus();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        role="menu"
        side="bottom"
      >
        {menu.items.map((item, index) => (
          <button
            aria-label={item.label}
            className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40"
            disabled={item.button.disabled}
            key={`${item.label}-${index}`}
            onClick={() => item.button.click()}
            role="menuitem"
            title={item.title}
            type="button"
          >
            {item.text}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function MermaidDownloadMenuLayer({ root }: { root: HTMLElement | null }) {
  const [menus, setMenus] = useState<DownloadMenu[]>([]);

  useEffect(() => {
    const win = root?.ownerDocument.defaultView;
    if (!root || !win) return;
    const managed = new Map<HTMLElement, string>();

    const sync = () => {
      const next = readDownloadMenus(root);
      for (const [menu, display] of managed) {
        if (!next.some((candidate) => candidate.menu === menu)) {
          if (menu.isConnected) menu.style.display = display;
          managed.delete(menu);
        }
      }
      for (const entry of next) {
        if (!managed.has(entry.menu)) managed.set(entry.menu, entry.menu.style.display);
        entry.menu.style.display = "none";
      }
      setMenus((current) => (sameMenus(current, next) ? current : next));
    };

    const observer = new win.MutationObserver(sync);
    const syncAfterClick = () => win.queueMicrotask(sync);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener("click", syncAfterClick);
    sync();
    return () => {
      observer.disconnect();
      root.removeEventListener("click", syncAfterClick);
      for (const [menu, display] of managed) menu.style.display = display;
    };
  }, [root]);

  return menus.map((menu, index) => <PortaledDownloadMenu key={index} menu={menu} />);
}
