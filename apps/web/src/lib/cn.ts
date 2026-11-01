import { clsx, type ClassValue } from "clsx";

/**
 * Class name joiner.
 *
 * Deliberately clsx-only: `tailwind-merge` ships Tailwind's whole class-group
 * registry (~40 kB of JS), and those registry keys contain the literal strings
 * `mask-image-…`, which make the repository's `sk-` key scanner report a false
 * positive on the production bundle. We never rely on twMerge's conflict
 * resolution — components only append layout helpers — so dropping it costs
 * nothing and keeps the security gate honest.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
