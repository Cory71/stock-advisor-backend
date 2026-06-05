// Runs before any test file is loaded. We force-set the env vars our routes
// need so tests don't depend on the developer having a .env file or the right
// values in it. mongodb-memory-server replaces MONGO_URI dynamically so we
// don't bother setting it here.

process.env.JWT_SECRET = require('./helpers/authToken').TEST_JWT_SECRET;
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
