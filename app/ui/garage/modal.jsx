"use client";
import { useEffect, useRef } from "react";
import { useSite } from "../site-provider.jsx";
import { useBackdropClose } from "../use-backdrop-close.js";
import { X } from "../icons.jsx";
export default function Modal({ title, onClose, children, dismissible = true }) {
  const { t } = useSite();
  const ref = useRef(),
    leaving = useRef(false);
  useEffect(() => {
    const el = ref.current;
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
      aria-labelledby="dialog-title"
    >
      <div className="modal-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon" aria-label={t("Закрыть")} onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
