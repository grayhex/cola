// Design system first: tokens.css declares the cascade layer order (#127).
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
import "./styles/bike.css";
import "./styles/bike-page.css";
import "./styles/journal.css";
import "./styles/community.css";
import "./styles/rides.css";
import "./styles/game.css";
import "./styles/profile.css";
import "./styles/articles.css";
import "./styles/admin.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { themeBootstrap } from "../lib/theme.js";
import SiteProvider from "./ui/site-provider.jsx";
import { getSite } from "../lib/site.js";
import { hidden } from "../lib/indexing.js";
import { currentViewer } from "../lib/viewer.js";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { settings } = await getSite();
  return {
    title: settings.siteName,
    description: settings.siteDescription,
    // Pages opt in to search engines one by one (#74).
    robots: hidden,
    icons: {
      icon: settings.faviconId
        ? "/api/assets/" + settings.faviconId
        : "/favicon.svg",
    },
  };
}
export default async function Layout({ children }) {
  const [site, user] = await Promise.all([getSite(), currentViewer()]);
  // What /api/me would answer, in the same JSON shape (dates as strings).
  const viewer = user ? JSON.parse(JSON.stringify(user)) : null;
  return (
    <html
      lang="ru"
      data-theme={site.settings.appearance.theme}
      suppressHydrationWarning
    >
      <head>
        <link
          rel="preload"
          href="/fonts/sourcesans3.woff"
          as="font"
          type="font/woff"
          crossOrigin="anonymous"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: themeBootstrap(site.settings.appearance.theme),
          }}
        />
      </head>
      <body>
        <SiteProvider initial={site} viewer={viewer}>
          {children}
        </SiteProvider>
      </body>
    </html>
  );
}
