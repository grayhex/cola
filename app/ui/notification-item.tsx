"use client";
import type * as React from "react";
import { Check, LoaderCircle } from "./icons.tsx";

export const noticeTime = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** The one mark «read» of one notice (#378): its own state and its own error. */
export interface ReadControl {
  pending: boolean;
  error: string;
  onRead: () => void;
}

// One notice in the list, whatever it is about (#378): the text, the action
// that follows it, the date and the control apart from each other, so a link
// never runs into the date. Every unread notice carries «Отметить прочитанным»:
// it marks that notice read, does not open its target and does not do what the
// notice offers.
export default function NotificationItem({
  notice,
  lead,
  action,
  read,
  children,
}: {
  notice: { id: string; readAt: string | null; createdAt: string };
  /** The avatar of who did it, or the mark of the site. */
  lead?: React.ReactNode;
  /** What the notice offers: a link to the target, a button. */
  action?: React.ReactNode;
  read: ReadControl;
  /** The sentence of the notice (its links may stand in it). */
  children: React.ReactNode;
}) {
  const unread = !notice.readAt;
  return (
    <li
      className={"notification" + (unread ? " unread" : "")}
      data-notification-id={notice.id}
    >
      {lead}
      <div className="notification-body">
        <p className="notification-text">{children}</p>
        {action && <div className="notification-actions">{action}</div>}
        <p className="notification-meta">
          <time dateTime={notice.createdAt}>
            {noticeTime(notice.createdAt)}
          </time>
          {/* Not only a colour and a bar: the word says it too. */}
          {unread && <span className="notification-flag">Новое</span>}
        </p>
        {read.error && (
          <p role="alert" className="notification-error">
            {read.error}
          </p>
        )}
      </div>
      {unread && (
        <button
          type="button"
          className="icon small notification-read"
          aria-label="Отметить прочитанным"
          data-hint="Отметить прочитанным"
          disabled={read.pending}
          aria-busy={read.pending || undefined}
          onClick={read.onRead}
        >
          {read.pending ? (
            <LoaderCircle size={16} aria-hidden="true" />
          ) : (
            <Check size={16} aria-hidden="true" />
          )}
        </button>
      )}
    </li>
  );
}
