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
  graphic,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  dismissible?: boolean;
  wide?: boolean;
  graphic?: React.ReactNode;
}) {
  const { t } = useSite();
  const ref = useRef<HTMLDialogElement>(null),
    leaving = useRef(false),
    // Its own id: two windows may stand one over the other (#378), and each is
    // named by its own title.
    titleId = useId();
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
      className={wide ? "planning" : undefined}
      aria-labelledby={titleId}
    >
      <div className="modal-head">
        <div className="modal-heading-content">
          {graphic}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button className="icon" aria-label={t("Закрыть")} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
