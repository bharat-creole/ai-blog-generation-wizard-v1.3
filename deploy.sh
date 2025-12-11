#!/bin/bash
# Quick deployment script for DigitalOcean Droplet
# Usage: ./deploy.sh

set -e

echo "🚀 Starting deployment..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create .env with all required environment variables."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Generate Prisma client
echo "🗄️  Generating Prisma client..."
npx prisma generate

# Run database migrations
echo "🔄 Running database migrations..."
npx prisma migrate deploy

# Build frontend
echo "🏗️  Building frontend..."
npm run build

# Restart PM2 process
if command -v pm2 &> /dev/null; then
    echo "🔄 Restarting PM2 process..."
    pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js
    pm2 save
    echo "✅ Deployment complete! Check status with: pm2 status"
else
    echo "⚠️  PM2 not found. Install with: npm install -g pm2"
    echo "Then start with: pm2 start ecosystem.config.js"
fi

echo "✅ Deployment script completed!"
