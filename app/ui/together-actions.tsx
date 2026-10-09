"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import SiteIcon from "./site-icon.tsx";
import RegistrationNote from "./registration-note.tsx";
import { guestRidingHref } from "../../lib/navigation.ts";

const loadDialogs = () => import("./together-dialogs.tsx");
type ActionKind = "intent" | "plan";
const saved: Record<ActionKind, [string, string, string]> = {
  intent: ["Намерение сохранено.", "/ride-intents", "Мои намерения"],
  plan: ["Покатушка запланирована.", "/account?tab=rides", "Мои покатушки"],
};
/**
 * The two riding actions (#245): «Хочу кататься» and «Организовать
 * покатушку». A guest follows links to sign in; a signed-in rider gets the
 * composer in a window over the current page. Its code loads on the first
 * click, so pages that show the buttons do not pay for the forms.*/
export default function TogetherActions({
  signedIn,
  className = "",
  onSaved,
}: {
  signedIn: boolean;
  className?: string;
  onSaved?: (kind: ActionKind) => void;
}) {
  const [open, setOpen] = useState<ActionKind | null>(null),
    [loading, setLoading] = useState<ActionKind | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState<[string, string, string] | null>(null);
  const dialogs = useRef<Awaited<ReturnType<typeof loadDialogs>> | null>(null);
  async function launch(kind: ActionKind) {
    if (loading) return;
    setError("");
    setNotice(null);
    if (!dialogs.current) {
      setLoading(kind);
      try {
        dialogs.current = await loadDialogs();
      } catch {
        setError(
          "Не удалось открыть форму. Проверьте соединение и попробуйте ещё раз.",
        );
        return;
      } finally {
        setLoading(null);
      }
    }
    setOpen(kind);
  }
  function done(kind: ActionKind) {
    setOpen(null);
    setNotice(saved[kind]);
    onSaved?.(kind);
  }
  const Dialogs = dialogs.current;
  return (
    <div className={"together-actions " + className}>
      <div className="together-buttons">
        {signedIn ? (
          <>
            <button
              type="button"
              className="button"
              aria-haspopup="dialog"
              aria-busy={loading === "intent" || undefined}
              // aria-disabled, not disabled: the button keeps focus while the
              // chunk loads, so closing the window returns focus to it.
              aria-disabled={!!loading || undefined}
              onClick={() => launch("intent")}
            >
              <CalendarDays size={16} aria-hidden="true" />
              {loading === "intent" ? "Открываем…" : "Хочу кататься"}
            </button>
            <button
              type="button"
              className="button secondary"
              aria-haspopup="dialog"
              aria-busy={loading === "plan" || undefined}
              aria-disabled={!!loading || undefined}
              onClick={() => launch("plan")}
            >
              <SiteIcon name="plan" />
              {loading === "plan" ? "Открываем…" : "Организовать покатушку"}
            </button>
          </>
        ) : (
          <>
            {/* A guest is asked to register (#378): the page of the scenario
                opens the form of registering; after signing up or in it is
                the same «Новое намерение» window a member gets here (#264),
                or the planner, and nothing is created by it. */}
            <Link className="button" href={guestRidingHref.intent}>
              <CalendarDays size={16} aria-hidden="true" />
              Хочу кататься
            </Link>
            <Link className="button secondary" href={guestRidingHref.plan}>
              <SiteIcon name="plan" />
              Организовать покатушку
            </Link>
          </>
        )}
      </div>
      {!signedIn && <RegistrationNote />}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice[0]}{" "}
          <Link className="text-link" href={notice[1]}>
            {notice[2]}
          </Link>
        </p>
      )}
      {Dialogs && open === "intent" && (
        <Dialogs.IntentDialog
          onClose={() => setOpen(null)}
          onSaved={() => done("intent")}
        />
      )}
      {Dialogs && open === "plan" && (
        <Dialogs.PlanComposer
          onClose={() => setOpen(null)}
          onSaved={() => done("plan")}
        />
      )}
    </div>
  );
}
