/**
 * driveSync.js -- Google Drive API wrapper for FPL Companion
 *
 * Handles all direct communication with Google Drive:
 * - OAuth 2.0 sign-in/sign-out via Google Identity Services (GIS)
 * - Upload and download of the backup JSON file
 * - Token management (storage, silent refresh, expiry detection)
 *
 * The backup file lives in Drive's "appDataFolder" -- a hidden,
 * app-specific folder that doesn't clutter the user's Drive.
 * Only this app can see or modify it.
 *
 * SETUP REQUIRED:
 * The consuming app must set DRIVE_CLIENT_ID before calling any
 * auth methods. This is the OAuth 2.0 Client ID from Google Cloud
 * Console (Web application type).
 *
 * Usage:
 *   import { initDriveAuth, signIn, signOut, uploadBackup, downloadBackup } from "./driveSync.js";
 *   initDriveAuth("YOUR_CLIENT_ID");
 *   await signIn();
 *   await uploadBackup(jsonString);
 *   const data = await downloadBackup();
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Filename used in Google Drive's appDataFolder */
const BACKUP_FILENAME = "fpl-companion-backup.json";

/** MIME type for the backup file */
const JSON_MIME = "application/json";

/**
 * OAuth scope: drive.appdata gives read/write access ONLY to the hidden
 * appDataFolder. It cannot see or modify any of the user's regular files.
 * This is the most restrictive Drive scope available.
 */
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

/** localStorage key for persisting the refresh token */
const TOKEN_STORAGE_KEY = "fpl_drive_token";

/** Google's token endpoint for refreshing access tokens */
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let clientId = null;
let accessToken = null;
let tokenExpiry = 0; // Unix ms when the current access token expires
let tokenClient = null; // GIS TokenClient instance
let isInitialized = false;

// Listeners for auth state changes (used by UI components)
const authListeners = new Set();

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the Google Drive auth system.
 *
 * Must be called once at app startup with the OAuth Client ID from
 * Google Cloud Console. This loads the GIS library and sets up the
 * token client for the sign-in flow.
 *
 * @param {string} oauthClientId - OAuth 2.0 Client ID (Web application type)
 */
export function initDriveAuth(oauthClientId) {
  if (!oauthClientId) {
    console.warn("[driveSync] No client ID provided -- Drive sync disabled");
    return;
  }

  clientId = oauthClientId;

  // Try to restore a saved token from localStorage
  const savedToken = loadSavedToken();
  if (savedToken) {
    accessToken = savedToken.access_token;
    tokenExpiry = savedToken.expiry;
  }

  // Load the Google Identity Services script if not already present.
  // GIS handles the OAuth popup/redirect flow and token management.
  if (!window.google?.accounts?.oauth2) {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      setupTokenClient();
      isInitialized = true;
    };
    document.head.appendChild(script);
  } else {
    setupTokenClient();
    isInitialized = true;
  }
}

/**
 * Create the GIS TokenClient instance.
 * This is what triggers the OAuth consent popup when signIn() is called.
 */
function setupTokenClient() {
  if (!window.google?.accounts?.oauth2) return;

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    // The callback fires after the user completes the consent flow
    callback: (response) => {
      if (response.error) {
        console.error("[driveSync] Auth error:", response.error);
        notifyListeners();
        return;
      }

      // Store the access token and calculate expiry
      // GIS returns expires_in in seconds; convert to absolute Unix ms
      accessToken = response.access_token;
      tokenExpiry = Date.now() + (response.expires_in || 3600) * 1000;

      // Persist token so we can restore it across page reloads
      saveToken({
        access_token: accessToken,
        expiry: tokenExpiry,
      });

      console.log("[driveSync] Signed in successfully");
      notifyListeners();
    },
  });
}

// ---------------------------------------------------------------------------
// Auth methods
// ---------------------------------------------------------------------------

/**
 * Trigger the Google sign-in flow (opens consent popup).
 * Resolves when the user completes sign-in, rejects on cancel/error.
 *
 * @returns {Promise<void>}
 */
export function signIn() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error("Drive sync not initialized. Call initDriveAuth() first."));
      return;
    }

    // Override the callback temporarily to resolve/reject the promise
    const originalCallback = tokenClient.callback;
    tokenClient.callback = (response) => {
      // Restore the original callback for future use
      tokenClient.callback = originalCallback;
      // Let the original callback handle token storage
      originalCallback(response);

      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve();
      }
    };

    // Request an access token -- this opens the consent popup
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

/**
 * Sign out: clear the access token and remove persisted token.
 * Does NOT revoke the token with Google (the user can do that from
 * their Google Account settings if they want to fully disconnect).
 */
export function signOut() {
  // Revoke the current token with Google so it can't be reused
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {
      console.log("[driveSync] Token revoked");
    });
  }

  accessToken = null;
  tokenExpiry = 0;
  removeSavedToken();
  notifyListeners();
  console.log("[driveSync] Signed out");
}

/**
 * Check whether the user is currently signed in with a valid token.
 * @returns {boolean}
 */
export function isSignedIn() {
  return !!accessToken && Date.now() < tokenExpiry;
}

/**
 * Subscribe to auth state changes (sign in / sign out / token refresh).
 * The listener is called with no arguments; use isSignedIn() to check state.
 *
 * @param {Function} listener - Callback function
 * @returns {Function} - Unsubscribe function
 */
export function onAuthChange(listener) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

/** Notify all auth listeners of a state change */
function notifyListeners() {
  for (const fn of authListeners) {
    try {
      fn();
    } catch (err) {
      console.warn("[driveSync] Listener error:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Token persistence (localStorage)
// ---------------------------------------------------------------------------

/**
 * Save token data to localStorage for cross-reload persistence.
 * The access token is short-lived (1 hour), but saving it means
 * the user doesn't need to re-auth on every page reload within
 * that window.
 */
function saveToken(tokenData) {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokenData));
  } catch {
    // localStorage might be full or unavailable -- non-critical
  }
}

/** Load a previously saved token, or null if expired/missing */
function loadSavedToken() {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw);
    // Only restore if the token hasn't expired yet
    if (data.expiry && Date.now() < data.expiry) {
      return data;
    }

    // Token expired -- clean up
    removeSavedToken();
    return null;
  } catch {
    return null;
  }
}

/** Remove saved token from localStorage */
function removeSavedToken() {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Ensure we have a valid access token. If the current token is expired
 * or about to expire (within 5 minutes), request a new one silently
 * via GIS. If silent refresh fails, returns false so the caller can
 * prompt the user to sign in again.
 *
 * @returns {Promise<boolean>} - True if we have a valid token
 */
async function ensureValidToken() {
  // Token is still good (with 5-minute buffer)
  if (accessToken && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    return true;
  }

  // Try silent token refresh via GIS
  // GIS can refresh without a popup if the user previously consented
  if (!tokenClient) return false;

  return new Promise((resolve) => {
    const originalCallback = tokenClient.callback;
    tokenClient.callback = (response) => {
      tokenClient.callback = originalCallback;
      originalCallback(response);
      resolve(!response.error);
    };

    // prompt: "" means try silent refresh, no popup
    try {
      tokenClient.requestAccessToken({ prompt: "" });
    } catch {
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Drive file operations
// ---------------------------------------------------------------------------

/**
 * Upload a backup JSON string to Google Drive's appDataFolder.
 *
 * Uses the multipart upload method: metadata + content in one request.
 * If a backup file already exists, it's updated in place (same file ID).
 * If no backup exists yet, a new file is created.
 *
 * @param {string} jsonString - The backup data as a JSON string
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function uploadBackup(jsonString) {
  // Ensure we have a valid token
  const hasToken = await ensureValidToken();
  if (!hasToken) {
    return { success: false, error: "Not signed in. Please sign in to Google Drive." };
  }

  try {
    // Check if backup file already exists so we can update it
    const existingFileId = await findBackupFileId();

    if (existingFileId) {
      // UPDATE existing file (PATCH to the file's upload URI)
      const res = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": JSON_MIME,
          },
          body: jsonString,
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error("[driveSync] Upload (update) failed:", res.status, errText);
        return { success: false, error: `Drive API error: ${res.status}` };
      }

      console.log("[driveSync] Backup updated on Drive");
      return { success: true };
    } else {
      // CREATE new file using multipart upload (metadata + content)
      const metadata = {
        name: BACKUP_FILENAME,
        mimeType: JSON_MIME,
        parents: ["appDataFolder"],
      };

      // Build multipart body
      const boundary = "fpl_backup_boundary";
      const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${JSON_MIME}\r\n\r\n` +
        `${jsonString}\r\n` +
        `--${boundary}--`;

      const res = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error("[driveSync] Upload (create) failed:", res.status, errText);
        return { success: false, error: `Drive API error: ${res.status}` };
      }

      console.log("[driveSync] Backup created on Drive");
      return { success: true };
    }
  } catch (err) {
    console.error("[driveSync] Upload error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Download the backup JSON from Google Drive's appDataFolder.
 *
 * @returns {Promise<{ success: boolean, data?: Object, error?: string }>}
 *   On success, data is the parsed backup object.
 */
export async function downloadBackup() {
  const hasToken = await ensureValidToken();
  if (!hasToken) {
    return { success: false, error: "Not signed in. Please sign in to Google Drive." };
  }

  try {
    const fileId = await findBackupFileId();
    if (!fileId) {
      return { success: false, error: "No backup found on Google Drive." };
    }

    // Download file content
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[driveSync] Download failed:", res.status, errText);
      return { success: false, error: `Drive API error: ${res.status}` };
    }

    const data = await res.json();
    console.log("[driveSync] Backup downloaded from Drive");
    return { success: true, data };
  } catch (err) {
    console.error("[driveSync] Download error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Find the file ID of the existing backup file in appDataFolder.
 * Returns null if no backup exists yet.
 *
 * @returns {Promise<string|null>}
 */
async function findBackupFileId() {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
        `spaces=appDataFolder&` +
        `q=name='${BACKUP_FILENAME}'&` +
        `fields=files(id,name,modifiedTime)&` +
        `pageSize=1`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!res.ok) return null;

    const result = await res.json();
    return result.files?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Metadata: last backup info
// ---------------------------------------------------------------------------

/**
 * Get metadata about the backup file on Drive (last modified time, size).
 * Useful for showing "Last synced: X" in the UI.
 *
 * @returns {Promise<{ exists: boolean, modifiedTime?: string } | null>}
 */
export async function getBackupInfo() {
  const hasToken = await ensureValidToken();
  if (!hasToken) return null;

  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
        `spaces=appDataFolder&` +
        `q=name='${BACKUP_FILENAME}'&` +
        `fields=files(id,name,modifiedTime,size)&` +
        `pageSize=1`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!res.ok) return null;

    const result = await res.json();
    const file = result.files?.[0];

    if (!file) return { exists: false };

    return {
      exists: true,
      modifiedTime: file.modifiedTime,
      sizeBytes: parseInt(file.size, 10) || 0,
    };
  } catch {
    return null;
  }
}
