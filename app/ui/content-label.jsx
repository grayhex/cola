import { eventPresentation } from "../../lib/content-labels.js";
import styles from "./content-label.module.css";

export function ContentLabel({ tone = "neutral", className = "", children, ...props }) {
  return <span {...props} className={`${styles.label} ${className}`} data-tone={tone}>{children}</span>;
}
export function ContentTypeLabel({ type, children }) {
  const kind = eventPresentation[type] || { label: "Событие", tone: "neutral" };
  return <ContentLabel tone={kind.tone} data-event-label={type}>{children}{kind.label}</ContentLabel>;
}
export function LabelRow({ className = "", children, ...props }) {
  return <div {...props} className={`${styles.row} ${className}`}>{children}</div>;
}
