import { cache } from "react";
import { currentUser } from "./auth.js";
// One session lookup per request, shared by the layout and the page (#74).
export const currentViewer = cache(currentUser);
