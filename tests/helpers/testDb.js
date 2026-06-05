// Spins up an in-memory MongoDB for the test run and tears it down at the
// end. Each test file uses these helpers in its before/after hooks so the
// real Atlas database is never touched.
//
// Why in-memory: tests are fast, fully isolated, and no .env / network needed.
// The mongodb-memory-server package downloads a small mongod binary on first
// run and reuses it for every subsequent test invocation.

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}

async function disconnect() {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function clearCollections() {
  const collections = mongoose.connection.collections;
  for (const name of Object.keys(collections)) {
    await collections[name].deleteMany({});
  }
}

module.exports = { connect, disconnect, clearCollections };
