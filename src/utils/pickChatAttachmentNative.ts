import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

export type PickedChatAttachment = {
  file: File | Blob;
  fileName: string;
};

/**
 * iOS/Android: system document picker → Blob/File for chat upload validation.
 * Web: returns null (use `<input type="file">`).
 */
export async function pickChatAttachmentNative(): Promise<PickedChatAttachment | null> {
  if (Platform.OS === 'web') return null;

  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const fileName = asset.name?.trim() || 'attachment';
  const mimeType = asset.mimeType?.trim() || 'application/octet-stream';

  const res = await fetch(asset.uri);
  const blob = await res.blob();
  const effectiveType =
    blob.type && blob.type !== 'application/octet-stream' ? blob.type : mimeType;
  const body = blob.type === effectiveType ? blob : new Blob([blob], { type: effectiveType });

  if (typeof File !== 'undefined') {
    return {
      file: new File([body], fileName, { type: body.type || effectiveType }),
      fileName,
    };
  }

  return { file: body, fileName };
}
