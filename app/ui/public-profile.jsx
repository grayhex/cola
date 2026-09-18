"use client";
import { useEffect, useState } from "react";
import { MapPin, Calendar, ArrowLeft } from "lucide-react";
import {
  Avatar,
  SocialHeader,
  SocialFooter,
  FollowButton,
  PeopleList,
  Pagination,
  socialApi,
} from "./social-primitives.jsx";
import BikeCard from "./bike-card.jsx";
import { useSite } from "./site-provider.jsx";
export default function PublicProfile({ username }) {
  const [profile, setProfile] = useState(null),
    [user, setUser] = useState(null),
    [feed, setFeed] = useState(null),
    [page, setPage] = useState(1),
    [people, setPeople] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState("");
  const { setPreferences } = useSite();
  async function refresh() {
    const d = await socialApi("social/profiles/" + username);
    setProfile(d.profile);
  }
  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([socialApi("me"), socialApi("social/profiles/" + username)])
      .then(([me, data]) => {
        if (active) {
          setUser(me.user);
          setPreferences(me.user?.preferences || {});
          setProfile(data.profile);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [username]);
  useEffect(() => {
    let active = true;
    setFeed(null);
    socialApi("social/profiles/" + username + "/bikes?page=" + page)
      .then((d) => {
        if (active) setFeed(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [username, page]);
  async function like(b) {
    if (!user) {
      window.location.assign("/account");
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      const result = await socialApi(
        "bikes/" + b.id + "/like",
        b.liked ? "DELETE" : "PUT",
      );
      setFeed((f) => ({
        ...f,
        bikes: f.bikes.map((x) => (x.id === b.id ? { ...x, ...result } : x)),
      }));
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SocialHeader user={user} />
      <main className="social-page public-profile">
        {error ? (
          <section className="social-empty">
            <h1>Профиль недоступен</h1>
            <p role="alert">{error}</p>
            <a href="/">На витрину</a>
          </section>
        ) : !profile ? (
          <p role="status">Загружаем профиль…</p>
        ) : (
          <>
            <section className="profile-hero">
              <Avatar person={profile} size="large" />
              <div className="profile-title">
                <p className="eyebrow">Владелец коллекции</p>
                <h1>{profile.name}</h1>
                <span className="username">@{profile.username}</span>
                {profile.bio && <p className="profile-bio">{profile.bio}</p>}
                <div className="profile-meta">
                  {profile.location && (
                    <span>
                      <MapPin size={14} />
                      {profile.location}
                    </span>
                  )}
                  <span>
                    <Calendar size={14} />С нами с{" "}
                    {new Date(profile.createdAt).toLocaleDateString("ru-RU", {
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
              <FollowButton profile={profile} user={user} onChange={refresh} />
              <div className="social-stats">
                <button onClick={() => setPeople("")} aria-pressed={!people}>
                  <strong>{profile.counts.bikes}</strong>Велосипеды
                </button>
                <button
                  onClick={() => setPeople("followers")}
                  aria-pressed={people === "followers"}
                >
                  <strong>{profile.counts.followers}</strong>Подписчики
                </button>
                <button
                  onClick={() => setPeople("following")}
                  aria-pressed={people === "following"}
                >
                  <strong>{profile.counts.following}</strong>Подписки
                </button>
                <button
                  onClick={() => setPeople("friends")}
                  aria-pressed={people === "friends"}
                >
                  <strong>{profile.counts.friends}</strong>Друзья
                </button>
              </div>
            </section>
            {profile.badges?.length > 0 && (
              <section className="profile-badges" aria-label="Достижения">
                {profile.badges.map((b) => (
                  <span key={b.id}>{b.name}</span>
                ))}
              </section>
            )}
            {people ? (
              <section className="social-panel">
                <button className="quiet" onClick={() => setPeople("")}>
                  <ArrowLeft size={15} />К велосипедам
                </button>
                <h2>
                  {
                    {
                      followers: "Подписчики",
                      following: "Подписки",
                      friends: "Друзья",
                    }[people]
                  }
                </h2>
                <PeopleList
                  key={people}
                  username={profile.username}
                  kind={people}
                  user={user}
                  onChange={refresh}
                />
              </section>
            ) : (
              <section className="profile-collection">
                {actionError && (
                  <p role="alert" className="error">
                    {actionError}
                  </p>
                )}
                <h2>
                  Коллекция велосипедов <span>{profile.counts.bikes}</span>
                </h2>
                {feed ? (
                  <>
                    <div className="bike-grid">
                      {feed.bikes.map((b) => (
                        <BikeCard
                          key={b.id}
                          bike={b}
                          busy={busy}
                          onLike={() => like(b)}
                        />
                      ))}
                    </div>
                    {!feed.bikes.length && (
                      <p className="help">
                        Владелец ещё не опубликовал велосипеды.
                      </p>
                    )}
                    <Pagination {...feed} onPage={setPage} />
                  </>
                ) : (
                  <p role="status">Загружаем велосипеды…</p>
                )}
              </section>
            )}
          </>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
