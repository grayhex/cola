"use client";
import RideList from "./ride-list.jsx";
import BikeGrid from "./bike-grid.jsx";
import { BadgeShelf } from "./achievements.jsx";
import { ReportButton } from "./community-controls.jsx";
import { Bike, Route } from "./icons.jsx";
import { useEffect, useState } from "react";
import { MapPin, Calendar, ArrowLeft } from "./icons.jsx";
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
import ShareButton from "./share-button.jsx";
export default function PublicProfile({ username, sharePath = null }) {
  const [profile, setProfile] = useState(null),
    [user, setUser] = useState(null),
    [feed, setFeed] = useState(null),
    [page, setPage] = useState(1),
    [people, setPeople] = useState(""),
    [collection, setCollection] = useState("bikes"),
    [error, setError] = useState("");
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
                {profile.bio && <section className="profile-about"><h2>О себе</h2><p className="profile-bio">{profile.bio}</p></section>}
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
              <ShareButton path={sharePath} title={profile.name} />
              {!profile.relationship.isSelf && (
                <ReportButton
                  entityType="profile"
                  targetId={profile.id}
                  user={user}
                />
              )}
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
            <BadgeShelf endpoint={"game/profiles/" + profile.username} />
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
                <div className="social-switch ui-tabs">
                  <button
                    className="quiet"
                    aria-pressed={collection === "bikes"}
                    onClick={() => setCollection("bikes")}
                  >
                    <Bike size={17} aria-hidden="true" />
                    Велосипеды
                  </button>
                  <button
                    className="quiet"
                    aria-pressed={collection === "rides"}
                    onClick={() => setCollection("rides")}
                  >
                    <Route size={17} aria-hidden="true" />
                    Покатушки
                  </button>
                </div>
                {collection === "rides" ? (
                  <RideList username={username} />
                ) : (
                  <>
                    <h2>
                      Коллекция велосипедов <span>{profile.counts.bikes}</span>
                    </h2>
                    {feed ? (
                      <>
                        <BikeGrid bikes={feed.bikes}>
                          {feed.bikes.map((b) => (
                            <BikeCard key={b.id} bike={b} user={user} />
                          ))}
                        </BikeGrid>
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
                  </>
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
