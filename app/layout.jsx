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
        {/* Russian text in the body and headings: fetch before first paint. */}
        {["manrope-cyrillic", "unbounded-cyrillic"].map((font) => (
          <link
            key={font}
            rel="preload"
            href={`/fonts/${font}.woff2`}
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        ))}
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
