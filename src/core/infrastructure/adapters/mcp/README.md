# Kodus Code Management MCP Server

Este módulo expõe funcionalidades do `CodeManagementService` através do protocolo MCP (Model Context Protocol), permitindo que aplicações externas consumam as operações de gerenciamento de código do Kodus.

## Funcionalidades Disponíveis

### Tools MCP Expostos

1. **`list_repositories`** - Lista repositórios da plataforma configurada (GitHub, GitLab, Azure Repos)
2. **`list_pull_requests`** - Lista pull requests com filtros avançados
3. **`list_commits`** - Lista commits de repositórios específicos
4. **`get_pull_request_details`** - Obtém detalhes específicos de um pull request
5. **`get_repository_files`** - Lista arquivos de um repositório com filtros

## Uso

### Iniciar o MCP Server

```bash
# Via script npm
npm run mcp:server

# Ou diretamente
yarn mcp:server
```

### Configuração do Cliente MCP

Para consumir este servidor MCP, configure seu cliente MCP para se conectar via stdio:

```typescript
import { createMCPAdapter } from '@kodus/flow';

const mcpAdapter = createMCPAdapter({
  servers: [
    {
      name: 'kodus-code-management',
      command: 'npm',
      args: ['run', 'mcp:server']
    }
  ]
});
```

### Exemplos de Uso dos Tools

#### 1. Listar Repositórios

```json
{
  "name": "list_repositories",
  "arguments": {
    "organizationId": "uuid-da-organizacao",
    "teamId": "uuid-do-time",
    "filters": {
      "language": "typescript",
      "archived": false,
      "private": true
    }
  }
}
```

#### 2. Listar Pull Requests

```json
{
  "name": "list_pull_requests", 
  "arguments": {
    "organizationId": "uuid-da-organizacao",
    "teamId": "uuid-do-time",
    "filters": {
      "state": "open",
      "repository": "my-repo",
      "author": "developer",
      "startDate": "2024-01-01",
      "endDate": "2024-12-31"
    }
  }
}
```

#### 3. Listar Commits

```json
{
  "name": "list_commits",
  "arguments": {
    "organizationId": "uuid-da-organizacao", 
    "teamId": "uuid-do-time",
    "repository": {
      "id": "repo-id",
      "name": "repo-name"
    },
    "filters": {
      "since": "2024-01-01",
      "until": "2024-12-31",
      "author": "developer@example.com",
      "branch": "main"
    }
  }
}
```

#### 4. Detalhes de Pull Request

```json
{
  "name": "get_pull_request_details",
  "arguments": {
    "organizationId": "uuid-da-organizacao",
    "teamId": "uuid-do-time",
    "repository": {
      "id": "repo-id",
      "name": "repo-name"
    },
    "prNumber": 123
  }
}
```

#### 5. Arquivos do Repositório

```json
{
  "name": "get_repository_files",
  "arguments": {
    "organizationId": "uuid-da-organizacao",
    "teamId": "uuid-do-time",
    "repository": "my-repo",
    "organizationName": "my-org",
    "branch": "main",
    "filePatterns": ["*.ts", "*.js"],
    "excludePatterns": ["node_modules/**"],
    "maxFiles": 500
  }
}
```

## Arquitetura

```
├── code-management-mcp.server.ts  # MCP Server implementation
├── mcp.module.ts                  # NestJS module
├── mcp-server.ts                  # Executable script
└── README.md                      # Documentação
```

### Componentes

- **`CodeManagementMcpServer`**: Implementação completa do servidor MCP usando SDK oficial
- **`McpModule`**: Módulo NestJS com todas as dependências
- **`mcp-server.ts`**: Script executável com graceful shutdown

## Tecnologias

- **`@modelcontextprotocol/sdk`** - SDK oficial do MCP v1.13.2
- **`@nestjs/common`** - Framework NestJS
- **`CodeManagementService`** - Serviço interno do Kodus
- **TypeScript** - Type safety completo

## Características

### Segurança
- Validação rigorosa via JSON Schema
- Tratamento robusto de erros com `McpError`
- Logging estruturado com NestJS Logger
- Isolamento por organização/equipe

### Performance
- Response padronizado com contadores
- Filtros avançados para reduzir payload
- Timeouts e graceful shutdown

### Observabilidade
- Logs detalhados de execução
- Métricas de sucesso/erro
- Status dos tools via `ListToolsRequestSchema`

## Response Format

Todos os tools retornam dados no formato padrão:

```json
{
  "success": true,
  "count": 25,
  "data": [/* array de resultados */]
}
```

## Extensão

Para adicionar novos tools:

1. **Definir Tool Schema**:
```typescript
{
  name: 'new_tool',
  description: 'Tool description',
  inputSchema: {
    type: 'object',
    properties: { /* definir props */ },
    required: ['requiredProp']
  }
}
```

2. **Adicionar Handler**:
```typescript
case 'new_tool':
  return await this.handleNewTool(args);
```

3. **Implementar Método**:
```typescript
private async handleNewTool(args: any): Promise<CallToolResult> {
  const result = await this.codeManagementService.someMethod(args);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        count: result.length,
        data: result
      }, null, 2)
    } as TextContent]
  };
}
```

## Suporte a Plataformas

O MCP Server funciona com todas as plataformas suportadas pelo Kodus:
- ✅ **GitHub** 
- ✅ **GitLab**
- ✅ **Azure Repos**
- ✅ **Bitbucket** (via factory pattern)