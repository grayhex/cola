"use client";
import NavPopover from "./nav-popover.jsx";
import SiteEmoji from "./site-emoji.jsx";
import { ChevronDown, Check } from "./icons.jsx";
export default function ChoiceMenu({ label, value, choices, onChange }) {
  const icon = (c) =>
    c.symbol ? (
      <span className="site-emoji" aria-hidden="true">
        {c.symbol}
      </span>
    ) : (
      <SiteEmoji name={c.emoji} />
    );
  const current = choices.find((c) => c.value === value) || choices[0];
  return (
    <NavPopover
      label={label}
      className="choice-menu"
      trigger={
        <>
          {icon(current)}
          <span>{current.label}</span>
          <ChevronDown size={14} />
        </>
      }
    >
      <div className="choice-options" role="listbox" aria-label={label}>
        {choices.map((c) => (
          <button
            type="button"
            role="option"
            aria-selected={c.value === value}
            key={c.value}
            className="nav-menu-link"
            onClick={() => onChange(c.value)}
          >
            {icon(c)}
            <span>{c.label}</span>
            {c.value === value && <Check size={15} />}
          </button>
        ))}
      </div>
    </NavPopover>
  );
}
