module.exports = {
  apps: [{
    name: 'dinheiro-fala',
    script: 'src/index.js',
    cwd: __dirname,
    autorestart: true,
    max_restarts: 20,
    restart_delay: 5000,
    max_memory_restart: '300M',
    time: true,
    env: { NODE_ENV: 'production', TZ: 'America/Sao_Paulo' },
  }],
};
