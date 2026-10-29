import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const { app, db } = createApp(config);

const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
if (n === 0) console.warn('No users yet. Run `npm run seed` to create the first admin account.');

app.listen(config.port, () => {
  console.log(`FE Booking running on http://localhost:${config.port}`);
});
