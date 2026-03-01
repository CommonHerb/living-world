'use strict';

/**
 * The Daily Chronicle — Newspaper System
 * 
 * Every N ticks, generates a newspaper edition from recent Chronicle events.
 * Template-based article generation with editorial bias based on the editor NPC.
 * The editor's personality drives story SELECTION, not distortion.
 */

const { queryChronicle } = require('./chronicle');
const { getSeason, getYear } = require('./seasons');
const { detectFactions } = require('./politics');
const { COMMODITIES } = require('./market');
const { getLivingAdults } = require('./settlement');

// ─── Configuration ───────────────────────────────────────────

const PUBLISH_FREQUENCY = 10; // publish every N ticks
const MAX_STORIES = 6;        // max editorial stories per edition
const MAX_ARCHIVE = 20;       // editions to keep

// ─── Newspaper Names ─────────────────────────────────────────

const NEWSPAPER_NAMES = [
  'The Daily Chronicle',
  'The Verdant Herald',
  'The People\'s Torch',
  'The Settlement Gazette',
  'The Morning Post',
];

const NEWSPAPER_MOTTOS = [
  'All the News That\'s Fit to Print',
  'Truth in Every Column',
  'Voice of the People',
  'Light Against the Darkness',
  'Recording History as It Happens',
];

// ─── Base Newsworthiness ─────────────────────────────────────

const BASE_NEWSWORTHINESS = {
  election:     0.9,
  succession:   0.85,
  coup:         0.95,
  death:        0.7,
  crisis:       0.85,
  tax_change:   0.7,
  surplus:      0.4,
  hunger:       0.8,
  bankruptcy:   0.6,
  relief:       0.55,
  market_crash: 0.9,
  price_spike:  0.6,
  crime:        0.55,
  crime_caught: 0.65,
  trial:        0.75,
  fine:         0.4,
  exile:        0.8,
  exile_return: 0.45,
  feud:         0.6,
  bandit_raid:  0.7,
  militia:      0.65,
  marriage:     0.35,
  birth:        0.3,
  emigration:   0.5,
  immigration:  0.5,
  trade:        0.3,
  founding:     0.95,
  gossip_distortion: 0.15,
  good_harvest: 0.5,
  unjust_acquittal: 0.6,
  political_argument: 0.2,
  maturation:   0.15,
};

// ─── Story Categories (for editorial bias) ───────────────────

const CATEGORY = {
  POLITICAL:  'political',
  ECONOMIC:   'economic',
  SECURITY:   'security',
  SOCIAL:     'social',
  CRISIS:     'crisis',
};

const EVENT_CATEGORIES = {
  election: CATEGORY.POLITICAL,
  succession: CATEGORY.POLITICAL,
  coup: CATEGORY.POLITICAL,
  tax_change: CATEGORY.POLITICAL,
  crisis: CATEGORY.CRISIS,
  hunger: CATEGORY.CRISIS,
  surplus: CATEGORY.ECONOMIC,
  bankruptcy: CATEGORY.ECONOMIC,
  market_crash: CATEGORY.ECONOMIC,
  price_spike: CATEGORY.ECONOMIC,
  trade: CATEGORY.ECONOMIC,
  good_harvest: CATEGORY.ECONOMIC,
  relief: CATEGORY.CRISIS,
  crime: CATEGORY.SECURITY,
  crime_caught: CATEGORY.SECURITY,
  trial: CATEGORY.SECURITY,
  fine: CATEGORY.SECURITY,
  exile: CATEGORY.SECURITY,
  exile_return: CATEGORY.SECURITY,
  feud: CATEGORY.SECURITY,
  bandit_raid: CATEGORY.SECURITY,
  militia: CATEGORY.SECURITY,
  death: CATEGORY.SOCIAL,
  marriage: CATEGORY.SOCIAL,
  birth: CATEGORY.SOCIAL,
  emigration: CATEGORY.SOCIAL,
  immigration: CATEGORY.SOCIAL,
  founding: CATEGORY.POLITICAL,
};

// ─── Editor Bias Derivation ──────────────────────────────────

function deriveEditorBias(editor, settlement) {
  // Derive bias from editor's personality traits
  const g = editor.genome;
  const faction = editor.faction || 'unaligned';
  
  // Map job to natural bias
  const jobBias = {
    farmer:     { economic: 0.7, security: 0.3, political: 0.3, social: 0.5, crisis: 0.6 },
    guard:      { economic: 0.3, security: 0.8, political: 0.4, social: 0.3, crisis: 0.5 },
    miller:     { economic: 0.6, security: 0.3, political: 0.4, social: 0.5, crisis: 0.5 },
    smith:      { economic: 0.5, security: 0.5, political: 0.3, social: 0.4, crisis: 0.5 },
    woodcutter: { economic: 0.5, security: 0.4, political: 0.3, social: 0.5, crisis: 0.5 },
    miner:      { economic: 0.6, security: 0.4, political: 0.3, social: 0.4, crisis: 0.5 },
  };

  const base = jobBias[editor.job] || { economic: 0.5, security: 0.5, political: 0.5, social: 0.5, crisis: 0.5 };

  return {
    economic:  Math.min(1, base.economic + (1 - g.riskTolerance) * 0.2),
    security:  Math.min(1, base.security + g.assertiveness * 0.2),
    political: Math.min(1, base.political + (1 - g.agreeableness) * 0.2),
    social:    Math.min(1, base.social + g.agreeableness * 0.2),
    crisis:    Math.min(1, base.crisis + g.fairnessSens * 0.2),
    sensationalism: g.assertiveness * 0.5 + (1 - g.agreeableness) * 0.3,
    govtTrust: editor.opinions ? (editor.opinions.leaderApproval + 1) / 2 : 0.5, // normalize to 0-1
    faction,
  };
}

// ─── Newsworthiness Scoring ──────────────────────────────────

function scoreNewsworthiness(event, bias, currentTick) {
  let score = BASE_NEWSWORTHINESS[event.eventType] || 0.2;
  
  // Category boost from editorial bias
  const category = EVENT_CATEGORIES[event.eventType] || CATEGORY.SOCIAL;
  const categoryBoost = bias[category] || 0.5;
  score += (categoryBoost - 0.5) * 0.3;

  // Sensationalism boost for dramatic events
  if (event.significance >= 100) {
    score += bias.sensationalism * 0.2;
  }

  // Recency bonus
  const age = currentTick - event.tick;
  if (age <= 2) score += 0.15;
  else if (age <= 5) score += 0.1;
  else if (age <= 10) score += 0.05;
  else score -= 0.1;

  return Math.max(0, Math.min(1, score));
}

// ─── Article Templates ───────────────────────────────────────
// Each template has variants keyed by bias level (high/mid/low govtTrust)

const ARTICLE_TEMPLATES = {
  election: [
    {
      biasKey: 'govtTrust', biasRange: [0.6, 1.0],
      headline: (e) => `NEW COUNCIL BRINGS FRESH MANDATE — ${actorName(e, 0)} Leads`,
      body: (e, s) => {
        const names = e.actors.filter(a => a.role === 'council').map(a => a.name);
        const taxMatch = e.outcome.match(/Tax:\s*(\d+)%\s*→\s*(\d+)%/);
        const taxNote = taxMatch ? ` Tax adjusted to ${taxMatch[2]}% in a measured response to community needs.` : '';
        return `In a clear expression of public will, ${names.join(', ')} were elected to lead ${s.name}'s council.${taxNote} The new leadership takes office with broad community support.`;
      },
    },
    {
      biasKey: 'govtTrust', biasRange: [0.3, 0.59],
      headline: (e) => `ELECTION RESULTS: ${actorName(e, 0)} Wins Council Seat`,
      body: (e, s) => {
        const names = e.actors.filter(a => a.role === 'council').map(a => a.name);
        const taxMatch = e.outcome.match(/Tax:\s*(\d+)%\s*→\s*(\d+)%/);
        const taxNote = taxMatch ? ` The tax rate moves from ${taxMatch[1]}% to ${taxMatch[2]}%.` : '';
        return `${names.join(', ')} won seats on the ${s.name} council.${taxNote} Time will tell what direction the new leadership takes.`;
      },
    },
    {
      biasKey: 'govtTrust', biasRange: [0.0, 0.29],
      headline: (e) => `SAME FACES, NEW PROMISES — Council Election Draws Thin Turnout`,
      body: (e, s) => {
        const names = e.actors.filter(a => a.role === 'council').map(a => a.name);
        const taxMatch = e.outcome.match(/Tax:\s*(\d+)%\s*→\s*(\d+)%/);
        const taxNote = taxMatch ? ` Among their first acts: shifting taxes to ${taxMatch[2]}%.` : '';
        return `${names.join(', ')} claimed council seats in ${s.name}, though few seem to expect real change.${taxNote} Critics question whether the new council will address long-standing grievances.`;
      },
    },
  ],

  coup: [
    {
      biasKey: 'govtTrust', biasRange: [0.0, 0.4],
      headline: (e) => `REGIME TOPPLED — ${actorName(e, 0)} Seizes Power`,
      body: (e, s) => `In a dramatic upheaval, ${actorName(e, 0)} overthrew ${actorName(e, 1) || 'the previous ruler'} in ${s.name}. The old guard fell as discontent reached a breaking point. Many are calling it long overdue.`,
    },
    {
      biasKey: 'govtTrust', biasRange: [0.41, 1.0],
      headline: (e) => `CRISIS: ${actorName(e, 0)} Overthrows Lawful Government`,
      body: (e, s) => `${actorName(e, 0)} seized control of ${s.name} by force, deposing ${actorName(e, 1) || 'the rightful leader'}. The coup throws the settlement's stability into question. Residents are urged to remain calm.`,
    },
  ],

  succession: [
    {
      biasKey: 'govtTrust', biasRange: [0.0, 1.0],
      headline: (e) => `${(actorName(e, 0) || 'NEW RULER').toUpperCase()} ASCENDS TO THE THRONE`,
      body: (e, s) => `${actorName(e, 0) || 'A new ruler'} has claimed the throne of ${s.name}. ${e.outcome}`,
    },
  ],

  tax_change: [
    {
      biasKey: 'govtTrust', biasRange: [0.6, 1.0],
      headline: (e) => {
        const m = e.outcome.match(/raised/);
        return m ? 'COUNCIL APPROVES MODEST REVENUE ADJUSTMENT' : 'TAX RELIEF ENACTED BY COUNCIL';
      },
      body: (e, s) => {
        const m = e.outcome.match(/(raised|lowered) from (\d+)% to (\d+)%/);
        if (!m) return e.outcome;
        if (m[1] === 'raised') return `In a measured response to fiscal pressures, the ${s.name} council voted to adjust the tax rate to ${m[3]}%, citing infrastructure needs and community investment priorities.`;
        return `The ${s.name} council voted to lower taxes from ${m[2]}% to ${m[3]}%, returning more gold to hardworking residents. Leadership called it a sign of fiscal confidence.`;
      },
    },
    {
      biasKey: 'govtTrust', biasRange: [0.0, 0.59],
      headline: (e) => {
        const m = e.outcome.match(/raised/);
        return m ? 'COUNCIL RAMS THROUGH TAX HIKE' : 'TAXES CUT — BUT IS IT ENOUGH?';
      },
      body: (e, s) => {
        const m = e.outcome.match(/(raised|lowered) from (\d+)% to (\d+)%/);
        if (!m) return e.outcome;
        if (m[1] === 'raised') {
          const pctIncrease = Math.round(((parseInt(m[3]) - parseInt(m[2])) / parseInt(m[2])) * 100);
          return `Despite grumbling from residents, the ${s.name} council forced a ${pctIncrease > 0 ? pctIncrease + '% ' : ''}increase in the tax burden, now set at ${m[3]}%. Working citizens bear the cost.`;
        }
        return `Taxes in ${s.name} dropped from ${m[2]}% to ${m[3]}%. Some call it progress; others say it's too little, too late after seasons of heavy taxation.`;
      },
    },
  ],

  crisis: [
    {
      biasKey: 'sensationalism', biasRange: [0.4, 1.0],
      headline: () => 'TREASURY CRISIS — SETTLEMENT ON THE BRINK',
      body: (e, s) => `${s.name} faces financial catastrophe as the treasury runs dangerously low. Without immediate action, public services and food distribution could collapse entirely. Residents stockpile what they can.`,
    },
    {
      biasKey: 'sensationalism', biasRange: [0.0, 0.39],
      headline: () => 'Treasury Reaches Critical Level',
      body: (e, s) => `The ${s.name} treasury has fallen to concerning levels. The council is expected to address the shortfall in upcoming sessions. Residents are advised to be patient as solutions are explored.`,
    },
  ],

  hunger: [
    {
      biasKey: 'crisis', biasRange: [0.5, 1.0],
      headline: (e) => {
        const m = e.outcome.match(/^(\d+)/);
        if (!m) return 'HUNGER STALKS THE SETTLEMENT';
        return parseInt(m[1]) === 1 ? 'RESIDENT GOES HUNGRY AS FOOD CRISIS DEEPENS' : `${m[1]} RESIDENTS GO HUNGRY AS FOOD CRISIS DEEPENS`;
      },
      body: (e, s) => {
        const m = e.outcome.match(/^(\d+)/);
        const count = m ? parseInt(m[1]) : 0;
        const subj = count === 1 ? 'A resident' : `${count} residents`;
        return `${subj} of ${s.name} went without adequate food. Families report empty stores and rising bread prices. The situation grows more desperate with each passing day.`;
      },
    },
    {
      biasKey: 'crisis', biasRange: [0.0, 0.49],
      headline: () => 'Food Distribution Challenges Reported',
      body: (e, s) => {
        const m = e.outcome.match(/^(\d+)/);
        const count = m ? parseInt(m[1]) : 0;
        const subj = count === 1 ? 'A resident' : `${count} residents`;
        return `${subj} of ${s.name} experienced food shortages. Officials say the situation is being monitored and steps are being taken to improve distribution.`;
      },
    },
  ],

  death: [
    {
      biasKey: 'social', biasRange: [0.0, 1.0],
      headline: (e) => `${(actorName(e, 0) || 'RESIDENT').toUpperCase()} PASSES AWAY`,
      body: (e, s) => {
        const name = actorName(e, 0) || 'A longtime resident';
        const role = e.actors[0]?.role || 'resident';
        return `${name}, a ${role} of ${s.name}, has passed away. ${e.outcome} The community mourns the loss.`;
      },
      section: 'OBITUARIES',
    },
  ],

  marriage: [
    {
      biasKey: 'social', biasRange: [0.0, 1.0],
      headline: (e) => `${actorName(e, 0)} AND ${actorName(e, 1)} WED`,
      body: (e, s) => `${actorName(e, 0) || '?'} and ${actorName(e, 1) || '?'} were united in marriage in ${s.name}. Friends and neighbors gathered to celebrate the union. We wish the couple many happy years.`,
      section: 'LOCAL',
    },
  ],

  birth: [
    {
      biasKey: 'social', biasRange: [0.0, 1.0],
      headline: (e) => `WELCOME TO THE WORLD: ${actorName(e, 0) || 'A New Life'}`,
      body: (e, s) => `A child was born in ${s.name}, bringing the settlement's population ever upward. ${e.outcome || 'Mother and child are reported to be well.'}`,
      section: 'LOCAL',
    },
  ],

  crime: [
    {
      biasKey: 'security', biasRange: [0.5, 1.0],
      headline: (e) => `CRIME WAVE: ${(actorName(e, 0) || 'SUSPECT').toUpperCase()} ACCUSED`,
      body: (e, s) => `${actorName(e, 0) || 'A resident'} stands accused of criminal activity in ${s.name}. ${e.outcome} Citizens demand the council take action to restore order.`,
    },
    {
      biasKey: 'security', biasRange: [0.0, 0.49],
      headline: (e) => `Incident Reported in ${e.actors[0]?.name ? 'Case Involving ' + actorName(e, 0) : 'Settlement'}`,
      body: (e, s) => `An incident was reported in ${s.name}. ${e.outcome} The matter is being handled through proper channels.`,
    },
  ],

  crime_caught: [
    {
      biasKey: 'security', biasRange: [0.0, 1.0],
      headline: (e) => `JUSTICE SERVED: ${(actorName(e, 0) || 'OFFENDER').toUpperCase()} APPREHENDED`,
      body: (e, s) => `${actorName(e, 0) || 'A suspect'} was caught in ${s.name}. ${e.outcome} The guard earned praise from onlookers.`,
    },
  ],

  trial: [
    {
      biasKey: 'security', biasRange: [0.0, 1.0],
      headline: (e) => `TRIAL: ${(actorName(e, 0) || 'THE ACCUSED').toUpperCase()} FACES JUDGMENT`,
      body: (e, s) => `The case of ${actorName(e, 0) || 'the accused'} went before ${s.name}'s court. ${e.outcome}`,
    },
  ],

  exile: [
    {
      biasKey: 'security', biasRange: [0.5, 1.0],
      headline: (e) => `BANISHED: ${(actorName(e, 0) || 'OFFENDER').toUpperCase()} EXILED FROM SETTLEMENT`,
      body: (e, s) => `${actorName(e, 0) || 'A convicted offender'} has been exiled from ${s.name}. ${e.outcome} The punishment sends a clear message about the settlement's commitment to order.`,
    },
    {
      biasKey: 'security', biasRange: [0.0, 0.49],
      headline: (e) => `${actorName(e, 0) || 'Resident'} Exiled — Questions Linger`,
      body: (e, s) => `${actorName(e, 0) || 'A resident'} was cast out of ${s.name}. ${e.outcome} Some wonder whether exile truly serves justice, or merely removes the problem from sight.`,
    },
  ],

  bandit_raid: [
    {
      biasKey: 'security', biasRange: [0.0, 1.0],
      headline: () => 'BANDITS STRIKE — SETTLEMENT DEFENSES TESTED',
      body: (e, s) => `Raiders targeted ${s.name} in a brazen attack. ${e.outcome} Residents are shaken, and calls for stronger militia presence grow louder.`,
    },
  ],

  militia: [
    {
      biasKey: 'security', biasRange: [0.0, 1.0],
      headline: () => 'MILITIA MOBILIZED FOR SETTLEMENT DEFENSE',
      body: (e, s) => `${s.name} has organized its militia to address security concerns. ${e.outcome} Whether this brings safety or merely the appearance of it remains to be seen.`,
    },
  ],

  surplus: [
    {
      biasKey: 'economic', biasRange: [0.0, 1.0],
      headline: () => 'TREASURY SWELLS WITH SURPLUS',
      body: (e, s) => `Good news for ${s.name}: the treasury reports a healthy surplus. The extra gold provides a buffer against future hardships and may open doors for community investment.`,
    },
  ],

  bankruptcy: [
    {
      biasKey: 'economic', biasRange: [0.5, 1.0],
      headline: (e) => `ECONOMIC CASUALTY: ${(actorName(e, 0) || 'RESIDENT').toUpperCase()} GOES BANKRUPT`,
      body: (e, s) => `${actorName(e, 0) || 'A resident'} of ${s.name} lost everything. ${e.outcome} The failure raises uncomfortable questions about economic conditions in the settlement.`,
    },
    {
      biasKey: 'economic', biasRange: [0.0, 0.49],
      headline: (e) => `${actorName(e, 0) || 'Resident'} Faces Financial Difficulty`,
      body: (e, s) => `${actorName(e, 0) || 'A resident'} of ${s.name} has declared bankruptcy. ${e.outcome} Neighbors are expected to rally around the family.`,
    },
  ],

  market_crash: [
    {
      biasKey: 'sensationalism', biasRange: [0.3, 1.0],
      headline: () => 'MARKET IN FREE FALL — PRICES COLLAPSE',
      body: (e, s) => `Panic gripped ${s.name}'s market as prices plummeted. ${e.outcome} Traders scramble to cut losses while buyers wait for the bottom. The crash threatens to destabilize the local economy.`,
    },
    {
      biasKey: 'sensationalism', biasRange: [0.0, 0.29],
      headline: () => 'Market Correction Sees Prices Adjust Downward',
      body: (e, s) => `${s.name}'s market experienced a significant price adjustment. ${e.outcome} Economists note that corrections, while painful, are a natural part of a healthy market.`,
    },
  ],

  price_spike: [
    {
      biasKey: 'economic', biasRange: [0.0, 1.0],
      headline: () => 'MARKET PRICES SURGE',
      body: (e, s) => `Prices spiked in ${s.name}'s marketplace. ${e.outcome} Residents feel the pinch as essential goods become more expensive.`,
    },
  ],

  relief: [
    {
      biasKey: 'govtTrust', biasRange: [0.5, 1.0],
      headline: () => 'COUNCIL ACTS SWIFTLY — EMERGENCY RELIEF DISTRIBUTED',
      body: (e, s) => `In a decisive response to hardship, ${s.name}'s leadership distributed emergency food supplies to those in need. The action has been widely praised as compassionate governance.`,
    },
    {
      biasKey: 'govtTrust', biasRange: [0.0, 0.49],
      headline: () => 'RELIEF FINALLY ARRIVES — TOO LATE FOR SOME',
      body: (e, s) => `After days of mounting pressure, ${s.name}'s council finally authorized emergency food distribution. Critics say the response was slow and inadequate, leaving the most vulnerable to fend for themselves.`,
    },
  ],

  emigration: [
    {
      biasKey: 'govtTrust', biasRange: [0.0, 0.4],
      headline: (e) => `ANOTHER ONE LEAVES: ${actorName(e, 0) || 'RESIDENT'} ABANDONS ${'{SETTLEMENT}'}`,
      body: (e, s) => `${actorName(e, 0) || 'A resident'} has left ${s.name} for elsewhere. The departure adds to growing concerns about conditions driving people away. How many more will follow?`,
    },
    {
      biasKey: 'govtTrust', biasRange: [0.41, 1.0],
      headline: (e) => `${actorName(e, 0) || 'Resident'} Relocates to Pursue Opportunities`,
      body: (e, s) => `${actorName(e, 0) || 'A resident'} of ${s.name} has moved on to new horizons. While departures are always bittersweet, the settlement wishes them well in their new endeavors.`,
    },
  ],

  immigration: [
    {
      biasKey: 'social', biasRange: [0.0, 1.0],
      headline: (e) => `WELCOME: ${(actorName(e, 0) || 'NEWCOMER').toUpperCase()} ARRIVES IN SETTLEMENT`,
      body: (e, s) => `${actorName(e, 0) || 'A newcomer'} has arrived in ${s.name}, seeking a fresh start. The settlement's population grows as word of opportunity spreads.`,
    },
  ],

  trade: [
    {
      biasKey: 'economic', biasRange: [0.0, 1.0],
      headline: () => 'TRADE CARAVAN ARRIVES',
      body: (e, s) => `Commerce flows as a trade caravan ${e.outcome} The exchange strengthens ${s.name}'s economic ties with neighboring settlements.`,
    },
  ],

  good_harvest: [
    {
      biasKey: 'economic', biasRange: [0.0, 1.0],
      headline: () => 'HARVEST YIELDS EXCEED EXPECTATIONS',
      body: (e, s) => `Bountiful harvest in ${s.name}! Grain stores are well-stocked and market prices have softened accordingly. Farmers report one of the best growing seasons in recent memory.`,
    },
  ],

  feud: [
    {
      biasKey: 'security', biasRange: [0.0, 1.0],
      headline: (e) => `FEUD ERUPTS BETWEEN ${(actorName(e, 0) || '?').toUpperCase()} AND ${(actorName(e, 1) || '?').toUpperCase()}`,
      body: (e, s) => `Tensions boiled over in ${s.name} as ${actorName(e, 0) || '?'} and ${actorName(e, 1) || '?'} entered into open conflict. ${e.outcome} Neighbors worry the feud could spread.`,
    },
  ],

  fine: [
    {
      biasKey: 'security', biasRange: [0.0, 1.0],
      headline: (e) => `${(actorName(e, 0) || 'OFFENDER').toUpperCase()} FINED BY COURT`,
      body: (e, s) => `${actorName(e, 0) || 'An offender'} received a fine from ${s.name}'s court. ${e.outcome}`,
      section: 'LOCAL',
    },
  ],

  exile_return: [
    {
      biasKey: 'social', biasRange: [0.0, 1.0],
      headline: (e) => `${(actorName(e, 0) || 'EXILE').toUpperCase()} RETURNS TO SETTLEMENT`,
      body: (e, s) => `${actorName(e, 0) || 'A formerly exiled resident'} has returned to ${s.name}. ${e.outcome} The community watches to see whether old wounds have healed.`,
    },
  ],
};

// ─── Helper Functions ────────────────────────────────────────

function actorName(entry, index) {
  return entry.actors[index]?.name || null;
}

function selectTemplate(eventType, bias) {
  const templates = ARTICLE_TEMPLATES[eventType];
  if (!templates || templates.length === 0) return null;

  // Find best matching template based on bias
  for (const tpl of templates) {
    const biasValue = bias[tpl.biasKey] || 0.5;
    if (biasValue >= tpl.biasRange[0] && biasValue <= tpl.biasRange[1]) {
      return tpl;
    }
  }
  // Fallback to first template
  return templates[0];
}

function generateArticle(event, template, settlement, section) {
  return {
    headline: template.headline(event),
    body: template.body(event, settlement),
    section: template.section || section || 'FRONT PAGE',
    eventType: event.eventType,
    tick: event.tick,
    significance: event.significance,
    sourceEventId: event.id,
  };
}

// ─── Market Report (always present) ──────────────────────────

function generateMarketReport(settlement) {
  const lines = [];
  let hasData = false;
  
  for (const c of COMMODITIES) {
    const price = settlement.market.lastClearingPrices[c];
    if (price === null) continue;
    hasData = true;
    const history = settlement.market.priceHistory[c];
    let trend = '━';
    let changeStr = '0g';
    if (history.length >= 2) {
      const prev = history[history.length - 2];
      const curr = history[history.length - 1];
      const change = curr - prev;
      if (curr > prev * 1.05) { trend = '▲'; changeStr = `+${change.toFixed(1)}g`; }
      else if (curr < prev * 0.95) { trend = '▼'; changeStr = `${change.toFixed(1)}g`; }
      else changeStr = '—';
    }
    lines.push(`  ${c.padEnd(12)} ${price.toFixed(1).padStart(6)}g   ${trend} ${changeStr}`);
  }
  
  if (!hasData) return null;

  const pct = Math.round(settlement.taxRate * 100);
  return {
    headline: 'MARKET REPORT',
    body: `  COMMODITY      PRICE   CHANGE\n  ${'─'.repeat(36)}\n${lines.join('\n')}\n\n  Treasury: ${Math.floor(settlement.treasury)}g  ·  Tax Rate: ${pct}%`,
    section: 'MARKET',
    eventType: '_market',
    tick: settlement.tick,
    significance: 0,
  };
}

// ─── Weather Report (always present) ─────────────────────────

function generateWeatherReport(tick) {
  const season = getSeason(tick);
  const year = getYear(tick);
  
  const seasonInfo = {
    spring: { temp: 'Mild', desc: 'Planting season underway', emoji: '🌱' },
    summer: { temp: 'Warm', desc: 'Long days and full sun', emoji: '☀️' },
    autumn: { temp: 'Cool', desc: 'Harvest season', emoji: '🍂' },
    winter: { temp: 'Cold', desc: 'Short days, bitter winds', emoji: '❄️' },
  };
  
  const info = seasonInfo[season];
  const SEASON_LENGTH = 12;
  const YEAR_LENGTH = 50;
  const dayOfYear = tick % YEAR_LENGTH;
  const seasonStart = season === 'spring' ? 0 : season === 'summer' ? SEASON_LENGTH : season === 'autumn' ? SEASON_LENGTH * 2 : SEASON_LENGTH * 3;
  const daysLeft = Math.max(0, (seasonStart + SEASON_LENGTH) - dayOfYear);

  return {
    headline: 'WEATHER & SEASONS',
    body: `  ${info.emoji} ${season.charAt(0).toUpperCase() + season.slice(1)}  ·  ${info.temp}  ·  ${info.desc}\n  ${daysLeft} days remain in the season  ·  Year ${year + 1}`,
    section: 'WEATHER',
    eventType: '_weather',
    tick,
    significance: 0,
  };
}

// ─── Edition Generation ──────────────────────────────────────

function generateEdition(settlement, world) {
  const tick = world.tick;
  const chronicle = settlement.chronicle;
  if (!chronicle || chronicle.entries.length === 0) return null;

  // Pick editor: the first council member is the "editor" (controls the press)
  const editorId = settlement.council[0];
  const editor = settlement.npcs.find(n => n.id === editorId);
  if (!editor) return null;

  const bias = deriveEditorBias(editor, settlement);

  // Get events since last edition (or last PUBLISH_FREQUENCY*2 ticks)
  const newspaper = settlement.newspaper || {};
  const lastEditionTick = newspaper.lastEditionTick || 0;
  const lookback = Math.max(lastEditionTick, tick - PUBLISH_FREQUENCY * 2);
  
  const recentEvents = queryChronicle(chronicle, {
    tickRange: [lookback + 1, tick],
  });

  if (recentEvents.length === 0) return null;

  // Deduplicate: recurring conditions get one story; unique events keep distinct actors
  const RECURRING_EVENTS = new Set([
    'hunger', 'surplus', 'crisis', 'relief', 'good_harvest',
    'gossip_distortion', 'political_argument',
  ]);
  const deduped = [];
  const seenKeys = new Map();
  for (const e of recentEvents) {
    if (!BASE_NEWSWORTHINESS[e.eventType]) continue;
    let key;
    if (RECURRING_EVENTS.has(e.eventType)) {
      key = e.eventType; // one story per type
    } else {
      const actorKey = e.actors.map(a => a.id).sort().join(',');
      key = `${e.eventType}:${actorKey}`;
    }
    const existingIdx = seenKeys.get(key);
    if (existingIdx === undefined) {
      seenKeys.set(key, deduped.length);
      deduped.push(e);
    } else if (e.significance > deduped[existingIdx].significance) {
      deduped[existingIdx] = e;
    }
  }

  // Score and sort events
  const scored = deduped
    .map(e => ({
      event: e,
      score: scoreNewsworthiness(e, bias, tick),
    }))
    .sort((a, b) => b.score - a.score);

  // Pick top stories
  const articles = [];
  const usedEvents = new Set();
  
  for (const { event } of scored) {
    if (articles.length >= MAX_STORIES) break;
    if (usedEvents.has(event.id)) continue;
    
    const template = selectTemplate(event.eventType, bias);
    if (!template) continue;

    // Assign section based on ranking
    let section;
    if (articles.length < 2) section = 'FRONT PAGE';
    else if (event.eventType === 'death') section = 'OBITUARIES';
    else section = 'LOCAL';

    const article = generateArticle(event, template, settlement, section);
    articles.push(article);
    usedEvents.add(event.id);
  }

  // Add fixed sections
  const marketReport = generateMarketReport(settlement);
  if (marketReport) articles.push(marketReport);
  
  articles.push(generateWeatherReport(tick));

  // Determine newspaper name and editor from settlement
  if (!settlement.newspaper) {
    const nameIdx = Math.abs(settlement.id.charCodeAt(0)) % NEWSPAPER_NAMES.length;
    settlement.newspaper = {
      name: `The ${settlement.name} Chronicle`,
      motto: NEWSPAPER_MOTTOS[nameIdx],
      editions: [],
      lastEditionTick: 0,
    };
  }

  const edition = {
    number: (settlement.newspaper.editions.length || 0) + 1,
    tick,
    year: getYear(tick) + 1,
    season: getSeason(tick),
    editor: editor.name,
    editorJob: editor.job,
    editorFaction: editor.faction || 'unaligned',
    articles,
    settlementName: settlement.name,
    newspaperName: settlement.newspaper.name,
    motto: settlement.newspaper.motto,
  };

  // Archive
  settlement.newspaper.editions.push(edition);
  settlement.newspaper.lastEditionTick = tick;
  if (settlement.newspaper.editions.length > MAX_ARCHIVE) {
    settlement.newspaper.editions = settlement.newspaper.editions.slice(-MAX_ARCHIVE);
  }

  return edition;
}

// ─── Display Formatting ─────────────────────────────────────

function formatEdition(edition) {
  if (!edition) return 'The presses are silent. No news to report.';

  const seasonCap = edition.season.charAt(0).toUpperCase() + edition.season.slice(1);
  const nameLen = edition.newspaperName.length;
  const padLen = Math.max(0, Math.floor((56 - nameLen) / 2));
  const pad = ' '.repeat(padLen);

  const lines = [
    '╔══════════════════════════════════════════════════════════╗',
    `║${pad}${edition.newspaperName.toUpperCase()}${' '.repeat(Math.max(0, 58 - padLen - nameLen))}║`,
    `║${' '.repeat(Math.max(0, Math.floor((58 - edition.motto.length - 2) / 2)))}"${edition.motto}"${' '.repeat(Math.max(0, 58 - Math.floor((58 - edition.motto.length - 2) / 2) - edition.motto.length - 2))}║`,
    `║                                                          ║`,
    `║  Year ${edition.year}, Day ${String(edition.tick).padEnd(4)}  ·  ${seasonCap.padEnd(8)}  ·  Edition No. ${String(edition.number).padEnd(4)}   ║`,
    '╚══════════════════════════════════════════════════════════╝',
    '',
  ];

  // Group articles by section
  const sectionOrder = ['FRONT PAGE', 'LOCAL', 'MARKET', 'OPINION', 'WEATHER', 'OBITUARIES'];
  const bySection = {};
  for (const article of edition.articles) {
    const sec = article.section || 'LOCAL';
    if (!bySection[sec]) bySection[sec] = [];
    bySection[sec].push(article);
  }

  for (const section of sectionOrder) {
    const arts = bySection[section];
    if (!arts || arts.length === 0) continue;

    lines.push(`━━━ ${section} ${'━'.repeat(Math.max(0, 53 - section.length))}`);
    lines.push('');

    for (const art of arts) {
      lines.push(`  ${art.headline}`);
      lines.push('');
      // Indent body lines
      const bodyLines = art.body.split('\n');
      for (const bl of bodyLines) {
        // Don't double-indent lines that are already indented (like market data)
        if (bl.startsWith('  ')) lines.push(bl);
        else lines.push(`  ${bl}`);
      }
      lines.push('');
      if (arts.indexOf(art) < arts.length - 1) {
        lines.push('  ───────────────────────────────────────────────');
        lines.push('');
      }
    }
  }

  lines.push('══════════════════════════════════════════════════════════');
  lines.push(`  Editor: ${edition.editor} (${edition.editorJob})  ·  ${edition.settlementName}  ·  Ed. ${edition.number}`);
  lines.push('══════════════════════════════════════════════════════════');

  return lines.join('\n');
}

function formatArchive(settlement, count = 5) {
  if (!settlement.newspaper || !settlement.newspaper.editions || settlement.newspaper.editions.length === 0) {
    return 'No archived editions found. The presses have yet to roll.';
  }

  const editions = settlement.newspaper.editions.slice(-count).reverse();
  const lines = [
    `═══ ${settlement.newspaper.name.toUpperCase()} — ARCHIVE ═══`,
    '',
  ];

  for (const ed of editions) {
    const seasonCap = ed.season.charAt(0).toUpperCase() + ed.season.slice(1);
    const storyCount = ed.articles.filter(a => a.eventType[0] !== '_').length;
    const topStory = ed.articles.find(a => a.section === 'FRONT PAGE');
    lines.push(`  Edition ${ed.number} — Year ${ed.year}, Day ${ed.tick} (${seasonCap})`);
    lines.push(`  ${storyCount} stories · Editor: ${ed.editor}`);
    if (topStory) {
      lines.push(`  Lead: ${topStory.headline}`);
    }
    lines.push('');
  }

  lines.push(`${settlement.newspaper.editions.length} total editions in archive.`);
  return lines.join('\n');
}

// ─── Tick Integration ────────────────────────────────────────

function tickNewspaper(settlement, world) {
  if (world.tick % PUBLISH_FREQUENCY !== 0) return null;
  if (world.tick === 0) return null;

  const edition = generateEdition(settlement, world);
  if (edition) {
    settlement.events.push({
      type: 'newspaper',
      text: `📰 New edition of ${settlement.newspaper.name} published! (Ed. ${edition.number})`,
    });
  }
  return edition;
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  tickNewspaper,
  generateEdition,
  formatEdition,
  formatArchive,
  PUBLISH_FREQUENCY,
  deriveEditorBias,
  scoreNewsworthiness,
  ARTICLE_TEMPLATES,
};
