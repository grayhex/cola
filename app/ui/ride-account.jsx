"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import SiteIcon from "./site-icon.jsx";
import AccountSectionHead from "./account-section.jsx";
import RideForm from "./ride-form.jsx";
import PlanComposer from "./plan-composer.jsx";
import { socialApi, Pagination } from "./social-primitives.jsx";
import RideCard from "./ride-card.jsx";

// «Мои покатушки» (#245): the rider's own planned and completed rides and
// their management. Track files, Garmin CSV and Ride with GPS live under
// «Интеграции и импорт».
export default function RideAccount({ bikes }) {
  const [data, setData] = useState(null),
    [config, setConfig] = useState(null),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [editing, setEditing] = useState(null),
    [planning, setPlanning] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [settingsRevision, setSettingsRevision] = useState(0),
    // Kept apart from the list error: a loaded list must not hide it.
    [settingsError, setSettingsError] = useState("");
  const action = useSearchParams().get("action");
  const requests = useRef({ revision: 0 });
  const refresh = useCallback(async () => {
    const revision = ++requests.current.revision;
    try {
      const result = await socialApi(
        "rides?" +
          new URLSearchParams({
            own: "1",
            page: String(page),
            ...(status ? { status } : {}),
          }),
      );
      if (revision === requests.current.revision) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (revision === requests.current.revision) setError(e.message);
    }
  }, [page, status]);
  useEffect(() => {
    const pending = requests.current;
    void refresh();
    return () => {
      pending.revision++;
    };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    socialApi("rides/settings")
      .then((result) => {
        if (!active) return;
        setConfig(result);
        setSettingsError("");
      })
      .catch((e) => {
        if (active) setSettingsError(e.message);
      });
    return () => {
      active = false;
    };
  }, [settingsRevision]);
  // Old and new links: ?action=plan opens the planner once.
  const handled = useRef(null);
  useEffect(() => {
    if (action !== "plan" || handled.current === action) return;
    handled.current = action;
    setPlanning(true);
  }, [action]);
  function closePlanner() {
    setPlanning(false);
    handled.current = null;
    const url = new URL(location.href);
    url.searchParams.delete("action");
    window.history.replaceState(null, "", url);
  }
  async function edit(r) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // The editor needs ride settings; a failed first load is retried here
      // so «Изменить» never hides the list without showing the form.
      const [{ ride }, settings] = await Promise.all([
        socialApi("rides/owner/" + r.shareId),
        config || socialApi("rides/settings"),
      ]);
      setConfig(settings);
      setSettingsError("");
      setEditing(ride);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-section" aria-labelledby="my-rides-heading">
      <AccountSectionHead
        id="my-rides-heading"
        title="Мои покатушки"
        count={data?.total}
        helper={
          <>
            Планы, прошедшие поездки и их управление.{" "}
            <Link className="text-link" href="/ride-intents">
              Мои намерения
            </Link>
          </>
        }
        action={
          <button
            type="button"
            className="button"
            aria-haspopup="dialog"
            disabled={busy}
            onClick={() => {
              setNotice("");
              setPlanning(true);
            }}
          >
            <SiteIcon name="plan" />
            Организовать покатушку
          </button>
        }
        toolbar={
          !editing && (
            <div
              className="ui-tabs"
              role="group"
              aria-label="Фильтр моих покатушек"
            >
              {[
                ["", "Все"],
                ["completed", "Прошедшие"],
                ["planned", "Предстоящие"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={label}
                  aria-pressed={status === value}
                  onClick={() => {
                    setPage(1);
                    setStatus(value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )
        }
      />
      {(error || settingsError) && (
        <p role="alert" className="error">
          {error || settingsError}{" "}
          <button
            className="quiet"
            onClick={() => {
              setError("");
              setSettingsError("");
              void refresh();
              if (!config) setSettingsRevision((v) => v + 1);
            }}
          >
            Повторить
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {editing && config && (
        <RideForm
          key={editing.id}
          mode={editing.status === "completed" ? "add" : "plan"}
          ride={editing}
          bikes={bikes}
          config={config}
          onChanged={refresh}
          onCancel={() => setEditing(null)}
          onSaved={async (result) => {
            setEditing(null);
            setNotice(
              result === "removed"
                ? "Покатушка убрана."
                : "Изменения сохранены.",
            );
            await refresh();
          }}
        />
      )}
      {!editing && !data && !error && <p role="status">Загружаем покатушки…</p>}
      {!editing && data && (
        <>
          <div className="ride-grid" aria-busy={busy}>
            {data.rides.map((r) => (
              <RideCard key={r.id} ride={r} owner onEdit={edit} />
            ))}
          </div>
          {!data.rides.length && (
            <div className="empty-state">
              <p>
                {status
                  ? "В этом списке пока нет поездок."
                  : "Здесь появятся ваши планы и прошедшие поездки."}
              </p>
              <p className="help">
                Организуйте выезд или загрузите поездки с велокомпьютера в
                разделе{" "}
                <Link className="text-link" href="/account?tab=integrations">
                  «Интеграции и импорт»
                </Link>
                .
              </p>
            </div>
          )}
          <Pagination {...data} onPage={setPage} />
        </>
      )}
      {planning && (
        <PlanComposer
          onClose={closePlanner}
          onSaved={async () => {
            closePlanner();
            setNotice("Покатушка запланирована.");
            setStatus("planned");
            setPage(1);
            await refresh();
          }}
        />
      )}
    </section>
  );
}
