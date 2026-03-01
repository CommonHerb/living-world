'use strict';

const { WebSocketServer } = require('ws');
const { createWorld, tickWorld, getSettlement } = require('./world');
const {
  formatStatus, formatRecentEvents, formatPeople, formatLook,
  formatMap, formatFactions, formatStats, formatHelp, formatMarket,
  formatSettlements,
} = require('./display');
const { formatChronicle } = require('./chronicle');
const {
  formatNewspaper, formatTalk, formatSettlementLook, formatHistory,
} = require('./narrative');
const { formatDiagnostics } = require('./diagnostics');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_SEED = 48271;
const TICK_INTERVAL = 1000;

class SimulationServer {
  constructor(port = 3000, seed = DEFAULT_SEED) {
    this.port = port;
    this.world = createWorld(seed);
    this.lawsDir = path.join(__dirname, '..', 'laws');
    this.running = false;
    this.tickTimer = null;
    this.wss = null;
    // Track active settlement per client
    this.activeSettlement = new Map(); // ws → settlementId
  }

  getActiveSettlementId(ws) {
    return this.activeSettlement.get(ws) || this.world.settlements[0].id;
  }

  start() {
    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        const htmlPath = path.join(__dirname, '..', 'index.html');
        fs.readFile(htmlPath, (err, data) => {
          if (err) { res.writeHead(404); res.end('Not found'); return; }
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
    console.log(`Settlements: ${this.world.settlements.map(s => s.name).join(', ')}`);

    this.wss.on('connection', (ws) => {
      console.log('Client connected');
      this.activeSettlement.set(ws, this.world.settlements[0].id);
      ws.send(formatSettlements(this.world) + '\n\n> ');

      ws.on('message', (data) => {
        const input = data.toString().trim();
        const response = this.handleCommand(input, ws);
        if (response !== null) {
          ws.send(response + '\n\n> ');
        }
      });

      ws.on('close', () => {
        console.log('Client disconnected');
        this.activeSettlement.delete(ws);
      });
    });
  }

  handleCommand(input, ws) {
    const [cmd, ...args] = input.toLowerCase().split(/\s+/);
    const sid = this.getActiveSettlementId(ws);

    switch (cmd) {
      case 'tick':
      case 't': {
        const count = parseInt(args[0]) || 1;
        return this.advanceTicks(count, sid);
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
        return formatStatus(this.world, sid) + '\n\nRecent Events:\n' + formatRecentEvents(this.world, 10, sid);

      case 'settlements':
        return formatSettlements(this.world);

      case 'goto': {
        const name = args.join(' ');
        if (!name) return 'Usage: goto <settlement name>';
        const target = this.world.settlements.find(s => 
          s.name.toLowerCase() === name || s.id === name
        );
        if (!target) return `No settlement named "${name}". Try: ${this.world.settlements.map(s => s.name).join(', ')}`;
        this.activeSettlement.set(ws, target.id);
        return `Now viewing ${target.name}.\n\n` + formatStatus(this.world, target.id);
      }

      case 'map':
        return formatMap(this.world, sid);

      case 'people':
      case 'p':
        return formatPeople(this.world, sid);

      case 'look':
      case 'l': {
        const name = input.split(/\s+/).slice(1).join(' ');
        if (!name) return formatSettlementLook(this.world, sid);
        return formatLook(this.world, name);
      }

      case 'talk': {
        const name = input.split(/\s+/).slice(1).join(' ');
        return formatTalk(this.world, name);
      }

      case 'news': {
        const sub = args[0];
        if (sub === 'all') return formatNewspaper(this.world, 30, sid);
        return formatNewspaper(this.world, 5, sid);
      }

      case 'market':
      case 'm':
        return formatMarket(this.world, sid);

      case 'factions':
        return formatFactions(this.world, sid);

      case 'stats':
        return formatStats(this.world, sid);

      case 'history':
        return formatHistory(this.world, sid);

      case 'chronicle':
        return formatChronicle(
          (this.world.settlements.find(s => s.id === sid) || this.world.settlements[0]).chronicle,
          parseInt(args[0]) || 20
        );

      case 'seed':
        return `Seed: ${this.world.seed}`;

      case 'diag':
      case 'diagnostics':
        return formatDiagnostics(this.world, sid);

      case 'law':
      case 'laws':
        return this.handleLaw(input, sid);

      case 'help':
        return formatHelp();

      case 'quit':
        return 'Goodbye.';

      default:
        return `Unknown command: "${cmd}". Type "help" for commands.`;
    }
  }

  handleLaw(input, settlementId) {
    const settlement = this.world.settlements.find(s => s.id === settlementId) || this.world.settlements[0];
    const vm = settlement.vm;
    const parts = input.split(/\s+/);
    const sub = parts[1];
    const arg = parts.slice(2).join(' ');

    if (!sub || sub === 'list') {
      const laws = vm.listLaws();
      if (laws.length === 0) return `No laws enacted in ${settlement.name}.`;
      const lines = [`=== ${settlement.name.toUpperCase()} ACTIVE LAWS ===`];
      for (const law of laws) {
        lines.push(`  ${law.name} — ${law.description} (${law.tensions} tensions)`);
      }
      lines.push('', vm.status());
      return lines.join('\n');
    }

    if (sub === 'load') {
      if (!arg) return 'Usage: law load <filename>';
      let filePath = path.join(this.lawsDir, arg);
      if (!fs.existsSync(filePath)) {
        if (!arg.endsWith('.herb.json')) filePath = path.join(this.lawsDir, arg + '.herb.json');
      }
      if (!fs.existsSync(filePath)) return `File not found: ${arg}`;
      try {
        const name = vm.loadFile(filePath);
        return `Law enacted in ${settlement.name}: ${name}\n\n${vm.status()}`;
      } catch (e) {
        return `Error loading law: ${e.message}`;
      }
    }

    if (sub === 'repeal') {
      if (!arg) return 'Usage: law repeal <name>';
      const laws = vm.listLaws();
      const match = laws.find(l => l.name === arg || l.name === `law.${arg}`);
      if (!match) return `No active law named "${arg}" in ${settlement.name}.`;
      vm.unload(match.name);
      return `Law repealed in ${settlement.name}: ${match.name}`;
    }

    if (sub === 'tick') {
      const result = vm.tick();
      if (result.iterations === 0) return 'HERB VM tick: fixpoint reached immediately.';
      const lines = [`HERB VM tick: ${result.iterations} iterations`];
      for (const entry of result.log) {
        if (entry.tension) lines.push(`  ${entry.tension}: ${entry.actions} actions`);
        if (entry.warning) lines.push(`  ⚠ ${entry.warning}`);
      }
      return lines.join('\n');
    }

    if (sub === 'status') return vm.status();

    return 'Usage: law [list|load <file>|repeal <name>|tick|status]';
  }

  advanceTicks(count, settlementId) {
    const lines = [];
    for (let i = 0; i < count; i++) {
      const events = tickWorld(this.world);
      if (count === 1) {
        lines.push(formatTickSummary(this.world, events, settlementId));
      }
    }
    if (count > 1) {
      lines.push(`Advanced ${count} ticks to Day ${this.world.tick}.`);
      lines.push('');
      lines.push(formatSettlements(this.world));
    }
    return lines.join('\n');
  }

  broadcast(msg) {
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if (client.readyState === 1) {
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

function formatTickSummary(world, events, settlementId) {
  const lines = [`\nDay ${world.tick}:`];
  
  // Group events by settlement
  for (const s of world.settlements) {
    const sEvents = s.events.filter(e => e.type !== 'economy' && e.type !== 'gossip');
    if (sEvents.length > 0) {
      lines.push(`  [${s.name}]`);
      for (const e of sEvents) {
        lines.push(`    ${e.text}`);
      }
    }
    const econ = s.events.find(e => e.type === 'economy');
    if (econ) lines.push(`  [${s.name}] ${econ.text}`);
  }

  // World events (migration, trade)
  for (const e of world.events) {
    lines.push(`  [WORLD] ${e.text}`);
  }

  return lines.join('\n');
}

module.exports = { SimulationServer };
