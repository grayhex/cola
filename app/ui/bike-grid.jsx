"use client";
import styles from "./bike-grid.module.css";
// A single transition for the result set; cards keep their local reaction queues.
export default function BikeGrid({ children, revision }) {
  const transition = revision == null ? "" : revision % 2 ? styles.enterA : styles.enterB;
  return <div className={`bike-grid ${styles.grid} ${transition}`}>{children}</div>;
}
