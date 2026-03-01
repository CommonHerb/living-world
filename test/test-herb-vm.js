/**
 * HERB VM test — market tax law
 */
const { HerbVM } = require('../src/herb-vm');
const path = require('path');

function test() {
  const vm = new HerbVM();

  // Load the market tax law
  const lawName = vm.loadFile(path.join(__dirname, '../laws/market_tax.herb.json'));
  console.log(`Loaded: ${lawName}`);

  // Seed the world
  vm.addEntity('TREASURY', { _id: 'treasury', gold: 100 });
  vm.addEntity('CITIZENS', { _id: 'alice', id: 'alice', name: 'Alice', gold: 50 });
  vm.addEntity('CITIZENS', { _id: 'bob', id: 'bob', name: 'Bob', gold: 30 });

  // Create market transactions
  vm.addEntity('TRANSACTIONS', { _id: 'tx1', seller_id: 'alice', buyer_id: 'bob', amount: 40 });
  vm.addEntity('TRANSACTIONS', { _id: 'tx2', seller_id: 'bob', buyer_id: 'alice', amount: 20 });

  console.log('\n--- BEFORE TICK ---');
  console.log('Treasury:', vm.getContainer('TREASURY').get('treasury').gold);
  console.log('Alice gold:', vm.getContainer('CITIZENS').get('alice').gold);
  console.log('Bob gold:', vm.getContainer('CITIZENS').get('bob').gold);
  console.log('Pending transactions:', vm.getContainer('TRANSACTIONS').size);

  // Run fixpoint
  const result = vm.tick();
  console.log('\n--- AFTER TICK ---');
  console.log(`Iterations: ${result.iterations}`);
  console.log('Log:', JSON.stringify(result.log));
  console.log('Treasury:', vm.getContainer('TREASURY').get('treasury').gold);
  console.log('Alice gold:', vm.getContainer('CITIZENS').get('alice').gold);
  console.log('Bob gold:', vm.getContainer('CITIZENS').get('bob').gold);
  console.log('Pending transactions:', vm.getContainer('TRANSACTIONS').size);
  console.log('Processed transactions:', vm.getContainer('PROCESSED').size);

  // Verify
  const treasury = vm.getContainer('TREASURY').get('treasury').gold;
  const expectedTreasury = 100 + (40 * 0.25) + (20 * 0.25); // 100 + 10 + 5 = 115
  console.log(`\nTreasury expected: ${expectedTreasury}, got: ${treasury}`);
  console.assert(treasury === expectedTreasury, `Treasury mismatch! Expected ${expectedTreasury}, got ${treasury}`);

  // Test law listing
  console.log('\n--- LAWS ---');
  for (const law of vm.listLaws()) {
    console.log(`  ${law.name}: ${law.description} (${law.tensions} tensions)`);
  }

  // Test repeal
  vm.unload('law.market_tax');
  console.log('\nAfter repeal, laws:', vm.listLaws().length);
  console.log('Tensions:', vm.tensions.length);

  // New transaction should NOT be processed
  vm.addEntity('TRANSACTIONS', { _id: 'tx3', seller_id: 'alice', buyer_id: 'bob', amount: 100 });
  const result2 = vm.tick();
  console.log(`Post-repeal tick iterations: ${result2.iterations} (should be 0)`);
  console.assert(result2.iterations === 0, 'Repealed law should not fire!');

  console.log('\n✅ All tests passed!');
}

test();
