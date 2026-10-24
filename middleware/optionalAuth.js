// Like verifyToken, but never blocks the request.
// Used on the public grade route: a signed-in visitor gets req.user (so their
// search is saved to history); anyone else carries on as a guest.
//
// A missing, expired or invalid token all mean "guest". A visitor with an old
// token left in their browser still sees the grade instead of an error.

const passport = require('passport');

function optionalAuth(req, res, next) {
  passport.authenticate('jwt', { session: false }, (err, user) => {
    if (err) return next(err);
    if (user) req.user = user;
    next();
  })(req, res, next);
}

module.exports = optionalAuth;
