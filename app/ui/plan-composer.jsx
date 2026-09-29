"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "./garage/modal.jsx";
import RideForm from "./ride-form.jsx";
import { socialApi } from "./social-primitives.jsx";
import { useConfirmation } from "./confirmation.jsx";
import { selectableRideBikes } from "../../lib/bike-status.js";

// «Организовать покатушку» as a window over the current page (#245): the home
// page, the account overview and «Мои покатушки» open the same planner. It
// loads the garage and ride settings on open, so no page pays for it upfront.
export default function PlanComposer({ onClose, onSaved }) {
  const [state, setState] = useState({ status: "loading" }),
    [revision, setRevision] = useState(0);
  const dirty = useRef(false);
  const [ask, confirmation] = useConfirmation();
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    Promise.all([socialApi("bikes"), socialApi("rides/settings")])
      .then(([garage, config]) => {
        if (active) setState({ status: "ready", bikes: garage.bikes, config });
      })
      .catch((e) => {
        if (active) setState({ status: "error", error: e.message });
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const onDirty = useCallback((value) => {
    dirty.current = value;
  }, []);
  async function close() {
    if (
      !dirty.current ||
      (await ask("Закрыть форму и потерять несохранённые изменения?", {
        confirmLabel: "Закрыть форму",
      }))
    )
      onClose();
  }
  const current =
    state.status === "ready" ? selectableRideBikes(state.bikes) : [];
  return (
    <>
      <Modal title="Организовать покатушку" onClose={close}>
        {state.status === "loading" && (
          <p role="status">Загружаем гараж и настройки…</p>
        )}
        {state.status === "error" && (
          <div className="empty-state">
            <p role="alert" className="error">
              {state.error || "Не удалось открыть планировщик."}
            </p>
            <button
              type="button"
              className="button secondary small"
              onClick={() => setRevision((v) => v + 1)}
            >
              Повторить
            </button>
          </div>
        )}
        {state.status === "ready" && !state.config.enabled && (
          <p className="empty-state">
            Планирование покатушек временно выключено. Попробуйте позже.
          </p>
        )}
        {state.status === "ready" &&
          state.config.enabled &&
          !current.length && (
            // A plan belongs to a current bike; without one nothing is created.
            <div className="empty-state">
              <p>
                {state.bikes.length
                  ? "В гараже только бывшие велосипеды. Добавьте текущий, чтобы организовать выезд."
                  : "Покатушка привязана к велосипеду организатора. Добавьте велосипед — это займёт минуту."}
              </p>
              <Link
                className="button small"
                href="/account?tab=bikes&action=add"
              >
                Добавить велосипед
              </Link>
            </div>
          )}
        {state.status === "ready" &&
          state.config.enabled &&
          !!current.length && (
            <RideForm
              mode="plan"
              heading={false}
              bikes={state.bikes}
              config={state.config}
              onDirty={onDirty}
              onCancel={close}
              onSaved={() => {
                dirty.current = false;
                onSaved();
              }}
            />
          )}
      </Modal>
      {confirmation}
    </>
  );
}
