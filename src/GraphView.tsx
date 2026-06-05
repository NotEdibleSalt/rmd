import { useEffect, useRef, useState } from 'react';
import { forceCenter, forceLink, forceManyBody, forceSimulation, Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { select, pointer } from 'd3-selection';
import { zoom, zoomIdentity, ZoomBehavior } from 'd3-zoom';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from './store';
import { GraphData, GraphEdge, GraphNode } from './lib/workspaceIndex';

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  path: string;
  link_count: number;
  backlink_count: number;
  r: number;
}

type SimLink = SimulationLinkDatum<SimNode>;

function nodeRadius(node: GraphNode): number {
  const total = node.link_count + node.backlink_count;
  // Log scale so a single link still gives a visible node
  return 6 + 4 * Math.log1p(total);
}

export function GraphView() {
  const graphViewOpen = useEditorStore((s) => s.graphViewOpen);
  const graphData = useEditorStore((s) => s.graphData);
  const theme = useEditorStore((s) => s.theme);
  const closeGraphView = useEditorStore((s) => s.closeGraphView);
  const openGraphView = useEditorStore((s) => s.openGraphView);
  const openFile = useEditorStore((s) => s.openFile);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const workspaceIndex = useEditorStore((s) => s.workspaceIndex);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const hoveredNodeRef = useRef<SVGGElement | null>(null);

  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoverLabel, setHoverLabel] = useState<{ x: number; y: number; text: string } | null>(null);

  const root = workspaceRoot || workspaceIndex.root;

  // Fetch graph data when the dialog opens.
  useEffect(() => {
    if (!graphViewOpen) return;
    if (graphData) return;
    if (!root) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await invoke<GraphData>('get_graph_data', { workspaceRoot: root });
        if (!cancelled) {
          useEditorStore.setState({ graphData: data });
        }
      } catch (e) {
        if (!cancelled) console.error('get_graph_data failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [graphViewOpen, graphData, root]);

  // Track container size for centering the simulation.
  useEffect(() => {
    if (!graphViewOpen) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: Math.max(200, rect.width), h: Math.max(200, rect.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [graphViewOpen]);

  // Build the d3 simulation when graph data is available.
  useEffect(() => {
    if (!graphViewOpen) return;
    if (!graphData) return;
    const svg = svgRef.current;
    if (!svg) return;

    // Cast: rust returns a plain GraphData shape; d3 mutates nodes in place.
    const rawNodes = graphData.nodes as unknown as GraphNode[];
    const rawEdges = graphData.edges as unknown as GraphEdge[];

    const nodes: SimNode[] = rawNodes.map((n) => ({
      id: n.id,
      label: n.label,
      path: n.path,
      link_count: n.link_count,
      backlink_count: n.backlink_count,
      r: nodeRadius(n),
    }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = rawEdges
      .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }));

    const linkDistance = 70;
    const sim = forceSimulation<SimNode>(nodes)
      .force('charge', forceManyBody<SimNode>().strength(-180))
      .force('center', forceCenter(size.w / 2, size.h / 2))
      .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(linkDistance))
      .alpha(1)
      .alphaDecay(0.03);

    simRef.current = sim;

    // Wire up the zoom behavior.
    const svgSel = select(svg);
    const g = svgSel.select<SVGGElement>('g.graph-view-root');
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString());
      });
    zoomRef.current = zoomBehavior;
    svgSel.call(zoomBehavior);
    // Reset transform whenever the dialog re-opens.
    svgSel.call(zoomBehavior.transform, zoomIdentity);

    // Bind links.
    const linkSel = g
      .select<SVGGElement>('g.graph-edges')
      .selectAll<SVGLineElement, SimLink>('line.graph-edge')
      .data(links, (d) => {
        const s = typeof d.source === 'string' ? d.source : (d.source as SimNode).id;
        const t = typeof d.target === 'string' ? d.target : (d.target as SimNode).id;
        return `${s}->${t}`;
      });

    linkSel
      .enter()
      .append('line')
      .attr('class', 'graph-edge')
      .attr('stroke-width', 1.2)
      .attr('stroke-opacity', 0.5)
      .merge(linkSel)
      .attr('stroke', 'currentColor');

    linkSel.exit().remove();

    // Bind nodes.
    const nodeSel = g
      .select<SVGGElement>('g.graph-nodes')
      .selectAll<SVGGElement, SimNode>('g.graph-node')
      .data(nodes, (d) => d.id);

    const nodeEnter = nodeSel
      .enter()
      .append('g')
      .attr('class', 'graph-node')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        openFile(d.path).catch((e) => console.error('Open from graph failed:', e));
        closeGraphView();
      })
      .on('mouseenter', (event, d) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const x = event.clientX - (rect?.left ?? 0);
        const y = event.clientY - (rect?.top ?? 0);
        setHoverLabel({ x, y, text: d.label });
        hoveredNodeRef.current = event.currentTarget as SVGGElement;
      })
      .on('mousemove', (event) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const x = event.clientX - (rect?.left ?? 0);
        const y = event.clientY - (rect?.top ?? 0);
        setHoverLabel((prev) => (prev ? { ...prev, x, y } : null));
      })
      .on('mouseleave', () => {
        setHoverLabel(null);
        hoveredNodeRef.current = null;
      });

    nodeEnter.append('circle').attr('class', 'graph-node-circle');
    nodeEnter.append('text')
      .attr('class', 'graph-node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .style('pointer-events', 'none')
      .style('font-size', '10px')
      .style('opacity', 0)
      .text((d) => d.label);

    const nodeAll = nodeEnter.merge(nodeSel);
    nodeAll.select<SVGCircleElement>('circle.graph-node-circle')
      .attr('r', (d) => d.r)
      .attr('fill', 'var(--accent)')
      .attr('fill-opacity', 0.7)
      .attr('stroke', 'var(--accent-hover)')
      .attr('stroke-width', 1.5);

    nodeSel.exit().remove();

    // Drag behavior: pin node while dragging.
    const dragBehavior = (event: MouseEvent, d: SimNode) => {
      const [px, py] = pointer(event, svg);
      d.fx = px;
      d.fy = py;
      sim.alphaTarget(0.3).restart();
    };
    const releaseBehavior = (event: MouseEvent, d: SimNode) => {
      if (event.button === 2 || (event as MouseEvent).ctrlKey) {
        d.fx = null;
        d.fy = null;
      } else {
        // Settle: keep fx/fy as the final drop position
        // (releasing re-enables gravity-like centering because fx stays set)
        // No-op: retain pinned position
        void d;
      }
      sim.alphaTarget(0);
    };
    nodeAll
      .on('mousedown', dragBehavior)
      .on('mouseup', releaseBehavior);

    sim.on('tick', () => {
      g.selectAll<SVGLineElement, SimLink>('line.graph-edge')
        .attr('x1', (d) => (typeof d.source === 'string' ? 0 : (d.source as SimNode).x ?? 0))
        .attr('y1', (d) => (typeof d.source === 'string' ? 0 : (d.source as SimNode).y ?? 0))
        .attr('x2', (d) => (typeof d.target === 'string' ? 0 : (d.target as SimNode).x ?? 0))
        .attr('y2', (d) => (typeof d.target === 'string' ? 0 : (d.target as SimNode).y ?? 0));

      nodeAll.attr('transform', (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
    });

    return () => {
      sim.stop();
      simRef.current = null;
      zoomRef.current = null;
    };
  }, [graphData, graphViewOpen, size.w, size.h, openFile, closeGraphView]);

  // Re-center the simulation when the viewport size changes.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const center = sim.force('center') as ReturnType<typeof forceCenter<SimNode>> | undefined;
    if (center) {
      center.x(size.w / 2).y(size.h / 2);
      sim.alpha(0.3).restart();
    }
  }, [size.w, size.h]);

  // Escape closes the dialog.
  useEffect(() => {
    if (!graphViewOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeGraphView();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [graphViewOpen, closeGraphView]);

  if (!graphViewOpen) return null;

  const hasNodes = (graphData?.nodes?.length ?? 0) > 0;

  return (
    <div className="dialog-overlay graph-view-overlay" onClick={closeGraphView}>
      <div
        className={`dialog graph-view graph-view-${theme}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>链接图谱</h2>
          <div className="graph-view-actions">
            <button
              className="toolbar-btn"
              onClick={() => openGraphView()}
              title="刷新"
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
            <button className="dialog-close" onClick={closeGraphView} title="关闭" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="graph-view-body" ref={containerRef}>
          {!root ? (
            <div className="graph-view-empty">请先设置工作区根目录</div>
          ) : !graphData ? (
            <div className="graph-view-loading">加载中…</div>
          ) : !hasNodes ? (
            <div className="graph-view-empty">暂无链接关系</div>
          ) : (
            <svg
              ref={svgRef}
              className="graph-view-svg"
              width={size.w}
              height={size.h}
              viewBox={`0 0 ${size.w} ${size.h}`}
            >
              <g className="graph-view-root">
                <g className="graph-edges" />
                <g className="graph-nodes" />
              </g>
            </svg>
          )}
          {hoverLabel && (
            <div
              className="graph-view-hover-label"
              style={{ left: hoverLabel.x + 12, top: hoverLabel.y + 12 }}
            >
              {hoverLabel.text}
            </div>
          )}
        </div>
        <div className="graph-view-footer">
          <span>{graphData?.nodes.length ?? 0} 个节点</span>
          <span>·</span>
          <span>{graphData?.edges.length ?? 0} 条链接</span>
          <span>·</span>
          <span className="graph-view-hint">拖动节点 · 滚轮缩放 · 点击节点打开文件</span>
        </div>
      </div>
    </div>
  );
}
