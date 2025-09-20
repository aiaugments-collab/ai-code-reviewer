import { LibraryKodyRule } from '@/config/types/kodyRules.type';

export class PaginationMetadata {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}

export class PaginatedLibraryKodyRulesResponse {
    data: LibraryKodyRule[];
    pagination: PaginationMetadata;
}
