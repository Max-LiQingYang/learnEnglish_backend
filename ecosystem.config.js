module.exports = {
  apps: [
    {
      name: 'learn-english-backend',
      script: 'dist/app.js',
      cwd: '/projects/myApp/learnEnglish-backend',
      exec_mode: 'cluster',
      instances: 2,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        DB_POOL_MAX: '10',
        SLOW_REQUEST_MS: '1000',
        SLOW_QUERY_MS: '200',
      },
    },
  ],
};
