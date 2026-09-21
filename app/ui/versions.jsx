"use client";
import { useEffect, useState } from "react";
import { useSite } from "./site-provider.jsx";
export default function Versions({ link = true }) {
  const { settings } = useSite();
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
      {`ColaBike ${settings.appVersionLabel || v?.app?.version || "…"} · Парсер ${settings.parserVersionLabel || v?.resolver?.version || (v ? "недоступен" : "…")}`}
      {link && (
        <>
          {" "}
          ·{" "}
          <a
            href="https://github.com/grayhex/cola"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </>
      )}
    </small>
  );
}
