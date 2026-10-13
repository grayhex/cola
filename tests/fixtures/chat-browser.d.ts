import type { Page } from "@playwright/test";
export function chatBrowserFixture(users: { id: string; name: string }[]): {
  install(page: Page, person: { id: string; name: string }): Promise<void>;
  reads: string[];
  events: { type?: string }[];
  unexpected: string[];
};
