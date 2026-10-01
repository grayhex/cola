import tseslint from "typescript-eslint";

// Address the external-boundary type debt without widening the gate to mocks.
export default [
  {
    files: ["services/bike-resolver/src/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-nocheck": true, "ts-expect-error": true },
      ],
    },
  },
];
