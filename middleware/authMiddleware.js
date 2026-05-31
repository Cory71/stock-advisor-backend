// Route protection middleware. Delegates to passport-jwt to verify the
// Authorization: Bearer <token> header and load the user.
// Wrapping passport.authenticate manually so we can return a friendly JSON
// error instead of Passport's default plain-text "Unauthorized".

const passport = require('passport');

function verifyToken(req, res, next) {
  passport.authenticate('jwt', { session: false }, (err, user) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).json({ message: 'Missing or invalid token' });
    }
    req.user = user;
    next();
  })(req, res, next);
}

module.exports = verifyToken;
