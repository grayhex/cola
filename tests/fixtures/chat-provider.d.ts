import type {
  StreamChat,
  UserResponse,
  ChannelMemberResponse,
  ChannelResponse,
  MessageResponse,
} from "stream-chat";
export function fixtureProvider(): StreamChat & {
  users: Map<string, UserResponse>;
  channels: Map<
    string,
    {
      members: ChannelMemberResponse[];
      created_by_id?: string;
      club_id?: string;
      frozen?: boolean;
      name?: string;
    }
  >;
  calls: unknown[][];
  messages: Map<string, Partial<MessageResponse> & { id: string; cid: string }>;
  asClient(token: string): {
    channel(
      type: string,
      id: string,
    ): {
      watch(): Promise<{ channel: Partial<ChannelResponse> }>;
      query(): Promise<{
        channel: Partial<ChannelResponse>;
        messages: Partial<MessageResponse>[];
      }>;
      sendMessage(body: {
        text: string;
      }): Promise<{ message: Partial<MessageResponse> }>;
    };
    queryChannels(filter: { cid: string }): Promise<unknown[]>;
  };
};
