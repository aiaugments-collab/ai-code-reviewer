import { EnrichedPullRequestResponse } from './enriched-pull-request-response.dto';

export class PaginationMetadata {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}

export class PaginatedEnrichedPullRequestsResponse {
    data: EnrichedPullRequestResponse[];
    pagination: PaginationMetadata;
}
