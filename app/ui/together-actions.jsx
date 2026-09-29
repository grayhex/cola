"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import SiteIcon from "./site-icon.jsx";

const loadDialogs = () => import("./together-dialogs.jsx");
const saved = {
  intent: ["Намерение сохранено.", "/ride-intents", "Подходящие выезды"],
  plan: ["Покатушка запланирована.", "/account?tab=rides", "Мои покатушки"],
};
/**
 * The two riding actions (#245): «Хочу кататься» and «Организовать
 * покатушку». A guest follows links to sign in; a signed-in rider gets the
 * composer in a window over the current page. Its code loads on the first
 * click, so pages that show the buttons do not pay for the forms.
 * @param {{ signedIn: boolean, className?: string, onSaved?: (kind: "intent" | "plan") => void }} props
 */
export default function TogetherActions({ signedIn, className = "", onSaved }) {
  const [open, setOpen] = useState(null),
    [loading, setLoading] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(null);
  const dialogs = useRef(null);
  async function launch(kind) {
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
  function done(kind) {
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
            <Link className="button" href="/ride-intents">
              <CalendarDays size={16} aria-hidden="true" />
              Хочу кататься
            </Link>
            <Link
              className="button secondary"
              href="/account?tab=rides&action=plan"
            >
              <SiteIcon name="plan" />
              Организовать покатушку
            </Link>
          </>
        )}
      </div>
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
