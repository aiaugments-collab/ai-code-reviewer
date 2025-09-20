# MCP Adapter - Kodus Flow

O adaptador MCP (Model Context Protocol) permite integrar servidores MCP externos ao Kodus Flow, fornecendo acesso a ferramentas, recursos e prompts de forma padronizada.

## 🚀 **Características**

- ✅ **Múltiplos Servidores**: Conecta a vários servidores MCP simultaneamente
- ✅ **Filtros Avançados**: Controle granular de quais tools são permitidas/bloqueadas
- ✅ **Logging Detalhado**: Debugging completo com observabilidade
- ✅ **Tratamento de Erros**: Recuperação robusta de falhas
- ✅ **Validação de Schemas**: Verificação automática de schemas MCP
- ✅ **TypeScript**: Tipagem completa e segura

## 📋 **Uso Básico**

```typescript
import { createMCPAdapter } from '@kodus-flow/adapters';

const mcpAdapter = createMCPAdapter({
  servers: [
    {
      name: 'filesystem',
      type: 'http',
      url: 'http://localhost:3000',
    },
    {
      name: 'github',
      type: 'http', 
      url: 'http://localhost:3001',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`
      }
    }
  ]
});

// Conectar aos servidores
await mcpAdapter.connect();

// Obter tools disponíveis
const tools = await mcpAdapter.getTools();

// Usar com agente
const agent = createAgent({
  tools: tools,
});
```

## 🔧 **Configuração**

### **Servidores MCP**

```typescript
interface MCPServerConfig {
  name: string;           // Nome único do servidor
  type: 'http' | 'sse';  // Tipo de transporte
  url?: string;          // URL do servidor (HTTP/SSE)
  headers?: Record<string, string>; // Headers customizados
  timeout?: number;      // Timeout em ms
  retries?: number;      // Tentativas de retry
}
```

### **Filtros de Tools**

```typescript
// Whitelist - apenas tools permitidas
allowedTools: {
  names: ['read_file', 'write_file'],     // Nomes específicos
  patterns: [/^read_/, /^write_/],       // Padrões regex
  servers: ['filesystem'],                // Servidores específicos
  categories: ['file_ops'],               // Categorias
}

// Blacklist - tools bloqueadas (tem prioridade)
blockedTools: {
  names: ['delete_file', 'format_disk'],  // Nomes específicos
  patterns: [/delete/, /format/],         // Padrões regex
  servers: ['dangerous_server'],          // Servidores específicos
  categories: ['destructive'],            // Categorias
}
```

## 🎯 **Exemplos Avançados**

### **Filtros por Padrão**

```typescript
const mcpAdapter = createMCPAdapter({
  servers: [
    {
      name: 'filesystem',
      type: 'http',
      url: 'http://localhost:3000',
    }
  ],
  // Permitir apenas operações de leitura
  allowedTools: {
    patterns: [/^read_/, /^list_/, /^get_/],
  },
  // Bloquear operações perigosas
  blockedTools: {
    patterns: [/delete/, /format/, /shutdown/],
  }
});
```

### **Filtros por Servidor**

```typescript
const mcpAdapter = createMCPAdapter({
  servers: [
    {
      name: 'filesystem',
      type: 'http',
      url: 'http://localhost:3000',
    },
    {
      name: 'github',
      type: 'http',
      url: 'http://localhost:3001',
    }
  ],
  // Permitir apenas filesystem
  allowedTools: {
    servers: ['filesystem'],
  }
});
```

### **Tratamento de Erros**

```typescript
const mcpAdapter = createMCPAdapter({
  servers: [
    {
      name: 'filesystem',
      type: 'http',
      url: 'http://localhost:3000',
    }
  ],
  onError: (error, serverName) => {
    console.error(`MCP server ${serverName} error:`, error);
    
    // Notificar sistema de monitoramento
    monitoring.recordError('mcp_connection_error', {
      server: serverName,
      error: error.message,
    });
  }
});
```

## 🔍 **Debugging**

O sistema MCP possui logging detalhado para debugging:

```typescript
// Logs de conexão
[INFO] MCPRegistry initialized
[INFO] Registering MCP server { serverName: 'filesystem' }
[INFO] Successfully registered MCP server { serverName: 'filesystem' }

// Logs de filtros
[DEBUG] Checking tool against filters { toolName: 'read_file', serverName: 'filesystem' }
[DEBUG] Tool allowed { toolName: 'read_file', serverName: 'filesystem' }
[DEBUG] Tool filtered out { toolName: 'delete_file', serverName: 'filesystem', reason: 'not allowed by filters' }

// Logs de execução
[DEBUG] Called tool { name: 'read_file', success: true }
```

## 🧪 **Testes**

```bash
# Executar testes MCP
npm test tests/adapters/mcp/

# Executar testes específicos
npm test tests/adapters/mcp/registry.test.ts
```

## 📚 **API Reference**

### **MCPAdapter**

```typescript
interface MCPAdapter {
  connect(): Promise<void>;                    // Conectar aos servidores
  disconnect(): Promise<void>;                 // Desconectar
  getTools(): Promise<MCPTool[]>;             // Listar tools
  hasTool(name: string): Promise<boolean>;    // Verificar tool
  executeTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
  getMetrics(): Record<string, unknown>;      // Métricas
}
```

### **MCPRegistry**

```typescript
class MCPRegistry {
  constructor(options: MCPRegistryOptions);
  register(config: MCPServerConfig): Promise<void>;
  unregister(serverName: string): Promise<void>;
  listAllTools(): Promise<MCPToolRawWithServer[]>;
  executeTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
  destroy(): void;
}
```

## 🚨 **Limitações Atuais**

- ❌ Suporte apenas a HTTP/SSE (não stdio/websocket)
- ❌ Sem health checks (removido por incompatibilidade)
- ❌ Sem cache de schemas (mantido simples)
- ❌ Sem recursos e prompts (implementação futura)

## 🔮 **Roadmap**

- [ ] Suporte a stdio/websocket
- [ ] Implementação de recursos
- [ ] Implementação de prompts
- [ ] Health checks compatíveis
- [ ] Cache inteligente
- [ ] Métricas avançadas
- [ ] Rate limiting
- [ ] Circuit breaker

## 🤝 **Contribuindo**

Para contribuir com o sistema MCP:

1. **Teste**: Adicione testes para novas funcionalidades
2. **Documente**: Atualize esta documentação
3. **Valide**: Execute `npm test` antes do PR
4. **Log**: Use logging apropriado para debugging

## 📄 **Licença**

MIT License - veja [LICENSE](../../../LICENSE) para detalhes. 
