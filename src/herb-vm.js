/**
 * HERB VM — JavaScript interpreter for .herb.json tension files.
 * 
 * The same JSON format that HERB OS compiles to HAM bytecode,
 * interpreted directly in Node.js for living-world governance.
 * 
 * Four operations: Match, Guard, Emit/Set, Emit/Move.
 * Fixpoint iteration to convergence.
 */

const fs = require('fs');
const path = require('path');

class HerbVM {
  constructor() {
    this.containers = new Map();   // name → Map<id, entity>
    this.tensions = [];            // sorted by priority desc
    this.moves = new Map();        // name → { from, to, entity_type }
    this.laws = new Map();         // programName → program JSON
    this.log = [];                 // actions taken this tick
  }

  // --- Entity Management ---

  addEntity(containerName, entity) {
    if (!this.containers.has(containerName))
      this.containers.set(containerName, new Map());
    const container = this.containers.get(containerName);
    if (!entity._id) entity._id = `${containerName}_${container.size}`;
    container.set(entity._id, entity);
    return entity;
  }

  getContainer(name) {
    return this.containers.get(name) || new Map();
  }

  // --- Program Loading ---

  load(program) {
    // Store the law for listing/repealing
    if (program.name) this.laws.set(program.name, program);

    for (const c of program.containers || []) {
      if (!this.containers.has(c.name))
        this.containers.set(c.name, new Map());
    }
    for (const m of program.moves || [])
      this.moves.set(m.name, m);
    for (const t of program.tensions || []) {
      t._law = program.name || 'unknown';
      this.tensions.push(t);
    }
    this.tensions.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  loadFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const program = JSON.parse(raw);
    this.load(program);
    return program.name || filePath;
  }

  unload(programName) {
    const law = this.laws.get(programName);
    // Run cleanup emits if defined
    if (law && law.cleanup) {
      for (const action of law.cleanup) {
        if (action.set_on) {
          const container = this.containers.get(action.set_on);
          if (container) {
            for (const entity of container.values()) {
              entity[action.property] = action.value;
            }
          }
        }
      }
    }
    this.tensions = this.tensions.filter(t => t._law !== programName);
    // Remove moves defined by this law
    if (law && law.moves) {
      for (const m of law.moves) this.moves.delete(m.name);
    }
    this.laws.delete(programName);
  }

  // --- Expression Evaluation ---

  eval(expr, bindings) {
    if (expr === null || expr === undefined) return expr;
    if (typeof expr === 'number' || typeof expr === 'string' || typeof expr === 'boolean')
      return expr;

    // Property access: { prop: "gold", of: "treasury" }
    if (expr.prop) {
      const entity = bindings[expr.of];
      return entity ? entity[expr.prop] : undefined;
    }

    // Binary operation: { op: "+", left: ..., right: ... }
    if (expr.op) {
      const l = this.eval(expr.left, bindings);
      const r = this.eval(expr.right, bindings);
      switch (expr.op) {
        case '+':  return l + r;
        case '-':  return l - r;
        case '*':  return l * r;
        case '/':  return r !== 0 ? l / r : 0;
        case '%':  return l % r;
        case '==': return l == r;  // intentional loose equality for string/number compat
        case '!=': return l != r;
        case '>':  return l > r;
        case '<':  return l < r;
        case '>=': return l >= r;
        case '<=': return l <= r;
        case '&&': return l && r;
        case '||': return l || r;
      }
    }

    return expr;
  }

  // --- Match Evaluation ---

  matchClause(clause, bindings) {
    // Guard: pure boolean check, no binding
    if (clause.guard) {
      return this.eval(clause.guard, bindings) ? [{}] : [];
    }

    // empty_in: match only if listed containers are empty
    if (clause.empty_in) {
      for (const cname of clause.empty_in) {
        const c = this.containers.get(cname);
        if (c && c.size > 0) return [];
      }
      return [{}];
    }

    const container = this.containers.get(clause.in);
    if (!container || container.size === 0) {
      return clause.required === false ? [null] : [];
    }

    let candidates = [...container.values()];

    // Apply where filter
    if (clause.where) {
      candidates = candidates.filter(e => {
        const testBindings = { ...bindings, [clause.bind]: e };
        return this.eval(clause.where, testBindings);
      });
    }

    // Apply select
    if (clause.select === 'first') candidates = candidates.slice(0, 1);
    if (clause.select === 'max_by' && clause.key) {
      candidates.sort((a, b) => (b[clause.key] || 0) - (a[clause.key] || 0));
      candidates = candidates.slice(0, 1);
    }

    if (candidates.length === 0 && clause.required === false)
      return [null];

    return candidates;
  }

  // --- Single Step (one tension fires) ---

  step() {
    for (const tension of this.tensions) {
      const matchClauses = tension.match || [];
      const bindings = {};
      let matched = true;

      for (const clause of matchClauses) {
        const results = this.matchClause(clause, bindings);
        if (results.length === 0) { matched = false; break; }
        if (clause.bind) bindings[clause.bind] = results[0];
      }

      if (!matched) continue;

      // Buffer actions for this tension, then commit atomically
      const actions = [];
      for (const emit of (tension.emit || [])) {
        if (emit.set) {
          const entity = bindings[emit.set];
          if (!entity) continue;
          const value = this.eval(emit.value, bindings);
          actions.push({ type: 'set', entity, property: emit.property, value });
        }
        if (emit.move) {
          const entity = bindings[emit.entity];
          if (!entity) continue;
          const moveDef = this.moves.get(emit.move);
          if (!moveDef) continue;
          actions.push({ type: 'move', entity, moveDef, to: emit.to });
        }
        if (emit.create) {
          const props = {};
          for (const [k, v] of Object.entries(emit.properties || {})) {
            props[k] = this.eval(v, bindings);
          }
          actions.push({ type: 'create', container: emit.create, properties: props });
        }
      }

      // Commit atomically (TEND)
      for (const action of actions) {
        switch (action.type) {
          case 'set':
            action.entity[action.property] = action.value;
            break;
          case 'move':
            for (const from of action.moveDef.from) {
              const c = this.containers.get(from);
              if (c) c.delete(action.entity._id);
            }
            const target = this.containers.get(action.to);
            if (target) target.set(action.entity._id, action.entity);
            break;
          case 'create': {
            const container = this.containers.get(action.container);
            if (container) {
              const id = `${action.container}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              action.properties._id = id;
              container.set(id, action.properties);
            }
            break;
          }
        }
      }

      if (actions.length > 0) {
        this.log.push({ tension: tension.name, actions: actions.length });
        return true; // Tension fired — need another iteration
      }
    }
    return false; // Fixpoint reached
  }

  // --- Run to fixpoint ---

  tick(maxIterations = 100) {
    this.log = [];
    let i = 0;
    while (i < maxIterations && this.step()) i++;
    if (i >= maxIterations) {
      this.log.push({ warning: 'Hit iteration limit — possible oscillation' });
    }
    return { iterations: i, log: this.log };
  }

  // --- Snapshot / Restore (for dry runs) ---

  snapshot() {
    const snap = {};
    for (const [name, container] of this.containers) {
      snap[name] = {};
      for (const [id, entity] of container) {
        snap[name][id] = { ...entity };
      }
    }
    return snap;
  }

  restore(snap) {
    for (const [name, entities] of Object.entries(snap)) {
      const container = this.containers.get(name) || new Map();
      container.clear();
      for (const [id, entity] of Object.entries(entities)) {
        container.set(id, { ...entity });
      }
      this.containers.set(name, container);
    }
  }

  // --- Info ---

  listLaws() {
    const laws = [];
    for (const [name, law] of this.laws) {
      laws.push({
        name,
        description: law.description || '',
        tensions: (law.tensions || []).length,
        passed: law.passed || 'unknown'
      });
    }
    return laws;
  }

  status() {
    const lines = [];
    lines.push(`Laws: ${this.laws.size}`);
    lines.push(`Tensions: ${this.tensions.length}`);
    lines.push(`Containers: ${this.containers.size}`);
    for (const [name, container] of this.containers) {
      if (container.size > 0) lines.push(`  ${name}: ${container.size} entities`);
    }
    return lines.join('\n');
  }
}

module.exports = { HerbVM };
