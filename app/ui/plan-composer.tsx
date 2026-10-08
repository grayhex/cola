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
  CreatedPlan,
  GarageDto,
} from "./ride-types.ts";
type PlannerState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; bikes: AccountBikeDto[]; config: RideConfig };
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "./garage/modal.tsx";
import PlanForm from "./plan-form.tsx";
import { socialApi } from "./social-primitives.tsx";
import { useConfirmation } from "./confirmation.tsx";
import { selectableRideBikes } from "../../lib/bike-status.ts";
import { organizeDefaults } from "../../lib/organize-filters.ts";

// The interest finder and the invitation step load only when they are used.
const InterestFinder = dynamic(() => import("./plan-interest.tsx"), {
  ssr: false,
  loading: () => <p role="status">Открываем…</p>,
});
const InviteFromInterest = dynamic(() => import("./invite-from-interest.tsx"), {
  ssr: false,
});

// «Организовать покатушку» as a wide window over the current page (#245,
// #253): the home page, the account overview and «Мои покатушки» open the
// same planner, which also edits an existing plan. It loads the garage and
// ride settings on open, so no page pays for it upfront.
//
// Planning is one scenario (#370): above the form a new plan can take its
// time and format from «Подобрать время по интересам» (the former «Собрать
// компанию», #234), and a plan made that way is followed by the invitation
// step before the opener hears about it. `interest` opens the finder with the
// organizer's filters (old `?mode=organize` links).
export default function PlanComposer({
  ride = null,
  interest = null,
  onClose,
  onSaved,
}: {
  ride?: RideDto | null;
  interest?: Record<string, string> | null;
  onClose: () => void;
  onSaved: RideSaveHandler;
}) {
  const [state, setState] = useState<PlannerState>({ status: "loading" }),
    [revision, setRevision] = useState(0),
    [finder, setFinder] = useState(!!interest),
    [suggestion, setSuggestion] = useState<{
      id: number;
      draft: PlanDraft;
    } | null>(null),
    [invite, setInvite] = useState<{
      plan: CreatedPlan;
      result: Parameters<RideSaveHandler>[0];
    } | null>(null);
  const choices = useRef(0),
    summary = useRef<HTMLElement | null>(null);
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
  // The plan exists; people are invited (or not) before the opener goes on.
  if (invite)
    return (
      <InviteFromInterest
        plan={invite.plan}
        onClose={() => void onSaved(invite.result, invite.plan)}
      />
    );
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
        title={ride ? "Изменить покатушку" : "Организовать покатушку"}
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
        {canPlan && !ride && (
          <details
            className="planning-interest"
            open={finder}
            onToggle={(e) => setFinder(e.currentTarget.open)}
          >
            <summary ref={summary}>Подобрать время по интересам людей</summary>
            {finder && (
              <InterestFinder
                initial={interest ?? { ...organizeDefaults }}
                onPropose={(draft) => {
                  setSuggestion({ id: ++choices.current, draft });
                  setFinder(false);
                  summary.current?.focus();
                }}
              />
            )}
          </details>
        )}
        {canPlan && (
          <PlanForm
            ride={ride}
            suggestion={suggestion}
            bikes={state.bikes}
            config={state.config}
            onDirty={onDirty}
            onCancel={close}
            onSaved={(result, created) => {
              dirty.current = false;
              if (created?.fromInterest) setInvite({ plan: created, result });
              else void onSaved(result, created);
            }}
          />
        )}
      </Modal>
      {confirmation}
    </>
  );
}
