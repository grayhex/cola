"use client";
import type { JournalSaved } from "./content-types.ts";
import type { BikeDto } from "../../lib/contracts.ts";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/errors.ts";
import { X } from "./icons.tsx";
import { socialApi } from "./social-primitives.tsx";
import { publicPath } from "../../lib/public-urls.ts";

// After the owner changes the build, an offer to tell about it: a draft, never
// a publication. It sits under the tabs of the bike page (#366), so that it is
// seen whichever tab the change was made in; the entries themselves are in the
// «Записи» tab.
export default function JournalBuildPrompt({
  bike,
  editable,
}: {
  bike: BikeDto;
  editable: boolean;
}) {
  const [change, setChange] = useState<{ componentIds: string[] } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const previous = useRef<{ id: string; parts: BikeDto["components"] } | null>(
    null,
  );
  useEffect(() => {
    const state = { id: bike.id, parts: bike.components || [] };
    if (
      editable &&
      previous.current?.id === bike.id &&
      JSON.stringify(previous.current.parts) !== JSON.stringify(state.parts)
    ) {
      const old = new Map(
        previous.current.parts.map((p) => [p.id, JSON.stringify(p)]),
      );
      setChange({
        componentIds: state.parts
          .filter((p) => old.get(p.id) !== JSON.stringify(p))
          .map((p) => p.id)
          .slice(0, 50),
      });
    } else if (previous.current?.id !== bike.id) setChange(null);
    previous.current = state;
  }, [bike.id, bike.components, editable]);
  async function draft() {
    if (!change) return;
    setBusy(true);
    setError("");
    try {
      const e = await socialApi<JournalSaved>("journal", "POST", {
        bikeId: bike.id,
        kind: "build",
        title: "Изменения комплектации",
        body: "",
        status: "draft",
        isPublic: false,
        componentIds: change.componentIds,
      });
      location.assign(publicPath("journal", e) + "?edit=1");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (!change) return null;
  return (
    <div className="journal-prompt">
      <span>Комплектация обновлена.</span>
      <button className="quiet" disabled={busy} onClick={draft}>
        Рассказать об изменении
      </button>
      <small>Создадим черновик, не публикацию.</small>
      <button
        className="quiet"
        onClick={() => setChange(null)}
        aria-label="Закрыть предложение"
      >
        <X size={14} />
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
