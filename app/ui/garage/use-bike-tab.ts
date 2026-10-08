"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// What the address asks the bike page to show (#366): a tab by the id of its
// section («#discussion»), something inside a panel by its own id (a comment),
// or, with no hash, the comments when the link points at one.
interface Request {
  hash: string;
  inside: string | null;
  comment: boolean;
}
function read(): Request {
  let hash: string;
  try {
    hash = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    hash = "";
  }
  const panel = hash
    ? document.getElementById(hash)?.closest<HTMLElement>("[data-tab-panel]")
    : null;
  return {
    hash,
    // The comments are drawn by a lazily loaded part, so a comment's anchor
    // may not exist yet: its name already says where it lives.
    inside:
      panel?.dataset.tabPanel ??
      (hash.startsWith("comment-") ? "discussion" : null),
    comment: new URLSearchParams(window.location.search).has("comment"),
  };
}
const same = (a: Request, b: Request) =>
  a.hash === b.hash && a.inside === b.inside && a.comment === b.comment;

// The tab of the bike page that is open. The address is the one source: a
// direct link, a reload, Back and Forward, a changed hash and a click on a
// tab or a counter all end in it. `ids` are the tabs the viewer may see now;
// a hash that names another one is kept as it is (the data or the rights may
// still be loading) and the first tab shows meanwhile. `null` request until
// the page is measured, so the server HTML and the first client render agree.
export function useBikeTab(ids: readonly string[]) {
  const [request, setRequest] = useState<Request | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const opening = useRef(true);
  const wanted = request
    ? ids.includes(request.hash)
      ? request.hash
      : request.inside && ids.includes(request.inside)
        ? request.inside
        : !request.hash && request.comment && ids.includes("discussion")
          ? "discussion"
          : null
    : null;
  const active = wanted ?? ids[0] ?? "";
  const current = useRef(active);
  useEffect(() => {
    current.current = active;
  }, [active]);
  useEffect(() => {
    const sync = () =>
      setRequest((previous) => {
        const next = read();
        return previous && same(previous, next) ? previous : next;
      });
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  // A link that opens the page on a tab brings the tabs into view, once.
  useEffect(() => {
    if (!request || !opening.current) return;
    if (!request.hash && !request.comment) opening.current = false;
    else if (wanted) {
      opening.current = false;
      list.current?.scrollIntoView({ block: "start" });
    }
  }, [request, wanted]);
  // `reveal`: a counter or a link in the header: show the tabs as well.
  const select = useCallback((id: string, reveal = false) => {
    opening.current = false;
    if (id !== current.current) {
      window.history.pushState(null, "", "#" + id);
      setRequest(read());
    }
    if (reveal)
      requestAnimationFrame(() =>
        list.current?.scrollIntoView({ block: "start" }),
      );
  }, []);
  return { active, select, list };
}
