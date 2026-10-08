"use client";
import type { SiteSettings } from "../../lib/contracts.ts";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowRight,
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
  Globe,
  Heart,
  House,
  ImagePlus,
  Import,
  Info,
  Link,
  Lock,
  LogOut,
  Menu,
  MessageCircle,
  Milestone,
  Monitor,
  Moon,
  Mountain,
  NotebookPen,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Route,
  Ruler,
  Save,
  Search,
  Send,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Sun,
  Tag,
  TreePine,
  Trophy,
  UserRound,
  UsersRound,
  Weight,
  Wrench,
  X,
} from "lucide-react";
import { useSite } from "./site-provider.tsx";
import { customEmoji, pulseIconColors } from "../../lib/ui-emoji.ts";
// One line icon per interface slot of lib/ui-emoji.ts (#127).
export const slotIcons: Record<string, LucideIcon> = {
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
  edit: Pencil,
  addPhoto: ImagePlus,
  public: Globe,
  private: Lock,
  link: Link,
  next: ArrowRight,
  back: ArrowLeft,
  save: Save,
  publish: Send,
  addPart: Wrench,
  addListing: Tag,
  date: Calendar,
  pulseToday: Sun,
  pulseTomorrow: CalendarPlus,
  pulseWeekend: TreePine,
  pulseLater: Calendar,
};
// Interface icon: the administrator's emoji when one is set for the slot,
// otherwise the line icon, both at the same size (docs/development/design-system.md → Icons).
export default function SiteIcon({
  name,
  settings,
  size = 16,
  className = "",
}: {
  name: string;
  settings?: Partial<SiteSettings>;
  size?: number;
  className?: string;
}) {
  const site = useSite();
  const config = settings || site?.settings;
  const emoji = customEmoji(config?.emojis, name);
  const color = config?.iconColors?.[name] || pulseIconColors[name];
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
