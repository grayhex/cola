"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "./icons.tsx";
import styles from "./multi-select-combo.module.css";

export type MultiOption = { value: string; label: string };

// A compact combo box that chooses several options at once (#370): one
// control with a short summary of what is chosen, a list of checkable options
// under it. Focus stays on the control; arrows move through the options,
// Space or Enter toggles one, Escape and Tab close the list.
export default function MultiSelectCombo({
  label,
  options,
  value,
  onChange,
  summary,
  disabled = false,
}: {
  label: string;
  options: readonly MultiOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  // What the control says when closed; the parent knows its own wording.
  summary: string;
  disabled?: boolean;
}) {
  const id = useId(),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  // The chosen values keep the order of the options, whatever the order of
  // the clicks: the stored list does not depend on how it was made.
  const toggle = (option: string) => {
    const next = new Set(value);
    if (!next.delete(option)) next.add(option);
    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  };
  const move = (to: number) =>
    setActive(Math.max(0, Math.min(options.length - 1, to)));
  return (
    <div ref={root} className={"field " + styles.root}>
      <span id={id + "-label"}>{label}</span>
      <button
        type="button"
        role="combobox"
        className={styles.control}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-labelledby={id + "-label " + id + "-summary"}
        aria-activedescendant={open ? id + "-" + active : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            // Closes the list, not the window that holds the form.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "Tab") setOpen(false);
          else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) setOpen(true);
            else move(active + (e.key === "ArrowDown" ? 1 : -1));
          } else if (open && e.key === "Home") {
            e.preventDefault();
            move(0);
          } else if (open && e.key === "End") {
            e.preventDefault();
            move(options.length - 1);
          } else if (open && (e.key === " " || e.key === "Enter")) {
            // The button's own click would close the list: the key chooses.
            e.preventDefault();
            toggle(options[active].value);
          }
        }}
      >
        <span id={id + "-summary"}>{summary}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <ul
          id={id}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={id + "-label"}
          className={styles.list}
        >
          {options.map((option, index) => {
            const checked = value.includes(option.value);
            return (
              <li
                key={option.value}
                id={id + "-" + index}
                role="option"
                aria-selected={checked}
                data-active={index === active || undefined}
                // A press keeps the focus on the control.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  setActive(index);
                  toggle(option.value);
                }}
              >
                <span className={styles.box} aria-hidden="true">
                  {checked && <Check size={13} />}
                </span>
                {option.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
