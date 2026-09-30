"use client";
export interface MenuOrigin {
  left: number;
  time: number;
}
import type * as React from "react";
import Link from "next/link";
import { useReducedMotion } from "./motion.tsx";
import { useSite } from "./site-provider.tsx";
import styles from "./global-header.module.css";
import { useCallback, useEffect, useId, useRef, useState } from "react";
// Navigation disclosure: links retain native Tab behavior; arrows/Home/End are shortcuts.
export default function NavPopover({
  label,
  href,
  linkLabel,
  linkName,
  trigger,
  children,
  active,
  className = "",
  onOpen,
  section,
  open: controlledOpen,
  onOpenChange,
  motionOrigin,
}: {
  label: string;
  href?: string;
  linkLabel?: React.ReactNode;
  linkName?: string;
  trigger?: React.ReactNode;
  children: React.ReactNode;
  active?: boolean;
  className?: string;
  onOpen?: () => void;
  section?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  motionOrigin?: React.RefObject<MenuOrigin | null>;
}) {
  const [localOpen, setLocalOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    id = useId();
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange || setLocalOpen;
  const panel = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const openedByHover = useRef(false);
  const reduced = useReducedMotion();
  const { personalSettings } = useSite();
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  useEffect(() => {
    if (!open || !panel.current) return;
    const element = panel.current;
    const previous = motionOrigin?.current;
    const rect = element.getBoundingClientRect();
    if (motionOrigin)
      motionOrigin.current = { left: rect.left, time: Date.now() };
    let disposed = false,
      stop: (() => void) | undefined;
    const started = performance.now();
    if (!reduced)
      import("./interaction-motion.ts")
        .then(({ revealMenu }) => {
          if (
            !disposed &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
            performance.now() - started < 200
          )
            stop = revealMenu(element, previous || null);
        })
        .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
      if (motionOrigin)
        motionOrigin.current = { left: rect.left, time: Date.now() };
    };
  }, [open, reduced, motionOrigin]);
  const close = useCallback(
    (restore = false) => {
      clearTimeout(leaveTimer.current);
      openedByHover.current = false;
      setOpen(false);
      if (restore) button.current?.focus();
    },
    [setOpen],
  );
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
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
  }, [open, close]);
  function show(edge?: "first" | "last") {
    setOpen(true);
    if (!open) onOpen?.();
    if (edge)
      requestAnimationFrame(() => {
        const links = panel.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not(:disabled)",
        );
        links?.[edge === "last" ? links.length - 1 : 0]?.focus();
      });
  }
  return (
    <div
      className={`nav-disclosure ${styles.disclosure} ${className}`}
      data-section={section}
      ref={root}
      data-open={open || undefined}
      onPointerEnter={(e) => {
        clearTimeout(leaveTimer.current);
        if (
          personalSettings.menuOpenOnHover === false ||
          e.pointerType !== "mouse" ||
          !window.matchMedia("(hover: hover) and (pointer: fine)").matches
        )
          return;
        if (!open) {
          openedByHover.current = true;
          show();
        }
      }}
      onPointerLeave={() => {
        clearTimeout(leaveTimer.current);
        if (!openedByHover.current) return;
        leaveTimer.current = setTimeout(() => {
          if (!root.current?.contains(document.activeElement)) close();
        }, 140);
      }}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget))
          close();
      }}
    >
      {href && (
        <Link
          className={"nav-trigger" + (active ? " active" : "")}
          href={href}
          aria-label={linkName}
          title={linkName}
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
        onClick={() => {
          if (open && !openedByHover.current) close();
          else {
            openedByHover.current = false;
            show();
          }
        }}
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
        data-motion-panel
        hidden={!open}
        onClick={(e) => {
          if ((e.target as Element).closest("a,button"))
            close(!!(e.target as Element).closest("button"));
        }}
        onKeyDown={(e) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
          const links = [
              ...panel.current!.querySelectorAll<HTMLElement>(
                "a[href],button:not(:disabled)",
              ),
            ],
            i = links.indexOf(document.activeElement as HTMLElement);
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
