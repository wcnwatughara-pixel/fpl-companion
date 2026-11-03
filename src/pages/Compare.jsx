/**
 * Compare.jsx -- Player Comparison page
 *
 * Lets the user search for and select 2-4 players to compare side by side.
 * Features:
 * - Autocomplete search by player name
 * - Position, team, and price filters
 * - Comparison table showing all key stats
 * - "Add to Wildcard" button to jump to the Wildcard Planner
 *
 * If the user arrives via clicking a player on the Dashboard, that
 * player's ID is in the URL query string and gets pre-selected.
 */

import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useFpl } from "../context/FplContext.jsx";
import ComparisonTable from "../components/ComparisonTable.jsx";
import { formatPrice } from "../utils/formatters.js";

export default function Compare() {
  const { players } = useFpl();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Currently selected players for comparison (max 4)
  const [selectedIds, setSelectedIds] = useState([]);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [positionFilter, setPositionFilter] = useState("All");
  const [teamFilter, setTeamFilter] = useState("All");
  const [maxPrice, setMaxPrice] = useState(15);
  const [showDropdown, setShowDropdown] = useState(false);

  // If we arrived from Dashboard with a pre-selected player
  useEffect(() => {
    const preselected = searchParams.get("player");
    if (preselected) {
      const id = parseInt(preselected);
      if (id && !selectedIds.includes(id)) {
        setSelectedIds((prev) => [...prev, id]);
      }
    }
    // Run only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build list of unique team names for the filter dropdown
  const teamNames = useMemo(() => {
    const names = [...new Set(players.map((p) => p.team_name))];
    return names.sort();
  }, [players]);

  // Filter the player list based on search query and filters
  const filteredPlayers = useMemo(() => {
    return players.filter((p) => {
      // Position filter
      if (positionFilter !== "All" && p.position_name !== positionFilter) return false;
      // Team filter
      if (teamFilter !== "All" && p.team_name !== teamFilter) return false;
      // Price filter
      if (p.price > maxPrice) return false;
      // Search query (match against web_name, first_name, second_name)
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const nameMatch =
          p.web_name.toLowerCase().includes(query) ||
          (p.first_name && p.first_name.toLowerCase().includes(query)) ||
          (p.second_name && p.second_name.toLowerCase().includes(query));
        if (!nameMatch) return false;
      }
      return true;
    });
  }, [players, searchQuery, positionFilter, teamFilter, maxPrice]);

  // The actual selected player objects
  const selectedPlayers = useMemo(() => {
    return selectedIds
      .map((id) => players.find((p) => p.id === id))
      .filter(Boolean);
  }, [selectedIds, players]);

  /**
   * Add a player to the comparison (max 4).
   */
  const addPlayer = (player) => {
    if (selectedIds.length >= 4) return; // max 4
    if (selectedIds.includes(player.id)) return; // already selected
    setSelectedIds((prev) => [...prev, player.id]);
    setSearchQuery("");
    setShowDropdown(false);
  };

  /**
   * Remove a player from the comparison.
   */
  const removePlayer = (playerId) => {
    setSelectedIds((prev) => prev.filter((id) => id !== playerId));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Player Comparison</h1>

      {/* Search and filters */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Search input with autocomplete */}
        <div className="relative flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-400 mb-1">Search Player</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Type a player name..."
            className="w-full px-3 py-2 bg-[#111] border border-[#333] rounded-lg text-sm focus:outline-none focus:border-[#555]"
            disabled={selectedIds.length >= 4}
          />
          {/* Autocomplete dropdown */}
          {showDropdown && searchQuery.length >= 2 && (
            <div className="absolute z-20 w-full mt-1 bg-[#1a1a1a] border border-[#333] rounded-lg max-h-48 overflow-y-auto">
              {filteredPlayers.slice(0, 10).map((player) => (
                <div
                  key={player.id}
                  onClick={() => addPlayer(player)}
                  className="px-3 py-2 hover:bg-[#252525] cursor-pointer flex justify-between items-center"
                >
                  <span className="text-sm">
                    {player.web_name}
                    <span className="text-gray-500 ml-2 text-xs">
                      {player.team_name} | {player.position_name}
                    </span>
                  </span>
                  <span className="text-xs text-gray-400 tabular-nums">
                    {formatPrice(player.price)}m
                  </span>
                </div>
              ))}
              {filteredPlayers.length === 0 && (
                <div className="px-3 py-2 text-gray-500 text-sm">No players found</div>
              )}
            </div>
          )}
        </div>

        {/* Position filter */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Position</label>
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="px-3 py-2 bg-[#111] border border-[#333] rounded-lg text-sm"
          >
            <option value="All">All</option>
            <option value="GKP">GKP</option>
            <option value="DEF">DEF</option>
            <option value="MID">MID</option>
            <option value="FWD">FWD</option>
          </select>
        </div>

        {/* Team filter */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Team</label>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="px-3 py-2 bg-[#111] border border-[#333] rounded-lg text-sm"
          >
            <option value="All">All</option>
            {teamNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        {/* Price filter */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Max Price: {maxPrice.toFixed(1)}m
          </label>
          <input
            type="range"
            min="3.5"
            max="15"
            step="0.5"
            value={maxPrice}
            onChange={(e) => setMaxPrice(parseFloat(e.target.value))}
            className="w-24"
          />
        </div>
      </div>

      {/* Click outside dropdown to close */}
      {showDropdown && (
        <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
      )}

      {/* Selected players count */}
      <div className="text-xs text-gray-500">
        {selectedIds.length}/4 players selected
      </div>

      {/* Comparison table */}
      <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111", border: "1px solid #222" }}>
        <ComparisonTable players={selectedPlayers} onRemovePlayer={removePlayer} />
      </div>
    </div>
  );
}
