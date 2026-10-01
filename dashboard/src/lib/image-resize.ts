/**
 * Client-seitiges Verkleinern vor dem Upload (max 2000×1500, JPEG 0.85).
 * Spart ~10× Storage gegenüber iPhone-Originalen. Kopie der Logik aus
 * pack-mode.tsx (dort bewusst unangetastet gelassen) für die Handoff-Seite.
 */
export async function resizeImage(
  file: File,
  maxLong = 2000,
  maxShort = 1500,
  quality = 0.85,
): Promise<File> {
  try {
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = blobUrl;
    });
    URL.revokeObjectURL(blobUrl);

    const isPortrait = img.height >= img.width;
    const longSide = isPortrait ? img.height : img.width;
    const shortSide = isPortrait ? img.width : img.height;

    let targetLong = Math.min(longSide, maxLong);
    let targetShort = Math.round(shortSide * (targetLong / longSide));
    if (targetShort > maxShort) {
      targetShort = maxShort;
      targetLong = Math.round(longSide * (targetShort / shortSide));
    }
    const targetW = isPortrait ? targetShort : targetLong;
    const targetH = isPortrait ? targetLong : targetShort;

    if (longSide <= maxLong && shortSide <= maxShort && file.type === "image/jpeg") {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) return file;
    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
