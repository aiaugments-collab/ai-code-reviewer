import { Injectable } from '@nestjs/common';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';

@Injectable()
export class DatabaseHealthIndicator {
    constructor(
        private readonly typeOrmHealthIndicator: TypeOrmHealthIndicator,
    ) {}

    async isDatabaseHealthy() {
        return this.typeOrmHealthIndicator.pingCheck('database');
    }
}