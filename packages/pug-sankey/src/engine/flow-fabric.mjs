// A fabric strand is a drawing unit, not a tracked particle or inferred
// provenance. Partial strands preserve the final fractional drawing unit.
export function fabricStrands(thickness, pitch = 4) {
  if (!(thickness > 0) || !(pitch > 0)) return [];
  const strands = [];
  for (let cursor=0;cursor<thickness;cursor+=pitch) {
    const width=Math.min(pitch,thickness-cursor);
    strands.push({ offset:-thickness/2+cursor+width/2, weight:width/pitch });
  }
  return strands;
}

/** Reachability only: no proportional allocation is inferred at merges. */
export function traceFlowRoute(edges, selection) {
  const nodeIds = new Set(), edgeKeys = new Set();
  const walk = (start, backwards) => {
    const pending=[start], visited=new Set();
    while(pending.length) {
      const id=pending.pop();
      if (visited.has(id)) continue;
      visited.add(id); nodeIds.add(id);
      for(const edge of edges) {
        if(edge[backwards ? 'to' : 'from']!==id) continue;
        edgeKeys.add(edge.key);
        pending.push(edge[backwards ? 'from' : 'to']);
      }
    }
  };
  if(selection.node) {
    walk(selection.node.id,true); walk(selection.node.id,false);
  } else {
    edgeKeys.add(selection.edge.key);
    walk(selection.edge.from,true); walk(selection.edge.to,false);
  }
  return { nodeIds,edgeKeys };
}
