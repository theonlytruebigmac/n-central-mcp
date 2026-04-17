/** Shared tool schema helpers. */

export const paginationParams = {
  pageNumber: { type: 'number', description: 'Page number (starts at 1)' },
  pageSize: { type: 'number', description: 'Number of items per page (max 200)' },
  select: { type: 'string', description: 'Field selection (comma-separated field names)' },
  sortBy: { type: 'string', description: 'Field to sort results by' },
  sortOrder: {
    type: 'string',
    description: 'Sort order: ASC, asc, ascending, natural, desc, descending, reverse',
    enum: ['ASC', 'asc', 'ascending', 'natural', 'desc', 'descending', 'reverse'],
  },
  all: {
    type: 'boolean',
    description: 'Auto-paginate: fetch every page and return the combined list. Ignores pageNumber/pageSize. Use for complete results; omit to return a single page (cheaper, safer for large environments).',
  },
};

export function paginationArgs(args) {
  return {
    pageNumber: args.pageNumber,
    pageSize: args.pageSize,
    select: args.select,
    sortBy: args.sortBy,
    sortOrder: args.sortOrder,
  };
}
