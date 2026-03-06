import React, { useRef, useEffect, useCallback } from "react";
import { useTable } from "spacetimedb/react";
import { tables } from "./module_bindings";
import { Identity } from "spacetimedb";

function orbitalPos(
  cx: number,
  cy: number,
  radius: number,
  initialAngle: number,
  orbitalSpeed: number,
  elapsedSec: number,
): [number, number] {
  const angle = initialAngle + orbitalSpeed * elapsedSec;
  return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
}

interface SolarSystemViewProps {
  systemId: number;
  myIdentity: Identity | undefined;
  onEnterPlanet: (planetId: bigint) => void;
  onBack: () => void;
  onSendFleet?: (targetPlanetId: bigint) => void;
  sourcePlanetId?: bigint;
}

export function SolarSystemView({
  systemId,
  myIdentity,
  onEnterPlanet,
  onBack,
  onSendFleet,
  sourcePlanetId,
}: SolarSystemViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const hoveredPlanetRef = useRef<bigint | null>(null);

  const [solarSystems] = useTable(tables.solar_system);
  const [planets] = useTable(tables.planet);

  const system = solarSystems.find((s) => s.id === systemId);
  const systemPlanets = planets.filter((p) => p.systemId === systemId);
  const myPlanet = systemPlanets.find(
    (p) =>
      p.ownerId != null && myIdentity != null && p.ownerId.isEqual(myIdentity),
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !system) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const elapsedSec = (Date.now() - startTimeRef.current) / 1000;

    const maxOrbital = Math.max(
      ...systemPlanets.map((p) => p.orbitalRadius),
      240,
    );
    const scale = (Math.min(W, H) / 2 - 50) / maxOrbital;

    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = "#08080f";
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < 80; i++) {
      const sx = (i * 1453 + 271) % W;
      const sy = (i * 997 + 53) % H;
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath();
      ctx.arc(sx, sy, i % 4 === 0 ? 1.0 : 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const planet of systemPlanets) {
      ctx.beginPath();
      ctx.arc(cx, cy, planet.orbitalRadius * scale, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const starGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28);
    starGlow.addColorStop(0, "rgba(255, 230, 120, 1)");
    starGlow.addColorStop(0.5, "rgba(255, 160, 40, 0.5)");
    starGlow.addColorStop(1, "rgba(255, 80, 0, 0)");
    ctx.fillStyle = starGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, 28, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 240, 180, 1)";
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#aaa";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`System ${system.systemIndex + 1}`, cx, cy + 42);

    for (const planet of systemPlanets) {
      const [px, py] = orbitalPos(
        cx,
        cy,
        planet.orbitalRadius * scale,
        planet.initialAngle,
        planet.orbitalSpeed,
        elapsedSec,
      );

      const isHovered = hoveredPlanetRef.current === planet.id;
      const isOwned = planet.ownerId != null;
      const isMine =
        myIdentity != null &&
        planet.ownerId != null &&
        planet.ownerId.isEqual(myIdentity);
      const isSource = sourcePlanetId != null && planet.id === sourcePlanetId;
      const isTargetable = onSendFleet != null && !isOwned;

      const planetRadius = isMine ? 9 : isOwned ? 7 : isHovered ? 8 : 6;

      const baseColor = isSource
        ? "#ffdd44"
        : isTargetable && isHovered
          ? "#44ff88"
          : isTargetable
            ? "#33bb66"
            : isMine
              ? "#7fc8ff"
              : isOwned
                ? "#ff9944"
                : isHovered
                  ? "#ffe080"
                  : "#7a9ab0";

      ctx.fillStyle = baseColor + "33";
      ctx.beginPath();
      ctx.arc(px, py, planetRadius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.arc(px, py, planetRadius, 0, Math.PI * 2);
      ctx.fill();

      if (isMine || isSource) {
        ctx.strokeStyle = isSource
          ? "rgba(255, 220, 60, 0.8)"
          : "rgba(120, 200, 255, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(px, py, planetRadius + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (isTargetable) {
        const pulse =
          0.5 + 0.5 * Math.sin(elapsedSec * 3 + planet.orbitalRadius);
        ctx.strokeStyle = `rgba(50, 200, 100, ${0.4 + 0.4 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, planetRadius + 5 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
      } else if (isHovered) {
        ctx.strokeStyle = "rgba(255, 220, 80, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, planetRadius + 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      const labelText = isSource
        ? "🚀 Origin"
        : isMine
          ? (planet.name ?? "Your Colony")
          : isOwned
            ? "Colonized"
            : isTargetable
              ? `→ Slot ${planet.slotIndex + 1}`
              : `Slot ${planet.slotIndex + 1}`;

      ctx.fillStyle = isSource
        ? "#ffdd44"
        : isMine
          ? "#7fc8ff"
          : isTargetable
            ? "#44ff88"
            : isHovered
              ? "#ffe080"
              : "#888";
      ctx.font =
        isMine || isHovered || isTargetable || isSource
          ? "bold 10px sans-serif"
          : "9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(labelText, px, py - planetRadius - 6);

      if (isMine || isHovered) {
        ctx.fillStyle = "#555";
        ctx.font = "9px sans-serif";
        ctx.fillText(
          `⚙${Math.floor(planet.iron)} ⚡${Math.floor(planet.plasma)} 💎${Math.floor(planet.crystals)}`,
          px,
          py + planetRadius + 14,
        );
      }
    }

    animRef.current = requestAnimationFrame(draw);
  }, [
    system,
    systemPlanets,
    myIdentity,
    myPlanet,
    onSendFleet,
    sourcePlanetId,
  ]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const getPlanetAtPos = useCallback(
    (mouseX: number, mouseY: number): bigint | null => {
      const canvas = canvasRef.current;
      if (!canvas || !system) return null;
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;
      const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
      const maxOrbital = Math.max(
        ...systemPlanets.map((p) => p.orbitalRadius),
        240,
      );
      const scale = (Math.min(W, H) / 2 - 50) / maxOrbital;

      for (const planet of systemPlanets) {
        const [px, py] = orbitalPos(
          cx,
          cy,
          planet.orbitalRadius * scale,
          planet.initialAngle,
          planet.orbitalSpeed,
          elapsedSec,
        );
        if (Math.hypot(mouseX - px, mouseY - py) < 18) return planet.id;
      }
      return null;
    },
    [system, systemPlanets],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const hit = getPlanetAtPos(
        (e.clientX - rect.left) * scaleX,
        (e.clientY - rect.top) * scaleY,
      );
      hoveredPlanetRef.current = hit;
      if (canvasRef.current) {
        canvasRef.current.style.cursor = hit !== null ? "pointer" : "default";
      }
    },
    [getPlanetAtPos],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const hit = getPlanetAtPos(
        (e.clientX - rect.left) * scaleX,
        (e.clientY - rect.top) * scaleY,
      );
      if (hit !== null) {
        const clickedPlanet = systemPlanets.find((p) => p.id === hit);
        if (onSendFleet != null) {
          if (clickedPlanet?.ownerId == null) {
            onSendFleet(hit);
          }
        } else if (
          clickedPlanet?.ownerId != null &&
          myIdentity != null &&
          clickedPlanet.ownerId.isEqual(myIdentity)
        ) {
          onEnterPlanet(hit);
        }
      }
    },
    [getPlanetAtPos, systemPlanets, myIdentity, onEnterPlanet, onSendFleet],
  );

  if (!system) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          width: "100%",
        }}
      >
        <button onClick={onBack} style={backBtnStyle}>
          ← Galaxy
        </button>
        <span style={{ color: "#999", fontSize: "0.85rem" }}>
          System {system.systemIndex + 1}
          {onSendFleet != null ? (
            <span style={{ color: "#44ff88", marginLeft: 12 }}>
              🚀 Fleet mode — click an unclaimed planet to send your Explorer
            </span>
          ) : myPlanet ? (
            <span style={{ color: "#7fc8ff", marginLeft: 12 }}>
              ● Your colony here — click your planet to manage it
            </span>
          ) : null}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={700}
        height={700}
        style={{
          borderRadius: 12,
          border: "1px solid #2a2a3a",
          maxWidth: "100%",
        }}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
      />
    </div>
  );
}

const backBtnStyle: React.CSSProperties = {
  background: "#1a2a3a",
  color: "#aaa",
  border: "1px solid #333",
  borderRadius: 6,
  padding: "5px 14px",
  cursor: "pointer",
  fontSize: "0.85rem",
};
