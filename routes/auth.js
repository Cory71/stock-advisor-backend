// Auth routes — email/password registration + login + current-user lookup.
// Both register and login return a signed JWT in the response body.
// The frontend stores the JWT and sends it as "Authorization: Bearer <token>"
// on every protected request.

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const verifyToken = require('../middleware/authMiddleware');

const router = express.Router();

// Sign a JWT for a user. Token expires in 7 days.
function signToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Shape the user object that gets sent back to the frontend.
// Never send the password hash, even hashed.
function publicUser(user) {
  return {
    id: user._id,
    email: user.email,
    displayName: user.displayName
  };
}

// POST /api/auth/register
// Body: { email, password, displayName? }
// Returns: { token, user }
router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    // Basic input check
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: 'Email and password are required' });
    }

    // Match the frontend's minLength={6} so direct API callers can't bypass it.
    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: 'Password must be at least 6 characters' });
    }

    // One account per email
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res
        .status(409)
        .json({ message: 'An account with this email already exists' });
    }

    // Hash the password (10 salt rounds is the common default)
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      passwordHash,
      displayName
    });

    const token = signToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/auth/login
// Body: { email, password }
// Returns: { token, user }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Same error for "no user" and "wrong password" so attackers can't
    // tell which emails are registered.
    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/auth/me (protected)
// passport-jwt has already verified the token and loaded the user, so we can
// just shape req.user for the response.
router.get('/me', verifyToken, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
