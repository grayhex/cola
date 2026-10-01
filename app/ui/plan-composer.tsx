"use client";
import PlanningGraphic from "./planning-graphic.tsx";
import { errorMessage } from "../../lib/errors.ts";
import type { ReactNode } from "react";
import type { AccountBikeDto } from "../../lib/contracts.ts";
import type { RideDto } from "./content-types.ts";
import type {
  RideConfig,
  PlanDraft,
  RideSaveHandler,
  GarageDto,
} from "./ride-types.ts";
type PlannerState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; bikes: AccountBikeDto[]; config: RideConfig };
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "./garage/modal.tsx";
import PlanForm from "./plan-form.tsx";
import { socialApi } from "./social-primitives.tsx";
import { useConfirmation } from "./confirmation.tsx";
import { selectableRideBikes } from "../../lib/bike-status.ts";

// «Организовать покатушку» as a wide window over the current page (#245,
// #253): the home page, the account overview and «Мои покатушки» open the
// same planner, which also edits an existing plan. It loads the garage and
// ride settings on open, so no page pays for it upfront.
export default function PlanComposer({
  ride = null,
  draft = null,
  title,
  onClose,
  onSaved,
}: {
  ride?: RideDto | null;
  draft?: PlanDraft | null;
  title?: string;
  onClose: () => void;
  onSaved: RideSaveHandler;
}) {
  const [state, setState] = useState<PlannerState>({ status: "loading" }),
    [revision, setRevision] = useState(0);
  const dirty = useRef(false);
  const [ask, confirmation] = useConfirmation();
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    Promise.all([
      socialApi<GarageDto>("bikes"),
      socialApi<RideConfig>("rides/settings"),
    ])
      .then(([garage, config]) => {
        if (active) setState({ status: "ready", bikes: garage.bikes, config });
      })
      .catch((e) => {
        if (active) setState({ status: "error", error: errorMessage(e) });
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const onDirty = useCallback((value: boolean) => {
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
  const ready = state.status === "ready";
  const current = ready ? selectableRideBikes(state.bikes) : [];
  // Editing keeps the plan's own bike even when it is no longer current.
  const canPlan = ready && state.config.enabled && (!!current.length || !!ride);
  const status = (children: ReactNode) => (
    <div className="planning-body">
      <div className="planning-section">{children}</div>
    </div>
  );
  return (
    <>
      <Modal
        graphic={<PlanningGraphic slot="planDialogGraphic" />}
        wide
        title={
          title || (ride ? "Изменить покатушку" : "Организовать покатушку")
        }
        onClose={close}
      >
        {state.status === "loading" &&
          status(<p role="status">Загружаем гараж и настройки…</p>)}
        {state.status === "error" &&
          status(
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
            </div>,
          )}
        {ready &&
          !state.config.enabled &&
          status(
            <p className="empty-state">
              Планирование покатушек временно выключено. Попробуйте позже.
            </p>,
          )}
        {ready &&
          state.config.enabled &&
          !canPlan &&
          status(
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
            </div>,
          )}
        {canPlan && (
          <PlanForm
            ride={ride}
            draft={draft}
            bikes={state.bikes}
            config={state.config}
            onDirty={onDirty}
            onCancel={close}
            onSaved={(result, created) => {
              dirty.current = false;
              onSaved(result, created);
            }}
          />
        )}
      </Modal>
      {confirmation}
    </>
  );
}
