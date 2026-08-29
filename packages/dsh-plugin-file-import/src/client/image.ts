function signatureMediaType(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  const text = String.fromCharCode(...bytes)
  if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) return 'image/gif'
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

export async function normalizedImage(file: File, mediaType: string): Promise<File> {
  const detected = signatureMediaType(new Uint8Array(await file.slice(0, 12).arrayBuffer()))
  const normalizedType = detected ?? mediaType
  return file.type === normalizedType
    ? file
    : new File([file], file.name, { type: normalizedType, lastModified: file.lastModified })
}
