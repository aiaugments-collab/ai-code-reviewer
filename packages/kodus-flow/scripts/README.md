# 📦 Scripts de Gerenciamento - Kodus Flow

## 🔧 Scripts Disponíveis

### 1. **manage-npmrc.sh** - Gerenciador de Configuração
Gerencia o arquivo `.npmrc` dinamicamente para desenvolvimento e publicação.

```bash
# Para desenvolvimento (comentar registry problemático)
./scripts/manage-npmrc.sh dev

# Para publicação (descomentar e configurar Project ID)
./scripts/manage-npmrc.sh publish kodus-infra-prod

# Para restaurar configuração original
./scripts/manage-npmrc.sh restore
```

### 2. **publish-with-project.sh** - Publicação Automática
Publica o package no Google Artifact Registry com autenticação automática.

```bash
# Publicar com Project ID específico
./scripts/publish-with-project.sh kodus-infra-prod
```

### 3. **refresh-token.sh** - Renovação de Token
Renova o token de autenticação do Google Cloud.

```bash
# Renovar token para Project ID específico
source scripts/refresh-token.sh kodus-infra-prod

# Renovar token para Project ID configurado no gcloud
source scripts/refresh-token.sh
```

## 🚀 Fluxo de Trabalho

### **Desenvolvimento Diário**
```bash
# 1. Configurar para desenvolvimento
./scripts/manage-npmrc.sh dev

# 2. Instalar dependências
yarn install

# 3. Desenvolver
yarn dev
yarn build
yarn test
yarn lint
```

### **Publicação**
```bash
# 1. Publicar (configura automaticamente)
./scripts/publish-with-project.sh kodus-infra-prod

# 2. Ou configurar manualmente
./scripts/manage-npmrc.sh publish kodus-infra-prod
yarn build && yarn lint && npm publish
./scripts/manage-npmrc.sh restore
```

## 🔍 Solução de Problemas

### **Erro: "Failed to replace env in config: ${GAR_PROJECT_ID}"**
```bash
# Solução: Configurar para desenvolvimento
./scripts/manage-npmrc.sh dev
```

### **Erro: "Command not found"**
```bash
# Solução: Tornar scripts executáveis
chmod +x scripts/*.sh
```

### **Erro: "Node version incompatible"**
```bash
# Solução: Usar versão correta do Node
nvm use
```

## 📋 Pré-requisitos

1. **Node.js 20+** (configurado via nvm)
2. **Google Cloud CLI** instalado e autenticado
3. **Yarn** instalado
4. **Permissões** de publicação no Google Artifact Registry

## 🎯 Configuração Inicial

```bash
# 1. Configurar Node.js
nvm use

# 2. Configurar para desenvolvimento
./scripts/manage-npmrc.sh dev

# 3. Instalar dependências
yarn install

# 4. Verificar se tudo funciona
yarn build
yarn test
```

## 🔐 Autenticação

O sistema usa autenticação automática via Google Cloud CLI:

```bash
# Verificar se está autenticado
gcloud auth list

# Fazer login se necessário
gcloud auth login

# Configurar Project ID padrão
gcloud config set project kodus-infra-prod
```

## 📝 Notas Importantes

- O `.npmrc` é gerenciado automaticamente pelos scripts
- A variável `${GAR_PROJECT_ID}` só é resolvida durante publicação
- Para desenvolvimento, o registry problemático é comentado
- Sempre use `nvm use` antes de executar comandos yarn
- Os warnings do ESLint são normais (console.log em testes) 
