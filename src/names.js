'use strict';

const FIRST_NAMES = [
  'Marta', 'Aldric', 'Bess', 'Finn', 'Edda', 'Wren', 'Silas', 'Holt',
  'Lena', 'Cade', 'Ivy', 'Rowan', 'Thea', 'Garret', 'Nessa', 'Bryn',
  'Otto', 'Cora', 'Dag', 'Elke', 'Rolf', 'Tilda', 'Viggo', 'Anya', 'Lars',
  'Petra', 'Sven', 'Ingrid', 'Bjorn', 'Freya', 'Erik', 'Helga', 'Kai',
  'Astrid', 'Gunnar', 'Solveig', 'Leif', 'Sigrid', 'Torsten', 'Ylva'
];

function generateName(rng, index) {
  if (index === 0) return 'You'; // Player
  if (index < FIRST_NAMES.length) return FIRST_NAMES[index];
  return FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)] + ' ' + (index - FIRST_NAMES.length + 2);
}

module.exports = { generateName, FIRST_NAMES };
