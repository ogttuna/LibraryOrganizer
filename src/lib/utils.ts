import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024)
    return `${(size / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} KB`;
  return `${(size / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
}
export function formatDate(date: string) {
  return new Date(date).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
export function normalize(text: string) {
  return text.replace(/[Iİı]/g, 'i').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}
