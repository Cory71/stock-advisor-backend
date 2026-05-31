// Passport JWT strategy.
// Pulls the JWT off the Authorization: Bearer <token> header, verifies it
// with JWT_SECRET, looks up the user, and attaches the full Mongoose user
// document (minus passwordHash) to req.user on protected routes.

const passport = require('passport');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const User = require('../models/User');

passport.use(new JwtStrategy(
  {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey:    process.env.JWT_SECRET
  },
  async (payload, done) => {
    try {
      // Look up the user by the id we stored in the JWT payload.
      // Excluding passwordHash so it never gets attached to req.user.
      const user = await User.findById(payload.id).select('-passwordHash');
      if (user) return done(null, user);
      return done(null, false); // token valid, but user no longer exists
    } catch (err) {
      return done(err, false);
    }
  }
));

module.exports = passport;
