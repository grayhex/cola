"use client";
import { useEffect, useState } from "react";
export function Avatar({ person, size = "normal" }) {
  const src =
      person?.avatar ||
      (person?.avatar_id ? "/api/avatars/" + person.avatar_id : null),
    [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={"social-avatar " + size}>
      {src && !failed ? (
        <img
          src={src}
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
