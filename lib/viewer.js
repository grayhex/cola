import { cache } from "react";
import { currentUser } from "./auth.js";
// One session lookup per request, shared by the layout and the page (#74).
/** @type {() => Promise<import("./auth.js").CurrentUser | null>} */
export const currentViewer = cache(currentUser);
