import type {
  AssetLibraryDto,
  SiteCatalog,
  SiteSettings,
} from "../../lib/contracts.ts";
export type SettingsChange = <K extends keyof SiteSettings>(
  key: K,
  value: SiteSettings[K] | ((before: SiteSettings[K]) => SiteSettings[K]),
) => void;
export interface SettingsProps {
  settings: SiteSettings;
  onChange: SettingsChange;
}
export interface CatalogProps {
  value: SiteCatalog;
  onChange: (value: SiteCatalog) => void;
}
export type AssetChoice = Pick<AssetLibraryDto[number], "id" | "name"> &
  Partial<Pick<AssetLibraryDto[number], "format">> & { preview?: string };
export type AssetUpload = (file: File) => Promise<AssetChoice | undefined>;
export type ConfirmAction = (
  title: string,
  description: string,
  action: (email: string) => Promise<unknown>,
  email?: string,
) => void;
