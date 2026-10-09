"use client";
import type * as React from "react";
import { useEffect } from "react";

export interface BikeTabItem {
  id: string;
  label: string;
  /**
   * What the tab holds, in brackets after its name (#378). `null` while it is
   * not known (loading, a failed request): no number is better than a false 0.
   */
  count?: number | null;
}
// The ids tie a tab to its panel; the page's own hash uses the section id.
const tabId = (id: string) => "bike-tab-" + id;
const panelId = (id: string) => "bike-panel-" + id;

// The tabs of the bike page (#366): a tablist with one keyboard stop (arrows,
// Home and End move and open), a row that scrolls sideways on a phone inside
// its own box, never the page.
export function BikeTabList({
  tabs,
  active,
  onSelect,
  label,
  listRef,
}: {
  tabs: readonly BikeTabItem[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
  listRef: React.RefObject<HTMLDivElement | null>;
}) {
  // The open tab stays in view of a narrow row, also when the counts that
  // arrive later make the tabs before it wider (#378).
  const counts = tabs.map((tab) => tab.count ?? "").join();
  useEffect(() => {
    const row = listRef.current;
    const tab = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !tab) return;
    const start = tab.offsetLeft - row.offsetLeft;
    const end = start + tab.offsetWidth;
    if (start < row.scrollLeft) row.scrollLeft = Math.max(0, start - 8);
    else if (end > row.scrollLeft + row.clientWidth)
      row.scrollLeft = end - row.clientWidth + 8;
  }, [active, counts, listRef]);
  return (
    <div
      ref={listRef}
      className="ui-tabs bike-tabs"
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tabId(tab.id)}
          aria-controls={panelId(tab.id)}
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (index +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      tabs.length) %
                    tabs.length;
            onSelect(tabs[next].id);
            document.getElementById(tabId(tabs[next].id))?.focus();
          }}
        >
          {/* One inline run: the label and its count are one phrase (the
              flex gap of the tab would pull them apart). */}
          <span>
            {tab.label}
            {typeof tab.count === "number" && (
              <span className="bike-tab-count"> ({tab.count})</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

// A panel stays mounted while another tab is open: what is typed, opened or
// counted in it is not lost, and the counters in the header keep their data.
// Hidden, it takes no room and no keyboard stop.
export function BikeTabPanel({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={panelId(id)}
      aria-labelledby={tabId(id)}
      data-tab-panel={id}
      className="bike-tabpanel"
      hidden={!active}
    >
      {children}
    </div>
  );
}
