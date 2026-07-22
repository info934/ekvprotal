let xlsxModulePromise;

export const loadXlsx = async () => {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import('xlsx').catch((error) => {
      xlsxModulePromise = null;
      throw error;
    });
  }

  return xlsxModulePromise;
};
