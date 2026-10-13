"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClubDto } from "../../lib/club-contracts.ts";
import { useConfirmation } from "./confirmation.tsx";
import { socialApi } from "./social-primitives.tsx";
export default function ClubLifecycle({ club }: { club: ClubDto }) {
  const [ask, confirmation] = useConfirmation(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    router = useRouter();
  if (club.membership?.role !== "owner" || club.membership.state !== "active")
    return null;
  return (
    <>
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          const accepted = await ask(
            club.archived
              ? "Клуб снова появится в каталоге. Восстановление занимает место в лимите трёх клубов."
              : "Публичная история останется доступна. Клуб исчезнет из каталога, новые вступления и публикации будут остановлены.",
            {
              title: club.archived
                ? "Восстановить клуб?"
                : "Архивировать клуб?",
              confirmLabel: club.archived ? "Восстановить" : "Архивировать",
            },
          );
          if (!accepted) return;
          setBusy(true);
          setError("");
          try {
            await socialApi("clubs/" + club.id + "/archive", "PATCH", {
              archived: !club.archived,
              version: club.version,
            });
            router.push("/clubs/" + club.id);
            router.refresh();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Не удалось изменить архив",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Сохраняем…"
          : club.archived
            ? "Восстановить клуб"
            : "Архивировать клуб"}
      </button>
      {error && <p role="alert">{error}</p>}
      {confirmation}
    </>
  );
}
