// The waypoint graph the bots walk. Nodes are open ground with line of sight to their
// neighbours; edges are hand-placed so a route never cuts through a wall. Pathfinding is
// breadth-first search over this small graph (tens of nodes), so a route costs almost
// nothing and never allocates per frame: the queue and the visited set are reused.
export function createNav(nodes, edges) {
  const adjacency = nodes.map(() => []);
  for (const [a, b] of edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  const queue = [];
  const cameFrom = new Int16Array(nodes.length);
  const visited = new Uint8Array(nodes.length);

  function nearest(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const dx = nodes[i][0] - x;
      const dz = nodes[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // Returns the node indices from `from` to `to`, start inclusive, into `out`.
  function route(from, to, out) {
    out.length = 0;
    if (from === to) {
      out.push(to);
      return out;
    }
    visited.fill(0);
    queue.length = 0;
    queue.push(from);
    visited[from] = 1;
    cameFrom[from] = -1;
    let found = false;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      if (current === to) {
        found = true;
        break;
      }
      for (const next of adjacency[current]) {
        if (!visited[next]) {
          visited[next] = 1;
          cameFrom[next] = current;
          queue.push(next);
        }
      }
    }
    if (!found) {
      out.push(to);
      return out;
    }
    const reversed = [];
    let node = to;
    while (node !== -1) {
      reversed.push(node);
      node = cameFrom[node];
    }
    for (let i = reversed.length - 1; i >= 0; i -= 1) out.push(reversed[i]);
    return out;
  }

  return { nodes, adjacency, nearest, route };
}
