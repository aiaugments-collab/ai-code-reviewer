# 🎯 TypeScript 2025 - Boas Práticas e Recomendações

## 📋 Contexto para LLM

Este documento serve como guia para implementação de TypeScript em projetos enterprise, especialmente frameworks de orquestração de agentes de IA. Foco em **type safety robusto** mas **simplicidade prática** para equipes grandes.

---

## 🚀 Princípios Fundamentais

### 1. **Simplicidade > Complexidade**
```ts
// ✅ String simples (prático)
type UserId = string;
type TenantId = string;
type CorrelationId = string;

// ❌ Branded types (over-engineering)
type UserId = Brand<string, 'UserId'>;
```

### 2. **Co-location (Tipos próximos ao uso)**
```ts
// ✅ Componente com seus tipos
// src/components/UserCard/UserCard.tsx
interface UserCardProps {
  user: User;
  onEdit?: () => void;
}

export const UserCard = ({ user, onEdit }: UserCardProps) => {
  // implementação
};
```

### 3. **Feature-based Organization**
```
src/
├── features/
│   ├── auth/
│   │   ├── types.ts
│   │   ├── components/
│   │   └── hooks/
│   └── agents/
│       ├── types.ts
│       └── components/
├── shared/
│   ├── types/
│   │   ├── api.ts
│   │   └── common.ts
│   └── utils/
└── components/
    └── ui/
        ├── Button/
        │   ├── Button.tsx
        │   └── types.ts
        └── Modal/
            ├── Modal.tsx
            └── types.ts
```

---

## 🎯 Tipos Básicos e Avançados

### 1. **Interfaces vs Types**
```ts
// ✅ Interface - Para objetos extensíveis
interface User {
  name: string;
  email: string;
}

interface User {
  age?: number; // ✅ Pode estender
}

// ✅ Type - Para unions, intersections
type UserRole = 'admin' | 'user' | 'guest';
type AdminUser = User & { role: 'admin' };
```

### 2. **Discriminated Unions**
```ts
// ✅ State management limpo
type LoadingState = { status: 'loading' };
type SuccessState<T> = { status: 'success'; data: T };
type ErrorState = { status: 'error'; error: string };

type AsyncState<T> = LoadingState | SuccessState<T> | ErrorState;

// ✅ Pattern matching
const handleState = <T>(state: AsyncState<T>) => {
  switch (state.status) {
    case 'loading': return 'Loading...';
    case 'success': return state.data;
    case 'error': return state.error;
  }
};
```

### 3. **Utility Types**
```ts
// ✅ Reutilização inteligente
type CreateUser = Omit<User, 'id'>;
type UserUpdate = Partial<User>;
type UserRequired = Required<Pick<User, 'name' | 'email'>>;

// ✅ Mapped Types
type Optional<T> = {
  [K in keyof T]?: T[K];
};

type Readonly<T> = {
  readonly [K in keyof T]: T[K];
};
```

### 4. **Generics**
```ts
// ✅ Reutilizável
function identity<T>(arg: T): T {
  return arg;
}

// ✅ Classes genéricas
class Container<T> {
  private value: T;
  
  constructor(value: T) {
    this.value = value;
  }
  
  getValue(): T {
    return this.value;
  }
}

// ✅ Constraints
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

### 5. **Template Literal Types**
```ts
// ✅ URLs tipadas
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type ApiEndpoint = `${HttpMethod} /api/${string}`;

// ✅ CSS Units
type CssUnit = `${number}px` | `${number}em` | `${number}rem`;
type CssColor = `#${string}` | `rgb(${number}, ${number}, ${number})`;
```

---

## 🔧 Padrões Avançados

### 1. **Type Guards**
```ts
// ✅ Runtime type checking
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isUser(obj: unknown): obj is User {
  return obj !== null && 
         typeof obj === 'object' && 
         'name' in obj && 
         'email' in obj;
}

// ✅ Discriminated union guards
function isSuccessState<T>(state: AsyncState<T>): state is SuccessState<T> {
  return state.status === 'success';
}
```

### 2. **Builder Pattern**
```ts
// ✅ Query Builder Tipado
class QueryBuilder<T> {
  private query: Partial<T> = {};

  where<K extends keyof T>(key: K, value: T[K]): this {
    this.query[key] = value;
    return this;
  }

  build(): T {
    return this.query as T;
  }
}
```

### 3. **Conditional Types**
```ts
// ✅ Type Guards Inteligentes
type IsArray<T> = T extends readonly any[] ? true : false;
type ArrayElement<T> = T extends readonly (infer U)[] ? U : never;

// ✅ Mapped Types Condicionais
type OptionalProps<T> = {
  [K in keyof T as T[K] extends undefined ? never : K]: T[K];
};
```

### 4. **Recursive Types**
```ts
// ✅ JSON Schema Types
type JsonValue = 
  | string 
  | number 
  | boolean 
  | null 
  | JsonValue[] 
  | { [key: string]: JsonValue };

// ✅ Tree Structures
type TreeNode<T> = {
  value: T;
  children: TreeNode<T>[];
};
```

---

## 🎯 Validação e Runtime Safety

### 1. **TypeScript Nativo (Recomendado)**
```ts
// ✅ Simples e eficiente
interface User {
  name: string;
  email: string;
}

// ✅ Validação manual quando necessário
const validateUser = (data: unknown): data is User => {
  return typeof data === 'object' && 
         data !== null && 
         'name' in data && 
         'email' in data &&
         typeof (data as any).name === 'string' &&
         typeof (data as any).email === 'string';
};
```

### 2. **Alternativas Modernas**
```ts
// ✅ Valibot (1.5kb - leve)
import { object, string, parse } from 'valibot';

const UserSchema = object({
  name: string(),
  email: string()
});

type User = Input<typeof UserSchema>;
const user = parse(UserSchema, data);

// ✅ TypeBox (Schema-first)
import { Type } from '@sinclair/typebox';

const UserSchema = Type.Object({
  name: Type.String(),
  email: Type.String()
});

type User = Static<typeof UserSchema>;
```

---

### 2. **Barrel Exports**
```ts
// ✅ src/features/auth/index.ts
export * from './types';
export * from './components';
export * from './hooks';

// ✅ src/shared/types/index.ts
export * from './api';
export * from './common';
export * from './utils';
```

### 3. **Co-location Strategy**
```ts
// ✅ Tipos próximos ao uso
// src/features/auth/components/LoginForm.tsx
interface LoginFormProps {
  onSubmit: (credentials: LoginCredentials) => void;
}

// src/features/auth/types.ts
interface LoginCredentials {
  email: string;
  password: string;
}
```

---

## 🚀 TypeScript 5.0+ - Recursos Avançados

### 1. **Satisfies Operator**
```ts
// ✅ Type checking sem perder inferência
const config = {
  api: 'https://api.example.com',
  timeout: 5000,
} satisfies Config;

// ✅ Mantém autocomplete e type safety
config.api; // ✅ Autocomplete funciona
config.timeout; // ✅ Autocomplete funciona
```

### 2. **Template Literal Types Avançados**
```ts
// ✅ APIs tipadas
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type ApiEndpoint = `${HttpMethod} /api/${string}`;

// ✅ CSS Units tipadas
type CssUnit = `${number}px` | `${number}em` | `${number}rem`;
type CssColor = `#${string}` | `rgb(${number}, ${number}, ${number})`;

// ✅ File paths tipados
type FilePath = `/${string}.${'ts' | 'js' | 'json'}`;
```

### 3. **Mapped Types Avançados**
```ts
// ✅ API Responses automático
type ApiResponses = {
  [K in keyof ApiEndpoints]: ApiEndpoints[K]['response'];
};

// ✅ Mapped Types Condicionais
type OptionalProps<T> = {
  [K in keyof T as T[K] extends undefined ? never : K]: T[K];
};

// ✅ Remover propriedades específicas
type RemoveProps<T, K extends keyof T> = {
  [P in keyof T as P extends K ? never : P]: T[P];
};
```

### 4. **Type Guards Inteligentes**
```ts
// ✅ Verificar se é array
type IsArray<T> = T extends readonly any[] ? true : false;

// ✅ Extrair tipo do array
type ArrayElement<T> = T extends readonly (infer U)[] ? U : never;

// ✅ Verificar se é objeto
type IsObject<T> = T extends object ? true : false;

// ✅ Verificar se é função
type IsFunction<T> = T extends (...args: any[]) => any ? true : false;
```

### 5. **Recursive Types**
```ts
// ✅ JSON Schema completo
type JsonValue = 
  | string 
  | number 
  | boolean 
  | null 
  | JsonValue[] 
  | { [key: string]: JsonValue };

// ✅ Tree Structures
type TreeNode<T> = {
  value: T;
  children: TreeNode<T>[];
};

// ✅ Deep Partial
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
```

### 6. **Runtime Validation + Type Safety**
```ts
// ✅ Zod + TypeScript
import { z } from 'zod';

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

type User = z.infer<typeof UserSchema>;

// ✅ Type Guards com Zod
const isUser = (data: unknown): data is User => {
  return UserSchema.safeParse(data).success;
};

// ✅ Validação em runtime
const validateUser = (data: unknown): User => {
  return UserSchema.parse(data);
};
```

### 7. **State Management Moderno**
```ts
// ✅ Discriminated Unions para estados
type LoadingState = { status: 'loading' };
type SuccessState<T> = { status: 'success'; data: T };
type ErrorState = { status: 'error'; error: string };

type AsyncState<T> = LoadingState | SuccessState<T> | ErrorState;

// ✅ Pattern Matching
const handleState = <T>(state: AsyncState<T>) => {
  switch (state.status) {
    case 'loading': return 'Loading...';
    case 'success': return state.data;
    case 'error': return state.error;
  }
};

// ✅ Type-safe state transitions
type StateTransition<T> = {
  from: AsyncState<T>;
  to: AsyncState<T>;
  action: string;
};
```

### 8. **Query Builder Tipado**
```ts
// ✅ Builder Pattern com type safety
class QueryBuilder<T> {
  private query: Partial<T> = {};

  where<K extends keyof T>(key: K, value: T[K]): this {
    this.query[key] = value;
    return this;
  }

  build(): T {
    return this.query as T;
  }
}

// ✅ Uso
const userQuery = new QueryBuilder<User>()
  .where('name', 'João')
  .where('age', 25)
  .build();
```

### 9. **Lazy e Memoized Types**
```ts
// ✅ Lazy evaluation
type Lazy<T> = () => T;

// ✅ Memoized types
type Memoized<T> = T & { __memoized: true };

// ✅ Conditional memoization
type MaybeMemoized<T, B extends boolean> = B extends true 
  ? Memoized<T> 
  : T;
```

### 10. **Bundle Size Optimization**
```ts
// ✅ Pick apenas o necessário
type OnlyNeeded<T, K extends keyof T> = Pick<T, K>;

// ✅ Omit propriedades desnecessárias
type WithoutProps<T, K extends keyof T> = Omit<T, K>;

// ✅ Conditional exports
type ExportConditional<T, B extends boolean> = B extends true 
  ? T 
  : never;
```

### 11. **Auto-generated Types**
```ts
// ✅ From API specs (OpenAPI)
type ApiSpec = {
  '/users': { GET: { response: User[] } };
  '/users/{id}': { GET: { response: User } };
};

// ✅ From runtime data
const createTypeFromData = <T>(data: T): T => data;
type InferredType = ReturnType<typeof createTypeFromData>;

// ✅ Smart type suggestions
type SuggestProps<T> = {
  [K in keyof T]: T[K] extends string ? `${K}Options` : never;
}[keyof T];
```

### 12. **Advanced Utility Types**
```ts
// ✅ Deep readonly
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object 
    ? DeepReadonly<T[P]> 
    : T[P];
};

// ✅ Deep required
type DeepRequired<T> = {
  [P in keyof T]: T[P] extends object 
    ? DeepRequired<T[P]> 
    : Required<T>[P];
};

// ✅ Path to property
type Paths<T> = {
  [K in keyof T]: T[K] extends object 
    ? `${K & string}.${Paths<T[K]> & string}` 
    : K;
}[keyof T];
```

---

## 🎯 Padrões para Framework Enterprise

### 1. **Contextos Base**
```ts
// ✅ Base simples
interface BaseContext {
  tenantId: string;
  correlationId: string;
}

// ✅ Extensões específicas
interface AgentContext extends BaseContext {
  agentName: string;
  invocationId: string;
  stateManager: ContextStateService;
  availableTools: Tool[];
  signal: AbortSignal;
}
```

### 2. **Actions/Events**
```ts
// ✅ Discriminated unions
type AgentAction = 
  | { type: 'start'; agentName: string }
  | { type: 'stop'; reason?: string }
  | { type: 'pause'; saveState: boolean }
  | { type: 'resume'; snapshotId?: string };

// ✅ Event handling
type AgentEvent = 
  | { type: 'agent.started'; agentName: string; timestamp: number }
  | { type: 'agent.stopped'; agentName: string; reason: string }
  | { type: 'agent.error'; agentName: string; error: string };
```

### 3. **State Management**
```ts
// ✅ Estados tipados
type AgentState = 
  | { status: 'idle' }
  | { status: 'starting'; agentName: string }
  | { status: 'running'; startTime: number; agentName: string }
  | { status: 'paused'; pauseTime: number; agentName: string }
  | { status: 'error'; error: string; agentName: string };

// ✅ Async states
type AsyncState<T> = 
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };
```

---

## ❌ Evitar

1. **Branded types** (a menos que seja crítico)
2. **Over-engineering** de tipos simples
3. **Any** (use `unknown` + type guards)
4. **Type assertions** desnecessárias
5. **Complexidade** desnecessária
6. **Zod** para projetos simples (use TypeScript nativo)

---

## ✅ Preferir

1. **String simples** para IDs
2. **Discriminated unions** para estados
3. **Co-location** para organização
4. **Utility types** para reutilização
5. **Type guards** para runtime safety
6. **Simplicidade** sobre complexidade
7. **TypeScript nativo** para validação

---

## 🎯 Configuração Recomendada

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false
  }
}
```

---

## 🚀 Trends 2025

1. **Runtime Type Safety**: Valibot, TypeBox (leves)
2. **Compile-time Validation**: Elysia, Bun
3. **Template Literal Types**: URLs, CSS, APIs tipadas
4. **Discriminated Unions**: State management
5. **Utility Types**: Reutilização de tipos
6. **Type Guards**: Runtime safety
7. **Simplicidade**: Menos over-engineering

---

## 🎯 Decisão Final para Kodus Flow

**Para Framework Enterprise:**

- **String** para todos os IDs
- **Discriminated unions** para estados
- **Co-location** para organização
- **TypeScript nativo** para validação
- **Simplicidade** sobre complexidade
- **Feature-based** para escalabilidade

**Resumo**: TypeScript é sobre **type safety** + **developer experience** + **performance**. Use o que faz sentido para seu projeto, não over-engineer! 
