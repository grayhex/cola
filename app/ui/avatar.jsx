"use client";
import { useEffect, useState } from "react";
// Avatars are stored at 512 px; lists show them at 20–96 px.
const avatarWidth = (size) => (size === "large" ? 320 : 160);
export function Avatar({ person, size = "normal" }) {
  const base =
      person?.avatar ||
      (person?.avatar_id ? "/api/avatars/" + person.avatar_id : null),
    src = base && !base.includes("?") ? base + "?width=" + avatarWidth(size) : base,
    [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={"social-avatar " + size}>
      {src && !failed ? (
        <img
          src={src}
          loading="lazy"
          decoding="async"
          alt={"Аватар " + person.name}
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">
          {(person?.name || "В").slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
