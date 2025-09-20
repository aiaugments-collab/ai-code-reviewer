# 🚀 Kodus AI - Quick Setup Guide

This guide will help you get Kodus AI running on your local machine in just a few minutes.

## Prerequisites

- Node.js (LTS version)
- Yarn or NPM
- Docker
- OpenSSL (usually pre-installed on macOS/Linux)

## Quick Start (Recommended)

For first-time setup, simply run:

```bash
yarn setup
```

This automated script will:
- ✅ Check all dependencies
- 📦 Install project dependencies
- 🔧 Create and configure your `.env` file
- 🔐 Generate secure keys automatically
- 🐳 Set up Docker networks
- 🚀 Start all services
- 📊 Run database migrations
- 🌱 Seed initial data

## Manual Configuration

If you prefer manual setup or need to customize settings:

1. **Install dependencies:**
   ```bash
   yarn install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

3. **Add your OpenAI API key to `.env`:**
   ```env
   API_OPEN_AI_API_KEY=your_api_key_here
   ```

4. **Start services:**
   ```bash
   yarn dev:quick-start
   ```

## Available Scripts

| Command | Description |
|---------|-------------|
| `yarn setup` | Complete first-time setup |
| `yarn dev:health-check` | Verify all services are running |
| `yarn dev:quick-start` | Start services and run health check |
| `yarn dev:restart` | Restart all services |
| `yarn dev:stop` | Stop all services |
| `yarn dev:logs` | View service logs |
| `yarn dev:clean` | Clean restart (removes Docker cache) |

## Health Check

To verify everything is working:

```bash
yarn dev:health-check
```

## Service Endpoints

Once running, you can access:

- **API Health:** http://localhost:3331/health
- **API Base:** http://localhost:3331

## Troubleshooting

If you encounter issues:

1. **Check service status:**
   ```bash
   yarn dev:health-check
   ```

2. **View logs:**
   ```bash
   yarn dev:logs
   ```

3. **Clean restart:**
   ```bash
   yarn dev:clean
   ```

4. **Manual container check:**
   ```bash
   docker ps
   ```

## Getting API Keys

- **OpenAI:** https://platform.openai.com/api-keys
- **Google AI:** https://cloud.google.com/docs/authentication/api-keys
- **Anthropic:** https://docs.anthropic.com/claude/reference/getting-started-with-the-api

## Need Help?

If you're still having trouble, check our [full documentation](./CONTRIBUTING.md) or open an issue.