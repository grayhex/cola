"use client";
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
} from "lucide-react";
import { useSite } from "./site-provider.jsx";
function configurable(name, Fallback) {
  function Icon({ size = 24, className = "", style, ...props }) {
    const { personalSettings: settings } = useSite();
    const id = settings.uiIcons?.[name];
    return id ? (
      <img
        src={"/api/assets/" + id}
        alt={props["aria-label"] || ""}
        aria-hidden={props["aria-hidden"] ?? !props["aria-label"]}
        title={props.title}
        className={"configurable-icon " + className}
        width={size}
        height={size}
        style={{
          ...style,
          objectFit: "contain",
          flexShrink: 0,
        }}
      />
    ) : (
      <Fallback size={size} className={className} style={style} {...props} />
    );
  }
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
export const SlidersHorizontal = configurable(
  "SlidersHorizontal",
  LucideSlidersHorizontal,
);
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
