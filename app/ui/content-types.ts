import type {
  JsonData,
  SiteSettings,
  PublicAuthor,
} from "../../lib/contracts.ts";
import type {
  journalDetail,
  journalList,
  saveJournal,
} from "../../lib/journal.ts";
import type { journalCards } from "../../lib/journal-discovery.ts";
import type {
  articleDetail,
  articleList,
  saveArticle,
} from "../../lib/articles.ts";
import type {
  marketDetail,
  marketList,
  sellerListings,
  saveListing,
  ListingInput,
} from "../../lib/market.ts";
import type {
  accountAchievements,
  reactionState,
} from "../../lib/gamification.ts";
import type { pageData } from "../../lib/social-page.ts";
import type {
  rideList,
  rideDetail,
  ownerRide,
  publicRide,
} from "../../lib/rides.ts";
import type { communityHome, discoverySearch } from "../../lib/discovery.ts";
import type { marketContact, extendListing } from "../../lib/market.ts";
import type {
  listingModelChoices,
  listingBikeChoices,
} from "../../lib/market-links.ts";
import type { JournalInput } from "../../lib/journal.ts";
import type { rideFeed } from "../../lib/ride-feed.ts";
import type { savedPage } from "../../lib/journal-discovery.ts";
import type { notificationPage } from "../../lib/notifications.ts";
import type { commentDto, commentPage, replyPage } from "../../lib/comments.ts";
export type JournalDto = JsonData<Awaited<ReturnType<typeof journalDetail>>>;
export type JournalCardDto =
  | JsonData<Awaited<ReturnType<typeof journalCards>>[number]>
  | Extract<FeedDto["items"][number], { kind: "journal" }>;
export type JournalListDto = JsonData<Awaited<ReturnType<typeof journalList>>>;
export type JournalSaved = JsonData<Awaited<ReturnType<typeof saveJournal>>>;
export type ArticleDto = JsonData<Awaited<ReturnType<typeof articleDetail>>>;
export type ArticleListDto = JsonData<Awaited<ReturnType<typeof articleList>>>;
export type ArticleSaved = JsonData<Awaited<ReturnType<typeof saveArticle>>>;
type MarketDetailDto = JsonData<Awaited<ReturnType<typeof marketDetail>>>;
export type MarketDto = Omit<MarketDetailDto, "saved"> & { saved?: boolean };
export type MarketListDto = JsonData<Awaited<ReturnType<typeof marketList>>> & {
  seller?: PublicAuthor;
};
export type MarketOthersDto = JsonData<
  Awaited<ReturnType<typeof sellerListings>>
>;
export type MarketSaved = JsonData<Awaited<ReturnType<typeof saveListing>>>;
export type GameShelfDto = JsonData<
  Awaited<ReturnType<typeof accountAchievements>>
>;
export type ReactionStateDto = Awaited<ReturnType<typeof reactionState>>;
export type ProfileInitial = NonNullable<
  Awaited<ReturnType<typeof pageData<"profile">>>
>;
export type HeroAnimation = SiteSettings["heroTitleAnimation"];
export type PhotoInserter = (id: string, alt?: string) => void;

export type RideListDto = JsonData<Awaited<ReturnType<typeof rideList>>>;
type OwnerRideFields = Partial<
  Omit<
    JsonData<ReturnType<typeof ownerRide>>,
    keyof JsonData<ReturnType<typeof publicRide>>
  >
>;
export type RideDto = JsonData<Awaited<ReturnType<typeof rideDetail>>> &
  OwnerRideFields;
export type RideCardDto = RideListDto["rides"][number] & OwnerRideFields;
export type CommunityHomeDto = JsonData<
  Awaited<ReturnType<typeof communityHome>>
>;
export type DiscoveryDto = JsonData<
  Awaited<ReturnType<typeof discoverySearch>>
>;
export type MarketContactDto = {
  contact: JsonData<Awaited<ReturnType<typeof marketContact>>>;
};
export type MarketExtendDto = JsonData<
  Awaited<ReturnType<typeof extendListing>>
>;
export type MarketModelsDto = JsonData<
  Awaited<ReturnType<typeof listingModelChoices>>
>;
export type MarketBikesDto = JsonData<
  Awaited<ReturnType<typeof listingBikeChoices>>
>;
export type JournalDraft = Omit<
  JournalInput,
  "kind" | "status" | "mileage" | "installationResult"
> & {
  kind: string;
  status: string;
  mileage: number | string | null;
  installationResult: string | null;
};
export type ListingDraft = Omit<
  Required<ListingInput>,
  "category" | "listingType" | "condition" | "price" | "currency" | "status"
> & {
  category: string;
  listingType: string;
  condition: string;
  price: number | string;
  currency: string;
  status: string;
};

export type FeedDto = JsonData<Awaited<ReturnType<typeof rideFeed>>>;
export type JournalFeedDto = Omit<FeedDto, "items"> & {
  items: Extract<FeedDto["items"][number], { kind: "journal" }>[];
};
export type SavedPageDto = JsonData<Awaited<ReturnType<typeof savedPage>>>;
export type NotificationPageDto = JsonData<
  Awaited<ReturnType<typeof notificationPage>>
>;
export type NotificationDto = NotificationPageDto["notifications"][number];
export type MarketNoticeDto = Extract<NotificationDto, { actor: null }>;
export type CommentDto = JsonData<ReturnType<typeof commentDto>>;
export type CommentPageDto = JsonData<Awaited<ReturnType<typeof commentPage>>>;
export type ReplyPageDto = JsonData<Awaited<ReturnType<typeof replyPage>>>;
