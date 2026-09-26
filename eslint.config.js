import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

// Every warning blocks CI as well (pnpm lint --max-warnings=0, #140).
export default [
  {
    ignores: [
      ".next/",
      "node_modules/",
      "services/",
      "public/",
      "test-results/",
      "playwright-report/",
      "lib/version.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": ["warn", { caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      // Sanitizers (SVG, previews, rich text) match control characters on purpose.
      "no-control-regex": "off",
    },
  },
  {
    files: ["app/**/*.{js,jsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
  {
    // Native images use the #67 media variants/srcset, private API URLs,
    // SVG artwork or local upload previews. Do not proxy these via next/image.
    // Keep this exception limited to the existing media renderers.
    files: [
      "app/about/about.jsx",
      "app/admin/asset-picker.jsx",
      "app/admin/media-library.jsx",
      "app/ui/achievement-art.jsx",
      "app/ui/articles.jsx",
      "app/ui/auth-window.jsx",
      "app/ui/avatar.jsx",
      "app/ui/bike-photo.jsx",
      "app/ui/bike-wizard.jsx",
      "app/ui/home.jsx",
      "app/ui/journal-card.jsx",
      "app/ui/journal-editor.jsx",
      "app/ui/journal-page.jsx",
      "app/ui/market.jsx",
      "app/ui/photo-search.jsx",
      "app/ui/small-image.jsx",
      "app/ui/social-primitives.jsx",
      "app/ui/zoomable-photo.jsx",
    ],
    rules: { "@next/next/no-img-element": "off" },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
