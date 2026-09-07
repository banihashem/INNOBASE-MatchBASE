export function errorMessage(data: any, fallback: string): string {
  return typeof data?.error === "string"
    ? data.error
    : data?.error?.message || data?.message || fallback;
}
