import { FalkorDB } from 'falkordb';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Thin wrapper around falkordb-ts: one connection, one named graph, parameterised queries only.
 * Every Cypher statement in this project is passed with `params` — never string-interpolated values.
 */
export class GraphClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.db = null;
    this.graph = null;
  }

  async connect({ retries = 10, delayMs = 1000 } = {}) {
    const { host, port, username, password, tls, graph } = this.cfg;
    const options = { password, socket: { host, port, connectTimeout: 4000, ...(tls ? { tls: true } : {}) } };
    if (username) options.username = username;
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        this.db = await FalkorDB.connect(options);
        this.graph = this.db.selectGraph(graph);
        await this.graph.query('RETURN 1');
        return this;
      } catch (err) {
        lastErr = err;
        try { await this.db?.close(); } catch { /* ignore */ }
        this.db = null;
        if (i < retries - 1) await sleep(delayMs);
      }
    }
    throw new Error(`Cannot connect to FalkorDB at ${host}:${port}: ${lastErr?.message}`);
  }

  /** Run a parameterised query; returns an array of row objects. */
  async query(cypher, params = {}) {
    const res = await this.graph.query(cypher, { params, TIMEOUT: this.cfg.queryTimeoutMs });
    return res.data ?? [];
  }

  /** Read-only variant (can be served by replicas). */
  async read(cypher, params = {}) {
    const res = await this.graph.roQuery(cypher, { params, TIMEOUT: this.cfg.queryTimeoutMs });
    return res.data ?? [];
  }

  async ping() {
    const t = Date.now();
    await this.graph.query('RETURN 1');
    return Date.now() - t;
  }

  async info() {
    // Version of the FalkorDB module as reported by the server.
    try {
      const mods = await this.db.sendCommand?.(['MODULE', 'LIST']);
      return mods;
    } catch { return null; }
  }

  async close() {
    try { await this.db?.close(); } catch { /* ignore */ }
  }
}

/** Convert a node returned by the client into a flat property object. */
export const props = (node) => (node && node.properties ? node.properties : node);
