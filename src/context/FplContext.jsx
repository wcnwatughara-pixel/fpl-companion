/**
 * FplContext.jsx -- Global state management
 *
 * This is the app's central data store, built with React Context + useReducer.
 * It holds all FPL data (players, fixtures, user team, etc.) and provides
 * functions to load data, refresh it, and update settings.
 *
 * Any component in the app can access this data by calling useFpl().
 *
 * State shape:
 *   loading    - true while data is being fetched
 *   error      - error message if something went wrong
 *   teamId     - the user's FPL team ID
 *   players    - normalised array of all ~700 players
 *   teamsById  - lookup map: team ID -> team object
 *   currentGw  - the "live" GW (stays active until all matches finish)
 *   planningGw - the "forward" GW (jumps ahead once deadline passes)
 *   events     - all gameweek objects (deadlines, averages, etc.)
 *   fixtures   - raw fixtures array from the API (for PPDU calculation)
 *   entry      - the user's team summary (rank, points, value)
 *   picks      - the user's current squad selection
 *   lastUpdated - timestamp of last data fetch
 */

import { createContext, useContext, useReducer, useCallback } from "react";
import { loadAllData, saveTeamId, getTeamId, getLastUpdated } from "../api/fplApi.js";
import { transformAll } from "../utils/transforms.js";
import { calculateCompositeScores, calculateGlobalBlendedScores, calculateCaptaincyScores } from "../utils/scoring.js";
import { calculateProjectedPoints } from "../utils/projections.js";
import { fetchLivePoints, mergeLivePoints } from "../utils/livePoints.js";
import { captureSnapshotIfNeeded, autoCompleteSnapshots } from "../utils/snapshots.js";
import { saveBacktestData } from "../utils/backtestDb.js";
       

const FplContext = createContext(null);

// ---------------------------------------------------------------------------
// Reducer (state machine)
// ---------------------------------------------------------------------------

/**
 * The reducer handles state transitions. Each action type describes
 * what happened, and the reducer returns the new state.
 */
/**
 * Default projection horizon in gameweeks.
 * The user can change this via the UI; the value persists in state
 * and projections are recalculated when it changes.
 */
const DEFAULT_PROJECTION_HORIZON = 5;

const initialState = {
  loading: false,
  error: null,
  teamId: getTeamId(),
  players: [],
  teamsById: {},
  currentGw: null,
  planningGw: null,
  events: [],
  fixtures: [],          // raw fixtures array, needed for PPDU calculation
  elementTypes: [],
  gameSettings: null,
  entry: null,
  picks: null,
  lastUpdated: getLastUpdated(),
  projectionHorizon: DEFAULT_PROJECTION_HORIZON,
  completedGws: 0, // stored so we can recalculate projections on horizon change
};

function fplReducer(state, action) {
  switch (action.type) {
    // Started fetching data
    case "LOADING":
      return { ...state, loading: true, error: null };

    // Data fetched and transformed successfully
    case "DATA_LOADED":
      return {
        ...state,
        loading: false,
        error: null,
        players: action.payload.players,
        teamsById: action.payload.teamsById,
        currentGw: action.payload.currentGw,
        planningGw: action.payload.planningGw,
        events: action.payload.events,
        fixtures: action.payload.fixtures,
        elementTypes: action.payload.elementTypes,
        gameSettings: action.payload.gameSettings,
        entry: action.payload.entry,
        picks: action.payload.picks,
        completedGws: action.payload.completedGws,
        lastUpdated: new Date().toISOString(),
      };

    // Something went wrong during fetch
    case "ERROR":
      return { ...state, loading: false, error: action.payload };

    // User entered/changed their team ID
    case "SET_TEAM_ID":
      return { ...state, teamId: action.payload };

    // User changed the projection horizon (number of GWs to project over).
    // Recalculates projected points and blend scores for all players.
    case "SET_PROJECTION_HORIZON": {
      const newHorizon = action.payload;
      const updatedPlayers = calculateProjectedPoints(
        state.players,
        newHorizon,
        state.completedGws
      );
      // Recalculate blend with the new projections (global normalisation)
      const blendedPlayers = calculateGlobalBlendedScores(updatedPlayers);
      return {
        ...state,
        projectionHorizon: newHorizon,
        players: blendedPlayers,
      };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Provider component
// ---------------------------------------------------------------------------

/**
 * FplProvider wraps the entire app and makes FPL data available
 * to all child components via the useFpl() hook.
 */
export function FplProvider({ children }) {
  const [state, dispatch] = useReducer(fplReducer, initialState);

  /**
   * Load all data from the FPL API.
   * This is the main "fetch everything" function.
   *
   * Steps:
   * 1. Fetch raw data from all endpoints (with caching)
   * 2. Transform/normalise the data (parse strings, map teams, etc.)
   * 3. Calculate composite scores for every player
   * 4. Calculate projected points over the configured horizon
   * 5. Calculate blended scores globally (stable across all views)
   * 6. Store everything in state
   *
   * @param {boolean} forceRefresh - If true, skip cache and re-fetch
   */
  const loadData = useCallback(
    async (forceRefresh = false) => {
      const teamId = state.teamId;
      if (!teamId) {
        dispatch({ type: "ERROR", payload: "No team ID set. Enter your FPL team ID to get started." });
        return;
      }

      dispatch({ type: "LOADING" });

      try {
        // Step 1: Fetch raw data
        // We need to figure out the current GW first from bootstrap.
        // But loadAllData needs it too. So we do a two-pass:
        // first get bootstrap to find currentGw, then get picks for that GW.
        const raw = await loadAllData(teamId, 0, forceRefresh);

        // Step 2: Transform -- parse strings, build lookups, enrich players
        const transformed = transformAll(raw.bootstrap, raw.fixtures);

        // Now re-fetch picks for the actual current GW if needed.
        // The initial loadAllData call passed GW 0, so picks is usually null
        // here. We try the current GW first (available once its deadline has
        // passed), then fall back to the previous GW if that fails.
        let picks = raw.picks;
        if (!picks && transformed.currentGw >= 1) {
          const { fetchPicks } = await import("../api/fplApi.js");

          // Try current GW first -- FPL serves picks as soon as the deadline locks
          try {
            picks = await fetchPicks(teamId, transformed.currentGw, forceRefresh);
          } catch {
            // Current GW picks not available (e.g. deadline hasn't passed yet).
            // Fall back to the most recently completed GW so the squad still shows.
            const completedGw = transformed.currentGw - 1;
            if (completedGw >= 1) {
              try {
                picks = await fetchPicks(teamId, completedGw, forceRefresh);
              } catch {
                // Picks not available for either GW -- that's fine
              }
            }
          }
        }

        // Step 3: Calculate composite scores
        // Count completed gameweeks for the early-season discount
        const completedGws = transformed.events.filter((e) => e.finished).length;
        const scoredPlayers = calculateCompositeScores(
          transformed.players,
          completedGws
        );

        // Step 4: Calculate projected points over the configured horizon.
        // This runs AFTER composite scoring so both metrics coexist on each player.
        const projectedPlayers = calculateProjectedPoints(
          scoredPlayers,
          state.projectionHorizon,
          completedGws
        );

        // Step 5: Calculate blended scores using position-group normalisation.
        // Projected points are normalised within each position group (GKP,
        // DEF, MID, FWD) to match how composite scores are already normalised.
        // This ensures blend is fair across positions and stable across views.
        const blendedPlayers = calculateGlobalBlendedScores(projectedPlayers);

        // Step 6: Attach captaincy scores to every player.
        // calculateCaptaincyScores returns a sorted subset; we merge its
        // captaincyScore back onto the full player array so snapshots can
        // capture it alongside composite/blend/projected.
        const { allScored: captainResults } = calculateCaptaincyScores(
          blendedPlayers,
          { squadOnly: false },
          null
        );
        // Build a quick lookup by ID for all scored players
        const capMap = {};
        for (const c of captainResults) {
          capMap[c.id] = c.captaincyScore;
        }
        const playersWithCaptaincy = blendedPlayers.map((p) => ({
          ...p,
          captaincyScore: capMap[p.id] ?? null,
        }));

        // Step 7: Fetch live GW points and merge onto players.
        // Uses currentGw (the active/in-progress GW) since we want to show
        // how players are scoring RIGHT NOW, not in a future GW.
        // Non-blocking: if the fetch fails, players just won't have gwPoints.
        const livePointsMap = await fetchLivePoints(transformed.currentGw);
        const playersWithGwPoints = mergeLivePoints(playersWithCaptaincy, livePointsMap);

        // Step 8: Snapshot capture -- if the current GW's deadline has passed,
        // capture predictions for accuracy tracking. Also auto-complete any
        // previously captured snapshots whose GW has since finished.
        const currentEvent = transformed.events.find((e) => e.is_current);
        const deadlinePassed = currentEvent
          ? new Date() >= new Date(currentEvent.deadline_time)
          : false;
        captureSnapshotIfNeeded(
          transformed.currentGw,
          deadlinePassed,
          playersWithGwPoints,
          picks
        );
        // Auto-complete snapshots for finished GWs and backfill any
        // legacy snapshots missing squadPlayerIds (non-blocking)
        autoCompleteSnapshots(transformed.events, teamId).catch(() => {});

        // Save raw bootstrap + fixtures to IndexedDB for future backtesting.
        // Runs alongside snapshot capture -- same "once per GW" timing.
        // Non-blocking: backtest data is a bonus, not critical path.
        if (deadlinePassed) {
          saveBacktestData(transformed.currentGw, raw.bootstrap, raw.fixtures).catch(() => {});
        }

        // Step 9: Dispatch everything to state
        dispatch({
          type: "DATA_LOADED",
          payload: {
            players: playersWithGwPoints,
            teamsById: transformed.teamsById,
            currentGw: transformed.currentGw,
            planningGw: transformed.planningGw,
            events: transformed.events,
            fixtures: raw.fixtures,
            elementTypes: transformed.elementTypes,
            gameSettings: transformed.gameSettings,
            entry: raw.entry,
            picks,
            completedGws,
          },
        });
      } catch (err) {
        console.error("[FplContext] Data load failed:", err);
        dispatch({ type: "ERROR", payload: err.message });
      }
    },
    [state.teamId]
  );

  /**
   * Set the user's FPL team ID and save it to localStorage.
   * @param {string} id - The team ID
   */
  const setTeamId = useCallback((id) => {
    saveTeamId(id);
    dispatch({ type: "SET_TEAM_ID", payload: id });
  }, []);

  /**
   * Change the projection horizon (number of GWs to project over).
   * Triggers an immediate recalculation of projected points for all players.
   * @param {number} horizon - Number of gameweeks (1 to 10)
   */
  const setProjectionHorizon = useCallback((horizon) => {
    dispatch({ type: "SET_PROJECTION_HORIZON", payload: horizon });
  }, []);

  // Bundle everything into a single value object for the context
  const value = {
    ...state,
    loadData,
    setTeamId,
    setProjectionHorizon,
  };

  return <FplContext.Provider value={value}>{children}</FplContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook for consuming components
// ---------------------------------------------------------------------------

/**
 * Custom hook to access FPL data from any component.
 * Usage: const { players, loading, loadData } = useFpl();
 */
export function useFpl() {
  const context = useContext(FplContext);
  if (!context) {
    throw new Error("useFpl() must be used within an <FplProvider>");
  }
  return context;
}
