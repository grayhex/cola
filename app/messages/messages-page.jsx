"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSite } from "../ui/site-provider.jsx";
import { SocialHeader, SocialFooter } from "../ui/social-primitives.jsx";
const Chat = dynamic(() => import("./stream-chat.jsx"), {
  ssr: false,
  loading: () => <p role="status">Загружаем сообщения…</p>,
});
export default function MessagesPage() {
  const { viewer, chatEnabled } = useSite();
  return (
    <>
      <SocialHeader />
      <main className="page messages-page">
        <h1>Сообщения</h1>
        {!viewer ? (
          <p>
            <Link href="/login">Войдите</Link>, чтобы переписываться с
            велосипедистами.
          </p>
        ) : !chatEnabled ? (
          <p role="status">Сообщения пока отключены.</p>
        ) : !viewer.email_verified_at ? (
          <p>
            Подтвердите почту в{" "}
            <Link href="/account?tab=profile">настройках профиля</Link>, чтобы
            пользоваться сообщениями.
          </p>
        ) : (
          <Chat key={viewer.id} />
        )}
      </main>
      <SocialFooter />
    </>
  );
}
