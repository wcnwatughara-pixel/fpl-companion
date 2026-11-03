/**
 * SyncSettings.jsx -- Data & Sync settings page
 *
 * Provides full visibility and control over the Google Drive sync system:
 * - Sign in / sign out with Google
 * - Sync status indicator (idle/pending/syncing/error)
 * - Last sync timestamp
 * - Force sync button
 * - Restore from Drive button
 * - Inventory of locally stored data (snapshots + backtest records)
 *
 * Also requests persistent storage from the browser to reduce the chance
 * of silent data eviction.
 *
 * Route: /sync (added in App.jsx)
 */

import { useState, useEffect, useCallback } from "react";
import { isSignedIn, signIn, signOut, onAuthChange, getBackupInfo } from "../utils/driveSync.js";
import { getSyncStatus, onSyncStatusChange, forceSync, restoreFromDrive } from "../utils/syncManager.js";
import { listSnapshots } from "../utils/snapshots.js";
import { listBacktestData } from "../utils/backtestDb.js";

export default function SyncSettings() {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const [authed, setAuthed] = useState(isSignedIn());
  const [syncState, setSyncState] = useState(getSyncStatus());
  const [snapshotList, setSnapshotList] = useState([]);
  const [backtestList, setBacktestList] = useState([]);
  const [backupInfo, setBackupInfo] = useState(null);
  const [restoreResult, setRestoreResult] = useState(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isForceSyncing, setIsForceSyncing] = useState(false);
  const [persistentStorage, setPersistentStorage] = useState(null);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Subscribe to auth and sync status changes
  useEffect(() => {
    const unsubAuth = onAuthChange(() => setAuthed(isSignedIn()));
    const unsubSync = onSyncStatusChange((status) => setSyncState(status));
    return () => { unsubAuth(); unsubSync(); };
  }, []);

  // Load local data inventory on mount and after restore
  const refreshInventory = useCallback(async () => {
    setSnapshotList(listSnapshots());
    const bt = await listBacktestData();
    setBacktestList(bt);
  }, []);

  useEffect(() => {
    refreshInventory();
  }, [refreshInventory]);

  // Fetch Drive backup info when signed in
  useEffect(() => {
    if (authed) {
      getBackupInfo().then((info) => setBackupInfo(info));
    } else {
      setBackupInfo(null);
    }
  }, [authed, syncState.status]);

  // Check persistent storage status
  useEffect(() => {
    if (navigator.storage?.persisted) {
      navigator.storage.persisted().then((val) => setPersistentStorage(val));
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSignIn = async () => {
    try {
      await signIn();
    } catch (err) {
      console.error("Sign-in failed:", err);
    }
  };

  const handleSignOut = () => {
    signOut();
    setRestoreResult(null);
  };

  const handleForceSync = async () => {
    setIsForceSyncing(true);
    await forceSync();
    setIsForceSyncing(false);
    // Refresh backup info after sync
    if (isSignedIn()) {
      const info = await getBackupInfo();
      setBackupInfo(info);
    }
  };

  const handleRestore = async () => {
    setIsRestoring(true);
    setRestoreResult(null);
    const result = await restoreFromDrive();
    setRestoreResult(result);
    setIsRestoring(false);
    // Refresh local inventory after restore
    await refreshInventory();
  };

  const handleRequestPersistence = async () => {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      setPersistentStorage(granted);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  /**
   * Sync status dot color:
   *   idle    -> green  (all synced)
   *   pending -> yellow (changes waiting)
   *   syncing -> blue   (uploading)
   *   error   -> red    (failed)
   */
  const statusColor = {
    idle: "bg-green-500",
    pending: "bg-yellow-500",
    syncing: "bg-blue-500 animate-pulse",
    error: "bg-red-500",
  };

  const statusLabel = {
    idle: "All data synced",
    pending: "Changes pending...",
    syncing: "Syncing to Drive...",
    error: "Sync error",
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-2xl font-bold">Data & Sync</h1>

      {/* ---- Google Drive Connection ---- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-300">Google Drive Backup</h2>

        {!authed ? (
          <div className="bg-[#111] border border-[#333] rounded-lg p-6 space-y-4">
            <p className="text-gray-400 text-sm">
              Sign in with Google to automatically back up your FPL data to
              Google Drive. Your data is stored in a hidden app folder that
              only this app can access.
            </p>
            <button
              onClick={handleSignIn}
              className="px-5 py-2.5 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition-colors flex items-center gap-2"
            >
              {/* Google "G" icon (inline SVG) */}
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign in with Google
            </button>
          </div>
        ) : (
          <div className="bg-[#111] border border-[#333] rounded-lg p-6 space-y-5">
            {/* Status row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${statusColor[syncState.status]}`} />
                <span className="text-sm text-gray-300">
                  {statusLabel[syncState.status]}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Sign out
              </button>
            </div>

            {/* Error details */}
            {syncState.error && (
              <p className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded">
                {syncState.error}
              </p>
            )}

            {/* Last sync time */}
            {syncState.lastSync && (
              <p className="text-xs text-gray-500">
                Last synced: {new Date(syncState.lastSync).toLocaleString()}
              </p>
            )}

            {/* Drive backup info */}
            {backupInfo?.exists && (
              <p className="text-xs text-gray-500">
                Drive backup last modified: {new Date(backupInfo.modifiedTime).toLocaleString()}
                {backupInfo.sizeBytes > 0 && (
                  <> &middot; {(backupInfo.sizeBytes / 1024 / 1024).toFixed(1)} MB</>
                )}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleForceSync}
                disabled={isForceSyncing || syncState.status === "syncing"}
                className="px-4 py-2 bg-[#222] hover:bg-[#333] rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isForceSyncing ? "Syncing..." : "Force Sync Now"}
              </button>
              <button
                onClick={handleRestore}
                disabled={isRestoring}
                className="px-4 py-2 bg-blue-900/40 hover:bg-blue-900/60 border border-blue-800/50 rounded-lg text-sm font-medium text-blue-300 transition-colors disabled:opacity-50"
              >
                {isRestoring ? "Restoring..." : "Restore from Drive"}
              </button>
            </div>

            {/* Restore result */}
            {restoreResult && (
              <div className={`text-sm px-4 py-3 rounded-lg ${
                restoreResult.success
                  ? "bg-green-900/20 text-green-300 border border-green-800/50"
                  : "bg-red-900/20 text-red-300 border border-red-800/50"
              }`}>
                {restoreResult.success ? (
                  <>
                    <p className="font-medium">Restore complete!</p>
                    <ul className="mt-1 text-xs space-y-0.5">
                      {restoreResult.restored.teamId && <li>Team ID restored</li>}
                      <li>{restoreResult.restored.snapshots} snapshot(s) restored</li>
                      <li>{restoreResult.restored.backtestRecords} backtest record(s) restored</li>
                    </ul>
                  </>
                ) : (
                  <p>{restoreResult.error}</p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---- Persistent Storage ---- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-300">Browser Storage</h2>
        <div className="bg-[#111] border border-[#333] rounded-lg p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-300">Persistent storage</p>
              <p className="text-xs text-gray-500 mt-1">
                Prevents the browser from silently clearing your data when disk space runs low.
              </p>
            </div>
            {persistentStorage === true ? (
              <span className="text-xs text-green-400 bg-green-900/20 px-3 py-1 rounded-full">
                Granted
              </span>
            ) : persistentStorage === false ? (
              <button
                onClick={handleRequestPersistence}
                className="text-xs text-yellow-300 bg-yellow-900/20 px-3 py-1 rounded-full hover:bg-yellow-900/40 transition-colors"
              >
                Request
              </button>
            ) : (
              <span className="text-xs text-gray-500">Not supported</span>
            )}
          </div>
        </div>
      </section>

      {/* ---- Local Data Inventory ---- */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-300">Stored Data</h2>

        {/* Team ID */}
        <div className="bg-[#111] border border-[#333] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Team ID</span>
            <span className="text-sm font-mono text-white">
              {(() => {
                try { return localStorage.getItem("fpl_team_id") || "Not set"; }
                catch { return "Unavailable"; }
              })()}
            </span>
          </div>
        </div>

        {/* Prediction Snapshots */}
        <div className="bg-[#111] border border-[#333] rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Prediction Snapshots</span>
            <span className="text-xs text-gray-500">{snapshotList.length} gameweek(s)</span>
          </div>
          {snapshotList.length > 0 && (
            <div className="space-y-1">
              {snapshotList.map((s) => (
                <div key={s.gw} className="flex items-center justify-between text-xs">
                  <span className="text-gray-300">GW{s.gw}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500">{s.playerCount} players</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                      s.isComplete
                        ? "bg-green-900/30 text-green-400"
                        : "bg-yellow-900/30 text-yellow-400"
                    }`}>
                      {s.isComplete ? "Complete" : "Pending"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {snapshotList.length === 0 && (
            <p className="text-xs text-gray-600">No snapshots stored locally.</p>
          )}
        </div>

        {/* Backtest Records */}
        <div className="bg-[#111] border border-[#333] rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Backtest Records</span>
            <span className="text-xs text-gray-500">{backtestList.length} gameweek(s)</span>
          </div>
          {backtestList.length > 0 && (
            <div className="space-y-1">
              {backtestList.map((b) => (
                <div key={b.gw} className="flex items-center justify-between text-xs">
                  <span className="text-gray-300">GW{b.gw}</span>
                  <span className="text-gray-500">
                    {new Date(b.capturedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
          {backtestList.length === 0 && (
            <p className="text-xs text-gray-600">No backtest records stored locally.</p>
          )}
        </div>
      </section>
    </div>
  );
}
