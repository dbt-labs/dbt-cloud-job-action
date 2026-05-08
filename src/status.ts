export function shouldJobFail(
  status: number | undefined,
  failureOnError: boolean,
): boolean {
  return failureOnError && status !== undefined && status !== 10;
}
