"use client";
import { useEffect, useState } from "react";
import { useSite } from "../ui/site-provider.jsx";
import RideCreationActions from "../ui/ride-creation-actions.jsx";
import RideList from "../ui/ride-list.jsx";
import {
  SocialHeader,
  SocialFooter,
  socialApi,
} from "../ui/social-primitives.jsx";
export default function Page() {
  const { setPreferences } = useSite();
  const [bikeId, setBikeId] = useState(null),
    [user, setUser] = useState(null),
    [status, setStatus] = useState(null);
  useEffect(() => {
    setBikeId(new URLSearchParams(location.search).get("bikeId") || "");
    setStatus(
      new URLSearchParams(location.search).get("status") === "planned"
        ? "planned"
        : null,
    );
    socialApi("me")
      .then((d) => {
        setUser(d.user);
        setPreferences(d.user?.preferences || {});
      })
      .catch(() => {});
  }, []);
  return (
    <>
      <SocialHeader user={user} />
      <main className="social-page">
        <div className="section-heading">
          <div>
            <h1>Покатушки</h1>
            <p>Маршруты, впечатления и километры сообщества.</p>
          </div>
        </div>
        <RideCreationActions />
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
