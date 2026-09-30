"use client";
import {
  Bell,
  Bike,
  Bookmark,
  BookOpen,
  Calendar,
  CalendarPlus,
  Cog,
  Check,
  CircleCheck,
  CircleHelp,
  Flame,
  Heart,
  House,
  Import,
  Info,
  LogOut,
  Menu,
  MessageCircle,
  Milestone,
  Monitor,
  Moon,
  Mountain,
  NotebookPen,
  Plus,
  Repeat,
  RotateCcw,
  Route,
  Ruler,
  Search,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Sun,
  TreePine,
  Trophy,
  UserRound,
  UsersRound,
  Weight,
  X,
} from "lucide-react";
import { useSite } from "./site-provider.jsx";
import { customEmoji } from "../../lib/ui-emoji.ts";
// One line icon per interface slot of lib/ui-emoji.ts (#127).
export const slotIcons = {
  home: House,
  bike: Bike,
  components: Cog,
  journal: NotebookPen,
  articles: BookOpen,
  rides: Route,
  market: ShoppingBag,
  about: Info,
  profile: UserRound,
  messages: MessageCircle,
  notifications: Bell,
  subscriptions: UsersRound,
  saved: Bookmark,
  records: Trophy,
  admin: Settings,
  logout: LogOut,
  search: Search,
  menu: Menu,
  light: Sun,
  dark: Moon,
  system: Monitor,
  add: Plus,
  addBike: Bike,
  addRide: Route,
  plan: CalendarPlus,
  import: Import,
  write: SquarePen,
  new: Sparkles,
  popular: Flame,
  filters: SlidersHorizontal,
  heart: Heart,
  size: Ruler,
  weight: Weight,
  mtb: Mountain,
  road: Milestone,
  gravel: TreePine,
  yes: CircleCheck,
  no: X,
  maybe: CircleHelp,
  repeat: Repeat,
  reset: RotateCcw,
  apply: Check,
  date: Calendar,
};
// Interface icon: the administrator's emoji when one is set for the slot,
// otherwise the line icon, both at the same size (docs/development/design-system.md → Icons).
export default function SiteIcon({
  name,
  settings,
  size = 16,
  className = "",
}) {
  const site = useSite();
  const config = settings || site?.settings;
  const emoji = customEmoji(config?.emojis, name);
  const color = config?.iconColors?.[name];
  const style = {
    "--icon-size": size + "px",
    ...(/^#[0-9a-f]{6}$/i.test(color || "") ? { "--icon-color": color } : {}),
  };
  if (emoji)
    return (
      <span
        className={"site-icon custom " + className}
        style={style}
        data-icon={name}
        data-highlight={!!color || undefined}
        aria-hidden="true"
      >
        {emoji}
      </span>
    );
  const Icon = slotIcons[name] || Plus;
  return (
    <Icon
      size={size}
      style={style}
      data-icon={name}
      data-highlight={!!color || undefined}
      strokeWidth={1.75}
      className={"site-icon " + className}
      aria-hidden="true"
    />
  );
}
