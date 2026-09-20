"use client";
import { useEffect, useState } from "react";
import { Flame, Sparkles, Star } from "./icons.jsx";
import { socialApi } from "./social-primitives.jsx";
import AchievementArt from "./achievement-art.jsx";
export function BadgeShelf({ endpoint, account = false }) {
  const [data, setData] = useState(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    socialApi(endpoint)
      .then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [endpoint]);
  if (error) return <p className="help" role="status">{error}</p>;
  if (!data) return <p className="help" role="status">Загружаем награды…</p>;
  function award(a, i) {
    return (
      <span className="award" key={a.key + ":" + a.bikeId + ":" + i}
        title={a.description + " · " + new Date(a.awardedAt).toLocaleDateString("ru-RU")}>
        <AchievementArt imageId={a.imageId} kind="achievement" size={24} />
        <span>{a.name}</span>
      </span>
    );
  }
  return (
    <section className="badge-shelf" aria-label="Награды и рекорды">
      <div className="award-row">
        {data.records.map((r) => (
          <a href={"/records#" + r.key} className="award current" key={r.key} title="Текущий рекорд">
            <AchievementArt imageId={r.imageId} size={24} />
            <span>{r.name}</span><small>Сейчас</small>
          </a>
        ))}
        {(account ? data.awards : data.awards.slice(0, 4)).map(award)}
      </div>
      {!data.awards.length && !data.records.length && (
        <p className="help">История достижений начинается с первого публичного велосипеда.</p>
      )}
      {!account && data.awards.length > 4 && (
        <details>
          <summary>Ещё {data.awards.length - 4} наград</summary>
          <div className="award-row">{data.awards.slice(4).map(award)}</div>
        </details>
      )}
      {account && (
        <>
          <h3>Следующая вершина</h3>
          <div className="locked-awards">
            {data.locked.map((a) => (
              <div key={a.key}>
                <AchievementArt imageId={a.imageId} kind="achievement" size={36} />
                <div className="locked-award-info">
                  <strong>{a.name}</strong>
                  <p>{a.description}</p>
                  {a.progress !== null && (
                    <>
                      <progress aria-label={a.name} max={a.target} value={a.progress} />
                      <small>{a.progress} / {a.target}</small>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
export function BikeGame({ bike, user }) {
  const [state, setState] = useState(null), [busy, setBusy] = useState(false),
    [error, setError] = useState(""), [revision, setRevision] = useState(0);
  useEffect(() => {
    socialApi("game/bikes/" + bike.id + "/reactions")
      .then(setState).catch((e) => setError(e.message));
  }, [bike.id]);
  const icons = { wild: Flame, clean: Sparkles, dream: Star };
  async function vote(r) {
    setBusy(true);
    setError("");
    try {
      setState(await socialApi("game/bikes/" + bike.id + "/reactions/" + r.key, r.selected ? "DELETE" : "PUT"));
      setRevision((n) => n + 1);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return (
    <section className="bike-game">
      <BadgeShelf key={revision} endpoint={"game/bikes/" + bike.id} />
      {state?.enabled && (
        <div className="reaction-row" aria-label="Оценка сообщества">
          {state.reactions.map((r) => {
            const Icon = icons[r.key];
            return (
              <button key={r.key} aria-pressed={r.selected} disabled={busy || !user || state.isOwner} onClick={() => vote(r)}>
                <Icon size={17} />{r.name}<b>{r.count}</b>
              </button>
            );
          })}
          {!user && <a href="/account">Войдите, чтобы оценить сборку</a>}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
