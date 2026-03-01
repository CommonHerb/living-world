'use strict';

const { WebSocketServer } = require('ws');
const { createWorld, tickWorld } = require('./world');
const {
  formatStatus, formatRecentEvents, formatPeople, formatLook,
  formatMap, formatFactions, formatStats, formatHelp, formatChronicleDisplay,
} = require('./display');
const { formatChronicle } = require('./chronicle');

const DEFAULT_SEED = 48271;
const TICK_INTERVAL = 1000; // ms

class SimulationServer {
  constructor(port = 3000, seed = DEFAULT_SEED) {
    this.port = port;
    this.world = createWorld(seed);
    this.running = false;
    this.tickTimer = null;
    this.wss = null;
  }

  start() {
    this.wss = new WebSocketServer({ port: this.port });
    console.log(`Living World server started on ws://localhost:${this.port}`);
    console.log(`Seed: ${this.world.seed}`);

    this.wss.on('connection', (ws) => {
      console.log('Client connected');
      ws.send(formatStatus(this.world) + '\n\nRecent Events:\n' + formatRecentEvents(this.world) + '\n\n> ');

      ws.on('message', (data) => {
        const input = data.toString().trim();
        const response = this.handleCommand(input);
        if (response !== null) {
          ws.send(response + '\n\n> ');
        }
      });

      ws.on('close', () => console.log('Client disconnected'));
    });
  }

  handleCommand(input) {
    const [cmd, ...args] = input.toLowerCase().split(/\s+/);

    switch (cmd) {
      case 'tick':
      case 't': {
        const count = parseInt(args[0]) || 1;
        return this.advanceTicks(count);
      }

      case 'run':
        if (this.running) return 'Already running.';
        this.running = true;
        this.tickTimer = setInterval(() => {
          const events = tickWorld(this.world);
          this.broadcast(formatTickSummary(this.world, events));
        }, TICK_INTERVAL);
        return 'Simulation running. Type "stop" to pause.';

      case 'stop':
        if (!this.running) return 'Not running.';
        this.running = false;
        clearInterval(this.tickTimer);
        return 'Simulation paused.';

      case 'status':
      case 's':
        return formatStatus(this.world) + '\n\nRecent Events:\n' + formatRecentEvents(this.world);

      case 'map':
        return formatMap(this.world);

      case 'people':
      case 'p':
        return formatPeople(this.world);

      case 'look': {
        // Accept original case for name lookup
        const name = input.split(/\s+/).slice(1).join(' ');
        return formatLook(this.world, name);
      }

      case 'factions':
        return formatFactions(this.world);

      case 'stats':
        return formatStats(this.world);

      case 'history':
        return formatRecentEvents(this.world, 20);

      case 'chronicle':
        return formatChronicle(this.world.chronicle, parseInt(args[0]) || 20);

      case 'seed':
        return `Seed: ${this.world.seed}`;

      case 'help':
        return formatHelp();

      case 'quit':
        return 'Goodbye.';

      default:
        return `Unknown command: "${cmd}". Type "help" for commands.`;
    }
  }

  advanceTicks(count) {
    const lines = [];
    for (let i = 0; i < count; i++) {
      const events = tickWorld(this.world);
      if (count === 1) {
        lines.push(formatTickSummary(this.world, events));
      }
    }
    if (count > 1) {
      lines.push(`Advanced ${count} ticks to Day ${this.world.tick}.`);
      lines.push('');
      lines.push(formatStatus(this.world));
      // Show notable events from the batch
      const notable = this.world.history
        .slice(-count * 3)
        .filter(e => e.type === 'election' || e.type === 'crisis' || e.type === 'hunger');
      if (notable.length > 0) {
        lines.push('\nNotable events:');
        for (const e of notable.slice(-10)) {
          lines.push(`  Day ${e.tick}: ${e.text}`);
        }
      }
    }
    return lines.join('\n');
  }

  broadcast(msg) {
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if (client.readyState === 1) { // OPEN
        client.send(msg + '\n\n> ');
      }
    }
  }

  close() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.wss) this.wss.close();
  }
}

function formatTickSummary(world, events) {
  const lines = [`\nDay ${world.tick}:`];
  for (const e of events) {
    if (e.type !== 'economy') {
      lines.push(`  ${e.text}`);
    }
  }
  // Always show economy summary
  const econ = events.find(e => e.type === 'economy');
  if (econ) lines.push(`  ${econ.text}`);
  return lines.join('\n');
}

module.exports = { SimulationServer };
