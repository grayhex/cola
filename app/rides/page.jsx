"use client";
import { useEffect, useState } from "react";
import { useSite } from "../ui/site-provider.jsx";
import { Plus } from "../ui/icons.jsx";
import RideList from "../ui/ride-list.jsx";
import {
  SocialHeader,
  SocialFooter,
  socialApi,
} from "../ui/social-primitives.jsx";
export default function Page() {
  const { setPreferences } = useSite();
  const [bikeId, setBikeId] = useState(null),
    [user, setUser] = useState(null);
  useEffect(() => {
    setBikeId(new URLSearchParams(location.search).get("bikeId") || "");
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
          <a
            className="button secondary small"
            href="/account?tab=rides&action=add"
          >
            <Plus size={16} />
            Добавить покатушку
          </a>
        </div>
        {bikeId !== null && <RideList bikeId={bikeId} />}
      </main>
      <SocialFooter />
    </>
  );
}
