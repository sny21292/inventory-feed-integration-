module.exports = {
  apps: [
    {
      name: 'inventory-feed-integration',
      script: 'src/index.js',
      cwd: '/root/inventory-feed-integration',
      env: {
        NODE_ENV: 'production',
      },
      watch: false,
      max_memory_restart: '150M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/root/inventory-feed-integration/logs/error.log',
      out_file: '/root/inventory-feed-integration/logs/output.log',
    },
  ],
};
