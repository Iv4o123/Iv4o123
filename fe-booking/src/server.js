import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const { app, db } = createApp(config);

const { n } = db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get();

app.listen(config.port, () => {
  console.log(`FE Booking running on http://localhost:${config.port}`);
  console.log(`Data folder: ${config.dataDir} (${n} active user${n === 1 ? '' : 's'})`);
  if (n === 0) console.warn('No users yet. Run `npm run seed:demo` (demo accounts) or `npm run seed` (your admin from .env).');
  if (config.cookieSecure) console.log('COOKIE_SECURE=1: sign-in only works over https://');
});
