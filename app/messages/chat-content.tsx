import type { AttachmentProps } from "stream-chat-react";
import SmallImage from "../ui/small-image.tsx";
function safeImage(value?: string) {
  try {
    const u = new URL(value || "");
    return u.protocol === "https:" &&
      /^[a-z0-9-]+\.stream-io-cdn\.com$/.test(u.hostname)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
// Render only vendor-hosted images. Untrusted attachments cannot embed arbitrary
// tracking pixels, documents, video players or HTML from a third-party domain.
export function Images({ attachments = [] }: AttachmentProps) {
  return attachments.map((file, i) => {
    const url =
      "type" in file &&
      file.type === "image" &&
      safeImage(file.image_url || file.asset_url);
    return url ? (
      <a
        key={i}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Открыть изображение"
      >
        <SmallImage
          src={url}
          alt={("title" in file && file.title) || "Изображение в сообщении"}
          className="chat-image"
        />
      </a>
    ) : (
      <span key={i}>Вложение недоступно</span>
    );
  });
}
export function plainText(text = "") {
  return (
    <span className="chat-text">
      {text.split(/(https?:\/\/[^\s<>]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </span>
  );
}
