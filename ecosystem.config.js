/**
 * PM2 Ecosystem Configuration
 * For managing Node.js processes on DigitalOcean Droplets
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
	apps: [
		{
			name: 'ai-blog-backend',
			script: 'server/index.ts',
			interpreter: 'node',
			interpreter_args: '--loader tsx/esm',
			instances: 1,
			exec_mode: 'fork',
			env: {
				NODE_ENV: 'production',
				PORT: 3001,
				DOTENV_PATH: '.env',
			},
			error_file: './logs/pm2-error.log',
			out_file: './logs/pm2-out.log',
			log_file: './logs/pm2-combined.log',
			time: true,
			autorestart: true,
			watch: false,
			max_memory_restart: '1G',
			// Graceful shutdown
			kill_timeout: 5000,
			wait_ready: true,
			listen_timeout: 10000,
		},
	],
};
