"use client";
import Link from "next/link";
import styles from "./global-header.module.css";
import { useEffect, useId, useRef, useState } from "react";
// Navigation disclosure: links retain native Tab behavior; arrows/Home/End are shortcuts.
export default function NavPopover({
  label,
  href,
  linkLabel,
  trigger,
  children,
  active,
  className = "",
  onOpen,
}) {
  const [open, setOpen] = useState(false),
    root = useRef(null),
    button = useRef(null),
    panel = useRef(null),
    id = useId();
  const close = (restore = false) => {
    setOpen(false);
    if (restore) button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!root.current?.contains(e.target)) close();
    };
    const escape = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  function show(edge) {
    setOpen(true);
    onOpen?.();
    if (edge)
      requestAnimationFrame(() => {
        const links = panel.current?.querySelectorAll(
          "a[href],button:not(:disabled)",
        );
        links?.[edge === "last" ? links.length - 1 : 0]?.focus();
      });
  }
  return (
    <div
      className={`nav-disclosure ${styles.disclosure} ${className}`}
      ref={root}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget))
          close();
      }}
    >
      {href && (
        <Link
          className={"nav-trigger" + (active ? " active" : "")}
          href={href}
          aria-current={active ? "page" : undefined}
        >
          {linkLabel}
        </Link>
      )}
      <button
        ref={button}
        className={
          "nav-trigger" +
          (href ? " nav-chevron" : "") +
          (active ? " active" : "")
        }
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            show(e.key === "ArrowUp" ? "last" : "first");
          }
        }}
      >
        {trigger}
      </button>
      <div
        ref={panel}
        id={id}
        className={`nav-popover ${styles.popover}`}
        hidden={!open}
        onClick={(e) => {
          if (e.target.closest("a,button")) close();
        }}
        onKeyDown={(e) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
          const links = [
              ...panel.current.querySelectorAll(
                "a[href],button:not(:disabled)",
              ),
            ],
            i = links.indexOf(document.activeElement);
          if (!links.length) return;
          e.preventDefault();
          links[
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? links.length - 1
                : (i + (e.key === "ArrowDown" ? 1 : -1) + links.length) %
                  links.length
          ].focus();
        }}
      >
        {children}
      </div>
    </div>
  );
}
