/**
 * @license
 * Kodus Tech. All rights reserved.
 */

import { Module } from '@nestjs/common';
import { LICENSE_SERVICE_TOKEN } from './interfaces/license.interface';
import { LicenseService } from './license.service';

@Module({
    providers: [{
        provide: LICENSE_SERVICE_TOKEN,
        useClass: LicenseService,
    },],
    exports: [LICENSE_SERVICE_TOKEN],
})
export class LicenseModule { }
