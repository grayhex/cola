import type * as React from "react";
import { eventPresentation } from "../../lib/content-labels.ts";
import styles from "./content-label.module.css";

export function ContentLabel({
  tone = "neutral",
  className = "",
  children,
  ...props
}: React.ComponentPropsWithoutRef<"span"> & { tone?: string }) {
  return (
    <span
      {...props}
      className={`${styles.label} ${className}`}
      data-tone={tone}
    >
      {children}
    </span>
  );
}
export function ContentTypeLabel({
  type,
  children,
}: {
  type: string;
  children?: React.ReactNode;
}) {
  const kind = eventPresentation[type as keyof typeof eventPresentation] || {
    label: "Событие",
    tone: "neutral",
  };
  return (
    <ContentLabel tone={kind.tone} data-event-label={type}>
      {children}
      {kind.label}
    </ContentLabel>
  );
}
export function LabelRow({
  className = "",
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div {...props} className={`${styles.row} ${className}`}>
      {children}
    </div>
  );
}
