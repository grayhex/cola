import "maplibre-gl/dist/maplibre-gl.css";
import "./rides.css";
import "./theme.css";
import "./globals.css";
import "./mobile.css";
import "./social.css";
import "./community.css";
import "./gamification.css";
import "./product-ui.css";
import "./showcase.css";
import "./header.css";
import "./about.css";
import "./refinements.css";
import "./journal.css";
import "./fonts.css";
import "./garage-polish.css";
import "./ui-tabs.css";
import { themeBootstrap } from "../lib/theme.js";
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
        <SiteProvider initial={site}>{children}</SiteProvider>
      </body>
    </html>
  );
}
