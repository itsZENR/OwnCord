import { t } from "@lib/i18n";

/** Crop and scale a selected picture before using the regular file upload API. */
export async function prepareAvatar(file: File): Promise<File> {
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error(t("Choose an image smaller than 10 MB.", "Выберите изображение размером до 10 МБ."));
  }
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
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not prepare avatar")), "image/png");
    });
    return new File([blob], "avatar.png", { type: "image/png" });
  } finally {
    bitmap.close();
  }
}
