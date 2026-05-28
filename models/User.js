// User model
// A registered user. Either email/password (Passport Local) or Google sign-in
// (Passport Google OAuth), or both linked by the same email.

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
