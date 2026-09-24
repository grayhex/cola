import Link from "next/link";
import GlobalHeader from "./ui/global-header.jsx";
import { SocialFooter } from "./ui/social-primitives.jsx";
import { Compass } from "./ui/icons.jsx";
import { currentUser } from "../lib/auth.js";
export default async function NotFound() {
  const user = await currentUser();
  return (
    <>
      <GlobalHeader user={user} />
      <main className="empty">
        <Compass size={36} strokeWidth={1.5} />
        <h1>Здесь пока ничего нет</h1>
        <p>Возможно, ссылка изменилась или публикация больше недоступна.</p>
        {!user && (
          <p>
            Если это ваша закрытая публикация,{" "}
            <Link href="/login">войдите</Link>, чтобы её открыть.
          </p>
        )}
        <Link className="button secondary" href="/">
          На главную
        </Link>
      </main>
      <SocialFooter />
    </>
  );
}
