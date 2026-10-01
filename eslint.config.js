import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

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
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
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
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { caughtErrors: "none" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-nocheck": true, "ts-expect-error": true },
      ],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
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
      "app/about/about.tsx",
      "app/admin/asset-picker.tsx",
      "app/admin/media-library.tsx",
      "app/ui/achievement-art.tsx",
      "app/ui/articles.tsx",
      "app/ui/auth-window.tsx",
      "app/ui/avatar.tsx",
      "app/ui/bike-photo.tsx",
      "app/ui/bike-wizard.tsx",
      "app/ui/home.tsx",
      "app/ui/journal-card.tsx",
      "app/ui/journal-editor.tsx",
      "app/ui/journal-page.tsx",
      "app/ui/market.tsx",
      "app/ui/photo-search.tsx",
      "app/ui/small-image.tsx",
      "app/ui/social-primitives.tsx",
      "app/ui/zoomable-photo.tsx",
    ],
    rules: { "@next/next/no-img-element": "off" },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
