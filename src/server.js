'use strict';

const { WebSocketServer } = require('ws');
const { createWorld, tickWorld } = require('./world');
const {
  formatStatus, formatRecentEvents, formatPeople, formatLook,
  formatMap, formatFactions, formatStats, formatHelp, formatMarket,
  formatChronicleDisplay,
} = require('./display');
const { formatChronicle } = require('./chronicle');
const {
  formatNewspaper, formatTalk, formatSettlementLook, formatHistory,
} = require('./narrative');
const { formatDiagnostics } = require('./diagnostics');
const { HerbVM } = require('./herb-vm');
const { formatCrime } = require('./crime');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_SEED = 48271;
const TICK_INTERVAL = 1000; // ms

class SimulationServer {
  constructor(port = 3000, seed = DEFAULT_SEED) {
    this.port = port;
    this.world = createWorld(seed);
    this.vm = new HerbVM();
    this.lawsDir = path.join(__dirname, '..', 'laws');
    this.running = false;
    this.tickTimer = null;
    this.wss = null;
  }

  start() {
    // Create HTTP server for serving index.html
    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        const htmlPath = path.join(__dirname, '..', 'index.html');
        fs.readFile(htmlPath, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data);
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.httpServer.listen(this.port);
    console.log(`Living World server started on http://localhost:${this.port}`);
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

      case 'look':
      case 'l': {
        const name = input.split(/\s+/).slice(1).join(' ');
        if (!name) return formatSettlementLook(this.world);
        return formatLook(this.world, name);
      }

      case 'talk': {
        const name = input.split(/\s+/).slice(1).join(' ');
        return formatTalk(this.world, name);
      }

      case 'news': {
        const sub = args[0];
        if (sub === 'all') return formatNewspaper(this.world, 30);
        return formatNewspaper(this.world, 5);
      }

      case 'market':
      case 'm':
        return formatMarket(this.world);

      case 'factions':
        return formatFactions(this.world);

      case 'stats':
        return formatStats(this.world);

      case 'history':
        return formatHistory(this.world);

      case 'chronicle':
        return formatChronicle(this.world.chronicle, parseInt(args[0]) || 20);

      case 'crime': {
        // Show crime stats for all settlements
        const crimeLines = [];
        if (this.world.settlements) {
          for (const s of this.world.settlements) {
            crimeLines.push(`\n── ${s.name} ──`);
            crimeLines.push(formatCrime(s));
          }
          return crimeLines.join('\n');
        }
        return formatCrime(this.world);
      }

      case 'seed':
        return `Seed: ${this.world.seed}`;

      case 'diag':
      case 'diagnostics':
        return formatDiagnostics(this.world);

      case 'law':
      case 'laws':
        return this.handleLaw(input);

      case 'help':
        return formatHelp();

      case 'quit':
        return 'Goodbye.';

      default:
        return `Unknown command: "${cmd}". Type "help" for commands.`;
    }
  }

  handleLaw(input) {
    const parts = input.split(/\s+/);
    const sub = parts[1];
    const arg = parts.slice(2).join(' ');

    if (!sub || sub === 'list') {
      const laws = this.vm.listLaws();
      if (laws.length === 0) return 'No laws enacted.';
      const lines = ['=== ACTIVE LAWS ==='];
      for (const law of laws) {
        lines.push(`  ${law.name} — ${law.description} (${law.tensions} tensions, passed ${law.passed})`);
      }
      lines.push('', this.vm.status());
      return lines.join('\n');
    }

    if (sub === 'load') {
      if (!arg) return 'Usage: law load <filename>';
      // Try relative to laws dir, then absolute
      let filePath = path.join(this.lawsDir, arg);
      if (!fs.existsSync(filePath)) {
        if (!arg.endsWith('.herb.json')) filePath = path.join(this.lawsDir, arg + '.herb.json');
      }
      if (!fs.existsSync(filePath)) return `File not found: ${arg}`;
      try {
        const name = this.vm.loadFile(filePath);
        return `Law enacted: ${name}\n\n${this.vm.status()}`;
      } catch (e) {
        return `Error loading law: ${e.message}`;
      }
    }

    if (sub === 'repeal') {
      if (!arg) return 'Usage: law repeal <name>';
      const laws = this.vm.listLaws();
      const match = laws.find(l => l.name === arg || l.name === `law.${arg}`);
      if (!match) return `No active law named "${arg}". Use "law list" to see active laws.`;
      this.vm.unload(match.name);
      return `Law repealed: ${match.name}`;
    }

    if (sub === 'tick') {
      const result = this.vm.tick();
      if (result.iterations === 0) return 'HERB VM tick: fixpoint reached immediately (no tensions fired).';
      const lines = [`HERB VM tick: ${result.iterations} iterations`];
      for (const entry of result.log) {
        if (entry.tension) lines.push(`  ${entry.tension}: ${entry.actions} actions`);
        if (entry.warning) lines.push(`  ⚠ ${entry.warning}`);
      }
      return lines.join('\n');
    }

    if (sub === 'status') {
      return this.vm.status();
    }

    return 'Usage: law [list|load <file>|repeal <name>|tick|status]';
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
    if (this.httpServer) this.httpServer.close();
  }
}

function formatTickSummary(world, events) {
  const { getTimeOfDay } = require('./social');
  const time = getTimeOfDay(world.tick);
  const timeLabel = time === 'day' ? '☀️ Day' : time === 'evening' ? '🌅 Evening' : '🌙 Night';
  const lines = [`\nDay ${world.tick} (${timeLabel}):`];

  // Show non-economy, non-social events first
  for (const e of events) {
    if (e.type !== 'economy' && !e.type.startsWith('speech') && !e.type.startsWith('social_')) {
      lines.push(`  ${e.text}`);
    }
  }

  // Economy summary
  const econ = events.find(e => e.type === 'economy');
  if (econ) lines.push(`  ${econ.text}`);

  // Social events (speech bubbles + interactions) — show a sample
  const socialEvents = events.filter(e => e.type === 'speech' || e.type.startsWith('social_'));
  if (socialEvents.length > 0) {
    lines.push('');
    // Show up to 5 social events to avoid flooding
    const shown = socialEvents.slice(0, 5);
    for (const se of shown) {
      lines.push(`  ${se.text}`);
    }
    if (socialEvents.length > 5) {
      lines.push(`  ... and ${socialEvents.length - 5} more social moments.`);
    }
  }

  return lines.join('\n');
}

module.exports = { SimulationServer };
