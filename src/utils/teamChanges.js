/**
 * teamChanges.js -- Fetch auto-subs and transfers for a manager's GW
 *
 * Provides two pieces of data for the Dashboard:
 *
 * 1. Auto-subs: Which players were automatically substituted by FPL
 *    after a starting player didn't play. Comes from the picks endpoint's
 *    `automatic_subs` array.
 *
 * 2. Transfers: Which players were brought in/out for a given GW,
 *    including any point hits. Comes from the transfers endpoint,
 *    filtered to the target GW.
 *
 * Both are fetched via the Vite proxy (/api -> fantasy.premierleague.com).
 */

// ---------------------------------------------------------------------------
// Fetch auto-subs from the picks endpoint
// ---------------------------------------------------------------------------

/**
 * Fetch the automatic substitutions for a manager in a given GW.
 *
 * The picks endpoint returns { picks, automatic_subs, entry_history, active_chip }.
 * We extract `automatic_subs` which is an array of:
 *   { entry, element_in, element_out, event }
 *
 * We also extract `entry_history` which contains `event_transfers_cost`
 * (total hit points for this GW, e.g. 4 means a -4 hit).
 *
 * @param {number|string} teamId - The manager's FPL team ID
 * @param {number} gw - The gameweek number
 * @param {Array} players - Full players array (to resolve names from IDs)
 * @returns {Object} - { autoSubs: [{ playerIn, playerOut }], chip, transfersCost }
 *   where playerIn/playerOut are enriched with name/position/team info.
 *   Returns { autoSubs: [], chip: null, transfersCost: 0 } on failure.
 */
export async function fetchAutoSubs(teamId, gw, players) {
  try {
    const res = await fetch(`/api/entry/${teamId}/event/${gw}/picks/`);
    if (!res.ok) return { autoSubs: [], chip: null, transfersCost: 0 };

    const data = await res.json();
    const subs = data.automatic_subs || [];

    // Build a quick player lookup by ID for name resolution
    const playerMap = {};
    for (const p of players) {
      playerMap[p.id] = p;
    }

    // Enrich each auto-sub with player details
    const autoSubs = subs.map((sub) => ({
      playerIn: playerMap[sub.element_in] || { web_name: `ID ${sub.element_in}`, position_name: "???" },
      playerOut: playerMap[sub.element_out] || { web_name: `ID ${sub.element_out}`, position_name: "???" },
    }));

    return {
      autoSubs,
      chip: data.active_chip || null,
      transfersCost: data.entry_history?.event_transfers_cost || 0,
    };
  } catch (err) {
    console.warn("[teamChanges] Failed to fetch auto-subs:", err.message);
    return { autoSubs: [], chip: null, transfersCost: 0 };
  }
}

// ---------------------------------------------------------------------------
// Fetch transfers for a given GW
// ---------------------------------------------------------------------------

/**
 * Fetch all transfers a manager has made, filtered to a specific GW.
 *
 * The transfers endpoint returns the full season's transfer history.
 * Each transfer object has:
 *   { element_in, element_in_cost, element_out, element_out_cost, event, time }
 *
 * We filter to the requested GW and enrich with player details.
 *
 * @param {number|string} teamId - The manager's FPL team ID
 * @param {number} gw - The gameweek number to filter to
 * @param {Array} players - Full players array (to resolve names from IDs)
 * @returns {Array} - Enriched transfer objects:
 *   [{ playerIn, playerOut, costIn, costOut, time }]
 *   where playerIn/playerOut have name/position/team info.
 *   Returns [] on failure.
 */
export async function fetchGwTransfers(teamId, gw, players) {
  try {
    const res = await fetch(`/api/entry/${teamId}/transfers/`);
    if (!res.ok) return [];

    const allTransfers = await res.json();

    // Filter to the requested GW
    const gwTransfers = allTransfers.filter((t) => t.event === gw);

    // Build a quick player lookup by ID for name resolution
    const playerMap = {};
    for (const p of players) {
      playerMap[p.id] = p;
    }

    // Enrich each transfer with player details and format costs
    return gwTransfers.map((t) => ({
      playerIn: playerMap[t.element_in] || { web_name: `ID ${t.element_in}`, position_name: "???", team_name: "???" },
      playerOut: playerMap[t.element_out] || { web_name: `ID ${t.element_out}`, position_name: "???", team_name: "???" },
      // Costs are in tenths (e.g. 55 = 5.5m)
      costIn: t.element_in_cost / 10,
      costOut: t.element_out_cost / 10,
      time: t.time,
    }));
  } catch (err) {
    console.warn("[teamChanges] Failed to fetch transfers:", err.message);
    return [];
  }
}
