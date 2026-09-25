"use client";
import { Bike } from "./icons.jsx";
import { useSite } from "./site-provider.jsx";
import styles from "./auth.module.css";

// The left half of the sign-in window (#125): the administrator's
// illustration from Design → Graphics, or the ColaBike mark on a quiet field.
export function AuthArt() {
  const { settings } = useSite();
  return (
    <div className={styles.art} aria-hidden="true">
      {settings.authImageId ? (
        <img src={"/api/assets/" + settings.authImageId} alt="" />
      ) : (
        <div className={styles.artDefault}>
          <span className={styles.artMark}>
            <Bike size={40} strokeWidth={1.25} />
          </span>
          <p>Ваши велосипеды, истории и маршруты — в одном месте.</p>
        </div>
      )}
    </div>
  );
}

// A sign-in or registration window: the illustration on the left, the
// form on the right; on phones the illustration becomes a short banner.
export default function AuthWindow({
  as: Tag = "div",
  children,
  className = "",
  ...props
}) {
  return (
    <Tag className={`${styles.window} ${className}`} {...props}>
      <AuthArt />
      <div className={styles.body}>{children}</div>
    </Tag>
  );
}
