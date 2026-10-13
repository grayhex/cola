import { uuid } from "./validation.ts";
const CHAT_TYPE = "colabike";
export const clubChannelId = (id: string) =>
  "club_" + uuid.parse(id).replaceAll("-", "");
export const clubChannelCid = (id: string) =>
  CHAT_TYPE + ":" + clubChannelId(id);
export function clubIdOfCid(cid: string) {
  const match = /^colabike:club_([a-f0-9]{32})$/.exec(cid);
  if (!match) return null;
  const h = match[1];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
