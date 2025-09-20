/**
 * @file basic-context.test.ts
 * @description Testes básicos do Core Layer - Context Management
 */

import { describe, it, expect } from 'vitest';
import {
    ContextStateService,
    UnifiedContextFactory,
    createBaseContext,
} from '../../src/core/context/index.js';

describe('Core Layer - Context Management', () => {
    it('should create state manager with proper interface', () => {
        const contextKey = {};
        const stateManager = new ContextStateService(contextKey);

        expect(stateManager).toBeDefined();
        expect(typeof stateManager.get).toBe('function');
        expect(typeof stateManager.set).toBe('function');
        expect(typeof stateManager.delete).toBe('function');
        expect(typeof stateManager.clear).toBe('function');
        expect(typeof stateManager.keys).toBe('function');
    });

    it('should manage state with namespaces', async () => {
        const contextKey = {};
        const stateManager = new ContextStateService(contextKey);

        // Set values in different namespaces
        await stateManager.set('user', 'id', 123);
        await stateManager.set('user', 'name', 'John');
        await stateManager.set('session', 'token', 'abc123');
        await stateManager.set('session', 'expires', 3600);

        // Get values
        expect(await stateManager.get('user', 'id')).toBe(123);
        expect(await stateManager.get('user', 'name')).toBe('John');
        expect(await stateManager.get('session', 'token')).toBe('abc123');
        expect(await stateManager.get('session', 'expires')).toBe(3600);

        // Get non-existent values
        expect(await stateManager.get('user', 'non-existent')).toBeUndefined();
        expect(await stateManager.get('non-existent', 'key')).toBeUndefined();
    });

    it('should get entire namespaces', async () => {
        const contextKey = {};
        const stateManager = new ContextStateService(contextKey);

        await stateManager.set('user', 'id', 123);
        await stateManager.set('user', 'name', 'John');
        await stateManager.set('user', 'email', 'john@example.com');

        const keys = await stateManager.keys('user');
        const userNamespace: Record<string, unknown> = {};
        for (const key of keys) {
            userNamespace[key] = await stateManager.get('user', key);
        }

        expect(userNamespace).toEqual({
            id: 123,
            name: 'John',
            email: 'john@example.com',
        });
    });

    it('should delete keys', async () => {
        const contextKey = {};
        const stateManager = new ContextStateService(contextKey);

        await stateManager.set('user', 'id', 123);
        await stateManager.set('user', 'name', 'John');

        expect(await stateManager.get('user', 'id')).toBe(123);
        expect(await stateManager.get('user', 'name')).toBe('John');

        // Delete specific key
        expect(await stateManager.delete('user', 'id')).toBe(true);
        expect(await stateManager.get('user', 'id')).toBeUndefined();
        expect(await stateManager.get('user', 'name')).toBe('John'); // Still exists

        // Try to delete non-existent key
        expect(await stateManager.delete('user', 'non-existent')).toBe(false);
    });

    it('should clear namespaces', async () => {
        const contextKey = {};
        const stateManager = new ContextStateService(contextKey);

        await stateManager.set('user', 'id', 123);
        await stateManager.set('user', 'name', 'John');
        await stateManager.set('session', 'token', 'abc123');

        // Clear specific namespace
        await stateManager.clear('user');
        expect(await stateManager.get('user', 'id')).toBeUndefined();
        expect(await stateManager.get('user', 'name')).toBeUndefined();
        expect(await stateManager.get('session', 'token')).toBe('abc123'); // Still exists

        // Clear all
        await stateManager.clear();
        expect(await stateManager.get('session', 'token')).toBeUndefined();
    });

    it('should create base context with proper structure', async () => {
        const context = createBaseContext({
            tenantId: 'test-tenant',
        });

        expect(context).toBeDefined();
        expect(context.executionId).toBeDefined();
        expect(context.tenantId).toBe('test-tenant');
        expect(context.startTime).toBeDefined();
        expect(context.status).toBe('RUNNING');
        // signal is optional in new implementation
        expect(typeof context.cleanup).toBe('function');
    });

    it('should create context factory', () => {
        const factory = new UnifiedContextFactory();
        expect(factory).toBeDefined();
        expect(typeof factory.createBaseContext).toBe('function');
        expect(typeof factory.createWorkflowContext).toBe('function');
    });

    it('should sanitize tenant ID', async () => {
        // Valid tenant ID
        const context1 = createBaseContext({
            tenantId: 'valid-tenant_123',
        });
        expect(context1.tenantId).toBe('valid-tenant_123');

        // Invalid tenant ID should throw
        expect(() => {
            createBaseContext({
                tenantId: 'invalid@tenant#123',
            });
        }).toThrow('TenantId contains invalid characters');
    });

    it('should require valid tenant ID', async () => {
        expect(() => {
            createBaseContext({
                tenantId: '',
            });
        }).toThrow('Valid tenantId is required for multi-tenant isolation');

        expect(() => {
            createBaseContext({
                tenantId: '   ',
            });
        }).toThrow('Valid tenantId is required for multi-tenant isolation');
    });
});
