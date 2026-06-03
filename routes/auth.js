// Auth routes — email/password registration + login + current-user lookup.
// Both register and login return a signed JWT in the response body.
// The frontend stores the JWT and sends it as "Authorization: Bearer <token>"
// on every protected request.

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const verifyToken = require('../middleware/authMiddleware');

const router = express.Router();

// Used to verify Google ID tokens posted from the frontend's Google Sign-In
// button. The library hits Google's public keys and checks the signature +
// audience + expiry for us.
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

// POST /api/auth/google
// Body: { credential }   -- the Google ID token returned by the Sign-In button
// Returns: { token, user }
// Verifies the ID token with Google's public keys, then either finds an
// existing user (by googleId or email) or creates a brand-new account. Either
// way we mint OUR own JWT and the rest of the app treats this user identically
// to an email/password one.
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ message: 'Google credential is required' });
    }

    // Step 1 — verify the ID token signature/audience/expiry.
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } catch (err) {
      return res.status(401).json({ message: 'Invalid Google credential' });
    }

    const googleId = payload.sub;                          // Google's stable user id
    const email = payload.email?.toLowerCase();
    const emailVerified = payload.email_verified === true;
    const displayName = payload.name || '';

    if (!email || !emailVerified) {
      return res.status(401).json({ message: 'Google account email is not verified' });
    }

    // Step 2 — find an existing user (by googleId first, then by email so
    // someone who originally signed up with email/password gets linked).
    let user = await User.findOne({ googleId });
    if (!user) {
      user = await User.findOne({ email });
    }

    // Step 3a — link Google to an existing email account if needed.
    if (user) {
      let changed = false;
      if (!user.googleId) {
        user.googleId = googleId;
        changed = true;
      }
      if (!user.displayName && displayName) {
        user.displayName = displayName;
        changed = true;
      }
      if (changed) await user.save();
    } else {
      // Step 3b — brand-new account (no passwordHash; this user signs in via Google only).
      user = await User.create({ email, googleId, displayName });
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
