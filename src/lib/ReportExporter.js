import { loadXlsx } from '@/lib/xlsx';

export const exportToPDF = async (elementId, title = "Report") => {
  const element = document.getElementById(elementId);
  if (!element) return;

  try {
    const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ]);
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false
    });
    
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4"
    });

    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
    pdf.save(`${title.replace(/\s+/g, "_")}_${new Date().toISOString().split('T')[0]}.pdf`);
  } catch (error) {
    console.error("Export to PDF failed:", error);
    throw new Error("Failed to generate PDF");
  }
};

export const exportToExcel = async (data, title = "Report") => {
  try {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, `${title.replace(/\s+/g, "_")}_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (error) {
    console.error("Export to Excel failed:", error);
    throw new Error("Failed to generate Excel file");
  }
};

export const exportToCSV = async (data, title = "Report") => {
  try {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet(data);
    const csv = XLSX.utils.sheet_to_csv(ws);
    
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    link.setAttribute("href", url);
    link.setAttribute("download", `${title.replace(/\s+/g, "_")}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Export to CSV failed:", error);
    throw new Error("Failed to generate CSV file");
  }
};
