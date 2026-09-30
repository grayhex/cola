"use client";
import { useEffect, useState } from "react";
import { useSite } from "./site-provider.tsx";
interface VersionsResponse {
  app?: { version: string };
  resolver?: { version: string } | null;
}
export default function Versions({ link = true }: { link?: boolean }) {
  const { settings } = useSite();
  const [v, setV] = useState<VersionsResponse | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/versions")
      .then((r) => r.json())
      .then((d: VersionsResponse) => {
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
