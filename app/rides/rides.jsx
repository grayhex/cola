"use client";
import { useEffect, useState } from "react";
import { useSite } from "../ui/site-provider.jsx";
import RideCreationActions from "../ui/ride-creation-actions.jsx";
import RideList from "../ui/ride-list.jsx";
import { SocialHeader, SocialFooter } from "../ui/social-primitives.jsx";
export default function Rides() {
  const { viewer: user } = useSite();
  const [bikeId, setBikeId] = useState(null),
    [status, setStatus] = useState(null);
  useEffect(() => {
    setBikeId(new URLSearchParams(location.search).get("bikeId") || "");
    setStatus(
      new URLSearchParams(location.search).get("status") === "planned"
        ? "planned"
        : null,
    );
  }, []);
  return (
    <>
      <SocialHeader user={user} />
      <main className="page">
        <div className="section-heading">
          <div>
            <h1>Покатушки</h1>
            <p>Находите маршруты сообщества и планируйте совместные поездки.</p>
          </div>
          <RideCreationActions />
        </div>
        <div className="ui-tabs" aria-label="Фильтр покатушек">
          {[
            [null, "Все"],
            ["completed", "Прошедшие"],
            ["planned", "Предстоящие"],
          ].map(([value, label]) => (
            <button
              key={label}
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {bikeId !== null && (
          <RideList key={status || "all"} bikeId={bikeId} status={status} />
        )}
      </main>
      <SocialFooter />
    </>
  );
}
