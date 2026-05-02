import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Global variable to hold the private mode state for the utility function
// This is a simple way to make the utility context-aware without rewriting every component signature
// Ideally, components should receive this as a prop, but for a global "mask", we can check a condition.
// However, creating a React Hook `useCurrency` is better pattern, but `formatCurrency` is used inside non-react logic sometimes.
// For this task, we will stick to passing the `privateMode` flag or handling it within components.
// BUT, to make it easy to refactor:

export const formatCurrency = (amount, isPrivateMode = false) => {
  if (isPrivateMode) return '*** *** Kč';

  if (amount === null || amount === undefined) return '0 Kč';
  return Number(amount).toLocaleString('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  });
};

export const projectStatusConfig = {
  nabidka: { label: 'Nabídka', color: 'bg-gray-100 text-gray-800 border-gray-200' },
  active: { label: 'Aktivní', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  ready_for_delivery: { label: 'Připraveno k dodání', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  delivered: { label: 'Dodáno', color: 'bg-green-100 text-green-800 border-green-200' },
  closed: { label: 'Uzavřeno', color: 'bg-purple-100 text-purple-800 border-purple-200' },
};