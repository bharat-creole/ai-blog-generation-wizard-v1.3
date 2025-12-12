# DigitalOcean Droplet Deployment Guide

Complete guide for deploying the AI Blog Generation Wizard on DigitalOcean Droplets (VPS).

## 📋 Prerequisites

- DigitalOcean account
- PostgreSQL database (DigitalOcean Managed Database or self-hosted)
- Domain name (optional, but recommended)
- Environment variables configured

## 🎯 Architecture Overview

**This deployment runs both frontend and backend!** You have two architecture choices:

### Architecture Option A: Nginx Serves Frontend + Proxies API (Recommended)

- **Frontend**: Built static files served directly by Nginx (faster, more efficient)
- **Backend**: Node.js API runs on port 3001 via PM2, Nginx proxies `/api` requests to it

### Architecture Option B: Backend Serves Everything

- **Frontend + Backend**: Both served by Node.js backend on port 3001
- **Nginx**: Acts as reverse proxy/SSL terminator only

We'll use **Architecture Option A** (recommended) in the steps below.

**How it works:**

- User visits `https://yourdomain.com` → Nginx serves static files from `dist/` folder
- User makes API call to `https://yourdomain.com/api/*` → Nginx proxies to `http://localhost:3001/api/*`
- Backend runs continuously via PM2 on port 3001

---

## 🚀 Step-by-Step Deployment

### Step 1: Create a Droplet

1. Log into [DigitalOcean Dashboard](https://cloud.digitalocean.com)
2. Click "Create" → "Droplets"
3. Configure your droplet:

      **Choose an image:**

      - Distribution: Ubuntu
      - Version: 22.04 (LTS) x64

      **Choose a plan:**

      - **Minimum for testing:** Basic plan, $6/month (1GB RAM, 1 vCPU)
      - **Recommended for production:** Basic plan, $12/month (2GB RAM, 1 vCPU)
      - **Better performance:** Basic plan, $18/month (4GB RAM, 2 vCPU)

      **Choose a datacenter region:**

      - Select closest to your users

      **Authentication:**

      - Select your SSH key (recommended)
      - Or use password (less secure)

      **Finalize:**

      - Hostname: `ai-blog-wizard` (or your choice)
      - Tags: `production`, `vps` (optional)
      - Project: Create new or select existing

4. Click "Create Droplet"
5. Wait 1-2 minutes for droplet to be created
6. **Note the IP address** (e.g., `157.230.123.45`)

---

### Step 2: Initial Server Setup

```bash
# SSH into your droplet
ssh root@your_droplet_ip

# Update system
apt update && apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 for process management
npm install -g pm2

# Install Nginx
apt install -y nginx

# Install PostgreSQL client (if using managed database)
apt install -y postgresql-client

# Install Git
apt install -y git
```

---

### Step 3: Clone and Setup Application

```bash
# Clone your repository
cd /var/www
git clone https://github.com/your-username/your-repo.git ai-blog-generation-wizard
cd ai-blog-generation-wizard

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy
```

---

### Step 4: Configure Environment Variables

```bash
# Create .env file
nano .env
```

Add all required environment variables:

```bash
# Database (Required)
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# Server Configuration
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://your-domain.com

# Google Ads API (Optional - for keyword research)
GOOGLE_ADS_DEVELOPER_TOKEN=your_token
GOOGLE_ADS_CLIENT_ID=your_client_id
GOOGLE_ADS_CLIENT_SECRET=your_client_secret
GOOGLE_ADS_REFRESH_TOKEN=your_refresh_token
GOOGLE_ADS_CUSTOMER_ID=your_customer_id
GOOGLE_ADS_LOGIN_CUSTOMER_ID=your_login_customer_id

# Google Search API (Optional - for web search)
GOOGLE_SEARCH_API_KEY=your_api_key
GOOGLE_SEARCH_ENGINE_ID=your_cse_id

# Authentication (If using JWT)
JWT_SECRET=your_secure_random_string_min_32_chars

# Gemini API (Optional - can be client-side BYOK)
GEMINI_API_KEY=your_gemini_key
```

**Generate secure JWT secret:**

```bash
openssl rand -base64 32
```

Save the file: `Ctrl+X`, `Y`, `Enter`

**Secure the file:**

```bash
chmod 600 .env
```

---

### Step 5: Build Frontend

```bash
# Build frontend to dist/ folder
npm run build

# Verify dist folder was created
ls -la dist/
```

---

### Step 6: Setup PM2 for Backend

```bash
# Use the provided ecosystem file
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions it outputs

# Verify backend is running
pm2 status
pm2 logs

# Test backend endpoint
curl http://localhost:3001
```

---

### Step 7: Configure Nginx

```bash
# Copy the provided nginx.conf to Nginx sites
sudo cp nginx.conf /etc/nginx/sites-available/ai-blog-wizard

# Edit the file to update domain name
sudo nano /etc/nginx/sites-available/ai-blog-wizard
```

**Update these values:**

- Replace `your-domain.com` with your actual domain (in 3 places)
- Update the root path if needed: `/var/www/ai-blog-generation-wizard/dist`

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/ai-blog-wizard /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# If test passes, reload Nginx
sudo systemctl reload nginx
```

---

### Step 8: Setup Domain & DNS

1. Log into your domain registrar (Namecheap, Google Domains, etc.)
2. Go to DNS management
3. Add DNS records:

      **For root domain (yourdomain.com):**

      ```
      Type: A
      Name: @
      Value: YOUR_DROPLET_IP
      TTL: 3600
      ```

      **For www subdomain (www.yourdomain.com):**

      ```
      Type: A
      Name: www
      Value: YOUR_DROPLET_IP
      TTL: 3600
      ```

4. Save changes
5. Wait 5-60 minutes for DNS propagation
6. Verify DNS:
      ```bash
      # From your local machine
      nslookup yourdomain.com
      # Should return your droplet IP
      ```

---

### Step 9: Setup SSL Certificate

```bash
# Install Certbot
apt install -y certbot python3-certbot-nginx

# Get SSL certificate (replace with your domain)
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Follow prompts:
# - Enter email address
# - Agree to terms
# - Choose whether to redirect HTTP to HTTPS (select 2 for redirect)
```

**Verify certificate:**

```bash
sudo certbot certificates
```

**Auto-renewal is automatically configured**, but test it:

```bash
sudo certbot renew --dry-run
```

---

### Step 10: Configure Firewall

```bash
# Check UFW status
sudo ufw status

# Allow SSH (IMPORTANT - do this first!)
sudo ufw allow OpenSSH

# Allow HTTP and HTTPS
sudo ufw allow 'Nginx Full'
# Or individually:
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable

# Verify rules
sudo ufw status verbose
```

---

### Step 11: Verify Deployment

```bash
# Check PM2 status
pm2 status

# Check Nginx status
sudo systemctl status nginx

# Test backend
curl http://localhost:3001

# Test from browser
# Visit: https://yourdomain.com
```

---

## 🗄️ Database Setup

### Option A: DigitalOcean Managed Database (Recommended)

1. In DigitalOcean dashboard, go to "Databases"
2. Click "Create Database Cluster"
3. Choose:
      - **Database Engine:** PostgreSQL
      - **Version:** 16
      - **Datacenter:** Same as your droplet
      - **Plan:** Basic ($15/month minimum) or Dev ($12/month)
4. Click "Create Database Cluster"
5. Once created:
      - Go to database settings
      - Click "Connection Details"
      - **Copy the connection string** → Use as `DATABASE_URL` in `.env`
      - Format: `postgresql://user:password@host:port/database?sslmode=require`
6. **Add trusted sources:**
      - Go to "Trusted Sources"
      - Add your droplet's IP address
      - Click "Add Trusted Source"

### Option B: Self-Hosted PostgreSQL

```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql

# In PostgreSQL prompt:
CREATE DATABASE ai_blog;
CREATE USER your_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE ai_blog TO your_user;
\q

# Update DATABASE_URL in .env
# Format: postgresql://your_user:your_password@localhost:5432/ai_blog
```

---

## 🔄 Alternative Architecture: Backend Serves Everything

If you prefer the backend to serve both frontend and backend:

1. Build frontend: `npm run build`
2. Update Nginx to proxy ALL requests to backend (not just `/api`)
3. The backend will automatically serve static files from `dist/` when `NODE_ENV=production`
4. Update `nginx.conf` location `/` block to:
      ```nginx
      location / {
          proxy_pass http://backend;
          proxy_http_version 1.1;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
      }
      ```

---

## 📊 Monitoring & Maintenance

### PM2 Commands

```bash
# View status
pm2 status

# View logs
pm2 logs
pm2 logs --lines 100

# Monitor resources
pm2 monit

# Restart application
pm2 restart ai-blog-backend

# Stop application
pm2 stop ai-blog-backend

# Delete from PM2
pm2 delete ai-blog-backend
```

### Nginx Commands

```bash
# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Restart Nginx
sudo systemctl restart nginx

# View logs
sudo tail -f /var/log/nginx/ai-blog-error.log
sudo tail -f /var/log/nginx/ai-blog-access.log
```

### Database Migrations

```bash
# Run migrations
npx prisma migrate deploy

# Generate Prisma client (if needed)
npx prisma generate

# Open Prisma Studio (for database management)
npx prisma studio
```

### System Monitoring

```bash
# Check disk usage
df -h

# Check memory usage
free -h

# Check CPU usage
top
# or install htop for better interface
apt install -y htop
htop
```

---

## 🔄 Updating Your Application

```bash
# Navigate to project directory
cd /var/www/ai-blog-generation-wizard

# Pull latest changes
git pull

# Install new dependencies (if any)
npm install

# Run migrations (if any)
npx prisma migrate deploy

# Rebuild frontend
npm run build

# Restart backend
pm2 restart ai-blog-backend

# Reload Nginx (if config changed)
sudo nginx -t && sudo systemctl reload nginx
```

---

## 🐛 Troubleshooting

### Backend not starting

```bash
# Check PM2 logs
pm2 logs ai-blog-backend

# Check environment variables
cat .env

# Verify database connection
npx prisma db pull

# Check if port is in use
sudo lsof -i :3001
```

### Frontend not loading

```bash
# Verify build exists
ls -la dist/

# Check Nginx configuration
sudo nginx -t

# Check Nginx error logs
sudo tail -f /var/log/nginx/ai-blog-error.log

# Verify Nginx is serving correct path
# Check root directive in nginx.conf matches actual dist/ location
```

### Nginx 502 Bad Gateway

```bash
# Check if backend is running
pm2 status
curl http://localhost:3001

# Check backend logs
pm2 logs ai-blog-backend

# Restart backend
pm2 restart ai-blog-backend

# Check Nginx upstream configuration
sudo cat /etc/nginx/sites-available/ai-blog-wizard | grep upstream
```

### Database connection errors

```bash
# Verify DATABASE_URL is correct
cat .env | grep DATABASE_URL

# Test database connection
npx prisma db pull

# For managed database: Check trusted sources in DigitalOcean
# Ensure your droplet IP is added to trusted sources
```

### SSL Certificate issues

```bash
# Check certificate status
sudo certbot certificates

# Renew certificate manually
sudo certbot renew

# Check Nginx SSL configuration
sudo nginx -t
```

### Port already in use

```bash
# Check what's using port 3001
sudo lsof -i :3001

# Or
sudo netstat -tulpn | grep 3001

# Stop conflicting service or change port in ecosystem.config.js
```

---

## 🔒 Security Checklist

- [ ] All `.env` files are in `.gitignore`
- [ ] `.env` has permissions `600` (read/write for owner only)
- [ ] Use strong `JWT_SECRET` (32+ random characters)
- [ ] SSL/HTTPS is enabled and working
- [ ] Firewall (UFW) is configured and enabled
- [ ] SSH keys are used instead of passwords
- [ ] Regular system updates are applied
- [ ] Database uses SSL connection (managed database)
- [ ] Nginx security headers are configured
- [ ] PM2 is configured to restart on failure

---

## 📚 Additional Resources

- [DigitalOcean Droplets Guide](https://docs.digitalocean.com/products/droplets/)
- [Prisma Deployment Guide](https://www.prisma.io/docs/guides/deployment)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)

---

## ✅ Quick Reference Commands

```bash
# PM2
pm2 status                    # View status
pm2 logs                      # View logs
pm2 restart ai-blog-backend   # Restart backend

# Nginx
sudo nginx -t                 # Test config
sudo systemctl reload nginx   # Reload Nginx

# Application
cd /var/www/ai-blog-generation-wizard
git pull                      # Update code
npm run build                 # Rebuild frontend
pm2 restart ai-blog-backend   # Restart backend

# Database
npx prisma migrate deploy     # Run migrations
npx prisma studio            # Open database GUI

# System
df -h                         # Disk usage
free -h                       # Memory usage
sudo ufw status               # Firewall status
```

---

**Congratulations! 🎉 Your application should now be live on DigitalOcean!**
