# 🔄 Docker Scripts Migration Guide

This document explains the Docker scripts reorganization where "small" becomes the default and the previous default becomes "complete".

## 📋 **Migration Summary**

| **OLD** | **NEW** | **Description** |
|---------|---------|-----------------|
| `yarn docker:*` | `yarn docker:*:complete` | Full/Heavy version |
| `yarn docker:*:small` | `yarn docker:*` | Light/Default version |

## 🚀 **New Script Structure**

### **Default Scripts (Light/Fast)** 
```bash
yarn docker:build          # Uses docker-compose.dev.small.yml (NEW DEFAULT)
yarn docker:up             # Uses docker-compose.dev.small.yml 
yarn docker:down           # Uses docker-compose.dev.small.yml
yarn docker:start          # Uses docker-compose.dev.small.yml
yarn docker:watch          # Uses docker-compose.dev.small.yml
yarn docker:clean          # Uses docker-compose.dev.small.yml
yarn docker:up:watch       # Uses docker-compose.dev.small.yml
```

### **Complete Scripts (Full/Heavy)**
```bash
yarn docker:build:complete    # Uses docker-compose.dev.yml (OLD DEFAULT)
yarn docker:up:complete       # Uses docker-compose.dev.yml
yarn docker:down:complete     # Uses docker-compose.dev.yml  
yarn docker:start:complete    # Uses docker-compose.dev.yml
yarn docker:watch:complete    # Uses docker-compose.dev.yml
```

## 🎯 **Impact on Development**

### **For Daily Development:**
- **Faster startup** - `yarn docker:start` now uses the lightweight version
- **Less resource usage** - Default scripts use fewer Docker resources
- **Quicker builds** - Default build is optimized for speed

### **For Full Testing:**
- **Complete environment** - Use `:complete` scripts when you need everything
- **Integration testing** - Use `:complete` for comprehensive testing
- **Production-like** - `:complete` scripts mirror production more closely

## 🔧 **Common Commands**

```bash
# Quick development (NEW DEFAULT)
yarn docker:start              # Fast startup
yarn dev:health-check          # Verify it's working

# Full development (when needed)
yarn docker:start:complete     # Complete environment
yarn dev:health-check          # Verify everything

# Cleanup
yarn docker:clean              # Clean restart (light)
yarn dev:clean                 # Full cleanup + restart
```

## ⚠️ **Breaking Changes**

1. **Scripts without suffix** now use `docker-compose.dev.small.yml`
2. **Scripts with `:complete`** now use `docker-compose.dev.yml` 
3. **Removed `:small` suffix** from all scripts

## 🚀 **Setup Script Updated**

The setup script (`yarn setup`) continues to work with the new default (light) Docker configuration.

## 📝 **Notes**

- This change makes development faster by default
- Use `:complete` scripts only when you need the full environment
- All existing functionality is preserved, just reorganized
