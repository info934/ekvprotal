import { toast } from '@/components/ui/use-toast';

/**
 * Parses a Supabase/PostgreSQL error and returns a user-friendly message.
 */
export const parseApiError = (error) => {
  if (!error) return null;
  const msg = error.message || '';

  // Unique constraint violations
  if (msg.includes('duplicate key value violates unique constraint')) {
    if (msg.includes('members_email_key')) return 'Uživatel s tímto emailem již existuje.';
    if (msg.includes('projects_code_key')) return 'Projekt s tímto kódem již existuje.';
    return 'Záznam s touto unikátní hodnotou již existuje.';
  }

  // Foreign key constraint violations
  if (msg.includes('violates foreign key constraint')) {
    if (msg.includes('update or delete on table')) return 'Nelze smazat záznam, protože je používán jinde (např. v docházce nebo financích).';
    return 'Odkazovaný záznam neexistuje.';
  }

  // Check constraint violations
  if (msg.includes('violates check constraint')) {
    if (msg.includes('percentage')) return 'Hodnota procent musí být mezi 0 a 100.';
    if (msg.includes('amount')) return 'Částka musí být kladná.';
    return 'Zadaná hodnota nesplňuje podmínky (např. záporné číslo tam, kde má být kladné).';
  }

  // Not null violations
  if (msg.includes('null value in column')) {
    return 'Nevyplnili jste povinné pole.';
  }

  return msg || 'Došlo k neznámé chybě.';
};

/**
 * Validates data against a Zod schema before sending to API.
 * Displays toast on error.
 */
export const validateAndSave = async (schema, data, apiCall, successMessage = 'Uloženo') => {
  try {
    // 1. Client-side Validation
    const validData = schema.parse(data);

    // 2. API Call
    const result = await apiCall(validData);

    if (result.error) {
      throw result.error;
    }

    // 3. Success
    toast({
      title: 'Úspěch',
      description: successMessage,
      variant: 'success'
    });
    
    return { success: true, data: result.data };

  } catch (error) {
    // Zod Error
    if (error.issues) {
      const messages = error.issues.map(i => i.message).join(', ');
      toast({
        title: 'Chyba validace',
        description: messages,
        variant: 'destructive'
      });
      return { success: false, error };
    }

    // API Error
    const friendlyMsg = parseApiError(error);
    toast({
      title: 'Chyba serveru',
      description: friendlyMsg,
      variant: 'destructive'
    });
    return { success: false, error };
  }
};