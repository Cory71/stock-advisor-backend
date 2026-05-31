// User model
// A registered user. Either email/password (bcrypt-hashed) or Google sign-in
// (Google Identity Services), or both linked by the same email. Both paths
// end at the same signed JWT — the rest of the app doesn't care which one
// the user used.

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Email is the primary identifier and is required for every account.
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },

  // bcrypt-hashed password. Optional because Google-only accounts won't have one.
  passwordHash: {
    type: String
  },

  // Google's user ID. Optional because password-only accounts won't have one.
  // `sparse: true` lets multiple users have no googleId without unique-index conflicts.
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },

  // Pulled from the Google profile when available, otherwise blank.
  displayName: {
    type: String
  }
}, { timestamps: true }); // adds createdAt + updatedAt automatically

module.exports = mongoose.model('User', userSchema);
