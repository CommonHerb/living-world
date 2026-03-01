const { HerbVM } = require('../src/herb-vm');
const path = require('path');

let passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

// --- Test 1: Rationing ---
console.log('\n=== RATIONING LAW ===');
{
  const vm = new HerbVM();
  vm.loadFile(path.join(__dirname, '../laws/rationing.herb.json'));
  vm.addEntity('GRANARY', { _id: 'g1', food: 30 });
  vm.addEntity('STATE', { _id: 's1', rationing: false });
  vm.addEntity('CITIZENS', { _id: 'c1', name: 'Alice', food: 5 });
  vm.addEntity('CITIZENS', { _id: 'c2', name: 'Bob', food: 10 });

  const r1 = vm.tick();
  const state = vm.getContainer('STATE').get('s1');
  assert(state.rationing === true, 'Rationing activated when granary=30');
  const alice = vm.getContainer('CITIZENS').get('c1');
  const bob = vm.getContainer('CITIZENS').get('c2');
  assert(alice.food === 2, `Alice food capped at 2 (got ${alice.food})`);
  assert(bob.food === 2, `Bob food capped at 2 (got ${bob.food})`);

  // Lift rationing
  vm.getContainer('GRANARY').get('g1').food = 120;
  vm.tick();
  assert(state.rationing === false, 'Rationing lifted when granary=120');
}

// --- Test 2: Term Limits ---
console.log('\n=== TERM LIMITS LAW ===');
{
  const vm = new HerbVM();
  vm.loadFile(path.join(__dirname, '../laws/term_limits.herb.json'));
  vm.addEntity('LEADERS', { _id: 'l1', name: 'Mayor Rex', consecutive_terms: 3, active: true, ineligible: false });
  vm.addEntity('LEADERS', { _id: 'l2', name: 'Senator Ada', consecutive_terms: 2, active: true, ineligible: false });

  vm.tick();
  const rex = vm.getContainer('LEADERS').get('l1');
  const ada = vm.getContainer('LEADERS').get('l2');
  assert(rex.active === false, 'Rex removed after 3 terms');
  assert(rex.ineligible === true, 'Rex marked ineligible');
  assert(ada.active === true, 'Ada stays (only 2 terms)');
}

// --- Test 3: Minimum Wage ---
console.log('\n=== MINIMUM WAGE LAW ===');
{
  const vm = new HerbVM();
  vm.loadFile(path.join(__dirname, '../laws/minimum_wage.herb.json'));
  vm.addEntity('TREASURY', { _id: 't1', gold: 100 });
  vm.addEntity('CITIZENS', { _id: 'c1', name: 'Worker1', job: 'farmer', wage: 0.5 });
  vm.addEntity('CITIZENS', { _id: 'c2', name: 'Worker2', job: 'smith', wage: 1.5 });
  vm.addEntity('CITIZENS', { _id: 'c3', name: 'Idle', job: 'none', wage: 0 });

  vm.tick();
  const w1 = vm.getContainer('CITIZENS').get('c1');
  const w2 = vm.getContainer('CITIZENS').get('c2');
  const idle = vm.getContainer('CITIZENS').get('c3');
  const treasury = vm.getContainer('TREASURY').get('t1');
  assert(w1.wage === 1, `Worker1 wage bumped to 1 (got ${w1.wage})`);
  assert(w2.wage === 1.5, `Worker2 unchanged at 1.5 (got ${w2.wage})`);
  assert(idle.wage === 0, `Idle person not affected (got ${idle.wage})`);
  assert(treasury.gold === 99.5, `Treasury paid 0.5 supplement (got ${treasury.gold})`);
}

// --- Test 4: Curfew ---
console.log('\n=== CURFEW LAW ===');
{
  const vm = new HerbVM();
  vm.loadFile(path.join(__dirname, '../laws/curfew.herb.json'));
  vm.addEntity('CLOCK', { _id: 'clk', hour: 21 });
  vm.addEntity('TREASURY', { _id: 't1', gold: 50 });
  vm.addEntity('CITIZENS', { _id: 'c1', name: 'NightOwl', gold: 10, location: 'market' });
  vm.addEntity('CITIZENS', { _id: 'c2', name: 'HomeBoy', gold: 10, location: 'home' });

  vm.tick();
  const owl = vm.getContainer('CITIZENS').get('c1');
  const home = vm.getContainer('CITIZENS').get('c2');
  const treasury = vm.getContainer('TREASURY').get('t1');
  assert(owl.gold === 8, `NightOwl fined 2 gold (got ${owl.gold})`);
  assert(owl.location === 'home', `NightOwl sent home (got ${owl.location})`);
  assert(home.gold === 10, `HomeBoy unaffected (got ${home.gold})`);
  assert(treasury.gold === 52, `Treasury collected fine (got ${treasury.gold})`);
}

// --- Test 5: Immigration ---
console.log('\n=== IMMIGRATION LAW ===');
{
  const vm = new HerbVM();
  vm.loadFile(path.join(__dirname, '../laws/immigration.herb.json'));
  vm.addEntity('CENSUS', { _id: 'cen', population: 15 });
  vm.addEntity('TREASURY', { _id: 't1', gold: 250 });

  const r = vm.tick();
  const census = vm.getContainer('CENSUS').get('cen');
  const treasury = vm.getContainer('TREASURY').get('t1');
  const citizens = vm.getContainer('CITIZENS');
  // Fixpoint iteration creates ALL 5 immigrants in one tick (pop 15→20, treasury 250→200)
  assert(citizens.size === 5, `5 immigrants created in one tick (got ${citizens.size})`);
  assert(census.population === 20, `Census reached 20 via fixpoint (got ${census.population})`);
  assert(treasury.gold === 200, `Treasury spent 50 total (got ${treasury.gold})`);

  // No more immigration — both conditions now fail
  vm.tick();
  assert(census.population === 20, `No more immigration at pop 20 (got ${census.population})`);
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
