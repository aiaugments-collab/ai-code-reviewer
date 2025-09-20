import { Role } from '@/core/domain/permissions/enums/permissions.enum';
import { IUser } from '@/core/domain/user/interfaces/user.interface';
import { Request } from 'express';

type User = Partial<Omit<IUser, 'password'>>;

export type UserRequest = Request & { user: User };
