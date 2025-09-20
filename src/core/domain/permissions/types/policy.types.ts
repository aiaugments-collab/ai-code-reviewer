import { Type } from '@nestjs/common';
import { AppAbility, Subject } from './permissions.types';
import { Action } from '../enums/permissions.enum';
import { UserRequest } from '@/config/types/http/user-request.type';

export interface IPolicyHandler {
    handle(
        ability: AppAbility,
        request?: UserRequest,
    ): Promise<boolean> | boolean;
}

export type PolicyHandlerCallback = (
    ability: AppAbility,
    request?: UserRequest,
) => Promise<boolean> | boolean;

export type PolicyHandler =
    | IPolicyHandler
    | PolicyHandlerCallback
    | Type<IPolicyHandler>;
