export const DEFAULT_LAYOUT = Object.freeze({
  horizontalGutter: 60,
  verticalGutter: 40,
  padding: 54,
});

const VECTORS = Object.freeze({
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
});

const OPPOSITE_DIRECTIONS = Object.freeze({
  right: "left",
  left: "right",
  down: "up",
  up: "down",
});

function edgeLayoutDirection(edge) {
  return edge.layoutDirection ?? "right";
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function alternateOffset(attempt) {
  if (!attempt) return 0;
  const distance = Math.ceil(attempt / 2);
  return attempt % 2 ? distance : -distance;
}

function freeCell(origin, direction, occupied) {
  const vector = VECTORS[direction] ?? VECTORS.right;
  const base = { x: origin.x + vector.x, y: origin.y + vector.y };
  return freeCandidate(base, direction, occupied);
}

function freeCandidate(base, direction, occupied) {
  const vector = VECTORS[direction] ?? VECTORS.right;
  for (let attempt = 0; ; attempt += 1) {
    const offset = alternateOffset(attempt);
    const candidate = vector.x
      ? { x: base.x, y: base.y + offset }
      : { x: base.x + offset, y: base.y };
    if (!occupied.has(cellKey(candidate.x, candidate.y))) return candidate;
  }
}

function branchCandidate(edge, edges, source) {
  const siblings = edges.filter((candidate) => candidate.kind === "branch"
    && candidate.from === edge.from
    && edgeLayoutDirection(candidate) === edgeLayoutDirection(edge));
  if (siblings.length < 2) return null;
  const direction = edgeLayoutDirection(edge);
  const vector = VECTORS[direction];
  const lane = siblings.indexOf(edge) - (siblings.length - 1) / 2;
  return vector.x
    ? { x: source.x + vector.x, y: source.y + lane }
    : { x: source.x + lane, y: source.y + vector.y };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function alignTerminalMergeSources(positions, edges) {
  const occupied = new Set([...positions.values()].map((position) => cellKey(position.x, position.y)));
  const groups = new Map();
  edges.forEach((edge) => {
    if (edge.kind !== "merge") return;
    const key = `${edge.to}|${edgeLayoutDirection(edge)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  });
  groups.forEach((group) => {
    const direction = edgeLayoutDirection(group[0]);
    const vector = VECTORS[direction];
    const target = positions.get(group[0].to);
    if (!target) return;
    const perpendicular = vector.x ? target.y : target.x;
    if (!Number.isInteger(perpendicular)) return;
    const frontier = { x: target.x - vector.x, y: target.y - vector.y };
    group.forEach((edge) => {
      const source = positions.get(edge.from);
      const continuesFlow = edges.some((candidate) => candidate.from === edge.from && candidate.kind !== "merge");
      if (!source || continuesFlow) return;
      const distanceToFrontier = (frontier.x - source.x) * vector.x + (frontier.y - source.y) * vector.y;
      if (distanceToFrontier <= 0) return;
      occupied.delete(cellKey(source.x, source.y));
      const position = freeCandidate(frontier, direction, occupied);
      positions.set(edge.from, position);
      occupied.add(cellKey(position.x, position.y));
    });
  });
  return positions;
}

function assignConnectionPorts(nodes, edges, cells) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const sourceFaces = { up: "top", right: "right", down: "bottom", left: "left" };
  const targetFaces = { down: "top", left: "right", up: "bottom", right: "left" };
  const groups = new Map();
  edges.forEach((edge, sourceOrder) => {
    const sourceDirection = edge.sourceDirection ?? edge.layoutDirection ?? "right";
    const targetDirection = edge.targetLayoutDirection ?? edge.layoutDirection ?? "right";
    [
      { role: "source", endpoint: edge.from, other: edge.to, direction: sourceDirection, face: edge.sourceFace ?? sourceFaces[sourceDirection] },
      { role: "target", endpoint: edge.to, other: edge.from, direction: targetDirection, face: edge.targetFace ?? targetFaces[targetDirection] },
    ].forEach((entry) => {
      const key = `${entry.role}|${entry.endpoint}|${entry.face}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ edge, sourceOrder, ...entry });
    });
  });
  const assignments = new Map();
  groups.forEach((group) => {
    const { direction, endpoint, face, role } = group[0];
    const vertical = direction === "up" || direction === "down";
    group.sort((a, b) => {
      const aCell = cells.get(a.other);
      const bCell = cells.get(b.other);
      const perpendicular = vertical ? aCell.x - bCell.x : aCell.y - bCell.y;
      if (perpendicular) return perpendicular;
      const along = vertical ? aCell.y - bCell.y : aCell.x - bCell.x;
      if (along) return ["left", "up"].includes(direction) ? -along : along;
      return a.sourceOrder - b.sourceOrder;
    });
    group.forEach(({ edge }, index) => {
      const distributed = nodesById.get(endpoint)?.style?.ports?.[face] === "distributed";
      const fraction = distributed ? (index + 1) / (group.length + 1) - 0.5 : 0;
      assignments.set(edge, {
        ...(assignments.get(edge) ?? {}),
        ...(role === "source"
          ? { branchPortIndex: index, branchPortCount: group.length, sourcePortFraction: fraction }
          : { mergePortIndex: index, mergePortCount: group.length, targetPortFraction: fraction }),
      });
    });
  });
  return edges.map((edge) => ({ ...edge, ...(assignments.get(edge) ?? {}) }));
}

function assignCells(nodes, edges) {
  const positions = new Map();
  const occupied = new Set();
  const first = nodes[0];
  if (first) {
    positions.set(first.id, { x: 0, y: 0 });
    occupied.add(cellKey(0, 0));
  }

  // Edges are emitted in source order. Repeated passes let merges and mixed
  // directions settle once their source has been placed.
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const from = positions.get(edge.from);
      const target = positions.get(edge.to);
      if (!from && target) {
        const direction = edgeLayoutDirection(edge);
        const vector = VECTORS[direction] ?? VECTORS.right;
        const base = { x: target.x - vector.x, y: target.y - vector.y };
        const position = freeCandidate(base, OPPOSITE_DIRECTIONS[direction] ?? "left", occupied);
        positions.set(edge.from, position);
        occupied.add(cellKey(position.x, position.y));
        changed = true;
        continue;
      }
      if (!from || target) continue;
      if (edge.kind === "merge") {
        const incoming = edges.filter((candidate) => candidate.kind === "merge" && candidate.to === edge.to);
        const sources = incoming.map((candidate) => positions.get(candidate.from));
        if (sources.some((position) => !position)) continue;
        const direction = edgeLayoutDirection(edge);
        const base = direction === "left"
          ? { x: Math.min(...sources.map((position) => position.x)) - 1, y: median(sources.map((position) => position.y)) }
          : direction === "right"
            ? { x: Math.max(...sources.map((position) => position.x)) + 1, y: median(sources.map((position) => position.y)) }
            : direction === "up"
              ? { x: median(sources.map((position) => position.x)), y: Math.min(...sources.map((position) => position.y)) - 1 }
              : { x: median(sources.map((position) => position.x)), y: Math.max(...sources.map((position) => position.y)) + 1 };
        const position = freeCandidate(base, direction, occupied);
        positions.set(edge.to, position);
        occupied.add(cellKey(position.x, position.y));
        changed = true;
        continue;
      }
      const branchBase = branchCandidate(edge, edges, from);
      const direction = edgeLayoutDirection(edge);
      const position = branchBase ? freeCandidate(branchBase, direction, occupied) : freeCell(from, direction, occupied);
      positions.set(edge.to, position);
      occupied.add(cellKey(position.x, position.y));
      changed = true;
    }
  }

  // Seed each disconnected component below the completed components, then
  // run its own relationships. This preserves earlier component geometry.
  while (nodes.some((node) => !positions.has(node.id))) {
    const root = nodes.find((node) => !positions.has(node.id));
    const occupiedRows = [...positions.values()].map((position) => position.y);
    const occupiedColumns = [...positions.values()].map((position) => position.x);
    const orphanRow = (occupiedRows.length ? Math.max(...occupiedRows) : -2) + 2;
    const orphanColumn = (occupiedColumns.length ? Math.max(...occupiedColumns) : -2) + 2;
    positions.set(root.id, { x: orphanColumn, y: orphanRow });
    occupied.add(cellKey(orphanColumn, orphanRow));
    let componentChanged = true;
    while (componentChanged) {
      componentChanged = false;
      for (const edge of edges) {
        const from = positions.get(edge.from);
        const target = positions.get(edge.to);
        if (!from && target) {
          const direction = edgeLayoutDirection(edge);
          const vector = VECTORS[direction] ?? VECTORS.right;
          const base = { x: target.x - vector.x, y: target.y - vector.y };
          const position = freeCandidate(base, OPPOSITE_DIRECTIONS[direction] ?? "left", occupied);
          positions.set(edge.from, position);
          occupied.add(cellKey(position.x, position.y));
          componentChanged = true;
          continue;
        }
        if (!from || target) continue;
        const incoming = edge.kind === "merge" ? edges.filter((candidate) => candidate.kind === "merge" && candidate.to === edge.to) : [];
        const sources = incoming.map((candidate) => positions.get(candidate.from));
        if (incoming.length && sources.some((position) => !position)) continue;
        const direction = edgeLayoutDirection(edge);
        const branchBase = branchCandidate(edge, edges, from);
        const base = incoming.length
          ? direction === "left" ? { x: Math.min(...sources.map((position) => position.x)) - 1, y: median(sources.map((position) => position.y)) }
            : direction === "right" ? { x: Math.max(...sources.map((position) => position.x)) + 1, y: median(sources.map((position) => position.y)) }
              : direction === "up" ? { x: median(sources.map((position) => position.x)), y: Math.min(...sources.map((position) => position.y)) - 1 }
                : { x: median(sources.map((position) => position.x)), y: Math.max(...sources.map((position) => position.y)) + 1 }
          : branchBase ?? freeCell(from, direction, occupied);
        const position = incoming.length || branchBase ? freeCandidate(base, direction, occupied) : base;
        positions.set(edge.to, position);
        occupied.add(cellKey(position.x, position.y));
        componentChanged = true;
      }
    }
  }
  return positions;
}

function compactSiblingBranches(nodes, edges, options) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incomingCount = new Map();
  edges.forEach((edge) => incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1));
  const groups = new Map();
  edges.forEach((edge) => {
    if (edge.kind !== "branch") return;
    const key = `${edge.from}|${edgeLayoutDirection(edge)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  });
  const translatePath = (id, axis, delta, visited = new Set()) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    node[axis] += delta;
    edges.filter((edge) => edge.kind === "branch" && edge.from === id && (incomingCount.get(edge.to) ?? 0) === 1)
      .forEach((edge) => translatePath(edge.to, axis, delta, visited));
  };
  groups.forEach((group) => {
    if (group.length < 2) return;
    const source = byId.get(group[0].from);
    const targets = group.map((edge) => byId.get(edge.to));
    if (!source || targets.some((target) => !target)) return;
    const vertical = ["up", "down"].includes(edgeLayoutDirection(group[0]));
    const axis = vertical ? "x" : "y";
    const size = vertical ? "width" : "layoutHeight";
    const sourceCenter = source[axis] + source[size] / 2;
    const gutter = vertical ? options.horizontalGutter : options.verticalGutter;
    const span = targets.reduce((total, target) => total + target[size], 0) + gutter * (targets.length - 1);
    let cursor = sourceCenter - span / 2;
    targets.forEach((target) => {
      const delta = cursor - target[axis];
      translatePath(target.id, axis, delta);
      cursor += target[size] + gutter;
    });
  });
  return nodes;
}

function resolveNodeCollisions(nodes, options) {
  const placed = [];
  const overlaps = (first, second) => first.x < second.x + second.width
    && second.x < first.x + first.width
    && first.y < second.y + second.layoutHeight
    && second.y < first.y + first.layoutHeight;
  nodes.forEach((node) => {
    let blocker;
    while ((blocker = placed.find((candidate) => overlaps(node, candidate)))) {
      const horizontalShift = blocker.x + blocker.width + options.horizontalGutter - node.x;
      const verticalShift = blocker.y + blocker.layoutHeight + options.verticalGutter - node.y;
      if (horizontalShift < verticalShift) {
        node.x += horizontalShift;
      } else {
        node.y += verticalShift;
      }
    }
    placed.push(node);
  });
  return nodes;
}

/**
 * Compact sibling lanes are positioned around their source after the main grid
 * is built. Anchor them to the source track during grid sizing so their
 * temporary fractional cells do not insert empty columns or rows into
 * unrelated paths.
 */
function gridCellsWithoutCompactSiblingLanes(cells, edges) {
  const gridCells = new Map([...cells].map(([id, position]) => [id, { ...position }]));
  const compactVerticalTargets = new Set();
  const compactHorizontalTargets = new Set();
  const groups = new Map();
  edges.forEach((edge) => {
    if (edge.kind !== "branch") return;
    const key = `${edge.from}|${edgeLayoutDirection(edge)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  });
  groups.forEach((group) => {
    if (group.length < 2) return;
    const source = cells.get(group[0].from);
    if (!source) return;
    const vertical = ["up", "down"].includes(edgeLayoutDirection(group[0]));
    group.forEach((edge) => {
      const target = gridCells.get(edge.to);
      if (!target) return;
      if (vertical) {
        target.x = source.x;
        compactVerticalTargets.add(edge.to);
      } else {
        target.y = source.y;
        compactHorizontalTargets.add(edge.to);
      }
    });
  });
  return { gridCells, compactVerticalTargets, compactHorizontalTargets };
}

export function layoutDiagram(nodes, edges, overrides = {}) {
  const options = { ...DEFAULT_LAYOUT, ...overrides };
  const cells = alignTerminalMergeSources(assignCells(nodes, edges), edges);
  const routedEdges = assignConnectionPorts(nodes, edges, cells);
  const { gridCells, compactVerticalTargets, compactHorizontalTargets } = gridCellsWithoutCompactSiblingLanes(cells, edges);
  const xValues = [...new Set([...gridCells.values()].map((position) => position.x))].sort((a, b) => a - b);
  const yValues = [...new Set([...gridCells.values()].map((position) => position.y))].sort((a, b) => a - b);
  const columnWidths = new Map(xValues.map((x) => [x, Math.max(...nodes
    .filter((node) => gridCells.get(node.id).x === x && !compactVerticalTargets.has(node.id))
    .map((node) => node.width ?? 150), 0)]));
  const rowHeights = new Map(yValues.map((y) => [y, Math.max(...nodes
    .filter((node) => gridCells.get(node.id).y === y && !compactHorizontalTargets.has(node.id))
    .map((node) => node.layoutHeight ?? node.height ?? 42), 0)]));
  const columnLeft = new Map();
  const rowTop = new Map();
  let cursor = options.padding;
  xValues.forEach((x) => {
    columnLeft.set(x, cursor);
    cursor += columnWidths.get(x) + options.horizontalGutter;
  });
  const width = cursor - options.horizontalGutter + options.padding;
  cursor = options.padding;
  yValues.forEach((y) => {
    rowTop.set(y, cursor);
    cursor += rowHeights.get(y) + options.verticalGutter;
  });
  const height = cursor - options.verticalGutter + options.padding;

  const placed = nodes.map((node) => {
    const cell = cells.get(node.id);
    const gridCell = gridCells.get(node.id);
    const nodeWidth = node.width ?? 150;
    const nodeHeight = node.height ?? 42;
    const layoutHeight = node.layoutHeight ?? nodeHeight;
    return {
      ...node,
      rank: cell.x,
      x: columnLeft.get(gridCell.x) + (columnWidths.get(gridCell.x) - nodeWidth) / 2,
      y: rowTop.get(gridCell.y) + (rowHeights.get(gridCell.y) - layoutHeight) / 2,
      width: nodeWidth,
      height: nodeHeight,
      layoutHeight,
    };
  });
  compactSiblingBranches(placed, edges, options);
  resolveNodeCollisions(placed, options);

  return { nodes: placed, edges: routedEdges, width, height, options };
}

/** Translate structural flow descendants with their manually moved ancestors. */
export function inheritedFlowOffsets(nodes, edges) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const parentByTarget = new Map();
  edges.filter((edge) => edge.kind === "branch").forEach((edge) => {
    if (!parentByTarget.has(edge.to)) parentByTarget.set(edge.to, edge.from);
  });
  const memo = new Map();
  const resolve = (id, visiting = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    const parentId = parentByTarget.get(id);
    if (!parentId || visiting.has(id)) return { x: 0, y: 0 };
    const parent = nodesById.get(parentId);
    if (!parent) return { x: 0, y: 0 };
    const inherited = resolve(parentId, new Set([...visiting, id]));
    const result = { x: inherited.x + (parent.offsetX ?? 0), y: inherited.y + (parent.offsetY ?? 0) };
    memo.set(id, result);
    return result;
  };
  nodes.forEach((node) => { if (!memo.has(node.id)) memo.set(node.id, resolve(node.id)); });
  return memo;
}

/** Apply a drag delta only to explicitly selected nodes. */
export function independentMoveOffsets(nodes, _edges, selectedIds, dx, dy) {
  const selected = new Set(selectedIds);
  return nodes.filter((node) => selected.has(node.id)).map((node) => ({
    ...node,
    offsetX: (node.offsetX ?? 0) + dx,
    offsetY: (node.offsetY ?? 0) + dy,
  }));
}

export function cleanupAlignmentOffsets(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, { ...node }]));
  const changed = new Map();
  const mergeSourceIds = new Set(edges.filter((edge) => edge.kind === "merge").map((edge) => edge.from));
  const centerX = (node) => node.x + node.width / 2;
  const centerY = (node) => node.y + node.height / 2;
  const verticalDirection = (direction) => direction === "up" || direction === "down";
  const directionSign = (direction) => direction === "left" || direction === "up" ? -1 : 1;
  const remember = (node) => {
    node.offsetX = Math.round((node.offsetX ?? 0) * 10) / 10;
    node.offsetY = Math.round((node.offsetY ?? 0) * 10) / 10;
    if (Math.abs(node.offsetX) < 0.05) node.offsetX = 0;
    if (Math.abs(node.offsetY) < 0.05) node.offsetY = 0;
    changed.set(node.id, { kind: "offset", id: node.id, lineNumber: node.lineNumber, offsetX: node.offsetX, offsetY: node.offsetY });
  };

  // Tiny drag offsets are always accidental noise. Removing them directly also
  // handles branch/merge junctions where moving for one connector could disturb
  // another connector.
  byId.forEach((node) => {
    for (const axis of ["X", "Y"]) {
      const key = `offset${axis}`;
      const coordinate = axis.toLowerCase();
      const offset = node[key] ?? 0;
      if (Math.abs(offset) < 0.05 || Math.abs(offset) > 2) continue;
      node[coordinate] -= offset;
      node[key] = 0;
      remember(node);
    }
  });

  const cleanForwardEdge = (edge) => {
    const source = byId.get(edge.from);
    const target = byId.get(edge.to);
    if (!source || !target || source.hidden || target.hidden) return;
    const mergeCount = edge.kind === "merge" ? edges.filter((candidate) => candidate.kind === "merge" && candidate.to === edge.to).length : 0;
    if (mergeCount > 1) return;
    const sourceDirection = edge.sourceDirection ?? edge.layoutDirection;
    const siblingCount = edge.kind === "branch" ? edges.filter((candidate) => candidate.kind === "branch"
      && candidate.from === edge.from
      && (candidate.sourceDirection ?? candidate.layoutDirection) === sourceDirection).length : 0;
    if (siblingCount > 1 || edge.kind === "branch" && mergeSourceIds.has(edge.to)) return;
    const targetDirection = edge.targetLayoutDirection ?? edge.layoutDirection;
    const sourceVertical = verticalDirection(sourceDirection);
    const targetVertical = verticalDirection(targetDirection);
    const adjustX = targetVertical;
    const perpendicularOffset = adjustX ? target.offsetX ?? 0 : target.offsetY ?? 0;
    if (Math.abs(perpendicularOffset) < 0.05) return;
    const sourcePortOffset = (edge.sourcePortFraction ?? 0) * (sourceVertical ? source.width : source.height);
    const targetPortOffset = (edge.targetPortFraction ?? 0) * (targetVertical ? target.width : target.height);
    let difference;
    if (sourceVertical) {
      const sourcePortX = centerX(source) + sourcePortOffset;
      const targetPortY = centerY(target) + targetPortOffset;
      difference = targetVertical
        ? sourcePortX - (centerX(target) + targetPortOffset)
        : source.y + (sourceDirection === "down" ? source.height : 0) + directionSign(sourceDirection) * 24 - targetPortY;
    } else {
      const sourcePortY = centerY(source) + sourcePortOffset;
      const targetPortX = centerX(target) + targetPortOffset;
      difference = targetVertical
        ? source.x + (sourceDirection === "right" ? source.width : 0) + directionSign(sourceDirection) * 24 - targetPortX
        : sourcePortY - (centerY(target) + targetPortOffset);
    }
    if (Math.abs(difference) < 0.05) return;
    if (adjustX) target.x += difference;
    else target.y += difference;
    target.offsetX = (target.offsetX ?? 0) + (adjustX ? difference : 0);
    target.offsetY = (target.offsetY ?? 0) + (adjustX ? 0 : difference);
    remember(target);
  };
  const cleanMergeSource = (edge) => {
    const source = byId.get(edge.from);
    const target = byId.get(edge.to);
    if (!source || !target || source.hidden || target.hidden) return;
    if (edges.some((candidate) => candidate.from === edge.from && candidate.kind !== "merge")) return;
    const sourceDirection = edge.sourceDirection ?? edge.layoutDirection;
    const targetDirection = edge.targetLayoutDirection ?? edge.layoutDirection;
    const sourceVertical = verticalDirection(sourceDirection);
    if (sourceVertical !== verticalDirection(targetDirection)) return;
    const sourcePortOffset = (edge.sourcePortFraction ?? 0) * (sourceVertical ? source.width : source.height);
    const targetPortOffset = (edge.targetPortFraction ?? 0) * (sourceVertical ? target.width : target.height);
    const difference = sourceVertical
      ? centerX(target) + targetPortOffset - (centerX(source) + sourcePortOffset)
      : centerY(target) + targetPortOffset - (centerY(source) + sourcePortOffset);
    const perpendicularOffset = sourceVertical ? source.offsetX ?? 0 : source.offsetY ?? 0;
    if (Math.abs(perpendicularOffset) < 0.05 || Math.abs(difference) < 0.05 || Math.abs(difference) > 32) return;
    if (sourceVertical) source.x += difference;
    else source.y += difference;
    source.offsetX = (source.offsetX ?? 0) + (sourceVertical ? difference : 0);
    source.offsetY = (source.offsetY ?? 0) + (sourceVertical ? 0 : difference);
    remember(source);
  };

  // Reach a fixed point in one invocation. A repeated position signature stops
  // contradictory cyclic constraints from oscillating indefinitely.
  const forwardEdges = edges.filter((edge) => edge.kind === "branch" || edge.kind === "merge" && edge.declarationKind === "node");
  const mergeEdges = edges.filter((edge) => edge.kind === "merge" && edge.declarationKind === "merge");
  const signatures = new Set();
  for (let pass = 0; pass < 24; pass += 1) {
    const before = [...byId.values()].map((node) => `${node.id}:${node.offsetX ?? 0},${node.offsetY ?? 0}`).join("|");
    if (signatures.has(before)) break;
    signatures.add(before);
    forwardEdges.forEach(cleanForwardEdge);
    mergeEdges.forEach(cleanMergeSource);
    const after = [...byId.values()].map((node) => `${node.id}:${node.offsetX ?? 0},${node.offsetY ?? 0}`).join("|");
    if (after === before) break;
  }
  return [...changed.values()];
}

/** Align connector ports across graph boundaries by translating whole graphs. */
export function cleanupGraphOffsets(nodes, edges, groups) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ownerByNode = new Map();
  groups.forEach((group) => group.nodeIds.forEach((id) => ownerByNode.set(id, group)));
  const centerX = (node) => node.x + node.width / 2;
  const centerY = (node) => node.y + node.height / 2;
  const verticalDirection = (direction) => direction === "up" || direction === "down";
  const directionSign = (direction) => direction === "left" || direction === "up" ? -1 : 1;
  const constraints = [];
  edges.forEach((edge) => {
    const source = byId.get(edge.from);
    const target = byId.get(edge.to);
    const sourceGroup = ownerByNode.get(edge.from);
    const targetGroup = ownerByNode.get(edge.to);
    if (!source || !target || !sourceGroup || !targetGroup || sourceGroup === targetGroup
      || source.hidden || target.hidden || edge.hidden || sourceGroup.hidden || targetGroup.hidden) return;
    const sourceDirection = edge.sourceDirection ?? edge.layoutDirection;
    const targetDirection = edge.targetLayoutDirection ?? edge.layoutDirection;
    const sourceVertical = verticalDirection(sourceDirection);
    const targetVertical = verticalDirection(targetDirection);
    const axis = targetVertical ? "x" : "y";
    const sourcePortOffset = (edge.sourcePortFraction ?? 0) * (sourceVertical ? source.width : source.height);
    const targetPortOffset = (edge.targetPortFraction ?? 0) * (targetVertical ? target.width : target.height);
    let difference;
    if (sourceVertical) {
      const sourcePortX = centerX(source) + sourcePortOffset;
      const targetPortY = centerY(target) + targetPortOffset;
      difference = targetVertical
        ? sourcePortX - (centerX(target) + targetPortOffset)
        : source.y + (sourceDirection === "down" ? source.height : 0) + directionSign(sourceDirection) * 24 - targetPortY;
    } else {
      const sourcePortY = centerY(source) + sourcePortOffset;
      const targetPortX = centerX(target) + targetPortOffset;
      difference = targetVertical
        ? source.x + (sourceDirection === "right" ? source.width : 0) + directionSign(sourceDirection) * 24 - targetPortX
        : sourcePortY - (centerY(target) + targetPortOffset);
    }
    if (Math.abs(difference) < 0.05 || Math.abs(difference) > 32) return;
    const currentSource = axis === "x" ? sourceGroup.offsetX ?? 0 : sourceGroup.offsetY ?? 0;
    const currentTarget = axis === "x" ? targetGroup.offsetX ?? 0 : targetGroup.offsetY ?? 0;
    constraints.push({ axis, source: sourceGroup.id, target: targetGroup.id, delta: currentTarget - currentSource + difference });
  });

  const next = new Map(groups.map((group) => [group.id, { x: group.offsetX ?? 0, y: group.offsetY ?? 0 }]));
  for (const axis of ["x", "y"]) {
    const axisConstraints = constraints.filter((constraint) => constraint.axis === axis);
    const adjacent = new Map(groups.map((group) => [group.id, []]));
    axisConstraints.forEach((constraint) => {
      adjacent.get(constraint.source)?.push({ id: constraint.target, delta: constraint.delta });
      adjacent.get(constraint.target)?.push({ id: constraint.source, delta: -constraint.delta });
    });
    const remaining = new Set(groups.filter((group) => adjacent.get(group.id)?.length).map((group) => group.id));
    while (remaining.size) {
      const first = remaining.values().next().value;
      const component = [];
      const queue = [first];
      remaining.delete(first);
      while (queue.length) {
        const id = queue.shift();
        component.push(id);
        adjacent.get(id).forEach((neighbor) => {
          if (!remaining.delete(neighbor.id)) return;
          queue.push(neighbor.id);
        });
      }
      const anchor = component.map((id) => groups.find((group) => group.id === id))
        .sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0))[0].id;
      const key = axis;
      for (let iteration = 0; iteration < 24; iteration += 1) {
        component.forEach((id) => {
          if (id === anchor) return;
          const implied = adjacent.get(id).map((neighbor) => next.get(neighbor.id)[key] - neighbor.delta);
          if (implied.length) next.get(id)[key] = implied.reduce((sum, value) => sum + value, 0) / implied.length;
        });
      }
    }
  }
  return groups.flatMap((group) => {
    const position = next.get(group.id);
    const offsetX = Math.round(position.x * 10) / 10;
    const offsetY = Math.round(position.y * 10) / 10;
    if (Math.abs(offsetX - (group.offsetX ?? 0)) < 0.05 && Math.abs(offsetY - (group.offsetY ?? 0)) < 0.05) return [];
    return [{ id: group.id, lineNumber: group.lineNumber, offsetX, offsetY }];
  });
}

export function arrangeNodeOffsets(nodes, action) {
  const targets = nodes.map((node) => ({ ...node }));
  if (targets.length < 2) return targets;
  const centerX = (node) => node.x + node.width / 2;
  const centerY = (node) => node.y + node.height / 2;
  if (["left", "center", "right", "top", "middle", "bottom"].includes(action)) {
    const horizontalAlignment = ["left", "center", "right"].includes(action);
    const read = action === "left" ? (node) => node.x
      : action === "right" ? (node) => node.x + node.width
        : action === "top" ? (node) => node.y
          : action === "bottom" ? (node) => node.y + node.height
            : action === "center" ? centerX : centerY;
    const goal = targets.reduce((sum, node) => sum + read(node), 0) / targets.length;
    targets.forEach((node) => {
      const delta = goal - read(node);
      node.offsetX += horizontalAlignment ? delta : 0;
      node.offsetY += horizontalAlignment ? 0 : delta;
    });
    return targets;
  }
  const horizontal = action === "horizontal";
  const start = (node) => horizontal ? node.x : node.y;
  const size = (node) => horizontal ? node.width : node.height;
  targets.sort((a, b) => start(a) - start(b));
  const first = start(targets[0]);
  const lastEdge = start(targets.at(-1)) + size(targets.at(-1));
  const occupied = targets.reduce((sum, node) => sum + size(node), 0);
  const gap = (lastEdge - first - occupied) / (targets.length - 1);
  let cursor = first;
  targets.forEach((node) => {
    const delta = cursor - start(node);
    node.offsetX += horizontal ? delta : 0;
    node.offsetY += horizontal ? 0 : delta;
    cursor += size(node) + gap;
  });
  return targets;
}
