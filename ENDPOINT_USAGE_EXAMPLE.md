# Endpoint de Execuções de Pull Requests

## Endpoint
```
GET /pull-requests/executions
```

## Parâmetros de Query (todos opcionais)
- `repositoryId` - Filtrar por ID do repositório
- `repositoryName` - Filtrar por nome do repositório
- `limit` - Número de itens por página (padrão: 30, máximo: 100)
- `page` - Número da página (padrão: 1)

## Autenticação
- Requer usuário logado
- A organização é obtida automaticamente do usuário logado via `REQUEST`

## Exemplos de Uso

### 1. Buscar todos os PRs da organização
```bash
GET /pull-requests/executions
Authorization: Bearer <token>
```

### 2. Filtrar por nome do repositório
```bash
GET /pull-requests/executions?repositoryName=meu-repo
Authorization: Bearer <token>
```

### 3. Filtrar por ID do repositório
```bash
GET /pull-requests/executions?repositoryId=123456
Authorization: Bearer <token>
```

### 4. Filtrar por nome e ID do repositório
```bash
GET /pull-requests/executions?repositoryName=meu-repo&repositoryId=123456
Authorization: Bearer <token>
```

### 5. Paginação - Primeira página com 10 itens
```bash
GET /pull-requests/executions?limit=10&page=1
Authorization: Bearer <token>
```

### 6. Paginação - Segunda página com 10 itens
```bash
GET /pull-requests/executions?limit=10&page=2
Authorization: Bearer <token>
```

### 7. Combinando filtros e paginação
```bash
GET /pull-requests/executions?repositoryName=meu-repo&limit=20&page=1
Authorization: Bearer <token>
```

## Resposta

A resposta agora é paginada e inclui metadados de paginação:

```json
{
  "data": [
    {
    "prId": "uuid-do-pr",
    "prNumber": 123,
    "title": "Feature: Add new functionality",
    "status": "open",
    "merged": false,
    "url": "https://github.com/org/repo/pull/123",
    "baseBranchRef": "main",
    "headBranchRef": "feature/new-functionality",
    "repositoryName": "meu-repo",
    "repositoryId": "123456",
    "openedAt": "2024-01-15T10:30:00Z",
    "closedAt": null,
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z",
    "provider": "github",
    "author": {
      "id": "user123",
      "username": "johndoe",
      "name": "John Doe"
    },
    "isDraft": false,
    "automationExecution": {
      "uuid": "exec-uuid",
      "status": "success",
      "errorMessage": null,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:35:00Z",
      "origin": "System"
    },
    "codeReviewTimeline": [
      {
        "uuid": "cre-uuid-1",
        "createdAt": "2024-01-15T10:30:00Z",
        "updatedAt": "2024-01-15T10:30:00Z",
        "status": "pending",
        "message": "Starting code review"
      },
      {
        "uuid": "cre-uuid-2",
        "createdAt": "2024-01-15T10:32:00Z",
        "updatedAt": "2024-01-15T10:32:00Z",
        "status": "in_progress",
        "message": "Analyzing code changes"
      },
      {
        "uuid": "cre-uuid-3",
        "createdAt": "2024-01-15T10:35:00Z",
        "updatedAt": "2024-01-15T10:35:00Z",
        "status": "success",
        "message": "Code review completed successfully"
      }
    ],
    "enrichedData": {
      "repository": {
        "id": "123456",
        "name": "meu-repo"
      },
      "pullRequest": {
        "number": 123,
        "title": "Feature: Add new functionality",
        "url": "https://github.com/org/repo/pull/123"
      },
      "team": {
        "name": "Development Team",
        "uuid": "team-uuid"
      },
      "automation": {
        "name": "Code Review Automation",
        "type": "AUTOMATION_CODE_REVIEW"
      }
    }
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalItems": 142,
    "itemsPerPage": 30,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

## Características

- **Organização automática**: A organização é obtida do usuário logado
- **Timeline completa**: Histórico de todas as execuções de code review
- **Dados enriquecidos**: Informações do PR, repositório, equipe e automação
- **Filtros opcionais**: Por ID ou nome do repositório
- **Ordenação**: PRs mais recentes primeiro
- **Validação**: Verifica se o usuário tem organização válida
- **Paginação**: Suporte a paginação com limit máximo de 100 itens
- **Cache**: Cache de 5 minutos para otimizar performance
- **Invalidação automática**: Cache é invalidado quando nova automation execution é criada
