'use strict';

const { createWorld, tickWorld } = require('../src/world');
const { detectFactions, giniCoefficient } = require('../src/politics');
const { formatDiagnostics } = require('../src/diagnostics');

const seed = 48271;
const CHECKPOINTS = [500, 1000];

const world = createWorld(seed);

for (let i = 1; i <= Math.max(...CHECKPOINTS); i++) {
  tickWorld(world);
  
  if (CHECKPOINTS.includes(i)) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`CHECKPOINT: TICK ${i}`);
    console.log(`${'═'.repeat(60)}`);
    
    for (const s of world.settlements) {
      console.log(`\n--- ${s.name} ---`);
      const living = s.npcs.filter(n => n.alive !== false && !n.isChild);
      const children = s.npcs.filter(n => n.alive !== false && n.isChild);
      const dead = s.npcs.filter(n => n.alive === false);
      console.log(`Population: ${living.length} adults, ${children.length} children, ${dead.length} dead (total created: ${s.npcs.length})`);
      
      // Faction distribution
      const { factions, unaligned } = detectFactions(s);
      for (const f of factions) {
        console.log(`  ${f.name}: ${f.members.length} members (avg sentiment: ${f.avgSentiment.toFixed(3)})`);
      }
      console.log(`  Unaligned: ${unaligned.length}`);
      
      // Opinion stats
      const taxSents = living.map(n => n.opinions.taxSentiment);
      const mean = arr => arr.reduce((a,b) => a+b, 0) / arr.length;
      const std = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((s,v) => s + (v-m)**2, 0) / arr.length); };
      console.log(`  Tax sentiment: mean=${mean(taxSents).toFixed(3)} std=${std(taxSents).toFixed(3)} range=[${Math.min(...taxSents).toFixed(3)}, ${Math.max(...taxSents).toFixed(3)}]`);
      
      // Memory fidelity
      let totalMem = 0, lowFid = 0;
      for (const npc of living) {
        for (const m of npc.memories) {
          totalMem++;
          if (m.fidelity < 0.5) lowFid++;
        }
      }
      console.log(`  Memories: ${totalMem} total, ${lowFid} below 0.5 fidelity`);
      
      // Elections
      const elections = s.electionHistory || [];
      if (elections.length > 0) {
        const lastE = elections[elections.length - 1];
        console.log(`  Elections: ${elections.length} held. Last winner: ${lastE.winner}`);
        // Check competitiveness
        const margins = [];
        for (const e of elections) {
          const votes = e.council.map(c => c.votes).sort((a,b) => b-a);
          if (votes.length >= 2) {
            const total = votes.reduce((a,b) => a+b, 0);
            if (total > 0) margins.push((votes[0] - votes[1]) / total);
          }
        }
        if (margins.length > 0) {
          console.log(`  Election margins: avg=${mean(margins).toFixed(3)}`);
        }
      }
      
      // Granary and wealth
      const avgGold = living.length > 0 ? living.reduce((s,n) => s + (n.gold||0), 0) / living.length : 0;
      console.log(`  Granary: ${s.granary?.toFixed(1) || 'N/A'}, Treasury: ${s.treasury?.toFixed(1) || 'N/A'}, Avg gold: ${avgGold.toFixed(1)}`);
      console.log(`  Families: ${Object.keys(s.families || {}).length}`);
      
      // Religion
      if (s.religion) {
        console.log(`  Myths: ${s.religion.myths.length}, Beliefs: ${s.religion.beliefs.length}, Rituals: ${s.religion.rituals.length}`);
        for (const myth of s.religion.myths.slice(0, 3)) {
          console.log(`    Myth: "${myth.narrative}" (name: ${myth.name || 'NONE'})`);
        }
      }
      
      // Full diagnostics
      console.log(`\n${formatDiagnostics(s)}`);
    }
  }
}
