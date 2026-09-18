import "./gamification.css";
import "./globals.css";
import "./mobile.css";
import "./showcase.css";
import "./social.css";
import "./header.css";
import "./community.css";
import SiteProvider from "./ui/site-provider.jsx";
import { getSite } from "../lib/site.js";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { settings } = await getSite();
  return {
    title: settings.siteName,
    description: settings.siteDescription,
    robots: { index: false, follow: false },
    icons: {
      icon: settings.faviconId
        ? "/api/assets/" + settings.faviconId
        : "/favicon.svg",
    },
  };
}
export default async function Layout({ children }) {
  const site = await getSite();
  return (
    <html lang="ru">
      <body>
        <SiteProvider initial={site}>{children}</SiteProvider>
      </body>
    </html>
  );
}
