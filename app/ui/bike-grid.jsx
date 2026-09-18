"use client";
import { createContext, useContext, useEffect, useState } from "react";
const RecordContext = createContext([]);
export const useGridRecords = () => useContext(RecordContext);
// One existing endpoint per grid, never a request per card. No persisted record cache.
export default function BikeGrid({ children, bikes = [] }) {
  const [records, setRecords] = useState([]);
  const revision = bikes
    .filter((b) => b.is_public)
    .map((b) => b.id + ":" + b.likes)
    .join("|");
  useEffect(() => {
    if (!revision) {
      setRecords([]);
      return;
    }
    const controller = new AbortController();
    setRecords([]);
    fetch("/api/game/records", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!controller.signal.aborted) setRecords(d?.records || []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [revision]);
  return (
    <RecordContext.Provider value={records}>
      <div className="bike-grid">{children}</div>
    </RecordContext.Provider>
  );
}
