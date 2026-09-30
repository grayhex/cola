import { cache } from "react";
import { currentUser } from "./auth.js";
// One session lookup per request, shared by the layout and the page (#74).
/** @type {() => Promise<import("./contracts.js").Viewer>} */
export const currentViewer = cache(currentUser);
