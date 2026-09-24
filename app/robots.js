import { crawlRules } from "../lib/indexing.js";
// The origin comes from the runtime environment, not from the build.
export const dynamic = "force-dynamic";
export default function robots() {
  return crawlRules();
}
