"use client";
import { Bike } from "./icons.jsx";
import { useSite } from "./site-provider.jsx";
import styles from "./auth.module.css";

// The left half of the sign-in window (#125): the administrator's
// illustration from Design → Graphics, or the ColaBike mark on a quiet field.
// Registration has its own picture and falls back to sign-in's (#131).
export function AuthArt({ mode = "login" }) {
  const { settings } = useSite();
  const imageId =
    (mode === "register" && settings.authRegisterImageId) ||
    settings.authImageId;
  return (
    <div className={styles.art} aria-hidden="true">
      {imageId ? (
        <img src={"/api/assets/" + imageId} alt="" />
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
  mode = "login",
  children,
  className = "",
  ...props
}) {
  return (
    <Tag className={`${styles.window} ${className}`} {...props}>
      <AuthArt mode={mode} />
      <div className={styles.body}>{children}</div>
    </Tag>
  );
}
