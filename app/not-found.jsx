import Link from "next/link";
import GlobalHeader from "./ui/global-header.jsx";
import { SocialFooter } from "./ui/social-primitives.jsx";
import { Compass } from "./ui/icons.jsx";
export default function NotFound() {
  return (
    <>
      <GlobalHeader user={null} />
      <main className="empty">
        <Compass size={36} strokeWidth={1.5} />
        <h1>Здесь пока ничего нет</h1>
        <p>Возможно, ссылка изменилась или публикация больше недоступна.</p>
        <Link className="button secondary" href="/">
          На главную
        </Link>
      </main>
      <SocialFooter />
    </>
  );
}
