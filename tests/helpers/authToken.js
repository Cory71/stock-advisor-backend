// Tiny helper that creates a user directly in the in-memory DB and signs
// a matching JWT — saves us from running register/login flows in every
// non-auth test file.

const jwt = require('jsonwebtoken');
const User = require('../../models/User');

// A throwaway secret for the test runs only.
const TEST_JWT_SECRET = 'test-secret-do-not-use-in-prod';

async function createUserAndToken(overrides = {}) {
  const user = await User.create({
    email: overrides.email || 'test@example.com',
    passwordHash: 'not-used-in-tests',
    displayName: overrides.displayName || 'Test User',
    ...overrides
  });

  const token = jwt.sign(
    { id: user._id.toString(), email: user.email },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );

  return { user, token };
}

module.exports = { createUserAndToken, TEST_JWT_SECRET };
