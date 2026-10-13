"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ClubDto } from "../../lib/club-contracts.ts";
import type { JsonData } from "../../lib/contracts.ts";
import type { clubRides } from "../../lib/rides.ts";
import { socialApi } from "./social-primitives.tsx";
import { useSite } from "./site-provider.tsx";
import { useConfirmation } from "./confirmation.tsx";
import RideCard from "./ride-card.tsx";
import styles from "./clubs.module.css";
const Planner = dynamic(() => import("./plan-composer.tsx"), { ssr: false });
type Data = JsonData<Awaited<ReturnType<typeof clubRides>>>;
export default function ClubRides({ club }: { club: ClubDto }) {
  const { viewer } = useSite();
  return <Contents key={viewer?.id || "guest"} club={club} />;
}
function Contents({ club }: { club: ClubDto }) {
  const { viewer } = useSite(),
    [data, setData] = useState<Data | null>(null),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [planning, setPlanning] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ask, confirmation] = useConfirmation();
  useEffect(() => {
    let active = true;
    setData(null);
    socialApi<Data>("clubs/" + club.id + "/rides?page=" + page)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Выезды недоступны");
      });
    return () => {
      active = false;
    };
  }, [club.id, club.membership?.state, club.membership?.role, page, revision]);
  const mine =
      club.membership?.userId === viewer?.id &&
      club.membership?.state === "active",
    canPlan =
      mine &&
      !club.archived &&
      ["owner", "admin", "organizer"].includes(club.membership?.role || "");
  async function manage(id: string, action: "cancel" | "pause") {
    if (
      !(await ask(
        action === "cancel"
          ? "Выезд будет отменён. Участники получат уведомление; велосипед и трек останутся у автора."
          : "Новые ответы на выезд будут закрыты. Уже принятые ответы сохранятся.",
        {
          title:
            action === "cancel" ? "Отменить выезд?" : "Приостановить набор?",
          confirmLabel:
            action === "cancel" ? "Отменить выезд" : "Приостановить",
        },
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await socialApi("clubs/" + club.id + "/rides/" + id, "PATCH", { action });
      setRevision((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить выезд");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="club-rides-heading">
      <h2 id="club-rides-heading">Выезды клуба</h2>
      {canPlan && (
        <button className="button" onClick={() => setPlanning(true)}>
          Запланировать выезд клуба
        </button>
      )}
      {!mine && (
        <p className="help">
          Здесь видны открытые выезды. Внутренние доступны действующим
          участникам клуба.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Загружаем выезды…</p>}
      {data && data.viewerId === (viewer?.id || null) && (
        <>
          {!data.rides.length && (
            <p className="empty-state">Пока нет доступных выездов.</p>
          )}
          <div className="ride-grid">
            {data.rides
              .filter((r) => r.club?.audience !== "members" || mine)
              .map((r) => (
                <div key={r.id}>
                  <RideCard ride={r} />
                  {r.club?.canManage && r.status === "planned" && (
                    <div className={styles.actions}>
                      <button
                        className="button secondary"
                        disabled={busy || r.recruitmentClosed}
                        onClick={() => void manage(r.id, "pause")}
                      >
                        Приостановить набор
                      </button>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void manage(r.id, "cancel")}
                      >
                        Отменить выезд
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>
          <div className={styles.actions}>
            {page > 1 && (
              <button
                className="button secondary"
                onClick={() => setPage((p) => p - 1)}
              >
                Предыдущие
              </button>
            )}
            {data.hasMore && (
              <button
                className="button secondary"
                onClick={() => setPage((p) => p + 1)}
              >
                Следующие
              </button>
            )}
          </div>
        </>
      )}
      {planning && canPlan && (
        <Planner
          club={club}
          onClose={() => setPlanning(false)}
          onSaved={() => {
            setPlanning(false);
            setRevision((r) => r + 1);
          }}
        />
      )}
      {confirmation}
    </section>
  );
}
