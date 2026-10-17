// Agent activity log. Every entry is persisted to FalkorDB (AgentEvent nodes chained by HANDED_OFF_TO)
// from values the agent actually read or wrote; the UI timeline is a plain read of these nodes.
let counter = 0;

export class AgentLog {
  /** @param {import('../graph/memory.js').MemoryStore} memory */
  constructor(memory, { learnerId, sessionId = '', isDemo = false, clock = Date.now }) {
    Object.assign(this, { memory, learnerId, sessionId, isDemo, clock });
  }

  /**
   * @param {'tutor'|'examiner'|'memory_planner'} agent
   * @param {string} action
   * @param {{key:string, retrieved?:object, changed?:object, output?:object, handoff?:string}} data
   */
  async log(agent, action, { key, retrieved = {}, changed = {}, output = {}, handoff = '' }) {
    const prevId = this.sessionId ? await this.memory.lastEventId(this.sessionId) : '';
    const id = `evt:${key}:${agent}:${action}`;
    if (prevId === id) return id;
    await this.memory.logEvent({
      id, learnerId: this.learnerId, sessionId: this.sessionId, agent, action, at: this.clock(), seq: ++counter,
      retrieved: JSON.stringify(retrieved), changed: JSON.stringify(changed), output: JSON.stringify(output),
      isDemo: this.isDemo, prevId: prevId && prevId !== id ? prevId : '', handoff,
    });
    return id;
  }
}
