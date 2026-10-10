"use client";
import type * as React from "react";
import { useEffect, useId, useRef } from "react";
import { useSite } from "../site-provider.tsx";
import { useBackdropClose } from "../use-backdrop-close.ts";
import { X } from "../icons.tsx";
export default function Modal({
  title,
  onClose,
  children,
  dismissible = true,
  wide = false,
  viewer = false,
  graphic,
  description,
  compactHeader = false,
  help,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  dismissible?: boolean;
  wide?: boolean;
  /** The window of an opened photo (#382): as large as the screen allows. */
  viewer?: boolean;
  graphic?: React.ReactNode;
  /**
   * A short note in the head, to the right of the title (#382): what the
   * window is for, without a paragraph of its own between the head and the
   * fields. It describes the window to a screen reader.
   */
  description?: React.ReactNode;
  /** Centered compact composer header; other dialogs retain their layout. */
  compactHeader?: boolean;
  help?: React.ReactNode;
}) {
  const { t } = useSite();
  const ref = useRef<HTMLDialogElement>(null),
    leaving = useRef(false),
    // Its own id: two windows may stand one over the other (#378), and each is
    // named by its own title.
    titleId = useId(),
    descriptionId = useId();
  useEffect(() => {
    const el = ref.current!;
    // The window may unmount before it closes; focus then returns here.
    const opener = document.activeElement;
    leaving.current = false;
    const y = window.scrollY,
      body = document.body,
      previous = body.getAttribute("style");
    Object.assign(body.style, {
      position: "fixed",
      top: `-${y}px`,
      left: "0",
      right: "0",
      width: "100%",
    });
    el.showModal();
    return () => {
      leaving.current = true;
      el.close();
      if (previous === null) body.removeAttribute("style");
      else body.setAttribute("style", previous);
      window.scrollTo({ top: y, behavior: "instant" });
      const current = document.activeElement;
      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        (!current || current === document.body || el.contains(current))
      )
        opener.focus({ preventScroll: true });
    };
  }, []);
  const request = () => {
    if (dismissible) onClose();
  };
  const backdrop = useBackdropClose(request);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        // An Escape the browser does not let us cancel closes the window
        // anyway; onClose below handles it.
        if (e.cancelable) request();
      }}
      onClose={() => {
        // Browsers close a window by themselves on a repeated Escape (close
        // watchers). Reopen it: closing is decided here, and a window with
        // unsaved data asks first (#129).
        // A late event of an earlier close finds the window open again.
        if (leaving.current || !ref.current || ref.current.open) return;
        ref.current.showModal();
        request();
      }}
      {...backdrop}
      className={wide ? "planning" : viewer ? "photo-viewer" : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div
        className={"modal-head" + (compactHeader ? " modal-head-compact" : "")}
      >
        <div className="modal-heading-content">
          {graphic}
          <h2 id={titleId}>{title}</h2>
          {help}
        </div>
        {description && (
          <p id={descriptionId} className="modal-description">
            {description}
          </p>
        )}
        <button className="icon" aria-label={t("Закрыть")} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
