/**
 * App.jsx -- Main application shell
 *
 * Sets up:
 * 1. React Router with 9 routes (Dashboard, Compare, Fixtures, Recommendations,
 *    Wildcard, Glossary, BestGW, AccuracyTracker, SyncSettings)
 * 2. Persistent top navigation bar
 * 3. First-time setup screen (enter Team ID)
 * 4. Refresh Data button
 * 5. FplContext provider (wraps everything so all pages can access data)
 *
 * Features 8+9: Added BestGW and AccuracyTracker routes and nav items.
 * Feature 10: Google Drive sync -- backs up all app data (team ID,
 *   prediction snapshots, backtest records) to a hidden app folder in
 *   the user's Google Drive for cross-device persistence.
 */

import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { FplProvider, useFpl } from "./context/FplContext.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Compare from "./pages/Compare.jsx";
import Fixtures from "./pages/Fixtures.jsx";
import Recommendations from "./pages/Recommendations.jsx";
import Wildcard from "./pages/Wildcard.jsx";
import Glossary from "./pages/Glossary.jsx";
import BestGW from "./pages/BestGW.jsx";
import AccuracyTracker from "./pages/AccuracyTracker.jsx";
import SyncSettings from "./pages/SyncSettings.jsx";
import { formatDate } from "./utils/formatters.js";
import { initDriveAuth } from "./utils/driveSync.js";
import { initSyncManager, getSyncStatus, onSyncStatusChange } from "./utils/syncManager.js";

/**
 * OAuth Client ID from Google Cloud Console (Web application type).
 * Replace this with your actual Client ID after setting up the
 * Google Cloud project. Leave empty to disable Drive sync entirely.
 */
const DRIVE_CLIENT_ID = "452995873342-7edugklvvdaiq1o9nbl94hvpsnu8ntqi.apps.googleusercontent.com";

export default function App() {
  return (
    <FplProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </FplProvider>
  );
}

// ---------------------------------------------------------------------------
// App Shell (needs to be inside FplProvider to use useFpl)
// ---------------------------------------------------------------------------

function AppShell() {
  const { teamId, setTeamId, loadData, loading, lastUpdated, error, currentGw } = useFpl();
  const [inputId, setInputId] = useState("");
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());

  // On mount: load data if we have a team ID, and initialize Drive sync.
  // Drive auth + sync manager init happen regardless of team ID so the
  // "Restore from Google Drive" link on the setup screen works for
  // returning users who lost their data.
  useEffect(() => {
    if (teamId) {
      loadData();
    }

    // Initialize Google Drive auth (no-ops if DRIVE_CLIENT_ID is empty)
    initDriveAuth(DRIVE_CLIENT_ID);

    // Initialize the sync manager (listens for auth changes, requests
    // persistent storage, and queues an initial sync if already signed in)
    initSyncManager();

    // Run only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to sync status changes so the nav dot stays current
  useEffect(() => {
    const unsub = onSyncStatusChange((status) => setSyncStatus(status));
    return unsub;
  }, []);

  /**
   * Handle first-time team ID submission.
   */
  const handleSetup = (e) => {
    e.preventDefault();
    const cleaned = inputId.trim();
    if (!cleaned) return;
    setTeamId(cleaned);
    // Load data after a tick so state has updated
    setTimeout(() => loadData(), 100);
  };

  /**
   * Handle "Refresh Data" click.
   */
  const handleRefresh = () => {
    loadData(true); // forceRefresh = true
  };

  // ----- First-time setup screen (no team ID yet) -----
  // Shows the team ID form plus a subtle restore link for returning
  // users whose localStorage was wiped by the browser.
  if (!teamId) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-md space-y-6 text-center">
            <h1 className="text-3xl font-bold">FPL Companion</h1>
            <p className="text-gray-400 text-sm">
              Enter your FPL Team ID to get started. You can find it in the URL
              when you view your team on the FPL website:
              <br />
              <span className="text-gray-500">
                fantasy.premierleague.com/entry/<strong className="text-white">YOUR_ID</strong>/event/...
              </span>
            </p>
            <form onSubmit={handleSetup} className="flex gap-2">
              <input
                type="text"
                value={inputId}
                onChange={(e) => setInputId(e.target.value)}
                placeholder="e.g. 1234567"
                className="flex-1 px-4 py-3 bg-[#111] border border-[#333] rounded-lg text-lg text-center focus:outline-none focus:border-[#555]"
                autoFocus
              />
              <button
                type="submit"
                className="px-6 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-semibold transition-colors"
              >
                Save
              </button>
            </form>

            {/* Restore link for returning users who lost their data.
                Only shown when Drive sync is configured (client ID set). */}
            {DRIVE_CLIENT_ID && (
              <p className="text-xs text-gray-600 pt-2">
                Returning user?{" "}
                <NavLink
                  to="/sync"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Restore from Google Drive
                </NavLink>
              </p>
            )}
          </div>
        </div>

        {/* Render /sync route even on setup screen so restore is accessible */}
        <Routes>
          <Route path="/sync" element={<SyncSettings />} />
        </Routes>
      </div>
    );
  }

  // ----- Main app (team ID exists) -----
  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation bar */}
      <nav className="sticky top-0 z-50 border-b border-[#222]" style={{ backgroundColor: "#0a0a0a" }}>
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
          {/* Left: nav links */}
          <div className="flex items-center gap-1 overflow-x-auto">
            <NavItem to="/" label="My Squad" />
            <NavItem to="/compare" label="Compare" />
            <NavItem to="/fixtures" label="Fixtures" />
            <NavItem to="/recommendations" label="Picks" />
            <NavItem to="/wildcard" label="Wildcard" />
            <NavItem to="/bestgw" label="Best GW" />
            <NavItem to="/accuracy" label="Accuracy" />
            <NavItem to="/glossary" label="Glossary" />
            <NavItem to="/sync" label="Sync" />
          </div>

          {/* Right: info + actions */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Sync status dot -- shows current Drive sync state.
                Only visible when the user has signed in to Google Drive
                (otherwise sync is inactive and the dot would be noise). */}
            <SyncDot status={syncStatus.status} />

            {/* Current GW indicator */}
            {currentGw && (
              <span className="text-xs text-gray-500 hidden md:inline">
                GW{currentGw}
              </span>
            )}

            {/* Last updated */}
            {lastUpdated && (
              <span className="text-[10px] text-gray-600 hidden lg:inline">
                Updated {formatDate(lastUpdated)}
              </span>
            )}

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="px-3 py-1.5 bg-[#222] hover:bg-[#333] rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>

            {/* Settings: change team ID */}
            <button
              onClick={() => {
                const newId = prompt("Enter new FPL Team ID:", teamId);
                if (newId && newId.trim() !== teamId) {
                  setTeamId(newId.trim());
                  setTimeout(() => loadData(true), 100);
                }
              }}
              className="text-gray-500 hover:text-gray-300 text-sm"
              title="Change Team ID"
            >
              &#9881;
            </button>
          </div>
        </div>
      </nav>

      {/* Error banner */}
      {error && (
        <div className="bg-red-900/40 border-b border-red-800/50 px-4 py-2 text-sm text-red-300">
          {error}
          <button
            onClick={() => loadData(true)}
            className="ml-3 text-red-200 underline hover:text-white text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Page content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/fixtures" element={<Fixtures />} />
          <Route path="/recommendations" element={<Recommendations />} />
          <Route path="/wildcard" element={<Wildcard />} />
          <Route path="/glossary" element={<Glossary />} />
          <Route path="/bestgw" element={<BestGW />} />
          <Route path="/accuracy" element={<AccuracyTracker />} />
          <Route path="/sync" element={<SyncSettings />} />
        </Routes>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nav link component
// ---------------------------------------------------------------------------

function NavItem({ to, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
          isActive
            ? "bg-[#1a1a2e] text-white"
            : "text-gray-400 hover:text-gray-200 hover:bg-[#111]"
        }`
      }
    >
      {label}
    </NavLink>
  );
}

// ---------------------------------------------------------------------------
// Sync status dot
// ---------------------------------------------------------------------------

/**
 * Tiny colored dot in the nav bar showing the current Drive sync state.
 * Hidden when status is "idle" to keep the nav clean when nothing is happening.
 *
 * Colors:
 *   pending -> yellow  (local changes waiting to sync)
 *   syncing -> blue    (upload in progress, pulses)
 *   error   -> red     (last sync failed)
 *   idle    -> hidden  (all good, no need to show anything)
 */
function SyncDot({ status }) {
  if (status === "idle") return null;

  const colors = {
    pending: "bg-yellow-500",
    syncing: "bg-blue-500 animate-pulse",
    error: "bg-red-500",
  };

  const titles = {
    pending: "Sync pending...",
    syncing: "Syncing to Drive...",
    error: "Sync error",
  };

  return (
    <NavLink to="/sync" title={titles[status] || ""}>
      <div className={`w-2 h-2 rounded-full ${colors[status] || ""}`} />
    </NavLink>
  );
}
