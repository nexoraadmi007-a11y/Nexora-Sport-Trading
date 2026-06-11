const { spawnSync } = require('node:child_process');

const workspaces = [
  '@nexora/types',
  '@nexora/shared',
  '@nexora/utils',
  '@nexora/football-over15-engine',
  '@nexora/football-btts-engine',
  '@nexora/football-doublechance-engine',
  '@nexora/nba-playerprops-engine',
  '@nexora/nba-teamtotals-engine',
  '@nexora/nba-firsthalf-engine',
  '@nexora/data-engine',
  '@nexora/sharpapi-data-engine',
  '@nexora/market-engine',
  '@nexora/signal-engine',
  '@nexora/telegram-engine',
  '@nexora/clv-engine',
  '@nexora/risk-engine',
  '@nexora/analytics-engine',
  '@nexora/persistence-engine',
  '@nexora/api',
  '@nexora/worker'
];

for (const workspace of workspaces) {
  console.log(`\n[build] ${workspace}`);
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run build -w ${workspace}`]
    : ['run', 'build', '-w', workspace];
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false
  });

  if (result.error) {
    console.error(`[build] ${workspace} failed to start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[build] ${workspace} failed with status ${result.status}`);
    process.exit(result.status || 1);
  }
}
