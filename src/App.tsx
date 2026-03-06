import React, { useState, useEffect } from "react";
import "./App.css";
import { tables, reducers } from "./module_bindings";
import { useSpacetimeDB, useTable, useReducer } from "spacetimedb/react";
import { GalaxyMap } from "./GalaxyMap";
import { SolarSystemView } from "./SolarSystemView";
import { Identity } from "spacetimedb";
import type { AuthContextProps } from "react-oidc-context";

// ─── Constants (mirrors server) ───────────────────────────────────────────────

const EXPLORER_COST_IRON = 300;
const EXPLORER_COST_PLASMA = 150;
const EXPLORER_COST_CRYSTALS = 100;

const BUILDING_TYPES = [
  "iron_mine",
  "plasma_extractor",
  "crystal_farm",
  "shipyard",
  "research_lab",
] as const;

type BuildingType = (typeof BUILDING_TYPES)[number];

const DISPLAY_NAMES: Record<BuildingType, string> = {
  iron_mine: "Iron Mine",
  plasma_extractor: "Plasma Extractor",
  crystal_farm: "Crystal Farm",
  shipyard: "Shipyard",
  research_lab: "Research Lab",
};

const BASE_COSTS: Record<BuildingType, [number, number, number]> = {
  iron_mine: [60, 15, 0],
  plasma_extractor: [0, 40, 30],
  crystal_farm: [20, 0, 40],
  shipyard: [400, 200, 100],
  research_lab: [200, 100, 150],
};

const BASE_BUILD_TIME_S: Record<BuildingType, number> = {
  iron_mine: 30,
  plasma_extractor: 60,
  crystal_farm: 45,
  shipyard: 120,
  research_lab: 90,
};

function buildingCost(
  type: BuildingType,
  targetLevel: number,
): [number, number, number] {
  const base = BASE_COSTS[type];
  const factor = Math.pow(1.5, targetLevel - 1);
  return [
    Math.floor(base[0] * factor),
    Math.floor(base[1] * factor),
    Math.floor(base[2] * factor),
  ];
}

function buildTimeSec(type: BuildingType, targetLevel: number): number {
  return Math.floor(BASE_BUILD_TIME_S[type] * Math.pow(2, targetLevel - 1));
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Build Queue Countdown ────────────────────────────────────────────────────

function useCountdown(finishMs: number | null): number {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (finishMs === null) return;
    const update = () =>
      setRemaining(Math.max(0, Math.floor((finishMs - Date.now()) / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [finishMs]);
  return remaining;
}

// ─── App ──────────────────────────────────────────────────────────────────────

type View = "galaxy" | "system" | "base";

interface AppProps {
  oidcAuth?: AuthContextProps | null;
}

function App({ oidcAuth }: AppProps) {
  const { identity, isActive: connected } = useSpacetimeDB();
  const setName = useReducer(reducers.setName);
  const setPlanetName = useReducer(reducers.setPlanetName);
  const upgradeBuilding = useReducer(reducers.upgradeBuilding);
  const cancelBuild = useReducer(reducers.cancelBuild);

  const [players] = useTable(tables.player);
  const [planets] = useTable(tables.planet);
  const [buildings] = useTable(tables.building);
  const [buildQueues] = useTable(tables.build_queue);

  const buildShip = useReducer(reducers.buildShip);
  const sendFleet = useReducer(reducers.sendFleet);

  const [fleets] = useTable(tables.fleet);
  const [fleetMissions] = useTable(tables.fleet_mission);
  const [returnMissions] = useTable(tables.return_mission);
  const [expeditionLogs] = useTable(tables.expedition_log);

  const [view, setView] = useState<View>("galaxy");
  const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);
  const [fleetMode, setFleetMode] = useState(false);

  const [editingPlayerName, setEditingPlayerName] = useState(false);
  const [playerNameInput, setPlayerNameInput] = useState("");
  const [editingPlanetName, setEditingPlanetName] = useState(false);
  const [planetNameInput, setPlanetNameInput] = useState("");
  const [planetNameError, setPlanetNameError] = useState("");

  if (!connected || !identity) {
    return (
      <div className="App">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            color: "#ccc",
          }}
        >
          Connecting to server…
        </div>
      </div>
    );
  }

  const player = players.find((p) => p.identity.isEqual(identity));
  const planet =
    player?.planetId != null
      ? planets.find((p) => p.id === player.planetId)
      : undefined;
  const myBuildings = planet
    ? buildings.filter((b) => b.planetId === planet.id)
    : [];
  const activeJob = planet
    ? buildQueues.find((q) => q.planetId === planet.id)
    : undefined;

  const myFleet = identity
    ? fleets.find((f) => f.ownerId.isEqual(identity))
    : undefined;
  const myMissions = identity
    ? fleetMissions.filter((m) => m.ownerId.isEqual(identity))
    : [];
  const myReturnMissions = identity
    ? returnMissions.filter((m) => m.ownerId.isEqual(identity))
    : [];
  const myExpeditionLogs = identity
    ? expeditionLogs.filter((l) => l.ownerId.isEqual(identity))
    : [];

  return (
    <div
      className="App"
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "1.5rem",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ marginBottom: "0.75rem", color: "#e0e0e0" }}>
        🚀 Space Colony
      </h1>

      <nav style={navStyle}>
        <button
          style={view === "galaxy" ? navBtnActiveStyle : navBtnStyle}
          onClick={() => setView("galaxy")}
        >
          Galaxy
        </button>
        {view !== "galaxy" && selectedSystemId !== null && (
          <button
            style={view === "system" ? navBtnActiveStyle : navBtnStyle}
            onClick={() => setView("system")}
          >
            › System {selectedSystemId}
          </button>
        )}
        {view === "base" && <button style={navBtnActiveStyle}>› Base</button>}

        {planet != null && (
          <button
            style={{
              ...navBtnStyle,
              marginLeft: "auto",
              color: view === "base" ? "#7fc8ff" : "#7fc8ff99",
              background: view === "base" ? "#1a2a3a" : "transparent",
              border: "1px solid #2a3a4a",
              borderRadius: 6,
            }}
            onClick={() => setView("base")}
          >
            🏠 {planet.name ?? "My Colony"}
          </button>
        )}
      </nav>
      {view === "galaxy" && (
        <GalaxyMap
          myIdentity={identity ?? undefined}
          onSelectSystem={(id) => {
            setSelectedSystemId(id);
            setView("system");
          }}
        />
      )}

      {view === "system" && selectedSystemId !== null && (
        <SolarSystemView
          systemId={selectedSystemId}
          myIdentity={identity ?? undefined}
          onEnterPlanet={(_planetId) => {
            setFleetMode(false);
            setView("base");
          }}
          onBack={() => {
            setFleetMode(false);
            setView("galaxy");
          }}
          onSendFleet={
            fleetMode && planet
              ? (targetPlanetId) => {
                  sendFleet({
                    sourcePlanetId: planet.id,
                    targetPlanetId,
                  });
                  setFleetMode(false);
                  setView("base");
                }
              : undefined
          }
          sourcePlanetId={fleetMode && planet ? planet.id : undefined}
        />
      )}

      {view === "base" && (
        <div
          style={{
            maxWidth: 900,
            fontFamily: "sans-serif",
          }}
        >
          <section style={sectionStyle}>
            <h2 style={sectionHeader}>Commander</h2>
            {editingPlayerName ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setName({ name: playerNameInput });
                  setEditingPlayerName(false);
                }}
                style={{ display: "flex", gap: 8 }}
              >
                <input
                  autoFocus
                  value={playerNameInput}
                  onChange={(e) => setPlayerNameInput(e.target.value)}
                  style={inputStyle}
                  placeholder="Enter name"
                />
                <button type="submit" style={btnStyle}>
                  Save
                </button>
                <button
                  type="button"
                  style={{ ...btnStyle, background: "#555" }}
                  onClick={() => setEditingPlayerName(false)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: "1.1rem", color: "#fff" }}>
                  {player?.name ?? (
                    <span style={{ color: "#888" }}>(no name)</span>
                  )}
                </span>
                <button
                  style={btnSmallStyle}
                  onClick={() => {
                    setPlayerNameInput(player?.name ?? "");
                    setEditingPlayerName(true);
                  }}
                >
                  ✏️ Rename
                </button>
                {oidcAuth && (
                  oidcAuth.isAuthenticated
                    ? <button
                        style={{ ...btnSmallStyle, background: "#3a2a4a" }}
                        onClick={() => oidcAuth.signoutRedirect()}
                      >
                        Sign Out
                      </button>
                    : <button
                        style={{ ...btnSmallStyle, background: "#1a3a5a" }}
                        onClick={() => oidcAuth.signinRedirect()}
                      >
                        Sign In
                      </button>
                )}
              </div>
            )}
            <div style={{ marginTop: 6, color: "#888", fontSize: "0.8rem" }}>
              ID: {identity?.toHexString().substring(0, 16)}…
            </div>
          </section>

          {!planet ? (
            <section style={sectionStyle}>
              <p style={{ color: "#aaa" }}>Waiting for planet assignment…</p>
            </section>
          ) : (
            <>
              {/* Planet */}
              <section style={sectionStyle}>
                <h2 style={sectionHeader}>
                  Planet
                  {editingPlanetName ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        setPlanetNameError("");
                        setPlanetName({
                          planetId: planet.id,
                          name: planetNameInput,
                        }).then(() => {
                          setEditingPlanetName(false);
                        }).catch((err: unknown) => {
                          setPlanetNameError(err instanceof Error ? err.message : String(err));
                        });
                      }}
                      style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, marginLeft: 12, alignItems: "center" }}
                    >
                      <input
                        autoFocus
                        value={planetNameInput}
                        onChange={(e) => { setPlanetNameInput(e.target.value); setPlanetNameError(""); }}
                        style={{
                          ...inputStyle,
                          fontSize: "0.9rem",
                          padding: "2px 8px",
                          borderColor: planetNameError ? "#f66" : undefined,
                        }}
                        placeholder="Planet name"
                      />
                      <button type="submit" style={btnSmallStyle}>
                        Save
                      </button>
                      <button
                        type="button"
                        style={{ ...btnSmallStyle, background: "#555" }}
                        onClick={() => { setEditingPlanetName(false); setPlanetNameError(""); }}
                      >
                        ✕
                      </button>
                      {planetNameError && (
                        <span style={{ color: "#f66", fontSize: "0.75rem", width: "100%", marginTop: 2 }}>
                          {planetNameError}
                        </span>
                      )}
                    </form>
                  ) : (
                    <>
                      <span
                        style={{
                          marginLeft: 12,
                          color: "#fff",
                          fontWeight: "normal",
                        }}
                      >
                        {planet.name ?? (
                          <span style={{ color: "#888" }}>(unnamed)</span>
                        )}
                      </span>
                      <button
                        style={{ ...btnSmallStyle, marginLeft: 8 }}
                        onClick={() => {
                          setPlanetNameInput(planet.name ?? "");
                          setEditingPlanetName(true);
                        }}
                      >
                        ✏️
                      </button>
                    </>
                  )}
                </h2>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 12,
                    marginTop: 8,
                  }}
                >
                  <ResourceCard icon="⚙️" label="Iron" value={planet.iron} />
                  <ResourceCard
                    icon="⚡"
                    label="Plasma"
                    value={planet.plasma}
                  />
                  <ResourceCard
                    icon="💎"
                    label="Crystals"
                    value={planet.crystals}
                  />
                </div>

                <div
                  style={{ marginTop: 8, color: "#666", fontSize: "0.75rem" }}
                >
                  System {planet.systemId} · Slot {planet.slotIndex}
                </div>
              </section>

              {/* Build Queue */}
              {activeJob && (
                <section style={sectionStyle}>
                  <h2 style={sectionHeader}>Build Queue</h2>
                  <BuildQueueRow
                    job={activeJob}
                    planet={planet}
                    onCancel={() => cancelBuild({ planetId: planet.id })}
                  />
                </section>
              )}

              {/* Fleet Missions */}
              {(myMissions.length > 0 || myReturnMissions.length > 0) && (
                <section style={sectionStyle}>
                  <h2 style={sectionHeader}>Fleet Missions</h2>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {myMissions.map((mission) => (
                      <MissionRow
                        key={`out-${mission.scheduledId.toString()}`}
                        kind="outbound"
                        scheduledAt={mission.scheduledAt}
                        planets={planets}
                        targetPlanetId={mission.targetPlanetId}
                      />
                    ))}
                    {myReturnMissions.map((mission) => (
                      <MissionRow
                        key={`ret-${mission.scheduledId.toString()}`}
                        kind="return"
                        scheduledAt={mission.scheduledAt}
                        resultType={mission.resultType}
                        lootIron={mission.lootIron}
                        lootPlasma={mission.lootPlasma}
                        lootCrystals={mission.lootCrystals}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Expedition Log */}
              {myExpeditionLogs.length > 0 && (
                <section style={sectionStyle}>
                  <h2 style={sectionHeader}>Expedition Log</h2>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    {[...myExpeditionLogs]
                      .sort((a, b) =>
                        Number(
                          b.completedAt.microsSinceUnixEpoch -
                            a.completedAt.microsSinceUnixEpoch,
                        ),
                      )
                      .slice(0, 10)
                      .map((log) => (
                        <ExpeditionLogRow key={log.id.toString()} log={log} />
                      ))}
                  </div>
                </section>
              )}

              {/* Buildings */}
              <section style={sectionStyle}>
                <h2 style={sectionHeader}>Buildings</h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: 12,
                    marginTop: 8,
                  }}
                >
                  {BUILDING_TYPES.map((type) => {
                    const building = myBuildings.find(
                      (b) => b.buildingType === type,
                    );
                    const currentLevel = building?.level ?? 0;
                    const targetLevel = currentLevel + 1;
                    const [costIron, costPlasma, costCrystals] = buildingCost(
                      type,
                      targetLevel,
                    );
                    const buildSec = buildTimeSec(type, targetLevel);
                    const canAfford =
                      planet.iron >= costIron &&
                      planet.plasma >= costPlasma &&
                      planet.crystals >= costCrystals;
                    const isBusy = !!activeJob;

                    if (type === "shipyard") {
                      const canAffordShip =
                        planet.iron >= EXPLORER_COST_IRON &&
                        planet.plasma >= EXPLORER_COST_PLASMA &&
                        planet.crystals >= EXPLORER_COST_CRYSTALS;
                      return (
                        <ShipyardPanel
                          key={type}
                          level={currentLevel}
                          planet={planet}
                          myFleet={myFleet}
                          myMissions={myMissions}
                          myReturnMissions={myReturnMissions}
                          canAffordShip={canAffordShip}
                          isBusy={isBusy}
                          canAffordUpgrade={canAfford}
                          targetLevel={targetLevel}
                          costIron={costIron}
                          costPlasma={costPlasma}
                          costCrystals={costCrystals}
                          buildSec={buildSec}
                          onBuildShip={() => buildShip({ planetId: planet.id })}
                          onUpgrade={() =>
                            upgradeBuilding({
                              planetId: planet.id,
                              buildingType: type,
                            })
                          }
                          onSendFleet={() => {
                            setSelectedSystemId(planet.systemId);
                            setFleetMode(true);
                            setView("system");
                          }}
                        />
                      );
                    }

                    return (
                      <BuildingCard
                        key={type}
                        type={type}
                        level={currentLevel}
                        targetLevel={targetLevel}
                        costIron={costIron}
                        costPlasma={costPlasma}
                        costCrystals={costCrystals}
                        buildSec={buildSec}
                        canAfford={canAfford}
                        isBusy={isBusy}
                        onUpgrade={() =>
                          upgradeBuilding({
                            planetId: planet.id,
                            buildingType: type,
                          })
                        }
                      />
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ResourceCard({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: number;
}) {
  return (
    <div
      style={{
        background: "#2a2a3a",
        borderRadius: 8,
        padding: "12px 16px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.4rem" }}>{icon}</div>
      <div style={{ color: "#aaa", fontSize: "0.75rem", marginTop: 2 }}>
        {label}
      </div>
      <div
        style={{
          color: "#fff",
          fontWeight: "bold",
          fontSize: "1.1rem",
          marginTop: 4,
        }}
      >
        {Math.floor(value).toLocaleString()}
      </div>
    </div>
  );
}

type BuildQueueJob = {
  scheduledId: bigint;
  scheduledAt:
    | { tag: string; value: { microsSinceUnixEpoch: bigint } }
    | unknown;
  planetId: bigint;
  buildingType: string;
  targetLevel: number;
};
type PlanetRow = {
  id: bigint;
  systemId: number;
  slotIndex: number;
  iron: number;
  plasma: number;
  crystals: number;
  name?: string | null | undefined;
  [k: string]: unknown;
};

function BuildQueueRow({
  job,
  planet,
  onCancel,
}: {
  job: BuildQueueJob;
  planet: PlanetRow;
  onCancel: () => void;
}) {
  const finishMs = (() => {
    const sa = job.scheduledAt as {
      tag: string;
      value: { microsSinceUnixEpoch: bigint };
    };
    if (sa?.tag === "Time" && sa.value?.microsSinceUnixEpoch != null) {
      return Number(sa.value.microsSinceUnixEpoch / 1000n);
    }
    return null;
  })();

  const remaining = useCountdown(finishMs);
  const type = job.buildingType as BuildingType;
  const [costIron, costPlasma, costCrystals] = buildingCost(
    type,
    job.targetLevel,
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#1e3a2a",
        borderRadius: 8,
        padding: "10px 16px",
      }}
    >
      <div>
        <div style={{ color: "#7fff7f", fontWeight: "bold" }}>
          {DISPLAY_NAMES[type] ?? type} → Level {job.targetLevel}
        </div>
        <div style={{ color: "#aaa", fontSize: "0.8rem", marginTop: 2 }}>
          Finishes in:{" "}
          <strong style={{ color: "#fff" }}>{formatDuration(remaining)}</strong>
        </div>
      </div>
      <button
        style={{ ...btnSmallStyle, background: "#7a2020" }}
        onClick={onCancel}
        title={`Refund: ${costIron}⚙️ ${costPlasma}⚡ ${costCrystals}💎`}
      >
        Cancel (refund)
      </button>
    </div>
  );
}

function BuildingCard({
  type,
  level,
  targetLevel,
  costIron,
  costPlasma,
  costCrystals,
  buildSec,
  canAfford,
  isBusy,
  onUpgrade,
}: {
  type: BuildingType;
  level: number;
  targetLevel: number;
  costIron: number;
  costPlasma: number;
  costCrystals: number;
  buildSec: number;
  canAfford: boolean;
  isBusy: boolean;
  onUpgrade: () => void;
}) {
  const disabled = isBusy || !canAfford;
  return (
    <div
      style={{
        background: "#1e2030",
        borderRadius: 8,
        padding: "14px 16px",
        border: "1px solid #333",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span style={{ fontWeight: "bold", color: "#e0e0e0" }}>
          {DISPLAY_NAMES[type]}
        </span>
        <span style={{ color: "#888", fontSize: "0.85rem" }}>
          Level {level}
        </span>
      </div>

      <div style={{ marginTop: 8, fontSize: "0.78rem", color: "#999" }}>
        <span>⏱ {formatDuration(buildSec)}</span>
        <span style={{ marginLeft: 12, color: costIron > 0 ? "#fff" : "#555" }}>
          ⚙️ {costIron}
        </span>
        <span
          style={{ marginLeft: 8, color: costPlasma > 0 ? "#fff" : "#555" }}
        >
          ⚡ {costPlasma}
        </span>
        <span
          style={{ marginLeft: 8, color: costCrystals > 0 ? "#fff" : "#555" }}
        >
          💎 {costCrystals}
        </span>
      </div>

      <button
        style={{
          ...btnStyle,
          marginTop: 10,
          width: "100%",
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
          background: !canAfford ? "#4a2a2a" : isBusy ? "#2a3a4a" : "#1a4a2a",
        }}
        disabled={disabled}
        onClick={onUpgrade}
        title={
          isBusy
            ? "Build queue is busy"
            : !canAfford
              ? "Not enough resources"
              : `Upgrade to Level ${targetLevel}`
        }
      >
        {isBusy
          ? "Queue busy"
          : !canAfford
            ? "Need more resources"
            : `Upgrade → Lv ${targetLevel}`}
      </button>
    </div>
  );
}

type FleetRow = { ownerId: unknown; explorerCount: number };
type FleetMissionRow = {
  scheduledId: bigint;
  scheduledAt:
    | { tag: string; value: { microsSinceUnixEpoch: bigint } }
    | unknown;
  ownerId: unknown;
  sourcePlanetId: bigint;
  targetPlanetId: bigint;
};
type ReturnMissionRow = {
  scheduledId: bigint;
  scheduledAt:
    | { tag: string; value: { microsSinceUnixEpoch: bigint } }
    | unknown;
  ownerId: unknown;
  homePlanetId: bigint;
  resultType: string;
  lootIron: number;
  lootPlasma: number;
  lootCrystals: number;
};
type ExpeditionLogEntry = {
  id: bigint;
  ownerId: unknown;
  homePlanetId: bigint;
  resultType: string;
  lootIron: number;
  lootPlasma: number;
  lootCrystals: number;
  completedAt: { microsSinceUnixEpoch: bigint };
};

function ShipyardPanel({
  level,
  planet,
  myFleet,
  myMissions,
  myReturnMissions,
  canAffordShip,
  isBusy,
  canAffordUpgrade,
  targetLevel,
  costIron,
  costPlasma,
  costCrystals,
  buildSec,
  onBuildShip,
  onUpgrade,
  onSendFleet,
}: {
  level: number;
  planet: PlanetRow;
  myFleet: FleetRow | undefined;
  myMissions: FleetMissionRow[];
  myReturnMissions: ReturnMissionRow[];
  canAffordShip: boolean;
  isBusy: boolean;
  canAffordUpgrade: boolean;
  targetLevel: number;
  costIron: number;
  costPlasma: number;
  costCrystals: number;
  buildSec: number;
  onBuildShip: () => void;
  onUpgrade: () => void;
  onSendFleet: () => void;
}) {
  const explorerCount = myFleet?.explorerCount ?? 0;
  const hasShipyard = level >= 1;
  const activeMissions =
    myMissions.filter((m) => m.sourcePlanetId === planet.id).length +
    myReturnMissions.filter((m) => m.homePlanetId === planet.id).length;
  const availableExplorers = Math.max(0, explorerCount - activeMissions);
  const upgradDisabled = isBusy || !canAffordUpgrade;

  return (
    <div
      style={{
        background: "#1e2030",
        borderRadius: 8,
        padding: "14px 16px",
        border: "1px solid #555a",
        gridColumn: "1 / -1",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
        }}
      >
        <span style={{ fontWeight: "bold", color: "#e0e0e0" }}>Shipyard</span>
        <span style={{ color: "#888", fontSize: "0.85rem" }}>
          Level {level}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        <div
          style={{
            background: "#131320",
            borderRadius: 6,
            padding: "10px 14px",
          }}
        >
          <div style={{ color: "#999", fontSize: "0.75rem", marginBottom: 4 }}>
            Explorer Ships
          </div>
          <div
            style={{ color: "#7fc8ff", fontWeight: "bold", fontSize: "1.2rem" }}
          >
            {explorerCount}
            {activeMissions > 0 && (
              <span
                style={{ color: "#aaa", fontSize: "0.8rem", marginLeft: 6 }}
              >
                ({availableExplorers} available)
              </span>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: "0.75rem", color: "#999" }}>
            Cost: ⚙️ {EXPLORER_COST_IRON} ⚡ {EXPLORER_COST_PLASMA} 💎{" "}
            {EXPLORER_COST_CRYSTALS}
          </div>
          <button
            style={{
              ...btnStyle,
              marginTop: 8,
              width: "100%",
              opacity: !hasShipyard || !canAffordShip ? 0.4 : 1,
              cursor:
                !hasShipyard || !canAffordShip ? "not-allowed" : "pointer",
              background: !hasShipyard
                ? "#2a2a3a"
                : !canAffordShip
                  ? "#4a2a2a"
                  : "#1a3a5a",
            }}
            disabled={!hasShipyard || !canAffordShip}
            onClick={onBuildShip}
            title={
              !hasShipyard
                ? "Build a Shipyard first"
                : !canAffordShip
                  ? "Not enough resources"
                  : "Build an Explorer ship"
            }
          >
            {!hasShipyard
              ? "No shipyard"
              : !canAffordShip
                ? "Need resources"
                : "Build Explorer"}
          </button>
        </div>

        <div
          style={{
            background: "#131320",
            borderRadius: 6,
            padding: "10px 14px",
          }}
        >
          <div style={{ color: "#999", fontSize: "0.75rem", marginBottom: 4 }}>
            Send Explorer
          </div>
          <div
            style={{
              color: "#aaa",
              fontSize: "0.8rem",
              lineHeight: 1.4,
              marginBottom: 8,
            }}
          >
            Send a ship on an expedition. Returns with resources, ruins,
            anomalies, or nothing.
          </div>
          <button
            style={{
              ...btnStyle,
              width: "100%",
              opacity: availableExplorers === 0 ? 0.4 : 1,
              cursor: availableExplorers === 0 ? "not-allowed" : "pointer",
              background: availableExplorers === 0 ? "#2a2a3a" : "#1a3a2a",
            }}
            disabled={availableExplorers === 0}
            onClick={onSendFleet}
            title={
              availableExplorers === 0
                ? "No available explorers"
                : "Select a target planet in the system map"
            }
          >
            {availableExplorers === 0 ? "No explorers" : "🚀 Launch Mission"}
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          borderTop: "1px solid #2a2a3a",
          paddingTop: 10,
        }}
      >
        <div style={{ fontSize: "0.75rem", color: "#999", marginBottom: 4 }}>
          Upgrade Shipyard
        </div>
        <div style={{ fontSize: "0.75rem", color: "#888", marginBottom: 6 }}>
          <span>⏱ {formatDuration(buildSec)}</span>
          <span
            style={{ marginLeft: 12, color: costIron > 0 ? "#fff" : "#555" }}
          >
            ⚙️ {costIron}
          </span>
          <span
            style={{ marginLeft: 8, color: costPlasma > 0 ? "#fff" : "#555" }}
          >
            ⚡ {costPlasma}
          </span>
          <span
            style={{ marginLeft: 8, color: costCrystals > 0 ? "#fff" : "#555" }}
          >
            💎 {costCrystals}
          </span>
        </div>
        <button
          style={{
            ...btnStyle,
            opacity: upgradDisabled ? 0.4 : 1,
            cursor: upgradDisabled ? "not-allowed" : "pointer",
            background: !canAffordUpgrade
              ? "#4a2a2a"
              : isBusy
                ? "#2a3a4a"
                : "#1a4a2a",
          }}
          disabled={upgradDisabled}
          onClick={onUpgrade}
        >
          {isBusy
            ? "Queue busy"
            : !canAffordUpgrade
              ? "Need more resources"
              : `Upgrade → Lv ${targetLevel}`}
        </button>
      </div>
    </div>
  );
}

const RESULT_META: Record<
  string,
  { emoji: string; label: string; bg: string; color: string }
> = {
  resources: {
    emoji: "🪨",
    label: "Resources Found",
    bg: "#1e2a1e",
    color: "#7fff7f",
  },
  ruins: {
    emoji: "🏛️",
    label: "Ancient Ruins",
    bg: "#1e1a2a",
    color: "#c8a0ff",
  },
  anomaly: { emoji: "🌀", label: "Anomaly", bg: "#1a2030", color: "#7fc8ff" },
  empty: { emoji: "🌌", label: "Empty Space", bg: "#1e1e1e", color: "#888" },
  delayed: { emoji: "⏳", label: "Delayed", bg: "#2a1e10", color: "#ffaa44" },
};

type MissionRowProps =
  | {
      kind: "outbound";
      scheduledAt: unknown;
      planets: readonly PlanetRow[];
      targetPlanetId: bigint;
    }
  | {
      kind: "return";
      scheduledAt: unknown;
      resultType: string;
      lootIron: number;
      lootPlasma: number;
      lootCrystals: number;
    };

function MissionRow(props: MissionRowProps) {
  const finishMs = (() => {
    const sa = props.scheduledAt as {
      tag: string;
      value: { microsSinceUnixEpoch: bigint };
    };
    if (sa?.tag === "Time" && sa.value?.microsSinceUnixEpoch != null) {
      return Number(sa.value.microsSinceUnixEpoch / 1000n);
    }
    return null;
  })();

  const remaining = useCountdown(finishMs);

  if (props.kind === "outbound") {
    const target = props.planets.find((p) => p.id === props.targetPlanetId);
    const targetLabel = target
      ? (target.name ??
        `System ${(target as { systemId?: number }).systemId ?? "?"} · Slot ${(target as { slotIndex?: number }).slotIndex != null ? (target as { slotIndex: number }).slotIndex + 1 : "?"}`)
      : `Planet #${props.targetPlanetId}`;

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#1e2a1e",
          borderRadius: 8,
          padding: "10px 16px",
        }}
      >
        <div>
          <div
            style={{ color: "#7fff7f", fontWeight: "bold", fontSize: "0.9rem" }}
          >
            🚀 Exploring → {targetLabel}
          </div>
          <div style={{ color: "#aaa", fontSize: "0.8rem", marginTop: 2 }}>
            Arrives in:{" "}
            <strong style={{ color: "#fff" }}>
              {formatDuration(remaining)}
            </strong>
          </div>
        </div>
      </div>
    );
  }

  const meta = RESULT_META[props.resultType] ?? RESULT_META.empty;
  const hasLoot =
    props.lootIron > 0 || props.lootPlasma > 0 || props.lootCrystals > 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: meta.bg,
        borderRadius: 8,
        padding: "10px 16px",
        border: `1px solid ${meta.color}33`,
      }}
    >
      <div>
        <div
          style={{ color: meta.color, fontWeight: "bold", fontSize: "0.9rem" }}
        >
          {meta.emoji} {meta.label} — returning
        </div>
        {hasLoot && (
          <div style={{ color: "#aaa", fontSize: "0.78rem", marginTop: 2 }}>
            {props.lootIron > 0 && <span>⚙️ {props.lootIron} </span>}
            {props.lootPlasma > 0 && <span>⚡ {props.lootPlasma} </span>}
            {props.lootCrystals > 0 && <span>💎 {props.lootCrystals}</span>}
          </div>
        )}
        <div style={{ color: "#aaa", fontSize: "0.8rem", marginTop: 2 }}>
          Returns in:{" "}
          <strong style={{ color: "#fff" }}>{formatDuration(remaining)}</strong>
        </div>
      </div>
    </div>
  );
}

function ExpeditionLogRow({ log }: { log: ExpeditionLogEntry }) {
  const meta = RESULT_META[log.resultType] ?? RESULT_META.empty;
  const hasLoot =
    log.lootIron > 0 || log.lootPlasma > 0 || log.lootCrystals > 0;
  const date = new Date(Number(log.completedAt.microsSinceUnixEpoch / 1000n));
  const timeLabel = date.toLocaleString();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: meta.bg,
        borderRadius: 6,
        padding: "8px 14px",
        border: `1px solid ${meta.color}22`,
      }}
    >
      <div>
        <span
          style={{ color: meta.color, fontWeight: "bold", fontSize: "0.85rem" }}
        >
          {meta.emoji} {meta.label}
        </span>
        {hasLoot ? (
          <span style={{ color: "#aaa", fontSize: "0.78rem", marginLeft: 10 }}>
            {log.lootIron > 0 && <span>⚙️ {log.lootIron} </span>}
            {log.lootPlasma > 0 && <span>⚡ {log.lootPlasma} </span>}
            {log.lootCrystals > 0 && <span>💎 {log.lootCrystals}</span>}
          </span>
        ) : (
          <span style={{ color: "#555", fontSize: "0.78rem", marginLeft: 10 }}>
            Nothing found
          </span>
        )}
      </div>
      <div style={{ color: "#555", fontSize: "0.72rem" }}>{timeLabel}</div>
    </div>
  );
}

const navStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  marginBottom: "1rem",
  borderBottom: "1px solid #2a2a3a",
  paddingBottom: "0.75rem",
};

const navBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#888",
  border: "none",
  borderRadius: 6,
  padding: "4px 12px",
  cursor: "pointer",
  fontSize: "0.85rem",
};

const navBtnActiveStyle: React.CSSProperties = {
  ...navBtnStyle,
  color: "#e0e0e0",
  background: "#2a2a3a",
};

const sectionStyle: React.CSSProperties = {
  background: "#161622",
  borderRadius: 10,
  padding: "1rem 1.25rem",
  marginBottom: "1rem",
  border: "1px solid #2a2a3a",
};

const sectionHeader: React.CSSProperties = {
  margin: "0 0 0.5rem 0",
  fontSize: "1rem",
  color: "#999",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const btnStyle: React.CSSProperties = {
  background: "#1a3a5a",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "6px 14px",
  cursor: "pointer",
  fontSize: "0.85rem",
};

const btnSmallStyle: React.CSSProperties = {
  ...btnStyle,
  padding: "3px 10px",
  fontSize: "0.78rem",
};

const inputStyle: React.CSSProperties = {
  background: "#2a2a3a",
  color: "#fff",
  border: "1px solid #444",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: "0.9rem",
  outline: "none",
};

export default App;
