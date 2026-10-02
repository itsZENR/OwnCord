import { t } from "@lib/i18n";

export interface AvatarCrop {
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
}

export const DEFAULT_AVATAR_CROP: AvatarCrop = { centerX: 0.5, centerY: 0.5, zoom: 1 };

export function validateAvatarFile(file: File): void {
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error(t("Choose an image smaller than 10 MB.", "Выберите изображение размером до 10 МБ."));
  }
}

export function avatarSourceRect(width: number, height: number, crop: AvatarCrop): { x: number; y: number; side: number } {
  const zoom = Math.max(1, Math.min(3, crop.zoom));
  const side = Math.min(width, height) / zoom;
  const x = Math.max(0, Math.min(width - side, crop.centerX * width - side / 2));
  const y = Math.max(0, Math.min(height - side, crop.centerY * height - side / 2));
  return { x, y, side };
}

/** Crop and scale a selected picture before using the regular file upload API. */
export async function prepareAvatar(file: File, crop: AvatarCrop = DEFAULT_AVATAR_CROP): Promise<File> {
  validateAvatarFile(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(t("This image could not be opened.", "Не удалось открыть это изображение."));
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("Image processing is unavailable.", "Обработка изображения недоступна."));
    const source = avatarSourceRect(bitmap.width, bitmap.height, crop);
    context.drawImage(bitmap, source.x, source.y, source.side, source.side, 0, 0, 256, 256);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not prepare avatar")), "image/png");
    });
    return new File([blob], "avatar.png", { type: "image/png" });
  } finally {
    bitmap.close();
  }
}
