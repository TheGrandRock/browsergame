import React, { useRef, useEffect, useCallback } from "react";
import { useTable } from "spacetimedb/react";
import { tables } from "./module_bindings";
import { Identity } from "spacetimedb";

// Orbital position at a given elapsed time (seconds)
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

interface GalaxyMapProps {
  myIdentity: Identity | undefined;
  onSelectSystem: (systemId: number) => void;
}

export function GalaxyMap({ myIdentity, onSelectSystem }: GalaxyMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const hoveredSystemRef = useRef<number | null>(null);

  const [solarSystems] = useTable(tables.solar_system);
  const [planets] = useTable(tables.planet);

  // Determine which system the player owns a planet in
  const mySystemId = planets.find(
    (p) =>
      p.ownerId != null && myIdentity != null && p.ownerId.isEqual(myIdentity),
  )?.systemId;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const elapsedSec = (Date.now() - startTimeRef.current) / 1000;

    // Scale: galaxy radius 1000 → fit in canvas
    const maxOrbital = Math.max(
      ...solarSystems.map((s) => s.orbitalRadius),
      920,
    );
    const scale = (Math.min(W, H) / 2 - 40) / maxOrbital;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#08080f";
    ctx.fillRect(0, 0, W, H);

    // Draw faint star field
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    // Use seeded deterministic stars
    for (let i = 0; i < 120; i++) {
      const sx = (i * 1237 + 317) % W;
      const sy = (i * 839 + 113) % H;
      const r = i % 3 === 0 ? 1.2 : 0.6;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Galactic center glow
    const galacticGlow = ctx.createRadialGradient(
      cx,
      cy,
      0,
      cx,
      cy,
      30 * scale,
    );
    galacticGlow.addColorStop(0, "rgba(255, 220, 100, 0.9)");
    galacticGlow.addColorStop(0.4, "rgba(255, 160, 50, 0.4)");
    galacticGlow.addColorStop(1, "rgba(255, 100, 20, 0)");
    ctx.fillStyle = galacticGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, 30 * scale, 0, Math.PI * 2);
    ctx.fill();

    // Draw orbital paths for each solar system
    for (const sys of solarSystems) {
      ctx.beginPath();
      ctx.arc(cx, cy, sys.orbitalRadius * scale, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw solar systems
    for (const sys of solarSystems) {
      const [sx, sy] = orbitalPos(
        cx,
        cy,
        sys.orbitalRadius * scale,
        sys.initialAngle,
        sys.orbitalSpeed,
        elapsedSec,
      );

      const isHovered = hoveredSystemRef.current === sys.id;
      const isMySystem = mySystemId === sys.id;

      // Count owned planets in this system
      const ownedCount = planets.filter(
        (p) => p.systemId === sys.id && p.ownerId != null,
      ).length;

      // Star glow
      const starRadius = isHovered ? 14 : isMySystem ? 12 : 9;
      const coreColor = isMySystem
        ? "rgba(120, 200, 255, 1)"
        : isHovered
          ? "rgba(255, 220, 120, 1)"
          : "rgba(255, 200, 80, 0.9)";
      const glowColor = isMySystem
        ? "rgba(80, 160, 255, 0)"
        : "rgba(255, 160, 40, 0)";

      const glow = ctx.createRadialGradient(
        sx,
        sy,
        0,
        sx,
        sy,
        starRadius * 2.5,
      );
      glow.addColorStop(0, coreColor);
      glow.addColorStop(
        0.4,
        isMySystem ? "rgba(80, 160, 255, 0.4)" : "rgba(255, 160, 40, 0.35)",
      );
      glow.addColorStop(1, glowColor);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, starRadius * 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Star core
      ctx.fillStyle = coreColor;
      ctx.beginPath();
      ctx.arc(sx, sy, starRadius * 0.6, 0, Math.PI * 2);
      ctx.fill();

      // Label
      const label = `System ${sys.systemIndex + 1}`;
      ctx.fillStyle = isMySystem ? "#7fc8ff" : isHovered ? "#ffe080" : "#aaa";
      ctx.font =
        isHovered || isMySystem ? "bold 11px sans-serif" : "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, sx, sy + starRadius * 2.5 + 12);

      // Owned planet indicator
      if (ownedCount > 0) {
        ctx.fillStyle = "#4dff88";
        ctx.font = "9px sans-serif";
        ctx.fillText(`${ownedCount} colony`, sx, sy + starRadius * 2.5 + 23);
      }

      // Hover ring
      if (isHovered) {
        ctx.strokeStyle = "rgba(255, 220, 100, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, starRadius * 2.5 + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // My system ring
      if (isMySystem) {
        ctx.strokeStyle = "rgba(120, 200, 255, 0.5)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(sx, sy, starRadius * 2.5 + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    animRef.current = requestAnimationFrame(draw);
  }, [solarSystems, planets, mySystemId]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  // Hit detection: find which system the cursor is near
  const getSystemAtPos = useCallback(
    (mouseX: number, mouseY: number): number | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;
      const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
      const maxOrbital = Math.max(
        ...solarSystems.map((s) => s.orbitalRadius),
        920,
      );
      const scale = (Math.min(W, H) / 2 - 40) / maxOrbital;

      for (const sys of solarSystems) {
        const [sx, sy] = orbitalPos(
          cx,
          cy,
          sys.orbitalRadius * scale,
          sys.initialAngle,
          sys.orbitalSpeed,
          elapsedSec,
        );
        const dist = Math.hypot(mouseX - sx, mouseY - sy);
        if (dist < 24) return sys.id;
      }
      return null;
    },
    [solarSystems],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const hit = getSystemAtPos(x, y);
      hoveredSystemRef.current = hit;
      if (canvasRef.current) {
        canvasRef.current.style.cursor = hit !== null ? "pointer" : "default";
      }
    },
    [getSystemAtPos],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const hit = getSystemAtPos(x, y);
      if (hit !== null) onSelectSystem(hit);
    },
    [getSystemAtPos, onSelectSystem],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ color: "#666", fontSize: "0.8rem" }}>
        Click a solar system to explore it
        {mySystemId != null && (
          <span style={{ color: "#7fc8ff", marginLeft: 12 }}>
            ● Your colony: System{" "}
            {solarSystems.find((s) => s.id === mySystemId)?.systemIndex != null
              ? solarSystems.find((s) => s.id === mySystemId)!.systemIndex + 1
              : "?"}
          </span>
        )}
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
