/** Shape every data hook returns, so pages are identical in both modes. */
export interface DataResult<T> {
  data: T;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}
