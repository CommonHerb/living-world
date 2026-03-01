'use strict';

const { SimulationServer } = require('./server');

const seed = parseInt(process.argv[2]) || 48271;
const port = parseInt(process.env.PORT) || 3000;

const server = new SimulationServer(port, seed);
server.start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
