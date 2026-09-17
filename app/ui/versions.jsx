"use client";
import { useEffect, useState } from "react";
export default function Versions() {
  const [v, setV] = useState(null);
  useEffect(() => {
    let active = true;
    fetch("/api/versions")
      .then((r) => r.json())
      .then((d) => {
        if (active) setV(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <small className="build-versions">
      {v
        ? `ColaBike ${v.app.version} (${v.app.build}) · Parser ${v.resolver?.version || "недоступен"}${v.resolver?.build ? " (" + v.resolver.build + ")" : ""}`
        : "Версии загружаются…"}
    </small>
  );
}
