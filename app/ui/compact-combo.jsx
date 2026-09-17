"use client";
import { useId, useState } from "react";
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
  const shown = limitedOptions(options, value);
  const choose = (v) => {
    onChange(v);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className="field compact-combo">
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
        onBlur={() => {
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
                  e.preventDefault();
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
