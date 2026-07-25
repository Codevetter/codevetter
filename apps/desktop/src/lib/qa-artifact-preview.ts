import type { QaArtifactPreview } from '@/lib/tauri-ipc';

export function qaArtifactRenderMode(preview: QaArtifactPreview): 'image' | 'text' | 'unsupported' {
  if (
    preview.dataUrl &&
    preview.contentType.startsWith('image/') &&
    preview.dataUrl.startsWith(`data:${preview.contentType};base64,`) &&
    !preview.text
  ) {
    return 'image';
  }
  if (
    preview.text !== null &&
    preview.dataUrl === null &&
    preview.contentType !== 'text/html' &&
    (preview.contentType.startsWith('text/') || preview.contentType === 'application/json')
  ) {
    return 'text';
  }
  return 'unsupported';
}
