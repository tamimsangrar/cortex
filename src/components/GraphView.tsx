'use client';

import { useRef, useEffect, useCallback } from 'react';

interface GraphNode {
  id: string;
  title: string;
  type: string;
  linkCount: number;
}

interface GraphEdge {
  source: string;
  target: string;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick: (path: string) => void;
}

const TYPE_COLORS: Record<string, string> = {
  people: '#3b82f6',
  person: '#3b82f6',
  patterns: '#8b5cf6',
  pattern: '#8b5cf6',
  projects: '#22c55e',
  project: '#22c55e',
  decisions: '#eab308',
  decision: '#eab308',
};
const DEFAULT_COLOR = '#88726c';

function getColor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] || DEFAULT_COLOR;
}

function getRadius(linkCount: number): number {
  return Math.min(20, Math.max(6, 4 + linkCount * 2));
}

export default function GraphView({ nodes, edges, onNodeClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{
    simNodes: SimNode[];
    edgeIndices: [number, number][];
    camera: { x: number; y: number; zoom: number };
    hoveredIdx: number;
    dragging: boolean;
    dragStart: { x: number; y: number } | null;
    animId: number;
    settled: boolean;
    tickCount: number;
  } | null>(null);

  const init = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const w = canvas.parentElement?.clientWidth || 800;
    const h = canvas.parentElement?.clientHeight || 600;
    canvas.width = w;
    canvas.height = h;

    // Build node index map
    const idxMap = new Map<string, number>();
    const simNodes: SimNode[] = nodes.map((n, i) => {
      idxMap.set(n.id, i);
      const angle = (2 * Math.PI * i) / nodes.length;
      const spread = Math.min(w, h) * 0.3;
      return {
        ...n,
        x: Math.cos(angle) * spread + (Math.random() - 0.5) * 40,
        y: Math.sin(angle) * spread + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        radius: getRadius(n.linkCount),
      };
    });

    const edgeIndices: [number, number][] = [];
    for (const e of edges) {
      const si = idxMap.get(e.source);
      const ti = idxMap.get(e.target);
      if (si !== undefined && ti !== undefined) {
        edgeIndices.push([si, ti]);
      }
    }

    // Build adjacency for quick neighbor lookup
    const adjacency = new Map<number, Set<number>>();
    for (const [s, t] of edgeIndices) {
      if (!adjacency.has(s)) adjacency.set(s, new Set());
      if (!adjacency.has(t)) adjacency.set(t, new Set());
      adjacency.get(s)!.add(t);
      adjacency.get(t)!.add(s);
    }

    const state = {
      simNodes,
      edgeIndices,
      camera: { x: 0, y: 0, zoom: 1 },
      hoveredIdx: -1,
      dragging: false,
      dragStart: null as { x: number; y: number } | null,
      animId: 0,
      settled: false,
      tickCount: 0,
    };
    stateRef.current = state;

    // Force simulation tick
    function tick() {
      const { simNodes, edgeIndices } = state;
      const n = simNodes.length;
      const damping = 0.88;
      const repulsion = 800;
      const springLen = 80;
      const springK = 0.015;
      const gravity = 0.02;

      // Charge repulsion (use grid for O(n log n) approximation for large graphs)
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = simNodes[j].x - simNodes[i].x;
          const dy = simNodes[j].y - simNodes[i].y;
          const dist2 = dx * dx + dy * dy + 1;
          const dist = Math.sqrt(dist2);
          const force = repulsion / dist2;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          simNodes[i].vx -= fx;
          simNodes[i].vy -= fy;
          simNodes[j].vx += fx;
          simNodes[j].vy += fy;
        }
      }

      // Spring forces along edges
      for (const [si, ti] of edgeIndices) {
        const dx = simNodes[ti].x - simNodes[si].x;
        const dy = simNodes[ti].y - simNodes[si].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const displacement = dist - springLen;
        const force = springK * displacement;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        simNodes[si].vx += fx;
        simNodes[si].vy += fy;
        simNodes[ti].vx -= fx;
        simNodes[ti].vy -= fy;
      }

      // Center gravity
      for (let i = 0; i < n; i++) {
        simNodes[i].vx -= simNodes[i].x * gravity;
        simNodes[i].vy -= simNodes[i].y * gravity;
      }

      // Apply velocities with damping
      let totalV = 0;
      for (let i = 0; i < n; i++) {
        simNodes[i].vx *= damping;
        simNodes[i].vy *= damping;
        simNodes[i].x += simNodes[i].vx;
        simNodes[i].y += simNodes[i].vy;
        totalV += Math.abs(simNodes[i].vx) + Math.abs(simNodes[i].vy);
      }

      state.tickCount++;
      if (totalV < 0.5 * n && state.tickCount > 100) {
        state.settled = true;
      }
    }

    // Render
    function render() {
      const ctx = canvas!.getContext('2d')!;
      const { simNodes, edgeIndices, camera, hoveredIdx } = state;
      const w = canvas!.width;
      const h = canvas!.height;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#fbf9f7';
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(w / 2 + camera.x, h / 2 + camera.y);
      ctx.scale(camera.zoom, camera.zoom);

      const hovered = hoveredIdx >= 0 ? hoveredIdx : -1;
      const connectedToHovered = new Set<number>();
      const hoveredEdges = new Set<number>();
      if (hovered >= 0) {
        const neighbors = adjacency.get(hovered);
        if (neighbors) neighbors.forEach(n => connectedToHovered.add(n));
        edgeIndices.forEach(([s, t], ei) => {
          if (s === hovered || t === hovered) hoveredEdges.add(ei);
        });
      }

      // Draw edges
      for (let ei = 0; ei < edgeIndices.length; ei++) {
        const [si, ti] = edgeIndices[ei];
        const dimmed = hovered >= 0 && !hoveredEdges.has(ei);
        ctx.beginPath();
        ctx.moveTo(simNodes[si].x, simNodes[si].y);
        ctx.lineTo(simNodes[ti].x, simNodes[ti].y);
        ctx.strokeStyle = dimmed ? 'rgba(219,193,185,0.15)' : (hoveredEdges.has(ei) ? 'rgba(136,114,108,0.9)' : '#dbc1b9');
        ctx.lineWidth = hoveredEdges.has(ei) ? 1 : 0.5;
        ctx.stroke();
      }

      // Draw nodes
      const showLabelsZoom = camera.zoom > 1.5;
      for (let i = 0; i < simNodes.length; i++) {
        const node = simNodes[i];
        const isHovered = i === hovered;
        const isConnected = connectedToHovered.has(i);
        const dimmed = hovered >= 0 && !isHovered && !isConnected;

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, 2 * Math.PI);
        const color = getColor(node.type);
        ctx.fillStyle = dimmed ? color + '33' : color;
        ctx.fill();

        if (isHovered) {
          ctx.strokeStyle = '#1b1c1b';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Labels
        if (isHovered || showLabelsZoom) {
          ctx.font = `${isHovered ? 12 : 10}px -apple-system, BlinkMacSystemFont, sans-serif`;
          ctx.fillStyle = isHovered ? '#1b1c1b' : (dimmed ? 'rgba(85,67,61,0.3)' : '#55433d');
          ctx.textAlign = 'center';
          ctx.fillText(node.title, node.x, node.y - node.radius - 6);
        }
      }

      ctx.restore();

      if (!state.settled) {
        tick();
      }
      state.animId = requestAnimationFrame(render);
    }

    // Mouse event helpers
    function screenToWorld(mx: number, my: number) {
      const w = canvas!.width;
      const h = canvas!.height;
      return {
        wx: (mx - w / 2 - state.camera.x) / state.camera.zoom,
        wy: (my - h / 2 - state.camera.y) / state.camera.zoom,
      };
    }

    function findNode(mx: number, my: number): number {
      const { wx, wy } = screenToWorld(mx, my);
      for (let i = state.simNodes.length - 1; i >= 0; i--) {
        const n = state.simNodes[i];
        const dx = wx - n.x;
        const dy = wy - n.y;
        if (dx * dx + dy * dy < (n.radius + 4) * (n.radius + 4)) return i;
      }
      return -1;
    }

    function onMouseMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (state.dragging && state.dragStart) {
        state.camera.x += (e.clientX - state.dragStart.x);
        state.camera.y += (e.clientY - state.dragStart.y);
        state.dragStart = { x: e.clientX, y: e.clientY };
        canvas!.style.cursor = 'grabbing';
        return;
      }

      const idx = findNode(mx, my);
      state.hoveredIdx = idx;
      canvas!.style.cursor = idx >= 0 ? 'pointer' : 'default';
    }

    function onMouseDown(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const idx = findNode(mx, my);
      if (idx < 0) {
        state.dragging = true;
        state.dragStart = { x: e.clientX, y: e.clientY };
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (state.dragging) {
        state.dragging = false;
        state.dragStart = null;
        canvas!.style.cursor = 'default';
        return;
      }
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const idx = findNode(mx, my);
      if (idx >= 0) {
        onNodeClick(state.simNodes[idx].id);
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      state.camera.zoom = Math.max(0.2, Math.min(5, state.camera.zoom * factor));
      // Wake simulation briefly on zoom for redraw
      state.settled = false;
      state.tickCount = Math.max(state.tickCount, 90);
    }

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Handle resize
    function onResize() {
      const w = canvas!.parentElement?.clientWidth || 800;
      const h = canvas!.parentElement?.clientHeight || 600;
      canvas!.width = w;
      canvas!.height = h;
    }
    window.addEventListener('resize', onResize);

    state.animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(state.animId);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    };
  }, [nodes, edges, onNodeClick]);

  useEffect(() => {
    const cleanup = init();
    return () => { if (cleanup) cleanup(); };
  }, [init]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#fbf9f7' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
      {nodes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', color: '#88726c',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 40, marginBottom: 12 }}>hub</span>
          <p style={{ fontSize: 14 }}>No graph data available</p>
        </div>
      )}
    </div>
  );
}
