const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export async function isPngFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.png')) return false;

  const signature = new Uint8Array(await file.slice(0, PNG_SIGNATURE.length).arrayBuffer());
  return PNG_SIGNATURE.every((byte, index) => signature[index] === byte);
}

export function hasSvgExtension(file: File) {
  return file.name.toLowerCase().endsWith('.svg');
}

export function hasPsdExtension(file: File) {
  return file.name.toLowerCase().endsWith('.psd');
}

export function hasAiOrEpsExtension(file: File) {
  return /\.(?:ai|eps)$/i.test(file.name);
}

export function hasHtmlExtension(file: File) {
  return /\.(?:html|htm)$/i.test(file.name);
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
