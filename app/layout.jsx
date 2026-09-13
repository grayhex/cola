import "./globals.css";
export const metadata = {
  title: "ColaBike — ваш велосипед в деталях",
  description: "Личный гараж, комплектация и аксессуары вашего велосипеда.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};
export default function Layout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
