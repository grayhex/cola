import type { StreamChat, UserResponse } from "stream-chat";
export function fixtureProvider(): StreamChat & {
  users: Map<string, UserResponse>;
  channels: Map<
    string,
    { members: { user_id: string; channel_role: string }[] }
  >;
  calls: unknown[][];
};
