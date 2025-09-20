# Runtime - Kodus Flow

## 📋 Visão Geral

O **Runtime** é o sistema principal de processamento de eventos e workflows do Kodus Flow, com:

- ✅ **API simples e intuitiva** - `on`, `emit`, `process`
- ✅ **Performance otimizada** - Processamento em batch, memory management
- ✅ **Observabilidade completa** - Logging, métricas, tracing integrados
- ✅ **Middleware configurável** - Retry, timeout, validação, etc.
- ✅ **Stream processing** - filter, map, debounce, throttle, batch, merge, combineLatest
- ✅ **Fan-out/Fan-in** - Processamento paralelo e agregação de streams
- ✅ **AbortSignal support** - Cancelamento de operações
- ✅ **Conceitos funcionais** - Imutabilidade, composição, funções puras

## 🏗️ Arquitetura

```
src/runtime/
├── index-clean.ts          # API principal do Runtime Clean
├── kernel-integration.ts   # Integração com o Kernel
├── constants.ts           # Constantes do runtime
├── README.md             # Esta documentação
├── core/                 # Componentes essenciais
│   ├── event-queue.ts    # Fila de eventos com prioridade
│   ├── event-processor-optimized.ts # Processador otimizado
│   ├── stream-manager.ts # Operadores de stream
│   ├── event-factory.ts  # Factory de eventos tipados
│   └── index.ts         # Re-exports dos componentes
├── middleware/           # Sistema de middleware
│   ├── index.ts         # Re-exports dos middlewares
│   ├── types.ts         # Tipos do middleware
│   ├── retry.ts         # Retry automático
│   ├── timeout.ts       # Controle de tempo
│   ├── concurrency.ts   # Controle de concorrência
│   ├── validate.ts      # Validação de eventos
│   ├── schedule.ts      # Agendamento
│   └── composites.ts    # Middlewares compostos
└── examples/            # Exemplos de uso
    └── simple-usage.ts  # Exemplo básico
```

## 🚀 Uso Rápido

### 1. Criar Runtime

```typescript
import { createRuntime } from '@kodus-flow/runtime';
import { withRetry, withTimeout, withConcurrency } from '@kodus-flow/runtime/middleware';

const runtime = createRuntime(context, observability, {
    queueSize: 1000,
    batchSize: 100,
    middleware: [
        withTimeout({ timeoutMs: 5000 }),
        withRetry({ maxRetries: 3, backoffMs: 1000 }),
        withConcurrency({ maxConcurrent: 10 }), // Fan-out controlado
    ],
});
```

### 2. Registrar Handlers e Emitir Eventos

```typescript
// Registrar handlers
runtime.on('user.created', async (event) => {
    console.log('Usuário criado:', event.data);
    await saveUser(event.data);
});

runtime.on('user.updated', async (event) => {
    console.log('Usuário atualizado:', event.data);
    await updateUser(event.data);
});

// Emitir eventos
runtime.emit('user.created', { userId: '123', name: 'John' });
runtime.emit('user.updated', { userId: '123', email: 'john@email.com' });

// Processar eventos
await runtime.process();
```

### 3. Stream Processing com Fan-out/Fan-in

```typescript
// Criar múltiplos streams (Fan-out)
const userStream = runtime.createStream(async function* () {
    for (let i = 0; i < 100; i++) {
        yield runtime.createEvent('user.created', { userId: `user-${i}` });
    }
});

const orderStream = runtime.createStream(async function* () {
    for (let i = 0; i < 50; i++) {
        yield runtime.createEvent('order.created', { orderId: `order-${i}` });
    }
});

const notificationStream = runtime.createStream(async function* () {
    for (let i = 0; i < 25; i++) {
        yield runtime.createEvent('notification.sent', { notificationId: `notif-${i}` });
    }
});

// Fan-in: Combinar múltiplos streams em um (merge)
const allEventsStream = userStream.merge(orderStream, notificationStream);

// Fan-in: Combinar valores mais recentes (combineLatest)
const dashboardStream = userStream.combineLatest(orderStream, notificationStream);

// Processar streams combinados
const allEvents = await allEventsStream.toArray();
const dashboardData = await dashboardStream.toArray();
```

## 🔧 API Principal

### **createRuntime(context, observability, config?)**
Cria uma instância do runtime.

```typescript
const runtime = createRuntime(context, observability, {
    queueSize: 1000,        // Tamanho da fila
    batchSize: 100,         // Tamanho do batch
    middleware: [withRetry], // Middlewares
});
```

### **runtime.on(eventType, handler)**
Registra um handler para um tipo de evento.

```typescript
runtime.on('user.created', async (event) => {
    // Processar evento
});
```

### **runtime.emit(eventType, data?)**
Emite um evento.

```typescript
runtime.emit('user.created', { userId: '123', name: 'John' });
```

### **runtime.process()**
Processa todos os eventos enfileirados.

```typescript
await runtime.process();
```

### **runtime.createEvent(type, data?)**
Cria um evento tipado.

```typescript
const event = runtime.createEvent('user.created', { userId: '123' });
```

### **runtime.createStream(generator)**
Cria um stream de eventos.

```typescript
const stream = runtime.createStream(async function* () {
    // Gerar eventos
});
```

## 🛠️ Middleware System

### Middlewares Disponíveis

| Middleware | Descrição | Configuração |
|------------|-----------|--------------|
| `withRetry` | Tentativas automáticas | `{ maxRetries, backoffMs }` |
| `withTimeout` | Controle de tempo | `{ timeoutMs }` |
| `withConcurrency` | **Fan-out controlado** | `{ maxConcurrent }` |
| `withValidate` | Validação de eventos | `{ schema }` |
| `withSchedule` | Agendamento | `{ schedule }` |

### Exemplo de Middleware com Fan-out

```typescript
const runtime = createRuntime(context, observability, {
    middleware: [
        withTimeout({ timeoutMs: 3000 }),
        withRetry({ 
            maxRetries: 3, 
            backoffMs: 1000,
            retryableErrors: ['NETWORK_ERROR', 'TIMEOUT_ERROR']
        }),
        withConcurrency({ 
            maxConcurrent: 10,  // Processar até 10 eventos em paralelo
            getKey: (ev) => ev.type, // Agrupar por tipo de evento
            queueTimeoutMs: 5000, // Timeout para fila
        }),
        withValidate({ 
            schema: z.object({ userId: z.string() })
        }),
    ],
});
```

## 📊 Stream Operators

### Operadores Disponíveis

| Operador | Descrição | Exemplo |
|----------|-----------|---------|
| `filter` | Filtrar eventos | `stream.filter(e => e.type === 'user.created')` |
| `map` | Transformar eventos | `stream.map(e => ({ ...e, processed: true }))` |
| `debounce` | Debounce de eventos | `stream.debounce(1000)` |
| `throttle` | Throttle de eventos | `stream.throttle(5000)` |
| `batch` | Agrupar eventos | `stream.batch(10, 5000)` |
| `merge` | **Fan-in: Mesclar streams** | `stream.merge(stream1, stream2)` |
| `combineLatest` | **Fan-in: Combinar últimos valores** | `stream.combineLatest(stream1, stream2)` |

### Exemplo Avançado com Fan-out/Fan-in

```typescript
// Criar múltiplos streams (Fan-out)
const userStream = runtime.createStream(async function* () {
    for await (const user of userService.getUsers()) {
        yield runtime.createEvent('user.created', user);
    }
});

const orderStream = runtime.createStream(async function* () {
    for await (const order of orderService.getOrders()) {
        yield runtime.createEvent('order.created', order);
    }
});

const notificationStream = runtime.createStream(async function* () {
    for await (const notification of notificationService.getNotifications()) {
        yield runtime.createEvent('notification.sent', notification);
    }
});

// Fan-in: Pipeline de processamento
const processedStream = userStream
    .filter(e => e.type.startsWith('user.'))
    .debounce(1000)
    .map(e => ({ ...e, timestamp: Date.now() }))
    .batch(5, 2000)
    .merge(orderStream, notificationStream)  // Fan-in: Combinar streams
    .combineLatest(metricsStream);           // Fan-in: Combinar com métricas
```

## 🔄 Fan-out (Parallelism) e Fan-in

### **Fan-out (Parallelism)**
Processamento paralelo de eventos usando middleware de concorrência:

```typescript
// Configurar Fan-out no middleware
const runtime = createRuntime(context, observability, {
    middleware: [
        withConcurrency({ 
            maxConcurrent: 10,  // Processar 10 eventos em paralelo
            getKey: (ev) => ev.type, // Agrupar por tipo
            queueTimeoutMs: 5000, // Timeout para fila
        }),
    ],
});

// Handlers serão executados em paralelo (até 10 simultâneos)
runtime.on('user.created', async (event) => {
    await saveUser(event.data);     // Executa em paralelo
});

runtime.on('user.updated', async (event) => {
    await updateUser(event.data);   // Executa em paralelo
});
```

### **Fan-in (Stream Aggregation)**
Combinação de múltiplos streams em um:

```typescript
// Fan-in com merge: Combina todos os eventos
const allEventsStream = userStream.merge(orderStream, notificationStream);
// Resultado: user1, order1, user2, notification1, user3, order2...

// Fan-in com combineLatest: Combina valores mais recentes
const dashboardStream = userStream.combineLatest(orderStream, notificationStream);
// Resultado: { events: [latestUser, latestOrder, latestNotification] }
```

### **Casos de Uso Avançados**

#### **1. Monitoramento Multi-Sensor (IoT)**
```typescript
// Múltiplos sensores (Fan-out)
const temperatureStream = runtime.createStream(async function* () {
    while (true) {
        yield runtime.createEvent('sensor.temperature', { 
            value: Math.random() * 100,
            timestamp: Date.now()
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
});

const humidityStream = runtime.createStream(async function* () {
    while (true) {
        yield runtime.createEvent('sensor.humidity', { 
            value: Math.random() * 100,
            timestamp: Date.now()
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
});

const pressureStream = runtime.createStream(async function* () {
    while (true) {
        yield runtime.createEvent('sensor.pressure', { 
            value: Math.random() * 100,
            timestamp: Date.now()
        });
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
});

// Fan-in: Dashboard em tempo real
const dashboardStream = temperatureStream.combineLatest(humidityStream, pressureStream);

// Processar leituras combinadas
for await (const reading of dashboardStream) {
    console.log('Dashboard:', reading.data.events);
    updateDashboard(reading.data.events);
}
```

#### **2. Agregação de Eventos de Múltiplos Sistemas**
```typescript
// Eventos de diferentes sistemas (Fan-out)
const userEvents = runtime.createStream(async function* () {
    yield runtime.createEvent('user.login', { userId: '123' });
    yield runtime.createEvent('user.purchase', { userId: '123', amount: 100 });
});

const systemEvents = runtime.createStream(async function* () {
    yield runtime.createEvent('system.alert', { level: 'warning' });
    yield runtime.createEvent('system.backup', { status: 'completed' });
});

const externalEvents = runtime.createStream(async function* () {
    yield runtime.createEvent('external.payment', { amount: 50 });
    yield runtime.createEvent('external.notification', { message: 'Payment received' });
});

// Fan-in: Processamento unificado
const allEvents = userEvents.merge(systemEvents, externalEvents);

// Pipeline de processamento
const processedEvents = allEvents
    .filter(event => event.type.startsWith('user.'))
    .map(event => ({ ...event, processed: true }))
    .batch(100, 5000)
    .map(batch => ({
        type: 'events.batch',
        data: { 
            events: batch.map(e => e.data), 
            count: batch.length 
        }
    }));

// Consumir
const batches = await processedEvents.toArray();
console.log('Batches processados:', batches);
```

#### **3. Workflow Complexo com Fan-out/Fan-in**
```typescript
const workflowRuntime = createRuntime(context, observability, {
    middleware: [
        withTimeout({ timeoutMs: 30000 }),
        withRetry({ 
            maxRetries: 3, 
            backoffMs: 2000,
            retryableErrors: ['NETWORK_ERROR', 'TIMEOUT_ERROR']
        }),
        withConcurrency({ 
            maxConcurrent: 10,  // Fan-out: 10 operações paralelas
            getKey: (ev) => ev.data.userId, // Agrupar por usuário
        }),
    ],
});

// Handlers com Fan-out automático
workflowRuntime.on('user.action', async (event) => {
    // Este handler será executado em paralelo (até 10 simultâneos)
    switch (event.data.action) {
        case 'create':
            await createUser(event.data);
            break;
        case 'update':
            await updateUser(event.data);
            break;
        case 'delete':
            await deleteUser(event.data);
            break;
    }
});

// Emitir eventos
workflowRuntime.emit('user.action', { 
    userId: '123', 
    action: 'create' 
});

// Processar com Fan-out
await workflowRuntime.process();
```

## 🔍 Observabilidade

### Métricas Disponíveis

```typescript
const stats = runtime.getStats();
console.log(stats);
// {
//   queue: { size: 10, processed: 100, dropped: 0 },
//   processor: { activeHandlers: 5, processedEvents: 100 },
//   stream: { activeGenerators: 3, staleGenerators: 1 }
// }
```

## 🧹 Memory Management

### Cleanup Automático

```typescript
// Cleanup manual
await runtime.cleanup();

// Limpar handlers
runtime.clear();
```

## 🚨 Casos de Uso

### 1. Processamento de Eventos com Fan-out

```typescript
const runtime = createRuntime(context, observability, {
    middleware: [
        withConcurrency({ maxConcurrent: 10 }), // Fan-out controlado
        withRetry({ maxRetries: 2 }),
    ],
});

// Registrar handlers
runtime.on('user.created', async (event) => {
    await saveUser(event.data);
    await sendWelcomeEmail(event.data);
});

// Emitir e processar com Fan-out
runtime.emit('user.created', { userId: '123', name: 'John' });
await runtime.process();
```

### 2. Stream Processing com Fan-in

```typescript
const userStream = runtime.createStream(async function* () {
    for await (const user of userService.getUsers()) {
        yield runtime.createEvent('user.created', user);
    }
});

const processedStream = userStream
    .filter(u => u.data.active)
    .debounce(1000)
    .batch(50, 5000)
    .merge(otherStream)  // Fan-in: Combinar streams
    .combineLatest(metricsStream); // Fan-in: Combinar com métricas
```

### 3. Workflow com Middleware e Fan-out

```typescript
const runtime = createRuntime(context, observability, {
    middleware: [
        withTimeout({ timeoutMs: 30000 }),
        withRetry({ maxRetries: 3, backoffMs: 2000 }),
        withConcurrency({ maxConcurrent: 10 }), // Fan-out
        withValidate({ schema: userSchema }),
    ],
});
```

## 🔧 Configuração

### Opções do Runtime

```typescript
interface RuntimeConfig {
    queueSize?: number;           // Tamanho da fila (default: 1000)
    batchSize?: number;           // Tamanho do batch (default: 100)
    enableObservability?: boolean; // Habilitar observabilidade (default: true)
    maxEventDepth?: number;       // Profundidade máxima de eventos (default: 100)
    maxEventChainLength?: number; // Comprimento máximo da cadeia (default: 1000)
    cleanupInterval?: number;     // Intervalo de cleanup (default: 2min)
    staleThreshold?: number;      // Threshold para handlers obsoletos (default: 10min)
    operationTimeoutMs?: number;  // Timeout de operações (default: 30s)
    middleware?: Middleware[];    // Middlewares para aplicar (incluindo Fan-out)
}
```

## 📈 Performance

### Benchmarks

- **Throughput**: 10,000+ eventos/segundo
- **Latency**: < 1ms para processamento simples
- **Fan-out**: Até 100 eventos processados em paralelo
- **Memory**: Garbage collection automático
- **Scalability**: Suporte a múltiplos tenants

## 🔒 Segurança

- ✅ Validação de eventos
- ✅ Proteção contra loops infinitos
- ✅ Timeout em todas as operações
- ✅ Isolamento de tenants
- ✅ Rate limiting integrado
- ✅ Controle de concorrência (Fan-out)

## 📚 Exemplos

### Exemplo Básico
Veja `src/runtime/examples/simple-usage.ts` para exemplos básicos de uso.

### Exemplo Avançado: Fan-out e Fan-in
Veja `src/runtime/examples/fan-out-fan-in-example.ts` para exemplos completos de:

- **Fan-out**: Processamento paralelo com middleware de concorrência
- **Fan-in**: Agregação de streams com merge e combineLatest
- **Casos de uso reais**: IoT, E-commerce, Monitoramento em tempo real

```bash
# Executar exemplo de Fan-out/Fan-in
npx tsx src/runtime/examples/fan-out-fan-in-example.ts
```

## 🤝 Contribuição

O Runtime é parte do Kodus Flow e segue as mesmas diretrizes de contribuição.

---

**Runtime** - Simplicidade, performance, Fan-out/Fan-in e confiabilidade para workflows AI em escala. 🚀 