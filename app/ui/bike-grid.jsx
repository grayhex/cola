"use client";
import styles from "./bike-grid.module.css";
import { MotionList } from "./motion.tsx";
// A single transition for the result set; cards keep their local reaction queues.
export default function BikeGrid({ children }) {
  return (
    <MotionList>
      <div className={`bike-grid ${styles.grid}`}>{children}</div>
    </MotionList>
  );
}
