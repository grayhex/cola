import type { Viewer as ViewerType } from "./contracts.ts";
import { cache } from "react";
import { currentUser } from "./auth.ts";
// One session lookup per request, shared by the layout and the page (#74).

export const currentViewer: () => Promise<ViewerType> = cache(currentUser);
