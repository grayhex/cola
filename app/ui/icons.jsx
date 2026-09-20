"use client";
import { useState } from "react";
import {
  ArrowLeft as LucideArrowLeft,
  ArrowUpRight as LucideArrowUpRight,
  Bell as LucideBell,
  Bike as LucideBike,
  BookOpen as LucideBookOpen,
  Calendar as LucideCalendar,
  Camera as LucideCamera,
  Check as LucideCheck,
  CheckCheck as LucideCheckCheck,
  ChevronDown as LucideChevronDown,
  ChevronRight as LucideChevronRight,
  ChevronUp as LucideChevronUp,
  Code2 as LucideCode2,
  Copy as LucideCopy,
  ExternalLink as LucideExternalLink,
  Flag as LucideFlag,
  Flame as LucideFlame,
  Gauge as LucideGauge,
  Globe as LucideGlobe,
  Heart as LucideHeart,
  History as LucideHistory,
  Home as LucideHome,
  Image as LucideImage,
  Info as LucideInfo,
  Layers as LucideLayers,
  Link as LucideLink,
  LoaderCircle as LucideLoaderCircle,
  Lock as LucideLock,
  LogOut as LucideLogOut,
  MapPin as LucideMapPin,
  Medal as LucideMedal,
  Menu as LucideMenu,
  MessageCircle as LucideMessageCircle,
  Package as LucidePackage,
  Palette as LucidePalette,
  Pencil as LucidePencil,
  Plus as LucidePlus,
  RefreshCw as LucideRefreshCw,
  RotateCcw as LucideRotateCcw,
  Route as LucideRoute,
  Save as LucideSave,
  ScanLine as LucideScanLine,
  Search as LucideSearch,
  Settings2 as LucideSettings2,
  Shield as LucideShield,
  ShieldCheck as LucideShieldCheck,
  SlidersHorizontal as LucideSlidersHorizontal,
  Sparkles as LucideSparkles,
  Star as LucideStar,
  Trash2 as LucideTrash2,
  TriangleAlert as LucideTriangleAlert,
  Trophy as LucideTrophy,
  Type as LucideType,
  Upload as LucideUpload,
  UserRound as LucideUserRound,
  Users as LucideUsers,
  X as LucideX,
  Zap as LucideZap,
  NotebookPen as LucideNotebookPen,
  MessagesSquare as LucideMessagesSquare,
  Bookmark as LucideBookmark,
  BookmarkCheck as LucideBookmarkCheck,
  FilePenLine as LucideFilePenLine,
  Reply as LucideReply,
  Share2 as LucideShare2,
  FileText as LucideFileText,
  CircleCheck as LucideCircleCheck,
  TrendingUp as LucideTrendingUp,
  Wrench as LucideWrench,
  Smile as LucideSmile,
  CircleHelp as LucideCircleHelp,
  UserPlus as LucideUserPlus,
  UsersRound as LucideUsersRound,
  BookMarked as LucideBookMarked,
  ArrowUpDown as LucideArrowUpDown,
  Compass as LucideCompass,
  Scale as LucideScale,
  Cog as LucideCog,
  LayoutGrid as LucideLayoutGrid,
  Images as LucideImages,
  ChartNoAxesColumnIncreasing as LucideChartNoAxesColumnIncreasing,
  Pin as LucidePin,
  Eye as LucideEye,
  EyeOff as LucideEyeOff,
} from "lucide-react";
import { useSite } from "./site-provider.jsx";
import { iconPackByName, resolveIconAsset, iconPackOverride } from "../../lib/icon-pack.js";
const builtins = {
  ArrowLeft: LucideArrowLeft,
  ArrowUpRight: LucideArrowUpRight,
  Bell: LucideBell,
  Bike: LucideBike,
  BookOpen: LucideBookOpen,
  Calendar: LucideCalendar,
  Camera: LucideCamera,
  Check: LucideCheck,
  CheckCheck: LucideCheckCheck,
  ChevronDown: LucideChevronDown,
  ChevronRight: LucideChevronRight,
  ChevronUp: LucideChevronUp,
  Code2: LucideCode2,
  Copy: LucideCopy,
  ExternalLink: LucideExternalLink,
  Flag: LucideFlag,
  Flame: LucideFlame,
  Gauge: LucideGauge,
  Globe: LucideGlobe,
  Heart: LucideHeart,
  History: LucideHistory,
  Home: LucideHome,
  Image: LucideImage,
  Info: LucideInfo,
  Layers: LucideLayers,
  Link: LucideLink,
  LoaderCircle: LucideLoaderCircle,
  Lock: LucideLock,
  LogOut: LucideLogOut,
  MapPin: LucideMapPin,
  Medal: LucideMedal,
  Menu: LucideMenu,
  MessageCircle: LucideMessageCircle,
  Package: LucidePackage,
  Palette: LucidePalette,
  Pencil: LucidePencil,
  Plus: LucidePlus,
  RefreshCw: LucideRefreshCw,
  RotateCcw: LucideRotateCcw,
  Route: LucideRoute,
  Save: LucideSave,
  ScanLine: LucideScanLine,
  Search: LucideSearch,
  Settings2: LucideSettings2,
  Shield: LucideShield,
  ShieldCheck: LucideShieldCheck,
  SlidersHorizontal: LucideSlidersHorizontal,
  Sparkles: LucideSparkles,
  Star: LucideStar,
  Trash2: LucideTrash2,
  TriangleAlert: LucideTriangleAlert,
  Trophy: LucideTrophy,
  Type: LucideType,
  Upload: LucideUpload,
  UserRound: LucideUserRound,
  Users: LucideUsers,
  X: LucideX,
  Zap: LucideZap,
  NotebookPen: LucideNotebookPen,
  MessagesSquare: LucideMessagesSquare,
  Bookmark: LucideBookmark,
  BookmarkCheck: LucideBookmarkCheck,
  FilePenLine: LucideFilePenLine,
  Reply: LucideReply,
  Share2: LucideShare2,
  FileText: LucideFileText,
  CircleCheck: LucideCircleCheck,
  TrendingUp: LucideTrendingUp,
  Wrench: LucideWrench,
  Smile: LucideSmile,
  CircleHelp: LucideCircleHelp,
  UserPlus: LucideUserPlus,
  UsersRound: LucideUsersRound,
  BookMarked: LucideBookMarked,
  ArrowUpDown: LucideArrowUpDown,
  Compass: LucideCompass,
  Scale: LucideScale,
  Cog: LucideCog,
  LayoutGrid: LucideLayoutGrid,
  Images: LucideImages,
  ChartNoAxesColumnIncreasing: LucideChartNoAxesColumnIncreasing,
  Pin: LucidePin,
  Eye: LucideEye,
  EyeOff: LucideEyeOff,
};

// A semantic icon never shares state with another slot. Missing/failed assets
// fall back to the built-in icon, preserving the accessible action label.
export function SiteIcon({
  name, original = false, legacyAssetId, size = 24, className = "", style,
  color, strokeWidth, absoluteStrokeWidth, fill, ...props
}) {
  const site = useSite();
  const settings = site?.personalSettings || site?.settings || {};
  const [failedId, setFailedId] = useState(null);
  const id = original ? null : resolveIconAsset(settings, name, legacyAssetId);
  const Fallback = builtins[iconPackByName[name]?.fallback || name] || LucideInfo;
  if (id && id !== failedId) return (
    <img
      {...props}
      src={"/api/assets/" + id}
      alt={props["aria-label"] || ""}
      aria-hidden={props["aria-hidden"] ?? !props["aria-label"]}
      className={"configurable-icon " + className}
      width={size} height={size}
      onError={(event) => { setFailedId(id); props.onError?.(event); }}
      style={{ ...style, objectFit: "contain", flexShrink: 0,
        ...(iconPackOverride(settings, name) ? { imageRendering: "pixelated" } : {}) }}
    />
  );
  return <Fallback {...props} size={size} className={className} style={style}
    color={color} strokeWidth={strokeWidth} absoluteStrokeWidth={absoluteStrokeWidth}
    fill={fill} aria-hidden={props["aria-hidden"] ?? !props["aria-label"]} />;
}
function configurable(name, Fallback) {
  function Icon(props) { return <SiteIcon name={name} {...props} />; }
  Icon.displayName = name;
  Icon.Default = Fallback;
  return Icon;
}

export const ArrowLeft = configurable("ArrowLeft", LucideArrowLeft);
export const ArrowUpRight = configurable("ArrowUpRight", LucideArrowUpRight);
export const Bell = configurable("Bell", LucideBell);
export const Bike = configurable("Bike", LucideBike);
export const BookOpen = configurable("BookOpen", LucideBookOpen);
export const Calendar = configurable("Calendar", LucideCalendar);
export const Camera = configurable("Camera", LucideCamera);
export const Check = configurable("Check", LucideCheck);
export const CheckCheck = configurable("CheckCheck", LucideCheckCheck);
export const ChevronDown = configurable("ChevronDown", LucideChevronDown);
export const ChevronRight = configurable("ChevronRight", LucideChevronRight);
export const ChevronUp = configurable("ChevronUp", LucideChevronUp);
export const Code2 = configurable("Code2", LucideCode2);
export const Copy = configurable("Copy", LucideCopy);
export const ExternalLink = configurable("ExternalLink", LucideExternalLink);
export const Flag = configurable("Flag", LucideFlag);
export const Flame = configurable("Flame", LucideFlame);
export const Gauge = configurable("Gauge", LucideGauge);
export const Globe = configurable("Globe", LucideGlobe);
export const Heart = configurable("Heart", LucideHeart);
export const History = configurable("History", LucideHistory);
export const Home = configurable("Home", LucideHome);
export const Image = configurable("Image", LucideImage);
export const Info = configurable("Info", LucideInfo);
export const Layers = configurable("Layers", LucideLayers);
export const Link = configurable("Link", LucideLink);
export const LoaderCircle = configurable("LoaderCircle", LucideLoaderCircle);
export const Lock = configurable("Lock", LucideLock);
export const LogOut = configurable("LogOut", LucideLogOut);
export const MapPin = configurable("MapPin", LucideMapPin);
export const Medal = configurable("Medal", LucideMedal);
export const Menu = configurable("Menu", LucideMenu);
export const MessageCircle = configurable("MessageCircle", LucideMessageCircle);
export const Package = configurable("Package", LucidePackage);
export const Palette = configurable("Palette", LucidePalette);
export const Pencil = configurable("Pencil", LucidePencil);
export const Plus = configurable("Plus", LucidePlus);
export const RefreshCw = configurable("RefreshCw", LucideRefreshCw);
export const RotateCcw = configurable("RotateCcw", LucideRotateCcw);
export const Route = configurable("Route", LucideRoute);
export const Save = configurable("Save", LucideSave);
export const ScanLine = configurable("ScanLine", LucideScanLine);
export const Search = configurable("Search", LucideSearch);
export const Settings2 = configurable("Settings2", LucideSettings2);
export const Shield = configurable("Shield", LucideShield);
export const ShieldCheck = configurable("ShieldCheck", LucideShieldCheck);
export const SlidersHorizontal = configurable("SlidersHorizontal", LucideSlidersHorizontal);
export const Sparkles = configurable("Sparkles", LucideSparkles);
export const Star = configurable("Star", LucideStar);
export const Trash2 = configurable("Trash2", LucideTrash2);
export const TriangleAlert = configurable("TriangleAlert", LucideTriangleAlert);
export const Trophy = configurable("Trophy", LucideTrophy);
export const Type = configurable("Type", LucideType);
export const Upload = configurable("Upload", LucideUpload);
export const UserRound = configurable("UserRound", LucideUserRound);
export const Users = configurable("Users", LucideUsers);
export const X = configurable("X", LucideX);
export const Zap = configurable("Zap", LucideZap);
export const NotebookPen = configurable("NotebookPen", LucideNotebookPen);
export const MessagesSquare = configurable("MessagesSquare", LucideMessagesSquare);
export const Bookmark = configurable("Bookmark", LucideBookmark);
export const BookmarkCheck = configurable("BookmarkCheck", LucideBookmarkCheck);
export const FilePenLine = configurable("FilePenLine", LucideFilePenLine);
export const Reply = configurable("Reply", LucideReply);
export const Share2 = configurable("Share2", LucideShare2);
export const FileText = configurable("FileText", LucideFileText);
export const CircleCheck = configurable("CircleCheck", LucideCircleCheck);
export const TrendingUp = configurable("TrendingUp", LucideTrendingUp);
export const Wrench = configurable("Wrench", LucideWrench);
export const Smile = configurable("Smile", LucideSmile);
export const CircleHelp = configurable("CircleHelp", LucideCircleHelp);
export const UserPlus = configurable("UserPlus", LucideUserPlus);
export const UsersRound = configurable("UsersRound", LucideUsersRound);
export const BookMarked = configurable("BookMarked", LucideBookMarked);
export const ArrowUpDown = configurable("ArrowUpDown", LucideArrowUpDown);
export const Compass = configurable("Compass", LucideCompass);
export const Scale = configurable("Scale", LucideScale);
export const Cog = configurable("Cog", LucideCog);
export const LayoutGrid = configurable("LayoutGrid", LucideLayoutGrid);
export const Images = configurable("Images", LucideImages);
export const ChartNoAxesColumnIncreasing = configurable("ChartNoAxesColumnIncreasing", LucideChartNoAxesColumnIncreasing);
export const Pin = configurable("Pin", LucidePin);
export const Eye = configurable("Eye", LucideEye);
export const EyeOff = configurable("EyeOff", LucideEyeOff);
