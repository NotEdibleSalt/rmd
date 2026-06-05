// deno-lint-ignore no-explicit-any
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
      timer = null;
    }, ms);
  };
}
