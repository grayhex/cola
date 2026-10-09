"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { publicPath } from "../../lib/public-urls.ts";
import type { BikeDto } from "../../lib/contracts.ts";
import { errorMessage } from "../../lib/errors.ts";
import BikeWizard from "./bike-wizard.tsx";
import { useConfirmation } from "./confirmation.tsx";
import api from "./garage/api.ts";
import Modal from "./garage/modal.tsx";

export interface AddBikeDialogProps {
  onClose: () => void;
  /** The new bike is saved (before the rider decides where to go on). */
  onCreated?: (bikeId: string) => void;
}
// The wizard in its window over the page the rider is on (#378): closing it
// leaves that page, its address and its scroll as they were. A saved bike is
// said so and offered, not forced: the rider opens it or stays where they were.
// The same `BikeWizard` as in the account; this is only its shell.
export default function AddBikeDialog({
  onClose,
  onCreated,
}: AddBikeDialogProps) {
  const router = useRouter();
  const [ask, confirmation] = useConfirmation();
  // Typed but unsaved data in the wizard (#129).
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<{ name: string; href: string } | null>(null),
    [error, setError] = useState("");
  async function close() {
    if (busy) return;
    if (
      dirty &&
      !saved &&
      !(await ask("Несохранённые данные будут потеряны.", {
        title: "Закрыть мастер?",
        confirmLabel: "Закрыть мастер",
        cancelLabel: "Продолжить редактирование",
        danger: true,
      }))
    )
      return;
    onClose();
  }
  return (
    <>
      <Modal
        title={saved ? "Велосипед сохранён" : "Новый велосипед"}
        onClose={close}
        dismissible={!!saved}
      >
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {saved ? (
          <div className="add-bike-saved">
            <p role="status">«{saved.name}» теперь в вашем гараже.</p>
            <div className="add-bike-saved-actions">
              <button
                type="button"
                className="button"
                autoFocus
                onClick={() => {
                  // The window goes first: it gives the page back its scroll
                  // before the bike's page replaces it.
                  onClose();
                  router.push(saved.href);
                }}
              >
                Открыть велосипед
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={onClose}
              >
                Остаться здесь
              </button>
            </div>
          </div>
        ) : (
          <BikeWizard
            onDirtyChange={setDirty}
            onBusy={setBusy}
            onCreated={async (id) => {
              try {
                const { bike } = await api<{ bike: BikeDto }>("bikes/" + id);
                setError("");
                setDirty(false);
                setSaved({
                  name: bike.name || [bike.brand, bike.model].join(" "),
                  href: publicPath("bike", bike),
                });
                onCreated?.(id);
              } catch (e) {
                // The bike is saved; only its page could not be read.
                setDirty(false);
                setSaved({ name: "Велосипед", href: "/account?tab=bikes" });
                setError(errorMessage(e));
                onCreated?.(id);
              }
            }}
          />
        )}
      </Modal>
      {confirmation}
    </>
  );
}
