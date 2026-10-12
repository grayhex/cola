"use client";
import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { limitedOptions } from "../../lib/wizard-options.ts";
export default function CompactCombo({
  label,
  value,
  onChange,
  options = [],
  required = false,
  maxLength = 150,
  placeholder = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: string[];
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  const id = useId(),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null),
    popup = useRef<HTMLDivElement>(null),
    gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null),
    touchClick = useRef(false);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        gesture.current = null;
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const shown = limitedOptions(options, value);
  useLayoutEffect(() => {
    if (!open || !shown.length) return;
    const place = () => {
      const field = root.current?.querySelector("input");
      const box = popup.current;
      if (!field || !box) return;
      const anchor = field.getBoundingClientRect(),
        view = window.visualViewport;
      const top = view?.offsetTop || 0,
        left = view?.offsetLeft || 0;
      const height = view?.height || window.innerHeight,
        width = view?.width || window.innerWidth;
      const below = top + height - anchor.bottom - 8,
        above = anchor.top - top - 8;
      const upwards = below < 200 && above > below;
      const room = Math.max(0, upwards ? above : below);
      box.style.width = `${Math.min(anchor.width, width - 16)}px`;
      box.style.left = `${Math.max(left + 8, Math.min(anchor.left, left + width - box.offsetWidth - 8))}px`;
      box.style.setProperty(
        "--combo-list-height",
        `${Math.min(192, Math.max(0, room - (box.querySelector("small")?.getBoundingClientRect().height || 0) - 2))}px`,
      );
      box.style.top = `${upwards ? anchor.top - box.offsetHeight - 4 : anchor.bottom + 4}px`;
    };
    place();
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open, shown.length]);
  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div ref={root} className="field compact-combo">
      <label htmlFor={id + "-input"}>{label}</label>
      <input
        id={id + "-input"}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && !!shown.length}
        aria-controls={id}
        aria-activedescendant={
          open && active >= 0 && shown[active] ? id + "-" + active : undefined
        }
        autoComplete="off"
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (gesture.current || root.current?.contains(e.relatedTarget))
            return;
          setOpen(false);
          setActive(-1);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            setOpen(false);
            e.stopPropagation();
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActive((a) =>
              Math.max(
                0,
                Math.min(
                  shown.length - 1,
                  a + (e.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if (e.key === "Enter" && open && active >= 0 && shown[active]) {
            e.preventDefault();
            choose(shown[active]);
          }
        }}
      />
      {open && !!shown.length && (
        <div ref={popup} className="combo-popup">
          <ul role="listbox" id={id} aria-label={label}>
            {shown.map((v, i) => (
              <li
                role="option"
                aria-selected={i === active}
                id={id + "-" + i}
                key={v}
                onPointerDown={(e) => {
                  touchClick.current = e.pointerType !== "mouse";
                  if (e.pointerType === "mouse") e.preventDefault();
                  else
                    gesture.current = {
                      x: e.clientX,
                      y: e.clientY,
                      moved: false,
                    };
                }}
                onPointerMove={(e) => {
                  const g = gesture.current;
                  if (g && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 8)
                    g.moved = true;
                }}
                onPointerCancel={() => {
                  gesture.current = null;
                }}
                onPointerUp={(e) => {
                  const g = gesture.current;
                  gesture.current = null;
                  if (
                    g &&
                    !g.moved &&
                    Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 8
                  ) {
                    e.preventDefault();
                    choose(v);
                  }
                }}
                onClick={(e) => {
                  if (!touchClick.current || e.detail === 0) choose(v);
                }}
              >
                {v}
              </li>
            ))}
          </ul>
          <small>До 8 вариантов · уточните поиском или введите своё</small>
        </div>
      )}
    </div>
  );
}
