// Photo upload rules and the words used to refuse a file (#366). One place for
// the bike page, the wizard and the server, so that the limit and the text
// agree: a file is refused when it is strictly larger than the limit.
export const photoFileBytes = 10 * 1024 * 1024;
export const photoTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const photosPerBike = 12;

// Rounded up: a file a byte over the limit must not read as exactly the limit.
const megabytes = (bytes: number) =>
  (Math.ceil((bytes / 1048576) * 100) / 100).toLocaleString("ru-RU", {
    maximumFractionDigits: 2,
  }) + " МБ";
export const photoLimitText = megabytes(photoFileBytes);

export type PhotoProblemKind = "size" | "format" | "count" | "small" | "failed";
// One refused file and why. `kind` says which rule: only «size» is about the
// size of the file.
export interface PhotoProblem {
  id: string;
  kind: PhotoProblemKind;
  message: string;
}

const tail = "Уменьшите изображение и выберите его снова.";
// For the server, which knows no name and, when it stops reading, no size.
export const photoTooLargeMessage = () =>
  `Фото слишком большое. Максимальный размер — ${photoLimitText}. ${tail}`;
export const oversizedPhotoMessage = (name: string, bytes: number) =>
  `Фото «${name}» слишком большое: ${megabytes(bytes)}. Максимальный размер — ${photoLimitText}. ${tail}`;
// The server said 413 to a file the browser found acceptable: a proxy in front
// of it has a smaller limit than the site's.
const refusedBySize = (name: string, bytes: number) =>
  `Сервер не принял фото «${name}» (${megabytes(bytes)}): оно больше допустимого размера запроса. ${tail}`;

type PhotoFile = { name: string; size: number; type: string };
const problemOf = (kind: PhotoProblemKind, message: string): PhotoProblem => ({
  id: crypto.randomUUID(),
  kind,
  message,
});
export function checkPhotoFile(file: PhotoFile): PhotoProblem | null {
  if (!(photoTypes as readonly string[]).includes(file.type))
    return problemOf(
      "format",
      `Фото «${file.name}» не добавлено: поддерживаются только JPEG, PNG и WebP.`,
    );
  if (file.size > photoFileBytes)
    return problemOf("size", oversizedPhotoMessage(file.name, file.size));
  return null;
}
export const tooManyPhotos = (name: string, most = photosPerBike) =>
  problemOf(
    "count",
    `Фото «${name}» не добавлено: у одного велосипеда может быть до ${most} фото.`,
  );
export const photoTooSmall = (name: string) =>
  problemOf(
    "small",
    `Фото «${name}» слишком маленькое: минимум 600 × 400 пикселей.`,
  );
export const photoUnreadable = (name: string) =>
  problemOf("failed", `Фото «${name}» не удалось прочитать как изображение.`);

export type PhotoSent =
  // `id`: the photo the server made of the file, when it said so.
  | { ok: true; id: string | null }
  // `retryable`: the same file may go through later (the network, a busy
  // server); otherwise it never will and is better dropped from the queue.
  | { ok: false; retryable: boolean; problem: PhotoProblem };

// The server's own words, when it sent JSON; a proxy may send HTML or nothing.
async function serverWords(response: Response) {
  try {
    const body: unknown = JSON.parse(await response.text());
    const error = (body as { error?: unknown } | null)?.error;
    return typeof error === "string" && error.trim() ? error : "";
  } catch {
    return "";
  }
}
// Sends one file to a bike. Never throws: whatever goes wrong comes back as
// words to show beside the file.
export async function sendBikePhoto(
  bikeId: string,
  file: File,
): Promise<PhotoSent> {
  const refused = checkPhotoFile(file);
  if (refused) return { ok: false, retryable: false, problem: refused };
  let response: Response;
  try {
    response = await fetch(`/api/bikes/${bikeId}/photos`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
  } catch {
    return {
      ok: false,
      retryable: true,
      problem: problemOf(
        "failed",
        `Фото «${file.name}» не отправлено: нет связи с сервером. Повторите попытку.`,
      ),
    };
  }
  if (response.ok) {
    let id: string | null = null;
    try {
      const body: unknown = JSON.parse(await response.text());
      const made = (body as { id?: unknown } | null)?.id;
      if (typeof made === "string") id = made;
    } catch {
      /* The photo is in; only its id is not known. */
    }
    return { ok: true, id };
  }
  if (response.status === 413)
    return {
      ok: false,
      retryable: false,
      problem: problemOf(
        "size",
        file.size > photoFileBytes
          ? oversizedPhotoMessage(file.name, file.size)
          : refusedBySize(file.name, file.size),
      ),
    };
  const words = await serverWords(response);
  const retryable = response.status === 429 || response.status >= 500;
  return {
    ok: false,
    retryable,
    problem: problemOf(
      "failed",
      `Фото «${file.name}» не загружено: ` +
        (words ||
          (response.status === 429
            ? "слишком много загрузок, подождите немного."
            : `сервер ответил с ошибкой (${response.status}).`)),
    ),
  };
}
