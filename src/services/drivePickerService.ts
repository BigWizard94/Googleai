import { DriveAttachment } from '../types';

declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

export interface PickedDriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  url?: string;
}

let pickerApiLoaded = false;

export function ensurePickerLoaded(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pickerApiLoaded && window.google?.picker) {
      resolve();
      return;
    }

    const loadPickerModule = () => {
      if (!window.gapi) {
        reject(new Error('Google API script not loaded'));
        return;
      }
      window.gapi.load('picker', {
        callback: () => {
          pickerApiLoaded = true;
          resolve();
        },
        onerror: () => {
          reject(new Error('Failed to load Google Picker API'));
        },
      });
    };

    if (window.gapi) {
      loadPickerModule();
    } else {
      const existingScript = document.querySelector('script[src="https://apis.google.com/js/api.js"]');
      if (existingScript) {
        existingScript.addEventListener('load', loadPickerModule, { once: true });
        existingScript.addEventListener(
          'error',
          () => reject(new Error('Failed to load Google API script')),
          { once: true }
        );
      } else {
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.async = true;
        script.defer = true;
        script.onload = loadPickerModule;
        script.onerror = () => reject(new Error('Failed to load Google API script'));
        document.head.appendChild(script);
      }
    }
  });
}

export async function openGoogleDrivePicker(accessToken: string): Promise<PickedDriveFile[]> {
  await ensurePickerLoaded();

  return new Promise((resolve, reject) => {
    try {
      const google = window.google;
      const pickerOrigin =
        window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0
          ? window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]
          : window.location.origin;

      const pickerCallback = (data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const docs: any[] = data.docs || [];
          const picked: PickedDriveFile[] = docs.map((doc) => ({
            id: doc.id,
            name: doc.name || 'Untitled File',
            mimeType: doc.mimeType || 'application/octet-stream',
            sizeBytes: doc.sizeBytes,
            url: doc.url,
          }));
          resolve(picked);
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve([]);
        }
      };

      const docsView = new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(
        true
      );
      const uploadView = new google.picker.DocsUploadView();

      const picker = new google.picker.PickerBuilder()
        .addView(docsView)
        .addView(uploadView)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(accessToken)
        .setCallback(pickerCallback)
        .setOrigin(pickerOrigin)
        .build();

      picker.setVisible(true);
    } catch (error) {
      reject(error);
    }
  });
}

export async function fetchDriveFileContent(
  file: PickedDriveFile,
  accessToken: string
): Promise<DriveAttachment> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  };

  // First fetch file metadata from Google Drive API
  let metaName = file.name;
  let metaMime = file.mimeType;
  let metaSize = file.sizeBytes;
  let metaWebViewLink = file.url;
  let metaDescription = '';

  try {
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        file.id
      )}?fields=id,name,mimeType,size,webViewLink,description,modifiedTime`,
      { headers }
    );
    if (metaRes.ok) {
      const metaJson = await metaRes.json();
      metaName = metaJson.name || metaName;
      metaMime = metaJson.mimeType || metaMime;
      metaSize = metaJson.size ? Number(metaJson.size) : metaSize;
      metaWebViewLink = metaJson.webViewLink || metaWebViewLink;
      metaDescription = metaJson.description || '';
    }
  } catch (err) {
    console.warn('Metadata fetch warning:', err);
  }

  let extractedContent = '';

  try {
    if (metaMime === 'application/vnd.google-apps.document') {
      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          file.id
        )}/export?mimeType=text/plain`,
        { headers }
      );
      if (exportRes.ok) {
        extractedContent = await exportRes.text();
      }
    } else if (metaMime === 'application/vnd.google-apps.spreadsheet') {
      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          file.id
        )}/export?mimeType=text/csv`,
        { headers }
      );
      if (exportRes.ok) {
        extractedContent = await exportRes.text();
      }
    } else if (metaMime === 'application/vnd.google-apps.presentation') {
      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          file.id
        )}/export?mimeType=text/plain`,
        { headers }
      );
      if (exportRes.ok) {
        extractedContent = await exportRes.text();
      }
    } else if (
      metaMime.startsWith('text/') ||
      metaMime === 'application/json' ||
      metaMime === 'application/xml' ||
      metaMime === 'application/javascript' ||
      metaName.match(/\.(txt|md|csv|json|ts|tsx|js|jsx|py|html|css|yml|yaml|xml|sql|log)$/i)
    ) {
      const downloadRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
        { headers }
      );
      if (downloadRes.ok) {
        extractedContent = await downloadRes.text();
      }
    }
  } catch (err) {
    console.warn('Content extraction fallback:', err);
  }

  if (!extractedContent.trim()) {
    extractedContent = [
      `[Google Drive File Metadata]`,
      `File Name: ${metaName}`,
      `MIME Type: ${metaMime}`,
      metaSize ? `Size: ${metaSize} bytes` : '',
      metaDescription ? `Description: ${metaDescription}` : '',
      metaWebViewLink ? `Link: ${metaWebViewLink}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Cap single file context at 25,000 characters so prompts stay well within limits
  const truncatedContent =
    extractedContent.length > 25000
      ? `${extractedContent.slice(0, 25000)}\n...[Content truncated at 25,000 characters]`
      : extractedContent;

  return {
    id: file.id,
    name: metaName,
    mimeType: metaMime,
    content: truncatedContent,
    sizeBytes: metaSize,
    webViewLink: metaWebViewLink,
  };
}
