import type {
  CatalogSeedBatch,
  CatalogSeedEntry,
} from "../../lib/component-catalog-seed.ts";

export function seedEntry(model = "RD-M6100-SGS"): CatalogSeedEntry {
  return {
    seedKey: "shimano-" + model.toLowerCase(),
    status: "approved",
    category: "Задний переключатель",
    brand: "Shimano",
    family: "DEORE",
    model,
    name: "Shimano DEORE " + model,
    codes: [model],
    aliases: ["Shimano " + model],
    generation: null,
    attributes: {},
    description: `${model} — задний переключатель Shimano. Модель относится к семейству DEORE.`,
    descriptionGap: null,
    sources: [
      {
        id: "official",
        url: "https://productinfo.shimano.com/en/product/" + model,
        role: "technical_archive",
        checkedAt: "2026-10-09T00:00:00Z",
        sha256: "0".repeat(64),
        facts: [{ name: "Model No", value: model }],
      },
    ],
    identity: {
      verified: true,
      sourceIds: ["official"],
      note: "Код совпадает со спецификацией.",
    },
    inclusion: "Серийная линейка производителя.",
    photo: {
      status: "needs_permission",
      attempts: [
        {
          url: "https://productinfo.shimano.com/en/product/" + model,
          checkedAt: "2026-10-09T00:00:00Z",
          imageUrl: null,
          result: "Условия повторного использования не подтверждены.",
        },
      ],
      reason: "Нет подтверждённого разрешения на публикацию.",
    },
  };
}

export function seedBatch(entries = [seedEntry()]): CatalogSeedBatch {
  return {
    schemaVersion: 1,
    batch: "mechanical-v1",
    reviewedAt: "2026-10-09T01:00:00Z",
    limits: { models: 600, photos: 20, bytes: 8_000_000 },
    entries,
  };
}

export function readySeedPhoto(): Extract<
  CatalogSeedEntry["photo"],
  { status: "ready" }
> {
  return {
    status: "ready",
    attempts: [
      {
        url: "https://commons.wikimedia.org/wiki/File:Shimano_SPD_pedal_PD-M520.jpg",
        checkedAt: "2026-10-09T00:00:00Z",
        imageUrl: null,
        result: "Проверена модель и свободная лицензия.",
      },
    ],
    source: {
      provider: "Wikimedia Commons",
      url: "https://commons.wikimedia.org/wiki/File:Shimano_SPD_pedal_PD-M520.jpg",
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/example.jpg",
      title: "Test fixture",
      creator: "Test author",
      credit: "Test fixture",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    file: "media/test-photo.webp",
    sha256: "1".repeat(64),
    originalSha256: "2".repeat(64),
    bytes: 1000,
    width: 600,
    height: 400,
    reviewedAt: "2026-10-09T01:00:00Z",
    identityReview: "Только тестовая фикстура.",
  };
}
