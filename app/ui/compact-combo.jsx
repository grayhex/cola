"use client";
import { useEffect, useId, useRef, useState } from "react";
import { limitedOptions } from "../../lib/wizard-options.js";
export default function CompactCombo({
  label,
  value,
  onChange,
  options = [],
  required = false,
  maxLength = 150,
  placeholder = "",
}) {
  const id = useId(),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1);
  const root = useRef(null), gesture = useRef(null);
  useEffect(() => {
    const outside = e => { if (!root.current?.contains(e.target)) { gesture.current = null; setOpen(false); } };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const shown = limitedOptions(options, value);
  const choose = (v) => {
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
          if (gesture.current || root.current?.contains(e.relatedTarget)) return;
          setOpen(false);
          setActive(-1);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
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
        <div className="combo-popup">
          <ul role="listbox" id={id} aria-label={label}>
            {shown.map((v, i) => (
              <li
                role="option"
                aria-selected={i === active}
                id={id + "-" + i}
                key={v}
                onPointerDown={(e) => {
                  if (e.pointerType === "mouse") e.preventDefault();
                  else gesture.current = { x: e.clientX, y: e.clientY, moved: false };
                }}
                onPointerMove={(e) => {
                  const g = gesture.current;
                  if (g && Math.hypot(e.clientX-g.x,e.clientY-g.y)>8) g.moved = true;
                }}
                onPointerCancel={() => { gesture.current = null; }}
                onPointerUp={(e) => {
                  const g = gesture.current;
                  gesture.current = null;
                  if (g && !g.moved && Math.hypot(e.clientX-g.x,e.clientY-g.y)<=8) {
                    e.preventDefault();
                    choose(v);
                  }
                }}
                onClick={() => choose(v)}
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
